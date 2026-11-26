// Plan-Sicherheitsnetz: prüft den Trainingsplan regelmäßig gegen die aktuelle
// Verfassung und füllt leere Trainingstage. Rein deterministisch, kein UI,
// kein Speicherzugriff (alles kommt als Parameter herein) - testbar ohne
// Browser (tests/js/plan-guard.test.js). Den Ablauf (wann was geprüft wird,
// Speichern, Rückgängig, KI-Tages-Check) steuert js/components/plan-check.js.
//
// Drei Bausteine:
//   planGuardReadiness()  heute/morgen: bei schlechter Erholung leichter/kürzer/Ruhetag
//   planGuardAutofix()    Regelwerk (plan-rules.js): "block"-Verstöße im Zeitraum beheben
//   planGuardFill()       leere Trainingstage (Profil) mit einer lockeren Einheit füllen
// Die KI darf danach (plan-check.js) nur innerhalb dieser Grenzen ändern -
// leichter, kürzer oder Ruhetag, nie härter oder länger.

const PLAN_GUARD_DOW = ["so", "mo", "di", "mi", "do", "fr", "sa"];
const PLAN_GUARD_FILL_MIN = 20;        // kürzer lohnt sich nicht - dann lieber frei lassen
const PLAN_GUARD_DEFAULT_MIN = 45;     // ohne "typische Dauer" im Profil
const PLAN_GUARD_LONG_FACTOR = 1.5;    // an "lange Einheit"-Tagen
const PLAN_GUARD_LONG_MAX = 120;       // länger zählt als hart (plan-rules.js)
const PLAN_GUARD_EASY_FACTOR = 0.7;    // schlecht erholt: locker und ca. 30 % kürzer
const PLAN_GUARD_EASY_MIN = 30;
const PLAN_GUARD_EASY_MAX = 75;
const PLAN_GUARD_MILD_FACTOR = 0.8;    // nur Uhr-Werte auffällig: harte Einheit locker, 20 % kürzer
const PLAN_GUARD_SPORT_TITLE = { Schwimmen: "Lockeres Schwimmen", Rad: "Lockere Radeinheit", Laufen: "Lockerer Lauf" };
const PLAN_GUARD_INTENSITY_RANK = { leicht: 0, mittel: 1, hart: 2 };

const planGuardWeekday = key => PLAN_GUARD_DOW[new Date(key + "T00:00:00").getDay()];
const planGuardRound5 = x => Math.floor(x / 5) * 5;
const planGuardCopy = list => (list || []).map(p => ({ ...p }));

// Tage, an denen schon etwas steht: jede Planeinheit (auch übersprungen -
// das hat der Athlet so entschieden) und jedes echte Workout.
// trainingOnly: geplante Mobility zählt nicht - 15 min Dehnen sind kein
// Training, der Tag gilt dann noch als leerer Trainingstag. Für "komplett
// freier Tag" (Regelwerk) zählt dagegen alles.
// trainingOnly "main": auch Kraft zählt nicht (Wochenplan "Kraft/Mobility
// zusätzlich am Trainingstag" - ein Kraft-Tag bekommt trotzdem ein Haupttraining).
function planGuardBusyDays(list, history, trainingOnly = false) {
  const skip = trainingOnly === "main" ? ["Mobility", "Kraft"] : trainingOnly ? ["Mobility"] : [];
  const busy = new Set((list || []).filter(p => !skip.includes(p.sport)).map(p => p.date));
  (history || []).forEach(w => {
    const d = w._date || (w.date ? new Date(w.date) : null);
    if (d && !isNaN(d)) busy.add(localDateStr(d));
  });
  return busy;
}

