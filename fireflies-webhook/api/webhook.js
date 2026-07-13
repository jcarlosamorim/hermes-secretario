// Webhook publico (Vercel) do Fireflies -- captura de reunioes do Hermes
// Secretario.
//
// Fireflies so aceita URL HTTPS publica pra webhook. Este endpoint:
//   1. recebe o POST e valida a assinatura HMAC (x-hub-signature)
//   2. extrai meetingId/eventType e grava raw no Supabase (fireflies_meetings)
//   3. responde rapido, sem nenhuma chamada externa antes do 200
//
// A busca dos action items (GraphQL do Fireflies) roda no cron
// (api/cron/fetch-actions.js), nunca aqui. A triagem e do Hermes.

import { waitUntil } from '@vercel/functions';
import crypto from 'node:crypto';
import { getSupabase } from '../lib/supabase.js';

export const config = {
  api: { bodyParser: false },
};

// V1 do Fireflies so tem "Transcription completed"; V2 usa
// "meeting.summarized" / "meeting.transcribed". Aceitamos os tres.
const ACCEPTED_EVENTS = new Set([
  'meeting.summarized',
  'meeting.transcribed',
  'Transcription completed',
]);

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function verifySignature(rawBody, header, secret) {
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractEvent(payload) {
  const eventType = payload.eventType || payload.event || payload.type;
  const meetingId = payload.meetingId || payload.meeting_id || payload?.data?.meetingId;
  const clientReferenceId = payload.clientReferenceId || payload.client_reference_id || null;
  return { eventType, meetingId, clientReferenceId };
}

async function persist(payload, meta) {
  const row = {
    fireflies_meeting_id: meta.meetingId,
    event_type: meta.eventType || null,
    client_reference_id: meta.clientReferenceId,
    raw_payload: payload,
    received_at: new Date().toISOString(),
    processed: false,
  };

  try {
    const { error } = await getSupabase()
      .from('fireflies_meetings')
      .upsert(row, { onConflict: 'fireflies_meeting_id', ignoreDuplicates: true });
    if (error) console.error('[webhook] insert error:', error.message);
    else console.log(`[webhook] reuniao ${meta.meetingId} capturada`);
  } catch (err) {
    console.error('[webhook] insert exception:', err.message);
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('hermes-secretario-fireflies ok');
  if (req.method !== 'POST') return res.status(405).send('method not allowed');

  const rawBody = await readRawBody(req);

  const secret = process.env.FIREFLIES_WEBHOOK_SECRET;
  if (secret) {
    const header = req.headers['x-hub-signature'];
    if (!verifySignature(rawBody, header, secret)) {
      console.warn('assinatura invalida, request rejeitado');
      return res.status(401).send('invalid signature');
    }
  } else {
    console.warn('FIREFLIES_WEBHOOK_SECRET nao configurada, aceitando sem verificar assinatura');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8') || '{}');
  } catch {
    return res.status(400).send('invalid json');
  }

  const meta = extractEvent(payload);

  if (meta.eventType && !ACCEPTED_EVENTS.has(meta.eventType)) {
    console.log(`evento ignorado: ${meta.eventType}`);
    return res.status(200).json({ ok: true, ignored: true });
  }

  if (!meta.meetingId) {
    console.warn('payload sem meetingId, descartado');
    return res.status(200).json({ ok: true, ignored: true });
  }

  // Responde rapido, antes de qualquer I/O.
  res.status(200).json({ ok: true });

  waitUntil(persist(payload, meta));
}
