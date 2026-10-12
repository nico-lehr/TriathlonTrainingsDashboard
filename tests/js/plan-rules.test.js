// Tests für das Trainingsplaner-Regelwerk (js/analytics/plan-rules.js).
// Ausführen: node --test tests/js/   (Node 22, keine npm-Pakete nötig)
//
// Die Browser-Skripte werden wie in index.html der Reihe nach in einen
// gemeinsamen vm-Kontext geladen (utils -> analytics). Einziger Stub ist
// DATA (sonst js/data/workouts.js): daraus rechnet training-load.js den ACWR.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/training-load.js", "js/analytics/plan-rules.js", "js/analytics/periodization.js"];

const app = vm.createContext({ DATA: [] });
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));

/* ---------- Testdaten ---------- */

const TODAY = new Date(2026, 9, 12, 9, 0); // Montag, 12.10.2026, 9 Uhr

// "YYYY-MM-DD" relativ zu heute: day(0) = Mo 12.10., day(-1) = So 11.10.
function day(n) {
  const d = new Date(2026, 9, 12 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let nextId = 1;
const pw = (date, sport, duration_min, intensity, status = "geplant") =>
  ({ id: "pw" + nextId++, date, sport, title: `${sport} ${intensity}`, duration_min, intensity, status });

const hist = (date, sport, duration_min, extra = {}) =>
  ({ date: `${date}T07:00:00`, _date: new Date(`${date}T07:00:00`), sport, duration_min, ...extra });

// Echte Trainingswoche (Historie): Minuten verteilt auf Di/Mi/Fr/Sa, jede
// Einheit unter 120 min (also nicht automatisch "hart").
function histWeek(mondayOffset, minutes) {
  const part = Math.round(minutes / 4);
  return [[1, "Laufen"], [2, "Rad"], [4, "Schwimmen"], [5, "Rad"]]
    .map(([d, sport], i) => hist(day(mondayOffset + d), sport, i === 3 ? minutes - 3 * part : part));
}

// Vorwochen: 21.09. 400 min, 28.09. 260 min (Entlastungswoche), 05.10. 370 min.
const HISTORY = [...histWeek(-21, 400), ...histWeek(-14, 260), ...histWeek(-7, 370)];

// Saubere Triathlon-Woche: Mo frei, 1 harte Einheit, 375 min (+1 %).
function cleanWeek() {
  return [
    pw(day(1), "Schwimmen", 45, "leicht"),
    pw(day(2), "Laufen", 50, "hart"),
    pw(day(3), "Rad", 60, "leicht"),
    pw(day(4), "Schwimmen", 40, "leicht"),
    pw(day(5), "Rad", 120, "leicht"),
    pw(day(6), "Laufen", 60, "leicht"),
  ];
}

const TRIATHLON = { id: "g1", name: "Ironman 70.3 Kraichgau", sport: "Triathlon", date: "2027-06-13", isPrimary: true };
const GOOD_RECOVERY = { date: day(0), soreness: "light", energy: "normal", injury: "no" };
const GOOD_WELLNESS = {
  hrv_ms: { date: day(0), value: 64, baseline: 62, deltaPct: 3.2 },
  resting_hr: { date: day(0), value: 49, baseline: 48, deltaPct: 2.1 },
};

const ACTIONS = ["set_intensity", "reduce_duration", "move", "make_rest_day", "reduce_week_volume", "add_easy_session"];

// Ruft validatePlan() im vm-Kontext auf und prüft die Form jedes Verstoßes.
// JSON-Kopie, weil Objekte aus dem vm-Kontext eigene Prototypen haben.
function validate(plan, { history = HISTORY, wellness = GOOD_WELLNESS, recovery = GOOD_RECOVERY, ...options } = {}) {
  const result = JSON.parse(JSON.stringify(app.validatePlan(plan, history, wellness, recovery, { today: TODAY, acwr: 1.0, ...options })));
  result.forEach(v => {
    assert.match(v.rule, /^[a-z_]+$/);
    assert.ok(["block", "warn"].includes(v.severity), `severity ${v.severity}`);
    assert.ok(v.date === null || /^\d{4}-\d{2}-\d{2}$/.test(v.date), `date ${v.date}`);
    assert.ok(typeof v.text === "string" && v.text.length > 20, "deutscher Text fehlt");
    assert.ok(v.suggestion && typeof v.suggestion.text === "string" && v.suggestion.text.length > 10, "Vorschlagstext fehlt");
    assert.ok(ACTIONS.includes(v.suggestion.action), `action ${v.suggestion.action}`);
  });
  return result;
}

const byRule = (result, rule) => result.filter(v => v.rule === rule);

// Wendet einen Vorschlag auf eine Kopie des Plans an (so wie es später die UI tut).
function applySuggestion(plan, s) {
  const copy = plan.map(p => ({ ...p }));
  const find = id => copy.find(p => p.id === id);
  if (s.action === "move") find(s.workoutId).date = s.toDate;
  if (s.action === "set_intensity") Object.assign(find(s.workoutId), { intensity: s.intensity }, s.duration_min ? { duration_min: s.duration_min } : {});
  if (s.action === "reduce_duration") find(s.workoutId).duration_min = s.duration_min;
  if (s.action === "reduce_week_volume") s.workouts.forEach(w => { find(w.workoutId).duration_min = w.duration_min; });
  if (s.action === "make_rest_day") return copy.filter(p => !s.workoutIds.includes(p.id));
  return copy;
}

/* ---------- Tests ---------- */

test("saubere Woche: keine Verstöße", () => {
  assert.deepStrictEqual(validate(cleanWeek(), { goal: TRIATHLON }), []);
});

test("kein offener Plan: leere Liste", () => {
  assert.deepStrictEqual(validate([pw(day(-2), "Laufen", 50, "hart", "erledigt")]), []);
});

test("Regel 1: zwei harte Tage hintereinander -> block, Verschiebung ohne neuen Verstoß", () => {
  const plan = cleanWeek();
  plan[2] = pw(day(3), "Rad", 60, "hart"); // Mi hart + Do hart
  const v = byRule(validate(plan), "hard_in_row");
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, "block");
  assert.strictEqual(v[0].workoutId, plan[2].id);
  assert.strictEqual(v[0].date, day(3));
  assert.match(v[0].text, /harte Tage hintereinander/);
  assert.strictEqual(v[0].suggestion.action, "move");
  assert.strictEqual(v[0].suggestion.toDate, day(4)); // Fr: Nachbartage danach nicht hart

  const fixed = validate(applySuggestion(plan, v[0].suggestion));
  assert.deepStrictEqual(fixed.filter(x => x.severity === "block"), []);
});

test("Regel 1: harter Vortag aus der Historie bzw. 'erledigt' zählt, 'uebersprungen' nicht", () => {
  const plan = [pw(day(0), "Laufen", 50, "hart"), pw(day(2), "Schwimmen", 40, "leicht")];
  const longRide = [...HISTORY, hist(day(-1), "Rad", 150)]; // 150 min = hart
  const v = byRule(validate(plan, { history: longRide }), "hard_in_row");
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].workoutId, plan[0].id);

  const done = [...plan, pw(day(-1), "Rad", 60, "hart", "erledigt")];
  assert.strictEqual(byRule(validate(done), "hard_in_row").length, 1);

  const skipped = [...plan, pw(day(-1), "Rad", 60, "hart", "uebersprungen")];
  assert.strictEqual(byRule(validate(skipped), "hard_in_row").length, 0);
});

