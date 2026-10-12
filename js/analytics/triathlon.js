// Triathlon-Auswertungen für den "Analyse"-Tab (Anzeige: js/components/analysis.js).
// Rein rechnerisch, kein DOM: alle Funktionen bekommen die Workouts als
// Parameter. Fehlende Daten ergeben null bzw. leere Listen, nie einen
// geratenen Wert.

const TRI_SPORTS = ["Schwimmen", "Rad", "Laufen"];

/* ======================================================================
   SPORT-BALANCE: Anteil von Schwimmen/Rad/Laufen an der Trainingszeit je
   Woche bzw. Monat im Vergleich zu einer Zielverteilung.
   ====================================================================== */

// Standard-Zielverteilung in Prozent der Trainingszeit (übliche Faustregel
// für Triathlon), überschreibbar in den Einstellungen (athleteProfile.sportBalanceTarget).
const SPORT_BALANCE_DEFAULT_TARGET = { Schwimmen: 15, Rad: 50, Laufen: 35 };

// Liegt eine Sportart MEHR als so viele Prozentpunkte unter ihrem Ziel,
// kommt sie "zu kurz" (z.B. Schwimmen 9 % bei Ziel 15 %).
const SPORT_BALANCE_TOLERANCE_PCT = 5;

// So viele Wochen bzw. Monate zeigt die Karte (inkl. der laufenden).
const SPORT_BALANCE_PERIODS = { week: 8, month: 6 };

// Prüft eine Zielverteilung { Schwimmen, Rad, Laufen } (Prozent). Gültig nur,
// wenn alle drei Werte Zahlen >= 0 sind und zusammen 100 ergeben.
// Liefert { target, error } - error ist ein deutscher Hinweistext oder null.
function checkSportBalanceTarget(values) {
  const target = {};
  for (const s of TRI_SPORTS) {
    const raw = values ? values[s] : null;
    const v = Number(raw);
    if (raw == null || raw === "" || !Number.isFinite(v) || v < 0) {
      return { target: null, error: "Bitte für alle drei Sportarten einen Prozentwert (0–100) eintragen." };
    }
    target[s] = v;
  }
  const sum = TRI_SPORTS.reduce((a, s) => a + target[s], 0);
  if (Math.abs(sum - 100) > 0.5) {
    return { target: null, error: `Die drei Werte müssen zusammen 100 % ergeben (aktuell ${Math.round(sum * 10) / 10} %).` };
  }
  return { target, error: null };
}

// Zielverteilung aus dem Profil - ungültig oder nicht gesetzt: Standard.
function sportBalanceTarget(saved) {
  const { target } = checkSportBalanceTarget(saved);
  return target || { ...SPORT_BALANCE_DEFAULT_TARGET };
}

function sportBalancePeriodStart(date, mode) {
  return mode === "month" ? new Date(date.getFullYear(), date.getMonth(), 1) : weekStart(date);
}

// Beginn der Periode n Wochen/Monate nach `start` (n negativ = davor).
// Über den Date-Konstruktor statt Millisekunden - so bleibt die
// Sommerzeit-Umstellung ohne Einfluss.
function shiftSportBalancePeriod(start, mode, n) {
  return mode === "month"
    ? new Date(start.getFullYear(), start.getMonth() + n, 1)
    : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * n);
}

// Anteile (%) und "zu kurz"-Liste für eine Minuten-Verteilung.
function sportBalanceShares(minutes, target) {
  const total = TRI_SPORTS.reduce((a, s) => a + minutes[s], 0);
  if (!total) return { total: 0, shares: null, short: [] };
  const shares = {};
  TRI_SPORTS.forEach(s => { shares[s] = minutes[s] / total * 100; });
  const short = TRI_SPORTS.filter(s => shares[s] < target[s] - SPORT_BALANCE_TOLERANCE_PCT);
  return { total, shares, short };
}

