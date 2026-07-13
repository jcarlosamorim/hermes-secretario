# 01 — Supabase (banco)

## Criar o projeto

1. Crie conta em https://supabase.com (plano Free basta).
2. **New project**: escolha organização, nome `hermes-secretario`, senha de
   banco forte (guarde num gerenciador; não será usada no dia a dia) e a
   região mais próxima (ex.: `South America (São Paulo)`).
3. Aguarde o provisionamento (~2 min).

## Rodar as migrations

No Dashboard do projeto: **SQL Editor > New query**. Cole e execute, NA
ORDEM, o conteúdo de:

1. `migrations/001_whatsapp_messages.sql`
2. `migrations/002_tasks.sql`
3. `migrations/003_triagem_runs.sql`

Confira em **Table Editor** que as 3 tabelas existem e que cada uma mostra
"RLS enabled" SEM nenhuma policy. É assim mesmo: sem policy, as chaves
públicas (anon) não leem nada; o webhook e o agente usam a service_role,
que ignora RLS.

## Credenciais a disponibilizar (e onde consegui-las)

| Credencial | Onde pegar | Quem usa |
|---|---|---|
| `SUPABASE_URL` | Project Settings > **Data API** > Project URL (ex.: `https://abcdefgh.supabase.co`) | webhook (Vercel) + agente |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings > **API Keys** > `service_role` > Reveal | webhook (Vercel) + agente |

## Regras de segurança (não negociáveis)

- **Nunca** use a `anon`/`publishable` key no webhook ou no agente: com RLS
  sem policy ela não lê nada, e é esse o comportamento correto.
- **Nunca** exponha a `service_role` em código de cliente, repositório,
  chat ou log. Ela dá acesso total ao banco.
- Ao passar a chave pro ambiente do agente, cole direto no arquivo de
  env/secret store; não a deixe em histórico de shell (`export` em
  terminal compartilhado) nem em stdout.
- Se vazar: Project Settings > API Keys > Roll/regenerate, e atualize os
  dois consumidores (Vercel + agente).
- Toda tabela futura segue o padrão: `ENABLE ROW LEVEL SECURITY` sem
  policy. Se um dia precisar de policy, SEMPRE com `TO service_role`
  explícito; `FOR ALL USING (true)` sem isso vale pra anon e vaza mensagem
  real via REST.