test("Regel 2: vier harte Einheiten -> warn an der letzten", () => {
  const plan = [
    pw(day(0), "Laufen", 45, "hart"),
    pw(day(1), "Schwimmen", 45, "leicht"),
    pw(day(2), "Rad", 60, "hart"),
    pw(day(3), "Laufen", 50, "leicht"),
    pw(day(4), "Schwimmen", 40, "VO2max"),
    pw(day(6), "Rad", 90, "hart"), // Sa frei
  ];
  const result = validate(plan);
  const v = byRule(result, "hard_per_week");
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, "warn");
  assert.strictEqual(v[0].workoutId, plan[5].id);
  assert.match(v[0].text, /4 harte Einheiten/);
  assert.deepStrictEqual([v[0].suggestion.action, v[0].suggestion.intensity], ["set_intensity", "leicht"]);
  assert.strictEqual(byRule(result, "hard_in_row").length, 0);
  // 80/20: nur 95 von 330 Minuten locker -> zusätzlich Hinweis
  assert.strictEqual(byRule(result, "easy_share")[0].severity, "warn");
});

test("Regel 3: Woche ohne Ruhetag -> block, Ruhetag kostet nicht die einzige lockere Schwimmeinheit", () => {
  const plan = [
    pw(day(0), "Schwimmen", 30, "leicht"), // kürzester Tag, aber einzige lockere Schwimmeinheit
    pw(day(1), "Laufen", 45, "leicht"),
    pw(day(2), "Rad", 60, "hart"),
    pw(day(3), "Laufen", 40, "leicht"),
    pw(day(4), "Schwimmen", 45, "hart"),
    pw(day(5), "Rad", 100, "leicht"),
    pw(day(6), "Laufen", 50, "leicht"),
  ];
  const v = byRule(validate(plan, { goal: TRIATHLON }), "rest_day");
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, "block");
  assert.strictEqual(v[0].date, day(0)); // Montag der Woche
  assert.strictEqual(v[0].suggestion.action, "make_rest_day");
  assert.notStrictEqual(v[0].suggestion.date, day(0));
  assert.match(v[0].suggestion.text, /Ruhetag/);

  const fixed = validate(applySuggestion(plan, v[0].suggestion), { goal: TRIATHLON });
  assert.strictEqual(byRule(fixed, "rest_day").length, 0);
  assert.strictEqual(byRule(fixed, "goal_base").length, 0);
});

