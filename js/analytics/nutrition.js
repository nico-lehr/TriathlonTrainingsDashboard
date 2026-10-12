// Ernährungs-Berechnungen: rein deterministisch (kein LLM), analog zu den
// übrigen analytics/-Modulen (siehe AI_RULES.md Abschnitt 9). Drei
// Kernfunktionen: tages-/phasenabhängige Makro-Ziele, Pre-Workout-Timing für
// die nächste geplante Einheit, und ein Wettkampf-Verpflegungsplan. Alle
// Werte beruhen auf etablierten Sporternährungs-Richtlinien (Quellen in den
// Kommentaren) - NICHT auf einer individuellen Stoffwechselmessung, deshalb
// bewusst als Bereich/Richtwert kommuniziert statt als exakte Zahl. Fehlen
// nötige Grunddaten (Körpergewicht, Zielzeit, ...), wird nichts geraten -
// die jeweilige Funktion gibt dann null zurück.

// Kohlenhydrat-Bedarf nach täglichem Trainingsumfang, in g pro kg
// Körpergewicht/Tag (Thomas/Erdman/Burke, ACSM/AND/DC Joint Position Stand
// "Nutrition and Athletic Performance", Med Sci Sports Exerc 2016).
const CARB_CATEGORIES = {
  rest: { key: "rest", label: "Ruhetag / sehr leicht", min: 3, max: 5, mid: 4 },
  moderate: { key: "moderate", label: "moderates Training (~1h)", min: 5, max: 7, mid: 6 },
  endurance: { key: "endurance", label: "Ausdauerprogramm (1-3h)", min: 6, max: 10, mid: 8 },
  high: { key: "high", label: "hohes Volumen (>3h, intensiv)", min: 8, max: 12, mid: 10 },
  loading: { key: "loading", label: "Carb-Loading vor Wettkampf", min: 8, max: 12, mid: 10 },
};

// Protein-/Fett-Richtwerte für Ausdauerathleten - bewusst konstant, nicht
// phasenabhängig (Jäger et al., ISSN Position Stand "Protein and Exercise",
// 2017; ACSM-Fett-Untergrenze für Hormon-/Vitaminhaushalt). FAT_G_PER_KG_MIN
// ist eine Untergrenze, kein vollständiger Energiebilanz-Wert - dafür fehlt
// im Profil eine Grundlage (Größe/Geschlecht für eine BMR-Schätzung gibt es
// bewusst nicht, siehe DATA_MODEL.md).
const PROTEIN_G_PER_KG = 1.6;
const FAT_G_PER_KG_MIN = 1.0;

function todaysPlannedMinutesAndIntensity() {
  const todayKey = todayStr();
  const todays = (typeof plannedWorkouts !== "undefined" ? plannedWorkouts : []).filter(p => p.date === todayKey);
  const minutes = todays.reduce((s, p) => s + (p.duration_min || 0), 0);
  const hasHart = todays.some(p => p.intensity === "hart");
  return { minutes, hasHart, count: todays.length };
}

function daysUntilGoal(goal) {
  if (!goal || !goal.date) return null;
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  return Math.round((new Date(goal.date + "T00:00:00") - todayMid) / 86400000);
}

function classifyCarbCategory(minutes, hasHart) {
  let cat;
  if (!minutes) cat = CARB_CATEGORIES.rest;
  else if (minutes <= 75) cat = CARB_CATEGORIES.moderate;
  else if (minutes <= 180) cat = CARB_CATEGORIES.endurance;
  else cat = CARB_CATEGORIES.high;
  // Harte Einheit auch bei kürzerer Dauer eine Stufe höher (die ACSM-
  // Leitlinien berücksichtigen neben Dauer auch Intensität) - nie über "high" hinaus.
  if (hasHart && cat === CARB_CATEGORIES.rest) cat = CARB_CATEGORIES.moderate;
  else if (hasHart && cat === CARB_CATEGORIES.moderate) cat = CARB_CATEGORIES.endurance;
  return cat;
}

