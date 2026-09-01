// Trainingsplan: rein deterministischer Teil (Periodisierungs-Phase,
// rollierendes Planungsfenster, Auto-Nachplan-Check). Die eigentlichen
// Workout-Vorschläge kommen von der KI (js/ai/plan-context-builder ist Teil
// von context-builder.js/prompts.js, Aufruf über generateTrainingPlan in
// ollama.js) - hier wird nur berechnet, WANN/WOFÜR geplant werden muss,
// nie WAS konkret trainiert wird (siehe AI_RULES: Berechnung vs. Interpretation).

// Grobe Trainings-Phasen nach Tagen bis zum Ziel-Event - dieselbe Idee wie
// der "Phase"-Faktor im Race-Readiness-Score (race-readiness.js), hier als
// eigenständiges Label für den KI-Kontext, da der Score dort etwas anders
// gewichtet (Punkte statt Klartext-Phase).
function computeTrainingPhase(daysUntil) {
  if (daysUntil == null) return { key: "unklar", label: "kein Zieldatum" };
  if (daysUntil < 0) return { key: "nach-event", label: "nach dem Ziel-Event" };
  if (daysUntil > 84) return { key: "grundlage", label: "Grundlagenausdauer (Basis)" };
  if (daysUntil > 28) return { key: "aufbau", label: "Aufbauphase" };
  if (daysUntil > 14) return { key: "spezifisch", label: "spezifische Vorbereitung" };
  if (daysUntil > 6) return { key: "taper-beginn", label: "beginnende Taper-Phase" };
  return { key: "taper-final", label: "finale Taper-Phase / Wettkampfwoche" };
}

// Nächste 7 Tage, die für ein Ziel noch KEINEN geplanten Eintrag haben -
// rollierendes Fenster statt die ganze Vorbereitungsphase auf einmal zu
// verplanen (Werte/Form ändern sich laufend, siehe AI_RULES).
function computePlanningWindow(goalId, days = 7) {
  const already = futurePlannedDatesForGoal(goalId);
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  let start = todayMid;
  if (already.length) {
    const lastPlanned = new Date(already[already.length - 1] + "T00:00:00");
    const next = new Date(lastPlanned.getTime() + 86400000);
    if (next > start) start = next;
  }
  const dates = [];
  for (let i = 0; i < days; i++) {
    dates.push(new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
  }
  return dates;
}

// Soll automatisch nachgeplant werden? - weniger als ~3 noch bevorstehende
// geplante Tage übrig, es gibt ein Hauptevent, und das Event liegt noch
// nicht in der Vergangenheit.
function shouldAutoReplan(goal) {
  if (!goal || !goal.date) return false;
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const eventDate = new Date(goal.date + "T00:00:00");
  if (eventDate < todayMid) return false;
  const remaining = futurePlannedDatesForGoal(goal.id).length;
  return remaining < 3;
}
