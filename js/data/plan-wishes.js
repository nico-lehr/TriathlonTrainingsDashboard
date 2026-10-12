// Terminwünsche für den Trainingsplan ("Ich möchte Donnerstag schwimmen"):
// strukturiert als Datum + Sportart + Dauer (+ Notiz), neben dem freien
// Wunschtext athleteProfile.customPlanWishes. Die nächste KI-Planung
// (generateTrainingPlan, js/ai/ollama.js) plant offene Wünsche fest ein.
//
// Ob ein Wunsch schon eingeplant ist, wird nicht gespeichert, sondern immer
// am Plan abgelesen (gleicher Tag + gleiche Sportart) - so kann der Stand
// nicht veralten, wenn die Einheit später verschoben oder gelöscht wird.

const PLAN_WISHES_KEY = "triathlon_dashboard_plan_wishes_v1";
const PLAN_WISH_MAX_MIN = 480; // dieselbe Grenze wie parsePlanResponse() (über 8 h = unplausibel)

let planWishes = [];

// Gespeichert in der Ablage pro Person auf dem Server (js/data/api-client.js).
// Vergangene Wünsche haben keinen Zweck mehr und fallen beim Laden weg.
function loadPlanWishes() {
  const saved = storeGet(PLAN_WISHES_KEY);
  const today = todayStr();
  planWishes = (Array.isArray(saved) ? saved : []).filter(w => w && w.date >= today);
}

function savePlanWishes() {
  storeSet(PLAN_WISHES_KEY, planWishes);
}

// entry: { date: "YYYY-MM-DD", sport, duration_min, note } - null, wenn
// etwas fehlt oder nicht passt (Datum vorbei, unbekannte Sportart, Dauer).
function addPlanWish(entry) {
  const duration = Math.round(Number(entry.duration_min));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date || "") || entry.date < todayStr()) return null;
  if (!PLAN_ALLOWED_SPORTS.includes(entry.sport)) return null;
  if (!(duration > 0 && duration <= PLAN_WISH_MAX_MIN)) return null;
  const note = entry.note ? String(entry.note).trim().slice(0, 200) : "";
  const wish = { id: newPlannedWorkoutId(), date: entry.date, sport: entry.sport, duration_min: duration, note: note || null, createdAt: new Date().toISOString() };
  planWishes.push(wish);
  savePlanWishes();
  return wish;
}

function deletePlanWish(id) {
  planWishes = planWishes.filter(w => w.id !== id);
  savePlanWishes();
}

// Steht der Wunsch schon im Plan (gleicher Tag + Sportart, nicht übersprungen)?
function isPlanWishPlanned(wish, list = plannedWorkouts) {
  return list.some(p => p.date === wish.date && p.sport === wish.sport && p.status !== "uebersprungen");
}

// Alle Wünsche ab heute bzw. nur die noch nicht eingeplanten, nach Datum.
function upcomingPlanWishes() {
  const today = todayStr();
  return planWishes.filter(w => w.date >= today).sort((a, b) => a.date.localeCompare(b.date));
}

function openPlanWishes(list = plannedWorkouts) {
  return upcomingPlanWishes().filter(w => !isPlanWishPlanned(w, list));
}

// Ergänzt eine Planliste (Kopie) um offene Wünsche bis einschließlich
// `untilDate`, die die KI nicht selbst eingeplant hat - ohne Intensität,
// weil der Wunsch keine nennt (nie raten).
function addOpenWishesToPlan(list, untilDate, defaults = {}) {
  const missing = openPlanWishes(list).filter(w => w.date <= untilDate);
  return [...list, ...missing.map(w => buildPlannedWorkout({
    ...defaults, date: w.date, sport: w.sport, title: `${w.sport} (Wunsch)`, duration_min: w.duration_min, description: w.note,
  }))];
}
