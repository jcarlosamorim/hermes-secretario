#!/usr/bin/env node
// Hermes Secretário: CLI que o Hermes usa pra operar o sistema de triagem.
// Node 18+, zero dependências (só fetch nativo). O Hermes NUNCA fala com o
// banco por conta própria: toda leitura e escrita passa por estes comandos.
// Publicar o card no Telegram é responsabilidade do Hermes (o comando
// create-task devolve o card pronto em texto).
//
// Comandos:
//   fetch-pending                     conversas de WhatsApp pendentes de triagem (JSON)
//   fetch-meetings                    reuniões (Fireflies) com action items pendentes
//   create-task '<json>'              cria task (origem: message_ids OU meeting_id), devolve card
//   ack-card <task_uuid> <card_ref>   registra onde o card foi publicado
//   mark-processed <uuid> [...]       arquiva mensagens de ruído (sem task)
//   mark-meeting-processed <uuid> [...]  marca reuniões como triadas
//   list-open [--vencidas]            tasks abertas (opcional: só SLA vencido)
//   close-task <uuid> [motivo]        conclui task
//   log-run '<json>'                  grava auditoria da varredura em triagem_runs
//
// Credenciais (nada além destas duas no ambiente):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Segurança: nunca expõe raw_payload; enums vindos de julgamento validados
// por ALLOWLIST (fail-closed: valor desconhecido é erro, nunca default).

import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(JSON.stringify({ ok: false, erro: `variavel de ambiente ${name} ausente` }));
    process.exit(2);
  }
  return v;
}

// ---------------------------------------------------------------------------
// PostgREST (Supabase) helpers
// ---------------------------------------------------------------------------

