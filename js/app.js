// Einstiegspunkt: orchestriert renderAll() ueber alle Tabs und startet die App
// (muss als letztes <script> geladen werden, da hier alle init...()-Aufrufe passieren).

function renderAll() {
  renderMeta();
  const filtered = getFilteredData();
  renderStats(filtered);
  renderMonthComparison(); // nutzt immer die volle Historie (fester Kalendermonat-Vergleich, unabhängig vom Zeitraum-Filter)
  renderWeekly(filtered);
  renderDonut(filtered);
  renderPMC(); // nutzt immer die volle Historie
  renderACWR(); // nutzt immer die volle Historie (wie PMC)
  renderMonotony(); // nutzt immer die volle Historie (rollierendes 7-Tage-Fenster braucht Kontext davor)
  renderHR(filtered);
  renderHRZones(filtered);
  renderHrDistribution(filtered);
  renderTrainingFocus(filtered);
  renderPace(filtered);
  renderRecovery(); // Garmin-Erholungsdaten; blendet sich selbst aus, solange nichts synchronisiert wurde
  renderTable(filtered);
  renderCoachWorkoutsMini(filtered);
  renderRaceCountdown(); // Ist-Minuten dieser Woche hängen an den Trainings (volle Historie)
  renderCalendar(); // nutzt immer die volle Historie
  renderEquipmentBanner(); // Hinweis in Kalender + Übersicht, falls Equipment fällig ist
  renderRecords(); // nutzt immer die volle Historie
  renderNutrition(); // nutzt Trainingsplan/Ziel-Daten, nicht den Zeitraum-Filter oben
  renderAchievements(); // nutzt immer die volle Historie
  showAchievementToast(checkAndUnlockAchievements());
  checkAndShowBirthdayMessage();
}

/* ======================================================================
   5) "AKTUALISIEREN"-MENÜ: liest .fit-Dateien direkt im Browser ein
      (per Ordner-Scan ODER per Drag & Drop / Einzelauswahl)
   ====================================================================== */

// Prüft einmal beim Laden, ob für das Hauptevent-Ziel weniger als ~3 geplante
// Tage übrig sind (shouldAutoReplan, js/analytics/training-plan.js) und plant
// dann automatisch im Hintergrund nach (generateTrainingPlan, js/ai/ollama.js)
// - läuft nur einmal pro Sitzung, damit nicht bei jedem renderAll() (z.B.
// Zeitraum-Filter ändern) erneut eine Ollama-Anfrage ausgelöst wird.
function checkAutoReplan() {
  const goal = getPrimaryGoal();
  if (!goal || !shouldAutoReplan(goal)) return;
  // Ohne Trainingstage im Profil kann die KI ohnehin nichts sinnvoll planen -
  // dann lieber gar nicht erst automatisch anfragen (der manuelle Button im
  // Coach-Tab bleibt trotzdem nutzbar und zeigt bei Bedarf den echten Fehler).
  if (!Array.isArray(athleteProfile.trainingDays) || !athleteProfile.trainingDays.length) return;
  generateTrainingPlan(goal.id);
}

/* ======================================================================
   6) INIT
   ====================================================================== */
// Als async IIFE, weil alle Daten vom Server kommen (js/data/api-client.js):
// Ablage pro Person (Profil, Ziele, Plan, ...), Workouts und Gesundheitsdaten.
// renderAll() und alle init...() muessen darauf warten. Ohne Login geht es
// direkt zur Login-Seite. Scheitert das Laden, startet die App bewusst NICHT
// mit leerem Stand - das erste Speichern wuerde sonst die echten Daten auf
// dem Server ueberschreiben.
(async function initApp() {
  if (!requireLogin()) return;
  try {
    await Promise.all([loadUserStore(), loadPersistedWorkouts(), loadWellness()]);
  } catch (e) {
    showApiError(`Daten konnten nicht geladen werden (${e.message}). Bitte die Seite neu laden.`);
    return;
  }
  loadWorkoutNotes();
  loadWorkoutAnalysisCache();
  // Garmin-Waagedaten ins Gewichts-Log uebernehmen, bevor irgendetwas
  // gerendert wird - sonst zeigt die erste Darstellung noch das alte Gewicht.
  // Ergaenzt nur fehlende Tage, ueberschreibt keine manuellen Eintraege.
  if (typeof syncGarminWeightIntoLog === "function") syncGarminWeightIntoLog();
  initTopNav();
  initFilterBar();
  initCalendarControls();
  initCoach();
  initEquipment();
  initNutrition();
  loadAchievements();
  initInfoPopovers();
  initCardSearch();
  initAccount();
  renderAll();
  checkAutoReplan();
  // Automatische Risiko-Kontrolle (ACWR/TSB/Monotonie + Erholungs-Check) für
  // die naechsten 1-2 Tage - siehe js/components/risk-adjust.js. Wie
  // checkAutoReplan() bewusst nicht awaited (Rest der App soll nicht auf
  // eine evtl. KI-Anfrage warten) und läuft intern selbst nur einmal pro Tag.
  checkTrainingRiskAdjustment();
})();

