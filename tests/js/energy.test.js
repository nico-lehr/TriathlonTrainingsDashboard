// Tests für Energie & Bedarf (js/analytics/energy.js): Grundumsatz,
// Tagesverbrauch aus Garmin bzw. Schätzung, Durchschnitte, Energiebilanz aus
// dem Gewichtsverlauf, geplante Einheiten und Kennzahlen.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/formatting.js", "js/analytics/energy.js"];
const app = vm.createContext({});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const plain = x => JSON.parse(JSON.stringify(x));

const TODAY = "2026-11-12";
const PROFILE = { weightKg: 70, heightCm: 180, gender: "m", birthDate: "1991-05-01" };

function ctx(over = {}) {
  return { today: TODAY, age: 35, profile: PROFILE, weights: [], wellness: {}, byDay: {}, ...over };
}

test("Grundumsatz: Mifflin-St Jeor mit Größe, sonst Henry nur mit Gewicht", () => {
  // 10*70 + 6,25*180 - 5*35 + 5 = 1655
  assert.deepStrictEqual(plain(app.bmrEstimate({ weightKg: 70, heightCm: 180, age: 35, gender: "m" })), { kcal: 1655, method: "Mifflin-St Jeor" });
  assert.strictEqual(app.bmrEstimate({ weightKg: 70, heightCm: 180, age: 35, gender: "w" }).kcal, 1489);
  // ohne Angabe: Mitte zwischen beiden
  assert.strictEqual(app.bmrEstimate({ weightKg: 70, heightCm: 180, age: 35, gender: "" }).kcal, 1572);
  // Henry Mann 30-60: 14,2*70 + 593 = 1587
  assert.deepStrictEqual(plain(app.bmrEstimate({ weightKg: 70, age: 35, gender: "m" })), { kcal: 1587, method: "Henry (nur Gewicht)" });
  assert.strictEqual(app.bmrEstimate({ weightKg: null }), null);
  assert.strictEqual(app.bmrEstimate({ weightKg: 500 }), null);
});

test("Einheit ohne kcal wird über MET geschätzt", () => {
  assert.deepStrictEqual(plain(app.workoutKcal({ calories: 650, duration_min: 60, sport: "Laufen" }, 70)), { kcal: 650, estimated: false });
  // Laufen MET 10 * 70 kg * 1 h
  assert.deepStrictEqual(plain(app.workoutKcal({ duration_min: 60, sport: "Laufen" }, 70)), { kcal: 700, estimated: true });
  assert.strictEqual(app.workoutKcal({ duration_min: 30, sport: "Mobility" }, 80).kcal, 100);
});

test("Tag mit Garmin-Daten: Gesamt aus Garmin, Training netto, Rest ist Alltag", () => {
  const c = ctx({
    wellness: { "2026-11-10": { kcal_total: 3200, kcal_bmr: 1700, kcal_active: 1500 } },
    byDay: { "2026-11-10": { kcal: 900, minutes: 72, steps: 0, count: 1 } },
  });
  const d = app.energyDay("2026-11-10", c);
  assert.strictEqual(d.source, "garmin");
  assert.strictEqual(d.total, 3200);
  assert.strictEqual(d.bmr, 1700);
  // 900 - 1700/1440*72 = 815
  assert.strictEqual(d.training, 815);
  assert.strictEqual(d.alltag, 1500 - 815);
  assert.strictEqual(d.bmr + d.alltag + d.training, d.total);
});

test("Training kann nicht mehr sein als Garmins Aktivitätsanteil", () => {
  const c = ctx({
    wellness: { "2026-11-10": { kcal_total: 2000, kcal_bmr: 1700 } },
    byDay: { "2026-11-10": { kcal: 900, minutes: 60, steps: 0, count: 1 } },
  });
  const d = app.energyDay("2026-11-10", c);
  assert.strictEqual(d.training, 300);
  assert.strictEqual(d.alltag, 0);
});

test("Tag ohne Garmin: Schätzung aus Grundumsatz, Schritten und Training", () => {
  const ohne = app.energyDay("2026-11-10", ctx());
  assert.strictEqual(ohne.source, "estimate");
  assert.strictEqual(ohne.bmr, 1655);
  // 25 % Grundumsatz für Bewegung + Verdauung (10 % vom Gesamten)
  assert.strictEqual(ohne.alltag, Math.round(0.25 * 1655 + 1.25 * 1655 / 9));
  assert.ok(Math.abs(ohne.total / ohne.bmr - 1.39) < 0.01); // Ruhetag ohne Schritte: PAL ≈ 1,4
  assert.strictEqual(ohne.training, 0);

  // 10.000 Schritte, davon 6.000 im Lauf: 4.000 * 70 * 0,0005 = 140, dazu Verdauung
  const c = ctx({
    wellness: { "2026-11-10": { steps: 10000 } },
    byDay: { "2026-11-10": { kcal: 700, minutes: 60, steps: 6000, count: 1 } },
  });
  const d = app.energyDay("2026-11-10", c);
  const training = Math.round(700 - 1655 / 1440 * 60);
  assert.strictEqual(d.training, training);
  assert.strictEqual(d.alltag, Math.round(140 + (1655 + 140 + training) / 9));
  // Verdauung ist 10 % vom Gesamtverbrauch
  assert.ok(Math.abs((d.alltag - 140) / d.total - 0.10) < 0.002);
  assert.strictEqual(d.total, d.bmr + d.alltag + d.training);
});

