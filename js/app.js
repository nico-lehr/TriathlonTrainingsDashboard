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
  if (typeof renderInsightRatings === "function") renderInsightRatings(); // Bewertungen unter Fitness & Form, ACWR, Monotonie, Erholung (stat-detail.js)
  renderTable(filtered);
  renderCoachWorkoutsMini(filtered);
  renderRaceCountdown(); // Ist-Minuten dieser Woche hängen an den Trainings (volle Historie)
  renderCalendar(); // nutzt immer die volle Historie
  renderEquipmentBanner(); // Hinweis in Kalender + Übersicht, falls Equipment fällig ist
  renderRecords(); // nutzt immer die volle Historie
  renderNutrition(); // nutzt Trainingsplan/Ziel-Daten, nicht den Zeitraum-Filter oben
  renderAchievements(); // nutzt immer die volle Historie
  renderAnalysis(); // Analyse-Tab, nutzt immer die volle Historie
  showAchievementToast(checkAndUnlockAchievements());
  if (typeof shareNewAchievements === "function") shareNewAchievements(); // neue Abzeichen in die Gruppe (nur wer mitmacht)
  checkAndShowBirthdayMessage();
}

/* ======================================================================
   5) "AKTUALISIEREN"-MENÜ: liest .fit-Dateien direkt im Browser ein
      (per Ordner-Scan ODER per Drag & Drop / Einzelauswahl)
   ====================================================================== */

// Automatischer Nachschub für den Trainingsplan: mit Claude vorab als günstiger
// Sammelauftrag, sonst (lokale KI) wie bisher sofort - siehe js/ai/plan-batch.js.
// Läuft beim Start und danach nur, wenn die App wieder in den Vordergrund kommt
// oder ein Auftrag noch aussteht - nicht bei jedem renderAll().
function checkAutoReplan() {
  if (typeof initAutoPlan === "function") initAutoPlan();
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
  await loadEquipmentItems(); // nach der Ablage: übernimmt ggf. die alte Equipment-Liste daraus
  loadWorkoutNotes();
  loadWorkoutAnalysisCache();
  // Garmin-Waagedaten ins Gewichts-Log uebernehmen, bevor irgendetwas
  // gerendert wird - sonst zeigt die erste Darstellung noch das alte Gewicht.
  // Ergaenzt nur fehlende Tage, ueberschreibt keine manuellen Eintraege.
  // Profil und Gewichtsverlauf VORHER laden: sonst saehe die Uebernahme ein
  // leeres Standard-Profil und speicherte es ueber das echte (bis 2.4.26
  // gingen so beim Start Einstellungen verloren, sobald Garmin ein Gewicht lieferte).
  loadAthleteProfile();
  loadWeightLog();
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
  initSecuritySettings();
  initGarminSettings();
  if (typeof initGarminDatacheck === "function") initGarminDatacheck();
  initGarminPushSettings();
  initUpdates();
  initAiSettings();
  initTrainingProfile();
  initInvites();
  initGarminImport();
  initGarminMenu();
  initMobility();
  loadStrengthState();
  if (typeof loadCoachChats === "function") loadCoachChats();
  initWeatherSettings();
  initAnalysis();
  renderAll();
  initMApp();
  if (typeof initGroupUi === "function" && groupFeatureEnabled()) { initGroupUi(); initGroup(); }
  initSettingsHub();
  if (typeof initUsageTracking === "function") initUsageTracking();
  checkAutoReplan();
  // Täglicher Plan-Check (js/components/plan-check.js): heute/morgen passend
  // zur Verfassung, leere Trainingstage füllen, gestaffelt bis 4 Wochen voraus.
  // Ersetzt die frühere Risiko-Kontrolle (risk-adjust.js), die nur einen
  // Vorschlag zeigte - der Plan-Check ändert selbst und lässt sich rückgängig
  // machen. Nicht awaited: die App wartet nicht auf eine evtl. KI-Anfrage.
  // Events aus dem Garmin-Kalender als Ziele übernehmen (höchstens einmal am Tag,
  // js/data/garmin-events.js) - vor dem Plan-Check, der das Hauptevent braucht.
  // Garmin-Daten beim Öffnen leise im Hintergrund holen (js/components/garmin-settings.js)
  if (typeof initGarminAutoSync === "function") initGarminAutoSync();
  if (typeof initGarminEvents === "function") initGarminEvents();
  if (typeof syncGarminEvents === "function") syncGarminEvents().catch(() => {});
  if (typeof initPlanCheck === "function") initPlanCheck();
  if (typeof initWebPush === "function") initWebPush();
  if (typeof initMorningReport === "function") initMorningReport();
  else checkTrainingRiskAdjustment();
})();

