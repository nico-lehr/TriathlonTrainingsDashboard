// Geplante Trainingseinheiten (KI-generierter oder manuell angelegter
// Trainingsplan) - eigener Datentyp, getrennt von den echten, aus .fit-Dateien
// importierten Workouts (ALL/DATA, siehe workouts.js). Ein geplantes Workout
// hat KEINE Streckendaten/Ist-Werte, nur eine Absicht (Sportart, Dauer,
// Intensität, Beschreibung) - siehe docs/DATA_MODEL.md.

const PLANNED_WORKOUTS_KEY = "triathlon_dashboard_planned_workouts_v1";

let plannedWorkouts = [];

// Gespeichert in der Ablage pro Person auf dem Server (js/data/api-client.js).
function loadPlannedWorkouts() {
  plannedWorkouts = storeGet(PLANNED_WORKOUTS_KEY) || [];
  if (!Array.isArray(plannedWorkouts)) plannedWorkouts = [];
}

function savePlannedWorkouts() {
  storeSet(PLANNED_WORKOUTS_KEY, plannedWorkouts);
  scheduleIcalSync();
}

// Kalender-Abo (iCal) - der Server bekommt eine Kopie der geplanten Einheiten
// zum Erzeugen des .ics-Feeds (siehe backend/routes.py: /api/v1/ical-sync,
// CHANGE_REQUESTS.md). Rein "best effort": schlägt es fehl, zeigt das Abo
// einfach den letzten erfolgreichen Stand. Debounced statt bei jedem
// einzelnen savePlannedWorkouts()-Aufruf sofort zu senden, da z.B. eine
// mehrtägige KI-Trainingsplan-Erstellung mehrfach hintereinander speichert.
let icalSyncTimer = null;

function scheduleIcalSync() {
  clearTimeout(icalSyncTimer);
  icalSyncTimer = setTimeout(() => {
    apiCall("ical-sync", "POST", { workouts: plannedWorkouts }).catch(() => { /* letzter Stand bleibt */ });
  }, 1200);
}

function newPlannedWorkoutId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("pw" + Date.now() + Math.random().toString(16).slice(2));
}

// Neuer, noch nicht gespeicherter Eintrag - gemeinsame Form für ALLE Wege,
// auf denen Einheiten entstehen: addPlannedWorkout() (manuell),
// applyPlanSuggestion() (add_easy_session), addOpenWishesToPlan() (Wünsche)
// und die KI-Planung (generateTrainingPlan).
// entry: { date, sport, title, duration_min, intensity, description, exercises, steps, goalId, phase, source }
// `phase` ergibt sich ohne Angabe aus Datum + Ziel (getPhase,
// js/analytics/periodization.js) - die Phase am Tag der Einheit, nicht die von heute.
function buildPlannedWorkout(entry) {
  return {
    id: newPlannedWorkoutId(),
    date: entry.date,
    sport: entry.sport,
    title: entry.title || entry.sport,
    duration_min: entry.duration_min != null ? Number(entry.duration_min) : null,
    intensity: entry.intensity || null, // "leicht" | "mittel" | "hart"
    description: entry.description || null,
    exercises: Array.isArray(entry.exercises) && entry.exercises.length ? entry.exercises : null, // nur Kraft/Mobility: [{name, sets, reps, note}]
    steps: entry.steps ? validateWorkoutSteps(entry.steps).steps : null, // optional, siehe validateWorkoutSteps unten
    status: "geplant", // "geplant" | "erledigt" | "uebersprungen"
    goalId: entry.goalId || null,
    phase: entry.phase || plannedWorkoutPhase(entry),
    source: entry.source || "manual", // "ai" | "manual"
    createdAt: new Date().toISOString(),
  };
}

// Trainingsphase einer Einheit an ihrem Datum für ihr Ziel (getPhase,
// js/analytics/periodization.js) - ohne Ziel null.
function plannedWorkoutPhase(entry) {
  const goal = entry.goalId ? goals.find(g => g.id === entry.goalId) : null;
  return getPhase(entry.date, goal);
}