test("Gewicht des Tages: letzter Eintrag bis dahin", () => {
  const w = [{ date: "2026-10-01", weightKg: 72 }, { date: "2026-11-01", weightKg: 70 }];
  assert.strictEqual(app.energyWeightAt(w, "2026-10-15"), 72);
  assert.strictEqual(app.energyWeightAt(w, "2026-11-05"), 70);
  assert.strictEqual(app.energyWeightAt(w, "2026-09-01"), 72); // vor dem ersten Eintrag
  assert.strictEqual(app.energyWeightAt([], "2026-09-01", 68), 68);
});

test("Verlauf beginnt mit den ersten Daten, heute zählt nicht in den Schnitt", () => {
  const byDay = {}, wellness = {};
  for (let i = 1; i <= 40; i++) {
    const ds = app.energyAddDays(TODAY, -i);
    wellness[ds] = { kcal_total: i % 2 ? 3000 : 2400, kcal_bmr: 1700 };
    if (i % 2) byDay[ds] = { kcal: 800, minutes: 60, steps: 0, count: 1 };
  }
  wellness[TODAY] = { kcal_total: 1200, kcal_bmr: 1700 };
  const c = ctx({ wellness, byDay });
  const series = app.energySeries(c, app.energyAddDays(TODAY, -365), TODAY);
  assert.strictEqual(series[0].date, app.energyAddDays(TODAY, -40));
  assert.strictEqual(series.length, 41);
  assert.strictEqual(series[series.length - 1].partial, true);

  const s = app.energyStats(series, TODAY);
  assert.strictEqual(s.w7.days, 7);
  assert.strictEqual(s.w30.days, 30);
  assert.strictEqual(s.w30.total, 2700);
  assert.strictEqual(s.w30.trainDay, 3000);
  assert.strictEqual(s.w30.restDay, 2400);
  assert.strictEqual(s.w30.garminShare, 1);
  assert.strictEqual(s.trend, null); // nur 10 Tage davor -> kein Vergleich
});

test("Trend vergleicht die letzten 30 Tage mit den 30 davor", () => {
  const wellness = {};
  for (let i = 1; i <= 60; i++) wellness[app.energyAddDays(TODAY, -i)] = { kcal_total: i <= 30 ? 3000 : 2500, kcal_bmr: 1700 };
  const s = app.energyStats(app.energySeries(ctx({ wellness }), "2025-01-01", TODAY), TODAY);
  assert.strictEqual(s.trend.deltaKcal, 500);
  assert.strictEqual(Math.round(s.trend.deltaPct), 20);
});

test("Monatsmittel", () => {
  const wellness = { "2026-09-30": { kcal_total: 2000, kcal_bmr: 1600 }, "2026-10-01": { kcal_total: 3000, kcal_bmr: 1600 }, "2026-10-02": { kcal_total: 2600, kcal_bmr: 1600 } };
  const m = app.energyMonthly(app.energySeries(ctx({ wellness }), "2026-09-30", "2026-10-02"));
  assert.deepStrictEqual(plain(m.map(x => [x.month, x.total, x.days])), [["2026-09", 2000, 1], ["2026-10", 2800, 2]]);
});

test("Gewichtstrend glättet Ausreißer", () => {
  const w = [{ date: "2026-11-01", weightKg: 70 }, { date: "2026-11-02", weightKg: 72 }, { date: "2026-11-03", weightKg: 70 }];
  const t = app.weightTrendSeries(w, "2026-11-01", "2026-11-04");
  assert.deepStrictEqual(plain(t.map(x => x.trend)), [70, 70.2, 70.18, 70.18]);
  assert.strictEqual(t[3].raw, null);
});

