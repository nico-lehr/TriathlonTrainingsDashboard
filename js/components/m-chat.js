// Chat-Fenster "Frag den Coach" (Coach-Seite). Logik und Speichern:
// js/ai/coach-chat.js. Hier nur Anzeige und Bedienung:
//   - Karte auf der Coach-Seite (mChatCardHtml) mit den letzten Gesprächen
//   - Vollbild-Fenster (Handy) bzw. großes Fenster (Computer) mit
//     Gesprächsliste, Nachrichten, Anhängen und "Übernehmen" für Vorschläge.

const mChat = { open: false, view: "chat", chatId: null, draft: "", attachments: [], picker: null, sending: null };

const mChatEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Einfaches Markdown der KI: Absätze, Listen ("- ", "1. "), **fett**.
function mChatMd(text) {
  const inline = s => mChatEsc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  String(text || "").split("\n").forEach(raw => {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*•]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      if (list !== tag) { close(); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
    } else if (!line.trim()) close();
    else { close(); out.push(h ? `<p><b>${inline(h[1])}</b></p>` : `<p>${inline(line)}</p>`); }
  });
  close();
  return out.join("");
}

const mChatTime = iso => {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const today = typeof todayStr === "function" && localDateStr(d) === todayStr();
  return today ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
};

// Text ohne Markdown-Zeichen (für Vorschauen).
const mChatPlain = t => String(t || "").replace(/\*\*/g, "").replace(/^\s*(?:[-*•]|\d+[.)]|#{1,4})\s+/gm, "").replace(/\s+/g, " ").trim();

/* ---------- Karte auf der Coach-Seite ---------- */

function mChatCardHtml() {
  const recent = (typeof coachChats !== "undefined" ? coachChats : []).filter(c => c.messages.length).slice(0, 3);
  const rows = recent.map(c => {
    const last = c.messages[c.messages.length - 1];
    return `<button type="button" class="m-row" data-chat-open="${mChatEsc(c.id)}"><span class="m-chat-ic" aria-hidden="true">💬</span><span class="m-grow"><span class="m-row-title">${mChatEsc(c.title)}</span><span class="m-row-meta">${mChatEsc(mChatPlain(last.text).slice(0, 70))}</span></span><span class="m-row-meta">${mChatTime(c.updatedAt)}</span></button>`;
  }).join("");
  return `<section class="m-card"><div class="m-head"><h2>Frag den Coach</h2>${recent.length ? `<button type="button" class="m-link" data-chat-list>Alle</button>` : ""}</div>
    <p class="m-say small muted">Diskutiere mit dem KI-Coach. Er kennt deine Trainings, deine Erholung und deinen Plan – mehr kannst du anhängen.</p>
    ${rows ? `<div class="m-list">${rows}</div>` : ""}
    <div class="m-actions"><button type="button" class="m-btn primary wide" data-chat-new>Neues Gespräch</button></div></section>`;
}

/* ---------- Fenster ---------- */

function mChatOpen(chatId, view = "chat") {
  if (chatId === undefined || (view === "chat" && !chatId)) {
    // leeres Gespräch wiederverwenden statt immer neue anzulegen
    const empty = coachChats.find(c => !c.messages.length);
    chatId = (empty || newCoachChat()).id;
  }
  if (chatId !== mChat.chatId) { mChat.draft = ""; mChat.attachments = []; mChat.picker = null; }
  mChat.chatId = chatId;
  mChat.view = view;
  mChat.open = true;
  document.body.classList.add("m-sheet-open", "m-chat-open");
  mChatRender({ scroll: true });
}

function mChatClose() {
  mChat.open = false;
  const el = document.getElementById("m-chat");
  if (el) el.remove();
  document.body.classList.remove("m-sheet-open", "m-chat-open");
  // leere Gespräche nicht aufheben
  coachChats = coachChats.filter(c => c.messages.length);
  if (typeof renderMApp === "function") renderMApp();
}

function mChatListHtml() {
  const list = coachChats.filter(c => c.messages.length);
  if (!list.length) return `<p class="m-empty">Noch keine Gespräche.</p>`;
  return `<div class="m-list m-chat-list">${list.map(c => `<div class="m-chat-li"><button type="button" class="m-row" data-chat-open="${mChatEsc(c.id)}"><span class="m-grow"><span class="m-row-title">${mChatEsc(c.title)}</span><span class="m-row-meta">${c.messages.length} Nachrichten · ${mChatTime(c.updatedAt)}</span></span></button><button type="button" class="m-icon m-chat-del" data-chat-del="${mChatEsc(c.id)}" aria-label="Gespräch „${mChatEsc(c.title)}“ löschen" title="Löschen">🗑</button></div>`).join("")}</div>`;
}

const M_CHAT_EXAMPLES = [
  "Wie lief meine letzte Trainingswoche?",
  "Bin ich auf Kurs für mein Ziel?",
  "Wie erholt bin ich gerade?",
  "Was sollte ich nächste Woche anders machen?",
];

function mChatProposalHtml(m) {
  const p = m.proposal;
  const st = p.state;
  const busy = st === "running";
  let foot = "";
  if (st === "open" || st === "failed") foot = `<div class="m-actions"><button type="button" class="m-btn primary" data-chat-apply="${mChatEsc(m.id)}">Übernehmen</button></div>`;
  if (busy) foot = `<p class="m-say small muted">Coach trägt es ein …</p>`;
  if (st === "failed" && p.error) foot = `<p class="m-say small bad">${mChatEsc(p.error)}</p>` + foot;
  if (st === "applied") {
    foot = `<p class="m-say small good">✓ Übernommen. ${mChatEsc(p.reply || "")}</p>${(p.hints || []).map(h => `<p class="m-say small">${mChatEsc(h)}</p>`).join("")}`
      + (coachChatUndo.has(m.id) ? `<button type="button" class="m-link" data-chat-undo="${mChatEsc(m.id)}">Rückgängig</button>` : "");
  }
  if (st === "undone") foot = `<p class="m-say small muted">Übernommen und wieder rückgängig gemacht.</p>`;
  return `<div class="m-chat-prop"><div class="m-chat-prop-head">Vorschlag für deinen Plan</div><p>${mChatEsc(p.note)}</p>${foot}</div>`;
}

function mChatMessagesHtml(chat) {
  if (!chat.messages.length) {
    return `<div class="m-chat-empty"><p class="m-say">Worüber möchtest du reden? Ich kenne deine Trainings der letzten Wochen, deine Erholung und deinen Plan.</p>
      <div class="m-chat-examples">${M_CHAT_EXAMPLES.map(t => `<button type="button" class="m-chip" data-chat-example="${mChatEsc(t)}">${mChatEsc(t)}</button>`).join("")}</div></div>`;
  }
  const items = chat.messages.map((m, i) => {
    if (m.role === "user") {
      const att = (m.attachments || []).map(a => `<span class="m-chat-att">📎 ${mChatEsc(a.label)}</span>`).join("");
      return `<div class="m-chat-msg me"><div class="m-chat-bubble">${mChatEsc(m.text).replace(/\n/g, "<br>")}${att ? `<div class="m-chat-atts">${att}</div>` : ""}</div></div>`;
    }
    if (m.error) {
      const lastMsg = i === chat.messages.length - 1;
      return `<div class="m-chat-msg coach"><div class="m-chat-bubble err"><p>${mChatEsc(m.text)}</p>${lastMsg ? `<button type="button" class="m-link" data-chat-retry>Nochmal versuchen</button>` : ""}</div></div>`;
    }
    return `<div class="m-chat-msg coach"><div class="m-chat-bubble">${mChatMd(m.text)}${m.proposal ? mChatProposalHtml(m) : ""}</div></div>`;
  });
  if (mChat.sending === chat.id) items.push(`<div class="m-chat-msg coach"><div class="m-chat-bubble typing" aria-label="Coach schreibt"><i></i><i></i><i></i></div></div>`);
  return items.join("");
}

function mChatPickerHtml() {
  if (mChat.picker === "menu") {
    return `<div class="m-chat-picker" role="menu">${COACH_CHAT_ATTACH_KINDS.map(k => {
      const on = k.kind !== "workout" && mChat.attachments.some(a => a.kind === k.kind);
      return `<button type="button" class="m-row" data-chat-attach="${k.kind}"${on ? " disabled" : ""}><span class="m-grow"><span class="m-row-title">${mChatEsc(k.label)}</span><span class="m-row-meta">${on ? "schon angehängt" : mChatEsc(k.hint)}</span></span></button>`;
    }).join("")}</div>`;
  }
  if (mChat.picker === "workout") {
    const list = coachChatWorkoutChoices();
    return `<div class="m-chat-picker" role="menu"><button type="button" class="m-link" data-chat-attach-back>‹ Zurück</button>${list.length ? list.map(w => {
      const name = chatWorkoutName(w);
      const amount = w.distance_km != null ? (w.sport === "Schwimmen" ? `${Math.round(w.distance_km * 1000).toLocaleString("de-DE")} m` : `${chatNum(w.distance_km, 1)} km`) : w.duration_min ? `${Math.round(w.duration_min)} min` : "";
      return `<button type="button" class="m-row" data-chat-workout="${mChatEsc(String(w.file || w.id))}">${typeof mIcon === "function" ? mIcon(w.sport, "sm") : ""}<span class="m-grow"><span class="m-row-title">${mChatEsc(name || w.sport)}</span><span class="m-row-meta">${mChatEsc(chatDay(chatWorkoutDay(w)))}${amount ? " · " + mChatEsc(amount) : ""}</span></span></button>`;
    }).join("") : `<p class="m-empty">Keine Trainings in den letzten 4 Monaten.</p>`}</div>`;
  }
  return "";
}

function mChatRender({ scroll = false } = {}) {
  if (!mChat.open) return;
  let el = document.getElementById("m-chat");
  const prevScroll = el && el.querySelector(".m-chat-body");
  const atBottom = prevScroll ? prevScroll.scrollHeight - prevScroll.scrollTop - prevScroll.clientHeight < 60 : true;
  const keepTop = prevScroll ? prevScroll.scrollTop : 0;
  const ta = document.activeElement && document.activeElement.id === "m-chat-input" ? document.activeElement : null;
  const sel = ta ? [ta.selectionStart, ta.selectionEnd] : null;
  if (!el) {
    el = document.createElement("div");
    el.id = "m-chat";
    el.className = "m-chat-overlay";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Chat mit dem Coach");
    document.body.appendChild(el);
    mChatBind(el);
  }
  const chat = findCoachChat(mChat.chatId);
  const isList = mChat.view === "list" || !chat;
  const busy = chat && mChat.sending === chat.id;
  const head = `<div class="m-chat-head">
      <button type="button" class="m-icon" data-chat-close aria-label="Schließen">×</button>
      <div class="m-grow m-chat-title">${isList ? "Deine Gespräche" : mChatEsc(chat.messages.length ? chat.title : "Neues Gespräch")}</div>
      ${isList ? "" : `<button type="button" class="m-icon" data-chat-list aria-label="Alle Gespräche" title="Alle Gespräche">☰</button>`}
      <button type="button" class="m-icon" data-chat-new aria-label="Neues Gespräch" title="Neues Gespräch">＋</button>
    </div>`;
  if (isList) {
    el.innerHTML = `<div class="m-chat-panel">${head}<div class="m-chat-body">${mChatListHtml()}</div></div>`;
    return;
  }
  const chips = mChat.attachments.map((a, i) => `<span class="m-chat-chip">📎 ${mChatEsc(a.label)}<button type="button" data-chat-unattach="${i}" aria-label="Anhang entfernen">×</button></span>`).join("");
  el.innerHTML = `<div class="m-chat-panel">${head}
    <div class="m-chat-body" aria-live="polite">${mChatMessagesHtml(chat)}</div>
    <div class="m-chat-compose">
      ${mChatPickerHtml()}
      ${chips ? `<div class="m-chat-chips">${chips}</div>` : ""}
      <div class="m-chat-row">
        <button type="button" class="m-icon m-chat-plus${mChat.picker ? " on" : ""}" data-chat-picker aria-label="Daten anhängen" title="Daten anhängen">📎</button>
        <textarea id="m-chat-input" rows="1" maxlength="${COACH_CHAT_MSG_MAX}" placeholder="${busy ? "Coach schreibt …" : "Nachricht an den Coach"}">${mChatEsc(mChat.draft)}</textarea>
        <button type="button" class="m-btn primary m-chat-send" data-chat-send${busy ? " disabled" : ""} aria-label="Senden">➤</button>
      </div>
      <p class="m-chat-foot">${typeof currentAiProviderLabel === "function" ? mChatEsc(currentAiProviderLabel()) + " · " : ""}Plan-Änderungen nur mit „Übernehmen“.</p>
    </div></div>`;
  const body = el.querySelector(".m-chat-body");
  body.scrollTop = scroll || atBottom ? body.scrollHeight : keepTop;
  const input = el.querySelector("#m-chat-input");
  mChatGrow(input);
  if (sel) { input.focus(); input.setSelectionRange(sel[0], sel[1]); }
}

function mChatGrow(ta) {
  if (!ta) return;
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
}

async function mChatSend() {
  const chat = findCoachChat(mChat.chatId);
  if (!chat || mChat.sending) return;
  const text = mChat.draft.trim();
  if (!text && !mChat.attachments.length) return;
  const atts = mChat.attachments;
  mChat.draft = ""; mChat.attachments = []; mChat.picker = null;
  mChat.sending = chat.id;
  if (typeof mTrack === "function") mTrack("feature", "chat-send");
  const p = sendCoachChatMessage(chat.id, text, atts);
  mChatRender({ scroll: true });
  try { await p; } finally { mChat.sending = null; }
  mChatRender({ scroll: true });
}

function mChatBind(el) {
  el.addEventListener("click", async e => {
    const t = e.target.closest("button");
    if (!t) { if (e.target === el) mChatClose(); return; }
    const d = t.dataset;
    if ("chatClose" in d) mChatClose();
    else if ("chatNew" in d) mChatOpen(undefined);
    else if ("chatList" in d) { mChat.view = "list"; mChatRender(); }
    else if (d.chatOpen) mChatOpen(d.chatOpen);
    else if (d.chatDel) {
      const c = findCoachChat(d.chatDel);
      const q = `Gespräch „${c ? c.title : ""}“ löschen?`;
      const ok = typeof confirmDialog === "function" ? await confirmDialog(q, { okLabel: "Löschen" }) : window.confirm(q);
      if (ok === true) { deleteCoachChat(d.chatDel); if (mChat.chatId === d.chatDel) mChat.chatId = null; mChatRender(); }
    }
    else if (d.chatExample) { mChat.draft = d.chatExample; mChatSend(); }
    else if ("chatSend" in d) mChatSend();
    else if ("chatRetry" in d) {
      const chat = findCoachChat(mChat.chatId);
      if (!chat || mChat.sending) return;
      mChat.sending = chat.id;
      const p = retryCoachChat(chat.id);
      mChatRender({ scroll: true });
      try { await p; } finally { mChat.sending = null; }
      mChatRender({ scroll: true });
    }
    else if ("chatPicker" in d) { mChat.picker = mChat.picker ? null : "menu"; mChatRender(); }
    else if ("chatAttachBack" in d) { mChat.picker = "menu"; mChatRender(); }
    else if (d.chatAttach) {
      if (d.chatAttach === "workout") { mChat.picker = "workout"; mChatRender(); return; }
      const a = buildCoachChatAttachment(d.chatAttach);
      if (a) mChat.attachments.push(a);
      mChat.picker = null; mChatRender();
    }
    else if (d.chatWorkout) {
      const a = buildCoachChatAttachment("workout", d.chatWorkout);
      if (a && !mChat.attachments.some(x => x.label === a.label)) mChat.attachments.push(a);
      mChat.picker = null; mChatRender();
    }
    else if (d.chatUnattach != null) { mChat.attachments.splice(Number(d.chatUnattach), 1); mChatRender(); }
    else if (d.chatApply) {
      if (typeof mTrack === "function") mTrack("feature", "chat-apply");
      const p = applyCoachChatProposal(mChat.chatId, d.chatApply);
      mChatRender();
      await p;
      mChatRender();
      if (typeof mScheduleRender === "function") mScheduleRender();
    }
    else if (d.chatUndo) { undoCoachChatProposal(mChat.chatId, d.chatUndo); mChatRender(); }
  });
  el.addEventListener("input", e => {
    if (e.target.id === "m-chat-input") { mChat.draft = e.target.value; mChatGrow(e.target); }
  });
  el.addEventListener("keydown", e => {
    if (e.key === "Escape") { if (mChat.picker) { mChat.picker = null; mChatRender(); } else mChatClose(); return; }
    // Am Computer: Enter sendet, Shift+Enter = neue Zeile. Am Handy macht Enter eine neue Zeile.
    const fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    if (e.target.id === "m-chat-input" && e.key === "Enter" && !e.shiftKey && fine && !e.isComposing) { e.preventDefault(); mChatSend(); }
  });
}

// Klicks auf die Karte der Coach-Seite (m-app zeichnet sie, hier die Bedienung).
document.addEventListener("click", e => {
  const host = e.target.closest && e.target.closest("#m-app");
  if (!host) return;
  const t = e.target.closest("[data-chat-new],[data-chat-open],[data-chat-list]");
  if (!t) return;
  e.stopPropagation();
  if ("chatNew" in t.dataset) mChatOpen(undefined);
  else if (t.dataset.chatOpen) mChatOpen(t.dataset.chatOpen);
  else mChatOpen(mChat.chatId, "list");
}, true);