// Einheit mit Änderungen; bei neuem Datum auch neue Phase (außer der
// Aufrufer setzt sie selbst).
function withPlannedPatch(pw, patch) {
  const next = { ...pw, ...patch };
  if (patch.date && patch.date !== pw.date && !("phase" in patch)) next.phase = plannedWorkoutPhase(next);
  return next;
}

function addPlannedWorkout(entry) {
  const pw = buildPlannedWorkout(entry);
  plannedWorkouts.push(pw);
  savePlannedWorkouts();
  return pw;
}

function updatePlannedWorkout(id, patch) {
  const pw = plannedWorkouts.find(p => p.id === id);
  if (!pw) return null;
  Object.assign(pw, withPlannedPatch(pw, patch));
  savePlannedWorkouts();
  return pw;
}

function deletePlannedWorkout(id) {
  plannedWorkouts = plannedWorkouts.filter(p => p.id !== id);
  savePlannedWorkouts();
}

function plannedWorkoutsOfDay(dayDate) {
  const key = localDateStr(dayDate);
  return plannedWorkouts.filter(p => p.date === key);
}

function plannedWorkoutsForGoal(goalId) {
  return plannedWorkouts.filter(p => p.goalId === goalId);
}

// Entfernt alle noch bevorstehenden (>= heute) geplanten Einheiten eines
// Ziels - Grundlage für "Plan neu erstellen" (ersetzt statt ergänzt, siehe
// generateTrainingPlan in js/ai/ollama.js). Bereits vergangene/erledigte
// Einheiten bleiben als Trainingshistorie erhalten.
function deleteFuturePlannedWorkoutsForGoal(goalId) {
  const todayKey = todayStr();
  plannedWorkouts = plannedWorkouts.filter(p => !(p.goalId === goalId && p.date >= todayKey));
  savePlannedWorkouts();
}

// Entfernt bevorstehende geplante Einheiten ALLER ANDEREN Ziele - wird beim
// Erstellen eines Plans für das aktuelle Hauptevent aufgerufen, damit nicht
// gleichzeitig der (jetzt veraltete) Plan eines früheren Hauptevents im
// Kalender steht und sich mit dem neuen Plan widerspricht (mehrere,
// gegensätzliche Trainings am selben Tag).
function deleteFuturePlannedWorkoutsForOtherGoals(goalId) {
  const todayKey = todayStr();
  const before = plannedWorkouts.length;
  plannedWorkouts = plannedWorkouts.filter(p => !(p.goalId && p.goalId !== goalId && p.date >= todayKey));
  if (plannedWorkouts.length !== before) savePlannedWorkouts();
}

// Bereits verplante zukünftige Tage (ab heute) für ein Ziel - Grundlage für
// das rollierende Nachplanen (siehe computePlanningWindow/shouldAutoReplan
// in js/analytics/training-plan.js).
function futurePlannedDatesForGoal(goalId) {
  const todayKey = todayStr();
  return [...new Set(plannedWorkouts.filter(p => p.goalId === goalId && p.date >= todayKey).map(p => p.date))].sort();
}

/* ---------- Änderungen mit Regelprüfung (js/analytics/plan-rules.js) ---------- */

// Prüft eine (geänderte) Liste mit validatePlan() gegen den aktuellen Stand
// des Athleten: echte Workouts (DATA), Garmin-Werte, heutiger
// Erholungs-Check, Hauptevent. Den ACWR holt validatePlan() selbst
// (computePerformanceState). options: weitere validatePlan-Optionen, z. B. planUntil.
function planRuleViolations(list, options = {}) {
  const wellness = { hrv_ms: wellnessDeviation("hrv_ms"), resting_hr: wellnessDeviation("resting_hr") };
  return validatePlan(list, DATA, wellness, recoveryCheck, { goal: getPrimaryGoal(), ...options });
}

// Kopie der Liste mit geänderter Einheit - die Vorschau, die erst geprüft
// und dann mit replacePlannedWorkouts() übernommen wird.
function patchedPlannedWorkouts(list, id, patch) {
  return list.map(p => (p.id === id ? withPlannedPatch(p, patch) : p));
}

