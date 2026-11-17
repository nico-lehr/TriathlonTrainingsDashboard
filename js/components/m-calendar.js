// Kalender (Graphit): am Computer ein großer Monats- oder Wochenplan mit
// Wetter und Wochensummen, am Handy ein kleiner Monat plus Liste der
// nächsten 7 Tage. Geplante Einheiten lassen sich auf einen anderen Tag
// ziehen (Maus: ziehen, Handy: kurz halten und ziehen). Verschoben wird über
// dieselbe Regelprüfung wie im Bearbeiten-Dialog (commitCheckedPlanChange,
// js/components/training-plan.js); danach lässt es sich rückgängig machen.
// Stil: css/m-calendar.css.

const K_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const K_GRIP = '<svg class="k-grip" viewBox="0 0 10 16" aria-hidden="true"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';

/* ------------------------------------------------------------ Hilfen */

// Kalenderwoche nach ISO 8601 (Woche mit dem ersten Donnerstag = KW 1).
function kIsoWeek(d) {
  const x = mDay(d);
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const jan4 = new Date(x.getFullYear(), 0, 4);
  return 1 + Math.round(((x - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

const kSportKey = s => (sportGroup(s) === "Sonstiges" ? s : sportGroup(s));
const kShortDur = min => (!(min > 0) ? "" : min >= 60 ? `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")} h` : `${Math.round(min)} min`);
const kHours = min => `${mNum(min / 60, 1)} h`;

function kDayLabel(k) {
  return new Date(k + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
}

// Alles, was an einem Tag im Kalender steht: Wettkämpfe, Erledigtes, Geplantes.
function kEntries(k) {
  const day = new Date(k + "T12:00:00");
  const done = mWorkoutsOn(day);
  const out = [];
  mGoalsOn(k).forEach(g => out.push({ type: "race", title: g.name, g }));
  done.forEach(w => out.push({ type: "done", title: w.title || w.name || w.sport, sport: kSportKey(w.sport), min: w.is_summary ? 0 : (w.duration_min || 0), w }));
  mPlannedOn(k).filter(p => p.status !== "erledigt" || !done.length).forEach(p => out.push({
    type: p.status === "uebersprungen" ? "skip" : p.status === "erledigt" ? "done" : "plan",
    title: p.title || p.sport, sport: p.sport, min: Number(p.duration_min) || 0, p,
  }));
  return out;
}

function kWeather(k) {
  const d = typeof weatherForDate === "function" ? weatherForDate(k) : null;
  if (!d) return null;
  const info = weatherCodeInfo(d.code);
  return { icon: info ? info.icon : "", label: info ? info.label : "", max: d.temp_max, min: d.temp_min, rain: d.precip_prob, wind: d.wind_max };
}

function kWeatherHtml(k, variant) {
  const w = kWeather(k);
  if (!w) return "";
  const t = w.max != null ? `${Math.round(w.max)}°` : "";
  const title = [w.label, w.max != null && w.min != null ? `${Math.round(w.min)}–${Math.round(w.max)} °C` : "", w.rain != null ? `Regen ${Math.round(w.rain)} %` : "", w.wind != null ? `Wind bis ${Math.round(w.wind)} km/h` : ""].filter(Boolean).join(" · ");
  if (variant === "full") {
    return `<span class="k-wx full" title="${mEsc(title)}"><span aria-hidden="true">${w.icon}</span><b>${t}</b>${w.min != null ? `<small>${Math.round(w.min)}°</small>` : ""}${w.rain != null && w.rain >= 30 ? `<small class="rain">${Math.round(w.rain)} %</small>` : ""}</span>`;
  }
  return `<span class="k-wx" title="${mEsc(title)}"><span aria-hidden="true">${w.icon}</span>${t}</span>`;
}

// Ein Eintrag. size: "s" (Monat), "l" (Woche und Liste).
function kEntryHtml(e, size) {
  if (e.type === "race") {
    return `<button type="button" class="k-ev race ${size}" data-m-classic="coach" data-m-scroll="goals"><span class="k-ev-t">🏁 ${mEsc(e.title)}</span>${size === "l" ? `<span class="k-ev-m">Wettkampf${e.g.distanceKm ? ` · ${mNum(e.g.distanceKm, e.g.distanceKm < 10 ? 1 : 0)} km` : ""}${e.g.targetTime ? ` · Ziel ${mEsc(e.g.targetTime)}` : ""}</span>` : ""}</button>`;
  }
  const color = mSport(e.sport).color;
  const drag = e.type === "plan" ? ` data-k-drag="${mEsc(e.p.id)}"` : "";
  const act = e.w ? `data-m-act="workout" data-file="${mEsc(e.w.file || e.w.id || "")}"` : `data-m-act="plan" data-id="${mEsc(e.p.id)}"`;
  const landed = e.p && mState.calLanded === e.p.id ? " landed" : "";
  const status = e.type === "done" ? "erledigt" : e.type === "skip" ? "übersprungen" : "geplant";
  const tip = `${e.title} · ${status}${e.min ? ` · ${kShortDur(e.min)}` : ""}${e.type === "plan" ? " – zum Verschieben ziehen" : ""}`;
  if (size === "s") {
    return `<button type="button" class="k-ev ${e.type} s${landed}" style="--c:${color}" ${act}${drag} title="${mEsc(tip)}"><span class="k-ev-t">${mEsc(e.title)}</span></button>`;
  }
  const meta = [kShortDur(e.min), e.w && e.w.distance_km ? `${mNum(e.w.distance_km, 1)} km` : "", e.p ? mSwimBit(e.p).replace(/^ · /, "") : "", e.p && e.p.intensity ? e.p.intensity : ""].filter(Boolean).join(" · ");
  const right = e.type === "done" ? `<span class="k-check" aria-label="erledigt">✓</span>` : e.type === "skip" ? `<span class="k-state">übersprungen</span>` : K_GRIP;
  return `<button type="button" class="k-ev ${e.type} l${landed}" style="--c:${color}" ${act}${drag} title="${mEsc(tip)}">${mIcon(e.sport, "sm")}<span class="k-ev-body"><span class="k-ev-t">${mEsc(e.title)}</span>${meta ? `<span class="k-ev-m">${mEsc(meta)}</span>` : ""}</span>${right}</button>`;
}

// Minuten einer Woche je Sportart: erledigt und noch geplant (ab heute).
function kWeekStats(monday) {
  const today = todayStr();
  const by = {}, plan = { total: 0 };
  let done = 0;
  for (let i = 0; i < 7; i++) {
    const k = localDateStr(mAddDays(monday, i));
    kEntries(k).forEach(e => {
      if (e.type === "done" && e.min) { by[e.sport] = (by[e.sport] || 0) + e.min; done += e.min; }
      if (e.type === "plan" && k >= today && e.min) plan.total += e.min;
    });
  }
  return { by, done, plan: plan.total };
}

function kSumBar(stats) {
  const order = ["Schwimmen", "Rad", "Laufen", "Kraft", "Mobility"];
  const rank = s => (order.includes(s) ? order.indexOf(s) : 99);
  const keys = Object.keys(stats.by).sort((x, y) => rank(x) - rank(y));
  const total = stats.done + stats.plan;
  if (!total) return `<span class="k-sumbar empty"></span>`;
  return `<span class="k-sumbar">${keys.map(s => `<i style="flex:${stats.by[s]};background:${mSport(s).color}" title="${mEsc(s)} ${kHours(stats.by[s])}"></i>`).join("")}${stats.plan ? `<i class="plan" style="flex:${stats.plan}" title="noch geplant ${kHours(stats.plan)}"></i>` : ""}</span>`;
}

/* ------------------------------------------------------------ Ansichten */

function kMonthBoard(today) {
  const m = mState.calMonth;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
  const todayKey = localDateStr(today);
  let rows = "";
  for (let ws = mMonday(first); ws <= last; ws = mAddDays(ws, 7)) {
    let cells = "";
    for (let i = 0; i < 7; i++) {
      const d = mAddDays(ws, i);
      const k = localDateStr(d);
      const evs = kEntries(k);
      const cls = ["k-cell", d.getMonth() !== m.getMonth() ? "out" : "", k === todayKey ? "today" : "", k < todayKey ? "past" : "", i >= 5 ? "we" : ""].filter(Boolean).join(" ");
      const shown = evs.slice(0, 4);
      cells += `<div class="${cls}" data-cal-drop="${k}">
        <div class="k-cell-top"><button type="button" class="k-num" data-m-act="k-day" data-date="${k}" aria-label="Woche ab ${mEsc(kDayLabel(k))}">${d.getDate()}</button>${kWeatherHtml(k)}</div>
        <div class="k-evs">${shown.map(e => kEntryHtml(e, "s")).join("")}${evs.length > shown.length ? `<button type="button" class="k-more" data-m-act="k-day" data-date="${k}">+${evs.length - shown.length} weitere</button>` : ""}</div>
        ${k >= todayKey ? `<button type="button" class="k-add" data-m-act="plan-new" data-date="${k}" aria-label="Einheit am ${mEsc(kDayLabel(k))} planen">+</button>` : ""}
      </div>`;
    }
    const st = kWeekStats(ws);
    rows += `<div class="k-row"><span class="k-kw">${kIsoWeek(ws)}</span>${cells}
      <div class="k-sum">${st.done || st.plan ? `<b>${kHours(st.done)}</b>${st.plan ? `<small>+ ${kHours(st.plan)} geplant</small>` : ""}${kSumBar(st)}` : `<small class="rest">Ruhewoche</small>`}</div></div>`;
  }
  const head = `<div class="k-row k-head"><span class="k-kw">KW</span>${mWeekdays.map((w, i) => `<span class="${i >= 5 ? "we" : ""}">${w}</span>`).join("")}<span class="k-sum-h">Woche</span></div>`;
  return `<div class="k-grid">${head}${rows}</div>`;
}

function kWeekBoard(today) {
  const mon = mState.calFocus;
  const todayKey = localDateStr(today);
  const cols = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = mAddDays(mon, i);
    const k = localDateStr(d);
    const evs = kEntries(k);
    const min = evs.reduce((s, e) => s + (e.type === "done" || e.type === "plan" ? e.min : 0), 0);
    return `<div class="k-col${k === todayKey ? " today" : ""}${k < todayKey ? " past" : ""}" data-cal-drop="${k}">
      <div class="k-col-head"><span class="k-col-wd">${k === todayKey ? "Heute" : mWeekdays[i]}</span><b class="k-col-num">${d.getDate()}</b>${kWeatherHtml(k, "full")}</div>
      <div class="k-col-evs">${evs.map(e => kEntryHtml(e, "l")).join("")}
        ${k >= todayKey ? `<button type="button" class="k-col-add" data-m-act="plan-new" data-date="${k}">+ Einheit</button>` : evs.length ? "" : `<span class="k-col-rest">Ruhetag</span>`}</div>
      <div class="k-col-foot">${min ? kShortDur(min) : ""}</div>
    </div>`;
  }).join("");
  return `<div class="k-cols">${cols}</div>`;
}

// Handy: kleiner Monat (Striche je Einheit) + Liste.
function kMini(today) {
  const m = mState.calMonth;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
  const todayKey = localDateStr(today);
  const from = localDateStr(mState.calWeek), to = localDateStr(mAddDays(mState.calWeek, 6));
  let cells = mWeekdays.map(w => `<span class="k-mini-wd">${w}</span>`).join("") + '<span></span>'.repeat((first.getDay() + 6) % 7);
  for (let d = 1; d <= last.getDate(); d++) {
    const k = localDateStr(new Date(m.getFullYear(), m.getMonth(), d));
    const evs = kEntries(k).slice(0, 3);
    const marks = evs.map(e => `<i class="${e.type}" style="--c:${e.type === "race" ? "var(--m-accent)" : mSport(e.sport).color}"></i>`).join("");
    const cls = ["k-mini-d", k === todayKey ? "today" : "", k < todayKey ? "past" : "", k >= from && k <= to ? "sel" : "", k === from ? "sel-a" : "", k === to ? "sel-b" : ""].filter(Boolean).join(" ");
    cells += `<button type="button" class="${cls}" data-m-act="cal-day" data-date="${k}" data-cal-drop="${k}"><b>${d}</b><span class="k-marks">${marks}</span></button>`;
  }
  return `<div class="k-mini-grid">${cells}</div>`;
}

function kAgenda(today) {
  const todayKey = localDateStr(today);
  return [0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = mAddDays(mState.calWeek, i);
    const k = localDateStr(d);
    const evs = kEntries(k);
    const wd = mWeekdays[(d.getDay() + 6) % 7];
    return `<div class="k-ag${k === todayKey ? " today" : ""}${k < todayKey ? " past" : ""}" data-cal-drop="${k}">
      <div class="k-ag-date"><span>${k === todayKey ? "Heute" : wd}</span><b>${d.getDate()}</b>${kWeatherHtml(k)}</div>
      <div class="k-ag-evs">${evs.map(e => kEntryHtml(e, "l")).join("")}${k >= todayKey && !evs.some(e => e.type === "plan") ? `<button type="button" class="k-ag-add" data-m-act="plan-new" data-date="${k}">+ Einheit</button>` : ""}${!evs.length && k < todayKey ? `<span class="k-col-rest">Ruhetag</span>` : ""}</div>
    </div>`;
  }).join("");
}

function kToast() {
  const u = mState.calUndo;
  if (!u) return "";
  return `<div class="k-toast" role="status"><span>Verschoben auf <b>${mEsc(kDayLabel(u.to))}</b></span><button type="button" data-m-act="k-undo">Rückgängig</button></div>`;
}

function mRenderKalender() {
  const today = mDay(new Date());
  if (!mState.calMonth) mState.calMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  if (!mState.calWeek) mState.calWeek = today;
  if (!mState.calFocus) mState.calFocus = mMonday(today);
  if (!mState.calView) mState.calView = "month";
  if (typeof weatherNeedsRefresh === "function" && weatherNeedsRefresh()) loadWeatherForecast().then(mScheduleRender);

  const view = mState.calView;
  const m = mState.calMonth;
  const mon = mState.calFocus;
  const sun = mAddDays(mon, 6);
  const deskTitle = view === "month"
    ? `${K_MONTHS[m.getMonth()]} <span>${m.getFullYear()}</span>`
    : `${mon.getDate()}.${mon.getMonth() !== sun.getMonth() ? ` ${K_MONTHS[mon.getMonth()].slice(0, 3)}.` : ""} – ${sun.getDate()}. ${K_MONTHS[sun.getMonth()]} <span>KW ${kIsoWeek(mon)}</span>`;
  const navAct = view === "month" ? "month" : "k-wk";
  const thisWeek = kWeekStats(mMonday(today));
  const kicker = `KW ${kIsoWeek(today)} · ${kHours(thisWeek.done)} trainiert${thisWeek.plan ? ` · ${kHours(thisWeek.plan)} geplant` : ""}`;
  const hasPlan = (typeof plannedWorkouts !== "undefined" ? plannedWorkouts : []).some(p => p.status === "geplant" && p.date >= todayStr());

  const desk = `<section class="k-board k-desk">
      <div class="k-bar">
        <h2 class="k-title">${deskTitle}</h2>
        <div class="k-tools">
          <span class="k-seg" role="tablist"><button type="button" class="${view === "month" ? "on" : ""}" data-m-act="k-view" data-v="month" role="tab" aria-selected="${view === "month"}">Monat</button><button type="button" class="${view === "week" ? "on" : ""}" data-m-act="k-view" data-v="week" role="tab" aria-selected="${view === "week"}">Woche</button></span>
          <span class="k-nav"><button type="button" data-m-act="${navAct}" data-dir="-1" aria-label="Zurück">‹</button><button type="button" class="k-today" data-m-act="k-today">Heute</button><button type="button" data-m-act="${navAct}" data-dir="1" aria-label="Weiter">›</button></span>
        </div>
      </div>
      ${view === "month" ? kMonthBoard(today) : kWeekBoard(today)}
      <div class="k-legend"><span><i class="done"></i>erledigt</span><span><i class="plan"></i>geplant</span>${hasPlan ? `<span class="k-legend-tip">Geplante Einheiten einfach auf einen anderen Tag ziehen</span>` : ""}</div>
    </section>`;

  const fromToday = localDateStr(mState.calWeek) === localDateStr(today);
  const agMin = [0, 1, 2, 3, 4, 5, 6].reduce((s, i) => s + kEntries(localDateStr(mAddDays(mState.calWeek, i))).reduce((a, e) => a + (e.type === "done" || e.type === "plan" ? e.min : 0), 0), 0);
  const phone = `<div class="k-phone">
      <section class="k-panel">
        <div class="k-pbar"><h2 class="k-title">${K_MONTHS[m.getMonth()]} <span>${m.getFullYear()}</span></h2><span class="k-nav"><button type="button" data-m-act="month" data-dir="-1" aria-label="Vormonat">‹</button><button type="button" data-m-act="month" data-dir="1" aria-label="Nächster Monat">›</button></span></div>
        ${kMini(today)}
      </section>
      <section class="k-panel">
        <div class="k-pbar"><h2 class="k-sub">${fromToday ? "Nächste 7 Tage" : mState.calWeek < today ? "Rückblick" : "Danach"} <span>${kHours(agMin)}</span></h2><span class="k-nav">${fromToday ? "" : `<button type="button" data-m-act="week" data-dir="-1" aria-label="Früher">‹</button>`}<button type="button" data-m-act="week" data-dir="1" aria-label="Später">›</button></span></div>
        ${hasPlan ? `<p class="k-hint">Geplante Einheit kurz halten und auf einen anderen Tag ziehen.</p>` : ""}
        <div class="k-agenda">${kAgenda(today)}</div>
      </section>
    </div>`;

  mState.calLanded = null; // die kleine Lande-Animation nur einmal
  return mHeaderHtml(kicker, "Kalender", `<button type="button" class="m-icon" data-m-act="plan-new" data-date="${todayStr()}" aria-label="Neue Einheit">+</button>`)
    + desk + phone + kToast();
}

/* ------------------------------------------------------------ Knöpfe */

// Wird von mAction (m-app.js) zuerst gefragt; true = erledigt.
function mCalAction(btn) {
  const act = btn.dataset.mAct;
  if (act === "k-view") { mState.calView = btn.dataset.v; renderMApp(); return true; }
  if (act === "k-wk") { mState.calFocus = mAddDays(mState.calFocus, 7 * Number(btn.dataset.dir)); kSyncMonth(mState.calFocus); renderMApp(); return true; }
  if (act === "k-today") {
    const t = mDay(new Date());
    mState.calFocus = mMonday(t); mState.calWeek = t; kSyncMonth(t);
    renderMApp(); return true;
  }
  if (act === "k-day") {
    const d = new Date(btn.dataset.date + "T12:00:00");
    mState.calFocus = mMonday(d); mState.calView = "week"; mState.calWeek = mDay(d);
    renderMApp(); return true;
  }
  if (act === "k-undo") { kUndo(); return true; }
  return false;
}

function kSyncMonth(d) {
  mState.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
}

/* ------------------------------------------------------------ Verschieben */

function kAfterChange() {
  if (typeof renderTrainingPlanCard === "function") renderTrainingPlanCard();
  if (typeof renderCalendar === "function") renderCalendar();
  renderMApp();
}

let kUndoTimer = null;
async function kMove(id, toKey) {
  const p = plannedWorkouts.find(x => x.id === id);
  if (!p || p.date === toKey) return;
  const from = p.date;
  const ok = await commitCheckedPlanChange(patchedPlannedWorkouts(plannedWorkouts, id, { date: toKey }));
  if (ok) {
    mState.calLanded = id;
    mState.calUndo = { id, from, to: toKey };
    if (typeof mTrack === "function") mTrack("feature", "cal-drag");
    clearTimeout(kUndoTimer);
    kUndoTimer = setTimeout(() => { mState.calUndo = null; if (mState.page === "kalender") renderMApp(); }, 6000);
  }
  kAfterChange();
}

function kUndo() {
  const u = mState.calUndo;
  mState.calUndo = null;
  clearTimeout(kUndoTimer);
  if (!u || !plannedWorkouts.some(p => p.id === u.id)) { renderMApp(); return; }
  replacePlannedWorkouts(patchedPlannedWorkouts(plannedWorkouts, u.id, { date: u.from }));
  mState.calLanded = u.id;
  kAfterChange();
}

// Ziehen mit Zeiger-Ereignissen statt HTML5-Drag&Drop: so geht es auch am
// Handy. Maus: ab 5 px Bewegung. Finger: erst nach kurzem Halten, damit
// normales Scrollen weiter funktioniert.
const kDrag = { s: null, justDropped: 0 };

function kTarget(x, y) {
  const el = document.elementFromPoint(x, y);
  const cell = el && el.closest("[data-cal-drop]");
  return cell && cell.closest("#m-app") ? cell : null;
}

function kStart() {
  const s = kDrag.s;
  if (!s || s.active) return;
  s.active = true;
  const r = s.el.getBoundingClientRect();
  s.dx = s.x - r.left; s.dy = s.y - r.top;
  const ghost = s.el.cloneNode(true);
  ghost.classList.add("k-ghost");
  ghost.removeAttribute("data-k-drag");
  ghost.style.width = `${r.width}px`;
  document.body.appendChild(ghost);
  s.ghost = ghost;
  s.el.classList.add("k-lifted");
  document.body.classList.add("k-dragging");
  if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* egal */ }
  kMoveGhost();
  const tick = () => {
    if (!kDrag.s || !kDrag.s.active) return;
    const edge = 70, y = kDrag.s.y;
    if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 5));
    else if (y > window.innerHeight - edge) window.scrollBy(0, Math.ceil((y - window.innerHeight + edge) / 5));
    kDrag.s.raf = requestAnimationFrame(tick);
  };
  s.raf = requestAnimationFrame(tick);
}

