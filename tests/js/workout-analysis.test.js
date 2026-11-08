// Tests für den Kontext der KI-Auswertung EINER Einheit (js/ai/context-builder.js):
// Zeitlinie (nur frühere Einheiten im Vergleich, spätere als "seitdem"),
// Notizen anderer Einheiten mit Datum, Körperwerte am Tag, Schwellenwerte.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const app = vm.createContext({ window: {}, console });
["js/utils/dates.js", "js/utils/formatting.js", "js/ai/context-builder.js"]
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);

// Fr 6.11. lockeres Schwimmen, Sa 7.11. CSS-Test mit Notiz, heute So 8.11.
const at = (d, h = 18) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00`);
const W = [
  { file: "a", sport: "Schwimmen", _date: at("2026-10-30"), distance_km: 1.5, duration_min: 40, pace_min_per_100m: "2:04" },
  { file: "fr", sport: "Schwimmen", _date: at("2026-11-06"), distance_km: 1.45, duration_min: 38, pace_min_per_100m: "1:52", training_load: 60 },
  { file: "sa", sport: "Schwimmen", title: "CSS-Test", _date: at("2026-11-07", 10), distance_km: 1.5, duration_min: 40, pace_min_per_100m: "1:55" },
];
app.DATA = W;
app.plannedWorkouts = [{ date: "2026-11-06", sport: "Schwimmen", title: "Lockeres Schwimmen", duration_min: 40, intensity: "leicht", description: "1.500 m locker" }];
app.athleteProfile = { swimCss: "1:55", swimCssTest: { date: "2026-11-07", t400: "7:20", t200: "3:30" } };
const NOTES = { sa: { rating: 4, note: "CSS-Test 1:55 in Baienfurt" } };
app.getWorkoutNote = f => NOTES[f] || null;
const daily = { "2026-11-06": { hrv_ms: 48, resting_hr: 52, sleep_min: 380 } };
for (let i = 1; i <= 10; i++) daily[`2026-10-${String(20 + i).padStart(2, "0")}`] = { hrv_ms: 60, resting_hr: 48 };
app.wellnessDaily = () => daily;
app.wellnessForDate = d => daily[run("localDateStr")(d)] || null;

test("Zeitlinie: Datum, geplant, Körperwerte, spätere Einheiten mit Notiz, aktuelle Schwelle", () => {
  app.__w = W[1];
  const text = run(`workoutTimelineContextLines(__w, new Date(2026, 10, 8, 9, 48)).join("\\n")`);
  assert.match(text, /Heute ist Sonntag, 08\.11\.2026\. Diese Einheit war am Freitag, 06\.11\.2026 \(vor 2 Tagen\)/);
  assert.match(text, /Geplant war an diesem Tag: „Lockeres Schwimmen“/);
  assert.match(text, /HRV 48 ms \(Mittel davor 60 ms\)/);
  assert.match(text, /Ruhepuls 52 bpm/);
  assert.match(text, /SEIT dieser Einheit schon absolviert.*Sa 07\.11\. Schwimmen „CSS-Test“ 1500 m.*Notiz: "CSS-Test 1:55 in Baienfurt"/);
  assert.match(text, /CSS 1:55 min\/100m \(aus CSS-Test vom 07\.11\.2026: 400 m in 7:20, 200 m in 3:30\)/);
});

test("Notizen anderer Einheiten stehen mit Datum und klar getrennt von dieser Einheit", () => {
  app.__c = [W[2]];
  const text = run(`workoutFeedbackContextLines(__c).join("\\n")`);
  assert.match(text, /ANDEREN Einheiten.*07\.11\.2026 \(„CSS-Test“\): "CSS-Test 1:55 in Baienfurt"/);
});

test("Vergleichsgruppe der Auswertung enthält nur frühere Einheiten", () => {
  const src = fs.readFileSync(path.join(ROOT, "js/ai/ollama.js"), "utf8");
  const ctx = vm.createContext({});
  vm.runInContext(src.match(/function workoutsBefore[\s\S]*?\n}\n/)[0], ctx);
  ctx.W = W;
  const files = vm.runInContext(`workoutsBefore(W[1], W).map(o => o.file)`, ctx);
  assert.deepStrictEqual([...files], ["a"]);
});
