// Tests für den Morgenbericht (js/components/morning-report.js).
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");

// Uhr fest auf Montag 9.11. 7:00 - der Bericht zeigt sich nur morgens, sonst
// hinge der Test von der Uhrzeit ab, zu der er läuft.
class MorningDate extends Date {
  constructor(...a) { super(...(a.length ? a : [2026, 10, 9, 7, 0])); }
  static now() { return new MorningDate().getTime(); }
}

function makeApp({ night, base = {}, plan = [], store = {}, ai = null } = {}) {
  const saved = { ...store };
  const ctx = vm.createContext({
    console, setTimeout: () => 0, Date: MorningDate, Math, JSON, String, Number, Array, Object, Set,
    storeGet: k => (saved[k] ? JSON.parse(JSON.stringify(saved[k])) : null),
    storeSet: (k, v) => { saved[k] = v; },
    todayStr: () => "2026-11-09",
    wellnessForDate: () => night,
    wellnessBaseline: f => (f in base ? base[f] : null),
    plannedWorkouts: plan,
    PLAN_HRV_DROP_PCT: 10, PLAN_RHR_RISE_BPM: 5, PLAN_READINESS_LOW: 25,
    planShiftDay: () => "2026-11-08",
    localDateStr: () => "", DATA: [],
    apiCall: async () => ({ data: {} }),
    document: { visibilityState: "visible" },
    calls: [],
  });
  if (ai) ctx.callAiText = async (prompt, o) => { ctx.calls.push({ prompt, o }); return ai; };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/components/morning-report.js"), "utf8"), ctx);
  ctx.saved = saved;
  return ctx;
}

const NIGHT = { sleep_min: 452, hrv_ms: 54, resting_hr: 53, body_battery_charged: 61 };
const BASE = { sleep_min: 430, hrv_ms: 62, resting_hr: 47 };

test("Kacheln vergleichen mit dem eigenen Normalwert", () => {
  const app = makeApp({ night: NIGHT, base: BASE });
  const tiles = JSON.parse(JSON.stringify(app.morningValues(NIGHT)));
  assert.deepStrictEqual(tiles.map(t => [t.label, t.value, t.sub, t.cls]), [
    ["Schlaf", "7:32", "Ø 7:10", "good"],
    ["HRV", "54 ms", "−13 % zu Ø", "bad"],
    ["Ruhepuls", "53", "+6 zu Ø", "bad"],
    ["Body Battery", "+61", "aufgeladen", "good"],
  ]);
});

test("ohne Schlaf kein Bericht, weggetippt bleibt weg", () => {
  assert.strictEqual(makeApp({ night: { hrv_ms: 60 } }).morningVisible(new Date(2026, 10, 9, 7)), false);
  const app = makeApp({ night: NIGHT, base: BASE });
  assert.strictEqual(app.morningVisible(new Date(2026, 10, 9, 7)), true);
  assert.strictEqual(app.morningVisible(new Date(2026, 10, 9, 19)), false);
  app.dismissMorningReport();
  assert.strictEqual(app.morningVisible(new Date(2026, 10, 9, 7)), false);
});

test("KI wird je Datenstand nur einmal gefragt, höchstens zweimal am Tag", async () => {
  const plan = [{ id: "p1", date: "2026-11-09", sport: "Laufen", title: "Intervalle 6 × 800 m", duration_min: 55, intensity: "hart", status: "geplant" }];
  const app = makeApp({ night: { ...NIGHT }, base: BASE, plan, ai: "Deine HRV liegt unter dem Schnitt. Mach die Intervalle heute lieber locker." });
  await app.ensureMorningText();
  await app.ensureMorningText();
  assert.strictEqual(app.calls.length, 1);
  assert.strictEqual(app.calls[0].o.task, "morning");
  assert.match(app.calls[0].prompt, /Heute geplant: Laufen „Intervalle 6 × 800 m“, 55 min, hart/);
  assert.match(app.saved.triathlon_dashboard_morning_v1.text, /Intervalle heute lieber locker/);
  plan[0].duration_min = 40; // Plan geändert -> noch einmal
  await app.ensureMorningText();
  plan[0].duration_min = 30;
  await app.ensureMorningText();
  assert.strictEqual(app.calls.length, 2);
});
