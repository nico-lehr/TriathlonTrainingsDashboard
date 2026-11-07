// Handy-Ansicht "Graphit" (bis 700 px Breite): eigene, kompakte Oberfläche
// mit den wichtigsten Infos zuerst - nach dem Vorbild von Trainings-Apps wie
// Whoop. Gleiche Daten und Funktionen wie die normale Ansicht; nur die
// Darstellung ist anders. Am Computer bleibt alles wie gewohnt.
//
// Bereiche: Übersicht · Kalender · Coach · Training (Mobility | Kraft) · Mehr.
// "Mehr" und "Alle Diagramme" öffnen die bisherigen Seiten (Ernährung,
// Rekorde, Analyse, Einstellungen, Übersicht mit allen Karten).
// Abschaltbar unter Einstellungen → Konto ("Neue Handy-Ansicht").

const M_KEY = "triathlon_dashboard_m_graphit_v1";
const M_QUERY = "(max-width: 700px)";
const M_RANGES = [[7, "7 Tage"], [30, "30 Tage"], [90, "90 Tage"], [365, "1 Jahr"]];
const M_SPORT = {
  Schwimmen: { color: "var(--m-swim)", icon: '<circle cx="15" cy="6" r="2"/><path d="M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2.5-1.5 4.5-1.5S19 17 21 17M3 21c2 0 2-1.5 4.5-1.5S10 21 12 21s2.5-1.5 4.5-1.5S19 21 21 21M7 13l4-5 4 2"/>' },
  Rad: { color: "var(--m-bike)", icon: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8M10 8l2 8"/>' },
  Laufen: { color: "var(--m-run)", icon: '<circle cx="14" cy="4" r="2"/><path d="M8 21l3-6 3 2v4M6 12l3-4h5l3 4M11 8l-2 7"/>' },
  Kraft: { color: "var(--m-strength)", icon: '<path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/>' },
  Mobility: { color: "var(--m-accent)", icon: '<circle cx="12" cy="4.5" r="2"/><path d="M5 9l7 1.5L19 9M12 10.5V15l-4 6M12 15l4 6"/>' },
};
const M_SPORT_OTHER = { color: "var(--m-muted)", icon: '<circle cx="12" cy="12" r="7"/>' };

const mState = { page: "heute", sub: "mobility", planId: null, range: 30, calMonth: null, calWeek: null, classic: null, busy: false };

function mEnabled() {
  try { return localStorage.getItem(M_KEY) !== "off"; } catch (e) { return true; }
}
function mActive() {
  return mEnabled() && window.matchMedia && window.matchMedia(M_QUERY).matches;
}

const mEsc = s => escapeHtml(String(s == null ? "" : s));
const mSport = s => M_SPORT[s] || M_SPORT[String(s).replace(/\s*\(.*\)$/, "")] || M_SPORT_OTHER;
const mIcon = (sport, cls = "") => `<span class="m-ic ${cls}" style="background:${mSport(sport).color}"><svg viewBox="0 0 24 24" aria-hidden="true">${mSport(sport).icon}</svg></span>`;
const mDur = min => (min >= 60 ? `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")} h` : `${Math.round(min)} min`);
const mNum = (v, d = 1) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const mDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const mMonday = d => { const x = mDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const mAddDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mWeekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function mRing(p, color, big, small, extraCls = "") {
  const C = 2 * Math.PI * 42;
  const pct = Math.max(0, Math.min(1, p || 0));
  return `<div class="m-ring ${extraCls}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="m-ring-track" cx="50" cy="50" r="42"/>`
    + `<circle class="m-ring-val" cx="50" cy="50" r="42" stroke="${color}" style="color:${color};stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct)}"/></svg>`
    + `<div class="m-ring-txt"><b>${big}</b><small>${small}</small></div></div>`;
}

/* ------------------------------------------------------------ Daten */

function mAllWorkouts() {
  return (typeof ALL !== "undefined" ? ALL : []).filter(w => w._date);
}

// Fitness/Ermüdung/Form über die ganze Historie (unabhängig vom Zeitraum-Filter).
function mLoadSeries() {
  const pts = mAllWorkouts().filter(w => w.training_load != null);
  if (!pts.length) return null;
  const dayMs = 86400000;
  const byDay = new Map();
  pts.forEach(p => { const k = Math.floor(mDay(p._date).getTime() / dayMs); byDay.set(k, (byDay.get(k) || 0) + p.training_load); });
  const first = Math.min(...byDay.keys());
  const last = Math.floor(mDay(new Date()).getTime() / dayMs);
  let ctl = 0, atl = 0;
  const out = [];
  for (let d = first; d <= last; d++) {
    const load = byDay.get(d) || 0;
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    out.push({ day: d, ctl, atl, tsb: ctl - atl });
  }
  return out;
}

// Erholung in % aus HRV, Ruhepuls und Schlaf (Garmin) im Vergleich zum
// eigenen 30-Tage-Mittel; der Erholungs-Check (Muskelkater, Energie,
// Verletzung) zieht ab. Ohne Garmin-Daten nur aus dem Erholungs-Check.
function mRecovery() {
  const parts = [];
  const hrv = typeof wellnessDeviation === "function" ? wellnessDeviation("hrv_ms") : null;
  const rhr = typeof wellnessDeviation === "function" ? wellnessDeviation("resting_hr") : null;
  const sleep = typeof latestWellness === "function" ? latestWellness("sleep_min", 2) : null;
  if (hrv) parts.push([0.5, Math.max(0, Math.min(100, 72 + hrv.deltaPct * 2.5))]);
  if (rhr) parts.push([0.25, Math.max(0, Math.min(100, 72 - rhr.deltaPct * 4))]);
  if (sleep) parts.push([0.25, Math.max(0, Math.min(100, (sleep.value / 480) * 90))]);
  const rc = typeof recoveryCheck !== "undefined" ? recoveryCheck : {};
  const checked = rc.soreness || rc.energy || rc.injury === "yes";
  if (!parts.length && !checked) return null;
  let score = parts.length ? parts.reduce((s, [w, v]) => s + w * v, 0) / parts.reduce((s, [w]) => s + w, 0) : 75;
  if (rc.soreness === "severe") score -= 18; else if (rc.soreness === "moderate") score -= 8; else if (rc.soreness === "light") score -= 3;
  if (rc.energy === "low") score -= 18; else if (rc.energy === "reduced") score -= 8; else if (rc.energy === "high") score += 4;
  if (rc.injury === "yes") score -= 25;
  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    hrv: hrv ? Math.round(hrv.value) : null,
    rhr: rhr ? Math.round(rhr.value) : (typeof latestWellness === "function" && latestWellness("resting_hr") ? Math.round(latestWellness("resting_hr").value) : null),
    fromGarmin: parts.length > 0,
  };
}

function mVerdict(rec, plannedHard) {
  if (!rec) return { cls: "neutral", text: "Füll den Erholungs-Check im Coach aus – dann sage ich dir, was heute passt." };
  if (rec.score >= 70) return { cls: "good", text: plannedHard ? "Gut erholt – die harte Einheit heute passt." : "Gut erholt – du kannst heute gut trainieren." };
  if (rec.score >= 45) return { cls: "warn", text: plannedHard ? "Mittel erholt – harte Einheit lieber etwas kürzer." : "Mittel erholt – heute eher locker." };
  return { cls: "bad", text: "Wenig erholt – heute locker oder Ruhetag." };
}

function mPlannedOn(dateStr) {
  return (typeof plannedWorkouts !== "undefined" ? plannedWorkouts : []).filter(p => p.date === dateStr);
}

function mWorkoutsOn(day) {
  const k = localDateStr(day);
  return mAllWorkouts().filter(w => localDateStr(w._date) === k);
}

/* ------------------------------------------------------------ Seiten */

function mHeaderHtml(kicker, title, right = "") {
  return `<header class="m-top"><div><div class="m-kicker">${mEsc(kicker)}</div><h1 class="m-title">${mEsc(title)}</h1></div><div class="m-top-right">${right}</div></header>`;
}

function mSyncPill() {
  const gs = typeof garminState !== "undefined" ? garminState : { loaded: false, sync: {} };
  const sync = typeof lastGarminSync === "function" ? lastGarminSync() : null;
  if (gs.sync && gs.sync.running) return `<span class="m-pill busy" role="status"><i></i>Holt Garmin-Daten …</span>`;
  if (gs.loaded && !gs.configured) return `<button type="button" class="m-pill" data-m-act="garmin"><i class="off"></i>Garmin verbinden</button>`;
  if (gs.loaded && gs.sync && gs.sync.at && gs.sync.ok === false) return `<button type="button" class="m-pill" data-m-act="garmin"><i class="bad"></i>Garmin: Abruf fehlgeschlagen</button>`;
  if (!sync || !sync.at) {
    return gs.loaded ? `<button type="button" class="m-pill" data-m-act="garmin-sync"><i class="old"></i>Jetzt von Garmin holen</button>`
      : `<button type="button" class="m-pill" data-m-act="garmin"><i class="off"></i>Garmin</button>`;
  }
  const d = new Date(sync.at);
  const today = localDateStr(d) === todayStr();
  const label = today ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
  return `<button type="button" class="m-pill" data-m-act="garmin-sync" aria-label="Jetzt von Garmin holen (zuletzt ${mEsc(label)})"><i class="${today ? "" : "old"}"></i>Garmin · ${mEsc(label)} ↻</button>`;
}

function mRenderHeute() {
  const now = new Date();
  const today = todayStr();
  const rec = mRecovery();
  const planned = mPlannedOn(today).filter(p => p.status !== "uebersprungen");
  const main = planned.find(p => p.sport !== "Mobility") || null;
  const mob = planned.find(p => p.sport === "Mobility") || null;
  const verdict = mVerdict(rec, main && main.intensity === "hart");

  // Woche
  const mon = mMonday(now);
  const weekWorkouts = mAllWorkouts().filter(w => w._date >= mon && w._date < mAddDays(mon, 7));
  const doneMin = weekWorkouts.reduce((s, w) => s + (w.duration_min || 0), 0);
  const plannedWeek = (typeof plannedWorkouts !== "undefined" ? plannedWorkouts : []).filter(p => p.date >= localDateStr(mon) && p.date < localDateStr(mAddDays(mon, 7)));
  const plannedMin = plannedWeek.filter(p => p.status !== "uebersprungen").reduce((s, p) => s + (p.duration_min || 0), 0);
  const targetMin = Math.max(plannedMin, (Number(athleteProfile.weeklyHours) || 0) * 60) || doneMin || 60;

  // Schlaf
  const sleep = typeof latestWellness === "function" ? latestWellness("sleep_min", 2) : null;
  const deep = typeof latestWellness === "function" ? latestWellness("sleep_deep_min", 2) : null;

  const rings = `<div class="m-rings">
      <div class="m-ring-col">${mRing(rec ? rec.score / 100 : 0, "var(--m-r1)", rec ? `${rec.score}<span class="m-unit">%</span>` : "–", "Erholung")}
        <span class="m-ring-sub">${rec && rec.fromGarmin ? `HRV ${rec.hrv ?? "–"} · Puls ${rec.rhr ?? "–"}` : rec ? "aus dem Check" : "keine Daten"}</span></div>
      <div class="m-ring-col">${mRing(doneMin / targetMin, "var(--m-r2)", mNum(doneMin / 60, 1), `von ${mNum(targetMin / 60, 1)} h`)}
        <span class="m-ring-sub">Woche</span></div>
      <div class="m-ring-col">${mRing(sleep ? sleep.value / 480 : 0, "var(--m-r3)", sleep ? `${Math.floor(sleep.value / 60)}:${String(Math.round(sleep.value % 60)).padStart(2, "0")}` : "–", "Schlaf")}
        <span class="m-ring-sub">${deep ? `Tiefschlaf ${Math.floor(deep.value / 60)}:${String(Math.round(deep.value % 60)).padStart(2, "0")}` : "keine Daten"}</span></div>
    </div>
    <div class="m-verdict ${verdict.cls}"><i></i>${mEsc(verdict.text)}</div>`;

  // Heute geplant
  let todayCard;
  if (main) {
    const desc = mStepSummary(main) || (main.description || "").split(/[.,\n]/)[0];
    todayCard = `<div class="m-today">${mIcon(main.sport, "lg")}<div class="m-grow"><div class="m-row-title lg">${mEsc(main.title || main.sport)}${main.duration_min ? ` · ${mDur(main.duration_min)}` : ""}</div>
        <div class="m-row-meta">${main.intensity ? `<span class="m-tag ${main.intensity}">${mEsc(main.intensity)}</span>` : ""}${mEsc(desc).slice(0, 90)}</div></div></div>
      <div class="m-actions">${main.status === "erledigt" ? `<span class="m-done-note">Erledigt ✓</span>` : ""}
        ${main.sport === "Kraft" && typeof plannedToStrengthSession === "function" && plannedToStrengthSession(main) ? `<button type="button" class="m-btn primary" data-m-act="start-strength" data-id="${mEsc(main.id)}">Mitmachen</button>` : ""}
        <button type="button" class="m-btn ${main.sport === "Kraft" ? "soft" : "primary"}" data-m-act="plan" data-id="${mEsc(main.id)}">${main.sport === "Kraft" ? "Details" : "Ansehen & an Garmin"}</button></div>`;
  } else {
    todayCard = `<p class="m-empty">${(athleteProfile.trainingDays || []).length && !(athleteProfile.trainingDays || []).includes(["so", "mo", "di", "mi", "do", "fr", "sa"][now.getDay()]) ? "Heute ist Ruhetag. Genieß ihn." : "Für heute ist nichts geplant."}</p>
      <div class="m-actions"><button type="button" class="m-btn soft" data-m-page="coach">Plan ansehen</button></div>`;
  }
  if (mob) todayCard += `<div class="m-extra"><span>${mEsc(mob.title || "Mobility")} · ${mDur(mob.duration_min || 15)}</span><button type="button" class="m-link" data-m-act="start-mob" data-id="${mEsc(mob.id)}">Starten</button></div>`;

  // Wochenpunkte
  const trainingDays = athleteProfile.trainingDays || [];
  const dowKey = ["mo", "di", "mi", "do", "fr", "sa", "so"];
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = mAddDays(mon, i);
    const k = localDateStr(d);
    const done = mWorkoutsOn(d);
    const plans = mPlannedOn(k).filter(p => p.status === "geplant");
    const isToday = k === today;
    let dot;
    if (done.length) dot = `<span class="m-dot" style="background:${mSport(done[0].sport).color}">✓</span>`;
    else if (plans.length) dot = `<span class="m-dot plan" style="border-color:${mSport(plans[0].sport).color};color:${mSport(plans[0].sport).color}">${plans[0].duration_min ? (plans[0].duration_min >= 60 ? `${Math.round(plans[0].duration_min / 60)}h` : `${plans[0].duration_min}′`) : "•"}</span>`;
    else if (k < today || (trainingDays.length && !trainingDays.includes(dowKey[i]))) dot = `<span class="m-dot rest">–</span>`;
    else dot = `<span class="m-dot rest"></span>`;
    return `<button type="button" class="m-day${isToday ? " today" : ""}" data-m-act="cal-day" data-date="${k}">${dot}<span>${mWeekdays[i]}</span></button>`;
  }).join("");
  const bySport = { Schwimmen: 0, Rad: 0, Laufen: 0 };
  weekWorkouts.forEach(w => { const g = sportGroup(w.sport); if (bySport[g] != null) bySport[g] += w.duration_min || 0; });
  const bar = Object.entries(bySport).map(([s, m]) => `<span style="width:${Math.min(100, (m / targetMin) * 100)}%;background:${mSport(s).color}"></span>`).join("");
  const legend = Object.entries(bySport).filter(([, m]) => m > 0).map(([s, m]) => `<span><i style="background:${mSport(s).color}"></i>${s} ${mNum(m / 60, 1)}</span>`).join("");

  // Form
  const series = mLoadSeries();
  let formCard = "";
  if (series && series.length > 7) {
    const last = series[series.length - 1];
    const span = series.slice(-42);
    const prev = series[Math.max(0, series.length - 15)];
    const vals = span.flatMap(p => [p.ctl, p.tsb]);
    const lo = Math.min(...vals, 0), hi = Math.max(...vals, 1);
    const y = v => 76 - ((v - lo) / (hi - lo)) * 66;
    const xs = i => (i / (span.length - 1)) * 320;
    const ctlPath = span.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)} ${y(p.ctl).toFixed(1)}`).join(" ");
    const tsbPath = span.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)} ${y(p.tsb).toFixed(1)}`).join(" ");
    const dCtl = Math.round(last.ctl - prev.ctl);
    const tsb = Math.round(last.tsb);
    formCard = `<section class="m-card"><div class="m-head"><h2>Form · 6 Wochen</h2><button type="button" class="m-link" data-m-classic="overview">Details</button></div>
      <div class="m-nums">
        <div class="m-num"><small>Fitness</small><b>${Math.round(last.ctl)}</b>${dCtl ? ` <em class="${dCtl > 0 ? "up" : "down"}">${dCtl > 0 ? "↑" : "↓"} ${Math.abs(dCtl)}</em>` : ""}</div>
        <div class="m-num"><small>Ermüdung</small><b>${Math.round(last.atl)}</b></div>
        <div class="m-num"><small>Form</small><b class="${tsb >= -10 ? "good" : tsb >= -30 ? "warn" : "bad"}">${tsb > 0 ? "+" : ""}${tsb}</b></div>
      </div>
      <svg class="m-spark" viewBox="0 0 320 80" preserveAspectRatio="none" role="img" aria-label="Fitness und Form der letzten 6 Wochen">
        <line x1="0" y1="${y(0).toFixed(1)}" x2="320" y2="${y(0).toFixed(1)}" class="m-spark-zero"/>
        <path d="${ctlPath} L320 80 L0 80 Z" class="m-spark-fill"/>
        <path d="${ctlPath}" class="m-spark-ctl"/><path d="${tsbPath}" class="m-spark-tsb"/>
        <circle cx="320" cy="${y(last.ctl).toFixed(1)}" r="4" class="m-spark-dot"/>
      </svg>
      <div class="m-legend"><span><i class="ctl"></i>Fitness</span><span><i class="tsb"></i>Form</span></div></section>`;
  }

  // Ziel
  const goal = typeof getPrimaryGoal === "function" ? getPrimaryGoal() : null;
  let goalCard;
  if (goal && goal.date) {
    const daysLeft = Math.round((mDay(goal.date + "T00:00:00") - mDay(now)) / 86400000);
    const phase = typeof getPhase === "function" ? getPhase(now, goal) : null;
    const tl = typeof getPhaseTimeline === "function" ? getPhaseTimeline(now, goal).filter(s => s.phase !== "erholung") : [];
    const total = tl.reduce((s, seg) => s + Math.max(1, (new Date(seg.to) - new Date(seg.from)) / 86400000), 0) || 1;
    const segs = tl.map((seg, i) => `<span class="${i === 0 ? "now" : ""}" style="flex:${Math.max(1, (new Date(seg.to) - new Date(seg.from)) / 86400000) / total}"></span>`).join("");
    const ready = typeof computeRaceReadiness === "function" ? computeRaceReadiness(goal) : null;
    const next = tl[1];
    goalCard = `<section class="m-card m-goal" data-m-page="coach" role="button" tabindex="0"><div class="m-goal-days">${daysLeft}<small>Tage</small></div>
      <div class="m-grow"><b>${mEsc(goal.name)} · ${new Date(goal.date + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "short" })}</b>
        <div class="m-phases" aria-hidden="true">${segs}</div>
        <small>${phase && PERIOD_PHASES[phase] ? `Phase: ${PERIOD_PHASES[phase].label}` : ""}${next && PERIOD_PHASES[next.phase] ? ` · ${PERIOD_PHASES[next.phase].label} ab ${new Date(next.from + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "short" })}` : ""}${ready ? ` · Readiness ${ready.score}/100` : ""}</small></div></section>`;
  } else {
    goalCard = `<section class="m-card"><p class="m-empty">Noch kein Ziel. Ein Wettkampf gibt deinem Plan die Richtung.</p><div class="m-actions"><button type="button" class="m-btn soft" data-m-classic="coach">Ziel eintragen</button></div></section>`;
  }

  // Zeitraum
  const from = mAddDays(mDay(now), -mState.range + 1);
  const inRange = mAllWorkouts().filter(w => w._date >= from);
  const sum = (arr, f) => arr.reduce((s, w) => s + (Number(w[f]) || 0), 0);
  const km = s => sum(inRange.filter(w => sportGroup(w.sport) === s), "distance_km");
  const rangeLabel = (M_RANGES.find(r => r[0] === mState.range) || M_RANGES[1])[1];

  // Letzte Einheiten
  const recent = mAllWorkouts().slice().sort((a, b) => b._date - a._date).slice(0, 3);
  const recentHtml = recent.length ? recent.map(w => `<button type="button" class="m-row" data-m-act="workout" data-file="${mEsc(w.file || w.id || "")}">
      ${mIcon(sportGroup(w.sport) === "Sonstiges" ? w.sport : sportGroup(w.sport))}<span class="m-grow"><span class="m-row-title">${mEsc(w.title || w.name || w.sport)}</span>
      <span class="m-row-meta">${w._date.toLocaleDateString("de-DE", { weekday: "short" })} · ${mDur(w.duration_min || 0)}${w.distance_km ? ` · ${mNum(w.distance_km, w.distance_km < 10 ? 1 : 0)} km` : ""}</span></span>
      ${w.training_load != null ? `<span class="m-load">${Math.round(w.training_load)}<small>Load</small></span>` : ""}</button>`).join("")
    : `<p class="m-empty">Noch keine Trainings. Verbinde Garmin oder importiere .fit-Dateien.</p>`;

  return mHeaderHtml(now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }), "Heute", mSyncPill())
    + `<section class="m-card m-hero" aria-label="Dein Zustand heute">${rings}</section>`
    + `<section class="m-card"><div class="m-head"><h2>Heute geplant</h2><button type="button" class="m-link" data-m-page="coach">Plan</button></div>${todayCard}</section>`
    + `<section class="m-card"><div class="m-head"><h2>Diese Woche</h2><button type="button" class="m-link" data-m-page="kalender">Kalender</button></div>
        <div class="m-days">${days}</div>
        <div class="m-week-num"><span><b>${mNum(doneMin / 60, 1)} h</b> von ${mNum(targetMin / 60, 1)} h</span><span>${weekWorkouts.length} Einheiten</span></div>
        <div class="m-bar" role="img" aria-label="Stunden je Sportart diese Woche">${bar}</div>${legend ? `<div class="m-legend">${legend}</div>` : ""}</section>`
    + formCard + goalCard
    + `<section class="m-card"><div class="m-head"><h2>Letzte ${mEsc(rangeLabel)}</h2><button type="button" class="m-chip" data-m-act="range" aria-label="Zeitraum ändern">${mEsc(rangeLabel)} ▾</button></div>
        <div class="m-stats">
          <div class="m-num"><small>Einheiten</small><b>${inRange.length}</b></div>
          <div class="m-num"><small>Zeit</small><b>${mNum(sum(inRange, "duration_min") / 60, 1)} h</b></div>
          <div class="m-num"><small>Load</small><b>${Math.round(sum(inRange, "training_load"))}</b></div>
          <div class="m-num"><small style="color:var(--m-swim)">Schwimmen</small><b>${mNum(km("Schwimmen"), 1)} km</b></div>
          <div class="m-num"><small style="color:var(--m-bike)">Rad</small><b>${mNum(km("Rad"), 0)} km</b></div>
          <div class="m-num"><small style="color:var(--m-run)">Laufen</small><b>${mNum(km("Laufen"), 0)} km</b></div>
        </div></section>`
    + `<section class="m-card"><div class="m-head"><h2>Letzte Einheiten</h2><button type="button" class="m-link" data-m-classic="overview" data-m-scroll="workouts">Alle</button></div><div class="m-list">${recentHtml}</div></section>`
    + `<button type="button" class="m-more" data-m-classic="overview">Alle Diagramme und Auswertungen</button>`;
}

