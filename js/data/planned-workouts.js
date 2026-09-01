// Geplante Trainingseinheiten (KI-generierter oder manuell angelegter
// Trainingsplan) - eigener Datentyp, getrennt von den echten, aus .fit-Dateien
// importierten Workouts (ALL/DATA, siehe workouts.js). Ein geplantes Workout
// hat KEINE Streckendaten/Ist-Werte, nur eine Absicht (Sportart, Dauer,
// Intensität, Beschreibung) - siehe docs/DATA_MODEL.md.

const PLANNED_WORKOUTS_KEY = "triathlon_dashboard_planned_workouts_v1";

let plannedWorkouts = [];

function loadPlannedWorkouts() {
  try {
    const raw = localStorage.getItem(PLANNED_WORKOUTS_KEY);
    plannedWorkouts = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(plannedWorkouts)) plannedWorkouts = [];
  } catch (e) { plannedWorkouts = []; }
}

function savePlannedWorkouts() {
  try { localStorage.setItem(PLANNED_WORKOUTS_KEY, JSON.stringify(plannedWorkouts)); } catch (e) { /* Speicher evtl. voll/deaktiviert */ }
  scheduleIcalSync();
}

// Kalender-Abo (iCal) - Quelle der Wahrheit bleibt IMMER localStorage/dieser
// Browser (s.o.), der Flask-Backend-Server bekommt hier nur eine Kopie zum
// Generieren des .ics-Feeds (siehe backend/routes.py: /api/v1/ical-sync,
// CHANGE_REQUESTS.md). Rein "best effort" - läuft der Server nicht lokal
// (Standardfall, muss manuell gestartet werden), schlägt der Request
// einfach fehl und wird ignoriert, ohne den Nutzer zu stören. Debounced statt
// bei jedem einzelnen savePlannedWorkouts()-Aufruf sofort zu senden, da z.B.
// eine mehrtägige KI-Trainingsplan-Erstellung mehrfach hintereinander
// speichert.
const ICAL_SYNC_URL = "http://localhost:5000/api/v1/ical-sync";
let icalSyncTimer = null;

function scheduleIcalSync() {
  clearTimeout(icalSyncTimer);
  icalSyncTimer = setTimeout(() => {
    fetch(ICAL_SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workouts: plannedWorkouts }),
    }).catch(() => { /* Backend nicht erreichbar - iCal-Abo zeigt dann einfach den letzten erfolgreichen Stand */ });
  }, 1200);
}

function newPlannedWorkoutId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("pw" + Date.now() + Math.random().toString(16).slice(2));
}

// entry: { date, sport, title, duration_min, intensity, description, exercises, goalId, phase, source }
function addPlannedWorkout(entry) {
  const pw = {
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
  const key = dayDate.toISOString().slice(0, 10);
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
  const todayKey = new Date().toISOString().slice(0, 10);
  plannedWorkouts = plannedWorkouts.filter(p => !(p.goalId === goalId && p.date >= todayKey));
  savePlannedWorkouts();
}

// Entfernt bevorstehende geplante Einheiten ALLER ANDEREN Ziele - wird beim
// Erstellen eines Plans für das aktuelle Hauptevent aufgerufen, damit nicht
// gleichzeitig der (jetzt veraltete) Plan eines früheren Hauptevents im
// Kalender steht und sich mit dem neuen Plan widerspricht (mehrere,
// gegensätzliche Trainings am selben Tag).
function deleteFuturePlannedWorkoutsForOtherGoals(goalId) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const before = plannedWorkouts.length;
  plannedWorkouts = plannedWorkouts.filter(p => !(p.goalId && p.goalId !== goalId && p.date >= todayKey));
  if (plannedWorkouts.length !== before) savePlannedWorkouts();
}

// Bereits verplante zukünftige Tage (ab heute) für ein Ziel - Grundlage für
// das rollierende Nachplanen (siehe computePlanningWindow/shouldAutoReplan
// in js/analytics/training-plan.js).
function futurePlannedDatesForGoal(goalId) {
  const todayKey = new Date().toISOString().slice(0, 10);
  return [...new Set(plannedWorkouts.filter(p => p.goalId === goalId && p.date >= todayKey).map(p => p.date))].sort();
}
