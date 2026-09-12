// Findet zu einem Workout vergleichbare frühere Einheiten (gleiche Sportart +
// ähnliche Distanz/Dauer, ±20%) und fasst die Abweichungen als kompakte
// Kennzahlen zusammen - reine Berechnung, keine KI. Grundlage für die
// KI-Auswertung je Training (siehe js/ai/context-builder.js), die diese Werte
// nur noch interpretiert statt sie selbst zu berechnen (siehe AI_RULES.md).

const COMPARISON_TOLERANCE = 0.2; // ±20% Distanz (oder Dauer, falls keine Distanz vorliegt)

const COMPARISON_MAX = 12; // mehr Vergleichswerte bringen dem Modell keinen Mehrwert, kosten nur Tokens/Tempo

function findComparableWorkouts(w, all) {
  // Bei Indoor-/virtuellen Radeinheiten BEWUSST über die Dauer statt über die
  // Distanz gruppieren: die virtuellen Kilometer hängen vom gewählten Kurs und
  // vom Windschatten-Modell der Plattform ab, die Dauer nicht. "60 Minuten
  // Rolle" ist die belastbare Vergleichsbasis, "34 virtuelle km" nicht.
  const indoorRide = isIndoorRide(w);
  const useDistance = w.distance_km != null && !indoorRide;
  const metric = useDistance ? "distance_km" : "duration_min";
  const target = w[metric];
  if (target == null) return [];
  const lo = target * (1 - COMPARISON_TOLERANCE), hi = target * (1 + COMPARISON_TOLERANCE);
  // Welche Einheit überhaupt in die Gruppe darf, entscheidet allein
  // sameComparisonGroup() in js/data/workouts.js - dort steckt die Trennung
  // nach Sportart, nach Becken/Freiwasser beim Schwimmen UND nach
  // Indoor/Outdoor beim Rad, damit alle Auswertungen dieselbe Definition nutzen.
  return all
    .filter(o => o.file !== w.file && !o.is_summary && o[metric] != null && sameComparisonGroup(w, o))
    .filter(o => o[metric] >= lo && o[metric] <= hi)
    .sort((a, b) => (b._date || 0) - (a._date || 0))
    .slice(0, COMPARISON_MAX);
}

// Ø-Werte über die Vergleichsgruppe (nur Felder, die tatsächlich vorhanden
// sind - fehlende Sensordaten werden nie als 0 mitgezählt).
function averageComparisonStat(comparable, key) {
  const vals = comparable.map(o => o[key]).filter(v => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Pace/Speed als vergleichbare Zahl (Sekunden je Kilometer bzw. km/h) statt
// als String, damit sich ein Ø berechnen lässt.
function paceOrSpeedSeconds(w) {
  if (w.pace_min_per_km) return paceToSeconds(w.pace_min_per_km);
  if (w.pace_min_per_100m) return paceToSeconds(w.pace_min_per_100m);
  return null;
}
