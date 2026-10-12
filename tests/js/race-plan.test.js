// Tests für den Rennplan (js/analytics/race-plan.js): Pacing je Disziplin aus
// Distanz + Zielzeit, ehrliche Angaben bei fehlenden Werten, Tage der
// Rennwoche und die Standard-Checklisten.
// Ausführen: node --test tests/js/
//
// Wie die übrigen Tests: die Browser-Skripte laufen in einem gemeinsamen
// vm-Kontext, gestubbt ist nichts.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/race-plan.js"];

const app = vm.createContext({});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const plain = x => JSON.parse(JSON.stringify(x)); // Objekte aus dem vm-Kontext haben eigene Prototypen

const tri = subDisciplines => ({ id: "g1", name: "Mitteldistanz", sport: "Triathlon", date: "2026-11-01", subDisciplines });
const byKey = legs => Object.fromEntries(plain(legs).map(l => [l.key, l]));

test("Zielzeit lesen: H:MM:SS und H:MM, alles andere null", () => {
  assert.strictEqual(app.parseRaceTargetTime("0:40:00"), 2400);
  assert.strictEqual(app.parseRaceTargetTime(" 2:30:00 "), 9000);
  assert.strictEqual(app.parseRaceTargetTime("5:30"), 19800); // wie im Ziel-Formular: 5 h 30 min
  assert.strictEqual(app.parseRaceTargetTime("1:60"), null);
  assert.strictEqual(app.parseRaceTargetTime("0:00"), null);
  assert.strictEqual(app.parseRaceTargetTime("abc"), null);
  assert.strictEqual(app.parseRaceTargetTime(""), null);
  assert.strictEqual(app.parseRaceTargetTime(null), null);
});

test("Triathlon: Pace je 100 m beim Schwimmen, km/h beim Rad, min/km beim Laufen", () => {
  const legs = byKey(app.computeRacePacing(tri([
    { key: "swim", label: "Schwimmen", distanceKm: 1.9, targetTime: "0:40:00" },
    { key: "bike", label: "Rad", distanceKm: 90, targetTime: "2:30:00" },
    { key: "run", label: "Laufen", distanceKm: 21.1, targetTime: "1:40:00" },
  ])));
  assert.deepStrictEqual(Object.keys(legs), ["swim", "bike", "run"]);
  assert.ok(Math.abs(legs.swim.value - 2400 / 19) < 1e-9);  // 126,3 s je 100 m
  assert.strictEqual(legs.swim.text, "2:06 /100 m");
  assert.strictEqual(legs.bike.value, 36);
  assert.strictEqual(legs.bike.text, "36 km/h");
  assert.ok(Math.abs(legs.run.value - 6000 / 21.1) < 1e-9); // 284,4 s je km
  assert.strictEqual(legs.run.text, "4:44 /km");
  assert.deepStrictEqual(legs.run.missing, []);
  assert.strictEqual(legs.run.seconds, 6000);
  assert.strictEqual(legs.run.distanceKm, 21.1);
});

test("fehlende oder unlesbare Angaben: keine Zahl, sondern was fehlt", () => {
  const legs = byKey(app.computeRacePacing(tri([
    { key: "swim", label: "Schwimmen", distanceKm: null, targetTime: "abc" },
    { key: "bike", label: "Rad", distanceKm: 90, targetTime: "2:50:00" },
    { key: "run", label: "Laufen", distanceKm: 21.1, targetTime: null },
  ])));
  assert.strictEqual(legs.swim.value, null);
  assert.strictEqual(legs.swim.text, null);
  assert.deepStrictEqual(legs.swim.missing, ["Distanz fehlt", "Zielzeit „abc“ nicht lesbar (Format H:MM:SS)"]);
  assert.ok(Math.abs(legs.bike.value - 90 / (10200 / 3600)) < 1e-9);
  assert.strictEqual(legs.bike.text, "31,8 km/h");
  assert.strictEqual(legs.run.value, null);
  assert.deepStrictEqual(legs.run.missing, ["Zielzeit fehlt"]);

  // Triathlon ganz ohne Unterdisziplinen: alle drei Disziplinen, jeweils "fehlt"
  const empty = plain(app.computeRacePacing(tri(null)));
  assert.deepStrictEqual(empty.map(l => l.key), ["swim", "bike", "run"]);
  empty.forEach(l => assert.deepStrictEqual(l.missing, ["Distanz fehlt", "Zielzeit fehlt"]));
});

