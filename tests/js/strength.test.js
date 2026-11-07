// Tests für Kraft: Übungs-Sammlung, Strichfiguren, Zusammenstellen einer
// Einheit, Gewichte merken und die Übernahme aus dem KI-Trainingsplan.
// Keine echte KI - alles lokal. Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/training-load.js", "js/analytics/plan-rules.js",
  "js/analytics/periodization.js", "js/data/planned-workouts.js", "js/ai/ollama.js",
  "js/data/mobility-exercises.js", "js/data/strength-exercises.js", "js/data/training-profile.js",
  "js/analytics/mobility-plan.js", "js/analytics/strength-plan.js", "js/components/mobility-figure.js"];

const store = {};
const app = vm.createContext({
  DATA: [], window: {}, document: { addEventListener() {} }, setTimeout: () => 0, clearTimeout: () => {},
  apiCall: () => Promise.resolve({}), storeGet: k => store[k] || null, storeSet: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
  goals: [], athleteProfile: {}, saveAthleteProfile: () => {}, Math, JSON, Date,
});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x));

const EXERCISES = plain(run("STRENGTH_EXERCISES"));
const AREAS = plain(run("STRENGTH_AREAS"));
const GROUPS = plain(run("STRENGTH_GROUPS"));
const EQUIPMENT = plain(run("STRENGTH_EQUIPMENT"));
const profile = patch => ({ goals: "", focusAreas: [], painAreas: [], avoid: [], equipment: [], ...patch });

test("Kraft-Sammlung: eindeutige ids (auch gegenüber Mobility), gültige Felder, Texte vollständig", () => {
  const mobIds = new Set(plain(run("MOBILITY_EXERCISES.map(e => e.id)")));
  const ids = new Set();
  EXERCISES.forEach(ex => {
    assert.ok(!ids.has(ex.id) && !mobIds.has(ex.id), "doppelte id " + ex.id);
    ids.add(ex.id);
    assert.ok(GROUPS.includes(ex.group), ex.id + " group");
    assert.ok(ex.areas.length && ex.areas.every(a => AREAS[a]), ex.id + " areas");
    assert.ok(ex.equipment.every(e => EQUIPMENT[e]), ex.id + " equipment");
    assert.ok(ex.sets >= 1 && ex.sets <= 6, ex.id + " sets");
    assert.ok(ex.reps || ex.hold, ex.id + " reps/hold");
    assert.ok(ex.rest > 0, ex.id + " rest");
    assert.strictEqual(ex.steps.length, 3, ex.id + " steps");
    assert.ok(ex.feel && ex.easier && ex.harder && ex.mistakes.length, ex.id + " texte");
    if (ex.weight) assert.ok(ex.startKg >= 0, ex.id + " startKg");
  });
  GROUPS.forEach(g => assert.ok(EXERCISES.some(ex => ex.group === g), "keine Übung für " + g));
});

test("Kraft-Figuren: alle Haltungen rechnen, Knochen bleiben gleich lang, nichts unter dem Boden", () => {
  const result = plain(run(`
    STRENGTH_EXERCISES.map(ex => {
      const frames = ex.fig.frames.map(figMerge);
      const poses = [];
      frames.forEach((f, i) => {
        const next = frames[(i + 1) % frames.length];
        for (let t = 0; t <= 1.0001; t += 0.25) poses.push(figBlend(f, next, t));
      });
      return { id: ex.id, pts: poses.map(figPoints) };
    })`));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  result.forEach(({ id, pts }) => pts.forEach(p => {
    Object.entries(p).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        assert.ok(v.every(Number.isFinite), `${id}: ${k} ist keine Zahl`);
        assert.ok(v[1] <= 2.5, `${id}: ${k} liegt unter dem Boden (y=${v[1].toFixed(1)})`);
      }
    });
    ["N", "F"].forEach(s => {
      assert.ok(Math.abs(dist(p.pelvis, p["knee" + s]) - 19) < 0.01, `${id}: Oberschenkel`);
      assert.ok(Math.abs(dist(p["knee" + s], p["ankle" + s]) - 18) < 0.01, `${id}: Unterschenkel`);
    });
  }));
});

