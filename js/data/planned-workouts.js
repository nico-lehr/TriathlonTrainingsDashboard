// Geplante Trainingseinheiten (KI-generierter oder manuell angelegter
// Trainingsplan) - eigener Datentyp, getrennt von den echten, aus .fit-Dateien
// importierten Workouts (ALL/DATA, siehe workouts.js). Ein geplantes Workout
// hat KEINE Streckendaten/Ist-Werte, nur eine Absicht (Sportart, Dauer,
// Intensität, Beschreibung) - siehe docs/DATA_MODEL.md.

const PLANNED_WORKOUTS_KEY = "triathlon_dashboard_planned_workouts_v1";

let plannedWorkouts = [];

// Gespeichert in der Ablage pro Person auf dem Server (js/data/api-client.js).
function loadPlannedWorkouts() {
  plannedWorkouts = storeGet(PLANNED_WORKOUTS_KEY) || [];
  if (!Array.isArray(plannedWorkouts)) plannedWorkouts = [];
  fixPlannedMobilityTimes();
}

// Ältere Mobility-Einheiten aus KI-Plänen: Übungszeiten passten oft nicht zur
// geplanten Dauer (10 Min geplant, 3 Min Übungen). Kommende Einheiten hier
// einmal passend machen und speichern - erledigte bleiben, wie sie waren.
function fixPlannedMobilityTimes() {
  if (typeof fitPlanMobility !== "function" || typeof mobilityTotalSeconds !== "function") return;
  const today = todayStr();
  let changed = false;
  plannedWorkouts.forEach(p => {
    if (p.sport !== "Mobility" || p.date < today || (p.status || "geplant") !== "geplant" || !Array.isArray(p.exercises) || !(p.duration_min > 0)) return;
    const lib = p.exercises.filter(x => x && x.id && MOBILITY_BY_ID[x.id]);
    if (!lib.length) return;
    const total = mobilityTotalSeconds(lib);
    if (total >= p.duration_min * 60 * 0.85 && total <= p.duration_min * 60 * 1.15) return;
    const list = p.exercises.slice();
    fitPlanMobility(list, p.duration_min);
    p.exercises = list;
    changed = true;
  });
  if (changed) storeSet(PLANNED_WORKOUTS_KEY, plannedWorkouts);
}

function savePlannedWorkouts() {
  storeSet(PLANNED_WORKOUTS_KEY, plannedWorkouts);
  scheduleIcalSync();
  if (typeof scheduleGarminPush === "function") scheduleGarminPush(); // Trainings auf die Uhr (js/data/garmin-push.js)
}

// Kalender-Abo (iCal) - der Server bekommt eine Kopie der geplanten Einheiten
// zum Erzeugen des .ics-Feeds (siehe backend/routes.py: /api/v1/ical-sync,
// CHANGE_REQUESTS.md). Rein "best effort": schlägt es fehl, zeigt das Abo
// einfach den letzten erfolgreichen Stand. Debounced statt bei jedem
// einzelnen savePlannedWorkouts()-Aufruf sofort zu senden, da z.B. eine
// mehrtägige KI-Trainingsplan-Erstellung mehrfach hintereinander speichert.
let icalSyncTimer = null;

function scheduleIcalSync() {
  clearTimeout(icalSyncTimer);
  icalSyncTimer = setTimeout(() => {
    apiCall("ical-sync", "POST", { workouts: plannedWorkouts }).catch(() => { /* letzter Stand bleibt */ });
  }, 1200);
}

function newPlannedWorkoutId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("pw" + Date.now() + Math.random().toString(16).slice(2));
}

// Neuer, noch nicht gespeicherter Eintrag - gemeinsame Form für ALLE Wege,
// auf denen Einheiten entstehen: addPlannedWorkout() (manuell),
// applyPlanSuggestion() (add_easy_session), addOpenWishesToPlan() (Wünsche)
// und die KI-Planung (generateTrainingPlan).
// entry: { date, sport, title, duration_min, intensity, description, exercises, steps, goalId, phase, source }
// `phase` ergibt sich ohne Angabe aus Datum + Ziel (getPhase,
// js/analytics/periodization.js) - die Phase am Tag der Einheit, nicht die von heute.
function buildPlannedWorkout(entry) {
  return {
    id: newPlannedWorkoutId(),
    date: entry.date,
    sport: entry.sport,
    title: entry.title || entry.sport,
    duration_min: entry.duration_min != null ? Number(entry.duration_min) : null,
    intensity: entry.intensity || null, // "leicht" | "mittel" | "hart"
    description: entry.description || null,
    exercises: Array.isArray(entry.exercises) && entry.exercises.length ? entry.exercises : null, // nur Kraft/Mobility: [{name, sets, reps, note}]
    steps: entry.steps ? validateWorkoutSteps(entry.steps).steps : null, // optional, siehe validateWorkoutSteps unten
    status: "geplant", // "geplant" | "erledigt" | "uebersprungen"
    goalId: entry.goalId || null,
    phase: entry.phase || plannedWorkoutPhase(entry),
    source: entry.source || "manual", // "ai" | "manual"
    createdAt: new Date().toISOString(),
  };
}

