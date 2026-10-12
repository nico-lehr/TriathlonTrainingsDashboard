// Race Readiness Score: rein rechnerische (keine KI) Einschätzung, wie gut
// der Athlet aktuell auf ein bestimmtes Ziel-Event vorbereitet ist. Kombiniert
// vier Faktoren zu einem Score 0-100, siehe die einzelnen compute*-Funktionen
// unten für die Punktevergabe. Nur für Ziele mit Datum in der Zukunft sinnvoll.

const READINESS_MAX = { form: 30, acwr: 25, consistency: 25, phase: 20 };

function readinessLevel(score) {
  if (score >= 75) return { label: "gut vorbereitet", color: "var(--c-good)" };
  if (score >= 50) return { label: "auf gutem Weg", color: "var(--c-warn)" };
  return { label: "noch Verbesserungsbedarf", color: "var(--c-crit)" };
}

// Faktor 1: Form (TSB) - optimal fürs Rennen ist "frisch, aber nicht
// detrainiert" (TSB 5-25 nach gängiger Trainingssteuerungs-Heuristik).
function scoreFormFactor(tsb) {
  if (tsb == null) return { points: READINESS_MAX.form * 0.5, note: "keine Formdaten vorhanden" };
  let points, note;
  if (tsb >= 5 && tsb <= 25) { points = READINESS_MAX.form; note = "frisch"; }
  else if ((tsb >= -10 && tsb < 5) || (tsb > 25 && tsb <= 40)) { points = READINESS_MAX.form * 0.65; note = tsb < 5 ? "leicht müde" : "sehr frisch/wenig Reiz zuletzt"; }
  else { points = READINESS_MAX.form * 0.3; note = tsb < -10 ? "deutlich ermüdet" : "lange kein intensiver Reiz mehr"; }
  return { points, note: `TSB ${tsb >= 0 ? "+" : ""}${fmtNum(tsb, 1)} (${note})` };
}

// Faktor 2: Verletzungsrisiko (ACWR) - dieselben Bänder wie das ACWR-Gauge.
function scoreAcwrFactor(acwr) {
  if (acwr == null) return { points: READINESS_MAX.acwr * 0.4, note: "noch nicht genug Daten" };
  let points, note;
  if (acwr >= 0.8 && acwr <= 1.3) { points = READINESS_MAX.acwr; note = "optimal"; }
  else if (acwr > 1.5) { points = READINESS_MAX.acwr * 0.2; note = "hohes Verletzungsrisiko"; }
  else if (acwr > 1.3) { points = READINESS_MAX.acwr * 0.6; note = "erhöhtes Risiko"; }
  else { points = READINESS_MAX.acwr * 0.6; note = "Aufbauphase, noch wenig Belastung"; }
  return { points, note: `ACWR ${fmtNum(acwr, 2)} (${note})` };
}

// Faktor 3: Trainingskonstanz - tatsächlicher Umfang der letzten 4 Wochen vs.
// das im Athletenprofil hinterlegte Wochenziel (verfügbare Stunden/Woche).
function scoreConsistencyFactor() {
  if (!athleteProfile.weeklyHours) return { points: READINESS_MAX.consistency * 0.6, note: "kein Wochenziel im Profil hinterlegt" };
  const cutoff = new Date(Date.now() - 28 * 86400000);
  const recentMin = DATA.filter(w => w._date && w._date >= cutoff).reduce((s, w) => s + (w.duration_min || 0), 0);
  const targetMin = athleteProfile.weeklyHours * 4 * 60;
  const pct = targetMin > 0 ? Math.min(1.3, recentMin / targetMin) : 0;
  // Über 100% ist nicht "noch besser" (Übertraining/Verletzungsrisiko wird
  // schon über den ACWR-Faktor abgedeckt) - Punkte deckeln bei 100%.
  const points = READINESS_MAX.consistency * Math.min(1, pct);
  return { points, note: `${Math.round(pct * 100)}% der Zielumfänge der letzten 4 Wochen erreicht` };
}

// Faktor 4: Zeit bis zum Event / Taper-Phase - je näher das Event, desto
// mehr zählt eine steigende Form (TSB) statt weiterem Aufbau. Ob schon
// Taper ist und ob es die Rennwoche ist, entscheidet die Periodisierung
// (js/analytics/periodization.js).
function scorePhaseFactor(daysUntil, tsb) {
  if (daysUntil == null) return { points: READINESS_MAX.phase, note: "kein Datum" };
  const race = periodRaceInDays(daysUntil);
  if (getPhase(new Date(), race) !== "taper") return { points: READINESS_MAX.phase, note: `${daysUntil} Tage bis Event — noch keine Taper-Phase` };
  const raceWeek = periodWeeksToRace(new Date(), race) === 0;
  const weeksLabel = raceWeek ? "finale Taper-Phase" : "beginnende Taper-Phase";
  let points;
  if (raceWeek) points = tsb != null && tsb > 5 ? READINESS_MAX.phase : tsb != null && tsb > 0 ? READINESS_MAX.phase * 0.6 : READINESS_MAX.phase * 0.25;
  else points = tsb != null && tsb > -5 ? READINESS_MAX.phase : READINESS_MAX.phase * 0.5;
  return { points, note: `${daysUntil} Tage bis Event — ${weeksLabel}` };
}

// Gibt null zurück für Ziele ohne Datum oder mit Datum in der Vergangenheit
// (Readiness ist dann nicht mehr sinnvoll interpretierbar).
function computeRaceReadiness(goal) {
  if (!goal.date) return null;
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const eventDate = new Date(goal.date + "T00:00:00");
  const daysUntil = Math.round((eventDate - todayMid) / 86400000);
  if (daysUntil < 0) return null;

  const series = computeLoadSeries();
  const last = series && series.length ? series[series.length - 1] : null;
  const tsb = last ? last.tsb : null;
  const acwr = last && last.ctl > 0.5 ? last.atl / last.ctl : null;

  const form = scoreFormFactor(tsb);
  const acwrFactor = scoreAcwrFactor(acwr);
  const consistency = scoreConsistencyFactor();
  const phase = scorePhaseFactor(daysUntil, tsb);

  const score = Math.round(form.points + acwrFactor.points + consistency.points + phase.points);
  const level = readinessLevel(score);
  return {
    score, level, daysUntil,
    factors: [
      { label: "Form", note: form.note },
      { label: "Verletzungsrisiko", note: acwrFactor.note },
      { label: "Trainingskonstanz", note: consistency.note },
      { label: "Phase", note: phase.note },
    ],
  };
}
