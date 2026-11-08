// Nutzungsstatistik für den Betreiber (Graphit: Mehr → Admin · Statistik).
//
// 1) mTrack(kind, name): zählt Bedienschritte (Dashboard geöffnet, Bereich
//    angetippt, Funktion benutzt). Gesammelt und alle paar Sekunden in einem
//    Rutsch an POST api/v1/usage geschickt. Nur Namen aus einer festen Liste,
//    keine Inhalte. Server: backend/usage.py.
// 2) Die Statistik-Seite (nur Betreiber, GET api/v1/admin/stats): Zahlen je
//    Person - wie oft genutzt, welche Bereiche, Claude, Garmin, Summen der
//    Trainings. Keine einzelnen Trainings, Gesundheitswerte oder Nachrichten.

const mUsageQueue = [];
let mUsageTimer = null;

function mTrack(kind, name) {
  if (!kind || !name || mUsageQueue.length >= 50) return;
  mUsageQueue.push({ kind, name });
  clearTimeout(mUsageTimer);
  mUsageTimer = setTimeout(mFlushUsage, 4000);
}

function mFlushUsage() {
  clearTimeout(mUsageTimer);
  if (!mUsageQueue.length || typeof apiCall !== "function" || !getAuthToken()) return;
  const events = mUsageQueue.splice(0, mUsageQueue.length);
  apiCall("usage", "POST", { events }, { redirectOn401: false, timeoutMs: 8000 }).catch(() => { /* Statistik ist Nebensache */ });
}

const mAdmin = { isAdmin: false, days: 30, data: null, loading: false, error: "" };

function initUsageTracking() {
  mTrack("open", window.matchMedia("(min-width: 900px)").matches ? "desktop" : "mobile");
  // Beim Verlassen/Ausblenden der Seite den Rest noch abschicken.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") mFlushUsage(); });
  let jsErrors = 0;
  window.addEventListener("error", () => { if (jsErrors++ < 3) mTrack("error", "js"); });
  apiCall("invites", "GET", null, { redirectOn401: false })
    .then(r => { mAdmin.isAdmin = !!(r.data && r.data.admin); if (mAdmin.isAdmin && typeof mScheduleRender === "function") mScheduleRender(); })
    .catch(() => {});
}

async function mLoadAdminStats(force) {
  if (mAdmin.loading || (mAdmin.data && !force)) return;
  mAdmin.loading = true;
  mAdmin.error = "";
  try {
    mAdmin.data = (await apiCall(`admin/stats?days=${mAdmin.days}`)).data;
  } catch (e) {
    mAdmin.error = e.message || String(e);
  } finally {
    mAdmin.loading = false;
    if (mState.page === "admin") renderMApp();
  }
}

const M_PAGE_NAMES = { heute: "Übersicht", kalender: "Kalender", coach: "Coach", training: "Training", mehr: "Mehr",
  overview: "Insights", nutrition: "Ernährung", records: "Rekorde", analysis: "Analyse", settings: "Einstellungen", calendar: "Kalender (klassisch)", mobility: "Mobility (klassisch)" };
const M_FEATURE_NAMES = { "coach-note": "Coach-Nachricht", "coach-undo": "Coach rückgängig", outlook: "Ausblick erstellt", "mob-start": "Mobility gestartet",
  "strength-start": "Kraft gestartet", "mob-claude": "Mobility mit KI-Coach", "plan-new": "Einheit geplant", "plan-open": "Geplante Einheit geöffnet",
  "workout-open": "Training angesehen", "garmin-send": "An Garmin gesendet", "garmin-push-login": "Uhr-Anmeldung", "classic-view": "Klassische Ansicht" };

function mAdminAgo(iso) {
  if (!iso) return "noch nie";
  const days = Math.round((new Date(localDateStr(new Date()) + "T12:00:00") - new Date(iso + "T12:00:00")) / 86400000);
  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  return `vor ${days} Tagen`;
}

