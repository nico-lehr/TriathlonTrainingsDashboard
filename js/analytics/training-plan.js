// Trainingsplan: rein deterministischer Teil (Periodisierungs-Phase,
// rollierendes Planungsfenster, Auto-Nachplan-Check). Die eigentlichen
// Workout-Vorschläge kommen von der KI (js/ai/plan-context-builder ist Teil
// von context-builder.js/prompts.js, Aufruf über generateTrainingPlan in
// ollama.js) - hier wird nur berechnet, WANN/WOFÜR geplant werden muss,
// nie WAS konkret trainiert wird (siehe AI_RULES: Berechnung vs. Interpretation).

// Trainingsphase für ein Event in `daysUntil` Tagen (ab heute) als
// { key, label }. Die Phasen selbst berechnet nur getPhase()
// (js/analytics/periodization.js); hier kommen zwei Fälle ohne Phase dazu:
// "unklar" (kein Zieldatum) und "nach-event" (Rennen samt Erholungswoche vorbei).
function computeTrainingPhase(daysUntil) {
  if (daysUntil == null) return { key: "unklar", label: "kein Zieldatum" };
  const key = getPhase(new Date(), periodRaceInDays(daysUntil));
  return key ? { key, label: PERIOD_PHASES[key].label } : { key: "nach-event", label: "nach dem Ziel-Event" };
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
    dates.push(localDateStr(new Date(start.getTime() + i * 86400000)));
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