test("Regel 4: +25 % Wochenumfang -> warn mit gleichmäßiger Kürzung", () => {
  const plan = [
    pw(day(1), "Schwimmen", 60, "leicht"),
    pw(day(2), "Laufen", 60, "hart"),
    pw(day(3), "Rad", 90, "leicht"),
    pw(day(4), "Schwimmen", 60, "leicht"),
    pw(day(5), "Rad", 120, "leicht"),
    pw(day(6), "Laufen", 75, "leicht"),
  ]; // 465 min statt 370
  const v = byRule(validate(plan), "volume_increase");
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, "warn");
  assert.match(v[0].text, /26 % mehr/);
  const s = v[0].suggestion;
  assert.strictEqual(s.action, "reduce_week_volume");
  assert.strictEqual(s.weekStart, day(0));
  assert.strictEqual(s.target_minutes, 407);

  const fixed = applySuggestion(plan, s);
  assert.ok(fixed.reduce((sum, p) => sum + p.duration_min, 0) <= 407);
  assert.strictEqual(byRule(validate(fixed), "volume_increase").length, 0);
});

test("Regel 4: Wiedereinstieg nach Entlastungswoche ist kein Sprung", () => {
  // Vorwoche (05.10.) war Entlastung: Vergleich mit der Woche davor (400 min).
  const history = [...histWeek(-21, 380), ...histWeek(-14, 400), ...histWeek(-7, 260)];
  assert.strictEqual(byRule(validate(cleanWeek(), { history }), "volume_increase").length, 0);
});

test("Regel 4: 4. Aufbauwoche ohne Entlastung -> warn mit ~30 % weniger", () => {
  const history = [...histWeek(-21, 330), ...histWeek(-14, 345), ...histWeek(-7, 360)];
  const plan = cleanWeek();
  const result = validate(plan, { history });
  const v = byRule(result, "deload");
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, "warn");
  assert.match(v[0].text, /4\. Aufbauwoche/);
  assert.strictEqual(v[0].suggestion.action, "reduce_week_volume");
  assert.strictEqual(v[0].suggestion.target_minutes, 252); // 360 * 0,7
  assert.strictEqual(byRule(result, "volume_increase").length, 0);

  const fixed = validate(applySuggestion(plan, v[0].suggestion), { history });
  assert.strictEqual(byRule(fixed, "deload").length, 0);
});

test("Regel 5: ACWR > 1,3 und harte Einheit morgen -> block, nur locker", () => {
  const plan = [
    pw(day(1), "Laufen", 50, "hart"), // heute frei, morgen hart
    pw(day(2), "Schwimmen", 45, "leicht"),
    pw(day(3), "Rad", 60, "leicht"),
    pw(day(4), "Laufen", 40, "hart"),
  ];
  const v = byRule(validate(plan, { acwr: 1.45 }), "recovery");
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, "block");
  assert.strictEqual(v[0].workoutId, plan[0].id);
  assert.match(v[0].text, /ACWR 1,45/);
  assert.deepStrictEqual([v[0].suggestion.action, v[0].suggestion.intensity], ["set_intensity", "leicht"]);

  assert.strictEqual(byRule(validate(plan, { acwr: 1.2 }), "recovery").length, 0);
});

