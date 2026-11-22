// Tests für den automatischen Wochenplan als Sammelauftrag (js/ai/plan-batch.js):
// wann abgeschickt, gewartet oder sofort geplant wird, und dass ein überholtes
// Ergebnis nicht eingebaut wird. Server und KI sind gemockt.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/data/race-formats.js", "js/utils/dates.js", "js/utils/formatting.js", "js/analytics/training-load.js", "js/analytics/plan-rules.js", "js/analytics/periodization.js",
  "js/data/planned-workouts.js", "js/analytics/training-plan.js", "js/ai/ollama.js", "js/ai/plan-batch.js"];

const app = vm.createContext({
  DATA: [], window: {}, setTimeout: () => 0, clearTimeout: () => {}, console,
  apiCall: () => Promise.resolve({}), storeSet: () => {}, storeGet: () => null,
  goals: [], athleteProfile: { trainingDays: [1, 3, 5] },
});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x));
const plus = n => run(`(() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + ${n}); return localDateStr(d); })()`);

/* ---------- Entscheidung ---------- */

test("planBatchDaysLeft zählt die geplanten Kalendertage ab heute", () => {
  const today = "2026-11-17";
  assert.strictEqual(app.planBatchDaysLeft([], today), 0);
  assert.strictEqual(app.planBatchDaysLeft(["2026-11-10"], today), 0);
  assert.strictEqual(app.planBatchDaysLeft(["2026-11-17"], today), 1);
  assert.strictEqual(app.planBatchDaysLeft(["2026-11-18", "2026-11-23", "2026-11-20"], today), 7);
});

test("planAutoDecision: vorab als Sammelauftrag, sofort nur im Notfall", () => {
  const todayKey = "2026-11-17";
  const d = (daysLeft, job = null) => app.planAutoDecision({ daysLeft, job, todayKey });
  assert.strictEqual(d(9), null, "noch genug geplant");
  assert.strictEqual(d(6), null);
  assert.strictEqual(d(5), "batch", "5 Tage vorher: günstig vorbereiten");
  assert.strictEqual(d(2), "batch");
  assert.strictEqual(d(1), "now", "nur noch heute geplant: sofort");
  assert.strictEqual(d(0), "now", "gar nichts geplant: sofort");
  const pending = { state: "pending" };
  assert.strictEqual(d(4, pending), "wait", "Auftrag läuft: abwarten");
  assert.strictEqual(d(1, pending), "now", "Auftrag hängt zu lange: sofort");
  // Gescheiterte Aufträge: bis zu 2× am Tag neu versuchen, dann erst morgen wieder
  assert.strictEqual(d(4, { state: "failed", fails: 1, failDate: todayKey }), "batch");
  assert.strictEqual(d(4, { state: "failed", fails: 2, failDate: todayKey }), null);
  assert.strictEqual(d(4, { state: "failed", fails: 2, failDate: "2026-11-16" }), "batch");
  assert.strictEqual(d(1, { state: "failed", fails: 5, failDate: todayKey }), "now");
});

/* ---------- Ablauf mit gemocktem Server ---------- */

function setup({ plannedDays, job = null, claude = true, batch = { status: "pending" } }) {
  const store = new Map();
  if (job) store.set("triathlon_plan_batch_v1", job);
  const calls = { submit: 0, fetch: 0, generate: [] };
  app.storeGet = k => (store.has(k) ? store.get(k) : null);
  app.storeSet = (k, v) => store.set(k, v);
  app.__calls = calls;
  app.__batch = batch;
  app.__claude = claude;
  run(`
    goals = [{ id: "g1", name: "Ziel", sport: "Triathlon", date: "2099-06-01", isPrimary: true }];
    getPrimaryGoal = () => goals[0];
    ensureClaudeStatus = async () => ({});
    claudeAvailable = () => __claude;
    buildTrainingPlanPrompt = () => "PROMPT";
    submitClaudeBatch = async (prompt, opts) => { __calls.submit++; __calls.submitTask = opts.task; return "msgbatch_1"; };
    fetchClaudeBatch = async id => { __calls.fetch++; return __batch; };
    generateTrainingPlan = async (goalId, opts) => {
      __calls.generate.push(opts || null);
      // wie der echte Plan: die Tage des Fensters sind danach geplant
      const dates = (opts && opts.windowDates) || computePlanningWindow(goalId);
      replacePlannedWorkouts([...plannedWorkouts, ...dates.map((date, i) => ({ id: "neu" + date, date, sport: "Laufen", title: "Neu", duration_min: 40, status: "geplant", goalId }))]);
    };
    renderTrainingPlanCard = () => {}; renderCalendar = () => {};
  `);
  const list = [];
  for (let i = 0; i < plannedDays; i++) list.push({ id: "p" + i, date: plus(i), sport: "Rad", title: "Rad", duration_min: 60, status: "geplant", goalId: "g1" });
  run(`replacePlannedWorkouts(${JSON.stringify(list)})`);
  return { store, calls, job: () => store.get("triathlon_plan_batch_v1") };
}