// Wendet einen Vorschlag des Regelwerks (suggestion aus validatePlan()) auf
// eine KOPIE von `list` an - gespeichert wird erst mit replacePlannedWorkouts().
// `defaults` ergänzt eine neu eingeplante Einheit (add_easy_session), z. B.
// { goalId, phase, source }. null = der Vorschlag passt nicht zur Liste.
function applyPlanSuggestion(list, suggestion, defaults = {}) {
  const s = suggestion || {};
  const copy = list.map(p => ({ ...p }));
  const find = id => copy.find(p => p.id === id);
  const target = s.workoutId != null ? find(s.workoutId) : null;
  switch (s.action) {
    case "move":
      if (!target || !s.toDate) return null;
      Object.assign(target, withPlannedPatch(target, { date: s.toDate }));
      return copy;
    case "set_intensity":
      if (!target || !s.intensity) return null;
      // Die Beschreibung (z. B. "6x400m zügig") passt danach nicht mehr zur
      // Intensität - deshalb ein sichtbarer Hinweis davor statt still ändern.
      if (target.intensity !== s.intensity) target.description = [`Vom Regelwerk auf „${s.intensity}“ gesetzt.`, target.description].filter(Boolean).join(" ");
      target.intensity = s.intensity;
      if (s.duration_min) target.duration_min = s.duration_min;
      return copy;
    case "reduce_duration":
      if (!target || !s.duration_min) return null;
      target.duration_min = s.duration_min;
      return copy;
    case "reduce_week_volume":
      if (!Array.isArray(s.workouts) || !s.workouts.length || !s.workouts.every(w => find(w.workoutId))) return null;
      s.workouts.forEach(w => { find(w.workoutId).duration_min = w.duration_min; });
      return copy;
    case "make_rest_day": {
      const ids = s.workoutIds || [];
      if (!ids.some(id => find(id))) return null;
      return copy.filter(p => !ids.includes(p.id));
    }
    case "add_easy_session":
      if (!s.date || !s.sport) return null;
      return [...copy, buildPlannedWorkout({ ...defaults, date: s.date, sport: s.sport, title: `${s.sport} locker`, duration_min: s.duration_min, intensity: "leicht" })];
    default:
      return null;
  }
}

// Übernimmt eine (geprüfte) Liste als neuen Trainingsplan.
function replacePlannedWorkouts(list) {
  plannedWorkouts = list;
  savePlannedWorkouts();
}

/* ---------- Schritte einer Einheit (Garmin-Workout und .fit-Export) ----------
   Optionales Feld `steps` am Eintrag:
     [{ type: "warmup", duration_min: 10, target: { kind: "none" } },
      { type: "repeat", count: 6, steps: [
          { type: "interval", distance_km: 0.4, target: { kind: "pace_zone", zone: 4 } },
          { type: "recovery", duration_min: 1.5, target: { kind: "none" } } ] },
      { type: "cooldown", duration_min: 10 }]
   Je Schritt duration_min ODER distance_km (keins = bis Lap-Taste). Eine
   Wiederholung enthält nur einfache Schritte (keine Wiederholung in der
   Wiederholung). Fehlen `steps`, gelten defaultWorkoutSteps(). */
const WORKOUT_STEP_TYPES = ["warmup", "interval", "recovery", "cooldown", "rest", "repeat"];
const WORKOUT_TARGET_KINDS = ["none", "hr_zone", "pace_zone", "power_zone"];
const WORKOUT_STEP_LABELS = { warmup: "Aufwärmen", interval: "Belastung", recovery: "Erholung", cooldown: "Abwärmen", rest: "Pause", repeat: "Wiederholung" };
const WORKOUT_TARGET_LABELS = { none: "ohne Ziel", hr_zone: "HF-Zone", pace_zone: "Pace-Zone", power_zone: "Leistungszone" };
const WORKOUT_STEP_MAX = 50;

