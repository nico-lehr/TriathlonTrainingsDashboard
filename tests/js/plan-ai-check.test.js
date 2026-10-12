// Tests für die Regelprüfung von KI-Plänen (checkedPlanFromAi,
// js/ai/ollama.js), die Regeln als Prompt-Text (planRulesText,
// js/analytics/plan-rules.js) und den Zahlen-Schutz der Empfehlungen
// (parseOutlookResponse, js/ai/ollama.js). Die KI-Anfrage ist gemockt.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/training-load.js", "js/analytics/plan-rules.js", "js/analytics/periodization.js",
  "js/data/planned-workouts.js", "js/ai/ollama.js"];

const app = vm.createContext({
  DATA: [], window: {}, setTimeout: () => 0, clearTimeout: () => {},
  apiCall: () => Promise.resolve({}), storeGet: () => null, storeSet: () => {},
  goals: [], // sonst js/data/goals.js
});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x));

/* ---------- Testdaten (wie plan-rules.test.js: Montag, 12.10.2026) ---------- */

const TODAY = new Date(2026, 9, 12, 9, 0);
const day = n => run(`localDateStr(new Date(2026, 9, ${12 + n}))`);
const TRIATHLON = { id: "g1", name: "Ironman 70.3", sport: "Triathlon", date: "2027-06-13", isPrimary: true };

let nextId = 1;
const pw = (date, sport, duration_min, intensity) =>
  ({ id: "pw" + nextId++, date, sport, title: `${sport} ${intensity}`, duration_min, intensity, status: "geplant", goalId: "g1" });

// Saubere Woche (Mo frei, 1 harte Einheit) - wie cleanWeek() in plan-rules.test.js.
const cleanWeek = () => [
  pw(day(1), "Schwimmen", 45, "leicht"), pw(day(2), "Laufen", 50, "hart"), pw(day(3), "Rad", 60, "leicht"),
  pw(day(4), "Schwimmen", 40, "leicht"), pw(day(5), "Rad", 120, "leicht"), pw(day(6), "Laufen", 60, "leicht"),
];
// KI-Vorschlag mit zwei harten Tagen hintereinander (Mi + Do).
const hardInRowWeek = () => { const w = cleanWeek(); w[2] = pw(day(3), "Rad", 60, "hart"); return w; };

const validate = list => app.validatePlan(list, [], null, null, { today: TODAY, acwr: 1.0, goal: TRIATHLON });
const fix = (list, s) => app.applyPlanSuggestion(list, s, { goalId: "g1", source: "ai" });

// Gemockte KI: liefert der Reihe nach die Vorschläge aus `answers` und merkt
// sich, mit welchen Verstößen sie gefragt wurde.
function mockAsk(answers, base = []) {
  const calls = [];
  const ask = async violations => {
    calls.push(plain(violations));
    const proposal = answers[Math.min(calls.length, answers.length) - 1]();
    return { base, list: [...base, ...proposal] };
  };
  return { ask, calls };
}
const blocksOf = list => plain(validate(list)).filter(v => v.severity === "block");

/* ---------- checkedPlanFromAi ---------- */

test("sauberer Vorschlag: eine KI-Anfrage, unverändert übernommen", async () => {
  const { ask, calls } = mockAsk([cleanWeek]);
  const r = plain(await app.checkedPlanFromAi({ ask, validate, fix }));
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], []);
  assert.strictEqual(r.attempts, 1);
  assert.deepStrictEqual(r.corrected, []);
  assert.strictEqual(r.list.length, 6);
  assert.deepStrictEqual(blocksOf(r.list), []);
});

test("block-Verstoß wird automatisch behoben, ohne zweite KI-Anfrage", async () => {
  const { ask, calls } = mockAsk([hardInRowWeek]);
  const r = plain(await app.checkedPlanFromAi({ ask, validate, fix }));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(r.attempts, 1);
  assert.strictEqual(r.corrected.length, 1);
  assert.match(r.corrected[0], /Verschiebe|locker/);
  assert.deepStrictEqual(blocksOf(r.list), [], "kein block im gespeicherten Plan");
  assert.ok(r.violations.every(v => v.severity === "warn"));
});

test("nicht behebbar: zweite KI-Anfrage bekommt die Verstoß-Texte", async () => {
  const noFix = () => null; // Korrektur greift nicht -> KI muss nachbessern
  const { ask, calls } = mockAsk([hardInRowWeek, cleanWeek]);
  const r = plain(await app.checkedPlanFromAi({ ask, validate, fix: noFix }));
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[1].length >= 1 && calls[1].every(v => v.severity === "block"));
  assert.match(calls[1][0].text, /harte Tage hintereinander/);
  assert.strictEqual(r.attempts, 2);
  assert.deepStrictEqual(blocksOf(r.list), []);
});

test("nach 2 Versuchen noch block: nichts speichern, Verstöße zurückgeben", async () => {
  const { ask, calls } = mockAsk([hardInRowWeek, hardInRowWeek]);
  const r = plain(await app.checkedPlanFromAi({ ask, validate, fix: () => null }));
  assert.strictEqual(calls.length, 2, "höchstens 2 KI-Anfragen");
  assert.strictEqual(r.list, null);
  assert.ok(r.violations.length && r.violations.every(v => v.severity === "block"));
});