// mode: "week" | "month". Liefert die letzten Perioden (älteste zuerst, die
// laufende zuletzt mit running: true) und eine Gesamtbewertung über die
// ABGESCHLOSSENEN Perioden - die laufende ist noch unvollständig (am Montag
// sähe sonst jede Woche schief aus). "Sonstiges" zählt bewusst nicht mit:
// die Zielverteilung beschreibt nur die drei Triathlon-Sportarten.
function computeSportBalance(workouts, mode, target, today = new Date()) {
  const current = sportBalancePeriodStart(today, mode);
  const periods = [];
  for (let i = SPORT_BALANCE_PERIODS[mode] - 1; i >= 0; i--) {
    const start = shiftSportBalancePeriod(current, mode, -i);
    periods.push({ start, end: shiftSportBalancePeriod(start, mode, 1), running: i === 0, minutes: { Schwimmen: 0, Rad: 0, Laufen: 0 } });
  }
  workouts.forEach(w => {
    const sport = sportGroup(w.sport);
    if (!w._date || w.is_summary || !TRI_SPORTS.includes(sport)) return;
    const p = periods.find(per => w._date >= per.start && w._date < per.end);
    if (p) p.minutes[sport] += w.duration_min || 0;
  });
  periods.forEach(p => Object.assign(p, sportBalanceShares(p.minutes, target)));
  periods[periods.length - 1].short = []; // laufende Periode: noch nicht bewertbar

  const done = periods.filter(p => !p.running);
  const minutes = { Schwimmen: 0, Rad: 0, Laufen: 0 };
  done.forEach(p => TRI_SPORTS.forEach(s => { minutes[s] += p.minutes[s]; }));
  return { mode, target, periods, overall: { periodCount: done.length, minutes, ...sportBalanceShares(minutes, target) } };
}

/* ======================================================================
   SCHWIMMEN: Pace je 100 m, Trend, SWOLF und Critical Swim Speed (CSS)
   ====================================================================== */

const SWIM_TREND_WINDOW_DAYS = 42; // Trend: Ø der letzten 6 Wochen gegen die 6 Wochen davor
const SWIM_TREND_MIN_SWIMS = 2;    // je Fenster mindestens so viele Einheiten, sonst kein Trend

// Testzeit "m:ss" (auch "mm:ss" oder mit Zehnteln "6:40.5") in Sekunden, sonst null.
function parseSwimTestTime(str) {
  const s = String(str == null ? "" : str).trim();
  return /^\d{1,2}:[0-5]\d(\.\d+)?$/.test(s) ? paceToSeconds(s) : null;
}

// Critical Swim Speed aus einem 400-m- und einem 200-m-Test (Standardformel):
// CSS [m/s] = (400 - 200) / (t400 - t200), als Pace je 100 m also
// (t400 - t200) / 2 Sekunden. Liefert { mps, secPer100, pace, error: null }
// oder { error } mit einem deutschen Hinweis.
function computeSwimCss(t400Str, t200Str) {
  const t400 = parseSwimTestTime(t400Str), t200 = parseSwimTestTime(t200Str);
  if (t400 == null || t200 == null) return { error: "Bitte beide Testzeiten im Format m:ss eintragen, z.B. 7:10 und 3:25." };
  // Auf 400 m ist man je 100 m langsamer als auf 200 m - sonst sind die
  // Zeiten vertauscht oder vertippt, und die Formel ergäbe Unsinn.
  if (t400 <= 2 * t200) return { error: "Die 400-m-Zeit muss mehr als doppelt so lang sein wie die 200-m-Zeit – sind die Zeiten vertauscht?" };
  const secPer100 = (t400 - t200) / 2;
  return { mps: 200 / (t400 - t200), secPer100, pace: secondsToPace(secPer100), error: null };
}

const swimPaceSec = w => (w.pace_min_per_100m ? paceToSeconds(w.pace_min_per_100m) : null);

// Ø von `key` in den letzten SWIM_TREND_WINDOW_DAYS Tagen gegen das Fenster
// davor. delta < 0 heißt besser (weniger Sekunden je 100 m bzw. kleinerer SWOLF).
function swimWindowTrend(points, key, today) {
  const windowMs = SWIM_TREND_WINDOW_DAYS * 86400000;
  const recentFrom = today.getTime() - windowMs, priorFrom = recentFrom - windowMs;
  const vals = (from, to) => points.filter(p => p[key] != null && p.date >= from && p.date < to).map(p => p[key]);
  const recent = vals(recentFrom, today.getTime() + 1), prior = vals(priorFrom, recentFrom);
  if (recent.length < SWIM_TREND_MIN_SWIMS || prior.length < SWIM_TREND_MIN_SWIMS) return null;
  const avg = list => list.reduce((a, b) => a + b, 0) / list.length;
  return { recent: avg(recent), prior: avg(prior), delta: avg(recent) - avg(prior), recentCount: recent.length, priorCount: prior.length };
}

