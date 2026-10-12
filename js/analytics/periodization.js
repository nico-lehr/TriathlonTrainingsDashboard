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

// Anker = "aktueller Wochenumfang": die letzte normale Woche aus Regel 4 von
// plan-rules.js (planVolumeStreak) - Entlastungs-, Taper- und Krankheits-
// wochen verschieben ihn nicht, so sinkt das Ziel nicht von selbst. Nur ohne
// normale Woche der Ø der letzten 4 abgeschlossenen Wochen (ab dem ersten
// erfassten Training), ohne beides nur Prozent. Alle Ziele sind Anteile davon.
const PERIOD_BASELINE_WEEKS = 4;

// Steigerung je Belastungswoche (schon in der aktuellen Woche) - bewusst unter
// der +10-%-Grenze von plan-rules.js (PLAN_MAX_WEEKLY_INCREASE): Grundlage
// langsam, Aufbau etwas mehr, in der spezifischen Phase wird gehalten.
const PERIOD_GROWTH = { grundlage: 0.03, aufbau: 0.05, spezifisch: 0 };

// Die Vorausschau steigt höchstens 30 % über den Anker. Der Anker wandert
// jeden Montag mit dem tatsächlich Trainierten mit - die echte Steigerung
// bestimmt also das Training; die Grenze verhindert nur absurde Spitzen bei
// einem Rennen in weiter Ferne (sonst z. B. 925 statt 370 Minuten in einem Jahr).
const PERIOD_MAX_GROWTH = 0.3;

// Taper: Anteil der letzten Belastungswoche - [Rennwoche, Woche davor] (ein
// Eintrag je PERIOD_TAPER_WEEKS). Erholungswoche nach dem Rennen.
const PERIOD_TAPER_FACTORS = [0.5, 0.7];
const PERIOD_RECOVERY_FACTOR = 0.4;

// Entlastungswochen kommen aus Regel 4 von plan-rules.js: dieselbe Zählweise
// (planVolumeStreak), derselbe Takt (PLAN_DELOAD_EVERY_WEEKS) und dieselbe
// Absenkung (PLAN_DELOAD_REDUCTION). Entlastung, Taper und Erholung werden aus
// dem angezeigten Wert der letzten Belastungswoche berechnet und zählen damit
// für Regel 4 immer als "leichtere Woche". Fiele eine Entlastungswoche genau
// auf die letzte Woche vor dem Taper, entfällt sie (sonst drei leichte Wochen
// in Folge) - Regel 4 macht dort dieselbe Ausnahme.
//
// Die Zielkurve reicht höchstens 104 Wochen voraus (auch Schutz vor
// Tippfehlern wie 9999-12-31).
const PERIOD_HORIZON_WEEKS = 104;

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

// Ziel, das `daysUntil` Tage nach heute stattfindet - für Aufrufer, die nur
// die Tage kennen (computeTrainingPhase, Race-Readiness).
function periodRaceInDays(daysUntil) {
  const race = periodDay(new Date());
  race.setDate(race.getDate() + daysUntil);
  return { date: localDateStr(race) };
}

// Die Phasen von `date` bis zum Ende der Erholung als zusammenhängende
// Abschnitte: [{ phase, from, to }] ("YYYY-MM-DD", jeweils einschließlich).
// Der erste Abschnitt ist die aktuelle Phase, der zweite der nächste Wechsel.
// Direkt aus den Grenzen berechnet (Montage vor der Rennwoche), ohne Tag für Tag.
function getPhaseTimeline(date, goal) {
  if (!getPhase(date, goal)) return [];
  const day = periodDay(date), race = periodDay(goal.date);
  const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const firstMonday = weeks => shift(weekStart(race), -7 * (weeks - 1)); // erste Woche mit k = weeks - 1
  const taper = firstMonday(PERIOD_TAPER_WEEKS);
  const specific = firstMonday(PERIOD_TAPER_WEEKS + PERIOD_SPECIFIC_WEEKS);
  const build = firstMonday(PERIOD_TAPER_WEEKS + PERIOD_SPECIFIC_WEEKS + PERIOD_BUILD_WEEKS);
  return [
    { phase: "grundlage", from: null, to: shift(build, -1) },
    { phase: "aufbau", from: build, to: shift(specific, -1) },
    { phase: "spezifisch", from: specific, to: shift(taper, -1) },
    { phase: "taper", from: taper, to: race },
    { phase: "erholung", from: shift(race, 1), to: shift(race, PERIOD_RECOVERY_DAYS) },
  ].filter(seg => seg.to >= day)
    .map(seg => ({ phase: seg.phase, from: localDateStr(!seg.from || seg.from < day ? day : seg.from), to: localDateStr(seg.to) }));
}

