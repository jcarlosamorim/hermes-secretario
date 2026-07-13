// Regra de relevancia (sincrona, sem I/O externo):
//   - mensagem enviada por API (wasSentByApi, bots) -> descarta sempre
//   - chat na lista de exclusao -> descarta sempre
//   - mensagem propria (fromMe manual) -> EVIDENCIA de resolucao: em DM
//     sempre entra; em grupo so quando e reply ou menciona alguem (senao o
//     volume de conversa do Jose em grupos afogaria o pipeline). Nunca vira
//     compromisso -- o Estagio 2 usa como prova de "ja respondi isso" pra
//     gerar resolution_candidates.
//   - DM de contato -> sempre relevante
//   - grupo -> relevante so se mencionado ou reply direto a uma mensagem sua

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = fileURLToPath(new URL('../config/excluded-chats.json', import.meta.url));

let cachedExclusions = null;

function loadExcludedChatIds() {
  if (cachedExclusions) return cachedExclusions;
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const data = JSON.parse(raw);
    cachedExclusions = new Set(data.excludedChatIds || []);
  } catch (err) {
    console.error('[filter] falha ao ler config/excluded-chats.json:', err.message);
    cachedExclusions = new Set();
  }
  return cachedExclusions;
}

export function evaluateRelevance(signals, options = {}) {
  if (!signals) return { relevant: false, reason: 'unparseable' };

  // Bot/API mandando pelo numero do Jose nao e o Jose respondendo.
  if (signals.wasSentByApi) {
    return { relevant: false, reason: 'own-api-message' };
  }

  const excluded = options.excludedChatIds ? new Set(options.excludedChatIds) : loadExcludedChatIds();
  if (excluded.has(signals.chatId)) {
    return { relevant: false, reason: 'excluded-chat' };
  }

  if (signals.fromMe) {
    if (signals.chatType === 'dm') {
      return { relevant: true, reason: 'own-dm-evidence' };
    }
    const isReplyOrMention =
      Boolean(signals.quotedParticipant) ||
      signals.quotedFromMe ||
      (signals.mentionedJids || []).length > 0;
    if (isReplyOrMention) {
      return { relevant: true, reason: 'own-group-reply-evidence' };
    }
    return { relevant: false, reason: 'own-group-no-context' };
  }

  if (signals.chatType === 'dm') {
    return { relevant: true, reason: 'dm' };
  }

  if (signals.isMentioned) {
    return { relevant: true, reason: 'group-mention' };
  }

  if (signals.isReplyToMe) {
    return { relevant: true, reason: 'group-reply' };
  }

  return { relevant: false, reason: 'group-no-match' };
}

// Usado pelos scripts de teste para reler o config apos edita-lo em memoria.
export function _resetExclusionCacheForTests() {
  cachedExclusions = null;
}