// Innerhalb der oben ermittelten Kategorie (die den HEUTIGEN Umfang abbildet)
// zusätzlich an die grobe Trainings-PHASE koppeln (computeTrainingPhase,
// js/analytics/training-plan.js - dieselbe Phase, die auch der Trainingsplan
// und der Coach-Kontext verwenden, siehe context-builder.js):
// - Grundlagenphase, an leichten/moderaten Tagen: bewusst untere
//   Bereichsgrenze ("train low") - fördert die Fettstoffwechsel-Adaption in
//   der Phase, in der das am wenigsten Risiko birgt (Impey et al., "Fuel for
//   the Work Required", Sports Med 2018). An Ausdauer-/hochvolumigen Tagen
//   NIE einschränken, unabhängig von der Phase - die Belastung selbst
//   braucht ausreichend Kohlenhydrate ("train high" für die harte/lange
//   Einheit selbst, nur die Ruhetage drumherum werden knapper gefahren).
// - Taper-Phase: obere Bereichsgrenze - Glykogenspeicher trotz sinkendem
//   Umfang für die noch verbleibenden intensiven/kurzen Einheiten und den
//   nahenden Wettkampf hochhalten (ergänzt das separate, noch schärfere
//   Carb-Loading-Protokoll der letzten 1-2 Tage, siehe unten).
// - Aufbau/spezifische Vorbereitung: unverändert die Mitte des Bereichs.
function carbBiasForPhase(phaseKey, catKey) {
  if (phaseKey === "grundlage" && (catKey === "rest" || catKey === "moderate")) return "low";
  if (phaseKey === "taper") return "high";
  return "mid";
}

// Haupt-Funktion für die "Tagesziel Makros"-Karte im Ernährungs-Tab. Koppelt
// sich bewusst an dieselben Größen wie der Trainingsplan/Coach-Kontext
// (heutige geplante Einheit(en), Trainingsphase, Hauptevent-Ziel) statt
// unabhängig davon zu rechnen - siehe Kommentar zu carbBiasForPhase().
function computeDailyMacroTargets() {
  const weightKg = (typeof getLatestWeightKg === "function") ? getLatestWeightKg() : (athleteProfile.weightKg || null);
  if (!weightKg) return null; // ohne Körpergewicht keine seriöse g/kg-Angabe

  const { minutes, hasHart } = todaysPlannedMinutesAndIntensity();
  let cat = classifyCarbCategory(minutes, hasHart);
  let isCarbLoading = false;
  let loadingNote = null;

  const goal = (typeof getPrimaryGoal === "function") ? getPrimaryGoal() : null;
  const daysUntil = daysUntilGoal(goal);
  const phase = (goal && daysUntil != null && typeof computeTrainingPhase === "function") ? computeTrainingPhase(daysUntil) : null;

  let bias = phase ? carbBiasForPhase(phase.key, cat.key) : "mid";
  let biasNote = null;
  if (bias === "low") biasNote = "untere Bereichsgrenze - Fettstoffwechsel-Fokus in der Grundlagenphase";
  else if (bias === "high") biasNote = "obere Bereichsgrenze - Glykogenspeicher in der Taper-Phase hochhalten";

  // Carb-Loading-Protokoll: die letzten 1-2 Tage vor einem längeren
  // Wettkampf, unabhängig vom heutigen Trainingsplan (Burke et al.,
  // "Carbohydrates for training and competition", J Sports Sci 2011) -
  // sticht die normale Phasen-Anpassung oben.
  if (goal && daysUntil != null && daysUntil >= 0 && daysUntil <= 2) {
    cat = CARB_CATEGORIES.loading;
    bias = "mid";
    biasNote = null;
    isCarbLoading = true;
    loadingNote = `Carb-Loading vor "${goal.name}" (${daysUntil === 0 ? "heute/morgen ist es soweit" : "noch " + daysUntil + (daysUntil === 1 ? " Tag" : " Tage")})`;
  }

  const carbPerKg = bias === "low" ? cat.min : bias === "high" ? cat.max : cat.mid;
  const carbG = Math.round(carbPerKg * weightKg);
  const proteinG = Math.round(PROTEIN_G_PER_KG * weightKg);
  const fatG = Math.round(FAT_G_PER_KG_MIN * weightKg);
  const kcal = Math.round(carbG * 4 + proteinG * 4 + fatG * 9);

  return {
    weightKg, category: cat, isCarbLoading, loadingNote,
    phaseLabel: phase ? phase.label : null, carbBias: bias, biasNote,
    carbG, carbRangeG: [Math.round(cat.min * weightKg), Math.round(cat.max * weightKg)],
    proteinG, fatG, kcal,
    todaysMinutes: minutes,
    sourceNote: "Richtwerte nach ACSM/AND/DC-Positionspapier (2016), ISSN-Positionspapier Protein (2017) und Impey et al. (2018) zur Trainingsphasen-Periodisierung - keine individuelle Stoffwechselmessung.",
  };
}

