// Tests für die Anzeige des Garmin-Datenchecks (js/components/garmin-datacheck.js).
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const app = vm.createContext({ console });
["js/utils/formatting.js", "js/components/garmin-datacheck.js"].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));

test("Datencheck: Zusammenfassung, Gruppen, Markierung je Status, Text sicher", () => {
  const html = app.garminCheckHtml({
    counts: { ok: 2, empty: 1, blocked: 1 },
    stopped: null,
    items: [
      { group: "Trainings", key: "rpe", label: "Gefühlte Anstrengung (RPE)", used: true, status: "ok", detail: "7/10 eingetragen" },
      { group: "Trainings", key: "laps", label: "Runden", used: true, status: "ok", detail: "2 Runden" },
      { group: "Gesundheit", key: "hrv", label: "HRV", used: true, status: "empty", detail: "Garmin hat dafür gerade keine Daten." },
      { group: "Belastung", key: "training_status", label: "Trainingszustand <b>", used: false, status: "blocked", detail: "Fehler 403" },
    ],
  });
  assert.match(html, /✅ 2 geliefert · ⚪ 1 leer · ⛔ 1 nicht freigegeben/);
  assert.strictEqual((html.match(/class="gc-group"/g) || []).length, 3);
  assert.match(html, /gc-row gc-blocked/);
  assert.match(html, /noch nicht genutzt/);
  assert.match(html, /Trainingszustand &lt;b&gt;/); // nie ungeprüftes HTML
  assert.doesNotMatch(html, /Abgebrochen/);
});

test("Datencheck: Abbruch wird erklärt, leeres Ergebnis zeigt nichts", () => {
  const html = app.garminCheckHtml({ counts: { skipped: 1 }, stopped: "Garmin blockt gerade.", items: [
    { group: "Gesundheit", key: "sleep", label: "Schlaf", used: true, status: "skipped", detail: "Nicht geprüft." }] });
  assert.match(html, /Abgebrochen: Garmin blockt gerade\./);
  assert.strictEqual(app.garminCheckHtml({ items: [] }), "");
  assert.strictEqual(app.garminCheckHtml(null), "");
});
