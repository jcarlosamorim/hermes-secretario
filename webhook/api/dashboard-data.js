// Dados do painel de saúde (JSON) -- consumido por /api/dashboard.
//
// Segurança, herdada do sistema original:
// - Auth SOMENTE via Authorization: Bearer $DASHBOARD_KEY (query string fica
//   gravada nos request logs da Vercel e no histórico do navegador).
// - Sem a env configurada o endpoint falha FECHADO (503), nunca aberto.
// - NUNCA devolve text_content/raw_payload: o painel mostra contagens e os
//   títulos/resumos que o próprio agente gerou, nada da conversa bruta.
// - Fontes opcionais (Fireflies, Gmail, transcrição) falham SUAVE: tabela
//   ausente vira "não instalado", nunca derruba o painel inteiro.

import { getSupabase } from '../lib/supabase.js';
import { countBy, computeHealth, safeEqual } from '../lib/dashboard-helpers.js';

function extractKey(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

// Count exato no banco, com filtro opcional. Janela explícita sempre que a
// pergunta for temporal -- nunca filter() sobre "as últimas N linhas".
function headCount(supabase, table, filter) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  if (filter) q = filter(q);
  return q.then(({ count, error }) => {
    if (error) throw new Error(`${table}: ${error.message}`);
    return count ?? 0;
  });
}

