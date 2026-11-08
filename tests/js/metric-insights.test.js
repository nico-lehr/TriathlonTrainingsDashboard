// Tests für die Einordnung der Messwerte (js/analytics/metric-insights.js):
// Richtwert-Bereich, Vergleich mit früheren Einheiten bei ähnlichem Tempo,
// Pulszone/Plan, Rad-Intensität, Schwimmtempo zur CSS, Puls-Drift.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const app = vm.createContext({ window: {}, console, Math, JSON, Date });
["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/metric-insights.js"]
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
app.sportGroup = s => s;
app.sameComparisonGroup = (a, b) => a.sport === b.sport;
app.isIndoorRide = () => false;
app.plannedWorkouts = [];
const plain = x => JSON.parse(JSON.stringify(x));
const at = d => new Date(`${d}T18:00:00`);

// Frühere Läufe: drei bei ~5:30 min/km mit hohem vertikalem Verhältnis, zwei schnelle.
const RUNS = [
  { file: "r1", sport: "Laufen", _date: at("2026-10-20"), pace_min_per_km: "5:28", avg_cadence: 162, avg_vertical_ratio_pct: 9.9, avg_stance_time_ms: 275, avg_hr: 150 },
  { file: "r2", sport: "Laufen", _date: at("2026-10-25"), pace_min_per_km: "5:35", avg_cadence: 163, avg_vertical_ratio_pct: 10.0, avg_stance_time_ms: 280, avg_hr: 152 },
  { file: "r3", sport: "Laufen", _date: at("2026-11-01"), pace_min_per_km: "5:31", avg_cadence: 161, avg_vertical_ratio_pct: 9.8, avg_stance_time_ms: 276, avg_hr: 151 },
  { file: "r4", sport: "Laufen", _date: at("2026-11-03"), pace_min_per_km: "4:40", avg_cadence: 178, avg_vertical_ratio_pct: 8.2, avg_stance_time_ms: 240, avg_hr: 168 },
  { file: "r5", sport: "Laufen", _date: at("2026-11-04"), pace_min_per_km: "4:45", avg_cadence: 176, avg_vertical_ratio_pct: 8.4, avg_stance_time_ms: 245, avg_hr: 166 },
];
// Später (darf nie als "sonst" zählen)
const LATER = { file: "r9", sport: "Laufen", _date: at("2026-11-20"), pace_min_per_km: "5:30", avg_cadence: 190, avg_vertical_ratio_pct: 6.0, avg_hr: 140 };
const TODAY = { file: "now", sport: "Laufen", sport_raw: "running", _date: at("2026-11-08"), pace_min_per_km: "5:30", avg_cadence: 170, avg_vertical_ratio_pct: 9.4, avg_stance_time_ms: 268, avg_hr: 147, duration_min: 34 };
const insights = (w, all, profile = {}) => { app.__w = app.__fix(w); app.__p = profile; return plain(run("workoutMetricInsights(__w, __all, __p)")); };
app.__fix = w => ({ ...w, _date: new Date(w._date) });
const get = (list, id) => list.find(x => x.id === id);

test("Vertikales Verhältnis: Bereich 'eher hoch', aber besser als sonst bei ähnlichem Tempo", () => {
  app.__all = [...RUNS, LATER, TODAY].map(app.__fix);
  const list = insights(TODAY);
  const vr = get(list, "run_vr");
  assert.strictEqual(vr.valueText, "9,4 %");
  assert.strictEqual(vr.verdict, "eher hoch");
  assert.strictEqual(vr.level, "warn");
  assert.strictEqual(vr.rangeText, "gut: unter 7,5 %");
  assert.strictEqual(vr.compare.dir, "better");
  assert.match(vr.compare.baseText, /sonst Ø 9,9 % \(3 Läufe mit ähnlichem Tempo\)/); // nur die 3 langsamen, nicht der spätere
  assert.strictEqual(vr.chart, "vr");
  const cad = get(list, "run_cadence");
  assert.deepStrictEqual([cad.verdict, cad.compare.dir, cad.rangeText], ["mittel", "better", "gut: ab 174 spm"]);
  const gct = get(list, "run_gct");
  assert.deepStrictEqual([gct.verdict, gct.compare.dir], ["mittel", "better"]);
  const hr = get(list, "hr_at_pace");
  assert.strictEqual(hr.compare.dir, "better"); // 147 statt Ø 151 bei ähnlichem Tempo
  assert.match(hr.valueText, /\(-4\)/);
});

test("Ohne genug ähnliche Läufe: Vergleich mit allen, als 'Tempo unterschiedlich' markiert; ohne frühere gar keiner", () => {
  app.__all = [...RUNS, TODAY].map(app.__fix);
  const fast = { ...TODAY, pace_min_per_km: "6:30" };
  const vr = get(insights(fast), "run_vr");
  assert.match(vr.compare.baseText, /letzte 5 Läufe, Tempo unterschiedlich/);
  assert.strictEqual(get(insights(fast), "hr_at_pace"), undefined);
  app.__all = [TODAY].map(app.__fix);
  assert.strictEqual(get(insights(TODAY), "run_vr").compare, null);
});

