// Tests für das Equipment-Modul (js/data/equipment.js): Kilometerstand mit
// Zeitfenster und ausdrücklicher Trainings-Zuordnung, die 90-%-Warnung, die
// Übersetzung zu den Datenbank-Spalten und die einmalige Übernahme der alten
// Liste. Ausführen: node --test tests/js/
//
// Wie plan-rules.test.js: die Browser-Skripte laufen in einem gemeinsamen
// vm-Kontext. Gestubbt sind nur Server (apiCall), Ablage (storeGet/storeSet),
// Hinweisbanner und sportGroup (sonst js/data/workouts.js).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/formatting.js", "js/data/equipment.js"];

const store = {};
const calls = [];
const errors = [];
let respond = () => ({ data: [] });
const app = vm.createContext({
  ALL: [], window: {},
  sportGroup: sport => (["Laufen", "Rad", "Schwimmen"].includes(sport) ? sport : "Sonstiges"),
  storeGet: key => (key in store ? JSON.parse(JSON.stringify(store[key])) : null),
  storeSet: (key, value) => { store[key] = JSON.parse(JSON.stringify(value)); },
  showApiError: message => { if (message) errors.push(message); },
  apiCall: async (endpoint, method = "GET", body = null) => {
    calls.push({ endpoint, method, body: body === null ? null : JSON.parse(JSON.stringify(body)) });
    return respond(endpoint, method, body);
  },
});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x)); // Objekte aus dem vm-Kontext haben eigene Prototypen

/* ---------- Testdaten ---------- */

const item = (id, over = {}) => ({
  id, name: id, category: "Sonstiges", sport: null, parentId: null, serviceIntervalKm: null, startKm: 0,
  activeFrom: null, activeTo: null, resetAt: null, manualKm: null, retired: false, note: "", createdAt: "2026-01-01", ...over,
});
const run_ = (file, day, km, sport = "Laufen") => ({ file, sport, _date: new Date(2026, 5, day, 8, 0), distance_km: km });

function reset({ items = [], workouts = [], assignments = {} } = {}) {
  calls.length = 0;
  errors.length = 0;
  Object.keys(store).forEach(k => delete store[k]);
  respond = () => ({ data: [] });
  app.ALL = workouts;
  app.__items = items;
  run("equipmentItems = __items; equipmentAssignments = new Map();");
  Object.entries(assignments).forEach(([file, id]) => run(`equipmentAssignments.set(${JSON.stringify(file)}, ${JSON.stringify(id)})`));
  run("equipmentSyncChain = Promise.resolve()");
}
const km = id => run(`equipmentKm(equipmentItems.find(x => x.id === ${JSON.stringify(id)}))`);
const state = id => run(`equipmentStatus(equipmentItems.find(x => x.id === ${JSON.stringify(id)}))`).state;
const settled = () => run("equipmentSyncChain");

/* ---------- 90-%-Warnung ---------- */

test("Warnschwelle ist ein benannter Wert: 90 Prozent", () => {
  assert.strictEqual(run("EQUIPMENT_WARN_RATIO"), 0.9);
});

test("Status: ok unter 90 %, bald fällig ab 90 %, fällig ab 100 %", () => {
  for (const [manual, expected] of [[0, "ok"], [89.9, "ok"], [90, "soon"], [99.9, "soon"], [100, "due"], [140, "due"]]) {
    reset({ items: [item("x", { serviceIntervalKm: 100, manualKm: manual })] });
    assert.strictEqual(state("x"), expected, `${manual} km von 100`);
  }
});

test("Status: ohne Limit nur Info, aussortiert warnt nie", () => {
  reset({ items: [item("a", { manualKm: 5000 }), item("b", { serviceIntervalKm: 100, manualKm: 500, retired: true })] });
  assert.strictEqual(state("a"), "nolimit");
  assert.strictEqual(state("b"), "retired");
  assert.deepStrictEqual(plain(run("dueEquipmentItems()")), []);
});