function mRenderKalender() {
  const today = mDay(new Date());
  if (!mState.calMonth) mState.calMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  if (!mState.calWeek) mState.calWeek = mMonday(today);
  const m = mState.calMonth;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const done = new Map();
  mAllWorkouts().forEach(w => { const k = localDateStr(w._date); if (!done.has(k)) done.set(k, w.sport); });
  const plan = new Map();
  (typeof plannedWorkouts !== "undefined" ? plannedWorkouts : []).forEach(p => { if (p.status === "geplant" && !plan.has(p.date)) plan.set(p.date, p.sport); });
  let cells = mWeekdays.map(d => `<span class="m-wd">${d}</span>`).join("") + '<span class="m-mc empty"></span>'.repeat(lead);
  const weekKey = localDateStr(mState.calWeek), weekEnd = localDateStr(mAddDays(mState.calWeek, 6));
  for (let d = 1; d <= daysIn; d++) {
    const date = new Date(m.getFullYear(), m.getMonth(), d);
    const k = localDateStr(date);
    const sport = done.get(k) || plan.get(k);
    const cls = ["m-mc", k === localDateStr(today) ? "today" : "", date < today ? "past" : "", k >= weekKey && k <= weekEnd ? "inweek" : ""].join(" ");
    cells += `<button type="button" class="${cls}" data-m-act="cal-day" data-date="${k}"><b>${d}</b><i style="${sport ? `background:${mSport(sportGroup(sport) === "Sonstiges" ? sport : sportGroup(sport)).color}` : ""}${sport && !done.has(k) ? ";opacity:.5" : ""}"></i></button>`;
  }
  const agenda = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = mAddDays(mState.calWeek, i);
    const k = localDateStr(d);
    const items = [];
    mWorkoutsOn(d).forEach(w => items.push(`<button type="button" class="m-ev" data-m-act="workout" data-file="${mEsc(w.file || w.id || "")}"><span class="m-ev-stripe" style="background:${mSport(sportGroup(w.sport)).color}"></span>${mIcon(sportGroup(w.sport) === "Sonstiges" ? w.sport : sportGroup(w.sport), "sm")}<span class="m-grow"><span class="m-row-title">${mEsc(w.title || w.name || w.sport)}</span><span class="m-row-meta">${mDur(w.duration_min || 0)}${w.distance_km ? ` · ${mNum(w.distance_km, 1)} km` : ""}</span></span><span class="m-tag done">✓</span></button>`));
    mPlannedOn(k).filter(p => p.status !== "erledigt" || !mWorkoutsOn(d).length).forEach(p => items.push(`<button type="button" class="m-ev" data-m-act="plan" data-id="${mEsc(p.id)}"><span class="m-ev-stripe" style="background:${mSport(p.sport).color}"></span>${mIcon(p.sport, "sm")}<span class="m-grow"><span class="m-row-title">${mEsc(p.title || p.sport)}</span><span class="m-row-meta">${p.duration_min ? mDur(p.duration_min) : ""}${p.intensity ? ` · ${mEsc(p.intensity)}` : ""}</span></span><span class="m-tag ${p.status === "erledigt" ? "done" : p.status === "uebersprungen" ? "bad" : "plan"}">${p.status === "erledigt" ? "✓" : p.status === "uebersprungen" ? "übersprungen" : "geplant"}</span></button>`));
    return `<div class="m-ag-day${k === localDateStr(today) ? " today" : ""}"><div class="m-ag-date"><b>${mWeekdays[i]}</b><span>${d.getDate()}.</span></div>
      <div class="m-ag-items">${items.join("") || `<button type="button" class="m-ag-add" data-m-act="plan-new" data-date="${k}">${k < localDateStr(today) ? "–" : "+ Einheit"}</button>`}</div></div>`;
  }).join("");
  const wkNo = (() => { const d = new Date(mState.calWeek); d.setDate(d.getDate() + 3); const y = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - y) / 86400000 - 3 + ((y.getDay() + 6) % 7)) / 7); })();
  const weekMin = [0, 1, 2, 3, 4, 5, 6].reduce((s, i) => s + mWorkoutsOn(mAddDays(mState.calWeek, i)).reduce((a, w) => a + (w.duration_min || 0), 0), 0);
  return mHeaderHtml(`Woche ${wkNo} · ${mState.calWeek.toLocaleDateString("de-DE", { day: "numeric", month: "short" })} – ${mAddDays(mState.calWeek, 6).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}`, "Kalender",
    `<button type="button" class="m-icon" data-m-act="plan-new" data-date="${todayStr()}" aria-label="Neue Einheit">+</button>`)
    + `<section class="m-card"><div class="m-head"><h2>${m.toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</h2><span class="m-arrows"><button type="button" class="m-chip" data-m-act="month" data-dir="-1" aria-label="Vormonat">‹</button><button type="button" class="m-chip" data-m-act="month" data-dir="1" aria-label="Nächster Monat">›</button></span></div>
        <div class="m-month">${cells}</div></section>`
    + `<section class="m-card"><div class="m-head"><h2>Woche</h2><span class="m-arrows"><button type="button" class="m-chip" data-m-act="week" data-dir="-1" aria-label="Vorwoche">‹</button><span class="m-head-note">${mNum(weekMin / 60, 1)} h</span><button type="button" class="m-chip" data-m-act="week" data-dir="1" aria-label="Nächste Woche">›</button></span></div>
        <div class="m-agenda">${agenda}</div></section>`
    + `<button type="button" class="m-more" data-m-classic="calendar">Großer Kalender mit Wetter</button>`;
}