// Die nächsten anstehenden geplanten Einheiten (Kraft/Mobility ausgenommen -
// dafür ist ein Fueling-Timing nicht sinnvoll), sortiert nach Datum. Basis
// sowohl für die Standardauswahl (upcoming[0]) als auch für den Umschalter
// im Ernährungs-Tab, mit dem sich die Empfehlung für eine ANDERE der
// nächsten Einheiten ansehen lässt (siehe renderPreWorkoutTiming, nutrition.js).
function upcomingPreWorkoutCandidates(limit = 5) {
  const todayKey = todayStr();
  return (typeof plannedWorkouts !== "undefined" ? plannedWorkouts : [])
    .filter(p => p.date >= todayKey && p.status === "geplant" && p.sport !== "Kraft" && p.sport !== "Mobility")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}

// Reiner Baustein: Pre-Workout-Fueling-Schritte für EINE gegebene geplante
// Einheit (unabhängig davon, ob sie zu den "nächsten anstehenden" zählt) -
// Grundlage sowohl für computePreWorkoutTiming() (Ernährungs-Tab, s.u.) als
// auch für die Detailansicht einer einzelnen Einheit (Bearbeiten-Overlay,
// siehe openPlanEdit in js/components/training-plan.js), damit an beiden
// Stellen exakt dieselbe Empfehlung erscheint. Kraft/Mobility ausgenommen -
// dafür ist ein Kohlenhydrat-Timing nicht sinnvoll.
function preWorkoutStepsForWorkout(pw) {
  if (!pw || pw.sport === "Kraft" || pw.sport === "Mobility") return null;
  const weightKg = (typeof getLatestWeightKg === "function") ? getLatestWeightKg() : (athleteProfile.weightKg || null);
  const needsPreLoad = (pw.duration_min || 0) >= 90 || pw.intensity === "hart";

  const steps = [{
    when: "2-4h vorher",
    what: weightKg
      ? `${Math.round(weightKg * 1)}-${Math.round(weightKg * 2)} g leicht verdauliche Kohlenhydrate + ausreichend Flüssigkeit`
      : "1-2 g/kg leicht verdauliche Kohlenhydrate + ausreichend Flüssigkeit (Körpergewicht im Profil hinterlegen für eine genaue Gramm-Angabe)",
  }];
  steps.push(needsPreLoad
    ? { when: "30-60min vorher", what: "zusätzlich ca. 15-30 g schnell verfügbare Kohlenhydrate (z.B. Banane, Gel, Sportgetränk)" }
    : { when: "kurz vorher", what: "kein zwingendes Zusatz-Fueling nötig - Einheit ist kurz und nicht hochintensiv" });

  return {
    workout: pw, needsPreLoad, steps,
    sourceNote: "Richtwerte nach ISSN-Positionspapier 'Nutrient Timing' (Kerksick et al., 2017).",
  };
}

// Gruppiert die anstehenden Kandidaten nach Datum - Grundlage für den
// "ein Reiter pro Tag statt pro Workout"-Umschalter im Ernährungs-Tab
// (siehe CHANGE_REQUESTS.md #4: mehrere Workouts am selben Tag bekommen
// einen gemeinsamen Tages-Reiter statt je einem eigenen).
function groupPreWorkoutCandidatesByDate(candidates) {
  const map = new Map();
  candidates.forEach(pw => {
    if (!map.has(pw.date)) map.set(pw.date, []);
    map.get(pw.date).push(pw);
  });
  return [...map.entries()].map(([date, workouts]) => ({ date, workouts })).sort((a, b) => a.date.localeCompare(b.date));
}

