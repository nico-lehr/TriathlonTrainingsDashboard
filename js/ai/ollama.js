// Anbindung an ein lokales LLM ueber Ollama: Einstellungen, Verbindungstest,
// Trainingsempfehlung generieren.

const COACH_SETTINGS_KEY = "triathlon_dashboard_coach_settings_v1";

let coachSettings = { baseUrl: "http://localhost:11434", model: "llama3.1" };

function loadCoachSettings() {
  try {
    const raw = localStorage.getItem(COACH_SETTINGS_KEY);
    if (raw) coachSettings = { ...coachSettings, ...JSON.parse(raw) };
  } catch (e) { /* Default beibehalten */ }
}

function saveCoachSettings() {
  try { localStorage.setItem(COACH_SETTINGS_KEY, JSON.stringify(coachSettings)); } catch (e) {}
}

// Cache der KI-Auswertung je Trainingseinheit (Dateiname -> {analysis,
// analysisAt, error, loading}) - separat von den Workout-Objekten selbst
// gespeichert, weil ALL/DATA bei jedem "Aktualisieren" aus RAW neu abgeleitet
// werden (siehe recomputeDerived in workouts.js) und zusätzliche Felder dabei
// verloren gingen. Gleiches Muster wie goals.js für die Ziel-Empfehlungen.

const WORKOUT_ANALYSIS_KEY = "triathlon_dashboard_workout_analysis_v1";

let workoutAnalysisCache = {};
try {
  const raw = localStorage.getItem(WORKOUT_ANALYSIS_KEY);
  if (raw) workoutAnalysisCache = JSON.parse(raw) || {};
} catch (e) { /* Cache leer starten */ }

function saveWorkoutAnalysisCache() {
  try { localStorage.setItem(WORKOUT_ANALYSIS_KEY, JSON.stringify(workoutAnalysisCache)); } catch (e) {}
}

function describeCoachError(e) {
  const msg = String((e && e.message) || e || "");
  if (/Failed to fetch|NetworkError|Load failed|ERR_CONNECTION/i.test(msg)) {
    return "Ollama nicht erreichbar. Läuft Ollama gerade auf diesem Rechner, und ist OLLAMA_ORIGINS für den Zugriff aus dieser Datei freigeschaltet? (Details im Hinweis oben / in der README)";
  }
  return "Fehler bei der Anfrage an Ollama: " + msg;
}

// Ein einzelner Text-Call an Ollama - von callAiText() (js/ai/provider.js)
// aufgerufen, wenn die jeweilige Aufgabe (Einstellungen → KI-Verbindung) auf
// Ollama statt Claude steht (Standard für alle Aufgaben).
async function callOllamaApi(prompt, { json = false } = {}) {
  const base = (coachSettings.baseUrl || "http://localhost:11434").replace(/\/$/, "");
  const res = await fetch(base + "/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json ? { model: coachSettings.model, prompt, format: "json", stream: false } : { model: coachSettings.model, prompt, stream: false }),
  });
  if (!res.ok) throw new Error("Status " + res.status);
  const data = await res.json();
  const text = (data.response || "").trim();
  if (!text) throw new Error("Leere Antwort vom Modell erhalten.");
  return text;
}


async function testOllamaConnection() {
  const statusEl = document.getElementById("coach-test-status");
  statusEl.textContent = "Teste Verbindung …";
  statusEl.className = "coach-test-status";
  try {
    const base = (coachSettings.baseUrl || "http://localhost:11434").replace(/\/$/, "");
    const res = await fetch(base + "/api/tags");
    if (!res.ok) throw new Error("Status " + res.status);
    const data = await res.json();
    const models = (data.models || []).map(m => m.name || m.model).filter(Boolean);
    const wanted = coachSettings.model;
    const hasModel = models.includes(wanted) || models.some(m => m.split(":")[0] === wanted.split(":")[0]);
    if (hasModel) {
      statusEl.textContent = `✓ Verbunden — Modell "${wanted}" ist verfügbar.`;
      statusEl.className = "coach-test-status ok";
    } else {
      statusEl.textContent = `Ollama erreichbar, aber Modell "${wanted}" nicht gefunden. Verfügbar: ${models.join(", ") || "keine (erst „ollama pull …" + wanted + "“ ausführen)"}.`;
      statusEl.className = "coach-test-status warn";
    }
  } catch (e) {
    statusEl.textContent = describeCoachError(e);
    statusEl.className = "coach-test-status err";
  }
}


