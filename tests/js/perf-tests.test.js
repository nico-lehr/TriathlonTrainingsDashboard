// Tests für die Leistungstests alle 8 Wochen (js/analytics/perf-tests.js).
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/data/race-formats.js", "js/utils/dates.js", "js/utils/formatting.js", "js/utils/calculations.js",
  "js/analytics/periodization.js", "js/analytics/perf-tests.js"];
const app = vm.createContext({ DATA: [], window: {}, goals: [], sportGroup: s => s, bestAveragePower: (stream, sec) => stream && stream.best20 });
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
app.__ = {};
const call = (fn, ...args) => { app.__.args = args; return JSON.parse(JSON.stringify(vm.runInContext(`${fn}(...__.args)`, app))); };

const TODAY = "2026-10-12"; // Montag
const days = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(from + "T00:00:00"); d.setDate(d.getDate() + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
const WINDOW = days("2026-10-13", 7);
const hist = sports => sports.flatMap((s, i) => [1, 8, 15].map(k => ({ date: days("2026-09-20", 30)[k + i], sport: s })));
const GOAL = { id: "g1", name: "70.3", sport: "Triathlon", date: "2027-06-13" };
const PROFILE = { trainingDays: ["di", "mi", "do", "sa", "so"], swimDays: ["mi"] };

test("ohne bisherigen Test: alle trainierten Sportarten fällig, an passenden Tagen mit Abstand", () => {
  const due = call("perfTestsDue", GOAL, WINDOW, { planned: [], history: hist(["Rad", "Laufen", "Schwimmen"]), profile: PROFILE, todayKey: TODAY });
  const by = Object.fromEntries(due.map(t => [t.key, t.date]));
  assert.strictEqual(by.css, "2026-10-14");      // einziger Schwimmtag (Mi) zuerst vergeben
  assert.strictEqual(by.ftp, "2026-10-17");      // Di/Do liegen zu nah am Mittwoch -> Samstag
  assert.strictEqual(by.run, undefined);         // kein Tag mit 2 Tagen Abstand frei -> nächste Planung
  assert.ok(due.every((a, i) => due.every((b, j) => i === j || Math.abs(new Date(a.date) - new Date(b.date)) >= 2 * 86400000)));
});

test("Abstand von 8 Wochen wird eingehalten, nicht trainierte Sportart nie getestet", () => {
  const planned = [{ id: "p1", date: "2026-09-01", sport: "Rad", perfTest: "ftp", status: "erledigt" }];
  const due = call("perfTestsDue", GOAL, WINDOW, { planned, history: hist(["Rad", "Laufen"]), profile: {}, todayKey: TODAY });
  assert.deepStrictEqual(due.map(t => t.key), ["run"]); // FTP erst ab 27.10., Schwimmen nicht trainiert
  const later = call("perfTestsDue", GOAL, days("2026-10-26", 7), { planned, history: hist(["Rad", "Laufen"]), profile: {}, todayKey: "2026-10-25" });
  assert.strictEqual(later.find(t => t.key === "ftp").date, "2026-10-27");
});

test("nie im Taper und nicht doppelt, wenn schon ein Test geplant ist", () => {
  const raceSoon = { ...GOAL, date: "2026-10-18" };
  assert.deepStrictEqual(call("perfTestsDue", raceSoon, WINDOW, { planned: [], history: hist(["Rad"]), profile: {}, todayKey: TODAY }), []);
  const planned = [{ id: "p1", date: "2026-10-15", sport: "Rad", perfTest: "ftp", status: "geplant" }];
  assert.deepStrictEqual(call("perfTestsDue", GOAL, WINDOW, { planned, history: hist(["Rad"]), profile: {}, todayKey: TODAY }), []);
});

test("CSS-Test aus der Analyse zählt als gemacht", () => {
  const due = call("perfTestsDue", GOAL, WINDOW, { planned: [], history: hist(["Schwimmen"]), profile: { swimCssTest: { date: "2026-10-01" } }, todayKey: TODAY });
  assert.deepStrictEqual(due, []);
});

test("Sicherheitsnetz setzt fehlenden Test ein und verdrängt nur neue Einheiten", () => {
  const due = call("perfTestsDue", GOAL, WINDOW, { planned: [], history: hist(["Rad"]), profile: {}, todayKey: TODAY });
  const list = [
    { id: "old", date: "2026-10-13", sport: "Rad", intensity: "leicht", status: "geplant" }, // vorher schon da
    { id: "new", date: "2026-10-14", sport: "Rad", intensity: "leicht", status: "geplant" },
  ];
  const r = call("perfTestsEnsure", list, due, { mutableIds: ["new"] });
  assert.strictEqual(r.added.length, 1);
  assert.strictEqual(r.added[0].date, "2026-10-14");
  assert.strictEqual(r.added[0].perfTest, "ftp");
  assert.ok(r.list.some(p => p.id === "old") && !r.list.some(p => p.id === "new"));
});

test("Auswertung: FTP aus 20 Minuten, Lauf-Schwelle aus 5 km", () => {
  const planned = [
    { id: "a", date: "2026-10-05", sport: "Rad", perfTest: "ftp", status: "erledigt" },
    { id: "b", date: "2026-10-08", sport: "Laufen", perfTest: "run", status: "erledigt" },
  ];
  const t = Array.from({ length: 61 }, (_, i) => i * 30), dist = t.map(s => s * 4); // 4 m/s -> 5 km in 1250 s
  const history = [
    { date: "2026-10-05T07:00:00", sport: "Rad", stream: { best20: 263 } },
    { date: "2026-10-08T07:00:00", sport: "Laufen", stream: { t, dist } },
  ];
  const res = call("perfTestResults", planned, history, { ftpWatts: 240 }, TODAY);
  const ftp = res.find(r => r.key === "ftp"), run = res.find(r => r.key === "run");
  assert.strictEqual(ftp.value, 250);
  assert.match(ftp.text, /bisher 240 W/);
  assert.strictEqual(run.value, "4:25"); // 4:10 /km x 1,06
});