// Trainingsphase einer Einheit an ihrem Datum für ihr Ziel (getPhase,
// js/analytics/periodization.js) - ohne Ziel null.
function plannedWorkoutPhase(entry) {
  const goal = entry.goalId ? goals.find(g => g.id === entry.goalId) : null;
  return getPhase(entry.date, goal);
}

// Einheit mit Änderungen; bei neuem Datum auch neue Phase (außer der
// Aufrufer setzt sie selbst).
function withPlannedPatch(pw, patch) {
  const next = { ...pw, ...patch };
  if (patch.date && patch.date !== pw.date && !("phase" in patch)) next.phase = plannedWorkoutPhase(next);
  return next;
}

function addPlannedWorkout(entry) {
  const pw = buildPlannedWorkout(entry);
  plannedWorkouts.push(pw);
  savePlannedWorkouts();
  return pw;
}

function updatePlannedWorkout(id, patch) {
  const pw = plannedWorkouts.find(p => p.id === id);
  if (!pw) return null;
  Object.assign(pw, withPlannedPatch(pw, patch));
  savePlannedWorkouts();
  return pw;
}

function deletePlannedWorkout(id) {
  plannedWorkouts = plannedWorkouts.filter(p => p.id !== id);
  savePlannedWorkouts();
}

function plannedWorkoutsOfDay(dayDate) {
  const key = localDateStr(dayDate);
  return plannedWorkouts.filter(p => p.date === key);
}

function plannedWorkoutsForGoal(goalId) {
  return plannedWorkouts.filter(p => p.goalId === goalId);
}

// Entfernt alle noch bevorstehenden (>= heute) geplanten Einheiten eines
// Ziels - Grundlage für "Plan neu erstellen" (ersetzt statt ergänzt, siehe
// generateTrainingPlan in js/ai/ollama.js). Bereits vergangene/erledigte
// Einheiten bleiben als Trainingshistorie erhalten.
function deleteFuturePlannedWorkoutsForGoal(goalId) {
  const todayKey = todayStr();
  plannedWorkouts = plannedWorkouts.filter(p => !(p.goalId === goalId && p.date >= todayKey));
  savePlannedWorkouts();
}

// Entfernt bevorstehende geplante Einheiten ALLER ANDEREN Ziele - wird beim
// Erstellen eines Plans für das aktuelle Hauptevent aufgerufen, damit nicht
// gleichzeitig der (jetzt veraltete) Plan eines früheren Hauptevents im
// Kalender steht und sich mit dem neuen Plan widerspricht (mehrere,
// gegensätzliche Trainings am selben Tag).
function deleteFuturePlannedWorkoutsForOtherGoals(goalId) {
  const todayKey = todayStr();
  const before = plannedWorkouts.length;
  plannedWorkouts = plannedWorkouts.filter(p => !(p.goalId && p.goalId !== goalId && p.date >= todayKey));
  if (plannedWorkouts.length !== before) savePlannedWorkouts();
}

// Bereits verplante zukünftige Tage (ab heute) für ein Ziel - Grundlage für
// das rollierende Nachplanen (siehe computePlanningWindow/shouldAutoReplan
// in js/analytics/training-plan.js).
function futurePlannedDatesForGoal(goalId) {
  const todayKey = todayStr();
  return [...new Set(plannedWorkouts.filter(p => p.goalId === goalId && p.date >= todayKey).map(p => p.date))].sort();
}

/* ---------- Änderungen mit Regelprüfung (js/analytics/plan-rules.js) ---------- */

