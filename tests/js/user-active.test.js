// Tests für "Ist gerade wirklich jemand da?" (js/utils/user-active.js):
// automatische KI-Arbeit läuft nur bei sichtbarer App und Benutzung in den
// letzten 2 Stunden; beim Zurückkommen wird nachgeholt.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");

function load() {
  const listeners = {};
  const document = {
    visibilityState: "visible",
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
  };
  const app = vm.createContext({ document, console, Date });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/utils/user-active.js"), "utf8"), app, { filename: "user-active.js" });
  const fire = type => (listeners[type] || []).forEach(fn => fn({ type }));
  return { app, document, fire, run: code => vm.runInContext(code, app) };
}

const H = 60 * 60 * 1000;

test("frisch geöffnet = aktiv; nach 2 h ohne Benutzung = nicht aktiv", () => {
  const { app } = load();
  const now = Date.now();
  assert.strictEqual(app.userIsActive(now), true);
  assert.strictEqual(app.userIsActive(now + 1.9 * H), true);
  assert.strictEqual(app.userIsActive(now + 2.1 * H), false);
});

test("verdeckter Tab ist nie aktiv", () => {
  const { app, document } = load();
  document.visibilityState = "hidden";
  assert.strictEqual(app.userIsActive(), false);
});

test("Tippen nach langer Pause zählt als zurück und holt nach - normales Tippen nicht", () => {
  const { app, run } = load();
  let back = 0;
  app.onUserBack(() => { back++; });
  app.noteUserActivity(Date.now() + 1000);
  assert.strictEqual(back, 0, "war ja gerade erst da");
  run("userLastSeen = Date.now() - 3 * 60 * 60 * 1000");
  assert.strictEqual(app.userIsActive(), false);
  app.noteUserActivity();
  assert.strictEqual(back, 1);
  assert.strictEqual(app.userIsActive(), true);
});

test("App wieder sichtbar = zurück (auch ohne Tippen); Klicks halten aktiv", () => {
  const { app, document, fire } = load();
  let back = 0;
  app.onUserBack(() => { back++; });
  document.visibilityState = "hidden"; fire("visibilitychange");
  assert.strictEqual(app.userIsActive(), false);
  document.visibilityState = "visible"; fire("visibilitychange");
  assert.strictEqual(back, 1);
  assert.strictEqual(app.userIsActive(), true);
  fire("pointerdown");
  assert.strictEqual(back, 1);
});