// Balken: eine Säule je Tag bzw. Woche, Höhe = aktive Personen.
function mAdminBars(points, labelFn, max) {
  const top = Math.max(1, max || 0, ...points.map(p => p.users));
  return `<div class="m-adm-bars" role="img" aria-label="Aktive Personen">${points.map(p =>
    `<span title="${mEsc(labelFn(p))}: ${p.users}"><i style="height:${Math.max(p.users ? 6 : 2, Math.round(p.users / top * 100))}%"${p.users ? "" : ' class="zero"'}></i></span>`).join("")}</div>`;
}

// Rangliste mit waagerechten Balken (Bereiche, Funktionen).
function mAdminRank(counts, names, color) {
  const list = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!list.length) return `<p class="m-muted-note">Noch keine Daten.</p>`;
  const top = list[0][1];
  return `<div class="m-adm-rank">${list.map(([k, v]) => `<div class="m-adm-rank-row"><span>${mEsc(names[k] || k)}</span><b>${v}</b>
    <div class="m-adm-rank-bar"><i style="width:${Math.max(3, Math.round(v / top * 100))}%;background:${color}"></i></div></div>`).join("")}</div>`;
}

// Kosten in US-Dollar (so rechnet Anthropic ab), deutsch geschrieben.
function mUsd(v) {
  if (!v) return "0 $";
  if (v < 0.01) return "< 0,01 $";
  return `${mNum(v, 2)} $`;
}

const M_AI_TASK_NAMES = {
  plan: "Trainingsplan", dailycheck: "Täglicher Plan-Check", analysis: "Auswertung einer Einheit",
  lessons: "Lessons Learned", focus: "Belastung einordnen", perfSummary: "Leistungszustand",
  recommendation: "Coach-Empfehlung", morning: "Morgenbericht", mobility: "Mobility", chat: "Sonstiges",
};

const mTok = n => (n >= 1e6 ? `${mNum(n / 1e6, 2)} Mio.` : n >= 1000 ? `${mNum(n / 1000, 1)}k` : String(n || 0));

// KI-Nutzung und Kosten je Modell und je Aufgabe (backend/usage.py).
function mAdminAiCostCard(d) {
  const models = d.ai_models || [];
  const legacy = d.ai_tokens_without_model || { in: 0, out: 0 };
  const total = (d.totals && d.totals.ai_cost_usd) || 0;
  const rows = models.map(m => `<div class="m-row"><span class="m-grow"><span class="m-row-title">${mEsc(m.label)}</span>
      <span class="m-row-meta">${m.requests} Anfragen · ${mTok(m.tokens_in)} gelesen / ${mTok(m.tokens_out)} geschrieben</span></span>
      <b>${m.price_known ? mUsd(m.cost_usd) : "Preis unbekannt"}</b></div>`).join("");
  const old = legacy.in + legacy.out ? `<div class="m-row"><span class="m-grow"><span class="m-row-title">Ohne Modell</span>
      <span class="m-row-meta">vor Version 2.4.37 gezählt · ${mTok(legacy.in)} / ${mTok(legacy.out)}</span></span><b>–</b></div>` : "";
  const tasks = Object.entries(d.ai_cost_tasks || {}).sort((a, b) => b[1] - a[1]);
  const top = tasks.length ? tasks[0][1] : 0;
  const taskHtml = tasks.length ? `<div class="m-adm-sub">Kosten je Aufgabe</div><div class="m-adm-rank">${tasks.map(([k, v]) => `<div class="m-adm-rank-row"><span>${mEsc(M_AI_TASK_NAMES[k] || k)}</span><b>${mUsd(v)}</b>
      <div class="m-adm-rank-bar"><i style="width:${Math.max(3, Math.round(v / top * 100))}%;background:var(--m-r2)"></i></div></div>`).join("")}</div>` : "";
  return `<section class="m-card"><div class="m-head"><h2>KI-Kosten</h2><span class="m-adm-hint">${d.days} Tage</span></div>
    <div class="m-adm-cost"><b>${mUsd(total)}</b><span>geschätzt nach Listenpreis, in US-Dollar</span></div>
    ${rows || old ? `<div class="m-list">${rows}${old}</div>` : `<p class="m-muted-note">Noch keine KI-Anfragen im Zeitraum.</p>`}
    ${taskHtml}</section>`;
}

