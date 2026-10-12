// Tests für das Übernehmen von Regelwerk-Vorschlägen (applyPlanSuggestion,
// js/data/planned-workouts.js) und die Terminwünsche (js/data/plan-wishes.js).
// Ausführen: node --test tests/js/
//
// Wie plan-rules.test.js: die Browser-Skripte laufen der Reihe nach in einem
// gemeinsamen vm-Kontext. Gestubbt sind nur Server-Ablage (storeGet/
// storeSet), apiCall, Timer und PLAN_ALLOWED_SPORTS (sonst js/ai/ollama.js).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/training-load.js", "js/analytics/plan-rules.js",
  "js/data/planned-workouts.js", "js/data/plan-wishes.js"];

const store = {};
const app = vm.createContext({
  DATA: [], window: {}, setTimeout: () => 0, clearTimeout: () => {},
  apiCall: () => Promise.resolve({}),
  storeGet: key => (key in store ? JSON.parse(JSON.stringify(store[key])) : null),
  storeSet: (key, value) => { store[key] = JSON.parse(JSON.stringify(value)); },
  PLAN_ALLOWED_SPORTS: ["Schwimmen", "Rad", "Laufen", "Kraft", "Mobility"],
});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x)); // Objekte aus dem vm-Kontext haben eigene Prototypen

/* ---------- Testdaten ---------- */

const TODAY = new Date(2026, 9, 12, 9, 0); // Montag, 12.10.2026 (wie plan-rules.test.js)
const day = n => run(`localDateStr(new Date(2026, 9, ${12 + n}))`);
const realDay = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return run(`localDateStr(new Date(${d.getTime()}))`); };

const pw = (id, date, sport, duration_min, intensity, status = "geplant") =>
  ({ id, date, sport, title: `${sport} ${intensity}`, duration_min, intensity, status, goalId: "g1" });

function plan() {
  return [
    pw("a", day(1), "Schwimmen", 45, "leicht"),
    pw("b", day(2), "Laufen", 50, "hart"),
    pw("c", day(3), "Rad", 60, "leicht"),
    pw("d", day(4), "Laufen", 40, "mittel"),
  ];
}

const apply = (list, suggestion, defaults) => {
  const out = app.applyPlanSuggestion(list, suggestion, defaults);
  return out === null ? null : plain(out);
};
const byId = (list, id) => list.find(p => p.id === id);

/* ---------- applyPlanSuggestion ---------- */

test("move: verschiebt die Einheit, die Eingabe bleibt unverändert", () => {
  const input = plan();
  const out = apply(input, { action: "move", workoutId: "c", toDate: day(5) });
  assert.strictEqual(byId(out, "c").date, day(5));
  assert.strictEqual(byId(input, "c").date, day(3));
  assert.strictEqual(out.length, input.length);
});

test("set_intensity: Intensität runter, bei Angabe auch kürzer", () => {
  let out = apply(plan(), { action: "set_intensity", workoutId: "b", intensity: "leicht" });
  assert.deepStrictEqual([byId(out, "b").intensity, byId(out, "b").duration_min], ["leicht", 50]);
  assert.match(byId(out, "b").description, /Vom Regelwerk auf „leicht“ gesetzt/, "Hinweis, dass die Beschreibung nicht mehr passt");
  out = apply(plan(), { action: "set_intensity", workoutId: "b", intensity: "leicht", duration_min: 30 });
  assert.deepStrictEqual([byId(out, "b").intensity, byId(out, "b").duration_min], ["leicht", 30]);
});

test("reduce_duration und reduce_week_volume ändern nur die Dauer", () => {
  let out = apply(plan(), { action: "reduce_duration", workoutId: "c", duration_min: 45 });
  assert.strictEqual(byId(out, "c").duration_min, 45);
  out = apply(plan(), { action: "reduce_week_volume", weekStart: day(0), target_minutes: 150, workouts: [{ workoutId: "a", duration_min: 35 }, { workoutId: "c", duration_min: 40 }] });
  assert.deepStrictEqual(out.map(p => p.duration_min), [35, 50, 40, 40]);
  assert.deepStrictEqual(out.map(p => p.intensity), ["leicht", "hart", "leicht", "mittel"]);
});

