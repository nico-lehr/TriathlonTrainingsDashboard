// Training Effects Berechnung - basierend auf Herzfrequenz-Daten
// Ähnlich wie Garmin Connect Training Effects

function calculateTrainingEffects(workout, maxHR = 185) {
  // Input: workout object mit avg_hr, max_hr, duration_min
  // Output: training_effects object

  if (!workout.avg_hr || !workout.max_hr || !workout.duration_min) {
    return {
      aerobic: false,
      anaerobic: false,
      vo2max: false,
      threshold: false,
      recovery: false,
      total_score: 0
    };
  }

  const avgHRPercent = (workout.avg_hr / (workout.max_hr || maxHR)) * 100;
  const maxHRPercent = (workout.max_hr / maxHR) * 100;

  let effects = {
    aerobic: false,
    anaerobic: false,
    vo2max: false,
    threshold: false,
    recovery: false,
    total_score: 0
  };

  // Berechnung basierend auf Prozentsatz der Max HR
  if (avgHRPercent < 70) {
    // Easy/Recovery Training
    effects.recovery = true;
    effects.total_score = 1;
  } else if (avgHRPercent >= 70 && avgHRPercent < 80) {
    // Aerobic Base
    effects.aerobic = true;
    effects.total_score = 2;
  } else if (avgHRPercent >= 80 && avgHRPercent < 90) {
    // Aerobic + Threshold
    effects.aerobic = true;
    effects.threshold = true;
    effects.total_score = 3;
  } else if (avgHRPercent >= 90 && avgHRPercent < 100) {
    // Threshold Focus
    effects.threshold = true;
    effects.total_score = 3;
  } else if (avgHRPercent >= 100) {
    // VO2Max + Anaerobic
    effects.vo2max = true;
    effects.anaerobic = true;
    effects.total_score = 4;
  }

  // Bonus-Punkte für sehr lange Trainings (Ausdauer-Effekt)
  if (workout.duration_min > 90) {
    effects.aerobic = true;
    effects.total_score = Math.min(5, effects.total_score + 1);
  }

  // Cap auf 0-5
  effects.total_score = Math.min(5, Math.max(0, effects.total_score));

  return effects;
}

// Für mehrere Workouts berechnen
function calculateTrainingEffectsForAll(workouts, userMaxHR = 185) {
  return workouts.map(w => ({
    ...w,
    training_effects: calculateTrainingEffects(w, userMaxHR)
  }));
}

// Training Effects Label für UI
function getTrainingEffectLabel(effects) {
  const labels = [];
  if (effects.aerobic) labels.push('Grundlage');
  if (effects.threshold) labels.push('Schwelle');
  if (effects.vo2max) labels.push('VO2Max');
  if (effects.anaerobic) labels.push('Kraft');
  if (effects.recovery) labels.push('Recovery');

  return labels.length > 0 ? labels.join(' + ') : 'Keine';
}

// Score zu Text
function getTrainingEffectScore(score) {
  const scores = ['Keine', 'Leicht', 'Mittel', 'Hoch', 'Sehr Hoch', 'Maximum'];
  return scores[Math.round(score)] || 'Unbekannt';
}
