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
let strengthState = { weights: {}, history: [], mode: null };

// Trainingsart: womit trainierst du? Wand und Bank/Stuhl gibt es fast überall.
// "prefer": Übungen mit diesen Geräten kommen zuerst dran.
const STRENGTH_MODES = {
  body: { label: "Eigengewicht", equipment: ["wall", "bench"], prefer: [] },
  dumbbells: { label: "Kurzhanteln", equipment: ["wall", "bench", "dumbbells"], prefer: ["dumbbells"] },
  kettlebell: { label: "Kettlebell", equipment: ["wall", "bench", "kettlebell"], prefer: ["kettlebell"] },
  band: { label: "Band", equipment: ["wall", "bench", "band"], prefer: ["band"] },
  gym: { label: "Studio", equipment: ["wall", "bench", "dumbbells", "kettlebell", "band", "barbell", "cable", "machine", "pullup"], prefer: ["barbell", "cable", "machine", "dumbbells"] },
};
// Ohne Gewichte: Übungen mit optionalem Gewicht starten mit 0 kg.
const STRENGTH_MODES_NO_WEIGHT = ["body", "band"];

function loadStrengthState() {
  const saved = storeGet(STRENGTH_STATE_KEY);
  strengthState = {
    weights: saved && saved.weights && typeof saved.weights === "object" ? saved.weights : {},
    history: saved && Array.isArray(saved.history) ? saved.history.slice(-60) : [],
    mode: saved && STRENGTH_MODES[saved.mode] ? saved.mode : null,
  };
}

// Gewählte Trainingsart - ohne Auswahl: Kurzhanteln, wenn welche im Profil stehen.
function strengthMode(tp) {
  if (STRENGTH_MODES[strengthState.mode]) return strengthState.mode;
  const prof = tp || (typeof trainingProfile === "function" ? trainingProfile() : null);
  return prof && (prof.equipment || []).includes("dumbbells") ? "dumbbells" : "body";
}

function setStrengthMode(mode) {
  if (!STRENGTH_MODES[mode]) return;
  strengthState.mode = mode;
  saveStrengthState();
}

// Hilfsmittel für eine Trainingsart (+ Klimmzugstange, wenn sie im Profil steht).
function strengthModeEquipment(tp, mode) {
  const eq = [...STRENGTH_MODES[mode].equipment];
  if ((tp.equipment || []).includes("pullup") && !eq.includes("pullup")) eq.push("pullup");
  return eq;
}

