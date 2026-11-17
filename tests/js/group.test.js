// Tests für den Feed (js/data/group.js): welche Abzeichen geteilt werden
// (nur ab dem Beitritt, nur die höchste Stufe auf einmal, keine Doppelten),
// die Übersetzung der Abzeichen-IDs und die sofort sichtbare Reaktion.
// Ausführen: node --test tests/js/
//
// Wie equipment.test.js: das Browser-Skript läuft in einem vm-Kontext,
// gestubbt sind nur Server (apiCall) und Ablage (storeGet/storeSet).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");

const store = {};
const calls = [];
let respond = () => ({ data: {} });
const app = vm.createContext({
  Date, document: { addEventListener() {} },
  storeGet: key => (key in store ? JSON.parse(JSON.stringify(store[key])) : null),
  storeSet: (key, value) => { store[key] = JSON.parse(JSON.stringify(value)); },
  apiCall: async (endpoint, method = "GET", body = null) => {
    calls.push({ endpoint, method, body: body === null ? null : JSON.parse(JSON.stringify(body)) });
    return respond(endpoint, method, body);
  },
});
vm.runInContext(fs.readFileSync(path.join(ROOT, "js/data/group.js"), "utf8"), app, { filename: "js/data/group.js" });
vm.runInContext("var achievementsState = { unlocked: [] };", app);
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x));

const iso = msAgo => new Date(Date.now() - msAgo).toISOString();
const HOUR = 3600000, DAY = 24 * HOUR;

function reset({ joinedAgo = 10 * DAY, unlocked = [] } = {}) {
  calls.length = 0;
  Object.keys(store).forEach(k => delete store[k]);
  respond = () => ({ data: { added: 0, skipped: 0 } });
  app.__state = { me: { uid: 1, joined: true, display_name: "Nico", joined_at: iso(joinedAgo) }, highlights: [], challenges: [] };
  app.__unlocked = unlocked;
  run("groupState.data = __state; groupState.sharing = false; achievementsState.unlocked = __unlocked;");
}

test("Abzeichen-IDs werden in feste Arten übersetzt, Unbekanntes nicht", () => {
  const t = id => plain(run(`achievementToGroupItem({ id: ${JSON.stringify(id)} })`));
  assert.deepStrictEqual(t("count_100"), { type: "count", value: 100 });
  assert.deepStrictEqual(t("streak_30"), { type: "streak", value: 30 });
  assert.deepStrictEqual(t("pb_Laufen_all_10000_2892"), { type: "pb", sport: "Laufen", meters: 10000, value: 2892 });
  assert.deepStrictEqual(t("pb_Rad_outdoor_40000_4510"), { type: "pb", sport: "Rad", meters: 40000, value: 4510 });
  assert.strictEqual(t("geburtstag"), null);
});

test("Geteilt wird nur, was nach dem Beitritt und in den letzten 7 Tagen kam", async () => {
  reset({ joinedAgo: 3 * DAY, unlocked: [
    { id: "count_50", achievedAt: iso(5 * DAY) },   // vor dem Beitritt
    { id: "streak_7", achievedAt: iso(2 * DAY) },
    { id: "pb_Laufen_all_5000_1320", achievedAt: iso(HOUR) },
  ] });
  await run("shareNewAchievements()");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].endpoint, "group/highlights");
  assert.deepStrictEqual(calls[0].body.items.map(i => i.type).sort(), ["pb", "streak"]);
  assert.ok(calls[0].body.items.every(i => typeof i.achieved_at === "string"));
  // Schon geteilt -> kein zweites Mal
  calls.length = 0;
  await run("shareNewAchievements()");
  assert.strictEqual(calls.length, 0);
});

test("Mehrere Stufen auf einmal: nur die höchste wird geteilt", async () => {
  reset({ unlocked: ["count_10", "count_25", "count_50", "streak_7", "streak_14"].map(id => ({ id, achievedAt: iso(HOUR) })) });
  await run("shareNewAchievements()");
  assert.deepStrictEqual(calls[0].body.items.map(i => `${i.type}_${i.value}`).sort(), ["count_50", "streak_14"]);
  // die kleineren gelten trotzdem als erledigt
  assert.deepStrictEqual([...store.triathlon_dashboard_group_shared_v1].sort(), ["count_10", "count_25", "count_50", "streak_14", "streak_7"]);
});

test("Wer nicht mitmacht, teilt nichts", async () => {
  reset({ unlocked: [{ id: "count_10", achievedAt: iso(HOUR) }] });
  run("groupState.data.me.joined = false");
  await run("shareNewAchievements()");
  assert.strictEqual(calls.length, 0);
});

test("Beim Beitreten gelten vorhandene Abzeichen als schon geteilt", async () => {
  reset({ unlocked: [{ id: "count_100", achievedAt: iso(HOUR) }] });
  run("groupState.data.me.joined = false");
  respond = endpoint => (endpoint === "group" ? { data: { me: { uid: 1, joined: true, display_name: "Nico", joined_at: iso(0) } } } : { data: {} });
  await run("groupJoin('Nico')");
  assert.deepStrictEqual(calls.map(c => `${c.method} ${c.endpoint}`), ["PUT group/me", "GET group"]);
  assert.deepStrictEqual(store.triathlon_dashboard_group_shared_v1, ["count_100"]);
});

test("Reaktion erscheint sofort und wird mit dem Server abgeglichen", async () => {
  reset();
  run(`groupState.data.highlights = [{ id: 7, reactions: [{ emoji: "clap", count: 1, mine: false, names: ["Tom"] }] }]`);
  let seen = null;
  respond = () => { seen = plain(run("groupState.data.highlights[0].reactions")); return { data: { reactions: [{ emoji: "fire", count: 1, mine: true, names: ["Nico"] }, { emoji: "clap", count: 1, mine: false, names: ["Tom"] }] } }; };
  await run("groupToggleReaction(7, 'fire')");
  // vor der Antwort schon sichtbar, in fester Reihenfolge (🔥 vor 👏)
  assert.deepStrictEqual(seen.map(r => [r.emoji, r.count, r.mine]), [["fire", 1, true], ["clap", 1, false]]);
  assert.deepStrictEqual(calls[0], { endpoint: "group/highlights/7/reactions", method: "POST", body: { emoji: "fire" } });
});
