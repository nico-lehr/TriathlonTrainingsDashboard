// Parser-Test (js/data/fit-parser.js) an einer selbst gebauten .fit-Datei:
// Runden, gefühlte Anstrengung/Gefühl von der Uhr, Temperatur - und derselbe
// Stand wie parse_fit.py (wenn Python + fitdecode da sind).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { sampleRunFit } = require("./fit-builder");

const ROOT = path.join(__dirname, "..", "..");
const app = vm.createContext({ console, Math, Date, JSON, DataView, ArrayBuffer, Uint8Array, BigInt, String, Number, Object, Array, Set, Map, Error });
vm.runInContext(fs.readFileSync(path.join(ROOT, "js/data/fit-parser.js"), "utf8"), app, { filename: "fit-parser.js" });

function parseJs(bytes) {
  app.__buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return JSON.parse(JSON.stringify(vm.runInContext("buildWorkoutFromParsed('lauf.fit', parseFitArrayBuffer(__buf))", app)));
}

test("Uhr-Werte: gefühlte Anstrengung, Gefühl, Temperatur", () => {
  const w = parseJs(sampleRunFit());
  assert.strictEqual(w.sport, "Laufen");
  assert.strictEqual(w.rpe, 7);
  assert.strictEqual(w.feel, 75);
  assert.strictEqual(w.avg_temp_c, 21);
  assert.strictEqual(w.max_temp_c, 24);
  assert.strictEqual(w.parser_version, 2);
});

test("Runden: Dauer, Puls, Tempo, Art und Auslöser", () => {
  const w = parseJs(sampleRunFit());
  assert.strictEqual(w.laps.length, 2);
  const [a, b] = w.laps;
  assert.deepStrictEqual([a.n, a.start_s, a.dur_s, a.hr, a.intensity, a.trigger], [1, 0, 600, 140, "warmup", "manual"]);
  assert.deepStrictEqual([b.n, b.start_s, b.dist_m, b.speed, b.hr, b.max_hr, b.intensity, b.trigger, b.cad, b.temp], [2, 600, 2100, 3.5, 165, 173, "interval", "time", 172, 21]);
});

test("Python-Parser liest dieselben Werte (wenn fitdecode installiert ist)", t => {
  let ok = true;
  try { execFileSync("python3", ["-c", "import fitdecode"], { stdio: "ignore" }); } catch (e) { ok = false; }
  if (!ok) { t.skip("python3/fitdecode fehlt"); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fit-"));
  fs.writeFileSync(path.join(dir, "lauf.fit"), sampleRunFit());
  execFileSync("python3", [path.join(ROOT, "parse_fit.py"), dir, "-o", path.join(dir, "out.json")], { stdio: "ignore" });
  const py = JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8")).workouts[0];
  const js = parseJs(sampleRunFit());
  for (const k of ["rpe", "feel", "avg_temp_c", "max_temp_c", "parser_version", "duration_min", "distance_km", "avg_hr"]) {
    assert.deepStrictEqual(py[k], js[k], k);
  }
  assert.deepStrictEqual(py.laps, js.laps);
  fs.rmSync(dir, { recursive: true, force: true });
});
