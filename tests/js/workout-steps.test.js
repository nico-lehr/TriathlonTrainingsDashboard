// Tests für die Schritte einer geplanten Einheit (validateWorkoutSteps,
// defaultWorkoutSteps, plannedWorkoutSteps in js/data/planned-workouts.js)
// und ihre Umsetzung in die .fit-Workout-Datei (js/data/fit-workout-writer.js).
// Ausführen: node --test tests/js/
//
// Wie planned-workouts.test.js: Browser-Skripte in einem gemeinsamen
// vm-Kontext; gestubbt sind Server-Ablage, Timer, goals und athleteProfile
// (sonst js/data/athlete.js - daraus liest zones.js die Schwellenpace).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/periodization.js", "js/analytics/zones.js",
  "js/data/planned-workouts.js", "js/data/fit-workout-writer.js"];

const app = vm.createContext({
  DATA: [], window: {}, TextEncoder, setTimeout: () => 0, clearTimeout: () => {},
  apiCall: () => Promise.resolve({}), storeGet: () => null, storeSet: () => {},
  goals: [], athleteProfile: { runThresholdPace: null, swimCss: null },
});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const plain = x => JSON.parse(JSON.stringify(x)); // Objekte aus dem vm-Kontext haben eigene Prototypen

const defaults = pw => plain(app.defaultWorkoutSteps(pw));
const validate = steps => plain(app.validateWorkoutSteps(steps));
const NONE = { kind: "none" };

/* ---------- Standard-Schritte aus Dauer + Intensität ---------- */

test("Standard: Ausdauer ab 30 min = Aufwärmen / Hauptteil in der HF-Zone der Intensität / Abwärmen", () => {
  assert.deepStrictEqual(defaults({ sport: "Laufen", duration_min: 50, intensity: "leicht" }), [
    { type: "warmup", duration_min: 10, target: NONE },
    { type: "interval", duration_min: 35, target: { kind: "hr_zone", zone: 2 } },
    { type: "cooldown", duration_min: 5, target: NONE },
  ]);
  assert.deepStrictEqual(defaults({ sport: "Rad", duration_min: 90, intensity: "hart" }), [
    { type: "warmup", duration_min: 15, target: NONE },
    { type: "interval", duration_min: 65, target: { kind: "hr_zone", zone: 4 } },
    { type: "cooldown", duration_min: 10, target: NONE },
  ]);
  assert.deepStrictEqual(defaults({ sport: "Laufen", duration_min: 40, intensity: "mittel" })[1].target, { kind: "hr_zone", zone: 3 });
});

test("Standard: die Schritte ergeben zusammen genau die geplante Dauer", () => {
  [30, 45, 59, 60, 75, 180].forEach(d => {
    const sum = defaults({ sport: "Rad", duration_min: d, intensity: "leicht" }).reduce((s, x) => s + x.duration_min, 0);
    assert.strictEqual(sum, d, `${d} min`);
  });
});

test("Standard: Schwimmen und Einheiten ohne Intensität bekommen kein Ziel", () => {
  assert.ok(defaults({ sport: "Schwimmen", duration_min: 45, intensity: "hart" }).every(s => s.target.kind === "none"));
  assert.ok(defaults({ sport: "Laufen", duration_min: 45, intensity: null }).every(s => s.target.kind === "none"));
});

test("Standard: kurze Einheit, Kraft/Mobility und Einheit ohne Dauer = ein einziger Schritt", () => {
  assert.deepStrictEqual(defaults({ sport: "Laufen", duration_min: 20, intensity: "leicht" }), [{ type: "interval", duration_min: 20, target: { kind: "hr_zone", zone: 2 } }]);
  assert.deepStrictEqual(defaults({ sport: "Kraft", duration_min: 45, intensity: "hart" }), [{ type: "interval", duration_min: 45, target: NONE }]);
  assert.deepStrictEqual(defaults({ sport: "Rad", duration_min: null, intensity: "leicht" }), [{ type: "interval", target: { kind: "hr_zone", zone: 2 } }]);
});

/* ---------- Prüfen eigener Schritte ---------- */

const INTERVALS = [
  { type: "warmup", duration_min: 15, extra: "weg" },
  { type: "repeat", count: 6, steps: [
    { type: "interval", distance_km: 0.4, target: { kind: "pace_zone", zone: 4 } },
    { type: "recovery", duration_min: 1.5, target: { kind: "none" } },
  ] },
  { type: "cooldown" },
];

test("gültige Schritte werden bereinigt übernommen (Ziel fehlt = ohne Ziel, fremde Felder fallen weg)", () => {
  const out = validate(INTERVALS);
  assert.deepStrictEqual(out.errors, []);
  assert.deepStrictEqual(out.steps, [
    { type: "warmup", duration_min: 15, target: NONE },
    { type: "repeat", count: 6, steps: [
      { type: "interval", distance_km: 0.4, target: { kind: "pace_zone", zone: 4 } },
      { type: "recovery", duration_min: 1.5, target: NONE },
    ] },
    { type: "cooldown", target: NONE },
  ]);
});

