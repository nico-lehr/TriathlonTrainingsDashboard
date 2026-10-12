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

// Neuer, noch nicht gespeicherter Eintrag - gemeinsame Form für
// addPlannedWorkout() und applyPlanSuggestion() (add_easy_session).
// entry: { date, sport, title, duration_min, intensity, description, exercises, goalId, phase, source }
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
    status: "geplant", // "geplant" | "erledigt" | "uebersprungen"
    goalId: entry.goalId || null,
    phase: entry.phase || null,
    source: entry.source || "manual", // "ai" | "manual"
    createdAt: new Date().toISOString(),
  };
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
  Object.assign(pw, patch);
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
  return list.map(p => (p.id === id ? { ...p, ...patch } : p));
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
      target.date = s.toDate;
      return copy;
    case "set_intensity":
      if (!target || !s.intensity) return null;
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
