# Hermes Secretário

Radar de compromissos pessoal: toda mensagem relevante do seu WhatsApp
cai num banco; **seu Hermes** (seu agente de IA) varre de hora em hora,
decide o que é task de verdade e publica cards nos tópicos do grupo de
vocês no Telegram (**Tarefas Pessoais** e **Tarefas Empresa**), cobrando
o que vencer o prazo. Você para de depender da memória pra não perder
pedido, prazo e cobrança.

```
WhatsApp (uazapi) ──▶ webhook (Vercel) ──▶ whatsapp_messages (Supabase)
                       sem LLM, só filtro           │
                                                    ▼
                                  SEU HERMES (varre de hora em hora)
                                  julga conversas via secretario.mjs,
                                  grava tasks e publica os cards
                                                    │
                                                    ▼
                          Grupo de vocês no Telegram
                          ├── 🏠 Tarefas Pessoais
                          ├── 🏢 Tarefas Empresa
                          └── relatórios + cobranças de SLA
```

## Como instalar

Você não instala nada sozinho. **Mande o link deste repositório pro seu
Hermes** e diga:

> Vamos instalar esse sistema. Leia o arquivo INSTALL-HERMES.md deste
> repositório e me guie passo a passo.

Ele conduz a instalação em 4 fases, validando cada uma: (1) criar o banco
no Supabase e colar as credenciais, (2) subir o webhook na Vercel, (3)
conectar seu WhatsApp na uazapi, (4) instalar a rotina de triagem nele
mesmo. Você só cria as contas e cola credenciais quando ele pedir.

## O que você vai precisar ter (ou criar durante a instalação)

- Conta **Supabase** (free) — o banco.
- Conta **Vercel** (free) — o webhook de captura.
- Conta **uazapi** (paga) — a ponte com o WhatsApp.
- O grupo do Telegram que você já usa com seu Hermes (com os tópicos
  Tarefas Pessoais e Tarefas Empresa; ele cria se faltar).

## Estrutura do repo

```
INSTALL-HERMES.md         runbook de instalação (escrito PRO seu Hermes)
migrations/               3 SQLs do banco (rodados na fase 1)
webhook/                  captura uazapi -> Supabase (deploy na fase 2)
agente/secretario.mjs     ferramenta que o Hermes usa pra operar (fase 4)
agente/AGENTE-TRIAGEM.md  rotina permanente de triagem do Hermes (fase 4)
test/test-secretario.mjs  asserts offline (node test/test-secretario.mjs)
```

## Segurança (decisões herdadas do sistema original, aprendidas a caro)

- O banco nasce com RLS ligado e sem nenhuma policy: as chaves públicas
  não leem nada; só a `service_role` (webhook + Hermes) acessa.
- O Hermes nunca vê o payload bruto das mensagens (mídia, metadados):
  a ferramenta só entrega texto + remetente + data.
- Classificações do Hermes passam por allowlist no código: valor fora da
  lista é rejeitado, nunca aceito por omissão.
- O webhook responde 200 antes de processar e valida secret com
  comparação timing-safe; sem secret configurado em produção, rejeita
  tudo (fail-closed).

## O que ficou de fora (extensões possíveis)

Fireflies/reuniões como segunda fonte, transcrição automática de áudio,
contrato determinístico de resolução ("o dono já respondeu" aqui é
julgamento do Hermes via `from_me`) e dashboard de infraestrutura. O
sistema original de referência implementa tudo isso; este repo é o core
mínimo de ponta a ponta.