// Leere Trainingstage im Zeitraum [from, to] (ab heute). Ausgenommen: Tage, die
// der Athlet bewusst frei haben will (freeDays), der Wettkampftag und der Tag davor.
// o: { from, to, todayKey, profile, freeDays, goal }
function planGuardGaps(list, history, o) {
  const days = (o.profile && o.profile.trainingDays) || [];
  if (!days.length) return [];
  // Kraft/Mobility "an eigenen Tagen": ein Tag mit Kraft oder Mobility ist belegt.
  const mode = o.profile.extrasMode === "own" ? false : o.profile.extrasMode === "same" ? "main" : true;
  const busy = planGuardBusyDays(list, history, mode);
  const free = o.freeDays || {};
  const out = [];
  for (let k = o.from; k <= o.to; k = planShiftDay(k, 1)) {
    if (k < o.todayKey || !days.includes(planGuardWeekday(k)) || busy.has(k) || free[k]) continue;
    if (o.goal && o.goal.date && (k === o.goal.date || k === planShiftDay(o.goal.date, -1))) continue;
    out.push(k);
  }
  return out;
}

// Wochenbudget in Minuten: Zielumfang der Periodisierung (getWeeklyTargets),
// höchstens die verfügbaren Stunden aus dem Profil. null = keine Grenze bekannt.
function planGuardWeekTarget(list, history, o, wk) {
  const limits = [];
  const period = o.goal && o.goal.date ? getWeeklyTargets(o.goal, list, history, o.today || new Date(o.todayKey + "T12:00:00")) : null;
  const week = period && period.weeks.find(w => w.weekStart === wk);
  if (week && week.targetMin != null) limits.push(week.targetMin);
  const hours = Number(o.profile && o.profile.weeklyHours);
  if (hours > 0) limits.push(Math.round(hours * 60));
  return limits.length ? Math.min(...limits) : null;
}

function planGuardWeekMinutes(list, history, todayKey, wk) {
  const days = new Set(planWeekDays(wk));
  return planMinutes(planSessions(list, history, todayKey).filter(s => days.has(s.date)));
}

// Sportart für eine Lücke: Schwimmen am Schwimmtag (und sonst nur dort, wenn
// Schwimmtage gesetzt sind), am "lange Einheit"-Tag Rad/Laufen, sonst die
// Ziel-Sportart mit den wenigsten Minuten in dieser Woche - möglichst nicht
// dieselbe wie am Vortag.
function planGuardSport(list, history, date, o) {
  const ownSports = o.goal ? goalRaceSports(o.goal) : [];
  const goalSports = ownSports.length ? ownSports : ["Laufen", "Rad", "Schwimmen"];
  const wd = planGuardWeekday(date);
  const swimDays = (o.profile && o.profile.swimDays) || [];
  const longDays = (o.profile && o.profile.longDays) || [];
  if (goalSports.includes("Schwimmen") && swimDays.includes(wd)) return "Schwimmen";
  let cands = goalSports.filter(sp => sp !== "Schwimmen" || !swimDays.length);
  if (longDays.includes(wd) && cands.some(sp => sp !== "Schwimmen")) cands = cands.filter(sp => sp !== "Schwimmen");
  if (!cands.length) cands = goalSports;
  const wkDays = new Set(planWeekDays(planWeekKey(date)));
  const sessions = planSessions(list, history, o.todayKey);
  const minutes = sp => planMinutes(sessions.filter(s => wkDays.has(s.date) && s.sport === sp));
  const prev = planShiftDay(date, -1);
  const yesterday = new Set(sessions.filter(s => s.date === prev).map(s => s.sport));
  return cands.slice().sort((a, b) => minutes(a) - minutes(b) || (yesterday.has(a) ? 1 : 0) - (yesterday.has(b) ? 1 : 0) || goalSports.indexOf(a) - goalSports.indexOf(b))[0];
}

// Schwimmen in Metern (wie die Schritte auf der Uhr), ohne Tempo-Vorgabe.
function planGuardSwimDescription(pw) {
  const m = typeof plannedSwimMeters === "function" ? plannedSwimMeters(pw) : null;
  const total = m ? `Zusammen etwa ${fmtSwimMeters(m)}: ` : "";
  return `${total}locker einschwimmen, ein paar Bahnen Technik, dann ruhig in längeren Stücken und zum Schluss ausschwimmen. So locker, dass du gleichmäßig atmen kannst.`;
}