test("Kraft-Einheit: je Bewegungsmuster eine Übung, nur vorhandene Hilfsmittel", () => {
  const all = Object.keys(EQUIPMENT);
  const full = plain(run(`buildStrengthSession({ tp: ${JSON.stringify(profile({ equipment: all }))}, today: "2026-11-07" })`));
  assert.strictEqual(full.kind, "strength");
  assert.strictEqual(full.exercises.length, GROUPS.length);
  const groups = full.exercises.map(x => EXERCISES.find(e => e.id === x.id).group);
  assert.deepStrictEqual([...new Set(groups)].sort(), [...GROUPS].sort());
  assert.ok(full.minutes >= 5);

  const none = plain(run(`buildStrengthSession({ tp: ${JSON.stringify(profile())}, today: "2026-11-07" })`));
  none.exercises.forEach(x => assert.deepStrictEqual(EXERCISES.find(e => e.id === x.id).equipment, [], x.id + " braucht Geräte"));
});

test("Kraft-Einheit: zuletzt gemachte Übungen werden möglichst getauscht", () => {
  const tp = JSON.stringify(profile({ equipment: Object.keys(EQUIPMENT) }));
  const a = plain(run(`buildStrengthSession({ tp: ${tp}, today: "2026-11-07" })`)).exercises.map(x => x.id);
  const b = plain(run(`buildStrengthSession({ tp: ${tp}, today: "2026-11-07", lastIds: ${JSON.stringify(a)} })`)).exercises.map(x => x.id);
  GROUPS.forEach((g, i) => {
    const pool = EXERCISES.filter(e => e.group === g);
    if (pool.length > 1 && a[i] && b[i]) assert.notStrictEqual(a[i], b[i], "gleiche Übung für " + g);
  });
});

test("Gewichte: Startwert, dann zuletzt genutztes Gewicht (auf 0,5 kg gerundet)", () => {
  const ex = EXERCISES.find(e => e.weight);
  assert.strictEqual(run(`strengthWeight("${ex.id}")`), ex.startKg);
  run(`setStrengthWeight("${ex.id}", 12.3)`);
  assert.strictEqual(run(`strengthWeight("${ex.id}")`), 12.5);
  run("loadStrengthState()");
  assert.strictEqual(run(`strengthWeight("${ex.id}")`), 12.5);
  const bodyweight = EXERCISES.find(e => !e.weight);
  assert.strictEqual(run(`strengthWeight("${bodyweight.id}")`), null);
});

test("KI-Trainingsplan: Kraft-Übungen aus der Sammlung behalten id, Sätze begrenzt, abspielbar", () => {
  const known = EXERCISES[0];
  const text = JSON.stringify({ workouts: [{ date: "2026-11-07", sport: "Kraft", title: "Kraft", duration_min: 30, intensity: "mittel", description: "x",
    exercises: [{ id: known.id, name: "Squat", sets: 12, reps: "10" }, { name: "Eigene Übung", sets: 3, reps: "8" }] }] });
  const [entry] = plain(run(`parsePlanResponse(${JSON.stringify(text)}, ["2026-11-07"])`));
  assert.strictEqual(entry.exercises[0].id, known.id);
  assert.strictEqual(entry.exercises[0].name, known.name);
  assert.strictEqual(entry.exercises[0].sets, 6);
  assert.strictEqual(entry.exercises[1].id, undefined);

  const session = plain(run(`plannedToStrengthSession(${JSON.stringify({ ...entry, id: "p1" })})`));
  assert.strictEqual(session.kind, "strength");
  assert.strictEqual(session.plannedId, "p1");
  assert.deepStrictEqual(session.exercises.map(x => x.id), [known.id]);
  assert.strictEqual(run(`plannedToStrengthSession({ exercises: [{ name: "Eigene" }] })`), null);
});

test("Trainingsart: jede Art deckt alle Bewegungsmuster ab und nutzt nur ihre Geräte", () => {
  const MODES = plain(run("STRENGTH_MODES"));
  assert.deepStrictEqual(Object.keys(MODES), ["body", "dumbbells", "kettlebell", "band", "gym"]);
  Object.entries(MODES).forEach(([mode, m]) => {
    const s = plain(run(`buildStrengthSession({ tp: ${JSON.stringify(profile())}, today: "2026-11-07", mode: "${mode}" })`));
    const groups = s.exercises.map(x => EXERCISES.find(e => e.id === x.id).group);
    assert.deepStrictEqual([...new Set(groups)].sort(), [...GROUPS].sort(), mode + ": Gruppen");
    s.exercises.forEach(x => {
      const ex = EXERCISES.find(e => e.id === x.id);
      assert.ok(ex.equipment.every(e => m.equipment.includes(e)), `${mode}: ${ex.id} braucht ${ex.equipment}`);
    });
    if (m.prefer.length) {
      const withGear = s.exercises.filter(x => EXERCISES.find(e => e.id === x.id).equipment.some(e => m.prefer.includes(e)));
      assert.ok(withGear.length >= 4, `${mode}: nur ${withGear.length} Übungen mit ${m.prefer}`);
    }
    assert.ok(s.title.includes(m.label), mode + " Titel");
  });
});

