// Ablage pro Person: Erkennung "auf einem anderen Gerät geändert" (js/data/api-client.js).
// Der Vergleich darf nicht an der Reihenfolge der Felder hängen und muss
// echte Abweichungen (geänderter Wert, neuer oder fehlender Schlüssel) finden.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
// Minimaler Ersatz für das Hinweis-Banner (#api-error-banner) samt Knopf.
const banner = { textContent: "", hidden: true, children: [], appendChild(c) { this.children.push(c); } };
const ctx = vm.createContext({
  window: { addEventListener: () => {} },
  document: {
    addEventListener: () => {}, visibilityState: "visible",
    getElementById: id => (id === "api-error-banner" ? banner : null),
    createElement: () => ({ addEventListener: () => {} }),
  },
  localStorage: { getItem: () => null }, setTimeout,
});
vm.runInContext(fs.readFileSync(path.join(ROOT, "js/data/api-client.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js/utils/formatting.js"), "utf8"), ctx);
const run = code => vm.runInContext(code, ctx);
const tick = () => new Promise(resolve => setImmediate(resolve));
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

test("storeSet legt eine Kopie ab: spätere Änderungen am Objekt sind nicht 'schon gespeichert'", async () => {
  ctx.apiCall = () => Promise.resolve({});
  run("userStore = {}");
  const plan = [{ id: "p1", status: "geplant" }];
  ctx.storeSet("plan", plan);
  plan[0]._lessonsLoading = true; // z. B. Lade-Merker der KI, noch nicht gespeichert
  assert.strictEqual(run("JSON.stringify(userStore.plan)"), JSON.stringify([{ id: "p1", status: "geplant" }]));
  await tick();
});

test("gescheitertes Speichern: Hinweis bleibt, kein Vergleich mit dem Server, kein 'Neu laden'-Rat", async () => {
  const calls = [];
  ctx.apiCall = (endpoint, method) => {
    calls.push(`${method || "GET"} ${endpoint}`);
    return endpoint === "store/x" ? Promise.reject(new Error("Server nicht erreichbar")) : Promise.resolve({ data: {} });
  };
  run("userStore = {}; storeLoaded = true; storeStale = false; storeCheckedAt = 0; storeFailed.clear()");
  ctx.storeSet("x", { haken: "erledigt" });
  await tick(); await tick();
  ctx.storeSet("y", 1); // ein anderer Schlüssel klappt danach
  await tick(); await tick();
  assert.ok(run("storeFailed.has('x') && !storeFailed.has('y')"));
  assert.strictEqual(banner.hidden, false);
  assert.match(banner.textContent, /Speichern fehlgeschlagen/);
  ctx.showApiError(null); // z. B. Equipment erfolgreich gespeichert
  assert.match(banner.textContent, /Speichern fehlgeschlagen/);
  calls.length = 0;
  await ctx.checkStoreStale();
  assert.deepStrictEqual(calls, []); // eigener ungesicherter Wert -> nicht vergleichen
  assert.strictEqual(run("storeStale"), false);
  run("storeFailed.clear()");
});

test("Warnung 'anderes Gerät' lässt sich durch einen anderen Erfolg nicht ausblenden", async () => {
  run("userStore = { a: 1 }; storeLoaded = true; storeStale = false; storeCheckedAt = 0; storeFailed.clear()");
  ctx.apiCall = () => Promise.resolve({ data: { a: 2 } });
  await ctx.checkStoreStale();
  assert.strictEqual(run("storeStale"), true);
  assert.match(banner.textContent, /anderen Gerät/);
  ctx.showApiError(null);
  assert.strictEqual(banner.hidden, false);
  assert.match(banner.textContent, /anderen Gerät/);
  run("storeStale = false");
});

test("vor dem ersten Laden wird nicht verglichen (leere Ablage wäre ein Fehlalarm)", async () => {
  run("userStore = {}; storeLoaded = false; storeStale = false; storeCheckedAt = 0");
  let asked = false;
  ctx.apiCall = () => { asked = true; return Promise.resolve({ data: { a: 1 } }); };
  await ctx.checkStoreStale();
  assert.strictEqual(asked, false);
  assert.strictEqual(run("storeStale"), false);
});

test("escapeHtml maskiert auch Anführungszeichen (Text in value=\"...\")", () => {
  assert.strictEqual(ctx.escapeHtml(`Lauf "locker" & <schnell> Coach's`), "Lauf &quot;locker&quot; &amp; &lt;schnell&gt; Coach&#39;s");
  assert.strictEqual(ctx.escapeHtml(null), "");
  assert.strictEqual(ctx.escapeHtml(5), "5");
});
