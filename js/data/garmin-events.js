// Events aus dem Garmin-Connect-Kalender als Ziele übernehmen.
// Der Server holt sie (backend/garmin_events.py, GET garmin/events); hier
// werden sie mit den vorhandenen Zielen zusammengeführt. Regeln:
// - Neues Event -> neues Ziel (Name, Datum, Sportart, Distanz, Zielzeit, Ort).
// - Steht am selben Tag schon ein eigenes Ziel derselben Sportart, wird es
//   nur verknüpft - keine Doppelten. Leere Felder werden ergänzt, Eingetragenes
//   bleibt.
// - Bereits verknüpfte Ziele folgen Garmin bei Datum und Name (den Namen nur,
//   solange du ihn nicht selbst geändert hast).
// - Nichts wird gelöscht. Ein Ziel, das du selbst löschst, kommt nicht wieder.
// - Hauptevent wird nur gesetzt, wenn es noch keins gibt (dein Trainingsplan
//   hängt daran) - bevorzugt Garmins "Hauptwettkampf".

const GARMIN_EVENTS_KEY = "triathlon_dashboard_garmin_events_v1"; // { at, error, dismissed: [id], last: {added, linked, updated} }
const GARMIN_EVENTS_EVERY_MS = 20 * 60 * 60 * 1000; // höchstens etwa einmal am Tag
const GARMIN_EVENT_SPORTS = ["Triathlon", "Laufen", "Rad", "Schwimmen"];

let garminEventsRunning = false;

function garminEventsState() {
  const st = storeGet(GARMIN_EVENTS_KEY) || {};
  return { at: null, error: null, dismissed: [], last: null, ...st };
}

function garminEventNotes(e) {
  const bits = [];
  if (e.location) bits.push(`Ort: ${e.location}`);
  if (e.startTime) bits.push(`Start ${e.startTime} Uhr`);
  return bits.length ? `${bits.join(" · ")} (aus Garmin Connect)` : "Aus Garmin Connect übernommen.";
}

const garminNameKey = s => String(s || "").toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim();

