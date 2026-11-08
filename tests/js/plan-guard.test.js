// Tests für das Plan-Sicherheitsnetz (js/analytics/plan-guard.js): leere
// Trainingstage füllen, heute/morgen an die Verfassung anpassen,
// Regelverstöße im Zeitraum beheben, KI-Vorschläge begrenzen.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/data/race-formats.js", "js/utils/dates.js", "js/utils/formatting.js", "js/analytics/training-load.js", "js/analytics/plan-rules.js", "js/analytics/periodization.js",
  "js/data/planned-workouts.js", "js/analytics/plan-guard.js"];

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

const TODAY_MS = new Date(2026, 9, 12, 9, 0).getTime(); // Montag, 12.10.2026
const day = n => run(`localDateStr(new Date(2026, 9, ${12 + n}))`);
const TODAY = day(0);

let nextId = 1;
const pw = (date, sport, duration_min, intensity, extra = {}) =>
  ({ id: "pw" + nextId++, date, sport, title: `${sport} ${intensity}`, duration_min, intensity, status: "geplant", goalId: "g1", ...extra });
const hist = (date, sport, duration_min) => ({ date: `${date}T07:00:00`, _date: new Date(`${date}T07:00:00`), sport, duration_min });
// Drei normale Vorwochen mit je 360 Minuten (Di/Mi/Fr/Sa).
const HISTORY = [-21, -14, -7].flatMap(w => [[1, "Laufen"], [2, "Rad"], [4, "Schwimmen"], [5, "Rad"]].map(([d, sp]) => hist(day(w + d), sp, 90)));
const ALL_DAYS = ["mo", "di", "mi", "do", "fr", "sa", "so"];

// validate wie im Browser (planRuleViolations), aber mit festem "heute".
run(`__.validate = (list, history) => validatePlan(list, history, null, null, { goal: goals[0], today: new Date(${TODAY_MS}), acwr: 1.0 })`);

function fill(list, profile, extra = {}) {
  app.__.list = list; app.__.profile = profile; app.__.extra = extra; app.__.history = extra.history || HISTORY;
  return plain(run(`planGuardFill(__.list, __.history, { from: "${day(0)}", to: "${day(6)}", todayKey: "${TODAY}", today: new Date(${TODAY_MS}),
    profile: __.profile, freeDays: __.extra.freeDays || {}, goal: __.extra.goal === undefined ? goals[0] : __.extra.goal, defaults: { goalId: "g1" },
    validate: l => __.validate(l, __.history) })`));
}

test("Lücken füllen: jeder Trainingstag bekommt eine lockere Einheit, ein Tag der Woche bleibt frei", () => {
  const list = [pw(day(0), "Schwimmen", 45, "leicht"), pw(day(3), "Kraft", 30, "mittel")];
  const res = fill(list, { trainingDays: ALL_DAYS, typicalSessionMin: 50 });
  const dates = res.added.map(p => p.date);
  assert.strictEqual(res.added.length, 4, JSON.stringify(res.skipped));
  assert.deepStrictEqual(res.skipped.map(s => s.reason), ["rest"]);
  assert.ok(!dates.includes(day(0)) && !dates.includes(day(3)));
  res.added.forEach(p => {
    assert.strictEqual(p.intensity, "leicht");
    assert.strictEqual(p.source, "guard");
    assert.strictEqual(p.status, "geplant");
    assert.ok(["Schwimmen", "Rad", "Laufen"].includes(p.sport));
    assert.ok(p.duration_min >= 20 && p.duration_min <= 50, p.duration_min);
  });
  // Abwechslung: Rad und Laufen kommen beide vor (Schwimmen hat schon Minuten).
  assert.ok(res.added.some(p => p.sport === "Rad") && res.added.some(p => p.sport === "Laufen"));
});

test("Lücken füllen: nur Trainingstage, bewusst freie Tage und Rennen bleiben leer", () => {
  const res = fill([], { trainingDays: ["di", "do", "sa"] }, { freeDays: { [day(3)]: "user" } });
  assert.deepStrictEqual(res.added.map(p => p.date), [day(1), day(5)]);
  const race = { ...GOAL, date: day(6) };
  const res2 = fill([], { trainingDays: ALL_DAYS }, { goal: race });
  assert.ok(!res2.added.some(p => p.date === day(6) || p.date === day(5)), "Wettkampf und Vortag bleiben frei");
});

