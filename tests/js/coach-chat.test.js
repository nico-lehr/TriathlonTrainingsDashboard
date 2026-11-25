// Tests für den Chat mit dem Coach (js/ai/coach-chat.js) und das Markdown
// der Antworten (js/components/m-chat.js). Die KI ist gemockt.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const store = {};
const app = vm.createContext({
  ALL: [], DATA: [], plannedWorkouts: [], goals: [], window: {}, document: { addEventListener: () => {} },
  storeGet: k => (k in store ? JSON.parse(JSON.stringify(store[k])) : null), storeSet: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
  console,
});
["js/utils/dates.js", "js/utils/formatting.js", "js/ai/coach-chat.js", "js/components/m-chat.js"]
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x));

// Kein Kennzahlen-Kontext im Test - der Überblick muss trotzdem gehen.
run(`buildCompactContext = () => "KONTEXT: Form gut"; getPrimaryGoal = () => null;`);

function setup(aiAnswer) {
  run(`coachChats = []; globalThis.__prompts = [];
    callAiText = async (prompt, opts) => { __prompts.push({ prompt, opts }); return ${JSON.stringify(aiAnswer)}; };`);
}

test("Antwort lesen: JSON mit Vorschlag, Titel; kaputtes JSON -> Text ist die Antwort", () => {
  const r = plain(run(`parseCoachChatResponse('{"antwort":"Mach locker.","plan_aenderung":"2026-11-26: Laufen 40 min leicht statt Intervalle","titel":"Müde Beine"}')`));
  assert.deepStrictEqual(r, { answer: "Mach locker.", proposal: "2026-11-26: Laufen 40 min leicht statt Intervalle", title: "Müde Beine" });
  assert.strictEqual(run(`parseCoachChatResponse('{"antwort":"Ok","plan_aenderung":null}').proposal`), null);
  assert.strictEqual(run(`parseCoachChatResponse("Einfach nur Text").answer`), "Einfach nur Text");
});

test("Nachricht senden: Gespräch gespeichert, Titel von der KI, Überblick und Verlauf im Prompt", async () => {
  setup(JSON.stringify({ antwort: "Deine Woche war gut.", plan_aenderung: null, titel: "Trainingswoche" }));
  run(`plannedWorkouts = [{ id: "p1", date: todayStr(), sport: "Schwimmen", title: "Zugfrequenz-Test", duration_min: 35, intensity: "mittel", status: "geplant" }]`);
  const id = run("newCoachChat().id");
  await run(`sendCoachChatMessage("${id}", "Wie war meine Woche?")`);
  const chat = plain(run(`findCoachChat("${id}")`));
  assert.strictEqual(chat.title, "Trainingswoche");
  assert.deepStrictEqual(chat.messages.map(m => [m.role, m.text]), [["user", "Wie war meine Woche?"], ["coach", "Deine Woche war gut."]]);
  assert.strictEqual(store.triathlon_dashboard_coach_chats_v1.chats[0].messages.length, 2, "gespeichert");
  const p = run("__prompts[0]");
  assert.strictEqual(p.opts.task, "chat");
  assert.match(p.prompt, /KONTEXT: Form gut/);
  assert.match(p.prompt, /Zugfrequenz-Test/, "Plan der nächsten 14 Tage");
  assert.match(p.prompt, /Neue Nachricht des Athleten ==\nWie war meine Woche\?/);
  // Zweite Nachricht: die erste steht im Verlauf
  await run(`sendCoachChatMessage("${id}", "Und nächste Woche?")`);
  assert.match(run("__prompts[1].prompt"), /Athlet: Wie war meine Woche\?\n\nCoach: Deine Woche war gut\./);
});