function kMoveGhost() {
  const s = kDrag.s;
  s.ghost.style.transform = `translate(${s.x - s.dx}px, ${s.y - s.dy}px) rotate(-1.5deg)`;
  const t = kTarget(s.x, s.y);
  if (t !== s.over) {
    if (s.over) s.over.classList.remove("k-over", "k-nope");
    s.over = t;
    if (t) t.classList.add(t.dataset.calDrop < todayStr() ? "k-nope" : "k-over");
  }
}

function kEnd(drop) {
  const s = kDrag.s;
  kDrag.s = null;
  if (!s) return;
  clearTimeout(s.timer);
  if (!s.active) return;
  cancelAnimationFrame(s.raf);
  document.body.classList.remove("k-dragging");
  if (s.over) s.over.classList.remove("k-over", "k-nope");
  kDrag.justDropped = Date.now();
  const to = drop && s.over ? s.over.dataset.calDrop : null;
  const p = plannedWorkouts.find(x => x.id === s.id);
  if (to && to >= todayStr() && p && p.date !== to) {
    s.ghost.remove();
    kMove(s.id, to);
    return;
  }
  // zurück an den alten Platz gleiten
  const r = s.el.getBoundingClientRect();
  s.ghost.classList.add("back");
  s.ghost.style.transform = `translate(${r.left}px, ${r.top}px)`;
  setTimeout(() => { s.ghost.remove(); s.el.classList.remove("k-lifted"); }, 220);
}

