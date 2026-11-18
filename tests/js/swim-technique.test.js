// Tests für die Schwimmtechnik-Auswertung (js/analytics/swim-technique.js)
// und die Übungssammlung (js/data/swim-drills.js): Kennzahlen aus den Bahnen,
// Schwerpunkte, Auswahl der Übungen (Hilfsmittel, Niveau, Abwechslung).
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const app = vm.createContext({
  Date, Math, Number, String, Object, Array, JSON, Set,
  DATA: [], goals: [], athleteProfile: { swimCss: null, swimEquipment: ["pullbuoy", "board"] },
  sportGroup: s => s,
  paceToSeconds: s => { if (!s) return null; const [m, x] = String(s).split(":"); return Number(m) * 60 + Number(x); },
});
["js/data/swim-drills.js", "js/analytics/swim-technique.js"].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => JSON.parse(JSON.stringify(vm.runInContext(code, app)));
const TODAY = "new Date('2026-11-18T20:00:00')";

// Beckeneinheiten (25 m) mit 60 Bahnen
function swims({ spl = 17, rate = 36, sec25 = 30, breast = 0, drift = 0, n = 6 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(new Date("2026-11-18T18:00:00").getTime() - (i * 4 + 1) * 86400000);
    const lengths = Array.from({ length: 60 }, (_, k) => ({
      duration_s: sec25 + (k % 3) - 1 + (k > 30 ? drift : 0),
      strokes: Math.round(spl + (k > 30 ? drift : 0) + (k % 2)),
      stroke_rate: rate,
      stroke_type: k % 10 < breast * 10 ? "Brust" : "Kraul",
    }));
    return { sport: "Schwimmen", date: date.toISOString(), distance_km: 1.5, lengths };
  });
}
const analyse = data => { app.DATA = data; return run(`swimTechniqueAnalysis(DATA, ${TODAY})`); };

test("Sammlung: jede Übung vollständig, Hinweise kurz genug für die Uhr", () => {
  const drills = run("SWIM_DRILLS");
  const focus = run("SWIM_FOCUS"), gear = run("SWIM_GEAR");
  assert.ok(drills.length >= 15);
  assert.strictEqual(new Set(drills.map(d => d.id)).size, drills.length);
  drills.forEach(d => {
    assert.ok(d.name && d.short && d.how.length > 60, d.id);
    assert.ok(d.focus.length && d.focus.every(f => focus[f]), d.id);
    assert.ok(d.gear.every(g => gear[g]), d.id);
    assert.ok(["drill", "kick", "swim"].includes(d.kind), d.id);
    assert.ok([1, 2, 3].includes(d.level), d.id);
    assert.ok(`${d.short} · ${d.cue}`.length <= 100, d.id);
    if (d.kind === "drill") assert.ok(d.swimCue && `Kraul · ${d.swimCue}`.length <= 100, d.id);
  });
  // jeder Schwerpunkt hat mindestens zwei Übungen ohne Hilfsmittel oder mit Brett/Pullbuoy
  Object.keys(focus).forEach(f => assert.ok(drills.filter(d => d.focus.includes(f) && d.gear.every(g => ["board", "pullbuoy"].includes(g))).length >= 2, f));
});

test("Kennzahlen aus den Bahnen: Züge pro 25 m, Zugfrequenz, Tempo", () => {
  const a = analyse(swims({ spl: 16, rate: 32, sec25: 30 }));
  assert.strictEqual(a.poolSessions, 6);
  assert.strictEqual(a.metrics.spl, 16.5);
  assert.strictEqual(a.metrics.rate, 32);
  assert.strictEqual(a.metrics.sec100, 120);
  // 50-m-Becken: Züge werden auf 25 m umgerechnet
  const long = swims({ spl: 32, sec25: 60 }).map(w => ({ ...w, distance_km: 3 }));
  assert.strictEqual(analyse(long).metrics.spl, 16.3);
});

test("Viele schnelle Züge -> Gleiten und Wasser fassen zuerst, mit Begründung aus den Daten", () => {
  const a = analyse(swims({ spl: 18, rate: 38 }));
  assert.deepStrictEqual(a.focus.slice(0, 2).map(f => [f.id, f.score]), [["gleiten", 3], ["zug", 3]]);
  assert.match(a.focus[0].reason, /18,5 Züge pro 25 m/);
});