test("runAutoPlan: bei 4 übrigen Tagen geht ein Sammelauftrag raus, der Plan wird nicht sofort erstellt", async () => {
  const s = setup({ plannedDays: 4 });
  await app.runAutoPlan({ force: true });
  assert.strictEqual(s.calls.submit, 1);
  assert.strictEqual(s.calls.submitTask, "planbatch");
  assert.strictEqual(s.calls.generate.length, 0);
  const job = plain(s.job());
  assert.strictEqual(job.state, "pending");
  assert.strictEqual(job.id, "msgbatch_1");
  assert.strictEqual(job.windowDates[0], plus(4), "die nächste Woche beginnt nach dem letzten geplanten Tag");
  assert.match(app.planBatchStatusText("g1"), /Sammelauftrag/);
});

test("runAutoPlan: fertiges Ergebnis wird mit der KI-Antwort eingebaut, ohne neue Anfrage", async () => {
  const windowDates = [4, 5, 6, 7, 8, 9, 10].map(plus);
  const s = setup({ plannedDays: 4, job: { state: "pending", id: "msgbatch_1", goalId: "g1", windowDates }, batch: { status: "done", text: "{\"workouts\":[]}" } });
  await app.runAutoPlan({ force: true });
  assert.strictEqual(s.calls.fetch, 1);
  assert.strictEqual(s.calls.generate.length, 1);
  assert.deepStrictEqual(plain(s.calls.generate[0]), { windowDates, firstRaw: "{\"workouts\":[]}" });
  assert.strictEqual(s.job(), null, "Auftrag ist erledigt");
});

test("runAutoPlan: überholtes Ergebnis (Tage inzwischen geplant) wird verworfen", async () => {
  // Fenster begann bei +2, inzwischen ist schon bis +4 geplant (z. B. per Knopf)
  const s = setup({ plannedDays: 7, job: { state: "pending", id: "msgbatch_1", goalId: "g1", windowDates: [plus(2), plus(3)] }, batch: { status: "done", text: "{}" } });
  await app.runAutoPlan({ force: true });
  assert.strictEqual(s.calls.generate.length, 0);
  assert.strictEqual(s.job(), null);
});

test("runAutoPlan: Auftrag läuft noch - warten; hängt er bis zum letzten Tag - sofort planen", async () => {
  const job = { state: "pending", id: "msgbatch_1", goalId: "g1", windowDates: [plus(4)] };
  let s = setup({ plannedDays: 4, job });
  await app.runAutoPlan({ force: true });
  assert.strictEqual(s.calls.generate.length, 0);
  assert.strictEqual(s.calls.submit, 0);
  assert.strictEqual(s.job().state, "pending");

  s = setup({ plannedDays: 1, job });
  await app.runAutoPlan({ force: true });
  assert.strictEqual(s.calls.generate.length, 1);
  assert.strictEqual(s.calls.generate[0], null, "normaler (sofortiger) Plan");
  assert.strictEqual(s.job(), null);
});

test("runAutoPlan: gescheiterter Auftrag wird gemerkt und später neu abgeschickt", async () => {
  const s = setup({ plannedDays: 4, job: { state: "pending", id: "msgbatch_1", goalId: "g1", windowDates: [plus(4)] }, batch: { status: "failed", error: "abgelaufen" } });
  await app.runAutoPlan({ force: true });
  // Fehler gemerkt und direkt ein neuer Auftrag abgeschickt
  assert.strictEqual(s.calls.submit, 1);
  assert.strictEqual(s.job().state, "pending");
});

test("runAutoPlan: Hauptziel gewechselt - alter Auftrag wird verworfen", async () => {
  const s = setup({ plannedDays: 9, job: { state: "pending", id: "alt", goalId: "anderes", windowDates: [plus(9)] } });
  await app.runAutoPlan({ force: true });
  assert.strictEqual(s.calls.fetch, 0);
  assert.strictEqual(s.job(), null);
});

test("runAutoPlan ohne Claude (lokale KI): wie bisher sofort, kein Sammelauftrag", async () => {
  let s = setup({ plannedDays: 4, claude: false });
  await app.runAutoPlan({ force: true });
  assert.strictEqual(s.calls.submit, 0);
  assert.strictEqual(s.calls.generate.length, 0, "4 Tage reichen der lokalen KI noch");
  s = setup({ plannedDays: 1, claude: false });
  await app.runAutoPlan({ force: true });
  assert.strictEqual(s.calls.generate.length, 1);
});

test("runAutoPlan: ohne Trainingstage im Profil passiert nichts", async () => {
  const s = setup({ plannedDays: 0 });
  run("athleteProfile.trainingDays = []");
  await app.runAutoPlan({ force: true });
  run("athleteProfile.trainingDays = [1, 3, 5]");
  assert.strictEqual(s.calls.submit + s.calls.generate.length, 0);
});

test("runAutoPlan: keiner da (Tab verdeckt oder 2 h nicht benutzt) - keine KI-Anfrage, kein Auftrag", async () => {
  const s = setup({ plannedDays: 0 });
  run("globalThis.userIsActive = () => false");
  await app.runAutoPlan({ force: true });
  assert.strictEqual(s.calls.submit + s.calls.generate.length, 0);
  run("globalThis.userIsActive = () => true");
  await app.runAutoPlan({ force: true });
  assert.strictEqual(s.calls.generate.length, 1, "sobald jemand da ist, wird nachgeholt");
  run("delete globalThis.userIsActive");
});
