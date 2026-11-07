// Tests für die Schritte einer geplanten Einheit (validateWorkoutSteps,
// defaultWorkoutSteps, plannedWorkoutSteps in js/data/planned-workouts.js)
// und ihre Umsetzung in die .fit-Workout-Datei (js/data/fit-workout-writer.js).
// Ausführen: node --test tests/js/
//
// Wie planned-workouts.test.js: Browser-Skripte in einem gemeinsamen
// vm-Kontext; gestubbt sind Server-Ablage, Timer, goals und athleteProfile
// (sonst js/data/athlete.js - daraus liest zones.js die Schwellenpace).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/periodization.js", "js/analytics/zones.js",
  "js/data/planned-workouts.js", "js/data/fit-workout-writer.js"];

const app = vm.createContext({
  DATA: [], window: {}, TextEncoder, setTimeout: () => 0, clearTimeout: () => {},
  apiCall: () => Promise.resolve({}), storeGet: () => null, storeSet: () => {}, storeSaved: () => Promise.resolve(),
  goals: [], athleteProfile: { runThresholdPace: null, swimCss: null },
});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const plain = x => JSON.parse(JSON.stringify(x)); // Objekte aus dem vm-Kontext haben eigene Prototypen

const defaults = pw => plain(app.defaultWorkoutSteps(pw));
const validate = steps => plain(app.validateWorkoutSteps(steps));
const NONE = { kind: "none" };

/* ---------- Standard-Schritte aus Dauer + Intensität ---------- */

const flat = steps => steps.flatMap(s => (s.type === "repeat" ? Array.from({ length: s.count }, () => s.steps).flat() : [s]));
const minutes = steps => flat(steps).reduce((a, s) => a + (s.duration_min || 0), 0);
const near = (a, b) => Math.abs(a - b) < 1e-6;

test("Standard: Laufen leicht = Einlaufen / Grundlage Zone 2 / 4× Steigerung / Auslaufen, mit Hinweisen", () => {
  assert.deepStrictEqual(defaults({ sport: "Laufen", duration_min: 50, intensity: "leicht" }), [
    { type: "warmup", duration_min: 10, target: NONE, note: "Einlaufen · ganz locker" },
    { type: "interval", duration_min: 31, target: { kind: "hr_zone", zone: 2 }, note: "Grundlage · locker, Reden geht" },
    { type: "repeat", count: 4, steps: [
      { type: "interval", duration_min: 1 / 3, target: NONE, note: "Steigerung · locker schnell, kein Sprint" },
      { type: "recovery", duration_min: 2 / 3, target: NONE, note: "Gehen oder traben" },
    ] },
    { type: "cooldown", duration_min: 5, target: NONE, note: "Auslaufen · ganz locker" },
  ]);
});

test("Standard: mittel und hart werden Intervall-Sätze wie beim Garmin Coach", () => {
  const tempo = defaults({ sport: "Laufen", duration_min: 60, intensity: "mittel" });
  assert.deepStrictEqual(tempo.map(s => s.type), ["warmup", "interval", "repeat", "cooldown"]);
  assert.deepStrictEqual(tempo[2].count, 2);
  assert.deepStrictEqual(tempo[2].steps.map(s => [s.type, s.duration_min, s.target.zone]), [["interval", 10, 3], ["recovery", 2, undefined]]);
  const vo2 = defaults({ sport: "Rad", duration_min: 45, intensity: "hart" });
  assert.deepStrictEqual(vo2.map(s => s.type), ["warmup", "repeat", "cooldown"]);
  assert.deepStrictEqual([vo2[1].count, vo2[1].steps[0].duration_min, vo2[1].steps[0].target], [5, 3, { kind: "hr_zone", zone: 5 }]);
  const thr = defaults({ sport: "Rad", duration_min: 90, intensity: "hart" });
  assert.deepStrictEqual([thr[2].count, thr[2].steps[0].duration_min, thr[2].steps[0].target.zone], [5, 8, 4]);
});

test("Standard: Laufen/Rad ergeben zusammen genau die geplante Dauer", () => {
  ["Laufen", "Rad"].forEach(sport => ["leicht", "mittel", "hart"].forEach(intensity => [20, 30, 45, 59, 60, 75, 90, 180].forEach(d => {
    const st = defaults({ sport, duration_min: d, intensity });
    assert.ok(near(minutes(st), d), `${sport} ${intensity} ${d} min -> ${minutes(st)}`);
    assert.ok(app.validateWorkoutSteps(st).steps, `${sport} ${intensity} ${d} gültig`);
  })));
});

