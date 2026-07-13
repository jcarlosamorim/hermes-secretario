#!/usr/bin/env node
// Cria as tabelas do Hermes Secretário no Supabase SEM o humano tocar em SQL.
// Roda as 3 migrations via Supabase Management API e verifica que as tabelas
// existem com RLS ligado. Node 18+, zero dependências. Idempotente: re-rodar
// é seguro (IF NOT EXISTS em tudo).
//
// Env necessárias:
//   SUPABASE_URL            https://<ref>.supabase.co
//   SUPABASE_ACCESS_TOKEN   Personal Access Token (sbp_...), gerado em
//                           Account Settings > Access Tokens. Vale pra conta
//                           INTEIRA: use só nesta instalação e peça ao humano
//                           pra REVOGAR o token assim que este script passar.
//
// Uso: node instalar-banco.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const MIGRATIONS = [
  '001_whatsapp_messages.sql',
  '002_tasks.sql',
  '003_triagem_runs.sql',
  '004_fireflies.sql',
];
const RAW_BASE =
  'https://raw.githubusercontent.com/jcarlosamorim/hermes-secretario/main/migrations/';
const TABELAS = ['whatsapp_messages', 'tasks', 'triagem_runs', 'fireflies_meetings'];

export function extractProjectRef(url) {
  const m = String(url || '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/);
  return m ? m[1] : null;
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(JSON.stringify({ ok: false, erro: `variavel de ambiente ${name} ausente` }));
    process.exit(2);
  }
  return v;
}

// Lê a migration do repo local se existir; senão baixa do raw do GitHub
// (cobre o caso do Hermes ter baixado só este script).
async function loadSql(name) {
  try {
    const local = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', name);
    return await readFile(local, 'utf8');
  } catch {
    const res = await fetch(RAW_BASE + name);
    if (!res.ok) throw new Error(`falha baixando ${name} do GitHub: HTTP ${res.status}`);
    return res.text();
  }
}

async function runQuery(ref, token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const ref = extractProjectRef(need('SUPABASE_URL'));
  if (!ref) {
    console.error(JSON.stringify({
      ok: false,
      erro: 'SUPABASE_URL invalida: esperado https://<ref>.supabase.co',
    }));
    process.exit(1);
  }
  const token = need('SUPABASE_ACCESS_TOKEN');

  for (const name of MIGRATIONS) {
    const sql = await loadSql(name);
    await runQuery(ref, token, sql);
    console.error(`aplicada: ${name}`);
  }

  // Verificação: as 3 tabelas existem E estão com RLS ligado.
  const rows = await runQuery(
    ref,
    token,
    `select relname, relrowsecurity from pg_class
     where relname in ('${TABELAS.join("','")}') and relkind = 'r'`
  );
  const encontradas = Array.isArray(rows) ? rows : [];
  const semRls = encontradas.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  const faltando = TABELAS.filter((t) => !encontradas.some((r) => r.relname === t));

  const ok = faltando.length === 0 && semRls.length === 0;
  console.log(JSON.stringify({
    ok,
    tabelas_criadas: encontradas.map((r) => r.relname).sort(),
    tabelas_faltando: faltando,
    tabelas_sem_rls: semRls,
    proximo_passo: ok
      ? 'IMPORTANTE: peca ao humano pra REVOGAR o Personal Access Token agora (Account Settings > Access Tokens). Ele nao e mais necessario.'
      : 'algo falhou: NAO avance de fase; revise o erro acima',
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, erro: err.message }));
    process.exit(1);
  });
}
