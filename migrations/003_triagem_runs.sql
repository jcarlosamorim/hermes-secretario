-- Hermes Secretário -- Auditoria das varreduras do agente
-- O agente grava UMA linha por varredura (comando log-run). Best-effort:
-- falha ao logar nunca deve derrubar a varredura em si.

CREATE TABLE IF NOT EXISTS triagem_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  mensagens_lidas       INT NOT NULL DEFAULT 0,
  conversas_analisadas  INT NOT NULL DEFAULT 0,
  tasks_criadas         INT NOT NULL DEFAULT 0,
  ruido_arquivado       INT NOT NULL DEFAULT 0,
  cobrancas_sla         INT NOT NULL DEFAULT 0,
  -- Observações livres do agente (ex.: "2 áudios sem transcrição ignorados").
  notas                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_triagem_runs_recent
  ON triagem_runs (run_at DESC);

-- Mesmo racional de 001: RLS sem policy. Não adicione policy sem TO service_role.
ALTER TABLE triagem_runs ENABLE ROW LEVEL SECURITY;
