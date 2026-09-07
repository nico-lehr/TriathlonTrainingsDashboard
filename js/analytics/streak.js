// Trainingsplan-Treue-Streak: rein deterministisch (kein LLM), analog zu den
// übrigen analytics/-Modulen. Zählt NICHT "Tage mit Training", sondern
// "Tage, an denen das eingehalten wurde, was laut Profil für diesen
// Wochentag vorgesehen war" - ein eingehaltener Ruhetag verlängert den
// Streak genauso wie eine absolvierte Einheit an einem Trainingstag. Ein
// per Erholungs-Check eingetragener Grund (Verletzung/wenig Energie/starker
// Muskelkater) "friert" den Streak an diesem Tag ein, statt ihn zu brechen -
// der Streak soll niemanden dazu verleiten, trotz Verletzung zu trainieren,
// nur um ihn nicht zu verlieren (siehe AI_RULES: Gesundheit geht vor).
//
// Bewusst KEIN manuelles "als erledigt markieren" nötig: ob ein Trainingstag
// eingehalten wurde, wird automatisch daran erkannt, ob an diesem Tag ein
// echtes (importiertes) Workout in ALL vorliegt - dieselbe Aktion
// ("Aktualisieren"), die der Nutzer ohnehin schon macht, hält also den
// Streak am Leben, ohne zusätzliche Buchhaltung.

const STREAK_LOOKBACK_MAX_DAYS = 400; // Sicherheitsgrenze für den Rückwärts-Scan (bricht ohnehin beim ersten verpassten Tag ab)

const STREAK_DOW_KEY_BY_JS_INDEX = ["so", "mo", "di", "mi", "do", "fr", "sa"];

// null = Trainingstage noch nicht im Profil hinterlegt (Streak lässt sich
// dann nicht sinnvoll berechnen - Feature bleibt bis dahin einfach unsichtbar
// statt etwas zu raten).
function isDeclaredTrainingDay(dayDate) {
  const days = athleteProfile.trainingDays;
  if (!Array.isArray(days) || !days.length) return null;
  return days.includes(STREAK_DOW_KEY_BY_JS_INDEX[dayDate.getDay()]);
}

function hadRealWorkoutOn(dayKey) {
  return ALL.some(w => w._date && !w.is_summary && localDateStr(w._date) === dayKey);
}

// Dieselben Erholungs-Check-Felder wie im Coach-Tab (js/data/health.js) -
// heute (recoveryCheck) UND das Logbuch für vergangene Tage.
function isRecoveryProtected(dayKey) {
  const entry = recoveryCheck.date === dayKey ? recoveryCheck : recoveryLog.find(e => e.date === dayKey);
  if (!entry) return false;
  return entry.injury === "yes" || entry.energy === "low" || entry.soreness === "severe";
}

// Status eines einzelnen Tages: "maintained" (erfüllt oder bewusster
// Ruhetag), "frozen" (Erholungsgrund eingetragen), "missed" (verpasst),
// "open" (heute, Tag noch nicht vorbei), "future".
function adherenceDayStatus(dayDate, todayKey) {
  const dayKey = localDateStr(dayDate);
  if (dayKey > todayKey) return "future";
  const trainDay = isDeclaredTrainingDay(dayDate);
  if (trainDay === false) return "maintained"; // laut Profil bewusst kein Trainingstag
  if (hadRealWorkoutOn(dayKey)) return "maintained";
  if (isRecoveryProtected(dayKey)) return "frozen";
  if (dayKey === todayKey) return "open";
  return "missed";
}

// Rückgabe: { days, frozenDays, todayStatus, atRisk } - oder null, wenn
// Trainingstage im Profil fehlen (Voraussetzung, um "Ruhetag laut Plan" von
// "Trainingstag verpasst" zu unterscheiden).
function computeAdherenceStreak() {
  if (!Array.isArray(athleteProfile.trainingDays) || !athleteProfile.trainingDays.length) return null;
  const todayKey = todayStr();
  let cursor = new Date(); cursor.setHours(0, 0, 0, 0);

  const todayStatus = adherenceDayStatus(cursor, todayKey);
  // Ist der heutige Tag noch offen (Trainingstag, noch nichts importiert),
  // startet der Rückwärts-Scan bei gestern - ein noch nicht absolviertes
  // heutiges Training soll den BISHERIGEN Streak nicht sofort auf 0 setzen,
  // sondern nur als "gefährdet" markiert werden (siehe atRisk unten).
  if (todayStatus === "open") cursor.setDate(cursor.getDate() - 1);

  let days = 0, frozenDays = 0;
  for (let i = 0; i < STREAK_LOOKBACK_MAX_DAYS; i++) {
    const status = adherenceDayStatus(cursor, todayKey);
    if (status === "missed") break;
    if (status === "maintained") days++;
    else if (status === "frozen") { days++; frozenDays++; }
    cursor.setDate(cursor.getDate() - 1);
  }

  return { days, frozenDays, todayStatus, atRisk: todayStatus === "open" };
}
