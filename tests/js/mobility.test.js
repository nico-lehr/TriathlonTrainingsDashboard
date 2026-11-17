// Tests für Mobility: Übungs-Sammlung, Strichfiguren (Skelett-Rechnung),
// Zusammenstellen einer Einheit, Prüfen einer Claude-Antwort und die
// Übernahme in den Trainingsplan. Keine echte KI - alles lokal.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/data/race-formats.js", "js/utils/dates.js", "js/utils/formatting.js", "js/analytics/training-load.js", "js/analytics/plan-rules.js",
  "js/analytics/periodization.js", "js/data/planned-workouts.js", "js/ai/ollama.js",
  "js/data/mobility-exercises.js", "js/data/training-profile.js", "js/analytics/mobility-plan.js", "js/components/mobility-figure.js"];

const store = {};
const app = vm.createContext({
  DATA: [], window: {}, document: { addEventListener() {} }, setTimeout: () => 0, clearTimeout: () => {},
  apiCall: () => Promise.resolve({}), storeGet: k => store[k] || null, storeSet: (k, v) => { store[k] = v; },
  goals: [], athleteProfile: {}, saveAthleteProfile: () => {}, Math, JSON, Date,
});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x));

const EXERCISES = plain(run("MOBILITY_EXERCISES"));
const AREAS = plain(run("MOBILITY_AREAS"));
const EQUIPMENT = plain(run("MOBILITY_EQUIPMENT"));
const AVOID = plain(run("MOBILITY_AVOID"));

const profile = patch => ({ goals: "", focusAreas: [], painAreas: [], avoid: [], equipment: ["wall"], mobilityPerWeek: 2, mobilityMinutes: 15, ...patch });

test("Sammlung: eindeutige ids, gültige Felder, Texte vollständig", () => {
  const ids = new Set();
  EXERCISES.forEach(ex => {
    assert.ok(!ids.has(ex.id), "doppelte id " + ex.id);
    ids.add(ex.id);
    assert.ok(ex.areas.length && ex.areas.every(a => AREAS[a]), ex.id + " areas");
    assert.ok(ex.equipment.every(e => EQUIPMENT[e]), ex.id + " equipment");
    assert.ok(ex.avoid.every(a => AVOID[a]), ex.id + " avoid");
    assert.ok(["hold", "reps"].includes(ex.kind), ex.id + " kind");
    assert.ok(ex.seconds >= 15 && ex.seconds <= 90, ex.id + " seconds");
    if (ex.kind === "reps") assert.ok(ex.reps > 0, ex.id + " reps");
    assert.ok([1, 2, 3].includes(ex.level), ex.id + " level");
    assert.strictEqual(ex.steps.length, 3, ex.id + " 3 Schritte");
    ["feel", "easier", "harder", "video"].forEach(k => assert.ok(ex[k] && ex[k].length > 3, ex.id + " " + k));
    assert.ok(ex.mistakes.length >= 1, ex.id + " mistakes");
    assert.ok(ex.fig.frames.length >= 2, ex.id + " mind. 2 Haltungen");
  });
  assert.ok(EXERCISES.length >= 30);
  // Jeder Bereich hat mehrere Übungen.
  Object.keys(AREAS).forEach(a => assert.ok(EXERCISES.filter(ex => ex.areas.includes(a)).length >= 4, a));
});

