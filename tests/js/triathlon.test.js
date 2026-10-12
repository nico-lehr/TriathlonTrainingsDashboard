// Tests für die Triathlon-Auswertungen (js/analytics/triathlon.js).
// Ausführen: node --test tests/js/   (Node 22, keine npm-Pakete nötig)
//
// Die Browser-Skripte werden wie in index.html der Reihe nach in einen
// gemeinsamen vm-Kontext geladen (utils -> data -> analytics). workouts.js
// liefert sportGroup()/sameComparisonGroup(), die die Auswertungen nutzen.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/data/workouts.js", "js/analytics/triathlon.js"];

const app = vm.createContext({});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));

// JSON-Kopie, weil Objekte aus dem vm-Kontext eigene Prototypen haben.
const plain = v => JSON.parse(JSON.stringify(v));

/* ---------- Testdaten ---------- */

const TODAY = new Date(2026, 9, 14, 12, 0); // Mittwoch, 14.10.2026

// Workout am Tag `y-m-d` (Monat 1-basiert) um 7 Uhr.
function wo(sport, y, m, d, duration_min, extra = {}) {
  const date = new Date(y, m - 1, d, 7, 0);
  return { sport, date: date.toISOString(), _date: date, duration_min, ...extra };
}

const TARGET = { Schwimmen: 15, Rad: 50, Laufen: 35 };

/* ---------- Sport-Balance ---------- */

test("Sport-Balance: Zielverteilung prüfen", () => {
  assert.deepStrictEqual(plain(app.checkSportBalanceTarget({ Schwimmen: 20, Rad: 45, Laufen: 35 })), { target: { Schwimmen: 20, Rad: 45, Laufen: 35 }, error: null });
  assert.deepStrictEqual(plain(app.checkSportBalanceTarget({ Schwimmen: "10", Rad: "60", Laufen: "30" })).target, { Schwimmen: 10, Rad: 60, Laufen: 30 });
  assert.match(app.checkSportBalanceTarget({ Schwimmen: 10, Rad: 50, Laufen: 35 }).error, /100 %.*95/);
  assert.match(app.checkSportBalanceTarget({ Schwimmen: "", Rad: 50, Laufen: 50 }).error, /alle drei/);
  assert.match(app.checkSportBalanceTarget({ Schwimmen: -5, Rad: 55, Laufen: 50 }).error, /alle drei/);
  // nicht gesetzt oder ungültig -> Standard 15/50/35
  assert.deepStrictEqual(plain(app.sportBalanceTarget(null)), TARGET);
  assert.deepStrictEqual(plain(app.sportBalanceTarget({ Schwimmen: 10, Rad: 10, Laufen: 10 })), TARGET);
  assert.deepStrictEqual(plain(app.sportBalanceTarget({ Schwimmen: 20, Rad: 40, Laufen: 40 })), { Schwimmen: 20, Rad: 40, Laufen: 40 });
});

test("Sport-Balance: Wochen - Anteile, laufende Woche, Sonstiges zählt nicht", () => {
  const data = [
    // Woche ab Mo 05.10.: 30 Schwimmen, 120 Rad, 90 Laufen (+ 60 Sonstiges, zählt nicht)
    wo("Schwimmen", 2026, 10, 5, 30), wo("Rad", 2026, 10, 7, 120), wo("Laufen", 2026, 10, 9, 90), wo("Kraft", 2026, 10, 10, 60),
    // laufende Woche ab 12.10.
    wo("Laufen", 2026, 10, 13, 45),
    // vor dem Fenster (8 Wochen): wird ignoriert
    wo("Rad", 2026, 8, 1, 300),
    // Multisport-Gesamteintrag: wird ignoriert
    wo("Rad", 2026, 10, 6, 500, { is_summary: true }),
  ];
  const r = plain(app.computeSportBalance(data, "week", TARGET, TODAY));
  assert.strictEqual(r.periods.length, 8);
  const last = r.periods[7], prev = r.periods[6];
  assert.strictEqual(last.running, true);
  assert.strictEqual(new Date(last.start).getDate(), 12);
  assert.deepStrictEqual(last.minutes, { Schwimmen: 0, Rad: 0, Laufen: 45 });
  assert.deepStrictEqual(last.short, []); // laufende Woche wird noch nicht bewertet
  assert.deepStrictEqual(prev.minutes, { Schwimmen: 30, Rad: 120, Laufen: 90 });
  assert.strictEqual(prev.total, 240);
  assert.strictEqual(prev.shares.Schwimmen, 12.5);
  assert.strictEqual(prev.shares.Rad, 50);
  assert.deepStrictEqual(prev.short, []); // 12,5 % liegt innerhalb von 5 Prozentpunkten unter 15 %
  assert.strictEqual(r.periods[0].shares, null); // leere Woche: keine Anteile statt 0 %
  // Gesamtbewertung nur über die abgeschlossenen Wochen (ohne die laufende)
  assert.strictEqual(r.overall.periodCount, 7);
  assert.deepStrictEqual(r.overall.minutes, { Schwimmen: 30, Rad: 120, Laufen: 90 });
});