test("Warnliste: bald fällige und fällige, die größte Auslastung zuerst", () => {
  reset({ items: [
    item("ok", { serviceIntervalKm: 100, manualKm: 50 }),
    item("soon", { serviceIntervalKm: 100, manualKm: 92 }),
    item("due", { serviceIntervalKm: 100, manualKm: 120 }),
    item("alt", { serviceIntervalKm: 100, manualKm: 99, retired: true }),
  ] });
  assert.deepStrictEqual(plain(run("dueEquipmentItems()")).map(x => x.item.id), ["due", "soon"]);
});

/* ---------- Kilometer: Zeitfenster und Zuordnung ---------- */

const WORKOUTS = [
  run_("w1", 1, 10), run_("w2", 10, 12), run_("w3", 20, 8), run_("w4", 25, 30, "Rad"),
  { ...run_("sum", 12, 99), is_summary: true },
];

test("Km Art A: Startwert + Läufe im Standard-Fenster [von, bis), andere Sportart und Summen zählen nicht", () => {
  reset({ workouts: WORKOUTS, items: [
    item("alt", { sport: "Laufen", startKm: 100, activeFrom: "2026-06-01", activeTo: "2026-06-15" }),
    item("neu", { sport: "Laufen", activeFrom: "2026-06-15" }),
    item("rad", { sport: "Rad", activeFrom: "2026-01-01" }),
    item("nie", { sport: "Laufen" }),
  ] });
  assert.strictEqual(km("alt"), 122); // 100 + w1 + w2 (w3 liegt nach dem Fenster)
  assert.strictEqual(km("neu"), 8);
  assert.strictEqual(km("rad"), 30);
  assert.strictEqual(km("nie"), 0);
});

test("Km: ausdrückliche Zuordnung gewinnt - zählt nur für das zugeordnete Item, auch außerhalb seines Fensters", () => {
  reset({ workouts: WORKOUTS, assignments: { w3: "alt" }, items: [
    item("alt", { sport: "Laufen", activeFrom: "2026-06-01", activeTo: "2026-06-15" }),
    item("neu", { sport: "Laufen", activeFrom: "2026-06-15" }),
  ] });
  assert.strictEqual(km("alt"), 10 + 12 + 8); // w3 gehört ausdrücklich dazu
  assert.strictEqual(km("neu"), 0);            // und fehlt deshalb hier
  // Eine Zuordnung zu einem Item anderer Sportart verfälscht nichts.
  reset({ workouts: WORKOUTS, assignments: { w4: "alt" }, items: [item("alt", { sport: "Laufen", activeFrom: "2026-01-01" })] });
  assert.strictEqual(km("alt"), 30);
});

test("Km Art B: Verschleißteil zählt nur ab resetAt und nur, was für das Rad zählt", () => {
  reset({ workouts: WORKOUTS, assignments: { w1: "rad2" }, items: [
    item("rad", { sport: "Laufen", activeFrom: "2026-06-01" }),
    item("rad2", { sport: "Laufen", activeFrom: "2026-07-01" }),
    item("teil", { parentId: "rad", resetAt: "2026-06-05" }),
    item("teilAlt", { parentId: "rad" }),
    item("waise", { parentId: "gibtsnicht" }),
  ] });
  assert.strictEqual(km("teil"), 12 + 8);    // w2 + w3; w1 liegt vor dem Reset
  assert.strictEqual(km("teilAlt"), 12 + 8); // w1 ist ausdrücklich dem anderen Rad zugeordnet
  assert.strictEqual(km("waise"), 0);
});

test("Km Art C: manueller Stand", () => {
  reset({ workouts: WORKOUTS, items: [item("brille", { manualKm: 42.5 })] });
  assert.strictEqual(km("brille"), 42.5);
});

test("Auswahl in der Detailansicht: passende Sportart, aussortierte nur wenn zugeordnet; Automatik-Name", () => {
  reset({ workouts: WORKOUTS, assignments: { w1: "weg" }, items: [
    item("a", { sport: "Laufen", activeFrom: "2026-06-01" }),
    item("weg", { sport: "Laufen", retired: true, activeFrom: "2026-01-01", activeTo: "2026-05-01" }),
    item("rad", { sport: "Rad", activeFrom: "2026-01-01" }),
    item("teil", { parentId: "a" }),
  ] });
  assert.deepStrictEqual(plain(run("equipmentChoicesForWorkout(ALL[0])")).map(x => x.id), ["a", "weg"]);
  assert.deepStrictEqual(plain(run("equipmentChoicesForWorkout(ALL[1])")).map(x => x.id), ["a"]);
  assert.strictEqual(run("automaticEquipmentForWorkout(ALL[1])").id, "a");
  assert.strictEqual(run("automaticEquipmentForWorkout(ALL[0])").id, "a"); // ohne Rücksicht auf die Zuordnung
  assert.strictEqual(run("automaticEquipmentForWorkout(ALL[4])"), null);   // Summe
});