function mSeg(field, options, current) {
  return `<div class="m-seg" data-m-check="${field}">${options.map(o => `<button type="button" class="${o.value === current ? "on" : ""}" data-value="${o.value}">${mEsc(o.label)}</button>`).join("")}</div>`;
}

function mRenderCoach() {
  const rc = typeof recoveryCheck !== "undefined" ? recoveryCheck : {};
  const sore = RECOVERY_SORENESS_OPTIONS;
  const energy = RECOVERY_ENERGY_OPTIONS.map(o => ({ ...o, label: { low: "Leer", reduced: "Mäßig", normal: "Normal", high: "Top" }[o.value] || o.label }));
  const inj = [{ value: "no", label: "Nein" }, { value: "yes", label: "Ja" }];
  const so = rc.soreness;
  const en = rc.energy;

  let say;
  if (typeof outlook !== "undefined" && outlook.loading) say = `<p class="m-say muted">Claude denkt nach …</p>`;
  else if (typeof outlook !== "undefined" && outlook.result && outlook.result.heute && outlook.result.heute.empfehlung) {
    const h = outlook.result.heute, w = outlook.result.diese_woche || {};
    say = `<p class="m-say">${mEsc(h.empfehlung)}</p>${h.begruendung ? `<p class="m-say small">${mEsc(h.begruendung)}</p>` : ""}${w.empfehlung ? `<p class="m-say small"><b>Diese Woche:</b> ${mEsc(w.empfehlung)}</p>` : ""}`;
  } else if (typeof outlook !== "undefined" && outlook.error) say = `<p class="m-say bad">${mEsc(outlook.error)}</p>`;
  else say = `<p class="m-say muted">Tippe auf „Neu“, dann sagt dir der Coach, was heute und diese Woche passt.</p>`;

  const goal = typeof getPrimaryGoal === "function" ? getPrimaryGoal() : null;
  const ready = goal && typeof computeRaceReadiness === "function" ? computeRaceReadiness(goal) : null;
  const goalCard = goal && goal.date ? `<section class="m-card"><div class="m-goal">${mRing(ready ? ready.score / 100 : 0, "var(--m-r2)", ready ? ready.score : "–", "Readiness", "sm")}
      <div class="m-grow"><b>${mEsc(goal.name)}</b><small>${Math.round((mDay(goal.date + "T00:00:00") - mDay(new Date())) / 86400000)} Tage · ${goal.targetTime ? `Ziel ${mEsc(goal.targetTime)}` : "keine Zielzeit"}</small>
      ${ready && ready.level ? `<small>${mEsc(ready.level.label)}</small>` : ""}</div></div></section>` : "";

  const today = todayStr();
  const next = (typeof plannedWorkouts !== "undefined" ? plannedWorkouts : []).filter(p => p.date >= today && p.status === "geplant").sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
  const nextHtml = next.length ? next.map(p => `<button type="button" class="m-row" data-m-act="plan" data-id="${mEsc(p.id)}">${mIcon(p.sport)}<span class="m-grow"><span class="m-row-title">${new Date(p.date + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short" })} · ${mEsc(p.title || p.sport)}</span><span class="m-row-meta">${p.duration_min ? mDur(p.duration_min) : ""}${p.description ? ` · ${mEsc(p.description.split(/[.\n]/)[0]).slice(0, 50)}` : ""}</span></span>${p.intensity ? `<span class="m-tag ${p.intensity}">${mEsc(p.intensity)}</span>` : ""}</button>`).join("")
    : `<p class="m-empty">Noch nichts geplant.</p>`;

  return mHeaderHtml("Dein Coach", "Coach", typeof claudeAvailable === "function" && claudeAvailable() ? `<span class="m-pill"><i></i>Claude</span>` : "")
    + `<section class="m-card"><div class="m-head"><h2>Wie fühlst du dich?</h2><span class="m-head-note">heute</span></div>
        <div class="m-check"><span>Muskelkater</span>${mSeg("soreness", sore, so)}</div>
        <div class="m-check"><span>Energie</span>${mSeg("energy", energy, en)}</div>
        <div class="m-check"><span>Verletzung</span>${mSeg("injury", inj, rc.injury || "no")}</div></section>`
    + `<section class="m-card"><div class="m-head"><h2>Empfehlung</h2><button type="button" class="m-link" data-m-act="outlook">${typeof outlook !== "undefined" && outlook.loading ? "…" : "Neu"}</button></div>${say}</section>`
    + goalCard
    + `<section class="m-card"><div class="m-head"><h2>Nächste Einheiten</h2><button type="button" class="m-link" data-m-classic="coach" data-m-scroll="trainingplan">Plan bearbeiten</button></div><div class="m-list">${nextHtml}</div></section>`
    + `<button type="button" class="m-more" data-m-classic="coach">Ganzer Coach-Bereich</button>`;
}