test("Standard: Ziele aus dem Profil - Pace (Schwellenpace), Watt (FTP), sonst Puls", () => {
  app.athleteProfile.runThresholdPace = "5:00";
  app.athleteProfile.ftpWatts = 250;
  assert.deepStrictEqual(defaults({ sport: "Laufen", duration_min: 45, intensity: "hart" })[1].steps[0].target, { kind: "pace_zone", zone: 5 });
  assert.deepStrictEqual(defaults({ sport: "Rad", duration_min: 60, intensity: "mittel" })[2].steps[0].target, { kind: "power_zone", zone: 3 });
  app.athleteProfile.runThresholdPace = null;
  app.athleteProfile.ftpWatts = null;
  assert.deepStrictEqual(defaults({ sport: "Laufen", duration_min: 45, intensity: "hart" })[1].steps[0].target, { kind: "hr_zone", zone: 5 });
});

test("Standard: Schwimmen = Einschwimmen / Technik 50 m / Hauptsatz mit Pausen / Ausschwimmen, in Metern mit Stil", () => {
  const st = defaults({ sport: "Schwimmen", duration_min: 45, intensity: "mittel" });
  assert.deepStrictEqual(st.map(s => s.type), ["warmup", "repeat", "repeat", "cooldown"]);
  assert.deepStrictEqual([st[0].distance_km, st[0].stroke], [0.25, "free"]);
  assert.deepStrictEqual(st[1].steps.map(s => [s.type, s.distance_km || s.duration_min * 60, s.stroke]), [["interval", 50, "drill"], ["rest", 15, undefined]].map(([t, v, k]) => [t, t === "interval" ? 0.05 : v, k]));
  assert.deepStrictEqual([st[2].count, st[2].steps[0].distance_km, st[2].steps[0].stroke, st[2].steps[1].type, st[2].steps[1].duration_min * 60], [10, 0.1, "free", "rest", 15]);
  assert.deepStrictEqual([st[3].distance_km, st[3].stroke], [0.2, "any"]);
  // ohne CSS kein Pace-Ziel, mit CSS Pace-Zone im Hauptsatz
  assert.strictEqual(st[2].steps[0].target.kind, "none");
  app.athleteProfile.swimCss = "1:50";
  assert.deepStrictEqual(defaults({ sport: "Schwimmen", duration_min: 45, intensity: "hart" })[2].steps[0].target, { kind: "pace_zone", zone: 4 });
  app.athleteProfile.swimCss = null;
});

test("Standard: Schwimm-Distanzen sind Bahnlängen und die geschätzte Zeit passt ungefähr", () => {
  ["leicht", "mittel", "hart"].forEach(intensity => [30, 45, 60, 90].forEach(d => {
    const st = defaults({ sport: "Schwimmen", duration_min: d, intensity });
    const f = { warmup: 1.25, cooldown: 1.3 };
    const sec = flat(st).reduce((a, s) => a + (s.duration_min ? s.duration_min * 60 : s.distance_km * 1000 / 100 * 120 * (f[s.type] || (s.stroke === "drill" ? 1.4 : 1.05))), 0);
    assert.ok(Math.abs(sec / 60 - d) <= d * 0.15, `${intensity} ${d} min -> ${(sec / 60).toFixed(1)}`);
    assert.ok(flat(st).every(s => !s.distance_km || Math.round(s.distance_km * 1000) % 25 === 0), "Vielfache von 25 m");
  }));
});

test("Standard: ein Satz im Titel (\"6×800 m\", \"5 x 4 min\") wird der Hauptsatz", () => {
  const run = defaults({ sport: "Laufen", duration_min: 60, intensity: "hart", title: "6×800 m mit 2 min Trabpause" });
  const set = run.find(s => s.type === "repeat");
  assert.deepStrictEqual([set.count, set.steps[0].distance_km, set.steps[0].target.zone, set.steps[1].duration_min], [6, 0.8, 4, 2]);
  const bike = defaults({ sport: "Rad", duration_min: 60, intensity: "hart", description: "Intervalle 5 x 4 min" });
  assert.deepStrictEqual([bike.find(s => s.type === "repeat").count, bike.find(s => s.type === "repeat").steps[0].duration_min], [5, 4]);
  const swim = defaults({ sport: "Schwimmen", duration_min: 45, intensity: "mittel", title: "10x100m P 20 s" });
  assert.deepStrictEqual([swim[2].count, swim[2].steps[0].distance_km, swim[2].steps[1].duration_min * 60], [10, 0.1, 20]);
  assert.deepStrictEqual(plain(app.parseMainSet({ title: "Locker 45 min" })), null);
});

