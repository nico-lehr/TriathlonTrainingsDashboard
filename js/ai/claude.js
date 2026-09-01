// Anbindung an die Claude API (Anthropic) - Alternative zu Ollama fuer wer
// keine lokale GPU/kein Ollama nutzen will oder für Aufgaben, bei denen ein
// stärkeres Modell den Unterschied macht (Trainingsplan-Erstellung, siehe
// js/ai/provider.js für die Aufgaben->Anbieter-Weiche). Läuft komplett aus
// dem Browser heraus (kein eigenes Backend nötig, Phase 1) über den
// "anthropic-dangerous-direct-browser-access"-Header, den Anthropic genau
// für diesen Fall (persönliches/lokales Tool, eigener API-Key) anbietet.
//
// Kosten-Vorsicht (siehe CHANGE_REQUESTS.md: "so effizient wie möglich, nur
// minimale API-Kosten"): Standardmodell ist bewusst das güntigste verfügbare
// (Claude Haiku), max_tokens ist knapp bemessen, und der Hybrid-Modus
// (provider.js) schickt nur die selten aufgerufene Trainingsplan-Erstellung
// hierher - häufigere Aufrufe (Workout-Analyse, Ziel-Empfehlung) bleiben auf
// Ollama (lokal, kostenlos), siehe Standardeinstellung dort.

const CLAUDE_SETTINGS_KEY = "triathlon_dashboard_claude_settings_v1";
const CLAUDE_DEFAULT_MODEL = "claude-haiku-4-5-20251001"; // güntigstes Modell (Stand siehe README) - austauschbar in den Einstellungen

let claudeSettings = { apiKey: "", model: CLAUDE_DEFAULT_MODEL };

function loadClaudeSettings() {
  try {
    const raw = localStorage.getItem(CLAUDE_SETTINGS_KEY);
    if (raw) claudeSettings = { ...claudeSettings, ...JSON.parse(raw) };
  } catch (e) { /* Default beibehalten */ }
}

function saveClaudeSettings() {
  try { localStorage.setItem(CLAUDE_SETTINGS_KEY, JSON.stringify(claudeSettings)); } catch (e) { /* ignorieren */ }
}

function describeClaudeError(e) {
  const msg = String((e && e.message) || e || "");
  if (/401/.test(msg)) return "Claude API-Key ungültig oder abgelaufen (401). Key in den Einstellungen prüfen.";
  if (/429/.test(msg)) return "Claude API: Rate-Limit erreicht (429) - kurz warten und erneut versuchen.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Claude API nicht erreichbar (kein Internet oder blockiert).";
  if (/max_tokens erreicht/i.test(msg)) return msg; // bereits ausformulierter Hinweis, siehe callClaudeApi
  return "Fehler bei der Anfrage an Claude: " + msg;
}

// Ein einzelner Text-Call an die Claude Messages API - bewusst schlank
// gehalten (ein User-Turn, kein System-Prompt-Overhead, keine Historie), da
// jeder zusätzliche Token hier bares Geld kostet (anders als bei Ollama).
// `json`: hängt eine knappe Anweisung an, nur das JSON-Objekt zu liefern -
// die Claude API hat kein eigenes "format:json"-Flag wie Ollama, das
// Ergebnis wird trotzdem wie bei Ollama per parsePlanResponse() robust
// geparst (schneidet sich den ersten {...}-Block heraus).
async function callClaudeApi(prompt, { json = false, maxTokens = 1200 } = {}) {
  if (!claudeSettings.apiKey) throw new Error("Kein Claude API-Key hinterlegt (Einstellungen → KI-Verbindung).");
  const fullPrompt = json
    ? prompt + "\n\nAntworte AUSSCHLIESSLICH mit dem rohen JSON-Objekt, kein Text davor/danach, keine Code-Block-Markierung. Halte die Antwort so kompakt wie möglich (kurze description-Texte), damit sie sicher innerhalb des Token-Limits vollständig ist."
    : prompt;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": claudeSettings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: claudeSettings.model || CLAUDE_DEFAULT_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: fullPrompt }],
    }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error?.message || ""; } catch (e) { /* ignorieren */ }
    throw new Error("Status " + res.status + (detail ? ": " + detail.slice(0, 200) : ""));
  }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  // stop_reason "max_tokens": die Antwort wurde mitten im Satz/JSON
  // abgeschnitten, bevor sie fertig war (nicht nur ein leeres Ergebnis) -
  // das war die Ursache für "kein gültiges JSON" bzw. eine leere Antwort bei
  // der Trainingsplan-Erstellung (siehe CHANGE_REQUESTS.md). Eigene,
  // verständliche Fehlermeldung statt eines kryptischen JSON-Parse-Fehlers.
  if (data.stop_reason === "max_tokens") {
    throw new Error(`Antwort war unvollständig, max_tokens erreicht (Limit: ${maxTokens}) - bitte ein kürzeres Zeitfenster/weniger Text versuchen oder in claude.js das Token-Limit für diese Aufgabe erhöhen.`);
  }
  if (!text) throw new Error("Leere Antwort von Claude erhalten (stop_reason: " + (data.stop_reason || "unbekannt") + ").");
  return text;
}

async function testClaudeConnection() {
  const statusEl = document.getElementById("claude-test-status");
  if (!statusEl) return;
  statusEl.textContent = "Teste Verbindung …";
  statusEl.className = "coach-test-status";
  try {
    const text = await callClaudeApi("Antworte NUR mit dem einen Wort: OK", { maxTokens: 10 });
    if (/ok/i.test(text)) {
      statusEl.textContent = `✓ Verbunden — Modell "${claudeSettings.model}" antwortet.`;
      statusEl.className = "coach-test-status ok";
    } else {
      statusEl.textContent = `Verbunden, aber unerwartete Antwort: "${text.slice(0, 60)}"`;
      statusEl.className = "coach-test-status warn";
    }
  } catch (e) {
    statusEl.textContent = describeClaudeError(e);
    statusEl.className = "coach-test-status err";
  }
}