// Gewicht für eine Übung in der gewählten Trainingsart (null = Übung ohne Gewicht).
const STRENGTH_WEIGHT_GEAR = ["dumbbells", "kettlebell", "barbell", "cable", "machine"];
function strengthModeKg(ex, mode) {
  if (!ex.weight) return null;
  const needsGear = ex.equipment.some(e => STRENGTH_WEIGHT_GEAR.includes(e));
  if (!needsGear && STRENGTH_MODES_NO_WEIGHT.includes(mode)) return 0;
  const saved = strengthState.weights[ex.id];
  if (saved != null && Number(saved) >= 0) return Number(saved);
  // Mit Gewichten gewählt: Startvorschlag, auch wenn das Profil keine Kurzhanteln kennt.
  if (!needsGear && STRENGTH_MODES[mode] && !STRENGTH_MODES_NO_WEIGHT.includes(mode)) return ex.startKg || 0;
  return strengthWeight(ex.id);
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

// mode: Trainingsart (STRENGTH_MODES) - ohne Angabe zählen die Hilfsmittel im Profil.
function allowedStrengthExercises(tp, mode) {
  const pain = new Set((tp.painAreas || []).flatMap(a => STRENGTH_PAIN_MAP[a] || []));
  const have = mode && STRENGTH_MODES[mode] ? strengthModeEquipment(tp, mode) : (tp.equipment || []);
  return STRENGTH_EXERCISES.filter(ex =>
    ex.equipment.every(eq => have.includes(eq)) &&
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

// Übungen einer Gruppe, die zur Trainingsart passen - bevorzugte Geräte zuerst.
function strengthGroupPool(allowed, group, mode) {
  const pool = allowed.filter(ex => ex.group === group);
  const prefer = mode && STRENGTH_MODES[mode] ? STRENGTH_MODES[mode].prefer : [];
  const best = pool.filter(ex => ex.equipment.some(e => prefer.includes(e)));
  return best.length ? best : pool;
}

function strengthPick(list, key, lastIds) {
  // Abwechslung: zuletzt gemachte Übung möglichst nicht wieder, sonst fester Tagesrhythmus.
  const fresh = list.filter(ex => !lastIds.includes(ex.id));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(mobilityDayHash(key) * pool.length) % pool.length];
}

const STRENGTH_MAX_EXERCISES = 8;
const STRENGTH_FOCUS_PER_AREA = 2;

// Sätze: für einen athletischen Körper (Muskelaufbau) einer mehr, höchstens 4.
function strengthSets(ex, tp) {
  return tp && tp.strengthGoal === "athletic" && !ex.hold ? Math.min(4, ex.sets + 1) : ex.sets;
}

// Zusätzliche Übungen für die Schwerpunkte: je Bereich bis zu zwei, die noch
// nicht in der Einheit sind - bevorzugt mit den Geräten der Trainingsart.
function strengthFocusPicks(allowed, focus, mode, usedIds, key) {
  const used = new Set(usedIds);
  const out = [];
  const prefer = mode && STRENGTH_MODES[mode] ? STRENGTH_MODES[mode].prefer : [];
  focus.forEach(area => {
    // Übungen, die schon für diesen Bereich in der Einheit sind, zählen mit.
    let have = [...used].filter(id => STRENGTH_BY_ID[id] && STRENGTH_BY_ID[id].areas[0] === area).length;
    // Hauptbereich zuerst (Bankdrücken für Brust, nicht Rudern), dann Übungen
    // mit den Geräten der Trainingsart.
    const rank = ex => (ex.areas[0] === area ? 0 : 2) + (ex.equipment.some(e => prefer.includes(e)) ? 0 : 1);
    let pool = allowed.filter(ex => ex.areas.includes(area) && !used.has(ex.id)).sort((a, b) => rank(a) - rank(b));
    while (have < STRENGTH_FOCUS_PER_AREA && pool.length) {
      const top = pool.filter(ex => rank(ex) === rank(pool[0]));
      const ex = top[Math.floor(mobilityDayHash(key + area + have) * top.length) % top.length];
      out.push(ex); used.add(ex.id); have++;
      pool = pool.filter(x => x !== ex);
    }
  });
  return out;
}

// Eine KI-Kraft-Einheit (Plan-Format {id, name, sets, reps}) um die
// Schwerpunkte ergänzen, wenn sie dafür zu wenig enthält. null = passt schon.
function strengthEnsureFocus(exercises, tp, mode, key) {
  const focus = (tp.strengthFocus || []).filter(a => STRENGTH_AREAS[a]);
  if (!focus.length) return null;
  const list = Array.isArray(exercises) ? exercises.slice() : [];
  const ids = list.map(x => x && x.id).filter(Boolean);
  const room = STRENGTH_MAX_EXERCISES - list.length;
  if (room <= 0) return null;
  const add = strengthFocusPicks(allowedStrengthExercises(tp, mode), focus, mode, ids, key).slice(0, room);
  if (!add.length) return null;
  return [...list, ...add.map(ex => ({ id: ex.id, name: ex.name, sets: strengthSets(ex, tp), reps: ex.hold ? `${ex.hold} s` : ex.reps, note: `Schwerpunkt ${STRENGTH_AREAS[focus.find(a => ex.areas.includes(a))] || ""}`.trim() }))];
}

// Fertige Kraft-Einheit für den Trainingsplan (wenn die KI zu wenige
// Kraft-Einheiten plant): Übungen nach den Regeln oben, im Plan-Format.
function plannedStrengthEntry(date, tp, mode) {
  const session = buildStrengthSession({ tp, today: date, mode, lastIds: [] });
  if (!session) return null;
  return {
    sport: "Kraft", title: session.title, intensity: "mittel",
    duration_min: Math.max(20, Math.round(session.minutes / 5) * 5),
    description: session.intro,
    exercises: session.exercises.map(x => {
      const ex = STRENGTH_BY_ID[x.id];
      return { id: x.id, name: ex.name, sets: x.sets, reps: ex.hold ? `${ex.hold} s` : ex.reps };
    }),
  };
}

// options: { tp, today, lastIds, mode }
function buildStrengthSession(options) {
  const { tp, today = todayStr(), lastIds = [], mode } = options;
  const allowed = allowedStrengthExercises(tp, mode);
  if (!allowed.length) return null;
  const picked = [];
  STRENGTH_GROUPS.forEach(group => {
    const list = strengthGroupPool(allowed, group, mode);
    if (list.length) picked.push(strengthPick(list, today + group, lastIds));
  });
  // Schwerpunkte (z. B. Brust und Schultern): je Bereich zwei Übungen mehr.
  const focus = (tp.strengthFocus || []).filter(a => STRENGTH_AREAS[a]);
  strengthFocusPicks(allowed, focus, mode, picked.map(ex => ex.id), today).forEach(ex => picked.push(ex));
  const athletic = tp.strengthGoal === "athletic";
  const exercises = picked.slice(0, STRENGTH_MAX_EXERCISES).map(ex => ({
    id: ex.id, sets: strengthSets(ex, tp), reps: ex.reps || null, hold: ex.hold || null, rest: ex.rest,
    kg: mode ? strengthModeKg(ex, mode) : (ex.weight ? strengthWeight(ex.id) : null),
  }));
  const label = mode && STRENGTH_MODES[mode] ? STRENGTH_MODES[mode].label : "";
  const focusText = focus.length ? `Schwerpunkt ${focus.map(a => STRENGTH_AREAS[a]).join(" und ")}` : "";
  const session = {
    kind: "strength",
    title: athletic ? `Kraft · ${focus.length ? STRENGTH_AREAS[focus[0]] : "Athletik"}` : label ? `Kraft · ${label}` : "Kraft für Triathlon",
    intro: focus.length
      ? `${focusText} – dazu Beine, Hüfte und Rumpf, damit der Körper im Gleichgewicht bleibt.${athletic ? " Für Muskelaufbau: die letzten Wiederholungen dürfen schwer sein." : ""}`
      : "Beine, Hüfte, Rumpf, Rücken und Schultern – eine ausgewogene Einheit mit deinen Hilfsmitteln.",
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
      kg: strengthModeKg(ex, strengthMode()),
    };
  });
  if (!exercises.length) return null;
  return { kind: "strength", title: pw.title || "Kraft", intro: pw.description || "", minutes: pw.duration_min, source: "plan", plannedId: pw.id, exercises };
}