test("Standard: kurze Einheit, Kraft/Mobility und Einheit ohne Dauer = ein einziger Schritt", () => {
  assert.deepStrictEqual(defaults({ sport: "Laufen", duration_min: 15, intensity: "leicht" }), [{ type: "interval", duration_min: 15, target: { kind: "hr_zone", zone: 2 }, note: "Locker und gleichmäßig" }]);
  assert.deepStrictEqual(defaults({ sport: "Kraft", duration_min: 45, intensity: "hart" }), [{ type: "interval", duration_min: 45, target: NONE }]);
  assert.deepStrictEqual(defaults({ sport: "Rad", duration_min: null, intensity: "leicht" }), [{ type: "interval", target: { kind: "hr_zone", zone: 2 } }]);
});

test("Hinweis und Schwimmstil bleiben beim Prüfen erhalten, unbekannter Stil fällt weg", () => {
  const out = validate([{ type: "interval", distance_km: 0.1, stroke: "breast", note: "  Brust locker  " }, { type: "rest", duration_min: 0.25, stroke: "kraulen" }]);
  assert.deepStrictEqual(out.steps, [{ type: "interval", distance_km: 0.1, target: NONE, stroke: "breast", note: "Brust locker" }, { type: "rest", duration_min: 0.25, target: NONE }]);
});

/* ---------- Prüfen eigener Schritte ---------- */

const INTERVALS = [
  { type: "warmup", duration_min: 15, extra: "weg" },
  { type: "repeat", count: 6, steps: [
    { type: "interval", distance_km: 0.4, target: { kind: "pace_zone", zone: 4 } },
    { type: "recovery", duration_min: 1.5, target: { kind: "none" } },
  ] },
  { type: "cooldown" },
];

test("gültige Schritte werden bereinigt übernommen (Ziel fehlt = ohne Ziel, fremde Felder fallen weg)", () => {
  const out = validate(INTERVALS);
  assert.deepStrictEqual(out.errors, []);
  assert.deepStrictEqual(out.steps, [
    { type: "warmup", duration_min: 15, target: NONE },
    { type: "repeat", count: 6, steps: [
      { type: "interval", distance_km: 0.4, target: { kind: "pace_zone", zone: 4 } },
      { type: "recovery", duration_min: 1.5, target: NONE },
    ] },
    { type: "cooldown", target: NONE },
  ]);
});

test("ungültige Schritte: steps = null und eine verständliche Meldung je Fehler", () => {
  const bad = (steps, text) => {
    const out = validate(steps);
    assert.strictEqual(out.steps, null);
    assert.ok(out.errors.some(e => e.includes(text)), `${JSON.stringify(out.errors)} enthält nicht "${text}"`);
  };
  bad(null, "Keine Schritte");
  bad([], "Keine Schritte");
  bad([{ type: "sprint", duration_min: 5 }], "unbekannte Art");
  bad([{ type: "interval", duration_min: 5, distance_km: 1 }], "nicht beides");
  bad([{ type: "interval", duration_min: -5 }], "Dauer ungültig");
  bad([{ type: "interval", distance_km: "1" }], "Distanz ungültig");
  bad([{ type: "interval", duration_min: 5, target: { kind: "hr_zone", zone: 6 } }], "Zone 1–5");
  bad([{ type: "interval", duration_min: 5, target: { kind: "laktat", zone: 2 } }], "unbekanntes Ziel");
  bad([{ type: "repeat", count: 0, steps: [{ type: "interval", duration_min: 1 }] }], "Wiederholungen 1–50");
  bad([{ type: "repeat", count: 3, steps: [] }], "ohne Schritte");
  bad([{ type: "repeat", count: 2, steps: [{ type: "repeat", count: 2, steps: [{ type: "rest" }] }] }], "keine Wiederholung in einer Wiederholung");
  bad(Array.from({ length: 51 }, () => ({ type: "interval", duration_min: 1 })), "Höchstens 50");
  bad([{ type: "warmup", duration_min: 5 }, { type: "repeat", count: 2, steps: [{ type: "interval", duration_min: "x" }] }], "Schritt 2.1");
});