// Kombinierte Pre-Workout-Fueling-Empfehlung für EINEN Tag mit ggf.
// mehreren Einheiten - eine einzige, zusammengeführte Tagesempfehlung
// (kein separater Block pro Workout, siehe CHANGE_REQUESTS.md #4).
// needsPreLoad/Zusatz-Fueling gilt, sobald mindestens eine der Einheiten
// lang/hart genug ist; bei mehreren Einheiten kommt ein Hinweis zum
// Auffüllen zwischen den Einheiten dazu.
function preWorkoutStepsForDay(dayWorkouts) {
  const relevant = (dayWorkouts || []).filter(pw => pw.sport !== "Kraft" && pw.sport !== "Mobility");
  if (!relevant.length) return null;
  const weightKg = (typeof getLatestWeightKg === "function") ? getLatestWeightKg() : (athleteProfile.weightKg || null);
  const needsPreLoad = relevant.some(pw => (pw.duration_min || 0) >= 90 || pw.intensity === "hart");

  const steps = [{
    when: "2-4h vorher",
    what: weightKg
      ? `${Math.round(weightKg * 1)}-${Math.round(weightKg * 2)} g leicht verdauliche Kohlenhydrate + ausreichend Flüssigkeit`
      : "1-2 g/kg leicht verdauliche Kohlenhydrate + ausreichend Flüssigkeit (Körpergewicht im Profil hinterlegen für eine genaue Gramm-Angabe)",
  }];
  steps.push(needsPreLoad
    ? { when: "30-60min vorher", what: "zusätzlich ca. 15-30 g schnell verfügbare Kohlenhydrate (z.B. Banane, Gel, Sportgetränk) - jeweils vor der anspruchsvolleren Einheit" }
    : { when: "kurz vorher", what: "kein zwingendes Zusatz-Fueling nötig - die Einheit(en) sind kurz und nicht hochintensiv" });
  if (relevant.length > 1) {
    steps.push({
      when: "zwischen den Einheiten",
      what: "Kohlenhydrate + Flüssigkeit wieder auffüllen (ca. 1 g/kg pro Stunde bis zur nächsten Einheit), damit für die folgende(n) Einheit(en) genug Energie da ist",
    });
  }

  return {
    workouts: relevant, needsPreLoad, steps,
    sourceNote: "Richtwerte nach ISSN-Positionspapier 'Nutrient Timing' (Kerksick et al., 2017).",
  };
}

// Pre-Workout-Timing für einen bestimmten ANSTEHENDEN Tag (ohne Argument:
// der nächste Tag mit geplanter Einheit) - für den Ernährungs-Tab, der nur
// aus den nächsten Tagen auswählen lässt (Umschalter, ein Reiter pro Tag).
// Geplante Einheiten haben keine Uhrzeit (nur ein Datum, siehe
// docs/DATA_MODEL.md) - die Empfehlung ist deshalb bewusst relativ zum
// Start formuliert ("X Stunden vorher"), nicht als konkrete Uhrzeit.
function computePreWorkoutTiming(dateKey) {
  const candidates = upcomingPreWorkoutCandidates();
  if (!candidates.length) return null;
  const days = groupPreWorkoutCandidatesByDate(candidates);
  const day = (dateKey && days.find(d => d.date === dateKey)) || days[0];
  const result = preWorkoutStepsForDay(day.workouts);
  if (!result) return null;
  return { ...result, date: day.date, days };
}