/* ---------- Übersetzung zu den Datenbank-Spalten ---------- */

test("API-Übersetzung: nichts geht verloren (Hin und zurück ergibt dasselbe Item)", () => {
  const full = item("17", {
    name: "Adizero", category: "Laufschuhe", sport: "Laufen", serviceIntervalKm: 700, startKm: 12.5,
    activeFrom: "2026-01-05", activeTo: "2026-09-30", resetAt: "2026-03-01", manualKm: 3, retired: true,
    note: "Kaufdatum Januar", createdAt: "2026-01-04",
  });
  const part = item("18", { category: "Verschleißteil", parentId: "17", serviceIntervalKm: 3000, resetAt: "2026-03-01" });
  for (const original of [full, part, item("19", { manualKm: 42.5 })]) {
    const row = plain(app.equipmentToApi(original));
    assert.deepStrictEqual(Object.keys(row).sort(), ["aktiv", "details", "max_km", "name", "parent_id", "sport", "start_km", "typ"]);
    const back = plain(app.equipmentFromApi({ id: Number(original.id), ...row, parent_id: row.parent_id }));
    assert.deepStrictEqual(back, original);
  }
  const row = plain(app.equipmentToApi(full));
  assert.deepStrictEqual([row.typ, row.max_km, row.start_km, row.aktiv], ["Laufschuhe", 700, 12.5, false]);
});

test("API-Übersetzung: ungültige alte Werte werden zu gültigen (kein 400 beim Übernehmen)", () => {
  const row = plain(app.equipmentToApi(item("1", { name: "", serviceIntervalKm: "", startKm: "abc", manualKm: -5, category: "" })));
  assert.deepStrictEqual([row.name, row.max_km, row.start_km, row.details.manualKm, row.typ], ["Ohne Namen", null, 0, 0, "Sonstiges"]);
  assert.strictEqual(plain(app.equipmentToApi(item("2", { name: "x".repeat(400) }))).name.length, 255);
});

test("Übernahme-Body: alte Kennungen als ref/parent_ref, keine alte id als parent_id", () => {
  const body = plain(app.equipmentImportPayload([
    item("uuid-rad", { sport: "Rad", name: "Rennrad" }),
    item("uuid-kette", { parentId: "uuid-rad", name: "Kette" }),
  ]));
  assert.deepStrictEqual(body.items.map(x => [x.ref, x.parent_ref, x.parent_id]), [["uuid-rad", null, null], ["uuid-kette", "uuid-rad", null]]);
});

/* ---------- Laden + einmalige Übernahme ---------- */

const serverRow = (id, over = {}) => ({ id, name: `Item ${id}`, typ: "Sonstiges", sport: null, parent_id: null, start_km: 0, max_km: null, aktiv: true, details: {}, ...over });

test("Laden: Items und Zuordnungen vom Server, Ids als Text", async () => {
  reset();
  respond = endpoint => ({ data: endpoint === "equipment" ? [serverRow(1, { sport: "Laufen" }), serverRow(2, { parent_id: 1 })] : [{ equipment_id: 1, workout_file: "w1" }] });
  await run("loadEquipmentItems()");
  assert.deepStrictEqual(plain(run("equipmentItems")).map(x => [x.id, x.parentId]), [["1", null], ["2", "1"]]);
  assert.strictEqual(run("equipmentAssignments.get('w1')"), "1");
  assert.deepStrictEqual(calls.map(c => c.endpoint).sort(), ["equipment", "equipment/assignments"]);
});

