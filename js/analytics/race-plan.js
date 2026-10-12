// Rennplan je Ziel (Coach-Tab, js/components/race-plan.js): Pacing je
// Disziplin aus Distanz + Zielzeit des Ziels, die Tage der Rennwoche und die
// Standard-Checklisten. Rein rechnerisch, kein DOM. Fehlt eine Distanz oder
// Zielzeit, wird nichts geschätzt - das Ergebnis sagt dann, was fehlt.
//
// Gespeichert wird der Rennplan im Ziel selbst (goal.racePlan, setGoalRacePlan
// in js/data/goals.js); solange nichts geändert wurde, ist er null und es
// gelten die Standard-Listen aus defaultRacePlan().
//   { transition: [{ text, done }],             // Wechselzone (Triathlon) bzw. Ausrüstung
//     nutrition:  [{ text, done }],             // Verpflegung - freie Checkliste, keine Berechnung
//     raceWeek:   [{ text, done, dayOffset }] } // dayOffset -6..0 = Tage vor dem Renntag

const RACE_WEEK_DAYS = 7; // Rennwoche = Renntag und die 6 Tage davor
const RACE_PLAN_TEXT_MAX = 120;

const RACE_PACING_LEGS = {
  swim: { label: "Schwimmen", sport: "Schwimmen" },
  bike: { label: "Rad", sport: "Rad" },
  run: { label: "Laufen", sport: "Laufen" },
};
const RACE_PACING_KEY_BY_SPORT = { Schwimmen: "swim", Rad: "bike", Laufen: "run" };

const RACE_PLAN_DEFAULTS = {
  transitionTriathlon: [
    "Neoprenanzug, Schwimmbrille, Badekappe",
    "Rad: Reifendruck prüfen, leichten Gang für den Start einlegen",
    "Helm, Radschuhe und Sonnenbrille am Platz",
    "Laufschuhe, Startnummernband und Kappe am Platz",
    "Wege durch die Wechselzone ablaufen (Schwimmen → Rad → Laufen)",
  ],
  transitionOther: [
    "Startnummer und Befestigung (Nadeln/Band)",
    "Wettkampfschuhe und -kleidung",
    "Uhr bzw. Radcomputer geladen",
    "Wechselkleidung für danach",
  ],
  nutrition: [
    "Gels/Riegel einpacken",
    "Trinkflaschen füllen",
    "Frühstück wie im Training getestet",
    "Verpflegungsstellen der Strecke ansehen",
  ],
  raceWeek: [
    [-3, "Ausrüstung komplett durchchecken"],
    [-2, "Anreise und Startzeit prüfen"],
    [-1, "Startunterlagen abholen"],
    [-1, "Rad und Wechselbeutel einchecken", "Triathlon"],
    [-1, "Wettkampfbesprechung", "Triathlon"],
    [0, "Rechtzeitig am Start sein (Zeitplan prüfen)"],
  ],
};

// Überschrift der ersten Checkliste: beim Triathlon die Wechselzone, sonst die Ausrüstung.
function raceTransitionTitle(goal) {
  return goal && goal.sport === "Triathlon" ? "Wechselzone" : "Ausrüstung";
}

function defaultRacePlan(goal) {
  const tri = !!goal && goal.sport === "Triathlon";
  const item = text => ({ text, done: false });
  return {
    transition: (tri ? RACE_PLAN_DEFAULTS.transitionTriathlon : RACE_PLAN_DEFAULTS.transitionOther).map(item),
    nutrition: RACE_PLAN_DEFAULTS.nutrition.map(item),
    raceWeek: RACE_PLAN_DEFAULTS.raceWeek.filter(([, , onlyFor]) => !onlyFor || (goal && goal.sport === onlyFor))
      .map(([dayOffset, text]) => ({ text, done: false, dayOffset })),
  };
}

