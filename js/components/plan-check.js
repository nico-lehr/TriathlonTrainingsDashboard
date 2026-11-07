// Täglicher Plan-Check ("Sicherheitsnetz"): hält den Trainingsplan passend zur
// aktuellen Verfassung. Die Bausteine selbst (rein rechnerisch, getestet)
// stehen in js/analytics/plan-guard.js - hier nur der Ablauf.
//
// Gestaffelt, damit nichts unnötig oft läuft:
//   heute + morgen   täglich und sofort, wenn sich etwas ändert (Erholungs-Check,
//                    neue Garmin-Nacht, Einheit erledigt)
//   Tag 3-7          alle 3 Tage - und sofort nach einer verpassten oder
//                    übersprungenen Einheit oder einer gemeldeten Verletzung
//   Tag 8-28         einmal pro Woche (nur Regelverstöße, keine Lücken füllen:
//                    so weit plant das rollierende Fenster noch nicht)
//
// Ablauf je Lauf: 1) Verfassung heute/morgen (leichter, kürzer, Ruhetag)
// 2) Regelwerk im Zeitraum 3) leere Trainingstage füllen 4) speichern (Garmin
// bekommt die Änderung automatisch, savePlannedWorkouts) 5) bei Bedarf EINE
// kleine KI-Prüfung für heute/morgen. Jede Änderung lässt sich rückgängig
// machen; danach füllt/ändert der Check diesen Tag bzw. diese Einheit nicht erneut.
//
// Die KI darf nur innerhalb der Regeln ändern: leichter, kürzer oder Ruhetag -
// nie härter oder länger (planGuardAcceptAi). Sie wird nur gefragt, wenn heute
// oder morgen eine fordernde Einheit ansteht, höchstens einmal je Datenstand.

const PLAN_CHECK_KEY = "triathlon_dashboard_plan_check_v1";
const PLAN_CHECK_MID_EVERY = 3;
const PLAN_CHECK_FAR_EVERY = 7;
const PLAN_CHECK_MID_DAYS = 7;    // heute + 6
const PLAN_CHECK_FAR_DAYS = 28;
const PLAN_CHECK_LOG_MAX = 10;
const PLAN_CHECK_FILL_TODAY_UNTIL = 14; // heute nach 14 Uhr keine neue Einheit mehr einschieben
const PLAN_CHECK_AI_MIN_DURATION = 60;  // ab hier (oder mittel/hart) lohnt sich die KI-Prüfung
const PLAN_CHECK_AI_MAX_PER_DAY = 3;    // Kostenbremse: neue Daten am selben Tag höchstens 3x

let planCheckState = null;
let planCheckRunning = false;
let planCheckTimer = null;
let planCheckReady = false; // erst nach dem Laden aller Daten (initPlanCheck)

function planCheckLoad() {
  if (planCheckState) return planCheckState;
  const raw = typeof storeGet === "function" ? storeGet(PLAN_CHECK_KEY) : null;
  planCheckState = { near: null, mid: null, far: null, sig: null, midSig: null, aiSig: null, freeDays: {}, skip: {}, log: [], ...(raw || {}) };
  // Alte Einträge aufräumen (nur was noch kommen kann, zählt)
  const cut = planShiftDay(todayStr(), -7);
  ["freeDays", "skip"].forEach(k => Object.keys(planCheckState[k] || {}).forEach(d => { if (d < cut) delete planCheckState[k][d]; }));
  return planCheckState;
}

function planCheckSave() {
  if (planCheckState && typeof storeSet === "function") storeSet(PLAN_CHECK_KEY, planCheckState);
}

// Ein Tag soll frei bleiben (Einheit gelöscht, Plan-Check rückgängig gemacht,
// Coach-Nachricht hat ihn leer gelassen) - der Check füllt ihn dann nicht.
function planCheckMarkFree(date, reason = "user") {
  if (!date) return;
  const st = planCheckLoad();
  st.freeDays[date] = reason;
  planCheckSave();
}

function planCheckFreeDays() { return planCheckLoad().freeDays; }

const planCheckDays = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

// Gemeinsame Optionen für planGuardFill - auch für generateTrainingPlan().
function planCheckFillOptions(goal, from, to) {
  return {
    from, to, todayKey: todayStr(), today: new Date(), profile: athleteProfile || {}, freeDays: planCheckFreeDays(), goal,
    defaults: { goalId: goal ? goal.id : null }, validate: list => planRuleViolations(list),
  };
}

