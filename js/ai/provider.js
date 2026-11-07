// Welche KI antwortet? Ist Claude auf dem Dashboard-Server eingerichtet und
// für diese Person freigegeben (js/ai/claude.js), läuft jede Aufgabe über
// Claude - sonst über Ollama auf dem Dashboard-PC (js/ai/ollama.js).
// generateRecommendation/generateTrainingPlan/... rufen nur callAiText auf.
//
// task-Namen: "plan", "analysis", "recommendation", "lessons", "focus",
// "perfSummary", "mobility" - der Server wählt daran Antwortlänge und
// Gründlichkeit (backend/claude_api.py).

async function callAiText(prompt, { task = "recommendation", json = false, schema = null } = {}) {
  await ensureClaudeStatus();
  if (claudeAvailable()) return callClaudeApi(prompt, { json, task, schema });
  return callOllamaApi(prompt, { json });
}

function currentAiProviderLabel() {
  return claudeAvailable() ? "KI-Coach" : "Ollama (lokal)";
}

function describeAiError(e) {
  return claudeAvailable() ? describeClaudeError(e) : describeCoachError(e);
}