test("Übernahme: leere Server-Tabelle + alte Liste in der Ablage -> einmal hochladen, Ablage bleibt als Kopie", async () => {
  reset();
  const old = [item("uuid-rad", { sport: "Rad", name: "Rennrad", category: "Rad" }), item("uuid-kette", { parentId: "uuid-rad", name: "Kette" })];
  store["triathlon_dashboard_equipment_items_v1"] = old;
  respond = (endpoint, method) => (method === "POST" ? { data: [serverRow(5, { name: "Rennrad", sport: "Rad" }), serverRow(6, { name: "Kette", parent_id: 5 })] } : { data: [] });
  await run("loadEquipmentItems()");
  const posts = calls.filter(c => c.method === "POST");
  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].endpoint, "equipment/import");
  assert.deepStrictEqual(posts[0].body.items.map(x => x.ref), ["uuid-rad", "uuid-kette"]);
  assert.deepStrictEqual(plain(run("equipmentItems")).map(x => [x.id, x.name, x.parentId]), [["5", "Rennrad", null], ["6", "Kette", "5"]]);
  assert.deepStrictEqual(store["triathlon_dashboard_equipment_items_v1"], old); // nicht gelöscht
  assert.strictEqual(store["triathlon_dashboard_equipment_migrated_v1"], true);
  assert.deepStrictEqual(errors, []);
});

test("Übernahme passiert nur einmal: nicht bei vorhandenen Server-Daten, nicht nach Löschen aller Items, nicht ohne alte Liste", async () => {
  const old = [item("u1", { name: "Alt" })];
  // Server hat schon Items
  reset();
  store["triathlon_dashboard_equipment_items_v1"] = old;
  respond = () => ({ data: [serverRow(1)] });
  await run("loadEquipmentItems()");
  assert.strictEqual(calls.filter(c => c.method === "POST").length, 0);
  // Schon übernommen, danach alles gelöscht: die alte Kopie kommt nicht zurück
  reset();
  store["triathlon_dashboard_equipment_items_v1"] = old;
  store["triathlon_dashboard_equipment_migrated_v1"] = true;
  await run("loadEquipmentItems()");
  assert.strictEqual(calls.filter(c => c.method === "POST").length, 0);
  assert.deepStrictEqual(plain(run("equipmentItems")), []);
  // Keine alte Liste
  reset();
  await run("loadEquipmentItems()");
  assert.strictEqual(calls.filter(c => c.method === "POST").length, 0);
  assert.strictEqual("triathlon_dashboard_equipment_migrated_v1" in store, false);
});

test("Laden scheitert: Hinweisbanner, kein Absturz, keine Übernahme-Markierung", async () => {
  reset();
  store["triathlon_dashboard_equipment_items_v1"] = [item("u1")];
  respond = () => { throw new Error("Server nicht erreichbar"); };
  await run("loadEquipmentItems()");
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /Equipment konnte nicht geladen werden/);
  assert.strictEqual("triathlon_dashboard_equipment_migrated_v1" in store, false);
});

/* ---------- Änderungen gehen zum Server ---------- */

test("Anlegen: Server vergibt die id; erstes Item einer Sportart wird gleich Standard", async () => {
  reset();
  respond = (endpoint, method, body) => ({ data: { id: 7, ...body } });
  const created = plain(await run(`addEquipmentItem({ name: " Pegasus ", category: "Laufschuhe", sport: "Laufen", serviceIntervalKm: "700", startKm: "20" })`));
  assert.strictEqual(created.id, "7");
  assert.strictEqual(created.name, "Pegasus");
  assert.ok(created.activeFrom, "ist Standard");
  await settled();
  assert.deepStrictEqual(calls.map(c => [c.method, c.endpoint]), [["POST", "equipment"], ["PUT", "equipment/7"]]);
  assert.deepStrictEqual([calls[0].body.typ, calls[0].body.max_km, calls[0].body.start_km, calls[0].body.sport], ["Laufschuhe", 700, 20, "Laufen"]);
  assert.strictEqual(calls[1].body.details.activeFrom, created.activeFrom);
});

test("Anlegen scheitert: null, Hinweisbanner, nichts in der Liste", async () => {
  reset();
  respond = () => { throw new Error("HTTP 500"); };
  assert.strictEqual(await run(`addEquipmentItem({ name: "X" })`), null);
  assert.strictEqual(run("equipmentItems.length"), 0);
  assert.match(errors[0], /konnte nicht angelegt werden/);
});

