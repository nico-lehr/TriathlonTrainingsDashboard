// Trainingsplaner-Regelwerk: prüft einen (meist von der KI vorgeschlagenen)
// Trainingsplan gegen feste Trainingsregeln. Die KI darf Einheiten
// vorschlagen - ob ein Plan zu hart oder zu viel ist, entscheidet nur dieses
// Regelwerk (AI_RULES: Berechnung vs. Interpretation). Rein deterministisch,
// kein UI, kein Speicherzugriff: alles kommt als Parameter herein, damit es
// sich ohne Browser testen lässt (tests/js/plan-rules.test.js).
//
// validatePlan() liefert eine Liste von Verstößen:
//   { rule, severity: "block"|"warn", date, workoutId, text, suggestion }
// "block" = Plan so nicht übernehmen, "warn" = Hinweis. date ist bei
// Wochenregeln der Montag der Woche, workoutId dann null. suggestion.action
// ist so konkret, dass eine spätere UI den Vorschlag per Klick übernehmen kann:
//   set_intensity      { workoutId, intensity: "leicht", duration_min? }
//   reduce_duration    { workoutId, duration_min }
//   move               { workoutId, toDate }
//   make_rest_day      { date, workoutIds }
//   reduce_week_volume { weekStart, target_minutes, workouts: [{ workoutId, duration_min }] }
//   add_easy_session   { sport, weekStart, date, duration_min }
//
// Mit options.goal (Hauptevent mit Datum) kommt die Periodisierung dazu
// (js/analytics/periodization.js): Taper-/Renn-/Erholungswochen haben einen
// Zielumfang (Regel 4), nach dem Wettkampf nur lockere Einheiten (Regel 7).

/* ---------- Schwellenwerte ---------- */

// Hart = so geplant ("hart"/"VO2max") ODER länger als 120 Minuten - auch eine
// locker gefahrene 3-Stunden-Ausfahrt ermüdet wie eine harte Einheit.
const PLAN_HARD_INTENSITIES = ["hart", "VO2max"];
const PLAN_HARD_MIN_DURATION = 120;

// Höchstens 3 harte Einheiten pro Woche. Bewusst nur "warn", kein "block":
// lange Einheiten zählen mit, und in der Aufbauphase sind 2 lange + 2
// intensive Einheiten im Triathlon üblich. Den eigentlichen Schutz liefern
// die harten Regeln "nie 2 harte Tage hintereinander" und "mind. 1 freier Tag".
const PLAN_MAX_HARD_PER_WEEK = 3;

// Ziel: ~80 % der Trainingsminuten locker (Seiler-Modell, dieselbe Idee wie
// die 80/10/10-Marke in renderTrainingFocus). Gezählt werden nur Einheiten
// mit Intensitätsangabe, und erst ab 3 davon - darunter ist der Anteil Zufall.
const PLAN_EASY_SHARE_TARGET = 0.8;
const PLAN_EASY_SHARE_MIN_SESSIONS = 3;

// Mindestens 1 komplett freier Tag pro Woche (Mo-So).
const PLAN_MIN_FREE_DAYS = 1;

// Wochenumfang (Minuten) höchstens +10 % gegenüber der letzten normalen Woche.
const PLAN_MAX_WEEKLY_INCREASE = 0.10;

// Nach 3 Aufbauwochen in Folge muss die 4. eine Entlastungswoche sein. Als
// Entlastungswoche zählt eine Woche mit mind. 30 % weniger Minuten als die
// letzte normale Woche (oder ganz ohne Training) - genau so viel schlägt die
// Regel auch vor. Zurückgeschaut wird höchstens 8 Wochen.
const PLAN_DELOAD_EVERY_WEEKS = 4;
const PLAN_DELOAD_REDUCTION = 0.30;
const PLAN_VOLUME_LOOKBACK_WEEKS = 8;

// Beim Kürzen einer Woche wird keine Einheit um mehr als die Hälfte gekürzt.
const PLAN_MAX_SHORTEN = 0.5;

// ACWR über 1,3 = "erhöhtes Risiko" (dieselbe Grenze wie acwrStatusLabel()).
const PLAN_ACWR_LIMIT = 1.3;

// Erholungs-Check-Werte, die als "schlecht erholt" gelten - dieselben wie in
// streak.js (isRecoveryProtected) und health-status.js. Eine gemeldete
// Verletzung (injury "yes") zählt immer.
const PLAN_BAD_RECOVERY = { energy: ["low"], soreness: ["severe"] };

// Garmin-Messwerte als Abweichung vom eigenen 30-Tage-Mittel (siehe
// wellnessDeviation()): HRV mind. 10 % darunter oder Ruhepuls mind. 5 Schläge
// darüber deuten auf unvollständige Erholung hin. Nur Werte von heute/gestern.
const PLAN_HRV_DROP_PCT = 10;
const PLAN_RHR_RISE_BPM = 5;
const PLAN_WELLNESS_MAX_AGE_DAYS = 1;

