// Tests für die Wochenplan-Struktur (js/analytics/plan-structure.js):
// Trainingstage, Schwimmtage, Einheiten pro Tag, Kraft/Mobility pro Woche.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/training-load.js", "js/analytics/plan-rules.js", "js/analytics/periodization.js",
  "js/data/planned-workouts.js", "js/analytics/plan-guard.js", "js/analytics/plan-structure.js"];

const store = {};
const GOAL = { id: "g1", name: "Ironman 70.3", sport: "Triathlon", date: "2027-06-13", isPrimary: true };
const app = vm.createContext({
  DATA: [], window: {}, setTimeout: () => 0, clearTimeout: () => {},
  apiCall: () => Promise.resolve({}),
  storeGet: key => (key in store ? JSON.parse(JSON.stringify(store[key])) : null),
  storeSet: (key, value) => { store[key] = JSON.parse(JSON.stringify(value)); },
  PLAN_ALLOWED_SPORTS: ["Schwimmen", "Rad", "Laufen", "Kraft", "Mobility"],
  goals: [GOAL],
});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x));
app.__ = {};
const call = (fn, ...args) => { app.__.args = args; return plain(run(`${fn}(...__.args)`)); };

// Montag, 9.11.2026 bis Sonntag, 15.11.2026
const D = { mo: "2026-11-09", di: "2026-11-10", mi: "2026-11-11", do: "2026-11-12", fr: "2026-11-13", sa: "2026-11-14", so: "2026-11-15" };
let nextId = 1;
const pw = (date, sport, duration_min = 45, intensity = "leicht", extra = {}) =>
  ({ id: "pw" + nextId++, date, sport, title: `${sport} ${intensity}`, duration_min, intensity, status: "geplant", goalId: "g1", ...extra });

const PROFILE = { trainingDays: ["mo", "di", "mi", "do", "fr", "sa"], swimDays: ["mo", "do"], longDays: ["sa"], typicalSessionMin: 50, includeStrength: true, includeMobility: true, strengthPerWeek: 2 };
const settings = (profile = {}, tp = { mobilityPerWeek: 2 }) => call("planStructureSettings", { ...PROFILE, ...profile }, tp);

function apply(list, profile, mutable = list.map(p => p.id)) {
  return call("planStructureApply", list, { settings: settings(profile), mutableIds: mutable, from: D.mo, to: D.so, todayKey: D.mo, goal: GOAL, defaults: { goalId: "g1", source: "ai" } });
}
const byDay = list => Object.fromEntries(Object.entries(D).map(([wd, d]) => [wd, list.filter(p => p.date === d).map(p => p.sport).sort()]));

test("Einstellungen: Schwimmtage nur innerhalb der Trainingstage, sinnvolle Standards", () => {
  const s = settings({ swimDays: ["mo", "so"], mainPerDay: 5, strengthPerWeek: 9 });
  assert.deepStrictEqual(s.swimDays, ["mo"]);
  assert.strictEqual(s.mainPerDay, 1);
  assert.strictEqual(s.strengthPerWeek, 2);
  assert.strictEqual(s.extrasSameDay, true);
  assert.strictEqual(settings({ includeStrength: false }).strengthPerWeek, 0);
});

test("Schwimmen am falschen Tag wandert auf den freien Schwimmtag", () => {
  const list = [pw(D.mo, "Laufen"), pw(D.di, "Schwimmen"), pw(D.mi, "Rad"), pw(D.do, "Laufen"), pw(D.fr, "Rad"), pw(D.sa, "Rad", 120)];
  const res = apply(list);
  const days = byDay(res.list);
  assert.deepStrictEqual(days.mo.concat(days.do).filter(s => s === "Schwimmen").length, 2, JSON.stringify(res.changes));
  assert.ok(!days.di.includes("Schwimmen"));
  assert.ok(!days.mi.includes("Schwimmen") && !days.fr.includes("Schwimmen"));
  Object.values(days).forEach(d => assert.ok(d.filter(s => s !== "Kraft" && s !== "Mobility").length <= 1, JSON.stringify(days)));
  assert.ok(res.changes.some(t => /Schwimmtag/.test(t)));
});

test("Ein Haupttraining pro Tag, Kraft/Mobility höchstens einmal dazu", () => {
  const list = [pw(D.di, "Laufen"), pw(D.di, "Rad"), pw(D.di, "Kraft", 30, "mittel"), pw(D.di, "Mobility", 15), pw(D.mo, "Schwimmen"), pw(D.do, "Schwimmen")];
  const res = apply(list);
  const days = byDay(res.list);
  assert.strictEqual(days.di.filter(s => s === "Laufen" || s === "Rad").length, 1, JSON.stringify(days));
  assert.strictEqual(days.di.filter(s => s === "Kraft" || s === "Mobility").length, 1);
  assert.strictEqual(res.list.length, list.length, "nichts gestrichen, nur verschoben");
  assert.ok(!days.so.length, "Sonntag ist kein Trainingstag");
});

