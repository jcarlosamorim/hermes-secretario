// Transcricao de audio do WhatsApp no Estagio 2. So roda pra mensagem de audio
// SEM text_content. Baixa o mp3 via uazapi e transcreve com Groq Whisper --
// assim o audio vira text_content e e classificado como qualquer outra
// mensagem, em vez de virar um card "transcreva isso" pro Jose.
//
// Este e o unico lugar do pipeline onde o audio e acessivel: a tabela
// `compromissos` (que o Hermes le) nunca expoe raw_payload/midia, por design
// de seguranca. Por isso a transcricao mora aqui, nao no lado do Hermes.
//
// Nenhuma chave em log. Falha aqui NAO trava o cron -- retorna null e o audio
// cai na classificacao padrao (baixa prioridade), pra tentar de novo depois.

import { extractSignals } from './extract.js';
import { downloadAudioUrl } from './uazapi.js';

const GROQ_KEY = () => process.env.GROQ_API_KEY || '';
const WHISPER_MODEL = () => process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3';

// Detecta se o raw_payload e uma mensagem de audio (ptt/voice/audio),
// reusando o mesmo parser do webhook. Retorna false pra qualquer outro tipo
// ou payload nao reconhecido.
export function isAudioMessage(rawPayload) {
  try {
    const sig = extractSignals(rawPayload);
    if (!sig) return false;
    return /audio|ptt|voice/i.test(String(sig.messageType || ''));
  } catch {
    return false;
  }
}

async function fetchAudioBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download mp3 ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function groqTranscribe(audioBuffer) {
  const fd = new FormData();
  fd.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'audio.mp3');
  fd.append('model', WHISPER_MODEL());
  fd.append('language', 'pt');
  fd.append('response_format', 'json');

  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY()}` },
    body: fd,
  });
  if (!r.ok) throw new Error(`groq transcribe ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return (data.text || '').trim();
}

// Recebe { uazapiMessageId }. Retorna a transcricao (string nao-vazia) ou null
// se nao der pra transcrever (sem GROQ_API_KEY, sem id, download falhou,
// audio vazio). O chamador decide o que fazer com null (classificacao padrao).
export async function transcribeAudioMessage({ uazapiMessageId }) {
  if (!GROQ_KEY()) {
    console.error(JSON.stringify({ level: 'transcribe_skip', reason: 'no_groq_key' }));
    return null;
  }
  if (!uazapiMessageId) return null;

  try {
    const url = await downloadAudioUrl(uazapiMessageId);
    const buf = await fetchAudioBuffer(url);
    const text = await groqTranscribe(buf);
    return text || null;
  } catch (err) {
    console.error(JSON.stringify({ level: 'transcribe_error', message: err.message }));
    return null;
  }
}