function planGuardFillDescription(sport, long) {
  const what = long ? "Längere, ruhige Grundlage" : "Ruhige Grundlage";
  return `${what}: gleichmäßig locker, du kannst dich dabei noch unterhalten (Zone 2). Vom Plan-Check ergänzt, weil an diesem Trainingstag nichts geplant war.`;
}

// Füllt leere Trainingstage mit je einer lockeren Einheit. Grenzen:
// - mindestens ein freier Tag pro Woche bleibt (plan-rules.js Regel 3, nur Mobility/Yoga zählt als frei);
//   frei bleibt der Tag nach dem längsten Trainingstag,
// - das Wochenbudget (planGuardWeekTarget) wird nicht überschritten,
// - eine Einheit, die einen neuen "block"-Verstoß erzeugen würde, entfällt.
// o: { from, to, todayKey, today, profile, freeDays, goal, defaults, validate }
// Ergebnis: { list, added: [Einheit], skipped: [{ date, reason, target? }] }
//   reason: "rest" (freier Tag der Woche), "volume" (Wochenbudget erreicht), "rules"
function planGuardFill(list, history, o) {
  let cur = list.slice();
  const added = [], skipped = [];
  const gaps = planGuardGaps(cur, history, o);
  if (!gaps.length) return { list: cur, added, skipped };
  const weeks = new Map();
  gaps.forEach(k => { const wk = planWeekKey(k); weeks.set(wk, [...(weeks.get(wk) || []), k]); });
  const base = Number(o.profile.typicalSessionMin) > 0 ? Number(o.profile.typicalSessionMin) : PLAN_GUARD_DEFAULT_MIN;
  const longDays = o.profile.longDays || [];

  weeks.forEach((wkGaps, wk) => {
    // Freie Tage der Woche - Tage mit nur Mobility/Yoga/sehr wenig Belastung zählen als frei.
    const sessNow = planSessions(cur, history, o.todayKey);
    const freeCount = planWeekDays(wk).filter(k => planIsRestDay(sessNow.filter(s => s.date === k))).length;
    const fill = wkGaps.slice();
    const dayMin = k => planMinutes(planSessions(cur, history, o.todayKey).filter(s => s.date === k));
    while (fill.length && freeCount - fill.length < PLAN_MIN_FREE_DAYS) {
      const keep = fill.slice().sort((a, b) => dayMin(planShiftDay(b, -1)) - dayMin(planShiftDay(a, -1)) || b.localeCompare(a))[0];
      fill.splice(fill.indexOf(keep), 1);
      skipped.push({ date: keep, reason: "rest" });
    }
    const target = planGuardWeekTarget(cur, history, o, wk);
    fill.forEach((date, i) => {
      const long = longDays.includes(planGuardWeekday(date));
      let dur = long ? Math.min(PLAN_GUARD_LONG_MAX, planGuardRound5(base * PLAN_GUARD_LONG_FACTOR)) : base;
      if (target != null) {
        const left = target - planGuardWeekMinutes(cur, history, o.todayKey, wk);
        dur = Math.min(dur, planGuardRound5(left / (fill.length - i)));
      }
      if (dur < PLAN_GUARD_FILL_MIN) { skipped.push({ date, reason: "volume", target }); return; }
      const sport = planGuardSport(cur, history, date, o);
      const entry = buildPlannedWorkout({
        ...(o.defaults || {}), date, sport, title: PLAN_GUARD_SPORT_TITLE[sport] || `${sport} locker`,
        duration_min: dur, intensity: "leicht", description: planGuardFillDescription(sport, long), source: "guard",
      });
      if (sport === "Schwimmen") entry.description = planGuardSwimDescription(entry);
      const next = [...cur, entry];
      if (o.validate) {
        const fresh = newPlanViolations(o.validate(cur), o.validate(next)).filter(v => v.severity === "block");
        if (fresh.length) { skipped.push({ date, reason: "rules" }); return; }
      }
      cur = next;
      added.push(entry);
    });
  });
  return { list: cur, added, skipped };
}

