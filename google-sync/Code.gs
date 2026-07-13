/**
 * Hermes Secretário — sincronizador Gmail + Google Agenda (Apps Script).
 *
 * O que faz, a cada 15 minutos:
 *   - Gmail: envia METADADOS + início do corpo (800 chars) das mensagens
 *     recebidas nos últimos 2 dias (fora Promoções/Social e fora o que o
 *     próprio dono enviou). Quem decide o que exige ação humana é o
 *     Hermes, na triagem.
 *   - Agenda: envia os eventos dos próximos 7 dias (upsert; evento apagado
 *     some da checagem sozinho).
 *
 * Idempotência é do BANCO, não daqui: a cada rodada a janela inteira é
 * reenviada e o webhook ignora o que já tem (upsert por gmail_message_id).
 * Assim, falha transitória de gravação se auto-corrige na rodada seguinte,
 * e mensagem nova numa conversa antiga nunca fica invisível (era o defeito
 * do desenho com label por thread: label é da THREAD no Gmail).
 *
 * INSTALAÇÃO (o Hermes te guia):
 *   1. Edite WEBHOOK_URL abaixo (o Hermes te manda a URL completa, já com
 *      o secret).
 *   2. script.google.com > New project > cole este arquivo > salve.
 *   3. Selecione a função `setup` no menu e clique em Run. Autorize o
 *      acesso a Gmail e Agenda quando o Google pedir.
 *   4. Pronto: o setup cria o gatilho de 15 min e roda a primeira sync.
 *      (Rodou setup duas vezes sem querer? Rode mais uma: ele remove
 *      gatilhos duplicados antes de criar o dele.)
 *
 * Privacidade: o corpo completo dos emails NUNCA sai da sua conta; apenas
 * remetente, assunto e os primeiros 800 caracteres em texto puro.
 */

// >>> EDITE AQUI (o Hermes fornece a URL completa com ?secret=...) <<<
var WEBHOOK_URL = 'https://SEU-WEBHOOK.vercel.app/api/webhook/google?secret=SEU_SECRET';

var GMAIL_QUERY = 'in:inbox newer_than:2d -category:promotions -category:social';
var GMAIL_THREADS = 30;
var JANELA_MS = 2 * 24 * 3600 * 1000;
var SNIPPET_CHARS = 800;
var AGENDA_DIAS = 7;
var POST_CHUNK = 100; // alinhado ao MAX_ITEMS do webhook (lotes maiores são fatiados)

/** Rode esta função UMA vez pra instalar (autoriza + cria o gatilho). */
function setup() {
  // Remove gatilhos antigos deste projeto (evita duplicar).
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'hermesSync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('hermesSync').timeBased().everyMinutes(15).create();
  hermesSync();
  Logger.log('Hermes Secretário instalado: gatilho de 15 min criado e primeira sync executada.');
}

/** Função chamada pelo gatilho. */
function hermesSync() {
  syncGmail();
  syncCalendar();
}

function syncGmail() {
  var threads = GmailApp.search(GMAIL_QUERY, 0, GMAIL_THREADS);
  if (!threads.length) return;
  var me = '';
  try { me = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (err) { /* segue sem filtro do dono */ }
  var cutoff = new Date(Date.now() - JANELA_MS);
  var items = [];
  threads.forEach(function (thread) {
    var msgs;
    try { msgs = thread.getMessages(); } catch (err) { Logger.log('thread pulada: ' + err); return; }
    msgs.forEach(function (m) {
      // Isolamento por mensagem: uma mensagem problemática (corpo gigante,
      // erro de API) é pulada com log e NUNCA trava a sync inteira.
      try {
        if (m.getDate() < cutoff) return;
        var from = String(m.getFrom() || '').toLowerCase();
        if (me && from.indexOf(me) !== -1) return; // enviado pelo dono: não é candidato
        items.push({
          gmail_message_id: m.getId(),
          thread_id: thread.getId(),
          from: m.getFrom(),
          to: m.getTo(),
          subject: m.getSubject(),
          snippet: m.getPlainBody().slice(0, SNIPPET_CHARS),
          received_at: m.getDate().toISOString(),
          labels: thread.getLabels().map(function (l) { return l.getName(); }),
        });
      } catch (err) {
        Logger.log('mensagem pulada: ' + err);
      }
    });
  });
  postChunked_('gmail', items);
}

function syncCalendar() {
  var now = new Date();
  var end = new Date(now.getTime() + AGENDA_DIAS * 24 * 3600 * 1000);
  var events = CalendarApp.getDefaultCalendar().getEvents(now, end);
  if (!events.length) return;
  var tz = Session.getScriptTimeZone();
  var items = [];
  events.forEach(function (e) {
    try {
      var allDay = e.isAllDayEvent();
      var startsAt, endsAt;
      if (allDay) {
        // Data pura no fuso do calendário: evita o dia "escorregar" ao
        // converter meia-noite local pra UTC (fusos a leste do UTC).
        startsAt = Utilities.formatDate(e.getAllDayStartDate(), tz, 'yyyy-MM-dd');
        endsAt = Utilities.formatDate(e.getAllDayEndDate(), tz, 'yyyy-MM-dd');
      } else {
        startsAt = e.getStartTime().toISOString();
        endsAt = e.getEndTime().toISOString();
      }
      var myStatus = null;
      try { myStatus = e.getMyStatus() ? String(e.getMyStatus()) : null; } catch (err) { /* evento sem convite */ }
      items.push({
        // getId() é o MESMO pra toda a série de um evento recorrente;
        // anexar o início torna cada ocorrência única no upsert.
        google_event_id: e.getId() + '/' + e.getStartTime().getTime(),
        title: e.getTitle(),
        description: (e.getDescription() || '').slice(0, 500),
        location: e.getLocation() || null,
        starts_at: startsAt,
        ends_at: endsAt,
        all_day: allDay,
        attendees: e.getGuestList().map(function (g) { return g.getEmail(); }),
        status: myStatus,
      });
    } catch (err) {
      Logger.log('evento pulado: ' + err);
    }
  });
  postChunked_('calendar', items);
}

function postChunked_(kind, items) {
  for (var i = 0; i < items.length; i += POST_CHUNK) {
    post_(kind, items.slice(i, i + POST_CHUNK));
  }
}

function post_(kind, items) {
  if (!items.length) return;
  var res = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ kind: kind, items: items }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code !== 200) {
    // throw registra a falha no Apps Script; como a idempotência é do banco,
    // a rodada seguinte reenvia a janela inteira sem duplicar nada.
    throw new Error('webhook ' + kind + ' respondeu HTTP ' + code + ' — confira WEBHOOK_URL/secret');
  }
}