// Reine Zusammenführung (testbar): -> { goals, added, linked, updated }
// list: vorhandene Ziele, events: vom Server, o: { todayKey, dismissed, newId }
function mergeGarminEvents(list, events, o) {
  const out = (list || []).map(g => ({ ...g }));
  const dismissed = new Set(o.dismissed || []);
  const added = [], linked = [], updated = [];
  const fallbackSport = (out.find(g => g.isPrimary) || {}).sport || "Triathlon";
  (events || []).forEach(e => {
    if (!e || !e.garminId || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") || e.date < o.todayKey || dismissed.has(e.garminId)) return;
    const sport = GARMIN_EVENT_SPORTS.includes(e.sport) ? e.sport : fallbackSport;
    let goal = out.find(g => g.garminEventId === e.garminId);
    if (goal) {
      const before = JSON.stringify(goal);
      if (goal.date !== e.date) goal.date = e.date;
      if (!goal.garminName || goal.name === goal.garminName) goal.name = e.name;
      goal.garminName = e.name;
      if (goal.distanceKm == null && e.distanceKm != null) goal.distanceKm = e.distanceKm;
      if (!goal.targetTime && e.targetTime) goal.targetTime = e.targetTime;
      if (JSON.stringify(goal) !== before) updated.push(goal.name);
      return;
    }
    // Eigenes Ziel am selben Tag? Dann verknüpfen statt doppelt anlegen.
    goal = out.find(g => !g.garminEventId && g.date === e.date && (g.sport === sport || garminNameKey(g.name) === garminNameKey(e.name)));
    if (goal) {
      goal.garminEventId = e.garminId;
      goal.garminName = e.name;
      if (goal.distanceKm == null && e.distanceKm != null) goal.distanceKm = e.distanceKm;
      if (!goal.targetTime && e.targetTime) goal.targetTime = e.targetTime;
      linked.push(goal.name);
      return;
    }
    const goalNew = {
      id: o.newId(), name: e.name, sport, date: e.date,
      targetTime: e.targetTime || null, distanceKm: e.distanceKm != null ? e.distanceKm : null,
      subDisciplines: null, notes: garminEventNotes(e), isPrimary: false,
      recommendation: null, recommendationAt: null,
      priority: e.primary ? "A" : null, strategyNote: null, courseElevationM: null, courseProfileSource: null, courseProfileLabel: null, racePlan: null,
      source: "garmin", garminEventId: e.garminId, garminName: e.name, garminPrimary: !!e.primary,
    };
    out.push(goalNew);
    added.push(goalNew.name);
  });
  // Hauptevent nur, wenn es noch keins gibt: Garmins Hauptwettkampf, sonst das nächste neue Event.
  if (added.length && !out.some(g => g.isPrimary)) {
    const fresh = out.filter(g => g.source === "garmin" && added.includes(g.name)).sort((a, b) => a.date.localeCompare(b.date));
    const pick = fresh.find(g => g.garminPrimary) || fresh[0];
    if (pick) pick.isPrimary = true;
  }
  return { goals: out, added, linked, updated };
}

// Holt die Events und übernimmt sie. force: sofort (Knopf, nach Garmin-Abruf),
// sonst höchstens einmal am Tag. Ergebnis: { added, linked, updated } oder null.
async function syncGarminEvents({ force = false } = {}) {
  if (garminEventsRunning) return null;
  const st = garminEventsState();
  if (!force && st.at && Date.now() - new Date(st.at).getTime() < GARMIN_EVENTS_EVERY_MS) return null;
  garminEventsRunning = true;
  try {
    let data;
    try {
      data = (await apiCall("garmin/events" + (force ? "?force=1" : ""))).data;
    } catch (e) {
      storeSet(GARMIN_EVENTS_KEY, { ...st, at: new Date().toISOString(), error: e.message || String(e) });
      if (typeof renderGarminEventsStatus === "function") renderGarminEventsStatus();
      return null;
    }
    const res = mergeGarminEvents(goals, data.events, {
      todayKey: todayStr(), dismissed: st.dismissed,
      newId: () => ((window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("g" + Date.now() + Math.random().toString(16).slice(2))),
    });
    const changed = res.added.length || res.linked.length || res.updated.length;
    if (changed) {
      goals = res.goals;
      saveGoals();
      if (typeof renderGoals === "function") renderGoals();
      if (typeof renderTrainingPlanCard === "function") renderTrainingPlanCard();
      if (typeof mScheduleRender === "function") mScheduleRender();
    }
    const last = { added: res.added, linked: res.linked, updated: res.updated, count: (data.events || []).length };
    // Hinweis auf "Heute" nur, wenn wirklich etwas Neues dazugekommen ist
    const noticeSeen = res.added.length || res.linked.length ? false : st.noticeSeen;
    storeSet(GARMIN_EVENTS_KEY, { ...st, at: new Date().toISOString(), error: null, last: res.added.length || res.linked.length ? last : (st.last && !st.noticeSeen ? st.last : last), noticeSeen });
    renderGarminEventsStatus();
    return last;
  } finally {
    garminEventsRunning = false;
  }
}

// Ein aus Garmin übernommenes Ziel wurde gelöscht: nicht wieder anlegen.
function dismissGarminEvent(garminId) {
  if (!garminId) return;
  const st = garminEventsState();
  storeSet(GARMIN_EVENTS_KEY, { ...st, dismissed: [...new Set([...(st.dismissed || []), String(garminId)])].slice(-100) });
}

function dismissGarminEventsNotice() {
  storeSet(GARMIN_EVENTS_KEY, { ...garminEventsState(), noticeSeen: true });
}

// Statuszeile + Knopf in den Garmin-Einstellungen
function garminEventsStatusText() {
  const st = garminEventsState();
  if (!st.at) return ["Noch nicht abgeglichen.", ""];
  const when = new Date(st.at);
  const at = `${fmtDate(when)}, ${when.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
  if (st.error) return [`Zuletzt versucht ${at}: ${st.error}`, "warn"];
  const n = st.last ? st.last.count : 0;
  const linkedCount = goals.filter(g => g.garminEventId).length;
  return [`Abgeglichen ${at} · ${n === 1 ? "1 Event" : `${n} Events`} bei Garmin, ${linkedCount} davon als Ziel im Dashboard.`, "ok"];
}

function renderGarminEventsStatus() {
  const el = document.getElementById("garmin-events-status");
  if (!el) return;
  const [text, kind] = garminEventsStatusText();
  el.textContent = text;
  el.classList.remove("ok", "warn", "err");
  if (kind) el.classList.add(kind);
}

function initGarminEvents() {
  const btn = document.getElementById("garmin-events-btn");
  renderGarminEventsStatus();
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const el = document.getElementById("garmin-events-status");
    if (el) el.textContent = "Hole Events von Garmin …";
    try { await syncGarminEvents({ force: true }); } finally {
      btn.disabled = false;
      renderGarminEventsStatus();
    }
  });
}