test("Trainingsart Eigengewicht/Band: Übungen mit optionalem Gewicht starten mit 0 kg", () => {
  run(`strengthState.weights = { ausfallschritt: 10 }`);
  assert.strictEqual(run(`strengthModeKg(STRENGTH_BY_ID.ausfallschritt, "body")`), 0);
  assert.strictEqual(run(`strengthModeKg(STRENGTH_BY_ID.ausfallschritt, "band")`), 0);
  assert.strictEqual(run(`strengthModeKg(STRENGTH_BY_ID.ausfallschritt, "dumbbells")`), 10);
  assert.strictEqual(run(`strengthModeKg(STRENGTH_BY_ID["bulgarische-kniebeuge"], "dumbbells")`), 6);
  assert.strictEqual(run(`strengthModeKg(STRENGTH_BY_ID.kniebeuge, "gym")`), null);
  ["body", "band"].forEach(mode => {
    const s = plain(run(`buildStrengthSession({ tp: ${JSON.stringify(profile())}, today: "2026-11-08", mode: "${mode}" })`));
    s.exercises.forEach(x => assert.ok(x.kg === null || x.kg === 0, `${mode}: ${x.id} mit ${x.kg} kg`));
  });
});

test("Trainingsart merken: ohne Auswahl Kurzhanteln, wenn im Profil, sonst Eigengewicht", () => {
  run("strengthState.mode = null");
  assert.strictEqual(run(`strengthMode(${JSON.stringify(profile({ equipment: ["dumbbells"] }))})`), "dumbbells");
  assert.strictEqual(run(`strengthMode(${JSON.stringify(profile())})`), "body");
  run(`setStrengthMode("kettlebell")`);
  run(`setStrengthMode("quatsch")`);
  run("loadStrengthState()");
  assert.strictEqual(run(`strengthMode(${JSON.stringify(profile())})`), "kettlebell");
  run(`setStrengthMode("body")`);
});

test("Trainingsart wechseln: geplante Übungen werden gruppengleich getauscht", () => {
  const list = [
    { id: "goblet-kniebeuge", name: "Goblet-Kniebeuge", sets: 3, reps: "10", note: "x" },
    { id: "unterarmstuetz", name: "Unterarmstütz", sets: 3, reps: "40 s" },
    { name: "Eigene Übung", sets: 2, reps: "8" },
  ];
  const tp = JSON.stringify(profile());
  const next = plain(run(`adaptStrengthExercises(${JSON.stringify(list)}, ${tp}, "body", "2026-11-07")`));
  assert.strictEqual(next.length, 3);
  const swapped = EXERCISES.find(e => e.id === next[0].id);
  assert.strictEqual(swapped.group, "knee");
  assert.deepStrictEqual(swapped.equipment.filter(e => !["wall", "bench"].includes(e)), []);
  assert.strictEqual(next[0].name, swapped.name);
  assert.deepStrictEqual(next[1], list[1], "passt schon - bleibt");
  assert.deepStrictEqual(next[2], list[2], "eigene Übung bleibt");
  // Kettlebell: bevorzugte Geräte -> Kniebeuge wird zur Kettlebell-Übung.
  const kb = plain(run(`adaptStrengthExercises(${JSON.stringify(list)}, ${tp}, "kettlebell", "2026-11-07")`));
  assert.ok(EXERCISES.find(e => e.id === kb[0].id).equipment.includes("kettlebell"));
  // strict: nur tauschen, was mit den Geräten nicht geht (Unterarmstütz bleibt bei Kurzhanteln).
  const keep = [{ id: "unterarmstuetz", name: "Unterarmstütz", sets: 3, reps: "40 s" }];
  assert.strictEqual(run(`adaptStrengthExercises(${JSON.stringify(keep)}, ${tp}, "dumbbells", "2026-11-07", true)`), null);
  assert.ok(run(`adaptStrengthExercises(${JSON.stringify(keep)}, ${tp}, "dumbbells", "2026-11-07")`), "ohne strict: Kurzhantel-Übung bevorzugt");
  // Nichts zu tun -> null
  assert.strictEqual(run(`adaptStrengthExercises(${JSON.stringify([list[1]])}, ${tp}, "body", "2026-11-07")`), null);
});