test("make_rest_day: die Einheiten des Tages fallen weg", () => {
  const out = apply(plan(), { action: "make_rest_day", date: day(2), workoutIds: ["b"] });
  assert.deepStrictEqual(out.map(p => p.id), ["a", "c", "d"]);
});

test("add_easy_session: neue lockere Einheit mit den Vorgaben des Aufrufers", () => {
  const out = apply(plan(), { action: "add_easy_session", sport: "Rad", weekStart: day(0), date: day(5), duration_min: 45 }, { goalId: "g1", phase: "aufbau", source: "ai" });
  assert.strictEqual(out.length, 5);
  const added = out[4];
  assert.ok(added.id && !["a", "b", "c", "d"].includes(added.id));
  assert.deepStrictEqual(
    { date: added.date, sport: added.sport, duration_min: added.duration_min, intensity: added.intensity, status: added.status, goalId: added.goalId, phase: added.phase, source: added.source },
    { date: day(5), sport: "Rad", duration_min: 45, intensity: "leicht", status: "geplant", goalId: "g1", phase: "aufbau", source: "ai" },
  );
});

test("unpassende Vorschläge liefern null statt einer kaputten Liste", () => {
  assert.strictEqual(apply(plan(), { action: "move", workoutId: "gibtsnicht", toDate: day(5) }), null);
  assert.strictEqual(apply(plan(), { action: "make_rest_day", date: day(6), workoutIds: [] }), null);
  assert.strictEqual(apply(plan(), { action: "reduce_week_volume", workouts: [{ workoutId: "x", duration_min: 10 }] }), null);
  assert.strictEqual(apply(plan(), { action: "add_easy_session", sport: "Rad", date: null, duration_min: 45 }), null);
  assert.strictEqual(apply(plan(), { action: "unbekannt" }), null);
  assert.strictEqual(apply(plan(), null), null);
});

test("Zusammenspiel mit validatePlan: der Vorschlag eines block-Verstoßes behebt ihn", () => {
  const list = plan();
  byId(list, "c").intensity = "hart"; // Di hart + Mi hart
  const options = { today: TODAY, acwr: 1.0 };
  const before = plain(app.validatePlan(list, [], null, null, options));
  const block = before.find(v => v.severity === "block");
  assert.strictEqual(block.rule, "hard_in_row");
  const fixed = apply(list, block.suggestion);
  const after = plain(app.validatePlan(fixed, [], null, null, options));
  assert.ok(!after.some(v => v.severity === "block"), JSON.stringify(after));
});

test("patchedPlannedWorkouts: Vorschau einer Änderung, Original bleibt", () => {
  const input = plan();
  const out = plain(app.patchedPlannedWorkouts(input, "d", { date: day(6) }));
  assert.strictEqual(byId(out, "d").date, day(6));
  assert.strictEqual(byId(input, "d").date, day(4));
});

test("newPlanViolations: nur Verstöße, die die Änderung neu verursacht", () => {
  const v = (rule, date, workoutId) => ({ rule, severity: "warn", date, workoutId });
  const before = [v("volume_increase", day(0), null), v("hard_in_row", day(3), "c")];
  const after = [v("volume_increase", day(0), null), v("hard_in_row", day(5), "c"), v("rest_day", day(7), null)];
  assert.deepStrictEqual(plain(app.newPlanViolations(before, after)).map(x => x.rule + x.date), ["hard_in_row" + day(5), "rest_day" + day(7)]);
});

/* ---------- Terminwünsche ---------- */

function resetWishes(saved) {
  if (saved === undefined) delete store.triathlon_dashboard_plan_wishes_v1;
  else store.triathlon_dashboard_plan_wishes_v1 = saved;
  run("loadPlanWishes(); plannedWorkouts = [];");
}