async function pg(path, { method = 'GET', body, headers = {} } = {}) {
  const key = need('SUPABASE_SERVICE_ROLE_KEY');
  const url = `${need('SUPABASE_URL')}/rest/v1/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PostgREST ${res.status} em ${path.split('?')[0]}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

function inList(ids) {
  return `in.(${ids.map((i) => `"${i}"`).join(',')})`;
}

// ---------------------------------------------------------------------------
// Funções puras (exportadas pra teste offline)
// ---------------------------------------------------------------------------

export const SLA_HORAS = { critica: 4, alta: 24, media: 72, baixa: null };

export function computeSla(prioridade, prazoPrevisto, now = new Date()) {
  if (prazoPrevisto) {
    const t = Date.parse(prazoPrevisto);
    if (Number.isFinite(t)) {
      return { sla_at: new Date(t).toISOString(), sla_regra: 'prazo-explicito' };
    }
  }
  const horas = SLA_HORAS[prioridade];
  if (horas == null) return { sla_at: null, sla_regra: 'sem-sla' };
  return {
    sla_at: new Date(now.getTime() + horas * 3600 * 1000).toISOString(),
    sla_regra: `prioridade-${prioridade}-${horas}h`,
  };
}

const CATEGORIAS = new Set(['pessoal', 'empresa']);
const PRIORIDADES = new Set(['critica', 'alta', 'media', 'baixa']);
const TIPOS = new Set(['pergunta', 'pedido', 'agendamento', 'urgente', 'outro']);
const CONFIANCAS = new Set(['alta', 'media', 'baixa']);
// ISO com offset explícito obrigatório (Z ou ±HH:MM). Sem offset, o mesmo
// prazo gravaria instantes diferentes dependendo do fuso da máquina.
const ISO_COM_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;

export function validateTaskInput(input) {
  const erros = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [false, ['input precisa ser um objeto JSON']];
  }
  if (!input.titulo || typeof input.titulo !== 'string') erros.push('titulo obrigatorio (string)');
  if (!input.resumo || typeof input.resumo !== 'string') erros.push('resumo obrigatorio (string)');
  if (!CATEGORIAS.has(input.categoria)) erros.push(`categoria invalida: ${input.categoria} (use pessoal|empresa)`);
  if (!PRIORIDADES.has(input.prioridade)) erros.push(`prioridade invalida: ${input.prioridade} (use critica|alta|media|baixa)`);
  if (!CONFIANCAS.has(input.confianca)) erros.push(`confianca invalida: ${input.confianca} (use alta|media|baixa)`);
  if (input.tipo !== undefined && !TIPOS.has(input.tipo)) erros.push(`tipo invalido: ${input.tipo}`);
  // Exatamente UMA origem: mensagens de WhatsApp OU reunião do Fireflies.
  const temMsgs = Array.isArray(input.message_ids) && input.message_ids.length > 0;
  const temMeeting = typeof input.meeting_id === 'string' && input.meeting_id.length > 0;
  if (temMsgs === temMeeting) {
    erros.push('origem: informe message_ids (WhatsApp) OU meeting_id (reuniao), exatamente um');
  }
  if (input.prazo_previsto !== undefined && input.prazo_previsto !== null) {
    if (typeof input.prazo_previsto !== 'string' || !ISO_COM_OFFSET.test(input.prazo_previsto) ||
        !Number.isFinite(Date.parse(input.prazo_previsto))) {
      erros.push('prazo_previsto precisa ser ISO 8601 COM offset (termina em Z ou ±HH:MM)');
    }
  }
  return [erros.length === 0, erros];
}

const PRIO_EMOJI = { critica: '🔴', alta: '🟠', media: '🟡', baixa: '⚪' };

// Card pronto pro Hermes publicar no tópico da categoria. Texto puro de
// propósito: markup quebraria com _ * [ ] vindos de mensagens reais.
export function formatCard(task) {
  const linhas = [];
  linhas.push(`${PRIO_EMOJI[task.prioridade] || '⚪'} ${task.categoria.toUpperCase()} · ${task.titulo}`);
  linhas.push('');
  linhas.push(`📝 ${task.resumo}`);
  if (task.acao_sugerida) linhas.push(`👉 Ação: ${task.acao_sugerida}`);
  const prazoParts = [];
  if (task.prazo_texto) prazoParts.push(`Prazo: ${task.prazo_texto}`);
  if (task.sla_at) prazoParts.push(`SLA: ${task.sla_at}`);
  if (prazoParts.length) linhas.push(`⏰ ${prazoParts.join(' · ')}`);
  if (task.origem) linhas.push(`💬 Origem: ${task.origem}`);
  linhas.push(`🆔 ${String(task.id).slice(0, 8)}`);
  return linhas.join('\n');
}

export function groupByChat(rows, { settleMinutes = 10, now = Date.now() } = {}) {
  const byChat = new Map();
  for (const row of rows) {
    if (!byChat.has(row.chat_id)) byChat.set(row.chat_id, []);
    byChat.get(row.chat_id).push(row);
  }
  const conversas = [];
  let adiadas = 0;
  const settleMs = settleMinutes * 60 * 1000;
  for (const msgs of byChat.values()) {
    msgs.sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
    const maisRecente = Date.parse(msgs[msgs.length - 1].received_at);
    // Janela de assentamento: conversa ainda "quente" espera a próxima
    // varredura pra não cortar um pedido no meio da digitação.
    if (now - maisRecente < settleMs) {
      adiadas += 1;
      continue;
    }
    const primeira = msgs[0];
    conversas.push({
      chat_id: primeira.chat_id,
      chat_name: primeira.chat_name || null,
      chat_type: primeira.chat_type,
      mensagens: msgs.map((m) => ({
        id: m.id,
        de: m.from_me ? 'DONO' : (m.sender_name || m.sender_id || 'desconhecido'),
        from_me: Boolean(m.from_me),
        texto: m.text_content || '[midia sem texto/transcricao]',
        quando: m.received_at,
      })),
    });
  }
  return { conversas, adiadas };
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

async function cmdFetchPending() {
  const rows = await pg(
    'whatsapp_messages?processed=eq.false' +
    '&select=id,chat_id,chat_type,chat_name,sender_id,sender_name,from_me,text_content,received_at' +
    '&order=received_at.asc&limit=500'
  );
  const settleMinutes = Number(process.env.SETTLE_MINUTES || 10);
  const { conversas, adiadas } = groupByChat(rows, { settleMinutes });
  print({
    ok: true,
    total_pendentes: rows.length,
    conversas_prontas: conversas.length,
    adiadas_assentamento: adiadas,
    conversas,
  });
}

async function cmdCreateTask(jsonArg) {
  const input = parseJsonArg(jsonArg);
  const [valido, erros] = validateTaskInput(input);
  if (!valido) return fail(`input invalido: ${erros.join('; ')}`);

  let origem;
  let origemRow;
  let conflictTarget;
  if (input.meeting_id) {
    const meetings = await pg(
      `fireflies_meetings?id=eq.${input.meeting_id}&select=id,title,meeting_date`
    );
    if (!meetings.length) return fail(`reuniao ${input.meeting_id} nao encontrada`);
    origem = `${meetings[0].title || 'reuniao'} (reuniao)`;
    origemRow = { fireflies_meeting_id: input.meeting_id, context_message_ids: [] };
    // Uma reunião gera N tasks: a chave de idempotência é (reunião, título).
    conflictTarget = 'fireflies_meeting_id,titulo';
  } else {
    // Confere que as mensagens existem e elege a mais recente como âncora.
    const msgs = await pg(
      `whatsapp_messages?id=${inList(input.message_ids)}` +
      '&select=id,received_at,chat_name,chat_type,sender_name'
    );
    if (msgs.length !== input.message_ids.length) {
      return fail(`message_ids: esperava ${input.message_ids.length} mensagens, achei ${msgs.length}`);
    }
    msgs.sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
    const anchor = msgs[msgs.length - 1];
    const origemNome = anchor.chat_name || anchor.sender_name || 'desconhecido';
    origem = `${origemNome} (${anchor.chat_type === 'group' ? 'grupo' : 'DM'})`;
    origemRow = { whatsapp_message_id: anchor.id, context_message_ids: input.message_ids };
    conflictTarget = 'whatsapp_message_id';
  }

  const { sla_at, sla_regra } = computeSla(input.prioridade, input.prazo_previsto ?? null);

  const row = {
    ...origemRow,
    titulo: input.titulo,
    resumo: input.resumo,
    categoria: input.categoria,
    tipo: input.tipo ?? 'outro',
    prioridade: input.prioridade,
    requer_resposta: Boolean(input.requer_resposta),
    acao_sugerida: input.acao_sugerida ?? null,
    prazo_texto: input.prazo_texto ?? null,
    prazo_previsto: input.prazo_previsto ?? null,
    responsavel: input.responsavel ?? null,
    confianca: input.confianca,
    sla_at,
    sla_regra,
  };

  // Upsert com ignore-duplicates: retry após falha parcial não duplica task.
  const inserted = await pg(`tasks?on_conflict=${conflictTarget}`, {
    method: 'POST',
    body: row,
    headers: { prefer: 'return=representation,resolution=ignore-duplicates' },
  });
  let jaExistia = false;
  let task = inserted?.[0];
  if (!task) {
    jaExistia = true;
    const lookup = input.meeting_id
      ? `tasks?fireflies_meeting_id=eq.${input.meeting_id}&titulo=eq.${encodeURIComponent(input.titulo)}&select=*`
      : `tasks?whatsapp_message_id=eq.${row.whatsapp_message_id}&select=*`;
    const existing = await pg(lookup);
    task = existing[0];
    if (!task) return fail('conflito no insert mas task existente nao encontrada');
  }

  // Origem WhatsApp: marca TODAS as mensagens da conversa como processadas
  // (descarte do acúmulo). Origem reunião: NÃO marca nada aqui — uma reunião
  // gera N tasks; o Hermes fecha com mark-meeting-processed no fim.
  if (!input.meeting_id) {
    await pg(`whatsapp_messages?id=${inList(input.message_ids)}`, {
      method: 'PATCH',
      body: { processed: true },
    });
  }

  print({
    ok: true,
    ja_existia: jaExistia,
    // Onde publicar e o quê: o Hermes posta este card no tópico da categoria.
    // ja_existia=true e card_ref preenchido = card já publicado antes, NÃO republique.
    topico: task.categoria,
    card: formatCard({ ...task, origem }),
    task,
  });
}

async function cmdAckCard(taskId, cardRef) {
  if (!taskId || !cardRef) return fail('uso: ack-card <task_uuid> <card_ref>');
  const updated = await pg(`tasks?id=eq.${taskId}`, {
    method: 'PATCH',
    body: { card_ref: cardRef, updated_at: new Date().toISOString() },
    headers: { prefer: 'return=representation' },
  });
  if (!updated.length) return fail(`task ${taskId} nao encontrada`);
  print({ ok: true, task: updated[0] });
}

async function cmdMarkProcessed(ids) {
  if (!ids.length) return fail('uso: mark-processed <uuid> [uuid...]');
  await pg(`whatsapp_messages?id=${inList(ids)}`, {
    method: 'PATCH',
    body: { processed: true },
  });
  print({ ok: true, marcadas: ids.length });
}

async function cmdFetchMeetings() {
  const rows = await pg(
    'fireflies_meetings?processed=eq.false&fetch_status=eq.ok' +
    '&select=id,title,meeting_date,action_items_raw&order=received_at.asc&limit=20'
  );
  print({
    ok: true,
    total: rows.length,
    aviso: 'action_items_raw vem em blocos por pessoa; o (mm:ss) no fim de cada linha e timestamp da call, NUNCA prazo',
    reunioes: rows,
  });
}

async function cmdMarkMeetingProcessed(ids) {
  if (!ids.length) return fail('uso: mark-meeting-processed <uuid> [uuid...]');
  await pg(`fireflies_meetings?id=${inList(ids)}`, {
    method: 'PATCH',
    body: { processed: true },
  });
  print({ ok: true, marcadas: ids.length });
}

async function cmdListOpen(flags) {
  let path = 'tasks?status=eq.aberta&select=*&order=sla_at.asc.nullslast';
  if (flags.includes('--vencidas')) {
    path += `&sla_at=lt.${new Date().toISOString()}`;
  }
  const rows = await pg(path);
  print({ ok: true, total: rows.length, tasks: rows });
}

async function cmdCloseTask(id, motivo) {
  if (!id) return fail('uso: close-task <uuid> [motivo]');
  // Guard no WHERE: nunca sobrescreve task já concluída/arquivada.
  const updated = await pg(`tasks?id=eq.${id}&status=eq.aberta`, {
    method: 'PATCH',
    body: {
      status: 'concluida',
      closed_reason: motivo || 'concluida pelo dono',
      updated_at: new Date().toISOString(),
    },
    headers: { prefer: 'return=representation' },
  });
  if (!updated.length) return fail(`task ${id} nao encontrada ou ja fechada`);
  print({ ok: true, task: updated[0] });
}

async function cmdLogRun(jsonArg) {
  const input = parseJsonArg(jsonArg);
  const row = {
    mensagens_lidas: int(input.mensagens_lidas),
    conversas_analisadas: int(input.conversas_analisadas),
    reunioes_analisadas: int(input.reunioes_analisadas),
    tasks_criadas: int(input.tasks_criadas),
    ruido_arquivado: int(input.ruido_arquivado),
    cobrancas_sla: int(input.cobrancas_sla),
    notas: typeof input.notas === 'string' ? input.notas : null,
  };
  await pg('triagem_runs', { method: 'POST', body: row });
  print({ ok: true });
}

// ---------------------------------------------------------------------------
// Infra do CLI
// ---------------------------------------------------------------------------

function int(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function parseJsonArg(arg) {
  try {
    return JSON.parse(arg);
  } catch {
    fail('argumento precisa ser JSON valido (entre aspas simples no shell)');
  }
}

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function fail(msg) {
  console.error(JSON.stringify({ ok: false, erro: msg }));
  process.exit(1);
}

const USO = `hermes-secretario CLI (v3)

  fetch-pending                    conversas de WhatsApp pendentes de triagem
  fetch-meetings                   reunioes (Fireflies) pendentes de triagem
  create-task '<json>'             cria task, devolve card pronto
  ack-card <task_uuid> <card_ref>  registra onde o card foi publicado
  mark-processed <uuid> [...]      arquiva ruido de WhatsApp sem criar task
  mark-meeting-processed <uuid> [...]  marca reunioes como triadas
  list-open [--vencidas]           tasks abertas
  close-task <uuid> [motivo]       conclui task
  log-run '<json>'                 grava auditoria da varredura

create-task espera: { titulo, resumo, categoria: pessoal|empresa,
  prioridade: critica|alta|media|baixa, confianca: alta|media|baixa,
  message_ids: [uuid...] OU meeting_id: uuid (exatamente um),
  tipo?, requer_resposta?, acao_sugerida?, prazo_texto?,
  prazo_previsto? (ISO com offset), responsavel? }

env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (nada alem disso)`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'fetch-pending': return cmdFetchPending();
    case 'fetch-meetings': return cmdFetchMeetings();
    case 'create-task': return cmdCreateTask(args[0]);
    case 'ack-card': return cmdAckCard(args[0], args.slice(1).join(' '));
    case 'mark-processed': return cmdMarkProcessed(args);
    case 'mark-meeting-processed': return cmdMarkMeetingProcessed(args);
    case 'list-open': return cmdListOpen(args);
    case 'close-task': return cmdCloseTask(args[0], args.slice(1).join(' '));
    case 'log-run': return cmdLogRun(args[0]);
    default:
      console.log(USO);
      process.exit(cmd ? 1 : 0);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => fail(err.message));
}