// Kohlenhydrat-Bedarf pro Stunde während längerer Belastung (Jeukendrup
// 2014; ACSM/AND/DC 2016) - separat für Rad/Laufen, da die Magen-Darm-
// Verträglichkeit beim Laufen (mechanische Erschütterung) niedriger ist als
// beim Radfahren.
function carbPerHourForDuration(hours, sportLabel) {
  if (hours == null) return null;
  if (hours < 1) return { minG: 0, maxG: 0, note: "unter 1h: i.d.R. keine zusätzlichen Kohlenhydrate nötig, nur trinken" };
  if (hours <= 2.5) return { minG: 30, maxG: 60, note: "1-2,5h: 30-60 g/h (eine Kohlenhydratquelle, z.B. Glukose/Maltodextrin)" };
  if (sportLabel === "Laufen") return { minG: 30, maxG: 60, note: ">2,5h Laufen: 30-60 g/h - höhere Mengen sind beim Laufen oft schwer verträglich" };
  return { minG: 60, maxG: 90, note: ">2,5h Rad: 60-90 g/h (mehrere Kohlenhydratquellen, z.B. Glukose+Fruktose) - vorher im Training testen" };
}

// Zielzeit ("H:MM:SS" oder "H:MM", siehe goalTimeToSeconds in js/utils/dates.js) -> Dauer in Stunden.
function hmsToHours(hms) {
  const s = goalTimeToSeconds(hms);
  return s == null ? null : s / 3600;
}

const NUTRITION_SPORT_LABEL = { swim: "Schwimmen", bike: "Rad", run: "Laufen" };

// Wettkampf-Verpflegungsplan aus dem Hauptevent-Ziel (Zielzeiten je
// Teildisziplin bei Triathlon, sonst die Gesamt-Zielzeit) - ohne Zielzeit
// keine seriöse Dauer, daher dann null statt geraten.
function computeRaceFuelingPlan() {
  const goal = (typeof getPrimaryGoal === "function") ? getPrimaryGoal() : null;
  if (!goal) return null;
  const weightKg = (typeof getLatestWeightKg === "function") ? getLatestWeightKg() : (athleteProfile.weightKg || null);

  const disciplines = [];
  if (goal.sport === "Triathlon" && Array.isArray(goal.subDisciplines)) {
    const order = { swim: 0, bike: 1, run: 2 };
    goal.subDisciplines.slice().sort((a, b) => order[a.key] - order[b.key]).forEach(sd => {
      disciplines.push({ key: sd.key, label: NUTRITION_SPORT_LABEL[sd.key] || sd.label, hours: hmsToHours(sd.targetTime), targetTime: sd.targetTime });
    });
  } else if (goal.targetTime) {
    const key = goal.sport === "Rad" ? "bike" : goal.sport === "Laufen" ? "run" : goal.sport === "Schwimmen" ? "swim" : null;
    if (key) disciplines.push({ key, label: goal.sport, hours: hmsToHours(goal.targetTime), targetTime: goal.targetTime });
  }

  if (!disciplines.length || disciplines.every(d => d.hours == null)) return null;

  let totalCarbMinG = 0, totalCarbMaxG = 0;
  const legs = disciplines.map(d => {
    if (d.hours == null) return { ...d, carb: null };
    let carb;
    if (d.key === "swim") {
      // Schwimmstrecken sind i.d.R. zu kurz für aktive Verpflegung während
      // der Einheit - erst ab 1h wird überhaupt eine Richtgröße ausgegeben.
      carb = d.hours >= 1
        ? { minG: 30, maxG: 60, note: `${d.hours.toFixed(1)}h Schwimmen: falls an Wechselzonen/Bojen möglich, 30-60 g/h` }
        : { minG: 0, maxG: 0, note: "unter 1h: keine Verpflegung während des Schwimmens nötig" };
    } else {
      carb = carbPerHourForDuration(d.hours, d.label);
    }
    if (carb) { totalCarbMinG += carb.minG * d.hours; totalCarbMaxG += carb.maxG * d.hours; }
    return { ...d, carb };
  });

  return {
    goal, legs, weightKg,
    totalCarbG: [Math.round(totalCarbMinG), Math.round(totalCarbMaxG)],
    fluidNote: "Faustregel ohne individuelle Schweißrate/Wetterdaten: ca. 400-800 ml Flüssigkeit pro Stunde, bei Hitze eher am oberen Ende (ACSM Fluid Replacement Guidelines).",
    sourceNote: "Kohlenhydrat-Richtwerte nach Jeukendrup (2014) und ACSM/AND/DC-Positionspapier (2016).",
  };
}
