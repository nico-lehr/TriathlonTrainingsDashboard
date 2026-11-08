// Tests für den automatischen Garmin-Abruf im Dashboard: beim Öffnen leise
// fragen (der Server entscheidet, ob er wirklich holt), Anzeige "vor 12 Min.",
// Hinweis vor dem Ablauf des Schlüssels. Keine echten Garmin-Aufrufe - apiCall
// ist ein Mock. Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const calls = [];
let reply = { data: { configured: true, sync: { running: false } } };
const doc = { visibilityState: "visible", activeElement: null, addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] };
const app = vm.createContext({
  window: {}, document: doc, setTimeout: (fn) => 0, clearTimeout: () => {}, console, Math, JSON, Date, Promise,
  apiCall: async (endpoint, method, body) => { calls.push(JSON.parse(JSON.stringify({ endpoint, method, body }))); return reply; },
  escapeHtml: s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
});
["js/utils/formatting.js", "js/components/garmin-settings.js", "js/components/m-app.js"].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);

test("Automatischer Abruf: fragt den Server mit auto, höchstens alle 5 Minuten, nicht im Hintergrund", async () => {
  calls.length = 0;
  doc.visibilityState = "hidden";
  await run("autoGarminSync()");
  assert.strictEqual(calls.length, 0);
  doc.visibilityState = "visible";
  reply = { data: { configured: true, skipped: "recent", sync: { running: false, at: "2026-11-08T10:00:00", ok: true } } };
  await run("autoGarminSync()");
  assert.deepStrictEqual(calls.map(c => [c.endpoint, c.method, c.body]), [["garmin/sync", "POST", { auto: true }]]);
  await run("autoGarminSync()"); // gleich danach wieder nach vorne geholt: keine zweite Anfrage
  assert.strictEqual(calls.length, 1);
  run("garminAutoAskedAt = Date.now() - 6 * 60 * 1000");
  await run("autoGarminSync()");
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(run("garminState.sync.at"), "2026-11-08T10:00:00");
});

test("Wischen/Knopf am Handy holt schnell, der Knopf in den Einstellungen alles", async () => {
  calls.length = 0;
  reply = { data: { configured: true, sync: { running: false } } };
  // nicht auf das Ende warten (das Nachsehen läuft über setTimeout) - nur die Anfrage zählt
  run("startGarminSync({ quick: true })");
  await new Promise(r => setImmediate(r));
  run("garminWatch = null");
  run("startGarminSync()");
  await new Promise(r => setImmediate(r));
  run("garminWatch = null");
  assert.deepStrictEqual(calls.map(c => c.body), [{ quick: true }, {}]);
});

test("Zeitangabe: gerade eben, vor X Min., Uhrzeit, gestern, Datum", () => {
  const label = (at, now) => run(`mAgoLabel(new Date(${JSON.stringify(at)}), new Date(${JSON.stringify(now)}))`);
  assert.strictEqual(label("2026-11-08T10:00:00", "2026-11-08T10:00:30"), "gerade eben");
  assert.strictEqual(label("2026-11-08T10:00:00", "2026-11-08T10:12:10"), "vor 12 Min.");
  assert.strictEqual(label("2026-11-08T07:05:00", "2026-11-08T10:12:00"), "07:05 Uhr");
  assert.strictEqual(label("2026-11-07T21:40:00", "2026-11-08T10:12:00"), "gestern 21:40");
  assert.match(label("2026-11-03T21:40:00", "2026-11-08T10:12:00"), /^3\. Nov/);
});

test("Garmin-Knopf oben: läuft, abgelaufen, fehlgeschlagen, zuletzt geholt", () => {
  const pill = st => { run(`garminState = ${JSON.stringify({ loaded: true, configured: true, ...st })}`); return run("mSyncPill()"); };
  assert.match(pill({ sync: { running: true } }), /Holt Garmin-Daten/);
  assert.match(pill({ days_left: -2, expires: "2026-11-06", sync: {} }), /Schlüssel abgelaufen/);
  assert.match(pill({ sync: { at: "2026-11-08T10:00:00", ok: false, message: "x" } }), /fehlgeschlagen/);
  const at = new Date(Date.now() - 12 * 60000);
  const html = pill({ sync: { at: run("localDateStr")(at) + "T" + at.toTimeString().slice(0, 8), ok: true } });
  assert.match(html, /Garmin · vor 1[12] Min\./);
  assert.match(html, /data-m-act="garmin-sync"/);
  assert.match(pill({ loaded: true, configured: false, sync: {} }), /Garmin verbinden/);
});

test("Hinweis zum Garmin-Schlüssel erst ab 7 Tagen vor Ablauf", () => {
  const card = st => { run(`garminState = ${JSON.stringify({ loaded: true, configured: true, sync: {}, ...st })}`); return run("mGarminKeyCard()"); };
  assert.strictEqual(card({ days_left: 30, expires: "2026-12-08" }), "");
  assert.strictEqual(card({ days_left: null, expires: null }), "");
  assert.match(card({ days_left: 5, expires: "2026-11-13" }), /in 5 Tagen ab \(13\. November\)/);
  assert.match(card({ days_left: 1, expires: "2026-11-09" }), /morgen ab/);
  assert.match(card({ days_left: 0, expires: "2026-11-08" }), /heute ab/);
  assert.match(card({ days_left: -3, expires: "2026-11-05" }), /seit 5\. November abgelaufen/);
  assert.match(card({ days_left: 5, expires: "2026-11-13" }), /data-m-act="garmin"/);
});