// Alle Haltungen und Zwischenschritte einer Sammlung: Punkte des Skeletts,
// erwartete Beinlängen (mit Verkürzung) und unerreichbare Ziele.
const figSamples = coll => plain(run(`
  ${coll}.map(ex => {
    const frames = ex.fig.frames.map(figMerge);
    const tl = figTimeline(ex.fig);
    const reach = [];
    frames.forEach((f, fi) => FIG_LIMBS.forEach(([kind, side]) => {
      const form = figLimbForm(f, kind, side);
      if (form === "a") return;
      const root = kind === "l" ? f.p : figShoulder(f);
      const target = form === "r" ? addV(root, f[kind + side + "r"]) : f[kind + side];
      const [a, b] = figLimbLen(f, kind, side);
      reach.push({ limb: kind + side, frame: fi, over: Math.hypot(target[0] - root[0], target[1] - root[1]) - a - b });
    }));
    const poses = [];
    tl.steps.forEach(st => {
      for (let i = 0; i <= 20; i++) poses.push(figBlend(frames[st.from], frames[st.to], i / 20));
    });
    return { id: ex.id, reach, poses: poses.map(p => ({ pts: figPoints(p), len: { N: figLimbLen(p, "l", "N"), F: figLimbLen(p, "l", "F") } })) };
  })`));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test("Figuren: Ziele erreichbar, nichts springt, Knochen bleiben gleich lang, nichts unter dem Boden", () => {
  figSamples("MOBILITY_EXERCISES").forEach(({ id, reach, poses }) => {
    // Hände und Füße kommen dort an, wo sie hingehören (sonst schweben sie in der Luft).
    reach.forEach(r => assert.ok(r.over <= 0.5, `${id}: ${r.limb} erreicht das Ziel in Haltung ${r.frame} nicht (${r.over.toFixed(1)} zu weit)`));
    poses.forEach(({ pts: p, len }, i) => {
      Object.entries(p).forEach(([k, v]) => {
        if (!Array.isArray(v)) return;
        assert.ok(v.every(Number.isFinite), `${id}: ${k} ist keine Zahl`);
        assert.ok(v[1] <= 2.5, `${id}: ${k} liegt unter dem Boden (y=${v[1].toFixed(1)})`);
        // Kein Gelenk springt von einem Bild zum nächsten (z. B. Ellbogen klappt um).
        const prev = i % 21 ? poses[i - 1].pts[k] : null;
        if (prev) assert.ok(dist(v, prev) < 6, `${id}: ${k} springt (${dist(v, prev).toFixed(1)})`);
      });
      ["N", "F"].forEach(s => {
        assert.ok(Math.abs(dist(p.pelvis, p["knee" + s]) - len[s][0]) < 0.01, `${id}: Oberschenkel`);
        assert.ok(Math.abs(dist(p["knee" + s], p["ankle" + s]) - len[s][1]) < 0.01, `${id}: Unterschenkel`);
      });
    });
  });
});

test("IK: erreichbares Ziel wird genau getroffen, Beugerichtung wirkt", () => {
  const r = plain(run(`(() => {
    const [t1, t2] = figSolveLimb([0, -38], [5, -2], 19, 18, 1);
    const knee = [Math.sin(t1 * Math.PI / 180) * 19, -38 + Math.cos(t1 * Math.PI / 180) * 19];
    const end = [knee[0] + Math.sin(t2 * Math.PI / 180) * 18, knee[1] + Math.cos(t2 * Math.PI / 180) * 18];
    const back = figSolveLimb([0, -38], [5, -2], 19, 18, -1);
    return { knee, end, kneeBackX: Math.sin(back[0] * Math.PI / 180) * 19 };
  })()`));
  assert.ok(Math.abs(r.end[0] - 5) < 0.01 && Math.abs(r.end[1] + 2) < 0.01);
  assert.ok(r.knee[0] > r.kneeBackX, "Knie nach vorn bei bend +1");
});

test("Haltung: bei zwei Formen für dieselbe Gliedmaße gilt die zuletzt genannte", () => {
  const r = plain(run(`(() => {
    const base = { aNa: [-92, -90], lN: [-14, -2] };
    const a = figMerge({ ...base, aN: [9, -17] });       // Grundhaltung mit Winkeln, darüber ein Ziel
    const b = figMerge({ ...base, lNa: [0, -90] });      // Grundhaltung mit Ziel, darüber Winkel
    return { arm: figLimbForm(a, "a", "N"), leg: figLimbForm(b, "l", "N"), armGone: a.aNa === undefined };
  })()`));
  assert.strictEqual(r.arm, "w");
  assert.ok(r.armGone);
  assert.strictEqual(r.leg, "a");
});

test("Verkürzung: Gliedmaße zur Seite wird kürzer gezeichnet und weich gemischt", () => {
  const r = plain(run(`(() => {
    const A = figMerge({ aNa: [90, 90] }), B = figMerge({ aNa: [90, 90], aNs: [0.5, 1] });
    const len = pose => { const p = figPoints(pose); return Math.hypot(p.elbowN[0] - p.shoulder[0], p.elbowN[1] - p.shoulder[1]); };
    return { full: len(A), half: len(B), mid: len(figBlend(A, B, 0.5)) };
  })()`));
  assert.ok(Math.abs(r.full - 14) < 0.01 && Math.abs(r.half - 7) < 0.01 && Math.abs(r.mid - 10.5) < 0.01);
});