function mAdminYesNo(v) {
  if (v === null || v === undefined) return `<span class="m-adm-flag">?</span>`;
  return v ? `<span class="m-adm-flag on">✓</span>` : `<span class="m-adm-flag">–</span>`;
}

function mAdminUserCard(u) {
  const opens = (u.opens.mobile || 0) + (u.opens.desktop || 0);
  const topPages = Object.entries(u.pages || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => M_PAGE_NAMES[k] || k).join(", ");
  return `<section class="m-card m-adm-user">
    <div class="m-head"><h2>${mEsc(u.username)}</h2><span class="m-adm-seen ${u.last_seen && (Date.now() - new Date(u.last_seen + "T12:00:00")) < 7 * 86400000 ? "on" : ""}">${mEsc(mAdminAgo(u.last_seen))}</span></div>
    <div class="m-stats">
      <div class="m-num"><small>Aktive Tage</small><b>${u.active_days}</b></div>
      <div class="m-num"><small>Geöffnet</small><b>${opens}</b></div>
      <div class="m-num"><small>KI-Coach</small><b>${u.ai_requests}${u.ai_cost_usd ? `<em> ${mUsd(u.ai_cost_usd)}</em>` : ""}</b></div>
      <div class="m-num"><small>Trainings</small><b>${u.workouts}</b></div>
      <div class="m-num"><small>Stunden</small><b>${mNum(u.hours, 1)}</b></div>
      <div class="m-num"><small>Garmin-Abrufe</small><b class="${u.garmin.fehler ? "warn" : ""}">${u.garmin.ok}${u.garmin.fehler ? `<em class="down"> +${u.garmin.fehler} ✕</em>` : ""}</b></div>
    </div>
    <div class="m-adm-meta">
      <span>Handy ${u.opens.mobile || 0} · Computer ${u.opens.desktop || 0}</span>
      ${topPages ? `<span>Am meisten: ${mEsc(topPages)}</span>` : ""}
    </div>
    <div class="m-adm-flags"><span>${mAdminYesNo(u.garmin.connected)} Garmin</span><span>${mAdminYesNo(u.goal)} Ziel</span><span>${mAdminYesNo(u.onboarding)} Einrichtung</span>
      ${u.ai_errors ? `<span class="warn">${u.ai_errors} KI-Coach-Fehler</span>` : ""}${u.js_errors ? `<span class="warn">${u.js_errors} App-Fehler</span>` : ""}</div>
    <div class="m-adm-since">Konto seit ${u.since ? mEsc(new Date(u.since + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" })) : "–"} · ${u.workouts_total} Trainings insgesamt</div>
  </section>`;
}

