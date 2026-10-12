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
