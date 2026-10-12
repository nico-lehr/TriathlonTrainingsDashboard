// Periodisierung: In welcher Trainingsphase liegt ein Tag vor dem Hauptevent
// (getPhase), und wie viel Wochenumfang ist in den Wochen bis dahin sinnvoll
// (getWeeklyTargets). Rein rechnerisch, kein UI, kein Speicherzugriff - alles
// kommt als Parameter herein (tests/js/periodization.test.js).
//
// Einzige Quelle für die Phasen: computeTrainingPhase() (training-plan.js)
// und alle Anzeigen/KI-Kontexte leiten sich von getPhase() ab.

/* ---------- Phasengrenzen ---------- */

// Gezählt wird in Kalenderwochen (Mo-So) bis zur Rennwoche, damit jede Woche
// genau eine Phase hat - wie die Wochenregeln in plan-rules.js. Die Vorgabe
// nennt Spannen ("Taper 7-14 Tage, Spezifisch 4-6 Wochen, Aufbau 6-8 Wochen,
// davor Grundlage"); gelesen als Dauer der Phasen, jeweils das obere Ende:
// - Taper: Rennwoche + die Woche davor - beginnt also je nach Wochentag des
//   Rennens 7-13 Tage vorher (Rennen am Sonntag: die letzten 14 Tage).
// - Spezifisch: die 6 Wochen davor, Aufbau: die 8 Wochen davor, sonst Grundlage.
// - Erholung: die 7 Tage nach dem Rennen. Danach gibt es keine Phase mehr
//   (null) - ohne kommendes Ziel wird nicht periodisiert.
const PERIOD_TAPER_WEEKS = 2;
const PERIOD_SPECIFIC_WEEKS = 6;
const PERIOD_BUILD_WEEKS = 8;
const PERIOD_RECOVERY_DAYS = 7;

const PERIOD_PHASES = {
  grundlage: { label: "Grundlage", text: "Viel lockeres Ausdauertraining – es legt die Basis, auf der alles Spätere aufbaut." },
  aufbau: { label: "Aufbau", text: "Der Umfang steigt weiter, dazu kommen gezielt härtere Einheiten." },
  spezifisch: { label: "Spezifisch", text: "Das Training wird dem Wettkampf immer ähnlicher: Renntempo, Koppeleinheiten, Streckenprofil." },
  taper: { label: "Taper", text: "Weniger Umfang mit kurzen, knackigen Reizen – so gehst du ausgeruht und frisch an den Start." },
  erholung: { label: "Erholung", text: "Nach dem Wettkampf nur locker bewegen, damit sich Muskeln und Immunsystem erholen." },
};

/* ---------- Zielumfang je Woche ---------- */

// "Aktueller Wochenumfang" = Ø der Minuten der letzten 4 abgeschlossenen
// Kalenderwochen (nur Wochen ab dem ersten erfassten Training). Alle Ziele
// sind Prozent davon.
const PERIOD_BASELINE_WEEKS = 4;

// Steigerung je Belastungswoche - bewusst unter der +10-%-Grenze von
// plan-rules.js (PLAN_MAX_WEEKLY_INCREASE): Grundlage langsam, Aufbau etwas
// mehr, in der spezifischen Phase wird das erreichte Niveau gehalten.
const PERIOD_GROWTH = { grundlage: 0.03, aufbau: 0.05, spezifisch: 0 };

// Taper: Anteil des zuletzt erreichten Niveaus - [Rennwoche, Woche davor]
// (ein Eintrag je PERIOD_TAPER_WEEKS). Erholungswoche nach dem Rennen.
const PERIOD_TAPER_FACTORS = [0.5, 0.7];
const PERIOD_RECOVERY_FACTOR = 0.4;

// Entlastungswochen kommen aus Regel 4 von plan-rules.js: dieselbe Zählweise
// (planVolumeStreak), derselbe Takt (PLAN_DELOAD_EVERY_WEEKS) und dieselbe
// Absenkung (PLAN_DELOAD_REDUCTION) - Zielkurve und Regelprüfung können sich
// so nicht widersprechen.

const PERIOD_WEEK_LABELS = {
  belastung: "Belastungswoche", entlastung: "Entlastungswoche", taper: "Taper-Woche",
  rennwoche: "Rennwoche", erholung: "Erholungswoche",
};

/* ---------- Phasen ---------- */