// Prüft eine (geänderte) Liste mit validatePlan() gegen den aktuellen Stand
// des Athleten: echte Workouts (DATA), Garmin-Werte, heutiger
// Erholungs-Check, Hauptevent. Den ACWR holt validatePlan() selbst
// (computePerformanceState). options: weitere validatePlan-Optionen, z. B. planUntil.
function planRuleViolations(list, options = {}) {
  const wellness = typeof planWellnessInput === "function" ? planWellnessInput()
    : { hrv_ms: wellnessDeviation("hrv_ms"), resting_hr: wellnessDeviation("resting_hr") };
  return validatePlan(list, DATA, wellness, recoveryCheck, { goal: getPrimaryGoal(), ...options });
}

// Kopie der Liste mit geänderter Einheit - die Vorschau, die erst geprüft
// und dann mit replacePlannedWorkouts() übernommen wird.
function patchedPlannedWorkouts(list, id, patch) {
  return list.map(p => (p.id === id ? withPlannedPatch(p, patch) : p));
}

// Wendet einen Vorschlag des Regelwerks (suggestion aus validatePlan()) auf
// eine KOPIE von `list` an - gespeichert wird erst mit replacePlannedWorkouts().
// `defaults` ergänzt eine neu eingeplante Einheit (add_easy_session), z. B.
// { goalId, phase, source }. null = der Vorschlag passt nicht zur Liste.
function applyPlanSuggestion(list, suggestion, defaults = {}) {
  const s = suggestion || {};
  const copy = list.map(p => ({ ...p }));
  const find = id => copy.find(p => p.id === id);
  const target = s.workoutId != null ? find(s.workoutId) : null;
  switch (s.action) {
    case "move":
      if (!target || !s.toDate) return null;
      Object.assign(target, withPlannedPatch(target, { date: s.toDate }));
      return copy;
    case "set_intensity":
      if (!target || !s.intensity) return null;
      // Die Beschreibung (z. B. "6x400m zügig") passt danach nicht mehr zur
      // Intensität - deshalb ein sichtbarer Hinweis davor statt still ändern.
      if (target.intensity !== s.intensity) target.description = [`Vom Regelwerk auf „${s.intensity}“ gesetzt.`, target.description].filter(Boolean).join(" ");
      target.intensity = s.intensity;
      if (s.duration_min) target.duration_min = s.duration_min;
      return copy;
    case "reduce_duration":
      if (!target || !s.duration_min) return null;
      target.duration_min = s.duration_min;
      return copy;
    case "reduce_week_volume":
      if (!Array.isArray(s.workouts) || !s.workouts.length || !s.workouts.every(w => find(w.workoutId))) return null;
      s.workouts.forEach(w => { find(w.workoutId).duration_min = w.duration_min; });
      return copy;
    case "make_rest_day": {
      const ids = s.workoutIds || [];
      if (!ids.some(id => find(id))) return null;
      return copy.filter(p => !ids.includes(p.id));
    }
    case "add_easy_session":
      if (!s.date || !s.sport) return null;
      return [...copy, buildPlannedWorkout({ ...defaults, date: s.date, sport: s.sport, title: `${s.sport} locker`, duration_min: s.duration_min, intensity: "leicht" })];
    default:
      return null;
  }
}

// Übernimmt eine (geprüfte) Liste als neuen Trainingsplan.
function replacePlannedWorkouts(list) {
  plannedWorkouts = list;
  savePlannedWorkouts();
}

/* ---------- Schritte einer Einheit (Garmin-Workout und .fit-Export) ----------
   Optionales Feld `steps` am Eintrag:
     [{ type: "warmup", duration_min: 10, target: { kind: "none" } },
      { type: "repeat", count: 6, steps: [
          { type: "interval", distance_km: 0.4, target: { kind: "pace_zone", zone: 4 } },
          { type: "recovery", duration_min: 1.5, target: { kind: "none" } } ] },
      { type: "cooldown", duration_min: 10 }]
   Je Schritt duration_min ODER distance_km (keins = bis Lap-Taste). Eine
   Wiederholung enthält nur einfache Schritte (keine Wiederholung in der
   Wiederholung). Fehlen `steps`, gelten defaultWorkoutSteps(). */
const WORKOUT_STEP_TYPES = ["warmup", "interval", "recovery", "cooldown", "rest", "repeat"];
const WORKOUT_TARGET_KINDS = ["none", "hr_zone", "pace_zone", "power_zone"];
const WORKOUT_STEP_LABELS = { warmup: "Aufwärmen", interval: "Belastung", recovery: "Erholung", cooldown: "Abwärmen", rest: "Pause", repeat: "Wiederholung" };
const WORKOUT_TARGET_LABELS = { none: "ohne Ziel", hr_zone: "HF-Zone", pace_zone: "Pace-Zone", power_zone: "Leistungszone" };
const WORKOUT_STEP_MAX = 50;