test("Sport-Balance: zu kurze Sportart wird erkannt (Toleranz 5 Prozentpunkte)", () => {
  // 15 Schwimmen von 300 = 5 % -> mehr als 5 Prozentpunkte unter 15 % -> zu kurz
  const data = [wo("Schwimmen", 2026, 10, 6, 15), wo("Rad", 2026, 10, 7, 165), wo("Laufen", 2026, 10, 8, 120)];
  const r = plain(app.computeSportBalance(data, "week", TARGET, TODAY));
  assert.deepStrictEqual(r.periods[6].short, ["Schwimmen"]);
  assert.deepStrictEqual(r.overall.short, ["Schwimmen"]);
  // genau 10 % (= Ziel - Toleranz) gilt noch nicht als zu kurz
  const edge = [wo("Schwimmen", 2026, 10, 6, 30), wo("Rad", 2026, 10, 7, 150), wo("Laufen", 2026, 10, 8, 120)];
  assert.deepStrictEqual(plain(app.computeSportBalance(edge, "week", TARGET, TODAY)).overall.short, []);
});

test("Sport-Balance: Monate inkl. Jahreswechsel", () => {
  const jan = new Date(2027, 0, 10);
  const data = [wo("Rad", 2026, 12, 3, 100), wo("Laufen", 2026, 12, 20, 100), wo("Schwimmen", 2027, 1, 5, 50), wo("Rad", 2026, 8, 31, 60)];
  const r = plain(app.computeSportBalance(data, "month", TARGET, jan));
  assert.strictEqual(r.periods.length, 6);
  assert.deepStrictEqual(r.periods.map(p => new Date(p.start).getMonth()), [7, 8, 9, 10, 11, 0]);
  assert.deepStrictEqual(r.periods[4].minutes, { Schwimmen: 0, Rad: 100, Laufen: 100 });
  assert.deepStrictEqual(r.periods[4].short, ["Schwimmen"]);
  assert.strictEqual(r.periods[5].running, true);
  assert.deepStrictEqual(r.overall.minutes, { Schwimmen: 0, Rad: 160, Laufen: 100 });
});

test("Sport-Balance: keine Daten -> keine Anteile, keine Hinweise", () => {
  const r = plain(app.computeSportBalance([], "week", TARGET, TODAY));
  assert.strictEqual(r.overall.shares, null);
  assert.deepStrictEqual(r.overall.short, []);
});

/* ---------- Schwimmen ---------- */

test("secondsToPace rundet erst die Gesamtzeit (kein '1:60')", () => {
  assert.strictEqual(app.secondsToPace(119.6), "2:00");
  assert.strictEqual(app.secondsToPace(105), "1:45");
  assert.strictEqual(app.secondsToPace(59.4), "0:59");
});

