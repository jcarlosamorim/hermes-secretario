// Webhook do Google Apps Script -- Fonte 3 (Gmail) + agenda do Hermes
// Secretario. O Apps Script na conta Google do dono roda a cada 15 min e
// POSTa aqui dois lotes: {kind:'gmail'} e {kind:'calendar'}.
//
// Sem LLM, sem julgamento: gmail entra com processed=false (o Hermes tria);
// calendar e upsert com last_seen_at (evento apagado da agenda para de ser
// visto e some da checagem sozinho).
//
// Seguranca: mesmo padrao do uazapi.js -- ?secret= na query, comparacao
// timing-safe, fail-closed em producao sem env.

import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { getSupabase } from '../../lib/supabase.js';

const MAX_ITEMS = 100;
const SNIPPET_MAX = 1000;

function secretMatches(provided, expected) {
  if (!expected) {
    // Sem GOOGLE_SYNC_SECRET configurado: fase 3C nao instalada. Rejeita
    // sempre em producao (fail-closed), igual ao webhook da uazapi.
    return process.env.VERCEL_ENV !== 'production';
  }
  if (!provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// "Nome Sobrenome <email@dominio>" -> { name, email }
export function parseFromHeader(from) {
  const raw = String(from || '').trim();
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  if (raw.includes('@')) return { name: null, email: raw.toLowerCase() };
  return { name: raw || null, email: null };
}

function str(v, max = 500) {
  if (v == null) return null;
  const s = String(v).slice(0, max);
  return s || null;
}

function iso(v) {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

async function persistGmail(items) {
  const rows = items
    .filter((m) => m && m.gmail_message_id)
    .map((m) => {
      const { name, email } = parseFromHeader(m.from);
      return {
        gmail_message_id: String(m.gmail_message_id),
        thread_id: str(m.thread_id, 200),
        from_name: str(name, 200),
        from_email: str(email, 320),
        to_email: str(m.to, 320),
        subject: str(m.subject, 500),
        snippet: str(m.snippet, SNIPPET_MAX),
        labels: Array.isArray(m.labels) ? m.labels.slice(0, 20).map((l) => String(l).slice(0, 100)) : [],
        received_at: iso(m.received_at),
        processed: false,
      };
    });
  if (!rows.length) return;
  const { error } = await getSupabase()
    .from('gmail_messages')
    .upsert(rows, { onConflict: 'gmail_message_id', ignoreDuplicates: true });
  if (error) console.error('[google] gmail insert error:', error.message);
  else console.log(`[google] gmail: ${rows.length} mensagens no lote`);
}

async function persistCalendar(items) {
  const now = new Date().toISOString();
  const rows = items
    .filter((e) => e && e.google_event_id)
    .map((e) => ({
      google_event_id: String(e.google_event_id).slice(0, 300),
      title: str(e.title, 300),
      description: str(e.description, 500),
      location: str(e.location, 300),
      starts_at: iso(e.starts_at),
      ends_at: iso(e.ends_at),
      all_day: Boolean(e.all_day),
      attendees: Array.isArray(e.attendees) ? e.attendees.slice(0, 30).map((a) => String(a).slice(0, 320)) : [],
      status: str(e.status, 50),
      last_seen_at: now,
    }));
  if (!rows.length) return;
  // Upsert com MERGE (sem ignoreDuplicates): horario alterado e last_seen_at
  // precisam sobrescrever a linha existente.
  const { error } = await getSupabase()
    .from('calendar_events')
    .upsert(rows, { onConflict: 'google_event_id' });
  if (error) console.error('[google] calendar upsert error:', error.message);
  else console.log(`[google] calendar: ${rows.length} eventos vistos`);
}

async function processBody(rawBody) {
  let body = rawBody;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
    console.warn('[google] body invalido, descartado');
    return;
  }
  if (body.items.length > MAX_ITEMS) {
    // O Apps Script fatia em lotes de 100 (POST_CHUNK); estourar aqui indica
    // remetente fora do padrão. Nunca truncar em silêncio.
    console.warn(`[google] lote ${body.kind} com ${body.items.length} itens; mantendo os ${MAX_ITEMS} primeiros`);
  }
  const items = body.items.slice(0, MAX_ITEMS);
  if (body.kind === 'gmail') return persistGmail(items);
  if (body.kind === 'calendar') return persistCalendar(items);
  console.warn(`[google] kind desconhecido: ${body.kind}`);
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).send('hermes-secretario-google ok');
  if (req.method !== 'POST') return res.status(405).send('method not allowed');

  if (!secretMatches(req.query?.secret, process.env.GOOGLE_SYNC_SECRET)) {
    return res.status(401).send('unauthorized');
  }

  res.status(200).json({ ok: true });
  waitUntil(processBody(req.body));
}
