# 02 — uazapi (WhatsApp) + webhook na Vercel

A uazapi é uma API não-oficial de WhatsApp. Você precisa de uma instância
própria conectada ao número do dono.

## Deploy do webhook (antes de mexer na uazapi)

1. Instale a CLI da Vercel (`npm i -g vercel`) e faça login.
2. Gere o secret do webhook: `openssl rand -hex 16` (guarde).
3. No diretório `webhook/` deste repo:

   ```bash
   cd webhook
   vercel link            # cria/vincula o projeto (ex.: hermes-secretario-webhook)
   vercel env add UAZAPI_WEBHOOK_SECRET production   # cole o secret gerado
   vercel env add OWNER_JID production               # número do dono, só dígitos com DDI
   vercel env add SUPABASE_URL production
   vercel env add SUPABASE_SERVICE_ROLE_KEY production
   vercel --prod
   ```

4. Teste: `curl https://SEU-PROJETO.vercel.app/api/webhook/uazapi` deve
   responder `hermes-secretario-webhook ok` (GET é health check; POST sem
   secret responde 401: é o esperado).

## Criar a instância uazapi e conectar o número

1. Contrate/acesse seu painel uazapi (ex.: `https://SEUSUBDOMINIO.uazapi.com`).
2. Crie uma instância pro número do dono e copie o **token da instância**
   (não confunda com o admintoken da conta).
3. Conecte o número: no painel, gere o QR code da instância e escaneie com
   o WhatsApp do dono (Aparelhos conectados > Conectar aparelho). Confirme
   que o status da instância fica `connected`.

## Registrar o webhook

A uazapi não tem endpoint de EDIÇÃO de webhook, só add/delete. Registre:

```bash
curl -X POST "https://SEUSUBDOMINIO.uazapi.com/webhook" \
  -H "token: SEU_TOKEN_DA_INSTANCIA" \
  -H "content-type: application/json" \
  -d '{
    "action": "add",
    "url": "https://SEU-PROJETO.vercel.app/api/webhook/uazapi?secret=SEU_SECRET",
    "enabled": true,
    "events": ["messages"],
    "excludeMessages": []
  }'
```

Atenção: o secret vai na URL registrada. Não cole essa URL completa em
chat/log público; se vazar, gere secret novo, atualize a env na Vercel,
delete o webhook antigo (`"action": "delete"` com o id retornado) e
registre de novo.

## Validar a captura de ponta a ponta

1. Peça pra alguém mandar uma DM pro número do dono.
2. No Supabase: Table Editor > `whatsapp_messages` deve ganhar 1 linha com
   `processed = false` em segundos.
3. Se não chegou: `vercel logs` no projeto do webhook. As causas mais
   comuns: secret divergente (log `secret_mismatch`), instância
   desconectada, evento errado no registro.

## O que o filtro de captura decide (código, não configuração)

- DM de contato: sempre grava.
- DM enviada pelo próprio dono (manual): grava como EVIDÊNCIA (`from_me`),
  usada pelo agente pra perceber "o dono já respondeu". Não vira task.
- Grupo: só grava se o dono foi mencionado (@) ou se é reply a mensagem
  dele; o resto do volume de grupo é descartado.
- Mensagem enviada por API/bot pelo número do dono: descartada sempre.
- Chats em `webhook/config/excluded-chats.json`: descartados sempre
  (edite e redeploy pra silenciar bots ruidosos).
