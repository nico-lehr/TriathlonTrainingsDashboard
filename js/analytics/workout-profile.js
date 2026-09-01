// Zusätzliche Auswertungen für die Trainings-Detailansicht (Modal +
// Kalender-Tagesansicht, siehe js/components/workout-card.js):
//   - computeTrainingLoadStats: TRIMP, TRIMP/Min., Ø-Herzfrequenzreserve,
//     eigener "Stress-Score" — braucht Max-/Ruhe-Herzfrequenz aus dem
//     Athletenprofil, sonst null (keine erfundenen Werte, siehe AI_RULES.md).
//   - computeWorkoutHrProfile: Puls-Dichtekurve dieser einen Einheit im
//     Vergleich zur sonstigen Verteilung derselben Sportart (nutzt
//     hrDensityFromValues aus js/analytics/hr-distribution.js).
//   - computeLoadRadar: normiertes Belastungsprofil (6 Achsen) dieser
//     Einheit im Vergleich zum Sportart-Durchschnitt.
// Alles rein deterministisch, keine KI beteiligt (AI_RULES: Berechnungen
// gehören in App-Code, nicht ins LLM).

/* ---------- Trainingsbelastung (TRIMP / Herzfrequenzreserve) ---------- */

// TRIMP nach Banister: dTRIMP = dt(Min.) x HRratio x 0.64 x e^(1.92 x HRratio)
// mit HRratio = (HF - Ruhe-HF) / (Max-HF - Ruhe-HF), geclampt auf 0..1.
// 0.64/1.92 sind die in der Literatur gebräuchlichen (männlichen) Koeffizienten
// - eine geschlechtsspezifische Variante würde ein Profilfeld voraussetzen,
// das dieses Projekt bewusst nicht erhebt (siehe Datenschutz-Prinzipien).
function computeTrainingLoadStats(w) {
  const maxHr = athleteProfile.maxHr, restingHr = athleteProfile.restingHr;
  if (!maxHr || !restingHr || maxHr <= restingHr) return null; // Profil unvollständig
  if (!w.duration_min) return null;
  const stream = w.stream;
  // Wie in workout-card.js (renderWorkoutDetailCharts, hrCoverage): ein Stream
  // mit nur vereinzelten Pulswerten liefert über die konsekutive Paar-Summation
  // (s.u.) fast nur Lücken und damit eine viel zu niedrige TRIMP-Summe - lieber
  // dann auf den geräteseitigen Ø-Wert über die Gesamtdauer zurückfallen.
  const hrPointCount = stream && stream.hr ? stream.hr.filter(v => v != null).length : 0;
  const hrCoverage = stream && stream.t && stream.t.length ? hrPointCount / stream.t.length : 0;
  const hasStream = !!(stream && stream.t && stream.hr && hrPointCount >= 2 && hrCoverage >= 0.15);
  if (!hasStream && w.avg_hr == null) return null; // keine ausreichenden Pulsdaten für diese Einheit

  const hrr = maxHr - restingHr;
  const clamp01 = v => Math.min(1, Math.max(0, v));

  let trimp, meanHr;
  if (hasStream) {
    let trimpSum = 0, hrWeightedSum = 0, weightTotal = 0;
    for (let i = 1; i < stream.t.length; i++) {
      if (stream.hr[i] == null || stream.hr[i - 1] == null) continue;
      const dtMin = (stream.t[i] - stream.t[i - 1]) / 60;
      if (dtMin <= 0) continue;
      const avgHr = (stream.hr[i] + stream.hr[i - 1]) / 2;
      const ratio = clamp01((avgHr - restingHr) / hrr);
      trimpSum += dtMin * ratio * 0.64 * Math.exp(1.92 * ratio);
      hrWeightedSum += avgHr * dtMin;
      weightTotal += dtMin;
    }
    trimp = trimpSum;
    meanHr = weightTotal > 0 ? hrWeightedSum / weightTotal : w.avg_hr;
  } else {
    meanHr = w.avg_hr;
    const ratio = clamp01((meanHr - restingHr) / hrr);
    trimp = w.duration_min * ratio * 0.64 * Math.exp(1.92 * ratio);
  }
  if (meanHr == null || !isFinite(trimp) || trimp <= 0) return null;

  const hrrPercent = clamp01((meanHr - restingHr) / hrr) * 100;
  const trimpPerMin = trimp / w.duration_min;
  // Eigener, transparenter "Stress-Score" (kein Nachbau proprietärer
  // Garmin-/TrainingPeaks-Werte): kombiniert Intensität (%HRR) mit Umfang
  // (Dauer, logarithmisch gedämpft, damit sehr lange lockere Einheiten den
  // Score nicht allein durch ihre Länge in die Höhe treiben).
  const stressScore = Math.round(hrrPercent * Math.log(1 + w.duration_min) / 10);

  return { trimp: Math.round(trimp), trimpPerMin, hrrPercent, stressScore };
}

/* ---------- Herzfrequenzprofil (Einheit vs. eigene Sportart) ---------- */

const HR_PROFILE_MIN_SAMPLES = 20;

