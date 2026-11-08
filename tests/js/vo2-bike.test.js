// Tests für die Rad-VO2max-Schätzung (js/analytics/performance.js):
// gleichmäßige Abschnitte aus Leistung + Herzfrequenzreserve statt einer
// Regression über ganze Einheiten. Die Fahrten sind künstlich erzeugt -
// mit bekannter VO2max, Rollphasen (0 W) und Aufwärmen.
// Ausführen: node --test tests/js/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const app = vm.createContext({});
["js/utils/formatting.js", "js/analytics/performance.js"].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));

const TRUE_VO2 = 55, KG = 70, MAX = 190, REST = 50;
// Leistung, bei der man den Anteil `frac` der VO2-Reserve braucht (ACSM-Formel umgestellt)
const wattsAt = frac => ((3.5 + frac * (TRUE_VO2 - 3.5)) - 7) * KG / 10.8;
const hrAt = frac => REST + frac * (MAX - REST);

// Eine Fahrt: 10 min Aufwärmen, dann gleichmäßig bei `frac`. Wie in der
// gespeicherten Zeitreihe sind die Werte 20-s-Mittel; draußen schwankt die
// Leistung etwas (Rollphasen anteilig drin). `hrOff`: Tagesform in Schlägen.
function ride(daysAgo, frac, { outdoor = true, minutes = 70, hrOff = 0 } = {}) {
  const t = [], hr = [], power = [];
  for (let s = 0; s <= minutes * 60; s += 20) {
    const warm = s < 600;
    const f = warm ? 0.3 : frac;
    t.push(s);
    hr.push(Math.round(hrAt(f) + (warm ? 0 : hrOff)));
    power.push(Math.round(wattsAt(f) * (outdoor && !warm ? ((s / 20) % 2 ? 0.92 : 1.08) : 1)));
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    sport: "Rad", _date: new Date(Date.now() - daysAgo * 86400000), duration_min: minutes,
    avg_hr: Math.round(avg(hr)), avg_power_w: Math.round(avg(power)), stream: { t, hr, power },
  };
}

function setup(rides, profile, wellness) {
  app.ALL = rides;
  app.athleteProfile = { weightKg: KG, maxHr: MAX, ...profile };
  app.wellnessSeries = wellness ? () => wellness : undefined;
  app.latestWellness = () => null;
}

// Typisch: alles Grundlage im ähnlichen Bereich, ein paar Schläge Tagesform.
const rides = [ride(3, 0.6, { hrOff: 3 }), ride(10, 0.58, { hrOff: -3 }), ride(17, 0.62, { outdoor: false, hrOff: 4 }),
  ride(24, 0.6, { hrOff: -2 }), ride(40, 0.61, { hrOff: 2 })];

test("Rad-VO2max aus gleichmäßigen Abschnitten trifft den wahren Wert", () => {
  setup(rides, { restingHr: REST });
  const est = app.computeBikeVo2MaxEstimate();
  assert.ok(Math.abs(est.value - TRUE_VO2) < 2.5, `geschätzt ${est.value}`);
  assert.match(est.methodLabel, /gleichmäßigen Abschnitten von 5 Radeinheiten/);
});

test("die alte Regression über ganze Einheiten kippt schon bei etwas Tagesform", () => {
  app.athleteProfile = { weightKg: KG };
  const pts = rides.map(w => app.bikeVo2SubmaxPoint(w)).filter(Boolean);
  const old = app.vo2LinearRegressionToMaxHr(pts, MAX);
  assert.ok(old == null || Math.abs(old - TRUE_VO2) > 5, `alt ${old}`);
});

test("Ruhepuls kommt ohne Profilwert aus den Garmin-Werten", () => {
  setup(rides, { restingHr: null }, [{ value: 49 }, { value: 50 }, { value: 52 }]);
  const est = app.computeBikeVo2MaxEstimate();
  assert.ok(Math.abs(est.value - TRUE_VO2) < 2.5);
});

test("Intervalle und kurze Fahrten liefern keine Abschnitte", () => {
  const t = [], hr = [], power = [];
  for (let s = 0; s <= 3600; s += 20) { t.push(s); hr.push(160); power.push((s / 60) % 2 < 1 ? 350 : 100); }
  assert.strictEqual(app.bikeVo2RideEstimate({ duration_min: 60, stream: { t, hr, power } }, KG, MAX, REST), null);
  assert.strictEqual(app.bikeVo2RideEstimate({ ...ride(1, 0.6), duration_min: 15 }, KG, MAX, REST), null);
});

test("zu wenige Fahrten: keine Schätzung aus Abschnitten", () => {
  setup(rides.slice(0, 2), { restingHr: REST });
  const est = app.computeBikeVo2MaxEstimate();
  assert.ok(!est || !/Abschnitten/.test(est.methodLabel));
});
