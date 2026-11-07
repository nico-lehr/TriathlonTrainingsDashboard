// Trainings auf die Uhr: geplante Einheiten der nächsten 7 Tage automatisch
// in Garmin Connect (backend/garmin_push.py). Der Browser rechnet die Schritte
// (Pace-Bereiche aus den eigenen Zonen) und Übungen aus und schickt sie mit;
// der Server gleicht ab - neu, geändert, verschoben, gelöscht.
//
// Ausgelöst: beim Öffnen des Dashboards und kurz nach jeder Plan-Änderung
// (savePlannedWorkouts -> scheduleGarminPush), nur wenn verbunden und die
// Automatik an ist. Zusätzlich gleicht der Garmin-Timer morgens ab.

const GARMIN_PUSH_DAYS = 7;
const GARMIN_PUSH_DELAY_MS = 4000;
const GARMIN_EXERCISE_SPORTS = ["Kraft", "Mobility"];

let garminPush = { loaded: false, connected: false, auto: true, links: {}, last_result: null, last_run_at: null,
  mfa_pending: false, official: { available: false, connected: false }, busy: false, error: null };
const garminPushListeners = [];
let garminPushTimer = null;

function onGarminPush(fn) { garminPushListeners.push(fn); }

function setGarminPush(data) {
  garminPush = { ...garminPush, ...data, loaded: true };
  garminPushListeners.forEach(fn => { try { fn(garminPush); } catch (e) { console.error(e); } });
}

async function refreshGarminPush() {
  try {
    const res = await apiCall("garmin/workouts/status", "GET");
    setGarminPush(res.data);
  } catch (e) {
    setGarminPush({ error: e.message });
  }
  return garminPush;
}

// Übungen einer Kraft-/Mobility-Einheit so, wie Garmin sie braucht - mit
// Namen, Sätzen, Wiederholungen bzw. Sekunden und Gewicht aus der Sammlung.
function garminExercises(pw) {
  let list = Array.isArray(pw && pw.exercises) ? pw.exercises : [];
  // Mobility: dieselben (auf die geplante Dauer gebrachten) Zeiten wie im Mitmach-Modus.
  if (pw && pw.sport === "Mobility" && typeof plannedToMobilitySession === "function" && typeof MOBILITY_BY_ID !== "undefined") {
    const s = plannedToMobilitySession(pw);
    if (s) list = [...s.exercises, ...list.filter(x => x && !(x.id && MOBILITY_BY_ID[x.id]))];
  }
  return list.filter(x => x && (x.name || x.id)).map(x => {
    const mob = pw.sport === "Mobility" && typeof MOBILITY_BY_ID !== "undefined" ? MOBILITY_BY_ID[x.id] : null;
    if (mob) {
      return { id: mob.id, name: mob.name, sides: !!mob.sides, note: x.note || null,
        seconds: mob.kind === "reps" ? null : (Number(x.seconds) || mob.seconds || null),
        reps: mob.kind === "reps" ? (typeof mobilityRepsFor === "function" ? mobilityRepsFor(mob, x.seconds) : Number(mob.reps) || null) : null };
    }
    const str = pw.sport === "Kraft" && typeof STRENGTH_BY_ID !== "undefined" ? STRENGTH_BY_ID[x.id] : null;
    if (str) {
      const repsText = String(x.reps || str.reps || "");
      const kg = x.kg != null ? Number(x.kg) : (typeof strengthModeKg === "function" ? strengthModeKg(str, strengthMode()) : (str.weight && typeof strengthWeight === "function" ? strengthWeight(str.id) : null));
      return { id: str.id, name: str.name, sets: Number(x.sets) || str.sets || 1, note: x.note || null,
        reps: str.hold ? null : (parseInt(repsText, 10) || null), seconds: str.hold ? (Number(x.hold) || str.hold) : null,
        sides: /je Seite/.test(repsText), rest_s: Number(x.rest) || str.rest || 60, weight_kg: kg > 0 ? kg : null };
    }
    return { name: x.name || "Übung", sets: Number(x.sets) || 1, reps: x.reps || null, seconds: Number(x.seconds) || null, note: x.note || null };
  });
}