function mRenderAdmin() {
  const back = `<button type="button" class="m-pill" data-m-page="mehr">‹ Mehr</button>`;
  const head = mHeaderHtml("Nur für dich als Betreiber", "Statistik", back);
  if (!mAdmin.isAdmin) return head + `<section class="m-card"><p>Die Statistik sieht nur der Betreiber des Dashboards.</p></section>`;
  if (!mAdmin.data) {
    mLoadAdminStats();
    return head + `<section class="m-card"><p class="m-muted-note">${mAdmin.error ? mEsc(mAdmin.error) : "Lädt …"}</p></section>`;
  }
  const d = mAdmin.data;
  const t = d.totals;
  const ranges = [[7, "7 Tage"], [30, "30 Tage"], [90, "90 Tage"]];
  const seg = `<div class="m-subseg m-adm-range">${ranges.map(([n, l]) => `<button type="button" data-m-act="adm-days" data-days="${n}" class="${d.days === n ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const tokens = t.ai_tokens_in + t.ai_tokens_out;
  const kpis = `<section class="m-card"><div class="m-head"><h2>Überblick</h2><button type="button" class="m-link" data-m-act="adm-reload">${mAdmin.loading ? "Lädt …" : "Aktualisieren"}</button></div>
    <div class="m-stats">
      <div class="m-num"><small>Konten</small><b>${t.accounts}</b></div>
      <div class="m-num"><small>Aktiv (${d.days} T.)</small><b class="good">${t.active}</b></div>
      <div class="m-num"><small>Aktiv (7 T.)</small><b>${t.active_7d}</b></div>
      <div class="m-num"><small>Geöffnet</small><b>${t.opens_mobile + t.opens_desktop}</b></div>
      <div class="m-num"><small>KI-Coach-Anfragen</small><b>${t.ai_requests}</b></div>
      <div class="m-num"><small>Trainings</small><b>${t.workouts}</b></div>
    </div>
    <div class="m-adm-meta"><span>Handy ${t.opens_mobile} · Computer ${t.opens_desktop}</span><span>${mNum(t.hours, 1)} h trainiert</span></div></section>`;
  const fmtDay = p => new Date(p.day + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "short" });
  const fmtWeek = p => "Woche ab " + new Date(p.week + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "short" });
  const active = `<section class="m-card"><div class="m-head"><h2>Aktive Personen je Tag</h2></div>${mAdminBars(d.daily_active, fmtDay, t.accounts)}
      <div class="m-adm-axis"><span>${mEsc(fmtDay(d.daily_active[0]))}</span><span>heute</span></div></section>
    <section class="m-card"><div class="m-head"><h2>Je Woche</h2><span class="m-adm-hint">12 Wochen</span></div>${mAdminBars(d.weekly_active, fmtWeek, t.accounts)}
      <div class="m-adm-axis"><span>vor 12 Wochen</span><span>diese Woche</span></div></section>`;
  const tech = `<section class="m-card"><div class="m-head"><h2>Technik</h2></div><div class="m-list">
      <div class="m-row"><span class="m-grow"><span class="m-row-title">Garmin verbunden</span></span><b>${t.garmin_connected} von ${t.accounts}</b></div>
      <div class="m-row"><span class="m-grow"><span class="m-row-title">Garmin-Abrufe</span><span class="m-row-meta">geklappt / fehlgeschlagen</span></span><b>${t.garmin_ok} / <span class="${t.garmin_fehler ? "m-adm-warn" : ""}">${t.garmin_fehler}</span></b></div>
      <div class="m-row"><span class="m-grow"><span class="m-row-title">KI-Coach-Fehler</span></span><b class="${t.ai_errors ? "m-adm-warn" : ""}">${t.ai_errors}</b></div>
      <div class="m-row"><span class="m-grow"><span class="m-row-title">KI-Coach-Tokens</span><span class="m-row-meta">gelesen / geschrieben</span></span><b>${tokens ? `${mNum(t.ai_tokens_in / 1000, 1)}k / ${mNum(t.ai_tokens_out / 1000, 1)}k` : "–"}</b></div>
      <div class="m-row"><span class="m-grow"><span class="m-row-title">App-Fehler im Browser</span></span><b class="${t.js_errors ? "m-adm-warn" : ""}">${t.js_errors}</b></div>
    </div></section>`;
  const usage = `<section class="m-card"><div class="m-head"><h2>Beliebteste Bereiche</h2></div>${mAdminRank(d.pages, M_PAGE_NAMES, "var(--m-accent)")}</section>
    <section class="m-card"><div class="m-head"><h2>Benutzte Funktionen</h2></div>${mAdminRank(d.features, M_FEATURE_NAMES, "var(--m-r3)")}</section>`;
  const users = d.users.slice().sort((a, b) => (b.last_seen || "").localeCompare(a.last_seen || ""));
  const people = `<h2 class="m-adm-section">Personen</h2><div class="m-adm-users">${users.map(mAdminUserCard).join("")}</div>`;
  const note = `<p class="m-adm-note">Nur Zahlen, keine Inhalte: keine einzelnen Trainings, Gesundheitswerte oder Coach-Nachrichten. Gezählt wird seit Version 2.4.27.</p>`;
  return head + seg + mCols3(kpis + tech, active + mAdminAiCostCard(d), usage, "adm") + people + note;
}
