# 03 — Telegram (grupo "Hermes Secretário" com tópicos)

## Criar o bot

1. Fale com o **@BotFather** no Telegram: `/newbot`, dê um nome (ex.:
   "Hermes Secretário") e um username (ex.: `hermes_secretario_xyz_bot`).
2. Guarde o **token** (`123456:ABC-...`) — é o `TELEGRAM_BOT_TOKEN`.

## Criar o grupo com tópicos

1. Crie um grupo chamado **"Hermes Secretário"** com você (dono do sistema).
2. Nas configurações do grupo, ative **Tópicos** (Topics). O grupo vira
   supergrupo.
3. Adicione o bot ao grupo e promova a **administrador** com a permissão
   **Manage Topics** (Gerenciar tópicos).

## Descobrir o chat_id

1. Mande qualquer mensagem no grupo (ex.: "setup").
2. Rode:

   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | python3 -m json.tool
   ```

3. Procure `chat: { id: -100..., title: "Hermes Secretário" }`. Esse número
   negativo é o `TELEGRAM_CHAT_ID`.
4. Se vier vazio: remova e re-adicione o bot, mande nova mensagem e repita
   (getUpdates só devolve updates recentes e não entrega os já consumidos).

## Criar os 3 tópicos

Use o script do repo (cria "📡 Radar", "🏠 Tarefas Pessoais" e
"🏢 Tarefas Empresa" e imprime as envs prontas):

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=-100... node agente/setup-topics.mjs
```

Saída esperada:

```
TELEGRAM_TOPIC_RADAR=2
TELEGRAM_TOPIC_PESSOAL=3
TELEGRAM_TOPIC_EMPRESA=4
```

Copie as 3 linhas pro ambiente do agente. Se preferir criar os tópicos à
mão no app, descubra o id de cada um mandando uma mensagem dentro do
tópico e lendo `message_thread_id` no `getUpdates`.

## Papel de cada tópico

| Tópico | O que entra |
|---|---|
| 📡 Radar | Relatórios da varredura horária, digests de SLA vencido, erros do agente |
| 🏠 Tarefas Pessoais | Cards de task `categoria: pessoal` |
| 🏢 Tarefas Empresa | Cards de task `categoria: empresa` |

## Teste

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... TELEGRAM_TOPIC_RADAR=... \
  node agente/secretario.mjs post-radar "teste de setup: radar no ar"
```

A mensagem deve aparecer DENTRO do tópico Radar (não no General). Se cair
no General, o `message_thread_id` está errado.