// Eigene Kopie des Rennplans (gespeichert oder Standard) - zum Ändern und
// anschließenden Speichern per setGoalRacePlan().
function racePlanOf(goal) {
  return goal && goal.racePlan ? JSON.parse(JSON.stringify(goal.racePlan)) : defaultRacePlan(goal);
}

// Zielzeit "H:MM:SS" oder "H:MM" -> Sekunden, sonst null. Zwei Teile heißen
// hier Stunden:Minuten wie in den Ziel-Formularen ("z.B. 5:30" = 5 h 30 min);
// die Anzeige nennt die gelesene Zeit, damit ein Missverständnis auffällt.
function parseRaceTargetTime(str) {
  const m = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(String(str == null ? "" : str).trim());
  if (!m) return null;
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  return sec > 0 ? sec : null;
}

// Gleichmäßiges Tempo je Disziplin. Triathlon: Schwimmen/Rad/Laufen aus den
// Unterdisziplinen, sonst eine Zeile aus Distanz + Zielzeit des Ziels.
// Je Disziplin: { key, label, sport, distanceKm, seconds, value, text, missing }
//   value: Schwimmen s je 100 m, Rad km/h, Laufen s je km (null, wenn etwas fehlt)
//   missing: was fehlt, z.B. ["Distanz fehlt", "Zielzeit fehlt"]
function computeRacePacing(goal) {
  if (!goal) return [];
  const legs = goal.sport === "Triathlon"
    ? Object.keys(RACE_PACING_LEGS).map(key => {
      const sub = (Array.isArray(goal.subDisciplines) ? goal.subDisciplines : []).find(s => s && s.key === key) || {};
      return { key, distanceKm: sub.distanceKm, targetTime: sub.targetTime };
    })
    : RACE_PACING_KEY_BY_SPORT[goal.sport] ? [{ key: RACE_PACING_KEY_BY_SPORT[goal.sport], distanceKm: goal.distanceKm, targetTime: goal.targetTime }] : [];
  return legs.map(racePacingLeg);
}

function racePacingLeg({ key, distanceKm, targetTime }) {
  const km = Number(distanceKm) > 0 ? Number(distanceKm) : null;
  const seconds = parseRaceTargetTime(targetTime);
  const missing = [];
  if (km == null) missing.push("Distanz fehlt");
  if (seconds == null) missing.push(targetTime ? `Zielzeit „${targetTime}“ nicht lesbar (Format H:MM:SS)` : "Zielzeit fehlt");
  let value = null, text = null;
  if (!missing.length) {
    if (key === "swim") { value = seconds / (km * 10); text = `${secondsToPace(value)} /100 m`; }
    else if (key === "bike") { value = km / (seconds / 3600); text = `${fmtNum(value, 1)} km/h`; }
    else { value = seconds / km; text = `${secondsToPace(value)} /km`; }
  }
  return { key, label: RACE_PACING_LEGS[key].label, sport: RACE_PACING_LEGS[key].sport, distanceKm: km, seconds, value, text, missing };
}

// Die Tage der Rennwoche (Renntag und die 6 Tage davor): je Tag die eigenen
// geplanten Einheiten (planned = plannedWorkouts) und die Checklisten-Punkte
// der Rennwoche (items = racePlan.raceWeek, mit ihrer Position idx).
function raceWeekDays(goal, planned, items) {
  const race = goal && goal.date ? new Date(goal.date + "T00:00:00") : null;
  if (!race || isNaN(race)) return [];
  return Array.from({ length: RACE_WEEK_DAYS }, (_, i) => {
    const offset = i - (RACE_WEEK_DAYS - 1);
    const day = new Date(race);
    day.setDate(race.getDate() + offset);
    const date = localDateStr(day);
    return {
      offset, date,
      sessions: (planned || []).filter(p => p.date === date),
      items: (items || []).map((it, idx) => ({ ...it, idx })).filter(it => it.dayOffset === offset),
    };
  });
}