test("Energiebilanz: Abnahme heißt Defizit, Zufuhr = Verbrauch + Bilanz", () => {
  const wellness = {}, weights = [];
  for (let i = 1; i <= 60; i++) wellness[app.energyAddDays(TODAY, -i)] = { kcal_total: 3000, kcal_bmr: 1700 };
  // 60 Tage lang jeden Tag 0,02 kg weniger
  for (let i = 60; i >= 0; i--) weights.push({ date: app.energyAddDays(TODAY, -i), weightKg: Math.round((72 - (60 - i) * 0.02) * 100) / 100 });
  const series = app.energySeries(ctx({ wellness, weights }), "2025-01-01", TODAY);
  const b = app.energyBalance(series, weights, TODAY, 28);
  assert.ok(b.kgPerWeek < -0.1 && b.kgPerWeek > -0.15, String(b.kgPerWeek));
  assert.ok(b.balance < -100 && b.balance > -170, String(b.balance));
  assert.strictEqual(b.expenditure, 3000);
  assert.strictEqual(b.intake, 3000 + b.balance);
});

test("Energiebilanz braucht genug Wiegungen über genug Zeit", () => {
  const wellness = {};
  for (let i = 1; i <= 30; i++) wellness[app.energyAddDays(TODAY, -i)] = { kcal_total: 3000, kcal_bmr: 1700 };
  const series = app.energySeries(ctx({ wellness }), "2025-01-01", TODAY);
  const zweiMal = [{ date: app.energyAddDays(TODAY, -20), weightKg: 70 }, { date: app.energyAddDays(TODAY, -1), weightKg: 69 }];
  assert.strictEqual(app.energyBalance(series, zweiMal, TODAY, 28), null);
  const engZusammen = [-3, -2, -1].map(i => ({ date: app.energyAddDays(TODAY, i), weightKg: 70 }));
  assert.strictEqual(app.energyBalance(series, engZusammen, TODAY, 28), null);
});

test("Geplante Einheit: aus eigener Historie (Median kcal/min), sonst MET", () => {
  const hist = [10, 11, 12, 30].map((r, i) => ({ sport: "Laufen", calories: r * 50, duration_min: 50, date: app.energyAddDays(TODAY, -i - 1) }));
  const k = app.plannedWorkoutKcal({ sport: "Laufen", duration_min: 60, intensity: "mittel" }, hist, 70, TODAY);
  assert.deepStrictEqual(plain(k), { kcal: 720, basis: "history", samples: 4 });
  assert.strictEqual(app.plannedWorkoutKcal({ sport: "Laufen", duration_min: 60, intensity: "hart" }, hist, 70, TODAY).kcal, 828);
  const met = app.plannedWorkoutKcal({ sport: "Rad", duration_min: 90 }, hist, 70, TODAY);
  assert.deepStrictEqual(plain(met), { kcal: 840, basis: "met", samples: 0 });
  assert.strictEqual(app.plannedWorkoutKcal({ sport: "Rad" }, hist, 70, TODAY), null);
});

test("Prognose heute: Ø Grundumsatz + Alltag + geplantes Training (netto)", () => {
  const stats = { w30: { bmr: 1700, alltag: 600 } };
  const planned = [
    { id: 1, date: TODAY, sport: "Rad", duration_min: 60, status: "geplant" },
    { id: 2, date: TODAY, sport: "Laufen", duration_min: 30, status: "erledigt" },
    { id: 3, date: "2026-11-13", sport: "Laufen", duration_min: 30 },
  ];
  const f = app.energyTodayForecast(stats, planned, [], 70, TODAY);
  assert.strictEqual(f.items.length, 1);
  assert.strictEqual(f.items[0].kcal, Math.round(560 - 1700 / 1440 * 60));
  assert.strictEqual(f.total, 1700 + 600 + f.training);
  assert.strictEqual(app.energyTodayForecast(null, planned, [], 70, TODAY), null);
});

test("Kennzahlen: PAL, BMI, kcal/kg, Magermasse, kcal je Trainingsstunde", () => {
  const stats = { w30: { total: 3000, bmr: 1700, training: 600, garminShare: 1, trainingHours: 30, trainingKcal: 18000 } };
  const k = app.energyKeyFigures(stats, PROFILE, 70, 15, TODAY);
  assert.strictEqual(k.pal, 1.76);
  assert.strictEqual(k.palCategory.label, "aktiv");
  assert.strictEqual(k.bmi, 21.6);
  assert.strictEqual(k.bmiCategory, "Normalgewicht");
  assert.strictEqual(k.kcalPerKg, 43);
  assert.strictEqual(k.leanKg, 59.5);
  assert.strictEqual(k.kcalPerTrainingHour, 600);
  assert.strictEqual(k.trainingShare, 20);
  assert.strictEqual(k.bmrSource, "garmin");

  const ohne = app.energyKeyFigures(null, { weightKg: 70 }, 70, null, TODAY);
  assert.strictEqual(ohne.pal, null);
  assert.strictEqual(ohne.bmi, null);
  assert.strictEqual(ohne.bmr, 1481); // ohne Geschlecht: Mitte aus 1587 (m) und 1376 (w)
  assert.strictEqual(ohne.bmrSource, "Henry (nur Gewicht)");
});
