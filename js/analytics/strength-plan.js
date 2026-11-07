// Kraft-Einheit zusammenstellen - nur aus der Kraft-Sammlung
// (js/data/strength-exercises.js), damit jede Übung eine Zeichnung hat.
// Eine Einheit deckt die Bewegungsmuster ab: Kniebeuge-Typ, Hüfte, Drücken,
// Ziehen, Rumpf und eine Extra-Übung (Waden/Schulter-Schutz).
//
// Ergebnis (gleiche Form wie Mobility, plus kind: "strength"):
//   { kind, title, intro, minutes, source, createdAt,
//     exercises: [{ id, sets, reps | hold, rest, kg }] }

// Beschwerden im Trainingsprofil (Mobility-Bereiche) -> Kraft-Bereiche.
const STRENGTH_PAIN_MAP = {
  hip: ["glute"], glute: ["glute"], hamstring: ["legs"], quad: ["legs"], calf: ["calf"],
  lowback: ["back", "core"], upperback: ["back"], shoulder: ["shoulder", "chest"],
};

const STRENGTH_STATE_KEY = "triathlon_dashboard_strength_v1";
let strengthState = { weights: {}, history: [] };

function loadStrengthState() {
  const saved = storeGet(STRENGTH_STATE_KEY);
  strengthState = {
    weights: saved && saved.weights && typeof saved.weights === "object" ? saved.weights : {},
    history: saved && Array.isArray(saved.history) ? saved.history.slice(-60) : [],
  };
}

function saveStrengthState() {
  storeSet(STRENGTH_STATE_KEY, strengthState);
}

// Zuletzt genutztes Gewicht (kg) - sonst der Startvorschlag der Übung.
function strengthWeight(id) {
  const ex = STRENGTH_BY_ID[id];
  const kg = Number(strengthState.weights[id]);
  if (kg >= 0 && strengthState.weights[id] != null) return kg;
  if (!ex || !ex.weight) return null;
  // Gewicht ist bei Übungen ohne Pflicht-Gerät nur ein Zusatz: ohne Kurzhanteln
  // im Trainingsprofil mit 0 kg ("ohne Gewicht") starten.
  const tp = typeof trainingProfile === "function" ? trainingProfile() : null;
  if (!ex.equipment.length && tp && !(tp.equipment || []).includes("dumbbells")) return 0;
  return ex.startKg || 0;
}

function setStrengthWeight(id, kg) {
  strengthState.weights[id] = Math.max(0, Math.round(kg * 2) / 2);
  saveStrengthState();
}

function addStrengthHistory(entry) {
  strengthState.history.push({ ...entry, at: new Date().toISOString() });
  strengthState.history = strengthState.history.slice(-60);
  saveStrengthState();
}

function allowedStrengthExercises(tp) {
  const pain = new Set((tp.painAreas || []).flatMap(a => STRENGTH_PAIN_MAP[a] || []));
  return STRENGTH_EXERCISES.filter(ex =>
    ex.equipment.every(eq => (tp.equipment || []).includes(eq)) &&
    !ex.avoid.some(a => (tp.avoid || []).includes(a)) &&
    !(ex.level > 1 && ex.areas.some(a => pain.has(a))));
}

// Sekunden für eine Übung (Sätze + Pausen), grob: 3 s je Wiederholung.
function strengthExerciseSeconds(ex, x) {
  const sets = (x && x.sets) || ex.sets;
  const reps = parseInt((x && x.reps) || ex.reps, 10) || 10;
  const perSet = ex.hold ? ((x && x.hold) || ex.hold) : reps * 3 * (/je Seite/.test(ex.reps || "") ? 2 : 1);
  return sets * perSet + (sets - 1) * ((x && x.rest) || ex.rest) + 20;
}

function strengthSessionSeconds(session) {
  return session.exercises.reduce((s, x) => {
    const ex = STRENGTH_BY_ID[x.id];
    return ex ? s + strengthExerciseSeconds(ex, x) : s;
  }, 0);
}

// options: { tp, today, lastIds }
function buildStrengthSession(options) {
  const { tp, today = todayStr(), lastIds = [] } = options;
  const allowed = allowedStrengthExercises(tp);
  if (!allowed.length) return null;
  const picked = [];
  STRENGTH_GROUPS.forEach(group => {
    const pool = allowed.filter(ex => ex.group === group);
    if (!pool.length) return;
    // Abwechslung: zuletzt gemachte Übung möglichst nicht wieder, sonst fester Tagesrhythmus.
    const fresh = pool.filter(ex => !lastIds.includes(ex.id));
    const list = fresh.length ? fresh : pool;
    picked.push(list[Math.floor(mobilityDayHash(today + group) * list.length) % list.length]);
  });
  const exercises = picked.map(ex => ({
    id: ex.id, sets: ex.sets, reps: ex.reps || null, hold: ex.hold || null, rest: ex.rest,
    kg: ex.weight ? strengthWeight(ex.id) : null,
  }));
  const session = {
    kind: "strength",
    title: "Kraft für Triathlon",
    intro: "Beine, Hüfte, Rumpf, Rücken und Schultern – eine ausgewogene Einheit mit deinen Hilfsmitteln.",
    source: "rules",
    createdAt: new Date().toISOString(),
    exercises,
  };
  session.minutes = Math.max(5, Math.round(strengthSessionSeconds(session) / 60));
  return session;
}

// Geplante Kraft-Einheit (Trainingsplan) mit Übungen aus der Sammlung -> abspielbar.
function plannedToStrengthSession(pw) {
  const exercises = (pw.exercises || []).filter(x => x && STRENGTH_BY_ID[x.id]).map(x => {
    const ex = STRENGTH_BY_ID[x.id];
    return {
      id: ex.id, sets: Number(x.sets) > 0 ? Math.min(6, Math.round(Number(x.sets))) : ex.sets,
      reps: ex.hold ? null : (x.reps || ex.reps), hold: ex.hold || null, rest: ex.rest,
      kg: ex.weight ? strengthWeight(ex.id) : null,
    };
  });
  if (!exercises.length) return null;
  return { kind: "strength", title: pw.title || "Kraft", intro: pw.description || "", minutes: pw.duration_min, source: "plan", plannedId: pw.id, exercises };
}

// Für den KI-Trainingsplan: nur Übungen aus der Sammlung (wie Mobility).
function strengthPlanRule() {
  const allowed = allowedStrengthExercises(trainingProfile());
  if (!allowed.length) return "- Bei \"Kraft\": \"exercises\"-Array mit 4-6 Übungen (Name, Sätze, Wiederholungen, kurzer Hinweis).";
  const list = allowed.map(ex => `${ex.id} (${ex.name})`).join(", ");
  return `- Bei "Kraft": "exercises"-Array mit 4-6 Übungen AUSSCHLIESSLICH aus dieser Liste, je Eintrag {"id": exakt die id, "name": Name, "sets": 2-4, "reps": z.B. "10" oder "8 je Seite", "note": kurzer Tipp}. Möglichst je eine Übung für Beine, Hüfte, Drücken, Ziehen und Rumpf. Erlaubt: ${list}.`;
}
