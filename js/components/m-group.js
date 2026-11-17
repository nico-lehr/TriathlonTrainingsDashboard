// Bereich "Feed" in Graphit (zwei Unter-Reiter: Feed | Challenges):
// Highlights der anderen und Challenges,
// Emoji-Reaktionen, Beitreten/Austreten, Challenge anlegen.
// Daten und Server-Aufrufe: js/data/group.js (Server: backend/group.py).

const gUi = { name: null, picker: null, busy: false, notice: "", sub: "feed" };

const G_PALETTE = [
  ["#ff9f6e", "#f0605d"], ["#7fb2ff", "#5b6ff0"], ["#5fe0a0", "#2fae9b"],
  ["#d3a8ff", "#8f6cf0"], ["#ffd36e", "#f08a5d"], ["#6fdcf0", "#4c8df0"],
];
const G_SPORT_NAMES = { Laufen: "Laufen", Rad: "Rad", Schwimmen: "Schwimmen", alle: "Alle Sportarten" };
const G_KIND_NAMES = { group: "Gruppenziel", personal: "Persönliche Challenge", ranking: "Rangliste" };
const G_KIND_HINT = {
  group: "Alle sammeln zusammen in einen Topf.",
  personal: "Jede und jeder muss das Ziel selbst schaffen.",
  ranking: "Wer sammelt am meisten? Ohne festes Ziel.",
};
const G_KIND_SHORT = { group: "Gruppenziel", personal: "Persönlich", ranking: "Rangliste" };
const G_METRIC_NAMES = { km: "Kilometer", hours: "Stunden", sessions: "Einheiten" };

// Kleine Symbole (Strich, 24er Raster) - wie SF Symbols, nur selbst gezeichnet.
const G_ICON = {
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M15.2 14.2c2.6-.3 4.6 1.2 5.3 4.3"/>',
  stopwatch: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.8M10 3h4M12 3v3.5M18.2 7.3l1.3-1.3"/>',
  flame: '<path d="M12 21c3.6 0 6-2.5 6-6 0-3.6-2.6-5.4-3.6-8.8-.2-.6-.9-.7-1.2-.2-.9 1.4-1.1 3-1.2 4-1.2-.8-1.8-2.2-1.9-3.3-.1-.6-.8-.8-1.2-.3C7.4 8.5 6 11.3 6 15c0 3.5 2.4 6 6 6z"/><path d="M12 21c-1.7 0-2.8-1.2-2.8-2.8 0-1.8 1.5-2.7 2.8-4.4 1.3 1.7 2.8 2.6 2.8 4.4 0 1.6-1.1 2.8-2.8 2.8z"/>',
  medal: '<circle cx="12" cy="14.5" r="5.5"/><path d="M8.5 10.2 6 3.5h4l2 4M15.5 10.2 18 3.5h-4l-2 4M12 12.2l.8 1.6 1.7.2-1.3 1.2.3 1.7-1.5-.8-1.5.8.3-1.7-1.3-1.2 1.7-.2z"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5c4-2 6.5 2 11 0v8c-4.5 2-7-2-11 0"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5c0 2.8 1.4 4.3 3.7 4.5M16 6h3.5c0 2.8-1.4 4.3-3.7 4.5M12 13v3.5M8.5 20h7M9.5 20c0-1.8 1.1-3.5 2.5-3.5s2.5 1.7 2.5 3.5"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.6 14.2c.8 1.3 2 2 3.4 2s2.6-.7 3.4-2"/><circle cx="9.2" cy="10" r="1"/><circle cx="14.8" cy="10" r="1"/>',
  all: '<circle cx="6.5" cy="12" r="2.3"/><circle cx="12" cy="12" r="2.3"/><circle cx="17.5" cy="12" r="2.3"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
};
const gSvg = (name, cls = "") => `<svg class="g-svg ${cls}" viewBox="0 0 24 24" aria-hidden="true">${G_ICON[name]}</svg>`;

/* ------------------------------------------------------------ Hilfen */

function gColors(uid) {
  return G_PALETTE[Math.abs(Number(uid) || 0) % G_PALETTE.length];
}

function gInitials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || "?").slice(0, 2);
  return s.toUpperCase();
}

function gAvatar(uid, name, cls = "") {
  const [a, b] = gColors(uid);
  const text = cls.includes("xs") ? gInitials(name).charAt(0) : gInitials(name); // klein: ein Buchstabe, sonst zu eng
  return `<span class="g-av ${cls}" style="--g1:${a};--g2:${b}" title="${mEsc(name)}" aria-hidden="true">${mEsc(text)}</span>`;
}

function gGroupAvatar(cls = "") {
  return `<span class="g-av group ${cls}" aria-hidden="true">${gSvg("people")}</span>`;
}

function gStack(people, max = 4) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return `<span class="g-stack">${shown.map(p => gAvatar(p.uid, p.name, "xs")).join("")}${rest > 0 ? `<span class="g-av xs rest">+${rest}</span>` : ""}</span>`;
}

function gAgo(iso, now = new Date()) {
  const t = new Date(iso);
  const min = Math.round((now - t) / 60000);
  if (min < 1) return "Gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  const days = Math.round((mDay(now) - mDay(t)) / 86400000);
  if (days === 0) return `vor ${h} Std.`;
  if (days === 1) return "Gestern";
  if (days < 7) return `vor ${days} Tagen`;
  return t.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}

