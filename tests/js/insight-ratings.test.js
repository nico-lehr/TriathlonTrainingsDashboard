// Tests für die Bewertungen der Insights-Seite (js/analytics/insight-ratings.js):
// VO2max nach Alter/Geschlecht + Verlauf, Form/ACWR/Monotonie, Erholung,
// Umfang gegen Plan, Regelmäßigkeit und das Kachel-Detail.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const app = vm.createContext({ window: {}, console, Math, JSON, Date });
["js/utils/dates.js", "js/utils/formatting.js", "js/analytics/metric-insights.js", "js/analytics/insight-ratings.js"]
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x));
const DAY = 86400000;
const daysAgo = n => new Date(Date.now() - n * DAY);

function setup({ profile = {}, all = [], wellness = {}, run: runEst = null, bike = null, state = null, mono = null } = {}) {
  app.athleteProfile = { gender: null, age: null, weeklyHours: null, trainingDaysPerWeek: null, ...profile };
  app.getAthleteAge = () => app.athleteProfile.age;
  app.ALL = all;
  app.wellnessSeries = (field, days) => (wellness[field] || [])
    .filter(p => p.age <= days).sort((a, b) => b.age - a.age).map(p => ({ date: daysAgo(p.age), value: p.value }));
  app.__estCalls = [];
  app.computeRunVo2MaxEstimate = (opts = {}) => { app.__estCalls.push(opts); return typeof runEst === "function" ? runEst(opts) : runEst; };
  app.computeBikeVo2MaxEstimate = () => bike;
  app.computePerformanceState = () => state;
  app.computeMonotonyStrainSeries = () => mono;
  app.computeTrainingStatus = () => ({ icon: "📈", label: "Formaufbau", desc: "Fitness steigt" });
  app.computeLoadSeries = () => null;
  app.computeAdherenceStreak = () => ({ days: 5 });
}

test("VO2max-Tabelle: richtige Altersgruppe und Stufe", () => {
  const n = plain(run(`vo2NormBands(35, "m")`));
  assert.strictEqual(n.group, "Männer 30–39 Jahre");
  assert.strictEqual(run(`miBand(vo2NormBands(35, "m").bands, 50)[3]`), "sehr gut");
  assert.strictEqual(run(`miBand(vo2NormBands(35, "m").bands, 39)[3]`), "niedrig");
  assert.strictEqual(run(`miBand(vo2NormBands(35, "m").bands, 56)[3]`), "hervorragend");
  assert.strictEqual(run(`miBand(vo2NormBands(25, "w").bands, 45)[3]`), "sehr gut");
  assert.strictEqual(run(`vo2NormBands(75, "m").group`), "Männer ab 70 Jahre");
  assert.match(run(`vo2NormBands(17, "w").ageNote`), /unter 20/);
  assert.strictEqual(run(`vo2NormBands(35, "divers")`), null);
  assert.strictEqual(run(`vo2NormBands(null, "m")`), null);
});

test("VO2max-Detail: Bewertung, Trend gegen vor 3 Monaten und Garmin-Verlauf (1 Punkt je Woche)", () => {
  const pts = [];
  for (let d = 200; d >= 0; d--) pts.push({ age: d, value: d > 80 ? 48 : 50 });
  setup({ profile: { gender: "m", age: 34 }, wellness: { vo2max: pts }, run: { value: 50, methodLabel: "synchronisiert (Garmin Connect)" } });
  const d = plain(run(`statDetail("vo2run")`));
  assert.strictEqual(d.items[0].verdict, "sehr gut");
  assert.strictEqual(d.items[0].rangeText, "Vergleich: Männer 30–39 Jahre");
  assert.strictEqual(d.items[0].compare.dir, "better");
  assert.match(d.items[0].compare.baseText, /48/);
  assert.ok(d.history.points.length >= 28 && d.history.points.length <= 30, String(d.history.points.length));
  assert.match(d.history.title, /Garmin/);
  assert.deepStrictEqual(plain(run(`statTileRating("vo2run")`)), { level: "good", word: "sehr gut" });
});

test("VO2max ohne Garmin: Verlauf aus der eigenen Schätzung je Monat, ohne Profil nur Hinweis", () => {
  setup({ run: opts => ({ value: opts.now ? 45 + (Date.now() - opts.now) / DAY / -100 : 45, methodLabel: "geschätzt" }) });
  const d = plain(run(`statDetail("vo2run")`));
  assert.strictEqual(d.history.points.length, 13);
  assert.ok(app.__estCalls.filter(o => o.skipSynced).length === 13);
  assert.strictEqual(d.items[0].scale, null);
  assert.match(d.items[0].rangeText, /Geburtsdatum und Geschlecht/);
  assert.strictEqual(run(`statTileRating("vo2run")`), null);
});