/* ---------- Zielumfang ---------- */

// Zielumfang je Kalenderwoche von der aktuellen Woche bis zum Ende der
// Erholungswoche (höchstens PERIOD_HORIZON_WEEKS). plannedWorkouts/history
// wie bei validatePlan() - gezählt wird genauso (planSessions: absolviert +
// noch offen geplant), nur der Wettkampftag selbst nicht (das Rennen ist kein
// Trainingsumfang). Liefert null ohne Ziel/Datum, sonst:
//   { baselineMin, baselineWeek, baselineWeeks, weeks: [{ weekStart, phase,
//     type, targetPct, targetMin, doneMin, plannedMin }] }
// baselineMin = Anker in Minuten: die letzte normale Woche (baselineWeek =
// ihr Montag) oder, ohne sie, der Ø über baselineWeeks Wochen. null, wenn es
// keinen Umfang gibt (kein Training in den letzten Wochen) - dann sind auch
// alle targetMin null, targetPct gibt es trotzdem. Minuten ganzzahlig
// abgerundet. Annahme für spätere Wochen: der Plan folgt der Kurve - dann
// liefert die Neuberechnung am nächsten Montag dieselben Ziele.
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
  const { ref, refWeek, streak: streak0 } = planVolumeStreak(weekMin, wk0);
  const firstDone = sessions.filter(s => !s.planned).map(s => s.date).sort()[0];
  const pastWeeks = [];
  for (let i = 1; i <= PERIOD_BASELINE_WEEKS; i++) {
    const wk = planShiftDay(wk0, -7 * i);
    if (firstDone && planShiftDay(wk, 6) >= firstDone) pastWeeks.push(wk);
  }
  const average = pastWeeks.length ? Math.round(pastWeeks.reduce((sum, wk) => sum + weekMin(wk), 0) / pastWeeks.length) : 0;
  const baselineMin = ref != null ? planFloorMin(ref) : (average > 0 ? average : null);

  // In Minuten mit ganzzahlig abgerundeten Werten; ohne Umfang in Prozent
  // (Anker 100, ungerundet). `last` = angezeigter Wert der letzten
  // Belastungswoche - daraus wachsen die nächsten Wochen und daraus ergeben
  // sich Entlastung, Taper und Erholung.
  const start = baselineMin != null ? baselineMin : 100;
  const show = baselineMin != null ? planFloorMin : x => x;
  const cap = start * (1 + PERIOD_MAX_GROWTH);
  let last = start, streak = streak0;

  const weeks = [];
  for (let i = 0, wk = wk0; i < PERIOD_HORIZON_WEEKS; i++, wk = planShiftDay(wk, 7)) {
    const phase = getPhase(wk, goal);
    if (!phase) break;
    const k = periodWeeksToRace(wk, goal);
    let type, value;
    if (PERIOD_GROWTH[phase] != null) {
      if (streak >= PLAN_DELOAD_EVERY_WEEKS - 1 && k !== PERIOD_TAPER_WEEKS) {
        type = "entlastung"; value = show(last * (1 - PLAN_DELOAD_REDUCTION)); streak = 0;
      } else {
        last = show(Math.min(cap, last * (1 + PERIOD_GROWTH[phase])));
        type = "belastung"; value = last; streak++;
      }
    } else if (phase === "taper") {
      type = k === 0 ? "rennwoche" : "taper"; value = show(last * PERIOD_TAPER_FACTORS[k]); streak = 0;
    } else {
      type = "erholung"; value = show(last * PERIOD_RECOVERY_FACTOR); streak = 0;
    }
    const e = byWeek.get(wk) || { done: 0, planned: 0 };
    weeks.push({
      weekStart: wk, phase, type,
      targetPct: value / start,
      targetMin: baselineMin != null ? value : null,
      doneMin: Math.round(e.done), plannedMin: Math.round(e.planned),
    });
  }
  return { baselineMin, baselineWeek: ref != null ? refWeek : null, baselineWeeks: ref != null ? 0 : pastWeeks.length, weeks };
}