function gNum(v, metric) {
  if (metric === "sessions") return String(Math.round(v || 0));
  const d = (v || 0) >= 100 ? 0 : 1;
  return mNum(v || 0, d).replace(/,0$/, "");
}

function gUnit(metric, v) {
  if (metric === "km") return "km";
  if (metric === "hours") return "h";
  return Math.round(v) === 1 ? "Einheit" : "Einheiten";
}

const gValue = (v, metric) => `${gNum(v, metric)} ${gUnit(metric, v)}`;

function gSportTile(sport, cls = "") {
  if (sport === "alle") return `<span class="m-ic g-allsport ${cls}">${gSvg("all")}</span>`;
  return mIcon(sport, cls);
}

function gSportColor(sport) {
  return sport === "alle" ? "var(--m-accent)" : mSport(sport).color;
}

function gDateLabel(s, opts = { day: "numeric", month: "short" }) {
  return new Date(s + "T12:00:00").toLocaleDateString("de-DE", opts);
}

function gTimeLabel(c) {
  const today = mDay(new Date());
  const days = d => Math.round((mDay(new Date(d + "T12:00:00")) - today) / 86400000);
  if (c.status === "upcoming") { const n = days(c.start); return n === 1 ? "Startet morgen" : `Startet in ${n} Tagen`; }
  if (c.status === "ended") return `Beendet am ${gDateLabel(c.end)}`;
  const n = days(c.end);
  return n <= 0 ? "Endet heute" : n === 1 ? "Noch 1 Tag" : `Noch ${n} Tage`;
}

function gMe() {
  return groupState.data && groupState.data.me;
}

/* ------------------------------------------------------------ Challenges */

function gChallengeBody(c) {
  const color = gSportColor(c.sport);
  const me = gMe();
  if (c.kind === "group") {
    const pct = c.target ? Math.min(1, c.total / c.target) : 0;
    let acc = 0;
    const segs = c.members.filter(m => m.value > 0).map(m => {
      const w = c.target ? Math.min(100 - acc, (m.value / Math.max(c.target, c.total)) * 100) : 0;
      acc += w;
      const [a, b] = gColors(m.uid);
      return `<i style="width:${w.toFixed(2)}%;--g1:${a};--g2:${b}" title="${mEsc(m.name)}: ${mEsc(gValue(m.value, c.metric))}"></i>`;
    }).join("");
    const rows = c.members.slice(0, 5).map(m => `<li>${gAvatar(m.uid, m.name, "xs")}<span>${mEsc(m.uid === me.uid ? "Du" : m.name)}</span><b>${mEsc(gValue(m.value, c.metric))}</b></li>`).join("");
    return `<div class="g-big"><b>${mEsc(gNum(c.total, c.metric))}</b><span>von ${mEsc(gValue(c.target, c.metric))}</span><em style="color:${color}">${Math.round(pct * 100)} %</em></div>
      <div class="g-bar stacked" role="img" aria-label="${Math.round(pct * 100)} Prozent geschafft">${segs}</div>
      ${rows ? `<ul class="g-contrib">${rows}</ul>` : ""}`;
  }
  if (c.kind === "personal") {
    const mine = c.members.find(m => m.uid === me.uid);
    const ring = mine ? `<div class="g-ring">${mRing(Math.min(1, mine.value / c.target), color, mEsc(gNum(mine.value, c.metric)), `von ${mEsc(gNum(c.target, c.metric))}`, "sm")}<span>${mine.done ? "Geschafft" : "Du"}</span></div>` : "";
    const rows = c.members.map(m => {
      const p = Math.min(1, m.value / c.target);
      return `<li class="${m.done ? "done" : ""}">${gAvatar(m.uid, m.name, "xs")}<span class="g-pname">${mEsc(m.uid === me.uid ? "Du" : m.name)}</span>
        <span class="g-mini"><i style="width:${(p * 100).toFixed(1)}%;background:${m.done ? "var(--m-good)" : color}"></i></span>
        <b>${m.done ? gSvg("check", "ok") : mEsc(gNum(m.value, c.metric))}</b></li>`;
    }).join("");
    return `<div class="g-personal">${ring}<ul class="g-plist">${rows}</ul></div>
      <p class="g-goal">Ziel: ${mEsc(gValue(c.target, c.metric))} ${c.sport === "alle" ? "" : mEsc(G_SPORT_NAMES[c.sport]) + " "}bis ${mEsc(gDateLabel(c.end, { day: "numeric", month: "long" }))}</p>`;
  }
  const top = c.members.length ? c.members[0].value : 0;
  const rows = c.members.map((m, i) => `<li class="${m.uid === me.uid ? "me" : ""}"><span class="g-rank r${i + 1}">${i + 1}</span>${gAvatar(m.uid, m.name, "sm")}
      <span class="m-grow"><span class="g-rname">${mEsc(m.uid === me.uid ? "Du" : m.name)}</span><span class="g-mini wide"><i style="width:${top ? ((m.value / top) * 100).toFixed(1) : 0}%;background:${color}"></i></span></span>
      <b>${mEsc(gValue(m.value, c.metric))}</b></li>`).join("");
  return `<ol class="g-ranklist">${rows}</ol>`;
}

