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
| `migrations/001..003*.sql` | conteúdo que o humano cola no SQL Editor (fase 1) |
| `webhook/` | projeto que o humano importa na Vercel (fase 2) |
| `agente/secretario.mjs` | sua ferramenta de operação (fase 4: instale em você) |
| `agente/AGENTE-TRIAGEM.md` | sua rotina permanente de triagem (fase 4) |

Baixe o que precisar pelo raw do GitHub
(`https://raw.githubusercontent.com/<owner>/<repo>/main/<caminho>`).

---

## FASE 0 — Reconhecimento

Confirme com o humano, antes de começar:

- [ ] Ele tem (ou topa criar agora) contas: **Supabase** (free),
      **Vercel** (free) e **uazapi** (paga, é a ponte com o WhatsApp).
- [ ] O número de WhatsApp que será monitorado está no celular dele.
- [ ] O grupo do Telegram entre vocês existe e tem os tópicos
      **Tarefas Pessoais** e **Tarefas Empresa** (crie-os se faltar; é
      onde você vai publicar os cards).
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

### 1.2 Criar as tabelas

Mande pra ele, UM POR VEZ, o conteúdo de `migrations/001_whatsapp_messages.sql`,
depois `002_tasks.sql`, depois `003_triagem_runs.sql`, com a instrução:

> No menu lateral: **SQL Editor > New query**. Cole isto e clique em Run.
> Deve terminar com "Success. No rows returned".

Não resuma nem edite o SQL: cole o arquivo inteiro, comentários incluídos
(os comentários explicam decisões de segurança pra quem ler depois).

### 1.3 Buscar as credenciais

Diga a ele:

> No menu **Project Settings**:
> 1. Em **Data API**, copie o **Project URL** (formato
>    `https://xxxxxxxx.supabase.co`) e me mande.
> 2. Em **API Keys**, ache a chave **service_role**, clique em
>    **Reveal**, copie e me mande. Atenção: é a service_role, NÃO a anon.

Guarde como `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

### 1.4 Validação da fase (você executa)

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "$SUPABASE_URL/rest/v1/tasks?select=id&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

| Resultado | Significado |
|---|---|
| `200` | fase concluída, avance |
| `404` | migrations não rodaram (volte ao 1.2) |
| `401` | chave errada (é a anon? copiou incompleta? volte ao 1.3) |
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
> (`<URL-DO-REPO>`). Antes de clicar em Deploy:
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

## FASE 4 — Instalar a rotina de triagem em você mesmo

Agora o pipeline captura sozinho; falta você virar o triador.

1. Salve `agente/secretario.mjs` no seu ambiente de execução (ex.:
   `/data/bin/secretario.mjs`).
2. Configure no ambiente do processo APENAS: `SUPABASE_URL` e
   `SUPABASE_SERVICE_ROLE_KEY`.
3. Verifique: `node secretario.mjs` sem argumentos deve listar 7 comandos
   (`fetch-pending`, `create-task`, `ack-card`, `mark-processed`,
   `list-open`, `close-task`, `log-run`).
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