test("Zwei Haupttrainings pro Tag erlaubt, wenn so eingestellt", () => {
  const list = [pw(D.mo, "Schwimmen"), pw(D.mo, "Laufen"), pw(D.do, "Schwimmen")];
  assert.deepStrictEqual(byDay(apply(list, { mainPerDay: 2 }).list).mo, ["Laufen", "Schwimmen"]);
  assert.deepStrictEqual(byDay(apply(list, { mainPerDay: 1 }).list).mo, ["Schwimmen"]);
});

test("Kraft an eigenen Tagen und höchstens wie gewünscht pro Woche", () => {
  const list = [pw(D.mo, "Schwimmen"), pw(D.mo, "Kraft", 30, "mittel"), pw(D.di, "Kraft", 30, "mittel"), pw(D.mi, "Kraft", 30, "mittel"), pw(D.do, "Schwimmen")];
  const res = apply(list, { extrasMode: "own", strengthPerWeek: 2 });
  const kraft = res.list.filter(p => p.sport === "Kraft");
  assert.strictEqual(kraft.length, 2, JSON.stringify(res.changes));
  kraft.forEach(k => assert.ok(!res.list.some(p => p.date === k.date && p.sport !== "Kraft"), "Kraft-Tag ohne Haupttraining"));
});

test("Einheit an einem Ruhetag wird verschoben, Bestand bleibt unangetastet", () => {
  const fixed = pw(D.so, "Laufen", 60, "leicht", { source: "manual" });
  const ai = pw(D.so, "Rad", 60);
  const res = apply([fixed, ai, pw(D.mo, "Schwimmen"), pw(D.do, "Schwimmen")], {}, [ai.id]);
  assert.ok(res.list.some(p => p.id === fixed.id && p.date === D.so));
  assert.notStrictEqual(res.list.find(p => p.id === ai.id).date, D.so);
});

test("Schwimmtag ohne Schwimmen: Lauf weicht aus, Schwimmen kommt dazu", () => {
  const list = [pw(D.mo, "Laufen"), pw(D.di, "Rad"), pw(D.do, "Schwimmen")];
  const res = apply(list);
  const days = byDay(res.list);
  assert.deepStrictEqual(days.mo, ["Schwimmen"], JSON.stringify(res.changes));
  assert.ok(res.list.some(p => p.sport === "Laufen" && p.date !== D.mo));
  const swim = res.list.find(p => p.date === D.mo);
  assert.strictEqual(swim.intensity, "leicht");
  assert.strictEqual(swim.duration_min, 50);
});

test("Prompt-Text nennt Tagesraster und Mengen", () => {
  const text = call("planStructureRuleText", settings(), [D.mo, D.di, D.so]);
  assert.match(text, /2026-11-09 Mo: Schwimmtag/);
  assert.match(text, /2026-11-15 So: Ruhetag/);
  assert.match(text, /höchstens EIN Haupttraining/);
  assert.match(text, /Kraft: genau 2× pro Woche/);
});

test("Verschieben im Regelwerk beachtet Schwimmtage und Tageslimit", () => {
  // Harter Lauf Di direkt nach hartem Rad Mo -> verschieben, aber nicht auf
  // einen Tag, der schon ein Haupttraining hat, und Schwimmen nur an Schwimmtagen.
  const list = [pw(D.mo, "Rad", 60, "hart"), pw(D.di, "Laufen", 50, "hart"), pw(D.mi, "Rad"), pw(D.do, "Schwimmen"), pw(D.fr, "Schwimmen", 40, "hart"), pw(D.sa, "Rad", 90)];
  app.__.list = list; app.__.s = settings();
  const v = plain(run(`validatePlan(__.list, [], null, null, { goal: goals[0], today: new Date(2026, 10, 9, 8), acwr: 1.0, structure: __.s })`));
  const hard = v.filter(x => x.rule === "hard_in_row");
  hard.forEach(h => {
    if (h.suggestion.action !== "move") return;
    const others = list.filter(p => p.date === h.suggestion.toDate && p.id !== h.workoutId);
    assert.ok(!others.some(p => p.sport !== "Kraft" && p.sport !== "Mobility"), JSON.stringify(h));
    const moved = list.find(p => p.id === h.workoutId);
    if (moved.sport === "Schwimmen") assert.ok([D.mo, D.do].includes(h.suggestion.toDate));
  });
});

test("Harte Einheit am Schwimmtag ersetzt lieber einen lockeren Lauf an einem anderen Tag", () => {
  const list = [pw(D.mo, "Schwimmen"), pw(D.di, "Rad"), pw(D.mi, "Laufen"), pw(D.do, "Laufen", 55, "hart"), pw(D.fr, "Laufen", 40), pw(D.sa, "Rad", 120)];
  const res = apply(list);
  const days = byDay(res.list);
  assert.deepStrictEqual(days.do, ["Schwimmen"], JSON.stringify(res.changes));
  const hard = res.list.find(p => p.intensity === "hart");
  assert.ok(hard && hard.sport === "Laufen" && hard.date !== D.do, JSON.stringify(res.changes));
  assert.ok(res.changes.some(t => /dafür entfällt/.test(t)));
});
