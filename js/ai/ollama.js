// Anbindung an ein lokales LLM ueber Ollama: Einstellungen, Verbindungstest,
// Trainingsempfehlung generieren. Ollama laeuft auf dem Dashboard-PC; der
// Browser fragt nur den eigenen Server (POST /api/v1/ai/chat, backend/
// ai_routes.py), die Ollama-Adresse steht dort in .env (OLLAMA_URL).

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

// Persoenliche KI-Texte -> Ablage pro Person auf dem Server (js/data/api-client.js);
// app.js ruft das nach loadUserStore() auf.
function loadWorkoutAnalysisCache() {
  workoutAnalysisCache = storeGet(WORKOUT_ANALYSIS_KEY) || {};
}

function saveWorkoutAnalysisCache() {
  storeSet(WORKOUT_ANALYSIS_KEY, workoutAnalysisCache);
}

// Die Server-Meldungen sind schon verstaendlich ("Ollama ist auf dem
// Dashboard-PC nicht erreichbar ..."), siehe backend/ai_routes.py.
function describeCoachError(e) {
  return "Fehler bei der Anfrage an Ollama: " + String((e && e.message) || e || "");
}

// Ein einzelner Text-Call an Ollama - von callAiText() (js/ai/provider.js)
// aufgerufen, wenn die jeweilige Aufgabe (Einstellungen → KI-Verbindung) auf
// Ollama statt Claude steht (Standard für alle Aufgaben).
async function callOllamaApi(prompt, { json = false } = {}) {
  // Lange Wartezeit: ein ganzer Trainingsplan braucht auf langsamen PCs Minuten.
  const res = await apiCall("ai/chat", "POST", { prompt, json, model: coachSettings.model }, { timeoutMs: 10 * 60 * 1000 });
  const text = ((res.data && res.data.response) || "").trim();
  if (!text) throw new Error("Leere Antwort vom Modell erhalten.");
  return text;
}


