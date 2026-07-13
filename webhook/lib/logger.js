// Logging deliberadamente pobre em conteudo: nunca imprime text_content nem
// o payload bruto inteiro. O rastro completo fica em raw_payload no Supabase
// (que ja tem controle de acesso via service role key), nao em log solto de
// aplicacao (Vercel logs sao mais expostos e de retencao menor).

export function logDecision({ chatId, chatType, isMentioned, isReplyToMe, receivedAt, decision, reason }) {
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      chat_id: chatId,
      chat_type: chatType,
      is_mentioned: Boolean(isMentioned),
      is_reply_to_me: Boolean(isReplyToMe),
      received_at: receivedAt,
      decision, // 'gravou' | 'descartou'
      reason,
    })
  );
}

export function logValidationFailure(reason, extra = {}) {
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      level: 'validation_failure',
      reason,
      ...extra,
    })
  );
}

export function logInsertError(chatId, error) {
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      level: 'insert_error',
      chat_id: chatId,
      message: error?.message || String(error),
    })
  );
}