test("Pulszone nach Herzfrequenzreserve und Abgleich mit dem Plan", () => {
  app.__all = [TODAY].map(app.__fix);
  app.plannedWorkouts = [{ date: "2026-11-08", sport: "Laufen", intensity: "leicht" }];
  const prof = { maxHr: 190, restingHr: 50 };
  const z = get(insights(TODAY, null, prof), "hr_zone"); // (147-50)/140 = 69 % Reserve
  assert.deepStrictEqual([z.verdict, z.plan.text, z.plan.level], ["Zone 2 · locker (Grundlage)", "passt zum Plan (locker)", "good"]);
  const z2 = get(insights({ ...TODAY, avg_hr: 158 }, null, prof), "hr_zone"); // 77 %
  assert.deepStrictEqual([z2.verdict, z2.plan.text, z2.plan.level], ["Zone 3 · mittel", "härter als geplant (locker geplant)", "warn"]);
  assert.strictEqual(get(insights(TODAY, null, {}), "hr_zone"), undefined); // ohne Max-/Ruhepuls keine Zone
  app.plannedWorkouts = [];
});

test("Rad: % FTP, Gleichmäßigkeit und Trittfrequenz", () => {
  app.plannedWorkouts = [];
  const ride = { file: "b", sport: "Rad", _date: at("2026-11-08"), avg_power_w: 180, normalized_power_w: 198, avg_cadence: 76, avg_hr: 140, speed_kmh: 30 };
  app.__all = [app.__fix(ride)];
  const list = insights(ride, null, { ftpWatts: 250, weightKg: 75 });
  const iF = get(list, "ride_if");
  assert.match(iF.valueText, /^79 % FTP · 2,40 W\/kg$/);
  assert.strictEqual(iF.verdict, "zügig (Tempo)");
  assert.deepStrictEqual([get(list, "ride_vi").verdict, get(list, "ride_vi").valueText], ["wechselnd", "1,10 (NP ÷ Ø Leistung)"]);
  assert.deepStrictEqual([get(list, "ride_cadence").verdict, get(list, "ride_cadence").rangeText], ["eher niedrig", "gut: 80–95 U/min"]);
});

test("Schwimmen: Tempo zur CSS", () => {
  const swim = { file: "s", sport: "Schwimmen", _date: at("2026-11-08"), pace_min_per_100m: "2:08" };
  app.__all = [app.__fix(swim)];
  const p = get(insights(swim, null, { swimCss: "1:55" }), "swim_pace");
  assert.strictEqual(p.valueText, "2:08 min/100 m (+13 s zur CSS)");
  assert.strictEqual(p.verdict, "zügig / Ausdauer");
  // Zugfrequenz: kein allgemeiner Richtwert (Zählweise der Uhr) - ohne frühere Einheiten also gar nichts
  assert.strictEqual(get(insights({ ...swim, avg_stroke_rate: 28 }, null, {}), "swim_stroke"), undefined);
});

test("Puls-Drift nur bei gleichmäßigen Einheiten ab 40 min", () => {
  const n = 120, t = [], hr = [], speed = [];
  for (let i = 0; i < n; i++) { t.push(i * 30); speed.push(3.0); hr.push(i < n / 2 ? 140 : 152); }
  const run1 = { file: "d", sport: "Laufen", _date: at("2026-11-08"), duration_min: 60, stream: { t, hr, speed } };
  app.__all = [app.__fix(run1)];
  const d = get(insights(run1), "decoupling");
  assert.ok(d && d.value > 5 && d.value < 10, JSON.stringify(d && d.value));
  assert.strictEqual(d.verdict, "leichte Drift");
  // Intervalle (Tempo springt): keine Aussage
  const iv = { ...run1, stream: { t, hr, speed: speed.map((v, i) => (i % 10 < 5 ? 2 : 4.5)) } };
  assert.strictEqual(get(insights(iv), "decoupling"), undefined);
  assert.strictEqual(get(insights({ ...run1, duration_min: 30 }), "decoupling"), undefined);
});

test("KI-Zeilen enthalten Bereich und Vergleich", () => {
  app.__all = [...RUNS, TODAY].map(app.__fix);
  app.__w = app.__fix(TODAY);
  const lines = run("workoutMetricInsightLines(__w, __all, {})");
  assert.ok(lines.some(l => /Vertikales Verhältnis: 9,4 %; Bereich: eher hoch \(gut: unter 7,5 %\); besser als sonst – sonst Ø 9,9 %/.test(l)), lines.join("\n"));
});