async function testOllamaConnection() {
  const statusEl = document.getElementById("coach-test-status");
  statusEl.textContent = "Teste Verbindung …";
  statusEl.className = "coach-test-status";
  try {
    const res = await apiCall("ai/models");
    const models = (res.data.models || []).filter(Boolean);
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
// Gängige Schreibweisen der KI auf die festen Namen abbilden, statt eine
// sonst gute Einheit wegen "Radfahren" oder "locker" zu verwerfen.
const PLAN_SPORT_ALIASES = {
  schwimmen: "Schwimmen", swim: "Schwimmen", swimming: "Schwimmen",
  rad: "Rad", radfahren: "Rad", fahrrad: "Rad", bike: "Rad", cycling: "Rad", radtraining: "Rad",
  laufen: "Laufen", lauf: "Laufen", run: "Laufen", running: "Laufen", joggen: "Laufen",
  kraft: "Kraft", krafttraining: "Kraft", strength: "Kraft",
  mobility: "Mobility", mobilität: "Mobility", beweglichkeit: "Mobility", dehnen: "Mobility", stretching: "Mobility",
};
const PLAN_INTENSITY_ALIASES = { leicht: "leicht", locker: "leicht", easy: "leicht", niedrig: "leicht", mittel: "mittel", moderat: "mittel", moderate: "mittel", hart: "hart", hoch: "hart", intensiv: "hart", hard: "hart" };
const normalizePlanSport = x => PLAN_SPORT_ALIASES[String(x || "").trim().toLowerCase()] || String(x || "").trim();
const normalizePlanIntensity = x => PLAN_INTENSITY_ALIASES[String(x || "").trim().toLowerCase()] || null;

// report (optional): bekommt in report.dropped jede verworfene Einheit mit
// Grund ({ date, sport, reason }) - für den Plan-Bericht nach der Planung.
function parsePlanResponse(rawText, windowDates, report) {
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
  const dropped = report ? (report.dropped = report.dropped || []) : [];
  list.forEach(raw => {
    if (!raw || typeof raw !== "object") return;
    const entry = { ...raw, sport: normalizePlanSport(raw.sport) };
    const drop = reason => { dropped.push({ date: entry.date || null, sport: entry.sport || null, reason }); };
    if (!windowSet.has(entry.date)) return drop("Datum außerhalb des Planungszeitraums");
    if (!PLAN_ALLOWED_SPORTS.includes(entry.sport)) return drop("unbekannte Sportart");
    const dur = Number(entry.duration_min);
    if (!isFinite(dur) || dur <= 0 || dur > 480) return drop("unplausible Dauer"); // >8h verwerfen

    // Konsistenz-Check: Titel/Beschreibung müssen zur gewählten Sportart
    // passen, sonst widersprechen sich zwei Felder derselben Antwort (siehe
    // STRENGTH_KEYWORDS oben) - lieber den Vorschlag verwerfen als eine
    // Einheit mit falscher Sportart speichern.
    const textLower = `${entry.title || ""} ${entry.description || ""}`.toLowerCase();
    if (entry.sport !== "Kraft" && STRENGTH_KEYWORDS.some(kw => textLower.includes(kw))) return drop("Beschreibung passt nicht zur Sportart");

    // Konsistenz-Check: bei Kraft/Mobility nennt die Beschreibung oft selbst
    // eine Gesamtdauer am Anfang (z.B. "20min Zugseiltraining ...") - weicht
    // die Zahl im Text stark vom separaten "duration_min"-Feld ab, ist das
    // ein interner Widerspruch statt eines gültigen Vorschlags.
    if (entry.sport === "Kraft" || entry.sport === "Mobility") {
      const textDurMatch = entry.description && String(entry.description).match(/^\s*(\d{1,3})\s*min\b/i);
      if (textDurMatch) {
        const textDur = Number(textDurMatch[1]);
        if (textDur > 0 && (dur > textDur * 1.5 || dur < textDur * 0.67)) return drop("Dauer widerspricht der Beschreibung");
      }
    }

    const dedupeKey = entry.date + "|" + entry.sport;
    if (seen.has(dedupeKey)) return drop("doppelt am selben Tag");
    seen.add(dedupeKey);
    const intensity = normalizePlanIntensity(entry.intensity);
    const exercises = (entry.sport === "Kraft" || entry.sport === "Mobility") && Array.isArray(entry.exercises)
      ? entry.exercises.filter(x => x && (x.name || x.id)).map(x => {
          // Mobility-Übung aus der Sammlung (js/data/mobility-exercises.js): id
          // behalten, damit Zeichnung und Mitmach-Modus funktionieren.
          const lib = entry.sport === "Mobility" && typeof MOBILITY_BY_ID !== "undefined" ? MOBILITY_BY_ID[x.id]
            : entry.sport === "Kraft" && typeof STRENGTH_BY_ID !== "undefined" ? STRENGTH_BY_ID[x.id] : null;
          const out = {
            name: lib ? lib.name : String(x.name).slice(0, 80),
            sets: x.sets != null ? Number(x.sets) || null : null,
            reps: x.reps != null ? String(x.reps).slice(0, 20) : null,
            note: x.note ? String(x.note).slice(0, 200) : null,
          };
          if (lib && entry.sport === "Mobility") {
            out.id = lib.id;
            out.seconds = Math.min(90, Math.max(15, Math.round(Number(x.seconds) || lib.seconds)));
          } else if (lib) {
            out.id = lib.id;
            out.sets = out.sets ? Math.min(6, Math.max(1, out.sets)) : lib.sets;
            if (!out.reps) out.reps = lib.hold ? `${lib.hold} s` : lib.reps;
          }
          return out;
        }).filter(x => x.name && x.name !== "undefined")
      : null;
    if (entry.sport === "Mobility" && exercises && typeof fitMobilityExercises === "function") fitPlanMobility(exercises, dur);
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

// Mobility aus einem KI-Plan: Die Sekunden der Übungen müssen zusammen
// ungefähr die geplante Dauer ergeben (der KI-Coach verrechnet sich gern -
// 10 Minuten geplant, aber nur 3 Minuten Übungen). Ändert die Liste direkt.
function fitPlanMobility(exercises, minutes) {
  const lib = exercises.filter(x => x.id && MOBILITY_BY_ID[x.id]);
  if (!lib.length) return;
  const fitted = fitMobilityExercises(lib, minutes, mobilityFillPool());
  const others = exercises.filter(x => !(x.id && MOBILITY_BY_ID[x.id]));
  const out = fitted.map(f => {
    const ex = MOBILITY_BY_ID[f.id];
    const old = lib.find(x => x.id === f.id) || {};
    return { name: ex.name, sets: null, note: old.note || f.note || null, id: ex.id, seconds: f.seconds,
      reps: ex.kind === "reps" ? `${mobilityRepsFor(ex, f.seconds)}×${ex.sides ? " je Seite" : ""}` : `${f.seconds} s${ex.sides ? " je Seite" : ""}` };
  });
  exercises.splice(0, exercises.length, ...out, ...others);
}

/* ---------- Regelprüfung für KI-Pläne (js/analytics/plan-rules.js) ---------- */

// Kein KI-Plan wird mit einem "block"-Verstoß gespeichert. Ablauf je Versuch:
// Verstöße, die der Vorschlag NEU verursacht (newPlanViolations), werden
// zuerst automatisch behoben - der Vorschlag jedes "block"-Verstoßes wird
// übernommen (fix = applyPlanSuggestion) und neu geprüft. Bleibt ein "block"
// übrig, fragt ask() die KI ein zweites Mal, diesmal mit den Verstoß-Texten.
//   ask(violations) -> Promise<{ base, list }>: base = Plan vorher, list = mit Vorschlag
//   validate(list)  -> Verstöße (validatePlan)
//   fix(list, suggestion) -> Liste | null
// Ergebnis: { list, corrected, violations, attempts } - list = null heißt
// "nicht speichern", violations sind dann die übrig gebliebenen "block"-
// Verstöße, sonst die verbleibenden Hinweise ("warn"); corrected = Texte der
// automatisch übernommenen Korrekturen.
const PLAN_AI_MAX_ATTEMPTS = 2;
const PLAN_AUTOFIX_MAX_ROUNDS = 10;

async function checkedPlanFromAi({ ask, validate, fix }) {
  let feedback = [], blocks = [];
  for (let attempt = 1; attempt <= PLAN_AI_MAX_ATTEMPTS; attempt++) {
    const { base, list: proposed } = await ask(feedback);
    const known = validate(base);
    const fresh = l => newPlanViolations(known, validate(l));
    let list = proposed, violations = fresh(list);
    const firstBlocks = violations.filter(v => v.severity === "block");
    const corrected = [];
    for (let round = 0; round < PLAN_AUTOFIX_MAX_ROUNDS; round++) {
      const block = violations.find(v => v.severity === "block");
      const next = block && fix(list, block.suggestion);
      if (!next) break;
      corrected.push(block.suggestion.text);
      list = next;
      violations = fresh(list);
    }
    blocks = violations.filter(v => v.severity === "block");
    if (!blocks.length) return { list, corrected, violations, attempts: attempt };
    feedback = firstBlocks;
  }
  return { list: null, corrected: [], violations: blocks, attempts: PLAN_AI_MAX_ATTEMPTS };
}

// Ergebnis der letzten Prüfung (nur für die laufende Sitzung), angezeigt in
// der Trainingsplan-Kachel: { goalId, corrected: [Text], hints: [Text] }.
let planCheckNotes = null;

// Generiert die nächsten (rollierend) geplanten Tage für das Hauptevent-Ziel
// und speichert sie als plannedWorkouts (js/data/planned-workouts.js). Wird
// sowohl manuell (Button im Coach-Tab) als auch automatisch im Hintergrund
// aufgerufen (checkAutoReplan, js/app.js), sobald wenig geplante Tage übrig sind.
// `replace: true` (Button "Plan neu erstellen") löscht zuerst alle noch
// bevorstehenden geplanten Einheiten DIESES Ziels und plant dann komplett
// neu ab heute, statt wie sonst nur die Lücke nach dem letzten bereits
// geplanten Tag aufzufüllen (rollierendes Fenster, s.o.).
// Gespeichert wird erst nach der Regelprüfung (checkedPlanFromAi, s.o.).
// Kommt kein Plan zustande (KI-Fehler oder Regelverstoß), werden die vorher
// entfernten Einheiten wiederhergestellt - sonst stünde man ohne Plan da.
async function generateTrainingPlan(goalId, { replace = false } = {}) {
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return;
  const before = plannedWorkouts;
  if (replace) deleteFuturePlannedWorkoutsForGoal(goal.id);
  // Ein Plan gehört immer nur zu EINEM (dem aktuellen Haupt-)Ziel - ein noch
  // bevorstehender Plan eines früheren Hauptevents würde sonst weiterhin im
  // Kalender stehen und sich mit dem neuen Plan widersprechen.
  deleteFuturePlannedWorkoutsForOtherGoals(goal.id);
  const removed = before.filter(p => !plannedWorkouts.includes(p));
  const restoreRemoved = () => { if (removed.length) replacePlannedWorkouts([...plannedWorkouts, ...removed]); };
  const windowDates = computePlanningWindow(goal.id);
  goal._planLoading = true; goal._planError = null;
  renderTrainingPlanCard();
  renderCalendar();
  planCheckNotes = null;
  try {
    // Offene Terminwünsche (js/data/plan-wishes.js) im Fenster bekommt die KI
    // als feste Vorgabe; was sie trotzdem nicht einplant - oder was auf einem
    // schon verplanten Tag liegt -, ergänzt addOpenWishesToPlan() danach selbst.
    const wishes = openPlanWishes().filter(w => windowDates.includes(w.date));
    // Die Phase bekommt jede Einheit selbst aus ihrem Datum (buildPlannedWorkout).
    const defaults = { goalId: goal.id, source: "ai" };
    const planUntil = windowDates[windowDates.length - 1];
    let report = {};
    const result = await checkedPlanFromAi({
      ask: async violations => {
        const prompt = buildPlanPrompt(goal, windowDates) + buildPlanRulesPrompt(goal) + buildPlanWishesPrompt(wishes) + buildPlanRetryPrompt(violations);
        report = {};
        const entries = parsePlanResponse(await callAiText(prompt, { task: "plan", json: true }), windowDates, report);
        report.aiCount = entries.length;
        // Basis erst nach der (langen) KI-Anfrage lesen - Änderungen, die in
        // der Zwischenzeit gemacht wurden, bleiben so erhalten.
        const base = plannedWorkouts;
        const withAi = [...base, ...entries.map(entry => buildPlannedWorkout({ ...entry, ...defaults }))];
        return { base, list: addOpenWishesToPlan(withAi, planUntil, { ...defaults, source: "manual" }) };
      },
      validate: list => planRuleViolations(list, { planUntil }),
      fix: (list, suggestion) => applyPlanSuggestion(list, suggestion, defaults),
    });
    if (result.list) {
      // Sicherheitsnetz (js/analytics/plan-guard.js): Trainingstage, die die KI
      // leer gelassen hat, bekommen eine lockere Einheit - innerhalb der Regeln
      // (ein freier Tag pro Woche, Wochenumfang, keine neuen Verstöße).
      let finalList = result.list, filled = { added: [], skipped: [] };
      if (typeof planCheckFill === "function") {
        filled = planCheckFill(result.list, goal, windowDates[0], planUntil);
        finalList = filled.list;
      }
      replacePlannedWorkouts(finalList);
      goal.lastPlannedAt = new Date().toISOString();
      goal._planError = null;
      planCheckNotes = {
        goalId: goal.id, corrected: result.corrected, hints: result.violations.map(v => v.text),
        aiCount: report.aiCount || 0, dropped: report.dropped || [],
        filled: filled.added.map(p => ({ date: p.date, sport: p.sport, title: p.title, duration_min: p.duration_min })),
        skipped: filled.skipped,
      };
    } else {
      goal._planError = `Der KI-Vorschlag verstößt auch nach ${PLAN_AI_MAX_ATTEMPTS} Versuchen gegen Trainingsregeln und wurde deshalb nicht gespeichert: ${result.violations.map(v => v.text).join(" ")}`;
      restoreRemoved();
    }
  } catch (e) {
    goal._planError = describeAiError(e, "plan");
    restoreRemoved();
  } finally {
    goal._planLoading = false;
    saveGoals();
    renderTrainingPlanCard();
    renderCalendar();
  }
}

// "Sag dem Coach Bescheid" (Handy, Coach-Seite): freie Nachricht wie "heute
// spontan 45 min schwimmen" -> die KI plant die nächsten 7 Tage (ab heute)
// neu. Ersetzt werden nur noch offene ("geplant") Einheiten in diesem
// Zeitraum; Erledigtes/Übersprungenes bleibt. Dieselbe Regelprüfung wie beim
// normalen Plan (checkedPlanFromAi). Ergebnis: { reply, undo } - undo() stellt
// den Plan von vorher wieder her. Wirft bei KI-Fehler/Regelverstoß, der Plan
// bleibt dann unverändert.
const COACH_NOTE_DAYS = 7;
async function replanFromCoachNote(note) {
  const text = String(note || "").trim().slice(0, 500);
  if (!text) throw new Error("Schreib kurz, was der Coach ändern soll.");
  const goal = typeof getPrimaryGoal === "function" ? getPrimaryGoal() : null;
  if (!goal) throw new Error("Lege zuerst ein Hauptziel an – der Coach plant immer auf ein Ziel hin.");
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const windowDates = Array.from({ length: COACH_NOTE_DAYS }, (_, i) => localDateStr(new Date(todayMid.getTime() + i * 86400000)));
  const inWindow = p => windowDates.includes(p.date) && p.status === "geplant";
  const before = plannedWorkouts;
  const oldPlan = before.filter(inWindow).sort((a, b) => a.date.localeCompare(b.date));
  const defaults = { goalId: goal.id, source: "ai" };
  let reply = "";
  const result = await checkedPlanFromAi({
    ask: async violations => {
      const prompt = buildPlanPrompt(goal, windowDates) + buildPlanRulesPrompt(goal) + buildCoachNotePrompt(text, oldPlan, windowDates) + buildPlanRetryPrompt(violations);
      const raw = await callAiText(prompt, { task: "plan", json: true });
      let data = null;
      try { const m = raw.match(/\{[\s\S]*\}/); data = JSON.parse(m ? m[0] : raw); } catch (e) { /* parsePlanResponse meldet den Fehler */ }
      if (data && typeof data.antwort === "string") reply = data.antwort.trim().slice(0, 400);
      const entries = data && Array.isArray(data.workouts) && !data.workouts.length ? [] : parsePlanResponse(raw, windowDates);
      // Basis erst nach der KI-Anfrage lesen (Änderungen in der Zwischenzeit bleiben).
      const base = plannedWorkouts.filter(p => !inWindow(p));
      return { base, list: [...base, ...entries.map(entry => buildPlannedWorkout({ ...entry, ...defaults }))] };
    },
    validate: list => planRuleViolations(list, { planUntil: windowDates[windowDates.length - 1] }),
    fix: (list, suggestion) => applyPlanSuggestion(list, suggestion, defaults),
  });
  if (!result.list) throw new Error(`Der neue Plan verstößt gegen Trainingsregeln und wurde nicht übernommen: ${result.violations.map(v => v.text).join(" ")}`);
  replacePlannedWorkouts(result.list);
  // Tage, die der Coach auf deine Nachricht hin leer gemacht hat, bleiben frei
  // (der tägliche Plan-Check füllt sie nicht wieder auf).
  if (typeof planCheckMarkFree === "function") {
    oldPlan.map(p => p.date).filter(d => !result.list.some(p => p.date === d)).forEach(d => planCheckMarkFree(d, "coach"));
  }
  if (typeof renderTrainingPlanCard === "function") renderTrainingPlanCard();
  if (typeof renderCalendar === "function") renderCalendar();
  return {
    reply: reply || "Erledigt – dein Plan ist angepasst.",
    hints: result.violations.map(v => v.text),
    undo: () => {
      replacePlannedWorkouts(before);
      if (typeof renderTrainingPlanCard === "function") renderTrainingPlanCard();
      if (typeof renderCalendar === "function") renderCalendar();
    },
  };
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
      // Nennt die konkrete Vergleichsgruppe, damit nachvollziehbar ist, warum
      // z.B. Outdoor-Fahrten bei einer Indoor-Einheit absichtlich nicht zählen.
      error: `Noch nicht genug ähnliche Einheiten für einen Vergleich (aktuell ${comparable.length}, mindestens 3 nötig — ${comparisonGroupLabel(w)}, ${isIndoorRide(w) ? "Dauer" : "Distanz/Dauer"} ±20%).`,
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


/* ---------- Leistungszustand: KI-Zusammenfassung als Text (Coach-Tab) ---------- */

// Gleiches Zustands-Schema wie focusInsight oben (Text/Zeitpunkt/Ladezustand/
// Fehler), global statt pro Ziel/Einheit - gerendert von
// renderPerformanceSummary() (js/components/coach.js).
let performanceSummary = { text: null, at: null, loading: false, error: null };

async function generatePerformanceSummary() {
  performanceSummary.loading = true; performanceSummary.error = null;
  if (typeof renderPerformanceSummary === "function") renderPerformanceSummary();
  try {
    const prompt = buildPerformanceSummaryPrompt();
    const text = await callAiText(prompt, { task: "perfSummary" });
    performanceSummary.text = text;
    performanceSummary.at = new Date().toISOString();
    performanceSummary.error = null;
  } catch (e) {
    performanceSummary.error = describeAiError(e, "perfSummary");
  } finally {
    performanceSummary.loading = false;
    if (typeof renderPerformanceSummary === "function") renderPerformanceSummary();
  }
}


/* ---------- Empfehlungen Heute / Diese Woche / Nächste Woche (Coach-Tab) ---------- */

// Gleiches Zustands-Schema wie performanceSummary, gerendert von
// renderOutlook() (js/components/coach.js). `facts` = die Fakten, mit denen
// die Empfehlung erstellt wurde (buildOutlookFacts, context-builder.js).
// Nutzt dieselbe KI-Einstellung wie die Ziel-Empfehlung ("recommendation").
const OUTLOOK_HORIZONS = [
  { key: "heute", label: "Heute", facts: "today" },
  { key: "diese_woche", label: "Diese Woche", facts: "thisWeek" },
  { key: "naechste_woche", label: "Nächste Woche", facts: "nextWeek" },
];

let outlook = { result: null, facts: null, at: null, loading: false, error: null };

// Zahlen eines Textes ("1,15", "12.10", "45"); "1,15" und "1.15" sind gleich.
const outlookNumberTokens = text => String(text || "").match(/\d+(?:[.,]\d+)*/g) || [];
const outlookNumber = token => Number(token.replace(",", "."));

// Entfernt aus der KI-Begründung jeden Satz mit einer Zahl, die nicht im
// Prompt stand - eine solche Zahl hätte die KI erfunden. Erlaubt sind die
// Zahlen des Prompts und ihre Teile (aus "15.10." auch 15 und 10).
function keepPromptNumbers(text, promptText) {
  const allowed = new Set();
  outlookNumberTokens(promptText).forEach(t => {
    allowed.add(outlookNumber(t));
    t.split(/[.,]/).forEach(part => allowed.add(Number(part)));
  });
  return String(text || "").split(/(?<=[.!?])\s+/)
    .filter(sentence => outlookNumberTokens(sentence).every(t => allowed.has(outlookNumber(t))))
    .join(" ").trim();
}

function parseOutlookResponse(rawText, promptText) {
  let data;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    data = JSON.parse(match ? match[0] : rawText);
  } catch (e) {
    throw new Error("Antwort war kein gültiges JSON.");
  }
  const text = v => (typeof v === "string" ? v.trim().slice(0, 600) : "");
  const result = {};
  OUTLOOK_HORIZONS.forEach(h => {
    const item = (data && data[h.key]) || {};
    result[h.key] = { empfehlung: text(item.empfehlung), begruendung: keepPromptNumbers(text(item.begruendung), promptText) };
  });
  if (!OUTLOOK_HORIZONS.some(h => result[h.key].empfehlung)) throw new Error("Keine Empfehlungen in der Antwort gefunden.");
  return result;
}

async function generateOutlook() {
  outlook.loading = true; outlook.error = null;
  if (typeof renderOutlook === "function") renderOutlook();
  try {
    const facts = buildOutlookFacts();
    const prompt = buildOutlookPrompt(facts, getPrimaryGoal());
    const text = await callAiText(prompt, { task: "recommendation", json: true });
    outlook.result = parseOutlookResponse(text, prompt);
    outlook.facts = facts;
    outlook.at = new Date().toISOString();
  } catch (e) {
    outlook.error = describeAiError(e, "recommendation");
  } finally {
    outlook.loading = false;
    if (typeof renderOutlook === "function") renderOutlook();
  }
}
