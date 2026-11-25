// Chat mit dem KI-Coach (Coach-Seite -> "Mit dem Coach chatten").
//
// Mehrere Gespräche, gespeichert wie alle anderen Daten (storeGet/storeSet,
// auf dem Server je Person). Bei jeder Nachricht bekommt die KI automatisch
// einen Überblick (Ziel, Profil, Form, Erholung, letzte 14 Tage, Plan der
// nächsten 14 Tage) - mehr hängt der Athlet bei Bedarf an (ein Training mit
// Runden, die letzten 3 Monate, Erholung 30 Tage, Plan 6 Wochen).
//
// Den Plan ändert der Chat nie selbst: Schlägt die KI eine Änderung vor,
// steht sie als "plan_aenderung" neben der Antwort. Erst der Knopf
// "Übernehmen" schickt sie an replanFromCoachNote (js/ai/ollama.js) - mit
// denselben Regeln, Hinweisen und "Rückgängig" wie "Sag dem Coach Bescheid".

const COACH_CHAT_KEY = "triathlon_dashboard_coach_chats_v1"; // { chats: [Gespräch] }
const COACH_CHAT_MAX_CHATS = 40;           // ältere fallen weg
const COACH_CHAT_MAX_MESSAGES = 120;       // je Gespräch
const COACH_CHAT_MSG_MAX = 4000;           // Zeichen je eigener Nachricht
const COACH_CHAT_HISTORY_CHARS = 24000;    // so viel vom bisherigen Gespräch geht mit
const COACH_CHAT_ATTACH_CHARS = 12000;     // je Anhang
const COACH_CHAT_ATTACH_TOTAL = 40000;     // alle Anhänge eines Gesprächs zusammen
const COACH_CHAT_KEEP_ATTACH = 5;          // nur die neuesten Gespräche behalten den Inhalt der Anhänge

// Gespräch: { id, title, createdAt, updatedAt, messages: [Nachricht] }
// Nachricht: { id, role: "user"|"coach", text, at,
//   attachments?: [{ kind, label, text }],          (nur user)
//   proposal?: { note, state: "open"|"applied"|"undone"|"failed", reply?, hints?, error? } (nur coach)
//   error?: true }                                  (Coach-Antwort fehlgeschlagen)
let coachChats = [];
// Rückgängig-Funktionen übernommener Vorschläge (nur solange die Seite offen ist)
const coachChatUndo = new Map();

function loadCoachChats() {
  const raw = typeof storeGet === "function" ? storeGet(COACH_CHAT_KEY) : null;
  coachChats = raw && Array.isArray(raw.chats) ? raw.chats.filter(c => c && c.id && Array.isArray(c.messages)) : [];
  // Ein Vorschlag, der beim Schließen gerade lief, ist nie fertig geworden.
  coachChats.forEach(c => c.messages.forEach(m => { if (m.proposal && m.proposal.state === "running") m.proposal.state = "open"; }));
}

function saveCoachChats() {
  coachChats.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  coachChats = coachChats.slice(0, COACH_CHAT_MAX_CHATS);
  coachChats.forEach((c, i) => {
    if (c.messages.length > COACH_CHAT_MAX_MESSAGES) c.messages = c.messages.slice(-COACH_CHAT_MAX_MESSAGES);
    // Ältere Gespräche: Anhänge nur noch mit Namen (die Ablage wird bei jeder
    // Änderung ganz übertragen - so bleibt sie klein).
    if (i >= COACH_CHAT_KEEP_ATTACH) c.messages.forEach(m => (m.attachments || []).forEach(a => { a.text = ""; }));
  });
  if (typeof storeSet === "function") storeSet(COACH_CHAT_KEY, { chats: coachChats });
}

const coachChatId = prefix => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function newCoachChat() {
  const now = new Date().toISOString();
  const chat = { id: coachChatId("c"), title: "Neues Gespräch", createdAt: now, updatedAt: now, messages: [] };
  coachChats.unshift(chat);
  return chat;
}

function findCoachChat(id) { return coachChats.find(c => c.id === id) || null; }

function deleteCoachChat(id) {
  coachChats = coachChats.filter(c => c.id !== id);
  saveCoachChats();
}

/* ---------- Daten für die KI ---------- */

