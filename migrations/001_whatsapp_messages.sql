-- Hermes Secretário -- Estágio 1 (Captura)
-- Execute no Supabase Dashboard > SQL Editor, na ordem dos arquivos (001, 002, 003).

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uazapi_message_id  TEXT NOT NULL UNIQUE,
  chat_id            TEXT NOT NULL,
  chat_type          TEXT NOT NULL CHECK (chat_type IN ('dm', 'group')),
  chat_name          TEXT,
  sender_id          TEXT,
  sender_name        TEXT,
  is_mentioned       BOOLEAN NOT NULL DEFAULT false,
  is_reply_to_me     BOOLEAN NOT NULL DEFAULT false,
  -- Mensagem enviada pelo próprio dono (manual, não por bot/API). Em DM é
  -- capturada como EVIDÊNCIA: o agente de triagem usa pra perceber que o dono
  -- já respondeu/resolveu algo na própria conversa. Nunca vira task.
  from_me            BOOLEAN NOT NULL DEFAULT false,
  text_content       TEXT,
  raw_payload        JSONB NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed          BOOLEAN NOT NULL DEFAULT false
);

-- O agente de triagem varre por aqui (fetch-pending).
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_unprocessed
  ON whatsapp_messages (received_at)
  WHERE NOT processed;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat_received
  ON whatsapp_messages (chat_id, received_at DESC);

-- RLS habilitado SEM nenhuma policy: nega por padrão pra anon/authenticated
-- (as roles do PostgREST); o service_role (usado pelo webhook e pelo agente)
-- ignora RLS de qualquer forma. É assim que o Supabase concede acesso
-- administrativo, não via policy.
--
-- NUNCA adicione aqui uma policy tipo `FOR ALL USING (true)` sem
-- `TO service_role`: sem essa cláusula ela vale pra QUALQUER role, inclusive
-- anon, e expõe o texto das mensagens reais via REST com a anon key pública.
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
