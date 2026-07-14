-- Hermes Secretário -- Observabilidade (painel de saúde)
-- Execute no Supabase Dashboard > SQL Editor (ou via instalar-banco.mjs).
--
-- Uma linha por disparo de cron dos projetos Vercel (transcrição, Fireflies).
-- O painel (/api/dashboard) lê daqui pra responder "os robôs rodaram?".
-- A triagem do agente já tem tabela própria (triagem_runs, migration 003) --
-- esta cobre o que roda FORA do agente.
--
-- Log é best-effort: falha ao gravar aqui NUNCA derruba o cron (ver
-- lib/cron-log.js). Por isso a tabela não tem constraint além do essencial.

CREATE TABLE IF NOT EXISTS cron_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'webhook' (projeto principal) | 'fireflies' (projeto opcional 3B)
  project      TEXT NOT NULL,
  -- 'transcribe' | 'fetch-actions'
  job          TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  finished_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms  INT,
  status       TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  -- Contadores do disparo (ex.: {"transcritos": 2, "falhas": 0}). Nunca
  -- contém texto de mensagem.
  stats        JSONB,
  error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_recent
  ON cron_runs (started_at DESC);

-- Mesma postura de segurança das outras tabelas: RLS habilitado SEM policy
-- nega anon/authenticated por padrão; a service role (webhook, painel)
-- bypassa. NUNCA crie policy "FOR ALL USING (true)" sem TO service_role.
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