const session = (patch, opts = {}) => plain(run(`buildMobilitySession(${JSON.stringify({
  minutes: 15, focus: null, tp: profile(patch), recent: [], lastIds: [], trend: 0, today: "2026-11-06", ...opts,
})})`.replace('"painfulIds":{}', '"painfulIds":new Set()')));

test("Einheit: Dauer passt, ruhige Anzahl, Aufwärmen zuerst", () => {
  [10, 15, 20, 30].forEach(min => {
    const s = session({}, { minutes: min });
    const total = run(`mobilitySessionSeconds(${JSON.stringify(s)})`);
    assert.ok(total <= min * 60 + 30, `${min} Min: ${total} s zu lang`);
    assert.ok(total >= min * 60 * 0.75, `${min} Min: ${total} s zu kurz`);
    assert.ok(s.exercises.length <= Math.round(min / 2.2) + 2, `${min} Min: zu viele Übungen`);
    assert.strictEqual(run(`MOBILITY_BY_ID["${s.exercises[0].id}"].kind`), "reps");
    assert.strictEqual(new Set(s.exercises.map(x => x.id)).size, s.exercises.length, "keine doppelten Übungen");
  });
});

test("Einheit: nur vorhandene Hilfsmittel, nichts Ausgeschlossenes, bei Beschwerden nur Sanftes", () => {
  const s = session({ equipment: [], avoid: ["kneel", "wrists", "floor"], painAreas: ["hip"] }, { minutes: 30 });
  s.exercises.forEach(x => {
    const ex = EXERCISES.find(e => e.id === x.id);
    assert.deepStrictEqual(ex.equipment, [], x.id + " braucht Hilfsmittel");
    assert.ok(!ex.avoid.some(a => ["kneel", "wrists", "floor"].includes(a)), x.id + " ausgeschlossen");
    if (ex.areas.includes("hip")) assert.strictEqual(ex.level, 1, x.id + " zu fordernd für Hüft-Beschwerden");
  });
});

test("Einheit: Schwerpunkt und letzter Lauf bestimmen die Auswahl", () => {
  const shoulder = session({ equipment: ["wall", "band", "roller", "block", "strap"] }, { focus: ["shoulder"] });
  const hits = shoulder.exercises.filter(x => EXERCISES.find(e => e.id === x.id).areas.includes("shoulder")).length;
  assert.ok(hits >= shoulder.exercises.length / 2, "Schwerpunkt Schultern zu selten");
  assert.match(shoulder.intro, /Schultern/);
  const afterRun = session({}, { recent: [{ sport: "Laufen", daysAgo: 1 }] });
  const legs = afterRun.exercises.filter(x => EXERCISES.find(e => e.id === x.id).areas.some(a => ["calf", "hamstring", "hip", "glute"].includes(a))).length;
  assert.ok(legs >= afterRun.exercises.length - 1, "nach dem Lauf vor allem Beine");
  assert.match(afterRun.intro, /Lauf gestern/);
});

test("Einheit: zuletzt zu schwer -> nichts Forderndes; schmerzhafte Übung bleibt draußen", () => {
  const easy = session({ equipment: ["wall", "roller"] }, { trend: -1, minutes: 20 });
  assert.ok(easy.exercises.every(x => EXERCISES.find(e => e.id === x.id).level <= 2));
  assert.ok(easy.exercises.filter(x => EXERCISES.find(e => e.id === x.id).level >= 2).length <= 1);
  const ids = plain(run(`allowedMobilityExercises(${JSON.stringify(profile({}))}, new Set(["taube"])).map(e => e.id)`));
  assert.ok(!ids.includes("taube"));
});

test("Verlauf: Schmerz-Sperre 3 Wochen, Tendenz aus den letzten Rückmeldungen", () => {
  run(`mobilityState = { current: null, history: [
    { date: "2026-10-01", rating: "ok", pain: ["frosch"] },
    { date: "2026-11-01", rating: "hard", pain: ["taube"] },
    { date: "2026-11-03", rating: "hard", pain: [] },
  ] }`);
  const painful = plain(run(`[...mobilityPainfulIds("2026-11-06")]`));
  assert.deepStrictEqual(painful, ["taube"]);
  assert.strictEqual(run("mobilityDifficultyTrend()"), -1);
});

