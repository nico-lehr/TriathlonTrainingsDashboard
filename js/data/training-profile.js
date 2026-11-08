// "Dein Trainingsprofil": alle persönlichen Trainingswünsche an einer Stelle
// (Einstellungen → Dein Trainingsprofil). Liegt im Athletenprofil auf dem
// Server (athleteProfile.trainingProfile) und fließt in JEDE KI-Planung ein
// (trainingProfileContextLines, js/ai/context-builder.js) - nicht nur in
// Mobility. Freitext-Einschränkungen (limitations) und Zusatzwünsche
// (customPlanWishes) bleiben, wo sie waren, und werden hier mitbearbeitet.
//
// Außerdem: Verlauf und Rückmeldungen der Mobility-Einheiten
// (mobilityState), damit die nächste Einheit besser passt.

const TRAINING_PROFILE_DEFAULT = {
  goals: "",            // "Was möchtest du erreichen?"
  focusAreas: [],       // Bereiche, die beweglicher werden sollen (MOBILITY_AREAS)
  painAreas: [],        // Bereiche mit Beschwerden - dort nur sanfte Übungen
  avoid: [],            // Belastungen, die nicht vorkommen sollen (MOBILITY_AVOID)
  equipment: ["wall"],  // vorhandene Hilfsmittel (MOBILITY_EQUIPMENT)
  mobilityPerWeek: 2,
  mobilityMinutes: 15,
  strengthGoal: "triathlon", // Krafttraining: "triathlon" (stabil & verletzungsfrei) | "athletic" (athletischer Körper, Muskelaufbau)
  strengthFocus: [],         // Schwerpunkte beim Krafttraining (STRENGTH_AREAS, z. B. chest, shoulder)
};

const STRENGTH_GOALS = { triathlon: "Fit für Triathlon", athletic: "Athletischer Körper" };

function trainingProfile() {
  const saved = athleteProfile.trainingProfile && typeof athleteProfile.trainingProfile === "object" ? athleteProfile.trainingProfile : {};
  const list = (v, allowed) => (Array.isArray(v) ? v : []).filter(x => allowed[x]);
  return {
    goals: typeof saved.goals === "string" ? saved.goals : "",
    focusAreas: list(saved.focusAreas, MOBILITY_AREAS),
    painAreas: list(saved.painAreas, MOBILITY_AREAS),
    avoid: list(saved.avoid, MOBILITY_AVOID),
    equipment: Array.isArray(saved.equipment) ? list(saved.equipment, MOBILITY_EQUIPMENT) : [...TRAINING_PROFILE_DEFAULT.equipment],
    mobilityPerWeek: [1, 2, 3, 4, 5].includes(saved.mobilityPerWeek) ? saved.mobilityPerWeek : TRAINING_PROFILE_DEFAULT.mobilityPerWeek,
    mobilityMinutes: [10, 15, 20, 30].includes(saved.mobilityMinutes) ? saved.mobilityMinutes : TRAINING_PROFILE_DEFAULT.mobilityMinutes,
    strengthGoal: STRENGTH_GOALS[saved.strengthGoal] ? saved.strengthGoal : TRAINING_PROFILE_DEFAULT.strengthGoal,
    strengthFocus: typeof STRENGTH_AREAS !== "undefined" ? list(saved.strengthFocus, STRENGTH_AREAS) : [],
  };
}

function saveTrainingProfile(patch) {
  athleteProfile.trainingProfile = { ...trainingProfile(), ...patch };
  saveAthleteProfile();
}

const labelList = (ids, map) => ids.map(id => map[id]).filter(Boolean).join(", ");