const chatNum = (v, d = 0) => (typeof fmtNum === "function" ? fmtNum(v, d) : Number(v).toFixed(d));
const chatDay = key => {
  const d = new Date(key + "T12:00:00");
  return `${d.toLocaleDateString("de-DE", { weekday: "short" })} ${d.getDate()}.${d.getMonth() + 1}.`;
};
const chatAddDays = (key, n) => { const d = new Date(key + "T12:00:00"); d.setDate(d.getDate() + n); return localDateStr(d); };
const chatWorkoutName = w => {
  if (typeof workoutDisplayName === "function") return workoutDisplayName(w);
  const n = String((w && (w.title || w.name)) || "").trim();
  return n && n !== w.sport ? n.slice(0, 60) : "";
};
const chatWorkoutDay = w => (w._date ? localDateStr(w._date) : String(w.date || "").slice(0, 10));

// Eine Zeile je absolvierter Einheit (Datum, Sport, Name, Umfang, Puls, Load, RPE).
function chatWorkoutLine(w) {
  const bits = [chatDay(chatWorkoutDay(w)), w.sport];
  const name = chatWorkoutName(w);
  if (name) bits.push(`„${name}“`);
  if (w.distance_km != null) bits.push(w.sport === "Schwimmen" ? `${Math.round(w.distance_km * 1000).toLocaleString("de-DE")} m` : `${chatNum(w.distance_km, 1)} km`);
  if (w.duration_min != null) bits.push(`${Math.round(w.duration_min)} min`);
  if (w.pace_min_per_km) bits.push(`${w.pace_min_per_km} min/km`);
  else if (w.pace_min_per_100m) bits.push(`${w.pace_min_per_100m} min/100m`);
  else if (w.speed_kmh != null && w.sport === "Rad") bits.push(`${chatNum(w.speed_kmh, 1)} km/h`);
  if (w.avg_power_w != null) bits.push(`Ø ${Math.round(w.avg_power_w)} W`);
  if (w.avg_hr != null) bits.push(`Ø HF ${w.avg_hr}`);
  if (w.training_load != null) bits.push(`Load ${Math.round(w.training_load)}`);
  if (w.rpe != null) bits.push(`RPE ${chatNum(w.rpe, 0)}/10`);
  return `- ${bits.join(" · ")}`;
}

function chatWorkoutsSince(days) {
  const from = chatAddDays(todayStr(), -days);
  const all = typeof ALL !== "undefined" && ALL.length ? ALL : (typeof DATA !== "undefined" ? DATA : []);
  return all.filter(w => chatWorkoutDay(w) >= from).sort((a, b) => chatWorkoutDay(a).localeCompare(chatWorkoutDay(b)));
}

function chatPlanLine(p) {
  const bits = [chatDay(p.date), p.sport, p.title && p.title !== p.sport ? `„${p.title}“` : null,
    p.duration_min ? `${p.duration_min} min` : null, p.intensity || null,
    p.status && p.status !== "geplant" ? `(${p.status})` : null];
  const desc = p.description ? ` – ${String(p.description).replace(/\s+/g, " ").slice(0, 160)}` : "";
  return `- ${bits.filter(Boolean).join(" · ")}${desc}`;
}

