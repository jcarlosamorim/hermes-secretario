// Testes offline dos helpers puros do painel. Sem rede, sem env.
// Rodar: node test/test-dashboard.mjs
import assert from 'node:assert/strict';
import { countBy, computeHealth, safeEqual } from '../webhook/lib/dashboard-helpers.js';

let passed = 0;
function ok(desc, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${desc}`);
}

const NOW = new Date('2026-07-14T12:00:00.000Z');
const horasAtras = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
const flag = (health, code) => health.flags.find((f) => f.code === code);

// Snapshot de sistema saudável: triagem recente, fila jovem, opcionais fora.
function saudavel(extra = {}) {
  return {
    ultimaTriagemEm: horasAtras(0.5),
    backlogWa: { count: 3, oldestAt: horasAtras(0.2) },
    slaVencidas: 0,
    abertasSemCard: 1,
    cronErrors24h: 0,
    transcricao: { installed: false, lastRunAt: null },
    fireflies: { installed: false, backlog: 0 },
    gmail: { installed: false, backlog: 0, oldestPendingAt: null },
    ...extra,
  };
}

// --- countBy ---
ok('countBy conta ocorrências e null vira (sem valor)', () => {
  const d = countBy([{ c: 'pessoal' }, { c: 'pessoal' }, { c: 'empresa' }, {}], 'c');
  assert.equal(d.pessoal, 2);
  assert.equal(d.empresa, 1);
  assert.equal(d['(sem valor)'], 1);
});
ok('countBy: lista vazia/null -> objeto vazio', () => {
  assert.deepEqual(countBy([], 'c'), {});
  assert.deepEqual(countBy(null, 'c'), {});
});

// --- computeHealth: o caminho feliz ---
ok('sistema saudável -> overall ok, todas as flags ok', () => {
  const h = computeHealth(saudavel(), NOW);
  assert.equal(h.overall, 'ok');
  assert.ok(h.flags.every((f) => f.level === 'ok'));
});

// --- triagem: a flag mais importante (agente para em silêncio) ---
ok('triagem nunca rodou -> warn (rotina não instalada ou sem log-run)', () => {
  const h = computeHealth(saudavel({ ultimaTriagemEm: null }), NOW);
  assert.equal(flag(h, 'triagem').level, 'warn');
});
ok('triagem há 5h -> warn', () => {
  const h = computeHealth(saudavel({ ultimaTriagemEm: horasAtras(5) }), NOW);
  assert.equal(flag(h, 'triagem').level, 'warn');
});
ok('triagem há 13h -> crit (agente parou; tasks param de nascer)', () => {
  const h = computeHealth(saudavel({ ultimaTriagemEm: horasAtras(13) }), NOW);
  assert.equal(flag(h, 'triagem').level, 'crit');
  assert.equal(h.overall, 'crit');
});

// --- backlog: idade manda, tamanho não ---
ok('backlog grande mas jovem -> ok (rajada + janela de assentamento)', () => {
  const h = computeHealth(saudavel({ backlogWa: { count: 40, oldestAt: horasAtras(0.5) } }), NOW);
  assert.equal(flag(h, 'wa_backlog').level, 'ok');
});
ok('pendente há 8h -> warn mesmo com fila pequena', () => {
  const h = computeHealth(saudavel({ backlogWa: { count: 2, oldestAt: horasAtras(8) } }), NOW);
  assert.equal(flag(h, 'wa_backlog').level, 'warn');
});
ok('pendente há 30h -> crit (fila não consumida)', () => {
  const h = computeHealth(saudavel({ backlogWa: { count: 9, oldestAt: horasAtras(30) } }), NOW);
  assert.equal(flag(h, 'wa_backlog').level, 'crit');
});
ok('fila vazia (oldestAt null) -> ok', () => {
  const h = computeHealth(saudavel({ backlogWa: { count: 0, oldestAt: null } }), NOW);
  assert.equal(flag(h, 'wa_backlog').level, 'ok');
});

// --- SLA e publicação ---
ok('SLA vencida -> warn', () => {
  const h = computeHealth(saudavel({ slaVencidas: 2 }), NOW);
  assert.equal(flag(h, 'sla').level, 'warn');
});
ok('7 tasks sem card -> warn (agente criando e não publicando)', () => {
  const h = computeHealth(saudavel({ abertasSemCard: 7 }), NOW);
  assert.equal(flag(h, 'publicacao').level, 'warn');
});

// --- crons e opcionais: ausência nunca é vermelho ---
ok('cron com erro em 24h -> warn', () => {
  const h = computeHealth(saudavel({ cronErrors24h: 1 }), NOW);
  assert.equal(flag(h, 'cron_errors').level, 'warn');
});
ok('transcrição não instalada -> ok (opcional)', () => {
  const h = computeHealth(saudavel(), NOW);
  assert.equal(flag(h, 'transcricao').level, 'ok');
});
ok('transcrição instalada e cron parado há 30h -> warn', () => {
  const h = computeHealth(saudavel({ transcricao: { installed: true, lastRunAt: horasAtras(30) } }), NOW);
  assert.equal(flag(h, 'transcricao').level, 'warn');
});
ok('fireflies com 15 reuniões na fila -> warn', () => {
  const h = computeHealth(saudavel({ fireflies: { installed: true, backlog: 15 } }), NOW);
  assert.equal(flag(h, 'fireflies').level, 'warn');
});
ok('gmail com pendente de 15h -> warn', () => {
  const h = computeHealth(saudavel({ gmail: { installed: true, backlog: 3, oldestPendingAt: horasAtras(15) } }), NOW);
  assert.equal(flag(h, 'gmail').level, 'warn');
});
ok('snapshot vazio não explode (defaults defensivos)', () => {
  const h = computeHealth({}, NOW);
  assert.ok(h.flags.length >= 8);
});

// --- safeEqual ---
ok('safeEqual: iguais true, diferentes false, vazio false', () => {
  assert.equal(safeEqual('abc123', 'abc123'), true);
  assert.equal(safeEqual('abc123', 'abc124'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual('abc', 'abcdef'), false);
  assert.equal(safeEqual(null, 'x'), false);
});

console.log(`\n${passed} asserts ok.`);