// Prüft eine Schritt-Liste. Ergebnis { steps, errors }: steps ist die
// bereinigte Liste (nur bekannte Felder) oder null, sobald etwas nicht passt.
function validateWorkoutSteps(steps) {
  const errors = [];
  let total = 0;
  const positive = (v, max) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;
  const clean = (s, nr, nested) => {
    total++;
    if (!s || typeof s !== "object" || !WORKOUT_STEP_TYPES.includes(s.type)) { errors.push(`Schritt ${nr}: unbekannte Art.`); return null; }
    if (s.type === "repeat") {
      if (nested) { errors.push(`Schritt ${nr}: keine Wiederholung in einer Wiederholung.`); return null; }
      if (!Number.isInteger(s.count) || s.count < 1 || s.count > 50) errors.push(`Schritt ${nr}: Wiederholungen 1–50.`);
      if (!Array.isArray(s.steps) || !s.steps.length) { errors.push(`Schritt ${nr}: Wiederholung ohne Schritte.`); return null; }
      return { type: "repeat", count: s.count, steps: s.steps.map((c, i) => clean(c, `${nr}.${i + 1}`, true)) };
    }
    const out = { type: s.type };
    if (s.duration_min != null && s.distance_km != null) errors.push(`Schritt ${nr}: Dauer ODER Distanz, nicht beides.`);
    else if (s.duration_min != null) { if (positive(s.duration_min, 1440)) out.duration_min = s.duration_min; else errors.push(`Schritt ${nr}: Dauer ungültig.`); }
    else if (s.distance_km != null) { if (positive(s.distance_km, 1000)) out.distance_km = s.distance_km; else errors.push(`Schritt ${nr}: Distanz ungültig.`); }
    const t = s.target || { kind: "none" };
    if (!WORKOUT_TARGET_KINDS.includes(t.kind)) errors.push(`Schritt ${nr}: unbekanntes Ziel.`);
    else if (t.kind === "none") out.target = { kind: "none" };
    else if (Number.isInteger(t.zone) && t.zone >= 1 && t.zone <= 5) out.target = { kind: t.kind, zone: t.zone };
    else errors.push(`Schritt ${nr}: Zone 1–5 angeben.`);
    if (typeof s.stroke === "string" && WORKOUT_STROKES.includes(s.stroke)) out.stroke = s.stroke;
    if (typeof s.note === "string" && s.note.trim()) out.note = s.note.trim().slice(0, 100);
    return out;
  };
  if (!Array.isArray(steps) || !steps.length) return { steps: null, errors: ["Keine Schritte angegeben."] };
  const cleaned = steps.map((s, i) => clean(s, String(i + 1), false));
  if (total > WORKOUT_STEP_MAX) errors.push(`Höchstens ${WORKOUT_STEP_MAX} Schritte.`);
  return { steps: errors.length ? null : cleaned, errors };
}

// Schwimmstile (Garmin zeigt sie am Schritt): Kraul, Rücken, Brust, Delfin,
// Technik, Lagen, beliebig.
const WORKOUT_STROKES = ["free", "back", "breast", "fly", "drill", "im", "any"];
const WORKOUT_STROKE_LABELS = { free: "Kraul", back: "Rücken", breast: "Brust", fly: "Delfin", drill: "Technik", im: "Lagen", any: "beliebig" };

/* ---------- Detaillierte Standard-Schritte (wie ein Garmin-Coach-Workout) ----------
   Hat eine Einheit keine eigenen Schritte, baut defaultWorkoutSteps() einen
   vollständigen Ablauf aus Sportart, Dauer und Intensität: Einlaufen /
   Einschwimmen, Technik oder Lauf-ABC, Hauptsatz als Wiederholung mit
   Pausen, Ausklang. Jeder Schritt hat einen kurzen Hinweis (note), den die
   Uhr anzeigt; Schwimmen hat Distanzen (25-m-Bahn) und den Schwimmstil.
   Ziele: Laufen Pace-Zone (Schwellenpace im Profil) sonst Puls-Zone, Rad
   Leistungszone (FTP im Profil) sonst Puls-Zone, Schwimmen Pace-Zone (CSS
   im Profil) sonst ohne Ziel. Steht im Titel/Text ein Satz wie "6×800 m"
   oder "5 x 4 min", wird genau der der Hauptsatz. Die Zeiten ergeben
   zusammen die geplante Dauer (Schwimmen: geschätzt aus der CSS). */
