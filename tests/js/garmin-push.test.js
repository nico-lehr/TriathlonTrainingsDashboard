// Tests für "Trainings auf die Uhr" im Browser (js/data/garmin-push.js):
// welche Einheiten mitgehen, wie Kraft-/Mobility-Übungen für Garmin
// aufbereitet werden, und der Stand je Einheit. Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/periodization.js", "js/analytics/zones.js",
  "js/data/planned-workouts.js", "js/data/fit-workout-writer.js", "js/data/garmin-push.js"];

const calls = [];
const app = vm.createContext({
  DATA: [], window: {}, TextEncoder, setTimeout: () => 0, clearTimeout: () => {},
  apiCall: (url, method, body) => { calls.push({ url, body }); return Promise.resolve({ data: { links: { a: { garmin_workout_id: 1 } }, created: 1 } }); },
  storeGet: () => null, storeSet: () => {}, storeSaved: () => Promise.resolve(),
  goals: [], athleteProfile: { runThresholdPace: null, swimCss: null },
  MOBILITY_BY_ID: { taube: { id: "taube", name: "Taube", kind: "hold", seconds: 40, sides: true } },
  STRENGTH_BY_ID: { "goblet-kniebeuge": { id: "goblet-kniebeuge", name: "Goblet-Kniebeuge", sets: 3, reps: "10", rest: 75, weight: true, startKg: 12, equipment: ["dumbbells"] } },
  strengthWeight: () => 14,
});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const plain = x => JSON.parse(JSON.stringify(x));
const day = n => app.localDateStr(new Date(Date.now() + n * 86400000));

test("Kraft und Mobility: Übungen mit Namen, Sätzen, Sekunden und Gewicht aus der Sammlung", () => {
  assert.deepStrictEqual(plain(app.garminExercises({ sport: "Mobility", exercises: [{ id: "taube", seconds: 45 }] })),
    [{ id: "taube", name: "Taube", sides: true, note: null, seconds: 45, reps: null }]);
  const k = plain(app.garminExercises({ sport: "Kraft", exercises: [{ id: "goblet-kniebeuge" }, { name: "Eigene", sets: 2, reps: "8" }] }));
  assert.deepStrictEqual(k[0], { id: "goblet-kniebeuge", name: "Goblet-Kniebeuge", sets: 3, note: null, reps: 10, seconds: null, sides: false, rest_s: 75, weight_kg: 14 });
  assert.strictEqual(k[1].name, "Eigene");
  assert.strictEqual(app.garminSupported({ sport: "Kraft", exercises: [] }), false);
  assert.strictEqual(app.garminSupported({ sport: "Kraft", exercises: [{ name: "X" }] }), true);
  assert.strictEqual(app.garminSupported({ sport: "Ruhetag" }), false);
});

test("Mit geht nur Geplantes im eingestellten Fenster (heute / 7 Tage / keins) plus von Hand Gesendetes", () => {
  app.replacePlannedWorkouts([
    { id: "a", date: day(0), sport: "Laufen", duration_min: 40, status: "geplant" },
    { id: "b", date: day(6), sport: "Rad", duration_min: 60, status: "geplant" },
    { id: "c", date: day(7), sport: "Rad", duration_min: 60, status: "geplant" },
    { id: "d", date: day(2), sport: "Laufen", duration_min: 40, status: "erledigt" },
    { id: "e", date: day(-1), sport: "Laufen", duration_min: 40, status: "geplant" },
    { id: "f", date: day(20), sport: "Schwimmen", duration_min: 40, status: "geplant" },
  ]);
  const ids = () => plain(app.garminPushCandidates().map(p => p.id)).sort();
  vm.runInContext("garminPush.links = { f: { pinned: true } }; garminPush.auto = true; garminPush.mode = 'week'; garminPush.window_days = 7", app);
  assert.deepStrictEqual(ids(), ["a", "b", "f"]);
  vm.runInContext("garminPush.mode = 'today'; garminPush.window_days = 1", app); // Standard: nur heute
  assert.deepStrictEqual(ids(), ["a", "f"]);
  vm.runInContext("garminPush.mode = 'manual'; garminPush.auto = false; garminPush.window_days = 0", app); // nur per Knopf
  assert.deepStrictEqual(ids(), ["f"]);
});

test("Abgleich schickt Schritte mit, Stand je Einheit", async () => {
  calls.length = 0;
  app.replacePlannedWorkouts([{ id: "a", date: day(0), sport: "Laufen", duration_min: 40, intensity: "leicht", status: "geplant" },
    { id: "z", date: day(30), sport: "Schwimmen", duration_min: 45, intensity: "mittel", status: "geplant" }]);
  vm.runInContext("garminPush = { ...garminPush, loaded: true, connected: true, auto: true, mode: 'today', window_days: 1, links: {}, busy: false }", app);
  assert.deepStrictEqual(plain(app.garminWatchStatus({ id: "a" })), { text: "Kommt auf die Uhr", kind: "wait" });
  await app.runGarminPush();
  const sync = calls.find(c => c.url === "garmin/workouts/sync");
  assert.strictEqual(sync.body.items[0].id, "a");
  // detaillierter Ablauf: Einlaufen, Grundlage, 4× Steigerung, Auslaufen
  assert.deepStrictEqual(plain(sync.body.items[0].steps.map(s => s.type)), ["warmup", "interval", "repeat", "cooldown"]);
  // auch Einheiten weit hinter dem Fenster schicken ihre Schritte mit (der Server merkt sie sich)
  assert.deepStrictEqual(plain(sync.body.items.map(i => i.id)), ["a", "z"]);
  assert.deepStrictEqual(plain(app.garminWatchStatus({ id: "a" })), { text: "Auf der Uhr", kind: "ok" });
  // "nur per Knopf": der Abgleich läuft trotzdem (räumt auf, aktualisiert Gesendetes)
  calls.length = 0;
  vm.runInContext("garminPush.auto = false; garminPush.mode = 'manual'; garminPush.window_days = 0", app);
  await app.runGarminPush();
  assert.ok(calls.some(c => c.url === "garmin/workouts/sync"));
  vm.runInContext("garminPush.connected = false", app);
  assert.strictEqual(app.garminWatchStatus({ id: "a" }), null);
});
