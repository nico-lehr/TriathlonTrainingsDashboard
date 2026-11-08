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
  strengthWish: "",     // "Was möchtest du mit dem Krafttraining erreichen?" (Freitext)
};

// Aus dem Freitext zum Krafttraining abgeleitet (strengthWishParse):
// strengthFocus = Muskelgruppen (STRENGTH_AREAS), strengthGoal = "athletic"
// bei Muskelaufbau-Wünschen, sonst "triathlon". So landet z. B. "Fokus auf
// Schultern und Brust" sicher in jeder Kraft-Einheit - der ganze Text geht
// zusätzlich an die KI.
const STRENGTH_WISH_WORDS = [
  ["chest", /brust|bankdr|liegestütz|\barm(e|en|s)?\b|oberarm|bizeps|trizeps/],
  ["shoulder", /schulter|deltamuskel/],
  ["back", /rücken|\blat\b|latissimus|klimmz/],
  ["core", /rumpf|bauch|\bcore\b|six-?pack/],
  ["legs", /\bbein(?!ahe)|oberschenkel|quadrizeps|kniebeug/],
  ["glute", /\bpo\b|gesäß|\bglute|hintern/],
  ["calf", /\bwade/],
];
const STRENGTH_ATHLETIC_RE = /\bathlet|muskelaufbau|muskelmasse|masse aufbauen|hypertroph|definiert|bodybuilding|\bfigur\b|breitere|muskulöse/;

function strengthWishParse(text) {
  const focus = [], unwanted = [];
  let athletic = false;
  // Satzteile mit "kein/nicht/ohne" zählen nicht - und was dort steht
  // ("keine Beinübungen") wird auch sonst nicht als Schwerpunkt genommen.
  String(text || "").toLowerCase().split(/[,.;!?\n]|\baber\b|\bsondern\b/).forEach(part => {
    if (/\b(kein|keine|keinen|nicht|ohne)\b/.test(part)) {
      STRENGTH_WISH_WORDS.forEach(([id, re]) => { if (re.test(part)) unwanted.push(id); });
      return;
    }
    if (STRENGTH_ATHLETIC_RE.test(part)) athletic = true;
    STRENGTH_WISH_WORDS
      .map(([id, re]) => [id, part.search(re)])
      .filter(([id, at]) => at >= 0 && !focus.includes(id))
      .sort((a, b) => a[1] - b[1])
      .forEach(([id]) => focus.push(id));
  });
  return { goal: athletic ? "athletic" : "triathlon", focus: focus.filter(id => !unwanted.includes(id)) };
}

// Bis 2.4.37 gab es Ziel und Schwerpunkt als Auswahl - daraus einmalig einen
// Text machen, damit niemandes Einstellung verloren geht.
function legacyStrengthWish(saved) {
  const parts = [];
  if (saved.strengthGoal === "athletic") parts.push("Athletischer Körper, Muskelaufbau");
  const focus = (Array.isArray(saved.strengthFocus) ? saved.strengthFocus : [])
    .map(id => (typeof STRENGTH_AREAS !== "undefined" ? STRENGTH_AREAS[id] : null)).filter(Boolean);
  if (focus.length) parts.push(`Schwerpunkt ${focus.join(" und ")}`);
  return parts.join(", ");
}

function trainingProfile() {
  const saved = athleteProfile.trainingProfile && typeof athleteProfile.trainingProfile === "object" ? athleteProfile.trainingProfile : {};
  const list = (v, allowed) => (Array.isArray(v) ? v : []).filter(x => allowed[x]);
  const strengthWish = typeof saved.strengthWish === "string" ? saved.strengthWish : legacyStrengthWish(saved);
  const wish = strengthWishParse(strengthWish);
  return {
    goals: typeof saved.goals === "string" ? saved.goals : "",
    focusAreas: list(saved.focusAreas, MOBILITY_AREAS),
    painAreas: list(saved.painAreas, MOBILITY_AREAS),
    avoid: list(saved.avoid, MOBILITY_AVOID),
    equipment: Array.isArray(saved.equipment) ? list(saved.equipment, MOBILITY_EQUIPMENT) : [...TRAINING_PROFILE_DEFAULT.equipment],
    mobilityPerWeek: [1, 2, 3, 4, 5].includes(saved.mobilityPerWeek) ? saved.mobilityPerWeek : TRAINING_PROFILE_DEFAULT.mobilityPerWeek,
    mobilityMinutes: [10, 15, 20, 30].includes(saved.mobilityMinutes) ? saved.mobilityMinutes : TRAINING_PROFILE_DEFAULT.mobilityMinutes,
    strengthWish,
    strengthGoal: wish.goal,
    strengthFocus: typeof STRENGTH_AREAS !== "undefined" ? wish.focus.filter(id => STRENGTH_AREAS[id]) : [],
  };
}

function saveTrainingProfile(patch) {
  // Ziel und Schwerpunkt werden immer aus dem Text abgeleitet, nie gespeichert.
  const { strengthGoal, strengthFocus, ...rest } = { ...trainingProfile(), ...patch };
  athleteProfile.trainingProfile = rest;
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
    lines.push(`Krafttraining-Wunsch: ${per}x pro Woche${tp.strengthFocus.length ? `, Schwerpunkt: ${labelList(tp.strengthFocus, STRENGTH_AREAS)}` : ""}${tp.strengthGoal === "athletic" ? ", Ziel: athletischer Körper / Muskelaufbau" : ""}`);
    if (tp.strengthWish.trim()) lines.push(`Was der Athlet mit dem Krafttraining erreichen möchte (eigene Worte, unbedingt berücksichtigen): "${tp.strengthWish.trim()}"`);
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