// Sportarten eines Ziels - je mind. 1 lockere Grundlageneinheit pro Woche.
const PLAN_GOAL_SPORTS = { Triathlon: ["Schwimmen", "Rad", "Laufen"], Schwimmen: ["Schwimmen"], Rad: ["Rad"], Laufen: ["Laufen"] };
const PLAN_EASY_SESSION_DEFAULT_MIN = 45; // vorgeschlagene Dauer einer fehlenden lockeren Einheit

const PLAN_SPORT_TEXT = { Rad: "Radfahren" }; // für Sätze wie "beim Radfahren"

/* ---------- Hilfsfunktionen ---------- */

// "YYYY-MM-DD" + n Tage - über setDate statt +86400000 ms, damit die
// Zeitumstellung keinen Tag verschluckt oder doppelt liefert.
function planShiftDay(key, n) {
  const d = new Date(key + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

// Montag der Woche (weekStart() aus js/utils/dates.js) als "YYYY-MM-DD".
const planWeekKey = key => localDateStr(weekStart(new Date(key + "T00:00:00")));
const planWeekDays = wk => [0, 1, 2, 3, 4, 5, 6].map(i => planShiftDay(wk, i));
const planDayLabel = key => fmtDateWeekday(new Date(key + "T00:00:00"));
const planWeekLabel = wk => `Woche ab ${fmtDate(new Date(wk + "T00:00:00"))}`;
const planSportText = sport => PLAN_SPORT_TEXT[sport] || sport;

const planIsHard = s => PLAN_HARD_INTENSITIES.includes(s.intensity) || s.duration_min > PLAN_HARD_MIN_DURATION;
const planIsEasy = s => s.intensity === "leicht" && !planIsHard(s);
const planMinutes = list => list.reduce((sum, s) => sum + s.duration_min, 0);
// Minutengrenzen ganzzahlig abgerundet - das Epsilon fängt Rechenfehler wie
// 360 * 0,7 = 251,99999… ab.
const planFloorMin = x => Math.floor(x + 1e-9);
const planDaySessions = (ctx, key) => ctx.byDay.get(key) || [];
const planWeekSessions = (ctx, wk) => planWeekDays(wk).flatMap(k => planDaySessions(ctx, k));

// Lockere Grundlage in einer Sportart = als "leicht" geplant/erledigt. Echte
// Workouts haben keine Intensitätsangabe - ein bereits absolviertes zählt
// trotzdem (nie raten, und an vergangenen Tagen kann der Plan nichts ändern).
const planHasBase = (list, sport) => list.some(s => s.sport === sport && (s.intensity === "leicht" || (!s.planned && !s.intensity)));

// Einheitliche Sicht auf alle Einheiten: noch offene geplante Einheiten ab
// heute (planned: true) plus bereits absolvierte als Kontext. Echte Workouts
// (history) zählen nur über die Dauer als hart, eine Intensität wird nie
// geraten. Als "erledigt" markierte Planeinheiten ergänzen die Historie, aber
// nur ohne echtes Workout derselben Sportart am selben Tag (sonst doppelt).
// "uebersprungen" und vergangene, nie erledigte Planeinheiten fallen weg.
function planSessions(plannedWorkouts, history, todayKey) {
  const done = (history || []).map(w => {
    const d = w._date || (w.date ? new Date(w.date) : null);
    if (!d || isNaN(d)) return null;
    return { id: null, date: localDateStr(d), sport: w.sport, title: w.sport, duration_min: Number(w.duration_min) || 0, intensity: w.intensity || null, planned: false };
  }).filter(s => s && s.date <= todayKey);
  const seen = new Set(done.map(s => s.date + "|" + s.sport));
  const fromPlan = (plannedWorkouts || []).filter(p =>
    (p.status === "geplant" && p.date >= todayKey) ||
    (p.status === "erledigt" && p.date <= todayKey && !seen.has(p.date + "|" + p.sport))
  ).map(p => ({ id: p.id, date: p.date, sport: p.sport, title: p.title || p.sport, duration_min: Number(p.duration_min) || 0, intensity: p.intensity || null, planned: p.status === "geplant" }));
  return [...done, ...fromPlan];
}

// Anteil lockerer Minuten an allen Einheiten MIT Intensitätsangabe - null,
// wenn es zu wenige für eine Aussage sind.
function planEasyShare(list) {
  const rated = list.filter(s => s.intensity && s.duration_min > 0);
  if (rated.length < PLAN_EASY_SHARE_MIN_SESSIONS) return null;
  return planMinutes(rated.filter(s => s.intensity === "leicht")) / planMinutes(rated);
}

// Standard-Vorschlag "locker statt hart": Intensität runter, und wenn die
// Einheit nur wegen ihrer Länge hart ist, auch auf 120 Minuten kürzen.
function planEasySuggestion(s) {
  const tooLong = s.duration_min > PLAN_HARD_MIN_DURATION;
  if (s.intensity === "leicht") {
    return { text: `Kürze „${s.title}“ auf ${PLAN_HARD_MIN_DURATION} Minuten.`, action: "reduce_duration", workoutId: s.id, duration_min: PLAN_HARD_MIN_DURATION };
  }
  return {
    text: `Mach aus „${s.title}“ eine lockere Einheit${tooLong ? ` mit höchstens ${PLAN_HARD_MIN_DURATION} Minuten` : ""}.`,
    action: "set_intensity", workoutId: s.id, intensity: "leicht", ...(tooLong ? { duration_min: PLAN_HARD_MIN_DURATION } : {}),
  };
}

// ACWR ist ein Zustand des Athleten, nicht des Plans: ohne options.acwr kommt
// er aus computePerformanceState() (training-load.js) - dieselbe Zahl wie im
// Dashboard/Coach-Tab, berechnet auf der vollen Historie (DATA). Ohne
// Trainingsdaten bleibt er null und die ACWR-Prüfung entfällt.
function planCurrentAcwr() {
  const state = typeof computePerformanceState === "function" ? computePerformanceState() : null;
  return state ? state.acwr : null;
}

/* ---------- Regel 1: nie 2 harte Tage hintereinander (block) ---------- */

// Sucht für eine harte Einheit einen Tag derselben Woche (ab heute), an dem
// sie keinen neuen Verstoß erzeugt: Zieltag und Nachbartage nicht hart, der
// letzte freie Tag bleibt frei, der laut Regel 5 nur locker erlaubte Tag
// bleibt tabu. Wochensummen (harte Einheiten, Minuten, 80/20) ändern sich
// beim Verschieben innerhalb der Woche nicht. null = kein sicherer Tag.
function planMoveTarget(ctx, byDay, s) {
  const others = k => (byDay.get(k) || []).filter(o => o !== s);
  const hardOn = k => others(k).some(planIsHard);
  const days = planWeekDays(planWeekKey(s.date));
  const freeDays = days.filter(k => !others(k).length).length;
  const dist = k => Math.abs(Date.parse(k) - Date.parse(s.date));
  return days
    .filter(k => k >= ctx.todayKey && k !== s.date && !(ctx.gateDay && k <= ctx.gateDay))
    .filter(k => !hardOn(k) && !hardOn(planShiftDay(k, -1)) && !hardOn(planShiftDay(k, 1)))
    .filter(k => others(k).length || freeDays > PLAN_MIN_FREE_DAYS)
    .sort((a, b) => dist(a) - dist(b))[0] || null;
}

// Der Vortag zählt auch, wenn er schon vorbei ist (echtes Workout von
// gestern). Vorgeschlagene Verschiebungen werden in einer Kopie der Tage
// mitgeführt, damit zwei Vorschläge nicht neu kollidieren.
function checkPlanHardDays(ctx) {
  const sim = new Map([...ctx.byDay].map(([k, v]) => [k, [...v]]));
  return ctx.open
    .filter(s => planIsHard(s) && planDaySessions(ctx, planShiftDay(s.date, -1)).some(planIsHard))
    .map(s => {
      const toDate = planMoveTarget(ctx, sim, s);
      if (toDate) {
        sim.set(s.date, sim.get(s.date).filter(o => o !== s));
        sim.set(toDate, [...(sim.get(toDate) || []), s]);
      }
      return {
        rule: "hard_in_row", severity: "block", date: s.date, workoutId: s.id,
        text: `Zwei harte Tage hintereinander: „${s.title}“ am ${planDayLabel(s.date)} kommt direkt nach einem harten Tag. Dazwischen braucht der Körper einen lockeren Tag, um sich zu erholen.`,
        suggestion: toDate
          ? { text: `Verschiebe „${s.title}“ auf ${planDayLabel(toDate)}`, action: "move", workoutId: s.id, toDate }
          : planEasySuggestion(s),
      };
    });
}

/* ---------- Regel 2: max. 3 harte Einheiten, ~80 % locker (warn) ---------- */

// Vorgeschlagen werden nur Änderungen an noch offenen Einheiten - bei zu
// vielen harten Einheiten an den letzten der Woche.
function checkPlanWeekLoad(ctx) {
  const out = [];
  ctx.weeks.forEach(wk => {
    const list = planWeekSessions(ctx, wk);
    const hard = list.filter(planIsHard);
    const excess = hard.length - PLAN_MAX_HARD_PER_WEEK;
    if (excess > 0) {
      hard.filter(s => s.planned).slice(-excess).forEach(s => out.push({
        rule: "hard_per_week", severity: "warn", date: s.date, workoutId: s.id,
        text: `In der ${planWeekLabel(wk)} kommen ${hard.length} harte Einheiten zusammen. Mehr als ${PLAN_MAX_HARD_PER_WEEK} pro Woche kann der Körper meist nicht gut verarbeiten.`,
        suggestion: planEasySuggestion(s),
      }));
    }

    const share = planEasyShare(list);
    if (share == null || share >= PLAN_EASY_SHARE_TARGET) return;
    // Erst "mittel" lockern (kostet am wenigsten Trainingsreiz), die längste zuerst.
    const fix = list.filter(s => s.planned && s.intensity && s.intensity !== "leicht" && s.duration_min > 0)
      .sort((a, b) => (a.intensity === "mittel" ? 0 : 1) - (b.intensity === "mittel" ? 0 : 1) || b.duration_min - a.duration_min)[0];
    if (!fix) return;
    out.push({
      rule: "easy_share", severity: "warn", date: wk, workoutId: null,
      text: `In der ${planWeekLabel(wk)} ist nur ${Math.round(share * 100)} % der Trainingszeit locker. Gut sind etwa ${Math.round(PLAN_EASY_SHARE_TARGET * 100)} % – vor allem die lockeren Einheiten bauen die Ausdauer auf.`,
      suggestion: { text: `Mach aus „${fix.title}“ am ${planDayLabel(fix.date)} eine lockere Einheit.`, action: "set_intensity", workoutId: fix.id, intensity: "leicht" },
    });
  });
  return out;
}

/* ---------- Regel 3: mind. 1 freier Tag pro Woche (block) ---------- */

// Würde das Streichen dieses Tages die letzte lockere Einheit einer
// Ziel-Sportart kosten (Regel 6) oder den 80/20-Anteil unter das Ziel drücken?
function planRestDaySafe(ctx, list, key) {
  const rest = list.filter(s => s.date !== key);
  const before = planEasyShare(list), after = planEasyShare(rest);
  if ((before == null || before >= PLAN_EASY_SHARE_TARGET) && after != null && after < PLAN_EASY_SHARE_TARGET) return false;
  return ctx.goalSports.every(sp => !planHasBase(list, sp) || planHasBase(rest, sp));
}

// Vorgeschlagen wird der Tag ab heute (noch nichts absolviert) mit den
// wenigsten Minuten, dessen Streichung keinen neuen Verstoß erzeugt.
function checkPlanRestDay(ctx) {
  const out = [];
  ctx.weeks.forEach(wk => {
    const days = planWeekDays(wk);
    if (days.filter(k => !planDaySessions(ctx, k).length).length >= PLAN_MIN_FREE_DAYS) return;
    const list = planWeekSessions(ctx, wk);
    const dayMin = k => planMinutes(planDaySessions(ctx, k));
    const pool = days.filter(k => k >= ctx.todayKey && planDaySessions(ctx, k).every(s => s.planned))
      .sort((a, b) => dayMin(a) - dayMin(b));
    if (!pool.length) return; // nichts mehr, was der Plan noch ändern könnte
    const date = pool.find(k => planRestDaySafe(ctx, list, k)) || pool[0];
    const sessions = planDaySessions(ctx, date);
    out.push({
      rule: "rest_day", severity: "block", date: wk, workoutId: null,
      text: `In der ${planWeekLabel(wk)} ist jeden Tag Training geplant. Stärker wird der Körper erst in den Pausen – mindestens ein freier Tag pro Woche muss sein.`,
      suggestion: {
        text: `Mach ${planDayLabel(date)} zum Ruhetag (${sessions.map(s => `„${s.title}“`).join(", ")} fällt weg).`,
        action: "make_rest_day", date, workoutIds: sessions.map(s => s.id),
      },
    });
  });
  return out;
}

/* ---------- Regel 4: Wochenumfang +10 % und Entlastungswoche (warn) ---------- */

// Kürzt alle noch offenen Einheiten der Woche gleichmäßig (auf 5 Minuten
// abgerundet) Richtung Zielwert, je Einheit aber höchstens um die Hälfte.
// Bereits absolvierte Minuten bleiben, wie sie sind; Einheiten am Tag
// `skipDate` (der Wettkampftag) auch.
function planShortenWeek(ctx, wk, cur, target, skipDate = null) {
  const open = planWeekSessions(ctx, wk).filter(s => s.planned && s.duration_min > 0 && s.date !== skipDate);
  const openMin = planMinutes(open);
  if (!openMin) return null;
  const factor = Math.max(PLAN_MAX_SHORTEN, (openMin - (cur - target)) / openMin);
  const workouts = open
    .map(s => ({ workoutId: s.id, duration_min: Math.max(5, Math.floor(s.duration_min * factor / 5) * 5), before: s.duration_min }))
    .filter(w => w.duration_min < w.before);
  if (!workouts.length) return null;
  const total = cur - workouts.reduce((sum, w) => sum + w.before - w.duration_min, 0);
  return {
    text: `Kürze die noch offenen Einheiten der Woche gleichmäßig – dann sind es ${Math.round(total)} statt ${Math.round(cur)} Minuten (Ziel: höchstens ${target}).`,
    action: "reduce_week_volume", weekStart: wk, target_minutes: target,
    workouts: workouts.map(w => ({ workoutId: w.workoutId, duration_min: w.duration_min })),
  };
}

// Zählweise: die 8 Wochen vor der geprüften Woche werden der Reihe nach
// durchgegangen. Eine Woche mit mind. 30 % weniger Minuten als die letzte
// normale Woche (oder ohne Training) ist eine Entlastungswoche und setzt den
// Zähler auf 0, jede andere zählt als Aufbauwoche. Vergleichswert für die
// +10 % ist die letzte normale Woche - nach einer Entlastungs-/Krankheitswoche
// also die Woche davor. Sonst würde der normale Wiedereinstieg als Sprung
// gewertet, und die Regel stünde im Widerspruch zur Entlastungsregel.
// Umfang = absolvierte Minuten (Historie) + offene Planeinheiten der Woche.
// Als eigene Funktion, weil die Periodisierung (getWeeklyTargets,
// periodization.js) ihre Entlastungswochen genau so zählt.
// weekMin: "YYYY-MM-DD" (Montag) -> Minuten der Woche.
const planDeloadMax = ref => planFloorMin(ref * (1 - PLAN_DELOAD_REDUCTION));
const planIsLighterWeek = (min, ref) => min === 0 || (ref != null && min <= planDeloadMax(ref));

function planVolumeStreak(weekMin, wk) {
  let ref = null, refWeek = null, streak = 0;
  for (let i = PLAN_VOLUME_LOOKBACK_WEEKS; i >= 1; i--) {
    const prevWk = planShiftDay(wk, -7 * i);
    const min = weekMin(prevWk);
    if (planIsLighterWeek(min, ref)) streak = 0;
    else { streak++; ref = min; refWeek = prevWk; }
  }
  return { ref, refWeek, streak };
}

// Taper-, Renn- und Erholungswochen: hier gilt der Zielumfang der
// Periodisierung (getWeeklyTargets) - als EIN Limit, das niedrigste aus
// Zielumfang, +10 % und (falls fällig) Entlastungswoche. So bekommt die
// Woche keine drei ähnlichen Hinweise, und die beiden Regeln oben werden nie
// aufgeweicht. Der Wettkampftag zählt nicht mit und wird nie gekürzt.
const PLAN_PHASE_REDUCED_WEEKS = ["taper", "rennwoche", "erholung"];

function planPhaseVolume(ctx, wk, week, ref, streak) {
  const limits = [week.targetMin];
  if (ref != null) {
    limits.push(planFloorMin(ref * (1 + PLAN_MAX_WEEKLY_INCREASE)));
    if (streak >= PLAN_DELOAD_EVERY_WEEKS - 1) limits.push(planDeloadMax(ref));
  }
  const target = Math.min(...limits);
  const cur = week.doneMin + week.plannedMin;
  if (cur <= target) return [];
  const suggestion = planShortenWeek(ctx, wk, cur, target, ctx.goal.date);
  if (!suggestion) return [];
  const name = `„${ctx.goal.name}“`;
  const what = {
    taper: [`eine Taper-Woche vor ${name}`, "Im Taper sinkt der Umfang, damit du ausgeruht an den Start gehst."],
    rennwoche: [`die Rennwoche von ${name}`, "So kurz vor dem Rennen bringt mehr Training keine Form mehr, nur Müdigkeit."],
    erholung: [`die Erholungswoche nach ${name}`, "Nach dem Wettkampf braucht der Körper Ruhe, um sich zu erholen."],
  }[week.type];
  return [{
    rule: "phase_volume", severity: "warn", date: wk, workoutId: null,
    text: `Die ${planWeekLabel(wk)} ist ${what[0]}: ${Math.round(cur)} Minuten Training, sinnvoll sind höchstens ${target} Minuten (ohne den Wettkampf selbst). ${what[1]}`,
    suggestion,
  }];
}

function checkPlanVolume(ctx) {
  const out = [];
  const weekMin = wk => planMinutes(planWeekSessions(ctx, wk));
  ctx.weeks.forEach(wk => {
    const { ref, refWeek, streak } = planVolumeStreak(weekMin, wk);
    const week = ctx.periodWeeks.get(wk);
    if (week && week.targetMin != null && PLAN_PHASE_REDUCED_WEEKS.includes(week.type)) {
      out.push(...planPhaseVolume(ctx, wk, week, ref, streak));
      return;
    }
    if (ref == null) return; // keine Vergleichswoche vorhanden
    const cur = weekMin(wk);

    const increaseMax = planFloorMin(ref * (1 + PLAN_MAX_WEEKLY_INCREASE));
    if (cur > increaseMax) {
      const suggestion = planShortenWeek(ctx, wk, cur, increaseMax);
      if (suggestion) out.push({
        rule: "volume_increase", severity: "warn", date: wk, workoutId: null,
        text: `In der ${planWeekLabel(wk)} kommen ${Math.round(cur)} Minuten Training zusammen – ${Math.round((cur / ref - 1) * 100)} % mehr als in der ${planWeekLabel(refWeek)} (${Math.round(ref)} Minuten). Mehr als ${Math.round(PLAN_MAX_WEEKLY_INCREASE * 100)} % Steigerung pro Woche erhöht das Verletzungsrisiko.`,
        suggestion,
      });
    }

    // In der letzten Woche vor dem Taper keine Entlastung - der Taper ist sie
    // (sonst drei leichte Wochen in Folge; getWeeklyTargets macht es genauso).
    const next = ctx.periodWeeks.get(planShiftDay(wk, 7));
    const beforeTaper = next && next.type === "taper";
    if (!beforeTaper && streak >= PLAN_DELOAD_EVERY_WEEKS - 1 && !planIsLighterWeek(cur, ref)) {
      const suggestion = planShortenWeek(ctx, wk, cur, planDeloadMax(ref));
      if (suggestion) out.push({
        rule: "deload", severity: "warn", date: wk, workoutId: null,
        text: `Die ${planWeekLabel(wk)} wäre die ${streak + 1}. Aufbauwoche in Folge. Nach ${PLAN_DELOAD_EVERY_WEEKS - 1} Wochen Aufbau braucht der Körper eine leichtere Woche (Entlastungswoche) mit etwa ${Math.round(PLAN_DELOAD_REDUCTION * 100)} % weniger Training, damit das Training wirken kann.`,
        suggestion,
      });
    }
  });
  return out;
}

/* ---------- Regel 5: nach Belastungsspitze/schlechter Erholung nur locker ---------- */

// Gründe, warum die nächste Einheit nur locker sein darf. Nur der
// Erholungs-Check von heute zählt (er wird täglich zurückgesetzt, health.js).
function planRecoveryGate(acwr, recovery, todayKey) {
  const reasons = [];
  if (acwr != null && acwr > PLAN_ACWR_LIMIT) reasons.push(`deine Belastung ist zuletzt stark gestiegen (ACWR ${fmtNum(acwr, 2)}, ab ${fmtNum(PLAN_ACWR_LIMIT, 1)} steigt das Verletzungsrisiko)`);
  const rec = recovery && recovery.date === todayKey ? recovery : {};
  if (rec.injury === "yes") reasons.push("du hast heute eine Verletzung gemeldet");
  if (PLAN_BAD_RECOVERY.energy.includes(rec.energy)) reasons.push("du fühlst dich heute erschöpft");
  if (PLAN_BAD_RECOVERY.soreness.includes(rec.soreness)) reasons.push("du hast heute starken Muskelkater");
  return { reasons, injury: rec.injury === "yes" };
}

// Erwartet die Ausgabe von wellnessDeviation() (js/data/garmin-wellness.js):
// { hrv_ms: wellnessDeviation("hrv_ms"), resting_hr: wellnessDeviation("resting_hr") }.
// Fehlt etwas (kein Garmin-Sync, zu wenig Werte für eine Basislinie, Wert
// älter als gestern), wird still übersprungen - nie raten.
function planWellnessSigns(wellness, todayKey) {
  const minDate = planShiftDay(todayKey, -PLAN_WELLNESS_MAX_AGE_DAYS);
  const fresh = d => d && d.date >= minDate && d.date <= todayKey && d.baseline;
  const hrv = wellness && wellness.hrv_ms, rhr = wellness && wellness.resting_hr;
  const signs = [];
  if (fresh(hrv) && hrv.deltaPct <= -PLAN_HRV_DROP_PCT) signs.push(`deine HRV liegt ${Math.round(-hrv.deltaPct)} % unter deinem Durchschnitt`);
  if (fresh(rhr) && rhr.value - rhr.baseline >= PLAN_RHR_RISE_BPM) signs.push(`dein Ruhepuls liegt ${Math.round(rhr.value - rhr.baseline)} Schläge über deinem Durchschnitt`);
  return signs;
}

// Betrifft nur die nächste geplante Einheit (heute bzw. den nächsten Tag mit
// Plan): ACWR/Erholungs-Check/Verletzung -> block, Garmin-Messwerte nur warn
// (ein einzelner Messwert schwankt). Bei Verletzung ist der Vorschlag ein
// Ruhetag, sonst eine lockere Einheit.
function checkPlanReadiness(ctx, gate, wellness) {
  const day = ctx.open[0].date;
  const planned = planDaySessions(ctx, day).filter(s => s.planned);
  const targets = planned.filter(s => !planIsEasy(s));
  if (gate.reasons.length) {
    return targets.map(s => ({
      rule: "recovery", severity: "block", date: day, workoutId: s.id,
      text: `Im Moment lieber nichts Anstrengendes: ${gate.reasons.join(", ")}. Deshalb darf „${s.title}“ am ${planDayLabel(day)} nur locker sein – oder du machst einen Ruhetag.`,
      suggestion: gate.injury
        ? { text: `Mach ${planDayLabel(day)} zum Ruhetag, damit die Verletzung ausheilen kann.`, action: "make_rest_day", date: day, workoutIds: planned.map(p => p.id) }
        : planEasySuggestion(s),
    }));
  }
  const signs = planWellnessSigns(wellness, ctx.todayKey);
  if (!signs.length) return [];
  return targets.map(s => ({
    rule: "wellness", severity: "warn", date: day, workoutId: s.id,
    text: `Deine Uhr meldet wenig Erholung: ${signs.join(" und ")}. „${s.title}“ am ${planDayLabel(day)} könnte gerade zu viel sein.`,
    suggestion: planEasySuggestion(s),
  }));
}

/* ---------- Regel 6: lockere Grundlage je Ziel-Sportart (warn) ---------- */

// Geprüft werden nur Wochen, die der Plan bis Sonntag abdeckt
// (options.planUntil, sonst die letzte geplante Einheit) - eine erst halb
// geplante Woche wird beim nächsten Nachplanen ohnehin aufgefüllt.
// Vorschlagstag: ein Tag ab heute, an dem schon trainiert wird (der freie Tag
// bleibt frei) und der nicht hart ist - am liebsten der kürzeste.
function checkPlanGoalSports(ctx, goal) {
  const out = [];
  ctx.weeks.filter(wk => planShiftDay(wk, 6) <= ctx.planUntil).forEach(wk => {
    const list = planWeekSessions(ctx, wk);
    ctx.goalSports.filter(sp => !planHasBase(list, sp)).forEach(sport => {
      const days = planWeekDays(wk).filter(k => k >= ctx.todayKey && planDaySessions(ctx, k).length);
      const dayMin = k => planMinutes(planDaySessions(ctx, k));
      const date = days.filter(k => !planDaySessions(ctx, k).some(planIsHard)).sort((a, b) => dayMin(a) - dayMin(b))[0] || days[0] || null;
      out.push({
        rule: "goal_base", severity: "warn", date: wk, workoutId: null,
        text: `In der ${planWeekLabel(wk)} fehlt eine lockere Einheit beim ${planSportText(sport)}. Für dein Ziel${goal.name ? ` „${goal.name}“` : ""} braucht jede Sportart mindestens eine ruhige Grundlagen-Einheit pro Woche.`,
        suggestion: {
          text: `Plane ${date ? `am ${planDayLabel(date)} ` : ""}zusätzlich ${PLAN_EASY_SESSION_DEFAULT_MIN} Minuten lockeres ${planSportText(sport)} ein.`,
          action: "add_easy_session", sport, weekStart: wk, date, duration_min: PLAN_EASY_SESSION_DEFAULT_MIN,
        },
      });
    });
  });
  return out;
}

/* ---------- Regel 7: nach dem Wettkampf nur locker (warn) ---------- */

// In den Erholungstagen nach dem Hauptevent (getPhase "erholung") nur
// lockere Einheiten: "mittel"/"hart" oder länger als 120 Minuten -> Hinweis.
// Einheiten ohne Intensitätsangabe (z. B. ein Terminwunsch) bleiben
// unbewertet - nie raten.
function checkPlanRecoveryWeek(ctx) {
  if (!ctx.goal) return [];
  return ctx.open
    .filter(s => getPhase(s.date, ctx.goal) === "erholung" && ((s.intensity && s.intensity !== "leicht") || planIsHard(s)))
    .map(s => ({
      rule: "recovery_week", severity: "warn", date: s.date, workoutId: s.id,
      text: `„${s.title}“ am ${planDayLabel(s.date)} liegt in der Erholungswoche nach „${ctx.goal.name}“. Nach einem Wettkampf braucht der Körper ein paar Tage nur lockere Bewegung, bevor wieder hart oder lang trainiert wird.`,
      suggestion: planEasySuggestion(s),
    }));
}

/* ---------- Einstieg ---------- */

// plannedWorkouts: Einträge wie in js/data/planned-workouts.js - geprüft
//   werden nur status "geplant" ab heute, "erledigt" zählt als Kontext.
// history: echte Workouts (DATA, js/data/workouts.js).
// wellness: { hrv_ms, resting_hr } aus wellnessDeviation(), optional.
// recovery: recoveryCheck (js/data/health.js), optional.
// options: { goal (Hauptevent, für Regel 6 und die Periodisierung), today (Date, Standard jetzt),
//   acwr (vorberechnet, sonst computePerformanceState()), planUntil
//   ("YYYY-MM-DD", bis wohin der Plan reicht, Standard: letzte Einheit) }
function validatePlan(plannedWorkouts, history, wellness, recovery, options = {}) {
  const todayKey = localDateStr(new Date(options.today || Date.now()));
  const sessions = planSessions(plannedWorkouts, history, todayKey);
  const open = sessions.filter(s => s.planned).sort((a, b) => a.date.localeCompare(b.date));
  if (!open.length) return [];

  const byDay = new Map();
  sessions.forEach(s => { if (!byDay.has(s.date)) byDay.set(s.date, []); byDay.get(s.date).push(s); });
  const acwr = typeof options.acwr === "number" ? options.acwr : planCurrentAcwr();
  const gate = planRecoveryGate(acwr, recovery, todayKey);
  const goal = options.goal || null;
  const period = getWeeklyTargets(goal, plannedWorkouts, history, new Date(options.today || Date.now()));
  const ctx = {
    todayKey, byDay, open,
    goal: goal && goal.date ? goal : null,
    periodWeeks: new Map(period ? period.weeks.map(w => [w.weekStart, w]) : []), // Zielumfang je Woche
    weeks: [...new Set(open.map(s => planWeekKey(s.date)))],
    planUntil: options.planUntil || open[open.length - 1].date,
    goalSports: (goal && PLAN_GOAL_SPORTS[goal.sport]) || [],
    gateDay: gate.reasons.length ? open[0].date : null, // nur locker erlaubt (Regel 5)
  };

  const severityOrder = { block: 0, warn: 1 };
  return [
    ...checkPlanHardDays(ctx),
    ...checkPlanWeekLoad(ctx),
    ...checkPlanRestDay(ctx),
    ...checkPlanVolume(ctx),
    ...checkPlanReadiness(ctx, gate, wellness),
    ...checkPlanGoalSports(ctx, goal),
    ...checkPlanRecoveryWeek(ctx),
  ].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || severityOrder[a.severity] - severityOrder[b.severity]);
}

// Die Regeln als kurze Sätze für den KI-Trainingsplan-Prompt
// (buildPlanRulesPrompt, js/ai/prompts.js) - direkt aus den Schwellenwerten
// oben erzeugt, damit die KI nie andere Zahlen bekommt als die Prüfung danach.
// Mit `goal` kommt Regel 6 (lockere Einheit je Ziel-Sportart) dazu, mit
// Zieldatum auch Taper/Erholung aus der Periodisierung.
function planRulesText(goal) {
  const pct = x => Math.round(x * 100);
  const sports = (goal && PLAN_GOAL_SPORTS[goal.sport]) || [];
  return [
    `Nie zwei harte Tage hintereinander. Hart ist eine Einheit mit Intensität "hart" oder mit mehr als ${PLAN_HARD_MIN_DURATION} Minuten (auch wenn sie locker ist).`,
    `Höchstens ${PLAN_MAX_HARD_PER_WEEK} harte Einheiten pro Woche (Montag bis Sonntag).`,
    `Etwa ${pct(PLAN_EASY_SHARE_TARGET)} % der Trainingsminuten einer Woche "leicht".`,
    `Mindestens ${PLAN_MIN_FREE_DAYS} komplett freier Tag pro Woche (Montag bis Sonntag).`,
    `Der Wochenumfang (Minuten) steigt höchstens um ${pct(PLAN_MAX_WEEKLY_INCREASE)} % gegenüber der letzten normalen Woche.`,
    `Nach ${PLAN_DELOAD_EVERY_WEEKS - 1} Aufbauwochen in Folge kommt eine Entlastungswoche mit mindestens ${pct(PLAN_DELOAD_REDUCTION)} % weniger Minuten.`,
    `Die nächste Einheit nur "leicht", wenn der ACWR über ${fmtNum(PLAN_ACWR_LIMIT, 1)} liegt oder heute Erschöpfung, starker Muskelkater oder eine Verletzung gemeldet ist - bei einer Verletzung stattdessen ein Ruhetag.`,
    `Die nächste Einheit besser "leicht", wenn die HRV mindestens ${PLAN_HRV_DROP_PCT} % unter dem eigenen Durchschnitt oder der Ruhepuls mindestens ${PLAN_RHR_RISE_BPM} Schläge darüber liegt.`,
    ...(sports.length ? [`Jede Woche mindestens eine lockere ("leicht") Einheit in jeder Sportart des Ziels: ${sports.join(", ")}.`] : []),
    ...(goal && goal.date ? [
      `Taper-Wochen (die Rennwoche und die Woche davor) und die Erholungswoche nach dem Wettkampf höchstens mit dem Zielumfang der Periodisierung planen (etwa ${pct(PERIOD_TAPER_FACTORS[1])} %, ${pct(PERIOD_TAPER_FACTORS[0])} % und ${pct(PERIOD_RECOVERY_FACTOR)} % der letzten normalen Woche); der Wettkampf selbst zählt nicht mit. In der letzten Woche vor dem Taper keine Entlastungswoche - der Taper übernimmt sie.`,
      `In den ${PERIOD_RECOVERY_DAYS} Tagen nach dem Wettkampf nur "leicht" und höchstens ${PLAN_HARD_MIN_DURATION} Minuten pro Einheit.`,
    ] : []),
  ].map(s => "- " + s).join("\n");
}

// Verstöße aus `after`, die es in `before` noch nicht gab (gleiche Regel,
// gleicher Tag bzw. gleiche Woche, gleiche Einheit) - eine Änderung am Plan
// soll nur für das warnen oder stoppen, was sie selbst neu verursacht.
function newPlanViolations(before, after) {
  const key = v => `${v.rule}|${v.date}|${v.workoutId}`;
  const known = new Set(before.map(key));
  return after.filter(v => !known.has(key(v)));
}
