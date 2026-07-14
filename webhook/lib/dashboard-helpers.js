// Funções puras do painel de saúde -- separadas do endpoint pra rodarem
// offline em test/test-dashboard.mjs, no mesmo padrão dos helpers do CLI.
//
// A pergunta que o painel responde: "o sistema continua rodando sozinho?".
// A lição de projeto por trás das flags: os estágios que rodam DENTRO do
// agente (triagem) são os que quebram em silêncio -- webhook fora do ar dá
// erro visível, agente que parou de rodar não dá sinal nenhum. Por isso a
// flag mais importante daqui é a de triagem parada.

import { timingSafeEqual } from 'node:crypto';

// Conta ocorrências de um campo: [{p:'alta'},...] -> {alta: 2, ...}.
// null/undefined caem em '(sem valor)' pra nunca sumirem da soma.
export function countBy(rows, field) {
  const out = {};
  for (const row of rows || []) {
    const key = row?.[field] ?? '(sem valor)';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

const HORA = 3600 * 1000;

function idadeHoras(iso, nowMs) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (nowMs - t) / HORA;
}

// Flags de saúde. Cada flag: { level: 'ok'|'warn'|'crit', code, message }.
// Fontes opcionais (Fireflies, Gmail, transcrição) NUNCA geram vermelho por
// ausência: não instalado é estado normal, não falha.
export function computeHealth(snapshot, now = new Date()) {
  const nowMs = now.getTime();
  const flags = [];
  const {
    ultimaTriagemEm = null,
    backlogWa = { count: 0, oldestAt: null },
    slaVencidas = 0,
    abertasSemCard = 0,
    cronErrors24h = 0,
    transcricao = { installed: false, lastRunAt: null },
    fireflies = { installed: false, backlog: 0 },
    gmail = { installed: false, backlog: 0, oldestPendingAt: null },
  } = snapshot || {};

  // 1. Triagem do agente -- a rotina é horária (AGENTE-TRIAGEM.md, seção A)
  // e loga em triagem_runs. Se parou, NADA mais acusa: o webhook continua
  // verde capturando e as tasks simplesmente param de nascer.
  const triagemIdade = idadeHoras(ultimaTriagemEm, nowMs);
  if (triagemIdade === null) {
    flags.push({
      level: 'warn',
      code: 'triagem',
      message: 'Nenhuma triagem registrada ainda — rotina não instalada (fase 4) ou o agente não está rodando log-run',
    });
  } else if (triagemIdade > 12) {
    flags.push({
      level: 'crit',
      code: 'triagem',
      message: `Triagem parada: última passada há ${Math.round(triagemIdade)}h (esperado: a cada hora). O agente parou — as mensagens continuam chegando e nenhuma task nasce.`,
    });
  } else if (triagemIdade > 3) {
    flags.push({
      level: 'warn',
      code: 'triagem',
      message: `Última triagem há ${Math.round(triagemIdade)}h (esperado: a cada hora)`,
    });
  } else {
    flags.push({ level: 'ok', code: 'triagem', message: `Última triagem há ${Math.round(triagemIdade * 60)} min` });
  }

  // 2. Backlog de captura -- medido pela IDADE da pendente mais antiga, não
  // pelo tamanho: acúmulo logo após uma rajada é normal (janela de 10 min),
  // pendente velha significa triagem pulando mensagem.
  const backlogIdade = idadeHoras(backlogWa.oldestAt, nowMs);
  if (backlogIdade !== null && backlogIdade > 24) {
    flags.push({
      level: 'crit',
      code: 'wa_backlog',
      message: `Mensagem esperando triagem há ${Math.round(backlogIdade)}h (${backlogWa.count} pendentes) — a fila não está sendo consumida`,
    });
  } else if (backlogIdade !== null && backlogIdade > 6) {
    flags.push({
      level: 'warn',
      code: 'wa_backlog',
      message: `Mensagem mais antiga esperando triagem há ${Math.round(backlogIdade)}h (${backlogWa.count} pendentes)`,
    });
  } else {
    flags.push({ level: 'ok', code: 'wa_backlog', message: `${backlogWa.count} mensagem(ns) aguardando a próxima triagem` });
  }

  // 3. SLA -- a cobrança é responsabilidade do agente (3x/dia); vencida é
  // aviso pro dono, não incêndio.
  if (slaVencidas > 0) {
    flags.push({ level: 'warn', code: 'sla', message: `${slaVencidas} task(s) abertas com SLA vencido (a rotina cobra 3x/dia)` });
  } else {
    flags.push({ level: 'ok', code: 'sla', message: 'Nenhuma task aberta com SLA vencido' });
  }

  // 4. Task criada e nunca publicada como card: o agente criou mas esqueceu
  // o passo de publicar/ack-card. Poucas é normal (janela entre criar e
  // publicar); muitas é rotina pela metade.
  if (abertasSemCard > 5) {
    flags.push({
      level: 'warn',
      code: 'publicacao',
      message: `${abertasSemCard} task(s) abertas sem card publicado — o agente está criando e não publicando?`,
    });
  } else {
    flags.push({ level: 'ok', code: 'publicacao', message: `${abertasSemCard} task(s) aguardando publicação` });
  }

  // 5. Crons da Vercel com erro.
  if (cronErrors24h > 0) {
    flags.push({ level: 'warn', code: 'cron_errors', message: `${cronErrors24h} disparo(s) de cron com erro nas últimas 24h` });
  } else {
    flags.push({ level: 'ok', code: 'cron_errors', message: 'Nenhum disparo de cron com erro nas últimas 24h' });
  }

  // 6. Transcrição (fase 3D, opcional) -- cron diário às 9h; sem disparo há
  // mais de ~26h significa cron morto, não dia sem áudio.
  if (!transcricao.installed) {
    flags.push({ level: 'ok', code: 'transcricao', message: 'Transcrição de áudio não instalada (fase 3D, opcional)' });
  } else {
    const idade = idadeHoras(transcricao.lastRunAt, nowMs);
    if (idade !== null && idade > 26) {
      flags.push({ level: 'warn', code: 'transcricao', message: `Cron de transcrição sem disparo há ${Math.round(idade)}h (esperado: diário)` });
    } else {
      flags.push({ level: 'ok', code: 'transcricao', message: 'Cron de transcrição rodando (diário)' });
    }
  }

  // 7. Fireflies (fase 3B, opcional).
  if (!fireflies.installed) {
    flags.push({ level: 'ok', code: 'fireflies', message: 'Fireflies não instalado (fase 3B, opcional)' });
  } else if (fireflies.backlog > 10) {
    flags.push({ level: 'warn', code: 'fireflies', message: `${fireflies.backlog} reunião(ões) aguardando análise do agente` });
  } else {
    flags.push({ level: 'ok', code: 'fireflies', message: `${fireflies.backlog} reunião(ões) na fila` });
  }

  // 8. Gmail (fase 3C, opcional) -- o Apps Script empurra a cada 15 min e a
  // triagem horária consome; pendente com mais de 12h é fila parada.
  if (!gmail.installed) {
    flags.push({ level: 'ok', code: 'gmail', message: 'Gmail não instalado (fase 3C, opcional)' });
  } else {
    const idade = idadeHoras(gmail.oldestPendingAt, nowMs);
    if (idade !== null && idade > 12) {
      flags.push({ level: 'warn', code: 'gmail', message: `E-mail esperando triagem há ${Math.round(idade)}h (${gmail.backlog} pendentes)` });
    } else {
      flags.push({ level: 'ok', code: 'gmail', message: `${gmail.backlog} e-mail(s) na fila` });
    }
  }

  const worst = flags.some((f) => f.level === 'crit') ? 'crit' : flags.some((f) => f.level === 'warn') ? 'warn' : 'ok';
  return { overall: worst, flags };
}

// Comparação em tempo constante da chave do painel (evita timing attack
// barato no endpoint público). Retorna false pra tipos/vazios inválidos.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
