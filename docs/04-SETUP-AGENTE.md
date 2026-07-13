# 04 — Agente de triagem

O agente substitui a chamada de LLM do sistema original: em vez de um cron
com prompt fixo, um agente conversacional com julgamento roda a varredura.

## Requisitos da plataforma do agente

Qualquer agente que consiga:

1. Executar comandos de shell (Node 18+ disponível).
2. Rodar num agendamento recorrente (cron de hora em hora).
3. Ler e seguir `agente/AGENTE-TRIAGEM.md` como instrução permanente.

Exemplos: OpenClaw, Claude Code (agendado via `/schedule` ou cron do
sistema), ou qualquer runtime de agente com acesso a shell.

## Instalação

1. Copie pro ambiente do agente:
   - `agente/secretario.mjs` (a ferramenta)
   - `agente/AGENTE-TRIAGEM.md` (a instrução/prompt)
2. Configure no ambiente do PROCESSO do agente (secret store da
   plataforma; nunca hardcoded na instrução):

   ```
   SUPABASE_URL=
   SUPABASE_SERVICE_ROLE_KEY=
   TELEGRAM_BOT_TOKEN=
   TELEGRAM_CHAT_ID=
   TELEGRAM_TOPIC_RADAR=
   TELEGRAM_TOPIC_PESSOAL=
   TELEGRAM_TOPIC_EMPRESA=
   ```

3. Verificação: `node agente/secretario.mjs` deve imprimir o uso com os 8
   comandos.

## Agendamento

UM cron único, de hora em hora (sugestão: 7h às 23h no fuso do dono), que
entrega ao agente a instrução:

> Execute a varredura do Hermes Secretário conforme AGENTE-TRIAGEM.md.
> Agora são {hora local}. Se for passada de 9h, 15h ou 21h, rode também a
> cobrança de SLA (seção B).

## Primeira execução (assistida)

Rode a primeira varredura com você olhando:

1. `node agente/secretario.mjs fetch-pending` e confira que as conversas
   fazem sentido (agrupadas por chat, sem payload bruto).
2. Deixe o agente julgar e criar as primeiras tasks; confira no grupo do
   Telegram se cada card caiu no tópico certo.
3. Confira no Supabase a linha em `triagem_runs` no fim da varredura.

## Ajuste fino esperado nas primeiras semanas

O julgamento do agente substitui um prompt que no sistema original passou
por eval empírico. Espere calibrar: quando o dono reclamar de card que não
é task (ou task perdida), NÃO mude o código; ajuste a seção "Critério de
julgamento" do AGENTE-TRIAGEM.md com o caso concreto (vira jurisprudência).
Mantenha o arquivo versionado neste repo: ele é o equivalente do
SYSTEM_PROMPT e merece o mesmo cuidado com regressão (guarde exemplos de
conversas reais julgadas certas e re-teste o julgamento após cada mudança
grande na instrução).