test("Regel 5: ACWR ohne options.acwr aus der Historie (computePerformanceState)", () => {
  const history = [];
  for (let i = -49; i <= -1; i++) {
    const spike = i >= -7; // letzte Woche plötzlich mehr als doppelt so viel Belastung
    if (spike || i % 2 === 0) history.push(hist(day(i), "Laufen", 60, { training_load: spike ? 110 : 45 }));
  }
  app.DATA = history;
  try {
    assert.ok(app.computePerformanceState().acwr > 1.3);
    const plan = [pw(day(0), "Laufen", 50, "mittel")];
    const v = byRule(validate(plan, { history, acwr: undefined }), "recovery");
    assert.strictEqual(v.length, 1);
    assert.strictEqual(v[0].workoutId, plan[0].id);
  } finally {
    app.DATA = [];
  }
});

test("Regel 5: Verletzung -> block mit Ruhetag-Vorschlag, nur heutiger Check zählt", () => {
  const plan = [pw(day(0), "Laufen", 45, "mittel"), pw(day(0), "Mobility", 20, "leicht"), pw(day(2), "Rad", 60, "leicht")];
  const injured = { date: day(0), soreness: "none", energy: "normal", injury: "yes", injuryNote: "Knie" };
  const v = byRule(validate(plan, { recovery: injured }), "recovery");
  assert.strictEqual(v.length, 1); // die lockere Mobility-Einheit ist erlaubt
  assert.strictEqual(v[0].severity, "block");
  assert.match(v[0].text, /Verletzung/);
  assert.strictEqual(v[0].suggestion.action, "make_rest_day");
  assert.strictEqual(v[0].suggestion.date, day(0));
  assert.deepStrictEqual(v[0].suggestion.workoutIds, [plan[0].id, plan[1].id]);

  const yesterday = { ...injured, date: day(-1) };
  assert.strictEqual(byRule(validate(plan, { recovery: yesterday }), "recovery").length, 0);

  const exhausted = { date: day(0), soreness: "severe", energy: "low", injury: "no" };
  const tired = byRule(validate(plan, { recovery: exhausted }), "recovery");
  assert.strictEqual(tired[0].suggestion.action, "set_intensity");
  assert.match(tired[0].text, /erschöpft/);
});

test("Garmin-Werte: niedrige HRV -> warn, alte oder fehlende Werte werden ignoriert", () => {
  const plan = [pw(day(1), "Laufen", 50, "hart"), pw(day(3), "Rad", 60, "leicht")];
  const lowHrv = { hrv_ms: { date: day(0), value: 50, baseline: 62, deltaPct: -19.4 }, resting_hr: null };
  const v = byRule(validate(plan, { wellness: lowHrv }), "wellness");
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, "warn");
  assert.match(v[0].text, /HRV liegt 19 %/);

  const old = { hrv_ms: { ...lowHrv.hrv_ms, date: day(-5) } };
  assert.strictEqual(byRule(validate(plan, { wellness: old }), "wellness").length, 0);
  assert.strictEqual(byRule(validate(plan, { wellness: null }), "wellness").length, 0);
});

test("Regel 6: Triathlon-Woche ohne lockeres Schwimmen -> warn mit add_easy_session", () => {
  const plan = cleanWeek();
  plan[0] = pw(day(1), "Schwimmen", 45, "hart"); // einzige Schwimmeinheit = Intervalle
  plan[1] = pw(day(2), "Laufen", 50, "leicht");
  plan[3] = pw(day(4), "Laufen", 40, "leicht");
  const v = byRule(validate(plan, { goal: TRIATHLON }), "goal_base");
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, "warn");
  assert.match(v[0].text, /beim Schwimmen/);
  const s = v[0].suggestion;
  assert.deepStrictEqual([s.action, s.sport, s.weekStart, s.date], ["add_easy_session", "Schwimmen", day(0), day(4)]);
  assert.ok(s.duration_min > 0);

  // Ohne Ziel oder bei reinem Laufziel: kein Hinweis zum Schwimmen.
  assert.strictEqual(byRule(validate(plan), "goal_base").length, 0);
  assert.strictEqual(byRule(validate(plan, { goal: { name: "Marathon", sport: "Laufen" } }), "goal_base").length, 0);
});