function computeWorkoutHrProfile(w, allData, binWidth = 3) {
  if (!w.stream || !w.stream.hr) return null;
  const ownVals = w.stream.hr.filter(v => v != null);
  if (ownVals.length < HR_PROFILE_MIN_SAMPLES) return null;

  const grp = sportGroup(w.sport);
  const compareVals = [];
  allData.forEach(o => {
    if (o.file === w.file || !o.stream || !o.stream.hr) return;
    if (sportGroup(o.sport) !== grp) return;
    o.stream.hr.forEach(v => { if (v != null) compareVals.push(v); });
  });
  const hasCompare = compareVals.length >= HR_PROFILE_MIN_SAMPLES;

  const allVals = hasCompare ? ownVals.concat(compareVals) : ownVals;
  const minHr = Math.floor(Math.min(...allVals) / binWidth) * binWidth;
  const maxHr = Math.ceil(Math.max(...allVals) / binWidth) * binWidth;
  const binCount = Math.max(1, Math.round((maxHr - minHr) / binWidth));

  const ownDensity = hrDensityFromValues(ownVals, minHr, binWidth, binCount);
  const compareDensity = hasCompare ? hrDensityFromValues(compareVals, minHr, binWidth, binCount) : null;

  const mean = ownVals.reduce((a, b) => a + b, 0) / ownVals.length;
  const variance = ownVals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / ownVals.length;
  const sd = Math.sqrt(variance);
  let variability;
  if (sd < 8) variability = "Sehr gleichmäßig";
  else if (sd < 15) variability = "Gleichmäßig";
  else if (sd < 25) variability = "Variabel";
  else variability = "Sehr variabel";

  const span = maxHr - minHr;
  const zoneBounds = [minHr, minHr + span * 0.2, minHr + span * 0.4, minHr + span * 0.6, minHr + span * 0.8, maxHr];

  return { minHr, maxHr, binWidth, binCount, ownDensity, compareDensity, variability, sd, zoneBounds, compareWorkouts: hasCompare };
}

/* ---------- Belastungsprofil (Radar, 6 Achsen vs. Sportart-Ø) ---------- */

// Kadenz-Ø der Vergleichsgruppe (Laufen/Rad) - wird für die KI-Auswertung
// je Einheit gebraucht (js/ai/context-builder.js), ergänzt averageComparisonStat
// aus workout-comparison.js um den passenden Klartext-Zusatz.
function cadenceComparisonLine(w, comparable) {
  const avgCad = averageComparisonStat(comparable, "avg_cadence");
  if (avgCad == null || w.avg_cadence == null) return null;
  const delta = Math.round(w.avg_cadence - avgCad);
  return `Ø Kadenz ${Math.round(avgCad)} (diese Einheit ${delta >= 0 ? "+" : ""}${delta})`;
}

const RADAR_MIN_COMPARABLE = 5; // zu wenig Vergleichseinheiten -> Normierung wäre nicht belastbar

// Vergleicht Pace/Geschwindigkeit erste vs. zweite Hälfte der Einheit
// (Sekundendaten nötig) - positiv = zweite Hälfte schneller = negativer Split.
function computeNegSplitPercent(w) {
  const stream = w.stream;
  if (!stream || !stream.t || !stream.speed) return null;
  const pts = stream.t.map((t, i) => ({ t, sp: stream.speed[i] })).filter(p => p.sp != null && p.sp > 0);
  if (pts.length < 10) return null;
  const totalT = pts[pts.length - 1].t;
  const mid = totalT / 2;
  const first = pts.filter(p => p.t <= mid), second = pts.filter(p => p.t > mid);
  if (!first.length || !second.length) return null;
  const avg = arr => arr.reduce((a, b) => a + b.sp, 0) / arr.length;
  const firstAvg = avg(first), secondAvg = avg(second);
  if (firstAvg <= 0) return null;
  return ((secondAvg - firstAvg) / firstAvg) * 100;
}

// speed_kmh ist nur bei Rad-Einheiten befüllt (siehe DATA_MODEL.md) - für
// Laufen/Schwimmen wird die Geschwindigkeit stattdessen aus der Pace
// abgeleitet, damit die "Ø-Schnitt"-Achse dort nicht immer fehlt.
function speedKmhForRadar(w) {
  if (w.speed_kmh != null) return w.speed_kmh;
  if (w.pace_min_per_km) {
    const sec = paceToSeconds(w.pace_min_per_km);
    if (sec) return 3600 / sec;
  }
  if (w.pace_min_per_100m) {
    const sec = paceToSeconds(w.pace_min_per_100m);
    if (sec) return (100 / sec) * 3.6;
  }
  return null;
}

const RADAR_AXES = [
  { label: "Ø-Schnitt", get: speedKmhForRadar },
  { label: "kcal/Min.", get: w => (w.calories && w.duration_min) ? w.calories / w.duration_min : null },
  { label: "HF Ø", get: w => w.avg_hr },
  { label: "Strecke", get: w => w.distance_km },
  { label: "Dauer", get: w => w.duration_min },
  { label: "Negativer Split", get: computeNegSplitPercent },
];

function computeLoadRadar(w, allData) {
  const grp = sportGroup(w.sport);
  const comparable = allData.filter(o => o.file !== w.file && !o.is_summary && sportGroup(o.sport) === grp);
  if (comparable.length < RADAR_MIN_COMPARABLE) return null;

  const axes = RADAR_AXES.map(axis => {
    const ownVal = axis.get(w);
    const compVals = comparable.map(axis.get).filter(v => v != null);
    if (ownVal == null || compVals.length < RADAR_MIN_COMPARABLE) return null;
    const allVals = compVals.concat([ownVal]);
    const min = Math.min(...allVals), max = Math.max(...allVals);
    const norm = v => max > min ? (v - min) / (max - min) : 0.5;
    const compAvg = compVals.reduce((a, b) => a + b, 0) / compVals.length;
    return { label: axis.label, own: norm(ownVal), avg: norm(compAvg), ownRaw: ownVal, avgRaw: compAvg };
  });

  // Nicht jede Achse ist für jede Einheit sinnvoll (z.B. "Negativer Split"
  // ohne Streckendaten) - dann lieber die ganze Karte weglassen statt eine
  // Achse mit einem neutralen/erfundenen Wert zu zeigen (AI_RULES: fehlende
  // Werte nie erfinden).
  if (axes.some(a => a == null)) return null;
  return axes;
}