// Geplante Kraft-/Mobility-Einheit, die gerade unter "Training" gezeigt wird
// (aus Kalender, Übersicht oder Coach angetippt).
function mPlannedFocus(sport) {
  const pw = mState.planId ? (plannedWorkouts || []).find(p => p.id === mState.planId) : null;
  return pw && pw.sport === sport ? pw : null;
}

function mWhenLabel(pw) {
  if (pw.date === todayStr()) return "Heute geplant";
  return `Geplant: ${new Date(pw.date + "T12:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "short" })}`;
}

function mOpenPlannedTraining(pw) {
  mState.planId = pw.id;
  mState.sub = pw.sport === "Kraft" ? "kraft" : "mobility";
  mShow("training");
}

function mStrengthSession() {
  const today = todayStr();
  const last = strengthState.history[strengthState.history.length - 1];
  const rules = () => buildStrengthSession({ tp: trainingProfile(), today, lastIds: last ? last.exercises || [] : [] });
  const focus = mPlannedFocus("Kraft");
  if (focus) {
    const fromPlan = plannedToStrengthSession(focus);
    if (fromPlan) return { session: fromPlan, when: mWhenLabel(focus), planned: focus };
    // Plan ohne Übungen aus der Sammlung: passende Einheit zusammenstellen, die den Plan abhakt.
    const s = rules();
    return s ? { session: { ...s, title: focus.title || s.title, plannedId: focus.id }, when: mWhenLabel(focus), planned: focus, filled: true } : null;
  }
  const planned = (typeof plannedWorkouts !== "undefined" ? plannedWorkouts : [])
    .filter(p => p.sport === "Kraft" && p.status === "geplant" && p.date >= today).sort((a, b) => a.date.localeCompare(b.date))
    .map(p => ({ p, s: plannedToStrengthSession(p) })).find(x => x.s);
  if (planned) return { session: planned.s, when: mWhenLabel(planned.p), planned: planned.p };
  const s = rules();
  return s ? { session: s, when: "Vorschlag für dich" } : null;
}

