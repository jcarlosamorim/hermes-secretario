// Painel de saúde do Hermes Secretário -- HTML único, sem dependências.
// Os dados vêm de /api/dashboard-data (Bearer DASHBOARD_KEY); a chave é
// pedida uma vez e fica no localStorage do navegador do dono.
//
// Desenho: triagem no topo (a resposta "está tudo bem?" em 1 segundo),
// fluxo com contadores vivos, e as tabelas de detalhe depois. Nada aqui
// mostra conteúdo de mensagem -- só contagens e os títulos que o próprio
// agente gerou.
//
// ATENÇÃO ao editar: o HTML inteiro vive num template literal -- NENHUM
// backtick pode aparecer dentro dele (nem em comentário do JS embutido).

const HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hermes Secretário — Saúde</title>
<style>
  :root {
    --bg: #14171b; --card: #1e232a; --line: #2e353d;
    --ink: #e9e7e4; --ink2: #aab2ba; --ink3: #7b848d;
    --ok: #5fb98f; --warn: #e0a94f; --crit: #e08174; --accent: #6fa8dc;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 28px 16px 80px; }
  h1 { font-size: 20px; margin: 0; }
  #stamp { color: var(--ink3); font-size: 12.5px; margin: 4px 0 20px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--ink3); margin: 32px 0 10px; font-weight: 600; }
  .alert { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px;
    border: 1px solid var(--line); border-radius: 6px; margin-bottom: 8px; background: var(--card); }
  .alert.good { border-color: var(--ok); }
  .alert.warn { border-color: var(--warn); }
  .alert.crit { border-color: var(--crit); }
  .alert .sub { display: block; color: var(--ink3); font-size: 12.5px; margin-top: 2px; }
  .flow { display: flex; gap: 8px; align-items: stretch; overflow-x: auto; padding-bottom: 4px; }
  .node { background: var(--card); border: 1px solid var(--line); border-radius: 6px;
    padding: 10px 14px; min-width: 118px; flex-shrink: 0; }
  .node.hot { border-color: var(--warn); }
  .node .nval { font-size: 21px; font-weight: 650; }
  .node .nname { font-size: 11.5px; color: var(--ink2); }
  .node .nsub { font-size: 11px; color: var(--ink3); }
  .arrow { align-self: center; color: var(--ink3); flex-shrink: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; background: var(--card);
    border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  th { color: var(--ink3); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 500; }
  tr:last-child td { border-bottom: none; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11.5px;
    border: 1px solid var(--line); color: var(--ink2); white-space: nowrap; }
  .pill.critica { border-color: var(--crit); color: var(--crit); }
  .pill.alta { border-color: var(--warn); color: var(--warn); }
  .pill.vencida { background: var(--crit); border-color: var(--crit); color: #14171b; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips .pill b { color: var(--ink); }
  .muted { color: var(--ink3); }
  .scroll { overflow-x: auto; }
  #gate { max-width: 380px; margin: 12vh auto; text-align: center; }
  #gate input { width: 100%; padding: 10px 12px; border-radius: 6px; border: 1px solid var(--line);
    background: var(--card); color: var(--ink); font-size: 15px; margin: 12px 0; }
  #gate button { padding: 10px 22px; border-radius: 6px; border: 1px solid var(--accent);
    background: transparent; color: var(--accent); font-size: 15px; cursor: pointer; }
</style>
</head>
<body>
<div id="gate" hidden>
  <h1>Painel do Hermes Secretário</h1>
  <p class="muted">Cole a DASHBOARD_KEY definida na instalação (fase 2).</p>
  <input id="key" type="password" autocomplete="off" placeholder="chave do painel">
  <button id="entrar">Entrar</button>
  <p id="gateerr" class="muted"></p>
</div>
<div class="wrap" id="painel" hidden>
  <h1>Hermes Secretário</h1>
  <div id="stamp"></div>
  <div id="triage"></div>
  <h2>Fluxo</h2>
  <div class="flow" id="flow"></div>
  <h2>Tasks abertas (por SLA)</h2>
  <div class="scroll"><table id="abertas"></table></div>
  <h2>Distribuição das abertas</h2>
  <div class="chips" id="dist"></div>
  <h2>Últimas triagens do agente</h2>
  <div class="scroll"><table id="triagens"></table></div>
  <h2>Crons (transcrição, Fireflies)</h2>
  <div class="scroll"><table id="crons"></table></div>
</div>
<script>
  var KEY_STORAGE = 'hermes_dashboard_key';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function rel(iso) {
    if (!iso) return '—';
    var min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 48) return 'há ' + h + 'h';
    return 'há ' + Math.round(h / 24) + ' dias';
  }
  function node(icon, name, val, sub, hot) {
    return '<div class="node' + (hot ? ' hot' : '') + '">' +
      '<div class="nval">' + icon + ' ' + esc(val) + '</div>' +
      '<div class="nname">' + (hot ? '⚠️ ' : '') + esc(name) + '</div>' +
      (sub ? '<div class="nsub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function render(d) {
    document.getElementById('stamp').textContent = 'atualizado ' + rel(d.generated_at) +
      ' · captura + triagem do seu agente + tasks';

    var atencao = d.health.flags.filter(function (f) { return f.level !== 'ok'; });
    document.getElementById('triage').innerHTML = atencao.length === 0
      ? '<div class="alert good">✅ <div>Tudo operacional<span class="sub">' +
        esc(d.health.flags.map(function (f) { return f.message; })[0]) + '</span></div></div>'
      : atencao.map(function (f) {
          return '<div class="alert ' + f.level + '">' + (f.level === 'crit' ? '🔴' : '🟡') +
            ' <div>' + esc(f.message) + '</div></div>';
        }).join('');

    var p = d.pipeline, seta = '<div class="arrow">→</div>', fluxo = [];
    fluxo.push(node('💬', 'WhatsApp', p.whatsapp.mensagens_total,
      'última ' + rel(p.whatsapp.ultima_mensagem_em)));
    if (p.fireflies.instalado) fluxo.push(node('🎙️', 'Fireflies', p.fireflies.reunioes_total, p.fireflies.aguardando + ' na fila'));
    if (p.gmail.instalado) fluxo.push(node('📧', 'Gmail', p.gmail.emails_total, p.gmail.aguardando + ' na fila'));
    fluxo.push(node('🧠', 'Triagem', p.whatsapp.aguardando_triagem,
      'aguardando o agente', p.whatsapp.aguardando_triagem > 30));
    fluxo.push(node('📋', 'Tasks abertas', p.tasks.abertas,
      p.tasks.concluidas + ' concluídas', p.tasks.sla_vencidas > 0));
    fluxo.push(node('📱', 'Cards', p.tasks.abertas - p.tasks.sem_card,
      p.tasks.sem_card + ' sem publicar', p.tasks.sem_card > 5));
    document.getElementById('flow').innerHTML = fluxo.join(seta);

    document.getElementById('abertas').innerHTML =
      '<tr><th>Task</th><th>Categoria</th><th>Prioridade</th><th>SLA</th></tr>' +
      (d.abertas.length === 0 ? '<tr><td colspan="4" class="muted">nenhuma task aberta 🎉</td></tr>' :
        d.abertas.map(function (t) {
          return '<tr><td>' + esc(t.titulo) + (t.card_publicado ? '' : ' <span class="pill">sem card</span>') + '</td>' +
            '<td><span class="pill">' + esc(t.categoria) + '</span></td>' +
            '<td><span class="pill ' + esc(t.prioridade) + '">' + esc(t.prioridade) + '</span></td>' +
            '<td>' + (t.sla_vencida ? '<span class="pill vencida">vencida</span> ' : '') +
            '<span class="muted">' + (t.sla_at ? rel(t.sla_at).replace('há', 'venceu há') : 'sem SLA') + '</span></td></tr>';
        }).join(''));

    var dist = d.distribuicoes, blocos = [];
    ['categoria', 'prioridade', 'tipo'].forEach(function (dim) {
      Object.keys(dist[dim] || {}).forEach(function (k) {
        blocos.push('<span class="pill">' + esc(dim) + ': <b>' + esc(k) + '</b> ' + dist[dim][k] + '</span>');
      });
    });
    document.getElementById('dist').innerHTML = blocos.join('') || '<span class="muted">sem tasks abertas</span>';

    document.getElementById('triagens').innerHTML =
      '<tr><th>Quando</th><th>Lidas</th><th>Conversas</th><th>Tasks</th><th>Ruído</th><th>Cobranças</th><th>Notas</th></tr>' +
      (d.triagens.length === 0 ? '<tr><td colspan="7" class="muted">nenhuma triagem registrada ainda (fase 4)</td></tr>' :
        d.triagens.map(function (r) {
          return '<tr><td>' + rel(r.run_at) + '</td><td>' + r.mensagens_lidas + '</td><td>' + r.conversas_analisadas +
            '</td><td>' + r.tasks_criadas + '</td><td>' + r.ruido_arquivado + '</td><td>' + r.cobrancas_sla +
            '</td><td class="muted">' + esc(r.notas || '') + '</td></tr>';
        }).join(''));

    document.getElementById('crons').innerHTML =
      '<tr><th>Quando</th><th>Projeto</th><th>Job</th><th>Status</th><th>Stats</th></tr>' +
      (d.cron_runs.length === 0 ? '<tr><td colspan="5" class="muted">nenhum disparo registrado (migration 006 aplicada?)</td></tr>' :
        d.cron_runs.map(function (r) {
          return '<tr><td>' + rel(r.started_at) + '</td><td>' + esc(r.project) + '</td><td>' + esc(r.job) +
            '</td><td>' + (r.status === 'ok' ? '✅' : '🔴 ' + esc(r.error || 'erro')) +
            '</td><td class="muted">' + esc(JSON.stringify(r.stats || {})) + '</td></tr>';
        }).join(''));
  }

  function carregar(key) {
    return fetch('/api/dashboard-data', { headers: { Authorization: 'Bearer ' + key } })
      .then(function (r) {
        if (r.status === 401) throw new Error('chave incorreta');
        if (!r.ok) throw new Error('erro ' + r.status);
        return r.json();
      });
  }

  function iniciar(key) {
    carregar(key).then(function (d) {
      localStorage.setItem(KEY_STORAGE, key);
      document.getElementById('gate').hidden = true;
      document.getElementById('painel').hidden = false;
      render(d);
      setInterval(function () {
        carregar(key).then(render).catch(function () {});
      }, 60000);
    }).catch(function (err) {
      localStorage.removeItem(KEY_STORAGE);
      document.getElementById('gate').hidden = false;
      document.getElementById('gateerr').textContent = err.message;
    });
  }

  var salva = localStorage.getItem(KEY_STORAGE);
  if (salva) { iniciar(salva); } else { document.getElementById('gate').hidden = false; }
  document.getElementById('entrar').addEventListener('click', function () {
    iniciar(document.getElementById('key').value.trim());
  });
  document.getElementById('key').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') iniciar(document.getElementById('key').value.trim());
  });
</script>
</body>
</html>`;

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(HTML);
}