test("Als Standard setzen: löst das bisherige ab, beide Items werden gespeichert", async () => {
  reset({ items: [item("1", { sport: "Laufen", activeFrom: "2026-01-01" }), item("2", { sport: "Laufen" })] });
  run(`setEquipmentDefaultForSport("2")`);
  await settled();
  assert.deepStrictEqual(calls.map(c => [c.method, c.endpoint]), [["PUT", "equipment/1"], ["PUT", "equipment/2"]]);
  assert.ok(calls[0].body.details.activeTo, "altes Item abgelöst");
  assert.strictEqual(calls[1].body.details.activeTo, null);
});

test("Aussortieren, Reaktivieren, Wartung, manueller Stand: jeweils ein PUT mit dem neuen Stand", async () => {
  reset({ items: [item("1", { sport: "Laufen", activeFrom: "2026-01-01" }), item("2", { parentId: "1" }), item("3")] });
  run(`retireEquipmentItem("1")`);
  run(`reactivateEquipmentItem("1")`);
  run(`resetEquipmentPart("2")`);
  run(`setEquipmentManualKm("3", "-4")`);
  run(`setEquipmentManualKm("3", "12.5")`);
  await settled();
  assert.deepStrictEqual(calls.map(c => [c.method, c.endpoint, c.body.aktiv]), [
    ["PUT", "equipment/1", false], ["PUT", "equipment/1", true], ["PUT", "equipment/2", true], ["PUT", "equipment/3", true], ["PUT", "equipment/3", true]]);
  assert.ok(calls[0].body.details.activeTo, "Zähl-Fenster beendet");
  assert.ok(calls[2].body.details.resetAt, "Wartung gemerkt");
  assert.deepStrictEqual(calls.slice(3).map(c => c.body.details.manualKm), [0, 12.5]); // nie negativ
});

test("Löschen: ein DELETE, Teile und deren Zuordnungen verschwinden auch in der Anzeige", async () => {
  reset({ items: [item("1", { sport: "Rad" }), item("2", { parentId: "1" }), item("3", { sport: "Rad" })], assignments: { a: "1", b: "3" } });
  run(`deleteEquipmentItem("1")`);
  await settled();
  assert.deepStrictEqual(calls.map(c => [c.method, c.endpoint]), [["DELETE", "equipment/1"]]);
  assert.deepStrictEqual(plain(run("equipmentItems")).map(x => x.id), ["3"]);
  assert.deepStrictEqual(plain(run("[...equipmentAssignments]")), [["b", "3"]]);
});

test("Zuordnen und aufheben", async () => {
  reset({ items: [item("1", { sport: "Laufen" }), item("2", { sport: "Laufen" })] });
  run(`assignWorkoutToEquipment("a b.fit", "1")`);
  run(`assignWorkoutToEquipment("a b.fit", "2")`); // umhängen
  assert.strictEqual(run(`equipmentAssignments.get("a b.fit")`), "2");
  run(`assignWorkoutToEquipment("a b.fit", null)`);
  run(`assignWorkoutToEquipment("nie-zugeordnet.fit", null)`); // nichts zu tun
  await settled();
  assert.strictEqual(run(`equipmentAssignments.size`), 0);
  assert.deepStrictEqual(calls.map(c => [c.method, c.endpoint]), [
    ["POST", "equipment/1/workouts"], ["POST", "equipment/2/workouts"], ["DELETE", "equipment/2/workouts?workout_file=a%20b.fit"]]);
  assert.deepStrictEqual(calls[0].body, { workout_file: "a b.fit" });
});

test("Speichern scheitert: Hinweisbanner, spätere Änderungen laufen trotzdem weiter", async () => {
  reset({ items: [item("1", { manualKm: 1 })] });
  let first = true;
  respond = () => { if (first) { first = false; throw new Error("HTTP 500"); } return { data: {} }; };
  run(`setEquipmentManualKm("1", 5)`);
  run(`setEquipmentManualKm("1", 6)`);
  await settled();
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /Equipment speichern fehlgeschlagen/);
});