function mMobilitySession() {
  const focus = mPlannedFocus("Mobility");
  if (focus) {
    const fromPlan = plannedToMobilitySession(focus);
    if (fromPlan) return { session: fromPlan, label: mWhenLabel(focus), planned: focus };
    const rules = mobRulesSession();
    if (rules) return { session: { ...rules, title: focus.title || rules.title, plannedId: focus.id }, label: mWhenLabel(focus), planned: focus, filled: true };
  }
  const { session, kind } = mobActiveSession();
  const label = { claude: "Von Claude für dich", planned: "Heute eingeplant", saved: "Für dich heute", rules: "Für dich heute" }[kind] || "Für dich heute";
  return { session, label, planned: null };
}

// Kopfzeile über dem Training, wenn es aus dem Plan kommt.
function mPlanBanner(k) {
  if (!k || !k.planned) return "";
  return `<div class="m-planbar"><span>${k.filled ? "Im Plan standen keine Übungen aus der Sammlung – passend dazu zusammengestellt." : `Aus deinem Plan · ${mEsc(k.planned.title || k.planned.sport)}`}</span>
    <span class="m-planbar-act"><button type="button" class="m-link" data-m-act="plan-details" data-id="${mEsc(k.planned.id)}">Details</button>${mState.planId ? `<button type="button" class="m-link" data-m-act="plan-clear">Anderes Training</button>` : ""}</span></div>`;
}

function mRenderTraining() {
  const seg = `<div class="m-subseg" role="tablist" aria-label="Training"><button type="button" class="${mState.sub === "mobility" ? "on" : ""}" data-m-sub="mobility" role="tab" aria-selected="${mState.sub === "mobility"}">Mobility</button><button type="button" class="${mState.sub === "kraft" ? "on" : ""}" data-m-sub="kraft" role="tab" aria-selected="${mState.sub === "kraft"}">Kraft</button></div>`;
  if (mState.sub === "kraft") {
    const k = mStrengthSession();
    if (!k) return mHeaderHtml("Kraft", "Training") + seg + `<section class="m-card"><p class="m-empty">Mit deinen Hilfsmitteln passt gerade keine Übung. Trag im Trainingsprofil ein, was du zu Hause hast.</p><div class="m-actions"><button type="button" class="m-btn soft" data-m-act="profile">Trainingsprofil</button></div></section>`;
    const s = k.session;
    const rows = s.exercises.map((x, i) => {
      const ex = STRENGTH_BY_ID[x.id];
      return `<button type="button" class="m-row" data-m-act="strength-detail" data-id="${ex.id}"><span class="m-fig-sm" data-m-fig="s:${ex.id}"></span><span class="m-grow"><span class="m-row-title">${mEsc(ex.name)}</span><span class="m-row-meta">${x.sets} × ${mEsc(ex.hold ? `${x.hold || ex.hold} s` : x.reps || ex.reps)}${ex.weight && (x.kg != null ? x.kg : strengthWeight(ex.id)) > 0 ? ` · ${mNum(x.kg != null ? x.kg : strengthWeight(ex.id), 1).replace(",0", "")} kg` : ""}</span></span><span class="m-tag plan">${mEsc(STRENGTH_AREAS[ex.areas[0]])}</span></button>`;
    }).join("");
    const needs = [...new Set(s.exercises.flatMap(x => STRENGTH_BY_ID[x.id].equipment))].map(e => MOBILITY_EQUIPMENT[e].split(" ")[0]);
    return mHeaderHtml(k.when, "Training") + seg + mPlanBanner(k)
      + `<section class="m-card m-hero-ex"><div class="m-fig-lg" data-m-fig="s:${s.exercises[0].id}"></div>
          <div><b class="m-hero-title">${mEsc(s.title)}</b><small class="m-row-meta">${s.minutes || Math.round(strengthSessionSeconds(s) / 60)} min · ${s.exercises.length} Übungen${needs.length ? ` · ${mEsc(needs.join(" & "))}` : " · ohne Geräte"}</small></div>
          <button type="button" class="m-btn primary wide" data-m-act="start-strength-now">Training starten</button></section>`
      + `<section class="m-card"><div class="m-head"><h2>Übungen</h2><button type="button" class="m-link" data-m-act="profile">Hilfsmittel</button></div><div class="m-list">${rows}</div></section>`;
  }
  const mk = mMobilitySession();
  const session = mk.session;
  if (!session) return mHeaderHtml("Mobility", "Training") + seg + `<section class="m-card"><p class="m-empty">Mit deinem Trainingsprofil passt gerade keine Übung.</p><div class="m-actions"><button type="button" class="m-btn soft" data-m-act="profile">Trainingsprofil</button></div></section>`;
  const rows = session.exercises.filter(x => MOBILITY_BY_ID[x.id]).map(x => {
    const ex = MOBILITY_BY_ID[x.id];
    return `<button type="button" class="m-row" data-m-act="mob-detail" data-id="${ex.id}"><span class="m-fig-sm" data-m-fig="m:${ex.id}"></span><span class="m-grow"><span class="m-row-title">${mEsc(ex.name)}</span><span class="m-row-meta">${mEsc(mobExerciseMeta(ex, x.seconds))} · ${mEsc(MOBILITY_AREAS[ex.areas[0]])}</span></span></button>`;
  }).join("");
  return mHeaderHtml(mk.label, "Training") + seg + mPlanBanner(mk)
    + `<section class="m-card m-hero-ex"><div class="m-fig-lg" data-m-fig="m:${session.exercises[0].id}"></div>
        <div><b class="m-hero-title">${mEsc(session.title)}</b><small class="m-row-meta">${Math.max(1, Math.round(mobilitySessionSeconds(session) / 60))} min · ${session.exercises.length} Übungen</small></div>
        <button type="button" class="m-btn primary wide" data-m-act="start-mob-now">Starten</button>
        ${!mk.planned && typeof claudeAvailable === "function" && claudeAvailable() ? `<button type="button" class="m-btn ghost wide" data-m-act="mob-claude">${mState.busy ? "Claude stellt zusammen …" : "Mit Claude anpassen"}</button>` : ""}</section>`
    + `<section class="m-card"><div class="m-head"><h2>Ablauf</h2><button type="button" class="m-link" data-m-classic="mobility">Alle Übungen</button></div><div class="m-list">${rows}</div></section>`;
}