// Leere Trainingstage in [from, to] füllen (heute nur am Vormittag).
function planCheckFill(list, goal, from, to) {
  const todayKey = todayStr();
  let start = from < todayKey ? todayKey : from;
  if (start === todayKey && new Date().getHours() >= PLAN_CHECK_FILL_TODAY_UNTIL) start = planShiftDay(todayKey, 1);
  if (!goal || start > to) return { list, added: [], skipped: [] };
  if (goal.date && goal.date < start) return { list, added: [], skipped: [] };
  return planGuardFill(list, DATA, planCheckFillOptions(goal, start, to));
}

// Wie geht es dir heute? Erholungs-Check, Belastung, Garmin-Nacht.
function planCheckSignals(todayKey) {
  const acwr = typeof planCurrentAcwr === "function" ? planCurrentAcwr() : null;
  const gate = planRecoveryGate(acwr, typeof recoveryCheck !== "undefined" ? recoveryCheck : null, todayKey);
  const wellness = typeof planWellnessInput === "function" ? planWellnessInput() : null;
  const signs = planWellnessSigns(wellness, todayKey);
  const strain = [];
  const risk = typeof computeCurrentRiskStatus === "function" ? computeCurrentRiskStatus() : null;
  if (risk && risk.critical.some(c => c.key === "tsb")) strain.push("deine Form (TSB) ist gerade sehr tief – du bist stark ermüdet");
  return { gate, signs, strain, wellness };
}

// Was sich seit dem letzten Lauf geändert haben kann: Erholungs-Check,
// neueste Garmin-Nacht, heute erledigte Einheiten, Plan für heute/morgen.
function planCheckSignature(todayKey) {
  const rc = typeof recoveryCheck !== "undefined" && recoveryCheck && recoveryCheck.date === todayKey ? recoveryCheck : {};
  const night = typeof latestWellness === "function" ? (latestWellness("sleep_min", 3) || latestWellness("hrv_ms", 3)) : null;
  const doneToday = (DATA || []).filter(w => w._date && localDateStr(w._date) === todayKey).length;
  const tomorrow = planShiftDay(todayKey, 1);
  const near = (plannedWorkouts || []).filter(p => p.date === todayKey || p.date === tomorrow)
    .map(p => `${p.id}:${p.intensity}:${p.duration_min}:${p.status}`).sort().join(",");
  return [todayKey, rc.soreness, rc.energy, rc.injury, night && night.date, doneToday, near].join("|");
}

// Verpasste/übersprungene Einheiten der letzten 3 Tage - ändert sich das,
// werden die Tage 3-7 sofort neu geprüft.
function planCheckMissed(todayKey) {
  const from = planShiftDay(todayKey, -3);
  const doneDays = new Set((DATA || []).filter(w => w._date).map(w => localDateStr(w._date)));
  return (plannedWorkouts || []).filter(p => p.date >= from && p.date < todayKey && p.sport !== "Mobility"
    && (p.status === "uebersprungen" || (p.status === "geplant" && !doneDays.has(p.date))));
}

function planCheckDue(st, todayKey, sig, signals, force) {
  const missedSig = planCheckMissed(todayKey).map(p => p.id).sort().join(",") + (signals.gate.injury ? "|injury" : "");
  return {
    near: force || st.near !== todayKey || st.sig !== sig,
    mid: force || !st.mid || planCheckDays(st.mid, todayKey) >= PLAN_CHECK_MID_EVERY || st.midSig !== missedSig,
    far: force || !st.far || planCheckDays(st.far, todayKey) >= PLAN_CHECK_FAR_EVERY,
    missedSig,
  };
}

// Kurzer Text je Änderung für die Karte "Plan-Check".
function planCheckItemText(d, reasonById) {
  const dt = new Date(d.date + "T12:00:00");
  const day = d.date === todayStr() ? "Heute" : d.date === planShiftDay(todayStr(), 1) ? "Morgen"
    : `${dt.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "")} ${dt.getDate()}.`;
  const p = d.after || d.before;
  const name = p.title || p.sport;
  const reason = reasonById[d.id];
  if (d.kind === "added") return { day, kind: "added", text: `${name} · ${p.duration_min} min`, why: reason || "" };
  if (d.kind === "removed") return { day, kind: "removed", text: `${name} gestrichen – Ruhetag`, why: reason || "" };
  const b = d.before, a = d.after;
  const bits = [];
  const renamed = b.title !== a.title;
  if (renamed) bits.push(`statt „${b.title || b.sport}“`);
  else if (b.sport !== a.sport) bits.push(`${a.sport} statt ${b.sport}`);
  if (b.intensity !== a.intensity && !renamed) bits.push(`${a.intensity || "offen"} statt ${b.intensity || "offen"}`);
  if (b.duration_min !== a.duration_min) bits.push(`${a.duration_min} statt ${b.duration_min} min`);
  if (b.date !== a.date) bits.push(`verschoben vom ${new Date(b.date + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "numeric" })}`);
  const text = renamed ? `${name} ${bits.join(" · ")}` : `${name}: ${bits.join(", ") || "angepasst"}`;
  return { day, kind: "changed", text, why: reason || "" };
}

