-- Hermes Secretário -- Estágio 2 (Triagem pelo agente)
-- Cada linha é uma task criada pelo agente a partir de uma CONVERSA
-- (grupo de mensagens do mesmo chat), nunca de uma mensagem isolada.

CREATE TABLE IF NOT EXISTS tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Âncora: a mensagem MAIS RECENTE da conversa que gerou a task.
  -- UNIQUE garante idempotência (re-rodar a triagem não duplica task).
  whatsapp_message_id   UUID NOT NULL UNIQUE REFERENCES whatsapp_messages(id),
  -- Todas as mensagens da conversa que sustentam a task (inclui a âncora).
  context_message_ids   UUID[] NOT NULL DEFAULT '{}',

  titulo                TEXT NOT NULL,
  resumo                TEXT NOT NULL,
  -- Decide o TÓPICO do Telegram em que o card é publicado.
  categoria             TEXT NOT NULL CHECK (categoria IN ('pessoal', 'empresa')),
  tipo                  TEXT NOT NULL DEFAULT 'outro'
                        CHECK (tipo IN ('pergunta', 'pedido', 'agendamento', 'urgente', 'outro')),
  prioridade            TEXT NOT NULL CHECK (prioridade IN ('critica', 'alta', 'media', 'baixa')),
  requer_resposta       BOOLEAN NOT NULL DEFAULT false,
  acao_sugerida         TEXT,
  prazo_texto           TEXT,
  prazo_previsto        TIMESTAMPTZ,
  responsavel           TEXT,
  confianca             TEXT NOT NULL CHECK (confianca IN ('alta', 'media', 'baixa')),

  status                TEXT NOT NULL DEFAULT 'aberta'
                        CHECK (status IN ('aberta', 'concluida', 'arquivada')),
  closed_reason         TEXT,

  -- SLA calculado pelo CLI (determinístico): prazo explícito vence; senão
  -- tabela por prioridade. NULL = sem cobrança automática.
  sla_at                TIMESTAMPTZ,
  sla_regra             TEXT,

  -- Referência livre do card publicado pelo Hermes (id de mensagem do
  -- Telegram, link, id de card). Gravada via comando ack-card.
  card_ref              TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_abertas
  ON tasks (sla_at)
  WHERE status = 'aberta';

CREATE INDEX IF NOT EXISTS idx_tasks_categoria
  ON tasks (categoria, created_at DESC);

-- Mesmo racional de 001: RLS sem policy. Não adicione policy sem TO service_role.
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
