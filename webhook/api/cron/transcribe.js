// Vassoura de transcrição (fase 3D, opcional): varre áudios capturados que
// ficaram SEM text_content (falha transitória no hot-path do webhook) e
// transcreve via Groq Whisper. O caminho quente é o próprio webhook da
// uazapi (transcreve na chegada); este cron diário só recolhe o que sobrou.
// Também pode ser disparado manualmente: Authorization: Bearer $CRON_SECRET.
//
// Sem GROQ_API_KEY configurada = fase 3D não instalada: responde ok e não
// faz nada (nunca derruba o resto do projeto).

import { getSupabase } from '../../lib/supabase.js';
import { isAudioMessage, transcribeAudioMessage } from '../../lib/transcribe.js';

const MAX_PER_RUN = Number(process.env.MAX_TRANSCRIBE_PER_RUN || 5);

export default async function handler(req, res) {
  if (!process.env.GROQ_API_KEY) {
    return res.status(200).json({ ok: true, skip: 'transcricao nao instalada (sem GROQ_API_KEY)' });
  }
  // Fase 3D instalada => secret OBRIGATÓRIO (fail-closed). Sem ele, um
  // endpoint público queimaria a quota Groq do dono a cada GET. O cron da
  // Vercel manda o Bearer automaticamente quando a env CRON_SECRET existe.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(503).send('CRON_SECRET nao configurada (obrigatoria com GROQ_API_KEY)');
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).send('unauthorized');
  }

  const supabase = getSupabase();
  const { data: candidatas, error } = await supabase
    .from('whatsapp_messages')
    .select('id, uazapi_message_id, raw_payload')
    .is('text_content', null)
    .eq('processed', false)
    .order('received_at', { ascending: true })
    .limit(50);
  if (error) return res.status(500).json({ ok: false, erro: error.message });

  // Só mensagens de áudio (ptt/voice/audio); o resto de text_content null é
  // mídia sem legenda, que não tem o que transcrever.
  const audios = candidatas.filter((m) => isAudioMessage(m.raw_payload)).slice(0, MAX_PER_RUN);
  const stats = { candidatas: candidatas.length, audios: audios.length, transcritos: 0, falhas: 0 };

  for (const msg of audios) {
    const text = await transcribeAudioMessage({ uazapiMessageId: msg.uazapi_message_id });
    if (!text) {
      stats.falhas += 1;
      continue;
    }
    // Guard .is(text_content, null): nunca sobrescreve texto que o hot-path
    // (ou uma rodada concorrente) já gravou.
    const { error: upErr } = await supabase
      .from('whatsapp_messages')
      .update({ text_content: text })
      .eq('id', msg.id)
      .is('text_content', null);
    if (upErr) {
      console.error('[transcribe] update:', upErr.message);
      stats.falhas += 1;
      continue;
    }
    stats.transcritos += 1;
  }

  console.log('[transcribe]', JSON.stringify(stats));
  return res.status(200).json({ ok: true, ...stats });
}
