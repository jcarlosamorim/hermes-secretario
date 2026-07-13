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
| `agente/instalar-webhook.mjs` | VOCÊ roda nas fases 2 e 3B: deploya na Vercel sozinho |
| `migrations/001..004*.sql` | o SQL que o instalar-banco executa (não peça pro humano colar) |
| `webhook/` | código da captura WhatsApp + rota Google (o instalar-webhook sobe na fase 2) |
| `fireflies-webhook/` | código da captura de reuniões, só na fase 3B (opcional) |
| `google-sync/Code.gs` | Apps Script de Gmail+Agenda, só na fase 3C (opcional) |
| `webhook/lib/transcribe.js` + `api/cron/transcribe.js` | transcrição de áudio, só na fase 3D (opcional; já viajam no deploy da fase 2) |
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
- [ ] Pergunte: ele quer ligar o **Gmail** (emails que exigem ação viram
      task) e o **Google Agenda** (você checa os compromissos dele nas
      varreduras)? Se sim, fase 3C (opcional). Também dá pra ligar depois.
- [ ] Pergunte: ele recebe muito **áudio no WhatsApp**? A fase 3D
      (opcional) transcreve automaticamente via Groq Whisper (conta grátis)
      — sem ela, áudio sem legenda fica invisível pra triagem.
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

### 2.2 Token da Vercel (ele cola, você guarda)

O humano NÃO importa repositório nem preenche formulário: você mesmo faz
o deploy no passo 2.3. Peça só o token:

> Acesse https://vercel.com e crie uma conta (a free serve). Depois:
> clique no seu avatar > **Account Settings** > **Tokens** >
> **Create Token**. Nome: `instalacao-hermes`. Scope: **Full Account**.
> Expiration: **1 day**. Copie o token e me mande. Ele é TEMPORÁRIO:
> expira sozinho em 1 dia e, quando os deploys terminarem, você o revoga.

Guarde como `VERCEL_TOKEN`.

### 2.3 Deploy (VOCÊ executa)

Baixe `agente/instalar-webhook.mjs` deste repo (raw do GitHub) e rode:

```bash
VERCEL_TOKEN=... UAZAPI_WEBHOOK_SECRET=... OWNER_JID=... \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node instalar-webhook.mjs webhook
```

O script cria o projeto `hermes-secretario-webhook`, configura as 4 env
vars de produção, sobe os arquivos direto pela API (sem git, sem
integração GitHub), espera o build ficar READY e já faz o health check.
Re-rodar é seguro (atualiza envs e redeploya). Guarde a `url_producao`
do output: ela entra no registro da uazapi na fase 3.

| Erro | Causa provável |
|---|---|
| `403`/`Not authorized` | token errado, expirado ou sem scope Full Account (volte ao 2.2) |
| `build terminou em ERROR` | veja os logs no painel da Vercel; caso típico: arquivo faltando no download (rode de novo) |
| `health_check` sem `hermes-secretario-webhook ok` | env faltando; confira o output do passo de env vars e re-rode |

Plano B (só se você não tiver como rodar Node): mande o humano clicar no
Deploy Button, que clona o repo pra conta GitHub dele e pede as envs no
browser:
`https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjcarlosamorim%2Fhermes-secretario&root-directory=webhook&project-name=hermes-secretario-webhook&env=UAZAPI_WEBHOOK_SECRET,OWNER_JID,SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY`
(nesse caso, passe a ele os 4 valores, um por mensagem, e peça a URL de
produção no final).

### 2.4 Validação da fase (você executa)

```bash
curl -s https://<url_producao>/api/webhook/uazapi
```

Esperado: `hermes-secretario-webhook ok`. Um POST sem secret deve dar 401
(isso é o certo: fail-closed).

**Token:** se NENHUMA fase opcional com deploy (3B Fireflies, 3C Google,
3D áudio) vai acontecer, diga ao humano pra revogar o `VERCEL_TOKEN`
agora (Account Settings > Tokens > Revoke) e descarte sua cópia. Senão,
guarde-o até o último deploy dessas fases.

---

## FASE 3 — uazapi (WhatsApp)

### 3.1 Instância e conexão (ele executa, você dita)