// Schwimm-Auswertung über die Vergleichsgruppe der letzten Einheit
// (sameComparisonGroup: Becken- und Freiwasser-Pace werden nicht vermischt).
// null, wenn es keine Schwimmeinheit mit Pace gibt.
function computeSwimAnalysis(workouts, today = new Date()) {
  const swims = workouts
    .filter(w => w._date && !w.is_summary && sportGroup(w.sport) === "Schwimmen" && swimPaceSec(w))
    .sort((a, b) => a._date - b._date);
  if (!swims.length) return null;
  const latest = swims[swims.length - 1];
  const points = swims.filter(w => sameComparisonGroup(latest, w))
    .map(w => ({ date: w._date.getTime(), paceSec: swimPaceSec(w), swolf: w.avg_swolf ?? null, workout: w }));
  return {
    groupLabel: comparisonGroupLabel(latest),
    points,
    swolfCount: points.filter(p => p.swolf != null).length,
    paceTrend: swimWindowTrend(points, "paceSec", today),
    swolfTrend: swimWindowTrend(points, "swolf", today),
  };
}

/* ======================================================================
   RAD: FTP (aus dem Profil + Schätzung aus den Leistungskurven),
   Zeit in den Leistungszonen und FTP-Verlauf
   ====================================================================== */

const FTP_BEST_EFFORT_S = 20 * 60;   // beste 20 Minuten am Stück ...
const FTP_FROM_20MIN_FACTOR = 0.95;  // ... davon 95 % = FTP (gängige Faustregel nach Allen/Coggan)
const FTP_ESTIMATE_WINDOW_DAYS = 90; // Schätzung nur aus den letzten 90 Tagen - eine alte Bestleistung sagt wenig über die heutige Form
const FTP_TREND_MONTHS = 12;         // Verlauf: geschätzte FTP je Kalendermonat, letzte 12 Monate
const POWER_ZONE_WINDOW_DAYS = 28;   // Zeit in den Leistungszonen: letzte 4 Wochen
const POWER_PAUSE_FACTOR = 3;        // Punktabstand > 3x des üblichen = Aufzeichnungspause, unterbricht ein Fenster