async function generateRecommendation(goalId) {
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return;
  goal._loading = true; goal._error = null;
  renderGoals();
  try {
    const prompt = buildCoachPrompt(goal);
    const text = await callAiText(prompt, { task: "recommendation" });
    goal.recommendation = text;
    goal.recommendationAt = new Date().toISOString();
    goal._error = null;
  } catch (e) {
    goal._error = describeAiError(e, "recommendation");
  } finally {
    goal._loading = false;
    saveGoals();
    renderGoals();
  }
}

/* ---------- Automatische Trainingsplan-Erstellung ---------- */

const PLAN_ALLOWED_SPORTS = ["Schwimmen", "Rad", "Laufen", "Kraft", "Mobility"];

// Stichwörter, die eindeutig auf eine Kraft-Einheit hindeuten - falls das
// Modell trotzdem eine andere Sportart (Schwimmen/Rad/Laufen) einträgt, ist
// das ein interner Widerspruch im Modell-Output (Titel/Beschreibung passen
// nicht zum "sport"-Feld), siehe Bug-Report Punkt 16: "Zugseiltraining"
// wurde fälschlich sport="Rad" zugewiesen.
const STRENGTH_KEYWORDS = ["zugseil", "klimmzug", "liegestütz", "liegestuetz", "kniebeuge", "kreuzheben", "bankdrücken", "bankdruecken", "kettlebell", "langhantel", "kurzhantel", "krafttraining"];

// Prüft/bereinigt die vom Modell gelieferten Vorschläge, bevor sie
// gespeichert werden - ungültige/unplausible Einträge werden übersprungen
// statt ungeprüft übernommen (siehe AI_RULES: KI-Output nie blind vertrauen).
function parsePlanResponse(rawText, windowDates) {
  let data;
  try {
    // Modelle liefern trotz format:"json" gelegentlich noch Text drumherum
    // (z.B. ```json ... ```) - den ersten {...}-Block herausschneiden.
    const match = rawText.match(/\{[\s\S]*\}/);
    data = JSON.parse(match ? match[0] : rawText);
  } catch (e) {
    throw new Error("Antwort war kein gültiges JSON.");
  }
  const list = Array.isArray(data.workouts) ? data.workouts : Array.isArray(data) ? data : null;
  if (!list) throw new Error("Antwort enthielt kein \"workouts\"-Array.");

  const windowSet = new Set(windowDates);
  const seen = new Set(); // "date|sport" gegen Duplikate am selben Tag
  const valid = [];
  list.forEach(entry => {
    if (!entry || typeof entry !== "object") return;
    if (!windowSet.has(entry.date)) return; // Datum außerhalb des angefragten Fensters
    if (!PLAN_ALLOWED_SPORTS.includes(entry.sport)) return;
    const dur = Number(entry.duration_min);
    if (!isFinite(dur) || dur <= 0 || dur > 480) return; // unplausible Dauer (>8h) verwerfen

    // Konsistenz-Check: Titel/Beschreibung müssen zur gewählten Sportart
    // passen, sonst widersprechen sich zwei Felder derselben Antwort (siehe
    // STRENGTH_KEYWORDS oben) - lieber den Vorschlag verwerfen als eine
    // Einheit mit falscher Sportart speichern.
    const textLower = `${entry.title || ""} ${entry.description || ""}`.toLowerCase();
    if (entry.sport !== "Kraft" && STRENGTH_KEYWORDS.some(kw => textLower.includes(kw))) return;

    // Konsistenz-Check: bei Kraft/Mobility nennt die Beschreibung oft selbst
    // eine Gesamtdauer am Anfang (z.B. "20min Zugseiltraining ...") - weicht
    // die Zahl im Text stark vom separaten "duration_min"-Feld ab, ist das
    // ein interner Widerspruch statt eines gültigen Vorschlags.
    if (entry.sport === "Kraft" || entry.sport === "Mobility") {
      const textDurMatch = entry.description && String(entry.description).match(/^\s*(\d{1,3})\s*min\b/i);
      if (textDurMatch) {
        const textDur = Number(textDurMatch[1]);
        if (textDur > 0 && (dur > textDur * 1.5 || dur < textDur * 0.67)) return;
      }
    }

    const dedupeKey = entry.date + "|" + entry.sport;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const intensity = ["leicht", "mittel", "hart"].includes(entry.intensity) ? entry.intensity : null;
    const exercises = (entry.sport === "Kraft" || entry.sport === "Mobility") && Array.isArray(entry.exercises)
      ? entry.exercises.filter(x => x && x.name).map(x => ({
          name: String(x.name).slice(0, 80),
          sets: x.sets != null ? Number(x.sets) || null : null,
          reps: x.reps != null ? String(x.reps).slice(0, 20) : null,
          note: x.note ? String(x.note).slice(0, 200) : null,
        }))
      : null;
    valid.push({
      date: entry.date,
      sport: entry.sport,
      title: entry.title ? String(entry.title).slice(0, 80) : entry.sport,
      duration_min: dur,
      intensity,
      description: entry.description ? String(entry.description).slice(0, 500) : null,
      exercises,
    });
  });
  if (!valid.length) throw new Error("Keine gültigen Trainingsvorschläge in der Antwort gefunden.");
  return valid;
}