function chatPlanLines(days) {
  const today = todayStr(), to = chatAddDays(today, days - 1);
  const list = (typeof plannedWorkouts !== "undefined" ? plannedWorkouts : [])
    .filter(p => p.date >= today && p.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  return list.length ? list.map(chatPlanLine) : ["- (nichts geplant)"];
}

// Der Überblick, den die KI bei jeder Nachricht automatisch bekommt.
function buildCoachChatOverview() {
  const out = [];
  const goal = typeof getPrimaryGoal === "function" ? getPrimaryGoal() : null;
  try { out.push(buildCompactContext(goal)); } catch (e) { /* ohne Kennzahlen weiter */ }
  try { if (typeof extraContextLines === "function") out.push(...extraContextLines()); } catch (e) { /* optional */ }
  const others = (typeof goals !== "undefined" ? goals : []).filter(g => g !== goal && g.date && g.date >= todayStr());
  if (others.length) out.push(`Weitere Ziele: ${others.map(g => `${g.name} (${g.sport}, ${g.date}${g.priority ? ", Priorität " + g.priority : ""})`).join(" | ")}`);
  const recent = chatWorkoutsSince(14);
  out.push(`Absolvierte Einheiten der letzten 14 Tage:\n${recent.length ? recent.map(chatWorkoutLine).join("\n") : "- (keine)"}`);
  out.push(`Geplante Einheiten der nächsten 14 Tage:\n${chatPlanLines(14).join("\n")}`);
  return out.filter(Boolean).join("\n");
}

/* ---------- Anhänge ---------- */

const COACH_CHAT_ATTACH_KINDS = [
  { kind: "workout", label: "Ein Training", hint: "mit Runden, Puls und deiner Notiz" },
  { kind: "history", label: "Training der letzten 3 Monate", hint: "jede Einheit eine Zeile" },
  { kind: "wellness", label: "Erholung der letzten 30 Tage", hint: "Schlaf, HRV, Ruhepuls, Stress je Tag" },
  { kind: "plan", label: "Plan der nächsten 6 Wochen", hint: "alle geplanten Einheiten" },
];

// Die letzten Trainings zur Auswahl für den Anhang "Ein Training".
function coachChatWorkoutChoices(max = 25) {
  return chatWorkoutsSince(120).reverse().slice(0, max);
}

function chatWorkoutDetail(w) {
  const lines = [];
  try {
    const comparable = typeof findComparableWorkouts === "function" ? findComparableWorkouts(w, workoutsBefore(w, ALL)) : [];
    if (comparable.length && typeof buildWorkoutAnalysisContext === "function") return buildWorkoutAnalysisContext(w, comparable);
  } catch (e) { /* einfache Fassung unten */ }
  lines.push(`Diese Einheit: ${chatWorkoutLine(w).slice(2)}`);
  if (typeof ctxLapsLine === "function") { const l = ctxLapsLine(w); if (l) lines.push(l); }
  const note = typeof getWorkoutNote === "function" ? getWorkoutNote(w.file) : null;
  if (note && note.note) lines.push(`Eigene Notiz: "${note.note}"`);
  return lines.join("\n");
}

function chatWellnessLines(days = 30) {
  const daily = typeof wellnessDaily === "function" ? wellnessDaily() : {};
  const from = chatAddDays(todayStr(), -(days - 1));
  const keys = Object.keys(daily).filter(k => k >= from && k <= todayStr()).sort();
  const rows = keys.map(k => {
    const d = daily[k] || {};
    const bits = [];
    if (typeof d.sleep_min === "number") bits.push(`Schlaf ${chatNum(d.sleep_min / 60, 1)} h${typeof d.sleep_score === "number" ? ` (Score ${Math.round(d.sleep_score)})` : ""}`);
    if (typeof d.hrv_ms === "number") bits.push(`HRV ${Math.round(d.hrv_ms)} ms`);
    if (typeof d.resting_hr === "number") bits.push(`Ruhepuls ${Math.round(d.resting_hr)}`);
    if (typeof d.stress_avg === "number") bits.push(`Stress ${Math.round(d.stress_avg)}`);
    if (typeof d.body_battery_high === "number") bits.push(`Body Battery max ${Math.round(d.body_battery_high)}`);
    if (typeof d.weight_kg === "number") bits.push(`Gewicht ${chatNum(d.weight_kg, 1)} kg`);
    return bits.length ? `- ${chatDay(k)}: ${bits.join(" · ")}` : null;
  }).filter(Boolean);
  return rows.length ? rows : ["- (keine Garmin-Erholungsdaten in diesem Zeitraum)"];
}

// Anhang bauen: { kind, label, text } - text ist das, was die KI liest.
function buildCoachChatAttachment(kind, ref) {
  let label = "", text = "";
  if (kind === "workout") {
    const w = (typeof ALL !== "undefined" ? ALL : []).find(x => String(x.file || x.id) === String(ref));
    if (!w) return null;
    label = `Training ${chatDay(chatWorkoutDay(w))} · ${w.sport}${chatWorkoutName(w) ? " · " + chatWorkoutName(w) : ""}`;
    text = chatWorkoutDetail(w);
  } else if (kind === "history") {
    const list = chatWorkoutsSince(91);
    label = `Training der letzten 3 Monate (${list.length} Einheiten)`;
    text = list.length ? list.map(chatWorkoutLine).join("\n") : "- (keine Einheiten)";
  } else if (kind === "wellness") {
    label = "Erholung der letzten 30 Tage";
    text = chatWellnessLines(30).join("\n");
  } else if (kind === "plan") {
    label = "Plan der nächsten 6 Wochen";
    text = chatPlanLines(42).join("\n");
  } else return null;
  return { kind, label, text: text.slice(0, COACH_CHAT_ATTACH_CHARS) };
}

/* ---------- Prompt und Antwort ---------- */

function buildCoachChatPrompt(chat) {
  const msgs = chat.messages.filter(m => !m.error);
  const last = msgs[msgs.length - 1];
  // Anhänge des ganzen Gesprächs (neueste zuerst bis zur Grenze), damit die
  // KI auch später noch weiß, worüber geredet wird.
  const attach = [];
  let attachChars = 0;
  [...msgs].reverse().forEach(m => (m.attachments || []).forEach(a => {
    if (!a.text) { attach.unshift(`### ${a.label}\n(Inhalt nicht mehr gespeichert - bei Bedarf neu anhängen lassen)`); return; }
    if (attachChars + a.text.length > COACH_CHAT_ATTACH_TOTAL) return;
    attachChars += a.text.length;
    attach.unshift(`### ${a.label}\n${a.text}`);
  }));
  // Bisheriges Gespräch: von hinten so viel wie passt
  const history = [];
  let chars = 0;
  for (let i = msgs.length - 2; i >= 0; i--) {
    const m = msgs[i];
    const line = `${m.role === "user" ? "Athlet" : "Coach"}: ${m.text}${m.proposal ? `\n(Vorschlag zur Planänderung: ${m.proposal.note} – Status: ${{ open: "noch nicht übernommen", applied: "übernommen", undone: "übernommen und wieder rückgängig gemacht", failed: "konnte nicht übernommen werden" }[m.proposal.state] || "offen"})` : ""}`;
    if (chars + line.length > COACH_CHAT_HISTORY_CHARS) { history.unshift("(ältere Nachrichten ausgelassen)"); break; }
    chars += line.length;
    history.unshift(line);
  }
  const today = todayStr();
  return `Du bist der persönliche Triathlon-Coach im Trainings-Dashboard dieses Athleten und führst mit ihm ein Gespräch. Heute ist ${new Date(today + "T12:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.

== Daten des Athleten (aktuell, automatisch) ==
${buildCoachChatOverview()}
${attach.length ? `\n== Vom Athleten angehängt ==\n${attach.join("\n\n")}\n` : ""}
== Bisheriges Gespräch ==
${history.length ? history.join("\n\n") : "(neues Gespräch)"}

== Neue Nachricht des Athleten ==
${last ? last.text : ""}

So antwortest du:
- Deutsch, du-Form, einfache Worte - auch Fachfremde sollen es verstehen. Fachbegriffe kurz erklären.
- Ehrlich und konkret: stütze dich auf die Daten oben und nenne die Zahlen, auf die du dich beziehst. Fehlen Daten, sag das und erfinde nichts; schlag ggf. vor, was der Athlet anhängen kann (ein Training, die letzten 3 Monate, Erholung 30 Tage, Plan 6 Wochen).
- Diskutiere auf Augenhöhe: Wenn der Athlet etwas vorhat, das du für ungünstig hältst, sag es mit Begründung - die Entscheidung bleibt seine.
- Bei Schmerzen, Verletzungen oder gesundheitlichen Warnzeichen: vorsichtig sein und zu Ärztin/Arzt bzw. Physiotherapie raten, keine Diagnosen.
- So lang wie nötig, so kurz wie möglich. Struktur nur mit einfachen Mitteln: Absätze, Listen mit "- ", **fett** für das Wichtigste.
- Du kannst den Trainingsplan NICHT selbst ändern. Möchte der Athlet eine Änderung (oder hast du eine empfohlen und er stimmt zu), schreib sie zusätzlich in "plan_aenderung": eine vollständige, eigenständige Anweisung an den Planer, so wie eine Nachricht "Sag dem Coach Bescheid" - mit Datum (JJJJ-MM-TT), Sportart, Titel, Dauer, Intensität, ggf. genauem Ablauf, und ob die Einheit zusätzlich ist oder etwas ersetzt. Der Athlet bekommt dafür einen Knopf "Übernehmen". Sonst "plan_aenderung": null. Ändere nichts ungefragt.
- "titel": 2-5 Wörter, worum es in diesem Gespräch geht.

Antwortformat: {"antwort":"...","plan_aenderung":null,"titel":"..."}`;
}

// Antwort der KI lesen. Kein gültiges JSON -> der ganze Text ist die Antwort.
function parseCoachChatResponse(raw) {
  const text = String(raw || "").trim();
  let data = null;
  try { const m = text.match(/\{[\s\S]*\}/); data = JSON.parse(m ? m[0] : text); } catch (e) { data = null; }
  if (!data || typeof data.antwort !== "string" || !data.antwort.trim()) {
    return { answer: text.replace(/^```(?:json)?|```$/g, "").trim(), proposal: null, title: null };
  }
  const prop = typeof data.plan_aenderung === "string" && data.plan_aenderung.trim() ? data.plan_aenderung.trim().slice(0, 2000) : null;
  const title = typeof data.titel === "string" && data.titel.trim() ? data.titel.trim().slice(0, 60) : null;
  return { answer: data.antwort.trim(), proposal: prop, title };
}

// Nachricht senden und auf die Antwort warten. Gibt die Antwort-Nachricht zurück.
async function sendCoachChatMessage(chatId, text, attachments = []) {
  const chat = findCoachChat(chatId);
  if (!chat) throw new Error("Gespräch nicht gefunden.");
  const clean = String(text || "").trim().slice(0, COACH_CHAT_MSG_MAX);
  if (!clean && !attachments.length) throw new Error("Schreib erst eine Nachricht.");
  const now = new Date().toISOString();
  chat.messages.push({ id: coachChatId("m"), role: "user", text: clean || "(siehe Anhang)", at: now, ...(attachments.length ? { attachments } : {}) });
  if (chat.messages.filter(m => m.role === "user").length === 1) chat.title = (clean || attachments[0].label).replace(/\s+/g, " ").slice(0, 40);
  chat.updatedAt = now;
  saveCoachChats();
  let reply;
  try {
    const raw = await callAiText(buildCoachChatPrompt(chat), { task: "chat", json: true });
    const res = parseCoachChatResponse(raw);
    reply = { id: coachChatId("m"), role: "coach", text: res.answer || "…", at: new Date().toISOString(),
      ...(res.proposal ? { proposal: { note: res.proposal, state: "open" } } : {}) };
    if (res.title && chat.messages.filter(m => m.role === "coach" && !m.error).length === 0) chat.title = res.title;
  } catch (e) {
    const msg = typeof describeAiError === "function" ? describeAiError(e) : (e.message || String(e));
    reply = { id: coachChatId("m"), role: "coach", text: msg, at: new Date().toISOString(), error: true };
  }
  chat.messages.push(reply);
  chat.updatedAt = reply.at;
  saveCoachChats();
  return reply;
}

// Fehlgeschlagene Antwort entfernen und die letzte Nachricht neu schicken.
async function retryCoachChat(chatId) {
  const chat = findCoachChat(chatId);
  if (!chat) return null;
  while (chat.messages.length && chat.messages[chat.messages.length - 1].error) chat.messages.pop();
  const last = chat.messages[chat.messages.length - 1];
  if (!last || last.role !== "user") return null;
  chat.messages.pop();
  return sendCoachChatMessage(chatId, last.text === "(siehe Anhang)" ? "" : last.text, last.attachments || []);
}

// "Übernehmen": Vorschlag an den Planer (wie "Sag dem Coach Bescheid").
async function applyCoachChatProposal(chatId, msgId) {
  const chat = findCoachChat(chatId);
  const msg = chat && chat.messages.find(m => m.id === msgId);
  if (!msg || !msg.proposal || msg.proposal.state === "running") return;
  msg.proposal.state = "running";
  try {
    const res = await replanFromCoachNote(msg.proposal.note);
    msg.proposal = { ...msg.proposal, state: "applied", reply: res.reply, hints: res.hints || [], error: null };
    if (res.undo) coachChatUndo.set(msgId, res.undo);
  } catch (e) {
    const plain = /Ziel|Schreib|Trainingsregeln/.test(e.message || "");
    msg.proposal = { ...msg.proposal, state: "failed", error: !plain && typeof describeAiError === "function" ? describeAiError(e) : (e.message || String(e)) };
  }
  chat.updatedAt = new Date().toISOString();
  saveCoachChats();
}

function undoCoachChatProposal(chatId, msgId) {
  const chat = findCoachChat(chatId);
  const msg = chat && chat.messages.find(m => m.id === msgId);
  const undo = coachChatUndo.get(msgId);
  if (!msg || !msg.proposal || !undo) return;
  undo();
  coachChatUndo.delete(msgId);
  msg.proposal.state = "undone";
  saveCoachChats();
}
