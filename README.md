# Hermes Secretário

Sistema pessoal de captura de compromissos: mensagens do WhatsApp viram
tasks triadas por um **agente** e publicadas como cards em tópicos de um
grupo do Telegram. Reprodução standalone do "Radar de Compromissos",
trocando o classificador LLM-em-cron por um agente com julgamento.

```
WhatsApp (uazapi) ──▶ webhook (Vercel) ──▶ whatsapp_messages (Supabase)
                       sem LLM, só filtro           │
                                                    ▼
                              Agente de Triagem (varre de hora em hora)
                              julga conversas via secretario.mjs, grava
                              tasks e publica cards nos tópicos
                                                    │
                                                    ▼
                     Grupo Telegram "Hermes Secretário" (fórum)
                     ├── 📡 Radar            relatórios + cobrança de SLA
                     ├── 🏠 Tarefas Pessoais cards categoria=pessoal
                     └── 🏢 Tarefas Empresa  cards categoria=empresa
```

## Stack

| Peça | Tecnologia | Papel |
|---|---|---|
| Captura | uazapi (instância própria) + webhook Node na Vercel | recebe toda mensagem, filtra relevância SEM LLM, grava raw no banco |
| Banco | Supabase (Postgres + PostgREST) | `whatsapp_messages`, `tasks`, `triagem_runs`; RLS sem policy |
| Triagem | Agente (OpenClaw, Claude Code ou similar) com cron horário | julga o que é task, categoria pessoal/empresa, prioridade |
| Ferramenta do agente | `agente/secretario.mjs` (Node 18+, zero deps) | única interface do agente com banco e Telegram |
| Entrega | Bot Telegram em grupo-fórum com 3 tópicos | cards de task + relatórios da varredura |

## Ordem de setup (siga os docs numerados)

1. **[docs/01-SETUP-SUPABASE.md](docs/01-SETUP-SUPABASE.md)**: criar
   projeto, rodar as 3 migrations, obter `SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY`.
2. **[docs/02-SETUP-UAZAPI.md](docs/02-SETUP-UAZAPI.md)**: deploy do
   `webhook/` na Vercel, criar instância uazapi, conectar o número (QR),
   registrar o webhook, validar 1 mensagem chegando na tabela.
3. **[docs/03-SETUP-TELEGRAM.md](docs/03-SETUP-TELEGRAM.md)**: bot via
   BotFather, grupo "Hermes Secretário" com Tópicos, bot admin, rodar
   `agente/setup-topics.mjs` pra criar os 3 tópicos e obter os ids.
4. **[docs/04-SETUP-AGENTE.md](docs/04-SETUP-AGENTE.md)**: instalar
   `secretario.mjs` + `AGENTE-TRIAGEM.md` no ambiente do agente, envs,
   cron horário, primeira varredura assistida.

## Credenciais (resumo)

| Variável | Onde conseguir | Quem usa |
|---|---|---|
| `UAZAPI_WEBHOOK_SECRET` | você gera (`openssl rand -hex 16`) | Vercel + URL registrada na uazapi |
| `OWNER_JID` | número do dono, só dígitos com DDI | Vercel |
| `SUPABASE_URL` | Supabase > Settings > Data API | Vercel + agente |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Settings > API Keys > service_role | Vercel + agente |
| token da instância uazapi | painel uazapi | só no curl de registro do webhook |
| `TELEGRAM_BOT_TOKEN` | @BotFather | agente |
| `TELEGRAM_CHAT_ID` | getUpdates após mensagem no grupo | agente |
| `TELEGRAM_TOPIC_*` (3) | `node agente/setup-topics.mjs` | agente |

Modelo completo em [.env.example](.env.example).

## O prompt do agente de triagem

Está em **[agente/AGENTE-TRIAGEM.md](agente/AGENTE-TRIAGEM.md)**. É o
equivalente do SYSTEM_PROMPT do sistema original: define o ciclo horário,
os critérios de julgamento (o que é task, categoria, prioridade), a
cobrança de SLA 3x/dia e as fronteiras (o agente nunca toca banco/Telegram
fora do CLI, nunca vê payload bruto, nunca responde WhatsApp).

## Estrutura do repo

```
migrations/        3 arquivos SQL (rodar na ordem no SQL Editor)
webhook/           projeto Vercel: captura uazapi -> Supabase
  api/webhook/uazapi.js   handler (responde 200 antes de processar)
  lib/extract.js          normaliza payloads uazapi (2 formatos)
  lib/filter.js           relevância: DM sempre; grupo só menção/reply
  config/excluded-chats.json  chats silenciados
agente/
  secretario.mjs          CLI zero-deps (única interface do agente)
  AGENTE-TRIAGEM.md       instrução/prompt do agente
  setup-topics.mjs        cria os tópicos do Telegram
test/test-secretario.mjs  asserts offline (node test/test-secretario.mjs)
docs/              setup passo-a-passo (01..04)
```

## Regras de segurança herdadas (a caro) do sistema original

1. RLS habilitado SEM policy em toda tabela; policy futura sempre com
   `TO service_role` explícito.
2. `service_role` key nunca em cliente, repo, chat ou log.
3. O agente nunca vê `raw_payload`/mídia: o CLI só entrega texto + metadados.
4. Enums vindos de julgamento (categoria, prioridade, confiança) validados
   por ALLOWLIST no CLI: valor fora da lista é erro, nunca default.
5. Prazo/SLA sempre ISO 8601 com offset explícito; sem offset o comando
   rejeita (o fuso da máquina nunca decide um prazo).
6. Logs/auditoria são best-effort: falha de log nunca derruba o pipeline.
7. Webhook responde 200 ANTES de qualquer processamento (uazapi tem retry
   agressivo; processamento roda em background via waitUntil).

## Diferenças conscientes vs o sistema original

| Original | Aqui | Por quê |
|---|---|---|
| Cron Vercel + Claude Haiku classifica | Agente julga na varredura | pedido de design desta reprodução |
| Kanban SQLite do agente consumidor | Tópicos no grupo Telegram | idem |
| `zona_pareto` no schema | `categoria` pessoal/empresa | tópicos pedem essa divisão |
| Fireflies como 2ª fonte | fora do escopo | extensão futura |
| Transcrição de áudio (Groq Whisper) | fora do escopo; áudio sem legenda é ignorado com aviso | extensão futura |
| Contrato de resolução automatizado | o agente vê `from_me` e julga "já resolvido" | julgamento substitui o guard determinístico |
| Dashboard de infra | fora do escopo | extensão futura |

## Testes

```bash
node test/test-secretario.mjs
```

18 asserts offline (SLA, validação fail-closed, formatação de card,
agrupamento por conversa e janela de assentamento). Sem rede, sem env.