test("Form, ACWR und Monotonie: Bereiche in einfachen Worten", () => {
  assert.strictEqual(run(`tsbItem(-35).verdict`), "stark ermüdet");
  assert.strictEqual(run(`tsbItem(-15).verdict`), "müde (im Aufbau normal)");
  assert.strictEqual(run(`tsbItem(0).verdict`), "ausgeglichen");
  assert.strictEqual(run(`acwrItem(1.0).verdict`), "optimal");
  assert.strictEqual(run(`acwrItem(1.7).verdict`), "hohes Risiko");
  assert.strictEqual(run(`acwrItem(0.5).verdict`), "wenig Belastung");
  assert.strictEqual(run(`monotonyItem(2.4).verdict`), "zu gleichförmig");
  assert.strictEqual(run(`monotonyItem(1.2).level`), "good");
  assert.strictEqual(run(`ctlRampItem({ ctl: 50, ctlDelta: 10 }).verdict`), "steigt gut");
  assert.strictEqual(run(`ctlRampItem({ ctl: 50, ctlDelta: -8 }).verdict`), "sinkt");
  assert.strictEqual(run(`ctlRampItem({ ctl: 50, ctlDelta: 40 }).level`), "bad");
  // Außerhalb der Skala: Markierung am Rand, Bewertung bleibt richtig
  assert.strictEqual(run(`acwrItem(3).verdict`), "hohes Risiko");
  assert.strictEqual(run(`acwrItem(3).scale.value < 2.1`), true);
});

test("Erholung: HRV und Ruhepuls gegen den eigenen Normalwert, Schlaf in Stunden", () => {
  const hrv = [], rhr = [], sleep = [];
  for (let d = 0; d < 60; d++) {
    hrv.push({ age: d, value: d <= 7 ? 48 : 60 });
    rhr.push({ age: d, value: d <= 7 ? 52 : 50 });
    sleep.push({ age: d, value: 7.5 * 60 });
  }
  setup({ wellness: { hrv_ms: hrv, resting_hr: rhr, sleep_min: sleep } });
  const items = plain(run(`recoveryRatingItems()`));
  assert.deepStrictEqual(items.map(i => i.verdict), ["deutlich unter normal", "leicht erhöht", "gut"]);
  assert.match(items[0].rangeText, /−20 %/);
});

test("Umfang: Gesamtzeit gegen das Wochenziel und Regelmäßigkeit je Sportart", () => {
  const all = [];
  // letzte 4 Wochen: 4 × 2 h pro Woche = 8 h, davor 12 Wochen je 6 h
  for (let d = 1; d < 112; d++) {
    if (d % 7 === 0 || d % 7 === 3 || d % 7 === 5) continue;
    all.push({ sport: d % 2 ? "Laufen" : "Rad", _date: daysAgo(d), duration_min: d < 28 ? 120 : 90, distance_km: 10 });
  }
  setup({ profile: { weeklyHours: 8 }, all });
  const t = plain(run(`statDetail("time")`));
  assert.strictEqual(t.items[0].label, "Trainingszeit pro Woche");
  assert.ok(["im Plan", "etwas über Plan", "etwas unter Plan"].includes(t.items[0].verdict), t.items[0].verdict);
  assert.strictEqual(t.items[1].compare.dir, "more");
  assert.strictEqual(t.history.points.length, 26);
  const r = plain(run(`statDetail("Laufen")`));
  assert.strictEqual(r.items[0].label, "Regelmäßigkeit");
  assert.strictEqual(r.items[0].verdict, "sehr regelmäßig");
  // Ohne Wochenziel: Hinweis statt Bewertung
  setup({ all });
  const t2 = plain(run(`statDetail("time")`));
  assert.strictEqual(t2.items.length, 1);
  assert.match(t2.items[0].tip, /Wochenstunden/);
});

test("Kachel-Detail: alle Kacheln liefern Inhalt, auch ohne Daten", () => {
  setup();
  ["status", "streak", "count", "time", "Laufen", "Rad", "Schwimmen", "vo2run", "vo2bike"].forEach(k => {
    const d = plain(run(`statDetail(${JSON.stringify(k)})`));
    assert.ok(d && d.title, k);
  });
  assert.match(plain(run(`statDetail("vo2bike")`)).empty, /Leistungsmesser/);
  assert.strictEqual(run(`statDetail("unbekannt")`), null);
  setup({ state: { ctl: 40, ctlDelta: 8, tsb: -5, acwr: 1.1 }, mono: [{ monotony: 1.3 }] });
  assert.deepStrictEqual(plain(run(`statDetail("status")`)).items.map(i => i.verdict), ["steigt gut", "ausgeglichen", "optimal", "abwechslungsreich"]);
});