// Heute/morgen an die Verfassung anpassen. Stufen:
// - Verletzung gemeldet: heute Ruhetag (Mobility bleibt), morgen nur locker.
// - Erschöpft, starker Muskelkater, ACWR > 1,3 oder Form (TSB) im roten
//   Bereich: heute und morgen alles Nicht-Lockere locker und ca. 30 % kürzer.
// - Nur Uhr-Werte auffällig (HRV, Ruhepuls, Temperatur, Atmung, Readiness):
//   heute eine harte Einheit locker und 20 % kürzer; morgen wird neu gemessen.
// o: { todayKey, gate (planRecoveryGate), signs (planWellnessSigns), strain: [Text], skipIds: [id] }
// Ergebnis: { list, changes: [{ id, date, kind: "easier"|"rest", reason, before }] }
function planGuardReadiness(list, o) {
  const tomorrow = planShiftDay(o.todayKey, 1);
  const skip = new Set(o.skipIds || []);
  const strong = [...(o.gate.reasons || []).filter(r => !/Verletzung/.test(r)), ...(o.strain || [])];
  const changes = [];
  let cur = planGuardCopy(list);
  const open = p => p.status === "geplant" && (p.date === o.todayKey || p.date === tomorrow) && !skip.has(p.id) && p.sport !== "Mobility";
  const nonEasy = p => (p.intensity && p.intensity !== "leicht") || (Number(p.duration_min) || 0) > PLAN_HARD_MIN_DURATION;
  const soften = (p, factor, max, reason) => {
    const before = { ...p };
    const dur = Number(p.duration_min) || 0;
    const nextDur = dur ? Math.min(dur, max, Math.max(PLAN_GUARD_EASY_MIN, planGuardRound5(dur * factor))) : null;
    p.intensity = "leicht";
    if (nextDur) p.duration_min = nextDur;
    // Der alte Titel ("6 × 800 m an der Schwelle") passte nicht mehr - auch auf der Uhr
    if (PLAN_GUARD_SPORT_TITLE[p.sport]) p.title = PLAN_GUARD_SPORT_TITLE[p.sport];
    p.steps = null; // eigene Schritte passen nicht mehr - Standard-Ablauf (locker) gilt
    // Alte Beschreibung bewusst weg: aus "6x800m" würde die App sonst wieder
    // Intervalle für die Uhr bauen (parseMainSet, planned-workouts.js).
    p.description = `Plan-Check: bewusst locker – ${reason}. Ruhig und gleichmäßig, du kannst dich dabei noch unterhalten.`;
    changes.push({ id: p.id, date: p.date, kind: "easier", reason, before });
  };

  if (o.gate.injury) {
    const reason = "du hast heute eine Verletzung gemeldet";
    cur.filter(p => open(p) && p.date === o.todayKey).forEach(p => changes.push({ id: p.id, date: p.date, kind: "rest", reason, before: { ...p } }));
    const removed = new Set(changes.map(c => c.id));
    cur = cur.filter(p => !removed.has(p.id));
    cur.filter(p => open(p) && p.date === tomorrow && nonEasy(p)).forEach(p => soften(p, PLAN_GUARD_EASY_FACTOR, PLAN_GUARD_EASY_MAX, reason));
    return { list: cur, changes };
  }
  if (strong.length) {
    const reason = strong.join(", ");
    cur.filter(p => open(p) && nonEasy(p)).forEach(p => soften(p, PLAN_GUARD_EASY_FACTOR, PLAN_GUARD_EASY_MAX, reason));
    return { list: cur, changes };
  }
  if ((o.signs || []).length) {
    const reason = o.signs.join(" und ");
    cur.filter(p => open(p) && p.date === o.todayKey && PLAN_HARD_INTENSITIES.includes(p.intensity))
      .forEach(p => soften(p, PLAN_GUARD_MILD_FACTOR, PLAN_HARD_MIN_DURATION, reason));
  }
  return { list: cur, changes };
}

