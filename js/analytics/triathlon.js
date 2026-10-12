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
