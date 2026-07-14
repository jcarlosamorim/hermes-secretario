#!/usr/bin/env node
// Deploya um dos projetos Vercel deste repo SEM o humano importar nada:
// ele só cola um Access Token temporário; este script cria o projeto,
// configura as env vars e sobe os arquivos via REST API da Vercel
// (deploy por upload direto: não usa git, não exige integração GitHub).
// Node 18+, zero dependências. Idempotente: re-rodar refaz o deploy e
// atualiza as envs (upsert), sem duplicar projeto.
//
// Env necessárias:
//   VERCEL_TOKEN   Access Token (Account Settings > Tokens), criado com
//                  expiração curta; o humano revoga no fim da fase.
//   + as env vars do projeto alvo (ver PROJETOS abaixo), que o script
//     replica pro ambiente de produção da Vercel.
//
// Uso: node instalar-webhook.mjs <webhook|fireflies-webhook>

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const RAW_BASE =
  'https://raw.githubusercontent.com/jcarlosamorim/hermes-secretario/main/';
const API = 'https://api.vercel.com';

export const PROJETOS = {
  webhook: {
    name: 'hermes-secretario-webhook',
    dir: 'webhook',
    files: [
      'package.json',
      'vercel.json',
      'api/webhook/uazapi.js',
      'api/webhook/google.js',
      'api/cron/transcribe.js',
      'api/dashboard.js',
      'api/dashboard-data.js',
      'lib/dashboard-helpers.js',
      'lib/cron-log.js',
      'lib/extract.js',
      'lib/filter.js',
      'lib/supabase.js',
      'lib/logger.js',
      'lib/uazapi.js',
      'lib/transcribe.js',
      'config/excluded-chats.json',
    ],
    envs: ['UAZAPI_WEBHOOK_SECRET', 'OWNER_JID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DASHBOARD_KEY'],
    // Setadas só se presentes no ambiente (fase 3C adiciona GOOGLE_SYNC_SECRET;
    // fase 3D adiciona as de transcrição — re-rodando este script).
    envsOpcionais: ['GOOGLE_SYNC_SECRET', 'GROQ_API_KEY', 'UAZAPI_BASE_URL', 'UAZAPI_TOKEN', 'CRON_SECRET'],
    healthPath: '/api/webhook/uazapi',
  },
  'fireflies-webhook': {
    name: 'hermes-secretario-fireflies',
    dir: 'fireflies-webhook',
    files: [
      'package.json',
      'vercel.json',
      'api/webhook.js',
      'api/cron/fetch-actions.js',
      'lib/fireflies.js',
      'lib/supabase.js',
      'lib/cron-log.js',
    ],
    envs: ['FIREFLIES_WEBHOOK_SECRET', 'FIREFLIES_API_KEY', 'CRON_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    healthPath: '/api/webhook',
  },
};

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(JSON.stringify({ ok: false, erro: `variavel de ambiente ${name} ausente` }));
    process.exit(2);
  }
  return v;
}

