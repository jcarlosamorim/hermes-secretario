// Webhook da uazapi -- Estagio 1 (Captura) do Hermes Secretario.
// Sem LLM, sem classificacao: so filtro de relevancia + grava raw no Supabase.
//
// Fluxo:
//   1. uazapi entrega a mensagem (POST) nesta URL, com ?secret=... na query
//   2. valida o secret, responde 200 o mais rapido possivel (sem I/O antes disso)
//   3. extrai sinais do payload (DM/grupo, mencao, reply) -- sincrono, sem I/O
//   4. se relevante, grava em background (waitUntil) na tabela whatsapp_messages
//
// O estagio 2 (triagem) e o agente, que varre de hora em hora as linhas com
// processed = false. Este webhook nunca chama LLM nem escreve em outro lugar.

import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { extractSignals } from '../../lib/extract.js';
import { evaluateRelevance } from '../../lib/filter.js';
import { getSupabase } from '../../lib/supabase.js';
import { logDecision, logValidationFailure, logInsertError } from '../../lib/logger.js';

function secretMatches(provided, expected) {
  if (!expected) {
    // Sem secret configurado: permite so fora de producao (dev local / preview).
    // Em producao um secret ausente falha FECHADO -- nunca aceita tudo por
    // omissao de config (VERCEL_ENV e setado automaticamente pela Vercel).
    return process.env.VERCEL_ENV !== 'production';
  }
  if (!provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function persist(signals, rawBody) {
  const row = {
    uazapi_message_id: signals.messageId,
    chat_id: signals.chatId,
    chat_type: signals.chatType,
    chat_name: signals.chatName,
    sender_id: signals.senderId,
    sender_name: signals.senderName,
    is_mentioned: signals.isMentioned,
    is_reply_to_me: signals.isReplyToMe,
    from_me: Boolean(signals.fromMe),
    text_content: signals.textContent || null,
    raw_payload: rawBody,
    received_at: signals.receivedAt,
    processed: false,
  };

  try {
    const { error } = await getSupabase()
      .from('whatsapp_messages')
      .upsert(row, { onConflict: 'uazapi_message_id', ignoreDuplicates: true });
    if (error) logInsertError(signals.chatId, error);
  } catch (err) {
    logInsertError(signals.chatId, err);
  }
}

// Todo o processamento (parse, extracao, filtro, log, gravacao) roda aqui,
// SEMPRE depois do 200 ja ter sido enviado (chamado via waitUntil). Nada
// disso -- nem o JSON.parse de um body-string -- deve rodar de forma
// sincrona antes da resposta: no event loop do Node, trabalho sincrono
// entre res.json() e o retorno do handler adia o flush real do socket.
async function processBody(rawBody) {
  let body = rawBody;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }

  if (!body || typeof body !== 'object') {
    logValidationFailure('invalid_or_empty_body');
    return;
  }

  const signals = extractSignals(body);
  if (!signals) {
    logValidationFailure('unrecognized_payload_shape');
    return;
  }

  const { relevant, reason } = evaluateRelevance(signals);
  logDecision({
    chatId: signals.chatId,
    chatType: signals.chatType,
    isMentioned: signals.isMentioned,
    isReplyToMe: signals.isReplyToMe,
    receivedAt: signals.receivedAt,
    decision: relevant ? 'gravou' : 'descartou',
    reason,
  });

  if (!relevant) return;

  await persist(signals, body);
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('hermes-secretario-webhook ok');
  if (req.method !== 'POST') return res.status(405).send('method not allowed');

  if (!secretMatches(req.query?.secret, process.env.UAZAPI_WEBHOOK_SECRET)) {
    logValidationFailure('secret_mismatch');
    return res.status(401).send('unauthorized');
  }

  // Responde imediatamente, antes de qualquer parse/filtro/gravacao.
  res.status(200).json({ ok: true });

  waitUntil(processBody(req.body));
}
