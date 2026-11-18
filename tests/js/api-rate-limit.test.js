// apiCall (js/data/api-client.js): Bremst der Server (429 "rate_limited"),
// wartet der Browser die Zeit aus Retry-After ab und versucht es erneut.
// Die Tagesgrenze des KI-Coachs (429 "claude_daily_limit") wird NICHT
// wiederholt. Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(responses) {
  const waits = [];
  const ctx = vm.createContext({
    console, JSON, Math, Number, String, Object, Array, Promise, Error, Set, Map, Date,
    AbortSignal: { timeout: () => undefined },
    setTimeout: (fn, ms) => { waits.push(ms); fn(); return 0; },
    clearTimeout: () => {},
    localStorage: { getItem: () => "tok", setItem() {}, removeItem() {}, clear() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    window: { location: { href: "" }, addEventListener() {} },
    document: { addEventListener() {}, visibilityState: "visible" },
    location: { href: "" },
    navigator: {},
    fetch: async () => {
      const r = responses.shift();
      return {
        ok: r.status < 400, status: r.status,
        headers: { get: h => (r.headers || {})[h] || null },
        json: async () => r.body || {},
      };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "js/data/api-client.js"), "utf8"), ctx);
  return { ctx, waits };
}

const limited = (s, code = "rate_limited") => ({ status: 429, headers: { "Retry-After": s }, body: { error: "zu viele", code } });

test("429 rate_limited: wartet Retry-After ab und versucht es noch einmal", async () => {
  const { ctx, waits } = load([limited("7"), { status: 200, body: { data: 1 } }]);
  const res = await vm.runInContext(`apiCall("workouts", "POST", {})`, ctx);
  assert.strictEqual(res.data, 1);
  assert.ok(waits.includes(7000));
});

test("Nach drei Wiederholungen kommt der Fehler an; Wartezeit höchstens 60 s", async () => {
  const { ctx, waits } = load([limited("500"), limited("500"), limited("500"), limited("500")]);
  await assert.rejects(vm.runInContext(`apiCall("x")`, ctx), e => e.status === 429);
  assert.deepStrictEqual(waits.filter(w => w >= 1000), [60000, 60000, 60000]);
});

test("Tagesgrenze des KI-Coachs wird nicht wiederholt", async () => {
  const { ctx, waits } = load([limited("5", "claude_daily_limit"), { status: 200, body: {} }]);
  await assert.rejects(vm.runInContext(`apiCall("ai/claude/chat", "POST", {})`, ctx), e => e.code === "claude_daily_limit");
  assert.ok(!waits.includes(5000));
});