const DEFAULT_STEP_HR_ZONE = { leicht: 2, mittel: 3, hart: 4 };
const DEFAULT_SWIM_PACE_S = 120; // ohne CSS: 2:00 /100 m

function stepProfile() {
  return typeof athleteProfile !== "undefined" && athleteProfile ? athleteProfile : {};
}

// Ziel-Zone als Target je Sportart (siehe oben).
function stepTarget(sport, zone) {
  if (!zone) return { kind: "none" };
  const prof = stepProfile();
  if (sport === "Laufen") return { kind: prof.runThresholdPace ? "pace_zone" : "hr_zone", zone };
  if (sport === "Rad") return { kind: prof.ftpWatts ? "power_zone" : "hr_zone", zone };
  return prof.swimCss ? { kind: "pace_zone", zone } : { kind: "none" };
}

// "6×800 m", "5 x 4 min", "10x100m", "3 × 1,5 km" aus Titel/Beschreibung -> Satz.
// Pause dahinter optional: "/ 2 min", "mit 90 s Pause", "P 20 s".
function parseMainSet(pw) {
  const text = `${pw.title || ""} ${pw.description || ""}`;
  const m = /(\d{1,2})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(km|m|min|sek|s)\b/i.exec(text);
  if (!m) return null;
  const count = Number(m[1]);
  const value = Number(m[2].replace(",", "."));
  const unit = m[3].toLowerCase();
  if (!(count >= 2 && count <= 30) || !(value > 0)) return null;
  const set = { count };
  if (unit === "km") set.distance_km = value;
  else if (unit === "m") set.distance_km = value / 1000;
  else if (unit === "min") set.duration_min = value;
  else set.duration_min = value / 60;
  if (set.distance_km != null && !(set.distance_km >= 0.025 && set.distance_km <= 20)) return null;
  if (set.duration_min != null && !(set.duration_min >= 0.25 && set.duration_min <= 60)) return null;
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
  const r = /(?:\/|mit|P(?:ause)?|Trabpause)\s*(\d+(?:[.,]\d+)?)\s*(min|sek|s)\b/i.exec(after);
  if (r) {
    const v = Number(r[1].replace(",", "."));
    const rest = /min/i.test(r[2]) ? v : v / 60;
    if (rest > 0 && rest <= 15) set.rest_min = rest;
  }
  return set;
}

const roundTo = (v, step) => Math.round(v / step) * step;
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const minutesRounded = v => Math.round(v * 60) / 60; // auf ganze Sekunden

function defaultWorkoutSteps(pw) {
  const d = Number(pw.duration_min) > 0 ? Number(pw.duration_min) : null;
  const sport = pw.sport;
  const intensity = ["leicht", "mittel", "hart"].includes(pw.intensity) ? pw.intensity : "leicht";
  if (!["Laufen", "Rad", "Schwimmen"].includes(sport) || !d) {
    const zone = ["Laufen", "Rad"].includes(sport) ? DEFAULT_STEP_HR_ZONE[pw.intensity] : null;
    const main = zone ? stepTarget(sport, zone) : { kind: "none" };
    return [d ? { type: "interval", duration_min: d, target: main } : { type: "interval", target: main }];
  }
  return sport === "Schwimmen" ? swimSteps(pw, d, intensity) : landSteps(pw, d, intensity);
}

// Wiederholungen, die in `left` Minuten passen; reicht die Zeit nicht für
// minCount, werden Belastung und Erholung kürzer (nie unter 1 min / 30 s).
function fitSet(left, work, rest, minCount, maxCount) {
  let count = Math.floor(left / (work + rest));
  if (count < minCount) {
    count = minCount;
    const per = left / count;
    rest = Math.min(rest, Math.max(0.5, Math.floor(per / 3 * 2) / 2));
    work = Math.max(1, Math.floor((per - rest) * 2) / 2);
  }
  count = Math.min(count, maxCount);
  return { count, work: { duration_min: work }, workMin: work, rest };
}

const timeStep = (type, minutes, target, note) => ({ type, duration_min: minutesRounded(minutes), target, ...(note ? { note } : {}) });