// Fonte opcional: tabela pode não existir (migration não aplicada) ou nunca
// ter sido usada. Erro aqui = não instalado, não incidente.
async function optional(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const expected = process.env.DASHBOARD_KEY;
  if (!expected) return res.status(503).json({ ok: false, error: 'DASHBOARD_KEY nao configurada' });
  if (!safeEqual(extractKey(req), expected)) return res.status(401).json({ ok: false });

  const supabase = getSupabase();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  try {
    const [
      waTotal, waPendentes, waOldestPending, waUltima,
      abertas, tasksDone, tasksArquivadas, tasksTotal,
      triagens, cronRows, cronErrors24h,
      lastTranscribe, ff, gm,
    ] = await Promise.all([
      headCount(supabase, 'whatsapp_messages'),
      headCount(supabase, 'whatsapp_messages', (q) => q.eq('processed', false)),
      supabase.from('whatsapp_messages').select('received_at').eq('processed', false)
        .order('received_at', { ascending: true }).limit(1)
        .then(({ data, error }) => { if (error) throw new Error(`wa oldest: ${error.message}`); return data?.[0]?.received_at || null; }),
      supabase.from('whatsapp_messages').select('received_at')
        .order('received_at', { ascending: false }).limit(1)
        .then(({ data, error }) => { if (error) throw new Error(`wa ultima: ${error.message}`); return data?.[0]?.received_at || null; }),
      // Só as abertas, filtradas no banco: agregado sobre "as N mais
      // recentes" esconderia justamente a task antiga estagnada.
      supabase.from('tasks')
        .select('id, titulo, categoria, tipo, prioridade, requer_resposta, sla_at, sla_regra, card_ref, responsavel, created_at')
        .eq('status', 'aberta')
        .order('created_at', { ascending: false }).limit(200)
        .then(({ data, error }) => { if (error) throw new Error(`tasks: ${error.message}`); return data || []; }),
      headCount(supabase, 'tasks', (q) => q.eq('status', 'concluida')),
      headCount(supabase, 'tasks', (q) => q.eq('status', 'arquivada')),
      headCount(supabase, 'tasks'),
      supabase.from('triagem_runs')
        .select('run_at, mensagens_lidas, conversas_analisadas, tasks_criadas, ruido_arquivado, cobrancas_sla, notas')
        .order('run_at', { ascending: false }).limit(15)
        .then(({ data, error }) => { if (error) throw new Error(`triagem_runs: ${error.message}`); return data || []; }),
      optional(() => supabase.from('cron_runs')
        .select('project, job, started_at, duration_ms, status, stats, error')
        .order('started_at', { ascending: false }).limit(20)
        .then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; })),
      optional(() => headCount(supabase, 'cron_runs', (q) => q.eq('status', 'error').gte('started_at', dayAgo))),
      optional(() => supabase.from('cron_runs').select('started_at')
        .eq('job', 'transcribe').order('started_at', { ascending: false }).limit(1)
        .then(({ data, error }) => { if (error) throw new Error(error.message); return data?.[0]?.started_at || null; })),
      optional(async () => ({
        total: await headCount(supabase, 'fireflies_meetings'),
        backlog: await headCount(supabase, 'fireflies_meetings', (q) => q.eq('processed', false)),
      })),
      optional(async () => ({
        total: await headCount(supabase, 'gmail_messages'),
        backlog: await headCount(supabase, 'gmail_messages', (q) => q.eq('processed', false)),
        oldest: await supabase.from('gmail_messages').select('received_at').eq('processed', false)
          .order('received_at', { ascending: true }).limit(1)
          .then(({ data, error }) => { if (error) throw new Error(error.message); return data?.[0]?.received_at || null; }),
      })),
    ]);

    const nowMs = now.getTime();
    const slaVencidas = abertas.filter((t) => t.sla_at && new Date(t.sla_at).getTime() < nowMs).length;
    const abertasSemCard = abertas.filter((t) => !t.card_ref).length;

    const health = computeHealth(
      {
        ultimaTriagemEm: triagens[0]?.run_at || null,
        backlogWa: { count: waPendentes, oldestAt: waOldestPending },
        slaVencidas,
        abertasSemCard,
        cronErrors24h: cronErrors24h || 0,
        // Transcrição instalada = já registrou disparo alguma vez (a env
        // GROQ_API_KEY não é visível daqui e não deve ser).
        transcricao: { installed: Boolean(lastTranscribe), lastRunAt: lastTranscribe },
        fireflies: { installed: Boolean(ff && ff.total > 0), backlog: ff?.backlog || 0 },
        gmail: { installed: Boolean(gm && gm.total > 0), backlog: gm?.backlog || 0, oldestPendingAt: gm?.oldest || null },
      },
      now
    );

    // Vencidas primeiro, depois por SLA mais próximo; sem SLA por último.
    const abertasOrdenadas = [...abertas].sort((a, b) => {
      const aMs = a.sla_at ? new Date(a.sla_at).getTime() : Infinity;
      const bMs = b.sla_at ? new Date(b.sla_at).getTime() : Infinity;
      return aMs - bMs;
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      generated_at: now.toISOString(),
      health,
      pipeline: {
        whatsapp: { mensagens_total: waTotal, aguardando_triagem: waPendentes, ultima_mensagem_em: waUltima },
        fireflies: ff ? { instalado: ff.total > 0, reunioes_total: ff.total, aguardando: ff.backlog } : { instalado: false },
        gmail: gm ? { instalado: gm.total > 0, emails_total: gm.total, aguardando: gm.backlog } : { instalado: false },
        tasks: {
          abertas: abertas.length,
          concluidas: tasksDone,
          arquivadas: tasksArquivadas,
          total: tasksTotal,
          sla_vencidas: slaVencidas,
          sem_card: abertasSemCard,
        },
      },
      distribuicoes: {
        categoria: countBy(abertas, 'categoria'),
        prioridade: countBy(abertas, 'prioridade'),
        tipo: countBy(abertas, 'tipo'),
      },
      abertas: abertasOrdenadas.map((t) => ({
        titulo: t.titulo,
        categoria: t.categoria,
        prioridade: t.prioridade,
        tipo: t.tipo,
        sla_at: t.sla_at,
        sla_vencida: Boolean(t.sla_at && new Date(t.sla_at).getTime() < nowMs),
        card_publicado: Boolean(t.card_ref),
        responsavel: t.responsavel,
        created_at: t.created_at,
      })),
      triagens,
      cron_runs: cronRows || [],
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'dashboard_error', message: err.message }));
    return res.status(500).json({ ok: false, error: err.message });
  }
}