> Acesse seu painel uazapi (`https://SEUSUBDOMINIO.uazapi.com`). Crie uma
> instância pro seu número e me mande o **token da instância** (não o
> admintoken da conta). Depois, na instância, gere o QR code e escaneie
> com o WhatsApp do celular (Configurações > Aparelhos conectados >
> Conectar aparelho). Me avise quando o status ficar "connected".

Guarde o token como `UAZAPI_INSTANCE_TOKEN` (usado nesta fase e, se o
humano quiser transcrição de áudio, de novo na fase 3D).

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

### 3B.2 Segundo projeto na Vercel (VOCÊ executa)

Use o mesmo `instalar-webhook.mjs` da fase 2 (e o mesmo `VERCEL_TOKEN`;
se ele já foi revogado/expirou, peça outro como no 2.2):

```bash
VERCEL_TOKEN=... FIREFLIES_WEBHOOK_SECRET=... FIREFLIES_API_KEY=... \
CRON_SECRET=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node instalar-webhook.mjs fireflies-webhook
```

O health check do output deve responder `hermes-secretario-fireflies ok`.
Guarde a `url_producao`. **Token:** se a fase 3C (Gmail/Agenda) NÃO vai
acontecer, o token da Vercel não é mais necessário: diga ao humano pra
revogá-lo (Account Settings > Tokens > Revoke) e descarte sua cópia. Se a
3C vem a seguir, guarde-o até o fim do 3C.1.

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

## FASE 3C — Gmail + Google Agenda (OPCIONAL)

Só execute se o humano quis (checklist da fase 0). Sem Google Cloud
Console, sem OAuth manual: um **Google Apps Script** na conta dele
sincroniza Gmail e Agenda a cada 15 min pro webhook da fase 2 (rota
`/api/webhook/google`). Emails viram candidatos a task (você tria com a
barra "ação humana necessária" da sua rotina); a agenda entra só como
CHECAGEM (`fetch-agenda`), nunca como fonte de task.

### 3C.1 Secret + redeploy do webhook (VOCÊ executa)

Gere `GOOGLE_SYNC_SECRET` (`openssl rand -hex 16`). Re-rode o
instalar-webhook da fase 2 com ela no ambiente (mesmo `VERCEL_TOKEN`; se
já expirou/foi revogado, peça outro como no 2.2). As 4 envs da fase 2
continuam obrigatórias no comando (o script upserta todas e redeploya):

```bash
VERCEL_TOKEN=... GOOGLE_SYNC_SECRET=... UAZAPI_WEBHOOK_SECRET=... \
OWNER_JID=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node instalar-webhook.mjs webhook
```

Valide: `curl -s https://<url_producao>/api/webhook/google` deve responder
`hermes-secretario-google ok`. Se nenhuma outra fase Vercel resta, mande
revogar o `VERCEL_TOKEN` agora.

Se o banco foi criado antes da migration 005 existir: peça um novo
Personal Access Token temporário do Supabase, re-rode o
`instalar-banco.mjs` (idempotente) e mande revogar de novo.

### 3C.2 Instalar o Apps Script (ele executa, você prepara)

1. Pegue `google-sync/Code.gs` deste repo e substitua a linha
   `WEBHOOK_URL` pela URL real:
   `https://<url_producao>/api/webhook/google?secret=<GOOGLE_SYNC_SECRET>`.
2. Mande o arquivo PRONTO pro humano, com a instrução:

