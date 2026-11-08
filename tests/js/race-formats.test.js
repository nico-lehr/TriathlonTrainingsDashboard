// Tests für Wettkampf-Formate (js/data/race-formats.js): Distanz-Vorlagen,
// Staffel mit eigener Teilstrecke, Streckenart - und dass Rennplan,
// Rennverpflegung und Trainingsplan-Regeln bei einer Staffel nur die eigenen
// Teilstrecken berücksichtigen.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/data/race-formats.js", "js/utils/dates.js", "js/utils/formatting.js", "js/analytics/training-load.js",
  "js/analytics/plan-rules.js", "js/analytics/periodization.js", "js/analytics/nutrition.js", "js/analytics/race-plan.js"];

const app = vm.createContext({});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const plain = x => JSON.parse(JSON.stringify(x));

const olympicLegs = { swim: { distanceKm: "1.5", targetTime: "" }, bike: { distanceKm: "40", targetTime: "" }, run: { distanceKm: "10", targetTime: "0:45:00" } };
const relayRun = () => ({
  id: "r1", name: "Staffel-Tri", sport: "Triathlon", date: "2027-06-01",
  ...plain(app.goalRaceFields({ sport: "Triathlon", format: "olympic", relay: true, relayLegs: ["run"], terrain: "road", targetTime: "2:20:00", legs: olympicLegs })),
});

test("Formular-Werte: Staffel-Triathlon mit eigener Laufstrecke", () => {
  const g = relayRun();
  assert.strictEqual(g.format, "olympic");
  assert.strictEqual(g.relay, true);
  assert.deepStrictEqual(g.relayLegs, ["run"]);
  assert.strictEqual(g.terrain, "road");
  assert.strictEqual(g.distanceKm, 51.5); // Summe der Teilstrecken
  assert.strictEqual(g.targetTime, "2:20:00");
  assert.deepStrictEqual(g.subDisciplines.map(s => [s.key, s.distanceKm, s.targetTime]), [["swim", 1.5, null], ["bike", 40, null], ["run", 10, "0:45:00"]]);
});

test("Formular-Werte: Staffel nur beim Triathlon, unbekannte Vorlage/Streckenart werden verworfen", () => {
  const run = plain(app.goalRaceFields({ sport: "Laufen", format: "half", relay: true, relayLegs: ["run"], terrain: "trail", distanceKm: "21.1" }));
  assert.deepStrictEqual([run.format, run.relay, run.relayLegs, run.terrain, run.distanceKm, run.subDisciplines], ["half", false, null, "trail", 21.1, null]);
  const odd = plain(app.goalRaceFields({ sport: "Laufen", format: "olympic", terrain: "gravel", distanceKm: "" }));
  assert.deepStrictEqual([odd.format, odd.terrain, odd.distanceKm], [null, null, null]);
  const partly = plain(app.goalRaceFields({ sport: "Triathlon", legs: { swim: { distanceKm: "0.5" } } }));
  assert.strictEqual(partly.distanceKm, null); // Summe nur, wenn alle drei Distanzen da sind
  assert.strictEqual(partly.subDisciplines.length, 1);
});

test("Eigene Teilstrecken und Sportarten", () => {
  assert.deepStrictEqual(plain(app.goalOwnLegKeys(relayRun())), ["run"]);
  assert.deepStrictEqual(plain(app.goalRaceSports(relayRun())), ["Laufen"]);
  assert.deepStrictEqual(plain(app.goalRaceSports({ sport: "Triathlon" })), ["Schwimmen", "Rad", "Laufen"]);
  assert.deepStrictEqual(plain(app.goalRaceSports({ sport: "Triathlon", relay: true, relayLegs: [] })), ["Schwimmen", "Rad", "Laufen"]);
  assert.deepStrictEqual(plain(app.goalRaceSports({ sport: "Laufen", relay: true, relayLegs: ["swim"] })), ["Laufen"]);
  assert.deepStrictEqual(plain(app.goalRaceSports({ sport: "Sonstiges" })), []);
});

test("Kurzbeschreibung für Karten und KI", () => {
  assert.deepStrictEqual(plain(app.goalRaceBits(relayRun())), ["Olympisch", "Staffel – du machst: Laufen", "Straße"]);
  assert.deepStrictEqual(plain(app.goalRaceBits({ sport: "Triathlon", relay: true, relayLegs: ["swim", "bike"] })), ["Staffel – du machst: Schwimmen und Rad"]);
  assert.deepStrictEqual(plain(app.goalRaceBits({ sport: "Laufen", format: "marathon", terrain: "trail" })), ["Marathon", "Trail / Gelände"]);
  assert.deepStrictEqual(plain(app.goalRaceBits({ sport: "Laufen" })), []);
});

test("Rennplan bei der Staffel: Tempo nur für die eigene Teilstrecke, passende Checklisten", () => {
  const g = relayRun();
  const legs = plain(app.computeRacePacing(g));
  assert.deepStrictEqual(legs.map(l => [l.key, l.text]), [["run", "4:30 /km"]]);
  assert.strictEqual(app.raceTransitionTitle(g), "Staffel-Übergabe");
  const plan = plain(app.defaultRacePlan(g));
  assert.ok(plan.transition.some(i => i.text.startsWith("Übergabe mit dem Team")));
  assert.ok(plan.transition.some(i => i.text.startsWith("Laufschuhe")));
  assert.ok(!plan.transition.some(i => i.text.startsWith("Neoprenanzug")));
  assert.ok(!plan.raceWeek.some(i => i.text.startsWith("Rad und Wechselbeutel")));
  assert.ok(plan.raceWeek.some(i => i.text === "Wettkampfbesprechung"));
  const bikeRelay = { ...g, relayLegs: ["bike"] };
  assert.ok(plain(app.defaultRacePlan(bikeRelay)).raceWeek.some(i => i.text.startsWith("Rad und Wechselbeutel")));
});

test("Rennverpflegung bei der Staffel: nur die eigenen Teilstrecken", () => {
  const g = relayRun();
  g.subDisciplines = g.subDisciplines.map(s => ({ ...s, targetTime: s.key === "bike" ? "1:10:00" : s.key === "run" ? "0:45:00" : "0:25:00" }));
  app.getPrimaryGoal = () => g;
  app.athleteProfile = { weightKg: 70 };
  const plan = plain(app.computeRaceFuelingPlan());
  assert.deepStrictEqual(plan.legs.map(l => l.key), ["run"]);
});

test("Trainingsplan-Regeln: bei der Staffel nur die eigene Sportart", () => {
  const text = app.planRulesText(relayRun());
  assert.match(text, /in jeder Sportart des Ziels: Laufen\./);
  assert.match(app.planRulesText({ sport: "Triathlon", date: "2027-06-01" }), /Schwimmen, Rad, Laufen/);
});
