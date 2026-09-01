// Reine, DOM-freie Berechnungen (Skalen, Bestleistungen).

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  let step;
  if (n <= 1) step = 1; else if (n <= 2) step = 2; else if (n <= 5) step = 5; else step = 10;
  return step * p;
}

/* ---------- Micro-Animation-Helfer ---------- */
// Lässt eine Linie sich selbst "zeichnen" (stroke-dashoffset von voller Länge auf 0).
// Nur für durchgezogene (nicht gestrichelte) Linien geeignet.

function bestEffortForDistance(workouts, targetMeters) {
  let best = null; // { seconds, workout }
  workouts.forEach(w => {
    const s = w.stream;
    if (!s || !s.dist || !s.t || s.dist.length < 2) return;
    const dist = s.dist, t = s.t, n = dist.length;
    for (let i = 0; i < n; i++) {
      if (dist[i] == null) continue;
      for (let j = i + 1; j < n; j++) {
        if (dist[j] == null) continue;
        if (dist[j] - dist[i] >= targetMeters) {
          const prevDist = dist[j - 1] != null ? dist[j - 1] : dist[i];
          const prevT = t[j - 1] != null ? t[j - 1] : t[i];
          const segDist = dist[j] - prevDist;
          const frac = segDist > 0 ? (targetMeters - (prevDist - dist[i])) / segDist : 0;
          const tAtTarget = prevT + frac * (t[j] - prevT);
          const dtSeconds = tAtTarget - t[i];
          if (dtSeconds > 0 && (!best || dtSeconds < best.seconds)) best = { seconds: dtSeconds, workout: w };
          break;
        }
      }
    }
  });
  return best;
}

function bestBy(list, keyFn, {max = true} = {}) {
  let best = null;
  list.forEach(w => {
    const v = keyFn(w);
    if (v == null) return;
    if (!best || (max ? v > keyFn(best) : v < keyFn(best))) best = w;
  });
  return best;
}

