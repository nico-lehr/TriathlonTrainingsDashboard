// Tests für den zusätzlichen KI-Kontext (js/ai/context-extras.js).
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/data/weather.js", "js/ai/context-extras.js"];
const app = vm.createContext({ window: {}, athleteProfile: {}, apiCall: () => Promise.resolve({}), sportGroup: s => s });
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
app.__ = {};
const call = (fn, ...args) => { app.__.args = args; return JSON.parse(JSON.stringify(vm.runInContext(`${fn}(...__.args)`, app))); };

const TODAY = "2026-10-12";
const PROFILE = { maxHr: 190, restingHr: 50 }; // HFR 140: locker < 148, hart >= 162
const day = n => { const d = new Date(TODAY + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const run = (date, hr, extra = {}) => ({ date: date + "T07:00:00", sport: "Laufen", duration_min: 40, avg_hr: hr, ...extra });

test("Intensität aus dem Puls statt aus den geplanten Etiketten", () => {
  const ws = [run(day(-2), 140), run(day(-4), 140), run(day(-6), 155), run(day(-8), 170)];
  const line = call("ctxIntensityLine", ws, PROFILE, TODAY);
  assert.match(line, /50 % locker \(Z1-2\), 25 % mittel \(Z3\), 25 % hart/);
  assert.match(line, /deutlich zu wenig locker/);
  assert.strictEqual(call("ctxIntensityLine", ws.slice(0, 2), PROFILE, TODAY), ""); // zu wenig Daten
});

test("Pulskurve zählt zeitgewichtet, Pausen nicht", () => {
  const t = [0, 600, 1200, 1800, 9000], hr = [140, 140, 170, 170, 170];
  const b = call("ctxHrBands", { stream: { t, hr }, duration_min: 30 }, PROFILE);
  assert.deepStrictEqual([Math.round(b.easy), Math.round(b.mid), Math.round(b.hard)], [10, 10, 10]); // 7200-s-Lücke fällt raus
});

test("Soll-Ist: zu hart gelaufene lockere Einheit, übersprungen, kürzer", () => {
  const planned = [
    { date: day(-1), sport: "Laufen", duration_min: 40, intensity: "leicht", status: "erledigt" },
    { date: day(-3), sport: "Laufen", duration_min: 60, intensity: "leicht", status: "erledigt" },
    { date: day(-5), sport: "Rad", duration_min: 60, intensity: "mittel", status: "uebersprungen" },
  ];
  const ws = [run(day(-1), 160), run(day(-3), 135, { duration_min: 30 })];
  const lines = call("ctxAdherenceLines", planned, ws, PROFILE, TODAY);
  assert.match(lines[0], /3 geplant, 2 gemacht, 1 übersprungen, Dauer im Schnitt 75 % des Plans/);
  assert.match(lines[1], /zu hart gelaufen: 11\.10\. Laufen \(100 % der Zeit über Z2\)/);
  assert.match(lines[1], /9\.10\. Laufen 30 statt 60 min/);
});

test("7-Tage-Trend mit 'fällt seit n Tagen'", () => {
  const daily = {};
  for (let i = 34; i >= 7; i--) daily[day(-i)] = { hrv_ms: 60 };
  [58, 56, 54, 52, 50, 48, 46].forEach((v, i) => { daily[day(-6 + i)] = { hrv_ms: v }; });
  const line = call("ctxTrendLine", daily, TODAY);
  assert.match(line, /HRV Ø 52 ms \(−13 % ggü\. den 4 Wochen davor, fällt seit 7 Tagen\)/);
});

test("Besondere Tage und Zyklus aus der Uhr", () => {
  const daily = { [day(-1)]: { special: ["Alkohol", "Reise"] }, [day(-20)]: { special: ["Krank"] }, [TODAY]: { cycle_phase: "LUTEAL", cycle_day: 21 } };
  const text = call("ctxSpecialDaysLine", daily, TODAY);
  assert.match(text, /11\.10\. Alkohol, Reise/);
  assert.doesNotMatch(text, /Krank/); // älter als 14 Tage
  assert.match(text, /Zyklus \(Garmin\): Lutealphase, Tag 21/);
});

test("Kennwerte der Uhr", () => {
  const daily = { [TODAY]: { load_acute: 620, load_chronic: 540, acwr: 1.15, load_anaerobic: 80, load_anaerobic_target: [150, 400], load_balance: "ANAEROBIC_SHORTAGE" } };
  const line = call("ctxGarminMetricsLine", daily, { race10kS: 2640, hillScore: 48 }, TODAY);
  assert.match(line, /Belastung akut 620 \/ chronisch 540 \(Verhältnis 1,15/);
  assert.match(line, /Intervalle 80 \(Ziel 150-400\) - zu wenig sehr harte Intervalle/);
  assert.match(line, /10 km 44:00/);
  assert.match(line, /Hill-Score 48/);
});

test("RPE: lockerer Puls fühlt sich hart an -> Müdigkeits-Hinweis", () => {
  const ws = [run(day(-1), 130, { rpe: 7, feel: 25 }), run(day(-2), 132, { rpe: 8 }), run(day(-3), 170, { rpe: 3 })];
  const line = call("ctxRpeLine", ws, PROFILE, TODAY);
  assert.match(line, /11\.10\. Laufen 40 min RPE 7, Gefühl mäßig \(Puls locker, fühlte sich hart an\)/);
  assert.match(line, /Puls hoch, fühlte sich leicht an/);
  assert.match(line, /2× fühlte sich lockerer Puls hart an/);
});

test("Wetter für das Planungsfenster", () => {
  const w = { [day(1)]: { code: 63, temp_max: 9.4, temp_min: 3, precip_prob: 80, wind_max: 35 }, [day(2)]: { code: 0, temp_max: 30, temp_min: 18, precip_prob: 0, wind_max: 5 } };
  app.__.w = w;
  const line = vm.runInContext(`ctxWeatherLine(${JSON.stringify([day(1), day(2), day(3)])}, d => __.w[d])`, app);
  assert.strictEqual(line, "Wetter-Vorhersage am Wohnort: 13.10. 9°/3° Regen Regen 80 % Wind 35 km/h | 14.10. 30°/18° Klar");
});

test("Gedächtnis: oft ausgelassener Wochentag, zu harte lockere Einheiten, Hitze", () => {
  const planned = [], ws = [];
  for (let k = 1; k <= 6; k++) {
    const tue = day(-7 * k + 1); // Dienstage
    planned.push({ date: tue, sport: "Rad", duration_min: 60, intensity: "mittel", status: k <= 4 ? "uebersprungen" : "erledigt" });
    const thu = day(-7 * k + 3);
    planned.push({ date: thu, sport: "Laufen", duration_min: 45, intensity: "leicht", status: "erledigt" });
    ws.push(run(thu, k <= 3 ? 160 : 135, { avg_temp_c: k <= 3 ? 27 : 12 }));
  }
  const line = call("ctxMemoryLine", planned, ws, PROFILE, TODAY);
  assert.match(line, /Dienstags fällt oft aus \(4 von 6 übersprungen\)/);
  assert.match(line, /lockere Einheiten werden oft zu hart gelaufen \(3 von 6\)/);
  assert.match(line, /Laufen: bei Hitze ab 25 °C Puls im Schnitt 25 Schläge höher/);
});

test("Runden kompakt", () => {
  const w = { sport: "Laufen", laps: [
    { n: 1, dur_s: 600, dist_m: 2000, speed: 3.333, hr: 140, intensity: "warmup" },
    { n: 2, dur_s: 90, dist_m: 400, speed: 4.444, hr: 172, intensity: "interval" },
  ] };
  assert.strictEqual(call("ctxLapsLine", w), "Runden/Intervalle (2): R1 Einlaufen 10:00 2 km 5:00/km 140 bpm | R2 Intervall 1:30 400 m 3:45/km 172 bpm");
  assert.strictEqual(call("ctxLapsLine", { sport: "Laufen", laps: [{ n: 1 }] }), "");
});
