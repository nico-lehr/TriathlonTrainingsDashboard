// Tests für die Periodisierung (js/analytics/periodization.js): Phasen je
// Tag (getPhase), Phasen-Abschnitte (getPhaseTimeline), Zielumfang je Woche
// (getWeeklyTargets) und computeTrainingPhase (training-plan.js), das nur
// noch an getPhase weitergibt.
// Ausführen: node --test tests/js/
//
// Wie plan-rules.test.js: die Browser-Skripte laufen der Reihe nach in einem
// gemeinsamen vm-Kontext, einziger Stub ist DATA.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/training-load.js", "js/analytics/plan-rules.js",
  "js/analytics/periodization.js", "js/analytics/training-plan.js"];

const app = vm.createContext({ DATA: [] });
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x)); // Objekte aus dem vm-Kontext haben eigene Prototypen

/* ---------- Testdaten ---------- */

const TODAY = new Date(2026, 9, 12, 9, 0); // Montag, 12.10.2026, 9 Uhr (wie plan-rules.test.js)
const day = n => run(`localDateStr(new Date(2026, 9, ${12 + n}))`);
const goalOn = date => ({ id: "g1", name: "Testrennen", sport: "Triathlon", date, isPrimary: true });
const phaseOn = raceDay => app.getPhase(TODAY, goalOn(day(raceDay))); // Phase heute bei Rennen an Tag raceDay

const hist = (date, sport, duration_min) => ({ date: `${date}T07:00:00`, _date: new Date(`${date}T07:00:00`), sport, duration_min });

// Echte Trainingswoche: Minuten verteilt auf Di/Mi/Fr/Sa (jede Einheit < 120 min).
function histWeek(mondayOffset, minutes) {
  const part = Math.round(minutes / 4);
  return [[1, "Laufen"], [2, "Rad"], [4, "Schwimmen"], [5, "Rad"]]
    .map(([d, sport], i) => hist(day(mondayOffset + d), sport, i === 3 ? minutes - 3 * part : part));
}

// Vorwochen 14.09.-11.10.: 300, 320, 200 (Entlastung), 330 Minuten.
const HISTORY = [...histWeek(-28, 300), ...histWeek(-21, 320), ...histWeek(-14, 200), ...histWeek(-7, 330)];

/* ---------- getPhase ---------- */

test("getPhase: Rennen in 20 Wochen, 10 Wochen, 5 Wochen, 10 Tagen, 3 Tagen", () => {
  assert.strictEqual(phaseOn(140), "grundlage");
  assert.strictEqual(phaseOn(70), "aufbau");
  assert.strictEqual(phaseOn(35), "spezifisch");
  assert.strictEqual(phaseOn(10), "taper");
  assert.strictEqual(phaseOn(3), "taper");
});

test("getPhase: Rennen gestern -> Erholung, 7 Tage lang, danach keine Phase", () => {
  assert.strictEqual(phaseOn(-1), "erholung");
  assert.strictEqual(phaseOn(-7), "erholung");
  assert.strictEqual(phaseOn(-8), null);
  assert.strictEqual(phaseOn(0), "taper", "der Wettkampftag selbst gehört noch zum Taper");
});

test("getPhase: ohne Ziel oder ohne Datum -> null", () => {
  assert.strictEqual(app.getPhase(TODAY, null), null);
  assert.strictEqual(app.getPhase(TODAY, { name: "Marathon", sport: "Laufen" }), null);
  assert.strictEqual(app.getPhase(TODAY, { name: "Marathon", date: null }), null);
  assert.strictEqual(app.getPhase(null, goalOn(day(35))), null);
  assert.strictEqual(app.getPhase("kein-datum", goalOn(day(35))), null);
});

test("getPhase: nimmt Date und \"YYYY-MM-DD\" gleich", () => {
  const goal = goalOn(day(35));
  assert.strictEqual(app.getPhase(day(0), goal), app.getPhase(TODAY, goal));
  assert.strictEqual(app.getPhase(day(29), goal), "taper");
});