test("ungültige Schritte: steps = null und eine verständliche Meldung je Fehler", () => {
  const bad = (steps, text) => {
    const out = validate(steps);
    assert.strictEqual(out.steps, null);
    assert.ok(out.errors.some(e => e.includes(text)), `${JSON.stringify(out.errors)} enthält nicht "${text}"`);
  };
  bad(null, "Keine Schritte");
  bad([], "Keine Schritte");
  bad([{ type: "sprint", duration_min: 5 }], "unbekannte Art");
  bad([{ type: "interval", duration_min: 5, distance_km: 1 }], "nicht beides");
  bad([{ type: "interval", duration_min: -5 }], "Dauer ungültig");
  bad([{ type: "interval", distance_km: "1" }], "Distanz ungültig");
  bad([{ type: "interval", duration_min: 5, target: { kind: "hr_zone", zone: 6 } }], "Zone 1–5");
  bad([{ type: "interval", duration_min: 5, target: { kind: "laktat", zone: 2 } }], "unbekanntes Ziel");
  bad([{ type: "repeat", count: 0, steps: [{ type: "interval", duration_min: 1 }] }], "Wiederholungen 1–50");
  bad([{ type: "repeat", count: 3, steps: [] }], "ohne Schritte");
  bad([{ type: "repeat", count: 2, steps: [{ type: "repeat", count: 2, steps: [{ type: "rest" }] }] }], "keine Wiederholung in einer Wiederholung");
  bad(Array.from({ length: 51 }, () => ({ type: "interval", duration_min: 1 })), "Höchstens 50");
  bad([{ type: "warmup", duration_min: 5 }, { type: "repeat", count: 2, steps: [{ type: "interval", duration_min: "x" }] }], "Schritt 2.1");
});

test("plannedWorkoutSteps: eigene gültige Schritte, sonst die Standard-Schritte", () => {
  const base = { sport: "Laufen", duration_min: 50, intensity: "leicht" };
  assert.deepStrictEqual(plain(app.plannedWorkoutSteps({ ...base, steps: INTERVALS })), validate(INTERVALS).steps);
  assert.deepStrictEqual(plain(app.plannedWorkoutSteps({ ...base, steps: null })), defaults(base));
  assert.deepStrictEqual(plain(app.plannedWorkoutSteps({ ...base, steps: [{ type: "kaputt" }] })), defaults(base));
});

test("buildPlannedWorkout übernimmt gültige Schritte und verwirft ungültige", () => {
  const entry = { date: "2026-10-14", sport: "Laufen", duration_min: 50, intensity: "hart" };
  assert.deepStrictEqual(plain(app.buildPlannedWorkout({ ...entry, steps: INTERVALS })).steps, validate(INTERVALS).steps);
  assert.strictEqual(app.buildPlannedWorkout({ ...entry, steps: [{ type: "kaputt" }] }).steps, null);
  assert.strictEqual(app.buildPlannedWorkout(entry).steps, null);
});

/* ---------- .fit-Datei ---------- */

test(".fit: Wiederholung steht hinter ihren Schritten und zeigt auf den ersten davon", () => {
  app.athleteProfile.runThresholdPace = null;
  const recs = plain(app.fitWorkoutStepRecords({ sport: "Laufen", title: "6x400", steps: INTERVALS }));
  assert.deepStrictEqual(recs.map(r => [r.name, r.durationType, r.durationValue, r.targetType, r.targetValue, r.intensity]), [
    ["Aufwärmen", 0, 900000, 2, 0, 2],     // 15 min in ms, ohne Ziel, warmup
    ["Belastung", 1, 40000, 2, 0, 0],      // 400 m in cm; Pace-Zone ohne Schwellenpace -> ohne Ziel
    ["Erholung", 0, 90000, 2, 0, 4],
    ["Wiederholung", 6, 1, 2, 6, 0xFF],    // ab Schritt 1, 6 Durchgänge
    ["Abwärmen", 5, 0, 2, 0, 3],           // ohne Dauer = offen
  ]);
});

test(".fit: HF-/Leistungszone als Zonennummer, Pace-Zone als Tempobereich aus der Schwellenpace", () => {
  app.athleteProfile.runThresholdPace = "5:00"; // Z4 = 0,98-1,05 x 300 s/km = 4:54-5:15 /km
  const recs = plain(app.fitWorkoutStepRecords({ sport: "Laufen", steps: [
    { type: "interval", duration_min: 10, target: { kind: "hr_zone", zone: 3 } },
    { type: "interval", duration_min: 10, target: { kind: "power_zone", zone: 2 } },
    { type: "interval", duration_min: 10, target: { kind: "pace_zone", zone: 4 } },
  ] }));
  assert.deepStrictEqual(recs.map(r => [r.targetType, r.targetValue]), [[1, 3], [4, 2], [0, 0]]);
  assert.strictEqual(recs[2].low, Math.round(1000 / 315 * 1000));  // langsamer Rand 5:15 /km in mm/s
  assert.strictEqual(recs[2].high, Math.round(1000 / 294 * 1000)); // schneller Rand 4:54 /km
  app.athleteProfile.runThresholdPace = null;
});

test(".fit: eine Einheit ohne eigene Schritte heißt wie bisher nach ihrem Titel, Datei-CRC stimmt", () => {
  const pw = { sport: "Rad", title: "Locker rollen", duration_min: 20, intensity: "leicht" };
  assert.deepStrictEqual(plain(app.fitWorkoutStepRecords(pw)).map(r => r.name), ["Locker rollen"]);
  const bytes = app.buildFitWorkoutFile({ ...pw, duration_min: 60 });
  const dataSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  assert.strictEqual(bytes.length, 14 + dataSize + 2);
  assert.strictEqual(String.fromCharCode(...bytes.slice(8, 12)), ".FIT");
  const crc = app.fitCrc16(bytes.slice(0, bytes.length - 2));
  assert.strictEqual(bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8), crc);
});