function garminSupported(pw) {
  if (["Laufen", "Rad", "Schwimmen"].includes(pw.sport)) return true;
  return GARMIN_EXERCISE_SPORTS.includes(pw.sport) && garminExercises(pw).length > 0;
}

function garminPushDetails(pw) {
  return GARMIN_EXERCISE_SPORTS.includes(pw.sport)
    ? { id: pw.id, exercises: garminExercises(pw) }
    : { id: pw.id, steps: resolvedWorkoutSteps(pw) };
}

// Die Einheiten, die gerade in Garmin gehören: nächste 7 Tage + von Hand gesendete.
function garminPushCandidates(today = todayStr()) {
  const end = localDateStr(new Date(new Date(today + "T00:00:00").getTime() + (GARMIN_PUSH_DAYS - 1) * 86400000));
  return plannedWorkouts.filter(p => p.date >= today && (p.status || "geplant") === "geplant" && garminSupported(p)
    && (p.date <= end || (garminPush.links[p.id] && garminPush.links[p.id].pinned)));
}

// Schritte/Übungen ALLER kommenden Einheiten (nicht nur der nächsten 7 Tage):
// Der Server merkt sie sich und legt damit später auch dann das detaillierte
// Workout an, wenn eine Einheit ins 7-Tage-Fenster rückt, während das
// Dashboard zu ist. Höchstens 120 (MAX_DETAILS in backend/garmin_push.py),
// die nächsten zuerst.
function garminPushDetailItems(today = todayStr()) {
  return plannedWorkouts.filter(p => p.date >= today && (p.status || "geplant") === "geplant" && garminSupported(p))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, 120).map(garminPushDetails);
}

async function runGarminPush() {
  if (!garminPush.connected || !garminPush.auto || garminPush.busy) return null;
  garminPush.busy = true;
  setGarminPush({});
  try {
    await storeSaved(PLANNED_WORKOUTS_KEY); // der Server liest den Plan aus der Ablage
    const res = await apiCall("garmin/workouts/sync", "POST", { items: garminPushDetailItems() }, { timeoutMs: 120000 });
    const d = res.data || {};
    setGarminPush({ busy: false, error: null, links: d.links || garminPush.links,
      last_result: d.skipped ? garminPush.last_result : d, last_run_at: d.ran_at || garminPush.last_run_at });
    return d;
  } catch (e) {
    setGarminPush({ busy: false, error: e.message });
    return null;
  }
}

function scheduleGarminPush() {
  if (!garminPush.connected || !garminPush.auto) return;
  clearTimeout(garminPushTimer);
  garminPushTimer = setTimeout(runGarminPush, GARMIN_PUSH_DELAY_MS);
}

// Stand einer Einheit für die Anzeige: { text, kind: "ok"|"wait" } oder null.
function garminWatchStatus(pw) {
  if (!pw || !garminPush.loaded || !garminPush.connected) return null;
  if (garminPush.links[pw.id]) return { text: "Auf der Uhr", kind: "ok" };
  if (garminPush.auto && garminPushCandidates().some(p => p.id === pw.id)) return { text: "Kommt auf die Uhr", kind: "wait" };
  return null;
}

// Rückkehr von Garmins Zustimmungsseite (offizielle Training API).
async function finishGarminOfficialLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.get("garmin_oauth") || !q.get("code")) return;
  history.replaceState(null, "", location.pathname);
  try {
    await apiCall("garmin/official/finish", "POST", { code: q.get("code"), state: q.get("state") });
  } catch (e) {
    setGarminPush({ error: e.message });
  }
  await refreshGarminPush();
  if (typeof openSettingsPanel === "function") openSettingsPanel("garmin");
}

async function initGarminPush() {
  await finishGarminOfficialLogin();
  await refreshGarminPush();
  scheduleGarminPush(); // beim Öffnen einmal abgleichen
}
