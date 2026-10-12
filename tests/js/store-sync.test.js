// Ablage pro Person: Erkennung "auf einem anderen Gerät geändert" (js/data/api-client.js).
// Der Vergleich darf nicht an der Reihenfolge der Felder hängen und muss
// echte Abweichungen (geänderter Wert, neuer oder fehlender Schlüssel) finden.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const ctx = vm.createContext({
  window: { addEventListener: () => {} }, document: { addEventListener: () => {} },
  localStorage: { getItem: () => null },
});
vm.runInContext(fs.readFileSync(path.join(ROOT, "js/data/api-client.js"), "utf8"), ctx);
const setLocal = value => vm.runInContext(`userStore = ${JSON.stringify(value)}`, ctx);
const differs = server => ctx.storeChangedElsewhere(server);

test("gleicher Stand, auch bei anderer Feld-Reihenfolge: keine Abweichung", () => {
  setLocal({ goals: [{ id: "g1", name: "Ironman", date: "2027-06-01" }], plan: [] });
  assert.strictEqual(differs({ plan: [], goals: [{ date: "2027-06-01", name: "Ironman", id: "g1" }] }), false);
});

test("geänderter Wert, neuer und fehlender Schlüssel werden erkannt", () => {
  setLocal({ weight: [{ date: "2026-10-01", weightKg: 70 }], plan: [] });
  assert.strictEqual(differs({ weight: [{ date: "2026-10-01", weightKg: 71 }], plan: [] }), true);
  assert.strictEqual(differs({ weight: [{ date: "2026-10-01", weightKg: 70 }], plan: [], extra: 1 }), true);
  assert.strictEqual(differs({ plan: [] }), true);
});

test("null, Zahlen, Texte und verschachtelte Listen werden unterschieden", () => {
  setLocal({ a: null, b: 0, c: "0", d: [[1, 2], [3]] });
  assert.strictEqual(differs({ a: null, b: 0, c: "0", d: [[1, 2], [3]] }), false);
  assert.strictEqual(differs({ a: null, b: "0", c: "0", d: [[1, 2], [3]] }), true);
  assert.strictEqual(differs({ a: null, b: 0, c: "0", d: [[1, 2, 3]] }), true);
});