// Änderungen speichern und als Eintrag (mit Rückgängig) merken.
// mergeInto: Eintrag desselben Laufs (Regelwerk + KI = eine Karte, ein Rückgängig).
function planCheckCommit(before, after, { tier, reasons = {}, note = null, fixed = [], mergeInto = null }) {
  const diff = planGuardDiff(before, after);
  if (!diff.length) return null;
  replacePlannedWorkouts(after);
  const st = planCheckLoad();
  const target = mergeInto && (st.log || []).find(e => e.id === mergeInto.id && !e.undone);
  if (target) {
    // Für Rückgängig zählt der Stand VOR dem ersten Eingriff
    const known = new Set([...target.restore.map(p => p.id), ...target.addedIds]);
    target.items.push(...diff.map(d => planCheckItemText(d, reasons)));
    target.restore.push(...diff.filter(d => d.before && !known.has(d.id)).map(d => d.before));
    target.addedIds.push(...diff.filter(d => d.kind === "added").map(d => d.id));
    target.addedDates.push(...diff.filter(d => d.kind === "added").map(d => d.date));
    target.changedIds.push(...diff.filter(d => d.kind !== "added").map(d => d.id));
    target.note = note || target.note;
    target.tier = `${target.tier}+${tier}`;
    target.seen = false;
    planCheckSave();
    return target;
  }
  const entry = {
    id: "pc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(), tier, note, fixed,
    items: diff.map(d => planCheckItemText(d, reasons)),
    restore: diff.filter(d => d.before).map(d => d.before),
    addedIds: diff.filter(d => d.kind === "added").map(d => d.id),
    changedIds: diff.filter(d => d.kind !== "added").map(d => d.id),
    addedDates: diff.filter(d => d.kind === "added").map(d => d.date),
    seen: false, undone: false,
  };
  st.log = [entry, ...(st.log || [])].slice(0, PLAN_CHECK_LOG_MAX);
  planCheckSave();
  return entry;
}

// Rückgängig: alter Stand der geänderten Einheiten zurück, neu eingeplante
// raus. Danach fasst der Check diese Einheiten/Tage heute nicht erneut an.
function undoPlanCheck(entryId) {
  const st = planCheckLoad();
  const entry = (st.log || []).find(e => e.id === entryId);
  if (!entry || entry.undone) return false;
  const restoreIds = new Set(entry.restore.map(p => p.id));
  const added = new Set(entry.addedIds);
  const kept = plannedWorkouts.filter(p => !added.has(p.id) && !restoreIds.has(p.id));
  replacePlannedWorkouts([...kept, ...entry.restore.map(p => ({ ...p }))]);
  const todayKey = todayStr();
  st.skip[todayKey] = [...new Set([...(st.skip[todayKey] || []), ...entry.changedIds])];
  entry.addedDates.forEach(d => { st.freeDays[d] = "undo"; });
  entry.undone = true;
  entry.seen = true;
  planCheckSave();
  planCheckRerender();
  return true;
}

function dismissPlanCheck(entryId) {
  const entry = (planCheckLoad().log || []).find(e => e.id === entryId);
  if (!entry) return;
  entry.seen = true;
  planCheckSave();
  planCheckRerender();
}

// Ungesehene Änderungen von heute, neueste zuerst (Karten auf "Heute").
function currentPlanCheckEntries() {
  const todayKey = todayStr();
  return (planCheckLoad().log || []).filter(e => !e.seen && localDateStr(new Date(e.at)) === todayKey);
}
function currentPlanCheckEntry() { return currentPlanCheckEntries()[0] || null; }

function planCheckStatus() {
  const st = planCheckLoad();
  return { near: st.near, at: st.lastRunAt || null, lastAi: st.aiNote || null, running: planCheckRunning };
}

function planCheckRerender() {
  if (typeof renderTrainingPlanCard === "function") renderTrainingPlanCard();
  if (typeof renderCalendar === "function") renderCalendar();
  if (typeof mScheduleRender === "function") mScheduleRender();
}