test("CSS aus 400-m- und 200-m-Test (Standardformel)", () => {
  // 400 m in 7:10 (430 s), 200 m in 3:25 (205 s): CSS = 200 / 225 = 0,889 m/s = 1:52,5 je 100 m
  const r = app.computeSwimCss("7:10", "3:25");
  assert.strictEqual(r.error, null);
  assert.ok(Math.abs(r.mps - 200 / 225) < 1e-9);
  assert.strictEqual(r.secPer100, 112.5);
  assert.strictEqual(r.pace, "1:53");
  assert.strictEqual(app.computeSwimCss(" 6:40.0 ", "3:10").secPer100, 105);
  // Eingabefehler -> deutscher Hinweis statt Zahl
  assert.match(app.computeSwimCss("", "3:25").error, /m:ss/);
  assert.match(app.computeSwimCss("7:75", "3:25").error, /m:ss/);
  assert.match(app.computeSwimCss("430", "205").error, /m:ss/);
  assert.match(app.computeSwimCss("3:25", "7:10").error, /vertauscht/);
  assert.match(app.computeSwimCss("6:00", "3:00").error, /vertauscht/); // 400er nicht langsamer je 100 m
});

function swim(y, m, d, pace, extra = {}) {
  return wo("Schwimmen", y, m, d, 40, { pace_min_per_100m: pace, ...extra });
}

test("Schwimmen: Pace-Trend 6 Wochen gegen die 6 Wochen davor, SWOLF falls vorhanden", () => {
  const data = [
    swim(2026, 7, 20, "2:10"),                         // älter als 12 Wochen: zählt nicht zum Trend
    swim(2026, 8, 20, "2:06", { avg_swolf: 40 }), swim(2026, 8, 27, "2:04", { avg_swolf: 39 }),   // Fenster davor
    swim(2026, 9, 10, "2:00", { avg_swolf: 37 }), swim(2026, 10, 1, "1:58"), swim(2026, 10, 12, "1:56", { avg_swolf: 36 }), // letzte 6 Wochen
    swim(2026, 10, 2, null),                           // ohne Pace: wird ignoriert
    wo("Laufen", 2026, 10, 3, 40, { pace_min_per_km: "5:00" }),
  ];
  const r = plain(app.computeSwimAnalysis(data, TODAY));
  assert.strictEqual(r.points.length, 6);
  assert.strictEqual(r.groupLabel, "Schwimmen");
  assert.strictEqual(r.paceTrend.recentCount, 3);
  assert.strictEqual(r.paceTrend.priorCount, 2);
  assert.strictEqual(r.paceTrend.recent, 118);
  assert.strictEqual(r.paceTrend.prior, 125);
  assert.strictEqual(r.paceTrend.delta, -7); // 7 s je 100 m schneller
  assert.strictEqual(r.swolfCount, 4);
  assert.strictEqual(r.swolfTrend.delta, 36.5 - 39.5);
});

test("Schwimmen: zu wenig Einheiten -> kein Trend, keine Schwimmeinheit -> null", () => {
  const r = plain(app.computeSwimAnalysis([swim(2026, 10, 1, "1:58"), swim(2026, 10, 8, "1:57")], TODAY));
  assert.strictEqual(r.paceTrend, null);
  assert.strictEqual(r.swolfTrend, null);
  assert.strictEqual(r.swolfCount, 0);
  assert.strictEqual(app.computeSwimAnalysis([wo("Rad", 2026, 10, 1, 60)], TODAY), null);
});

test("Schwimmen: Becken und Freiwasser werden nicht vermischt (Gruppe der letzten Einheit)", () => {
  const data = [swim(2026, 9, 1, "2:20", { sub_sport: "Freiwasser" }), swim(2026, 9, 5, "1:58", { sub_sport: "Becken" }),
    swim(2026, 9, 9, "2:01"), swim(2026, 10, 10, "1:57", { sub_sport: "Becken" })];
  const r = plain(app.computeSwimAnalysis(data, TODAY));
  assert.strictEqual(r.groupLabel, "Schwimmen (Becken)");
  assert.deepStrictEqual(r.points.map(p => p.paceSec), [118, 121, 117]); // Freiwasser fehlt, unbekannt zählt mit
});