test("plannedWorkoutSteps: eigene gültige Schritte, sonst die Standard-Schritte", () => {
  const base = { sport: "Laufen", duration_min: 50, intensity: "leicht" };
  assert.deepStrictEqual(plain(app.plannedWorkoutSteps({ ...base, steps: INTERVALS })), validate(INTERVALS).steps);
  assert.deepStrictEqual(plain(app.plannedWorkoutSteps({ ...base, steps: null })), defaults(base));
  assert.deepStrictEqual(plain(app.plannedWorkoutSteps({ ...base, steps: [{ type: "kaputt" }] })), defaults(base));
});

test("buildPlannedWorkout übernimmt gültige Schritte und verwirft ungültige", () => {
  const entry = { date: "2026-10-14", sport: "Laufen", duration_min: 50, intensity: "hart" };
  assert.deepStrictEqual(plain(app.buildPlannedWorkout({ ...entry, steps: INTERVALS })).steps, validate(INTERVALS).steps);
  assert.strictEqual(app.buildPlannedWorkout({ ...entry, steps: [{ type: "kaputt" }] }).steps, null);
  assert.strictEqual(app.buildPlannedWorkout(entry).steps, null);
});

/* ---------- .fit-Datei ---------- */

test(".fit: Wiederholung steht hinter ihren Schritten und zeigt auf den ersten davon", () => {
  app.athleteProfile.runThresholdPace = null;
  const recs = plain(app.fitWorkoutStepRecords({ sport: "Laufen", title: "6x400", steps: INTERVALS }));
  assert.deepStrictEqual(recs.map(r => [r.name, r.durationType, r.durationValue, r.targetType, r.targetValue, r.intensity]), [
    ["Aufwärmen", 0, 900000, 2, 0, 2],     // 15 min in ms, ohne Ziel, warmup
    ["Belastung", 1, 40000, 2, 0, 0],      // 400 m in cm; Pace-Zone ohne Schwellenpace -> ohne Ziel
    ["Erholung", 0, 90000, 2, 0, 4],
    ["Wiederholung", 6, 1, 2, 6, 0xFF],    // ab Schritt 1, 6 Durchgänge
    ["Abwärmen", 5, 0, 2, 0, 3],           // ohne Dauer = offen
  ]);
});

test(".fit: HF-/Leistungszone als Zonennummer, Pace-Zone als Tempobereich aus der Schwellenpace", () => {
  app.athleteProfile.runThresholdPace = "5:00"; // Z4 = 0,98-1,05 x 300 s/km = 4:54-5:15 /km
  const recs = plain(app.fitWorkoutStepRecords({ sport: "Laufen", steps: [
    { type: "interval", duration_min: 10, target: { kind: "hr_zone", zone: 3 } },
    { type: "interval", duration_min: 10, target: { kind: "power_zone", zone: 2 } },
    { type: "interval", duration_min: 10, target: { kind: "pace_zone", zone: 4 } },
  ] }));
  assert.deepStrictEqual(recs.map(r => [r.targetType, r.targetValue]), [[1, 3], [4, 2], [0, 0]]);
  assert.strictEqual(recs[2].low, Math.round(1000 / 315 * 1000));  // langsamer Rand 5:15 /km in mm/s
  assert.strictEqual(recs[2].high, Math.round(1000 / 294 * 1000)); // schneller Rand 4:54 /km
  app.athleteProfile.runThresholdPace = null;
});

test(".fit: eine Einheit ohne eigene Schritte heißt wie bisher nach ihrem Titel, Datei-CRC stimmt", () => {
  const pw = { sport: "Rad", title: "Locker rollen", duration_min: 15, intensity: "leicht" };
  assert.deepStrictEqual(plain(app.fitWorkoutStepRecords(pw)).map(r => r.name), ["Locker rollen"]);
  const bytes = app.buildFitWorkoutFile({ ...pw, duration_min: 60 });
  const dataSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  assert.strictEqual(bytes.length, 14 + dataSize + 2);
  assert.strictEqual(String.fromCharCode(...bytes.slice(8, 12)), ".FIT");
  const crc = app.fitCrc16(bytes.slice(0, bytes.length - 2));
  assert.strictEqual(bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8), crc);
});

