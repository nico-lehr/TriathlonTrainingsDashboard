// Trainingszonen aus dem Athletenprofil (maxHr/restingHr, Schwellenpace Lauf,
// CSS Schwimmen, FTP Rad) - rein deterministische Berechnung (AI_RULES:
// "Analytics feed AI, AI doesn't calculate"). Wird dem KI-Trainingsplan als
// fertige Referenzwerte mitgegeben, damit Empfehlungen konkrete HF-/Pace-/
// Watt-Bereiche nennen können, ohne dass die KI selbst etwas erfinden oder
// rechnen muss (siehe CHANGE_REQUESTS.md: "präzisere Trainingsvorschläge").
//
// 5-Zonen-Modell (gängige, einfache Coaching-Praxis - kein Ersatz für eine
// echte Leistungsdiagnostik, aber deutlich konkreter als nur "leicht/mittel/
// hart"): Z1 Recovery, Z2 Grundlage/aerob, Z3 Tempo, Z4 Schwelle, Z5 VO2max.

const ZONE_LABELS = ["Z1 Recovery", "Z2 Grundlage", "Z3 Tempo", "Z4 Schwelle", "Z5 VO2max"];

// Herzfrequenz-Zonen nach Karvonen (Herzfrequenzreserve = maxHr - restingHr) -
// Standard-Prozentbänder der HFR je Zone.
const HR_ZONE_HRR_BOUNDS = [[0.50, 0.60], [0.60, 0.70], [0.70, 0.80], [0.80, 0.90], [0.90, 1.00]];

function computeHrZones() {
  const max = athleteProfile.maxHr, rest = athleteProfile.restingHr;
  if (!max || !rest || max <= rest) return null;
  const hrr = max - rest;
  return HR_ZONE_HRR_BOUNDS.map(([lo, hi], i) => ({
    label: ZONE_LABELS[i],
    lowBpm: Math.round(rest + hrr * lo),
    highBpm: Math.round(rest + hrr * hi),
  }));
}

// Pace-Zonen als Faktor der Schwellenpace (Sek./Distanzeinheit) - langsamer
// als Schwelle = größerer Faktor (mehr Sekunden je km/100m). Dieselben
// Faktoren für Laufen (Schwellenpace) und Schwimmen (CSS) genutzt, da beides
// eine "kritische"/Schwellenpace als Referenzpunkt ist.
const PACE_ZONE_THRESHOLD_FACTORS = [[1.30, 1.45], [1.15, 1.30], [1.05, 1.15], [0.98, 1.05], [0.90, 0.98]];

function computePaceZonesFromThreshold(thresholdPaceStr) {
  const sec = paceToSeconds(thresholdPaceStr);
  if (!sec) return null;
  return PACE_ZONE_THRESHOLD_FACTORS.map(([loFactor, hiFactor], i) => ({
    label: ZONE_LABELS[i],
    fastPace: secondsToPace(sec * loFactor),
    slowPace: secondsToPace(sec * hiFactor),
  }));
}

function computeRunPaceZones() { return computePaceZonesFromThreshold(athleteProfile.runThresholdPace); }
function computeSwimPaceZones() { return computePaceZonesFromThreshold(athleteProfile.swimCss); }

// Rad-Leistungszonen als %FTP (angelehnt an das gängige Coggan-7-Zonen-Modell,
// hier auf 5 Zonen komprimiert, damit es zum selben Label-Set passt).
const POWER_ZONE_FTP_BOUNDS = [[0, 0.55], [0.56, 0.75], [0.76, 0.90], [0.91, 1.05], [1.06, 1.30]];

function computeBikePowerZones() {
  const ftp = athleteProfile.ftpWatts;
  if (!ftp) return null;
  return POWER_ZONE_FTP_BOUNDS.map(([lo, hi], i) => ({
    label: ZONE_LABELS[i],
    lowW: Math.round(ftp * lo),
    highW: Math.round(ftp * hi),
  }));
}

// Kompakter Text-Block für den KI-Kontext (context-builder.js) - nur die
// Zonen, für die überhaupt ein Schwellenwert im Profil hinterlegt ist, damit
// der Kontext nicht mit Leerwerten aufgebläht wird.
function formatZonesForContext() {
  const lines = [];
  const hr = computeHrZones();
  if (hr) lines.push(`Herzfrequenz-Zonen (Karvonen, Ruhe-/Max-HF aus Profil): ${hr.map(z => `${z.label} ${z.lowBpm}-${z.highBpm}bpm`).join(" | ")}`);
  const run = computeRunPaceZones();
  if (run) lines.push(`Lauf-Pace-Zonen (aus Schwellenpace): ${run.map(z => `${z.label} ${z.fastPace}-${z.slowPace}/km`).join(" | ")}`);
  const swim = computeSwimPaceZones();
  if (swim) lines.push(`Schwimm-Pace-Zonen (aus CSS): ${swim.map(z => `${z.label} ${z.fastPace}-${z.slowPace}/100m`).join(" | ")}`);
  const bike = computeBikePowerZones();
  if (bike) lines.push(`Rad-Leistungszonen (aus FTP): ${bike.map(z => `${z.label} ${z.lowW}-${z.highW}W`).join(" | ")}`);
  return lines;
}