test("Phasengrenzen (Rennen am Sonntag): Taper 2 Wochen, Spezifisch 6, Aufbau 8, ganze Kalenderwochen", () => {
  const race = goalOn(day(132)); // Sonntag, 21.02.2027
  const timeline = plain(app.getPhaseTimeline(TODAY, race));
  assert.deepStrictEqual(timeline.map(s => s.phase), ["grundlage", "aufbau", "spezifisch", "taper", "erholung"]);
  const byPhase = Object.fromEntries(timeline.map(s => [s.phase, s]));
  assert.deepStrictEqual([byPhase.taper.from, byPhase.taper.to], [day(119), day(132)]); // Mo 13 Tage vorher bis Wettkampftag
  assert.deepStrictEqual([byPhase.spezifisch.from, byPhase.spezifisch.to], [day(77), day(118)]); // 6 Wochen
  assert.deepStrictEqual([byPhase.aufbau.from, byPhase.aufbau.to], [day(21), day(76)]); // 8 Wochen
  assert.deepStrictEqual([byPhase.grundlage.from, byPhase.grundlage.to], [day(0), day(20)]);
  assert.deepStrictEqual([byPhase.erholung.from, byPhase.erholung.to], [day(133), day(139)]);
  // Abschnitte lückenlos aneinander
  for (let i = 1; i < timeline.length; i++) assert.strictEqual(timeline[i].from, run(`planShiftDay("${timeline[i - 1].to}", 1)`));
});

test("Taper beginnt für jeden Wochentag des Rennens 7 bis 14 Tage vorher, immer an einem Montag", () => {
  for (let raceDay = 63; raceDay < 70; raceDay++) {
    const taper = plain(app.getPhaseTimeline(TODAY, goalOn(day(raceDay)))).find(s => s.phase === "taper");
    const daysBefore = raceDay - Math.round((new Date(taper.from + "T00:00:00") - new Date(2026, 9, 12)) / 86400000);
    assert.ok(daysBefore >= 7 && daysBefore <= 14, `Rennen an Tag ${raceDay}: Taper ${daysBefore} Tage vorher`);
    assert.strictEqual(new Date(taper.from + "T00:00:00").getDay(), 1);
  }
});

test("getPhaseTimeline: ohne Phase leer, erster Abschnitt = aktuelle Phase", () => {
  assert.deepStrictEqual(plain(app.getPhaseTimeline(TODAY, null)), []);
  assert.deepStrictEqual(plain(app.getPhaseTimeline(TODAY, goalOn(day(-30)))), []);
  const t = plain(app.getPhaseTimeline(TODAY, goalOn(day(-3))));
  assert.deepStrictEqual(t, [{ phase: "erholung", from: day(0), to: day(4) }]);
});

/* ---------- computeTrainingPhase ---------- */

test("computeTrainingPhase gibt getPhase weiter ({ key, label }), plus unklar/nach-event", () => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  [-8, -3, 0, 5, 12, 30, 60, 100, 200].forEach(n => {
    const race = new Date(today); race.setDate(race.getDate() + n);
    const expected = app.getPhase(today, { date: run(`localDateStr(new Date(${race.getTime()}))`) });
    const r = plain(app.computeTrainingPhase(n));
    assert.deepStrictEqual(Object.keys(r).sort(), ["key", "label"]);
    assert.strictEqual(r.key, expected || "nach-event", `daysUntil ${n}`);
    if (expected) assert.strictEqual(r.label, run(`PERIOD_PHASES.${expected}.label`));
  });
  assert.deepStrictEqual(plain(app.computeTrainingPhase(null)), { key: "unklar", label: "kein Zieldatum" });
  assert.deepStrictEqual(plain(app.computeTrainingPhase(-30)), { key: "nach-event", label: "nach dem Ziel-Event" });
});

/* ---------- getWeeklyTargets ---------- */

const SUNDAY_RACE = goalOn(day(69)); // Sonntag, 20.12.2026 - Rennwoche ab 14.12.
const targets = (history, plan = [], goal = SUNDAY_RACE) => plain(app.getWeeklyTargets(goal, plan, history, TODAY));

test("getWeeklyTargets: ohne Ziel/Datum null", () => {
  assert.strictEqual(app.getWeeklyTargets(null, [], HISTORY, TODAY), null);
  assert.strictEqual(app.getWeeklyTargets({ name: "x" }, [], HISTORY, TODAY), null);
});