/* ---------- An Garmin senden ---------- */

test("resolvedWorkoutSteps: Pace-Zone bekommt den Tempobereich, alles andere bleibt", () => {
  app.athleteProfile.runThresholdPace = "5:00";
  const out = plain(app.resolvedWorkoutSteps({ sport: "Laufen", steps: INTERVALS }));
  const pace = out[1].steps[0].target;
  assert.deepStrictEqual([pace.kind, pace.zone], ["pace_zone", 4]);
  assert.ok(Math.abs(pace.low_mps - 1000 / 315) < 1e-9 && Math.abs(pace.high_mps - 1000 / 294) < 1e-9);
  assert.deepStrictEqual(out[0], validate(INTERVALS).steps[0]);
  // Rad kennt keine Pace -> ohne Tempobereich (der Server sendet dann "kein Ziel")
  assert.strictEqual(plain(app.resolvedWorkoutSteps({ sport: "Rad", steps: INTERVALS }))[1].steps[0].target.low_mps, undefined);
  app.athleteProfile.runThresholdPace = null;
});

test("sendPlannedWorkoutToGarmin: schickt die Schritte an den Endpunkt und vermerkt das Senden", async () => {
  const calls = [];
  app.apiCall = (endpoint, method, body) => {
    calls.push({ endpoint, method, body: plain(body) });
    return Promise.resolve({ data: { garmin_workout_id: 4711, scheduled_date: "2026-10-14" } });
  };
  const pw = { id: "a b", date: "2026-10-14", sport: "Laufen", duration_min: 50, intensity: "leicht" };
  app.replacePlannedWorkouts([pw]);
  assert.deepStrictEqual(plain(await app.sendPlannedWorkoutToGarmin("a b")), { garmin_workout_id: 4711, scheduled_date: "2026-10-14" });
  assert.deepStrictEqual(calls, [{ endpoint: "planned-workouts/a%20b/send-to-garmin", method: "POST", body: { steps: defaults(pw) } }]);
  const saved = plain(vm.runInContext("plannedWorkouts", app))[0];
  assert.strictEqual(saved.garminWorkoutId, 4711);
  assert.ok(!Number.isNaN(Date.parse(saved.garminSentAt)));
  assert.strictEqual(app.canSendToGarmin({ sport: "Kraft" }), false);
  assert.strictEqual(app.canSendToGarmin({ sport: "Schwimmen" }), true);
});

test("sendPlannedWorkoutToGarmin: nach Zeitüberschreitung eigener Hinweis, nichts als gesendet vermerkt", async () => {
  app.apiCall = () => Promise.reject(Object.assign(new Error("Server nicht erreichbar"), { timeout: true }));
  app.replacePlannedWorkouts([{ id: "t1", date: "2026-10-14", sport: "Rad", duration_min: 60, intensity: "leicht" }]);
  await assert.rejects(app.sendPlannedWorkoutToGarmin("t1"), /nicht rechtzeitig.*doppelt wird es nicht/);
  assert.strictEqual(plain(vm.runInContext("plannedWorkouts", app))[0].garminSentAt, undefined);
  app.apiCall = () => Promise.reject(new Error("Server nicht erreichbar - läuft das Dashboard auf dem PC?"));
  await assert.rejects(app.sendPlannedWorkoutToGarmin("t1"), /Server nicht erreichbar/);
});

test("apiCall markiert eine Zeitüberschreitung (timeout), andere Netzfehler nicht", async () => {
  const fail = { name: "TypeError" };
  const ctx = vm.createContext({
    window: { addEventListener: () => {} }, document: { addEventListener: () => {} }, localStorage: { getItem: () => null },
    AbortSignal: { timeout: () => undefined }, fetch: () => Promise.reject(fail),
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/data/api-client.js"), "utf8"), ctx);
  await assert.rejects(ctx.apiCall("x"), e => e.timeout === false);
  fail.name = "TimeoutError";
  await assert.rejects(ctx.apiCall("x"), e => e.timeout === true && /Server nicht erreichbar/.test(e.message));
});