test("Einzelsportart: eine Zeile aus Distanz + Zielzeit des Ziels", () => {
  const run = plain(app.computeRacePacing({ sport: "Laufen", distanceKm: 42.2, targetTime: "3:30" }));
  assert.strictEqual(run.length, 1);
  assert.strictEqual(run[0].text, "4:59 /km");
  const bike = plain(app.computeRacePacing({ sport: "Rad", distanceKm: 180, targetTime: "6:00:00" }));
  assert.strictEqual(bike[0].text, "30 km/h");
  const swim = plain(app.computeRacePacing({ sport: "Schwimmen", distanceKm: 3.8, targetTime: null }));
  assert.deepStrictEqual(swim[0].missing, ["Zielzeit fehlt"]);
  assert.deepStrictEqual(plain(app.computeRacePacing({ sport: "Sonstiges" })), []);
  assert.deepStrictEqual(plain(app.computeRacePacing(null)), []);
});

test("Rennwoche: Renntag und die 6 Tage davor mit eigenen Einheiten und Checklisten-Punkten", () => {
  const planned = [
    { id: "a", date: "2026-10-26", sport: "Laufen", title: "Locker" },
    { id: "b", date: "2026-10-31", sport: "Rad", title: "Vorbelastung" },
    { id: "c", date: "2026-10-25", sport: "Rad", title: "zu früh" },
  ];
  const items = [{ text: "Startunterlagen abholen", done: false, dayOffset: -1 }, { text: "Start", done: true, dayOffset: 0 }];
  const days = plain(app.raceWeekDays(tri(null), planned, items));
  assert.deepStrictEqual(days.map(d => d.date), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.deepStrictEqual(days.map(d => d.offset), [-6, -5, -4, -3, -2, -1, 0]);
  assert.deepStrictEqual(days[0].sessions.map(s => s.id), ["a"]);
  assert.deepStrictEqual(days[5].sessions.map(s => s.id), ["b"]);
  assert.deepStrictEqual(days[5].items, [{ text: "Startunterlagen abholen", done: false, dayOffset: -1, idx: 0 }]);
  assert.strictEqual(days[6].items[0].idx, 1);
  assert.deepStrictEqual(plain(app.raceWeekDays({ sport: "Laufen" }, planned, items)), []);
});

test("Standard-Checklisten: Wechselzone nur beim Triathlon, gespeicherter Plan wird kopiert", () => {
  const triPlan = plain(app.defaultRacePlan(tri(null)));
  assert.strictEqual(app.raceTransitionTitle(tri(null)), "Wechselzone");
  assert.ok(triPlan.transition.some(i => i.text.startsWith("Neoprenanzug")));
  assert.ok(triPlan.raceWeek.some(i => i.text === "Rad und Wechselbeutel einchecken" && i.dayOffset === -1));
  assert.ok(triPlan.nutrition.length > 0);
  [...triPlan.transition, ...triPlan.nutrition, ...triPlan.raceWeek].forEach(i => assert.strictEqual(i.done, false));
  triPlan.raceWeek.forEach(i => assert.ok(i.dayOffset >= -6 && i.dayOffset <= 0));

  const runGoal = { sport: "Laufen", date: "2026-11-01" };
  const runPlan = plain(app.defaultRacePlan(runGoal));
  assert.strictEqual(app.raceTransitionTitle(runGoal), "Ausrüstung");
  assert.ok(!runPlan.raceWeek.some(i => i.text === "Rad und Wechselbeutel einchecken"));
  assert.ok(runPlan.raceWeek.some(i => i.text === "Startunterlagen abholen"));

  const saved = { ...runGoal, racePlan: { transition: [{ text: "Eigene Schuhe", done: true }], nutrition: [], raceWeek: [] } };
  const copy = app.racePlanOf(saved);
  copy.transition[0].done = false;
  assert.strictEqual(saved.racePlan.transition[0].done, true);
  assert.deepStrictEqual(plain(app.racePlanOf(saved)).transition, [{ text: "Eigene Schuhe", done: true }]);
});