test("Verstöße, die es vorher schon gab, blockieren den neuen Vorschlag nicht", async () => {
  const base = [pw(day(2), "Laufen", 50, "hart"), pw(day(3), "Rad", 60, "hart")]; // schon vorher hart/hart
  const nextWeek = () => [pw(day(8), "Schwimmen", 45, "leicht"), pw(day(9), "Laufen", 40, "leicht")];
  const { ask } = mockAsk([nextWeek], base);
  const r = plain(await app.checkedPlanFromAi({ ask, validate, fix }));
  assert.strictEqual(r.attempts, 1);
  assert.deepStrictEqual(r.corrected, []);
  assert.strictEqual(r.list.length, 4);
});

test("Fehler der KI-Anfrage (z.B. kein gültiges JSON) werden nicht verschluckt", async () => {
  const ask = async () => { throw new Error("Antwort war kein gültiges JSON."); };
  await assert.rejects(app.checkedPlanFromAi({ ask, validate, fix }), /kein gültiges JSON/);
});

/* ---------- planRulesText ---------- */

test("planRulesText: Zahlen kommen aus den Konstanten des Regelwerks", () => {
  const text = app.planRulesText(TRIATHLON);
  const c = run(`({ hardMin: PLAN_HARD_MIN_DURATION, maxHard: PLAN_MAX_HARD_PER_WEEK, easy: PLAN_EASY_SHARE_TARGET,
    free: PLAN_MIN_FREE_DAYS, inc: PLAN_MAX_WEEKLY_INCREASE, deloadEvery: PLAN_DELOAD_EVERY_WEEKS, deload: PLAN_DELOAD_REDUCTION,
    acwr: PLAN_ACWR_LIMIT, hrv: PLAN_HRV_DROP_PCT, rhr: PLAN_RHR_RISE_BPM })`);
  [`${c.hardMin} Minuten`, `Höchstens ${c.maxHard} harte`, `${Math.round(c.easy * 100)} %`, `Mindestens ${c.free} komplett freier`,
    `${Math.round(c.inc * 100)} %`, `Nach ${c.deloadEvery - 1} Aufbauwochen`, `${Math.round(c.deload * 100)} % weniger`,
    `über ${String(c.acwr).replace(".", ",")}`, `${c.hrv} % unter`, `${c.rhr} Schläge`, "Schwimmen, Rad, Laufen"]
    .forEach(part => assert.ok(text.includes(part), `fehlt: ${part}\n${text}`));
  assert.ok(!app.planRulesText(null).includes("Sportart des Ziels"), "ohne Ziel keine Ziel-Sportarten-Regel");
  // Periodisierung: Zahlen aus periodization.js, nur mit Zieldatum
  const p = run(`({ t1: PERIOD_TAPER_FACTORS[1], t0: PERIOD_TAPER_FACTORS[0], rec: PERIOD_RECOVERY_FACTOR, days: PERIOD_RECOVERY_DAYS })`);
  [`${Math.round(p.t1 * 100)} %, ${Math.round(p.t0 * 100)} % und ${Math.round(p.rec * 100)} %`, `In den ${p.days} Tagen nach dem Wettkampf nur "leicht"`]
    .forEach(part => assert.ok(text.includes(part), `fehlt: ${part}\n${text}`));
  assert.ok(!app.planRulesText({ ...TRIATHLON, date: null }).includes("Taper"), "ohne Zieldatum keine Taper-Regel");
});

/* ---------- Empfehlungen: Zahlen nur aus dem Prompt ---------- */

const PROMPT = "Form (TSB) +5,2: frisch / gut erholt\nBelastungsverhältnis (ACWR) 1,15: optimaler Bereich\nWettkampf in 34 Wochen (240 Tage)\nHRV (Garmin, 11.10.): -8 %";

test("parseOutlookResponse: Sätze mit erfundenen Zahlen fliegen aus der Begründung", () => {
  const raw = JSON.stringify({
    heute: { empfehlung: "Locker 45 min laufen.", begruendung: "Dein ACWR liegt bei 1.15 und die HRV ist 8 % unter dem Mittel. Du hast 42 % mehr Umfang als sonst." },
    diese_woche: { empfehlung: "Plan so umsetzen.", begruendung: "Der Wettkampf ist noch 34 Wochen entfernt, die Form ist mit +5,2 gut." },
    naechste_woche: { empfehlung: "Etwas mehr Umfang.", begruendung: "Seit dem 11.10. bist du gut erholt." },
  });
  const r = plain(app.parseOutlookResponse("Hier: " + raw, PROMPT));
  assert.strictEqual(r.heute.begruendung, "Dein ACWR liegt bei 1.15 und die HRV ist 8 % unter dem Mittel.");
  assert.strictEqual(r.heute.empfehlung, "Locker 45 min laufen.");
  assert.strictEqual(r.diese_woche.begruendung, "Der Wettkampf ist noch 34 Wochen entfernt, die Form ist mit +5,2 gut.");
  assert.strictEqual(r.naechste_woche.begruendung, "Seit dem 11.10. bist du gut erholt.");
});

test("parseOutlookResponse: kaputte oder leere Antworten werden gemeldet", () => {
  assert.throws(() => app.parseOutlookResponse("kein json", PROMPT), /kein gültiges JSON/);
  assert.throws(() => app.parseOutlookResponse("{}", PROMPT), /Keine Empfehlungen/);
  const partial = plain(app.parseOutlookResponse(JSON.stringify({ heute: { empfehlung: "Ruhetag." } }), PROMPT));
  assert.deepStrictEqual(partial.diese_woche, { empfehlung: "", begruendung: "" });
});