test("Claude-Antwort: nur erlaubte ids, keine doppelten, Zeiten begrenzt, zu kurz wird gestreckt", () => {
  const text = JSON.stringify({ title: "Test", intro: "Weil.", exercises: [
    { id: "beinpendel", seconds: 30, note: "" },
    { id: "gibt-es-nicht", seconds: 30, note: "" },
    { id: "beinpendel", seconds: 30, note: "" },
    { id: "taube", seconds: 500, note: "Tipp" },
    { id: "wade-wand", seconds: 1, note: "" },
  ] });
  const s = plain(run(`parseMobilityResponse(${JSON.stringify(text)}, ["beinpendel", "taube", "wade-wand"], 15)`));
  assert.deepStrictEqual(s.exercises.map(x => x.id), ["beinpendel", "taube", "wade-wand"]);
  assert.ok(s.exercises.every(x => x.seconds >= 20 && x.seconds <= 90));
  assert.strictEqual(s.source, "claude");
  assert.throws(() => run(`parseMobilityResponse('{"exercises":[{"id":"x"}]}', ["beinpendel"], 10)`));
  assert.throws(() => run(`parseMobilityResponse("kein json", ["beinpendel"], 10)`));
  const schema = plain(run(`mobilityResponseSchema(["a", "b"])`));
  assert.deepStrictEqual(schema.properties.exercises.items.properties.id.enum, ["a", "b"]);
  assert.strictEqual(schema.additionalProperties, false);
});

test("Kalender: Einheit -> geplante Einheit -> wieder abspielbar", () => {
  const s = session({}, { minutes: 15 });
  const planned = plain(run(`mobilitySessionToPlanned(${JSON.stringify(s)}, "2026-11-07")`));
  assert.strictEqual(planned.sport, "Mobility");
  assert.ok(planned.exercises.every(x => x.id && x.name && x.seconds));
  const back = plain(run(`plannedToMobilitySession(${JSON.stringify({ ...planned, id: "pw1" })})`));
  assert.deepStrictEqual(back.exercises.map(x => x.id), s.exercises.map(x => x.id));
  assert.strictEqual(back.plannedId, "pw1");
});

test("KI-Trainingsplan: Mobility-Übungen aus der Sammlung behalten id, fremde Namen bleiben ohne", () => {
  const windowDates = ["2026-11-07"];
  const text = JSON.stringify({ workouts: [{ date: "2026-11-07", sport: "Mobility", title: "Mobility", duration_min: 15, intensity: "leicht", description: "x",
    exercises: [{ id: "taube", name: "Pigeon", seconds: 999, reps: "40 s je Seite" }, { name: "Eigene Übung", reps: "10" }] }] });
  const [entry] = plain(run(`parsePlanResponse(${JSON.stringify(text)}, ${JSON.stringify(windowDates)})`));
  assert.strictEqual(entry.exercises[0].id, "taube");
  assert.strictEqual(entry.exercises[0].name, "Taube");
  assert.strictEqual(entry.exercises[0].seconds, 90);
  const own = entry.exercises[entry.exercises.length - 1];
  assert.strictEqual(own.id, undefined);
  assert.strictEqual(own.name, "Eigene Übung");
});

// Der gemeldete Fehler: 10 Minuten geplant, aber die Übungen dauerten
// zusammen nur ein paar Minuten.
const totalOf = list => run(`mobilityTotalSeconds(${JSON.stringify(list)})`);

test("KI-Trainingsplan: viel zu kurze Mobility wird auf die geplanten Minuten gebracht", () => {
  [10, 15, 20].forEach(min => {
    const text = JSON.stringify({ workouts: [{ date: "2026-11-07", sport: "Mobility", title: "Mobility", duration_min: min, intensity: "leicht", description: "x",
      exercises: ["katze-kuh", "taube", "wade-wand", "kindhaltung"].map(id => ({ id, seconds: 15, reps: "15 s" })) }] });
    const [entry] = plain(run(`parsePlanResponse(${JSON.stringify(text)}, ["2026-11-07"])`));
    const total = totalOf(entry.exercises);
    assert.ok(total >= min * 60 * 0.92 && total <= min * 60 * 1.08, `${min} Min geplant, aber ${Math.round(total / 6) / 10} Min Übungen`);
    entry.exercises.forEach(x => {
      const ex = EXERCISES.find(e => e.id === x.id);
      if (ex.kind === "hold") assert.ok(x.seconds >= 30, `${x.id}: Dehnung nur ${x.seconds} s`);
      if (ex.kind === "hold") assert.match(x.reps, new RegExp(`^${x.seconds} s`), "Anzeige passt zu den Sekunden");
    });
    assert.strictEqual(entry.exercises[0].id, "katze-kuh", "Aufwärmen bleibt vorn");
  });
});

