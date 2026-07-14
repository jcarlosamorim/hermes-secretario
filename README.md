# Hermes Secretário

Radar de compromissos pessoal: toda mensagem relevante do seu WhatsApp
cai num banco; **seu Hermes** (seu agente de IA) varre de hora em hora,
decide o que é task de verdade e publica cards nos tópicos do grupo de
vocês no Telegram (**Tarefas Pessoais** e **Tarefas Empresa**), cobrando
o que vencer o prazo. Você para de depender da memória pra não perder
pedido, prazo e cobrança.

```
WhatsApp (uazapi) ──▶ webhook (Vercel) ──▶ whatsapp_messages ──┐
                       filtro sem julgamento;                  │
                       áudio → texto (Groq, opcional)          │
Fireflies (opcional) ─▶ webhook (Vercel) ─▶ fireflies_meetings ┤ (Supabase)
                        cron busca action items                │
Gmail + Agenda ───────▶ Apps Script ──▶ gmail_messages         │
(opcional)              sync 15 min     calendar_events ───────┘
                                                     │
                                                     ▼
                                  SEU HERMES (varre de hora em hora)
                                  julga conversas, reuniões e emails;
                                  checa a agenda; publica os cards
                                                     │
                                                     ▼
                          Grupo de vocês no Telegram
                          ├── 🏠 Tarefas Pessoais
                          ├── 🏢 Tarefas Empresa
                          └── relatórios + agenda + cobranças de SLA
```

## Como instalar

Você não instala nada sozinho. **Mande o link deste repositório pro seu
Hermes** e diga:

> Vamos instalar esse sistema. Leia o arquivo INSTALL-HERMES.md deste
> repositório e me guie passo a passo.

Ele conduz a instalação em 4 fases, validando cada uma: (1) você cria o
projeto no Supabase e cola as credenciais, e ELE cria as tabelas sozinho,
(2) você cola um token temporário da Vercel e ELE deploya o webhook
sozinho, (3) conectar seu WhatsApp na uazapi, (3B, opcional) ligar o
Fireflies pra reuniões virarem tasks também, (3C, opcional) ligar Gmail
(só email que exige ação vira task) e Google Agenda (checagem dos seus
compromissos), (3D, opcional) transcrição automática dos áudios do
WhatsApp, (4) instalar a rotina de triagem nele mesmo. Você nunca
toca em SQL, terminal ou formulário de deploy: só cria contas e cola
credenciais quando ele pedir, e revoga os tokens temporários quando ele
mandar.

Depois de instalado, você acompanha tudo pelo **painel de saúde** em
`https://<seu-webhook>/api/dashboard` (senha: a `DASHBOARD_KEY` que você
criou na fase 2). Ele responde "o sistema continua rodando?" em um
segundo: triagem do agente viva, fila de mensagens, tasks abertas por
SLA e os crons — inclusive a falha que nenhum log acusa, que é o seu
agente parar de rodar a rotina em silêncio.

## O que você vai precisar ter (ou criar durante a instalação)

- Conta **Supabase** (free) — o banco.
- Conta **Vercel** (free) — os webhooks de captura.
- Conta **uazapi** (paga) — a ponte com o WhatsApp.
- Conta **Fireflies** (opcional) — se quiser que action items de reuniões
  também virem tasks.
- Conta **Google** (opcional) — se quiser Gmail como fonte de task e a
  Agenda checada nas varreduras (via Apps Script, sem Google Cloud).
- Conta **Groq** (opcional, grátis) — se quiser os áudios do WhatsApp
  transcritos automaticamente (Whisper) antes da triagem.
- O grupo do Telegram que você já usa com seu Hermes (com os tópicos
  Tarefas Pessoais e Tarefas Empresa; ele cria se faltar).

## Estrutura do repo

```
INSTALL-HERMES.md         runbook de instalação (escrito PRO seu Hermes)
migrations/               5 SQLs do banco (o Hermes aplica na fase 1)
agente/instalar-banco.mjs cria as tabelas via Management API (fase 1)
agente/instalar-webhook.mjs deploya na Vercel via token (fases 2/3B/3C)
webhook/                  captura uazapi + rota Google -> Supabase (fase 2)
fireflies-webhook/        captura Fireflies + cron de action items (fase 3B)
google-sync/Code.gs       Apps Script: Gmail + Agenda a cada 15 min (fase 3C)
agente/secretario.mjs     ferramenta que o Hermes usa pra operar (fase 4)
agente/AGENTE-TRIAGEM.md  rotina permanente de triagem do Hermes (fase 4)
test/test-secretario.mjs  asserts offline (node test/test-secretario.mjs)
```

## Segurança (decisões herdadas do sistema original, aprendidas a caro)

- O banco nasce com RLS ligado e sem nenhuma policy: as chaves públicas
  não leem nada; só a `service_role` (webhook + Hermes) acessa.
- O Hermes nunca vê o payload bruto das mensagens (mídia, metadados):
  a ferramenta só entrega texto + remetente + data.
- O corpo completo dos emails nunca sai da conta Google: o Apps Script
  envia só remetente, assunto e os primeiros 800 caracteres em texto puro.
- Agenda é checagem, não fonte: o Hermes cita compromissos e cruza com
  tasks, mas nunca cria task a partir de evento.
- Classificações do Hermes passam por allowlist no código: valor fora da
  lista é rejeitado, nunca aceito por omissão.
- O webhook responde 200 antes de processar e valida secret com
  comparação timing-safe; sem secret configurado em produção, rejeita
  tudo (fail-closed).

## O que ficou de fora (extensões possíveis)

Contrato determinístico de resolução ("o dono já respondeu" aqui é
julgamento do Hermes via `from_me`) e dashboard de infraestrutura. O
sistema original de referência implementa ambos; este repo é o core de
ponta a ponta com as três fontes (WhatsApp + reuniões + email), agenda e
transcrição de áudio.