// "block"-Verstöße des Regelwerks beheben, die einen Tag im Zeitraum
// [from, to] betreffen (bei Wochenregeln: die Woche überschneidet ihn) -
// derselbe Ablauf wie nach einer KI-Planung (checkedPlanFromAi).
// Ergebnis: { list, fixed: [Text] }
function planGuardAutofix(list, o) {
  const inRange = v => {
    const start = v.date, end = v.workoutId ? v.date : planShiftDay(v.date, 6);
    return end >= o.from && start <= o.to;
  };
  let cur = list;
  const fixed = [];
  for (let round = 0; round < 10; round++) {
    const block = o.validate(cur).find(v => v.severity === "block" && inRange(v));
    const next = block && o.fix(cur, block.suggestion);
    if (!next) break;
    fixed.push(block.suggestion.text);
    cur = next;
  }
  return { list: cur, fixed };
}

// Unterschied zweier Planstände (für Anzeige und Rückgängig):
// [{ kind: "added"|"removed"|"changed", id, date, before?, after? }]
function planGuardDiff(before, after) {
  const a = new Map((before || []).map(p => [p.id, p]));
  const b = new Map((after || []).map(p => [p.id, p]));
  const out = [];
  const fields = ["date", "sport", "duration_min", "intensity", "title", "description", "status"];
  a.forEach((p, id) => {
    const q = b.get(id);
    if (!q) out.push({ kind: "removed", id, date: p.date, before: p });
    else if (fields.some(f => p[f] !== q[f])) out.push({ kind: "changed", id, date: q.date, before: p, after: q });
  });
  b.forEach((q, id) => { if (!a.has(id)) out.push({ kind: "added", id, date: q.date, after: q }); });
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

// KI-Vorschlag für eine Einheit prüfen: nur leichter/kürzer, gleiche Art der
// Belastung (Ausdauer bleibt Ausdauer), sonst null. envelope = die Einheit
// nach der Regelprüfung (Obergrenze).
function planGuardAcceptAi(envelope, proposal) {
  if (!proposal || !envelope) return null;
  const endurance = ["Schwimmen", "Rad", "Laufen"];
  const sport = proposal.sport || envelope.sport;
  if (sport !== envelope.sport && !(endurance.includes(sport) && endurance.includes(envelope.sport))) return null;
  const rank = x => PLAN_GUARD_INTENSITY_RANK[x] != null ? PLAN_GUARD_INTENSITY_RANK[x] : 1;
  const intensity = ["leicht", "mittel", "hart"].includes(proposal.intensity) ? proposal.intensity : envelope.intensity;
  if (envelope.intensity && rank(intensity) > rank(envelope.intensity)) return null;
  const dur = Math.round(Number(proposal.duration_min));
  const maxDur = Number(envelope.duration_min) || 0;
  if (!(dur >= 15) || (maxDur && dur > maxDur)) return null;
  return { sport, intensity, duration_min: dur };
}

// Lohnt sich die KI-Prüfung für heute/morgen? Nur, wenn es etwas abzuwägen
// gibt - sonst lautet die Antwort praktisch immer "behalten" und kostet nur.
// Gibt die Gründe zurück (leer = KI nicht fragen). o: { gate, signs, strain,
// recovery (Erholungs-Check von heute oder null), wellness ({ hrv_ms,
// resting_hr, sleep_min } wie wellnessDeviation, readiness_score wie
// latestWellness), missed (verpasste Einheiten), acwr, todayKey }.
const PLAN_GUARD_AI_ACWR = 1.2;        // knapp unter der festen Grenze (1,3)
const PLAN_GUARD_AI_HRV_PCT = -5;      // halbe Schwelle der festen Regel (-10 %)
const PLAN_GUARD_AI_RHR_BPM = 3;       // feste Regel: +5
const PLAN_GUARD_AI_SLEEP_PCT = -15;   // deutlich kürzer geschlafen als sonst
const PLAN_GUARD_AI_READINESS = 50;    // feste Regel: unter 25
function planGuardAiReasons(o) {
  const reasons = [];
  const add = r => { if (!reasons.includes(r)) reasons.push(r); };
  if ((o.gate && o.gate.reasons && o.gate.reasons.length) || (o.signs && o.signs.length) || (o.strain && o.strain.length)) add("feste Regeln auffällig");
  const rc = o.recovery || {};
  if (["moderate", "severe"].includes(rc.soreness) || ["low", "reduced"].includes(rc.energy) || rc.injury === "yes") add("Erholungs-Check");
  if (o.missed && o.missed.length) add("verpasste Einheit");
  if (o.acwr != null && o.acwr >= PLAN_GUARD_AI_ACWR) add("Belastung steigt");
  // Mehrere leicht auffällige Uhr-Werte zusammen (einzeln schwankt jeder Wert)
  const minDate = planShiftDay(o.todayKey, -1);
  const fresh = d => d && d.value != null && d.date >= minDate && d.date <= o.todayKey;
  const w = o.wellness || {};
  let mild = 0;
  if (fresh(w.hrv_ms) && w.hrv_ms.baseline && w.hrv_ms.deltaPct <= PLAN_GUARD_AI_HRV_PCT) mild++;
  if (fresh(w.resting_hr) && w.resting_hr.baseline && w.resting_hr.value - w.resting_hr.baseline >= PLAN_GUARD_AI_RHR_BPM) mild++;
  if (fresh(w.sleep_min) && w.sleep_min.baseline && w.sleep_min.deltaPct <= PLAN_GUARD_AI_SLEEP_PCT) mild++;
  if (fresh(w.readiness_score) && w.readiness_score.value < PLAN_GUARD_AI_READINESS) mild++;
  if (mild >= 2) add("mehrere Uhr-Werte leicht auffällig");
  return reasons;
}

/* ---------- Wochenumfang auffüllen (nach der KI-Planung) ---------- */

// Bleibt eine Woche nach der KI-Planung deutlich unter ihrem Budget
// (planGuardWeekTarget: Zielumfang, höchstens die verfügbaren Stunden),
// füllt das Dashboard selbst auf - ohne weitere KI-Anfrage:
//   1. neue lockere Rad-/Laufeinheiten (o.mutableIds) in 5-Minuten-Schritten
//      verlängern, je höchstens um die Hälfte und nie über 120 min (sonst
//      zählt sie als hart). Schwimmen nicht (Meterbereich), keine Einheiten
//      mit eigenen Schritten (die passen dann nicht mehr), keine selbst
//      gewünschten (requested).
//   2. Mit 2 Haupttrainings pro Tag (o.structure.mainPerDay) an Tagen mit
//      genau einem Haupttraining eine kurze zweite lockere Einheit ergänzen.
// Jede Änderung, die einen neuen "block"-Verstoß erzeugt, wird verworfen.
// Aufgefüllt wird bis zum Budget, sobald die Woche unter PLAN_TOPUP_SHARE liegt.
// o: { from, to, todayKey, today, profile, goal, defaults, validate, mutableIds, structure }
// Ergebnis: { list, changes: [{ date, kind: "longer"|"added", title, before?, after }] }
const PLAN_TOPUP_SHARE = 0.9;
const PLAN_TOPUP_MAX_FACTOR = 1.5;
const PLAN_TOPUP_SECOND_MIN = 20;
const PLAN_TOPUP_SECOND_MAX = 45;

function planGuardTopUp(list, history, o) {
  let cur = list.slice();
  const changes = [];
  const mutable = new Set(o.mutableIds || []);
  const ok = next => !o.validate || !newPlanViolations(o.validate(cur), o.validate(next)).some(v => v.severity === "block");
  const raceDays = o.goal && o.goal.date ? [o.goal.date, planShiftDay(o.goal.date, -1)] : [];
  const weeks = [...new Set(Array.from({ length: 400 }, (_, i) => planShiftDay(o.from, i)).filter(k => k <= o.to).map(planWeekKey))];

  weeks.forEach(wk => {
    const target = planGuardWeekTarget(cur, history, o, wk);
    if (target == null) return;
    const missing = () => target - planGuardWeekMinutes(cur, history, o.todayKey, wk);
    if (missing() <= target * (1 - PLAN_TOPUP_SHARE)) return;
    const inRange = k => planWeekKey(k) === wk && k >= o.from && k <= o.to && k >= o.todayKey && !raceDays.includes(k);

    // 1. Verlängern
    const start = new Map();
    const cands = () => cur.filter(p => mutable.has(p.id) && p.status === "geplant" && inRange(p.date)
      && (p.sport === "Rad" || p.sport === "Laufen") && p.intensity === "leicht" && !p.requested && !(p.steps && p.steps.length)
      && Number(p.duration_min) > 0);
    for (let guard = 0; guard < 200 && missing() >= 5; guard++) {
      const pick = cands().map(p => {
        const base = start.has(p.id) ? start.get(p.id) : Number(p.duration_min);
        return { p, base, cap: Math.min(PLAN_GUARD_LONG_MAX, planGuardRound5(base * PLAN_TOPUP_MAX_FACTOR)) };
      }).filter(c => Number(c.p.duration_min) + 5 <= c.cap)
        .sort((a, b) => Number(a.p.duration_min) / a.base - Number(b.p.duration_min) / b.base || a.p.date.localeCompare(b.p.date))[0];
      if (!pick) break;
      if (!start.has(pick.p.id)) start.set(pick.p.id, Number(pick.p.duration_min));
      const next = cur.map(p => (p.id === pick.p.id ? { ...p, duration_min: Number(p.duration_min) + 5 } : p));
      if (!ok(next)) { mutable.delete(pick.p.id); continue; }
      cur = next;
    }
    start.forEach((before, id) => {
      const p = cur.find(x => x.id === id);
      if (!p || p.duration_min === before) return;
      const note = `Auf ${p.duration_min} min verlängert, damit die Woche ihren Zielumfang erreicht: den lockeren Hauptteil entsprechend länger fahren bzw. laufen.`;
      cur = cur.map(x => (x.id === id ? { ...x, description: x.description ? `${x.description} ${note}` : note } : x));
      changes.push({ date: p.date, kind: "longer", title: p.title, before, after: p.duration_min });
    });

    // 2. Kurze zweite Einheit
    const s = o.structure;
    if (!s || s.mainPerDay !== 2 || typeof planStructDayAccepts !== "function") return;
    const days = planWeekDays(wk).filter(inRange);
    for (const k of days) {
      const left = missing();
      if (left < PLAN_TOPUP_SECOND_MIN) break;
      const others = cur.filter(p => p.date === k && p.status !== "uebersprungen");
      const mains = others.filter(p => !planStructIsExtra(p));
      if (mains.length !== 1) continue; // Ruhetage bleiben frei, volle Tage auch
      const goalSports = o.goal ? goalRaceSports(o.goal) : [];
      const sports = (goalSports.length ? goalSports : ["Rad", "Laufen", "Schwimmen"]).filter(sp => !others.some(p => p.sport === sp));
      const dur = Math.max(PLAN_TOPUP_SECOND_MIN, Math.min(PLAN_TOPUP_SECOND_MAX, planGuardRound5(left)));
      for (const sport of sports) {
        const probe = { sport, intensity: "leicht", duration_min: dur };
        if (!planStructDayAccepts(s, k, probe, others)) continue;
        const entry = buildPlannedWorkout({
          ...(o.defaults || {}), date: k, sport, title: `${PLAN_GUARD_SPORT_TITLE[sport] || sport} (kurz)`,
          duration_min: dur, intensity: "leicht", source: "guard",
          description: "Kurze zweite Einheit am Tag, ganz locker (Zone 1-2) - ergänzt, damit die Woche ihren Zielumfang erreicht.",
        });
        if (sport === "Schwimmen") entry.description = planGuardSwimDescription(entry);
        const next = [...cur, entry];
        if (!ok(next)) continue;
        cur = next;
        changes.push({ date: k, kind: "added", title: entry.title, after: entry.duration_min });
        break;
      }
    }
  });
  return { list: cur, changes };
}
