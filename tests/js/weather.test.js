// Tests für das Wetter im Kalender: welche geplante Einheit draußen
// stattfindet (isOutdoorPlannedWorkout, js/data/workouts.js), die
// WMO-Code-Tabelle und das Laden der Vorhersage (js/data/weather.js).
// Ausführen: node --test tests/js/
//
// Wie die übrigen Tests: die Browser-Skripte laufen in einem gemeinsamen
// vm-Kontext. Gestubbt sind nur apiCall (der eigene Server) und das Profil.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = ["js/utils/dates.js", "js/utils/formatting.js", "js/data/workouts.js", "js/data/weather.js"];

let apiAnswer = null; // Funktion (endpoint) -> Antwort bzw. wirft
const app = vm.createContext({
  apiCall: async endpoint => apiAnswer(endpoint),
  athleteProfile: { homeLocation: null },
  saveAthleteProfile: () => {},
});
SCRIPTS.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), app, { filename: f }));
const run = code => vm.runInContext(code, app);
const plain = x => JSON.parse(JSON.stringify(x));
const outdoor = (sport, title) => app.isOutdoorPlannedWorkout({ sport, title });

test("Rad und Laufen sind draußen, außer der Titel nennt ein Indoor-Stichwort", () => {
  assert.strictEqual(outdoor("Rad", "Grundlage lang"), true);
  assert.strictEqual(outdoor("Laufen", "Lockerer Dauerlauf"), true);
  assert.strictEqual(outdoor("Laufen", "Kontrolliertes Tempo"), true); // "rolle" mitten im Wort zählt nicht
  assert.strictEqual(outdoor("Rad", "Sweet Spot auf der Rolle"), false);
  assert.strictEqual(outdoor("Rad", "Rollentraining 4x8"), false);
  assert.strictEqual(outdoor("Rad", "Indoor Intervalle"), false);
  assert.strictEqual(outdoor("Rad", "Zwift Rennen"), false);
  assert.strictEqual(outdoor("Rad", "Virtuelle Ausfahrt"), false);
  assert.strictEqual(outdoor("Laufen", "Laufband-Intervalle"), false);
  assert.strictEqual(outdoor("Laufen", "Hallentraining"), false);
  assert.strictEqual(outdoor("Rad", "Ergometer 3x10 min"), false);
  assert.strictEqual(outdoor("Rad", "Radergometer locker"), false);
  assert.strictEqual(outdoor("Rad", "Smart-Trainer Intervalle"), false);
  assert.strictEqual(outdoor("Rad", "Smarttrainer Grundlage"), false);
  assert.strictEqual(outdoor("Laufen", "Treadmill Tempo"), false);
});

test("Schwimmen nur mit Freiwasser-Stichwort draußen, Kraft/Mobility nie", () => {
  assert.strictEqual(outdoor("Schwimmen", "Technik 2000 m"), false);
  assert.strictEqual(outdoor("Schwimmen", "Freiwasserschwimmen"), true);
  assert.strictEqual(outdoor("Schwimmen", "Open Water Test"), true);
  assert.strictEqual(outdoor("Schwimmen", "Schwimmen im See"), true);
  assert.strictEqual(outdoor("Schwimmen", "See-Querung"), true);
  assert.strictEqual(outdoor("Schwimmen", "Im Meer"), true);
  assert.strictEqual(outdoor("Schwimmen", "Seepferdchen-Technik"), false); // nur das ganze Wort "See"
  assert.strictEqual(outdoor("Schwimmen", "Meerjungfrau-Beinschlag"), false);
  assert.strictEqual(outdoor("Kraft", "Kraft draußen im Park"), false);
  assert.strictEqual(outdoor("Mobility", "Mobility"), false);
  assert.strictEqual(app.isOutdoorPlannedWorkout(null), false);
});

test("WMO-Code -> Symbol und deutscher Text, unbekannt -> null", () => {
  assert.deepStrictEqual(plain(app.weatherCodeInfo(0)), { icon: "☀️", label: "Klar" });
  assert.strictEqual(app.weatherCodeInfo(63).label, "Regen");
  assert.strictEqual(app.weatherCodeInfo(82).label, "Regenschauer");
  assert.strictEqual(app.weatherCodeInfo(99).label, "Gewitter mit Hagel");
  assert.strictEqual(app.weatherCodeInfo(42), null);
  assert.strictEqual(app.weatherCodeInfo(null), null);
});

test("Vorhersage laden: je Tag abrufbar, Fehler als Text statt Absturz, ohne Ort keine Anfrage", async () => {
  let calls = 0;
  apiAnswer = endpoint => { calls++; assert.strictEqual(endpoint, "weather?lat=49.41&lon=8.69"); return { data: { days: [{ date: "2026-10-12", code: 3, temp_max: 16 }] } }; };

  run("athleteProfile.homeLocation = null");
  assert.strictEqual(app.weatherNeedsRefresh(), false);
  await app.loadWeatherForecast();
  assert.strictEqual(calls, 0);

  app.setHomeLocation({ name: "Heidelberg", region: "Baden-Württemberg, Deutschland", lat: 49.41, lon: 8.69 });
  assert.deepStrictEqual(plain(app.athleteProfile.homeLocation), { name: "Heidelberg (Baden-Württemberg, Deutschland)", lat: 49.41, lon: 8.69 });
  assert.strictEqual(app.weatherNeedsRefresh(), true);
  await app.loadWeatherForecast();
  assert.strictEqual(calls, 1);
  assert.strictEqual(app.weatherNeedsRefresh(), false);
  assert.strictEqual(app.weatherForDate("2026-10-12").temp_max, 16);
  assert.strictEqual(app.weatherForDate("2026-10-13"), null);

  apiAnswer = () => { throw new Error("Der Wetterdienst Open-Meteo ist gerade nicht erreichbar."); };
  await app.loadWeatherForecast();
  assert.match(run("weatherState.error"), /nicht erreichbar/);
  assert.strictEqual(app.weatherForDate("2026-10-12"), null);
});
