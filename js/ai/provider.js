// Hybrid-Weiche: entscheidet je KI-Aufgabe, ob Ollama (lokal, kostenlos) oder
// die Claude API (bezahlt, siehe js/ai/claude.js) genutzt wird - Einstellung
// pro Aufgabe in den Einstellungen (Zahnrad → KI-Verbindung), damit z.B. nur
// die selten aufgerufene Trainingsplan-Erstellung ein stärkeres Modell nutzt,
// häufigere/kleinere Aufrufe (Workout-Analyse, Ziel-Empfehlung, Lessons
// Learned) aber lokal & kostenlos auf Ollama bleiben (siehe CHANGE_REQUESTS.md:
// "so effizient wie möglich, minimale API-Kosten"). Standard für ALLE
// Aufgaben ist Ollama - Claude muss bewusst pro Aufgabe aktiviert werden.

const HYBRID_SETTINGS_KEY = "triathlon_dashboard_hybrid_settings_v1";

// task-Namen: "plan" (Trainingsplan-Erstellung), "analysis" (Workout-Analyse),
// "recommendation" (Ziel-Empfehlung), "lessons" (Lessons Learned je Einheit),
// "focus" (Ist/Soll-Einordnung Trainingsbelastungsfokus).
let hybridSettings = { plan: "ollama", analysis: "ollama", recommendation: "ollama", lessons: "ollama", focus: "ollama" };

function loadHybridSettings() {
  try {
    const raw = localStorage.getItem(HYBRID_SETTINGS_KEY);
    if (raw) hybridSettings = { ...hybridSettings, ...JSON.parse(raw) };
  } catch (e) { /* Default beibehalten */ }
}

function saveHybridSettings() {
  try { localStorage.setItem(HYBRID_SETTINGS_KEY, JSON.stringify(hybridSettings)); } catch (e) { /* ignorieren */ }
}

// Zentraler Einstiegspunkt für alle KI-Text-Calls (Ollama ODER Claude,
// abhängig von hybridSettings[task]) - generateRecommendation/
// generateTrainingPlan/generateWorkoutAnalysis/generateLessons (ollama.js)
// rufen NUR NOCH das hier auf, statt Ollama fest zu verdrahten.
// Token-Limit je Aufgabe für die Claude API (Ollama hat kein festes Limit,
// läuft lokal bis zur natürlichen Antwortlänge durch) - der Trainingsplan
// liefert ein JSON mit mehreren Tagen inkl. Beschreibung/Übungen und
// braucht daher deutlich mehr Spielraum als die kurzen Fließtext-Antworten,
// sonst wird die Antwort mitten im JSON abgeschnitten (siehe
// CHANGE_REQUESTS.md: "Antwort war kein gültiges JSON"/"Leere Antwort").
const CLAUDE_TASK_MAX_TOKENS = { plan: 4000, analysis: 900, recommendation: 900, lessons: 700, focus: 500 };

async function callAiText(prompt, { task = "recommendation", json = false } = {}) {
  const provider = hybridSettings[task] || "ollama";
  if (provider === "claude") return callClaudeApi(prompt, { json, maxTokens: CLAUDE_TASK_MAX_TOKENS[task] || 900 });
  return callOllamaApi(prompt, { json });
}

function currentAiProviderLabel(task) {
  return (hybridSettings[task] || "ollama") === "claude" ? "Claude API" : "Ollama (lokal)";
}

// Wählt je nach genutztem Anbieter die passende Fehlerbeschreibung
// (describeCoachError für Ollama, describeClaudeError für Claude) - damit
// z.B. ein Claude-401-Fehler nicht fälschlich als Ollama-Problem angezeigt wird.
function describeAiError(e, task) {
  const provider = hybridSettings[task] || "ollama";
  return provider === "claude" ? describeClaudeError(e) : describeCoachError(e);
}
