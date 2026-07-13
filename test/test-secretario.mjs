// Testes offline das funções puras do CLI. Sem rede, sem env.
// Rodar: node test/test-secretario.mjs
import assert from 'node:assert/strict';
import { computeSla, validateTaskInput, formatCard, groupByChat, SLA_HORAS } from '../agente/secretario.mjs';
import { extractProjectRef } from '../agente/instalar-banco.mjs';
import { PROJETOS } from '../agente/instalar-webhook.mjs';

let passed = 0;
function ok(desc, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${desc}`);
}

const NOW = new Date('2026-07-13T12:00:00.000Z');

// --- computeSla ---
ok('prazo explicito vence a tabela de prioridade', () => {
  const r = computeSla('baixa', '2026-07-20T09:00:00-04:00', NOW);
  assert.equal(r.sla_regra, 'prazo-explicito');
  assert.equal(r.sla_at, '2026-07-20T13:00:00.000Z');
});
ok('critica = 4h', () => {
  const r = computeSla('critica', null, NOW);
  assert.equal(r.sla_at, '2026-07-13T16:00:00.000Z');
  assert.equal(r.sla_regra, 'prioridade-critica-4h');
});
ok('alta = 24h', () => {
  assert.equal(computeSla('alta', null, NOW).sla_at, '2026-07-14T12:00:00.000Z');
});
ok('media = 72h', () => {
  assert.equal(computeSla('media', null, NOW).sla_at, '2026-07-16T12:00:00.000Z');
});
ok('baixa nao tem SLA (nunca gera cobranca)', () => {
  const r = computeSla('baixa', null, NOW);
  assert.equal(r.sla_at, null);
  assert.equal(r.sla_regra, 'sem-sla');
});
ok('prioridade desconhecida cai em sem-sla (fail-closed, sem crash)', () => {
  assert.equal(computeSla('urgentissima', null, NOW).sla_at, null);
  assert.equal(SLA_HORAS.urgentissima, undefined);
});
ok('prazo_previsto invalido ignora e usa a tabela', () => {
  assert.equal(computeSla('alta', 'sexta que vem', NOW).sla_regra, 'prioridade-alta-24h');
});

// --- validateTaskInput ---
const BASE = {
  titulo: 'Responder proposta',
  resumo: 'Cliente pediu retorno sobre a proposta.',
  categoria: 'empresa',
  prioridade: 'alta',
  confianca: 'alta',
  message_ids: ['a1b2c3d4-0000-0000-0000-000000000001'],
};
ok('input completo passa', () => {
  assert.deepEqual(validateTaskInput(BASE), [true, []]);
});
ok('categoria fora da allowlist reprova (fail-closed)', () => {
  const [valido, erros] = validateTaskInput({ ...BASE, categoria: 'trabalho' });
  assert.equal(valido, false);
  assert.match(erros.join(';'), /categoria invalida/);
});
ok('prioridade fora da allowlist reprova', () => {
  assert.equal(validateTaskInput({ ...BASE, prioridade: 'urgente' })[0], false);
});
ok('confianca fora da allowlist reprova', () => {
  assert.equal(validateTaskInput({ ...BASE, confianca: 'incerta' })[0], false);
});
ok('message_ids vazio reprova', () => {
  assert.equal(validateTaskInput({ ...BASE, message_ids: [] })[0], false);
});
ok('meeting_id sozinho passa (task de reuniao)', () => {
  const { message_ids, ...semMsgs } = BASE;
  assert.deepEqual(validateTaskInput({ ...semMsgs, meeting_id: 'deadbeef-0000-0000-0000-000000000002' }), [true, []]);
});
ok('message_ids + meeting_id juntos reprova (origem ambigua)', () => {
  const [valido, erros] = validateTaskInput({ ...BASE, meeting_id: 'deadbeef-0000-0000-0000-000000000002' });
  assert.equal(valido, false);
  assert.match(erros.join(';'), /origem/);
});
ok('nenhuma origem reprova', () => {
  const { message_ids, ...semMsgs } = BASE;
  assert.equal(validateTaskInput(semMsgs)[0], false);
});
ok('prazo_previsto SEM offset reprova (fuso da maquina nao pode decidir)', () => {
  const [valido, erros] = validateTaskInput({ ...BASE, prazo_previsto: '2026-07-14T09:00:00' });
  assert.equal(valido, false);
  assert.match(erros.join(';'), /offset/);
});
ok('prazo_previsto com offset passa', () => {
  assert.equal(validateTaskInput({ ...BASE, prazo_previsto: '2026-07-14T09:00:00-04:00' })[0], true);
  assert.equal(validateTaskInput({ ...BASE, prazo_previsto: '2026-07-14T13:00:00Z' })[0], true);
});

// --- formatCard ---
ok('card leva emoji de prioridade, categoria, resumo e id curto', () => {
  const card = formatCard({
    id: 'deadbeef-1111-2222-3333-444444444444',
    titulo: 'Pagar boleto da escola',
    resumo: 'Vence sexta.',
    categoria: 'pessoal',
    prioridade: 'alta',
    prazo_texto: 'sexta',
    sla_at: '2026-07-17T12:00:00.000Z',
    acao_sugerida: 'pagar no app do banco',
    origem: 'Maria (DM)',
  });
  assert.match(card, /^🟠 PESSOAL · Pagar boleto da escola/);
  assert.match(card, /📝 Vence sexta\./);
  assert.match(card, /👉 Ação: pagar no app do banco/);
  assert.match(card, /⏰ Prazo: sexta · SLA: 2026-07-17T12:00:00\.000Z/);
  assert.match(card, /💬 Origem: Maria \(DM\)/);
  assert.match(card, /🆔 deadbeef/);
});

// --- groupByChat ---
const msg = (id, chat, receivedAt, extra = {}) => ({
  id,
  chat_id: chat,
  chat_type: 'dm',
  chat_name: null,
  sender_id: '5511@s.whatsapp.net',
  sender_name: 'Fulano',
  from_me: false,
  text_content: `msg ${id}`,
  received_at: receivedAt,
  ...extra,
});
ok('agrupa por chat e ordena cronologicamente', () => {
  const { conversas } = groupByChat(
    [
      msg('m2', 'chatA', '2026-07-13T11:30:00Z'),
      msg('m1', 'chatA', '2026-07-13T11:00:00Z'),
      msg('m3', 'chatB', '2026-07-13T11:10:00Z'),
    ],
    { settleMinutes: 10, now: Date.parse('2026-07-13T12:00:00Z') }
  );
  assert.equal(conversas.length, 2);
  const a = conversas.find((c) => c.chat_id === 'chatA');
  assert.deepEqual(a.mensagens.map((m) => m.id), ['m1', 'm2']);
});
ok('conversa quente (msg < settle) e adiada INTEIRA', () => {
  const { conversas, adiadas } = groupByChat(
    [
      msg('m1', 'chatA', '2026-07-13T11:00:00Z'),
      msg('m2', 'chatA', '2026-07-13T11:55:00Z'),
    ],
    { settleMinutes: 10, now: Date.parse('2026-07-13T12:00:00Z') }
  );
  assert.equal(conversas.length, 0);
  assert.equal(adiadas, 1);
});
ok('from_me vira "DONO" e midia sem texto ganha marcador', () => {
  const { conversas } = groupByChat(
    [msg('m1', 'chatA', '2026-07-13T11:00:00Z', { from_me: true, text_content: null })],
    { settleMinutes: 10, now: Date.parse('2026-07-13T12:00:00Z') }
  );
  const m = conversas[0].mensagens[0];
  assert.equal(m.de, 'DONO');
  assert.equal(m.texto, '[midia sem texto/transcricao]');
});

// --- extractProjectRef (instalar-banco) ---
ok('extrai ref de URL valida (com e sem barra final)', () => {
  assert.equal(extractProjectRef('https://eyeshtedbltwazicqkas.supabase.co'), 'eyeshtedbltwazicqkas');
  assert.equal(extractProjectRef('https://abc123.supabase.co/'), 'abc123');
});
ok('rejeita URL que nao e do formato do projeto', () => {
  assert.equal(extractProjectRef('https://supabase.com/dashboard/project/abc'), null);
  assert.equal(extractProjectRef('https://abc123.supabase.co/rest/v1'), null);
  assert.equal(extractProjectRef(''), null);
});

// --- PROJETOS (instalar-webhook) ---
ok('manifests dos deploys incluem package.json e vercel.json', () => {
  for (const proj of Object.values(PROJETOS)) {
    assert.ok(proj.files.includes('package.json'), `${proj.name} sem package.json`);
    assert.ok(proj.files.includes('vercel.json'), `${proj.name} sem vercel.json`);
    assert.ok(proj.envs.length >= 4, `${proj.name} com envs de menos`);
    assert.match(proj.healthPath, /^\/api\//);
  }
});
ok('os dois projetos existem e compartilham as envs do Supabase', () => {
  assert.deepEqual(Object.keys(PROJETOS).sort(), ['fireflies-webhook', 'webhook']);
  for (const proj of Object.values(PROJETOS)) {
    assert.ok(proj.envs.includes('SUPABASE_URL'));
    assert.ok(proj.envs.includes('SUPABASE_SERVICE_ROLE_KEY'));
  }
});

console.log(`\n${passed} asserts passando`);