// Laufen und Rad: Aufwärmen, (Grundlage), Hauptsatz, Abwärmen - in Minuten.
function landSteps(pw, d, intensity) {
  const sport = pw.sport;
  const run = sport === "Laufen";
  const T = z => (z > 1 ? stepTarget(sport, z) : { kind: "none" }); // locker = ohne Ziel (kein Piepen)
  const warm = d >= 60 ? 15 : d >= 30 ? 10 : 5;
  const cool = d >= 60 ? 10 : 5;
  const word = run ? ["Einlaufen", "Auslaufen", "Traben"] : ["Einrollen", "Ausrollen", "Locker kurbeln"];
  if (d < 20) return [timeStep("interval", d, T(DEFAULT_STEP_HR_ZONE[intensity]), "Locker und gleichmäßig")];
  const out = [timeStep("warmup", warm, T(1), `${word[0]} · ganz locker`)];
  const left = d - warm - cool;

  // Hauptsatz: aus dem Text oder je Intensität
  const parsed = parseMainSet(pw);
  let set = null;
  if (parsed) {
    const zone = intensity === "hart" ? (parsed.distance_km != null && parsed.distance_km <= 0.6 || (parsed.duration_min || 99) <= 3 ? 5 : 4) : intensity === "mittel" ? 3 : 2;
    const paceS = run ? (paceToSeconds(stepProfile().runThresholdPace) || 330) : null;
    const workMin = parsed.duration_min != null ? parsed.duration_min : run ? parsed.distance_km * paceS / 60 : parsed.distance_km / 0.5; // Rad ~30 km/h
    const rest = parsed.rest_min != null ? parsed.rest_min : intensity === "hart" ? 2 : 1.5;
    set = { count: parsed.count, work: parsed.duration_min != null ? { duration_min: minutesRounded(parsed.duration_min) } : { distance_km: parsed.distance_km },
      workMin, rest, zone, note: `${parsed.count}× ${parsed.distance_km != null ? (parsed.distance_km < 1 ? `${Math.round(parsed.distance_km * 1000)} m` : `${parsed.distance_km} km`) : `${minutesRounded(parsed.duration_min)} min`} · Zone ${zone}` };
  } else if (intensity === "mittel") {
    set = fitSet(left, run ? (d >= 60 ? 10 : 8) : (d >= 75 ? 15 : 10), run ? 2 : 5, 2, run ? 5 : 4);
    Object.assign(set, { zone: 3, note: run ? "Tempo · zügig, aber kontrolliert" : "Sweet Spot · kräftig, gleichmäßig treten" });
  } else if (intensity === "hart") {
    const vo2 = d < 50;
    set = fitSet(left, run ? (vo2 ? 3 : 5) : (vo2 ? 3 : 8), run ? 2 : (vo2 ? 3 : 4), 3, vo2 ? 8 : 6);
    Object.assign(set, { zone: vo2 ? 5 : 4, note: vo2 ? "Hart · VO2max, letzte Wiederholung gleich schnell" : "Schwelle · hart, aber gleichmäßig" });
  }

  if (set) {
    const setMin = set.count * (set.workMin + set.rest);
    const base = parsed ? Math.round(left - setMin) : left - setMin; // Sätze aus dem Text: geschätzt -> ganze Minuten
    if (base >= 5) out.push(timeStep("interval", base, T(2), "Grundlage · locker, Reden geht"));
    else if (base > 0) out[0].duration_min = minutesRounded(out[0].duration_min + base);
    const work = { type: "interval", ...set.work, target: T(set.zone), note: set.note };
    const rec = timeStep("recovery", set.rest, T(1), run ? "Traben · locker erholen" : "Locker kurbeln · erholen");
    out.push({ type: "repeat", count: set.count, steps: [work, rec] });
    out.push(timeStep("cooldown", cool, T(1), `${word[1]} · ganz locker`));
    return out;
  }

  // leicht: Grundlage, ab 40 min mit Steigerungen (Laufen) bzw. Trittfrequenz (Rad)
  if (d >= 40) {
    const extra = run ? { count: 4, work: 20 / 60, rest: 40 / 60, zone: 5, note: "Steigerung · locker schnell, kein Sprint", restNote: "Gehen oder traben" }
      : { count: 3, work: 1, rest: 2, zone: 3, note: "Hohe Trittfrequenz · über 100/min", restNote: "Locker kurbeln" };
    const extraMin = extra.count * (extra.work + extra.rest);
    out.push(timeStep("interval", left - extraMin, T(2), "Grundlage · locker, Reden geht"));
    out.push({ type: "repeat", count: extra.count, steps: [
      timeStep("interval", extra.work, run ? { kind: "none" } : T(extra.zone), extra.note),
      timeStep("recovery", extra.rest, T(1), extra.restNote),
    ] });
  } else {
    out.push(timeStep("interval", left, T(2), "Grundlage · locker, Reden geht"));
  }
  out.push(timeStep("cooldown", cool, T(1), `${word[1]} · ganz locker`));
  return out;
}

