// Claude über den Dashboard-Server (backend/claude_api.py): Der Betreiber
// hinterlegt den Schlüssel einmal in den Einstellungen ("KI-Coach"), danach
// nutzt jedes Gerät Claude, ohne dass der Schlüssel je im Browser liegt.
// Ist Claude für diese Person verfügbar, laufen ALLE KI-Aufgaben darüber
// (js/ai/provider.js), sonst wie bisher über Ollama.

const CLAUDE_LEGACY_SETTINGS_KEY = "triathlon_dashboard_claude_settings_v1"; // alter Browser-Schlüssel - wird entfernt
const CLAUDE_CHAT_TIMEOUT_MS = 6 * 60 * 1000;

let claudeStatus = null; // Antwort von GET ai/claude, null = unbekannt/Server nicht erreichbar
let claudeStatusPromise = null;

function refreshClaudeStatus() {
  claudeStatusPromise = apiCall("ai/claude")
    .then(res => { claudeStatus = res.data || null; return claudeStatus; })
    .catch(() => { claudeStatus = null; return null; });
  return claudeStatusPromise;
}

async function ensureClaudeStatus() {
  if (claudeStatus) return claudeStatus;
  return claudeStatusPromise || refreshClaudeStatus();
}

function claudeAvailable() {
  return !!(claudeStatus && claudeStatus.available);
}

// Der frühere Browser-Schlüssel hat dort nichts mehr verloren.
function forgetLegacyClaudeKey() {
  try { localStorage.removeItem(CLAUDE_LEGACY_SETTINGS_KEY); } catch (e) { /* ignorieren */ }
}

// Ein Text-Aufruf. `schema`: JSON-Schema - Claude liefert dann garantiert
// gültiges JSON in genau dieser Form. `json` ohne Schema: nur die Bitte,
// reines JSON zu liefern (geparst wird ohnehin robust).
async function callClaudeApi(prompt, { json = false, task = "", schema = null } = {}) {
  const fullPrompt = json && !schema
    ? prompt + "\n\nAntworte ausschließlich mit dem rohen JSON-Objekt – kein Text davor oder danach, keine Code-Block-Markierung."
    : prompt;
  const res = await apiCall("ai/claude/chat", "POST", { prompt: fullPrompt, task, schema }, { timeoutMs: CLAUDE_CHAT_TIMEOUT_MS });
  const text = ((res.data && res.data.response) || "").trim();
  if (!text) throw new Error("Der KI-Coach hat keine Antwort geliefert. Bitte noch einmal versuchen.");
  return text;
}

// Die Meldungen des Servers sind schon verständlich formuliert.
function describeClaudeError(e) {
  return String((e && e.message) || e || "Unbekannter Fehler beim KI-Coach.");
}