// Zerlegt die Leistungskurve (stream.t/stream.power, vom Parser auf ~200
// Punkte verdichtet - jeder Punkt steht für den Abschnitt bis zum nächsten)
// in lückenlose Stücke aus { dt, p }. Punkte ohne Leistungswert und
// Aufzeichnungspausen trennen die Stücke, damit nichts überbrückt wird.
function powerRuns(stream) {
  if (!stream || !Array.isArray(stream.t) || !Array.isArray(stream.power)) return [];
  const t = stream.t, pw = stream.power, n = Math.min(t.length, pw.length);
  const steps = [];
  for (let i = 0; i < n - 1; i++) if (t[i + 1] > t[i]) steps.push(t[i + 1] - t[i]);
  if (!steps.length) return [];
  steps.sort((a, b) => a - b);
  const step = steps[Math.floor(steps.length / 2)]; // üblicher Punktabstand (Median)
  const runs = [];
  let cur = [];
  for (let i = 0; i < n; i++) {
    const raw = i < n - 1 ? t[i + 1] - t[i] : step;
    if (pw[i] == null || !(raw > 0)) { if (cur.length) runs.push(cur); cur = []; continue; }
    const pause = raw > POWER_PAUSE_FACTOR * step;
    cur.push({ dt: pause ? step : raw, p: pw[i] });
    if (pause) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

// Beste Durchschnittsleistung (W) über `seconds` am Stück, zeitgewichtet.
// null, wenn kein lückenloses Stück so lang ist.
function bestAveragePower(stream, seconds) {
  let best = null;
  powerRuns(stream).forEach(run => {
    const T = [0], E = [0]; // Summen von Dauer und Energie bis vor Abschnitt k
    run.forEach((s, k) => { T.push(T[k] + s.dt); E.push(E[k] + s.p * s.dt); });
    let j = 0;
    for (let i = 0; i < run.length; i++) {
      if (j < i) j = i;
      while (j < run.length && T[j + 1] - T[i] < seconds) j++;
      if (j >= run.length) break; // ab hier ist der Rest kürzer als `seconds`
      const energy = E[j] - E[i] + run[j].p * (seconds - (T[j] - T[i]));
      if (best == null || energy / seconds > best) best = energy / seconds;
    }
  });
  return best;
}

const hasPowerStream = w => !!(w.stream && Array.isArray(w.stream.power) && w.stream.power.some(v => v != null));

// Index (0-4) der Leistungszone für einen Anteil der FTP - Zonengrenzen aus
// POWER_ZONE_FTP_BOUNDS (js/analytics/zones.js), oberhalb von Z5 bleibt es Z5.
function powerZoneIndex(fraction) {
  let zi = 0;
  POWER_ZONE_FTP_BOUNDS.forEach(([lo], i) => { if (fraction >= lo) zi = i; });
  return zi;
}

// Rad-Auswertung. manualFtp = athleteProfile.ftpWatts (oder null).
// Ohne Leistungskurven bleibt alles Gemessene leer (hasPower: false) - die
// Zonen-Grenzen gibt es dann nur aus der FTP im Profil.
function computeBikeAnalysis(workouts, manualFtp, today = new Date()) {
  const dayMs = 86400000;
  const rides = workouts.filter(w => w._date && !w.is_summary && sportGroup(w.sport) === "Rad" && hasPowerStream(w));
  const best20 = new Map(rides.map(w => [w, bestAveragePower(w.stream, FTP_BEST_EFFORT_S)]));
  const bestOf = list => list.reduce((b, w) => (best20.get(w) != null && (!b || best20.get(w) > best20.get(b)) ? w : b), null);
  const estimateOf = w => (w ? { ftp: Math.round(best20.get(w) * FTP_FROM_20MIN_FACTOR), best20: Math.round(best20.get(w)), workout: w } : null);

  const estimate = estimateOf(bestOf(rides.filter(w => w._date >= today - FTP_ESTIMATE_WINDOW_DAYS * dayMs && w._date <= today)));

  const trend = [];
  for (let i = FTP_TREND_MONTHS - 1; i >= 0; i--) {
    const start = new Date(today.getFullYear(), today.getMonth() - i, 1), end = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
    const est = estimateOf(bestOf(rides.filter(w => w._date >= start && w._date < end)));
    if (est) trend.push({ start, ...est });
  }

  const ftp = manualFtp || (estimate && estimate.ftp) || null;
  let distribution = null;
  if (ftp) {
    const seconds = [0, 0, 0, 0, 0];
    const recent = rides.filter(w => w._date >= today - POWER_ZONE_WINDOW_DAYS * dayMs && w._date <= today);
    recent.forEach(w => powerRuns(w.stream).forEach(run => run.forEach(s => { seconds[powerZoneIndex(s.p / ftp)] += s.dt; })));
    const total = seconds.reduce((a, b) => a + b, 0);
    if (total) distribution = { seconds, total, rideCount: recent.length };
  }
  return {
    hasPower: rides.length > 0,
    estimate,
    trend,
    ftp,
    ftpSource: manualFtp ? "manual" : (ftp ? "estimate" : null),
    zones: ftp ? computeBikePowerZones(ftp) : null,
    distribution,
  };
}

/* ======================================================================
   KOPPELTRAINING: Lauf direkt nach dem Rad, die ersten 10 Minuten im
   Vergleich zu normalen Läufen
   ====================================================================== */

const BRICK_MAX_GAP_MIN = 30;          // Lauf beginnt höchstens 30 min nach dem Radende = Koppeltraining
const BRICK_CLOCK_TOLERANCE_S = 60;    // Uhr-/Rundungsabweichung: der Lauf darf bis zu 1 min "vor" dem Radende beginnen
const BRICK_START_WINDOW_S = 600;      // verglichen werden die ersten 10 Minuten des Laufs
const BRICK_COMPARE_WINDOW_DAYS = 90;  // Vergleich: normale Läufe aus den 90 Tagen vor der Koppeleinheit
const BRICK_MIN_COMPARE_RUNS = 3;      // weniger Vergleichsläufe -> kein Vergleich
const BRICK_MIN_POINTS = 3;            // so viele Messpunkte braucht ein Wert in den ersten 10 Minuten

// Pace (s/km, aus der Ø-Geschwindigkeit in Bewegung - Stillstand zählt nicht)
// und Ø-Puls der ersten BRICK_START_WINDOW_S Sekunden aus der Sekundenkurve
// (stream). Der Lauf muss mindestens so lang aufgezeichnet sein. null, wenn beides fehlt.
function runStartMetrics(w) {
  const s = w.stream;
  if (!s || !Array.isArray(s.t) || !s.t.length || s.t[s.t.length - 1] < BRICK_START_WINDOW_S) return null;
  const inWindow = key => (Array.isArray(s[key]) ? s.t.map((t, i) => (t < BRICK_START_WINDOW_S ? s[key][i] : null)).filter(v => v != null && v > 0) : []);
  const mean = list => (list.length >= BRICK_MIN_POINTS ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const speed = mean(inWindow("speed")), hr = mean(inWindow("hr"));
  if (speed == null && hr == null) return null;
  return { paceSec: speed != null ? 1000 / speed : null, hr };
}

// Koppeleinheiten, neueste zuerst: Lauf, der höchstens BRICK_MAX_GAP_MIN nach
// dem Ende einer Radeinheit beginnt (Start/Ende über workoutStartEndMs() aus
// js/data/workouts.js). Je Lauf zählt die zuletzt davor beendete Radeinheit.
function findBrickSessions(workouts) {
  const timed = workouts.filter(w => !w.is_summary && workoutStartEndMs(w));
  const rides = timed.filter(w => sportGroup(w.sport) === "Rad");
  const bricks = [];
  timed.filter(w => sportGroup(w.sport) === "Laufen").forEach(run => {
    const start = workoutStartEndMs(run).start;
    let best = null;
    rides.forEach(ride => {
      const end = workoutStartEndMs(ride).end, gapS = (start - end) / 1000;
      if (gapS >= -BRICK_CLOCK_TOLERANCE_S && gapS <= BRICK_MAX_GAP_MIN * 60 && (!best || end > best.end)) best = { ride, end, gapS };
    });
    if (best) bricks.push({ ride: best.ride, run, start, gapMin: Math.max(0, best.gapS) / 60 });
  });
  return bricks.sort((a, b) => b.start - a.start);
}

// Je Koppeleinheit: erste 10 Minuten des Laufs gegen dieselben 10 Minuten
// normaler Läufe (kein Rad davor) der BRICK_COMPARE_WINDOW_DAYS Tage davor -
// wer in die Vergleichsgruppe darf, entscheidet sameComparisonGroup().
// delta > 0 = langsamer bzw. höherer Puls als sonst.
function computeBrickAnalysis(workouts) {
  const bricks = findBrickSessions(workouts);
  const brickRuns = new Set(bricks.map(b => b.run));
  const normal = workouts.filter(w => w._date && !w.is_summary && sportGroup(w.sport) === "Laufen" && !brickRuns.has(w));
  const metrics = new Map(normal.map(w => [w, runStartMetrics(w)]));
  const avg = list => list.reduce((a, b) => a + b, 0) / list.length;

  const sessions = bricks.map(b => {
    const own = runStartMetrics(b.run);
    const from = b.start - BRICK_COMPARE_WINDOW_DAYS * 86400000;
    const group = normal.filter(o => metrics.get(o) && o._date >= from && o._date < b.start && sameComparisonGroup(b.run, o));
    const compare = {};
    ["paceSec", "hr"].forEach(key => {
      const vals = group.map(o => metrics.get(o)[key]).filter(v => v != null);
      compare[key] = vals.length >= BRICK_MIN_COMPARE_RUNS ? avg(vals) : null;
    });
    const delta = key => (own && own[key] != null && compare[key] != null ? own[key] - compare[key] : null);
    return { ride: b.ride, run: b.run, gapMin: b.gapMin, own, compare, compareCount: group.length, delta: { paceSec: delta("paceSec"), hr: delta("hr") } };
  });

  const summaryOf = key => {
    const vals = sessions.map(s => s.delta[key]).filter(v => v != null);
    return vals.length ? { value: avg(vals), count: vals.length } : null;
  };
  return { sessions, summary: { paceSec: summaryOf("paceSec"), hr: summaryOf("hr") } };
}