// Schwimmen: Einschwimmen, Technik, Hauptsatz, Ausschwimmen - in Metern
// (vielfache von 50 m bzw. 25 m), Zeit geschätzt aus CSS bzw. 2:00 /100 m.
function swimSteps(pw, d, intensity) {
  const css = paceToSeconds(stepProfile().swimCss) || DEFAULT_SWIM_PACE_S;
  const T = z => stepTarget("Schwimmen", z);
  const secs = (m, f) => m / 100 * css * f; // f = langsamer/schneller als CSS
  const km = m => Math.round(m) / 1000;
  const swim = (type, meters, stroke, target, note) => ({ type, distance_km: km(meters), stroke, target, note });
  const rest = (s, note) => ({ type: "rest", duration_min: s / 60, target: { kind: "none" }, note: note || "Pause am Rand" });
  let budget = d * 60;
  const out = [];

  const warmM = clampNum(roundTo(d * 60 * 0.15 / secs(1, 1.25), 50), 100, 400);
  out.push(swim("warmup", warmM, "free", { kind: "none" }, "Einschwimmen · locker, lang gleiten"));
  budget -= secs(warmM, 1.25);
  const coolM = d >= 45 ? 200 : 100;
  budget -= secs(coolM, 1.3);

  if (d >= 25) {
    const n = d >= 50 ? 8 : d >= 35 ? 6 : 4;
    out.push({ type: "repeat", count: n, steps: [
      swim("interval", 50, "drill", { kind: "none" }, "Technik · z. B. Abschlag, Faust, Zählen"),
      rest(15),
    ] });
    budget -= n * (secs(50, 1.4) + 15) - 15;
  }

  const parsed = parseMainSet(pw);
  let set;
  if (parsed && parsed.distance_km != null) {
    const len = clampNum(roundTo(parsed.distance_km * 1000, 25), 25, 1500);
    const zone = intensity === "hart" ? (len <= 50 ? 5 : 4) : intensity === "mittel" ? 3 : 2;
    set = { len, count: parsed.count, rest: Math.round((parsed.rest_min != null ? parsed.rest_min * 60 : len <= 100 ? 20 : 30)), zone };
  } else {
    const len = intensity === "leicht" ? (d >= 60 ? 300 : 200) : intensity === "mittel" ? (d >= 60 ? 200 : 100) : (d < 35 ? 50 : 100);
    const restS = intensity === "leicht" ? 20 : intensity === "mittel" ? 15 : (len <= 50 ? 30 : 20);
    const zone = intensity === "leicht" ? 2 : intensity === "mittel" ? 3 : (len <= 50 ? 5 : 4);
    const f = { 2: 1.15, 3: 1.05, 4: 1.0, 5: 0.94 }[zone];
    const count = clampNum(Math.floor((budget + restS) / (secs(len, f) + restS)), 2, 30);
    set = { len, count, rest: restS, zone };
  }
  const words = { 2: "Gleichmäßig locker · saubere Technik", 3: "Zügig · gleichmäßiges Tempo", 4: "Hart · CSS-Tempo halten", 5: "Sehr schnell · volle Kraft" };
  out.push({ type: "repeat", count: set.count, steps: [
    swim("interval", set.len, "free", T(set.zone), `Hauptsatz · ${words[set.zone]}`),
    rest(set.rest),
  ] });
  out.push(swim("cooldown", coolM, "any", { kind: "none" }, "Ausschwimmen · locker, beliebiger Stil"));
  return out;
}

// Die Schritte, die wirklich verwendet werden (.fit-Export, Garmin-Versand):
// eigene, sofern gültig, sonst die Standard-Schritte.
function plannedWorkoutSteps(pw) {
  return (pw.steps && validateWorkoutSteps(pw.steps).steps) || defaultWorkoutSteps(pw);
}