// Geplante Übungen an eine andere Trainingsart anpassen: Übungen, die nicht
// passen (oder deren Gruppe bevorzugte Geräte hat), gegen eine aus derselben
// Gruppe tauschen. Sätze/Wiederholungen der neuen Übung, Hinweis bleibt weg.
// strict: nur tauschen, was mit den Geräten gar nicht geht.
// Ergebnis: neue exercises-Liste im Plan-Format oder null, wenn nichts zu tun ist.
function adaptStrengthExercises(list, tp, mode, today = todayStr(), strict = false) {
  const allowed = allowedStrengthExercises(tp, mode);
  const used = new Set();
  let changed = false;
  const out = (list || []).map((x, i) => {
    const cur = x && STRENGTH_BY_ID[x.id];
    if (!cur) return x;
    const pool = strengthGroupPool(allowed, cur.group, mode);
    const fits = (strict ? allowed : pool).some(ex => ex.id === cur.id);
    if (fits && !used.has(cur.id)) { used.add(cur.id); return x; }
    const options = pool.filter(ex => !used.has(ex.id));
    if (!options.length) return x;
    const ex = strengthPick(options, today + cur.group + i, []);
    used.add(ex.id);
    changed = true;
    return { id: ex.id, name: ex.name, sets: ex.sets, reps: ex.hold ? `${ex.hold} s` : ex.reps };
  });
  return changed ? out : null;
}

// Für den KI-Trainingsplan: nur Übungen aus der Sammlung (wie Mobility),
// passend zur gewählten Trainingsart.
function strengthPlanRule() {
  const tp = trainingProfile();
  const allowed = allowedStrengthExercises(tp, strengthMode(tp));
  if (!allowed.length) return "- Bei \"Kraft\": \"exercises\"-Array mit 4-6 Übungen (Name, Sätze, Wiederholungen, kurzer Hinweis).";
  const list = allowed.map(ex => `${ex.id} (${ex.name})`).join(", ");
  const focus = (tp.strengthFocus || []).filter(a => STRENGTH_AREAS[a]);
  const focusRule = focus.length
    ? ` WICHTIG - Schwerpunkt dieser Person: ${focus.map(a => STRENGTH_AREAS[a]).join(", ")}. In JEDER Kraft-Einheit mindestens 2 Übungen je Schwerpunkt (passend: ${focus.map(a => allowed.filter(ex => ex.areas[0] === a || ex.areas.includes(a)).slice(0, 6).map(ex => ex.id).join("/")).join("; ")}), dazu Beine, Hüfte und Rumpf als Ausgleich; 5-8 Übungen.`
    : " Möglichst je eine Übung für Beine, Hüfte, Drücken, Ziehen und Rumpf.";
  const goalRule = tp.strengthGoal === "athletic"
    ? ` Ziel: athletischer Körper / Muskelaufbau - 3-4 Sätze à 8-12 Wiederholungen, die letzten Wiederholungen schwer; Dauer ca. 40-50 min.`
    : "";
  const wishRule = tp.strengthWish && tp.strengthWish.trim() ? ` Wunsch der Person zum Krafttraining (in ihren Worten): "${tp.strengthWish.trim().slice(0, 300)}" - die Übungsauswahl daran ausrichten.` : "";
  return `- Bei "Kraft": "exercises"-Array AUSSCHLIESSLICH aus dieser Liste, je Eintrag {"id": exakt die id, "name": Name, "sets": 2-4, "reps": z.B. "10" oder "8 je Seite", "note": kurzer Tipp}.${focusRule}${goalRule}${wishRule} Erlaubt: ${list}.`;
}