function initCalDrag() {
  document.addEventListener("pointerdown", e => {
    const el = e.target.closest && e.target.closest("#m-app [data-k-drag]");
    if (!el || e.button > 0 || kDrag.s) return;
    kDrag.s = { el, id: el.dataset.kDrag, pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType !== "mouse", active: false };
    if (kDrag.s.touch) kDrag.s.timer = setTimeout(kStart, 380);
  });
  document.addEventListener("pointermove", e => {
    const s = kDrag.s;
    if (!s || e.pointerId !== s.pid) return;
    s.x = e.clientX; s.y = e.clientY;
    const dist = Math.hypot(s.x - s.x0, s.y - s.y0);
    if (!s.active) {
      if (s.touch && dist > 10) { clearTimeout(s.timer); kDrag.s = null; } // wird gescrollt
      else if (!s.touch && dist > 5) kStart();
      return;
    }
    kMoveGhost();
  });
  document.addEventListener("pointerup", e => { if (kDrag.s && e.pointerId === kDrag.s.pid) kEnd(true); });
  document.addEventListener("pointercancel", e => { if (kDrag.s && e.pointerId === kDrag.s.pid) kEnd(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && kDrag.s) kEnd(false); });
  // Während des Ziehens nicht scrollen, kein Kontextmenü, kein Klick danach.
  document.addEventListener("touchmove", e => { if (kDrag.s && kDrag.s.active) e.preventDefault(); }, { passive: false });
  document.addEventListener("contextmenu", e => { if (kDrag.s) e.preventDefault(); });
  document.addEventListener("click", e => {
    if (Date.now() - kDrag.justDropped < 350 && e.target.closest && e.target.closest("#m-app")) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

initCalDrag();
