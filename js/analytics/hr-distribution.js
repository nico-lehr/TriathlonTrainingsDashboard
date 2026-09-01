// Herzfrequenzverteilung nach Aktivität: baut je Sportart ein geglättetes
// Dichte-Histogramm aus den Sekunden-Pulswerten (workout.stream.hr) aller
// Einheiten - zeigt (anders als der HF-Trend-Chart, der nur den Ø-Puls pro
// Einheit zeigt), in welchem Pulsbereich TATSÄCHLICH die meiste Zeit
// verbracht wurde. Rein deterministische Berechnung, keine KI beteiligt.

const HRDIST_MIN_SAMPLES = 20; // zu wenig Punkte -> Kurve wäre nicht aussagekräftig

// Gemeinsam mit js/analytics/workout-profile.js genutzt (Herzfrequenzprofil
// einer einzelnen Einheit im Vergleich zu ihrer Sportart): baut aus rohen
// Pulswerten ein normiertes (0..1, eigenes Maximum je Aufruf), geglättetes
// Dichte-Histogramm über eine VORGEGEBENE gemeinsame bpm-Achse (minHr/maxHr/
// binCount), damit zwei Kurven direkt vergleichbar auf derselben Achse
// liegen, statt jede ihre eigene Skala zu bekommen.
function hrDensityFromValues(vals, minHr, binWidth, binCount) {
  const bins = new Array(binCount).fill(0);
  vals.forEach(v => {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((v - minHr) / binWidth)));
    bins[idx]++;
  });
  // Leichte gleitende Glättung (5er-Fenster): macht aus den Balken eine
  // ruhige Kurve, ohne die grobe Form der Verteilung zu verfälschen.
  const smoothed = bins.map((_, i) => {
    const lo = Math.max(0, i - 2), hi = Math.min(binCount - 1, i + 2);
    let sum = 0, n = 0;
    for (let j = lo; j <= hi; j++) { sum += bins[j]; n++; }
    return sum / n;
  });
  const peak = Math.max(1, ...smoothed);
  return smoothed.map(v => v / peak);
}

function computeHrDistribution(data, binWidth = 3) {
  const order = ["Schwimmen", "Rad", "Laufen", "Sonstiges"];
  const perSport = {}; order.forEach(s => perSport[s] = { values: [], workouts: 0 });

  data.forEach(w => {
    if (!w.stream || !w.stream.hr || !w.stream.hr.length) return;
    const grp = sportGroup(w.sport);
    const before = perSport[grp].values.length;
    w.stream.hr.forEach(v => { if (v) perSport[grp].values.push(v); });
    if (perSport[grp].values.length > before) perSport[grp].workouts++;
  });

  const allVals = order.flatMap(s => perSport[s].values);
  if (allVals.length < HRDIST_MIN_SAMPLES) return null;

  const minHr = Math.floor(Math.min(...allVals) / binWidth) * binWidth;
  const maxHr = Math.ceil(Math.max(...allVals) / binWidth) * binWidth;
  const binCount = Math.max(1, Math.round((maxHr - minHr) / binWidth));

  const rows = order
    .filter(s => perSport[s].values.length >= HRDIST_MIN_SAMPLES)
    .map(s => ({ sport: s, samples: perSport[s].values.length, workouts: perSport[s].workouts, density: hrDensityFromValues(perSport[s].values, minHr, binWidth, binCount) }));

  if (!rows.length) return null;

  // Zonengrenzen relativ zur gemeinsamen Puls-Spanne (dieselbe Systematik
  // wie die bestehende HF-Zonen-Karte: 5 gleich große Bänder statt %-von-
  // Max-HF, da kein hinterlegter Max-HF-Wert im Athletenprofil existiert).
  const span = maxHr - minHr;
  const zoneBounds = [minHr, minHr + span * 0.2, minHr + span * 0.4, minHr + span * 0.6, minHr + span * 0.8, maxHr];

  return { minHr, maxHr, binWidth, binCount, rows, zoneBounds };
}