// Hauptlauf. force: alles prüfen (z. B. Button). Läuft nie doppelt.
async function runPlanCheck({ force = false } = {}) {
  if (planCheckRunning || typeof plannedWorkouts === "undefined") return null;
  const goal = typeof getPrimaryGoal === "function" ? getPrimaryGoal() : null;
  if (!goal) return null;
  planCheckRunning = true;
  try {
    const st = planCheckLoad();
    const todayKey = todayStr();
    const tomorrow = planShiftDay(todayKey, 1);
    const signals = planCheckSignals(todayKey);
    const sig = planCheckSignature(todayKey);
    const due = planCheckDue(st, todayKey, sig, signals, force);
    if (!due.near && !due.mid && !due.far) return null;

    const before = plannedWorkouts;
    let list = before.slice();
    const reasons = {};
    const fixed = [];
    const fix = (l, s) => applyPlanSuggestion(l, s, { goalId: goal.id, source: "guard" });
    const validate = l => planRuleViolations(l);

    if (due.near) {
      // Was heute schon trainiert wurde (gleiche Sportart), nicht mehr anfassen
      const doneSports = new Set((DATA || []).filter(w => w._date && localDateStr(w._date) === todayKey).map(w => typeof sportGroup === "function" ? sportGroup(w.sport) : w.sport));
      const doneIds = list.filter(p => p.date === todayKey && doneSports.has(p.sport)).map(p => p.id);
      const r = planGuardReadiness(list, { todayKey, gate: signals.gate, signs: signals.signs, strain: signals.strain, skipIds: [...(st.skip[todayKey] || []), ...doneIds] });
      r.changes.forEach(c => { reasons[c.id] = c.reason; });
      list = r.list;
      const f = planGuardAutofix(list, { from: todayKey, to: tomorrow, validate, fix });
      list = f.list; fixed.push(...f.fixed);
      list = planCheckFill(list, goal, todayKey, tomorrow).list;
    }
    if (due.mid) {
      const from = planShiftDay(todayKey, 2), to = planShiftDay(todayKey, PLAN_CHECK_MID_DAYS - 1);
      const f = planGuardAutofix(list, { from, to, validate, fix });
      list = f.list; fixed.push(...f.fixed);
      const filled = planCheckFill(list, goal, from, to);
      list = filled.list;
      st.lastSkipped = filled.skipped;
    }
    if (due.far) {
      const f = planGuardAutofix(list, { from: planShiftDay(todayKey, PLAN_CHECK_MID_DAYS), to: planShiftDay(todayKey, PLAN_CHECK_FAR_DAYS - 1), validate, fix });
      list = f.list; fixed.push(...f.fixed);
    }

    const tier = due.near ? "near" : due.mid ? "mid" : "far";
    const entry = planCheckCommit(before, list, { tier, reasons, fixed });
    if (due.near) { st.near = todayKey; st.sig = planCheckSignature(todayKey); }
    if (due.mid) { st.mid = todayKey; st.midSig = due.missedSig; }
    if (due.far) st.far = todayKey;
    st.lastRunAt = new Date().toISOString();
    planCheckSave();
    if (entry) planCheckRerender();

    if (due.near) await planCheckAi(goal, signals, entry);
    return planCheckLoad().log[0] || null;
  } catch (e) {
    console.warn("Plan-Check fehlgeschlagen:", e);
    return null;
  } finally {
    planCheckRunning = false;
  }
}

// Kurz verzögert starten (mehrere Änderungen hintereinander = ein Lauf).
function schedulePlanCheck(delayMs = 1500) {
  if (!planCheckReady) return;
  clearTimeout(planCheckTimer);
  planCheckTimer = setTimeout(() => runPlanCheck(), delayMs);
}

// Beim Start und danach stündlich (fängt den Tageswechsel und neue
// Garmin-Daten ab, ohne dass die Seite neu geladen werden muss).
function initPlanCheck() {
  planCheckReady = true;
  schedulePlanCheck(2500);
  setInterval(() => runPlanCheck(), 60 * 60 * 1000);
}

/* ---------- KI-Tages-Check (sparsam) ---------- */