test("getWeeklyTargets: Kurve von heute bis zur Erholungswoche", () => {
  const t = targets(HISTORY);
  assert.strictEqual(t.baselineMin, 288); // (300 + 320 + 200 + 330) / 4
  assert.strictEqual(t.baselineWeeks, 4);
  assert.deepStrictEqual(t.weeks.map(w => w.weekStart), Array.from({ length: 11 }, (_, i) => day(7 * i)));
  assert.deepStrictEqual(t.weeks.map(w => w.phase), ["aufbau", "aufbau", ...Array(6).fill("spezifisch"), "taper", "taper", "erholung"]);
  assert.deepStrictEqual(t.weeks.map(w => w.type), ["belastung", "belastung", "entlastung", "belastung", "belastung", "belastung",
    "entlastung", "belastung", "taper", "rennwoche", "erholung"]);
  // Start = Ø, höchstens die letzte normale Woche (330), auf 5 abgerundet; +5 % im Aufbau,
  // Entlastung -30 % (Regel 4), Spezifisch hält, Taper 70 % / 50 %, Erholung 40 %.
  assert.deepStrictEqual(t.weeks.map(w => w.targetMin), [285, 295, 205, 295, 295, 295, 205, 295, 205, 145, 115]);
  assert.strictEqual(Math.round(t.weeks[0].targetPct * 100), 99);
  assert.strictEqual(Math.round(t.weeks[9].targetPct * 100), 50);
});

test("getWeeklyTargets: erledigt + noch geplant je Woche, Wettkampftag zählt nicht", () => {
  const plan = [
    { id: "a", date: day(1), sport: "Laufen", duration_min: 50, intensity: "leicht", status: "geplant" },
    { id: "b", date: day(3), sport: "Rad", duration_min: 70, intensity: "leicht", status: "geplant" },
    { id: "c", date: day(68), sport: "Laufen", duration_min: 20, intensity: "leicht", status: "geplant" },
    { id: "d", date: day(69), sport: "Laufen", duration_min: 300, intensity: "hart", status: "geplant" }, // Wettkampf
  ];
  const history = [...HISTORY, hist(day(0), "Schwimmen", 40)];
  const t = targets(history, plan);
  assert.deepStrictEqual([t.weeks[0].doneMin, t.weeks[0].plannedMin], [40, 120]);
  assert.deepStrictEqual([t.weeks[9].doneMin, t.weeks[9].plannedMin], [0, 20]);
});

test("getWeeklyTargets: ohne Trainingsdaten nur Prozent, keine Minuten", () => {
  const t = targets([]);
  assert.strictEqual(t.baselineMin, null);
  assert.ok(t.weeks.every(w => w.targetMin === null));
  assert.strictEqual(t.weeks[0].targetPct, 1);
  assert.strictEqual(t.weeks[1].targetPct, 1.05);
});

test("Entlastungswoche genau dann, wenn Regel 4 (plan-rules.js) sie verlangt", () => {
  const history = [...histWeek(-28, 300), ...histWeek(-21, 300), ...histWeek(-14, 300), ...histWeek(-7, 300)];
  const t = targets(history);
  assert.strictEqual(t.weeks[0].type, "entlastung");
  assert.strictEqual(t.weeks[0].targetMin, 210);

  const week = minutes => [day(1), day(3), day(5)].map((d, i) => ({ id: "w" + i, date: d, sport: ["Schwimmen", "Rad", "Laufen"][i], title: "x", duration_min: minutes / 3, intensity: "leicht", status: "geplant" }));
  const deload = plan => plain(app.validatePlan(plan, history, null, null, { today: TODAY, acwr: 1.0, goal: SUNDAY_RACE })).filter(v => v.rule === "deload");
  assert.strictEqual(deload(week(300)).length, 1);
  assert.strictEqual(deload(week(210)).length, 0);
});

test("Ein Plan genau nach der Kurve verstößt gegen keine Umfangsregel", () => {
  const t = targets(HISTORY);
  const days = [1, 3, 5, 2, 4]; // Di, Do, Sa, Mi, Fr - nie der Wettkampfsonntag
  const sports = ["Schwimmen", "Rad", "Laufen"];
  const plan = [];
  t.weeks.forEach((w, wi) => {
    const n = Math.ceil(w.targetMin / 100);
    const part = Math.floor(w.targetMin / n / 5) * 5;
    for (let i = 0; i < n; i++) {
      plan.push({ id: `p${wi}-${i}`, date: run(`planShiftDay("${w.weekStart}", ${days[i]})`), sport: sports[i % 3], title: "locker",
        duration_min: i === 0 ? w.targetMin - part * (n - 1) : part, intensity: "leicht", status: "geplant" });
    }
  });
  const result = plain(app.validatePlan(plan, HISTORY, null, null, { today: TODAY, acwr: 1.0, goal: SUNDAY_RACE }));
  assert.deepStrictEqual(result.filter(v => ["volume_increase", "deload", "phase_volume", "recovery_week"].includes(v.rule)), []);
});