test("Anhänge: gehen mit (auch bei späteren Nachrichten), Training mit Details", async () => {
  setup(JSON.stringify({ antwort: "Ok", plan_aenderung: null }));
  run(`ALL = [{ file: "f1", sport: "Laufen", _date: new Date(), date: todayStr(), distance_km: 10.2, duration_min: 52, avg_hr: 151, title: "Schwellenlauf" }];`);
  const att = plain(run(`buildCoachChatAttachment("workout", "f1")`));
  assert.match(att.label, /Laufen · Schwellenlauf/);
  assert.match(att.text, /10,2 km|10.2 km/);
  assert.match(att.text, /Ø HF 151/);
  assert.strictEqual(run(`buildCoachChatAttachment("workout", "gibtsnicht")`), null);
  const id = run("newCoachChat().id");
  await run(`sendCoachChatMessage("${id}", "Wie war der Lauf?", [buildCoachChatAttachment("workout", "f1")])`);
  await run(`sendCoachChatMessage("${id}", "Und im Vergleich?")`);
  assert.match(run("__prompts[1].prompt"), /Vom Athleten angehängt ==\n### Training .*Schwellenlauf/);
  assert.ok(plain(run(`buildCoachChatAttachment("wellness")`)).text.length > 0);
  assert.ok(plain(run(`buildCoachChatAttachment("plan")`)).label.includes("6 Wochen"));
});

test("KI-Fehler: Fehlermeldung im Gespräch, 'Nochmal versuchen' schickt dieselbe Nachricht", async () => {
  run(`coachChats = []; describeAiError = e => "Coach gerade nicht erreichbar."; callAiText = async () => { throw new Error("weg"); };`);
  const id = run("newCoachChat().id");
  await run(`sendCoachChatMessage("${id}", "Hallo?")`);
  assert.deepStrictEqual(plain(run(`findCoachChat("${id}").messages.map(m => [m.role, m.text, !!m.error])`)),
    [["user", "Hallo?", false], ["coach", "Coach gerade nicht erreichbar.", true]]);
  const saved = plain(run(`findCoachChat("${id}")`));
  setup(JSON.stringify({ antwort: "Jetzt geht's." }));
  run(`coachChats = [${JSON.stringify(saved)}]`);
  await run(`retryCoachChat("${id}")`);
  assert.deepStrictEqual(plain(run(`findCoachChat("${id}").messages.map(m => [m.role, m.text])`)), [["user", "Hallo?"], ["coach", "Jetzt geht's."]]);
  assert.doesNotMatch(run("__prompts[0].prompt"), /nicht erreichbar/, "Fehlertext nicht im Verlauf");
});

test("Vorschlag: erst mit 'Übernehmen' an den Planer, mit Rückgängig", async () => {
  setup(JSON.stringify({ antwort: "Ich würde morgen locker laufen.", plan_aenderung: "Morgen Laufen 40 min leicht statt Intervalle." }));
  run(`globalThis.__notes = []; globalThis.__undone = 0;
    replanFromCoachNote = async note => { __notes.push(note); return { reply: "Erledigt.", hints: ["Hinweis A"], undo: () => { __undone++; } }; };`);
  const id = run("newCoachChat().id");
  const reply = plain(await run(`sendCoachChatMessage("${id}", "Ich bin müde, was tun?")`));
  assert.deepStrictEqual(reply.proposal, { note: "Morgen Laufen 40 min leicht statt Intervalle.", state: "open" });
  assert.deepStrictEqual(plain(run("__notes")), [], "nichts ungefragt geändert");
  await run(`applyCoachChatProposal("${id}", "${reply.id}")`);
  assert.deepStrictEqual(plain(run("__notes")), ["Morgen Laufen 40 min leicht statt Intervalle."]);
  const p = plain(run(`findCoachChat("${id}").messages[1].proposal`));
  assert.strictEqual(p.state, "applied");
  assert.deepStrictEqual(p.hints, ["Hinweis A"]);
  run(`undoCoachChatProposal("${id}", "${reply.id}")`);
  assert.strictEqual(run("__undone"), 1);
  assert.strictEqual(run(`findCoachChat("${id}").messages[1].proposal.state`), "undone");
  // Der Status steht beim nächsten Mal im Verlauf
  await run(`sendCoachChatMessage("${id}", "Doch nicht.")`);
  assert.match(run("__prompts[1].prompt"), /wieder rückgängig gemacht/);
});

test("Vorschlag scheitert (z. B. Regeln): Fehler am Vorschlag, nochmal möglich", async () => {
  setup(JSON.stringify({ antwort: "x", plan_aenderung: "y" }));
  run(`replanFromCoachNote = async () => { throw new Error("Der neue Plan verstößt gegen Trainingsregeln."); };`);
  const id = run("newCoachChat().id");
  const reply = plain(await run(`sendCoachChatMessage("${id}", "z")`));
  await run(`applyCoachChatProposal("${id}", "${reply.id}")`);
  const p = plain(run(`findCoachChat("${id}").messages[1].proposal`));
  assert.strictEqual(p.state, "failed");
  assert.match(p.error, /Trainingsregeln/);
});

test("Gespeicherte Gespräche laden, Obergrenzen, löschen", () => {
  store.triathlon_dashboard_coach_chats_v1 = { chats: [{ id: "a", title: "A", updatedAt: "2026-11-01", messages: [{ id: "m", role: "coach", text: "x", proposal: { note: "n", state: "running" } }] }, { bad: true }] };
  run("loadCoachChats()");
  assert.strictEqual(run("coachChats.length"), 1);
  assert.strictEqual(run("coachChats[0].messages[0].proposal.state"), "open", "abgebrochenes Übernehmen wieder möglich");
  run(`for (let i = 0; i < 50; i++) coachChats.push({ id: "x" + i, title: "x", updatedAt: "2026-10-" + String(i % 28 + 1).padStart(2, "0"), messages: [] });
    saveCoachChats();`);
  assert.strictEqual(store.triathlon_dashboard_coach_chats_v1.chats.length, 40);
  assert.strictEqual(store.triathlon_dashboard_coach_chats_v1.chats[0].id, "a", "neuestes zuerst");
  run(`deleteCoachChat("a")`);
  assert.ok(!store.triathlon_dashboard_coach_chats_v1.chats.some(c => c.id === "a"));
});

test("Markdown der Antworten: Absätze, Listen, fett - und HTML wird nicht ausgeführt", () => {
  const html = run(`mChatMd("**Kurz:** gut.\\n\\n- eins\\n- zwei\\n1. erst\\n<img src=x onerror=alert(1)>")`);
  assert.strictEqual(html, "<p><b>Kurz:</b> gut.</p><ul><li>eins</li><li>zwei</li></ul><ol><li>erst</li></ol><p>&lt;img src=x onerror=alert(1)&gt;</p>");
});