// Nur fordernde Einheiten von heute/morgen sind es wert, die KI zu fragen -
// lockere kurze Einheiten passen praktisch immer.
function planCheckAiCandidates(todayKey) {
  const tomorrow = planShiftDay(todayKey, 1);
  const doneToday = (DATA || []).some(w => w._date && localDateStr(w._date) === todayKey);
  return (plannedWorkouts || []).filter(p => p.status === "geplant" && p.sport !== "Mobility"
    && (p.date === tomorrow || (p.date === todayKey && !doneToday))
    && ((p.intensity && p.intensity !== "leicht") || (Number(p.duration_min) || 0) >= PLAN_CHECK_AI_MIN_DURATION));
}

const PLAN_CHECK_AI_SCHEMA = {
  type: "object",
  properties: {
    pruefung: { type: "string" },
    einheiten: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          entscheidung: { type: "string", enum: ["behalten", "anpassen", "ruhetag"] },
          sport: { type: "string", enum: ["Schwimmen", "Rad", "Laufen", "Kraft"] },
          title: { type: "string" },
          duration_min: { type: "integer" },
          intensity: { type: "string", enum: ["leicht", "mittel", "hart"] },
          description: { type: "string" },
          grund: { type: "string" },
        },
        required: ["id", "entscheidung", "grund"],
        additionalProperties: false,
      },
    },
  },
  required: ["pruefung", "einheiten"],
  additionalProperties: false,
};

async function planCheckAi(goal, signals, guardEntry) {
  if (typeof callAiText !== "function") return;
  const st = planCheckLoad();
  const todayKey = todayStr();
  const cands = planCheckAiCandidates(todayKey).filter(p => !(st.skip[todayKey] || []).includes(p.id));
  if (!cands.length) return;
  const aiSig = planCheckSignature(todayKey);
  if (st.aiSig === aiSig) return; // derselbe Datenstand wurde schon geprüft
  const count = st.aiCount && st.aiCount.date === todayKey ? st.aiCount.n : 0;
  if (count >= PLAN_CHECK_AI_MAX_PER_DAY) return;
  st.aiCount = { date: todayKey, n: count + 1 };
  st.aiSig = aiSig;
  planCheckSave();

  const prompt = buildDailyCheckPrompt(goal, cands, signals, guardEntry);
  let data;
  try {
    const raw = await callAiText(prompt, { task: "dailycheck", json: true, schema: PLAN_CHECK_AI_SCHEMA });
    const m = String(raw).match(/\{[\s\S]*\}/);
    data = JSON.parse(m ? m[0] : raw);
  } catch (e) {
    st.aiNote = null;
    planCheckSave();
    return; // KI nicht erreichbar: die festen Regeln haben schon gegriffen
  }
  const clean = t => (typeof keepPromptNumbers === "function" ? keepPromptNumbers(String(t || ""), prompt) : String(t || "")).slice(0, 400);
  const before = plannedWorkouts;
  let list = before.slice();
  const reasons = {};
  const ids = new Set(cands.map(p => p.id));
  (Array.isArray(data.einheiten) ? data.einheiten : []).forEach(e => {
    if (!e || !ids.has(e.id) || e.entscheidung === "behalten") return;
    const cur = list.find(p => p.id === e.id);
    if (!cur) return;
    let next;
    if (e.entscheidung === "ruhetag") next = list.filter(p => p.id !== e.id);
    else {
      const ok = planGuardAcceptAi(cur, e);
      if (!ok) return;
      const desc = clean(e.description);
      const changed = { ...cur, ...ok, title: e.title ? String(e.title).slice(0, 80) : cur.title, steps: null,
        description: desc ? `Plan-Check (KI): ${desc}` : cur.description };
      next = list.map(p => (p.id === e.id ? changed : p));
    }
    // Die KI darf keinen neuen Regelverstoß erzeugen
    const fresh = newPlanViolations(planRuleViolations(list), planRuleViolations(next)).filter(v => v.severity === "block");
    if (fresh.length) return;
    list = next;
    reasons[e.id] = clean(e.grund);
  });
  st.aiNote = { date: todayKey, text: clean(data.pruefung) };
  planCheckSave();
  const entry = planCheckCommit(before, list, { tier: "ki", reasons, note: st.aiNote.text, mergeInto: guardEntry });
  // Eigene Änderung gilt als geprüft - sonst fragte der nächste Lauf erneut
  st.sig = st.aiSig = planCheckSignature(todayKey);
  planCheckSave();
  if (!entry && st.aiNote.text) {
    // Nichts geändert: die Einschätzung trotzdem zeigen, wenn es heute schon
    // eine Plan-Check-Karte gibt - sonst nur im Coach-Bereich.
    const today = currentPlanCheckEntry();
    if (today) { today.note = today.note || st.aiNote.text; planCheckSave(); }
  }
  planCheckRerender();
}
