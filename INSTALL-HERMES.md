# Instalação guiada — instruções para VOCÊ, Hermes

Seu humano te mandou este repositório e disse algo como "vamos instalar
esse sistema". Este documento é o seu roteiro: **você conduz, ele executa
o que só ele pode executar (criar contas, colar credenciais), e você
valida cada fase antes de avançar.**

## O que você está instalando (explique isso a ele primeiro, em 3 linhas)

Um radar de compromissos: toda mensagem relevante do WhatsApp dele cai num
banco; você varre de hora em hora, decide o que é task de verdade e
publica cards nos tópicos do grupo do Telegram de vocês ("Tarefas
Pessoais" e "Tarefas Empresa"), cobrando o que vencer. Ele para de
depender da própria memória pra não perder pedido, prazo e cobrança.

## Regras de condução (valem a instalação inteira)

1. **Uma fase por vez.** Nunca avance sem a validação da fase passar.
2. **Explique onde conseguir ANTES de pedir.** Nunca peça uma credencial
   sem antes dizer exatamente em que tela ela está.
3. **Credencial que ele colar**: guarde no seu armazenamento seguro de
   variáveis; NUNCA repita o valor de volta no chat, em log ou em card.
   Confirme só com o tamanho ("recebi, 219 caracteres").
4. Comandos: se você tem shell com Node 18+ e acesso à internet, rode
   você mesmo. Se não tem, entregue o comando pronto pra ele colar no
   terminal dele e peça o output.
5. Erro numa validação: diagnostique pela tabela de erros da fase; não
   improvise mudança no código nem no banco.

## Arquivos deste repo que você vai usar

| Arquivo | Pra quê |
|---|---|
| `agente/instalar-banco.mjs` | VOCÊ roda na fase 1: cria as tabelas sozinho |
| `migrations/001..004*.sql` | o SQL que o instalar-banco executa (não peça pro humano colar) |
| `webhook/` | projeto que o humano importa na Vercel (fase 2) |
| `fireflies-webhook/` | segundo projeto Vercel, só na fase 3B (opcional) |
| `agente/secretario.mjs` | sua ferramenta de operação (fase 4: instale em você) |
| `agente/AGENTE-TRIAGEM.md` | sua rotina permanente de triagem (fase 4) |

Baixe o que precisar pelo raw do GitHub
(`https://raw.githubusercontent.com/jcarlosamorim/hermes-secretario/main/<caminho>`).

---

## FASE 0 — Reconhecimento

Confirme com o humano, antes de começar:

- [ ] Ele tem (ou topa criar agora) contas: **Supabase** (free),
      **Vercel** (free) e **uazapi** (paga, é a ponte com o WhatsApp).
- [ ] O número de WhatsApp que será monitorado está no celular dele.
- [ ] O grupo do Telegram entre vocês existe e tem os tópicos
      **Tarefas Pessoais** e **Tarefas Empresa** (crie-os se faltar; é
      onde você vai publicar os cards).
- [ ] Pergunte: ele usa **Fireflies** pra gravar/transcrever reuniões?
      Se sim, a fase 3B (opcional) liga as reuniões como segunda fonte.
      Se não, pule a 3B sem culpa: dá pra ligar depois.
- [ ] Você consegue rodar `node --version` (18+) no seu ambiente. Se não
      conseguir, avise que vai operar em modo "comandos prontos pra ele".

---

## FASE 1 — Supabase (banco)

### 1.1 Criar o projeto (ele executa, você dita)

Diga a ele:

> Acesse https://supabase.com, crie uma conta e clique em **New project**.
> Nome: `hermes-secretario`. Senha do banco: gere uma forte e guarde no
> seu gerenciador (não vamos usá-la no dia a dia). Região: a mais próxima
> de você. Aguarde ~2 min provisionar.

### 1.2 Buscar as credenciais (ele cola, você guarda)

O humano NÃO vai colar SQL em lugar nenhum: você mesmo cria as tabelas no
passo 1.3. Pra isso, peça as 3 credenciais, explicando cada tela:

> Preciso de 3 credenciais. No painel do Supabase:
> 1. Em **Project Settings > Data API**, copie o **Project URL** (formato
>    `https://xxxxxxxx.supabase.co`) e me mande.
> 2. Em **Project Settings > API Keys**, ache a chave **service_role**,
>    clique em **Reveal**, copie e me mande. Atenção: é a service_role,
>    NÃO a anon.
> 3. Clique no seu avatar (canto da tela) > **Account Settings** >
>    **Access Tokens** > **Generate new token**. Nome:
>    `instalacao-hermes`. Copie o token (começa com `sbp_`) e me mande.
>    Esse token é TEMPORÁRIO: eu uso pra criar as tabelas e no fim desta
>    fase você o revoga.

Guarde como `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e
`SUPABASE_ACCESS_TOKEN`.

### 1.3 Criar as tabelas (VOCÊ executa)

Baixe `agente/instalar-banco.mjs` deste repo (raw do GitHub) e rode:

```bash
SUPABASE_URL=... SUPABASE_ACCESS_TOKEN=... node instalar-banco.mjs
```

O script aplica as 3 migrations via Supabase Management API e verifica que
as tabelas `whatsapp_messages`, `tasks` e `triagem_runs` existem com RLS
ligado. Re-rodar é seguro (idempotente). Sucesso = JSON final com
`"ok": true`.

| Erro | Causa provável |
|---|---|
| `401` na Management API | token errado/incompleto ou já revogado (volte ao 1.2 item 3) |
| `SUPABASE_URL invalida` | URL não é `https://<ref>.supabase.co` (copiou de outra tela?) |
| `tabelas_sem_rls` não vazio | não deveria acontecer com estas migrations; NÃO avance, revise |

Plano B (só se você não tiver como rodar Node): mande o conteúdo de cada
migration, um arquivo por vez e sem editar nada, pro humano colar em
**SQL Editor > New query > Run**.

### 1.4 Revogar o token de instalação

Assim que o 1.3 passar, diga a ele:

> Tabelas criadas. Agora volte em **Account Settings > Access Tokens** e
> **revogue** o token `instalacao-hermes`. Ele dava acesso à sua conta
> inteira do Supabase e não é mais necessário.

Descarte sua cópia do `SUPABASE_ACCESS_TOKEN`: nenhuma outra fase o usa.

### 1.5 Validação da fase (você executa)

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "$SUPABASE_URL/rest/v1/tasks?select=id&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

| Resultado | Significado |
|---|---|
| `200` | fase concluída, avance |
| `404` | migrations não rodaram (volte ao 1.3) |
| `401` | chave errada (é a anon? copiou incompleta? volte ao 1.2) |
| outro | mande o corpo do erro pro humano conferir o projeto |

Repita o mesmo curl pra `whatsapp_messages` e `triagem_runs` (3× 200 = ok).

---

## FASE 2 — Webhook na Vercel (captura)

### 2.1 Gerar o secret (você executa)

Gere um segredo hex de 32 caracteres (`openssl rand -hex 16`, ou gere por
outro meio confiável se não tiver shell). Guarde como
`UAZAPI_WEBHOOK_SECRET`. Não mostre o valor no chat: você vai usá-lo na
fase 3 pra montar a URL.

Pergunte também o **número de WhatsApp monitorado** com DDI, só dígitos
(ex.: `5511999998888`). Guarde como `OWNER_JID` (esse pode circular em
chat, não é segredo).

### 2.2 Deploy (ele executa no browser, você dita)

> Acesse https://vercel.com, crie a conta (pode entrar com GitHub).
> Clique em **Add New > Project** e importe este repositório
> (`https://github.com/jcarlosamorim/hermes-secretario`). Antes de clicar em Deploy:
> 1. **Root Directory**: clique em Edit e selecione a pasta **`webhook`**.
> 2. Em **Environment Variables**, adicione as 4 que eu vou te passar.

Passe a ele as 4 variáveis (aqui pode, ele é o dono delas; mande cada
valor isolado numa mensagem própria pra facilitar o copiar-colar):
`UAZAPI_WEBHOOK_SECRET`, `OWNER_JID`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`.

> Clique em **Deploy** e, quando terminar, me mande a URL de produção
> (formato `https://alguma-coisa.vercel.app`).

### 2.3 Validação da fase (você executa)

```bash
curl -s https://<projeto>.vercel.app/api/webhook/uazapi
```

Esperado: `hermes-secretario-webhook ok`. Um POST sem secret deve dar 401
(isso é o certo: fail-closed).

| Erro | Causa provável |
|---|---|
| 404 | Root Directory não foi setado pra `webhook` (redeploy) |
| 500 | env faltando (conferir as 4 no painel do projeto > Settings > Environment Variables e redeploy) |

---

## FASE 3 — uazapi (WhatsApp)

### 3.1 Instância e conexão (ele executa, você dita)

> Acesse seu painel uazapi (`https://SEUSUBDOMINIO.uazapi.com`). Crie uma
> instância pro seu número e me mande o **token da instância** (não o
> admintoken da conta). Depois, na instância, gere o QR code e escaneie
> com o WhatsApp do celular (Configurações > Aparelhos conectados >
> Conectar aparelho). Me avise quando o status ficar "connected".

Guarde o token como `UAZAPI_INSTANCE_TOKEN` (você só usa nesta fase).

### 3.2 Registrar o webhook (você executa; ou entregue o comando pronto)

A uazapi não edita webhook, só adiciona/remove. Registre:

```bash
curl -X POST "https://SEUSUBDOMINIO.uazapi.com/webhook" \
  -H "token: $UAZAPI_INSTANCE_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "action": "add",
    "url": "https://<projeto>.vercel.app/api/webhook/uazapi?secret='"$UAZAPI_WEBHOOK_SECRET"'",
    "enabled": true,
    "events": ["messages"],
    "excludeMessages": []
  }'
```

A resposta traz um `id` de webhook: anote (é o que permite deletar/refazer
depois). Se você entregar o comando pro humano rodar, lembre-o de apagar o
comando do histórico depois (a URL contém o secret).

### 3.3 Validação da fase: primeira mensagem real

Peça ao humano:

> Peça pra alguém (outro número) te mandar um "oi, teste do radar" em DM.

Aguarde ~10 s e confira você (não precisa do CLI ainda):

```bash
curl -s "$SUPABASE_URL/rest/v1/whatsapp_messages?select=chat_id,text_content,processed&order=received_at.desc&limit=3" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

A mensagem de teste deve aparecer com `processed: false`.

| Sintoma | Causa provável |
|---|---|
| Nada chega | instância desconectada, ou webhook registrado com URL/secret errado (delete e registre de novo) |
| Chega mensagem de grupo demais | esperado que NÃO chegue: grupo só entra com menção/reply ao dono |
| Log `secret_mismatch` na Vercel | secret da URL ≠ env `UAZAPI_WEBHOOK_SECRET` |

---

## FASE 3B — Fireflies (OPCIONAL: reuniões como segunda fonte)

Só execute se o humano usa Fireflies (checklist da fase 0). O fluxo:
o Fireflies avisa quando uma reunião é transcrita → webhook grava no mesmo
banco → um cron horário busca os action items via API (sem LLM) → você
tria na sua varredura normal (`fetch-meetings`), como faz com o WhatsApp.

### 3B.1 Credenciais (ele cola, você guarda)

> No app do Fireflies (app.fireflies.ai): **Settings > Developer
> settings**, copie a **API key** e me mande.

Guarde como `FIREFLIES_API_KEY`. Gere você mesmo mais dois segredos:
- `FIREFLIES_WEBHOOK_SECRET`: **precisa ter entre 16 e 32 caracteres**
  (limite do próprio Fireflies): `openssl rand -hex 12` gera 24, serve.
- `CRON_SECRET`: `openssl rand -hex 16` (protege o cron de disparo alheio).

### 3B.2 Segundo projeto na Vercel (ele executa no browser, você dita)

> Na Vercel: **Add New > Project**, importe o MESMO repositório de antes.
> **Root Directory**: desta vez selecione a pasta **`fireflies-webhook`**.
> Em Environment Variables, adicione as 5 que eu vou te passar, e Deploy.

Passe: `FIREFLIES_WEBHOOK_SECRET`, `FIREFLIES_API_KEY`, `CRON_SECRET`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Peça a URL de produção.

Valide: `curl -s https://<projeto-ff>.vercel.app/api/webhook` deve
responder `hermes-secretario-fireflies ok`.

### 3B.3 Registrar o webhook no Fireflies (ele executa; não existe API)

> No Fireflies: **Settings > Developer settings**, seção **Webhooks**.
> Cole a URL `https://<projeto-ff>.vercel.app/api/webhook` e, no campo de
> secret, cole o segredo que eu vou te passar (o
> FIREFLIES_WEBHOOK_SECRET). Salve.

### 3B.4 Validação da fase

Peça pra ele fazer uma call curta de teste com o bot do Fireflies (ou
espere a próxima reunião real). Quando a transcrição concluir:

1. Confira a captura (você executa):

```bash
curl -s "$SUPABASE_URL/rest/v1/fireflies_meetings?select=title,fetch_status,processed&order=received_at.desc&limit=3" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

2. A linha nasce com `fetch_status: "pendente"`. O cron horário busca os
   action items; pra não esperar, dispare-o você:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://<projeto-ff>.vercel.app/api/cron/fetch-actions
```

3. Re-rode o curl do passo 1: `fetch_status` deve virar `"ok"` (ou seguir
   `"pendente"` por alguns minutos se o summary ainda estiver sendo
   gerado; o cron re-tenta a cada hora).

| Sintoma | Causa provável |
|---|---|
| Nada chega no banco | webhook não registrado, ou secret com tamanho fora de 16-32 chars (o Fireflies rejeita silenciosamente) |
| `401` no cron manual | `CRON_SECRET` divergente entre env e comando |
| `fetch_status: "erro"` | API key errada, ou rate limit (plano Free = 50 chamadas/dia; o cron gasta no máximo 2/hora) |

Nota pra quem instalou o banco ANTES desta fase existir no repo: a
migration 004 é aplicada pelo `instalar-banco.mjs`. Se o seu banco foi
criado sem ela, peça um novo Personal Access Token temporário, re-rode o
instalar-banco (idempotente) e mande revogar o token de novo.

---

## FASE 4 — Instalar a rotina de triagem em você mesmo

Agora o pipeline captura sozinho; falta você virar o triador.

1. Salve `agente/secretario.mjs` no seu ambiente de execução (ex.:
   `/data/bin/secretario.mjs`).
2. Configure no ambiente do processo APENAS: `SUPABASE_URL` e
   `SUPABASE_SERVICE_ROLE_KEY`.
3. Verifique: `node secretario.mjs` sem argumentos deve listar 9 comandos
   (`fetch-pending`, `fetch-meetings`, `create-task`, `ack-card`,
   `mark-processed`, `mark-meeting-processed`, `list-open`, `close-task`,
   `log-run`).
4. Leia `agente/AGENTE-TRIAGEM.md` INTEIRO e adote como sua rotina
   permanente (instrução/memória de longo prazo). Ele define seu ciclo
   horário, seus critérios de julgamento e onde publicar cada card.
5. Crie **UM único cron: a cada hora** (sugestão 7h às 23h no fuso do
   humano) executando a rotina do AGENTE-TRIAGEM.md. Nada de cron por
   task nem crons duplicados.
6. **Primeira varredura assistida**: rode `fetch-pending` com o humano
   olhando (a mensagem de teste da fase 3 deve aparecer), julgue, crie a
   primeira task e publique o card no tópico certo. Mostre a ele o
   resultado e o registro em `triagem_runs`.

## Encerramento

Diga ao humano o que ficou de pé, onde vive cada peça (Supabase, Vercel,
uazapi, seu cron) e combine o protocolo de ajuste: quando um card não
fizer sentido (ou faltar um), ele te diz o caso concreto e você ajusta o
SEU critério de julgamento (seção correspondente do AGENTE-TRIAGEM.md),
nunca o código.
