// Registro de disparo de cron em cron_runs (migration 006), pro painel de
// saúde saber que os robôs rodaram. Best-effort por decisão: observabilidade
// NUNCA derruba o pipeline -- qualquer falha aqui vira console.error e a
// resposta do cron segue normal.

export async function recordCronRun(supabase, { project, job, startedAt, status, stats, error }) {
  try {
    const finished = new Date();
    const { error: insertError } = await supabase.from('cron_runs').insert({
      project,
      job,
      started_at: startedAt.toISOString(),
      finished_at: finished.toISOString(),
      duration_ms: finished.getTime() - startedAt.getTime(),
      status,
      stats: stats || null,
      error: error || null,
    });
    if (insertError) throw insertError;
  } catch (err) {
    // Tabela ausente (migration 006 não aplicada) cai aqui também: o cron
    // continua funcionando sem observabilidade, nunca o contrário.
    console.error(JSON.stringify({ level: 'cron_log_failed', project, job, message: err?.message || String(err) }));
  }
}