// Generiert die nächsten (rollierend) geplanten Tage für das Hauptevent-Ziel
// und speichert sie als plannedWorkouts (js/data/planned-workouts.js). Wird
// sowohl manuell (Button im Coach-Tab) als auch automatisch im Hintergrund
// aufgerufen (checkAutoReplan, js/app.js), sobald wenig geplante Tage übrig sind.
// `replace: true` (Button "Plan neu erstellen") löscht zuerst alle noch
// bevorstehenden geplanten Einheiten DIESES Ziels und plant dann komplett
// neu ab heute, statt wie sonst nur die Lücke nach dem letzten bereits
// geplanten Tag aufzufüllen (rollierendes Fenster, s.o.).
async function generateTrainingPlan(goalId, { replace = false } = {}) {
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return;
  if (replace) deleteFuturePlannedWorkoutsForGoal(goal.id);
  // Ein Plan gehört immer nur zu EINEM (dem aktuellen Haupt-)Ziel - ein noch
  // bevorstehender Plan eines früheren Hauptevents würde sonst weiterhin im
  // Kalender stehen und sich mit dem neuen Plan widersprechen.
  deleteFuturePlannedWorkoutsForOtherGoals(goal.id);
  const windowDates = computePlanningWindow(goal.id);
  goal._planLoading = true; goal._planError = null;
  renderTrainingPlanCard();
  renderCalendar();
  try {
    const prompt = buildPlanPrompt(goal, windowDates);
    const text = await callAiText(prompt, { task: "plan", json: true });
    const entries = parsePlanResponse(text, windowDates);
    const phase = computeTrainingPhase(Math.round((new Date(goal.date + "T00:00:00") - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000));
    entries.forEach(entry => addPlannedWorkout({ ...entry, goalId: goal.id, phase: phase.key, source: "ai" }));
    goal.lastPlannedAt = new Date().toISOString();
    goal._planError = null;
  } catch (e) {
    goal._planError = describeAiError(e, "plan");
  } finally {
    goal._planLoading = false;
    saveGoals();
    renderTrainingPlanCard();
    renderCalendar();
  }
}

// KI-Auswertung EINER Trainingseinheit im Vergleich zu ähnlichen Einheiten
// (siehe findComparableWorkouts in js/analytics/workout-comparison.js).
// Aktualisiert nach Abschluss gezielt nur den betroffenen Auswertungs-Block
// (renderWorkoutAnalysisBlock, workout-card.js) statt der ganzen Detailansicht
// - die dort ebenfalls angezeigten Diagramme müssen dafür nicht neu gezeichnet werden.

async function generateWorkoutAnalysis(file) {
  const w = ALL.find(x => x.file === file);
  if (!w) return;
  const comparable = findComparableWorkouts(w, ALL);
  if (comparable.length < 3) {
    workoutAnalysisCache[file] = {
      analysis: null, analysisAt: null, loading: false,
      error: `Noch nicht genug ähnliche Einheiten für einen Vergleich (aktuell ${comparable.length}, mindestens 3 nötig — gleiche Sportart, Distanz/Dauer ±20%).`,
    };
    saveWorkoutAnalysisCache();
    renderWorkoutAnalysisBlock(file);
    return;
  }
  workoutAnalysisCache[file] = { ...(workoutAnalysisCache[file] || {}), loading: true, error: null };
  renderWorkoutAnalysisBlock(file);
  try {
    const prompt = buildWorkoutAnalysisPrompt(w, comparable);
    const text = await callAiText(prompt, { task: "analysis" });
    workoutAnalysisCache[file] = { analysis: text, analysisAt: new Date().toISOString(), loading: false, error: null };
  } catch (e) {
    workoutAnalysisCache[file] = { ...(workoutAnalysisCache[file] || {}), loading: false, error: describeAiError(e, "analysis") };
  } finally {
    saveWorkoutAnalysisCache();
    renderWorkoutAnalysisBlock(file);
  }
}

// KI-"Lessons Learned" fuer EINE geplante (noch nicht absolvierte) Einheit -
// vorausschauend statt rueckblickend (siehe buildLessonsContext/-Prompt),
// nutzt dieselbe Vergleichsgruppen-Funktion wie generateWorkoutAnalysis
// (findComparableWorkouts toleriert ein Planungs-Objekt ohne file/
// distance_km). Aktualisiert gezielt nur den betroffenen Block im
// Trainingsplan-Bearbeiten-Dialog (renderPlanEditLessons, training-plan.js).
async function generateLessons(plannedWorkoutId) {
  const pw = plannedWorkouts.find(p => p.id === plannedWorkoutId);
  if (!pw) return;
  const comparable = findComparableWorkouts(pw, ALL);
  pw._lessonsLoading = true; pw._lessonsError = null;
  if (typeof renderPlanEditLessons === "function") renderPlanEditLessons(pw);
  try {
    const prompt = buildLessonsPrompt(pw, comparable);
    const text = await callAiText(prompt, { task: "lessons" });
    pw.lessons = text;
    pw.lessonsAt = new Date().toISOString();
    pw._lessonsError = null;
  } catch (e) {
    pw._lessonsError = describeAiError(e, "lessons");
  } finally {
    pw._lessonsLoading = false;
    savePlannedWorkouts();
    if (typeof renderPlanEditLessons === "function") renderPlanEditLessons(pw);
  }
}

// "Kürzere Variante" / "Alternative Einheit" fuer EINE geplante Einheit
// (Dropdown im Bearbeiten-Dialog, js/components/training-plan.js) - nutzt
// bewusst denselben "plan"-Task wie die normale Trainingsplan-Erstellung
// (dieselbe Ollama/Claude-Wahl in den Hybrid-Einstellungen gilt automatisch
// auch hier, keine eigene Einstellung noetig) und denselben Parser
// (parsePlanResponse). Liefert NUR den validierten Vorschlag zurueck -
// speichert NICHTS direkt, das Formular zeigt den Vorschlag zur Kontrolle
// an und Nico speichert bewusst selbst (siehe openPlanEdit).
async function generatePlannedWorkoutAlternative(pw, mode) {
  const goal = (pw.goalId && goals.find(g => g.id === pw.goalId)) || getPrimaryGoal();
  if (!goal) throw new Error("Kein Ziel/Event hinterlegt - dafür wird mindestens ein Ziel unter \"Deine Ziele\" benötigt.");
  const prompt = buildRegeneratePrompt(pw, mode, goal);
  const text = await callAiText(prompt, { task: "plan", json: true });
  const entries = parsePlanResponse(text, [pw.date]);
  if (!entries.length) throw new Error("Kein gültiger Vorschlag in der Antwort gefunden.");
  return entries[0];
}


/* ---------- Trainingsbelastungsfokus: KI-Einordnung Ist vs. Soll ---------- */

// Globaler Cache (kein einzelnes Ziel/keine einzelne Einheit dahinter, im
// Unterschied zu goal.recommendation/pw.lessons) - gleiches Zustands-Schema
// (Text/Zeitpunkt/Ladezustand/Fehler), gerendert von renderFocusInsight()
// (js/components/dashboard.js).
let focusInsight = { text: null, at: null, loading: false, error: null };

async function generateFocusInsight() {
  focusInsight.loading = true; focusInsight.error = null;
  if (typeof renderFocusInsight === "function") renderFocusInsight();
  try {
    const prompt = buildFocusPrompt();
    const text = await callAiText(prompt, { task: "focus" });
    focusInsight.text = text;
    focusInsight.at = new Date().toISOString();
    focusInsight.error = null;
  } catch (e) {
    focusInsight.error = describeAiError(e, "focus");
  } finally {
    focusInsight.loading = false;
    if (typeof renderFocusInsight === "function") renderFocusInsight();
  }
}