test("addPlanWish speichert gültige Wünsche in der Ablage pro Person", () => {
  resetWishes();
  const w = plain(app.addPlanWish({ date: realDay(3), sport: "Schwimmen", duration_min: "45", note: "  gern Freiwasser  " }));
  assert.deepStrictEqual({ date: w.date, sport: w.sport, duration_min: w.duration_min, note: w.note }, { date: realDay(3), sport: "Schwimmen", duration_min: 45, note: "gern Freiwasser" });
  assert.strictEqual(store.triathlon_dashboard_plan_wishes_v1.length, 1);
  assert.strictEqual(store.triathlon_dashboard_plan_wishes_v1[0].id, w.id);
});

test("addPlanWish lehnt ungültige Eingaben ab", () => {
  resetWishes();
  assert.strictEqual(app.addPlanWish({ date: realDay(-1), sport: "Laufen", duration_min: 30 }), null); // vorbei
  assert.strictEqual(app.addPlanWish({ date: "", sport: "Laufen", duration_min: 30 }), null);
  assert.strictEqual(app.addPlanWish({ date: realDay(2), sport: "Golf", duration_min: 30 }), null);
  assert.strictEqual(app.addPlanWish({ date: realDay(2), sport: "Laufen", duration_min: 0 }), null);
  assert.strictEqual(app.addPlanWish({ date: realDay(2), sport: "Laufen", duration_min: 600 }), null);
  assert.strictEqual(store.triathlon_dashboard_plan_wishes_v1, undefined, "nichts gespeichert");
  assert.ok(app.addPlanWish({ date: realDay(0), sport: "Laufen", duration_min: 30 }), "heute ist erlaubt");
});

test("deletePlanWish und loadPlanWishes (vergangene Wünsche fallen weg)", () => {
  resetWishes([
    { id: "w1", date: realDay(-2), sport: "Rad", duration_min: 60, note: null },
    { id: "w2", date: realDay(2), sport: "Rad", duration_min: 60, note: null },
    { id: "w3", date: realDay(4), sport: "Laufen", duration_min: 30, note: null },
  ]);
  assert.deepStrictEqual(plain(app.upcomingPlanWishes()).map(w => w.id), ["w2", "w3"]);
  app.deletePlanWish("w2");
  assert.deepStrictEqual(store.triathlon_dashboard_plan_wishes_v1.map(w => w.id), ["w3"]);
});

test("openPlanWishes: eingeplant ist, was am selben Tag in derselben Sportart im Plan steht", () => {
  resetWishes([
    { id: "w1", date: realDay(5), sport: "Laufen", duration_min: 30, note: null },
    { id: "w2", date: realDay(1), sport: "Schwimmen", duration_min: 45, note: null },
  ]);
  const list = [pw("x", realDay(1), "Schwimmen", 40, "leicht"), pw("y", realDay(5), "Rad", 60, "leicht")];
  assert.deepStrictEqual(plain(app.openPlanWishes(list)).map(w => w.id), ["w1"]);
  list[0].status = "uebersprungen";
  assert.deepStrictEqual(plain(app.openPlanWishes(list)).map(w => w.id), ["w2", "w1"], "übersprungen zählt nicht, sortiert nach Datum");
});

test("addOpenWishesToPlan ergänzt fehlende Wünsche bis zum Datum, ohne Intensität", () => {
  resetWishes([
    { id: "w1", date: realDay(1), sport: "Schwimmen", duration_min: 45, note: "Freiwasser" },
    { id: "w2", date: realDay(2), sport: "Laufen", duration_min: 30, note: null },
    { id: "w3", date: realDay(9), sport: "Rad", duration_min: 90, note: null },
  ]);
  const list = [pw("x", realDay(2), "Laufen", 50, "mittel")]; // w2 hat die KI schon eingeplant
  const out = plain(app.addOpenWishesToPlan(list, realDay(6), { goalId: "g1", phase: "aufbau", source: "manual" }));
  assert.strictEqual(out.length, 2, "w3 liegt nach dem Fenster");
  const added = out[1];
  assert.deepStrictEqual(
    { date: added.date, sport: added.sport, duration_min: added.duration_min, intensity: added.intensity, description: added.description, goalId: added.goalId, source: added.source },
    { date: realDay(1), sport: "Schwimmen", duration_min: 45, intensity: null, description: "Freiwasser", goalId: "g1", source: "manual" },
  );
  assert.strictEqual(list.length, 1, "Eingabe unverändert");
});