test("Regel 6: erst halb geplante Woche wird nicht bemängelt", () => {
  const plan = [...cleanWeek(), pw(day(7), "Rad", 60, "leicht")]; // nächste Woche nur Montag
  assert.strictEqual(byRule(validate(plan, { goal: TRIATHLON }), "goal_base").length, 0);
});

/* ---------- Periodisierung (js/analytics/periodization.js) ---------- */

// Anker aus HISTORY: die letzte normale Woche (05.10., 370 min).
const raceOn = n => ({ id: "g2", name: "Stadttriathlon", sport: "Triathlon", date: day(n), isPrimary: true });

test("Periodisierung: Taper-Woche über dem Zielumfang -> ein Hinweis statt +10 %/Entlastung", () => {
  const goal = raceOn(10); // Do 22.10.: diese Woche ist die Woche vor der Rennwoche
  const plan = cleanWeek(); // 375 min
  const result = validate(plan, { goal });
  const v = byRule(result, "phase_volume");
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].severity, "warn");
  assert.strictEqual(v[0].date, day(0));
  assert.match(v[0].text, /Taper-Woche vor „Stadttriathlon“/);
  assert.strictEqual(v[0].suggestion.action, "reduce_week_volume");
  assert.strictEqual(v[0].suggestion.target_minutes, 259); // 370 * 0,7
  assert.strictEqual(byRule(result, "volume_increase").length + byRule(result, "deload").length, 0);

  const fixed = validate(applySuggestion(plan, v[0].suggestion), { goal });
  assert.strictEqual(byRule(fixed, "phase_volume").length, 0);
});

test("Periodisierung: Rennwoche - der Wettkampftag zählt nicht mit und wird nie gekürzt", () => {
  const goal = raceOn(6); // So 18.10.
  const plan = cleanWeek(); // So 60 min Laufen = Wettkampftag
  const v = byRule(validate(plan, { goal }), "phase_volume");
  assert.strictEqual(v.length, 1);
  assert.match(v[0].text, /Rennwoche/);
  assert.match(v[0].text, /315 Minuten/); // 375 - 60
  assert.strictEqual(v[0].suggestion.target_minutes, 185); // 370 * 0,5
  assert.ok(v[0].suggestion.workouts.every(w => w.workoutId !== plan[5].id), "Wettkampftag bleibt");
});

test("Periodisierung: Erholungswoche - nur locker (Regel 7) und weniger Umfang", () => {
  const goal = raceOn(-1); // Rennen gestern
  const plan = [
    pw(day(2), "Laufen", 50, "hart"),
    pw(day(4), "Rad", 150, "leicht"), // lang = hart
    pw(day(5), "Schwimmen", 30, "leicht"),
    pw(day(9), "Laufen", 50, "hart"), // 10 Tage nach dem Rennen: wieder erlaubt
  ];
  const result = validate(plan, { goal });
  const easy = byRule(result, "recovery_week");
  assert.deepStrictEqual(easy.map(v => v.workoutId), [plan[0].id, plan[1].id]);
  assert.ok(easy.every(v => v.severity === "warn"));
  assert.match(easy[0].text, /Erholungswoche nach „Stadttriathlon“/);
  assert.deepStrictEqual([easy[0].suggestion.action, easy[0].suggestion.intensity], ["set_intensity", "leicht"]);
  assert.deepStrictEqual([easy[1].suggestion.action, easy[1].suggestion.duration_min], ["reduce_duration", 120]);

  const vol = byRule(result, "phase_volume");
  assert.strictEqual(vol.length, 1);
  assert.strictEqual(vol[0].suggestion.target_minutes, 148); // 370 * 0,4
});

test("Periodisierung: ohne Zieldatum oder weit vor dem Rennen keine neuen Hinweise", () => {
  const rules = r => r.filter(v => v.rule === "phase_volume" || v.rule === "recovery_week");
  assert.deepStrictEqual(rules(validate(cleanWeek(), { goal: TRIATHLON })), []);
  assert.deepStrictEqual(rules(validate(cleanWeek(), { goal: { name: "Marathon", sport: "Laufen" } })), []);
});