test("Brust-Bahnen -> Atmung zuerst; Ermüdung wird erkannt und begründet", () => {
  const a = analyse(swims({ spl: 15, rate: 30, breast: 0.3, drift: 3 }));
  assert.strictEqual(a.focus[0].id, "atmung");
  assert.match(a.focus[0].reason, /30 % deiner Bahnen/);
  assert.strictEqual(a.metrics.fatigue, true);
  assert.match(a.focus.find(f => f.id === "lage").reason, /zweiten Hälfte/);
});

test("Ruhiger Takt bei wenigen Zügen -> Rhythmus; schnelle Schwimmer bekommen Niveau 3", () => {
  const a = analyse(swims({ spl: 12, rate: 21, sec25: 24 }));
  assert.strictEqual(a.focus[0].id, "rhythmus");
  assert.strictEqual(a.level, 3);
});

test("Freiwasser-Wettkampf in den nächsten Wochen -> Orientierung wird Schwerpunkt", () => {
  app.goals = [{ id: "g", name: "Stadt-Triathlon", sport: "Triathlon", date: "2026-12-20", isPrimary: true }];
  const a = analyse(swims({ spl: 13, rate: 28, sec25: 27 }));
  const f = a.focus.find(x => x.id === "freiwasser");
  assert.strictEqual(f.score, 3);
  assert.match(f.reason, /Stadt-Triathlon.*5 Wochen/);
  app.goals = [];
});

test("Ohne Bahn-Daten: Hinweis statt geratener Zahlen, trotzdem Übungen", () => {
  const a = analyse([{ sport: "Schwimmen", date: "2026-11-15T18:00:00", distance_km: 1.5 }]);
  assert.strictEqual(a.poolSessions, 0);
  assert.strictEqual(a.metrics.spl, null);
  assert.match(a.note, /Bahnenschwimmen/);
  assert.strictEqual(run(`pickSwimDrills("2026-11-19", swimTechniqueAnalysis(DATA, ${TODAY}))`).length, 3);
  assert.match(analyse([]).note, /Noch keine Schwimmeinheit/);
});

test("Übungsauswahl: nur mit vorhandenen Hilfsmitteln, passendes Niveau, Abwechslung", () => {
  app.DATA = swims({ spl: 15, rate: 30, breast: 0.3 });
  const all = new Set();
  for (let day = 1; day <= 28; day++) {
    const date = `2026-12-${String(day).padStart(2, "0")}`;
    const noBoard = run(`pickSwimDrills("${date}", swimTechniqueAnalysis(DATA, ${TODAY}), [])`);
    const drills = noBoard.map(id => run(`SWIM_DRILL_BY_ID["${id}"]`));
    assert.strictEqual(noBoard.length, 3);
    assert.strictEqual(new Set(noBoard).size, 3);
    assert.ok(drills.every(d => d.gear.length === 0), `${date}: Brett ohne Brett geplant`);
    assert.ok(drills.every(d => d.level <= 2), `${date}: zu schwer`);
    assert.ok(drills.filter(d => d.kind !== "drill").length <= 2);
    noBoard.forEach(id => all.add(id));
    // gleicher Tag -> gleiche Übungen (Uhr und App zeigen dasselbe)
    assert.deepStrictEqual(run(`pickSwimDrills("${date}", swimTechniqueAnalysis(DATA, ${TODAY}), [])`), noBoard);
  }
  assert.ok(all.size >= 5, `nur ${all.size} verschiedene Übungen in 4 Wochen`);
});

test("Kontext für den KI-Coach nennt Daten, Schwerpunkte und erlaubte Übungs-IDs", () => {
  app.DATA = swims({ spl: 18, rate: 38 });
  const text = run(`swimTechniqueContextText(swimTechniqueAnalysis(DATA, ${TODAY}), ["board"])`);
  assert.match(text, /6 Beckeneinheiten/);
  assert.match(text, /Gleiten & Zuglänge \(wichtig\)/);
  assert.match(text, /abschlag: Abschlagschwimmen/);
  assert.match(text, /Hilfsmittel beim Schwimmen: Schwimmbrett/);
});