function gChallengeCard(c) {
  const done = c.completed && c.kind === "group";
  const head = `<div class="g-ch-head">${gSportTile(c.sport)}
      <span class="m-grow"><span class="g-ch-kind">${mEsc(G_KIND_SHORT[c.kind])} · ${mEsc(G_SPORT_NAMES[c.sport])}</span><b class="g-ch-title">${mEsc(c.title)}</b></span>
      ${done ? `<span class="g-done-chip">${gSvg("check")}Geschafft</span>` : ""}
      ${c.joined || c.can_delete ? `<button type="button" class="g-round" data-g-act="ch-menu" data-id="${c.id}" aria-label="Optionen">${gSvg("more")}</button>` : ""}</div>`;
  const foot = `<div class="g-ch-foot"><span>${mEsc(gTimeLabel(c))}</span><span class="g-who">${gStack(c.members)}${c.members.length} dabei</span></div>`;
  const join = !c.joined && c.status !== "ended" ? `<button type="button" class="m-btn primary wide g-join-btn" data-g-act="ch-join" data-id="${c.id}">Mitmachen</button>` : "";
  const body = c.members.length ? gChallengeBody(c) : `<p class="m-empty">Noch niemand dabei.</p>`;
  return `<section class="m-card g-ch${c.status === "ended" ? " ended" : ""}${c.joined ? "" : " open"}" style="--sc:${gSportColor(c.sport)}">${head}${c.status === "ended" || (c.joined && c.status === "running") ? body : gPreview(c)}${foot}${join}</section>`;
}

// Wer noch nicht mitmacht, sieht eine kurze Vorschau statt der Zahlen jedes Einzelnen.
function gPreview(c) {
  const what = c.kind === "ranking" ? `Meiste ${G_METRIC_NAMES[c.metric]}` : gValue(c.target, c.metric);
  return `<div class="g-preview"><span><small>${c.kind === "group" ? "Gemeinsames Ziel" : c.kind === "personal" ? (c.joined ? "Dein Ziel" : "Ziel je Person") : "Gewertet"}</small><b>${mEsc(what)}</b></span>
    <span><small>Zeitraum</small><b>${mEsc(gDateLabel(c.start))} – ${mEsc(gDateLabel(c.end))}</b></span></div>`;
}

/* ------------------------------------------------------------ Highlights */

// Lockere Sprüche über der Zahl - ohne Namen (der steht schon oben), damit sie
// auch bei eigenen Highlights passen. Welcher kommt, hängt fest an der ID.
const G_CHEERS = {
  pb: ["Schneller als je zuvor! 🚀", "Neuer Rekord! ⚡️", "Was für ein Tempo! 🔥", "Bestmarke geknackt! 🎯"],
  streak: ["Nicht zu stoppen! 🔥", "Dranbleiben zahlt sich aus! 💪", "Was für eine Disziplin! 🙌", "Die Serie lebt! ⚡️"],
  count: ["Meilenstein geknackt! 🎯", "Zeit zum Feiern! 🎉", "Training für Training! 💪", "Was für eine Leistung! 🙌"],
  challenge_done: ["Ziel erreicht! 🏁", "Challenge gemeistert! 💪", "Geschafft! 🎉"],
  challenge_win: ["Ganz oben auf dem Treppchen! 🏆", "Sieg! 🥇", "Die Nummer 1! 👑"],
  challenge_group: ["Gemeinsam geschafft! 🙌", "Starkes Team! 🤝", "Alle zusammen! 💪"],
};

function gCheer(h) {
  const list = G_CHEERS[h.kind] || ["Stark! 🎉"];
  return list[Math.abs(Number(h.id) || 0) % list.length];
}

// Was auf Medaille und Karte steht. medal.top = große Zeile in der Medaille
// (leer = nur das Symbol), medal.label = kleine Zeile darunter.
function gHighlightContent(h) {
  const d = h.data || {};
  const sportTxt = d.sport && d.sport !== "alle" ? " " + d.sport : "";
  if (h.kind === "pb") {
    const dist = d.meters >= 1000 ? `${d.meters / 1000} km` : `${d.meters} m`;
    return { kicker: "Neue Bestzeit", icon: "stopwatch", tone: d.sport === "Rad" ? "bike" : "run", medal: { top: dist, label: "Bestzeit" }, big: fmtDurationClock(d.value), sub: `Neue Bestzeit · ${dist} ${d.sport}` };
  }
  if (h.kind === "streak") return { kicker: "Serie", icon: "flame", tone: "flame", medal: { top: String(d.value), label: "Tage" }, big: `${d.value}-Tage-Serie`, sub: "am Stück nach Plan trainiert" };
  if (h.kind === "count") return { kicker: "Meilenstein", icon: "medal", tone: "gold", medal: { top: mNum(d.value, 0), label: d.value === 1 ? "Training" : "Trainings" }, big: `${mNum(d.value, 0)}. Training`, sub: "Meilenstein erreicht" };
  if (h.kind === "challenge_done") return { kicker: "Challenge geschafft", icon: "flag", tone: "good", medal: { top: "", label: "Geschafft" }, big: d.title, sub: `${gValue(d.value, d.metric)}${sportTxt} · Ziel ${gValue(d.target, d.metric)}` };
  if (h.kind === "challenge_win") return { kicker: "Platz 1", icon: "trophy", tone: "gold", medal: { top: "1", label: "Platz" }, big: d.title, sub: `Platz 1 mit ${gValue(d.value, d.metric)}${sportTxt}` };
  if (h.kind === "challenge_group") return { kicker: "Gruppenziel erreicht", icon: "people", tone: "accent", medal: { top: gNum(d.value, d.metric), label: gUnit(d.metric, d.value) }, big: d.title, sub: `Gruppenziel · ${gValue(d.value, d.metric)}${d.members ? ` · ${d.members} dabei` : ""}` };
  return { kicker: "Highlight", icon: "medal", tone: "gold", medal: { top: "", label: "Highlight" }, big: "", sub: "" };
}

