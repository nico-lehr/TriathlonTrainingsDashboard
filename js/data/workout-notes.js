// Nutzer-Bewertung (1-5 Sterne) + Notiz je absolvierter Trainingseinheit -
// rein subjektiver Eintrag des Athleten, getrennt von den Workout-Objekten
// selbst gespeichert (gleiches Muster wie workoutAnalysisCache, js/ai/
// ollama.js), weil ALL/DATA bei jedem "Aktualisieren" aus RAW neu abgeleitet
// werden (recomputeDerived, js/data/workouts.js) und zusätzliche Felder
// dabei verloren gingen. Keyed nach Dateiname (w.file), da es keine stabile
// DB-ID gibt. UI: js/components/workout-card.js (buildWorkoutRatingHtml).
// Fließt, sofern vorhanden, in die KI-Auswertung/Lessons Learned ein (siehe
// workoutFeedbackContextLines(), js/ai/context-builder.js) und in die
// Vergleichsansicht (js/components/compare.js) - AI_RULES: nur was der
// Nutzer tatsächlich eingetragen hat, nichts wird erfunden/ergänzt.

const WORKOUT_NOTES_KEY = "triathlon_dashboard_workout_notes_v1";

let workoutNotes = {};
try {
  const raw = localStorage.getItem(WORKOUT_NOTES_KEY);
  if (raw) workoutNotes = JSON.parse(raw) || {};
} catch (e) { /* Cache leer starten */ }

function saveWorkoutNotes() {
  try { localStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify(workoutNotes)); } catch (e) { /* ignorieren */ }
}

function getWorkoutNote(file) {
  return workoutNotes[file] || null;
}

function setWorkoutRating(file, rating) {
  const r = Number(rating);
  const entry = { ...(workoutNotes[file] || {}) };
  entry.rating = (r >= 1 && r <= 5) ? r : null;
  entry.updatedAt = new Date().toISOString();
  workoutNotes[file] = entry;
  saveWorkoutNotes();
}

function setWorkoutNoteText(file, text) {
  const entry = { ...(workoutNotes[file] || {}) };
  entry.note = (text || "").trim().slice(0, 500) || null;
  entry.updatedAt = new Date().toISOString();
  workoutNotes[file] = entry;
  saveWorkoutNotes();
}

// Nachträgliche Höhenmeter-Korrektur (manuell ODER aus GPX-Upload, siehe
// js/data/gpx-parser.js) - für Einheiten, deren .fit-Datei keine
// Höhenmeter aufgezeichnet hat oder bei denen der Wert offensichtlich
// falsch ist. Überschreibt NICHT das Workout-Objekt selbst (w bleibt
// unverändert, siehe Datei-Kopfkommentar oben), sondern wird an den
// relevanten Stellen per effectiveElevationGainM() bevorzugt gelesen.
function setWorkoutElevationOverride(file, meters) {
  const m = Number(meters);
  const entry = { ...(workoutNotes[file] || {}) };
  entry.elevationOverrideM = (m > 0) ? Math.round(m) : null;
  entry.updatedAt = new Date().toISOString();
  workoutNotes[file] = entry;
  saveWorkoutNotes();
}

// Höhenmeter, die für Anzeige/KI-Kontext tatsächlich verwendet werden sollen:
// der echte .fit-Wert hat Vorrang, die manuelle/GPX-Korrektur greift nur,
// wenn die Aufzeichnung selbst keine Höhenmeter hat.
function effectiveElevationGainM(w) {
  if (w.elevation_gain_m != null) return w.elevation_gain_m;
  const entry = getWorkoutNote(w.file);
  return entry && entry.elevationOverrideM != null ? entry.elevationOverrideM : null;
}
