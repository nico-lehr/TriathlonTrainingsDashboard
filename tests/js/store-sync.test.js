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
const reloads = [];
const local = new Map();
const ctx = vm.createContext({
  window: { addEventListener: () => {}, location: { reload: () => reloads.push(1) } },
  document: {
    addEventListener: () => {}, visibilityState: "visible", activeElement: null,
    getElementById: id => (id === "api-error-banner" ? banner : null),
    createElement: () => ({ addEventListener: () => {} }),
  },
  localStorage: { getItem: k => (local.has(k) ? local.get(k) : null), setItem: (k, v) => local.set(k, String(v)), removeItem: k => local.delete(k) },
  setTimeout: () => 0, clearTimeout: () => {},
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
  assert.match(banner.textContent, /automatisch nachgeschickt/);
  run("storeFailed.clear(); storeDirty.clear(); storeSending.clear()");
});

test("anderes Gerät hat geändert, hier ist nichts offen: neuer Stand wird geladen (statt nur Warnung)", async () => {
  run("userStore = { a: 1 }; storeLoaded = true; storeStale = false; storeCheckedAt = 0; storeFailed.clear()");
  ctx.apiCall = () => Promise.resolve({ data: { a: 2 } });
  reloads.length = 0;
  await ctx.checkStoreStale();
  assert.strictEqual(reloads.length, 1);
  assert.strictEqual(run("storeStale"), false);
});

test("Warnung 'anderes Gerät' (mitten in einer Eingabe) lässt sich durch einen anderen Erfolg nicht ausblenden", async () => {
  run("userStore = { a: 1 }; storeLoaded = true; storeStale = false; storeCheckedAt = 0; storeFailed.clear()");
  ctx.apiCall = () => Promise.resolve({ data: { a: 2 } });
  ctx.document.activeElement = { tagName: "INPUT" };
  reloads.length = 0;
  await ctx.checkStoreStale();
  ctx.document.activeElement = null;
  assert.strictEqual(reloads.length, 0);
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

test("eigene Änderung während der Prüfung gilt nicht als Änderung von außen", async () => {
  run("userStore = { a: 1 }; storeLoaded = true; storeStale = false; storeCheckedAt = 0; storeFailed.clear()");
  let answer;
  ctx.apiCall = (endpoint) => endpoint === "store"
    ? new Promise(resolve => { answer = resolve; }) // langsame Antwort mit dem alten Stand
    : Promise.resolve({});
  const check = ctx.checkStoreStale();
  ctx.storeSet("a", 2); // Haken gesetzt, PUT ist schneller fertig als das GET
  await tick(); await tick();
  answer({ data: { a: 1 } });
  await check;
  assert.strictEqual(run("storeStale"), false);
});

test("Schließen der Seite warnt bei ungesicherter Änderung", () => {
  const handlers = {};
  const win = { addEventListener: (name, fn) => { handlers[name] = fn; } };
  const c2 = vm.createContext({ window: win, document: { addEventListener: () => {} }, localStorage: { getItem: () => null }, clearTimeout: () => {}, setTimeout: () => 0 });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js/data/api-client.js"), "utf8"), c2);
  const ev = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
  let e = ev(); handlers.beforeunload(e);
  assert.strictEqual(e.prevented, false);
  vm.runInContext("storeFailed.add('x')", c2);
  e = ev(); handlers.beforeunload(e);
  assert.strictEqual(e.prevented, true);
});

/* ---------- Zusammenführen statt Überschreiben (zwei Geräte) ---------- */

test("storeMerge3: jedes Gerät hat ein anderes Feld geändert -> beide Änderungen bleiben", () => {
  const base = { ftpWatts: 230, weightKg: 72, name: "Nico" };
  const handy = { ftpWatts: 230, weightKg: 71, name: "Nico" };   // Handy: Gewicht
  const pc = { ftpWatts: 250, weightKg: 72, name: "Nico" };      // Computer: FTP
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.storeMerge3(base, handy, pc))), { ftpWatts: 250, weightKg: 71, name: "Nico" });
});

test("storeMerge3: Listen mit id werden Eintrag für Eintrag zusammengeführt", () => {
  const base = [{ id: "a", t: "Lauf" }, { id: "b", t: "Rad" }];
  const mine = [{ id: "a", t: "Lauf locker" }, { id: "b", t: "Rad" }, { id: "c", t: "Schwimmen" }]; // geändert + neu
  const theirs = [{ id: "a", t: "Lauf" }, { id: "d", t: "Kraft" }];                                 // b gelöscht, d neu
  const out = JSON.parse(JSON.stringify(ctx.storeMerge3(base, mine, theirs)));
  assert.deepStrictEqual(out, [{ id: "a", t: "Lauf locker" }, { id: "d", t: "Kraft" }, { id: "c", t: "Schwimmen" }]);
});

test("storeMerge3: dasselbe Feld auf beiden Geräten -> die eigene, neueste Eingabe gewinnt", () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.storeMerge3({ x: 1 }, { x: 2 }, { x: 3 }))), { x: 2 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.storeMerge3({ x: 1 }, { x: 1 }, { x: 3 }))), { x: 3 });
});

