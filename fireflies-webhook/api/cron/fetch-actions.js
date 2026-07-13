// Cron horario (Vercel): materializa os action items das reunioes capturadas.
// SEM LLM: busca `summary.action_items` via GraphQL do Fireflies e grava o
// texto em fireflies_meetings.action_items_raw. Quem julga o que vira task
// e o Hermes (comando fetch-meetings do secretario.mjs).
//
// Limites conhecidos da API do Fireflies (plano Free): 50 chamadas/dia.
// Por isso MAX_FETCH_PER_RUN = 2 (24 rodadas x 2 = 48/dia no pior caso).

import { getSupabase } from '../../lib/supabase.js';
import { fetchTranscriptSummary } from '../../lib/fireflies.js';

const MAX_FETCH_PER_RUN = Number(process.env.MAX_FETCH_PER_RUN || 2);
const MAX_ATTEMPTS = 12; // ~12h tentando; depois marca sem_action_items/erro

// transcript.date vem em epoch MILISSEGUNDOS (nao segundos); cobre tambem
// string ISO por robustez.
function toIso(date) {
  if (date == null) return null;
  const n = Number(date);
  if (Number.isFinite(n) && n > 0) return new Date(n).toISOString();
  const t = Date.parse(date);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).send('unauthorized');
  }

  const supabase = getSupabase();
  const { data: pendentes, error } = await supabase
    .from('fireflies_meetings')
    .select('id, fireflies_meeting_id, fetch_attempts')
    .eq('fetch_status', 'pendente')
    .lt('fetch_attempts', MAX_ATTEMPTS)
    .order('received_at', { ascending: true })
    .limit(MAX_FETCH_PER_RUN);
  if (error) return res.status(500).json({ ok: false, erro: error.message });

  const stats = { candidatas: pendentes.length, ok: 0, aguardando: 0, sem_action_items: 0, erro: 0 };

  for (const meeting of pendentes) {
    const attempts = meeting.fetch_attempts + 1;
    const patch = { fetch_attempts: attempts };
    try {
      const transcript = await fetchTranscriptSummary(meeting.fireflies_meeting_id);
      const actionItems = transcript?.summary?.action_items;
      if (typeof actionItems === 'string' && actionItems.trim()) {
        patch.title = transcript.title || null;
        patch.meeting_date = toIso(transcript.date);
        patch.action_items_raw = actionItems;
        patch.fetch_status = 'ok';
        patch.fetched_at = new Date().toISOString();
        stats.ok += 1;
      } else if (attempts >= MAX_ATTEMPTS) {
        // Reuniao sem action items: nada a triar, nao pendura a fila do Hermes.
        patch.title = transcript?.title || null;
        patch.meeting_date = toIso(transcript?.date);
        patch.fetch_status = 'sem_action_items';
        patch.fetched_at = new Date().toISOString();
        patch.processed = true;
        stats.sem_action_items += 1;
      } else {
        // Summary pode ainda estar sendo gerado: tenta na proxima rodada.
        stats.aguardando += 1;
      }
    } catch (err) {
      console.error(`[fetch-actions] ${meeting.fireflies_meeting_id}:`, err.message);
      if (attempts >= MAX_ATTEMPTS) patch.fetch_status = 'erro';
      stats.erro += 1;
    }
    const { error: patchError } = await supabase
      .from('fireflies_meetings')
      .update(patch)
      .eq('id', meeting.id);
    if (patchError) console.error(`[fetch-actions] update ${meeting.id}:`, patchError.message);
  }

  console.log('[fetch-actions]', JSON.stringify(stats));
  return res.status(200).json({ ok: true, ...stats });
}