// Prüft eine Schritt-Liste. Ergebnis { steps, errors }: steps ist die
// bereinigte Liste (nur bekannte Felder) oder null, sobald etwas nicht passt.
function validateWorkoutSteps(steps) {
  const errors = [];
  let total = 0;
  const positive = (v, max) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;
  const clean = (s, nr, nested) => {
    total++;
    if (!s || typeof s !== "object" || !WORKOUT_STEP_TYPES.includes(s.type)) { errors.push(`Schritt ${nr}: unbekannte Art.`); return null; }
    if (s.type === "repeat") {
      if (nested) { errors.push(`Schritt ${nr}: keine Wiederholung in einer Wiederholung.`); return null; }
      if (!Number.isInteger(s.count) || s.count < 1 || s.count > 50) errors.push(`Schritt ${nr}: Wiederholungen 1–50.`);
      if (!Array.isArray(s.steps) || !s.steps.length) { errors.push(`Schritt ${nr}: Wiederholung ohne Schritte.`); return null; }
      return { type: "repeat", count: s.count, steps: s.steps.map((c, i) => clean(c, `${nr}.${i + 1}`, true)) };
    }
    const out = { type: s.type };
    if (s.duration_min != null && s.distance_km != null) errors.push(`Schritt ${nr}: Dauer ODER Distanz, nicht beides.`);
    else if (s.duration_min != null) { if (positive(s.duration_min, 1440)) out.duration_min = s.duration_min; else errors.push(`Schritt ${nr}: Dauer ungültig.`); }
    else if (s.distance_km != null) { if (positive(s.distance_km, 1000)) out.distance_km = s.distance_km; else errors.push(`Schritt ${nr}: Distanz ungültig.`); }
    const t = s.target || { kind: "none" };
    if (!WORKOUT_TARGET_KINDS.includes(t.kind)) errors.push(`Schritt ${nr}: unbekanntes Ziel.`);
    else if (t.kind === "none") out.target = { kind: "none" };
    else if (Number.isInteger(t.zone) && t.zone >= 1 && t.zone <= 5) out.target = { kind: t.kind, zone: t.zone };
    else errors.push(`Schritt ${nr}: Zone 1–5 angeben.`);
    return out;
  };
  if (!Array.isArray(steps) || !steps.length) return { steps: null, errors: ["Keine Schritte angegeben."] };
  const cleaned = steps.map((s, i) => clean(s, String(i + 1), false));
  if (total > WORKOUT_STEP_MAX) errors.push(`Höchstens ${WORKOUT_STEP_MAX} Schritte.`);
  return { steps: errors.length ? null : cleaned, errors };
}

// HF-Zone des Hauptteils je Intensität. Bewusst keine erfundenen Intervalle:
// "hart" wird ein durchgehender Block in Zone 4 - Intervalle trägt man selbst ein.
const DEFAULT_STEP_HR_ZONE = { leicht: 2, mittel: 3, hart: 4 };

// Standard-Schritte aus Dauer + Intensität (wenn die Einheit keine eigenen
// hat): ab 30 min Ausdauer Aufwärmen / Hauptteil / Abwärmen, sonst ein Block.
// Schwimmen ohne Pulsziel (Handgelenk-Puls im Wasser unzuverlässig).
function defaultWorkoutSteps(pw) {
  const d = Number(pw.duration_min) > 0 ? Number(pw.duration_min) : null;
  const endurance = ["Laufen", "Rad", "Schwimmen"].includes(pw.sport);
  const zone = endurance && pw.sport !== "Schwimmen" ? DEFAULT_STEP_HR_ZONE[pw.intensity] : null;
  const main = zone ? { kind: "hr_zone", zone } : { kind: "none" };
  const step = (type, minutes, target) => (minutes ? { type, duration_min: minutes, target } : { type, target });
  if (!endurance || !d || d < 30) return [step("interval", d, main)];
  const warm = d >= 60 ? 15 : 10;
  const cool = d >= 60 ? 10 : 5;
  return [step("warmup", warm, { kind: "none" }), step("interval", d - warm - cool, main), step("cooldown", cool, { kind: "none" })];
}

// Die Schritte, die wirklich verwendet werden (.fit-Export, Garmin-Versand):
// eigene, sofern gültig, sonst die Standard-Schritte.
function plannedWorkoutSteps(pw) {
  return (pw.steps && validateWorkoutSteps(pw.steps).steps) || defaultWorkoutSteps(pw);
}
