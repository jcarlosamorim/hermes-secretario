// Extrai sinais normalizados de um payload de webhook uazapi.
//
// A uazapi (API nao-oficial) entrega mensagens em pelo menos dois formatos
// ja observados em producao neste workspace:
//   - "flattened" (uazapiGO V2 / pablo-whatsapp-manager): campos direto no
//     objeto message (messageid, chatid, isGroup, sender, text, ...)
//   - "baileys-raw" (whatsapp-daily-digest): message = { key, pushName,
//     messageTimestamp, message: { conversation | extendedTextMessage... } },
//     formato cru do protocolo Baileys.
//
// Os nomes de campo de mencao (@) e reply (quoted) NAO sao documentados
// publicamente pela uazapi. Cobrimos os candidatos mais prováveis para cada
// formato; use scripts/replay.js contra um payload real capturado em
// raw_payload para calibrar isso quando necessario.

function normalizeJid(value) {
  if (!value) return '';
  return String(value).replace(/@.*$/, '').replace(/\D/g, '');
}

// Um item de mencao pode vir como string de JID ou, em variacoes possiveis
// da uazapi, como objeto ({ jid | id | phone | number }). Sem esse fallback,
// String(objeto) vira '[object Object]' e a mencao some silenciosamente.
function normalizeMentionEntry(entry) {
  if (entry && typeof entry === 'object') {
    return normalizeJid(entry.jid || entry.id || entry.phone || entry.number || '');
  }
  return normalizeJid(entry);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function extractTimestampMs(candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const n = Number(c);
    if (!Number.isFinite(n) || n <= 0) continue;
    return n < 1e12 ? n * 1000 : n; // <13 digitos ~ segundos, senao ja em ms
  }
  return Date.now();
}

function extractEnvelope(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.message && typeof body.message === 'object') {
    return { message: body.message, owner: body.owner || null };
  }
  if (body.data && typeof body.data === 'object') {
    return { message: body.data, owner: body.owner || body.instance || null };
  }
  if (body.messageid || body.chatid || body.key) {
    return { message: body, owner: body.owner || null };
  }
  return null;
}

function extractFlattened(msg) {
  const mentionSource = msg.mentioned ?? msg.mentions ?? msg.mentionedJid ?? [];
  const quoted = msg.quoted || msg.quotedMsg || null;
  const chatId = msg.chatid || msg.chatId || null;

  return {
    messageId: msg.messageid || msg.id || null,
    chatId,
    isGroup: Boolean(msg.isGroup) || String(chatId || '').endsWith('@g.us'),
    senderId: msg.sender || null,
    senderName: msg.senderName || msg.pushName || null,
    chatName: msg.groupName || msg.chatName || null,
    fromMe: Boolean(msg.fromMe),
    wasSentByApi: Boolean(msg.wasSentByApi),
    messageType: msg.messageType || msg.type || 'unknown',
    textContent: msg.text || msg.content || msg.body || '',
    mentionedJids: asArray(mentionSource).map(normalizeMentionEntry).filter(Boolean),
    quotedParticipant: quoted
      ? normalizeJid(quoted.participant || quoted.sender || quoted.senderId)
      : '',
    quotedFromMe: quoted ? Boolean(quoted.fromMe) : false,
    receivedAtMs: extractTimestampMs([msg.messageTimestamp, msg.timestamp, msg.moment]),
  };
}

const BAILEYS_TYPE_KEYS = [
  'conversation',
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'contactMessage',
  'locationMessage',
];

function extractBaileysRaw(msg) {
  const key = msg.key || {};
  const inner = msg.message || {};
  const extended = inner.extendedTextMessage || {};
  const ctx = extended.contextInfo || inner.contextInfo || {};
  const text =
    inner.conversation ||
    extended.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption ||
    '';
  const remoteJid = key.remoteJid || '';
  const isGroup = remoteJid.endsWith('@g.us');
  const messageType = BAILEYS_TYPE_KEYS.find((k) => inner[k]) || Object.keys(inner)[0] || 'unknown';

  return {
    messageId: key.id || null,
    chatId: remoteJid || null,
    isGroup,
    senderId: isGroup ? key.participant || '' : remoteJid,
    senderName: msg.pushName || null,
    chatName: null, // so via /group/info da uazapi -- fora do hot path do webhook
    fromMe: Boolean(key.fromMe),
    wasSentByApi: false,
    messageType,
    textContent: text,
    mentionedJids: asArray(ctx.mentionedJid).map(normalizeMentionEntry).filter(Boolean),
    quotedParticipant: normalizeJid(ctx.participant),
    quotedFromMe: false,
    receivedAtMs: extractTimestampMs([msg.messageTimestamp]),
  };
}

// Retorna null se o payload nao contiver uma mensagem reconhecivel
// (ex.: evento de status/presence, ping de healthcheck, formato desconhecido).
export function extractSignals(body) {
  const envelope = extractEnvelope(body);
  if (!envelope || !envelope.message) return null;

  const looksLikeBaileys = Boolean(envelope.message.key || envelope.message.message);
  const parsed = looksLikeBaileys
    ? extractBaileysRaw(envelope.message)
    : extractFlattened(envelope.message);

  if (!parsed.messageId || !parsed.chatId) return null;

  const ownerDigits = normalizeJid(envelope.owner || process.env.OWNER_JID || '');
  const isMentioned = ownerDigits ? parsed.mentionedJids.includes(ownerDigits) : false;
  const isReplyToMe =
    parsed.quotedFromMe || (ownerDigits ? parsed.quotedParticipant === ownerDigits : false);

  return {
    ...parsed,
    chatType: parsed.isGroup ? 'group' : 'dm',
    isMentioned,
    isReplyToMe,
    receivedAt: new Date(parsed.receivedAtMs).toISOString(),
  };
}

export { normalizeJid };