function mRenderMehr() {
  const rows = [["nutrition", "Ernährung"], ["records", "Rekorde"], ["analysis", "Analyse"], ["overview", "Alle Diagramme"], ["settings", "Einstellungen"]];
  return mHeaderHtml("Weitere Bereiche", "Mehr")
    + `<section class="m-card m-navlist">${rows.map(([v, l]) => `<button type="button" class="m-nav-row" data-m-classic="${v}"><span>${l}</span><i>›</i></button>`).join("")}</section>`
    + `<section class="m-card m-navlist"><button type="button" class="m-nav-row" data-m-act="profile"><span>Dein Trainingsprofil</span><i>›</i></button>
        <button type="button" class="m-nav-row" data-m-act="m-off"><span>Klassische Ansicht verwenden</span><i>›</i></button></section>`;
}

/* ------------------------------------------------------------ Rahmen */

function mFillFigures(root) {
  root.querySelectorAll("[data-m-fig]").forEach(el => {
    const [kind, id] = el.dataset.mFig.split(":");
    const ex = kind === "s" ? STRENGTH_BY_ID[id] : MOBILITY_BY_ID[id];
    if (ex && !el.firstChild) el.appendChild(createMobilityFigure(ex, { animate: true, label: false }));
  });
}

let mRenderTimer = null;
function mScheduleRender() {
  if (!mActive()) return;
  clearTimeout(mRenderTimer);
  mRenderTimer = setTimeout(renderMApp, 60);
}

// Farbe der Safari-Leisten oben/unten an die dunkle Ansicht anpassen.
function mThemeColor(active) {
  let meta = document.getElementById("m-theme-color");
  if (active && !meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.id = "m-theme-color";
    document.head.appendChild(meta);
  }
  if (meta) { if (active) meta.content = "#0c0d0f"; else meta.remove(); }
  // Die festen hell/dunkel-Einträge würden sonst Vorrang haben.
  document.querySelectorAll('meta[name="theme-color"][media]').forEach(m => {
    if (active) { if (!m.dataset.mMedia) m.dataset.mMedia = m.media; m.media = "not all"; }
    else if (m.dataset.mMedia) { m.media = m.dataset.mMedia; delete m.dataset.mMedia; }
  });
}