test("Speichern schickt den bekannten Server-Stand mit; bei 409 wird zusammengeführt und erneut gespeichert", async () => {
  run("userStore = { p: { ftp: 230, kg: 72 } }; storeBase = { p: { ftp: 230, kg: 72 } }; storeFailed.clear(); storeDirty.clear(); storeSending.clear(); storeMerged = false");
  const bodies = [];
  let server = { ftp: 250, kg: 72 }; // Computer hat inzwischen FTP geändert
  ctx.apiCall = (endpoint, method, body) => {
    if (method !== "PUT") return Promise.resolve({ data: {} });
    bodies.push(JSON.parse(JSON.stringify(body)));
    if (JSON.stringify(body.base) !== JSON.stringify(server)) {
      const e = new Error("konflikt"); e.status = 409; e.code = "store_conflict"; e.body = { current: server };
      return Promise.reject(e);
    }
    server = body.value;
    return Promise.resolve({});
  };
  reloads.length = 0;
  ctx.storeSet("p", { ftp: 230, kg: 71 }); // Handy: Gewicht
  for (let i = 0; i < 6; i++) await tick();
  assert.deepStrictEqual(bodies[0].base, { ftp: 230, kg: 72 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(server)), { ftp: 250, kg: 71 });
  assert.strictEqual(reloads.length, 1); // danach neu laden, damit auch FTP 250 angezeigt wird
  const box = JSON.parse(local.get("triathlon_dashboard_outbox_v1") || '{"items":{}}');
  assert.strictEqual("p" in box.items, false); // angekommen -> nicht mehr im Zwischenspeicher
});

test("nicht angekommene Änderung liegt im Gerät und wird beim nächsten Öffnen nachgeschickt", async () => {
  local.clear();
  run("userStore = {}; storeBase = {}; storeOwner = 7; storeFailed.clear(); storeDirty.clear(); storeSending.clear()");
  ctx.apiCall = (endpoint, method) => (method === "PUT" ? Promise.reject(new Error("Server nicht erreichbar")) : Promise.resolve({ data: {} }));
  ctx.storeSet("ziel", { name: "Ironman" });
  for (let i = 0; i < 3; i++) await tick();
  assert.ok(local.has("triathlon_dashboard_outbox_v1"));

  // "App neu geöffnet": frischer Stand vom Server, Netz wieder da
  run("userStore = {}; storeBase = {}; storeOwner = null; storeFailed.clear(); storeDirty.clear(); storeSending.clear()");
  const puts = [];
  ctx.apiCall = (endpoint, method, body) => {
    if (endpoint === "store") return Promise.resolve({ data: { andere: 1 } });
    if (endpoint === "auth/me") return Promise.resolve({ data: { username: 7 } });
    puts.push([endpoint, body.value]);
    return Promise.resolve({});
  };
  await ctx.loadUserStore();
  for (let i = 0; i < 3; i++) await tick();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(puts)), [["store/ziel", { name: "Ironman" }]]);
  assert.strictEqual(local.has("triathlon_dashboard_outbox_v1"), false);
});

test("Zwischenspeicher einer anderen Person wird nie übernommen", async () => {
  local.set("triathlon_dashboard_outbox_v1", JSON.stringify({ owner: 3, items: { ziel: { value: { name: "fremd" }, base: null } } }));
  run("userStore = {}; storeBase = {}; storeFailed.clear(); storeDirty.clear(); storeSending.clear()");
  const puts = [];
  ctx.apiCall = (endpoint, method) => {
    if (endpoint === "store") return Promise.resolve({ data: {} });
    if (endpoint === "auth/me") return Promise.resolve({ data: { username: 7 } });
    puts.push(endpoint);
    return Promise.resolve({});
  };
  await ctx.loadUserStore();
  await tick();
  assert.deepStrictEqual(puts, []);
  assert.strictEqual(local.has("triathlon_dashboard_outbox_v1"), false);
});

test("Schutz: Speichern eines nie gelesenen Bereichs ergänzt statt zu ersetzen (leeres Start-Profil)", async () => {
  run("userStore = { profil: { ftpWatts: 250, name: 'Nico', weightKg: 70 }, log: [{ date: '2026-11-01', weightKg: 70 }] }; storeBase = JSON.parse(JSON.stringify(userStore)); storeLoaded = true; storeReadKeys.clear(); storeFailed.clear(); storeDirty.clear(); storeSending.clear()");
  const sent = {};
  ctx.apiCall = (endpoint, method, body) => { if (method === "PUT") sent[endpoint] = body.value; return Promise.resolve({}); };
  ctx.storeSet("profil", { ftpWatts: null, name: null, weightKg: 71.5 }); // Standard-Profil + neues Garmin-Gewicht
  ctx.storeSet("log", [{ date: "2026-11-07", weightKg: 71.5 }]);
  await tick(); await tick();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sent["store/profil"])), { ftpWatts: 250, name: "Nico", weightKg: 71.5 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sent["store/log"])), [{ date: "2026-11-01", weightKg: 70 }, { date: "2026-11-07", weightKg: 71.5 }]);
  // Nach dem Lesen gilt wieder: der Code kennt den Stand, Speichern ersetzt.
  ctx.storeGet("profil");
  ctx.storeSet("profil", { ftpWatts: 260 });
  await tick(); await tick();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sent["store/profil"])), { ftpWatts: 260 });
});
