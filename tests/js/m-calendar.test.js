// Tests für den Kalender (js/components/m-calendar.js): Kalenderwoche nach
// ISO 8601 und welche Einträge an einem Tag stehen (erledigt ersetzt den Plan,
// übersprungen bleibt sichtbar). Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const pad = n => String(n).padStart(2, "0");
const app = vm.createContext({
  Date, Math, Number, String, Object,
  document: { addEventListener() {} },
  mDay: d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; },
  localDateStr: d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  sportGroup: s => (["Schwimmen", "Rad", "Laufen"].includes(s) ? s : "Sonstiges"),
  mGoalsOn: () => [],
  mWorkoutsOn: () => [],
  mPlannedOn: () => [],
});
vm.runInContext(fs.readFileSync(path.join(ROOT, "js/components/m-calendar.js"), "utf8"), app, { filename: "js/components/m-calendar.js" });
const run = code => vm.runInContext(code, app);

test("Kalenderwoche nach ISO 8601", () => {
  const kw = s => run(`kIsoWeek(new Date("${s}T12:00:00"))`);
  assert.strictEqual(kw("2026-11-17"), 47);
  assert.strictEqual(kw("2026-01-01"), 1);  // Donnerstag -> KW 1
  assert.strictEqual(kw("2027-01-01"), 53); // Freitag -> noch KW 53 von 2026
  assert.strictEqual(kw("2024-12-30"), 1);  // Montag -> schon KW 1 von 2025
});

test("Einträge eines Tages: Erledigtes ersetzt den erledigten Plan", () => {
  app.mWorkoutsOn = () => [{ sport: "Laufen", title: "Lauf", duration_min: 45, file: "a.fit" }];
  app.mPlannedOn = () => [
    { id: "p1", sport: "Laufen", title: "Lauf", duration_min: 40, status: "erledigt" },
    { id: "p2", sport: "Rad", title: "Rolle", duration_min: 60, status: "geplant" },
  ];
  const e = JSON.parse(JSON.stringify(run(`kEntries("2026-11-17")`)));
  assert.deepStrictEqual(e.map(x => [x.type, x.title, x.min]), [["done", "Lauf", 45], ["plan", "Rolle", 60]]);
});

test("Ohne Training bleibt Erledigtes und Übersprungenes sichtbar", () => {
  app.mWorkoutsOn = () => [];
  app.mPlannedOn = () => [
    { id: "p1", sport: "Laufen", title: "Lauf", duration_min: 40, status: "erledigt" },
    { id: "p3", sport: "Schwimmen", title: "Technik", duration_min: 30, status: "uebersprungen" },
  ];
  const e = JSON.parse(JSON.stringify(run(`kEntries("2026-11-17")`)));
  assert.deepStrictEqual(e.map(x => x.type), ["done", "skip"]);
});