test("Lücken füllen: Schwimmen nur an Schwimmtagen, Rad/Laufen am langen Tag (länger)", () => {
  const res = fill([], { trainingDays: ["di", "mi", "sa"], swimDays: ["mi"], longDays: ["sa"], typicalSessionMin: 40 });
  const by = Object.fromEntries(res.added.map(p => [p.date, p]));
  assert.strictEqual(by[day(2)].sport, "Schwimmen");
  assert.notStrictEqual(by[day(1)].sport, "Schwimmen");
  assert.ok(["Rad", "Laufen"].includes(by[day(5)].sport));
  assert.strictEqual(by[day(5)].duration_min, 60);
});

test("Lücken füllen: Wochenbudget (verfügbare Stunden) wird nicht überschritten", () => {
  const list = [pw(day(0), "Rad", 90, "leicht"), pw(day(1), "Laufen", 60, "mittel")];
  const res = fill(list, { trainingDays: ALL_DAYS, weeklyHours: 3, typicalSessionMin: 45 });
  const total = [...list, ...res.added].reduce((s, p) => s + p.duration_min, 0);
  assert.ok(total <= 180, "gesamt " + total);
  assert.ok(res.added.length >= 1);
  const tight = fill(list, { trainingDays: ALL_DAYS, weeklyHours: 2.6 });
  assert.strictEqual(tight.added.length, 0);
  assert.ok(tight.skipped.some(s => s.reason === "volume"));
});

test("Lücken füllen: ein Tag mit nur Mobility gilt als leerer Trainingstag", () => {
  const res = fill([pw(day(0), "Mobility", 20, "leicht"), pw(day(3), "Kraft", 30, "mittel")], { trainingDays: ["mo", "do"] });
  assert.deepStrictEqual(res.added.map(p => p.date), [day(0)]);
});

test("Lücken füllen: ohne Trainingstage im Profil passiert nichts", () => {
  assert.strictEqual(fill([], { trainingDays: [] }).added.length, 0);
});

const ready = (list, gate, extra = {}) => call("planGuardReadiness", list, { todayKey: TODAY, gate, signs: extra.signs || [], strain: extra.strain || [], skipIds: extra.skipIds || [] });

test("Verfassung: Verletzung -> heute Ruhetag (Mobility bleibt), morgen nur locker", () => {
  const run1 = pw(day(0), "Laufen", 60, "hart"), mob = pw(day(0), "Mobility", 15, "leicht"), tomorrow = pw(day(1), "Rad", 90, "mittel"), later = pw(day(2), "Laufen", 50, "hart");
  const res = ready([run1, mob, tomorrow, later], { reasons: ["du hast heute eine Verletzung gemeldet"], injury: true });
  const ids = res.list.map(p => p.id);
  assert.ok(!ids.includes(run1.id) && ids.includes(mob.id));
  const t = res.list.find(p => p.id === tomorrow.id);
  assert.strictEqual(t.intensity, "leicht");
  assert.strictEqual(t.duration_min, 60);
  assert.ok(/Plan-Check/.test(t.description));
  assert.deepStrictEqual(res.list.find(p => p.id === later.id), later, "übermorgen unverändert");
  assert.deepStrictEqual(res.changes.map(c => c.kind), ["rest", "easier"]);
});

test("Verfassung: erschöpft -> heute und morgen locker und kürzer, lockere Einheiten bleiben", () => {
  const a = pw(day(0), "Laufen", 60, "mittel"), b = pw(day(1), "Rad", 150, "leicht"), c = pw(day(1), "Schwimmen", 40, "leicht");
  const res = ready([a, b, c], { reasons: ["du fühlst dich heute erschöpft"], injury: false });
  const by = Object.fromEntries(res.list.map(p => [p.id, p]));
  assert.deepStrictEqual([by[a.id].intensity, by[a.id].duration_min], ["leicht", 40]);
  assert.deepStrictEqual([by[b.id].intensity, by[b.id].duration_min], ["leicht", 75], "über 120 min zählt als hart");
  assert.deepStrictEqual(by[c.id], c);
  assert.strictEqual(by[a.id].steps, null);
});