// Zeilen für den KI-Kontext (Trainingsplan, Empfehlungen, Mobility).
function trainingProfileContextLines() {
  const tp = trainingProfile();
  const lines = [];
  if (tp.goals.trim()) lines.push(`Persönliche Trainingsziele des Athleten: ${tp.goals.trim()}`);
  if (tp.focusAreas.length) lines.push(`Möchte beweglicher werden in: ${labelList(tp.focusAreas, MOBILITY_AREAS)}`);
  if (tp.painAreas.length) lines.push(`Beschwerden (dort nur sanft belasten, nichts erzwingen): ${labelList(tp.painAreas, MOBILITY_AREAS)}`);
  if (tp.avoid.length) lines.push(`Bitte vermeiden: ${labelList(tp.avoid, MOBILITY_AVOID)}`);
  lines.push(`Vorhandene Hilfsmittel für Mobility: ${tp.equipment.length ? labelList(tp.equipment, MOBILITY_EQUIPMENT) : "keine (nur Matte/Boden)"}`);
  if (athleteProfile.includeMobility) lines.push(`Mobility-Wunsch: ${tp.mobilityPerWeek}x pro Woche, je ca. ${tp.mobilityMinutes} Minuten`);
  if (athleteProfile.includeStrength) {
    const per = [1, 2, 3].includes(Number(athleteProfile.strengthPerWeek)) ? Number(athleteProfile.strengthPerWeek) : 2;
    const goal = tp.strengthGoal === "athletic" ? "athletischer Körper / Muskelaufbau" : "stabil und verletzungsfrei für Triathlon";
    lines.push(`Krafttraining-Wunsch: ${per}x pro Woche, Ziel: ${goal}${tp.strengthFocus.length ? `, Schwerpunkt: ${labelList(tp.strengthFocus, STRENGTH_AREAS)}` : ""}`);
  }
  const fb = mobilityFeedbackSummary();
  if (fb) lines.push(`Rückmeldungen zu Mobility-Einheiten: ${fb}`);
  return lines;
}

/* ---------------------------------------------------- Mobility-Verlauf */

const MOBILITY_STATE_KEY = "triathlon_dashboard_mobility_v1";
const MOBILITY_HISTORY_MAX = 60;
const MOBILITY_PAIN_DAYS = 21; // so lange bleibt eine Übung nach "tat weh" draußen

let mobilityState = { current: null, history: [] };

function loadMobilityState() {
  const saved = storeGet(MOBILITY_STATE_KEY);
  mobilityState = {
    current: saved && saved.current && Array.isArray(saved.current.exercises) ? saved.current : null,
    history: saved && Array.isArray(saved.history) ? saved.history.slice(-MOBILITY_HISTORY_MAX) : [],
  };
}

function saveMobilityState() {
  storeSet(MOBILITY_STATE_KEY, mobilityState);
}

function setCurrentMobilitySession(session) {
  mobilityState.current = session;
  saveMobilityState();
}

// entry: { date, title, minutes, exercises: [id], rating: "easy"|"ok"|"hard", pain: [id], source }
function addMobilityHistory(entry) {
  mobilityState.history.push({ ...entry, at: new Date().toISOString() });
  mobilityState.history = mobilityState.history.slice(-MOBILITY_HISTORY_MAX);
  saveMobilityState();
}

function daysBetween(a, b) {
  return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
}

// Übungen, die in den letzten 3 Wochen weh getan haben.
function mobilityPainfulIds(today) {
  const ids = new Set();
  mobilityState.history.forEach(h => {
    if (h.date && daysBetween(h.date, today) <= MOBILITY_PAIN_DAYS) (h.pain || []).forEach(id => ids.add(id));
  });
  return ids;
}

// Tendenz der letzten Einheiten: -1 = eher zu schwer, +1 = eher zu leicht.
function mobilityDifficultyTrend() {
  const last = mobilityState.history.slice(-3).filter(h => h.rating);
  if (!last.length) return 0;
  const score = last.reduce((s, h) => s + (h.rating === "easy" ? 1 : h.rating === "hard" ? -1 : 0), 0);
  return score >= 1 ? 1 : score <= -1 ? -1 : 0;
}

function mobilityFeedbackSummary() {
  const last = mobilityState.history.slice(-5);
  if (!last.length) return "";
  const words = { easy: "zu leicht", ok: "passend", hard: "zu schwer" };
  const parts = last.filter(h => h.rating).map(h => `${h.date}: ${words[h.rating]}`);
  const pain = [...mobilityPainfulIds(todayStr())].map(id => (MOBILITY_BY_ID[id] || {}).name).filter(Boolean);
  if (pain.length) parts.push(`schmerzhaft (weglassen): ${pain.join(", ")}`);
  return parts.join("; ");
}
