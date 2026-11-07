// Tests für die Übernahme von Garmin-Events als Ziele (js/data/garmin-events.js).
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const app = vm.createContext({ window: {}, storeGet: () => null, storeSet: () => {}, goals: [] });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js/data/garmin-events.js"), "utf8"), app);
app.__ = {};
const merge = (list, events, dismissed = []) => {
  let n = 0;
  app.__.a = [list, events, { todayKey: "2026-11-09", dismissed, newId: () => "neu" + ++n }];
  return JSON.parse(JSON.stringify(vm.runInContext("mergeGarminEvents(...__.a)", app)));
};
const ev = (garminId, date, name, extra = {}) => ({ garminId, date, name, sport: "Laufen", isRace: true, primary: false, distanceKm: null, targetTime: null, ...extra });

test("neue Events werden Ziele, vergangene und gelöschte nicht", () => {
  const res = merge([], [ev("1", "2026-11-01", "Alt"), ev("2", "2026-12-06", "Nikolauslauf", { distanceKm: 10, location: "Köln", startTime: "10:30" }),
    ev("3", "2027-06-13", "IRONMAN 70.3", { sport: "Triathlon", primary: true, targetTime: "5:30:00" }), ev("4", "2027-03-01", "Weg damit")], ["4"]);
  assert.deepStrictEqual(res.added, ["Nikolauslauf", "IRONMAN 70.3"]);
  const [run, tri] = res.goals;
  assert.strictEqual(run.notes, "Ort: Köln · Start 10:30 Uhr (aus Garmin Connect)");
  assert.deepStrictEqual([run.distanceKm, run.isPrimary, run.priority], [10, false, null]);
  assert.deepStrictEqual([tri.isPrimary, tri.priority, tri.targetTime, tri.source], [true, "A", "5:30:00", "garmin"]);
});

test("vorhandenes Hauptevent bleibt, eigenes Ziel am selben Tag wird verknüpft statt doppelt", () => {
  const mine = { id: "g1", name: "Ironman Kraichgau", sport: "Triathlon", date: "2027-06-13", isPrimary: true, distanceKm: null, targetTime: "5:45:00" };
  const res = merge([mine], [ev("3", "2027-06-13", "IRONMAN 70.3 Kraichgau", { sport: "Triathlon", primary: true, distanceKm: 113, targetTime: "5:30:00" }),
    ev("5", "2027-04-04", "Frühjahrslauf", { primary: false })]);
  assert.deepStrictEqual(res.linked, ["Ironman Kraichgau"]);
  const g1 = res.goals.find(g => g.id === "g1");
  assert.deepStrictEqual([g1.name, g1.garminEventId, g1.distanceKm, g1.targetTime, g1.isPrimary], ["Ironman Kraichgau", "3", 113, "5:45:00", true]);
  assert.strictEqual(res.goals.filter(g => g.isPrimary).length, 1);
});

test("verknüpfte Ziele folgen Garmin bei Datum und Name - außer du hast umbenannt", () => {
  const a = { id: "a", name: "Stadtlauf", garminName: "Stadtlauf", garminEventId: "7", sport: "Laufen", date: "2027-01-10" };
  const b = { id: "b", name: "Mein Halbmarathon", garminName: "HM Köln", garminEventId: "8", sport: "Laufen", date: "2027-02-10" };
  const res = merge([a, b], [ev("7", "2027-01-17", "Stadtlauf 2027"), ev("8", "2027-02-10", "Halbmarathon Köln")]);
  const [ga, gb] = res.goals;
  assert.deepStrictEqual([ga.date, ga.name], ["2027-01-17", "Stadtlauf 2027"]);
  assert.deepStrictEqual([gb.name, gb.garminName], ["Mein Halbmarathon", "Halbmarathon Köln"]);
  assert.strictEqual(res.added.length, 0);
});

test("unbekannte Sportart nimmt die Sportart des Hauptevents", () => {
  const res = merge([{ id: "g", name: "X", sport: "Laufen", date: "2027-09-01", isPrimary: true }], [ev("9", "2027-05-01", "Firmenevent", { sport: "Sonstiges" })]);
  assert.strictEqual(res.goals[1].sport, "Laufen");
});
