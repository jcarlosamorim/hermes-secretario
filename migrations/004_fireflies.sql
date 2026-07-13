-- Hermes Secretário -- Fonte 2: reuniões (Fireflies)
-- Captura em fireflies_meetings; o cron do fireflies-webhook só MATERIALIZA
-- os action items (GraphQL, sem LLM); a triagem continua sendo do Hermes,
-- que cria linhas em tasks com fireflies_meeting_id.

CREATE TABLE IF NOT EXISTS fireflies_meetings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fireflies_meeting_id  TEXT NOT NULL UNIQUE,
  event_type            TEXT,
  client_reference_id   TEXT,
  -- Preenchidos pelo cron fetch-actions (GraphQL do Fireflies):
  title                 TEXT,
  meeting_date          TIMESTAMPTZ,
  -- STRING única formatada em blocos por pessoa ("**Nome**\ntarefa (mm:ss)").
  -- O "(mm:ss)" é timestamp da call, NUNCA prazo.
  action_items_raw      TEXT,
  fetch_status          TEXT NOT NULL DEFAULT 'pendente'
                        CHECK (fetch_status IN ('pendente', 'ok', 'sem_action_items', 'erro')),
  fetch_attempts        INT NOT NULL DEFAULT 0,
  fetched_at            TIMESTAMPTZ,
  raw_payload           JSONB NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Triagem do Hermes concluída (via mark-meeting-processed).
  processed             BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_fireflies_meetings_unprocessed
  ON fireflies_meetings (received_at)
  WHERE NOT processed;

-- Mesmo racional das demais: RLS sem policy; nunca policy sem TO service_role.
ALTER TABLE fireflies_meetings ENABLE ROW LEVEL SECURITY;

-- tasks agora pode nascer de reunião (exatamente UMA origem por task).
ALTER TABLE tasks ALTER COLUMN whatsapp_message_id DROP NOT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS fireflies_meeting_id UUID REFERENCES fireflies_meetings(id);

DO $$ BEGIN
  ALTER TABLE tasks ADD CONSTRAINT tasks_uma_origem
    CHECK (num_nonnulls(whatsapp_message_id, fireflies_meeting_id) = 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Idempotência das tasks de reunião: uma reunião gera N tasks, então a
-- chave é (reunião, título). Índice COMPLETO de propósito: nas tasks de
-- WhatsApp fireflies_meeting_id é NULL e NULLs não colidem entre si, e o
-- upsert do PostgREST (on_conflict) não casa com índice parcial.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_meeting_titulo
  ON tasks (fireflies_meeting_id, titulo);

ALTER TABLE triagem_runs ADD COLUMN IF NOT EXISTS reunioes_analisadas INT NOT NULL DEFAULT 0;
