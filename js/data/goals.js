// Ziel-Events: Laden, Speichern, Anlegen, Loeschen.

const GOALS_KEY = "triathlon_dashboard_goals_v1";

let goals = [];

// Gespeichert in der Ablage pro Person auf dem Server (js/data/api-client.js).
function loadGoals() {
  goals = storeGet(GOALS_KEY) || [];
  if (!Array.isArray(goals)) goals = [];
}

function saveGoals() {
  // transiente Lade-/Fehlerzustände nicht mit persistieren
  const clean = goals.map(({ _loading, _error, _planLoading, _planError, _detailsOpen, _advOpen, _racePlanOpen, _gpxError, ...rest }) => rest);
  storeSet(GOALS_KEY, clean);
}

// Neues Ziel anlegen oder - wenn gerade eines bearbeitet wird (goalEditingId,
// js/components/goal-form.js) - dessen Wettkampf-Angaben ändern. Was aus dem
// Formular gelesen wird, steht in readGoalForm(); Staffel, Vorlage und
// Streckenart rechnet goalRaceFields() (js/data/race-formats.js).
function addGoal(e) {
  e.preventDefault();
  const form = readGoalForm();
  const errEl = document.getElementById("goal-form-error");
  if (form.error) {
    if (errEl) { errEl.textContent = form.error; errEl.hidden = false; }
    return;
  }
  if (errEl) errEl.hidden = true;
  if (!form.name || !form.date) return;
  const editing = goalEditingId ? goals.find(g => g.id === goalEditingId) : null;
  if (editing) {
    // Nur die Wettkampf-Angaben - Priorität, Streckenprofil, Rennplan und
    // KI-Empfehlung bleiben, wie sie sind.
    Object.assign(editing, form);
  } else {
    goals.push({
      id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("g" + Date.now() + Math.random().toString(16).slice(2)),
      ...form, // name, sport, date, notes, format, relay, relayLegs, terrain, distanceKm, targetTime, subDisciplines
      isPrimary: goals.length === 0, // erstes Ziel wird automatisch Hauptevent, sonst per Stern markierbar
      recommendation: null,
      recommendationAt: null,
      // "Erweiterte Einstellungen" (js/components/coach.js, buildGoalAdvancedHtml)
      // - alle optional, nichts davon blockiert das Anlegen eines Ziels.
      priority: null, // "A"|"B"|"C" (Ausdauersport-Konvention: A = Hauptrennen, B/C = Nebenziele)
      strategyNote: null, // Freitext, z.B. Pacing-/Verpflegungsstrategie
      courseElevationM: null, // Höhenmeter der Strecke, manuell ODER aus GPX
      courseProfileSource: null, // "manual"|"gpx" - nur zur Anzeige, welche Quelle
      courseProfileLabel: null, // z.B. "1240 Hm über 92 km (13 Hm/km, hügelig)" - nur bei GPX-Quelle gesetzt (gpxProfileLabel())
      racePlan: null, // Rennplan-Checklisten (js/analytics/race-plan.js) - null = Standard-Listen, bis etwas geändert wird
    });
  }
  saveGoals();
  // Formular zurücksetzen und die Kachel wieder einklappen (siehe coach.js:
  // "+ Neues Ziel/Event"-Toggle).
  resetGoalForm();
  showGoalFormCard(false);
  renderGoals();
  // Das neu angelegte Ziel kann automatisch zum Hauptevent werden (erstes
  // Ziel überhaupt, s.o.) - Trainingsplan-Kachel (inkl. Zeitleiste) und
  // Ernährungs-Tab hängen daran und müssen das sofort mit anzeigen, nicht
  // erst nach dem nächsten unabhängigen Re-Render.
  renderTrainingPlanCard();
  if (typeof renderNutrition === "function") renderNutrition();
}

function deleteGoal(id) {
  const gone = goals.find(g => g.id === id);
  // Aus Garmin übernommen? Dann beim nächsten Abgleich nicht wieder anlegen.
  if (gone && gone.garminEventId && typeof dismissGarminEvent === "function") dismissGarminEvent(gone.garminEventId);
  goals = goals.filter(g => g.id !== id);
  saveGoals();
  renderGoals();
  renderTrainingPlanCard();
  if (typeof renderNutrition === "function") renderNutrition();
}

// "Hauptevent" für den Trainingsplan (siehe js/analytics/training-plan.js) -
// genau eines von mehreren Zielen kann primär sein, damit klar ist, worauf
// die KI konkret hintrainiert (andere Ziele bleiben als Zwischen-Checks im
// Race-Readiness sichtbar, siehe AI_CONTEXT.md).
function setGoalPrimary(id) {
  goals.forEach(g => { g.isPrimary = (g.id === id); });
  saveGoals();
  renderGoals();
  renderTrainingPlanCard();
  if (typeof renderNutrition === "function") renderNutrition();
}

function getPrimaryGoal() {
  return goals.find(g => g.isPrimary) || null;
}

/* ---------- "Erweiterte Einstellungen" je Ziel ---------- */
// Eigene Setter statt eines generischen updateGoal(id, patch) - macht an
// jeder Aufrufstelle explizit, welches Feld geändert wird (gleiches Muster
// wie z.B. setEquipmentManualKm(), js/data/equipment.js), und hier zusätzlich
// sinnvoll, weil renderTrainingPlanCard() nur bei den plan-relevanten
// Feldern (Priorität/Streckenprofil, nicht bei der reinen Strategie-Notiz)
// erneut aufgerufen werden muss.

function setGoalPriority(id, priority) {
  const goal = goals.find(g => g.id === id);
  if (!goal) return;
  goal.priority = ["A", "B", "C"].includes(priority) ? priority : null;
  saveGoals();
  renderGoals();
}

function setGoalStrategyNote(id, note) {
  const goal = goals.find(g => g.id === id);
  if (!goal) return;
  goal.strategyNote = (note || "").trim().slice(0, 500) || null;
  saveGoals();
  renderGoals();
}

// source: "manual" (Zahl direkt eingetragen) oder "gpx" (aus hochgeladener
// .gpx-Datei berechnet, siehe js/data/gpx-parser.js) - label nur bei "gpx"
// gesetzt (fertig formatierter Hügeligkeits-Hinweis für Anzeige + KI-Kontext).
function setGoalCourseElevation(id, elevationM, source, label) {
  const goal = goals.find(g => g.id === id);
  if (!goal) return;
  const m = Number(elevationM);
  goal.courseElevationM = (m > 0) ? Math.round(m) : null;
  goal.courseProfileSource = goal.courseElevationM != null ? (source || "manual") : null;
  goal.courseProfileLabel = (goal.courseElevationM != null && source === "gpx") ? (label || null) : null;
  saveGoals();
  renderGoals();
}

// Rennplan (Checklisten Wechselzone/Ausrüstung, Verpflegung, Rennwoche - siehe
// js/analytics/race-plan.js) als Ganzes ersetzen; null = wieder Standard-Listen.
// rerender = false: nur speichern - für einen geänderten Text, der schon so
// auf dem Bildschirm steht (neu zeichnen würde den nächsten Klick verschlucken).
function setGoalRacePlan(id, racePlan, rerender = true) {
  const goal = goals.find(g => g.id === id);
  if (!goal) return;
  goal.racePlan = racePlan || null;
  saveGoals();
  if (rerender) renderGoals();
}