function gMedal(c) {
  const m = c.medal;
  const size = m.top.length > 4 ? " long" : "";
  return `<span class="g-medal ${c.tone}" aria-hidden="true"><span class="g-medal-in${m.top ? "" : " icon-only"}">${gSvg(c.icon)}${m.top ? `<b class="${size.trim()}">${mEsc(m.top)}</b>` : ""}<small>${mEsc(m.label)}</small></span></span>`;
}

function gNamesLine(reactions, me) {
  const names = [...new Set(reactions.flatMap(r => r.names))].map(n => (n === me.display_name ? "Du" : n));
  if (!names.length) return "";
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  const text = rest > 0 ? `${shown.join(", ")} und ${rest} weitere` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} und ${shown[shown.length - 1]}` : shown[0];
  return `<p class="g-names">${mEsc(text)}</p>`;
}

function gHighlightCard(h) {
  const me = gMe();
  const c = gHighlightContent(h);
  const who = h.uid == null ? "Die Gruppe" : h.mine ? "Du" : h.name;
  const avatar = h.uid == null ? gGroupAvatar("md") : gAvatar(h.uid, h.name, "md");
  const pills = h.reactions.map(r => `<button type="button" class="g-pill${r.mine ? " on" : ""}" data-g-act="react" data-id="${h.id}" data-emoji="${r.emoji}"${h.mine ? " disabled" : ""} aria-pressed="${r.mine}" aria-label="${GROUP_REACTIONS[r.emoji] || ""} ${r.count}"><span>${GROUP_REACTIONS[r.emoji] || "?"}</span><b>${r.count}</b></button>`).join("");
  const open = gUi.picker === h.id;
  const picker = h.mine ? "" : `<button type="button" class="g-pill add${open ? " on" : ""}" data-g-act="picker" data-id="${h.id}" aria-label="Reagieren" aria-expanded="${open}">${gSvg("smile")}${gSvg("plus", "tiny")}</button>`;
  const tapback = open && !h.mine ? `<div class="g-tapback" role="group" aria-label="Reaktion wählen">${Object.entries(GROUP_REACTIONS).map(([k, e], i) => {
    const on = h.reactions.some(r => r.emoji === k && r.mine);
    return `<button type="button" class="${on ? "on" : ""}" style="animation-delay:${i * 30}ms" data-g-act="react" data-id="${h.id}" data-emoji="${k}" aria-pressed="${on}">${e}</button>`;
  }).join("")}</div>` : "";
  return `<article class="m-card g-hl ${c.tone}">
    <div class="g-hl-top">${avatar}<span class="m-grow"><b class="g-who-name">${mEsc(who)}</b><small class="g-when">${mEsc(gAgo(h.at))}</small></span>
      ${h.mine ? `<button type="button" class="g-round" data-g-act="hl-menu" data-id="${h.id}" aria-label="Optionen">${gSvg("more")}</button>` : ""}</div>
    <div class="g-hl-hero">${gMedal(c)}
      <p class="g-hl-cheer">${mEsc(gCheer(h))}</p><b class="g-hl-big">${mEsc(c.big)}</b><span class="g-hl-sub">${mEsc(c.sub)}</span></div>
    ${pills || picker ? `<div class="g-react">${pills}${picker}</div>` : ""}${tapback}
    ${gNamesLine(h.reactions, me)}
  </article>`;
}

/* ------------------------------------------------------------ Seite */

function gJoinHtml(d) {
  const count = d ? d.member_count : 0;
  const suggested = gUi.name != null ? gUi.name
    : (typeof athleteProfile !== "undefined" && athleteProfile.name) ? String(athleteProfile.name).split(/\s+/)[0]
    : (d && d.me.username) ? d.me.username.charAt(0).toUpperCase() + d.me.username.slice(1) : "";
  return mHeaderHtml("Gemeinsam trainieren", "Feed")
    + `<section class="m-card g-join">
      <div class="g-join-art" aria-hidden="true"><span class="g-badge flame">${gSvg("flame")}</span><span class="g-badge accent big">${gSvg("people")}</span><span class="g-badge gold">${gSvg("trophy")}</span></div>
      <h2 class="g-join-title">Motiviert euch gegenseitig</h2>
      <p class="g-join-text">Seht eure Erfolge, feuert euch mit Emojis an und startet gemeinsame Challenges.${count ? ` ${count === 1 ? "Eine Person macht" : `${count} Personen machen`} schon mit.` : ""}</p>
      <ul class="g-facts">
        <li><span class="g-fact ok">${gSvg("check")}</span><span><b>Das sehen die anderen</b><small>Abzeichen, Bestzeiten und Serien ab heute – und deine Summe in Challenges, bei denen du mitmachst.</small></span></li>
        <li><span class="g-fact no">${gSvg("lock")}</span><span><b>Das bleibt privat</b><small>Einzelne Trainings, Puls, Tempo, Strecken, Gewicht, Schlaf und Notizen.</small></span></li>
      </ul>
      <label class="g-field"><span>Dein Name im Feed</span><input id="g-name" type="text" maxlength="30" autocomplete="nickname" value="${mEsc(suggested)}" placeholder="z. B. Anna"></label>
      ${gUi.notice ? `<p class="m-say bad">${mEsc(gUi.notice)}</p>` : ""}
      <button type="button" class="m-btn primary wide" data-g-act="join"${gUi.busy ? " disabled" : ""}>${gUi.busy ? "Einen Moment …" : "Mitmachen"}</button>
      <p class="g-fine">Du kannst jederzeit austreten – dann wird alles gelöscht, was du geteilt hast.</p>
    </section>`;
}

function mRenderGruppe() {
  loadGroup();
  const d = groupState.data;
  if (!d) {
    const msg = groupState.error ? `<p class="m-say bad">${mEsc(groupState.error)}</p><div class="m-actions"><button type="button" class="m-btn soft" data-g-act="reload">Erneut versuchen</button></div>` : `<p class="m-empty">Lädt …</p>`;
    return mHeaderHtml("Gemeinsam trainieren", "Feed") + `<section class="m-card">${msg}</section>`;
  }
  if (!d.me.joined) return gJoinHtml(d);

  const members = d.members || [];
  const right = `<button type="button" class="g-head-people" data-g-act="settings" aria-label="Mitglieder und Einstellungen">${gStack(members, 5)}<span class="g-round sm">${gSvg("more")}</span></button>`;
  const active = d.challenges.filter(c => c.status !== "ended");
  const ended = d.challenges.filter(c => c.status === "ended");
  const openCount = active.filter(c => !c.joined).length;
  const tab = (key, label, badge) => `<button type="button" class="${gUi.sub === key ? "on" : ""}" data-g-act="sub" data-v="${key}" role="tab" aria-selected="${gUi.sub === key}">${label}${badge ? `<i class="g-badge-num" aria-label="${badge} neu zum Mitmachen">${badge}</i>` : ""}</button>`;
  const seg = `<div class="m-subseg" role="tablist" aria-label="Feed">${tab("feed", "Feed")}${tab("challenges", "Challenges", openCount)}</div>`;
  const err = groupState.error ? `<p class="m-say bad g-err">${mEsc(groupState.error)}</p>` : "";
  const head = mHeaderHtml(`${members.length} ${members.length === 1 ? "Mitglied" : "Mitglieder"}`, "Feed", right) + seg + err;

  if (gUi.sub === "challenges") {
    // Laufende, bei denen man dabei ist, zuerst; dann die zum Mitmachen; dann geplante.
    const order = c => (c.status === "running" ? 0 : 2) + (c.joined ? 0 : 1);
    active.sort((a, b) => order(a) - order(b));
    const newBtn = `<button type="button" class="m-card g-newch" data-g-act="ch-new"><span class="g-newch-ic">${gSvg("plus")}</span><span class="m-grow"><b>Neue Challenge</b><small>Gruppenziel, persönlich oder Rangliste</small></span><i>›</i></button>`;
    const empty = `<section class="m-card g-emptycard"><span class="g-badge accent">${gSvg("flag")}</span><b>Noch keine Challenge</b><p>Starte eine – zum Beispiel „500 km Rad im Dezember“ – und die anderen können mitmachen.</p></section>`;
    const list = active.length ? `<div class="g-chlist">${active.map(gChallengeCard).join("")}</div>` : empty;
    const old = ended.length ? `<div class="g-sec small"><h2>Kürzlich beendet</h2></div><div class="g-chlist">${ended.map(gChallengeCard).join("")}</div>` : "";
    return head + newBtn + list + old;
  }
  const feed = d.highlights.length ? d.highlights.map(gHighlightCard).join("")
    : `<section class="m-card g-emptycard"><span class="g-badge gold">${gSvg("medal")}</span><b>Noch keine Highlights</b><p>Hier erscheinen neue Bestzeiten, Serien und geschaffte Challenges – von dir und den anderen.</p></section>`;
  return head + `<div class="g-feed">${feed}</div>`;
}

/* ------------------------------------------------------------ Fenster */

function gSheet(label, drawFn, onClick) {
  document.querySelectorAll(".m-sheet-overlay").forEach(el => el.remove());
  const overlay = document.createElement("div");
  overlay.className = "m-sheet-overlay g-sheet";
  overlay.innerHTML = `<div class="m-sheet" role="dialog" aria-modal="true" aria-label="${mEsc(label)}">
      <div class="m-sheet-bar"><span class="m-sheet-grab" aria-hidden="true"></span><button type="button" class="m-icon m-sheet-close" aria-label="Schließen">×</button></div>
      <div class="m-sheet-body"></div></div>`;
  document.body.appendChild(overlay);
  document.body.classList.add("m-sheet-open");
  const body = overlay.querySelector(".m-sheet-body");
  const close = () => {
    overlay.classList.remove("is-open");
    document.body.classList.remove("m-sheet-open");
    setTimeout(() => overlay.remove(), 250);
  };
  const draw = () => { body.innerHTML = drawFn(); };
  draw();
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  overlay.addEventListener("click", e => {
    if (e.target === overlay || e.target.closest(".m-sheet-close")) { close(); return; }
    onClick(e, { close, draw, body });
  });
  document.addEventListener("keydown", function onKey(e) {
    if (!overlay.isConnected) { document.removeEventListener("keydown", onKey); return; }
    if (e.key === "Escape") close();
  });
  return { close, draw, body, overlay };
}

// Kleines Aktionsmenü (wie ein iOS-Aktionsblatt).
function gActionSheet(title, subtitle, actions) {
  let confirm = null;
  gSheet(title, () => `<div class="g-as-head"><b>${mEsc(title)}</b>${subtitle ? `<small>${mEsc(subtitle)}</small>` : ""}</div>
    <div class="g-as">${actions.map((a, i) => `<button type="button" class="${a.danger ? "danger" : ""}" data-i="${i}">${mEsc(confirm === i ? a.confirm : a.label)}</button>`).join("")}</div>`,
  async (e, sh) => {
    const btn = e.target.closest("[data-i]");
    if (!btn) return;
    const i = Number(btn.dataset.i);
    const a = actions[i];
    if (a.confirm && confirm !== i) { confirm = i; sh.draw(); return; }
    sh.close();
    try { await a.run(); } catch (err) { groupState.error = err.message || String(err); }
    mScheduleRender();
  });
}

function gOpenSettings() {
  const d = groupState.data;
  let name = d.me.display_name;
  let msg = "", leaving = false;
  const sh = gSheet("Mitglieder", () => `<div class="g-as-head left"><b class="m-sh-title">Mitglieder</b><small>${d.members.length} ${d.members.length === 1 ? "Mitglied" : "Mitglieder"}</small></div>
      <div class="g-memberlist">${d.members.map(m => `<span>${gAvatar(m.uid, m.name, "md")}<small>${mEsc(m.uid === d.me.uid ? "Du" : m.name)}</small></span>`).join("")}</div>
      <label class="g-field"><span>Dein Name im Feed</span><input id="g-set-name" type="text" maxlength="30" value="${mEsc(name)}"></label>
      ${msg ? `<p class="m-say small">${mEsc(msg)}</p>` : ""}
      <button type="button" class="m-btn soft wide" data-s="save">Namen speichern</button>
      <ul class="g-facts compact">
        <li><span class="g-fact ok">${gSvg("check")}</span><span><b>Geteilt</b><small>Abzeichen, Bestzeiten, Serien und deine Summe in Challenges, bei denen du mitmachst.</small></span></li>
        <li><span class="g-fact no">${gSvg("lock")}</span><span><b>Privat</b><small>Einzelne Trainings, Puls, Tempo, Strecken, Gewicht, Schlaf und Notizen.</small></span></li>
      </ul>
      <div class="g-as"><button type="button" class="danger" data-s="leave">${leaving ? "Wirklich austreten? Alles wird gelöscht" : "Aus dem Feed austreten"}</button></div>`,
  async (e, s) => {
    const btn = e.target.closest("[data-s]");
    if (!btn) return;
    if (btn.dataset.s === "save") {
      name = (s.body.querySelector("#g-set-name").value || "").trim();
      try { await groupJoin(name); msg = "Gespeichert."; } catch (err) { msg = err.message || String(err); }
      s.draw();
    } else if (btn.dataset.s === "leave") {
      if (!leaving) { leaving = true; s.draw(); return; }
      s.close();
      try { await groupLeave(); gUi.name = null; } catch (err) { groupState.error = err.message || String(err); }
      mScheduleRender();
    }
  });
  sh.body.addEventListener("input", e => { if (e.target.id === "g-set-name") name = e.target.value; });
}

function gChallengeMenu(id) {
  const c = groupState.data.challenges.find(x => x.id === id);
  if (!c) return;
  const actions = [];
  if (c.joined) actions.push({ label: "Aussteigen", confirm: "Wirklich aussteigen?", danger: true, run: () => groupJoinChallenge(id, false) });
  if (c.can_delete) actions.push({ label: "Challenge löschen", confirm: "Wirklich für alle löschen?", danger: true, run: () => groupDeleteChallenge(id) });
  gActionSheet(c.title, `${G_KIND_NAMES[c.kind]}${c.creator ? ` · gestartet von ${c.creator}` : ""}`, actions);
}

function gHighlightMenu(id) {
  const h = groupState.data.highlights.find(x => x.id === id);
  if (!h) return;
  gActionSheet(gHighlightContent(h).kicker, h.mine ? "Nur aus dem Feed – dein Abzeichen bleibt." : `von ${h.name}`,
    [{ label: "Highlight löschen", confirm: "Wirklich löschen?", danger: true, run: () => groupDeleteHighlight(id) }]);
}

/* ---------------- Challenge anlegen */

function gIsoDay(d) { return localDateStr(d); }

function gPeriod(key) {
  const today = mDay(new Date());
  if (key === "week") return [today, mAddDays(mMonday(today), 6)];
  if (key === "month") return [new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 0)];
  if (key === "4w") return [today, mAddDays(today, 27)];
  if (key === "nextmonth") return [new Date(today.getFullYear(), today.getMonth() + 1, 1), new Date(today.getFullYear(), today.getMonth() + 2, 0)];
  return null;
}

// Vorschlag für den Namen, falls man selbst keinen einträgt: "500 km Rad im Dezember", "Schwimm-Duell".
function gSuggestTitle(f) {
  if (f.kind === "ranking") return { Laufen: "Lauf-Duell", Rad: "Rad-Duell", Schwimmen: "Schwimm-Duell", alle: "Trainings-Duell" }[f.sport];
  const t = Number(String(f.target).replace(",", "."));
  const what = t > 0 ? gValue(t, f.metric) : G_METRIC_NAMES[f.metric];
  const sport = f.sport === "alle" ? "" : ` ${f.sport}`;
  const month = f.period === "month" || f.period === "nextmonth" ? ` im ${gDateLabel(f.start, { month: "long" })}` : f.period === "week" ? " diese Woche" : "";
  return `${what}${sport}${month}`;
}

function gCreateHtml(f, err) {
  const seg = (field, opts) => `<div class="g-seg" role="radiogroup">${opts.map(([v, l, dis]) =>
    `<button type="button" role="radio" aria-checked="${f[field] === v}" class="${f[field] === v ? "on" : ""}" data-f="${field}" data-v="${v}"${dis ? " disabled" : ""}>${l}</button>`).join("")}</div>`;
  const sports = [["Laufen", "Laufen"], ["Rad", "Rad"], ["Schwimmen", "Schwimmen"], ["alle", "Alle"]];
  const sportBtns = `<div class="g-sports">${sports.map(([v, l]) => `<button type="button" class="${f.sport === v ? "on" : ""}" style="--sc:${gSportColor(v)}" data-f="sport" data-v="${v}">${gSportTile(v, "sm")}<span>${l}</span></button>`).join("")}</div>`;
  const periods = [["week", "Diese Woche"], ["month", "Dieser Monat"], ["4w", "4 Wochen"], ["nextmonth", "Nächster Monat"], ["custom", "Eigener"]];
  const perBtns = `<div class="g-chips">${periods.map(([v, l]) => `<button type="button" class="${f.period === v ? "on" : ""}" data-f="period" data-v="${v}">${l}</button>`).join("")}</div>`;
  const custom = f.period === "custom" ? `<div class="g-dates"><label class="g-field"><span>Von</span><input type="date" data-in="start" value="${f.start}"></label><label class="g-field"><span>Bis</span><input type="date" data-in="end" value="${f.end}"></label></div>` : "";
  const unit = f.metric === "km" ? "km" : f.metric === "hours" ? "Stunden" : "Einheiten";
  const target = f.kind === "ranking" ? "" : `<label class="g-field"><span>${f.kind === "group" ? "Gemeinsames Ziel" : "Ziel für jede Person"}</span><span class="g-numwrap"><input type="number" inputmode="decimal" min="1" step="${f.metric === "sessions" ? 1 : 0.5}" data-in="target" value="${f.target}" placeholder="z. B. ${f.metric === "km" ? 500 : f.metric === "hours" ? 20 : 12}"><em>${unit}</em></span></label>`;
  return `<div class="g-as-head left"><b class="m-sh-title">Neue Challenge</b><small>Gezählt werden die Trainings von Garmin – automatisch.</small></div>
    <div class="g-form">
      <div class="g-step"><span class="g-lbl">Art</span>${seg("kind", [["group", "Gruppenziel"], ["personal", "Persönlich"], ["ranking", "Rangliste"]])}<small class="g-hint">${G_KIND_HINT[f.kind]}</small></div>
      <div class="g-step"><span class="g-lbl">Sportart</span>${sportBtns}</div>
      <div class="g-step"><span class="g-lbl">Gezählt werden</span>${seg("metric", [["km", "Kilometer", f.sport === "alle"], ["hours", "Stunden"], ["sessions", "Einheiten"]])}${f.sport === "alle" ? `<small class="g-hint">Kilometer gibt es nur für eine Sportart.</small>` : f.kind === "ranking" && f.metric === "km" ? `<small class="g-hint">Tipp: Mit Stunden oder Einheiten ist es fairer.</small>` : ""}</div>
      <div class="g-step"><span class="g-lbl">Zeitraum</span>${perBtns}${custom}</div>
      ${target ? `<div class="g-step">${target}</div>` : ""}
      <div class="g-step"><label class="g-field"><span>Name</span><input type="text" maxlength="60" data-in="title" value="${mEsc(f.title)}" placeholder="${mEsc(gSuggestTitle(f))}"></label></div>
    </div>
    <div class="g-summary-slot">${gSummaryHtml(f)}</div>
    ${err ? `<p class="m-say bad">${mEsc(err)}</p>` : ""}
    <button type="button" class="m-btn primary wide" data-f="create"${f.busy ? " disabled" : ""}>${f.busy ? "Wird gestartet …" : "Challenge starten"}</button>`;
}

// Der Satz unter dem Formular: was die Challenge in Worten bedeutet.
function gSummaryHtml(f) {
  const sentence = (() => {
    const per = `${gDateLabel(f.start)} – ${gDateLabel(f.end)}`;
    const sp = f.sport === "alle" ? "in allen Sportarten" : f.sport === "Rad" ? "auf dem Rad" : f.sport === "Laufen" ? "beim Laufen" : "beim Schwimmen";
    const t = Number(String(f.target).replace(",", "."));
    if (f.kind === "ranking") return `Wer sammelt ${per} die meisten ${G_METRIC_NAMES[f.metric]} ${sp}?`;
    if (!(t > 0)) return "";
    return f.kind === "group" ? `Ihr sammelt zusammen ${gValue(t, f.metric)} ${sp} · ${per}` : `Jede Person schafft ${gValue(t, f.metric)} ${sp} · ${per}`;
  })();
  return sentence ? `<div class="g-summary" style="--sc:${gSportColor(f.sport)}">${gSportTile(f.sport, "sm")}<span>${mEsc(sentence)}</span></div>` : "";
}

function gOpenCreate() {
  const [s, e] = gPeriod("month");
  const f = { kind: "group", sport: "Rad", metric: "km", period: "month", start: gIsoDay(s), end: gIsoDay(e), target: "", title: "", busy: false };
  let err = "";
  const sh = gSheet("Neue Challenge", () => gCreateHtml(f, err), async (ev, s2) => {
    const btn = ev.target.closest("[data-f]");
    if (!btn || btn.disabled) return;
    const field = btn.dataset.f;
    if (field === "create") {
      const target = Number(String(f.target).replace(",", "."));
      const body = { title: (f.title || gSuggestTitle(f)).trim(), kind: f.kind, sport: f.sport, metric: f.metric, start: f.start, end: f.end, target: f.kind === "ranking" ? null : target };
      if (f.kind !== "ranking" && !(target > 0)) { err = "Bitte ein Ziel eintragen."; s2.draw(); return; }
      f.busy = true; err = ""; s2.draw();
      try {
        await groupCreateChallenge(body);
        if (typeof mTrack === "function") mTrack("feature", "challenge-new");
        s2.close();
        mScheduleRender();
      } catch (e2) { err = e2.message || String(e2); f.busy = false; s2.draw(); }
      return;
    }
    f[field] = btn.dataset.v;
    if (field === "sport" && f.sport === "alle" && f.metric === "km") f.metric = "hours";
    if (field === "period" && f.period !== "custom") { const [a, b] = gPeriod(f.period); f.start = gIsoDay(a); f.end = gIsoDay(b); }
    err = "";
    s2.draw();
  });
  sh.body.addEventListener("input", ev => {
    const k = ev.target.dataset.in;
    if (!k) return;
    f[k] = ev.target.value;
    // Nur den Satz unten auffrischen - das Eingabefeld bleibt, wie es ist.
    const slot = sh.body.querySelector(".g-summary-slot");
    if (slot) slot.innerHTML = gSummaryHtml(f);
    const title = sh.body.querySelector('[data-in="title"]');
    if (title && k !== "title") title.placeholder = gSuggestTitle(f);
  });
}

/* ------------------------------------------------------------ Bedienung */

async function gAction(btn) {
  const act = btn.dataset.gAct;
  const id = Number(btn.dataset.id);
  if (act === "reload") { loadGroup(true); return; }
  if (act === "join") {
    const input = document.getElementById("g-name");
    const name = (input ? input.value : gUi.name || "").trim();
    if (!name) { gUi.notice = "Bitte gib einen Namen ein."; renderMApp(); return; }
    gUi.busy = true; gUi.notice = ""; renderMApp();
    try {
      await groupJoin(name);
      if (typeof mTrack === "function") mTrack("feature", "group-join");
      mState.anim = true;
    } catch (e) { gUi.notice = e.message || String(e); }
    gUi.busy = false;
    renderMApp();
  } else if (act === "picker") {
    gUi.picker = gUi.picker === id ? null : id;
    renderMApp();
  } else if (act === "react") {
    gUi.picker = null;
    if (typeof mTrack === "function") mTrack("feature", "group-react");
    groupToggleReaction(id, btn.dataset.emoji);
  } else if (act === "hl-menu") gHighlightMenu(id);
  else if (act === "ch-menu") gChallengeMenu(id);
  else if (act === "ch-new") gOpenCreate();
  else if (act === "sub") {
    if (gUi.sub !== btn.dataset.v) { gUi.sub = btn.dataset.v; gUi.picker = null; mState.anim = true; renderMApp(); window.scrollTo({ top: 0 }); }
  }
  else if (act === "settings") gOpenSettings();
  else if (act === "ch-join") {
    btn.disabled = true;
    try { await groupJoinChallenge(id, true); } catch (e) { groupState.error = e.message || String(e); renderMApp(); }
  }
}

function initGroupUi() {
  const host = document.getElementById("m-app");
  if (!host) return;
  host.addEventListener("click", e => {
    const btn = e.target.closest("[data-g-act]");
    if (btn && !btn.disabled) { gAction(btn); return; }
    // Tipp daneben schließt die Emoji-Auswahl.
    if (gUi.picker != null && !e.target.closest(".g-tapback")) { gUi.picker = null; renderMApp(); }
  });
  host.addEventListener("input", e => { if (e.target.id === "g-name") gUi.name = e.target.value; });
  host.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "g-name") { const b = host.querySelector('[data-g-act="join"]'); if (b) gAction(b); } });
}