// Date oder "YYYY-MM-DD" -> lokaler Tag, 0 Uhr.
function periodDay(d) {
  const x = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Kalenderwochen von `date` bis zur Rennwoche (0 = Rennwoche, 1 = Woche davor,
// negativ = nach der Rennwoche). null ohne Ziel/Datum.
function periodWeeksToRace(date, goal) {
  if (!goal || !goal.date) return null;
  return Math.round((weekStart(periodDay(goal.date)) - weekStart(periodDay(date))) / (7 * 86400000));
}

// "grundlage" | "aufbau" | "spezifisch" | "taper" | "erholung" - oder null
// (kein Ziel, kein Datum, Rennen länger als die Erholungswoche vorbei).
// Der Wettkampftag selbst gehört noch zum Taper.
function getPhase(date, goal) {
  if (!goal || !goal.date || !date) return null;
  const daysAfter = Math.round((periodDay(date) - periodDay(goal.date)) / 86400000);
  if (isNaN(daysAfter)) return null; // ungültiges Datum - nie raten
  if (daysAfter > 0) return daysAfter <= PERIOD_RECOVERY_DAYS ? "erholung" : null;
  const k = periodWeeksToRace(date, goal);
  if (k < PERIOD_TAPER_WEEKS) return "taper";
  if (k < PERIOD_TAPER_WEEKS + PERIOD_SPECIFIC_WEEKS) return "spezifisch";
  if (k < PERIOD_TAPER_WEEKS + PERIOD_SPECIFIC_WEEKS + PERIOD_BUILD_WEEKS) return "aufbau";
  return "grundlage";
}

// Die Phasen von `date` bis zum Ende der Erholung als zusammenhängende
// Abschnitte: [{ phase, from, to }] ("YYYY-MM-DD", jeweils einschließlich).
// Der erste Abschnitt ist die aktuelle Phase, der zweite der nächste Wechsel.
function getPhaseTimeline(date, goal) {
  const out = [];
  if (!getPhase(date, goal)) return out;
  for (let d = periodDay(date); ; d.setDate(d.getDate() + 1)) {
    const phase = getPhase(d, goal);
    if (!phase) return out;
    const key = localDateStr(d);
    const last = out[out.length - 1];
    if (last && last.phase === phase) last.to = key;
    else out.push({ phase, from: key, to: key });
  }
}

/* ---------- Zielumfang ---------- */

// Zielumfang je Kalenderwoche von der aktuellen Woche bis zum Ende der
// Erholungswoche. plannedWorkouts/history wie bei validatePlan() - gezählt
// wird genauso (planSessions: absolviert + noch offen geplant), nur der
// Wettkampftag selbst nicht (das Rennen ist kein Trainingsumfang).
// Liefert null ohne Ziel/Datum, sonst:
//   { baselineMin, baselineWeeks, weeks: [{ weekStart, phase, type,
//     targetPct, targetMin, doneMin, plannedMin }] }
// baselineMin/targetMin sind null, solange es keinen aktuellen Wochenumfang
// gibt (kein Training in den letzten Wochen) - targetPct gibt es trotzdem.
// Annahme für spätere Wochen: der Plan folgt der Kurve.
function getWeeklyTargets(goal, plannedWorkouts, history, today = new Date()) {
  if (!goal || !goal.date) return null;
  const todayKey = localDateStr(periodDay(today));
  const sessions = planSessions(plannedWorkouts, history, todayKey).filter(s => s.date !== goal.date);
  const byWeek = new Map();
  sessions.forEach(s => {
    const wk = planWeekKey(s.date);
    const e = byWeek.get(wk) || { done: 0, planned: 0 };
    e[s.planned ? "planned" : "done"] += s.duration_min;
    byWeek.set(wk, e);
  });
  const weekMin = wk => { const e = byWeek.get(wk); return e ? e.done + e.planned : 0; };

  const wk0 = planWeekKey(todayKey);
  const firstDone = sessions.filter(s => !s.planned).map(s => s.date).sort()[0];
  const pastWeeks = [];
  for (let i = 1; i <= PERIOD_BASELINE_WEEKS; i++) {
    const wk = planShiftDay(wk0, -7 * i);
    if (firstDone && planShiftDay(wk, 6) >= firstDone) pastWeeks.push(wk);
  }
  const baselineMin = pastWeeks.length ? Math.round(pastWeeks.reduce((sum, wk) => sum + weekMin(wk), 0) / pastWeeks.length) : null;
  const base = baselineMin > 0 ? baselineMin : null;

  // Startniveau: der aktuelle Umfang, aber nie über der letzten normalen Woche
  // (sonst läge schon die erste Steigerung über der +10-%-Grenze). Mit Umfang
  // wird in Minuten gerechnet (auf 5 abgerundet), ohne nur in Prozent.
  const { ref, streak: streak0 } = planVolumeStreak(weekMin, wk0);
  const unit = base != null ? x => Math.floor(x / 5) * 5 : x => x;
  let level = base != null ? unit(ref != null ? Math.min(base, ref) : base) : 100;
  let streak = streak0, firstLoad = true;

  const weeks = [];
  for (let wk = wk0; ; wk = planShiftDay(wk, 7)) {
    const phase = getPhase(wk, goal);
    if (!phase) break;
    let type, value;
    if (PERIOD_GROWTH[phase] != null) {
      if (streak >= PLAN_DELOAD_EVERY_WEEKS - 1) {
        type = "entlastung"; value = unit(level * (1 - PLAN_DELOAD_REDUCTION)); streak = 0;
      } else {
        if (!firstLoad) level = unit(level * (1 + PERIOD_GROWTH[phase]));
        type = "belastung"; value = level; streak++; firstLoad = false;
      }
    } else if (phase === "taper") {
      const k = periodWeeksToRace(wk, goal);
      type = k === 0 ? "rennwoche" : "taper"; value = unit(level * PERIOD_TAPER_FACTORS[k]); streak = 0;
    } else {
      type = "erholung"; value = unit(level * PERIOD_RECOVERY_FACTOR); streak = 0;
    }
    const e = byWeek.get(wk) || { done: 0, planned: 0 };
    weeks.push({
      weekStart: wk, phase, type,
      targetPct: value / (base != null ? base : 100),
      targetMin: base != null ? value : null,
      doneMin: Math.round(e.done), plannedMin: Math.round(e.planned),
    });
  }
  return { baselineMin, baselineWeeks: pastWeeks.length, weeks };
}