function renderMApp() {
  const host = document.getElementById("m-app");
  if (!host) return;
  const active = mActive();
  document.body.classList.toggle("m-graphit", active);
  document.documentElement.classList.toggle("m-graphit-root", active);
  mThemeColor(active);
  document.body.classList.toggle("m-classic", active && !!mState.classic);
  if (!active) { host.hidden = true; return; }
  host.hidden = !!mState.classic;
  document.querySelectorAll("#m-tabs button").forEach(b => {
    const on = !mState.classic && b.dataset.mPage === mState.page;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if (mState.classic) return;
  const body = document.getElementById("m-body");
  const html = { heute: mRenderHeute, kalender: mRenderKalender, coach: mRenderCoach, training: mRenderTraining, mehr: mRenderMehr }[mState.page]();
  body.innerHTML = html;
  mFillFigures(body);
}

function mShow(page) {
  mState.page = page;
  mState.classic = null;
  renderMApp();
  window.scrollTo({ top: 0 });
}

// Bisherige Seite öffnen (Ernährung, Rekorde ...) - mit Zurück-Leiste oben.
function mOpenClassic(view, scrollTo) {
  mState.classic = view;
  if (view === "settings") openSettingsView(); else activateView(view);
  renderMApp();
  const title = document.getElementById("m-classic-title");
  if (title) title.textContent = { overview: "Alle Diagramme", nutrition: "Ernährung", records: "Rekorde", analysis: "Analyse", settings: "Einstellungen", coach: "Coach", calendar: "Kalender", mobility: "Mobility" }[view] || "";
  window.scrollTo({ top: 0 });
  if (scrollTo) {
    const el = document.querySelector(`[data-card-id="${scrollTo}"]`);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
  }
}

function mBack() {
  mState.classic = null;
  activateView("overview");
  renderMApp();
  window.scrollTo({ top: 0 });
}

async function mAction(btn) {
  const act = btn.dataset.mAct;
  const id = btn.dataset.id;
  if (act === "plan" && id) {
    const pw = plannedWorkouts.find(p => p.id === id);
    if (pw && (pw.sport === "Kraft" || pw.sport === "Mobility")) mOpenPlannedTraining(pw);
    else mPlanSheet(id);
  }
  else if (act === "plan-details" && id) mPlanSheet(id);
  else if (act === "plan-clear") { mState.planId = null; renderMApp(); }
  else if (act === "plan-new") openPlanEdit(null, { date: btn.dataset.date || todayStr() });
  else if (act === "workout") {
    const w = mAllWorkouts().find(x => String(x.file || x.id || "") === btn.dataset.file);
    if (w) openDetail(w);
  } else if (act === "range") {
    const i = M_RANGES.findIndex(r => r[0] === mState.range);
    mState.range = M_RANGES[(i + 1) % M_RANGES.length][0];
    renderMApp();
  } else if (act === "cal-day") {
    const d = new Date(btn.dataset.date + "T12:00:00");
    mState.calWeek = mMonday(d);
    mState.calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    if (mState.page !== "kalender") mShow("kalender"); else renderMApp();
  } else if (act === "month") {
    const m = mState.calMonth;
    mState.calMonth = new Date(m.getFullYear(), m.getMonth() + Number(btn.dataset.dir), 1);
    renderMApp();
  } else if (act === "week") {
    mState.calWeek = mAddDays(mState.calWeek, 7 * Number(btn.dataset.dir));
    mState.calMonth = new Date(mState.calWeek.getFullYear(), mState.calWeek.getMonth(), 1);
    renderMApp();
  } else if (act === "outlook") {
    if (typeof generateOutlook !== "function" || outlook.loading) return;
    const p = generateOutlook();
    renderMApp();
    await p;
    renderMApp();
  } else if (act === "start-mob" && id) {
    const pw = plannedWorkouts.find(p => p.id === id);
    if (pw) startPlannedMobility(pw);
  } else if (act === "start-mob-now") {
    const { session } = mMobilitySession();
    if (session) startMobilitySession(session);
  } else if (act === "mob-detail" && id) openMobilityDetail(id);
  else if (act === "mob-claude") {
    if (mState.busy) return;
    mState.busy = true;
    renderMApp();
    try { await mobGenerateWithClaude(); } finally { mState.busy = false; renderMApp(); }
  } else if (act === "start-strength" && id) {
    const pw = plannedWorkouts.find(p => p.id === id);
    const s = pw ? plannedToStrengthSession(pw) : null;
    if (s) mStartStrength(s);
  } else if (act === "start-strength-now") {
    const k = mStrengthSession();
    if (k) mStartStrength(k.session);
  } else if (act === "strength-detail" && id) mStrengthDetail(id);
  else if (act === "profile") { mState.classic = "settings"; openTrainingProfile(); renderMApp(); }
  else if (act === "garmin") { mState.classic = "settings"; openSettingsView(); renderMApp(); const c = document.getElementById("garmin-settings-card"); if (c) c.scrollIntoView({ block: "start" }); }
  else if (act === "garmin-sync") {
    try { await startGarminSync(); } catch (e) {
      mState.classic = "settings"; openSettingsView(); renderMApp();
      const c = document.getElementById("garmin-settings-card"); if (c) c.scrollIntoView({ block: "start" });
    }
    renderMApp();
  }
  else if (act === "m-off") {
    try { localStorage.setItem(M_KEY, "off"); } catch (e) { /* nur Komfort */ }
    mState.classic = null;
    renderMApp();
    syncMSwitch();
  }
}

function mStartStrength(session) {
  openMobilityPlayer({ ...session, exercises: session.exercises.map(x => ({ ...x })) }, {
    onFinish: res => {
      addStrengthHistory(res);
      if (session.plannedId) updatePlannedWorkout(session.plannedId, { status: "erledigt" });
      if (session.plannedId && mState.planId === session.plannedId) mState.planId = null;
      renderMApp();
    },
  });
}

// Anleitung einer Kraftübung - dasselbe Fenster wie bei Mobility.
function mStrengthDetail(id) {
  const ex = STRENGTH_BY_ID[id];
  if (!ex) return;
  const overlay = document.createElement("div");
  overlay.className = "mob-sheet-overlay";
  overlay.innerHTML = `<div class="mob-sheet" role="dialog" aria-modal="true" aria-label="${mEsc(ex.name)}">
      <div class="mob-sheet-grabber" aria-hidden="true"></div>
      <button type="button" class="mob-icon-btn mob-sheet-close" aria-label="Schließen">${MOB_ICONS.close}</button>
      <div class="mob-sheet-fig"></div>
      <h2 class="mob-sheet-title">${mEsc(ex.name)}</h2>
      <p class="mob-sheet-meta">${ex.sets} × ${mEsc(ex.hold ? `${ex.hold} s` : ex.reps)} · Pause ${ex.rest} s${ex.equipment.length ? " · " + mEsc(ex.equipment.map(e => MOBILITY_EQUIPMENT[e]).join(", ")) : ""}</p>
      <h3>So geht's</h3><ol class="mob-steps">${ex.steps.map(s => `<li>${mEsc(s)}</li>`).join("")}</ol>
      <h3>Das spürst du</h3><p>${mEsc(ex.feel)}</p>
      <h3>Achte darauf</h3><ul class="mob-mistakes">${ex.mistakes.map(s => `<li>${mEsc(s)}</li>`).join("")}</ul>
      <div class="mob-variants"><div class="mob-variant"><span class="mob-variant-label">Leichter</span><p>${mEsc(ex.easier)}</p></div><div class="mob-variant"><span class="mob-variant-label">Schwerer</span><p>${mEsc(ex.harder)}</p></div></div>
      <div class="mob-sheet-actions"><a class="mob-btn mob-btn-secondary" href="${mobilityVideoUrl(ex)}" target="_blank" rel="noopener">Video ansehen ↗</a></div>
    </div>`;
  overlay.querySelector(".mob-sheet-fig").appendChild(createMobilityFigure(ex, { animate: true }));
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  const close = () => { overlay.classList.remove("is-open"); setTimeout(() => overlay.remove(), 250); };
  overlay.addEventListener("click", e => { if (e.target === overlay || e.target.closest(".mob-sheet-close")) close(); });
}

/* ------------------------------------------------------------ Geplante Einheit */

const M_STEP_COLOR = { warmup: "var(--m-muted)", cooldown: "var(--m-muted)", recovery: "var(--m-good)", rest: "var(--m-good)" };

// Schritte flach machen (Wiederholungen ausschreiben) - für die Zeitleiste.
function mFlatSteps(steps) {
  const out = [];
  steps.forEach(s => {
    if (s.type === "repeat") for (let i = 0; i < (s.count || 1); i++) s.steps.forEach(x => out.push(x));
    else out.push(s);
  });
  return out;
}

function mStepTarget(s) {
  return s.target && s.target.kind && s.target.kind !== "none" ? `${WORKOUT_TARGET_LABELS[s.target.kind].replace(/-?Zone$/, "").replace("Leistungszone", "Leistung").trim()} Zone ${s.target.zone}` : "";
}

function mStepAmount(s) {
  return s.duration_min ? mDur(s.duration_min) : s.distance_km ? `${mNum(s.distance_km, s.distance_km < 1 ? 2 : 1)} km` : "bis Runde";
}

// Kurzform für Listen: "15′ Aufwärmen · 45′ Zone 2 · 10′ Abwärmen"
function mStepSummary(p) {
  if (!["Laufen", "Rad", "Schwimmen"].includes(p.sport) || typeof plannedWorkoutSteps !== "function") return "";
  return plannedWorkoutSteps(p).map(s => s.type === "repeat" ? `${s.count}× ${s.steps.map(x => mStepAmount(x)).join("/")}`
    : `${s.duration_min ? `${Math.round(s.duration_min)}′` : mStepAmount(s)} ${s.type === "interval" && mStepTarget(s) ? mStepTarget(s).replace(/^HF /, "") : WORKOUT_STEP_LABELS[s.type]}`).join(" · ");
}

// Beschreibung in kurze Punkte teilen: an Satzenden (nicht nach "ca.",
// "z. B." ...), lange Sätze zusätzlich an Kommas außerhalb von Klammern.
// Bewusst ohne Lookbehind im RegExp (ältere iPhones kennen das nicht).
const M_ABBR = /(?:^|[\s(])(?:ca|bzw|z|B|u|a|ggf|evtl|inkl|max|min|mind|ggü|vgl|Nr|bspw)\.$/i;
function mNoteParts(text) {
  const out = [];
  String(text || "").split(/\n+/).forEach(line => {
    let cur = "";
    for (let i = 0; i < line.length; i++) {
      cur += line[i];
      if (/[.!?]/.test(line[i]) && /\s/.test(line[i + 1] || "") && /[A-ZÄÖÜ0-9]/.test((line.slice(i + 1).trim()[0]) || "") && !M_ABBR.test(cur)) { out.push(cur); cur = ""; }
    }
    if (cur.trim()) out.push(cur);
  });
  return out.flatMap(sentence => {
    const t = sentence.trim();
    if (t.length <= 90) return [t.replace(/\.$/, "")];
    const parts = []; let cur = "", depth = 0;
    for (const ch of t) {
      if (ch === "(") depth++; else if (ch === ")") depth = Math.max(0, depth - 1);
      if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
    }
    parts.push(cur);
    return parts.map(x => x.trim().replace(/\.$/, "")).filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1));
  }).filter(Boolean);
}

function mPlanSheetHtml(p) {
  const date = new Date(p.date + "T12:00:00");
  const today = p.date === todayStr();
  const sport = mSport(p.sport);
  const head = `<div class="m-sh-head">${mIcon(p.sport, "lg")}<div class="m-grow">
      <div class="m-kicker">${today ? "Heute" : mEsc(date.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }))} · ${mEsc(p.sport)}</div>
      <h2 class="m-sh-title">${mEsc(p.title || p.sport)}</h2></div></div>
    <div class="m-sh-facts">
      ${p.duration_min ? `<div class="m-num"><small>Dauer</small><b>${mDur(p.duration_min)}</b></div>` : ""}
      ${p.intensity ? `<div class="m-num"><small>Intensität</small><b class="m-int ${mEsc(p.intensity)}">${mEsc(p.intensity[0].toUpperCase() + p.intensity.slice(1))}</b></div>` : ""}
      <div class="m-num"><small>Status</small><b class="${p.status === "erledigt" ? "good" : p.status === "uebersprungen" ? "bad" : ""}">${p.status === "erledigt" ? "Erledigt" : p.status === "uebersprungen" ? "Übersprungen" : "Geplant"}</b></div>
    </div>`;

  let flow = "";
  const endurance = ["Laufen", "Rad", "Schwimmen"].includes(p.sport);
  if (endurance && typeof plannedWorkoutSteps === "function") {
    const steps = plannedWorkoutSteps(p);
    const flat = mFlatSteps(steps);
    const total = flat.reduce((a, s) => a + (s.duration_min || (s.distance_km ? s.distance_km * 6 : 3)), 0) || 1;
    const bar = flat.map(s => `<span style="flex:${(s.duration_min || (s.distance_km ? s.distance_km * 6 : 3)) / total};background:${M_STEP_COLOR[s.type] || sport.color}"></span>`).join("");
    const rows = steps.map(s => {
      if (s.type === "repeat") {
        return `<li class="m-step"><i style="background:${sport.color}"></i><div class="m-grow"><b>${s.count}× wiederholen</b>
          ${s.steps.map(x => `<span class="m-row-meta">${mEsc(WORKOUT_STEP_LABELS[x.type])} · ${mStepAmount(x)}${mStepTarget(x) ? ` · ${mEsc(mStepTarget(x))}` : ""}</span>`).join("")}</div></li>`;
      }
      return `<li class="m-step"><i style="background:${M_STEP_COLOR[s.type] || sport.color}"></i><div class="m-grow"><b>${mEsc(WORKOUT_STEP_LABELS[s.type])}</b>${mStepTarget(s) ? `<span class="m-row-meta">${mEsc(mStepTarget(s))}</span>` : ""}</div><span class="m-step-amt">${mStepAmount(s)}</span></li>`;
    }).join("");
    flow = `<section class="m-card"><div class="m-head"><h2>Ablauf</h2><span class="m-head-note">so läuft es auf der Uhr</span></div>
      <div class="m-flowbar" aria-hidden="true">${bar}</div><ol class="m-steps">${rows}</ol></section>`;
  } else if ((p.exercises || []).length) {
    const lib = p.sport === "Kraft" && typeof STRENGTH_BY_ID !== "undefined" ? STRENGTH_BY_ID : p.sport === "Mobility" && typeof MOBILITY_BY_ID !== "undefined" ? MOBILITY_BY_ID : {};
    flow = `<section class="m-card"><div class="m-head"><h2>Übungen</h2></div><div class="m-list">${p.exercises.map(x => {
      const ex = x.id && lib[x.id];
      const amount = x.sets ? `${x.sets} × ${x.reps || ""}` : x.seconds ? `${x.seconds} s` : x.reps || "";
      return `<div class="m-row">${ex ? `<span class="m-fig-sm" data-m-fig="${p.sport === "Kraft" ? "s" : "m"}:${ex.id}"></span>` : mIcon(p.sport, "sm")}<span class="m-grow"><span class="m-row-title">${mEsc(ex ? ex.name : x.name)}</span>${amount || x.note ? `<span class="m-row-meta">${mEsc(amount)}${x.note ? `${amount ? " · " : ""}${mEsc(x.note)}` : ""}</span>` : ""}</span></div>`;
    }).join("")}</div></section>`;
  }

  const sentences = mNoteParts(p.description);
  const notes = sentences.length ? `<section class="m-card"><div class="m-head"><h2>Worauf es ankommt</h2></div><ul class="m-notes">${sentences.map(t => `<li>${mEsc(t)}</li>`).join("")}</ul></section>` : "";

  const st = typeof garminSendState !== "undefined" ? garminSendState.get(p.id) || {} : {};
  let primary = "";
  if (p.sport === "Kraft" && typeof plannedToStrengthSession === "function" && plannedToStrengthSession(p)) primary = `<button type="button" class="m-btn primary wide" data-sh="strength">Mitmachen</button>`;
  else if (p.sport === "Mobility" && typeof plannedToMobilitySession === "function" && plannedToMobilitySession(p)) primary = `<button type="button" class="m-btn primary wide" data-sh="mobility">Starten</button>`;
  else if (typeof canSendToGarmin === "function" && canSendToGarmin(p)) {
    primary = `<button type="button" class="m-btn primary wide" data-sh="garmin"${st.loading ? " disabled" : ""}>${st.loading ? "Sende an Garmin …" : p.garminSentAt ? "Erneut an Garmin senden" : "An Garmin senden"}</button>`
      + (st.error ? `<p class="m-say bad small">${mEsc(st.error)}</p><button type="button" class="m-btn ghost wide" data-sh="fit">Stattdessen als .fit-Datei laden</button>`
        : p.garminSentAt ? `<p class="m-sh-note">✓ Gesendet am ${mEsc(new Date(p.garminSentAt).toLocaleDateString("de-DE", { day: "numeric", month: "short" }))} – nach dem nächsten Sync auf der Uhr.</p>` : "");
  }
  const done = p.status === "erledigt";
  const actions = `<div class="m-sh-actions">${primary}
      <div class="m-sh-row">
        <button type="button" class="m-btn soft" data-sh="edit">Bearbeiten</button>
        <button type="button" class="m-btn soft" data-sh="${done ? "open" : "done"}">${done ? "Wieder offen" : "Erledigt"}</button>
      </div>
      ${!done && p.status !== "uebersprungen" ? `<button type="button" class="m-btn ghost wide" data-sh="skip">Überspringen</button>` : ""}</div>`;
  return head + flow + notes + actions;
}

function mPlanSheet(id) {
  const p = plannedWorkouts.find(x => x.id === id);
  if (!p) return;
  document.querySelectorAll(".m-sheet-overlay").forEach(el => el.remove());
  const overlay = document.createElement("div");
  overlay.className = "m-sheet-overlay";
  overlay.innerHTML = `<div class="m-sheet" role="dialog" aria-modal="true" aria-label="${mEsc(p.title || p.sport)}">
      <div class="m-sheet-bar"><span class="m-sheet-grab" aria-hidden="true"></span><button type="button" class="m-icon m-sheet-close" aria-label="Schließen">×</button></div>
      <div class="m-sheet-body"></div></div>`;
  document.body.appendChild(overlay);
  document.body.classList.add("m-sheet-open");
  const body = overlay.querySelector(".m-sheet-body");
  const draw = () => {
    const cur = plannedWorkouts.find(x => x.id === id);
    if (!cur) { close(); return; }
    body.innerHTML = mPlanSheetHtml(cur);
    mFillFigures(body);
  };
  const close = () => {
    overlay.classList.remove("is-open");
    document.body.classList.remove("m-sheet-open");
    setTimeout(() => overlay.remove(), 250);
  };
  draw();
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  overlay.addEventListener("click", async e => {
    if (e.target === overlay || e.target.closest(".m-sheet-close")) { close(); return; }
    const btn = e.target.closest("[data-sh]");
    if (!btn) return;
    const act = btn.dataset.sh;
    const cur = plannedWorkouts.find(x => x.id === id);
    if (!cur) return;
    if (act === "edit") { close(); openPlanEdit(id); }
    else if (act === "strength") { close(); mStartStrength(plannedToStrengthSession(cur)); }
    else if (act === "mobility") { close(); startPlannedMobility(cur); }
    else if (act === "garmin") { const pr = sendToGarminFromUi(id); draw(); await pr; draw(); }
    else if (act === "fit") exportPlannedWorkoutAsFit(id);
    else if (act === "done" || act === "open" || act === "skip") {
      updatePlannedWorkout(id, { status: act === "done" ? "erledigt" : act === "skip" ? "uebersprungen" : "geplant" });
      if (typeof renderTrainingPlanCard === "function") renderTrainingPlanCard();
      draw();
      renderMApp();
    }
  });
  document.addEventListener("keydown", function onKey(e) {
    if (!overlay.isConnected) { document.removeEventListener("keydown", onKey); return; }
    if (e.key === "Escape") close();
  });
}

function syncMSwitch() {
  const sw = document.getElementById("m-graphit-switch");
  if (sw) sw.checked = mEnabled();
}

function initMApp() {
  const host = document.createElement("div");
  host.id = "m-app";
  host.hidden = true;
  host.innerHTML = `
    <nav class="m-tabs" id="m-tabs" aria-label="Bereiche">
      <button type="button" data-m-page="heute">Übersicht</button>
      <button type="button" data-m-page="kalender">Kalender</button>
      <button type="button" data-m-page="coach">Coach</button>
      <button type="button" data-m-page="training">Training</button>
      <button type="button" data-m-page="mehr">Mehr</button>
    </nav>
    <main id="m-body" class="m-body"></main>`;
  document.body.insertBefore(host, document.body.firstChild);
  const back = document.createElement("div");
  back.className = "m-backbar";
  back.innerHTML = `<button type="button" class="m-back" id="m-back">‹ Zurück</button><span id="m-classic-title"></span>`;
  document.body.insertBefore(back, document.body.firstChild);

  document.getElementById("m-back").addEventListener("click", mBack);
  host.addEventListener("click", e => {
    const tab = e.target.closest("[data-m-page]");
    if (tab) { mShow(tab.dataset.mPage); return; }
    const sub = e.target.closest("[data-m-sub]");
    if (sub) { mState.sub = sub.dataset.mSub; mState.planId = null; renderMApp(); return; }
    const classic = e.target.closest("[data-m-classic]");
    if (classic) { mOpenClassic(classic.dataset.mClassic, classic.dataset.mScroll); return; }
    const seg = e.target.closest("[data-m-check] button");
    if (seg) {
      const field = seg.closest("[data-m-check]").dataset.mCheck;
      recoveryCheck[field] = seg.dataset.value;
      saveRecoveryCheck();
      if (typeof renderRecoveryCheck === "function") renderRecoveryCheck();
      renderMApp();
      return;
    }
    const btn = e.target.closest("[data-m-act]");
    if (btn) mAction(btn);
  });
  host.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-m-page]")) { e.preventDefault(); mShow(e.target.dataset.mPage); }
  });

  // Schalter in den Einstellungen (Konto)
  const sw = document.getElementById("m-graphit-switch");
  if (sw) sw.addEventListener("change", () => {
    try { localStorage.setItem(M_KEY, sw.checked ? "on" : "off"); } catch (e) { /* nur Komfort */ }
    mState.classic = sw.checked ? "settings" : null;
    renderMApp();
  });
  syncMSwitch();

  // Neu zeichnen, wenn sich Daten ändern.
  const wrap = name => {
    const fn = window[name];
    if (typeof fn !== "function") return;
    window[name] = function (...args) { const r = fn.apply(this, args); mScheduleRender(); return r; };
  };
  ["savePlannedWorkouts", "saveMobilityState", "saveStrengthState", "renderAll", "renderOutlook"].forEach(wrap);
  if (typeof onGarminState === "function") onGarminState(() => mScheduleRender());
  if (window.matchMedia) window.matchMedia(M_QUERY).addEventListener("change", () => renderMApp());
  renderMApp();
}