async function vercel(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// Lê o arquivo do repo local se existir; senão baixa do raw do GitHub
// (cobre o caso do Hermes ter baixado só este script).
async function loadFile(dir, rel) {
  try {
    const local = join(dirname(fileURLToPath(import.meta.url)), '..', dir, rel);
    return await readFile(local, 'utf8');
  } catch {
    const res = await fetch(`${RAW_BASE}${dir}/${rel}`);
    if (!res.ok) throw new Error(`falha baixando ${dir}/${rel} do GitHub: HTTP ${res.status}`);
    return res.text();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const alvo = process.argv[2];
  const proj = PROJETOS[alvo];
  if (!proj) {
    console.error(JSON.stringify({
      ok: false,
      erro: `uso: node instalar-webhook.mjs <${Object.keys(PROJETOS).join('|')}>`,
    }));
    process.exit(1);
  }
  need('VERCEL_TOKEN');
  const envValues = Object.fromEntries(proj.envs.map((k) => [k, need(k)]));
  for (const k of proj.envsOpcionais || []) {
    if (process.env[k]) envValues[k] = process.env[k];
  }
  // Fase 3D é tudo-ou-nada: GROQ_API_KEY sem o resto deixaria o endpoint de
  // transcrição inoperante (sem uazapi) ou aberto (sem CRON_SECRET).
  if (alvo === 'webhook' && envValues.GROQ_API_KEY) {
    for (const k of ['UAZAPI_BASE_URL', 'UAZAPI_TOKEN', 'CRON_SECRET']) {
      if (!envValues[k]) {
        console.error(JSON.stringify({
          ok: false,
          erro: `transcricao (GROQ_API_KEY) exige tambem ${k} — passe as 4 envs da fase 3D juntas`,
        }));
        process.exit(2);
      }
    }
  }

  // 1. Cria o projeto (409 = já existe, segue em frente).
  const created = await vercel('/v11/projects', { method: 'POST', body: { name: proj.name } });
  if (created.status !== 200 && created.status !== 409) {
    throw new Error(`criacao do projeto: HTTP ${created.status}: ${JSON.stringify(created.data).slice(0, 300)}`);
  }
  console.error(`projeto ${proj.name}: ${created.status === 409 ? 'ja existia' : 'criado'}`);

  // 2. Env vars de produção (upsert: re-rodar atualiza).
  const envPayload = Object.entries(envValues).map(([key, value]) => ({
    key,
    value,
    type: 'encrypted',
    target: ['production'],
  }));
  const envRes = await vercel(`/v10/projects/${proj.name}/env?upsert=true`, {
    method: 'POST',
    body: envPayload,
  });
  if (envRes.status >= 400) {
    // Só o objeto error da resposta: o body completo poderia ecoar os
    // valores das envs recém-enviadas num erro de validação.
    const motivo = JSON.stringify(envRes.data?.error || { status: envRes.status });
    throw new Error(`env vars: HTTP ${envRes.status}: ${motivo.slice(0, 200)}`);
  }
  console.error(`env vars configuradas: ${Object.keys(envValues).join(', ')}`);

  // 3. Sobe os arquivos e dispara o deploy de produção.
  const files = [];
  for (const rel of proj.files) {
    files.push({ file: rel, data: await loadFile(proj.dir, rel) });
  }
  const dep = await vercel('/v13/deployments', {
    method: 'POST',
    body: {
      name: proj.name,
      target: 'production',
      files,
      projectSettings: { framework: null },
    },
  });
  if (dep.status >= 400) {
    throw new Error(`deployment: HTTP ${dep.status}: ${JSON.stringify(dep.data).slice(0, 300)}`);
  }
  console.error(`deploy disparado: ${dep.data.id}`);

  // 4. Espera o build (READY ou ERROR), até 5 min.
  let state = dep.data.readyState || 'QUEUED';
  let info = dep.data;
  const deadline = Date.now() + 300_000;
  while (state !== 'READY' && state !== 'ERROR' && state !== 'CANCELED') {
    if (Date.now() > deadline) throw new Error('timeout esperando o build (5 min)');
    await sleep(5000);
    const poll = await vercel(`/v13/deployments/${dep.data.id}`);
    info = poll.data || info;
    state = info.readyState || state;
    console.error(`build: ${state}`);
  }
  if (state !== 'READY') {
    throw new Error(`build terminou em ${state}; veja os logs no painel da Vercel (projeto ${proj.name})`);
  }

  // 5. URL de produção (primeiro alias; fallback = URL do deployment).
  const aliases = info.alias || [];
  const urlProducao = `https://${aliases[0] || info.url}`;

  // 6. Health check.
  let health = null;
  try {
    const h = await fetch(`${urlProducao}${proj.healthPath}`);
    health = { status: h.status, body: (await h.text()).slice(0, 100) };
  } catch (err) {
    health = { erro: err.message };
  }

  console.log(JSON.stringify({
    ok: true,
    projeto: proj.name,
    url_producao: urlProducao,
    aliases,
    health_check: health,
    painel: alvo === 'webhook' ? `${urlProducao}/api/dashboard` : undefined,
    proximo_passo: alvo === 'webhook'
      ? 'guarde a url_producao: ela entra no registro do webhook da uazapi (fase 3). O painel de saude esta em /api/dashboard (abre com a DASHBOARD_KEY)'
      : 'guarde a url_producao: ela entra no registro do webhook no painel do Fireflies (fase 3B.3)',
  }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, erro: err.message }));
    process.exit(1);
  });
}