test("KI-Trainingsplan: viel zu lange Mobility wird gekürzt", () => {
  const ids = EXERCISES.filter(e => !e.equipment.length).slice(0, 10).map(e => e.id);
  const text = JSON.stringify({ workouts: [{ date: "2026-11-07", sport: "Mobility", title: "Mobility", duration_min: 10, intensity: "leicht", description: "x",
    exercises: ids.map(id => ({ id, seconds: 90 })) }] });
  const [entry] = plain(run(`parsePlanResponse(${JSON.stringify(text)}, ["2026-11-07"])`));
  const total = totalOf(entry.exercises);
  assert.ok(total >= 600 * 0.92 && total <= 600 * 1.08, `${total} s statt 600 s`);
});

test("Claude-Mobility und Abspielen aus dem Plan: Dauer stimmt ±8 %", () => {
  const text = JSON.stringify({ title: "Kurz", intro: "", exercises: ["beinpendel", "taube", "wade-wand"].map(id => ({ id, seconds: 20, note: "" })) });
  [10, 20].forEach(min => {
    const s = plain(run(`parseMobilityResponse(${JSON.stringify(text)}, ${JSON.stringify(EXERCISES.map(e => e.id))}, ${min})`));
    const total = totalOf(s.exercises);
    assert.ok(total >= min * 60 * 0.92 && total <= min * 60 * 1.08, `Claude ${min} Min: ${total} s`);
  });
  // Ältere, zu kurze Einheit im Kalender wird beim Starten passend gemacht.
  const pw = { id: "alt", sport: "Mobility", title: "Alt", duration_min: 10,
    exercises: [{ id: "taube", seconds: 15 }, { id: "wade-wand", seconds: 15 }, { id: "kindhaltung", seconds: 15 }] };
  const back = plain(run(`plannedToMobilitySession(${JSON.stringify(pw)})`));
  const total = totalOf(back.exercises);
  assert.ok(total >= 600 * 0.92 && total <= 600 * 1.08, `aus dem Plan: ${total} s`);
});

test("Mitmach-Modus dauert so lange wie berechnet", () => {
  const src = fs.readFileSync(path.join(ROOT, "js/components/mobility-player.js"), "utf8");
  const prep = Number(src.match(/const MOB_PREP_S = (\d+)/)[1]);
  const sw = Number(src.match(/const MOB_SWITCH_S = (\d+)/)[1]);
  assert.strictEqual(prep, run("MOBILITY_TRANSITION_S"));
  const sided = EXERCISES.find(e => e.sides);
  assert.strictEqual(run(`mobilityExerciseSeconds(MOBILITY_BY_ID["${sided.id}"], 40)`), 80 + sw);
});

test("Gespeicherter Plan: kommende, zu kurze Mobility wird beim Laden repariert, erledigte nicht", () => {
  const short = [{ id: "taube", name: "Taube", seconds: 15, reps: "15 s je Seite" }, { id: "wade-wand", name: "Wade", seconds: 15, reps: "15 s" }];
  store[run("PLANNED_WORKOUTS_KEY")] = [
    { id: "a", date: "2099-01-01", sport: "Mobility", duration_min: 10, status: "geplant", exercises: plain(short) },
    { id: "b", date: "2000-01-01", sport: "Mobility", duration_min: 10, status: "erledigt", exercises: plain(short) },
  ];
  run("loadPlannedWorkouts()");
  const [a, b] = plain(run("plannedWorkouts"));
  const total = totalOf(a.exercises);
  assert.ok(total >= 600 * 0.92 && total <= 600 * 1.08, `${total} s`);
  assert.deepStrictEqual(b.exercises, short);
});