> Acesse https://script.google.com e clique em **New project**. Apague o
> conteúdo, cole o código que te mandei e salve (nome: "Hermes
> Secretário"). Na barra de cima, selecione a função **setup** e clique
> em **Run**. O Google vai pedir autorização de Gmail e Agenda: revise e
> permita — o código é exatamente o que você colou, e ele envia só
> remetente, assunto e o começo de cada email (800 caracteres), nunca o
> corpo inteiro. Quando o log disser "instalado", me avise.

Este é o único ponto do sistema em que uma URL com secret fica com o
humano (dentro do script, na conta Google dele). Aceitável: o script é
dele e roda na conta dele. Não cole essa URL em mais lugar nenhum.

### 3C.3 Validação da fase (você executa)

O `setup` já roda a primeira sync. Confira as duas tabelas:

```bash
curl -s "$SUPABASE_URL/rest/v1/gmail_messages?select=subject,processed&order=received_at.desc&limit=3" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

curl -s "$SUPABASE_URL/rest/v1/calendar_events?select=title,starts_at&order=starts_at.asc&limit=3" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

| Sintoma | Causa provável |
|---|---|
| tabelas não existem (404) | banco criado antes da migration 005 (ver fim do 3C.1) |
| nada chega | `WEBHOOK_URL`/secret errados no Code.gs (o setup loga o erro HTTP: peça o log ao humano) |
| chegam emails de Promoções/Social | não deveria: a `GMAIL_QUERY` do script os exclui; se vazar, ajuste a query no script |
| agenda vazia | normal se não há eventos nos próximos 7 dias |

---

## FASE 3D — Transcrição de áudio do WhatsApp (OPCIONAL)

Só execute se o humano quis (checklist da fase 0). Sem ela, áudio sem
legenda nunca vira task (bloqueio duro da sua rotina). Com ela, o próprio
webhook transcreve o áudio na chegada (Groq Whisper, `whisper-large-v3`,
português) e ele entra na triagem como texto normal; uma vassoura diária
recolhe o que falhar no caminho quente.

### 3D.1 Credenciais

1. Peça ao humano:

> Acesse https://console.groq.com, crie uma conta (grátis) e em
> **API Keys > Create API Key** gere uma chave. Copie e me mande.

Guarde como `GROQ_API_KEY`. **Nunca aceite chave emprestada de outra
pessoa/projeto**: a chave é da conta dele.

2. Você já tem da fase 3: `UAZAPI_BASE_URL`
   (`https://SEUSUBDOMINIO.uazapi.com`) e `UAZAPI_TOKEN` (o token da
   instância, `UAZAPI_INSTANCE_TOKEN`). Eles passam a viver como env do
   projeto webhook — é o download da mídia.
3. Gere `CRON_SECRET` (`openssl rand -hex 16`): protege o disparo manual
   da vassoura.

### 3D.2 Redeploy do webhook (VOCÊ executa)

Mesmo padrão da 3C.1 (mesmo `VERCEL_TOKEN`; se expirou, peça outro):

```bash
VERCEL_TOKEN=... GROQ_API_KEY=... UAZAPI_BASE_URL=... UAZAPI_TOKEN=... \
CRON_SECRET=... UAZAPI_WEBHOOK_SECRET=... OWNER_JID=... \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node instalar-webhook.mjs webhook
```

(As 4 envs da fase 2, e a `GOOGLE_SYNC_SECRET` se a 3C foi instalada,
continuam no comando: o script upserta todas e redeploya.) Se este é o
último deploy, mande revogar o `VERCEL_TOKEN`.

### 3D.3 Validação da fase

1. Peça pra alguém mandar um **áudio de voz** em DM pro número do dono.
2. Aguarde ~30 s e confira (você executa):

```bash
curl -s "$SUPABASE_URL/rest/v1/whatsapp_messages?select=text_content,received_at&order=received_at.desc&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

`text_content` deve conter a transcrição. Se vier `null`, dispare a
vassoura e leia as stats:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://<url_producao>/api/cron/transcribe
```

| Sintoma | Causa provável |
|---|---|
| `skip: transcricao nao instalada` | `GROQ_API_KEY` não chegou no projeto (re-rode o 3D.2) |
| `falhas` > 0 nas stats | `UAZAPI_TOKEN`/`UAZAPI_BASE_URL` errados (log `transcribe_error` na Vercel) ou chave Groq inválida |
| `401` no disparo manual | `CRON_SECRET` divergente entre env e comando |

---

## FASE 4 — Instalar a rotina de triagem em você mesmo

Agora o pipeline captura sozinho; falta você virar o triador.

1. Salve `agente/secretario.mjs` no seu ambiente de execução (ex.:
   `/data/bin/secretario.mjs`).
2. Configure no ambiente do processo APENAS: `SUPABASE_URL` e
   `SUPABASE_SERVICE_ROLE_KEY`.
3. Verifique: `node secretario.mjs` sem argumentos deve listar 12 comandos
   (`fetch-pending`, `fetch-meetings`, `fetch-emails`, `fetch-agenda`,
   `create-task`, `ack-card`, `mark-processed`, `mark-meeting-processed`,
   `mark-email-processed`, `list-open`, `close-task`, `log-run`).
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