test("Verfassung: nur Uhr-Werte auffällig -> nur die harte Einheit von heute wird locker", () => {
  const a = pw(day(0), "Laufen", 60, "hart"), b = pw(day(0), "Rad", 60, "mittel"), c = pw(day(1), "Laufen", 60, "hart");
  const res = ready([a, b, c], { reasons: [], injury: false }, { signs: ["deine HRV liegt 15 % unter deinem Durchschnitt"] });
  const by = Object.fromEntries(res.list.map(p => [p.id, p]));
  assert.deepStrictEqual([by[a.id].intensity, by[a.id].duration_min], ["leicht", 45]);
  assert.strictEqual(by[b.id].intensity, "mittel");
  assert.strictEqual(by[c.id].intensity, "hart");
});

test("Verfassung: alles gut oder rückgängig gemacht -> keine Änderung", () => {
  const a = pw(day(0), "Laufen", 60, "hart");
  assert.strictEqual(ready([a], { reasons: [], injury: false }).changes.length, 0);
  assert.strictEqual(ready([a], { reasons: ["du fühlst dich heute erschöpft"], injury: false }, { skipIds: [a.id] }).changes.length, 0);
});

test("Regelwerk im Zeitraum: zwei harte Tage hintereinander werden behoben, außerhalb nicht", () => {
  const list = [pw(day(1), "Laufen", 50, "hart"), pw(day(2), "Rad", 60, "hart"), pw(day(4), "Schwimmen", 40, "leicht")];
  app.__.list = list;
  const res = plain(run(`planGuardAutofix(__.list, { from: "${day(0)}", to: "${day(6)}", validate: l => __.validate(l, []), fix: (l, s) => applyPlanSuggestion(l, s, { goalId: "g1" }) })`));
  assert.ok(res.fixed.length >= 1);
  const after = plain(run(`validatePlan(${JSON.stringify(res.list)}, [], null, null, { goal: goals[0], today: new Date(${TODAY_MS}), acwr: 1.0 })`));
  assert.ok(!after.some(v => v.severity === "block"), JSON.stringify(after));
  const none = plain(run(`planGuardAutofix(__.list, { from: "${day(10)}", to: "${day(12)}", validate: l => __.validate(l, []), fix: (l, s) => applyPlanSuggestion(l, s, {}) })`));
  assert.strictEqual(none.fixed.length, 0);
});

test("Unterschied zweier Planstände", () => {
  const a = pw(day(0), "Laufen", 60, "hart"), b = pw(day(1), "Rad", 60, "leicht"), c = pw(day(2), "Schwimmen", 30, "leicht");
  const diff = call("planGuardDiff", [a, b], [{ ...a, intensity: "leicht" }, c]);
  assert.deepStrictEqual(diff.map(d => [d.kind, d.id]), [["changed", a.id], ["removed", b.id], ["added", c.id]]);
});

test("KI-Vorschlag: nur leichter/kürzer, Ausdauer bleibt Ausdauer", () => {
  const env = pw(day(0), "Laufen", 60, "mittel");
  assert.deepStrictEqual(call("planGuardAcceptAi", env, { sport: "Rad", intensity: "leicht", duration_min: 45 }), { sport: "Rad", intensity: "leicht", duration_min: 45 });
  assert.strictEqual(call("planGuardAcceptAi", env, { intensity: "hart", duration_min: 45 }), null);
  assert.strictEqual(call("planGuardAcceptAi", env, { intensity: "leicht", duration_min: 75 }), null);
  assert.strictEqual(call("planGuardAcceptAi", env, { sport: "Kraft", intensity: "leicht", duration_min: 30 }), null);
  assert.strictEqual(call("planGuardAcceptAi", env, { intensity: "leicht", duration_min: 5 }), null);
});
