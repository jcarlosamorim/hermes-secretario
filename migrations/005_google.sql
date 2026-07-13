-- Hermes Secretário -- Fonte 3 (Gmail) + checagem de agenda (Google Calendar)
-- Um Google Apps Script na conta do dono sincroniza a cada 15 min pro
-- webhook (api/webhook/google.js), que grava aqui. A triagem de email é do
-- Hermes (critério: só ação humana necessária vira task). A agenda NUNCA
-- vira task: é contexto de checagem (fetch-agenda).

CREATE TABLE IF NOT EXISTS gmail_messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id   TEXT NOT NULL UNIQUE,
  thread_id          TEXT,
  from_name          TEXT,
  from_email         TEXT,
  to_email           TEXT,
  subject            TEXT,
  -- Primeiros ~800 chars do corpo em texto puro (truncado no Apps Script e
  -- de novo no webhook). O corpo completo NUNCA sai do Gmail.
  snippet            TEXT,
  labels             TEXT[] NOT NULL DEFAULT '{}',
  received_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed          BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_gmail_messages_unprocessed
  ON gmail_messages (received_at)
  WHERE NOT processed;

CREATE TABLE IF NOT EXISTS calendar_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_event_id    TEXT NOT NULL UNIQUE,
  title              TEXT,
  description        TEXT,
  location           TEXT,
  starts_at          TIMESTAMPTZ,
  ends_at            TIMESTAMPTZ,
  all_day            BOOLEAN NOT NULL DEFAULT false,
  attendees          TEXT[] NOT NULL DEFAULT '{}',
  status             TEXT,
  -- Atualizado a cada sync. Evento apagado da agenda para de ser "visto" e
  -- some da checagem sozinho (fetch-agenda filtra last_seen_at recente) --
  -- sem DELETE, sem race.
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_starts
  ON calendar_events (starts_at);

-- Mesmo racional das demais: RLS sem policy; nunca policy sem TO service_role.
ALTER TABLE gmail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- tasks ganha a terceira origem (WhatsApp XOR reunião XOR email).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS gmail_message_id UUID REFERENCES gmail_messages(id);

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_uma_origem;
ALTER TABLE tasks ADD CONSTRAINT tasks_uma_origem
  CHECK (num_nonnulls(whatsapp_message_id, fireflies_meeting_id, gmail_message_id) = 1);

-- 1 email -> 1 task (o Hermes funde demandas do mesmo email no resumo).
-- Índice completo: NULLs (tasks de outras origens) não colidem entre si.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_gmail
  ON tasks (gmail_message_id);

ALTER TABLE triagem_runs ADD COLUMN IF NOT EXISTS emails_analisados INT NOT NULL DEFAULT 0;
