// Automatische Risiko-Kontrolle (UI-Teil) - Konzept: siehe CHANGE_REQUESTS.md.
//
// Ablauf, bewusst so gebaut, dass an fast allen Tagen KEINE KI-Anfrage
// anfällt:
//   1) Einmal pro Kalendertag (nicht bei jedem Neuladen) wird rein
//      deterministisch geprüft, ob ACWR/TSB/Trainingsmonotonie oder der
//      heutige Erholungs-Check kritisch sind (computeCurrentRiskStatus(),
//      js/analytics/risk-check.js) - reine Mathematik, keine KI.
//   2) Nur wenn das der Fall ist UND für heute/morgen tatsächlich eine
//      mittlere/harte Einheit geplant ist (an leichten Einheiten/Ruhetagen
//      gibt's nichts zu reduzieren), wird EINE kleine KI-Anfrage ausgelöst -
//      derselbe schlanke "Kürzere Variante"-Mechanismus wie beim manuellen
//      Button im Bearbeiten-Dialog (generatePlannedWorkoutAlternative,
//      js/ai/ollama.js), NIE eine komplette Wochenplanung.
//   3) Der Vorschlag wird NICHT automatisch gespeichert, sondern als Banner
//      im Coach-Tab angezeigt - Nico sieht Grund + Vorschlag und übernimmt
//      oder verwirft ihn bewusst selbst.
const RISK_CHECK_LAST_KEY = "riskCheckLastDate";

let riskAdjustState = { pw: null, suggestion: null, reasons: [], loading: false, error: null };

async function checkTrainingRiskAdjustment() {
  const todayKey = todayStr();
  if (localStorage.getItem(RISK_CHECK_LAST_KEY) === todayKey) return; // heute schon geprüft
  // Merken, BEVOR die Prüfung läuft - auch wenn unten etwas fehlschlägt oder
  // kein Ziel/Trainingsplan vorhanden ist, wird heute nicht erneut versucht
  // (morgen greift der Gate-Check automatisch wieder, RISK_CHECK_LAST_KEY
  // wechselt dann auf ein neues Datum).
  localStorage.setItem(RISK_CHECK_LAST_KEY, todayKey);

  const status = computeCurrentRiskStatus();
  if (!status || !status.critical.length) return; // alles im grünen Bereich - keine KI-Anfrage nötig

  const tomorrowKey = localDateStr(new Date(Date.now() + 86400000));
  const pw = plannedWorkouts.find(p =>
    (p.date === todayKey || p.date === tomorrowKey) &&
    p.status === "geplant" &&
    p.intensity && p.intensity !== "leicht"
  );
  if (!pw) return; // in den nächsten 1-2 Tagen nichts, das sich sinnvoll reduzieren ließe

  const goal = (pw.goalId && goals.find(g => g.id === pw.goalId)) || getPrimaryGoal();
  if (!goal) return; // "Kürzere Variante" braucht ein Ziel für den KI-Kontext, wie beim manuellen Button auch

  riskAdjustState = { pw, suggestion: null, reasons: status.critical.map(c => c.text), loading: true, error: null };
  if (typeof renderRiskAdjustBanner === "function") renderRiskAdjustBanner();

  try {
    riskAdjustState.suggestion = await generatePlannedWorkoutAlternative(pw, "shorter");
  } catch (e) {
    riskAdjustState.error = describeAiError(e, "plan");
  } finally {
    riskAdjustState.loading = false;
    if (typeof renderRiskAdjustBanner === "function") renderRiskAdjustBanner();
  }
}

function renderRiskAdjustBanner() {
  const el = document.getElementById("risk-adjust-banner");
  if (!el) return;
  const { pw, suggestion, reasons, loading, error } = riskAdjustState;
  if (!pw || (!loading && !suggestion && !error)) { el.hidden = true; return; }

  const dayLabel = pw.date === todayStr() ? "heute" : "morgen";
  el.hidden = false;
  el.innerHTML = `
    <div class="rab-icon">⚠️</div>
    <div class="rab-body">
      <div class="rab-title">Erhöhtes Risiko erkannt</div>
      <div class="rab-reasons">${reasons.map(r => escapeHtml(r)).join(" · ")}</div>
      ${loading ? `<p class="rab-loading">Prüfe Anpassung für ${dayLabel} (${escapeHtml(pw.sport)}) …</p>` : ""}
      ${error ? `<p class="goal-error">${escapeHtml(error)}</p>` : ""}
      ${suggestion ? `
        <p class="rab-suggestion">Vorschlag für ${dayLabel}: <b>${escapeHtml(suggestion.title || suggestion.sport)}</b>${suggestion.duration_min != null ? `, ${Math.round(suggestion.duration_min)} min` : ""} statt bisher ${pw.duration_min != null ? Math.round(pw.duration_min) + " min" : "geplant"}.</p>
      ` : ""}
    </div>
    <div class="rab-actions">
      ${suggestion ? `<button type="button" class="chip" id="rab-accept-btn">Übernehmen</button>` : ""}
      ${suggestion ? `<button type="button" class="chip" id="rab-review-btn">Im Dialog ansehen</button>` : ""}
      <button type="button" class="chip" id="rab-dismiss-btn">Verwerfen</button>
    </div>`;

  const acceptBtn = document.getElementById("rab-accept-btn");
  if (acceptBtn) acceptBtn.addEventListener("click", applyRiskAdjustSuggestion);
  const reviewBtn = document.getElementById("rab-review-btn");
  if (reviewBtn) reviewBtn.addEventListener("click", () => { openPlanEdit(pw.id); dismissRiskAdjustSuggestion(false); });
  document.getElementById("rab-dismiss-btn").addEventListener("click", () => dismissRiskAdjustSuggestion(true));
}

function applyRiskAdjustSuggestion() {
  const { pw, suggestion } = riskAdjustState;
  if (!pw || !suggestion) return;
  updatePlannedWorkout(pw.id, {
    sport: suggestion.sport || pw.sport,
    title: suggestion.title || pw.title,
    duration_min: suggestion.duration_min != null ? Number(suggestion.duration_min) : pw.duration_min,
    intensity: suggestion.intensity || pw.intensity,
    description: suggestion.description || pw.description,
    exercises: Array.isArray(suggestion.exercises) && suggestion.exercises.length ? suggestion.exercises : pw.exercises,
  });
  dismissRiskAdjustSuggestion(false);
  if (typeof renderCalendar === "function") renderCalendar();
  if (typeof renderTrainingPlanCard === "function") renderTrainingPlanCard();
}

function dismissRiskAdjustSuggestion(hide) {
  riskAdjustState = { pw: null, suggestion: null, reasons: [], loading: false, error: null };
  if (hide) renderRiskAdjustBanner();
}
