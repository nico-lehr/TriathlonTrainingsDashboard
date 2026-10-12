// Coach-Tab: Onboarding-Assistent (inkl. Onboarding-Gate), Athletenprofil-Sync,
// Ziel-Liste, Ollama-Einstellungsmenue.

// Kurzüberblick ganz oben im Coach-Tab (in der Erholungs-Check-Karte, siehe
// index.html): fasst Form, Hauptevent-Fortschritt, Trainingsplan-Treue und
// nächste geplante Einheit in wenigen kompakten Chips zusammen - rein
// deterministisch aus bereits vorhandenen Analytics-Funktionen abgeleitet,
// keine zusätzliche KI-Anfrage nötig. Wird nach jeder Änderung an Zielen,
// Trainingsplan oder Erholungs-Check neu gerufen (siehe renderGoals(),
// renderTrainingPlanCard() und updateRecoveryBadge()).
function renderCoachSummary() {
  const host = document.getElementById("coach-summary-body");
  if (!host) return;
  // Die "Grundlage" der Empfehlungs-Karte hängt an denselben Daten (Form,
  // Plan, Erholung) - deshalb hier mit auffrischen, wie renderPerformanceSummary.
  if (typeof renderOutlook === "function") renderOutlook();
  if (typeof renderRaceCountdown === "function") renderRaceCountdown(); // Wettkampf-Countdown hängt an Ziel + Plan

  const chips = [];

  // Form (TSB) aus der Trainingsbelastung - dieselbe Berechnung/Einordnung
  // wie die PMC-Kachel in der Übersicht (tsbStatusLabel).
  const series = typeof computeLoadSeries === "function" ? computeLoadSeries() : null;
  if (series && series.length) {
    const last = series[series.length - 1];
    const status = tsbStatusLabel(last.tsb) || { text: "" };
    chips.push({ label: "Form", value: `${last.tsb >= 0 ? "+" : ""}${fmtNum(last.tsb, 1)}`, sub: status.text });
  }


  // Trainingsplan-Treue-Streak (dieselbe Logik wie die Streak-Kachel in der
  // Übersicht) - nur wenn Trainingstage im Profil hinterlegt sind.
  const streak = typeof computeAdherenceStreak === "function" ? computeAdherenceStreak() : null;
  if (streak) {
    chips.push({ label: "Streak", value: `🔥 ${streak.days} Tage`, sub: streak.atRisk ? "heute noch offen" : "eingehalten" });
  }

  // Hauptevent: Countdown + Race-Readiness-Score, falls eines als ★ markiert ist.
  const goal = typeof getPrimaryGoal === "function" ? getPrimaryGoal() : null;
  if (goal) {
    const eventDate = goal.date ? new Date(goal.date + "T00:00:00") : null;
    const days = eventDate ? Math.round((eventDate - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000) : null;
    const daysLabel = days == null ? "" : days > 0 ? `in ${days} Tagen` : days === 0 ? "heute" : `vor ${Math.abs(days)} Tagen`;
    const readiness = typeof computeRaceReadiness === "function" ? computeRaceReadiness(goal) : null;
    chips.push({
      label: "Hauptevent",
      value: escapeHtml(goal.name),
      sub: [daysLabel, readiness ? `Readiness ${readiness.score}/100` : null].filter(Boolean).join(" · "),
    });
  }

  // Nächste geplante Einheit für dieses Hauptevent (dieselbe Quelle wie die
  // Trainingsplan-Kachel weiter unten).
  if (goal && typeof plannedWorkoutsForGoal === "function") {
    const todayKey = todayStr();
    const upcoming = plannedWorkoutsForGoal(goal.id).filter(p => p.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date));
    if (upcoming.length) {
      const p = upcoming[0];
      const d = new Date(p.date + "T00:00:00");
      const dowShort = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
      chips.push({ label: "Nächstes Training", value: `${escapeHtml(p.sport)}`, sub: `${dowShort[d.getDay()]}, ${escapeHtml(p.title || "")}`.trim() });
    }
  }

  if (!chips.length) {
    host.innerHTML = `<p class="coach-summary-empty">Noch keine Daten für eine Zusammenfassung — trag unten dein Profil/Ziel ein und importiere ein paar Trainings.</p>`;
    return;
  }

  host.innerHTML = chips.map(c => `
    <div class="coach-summary-chip">
      <div class="csc-label">${escapeHtml(c.label)}</div>
      <div class="csc-value">${c.value}</div>
      ${c.sub ? `<div class="csc-sub">${escapeHtml(c.sub)}</div>` : ""}
    </div>`).join("");

  // Re-rendert nur die bestehende KI-Zusammenfassung (Text/Lade-/Fehlerzustand
  // bleiben erhalten, siehe performanceSummary in js/ai/ollama.js) - so muss
  // nicht jeder der Aufrufer von renderCoachSummary() zusätzlich daran denken.
  if (typeof renderPerformanceSummary === "function") renderPerformanceSummary();
}

// KI-Zusammenfassung "aktueller Leistungszustand" als kurzer Text (statt
// einer weiteren Zahlen-Kachel) - gleiches Muster (Button + Ergebnis/Fehler/
// Lade-Zustand) wie buildFocusInsightHtml (js/components/dashboard.js), aber
// im Coach-Tab neben renderCoachSummary() (siehe performanceSummary, js/ai/ollama.js).
function buildPerformanceSummaryHtml() {
  const btnLabel = performanceSummary.loading ? "Analysiere …" : (performanceSummary.text ? "Neu zusammenfassen" : "KI-Zusammenfassung abrufen");
  return `
    <label>KI-Zusammenfassung <span class="wd-analysis-hint">Kurze Einordnung deines aktuellen Leistungszustands in Worten</span></label>
    <div class="goal-actions">
      <button type="button" class="chip" id="perf-summary-btn" ${performanceSummary.loading ? "disabled" : ""}>${btnLabel}</button>
      ${performanceSummary.at ? `<span class="goal-rec-date">Stand: ${fmtDateFull(new Date(performanceSummary.at))}</span>` : ""}
    </div>
    ${performanceSummary.error ? `<p class="goal-error">${escapeHtml(performanceSummary.error)}</p>` : ""}
    ${performanceSummary.text ? `<div class="goal-recommendation">${formatRecommendation(performanceSummary.text)}</div>` : ""}`;
}

function renderPerformanceSummary() {
  const host = document.getElementById("perf-summary-block");
  if (!host) return;
  host.innerHTML = buildPerformanceSummaryHtml();
  const btn = document.getElementById("perf-summary-btn");
  if (btn) btn.addEventListener("click", () => generatePerformanceSummary());
}

// Empfehlungen "Heute / Diese Woche / Nächste Woche" (eigene Karte im
// Coach-Tab) - gleiches Muster wie buildPerformanceSummaryHtml (Button +
// Ergebnis/Fehler/Lade-Zustand, outlook in js/ai/ollama.js). Unter jeder
// Empfehlung stehen die Fakten, aus denen sie entstanden ist
// (buildOutlookFacts) - vor dem ersten Abruf die aktuellen.
function renderOutlook() {
  const host = document.getElementById("coach-outlook-body");
  if (!host) return;
  const r = outlook.result;
  const facts = (r && outlook.facts) || buildOutlookFacts();
  const btnLabel = outlook.loading ? "Analysiere …" : (r ? "Neu einschätzen" : "Empfehlungen abrufen");
  host.innerHTML = `
    <div class="goal-actions">
      <button type="button" class="chip" id="coach-outlook-btn" ${outlook.loading ? "disabled" : ""}>${btnLabel}</button>
      ${outlook.at ? `<span class="goal-rec-date">Stand: ${fmtDateFull(new Date(outlook.at))}</span>` : ""}
    </div>
    ${outlook.error ? `<p class="goal-error">${escapeHtml(outlook.error)}</p>` : ""}
    <div class="outlook-grid">
      ${OUTLOOK_HORIZONS.map(h => {
        const item = r && r[h.key];
        return `
        <div class="outlook-item">
          <h3 class="outlook-title">${h.label}</h3>
          ${item && item.empfehlung ? `<p class="outlook-text">${escapeHtml(item.empfehlung)}</p>` : ""}
          ${item && item.begruendung ? `<p class="outlook-reason"><b>Warum:</b> ${escapeHtml(item.begruendung)}</p>` : ""}
          <p class="workouts-columns-title outlook-facts-title">Grundlage</p>
          <ul class="outlook-facts">${facts[h.facts].map(f => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
        </div>`;
      }).join("")}
    </div>`;
  host.querySelector("#coach-outlook-btn").addEventListener("click", () => generateOutlook());
}

// Minimalistische Karten: pro Ziel nur Name/Datum/Countdown + kompakte
// Readiness-Pille auf den ersten Blick sichtbar. Alles Schwergewichtige
// (Notizen, ausführliche Readiness-Faktoren, KI-Empfehlung) steckt hinter
// einem Auf-/Zuklapp-Pfeil, damit die Kachel bei mehreren Zielen nicht
// überladen wirkt. `_detailsOpen` ist bewusst transient (siehe saveGoals()
// in js/data/goals.js, das dieses Feld beim Speichern rausfiltert) - Zustand
// gilt nur für die laufende Sitzung, defaultet auf "offen", sobald bereits
// eine Empfehlung vorliegt (die will man ja direkt sehen).
// "Erweiterte Einstellungen" je Ziel (Priorität, Streckenprofil, Strategie-
// Notiz, siehe js/data/goals.js) - standardmäßig eingeklappt (_advOpen
// transient, wie _detailsOpen), damit die Zielkarte für die meisten Nutzer
// (die diese optionalen Felder nicht brauchen) kompakt bleibt.
function buildGoalAdvancedHtml(goal) {
  const open = !!goal._advOpen;
  return `
    <div class="goal-adv">
      <button type="button" class="chip goal-adv-toggle-btn" data-id="${goal.id}">${open ? "Erweiterte Einstellungen ausblenden" : "Erweiterte Einstellungen"}</button>
      <div class="goal-adv-body${open ? "" : " collapsed"}">
        <div class="goal-form-row">
          <label for="goal-adv-priority-${goal.id}">Priorität</label>
          <select id="goal-adv-priority-${goal.id}" class="coach-input goal-adv-priority" data-id="${goal.id}">
            <option value="">– keine –</option>
            <option value="A"${goal.priority === "A" ? " selected" : ""}>A – Hauptrennen</option>
            <option value="B"${goal.priority === "B" ? " selected" : ""}>B – Nebenziel</option>
            <option value="C"${goal.priority === "C" ? " selected" : ""}>C – Trainingswettkampf</option>
          </select>
        </div>
        <div class="goal-form-row">
          <label for="goal-adv-elevation-${goal.id}">Höhenmeter der Strecke</label>
          <div class="goal-adv-elevation-row">
            <input type="number" id="goal-adv-elevation-${goal.id}" class="coach-input goal-adv-elevation" data-id="${goal.id}" min="0" step="1" value="${goal.courseElevationM != null ? goal.courseElevationM : ""}" placeholder="z.B. 1200">
            <button type="button" class="chip goal-adv-gpx-btn" data-id="${goal.id}">GPX hochladen</button>
            <input type="file" accept=".gpx" class="goal-adv-gpx-input" data-id="${goal.id}" hidden>
          </div>
          ${goal.courseProfileLabel ? `<p class="card-sub" style="margin:4px 0 0;">${escapeHtml(goal.courseProfileLabel)}</p>` : ""}
          ${goal._gpxError ? `<p class="goal-error">${escapeHtml(goal._gpxError)}</p>` : ""}
        </div>
        <div class="goal-form-row goal-form-row-wide">
          <label for="goal-adv-strategy-${goal.id}">Strategie-Notiz</label>
          <textarea id="goal-adv-strategy-${goal.id}" class="coach-input goal-adv-strategy" data-id="${goal.id}" maxlength="500" placeholder="z.B. Pacing, Verpflegung, Renneinteilung">${escapeHtml(goal.strategyNote || "")}</textarea>
          <button type="button" class="chip goal-adv-strategy-save-btn" data-id="${goal.id}" style="margin-top:6px;">Notiz speichern</button>
        </div>
      </div>
    </div>`;
}

// Ganze "Deine Ziele"-Karte ein-/ausklappbar: im Coach-Tab steht darüber schon
// die kompakte Kurzübersicht (renderCoachSummary) und darunter der Trainingsplan
// mit KI-Text - mit mehreren Zielen (jedes mit Notizen/Readiness/KI-Empfehlung)
// nimmt die Ziele-Liste dann trotzdem noch zu viel Platz auf einen Blick ein.
// Eingeklappt bleibt nur ein kleiner Block mit den wichtigsten Infos zum
// Hauptevent sichtbar (Name, Countdown, Readiness) statt der vollen Liste.
// Zustand wird gemerkt (localStorage), damit er nach einem Reload erhalten bleibt.
const GOALS_CARD_COLLAPSE_KEY = "goalsCardCollapsed";
let goalsCardCollapsed = localStorage.getItem(GOALS_CARD_COLLAPSE_KEY) === "1";

function initGoalsCardCollapse() {
  const btn = document.getElementById("goals-collapse-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    goalsCardCollapsed = !goalsCardCollapsed;
    localStorage.setItem(GOALS_CARD_COLLAPSE_KEY, goalsCardCollapsed ? "1" : "0");
    applyGoalsCardCollapseState();
  });
  applyGoalsCardCollapseState();
}

function applyGoalsCardCollapseState() {
  const btn = document.getElementById("goals-collapse-btn");
  const list = document.getElementById("goals-list");
  const mini = document.getElementById("goals-mini-summary");
  if (!btn || !list || !mini) return;
  btn.textContent = goalsCardCollapsed ? "▸" : "▾";
  btn.title = goalsCardCollapsed ? "Ziele-Liste einblenden" : "Ziele-Liste ausblenden";
  list.hidden = goalsCardCollapsed;
  mini.hidden = !goalsCardCollapsed;
  if (goalsCardCollapsed) renderGoalsMiniSummary();
}

// Kleiner Block für den eingeklappten Zustand: nur Hauptevent (★) mit
// Countdown + Readiness-Score, sonst nur die Anzahl der Ziele - bewusst
// deterministisch (keine KI-Anfrage), dieselbe Quelle wie renderCoachSummary().
function renderGoalsMiniSummary() {
  const mini = document.getElementById("goals-mini-summary");
  if (!mini) return;
  if (!goals.length) {
    mini.innerHTML = `<p class="empty-note" style="margin:0;">Noch keine Ziele eingetragen.</p>`;
    return;
  }
  const goal = typeof getPrimaryGoal === "function" ? getPrimaryGoal() : null;
  if (!goal) {
    mini.innerHTML = `<p class="empty-note" style="margin:0;">${goals.length} Ziel${goals.length === 1 ? "" : "e"} eingetragen — kein Hauptevent (★) markiert.</p>`;
    return;
  }
  const eventDate = goal.date ? new Date(goal.date + "T00:00:00") : null;
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const days = eventDate ? Math.round((eventDate - todayMid) / 86400000) : null;
  const daysLabel = days == null ? "" : days > 0 ? `in ${days} Tagen` : days === 0 ? "heute" : `vor ${Math.abs(days)} Tagen`;
  const readiness = typeof computeRaceReadiness === "function" ? computeRaceReadiness(goal) : null;
  mini.innerHTML = `
    <div class="goals-mini-row">
      <span class="sport-dot" style="background:${sportColor(goal.sport)}"></span>
      <span class="goal-name">★ ${escapeHtml(goal.name)}</span>
      ${daysLabel ? `<span class="goals-mini-sub">${daysLabel}</span>` : ""}
      ${readiness ? `<span class="goal-readiness-pill" style="color:${readiness.level.color}" title="Race Readiness — ${escapeHtml(readiness.level.label)}">${readiness.score}</span>` : ""}
      ${goals.length > 1 ? `<span class="goals-mini-sub">+${goals.length - 1} weitere${goals.length - 1 === 1 ? "s" : ""} Ziel${goals.length - 1 === 1 ? "" : "e"}</span>` : ""}
    </div>`;
}

function renderGoals() {
  const el = document.getElementById("goals-list");
  if (!goals.length) {
    el.innerHTML = "<p class='empty-note'>Noch keine Ziele eingetragen — klicke oben auf „+ Neues Ziel/Event“.</p>";
    renderCoachSummary();
    applyGoalsCardCollapseState();
    return;
  }
  const sorted = [...goals].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);

  el.innerHTML = sorted.map(goal => {
    const eventDate = goal.date ? new Date(goal.date + "T00:00:00") : null;
    const days = eventDate ? Math.round((eventDate - todayMid) / 86400000) : null;
    const daysLabel = days == null ? "" : days > 0 ? `in ${days} Tagen` : days === 0 ? "heute" : `vor ${Math.abs(days)} Tagen`;
    const metaBits = [];
    if (goal.distanceKm) metaBits.push(`${fmtNum(goal.distanceKm, 1)} km`);
    if (goal.targetTime) metaBits.push(`Zielzeit ${escapeHtml(goal.targetTime)}`);
    const btnLabel = goal._loading ? "Generiere …" : (goal.recommendation ? "Neu generieren" : "Empfehlung generieren");
    const subDisciplinesHtml = (goal.subDisciplines && goal.subDisciplines.length) ? `
        <div class="goal-subdiscipline-list">
          ${goal.subDisciplines.map(s => `<span class="goal-subdiscipline-tag">${escapeHtml(s.label)}${s.distanceKm ? " " + fmtNum(s.distanceKm, 1) + " km" : ""}${s.targetTime ? " · " + escapeHtml(s.targetTime) : ""}</span>`).join("")}
        </div>` : "";
    const readiness = computeRaceReadiness(goal);
    const readinessBadgeHtml = readiness ? `
        <span class="goal-readiness-pill" style="color:${readiness.level.color}" title="Race Readiness — ${escapeHtml(readiness.level.label)}">${readiness.score}</span>` : "";
    const readinessDetailHtml = readiness ? `
        <div class="goal-readiness">
          <div class="goal-readiness-head">
            <span class="goal-readiness-score" style="color:${readiness.level.color}">${readiness.score}<span class="goal-readiness-max">/100</span></span>
            <span class="goal-readiness-label">Race Readiness — ${readiness.level.label}</span>
          </div>
          <ul class="goal-readiness-factors">
            ${readiness.factors.map(f => `<li><b>${escapeHtml(f.label)}:</b> ${escapeHtml(f.note)}</li>`).join("")}
          </ul>
        </div>` : "";
    const isOpen = goal._detailsOpen != null ? goal._detailsOpen : false; // Standardmäßig eingeklappt
    return `
      <div class="goal-card chart-enter${goal.isPrimary ? " goal-card-primary" : ""}">
        <div class="goal-head">
          <div class="goal-head-left">
            <button class="goal-primary-star${goal.isPrimary ? " active" : ""}" title="${goal.isPrimary ? "Hauptevent" : "Als Hauptevent für den Trainingsplan markieren"}" data-id="${goal.id}" type="button">★</button>
            <span class="sport-dot" style="background:${sportColor(goal.sport)}"></span><span class="goal-name">${escapeHtml(goal.name)}</span>
            ${goal.priority ? `<span class="goal-priority-badge goal-priority-${goal.priority}" title="${goal.priority}-Rennen">${goal.priority}</span>` : ""}
          </div>
          <div class="goal-head-right">
            ${readinessBadgeHtml}
            <button class="goal-expand-btn${isOpen ? " open" : ""}" title="${isOpen ? "Details ausblenden" : "Details anzeigen"}" data-id="${goal.id}" type="button">⌄</button>
            <button class="goal-delete" title="Ziel löschen" data-id="${goal.id}">✕</button>
          </div>
        </div>
        <div class="goal-meta">${eventDate ? fmtDateFull(eventDate) : ""}${daysLabel ? " · " + daysLabel : ""}${metaBits.length ? " · " + metaBits.join(" · ") : ""}</div>
        ${subDisciplinesHtml}
        <div class="goal-details${isOpen ? "" : " collapsed"}">
          ${goal.notes ? `<div class="goal-notes">${escapeHtml(goal.notes)}</div>` : ""}
          ${readinessDetailHtml}
          ${buildGoalAdvancedHtml(goal)}
          ${buildRacePlanHtml(goal)}
          <div class="goal-actions">
            <button class="chip goal-generate-btn" data-id="${goal.id}" ${goal._loading ? "disabled" : ""}>${btnLabel}</button>
            ${goal.recommendationAt ? `<span class="goal-rec-date">Stand: ${fmtDateFull(new Date(goal.recommendationAt))}</span>` : ""}
          </div>
          ${goal._error ? `<p class="goal-error">${escapeHtml(goal._error)}</p>` : ""}
          ${goal.recommendation ? `<div class="goal-recommendation">${formatRecommendation(goal.recommendation)}</div>` : ""}
        </div>
      </div>
    `;
  }).join("");

  el.querySelectorAll(".goal-delete").forEach(btn => btn.addEventListener("click", async () => {
    const goal = goals.find(g => g.id === btn.dataset.id);
    const label = goal ? `„${goal.name}“` : "dieses Ziel";
    const ok = (typeof confirmDialog === "function")
      ? await confirmDialog(`${label} wirklich löschen? Das kann nicht rückgängig gemacht werden.`)
      : window.confirm(`${label} wirklich löschen?`);
    if (ok) deleteGoal(btn.dataset.id);
  }));
  el.querySelectorAll(".goal-generate-btn").forEach(btn => btn.addEventListener("click", () => generateRecommendation(btn.dataset.id)));
  el.querySelectorAll(".goal-primary-star").forEach(btn => btn.addEventListener("click", () => setGoalPrimary(btn.dataset.id)));
  el.querySelectorAll(".goal-expand-btn").forEach(btn => btn.addEventListener("click", () => {
    const goal = goals.find(g => g.id === btn.dataset.id);
    if (!goal) return;
    const currentlyOpen = goal._detailsOpen != null ? goal._detailsOpen : !!goal.recommendation;
    goal._detailsOpen = !currentlyOpen;
    renderGoals();
  }));
  el.querySelectorAll(".goal-adv-toggle-btn").forEach(btn => btn.addEventListener("click", () => {
    const goal = goals.find(g => g.id === btn.dataset.id);
    if (!goal) return;
    goal._advOpen = !goal._advOpen;
    renderGoals();
  }));
  el.querySelectorAll(".goal-adv-priority").forEach(sel => sel.addEventListener("change", () => setGoalPriority(sel.dataset.id, sel.value)));
  el.querySelectorAll(".goal-adv-elevation").forEach(input => input.addEventListener("change", () => setGoalCourseElevation(input.dataset.id, input.value, "manual", null)));
  el.querySelectorAll(".goal-adv-strategy-save-btn").forEach(btn => btn.addEventListener("click", () => {
    const textarea = document.getElementById(`goal-adv-strategy-${btn.dataset.id}`);
    if (textarea) setGoalStrategyNote(btn.dataset.id, textarea.value);
  }));
  el.querySelectorAll(".goal-adv-gpx-btn").forEach(btn => btn.addEventListener("click", () => {
    const fileInput = el.querySelector(`.goal-adv-gpx-input[data-id="${btn.dataset.id}"]`);
    if (fileInput) fileInput.click();
  }));
  el.querySelectorAll(".goal-adv-gpx-input").forEach(input => input.addEventListener("change", async () => {
    const id = input.dataset.id;
    const goal = goals.find(g => g.id === id);
    const file = input.files && input.files[0];
    if (!goal || !file) return;
    try {
      const text = await file.text();
      const profile = parseGpxElevation(text);
      if (!profile) {
        goal._gpxError = "Konnte aus dieser GPX-Datei kein Höhenprofil lesen (keine Höhendaten in den Trackpunkten gefunden).";
        renderGoals();
        return;
      }
      goal._gpxError = null;
      setGoalCourseElevation(id, profile.ascentM, "gpx", gpxProfileLabel(profile));
    } catch (e) {
      goal._gpxError = "GPX-Datei konnte nicht gelesen werden.";
      renderGoals();
    }
  }));
  wireRacePlan(el);

  renderCoachSummary();
  applyGoalsCardCollapseState();
}

/* ----------------------------------------------------------------------
   Onboarding-Wizard: fragt in 5 kurzen Schritten die wichtigsten Angaben
   für Profil + Ziel ab, statt die Formulare einzeln ausfüllen zu müssen.
   Sammelt alles zunächst nur im Speicher (onbState) und schreibt erst bei
   "Fertig" in athleteProfile/goals + localStorage.
   ---------------------------------------------------------------------- */

const ONB_STEPS = 7;

let onbStep = 0;

let onbState = {};


function resetOnbState() {
  onbState = {
    name: athleteProfile.name || "",
    gender: athleteProfile.gender || "",
    birthDate: athleteProfile.birthDate || "",
    experienceLevel: athleteProfile.experienceLevel || null,
    raceExperience: athleteProfile.raceExperience || null,
    strongDiscipline: athleteProfile.strongDiscipline || "",
    weakDiscipline: athleteProfile.weakDiscipline || "",
    trainingDays: [...(athleteProfile.trainingDays || [])],
    swimDays: [...(athleteProfile.swimDays || [])],
    longDays: [...(athleteProfile.longDays || [])],
    typicalSessionMin: athleteProfile.typicalSessionMin || "",
    weeklyHours: athleteProfile.weeklyHours || "",
    ftpWatts: athleteProfile.ftpWatts || "",
    runThresholdPace: athleteProfile.runThresholdPace || "",
    swimCss: athleteProfile.swimCss || "",
    maxHr: athleteProfile.maxHr || "",
    restingHr: athleteProfile.restingHr || "",
    weightKg: athleteProfile.weightKg || "",
    limitations: athleteProfile.limitations || "",
    includeStrength: athleteProfile.includeStrength || false,
    includeMobility: athleteProfile.includeMobility || false,
    goalName: "", goalSport: "Triathlon", goalDate: "", goalTime: "", goalDistance: "", goalNotes: "",
    goalIsPrimary: true,
  };
}


function onbRadioChips(name, options, selected) {
  return `<div class="onb-radio-group" data-field="${name}">` +
    options.map(([val, label]) => `<button type="button" class="onb-radio-chip${selected === val ? " selected" : ""}" data-value="${val}">${label}</button>`).join("") +
    `</div>`;
}

// Wochentag-Auswahl für Schritt "Verfügbarkeit": erst wählt man die
// generellen Trainingstage, danach lassen sich Schwimmtag (einzeln) und
// lange Einheit(en) (mehrfach) NUR unter den bereits gewählten Tagen
// festlegen - logisch konsistent, kein Tag kann Schwimmtag sein, an dem
// gar nicht trainiert wird.

function renderWeekdayGroup(containerId, selected, allowedDays, variantClass) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const isMulti = Array.isArray(selected);
  el.innerHTML = WEEKDAYS.map(([val, label]) => {
    const isSel = isMulti ? selected.includes(val) : selected === val;
    const isAllowed = !allowedDays || allowedDays.includes(val);
    const cls = ["onb-weekday-chip"];
    if (isSel) cls.push("selected", variantClass || "");
    return `<button type="button" class="${cls.join(" ").trim()}" data-value="${val}"${isAllowed ? "" : " disabled"}>${label}</button>`;
  }).join("");
}

function renderOnbAvailabilityPickers() {
  const days = onbState.trainingDays || [];
  renderWeekdayGroup("onb-training-days", days, null, null);
  renderWeekdayGroup("onb-swim-day", onbState.swimDays || [], days, "selected-swim");
  renderWeekdayGroup("onb-long-days", onbState.longDays || [], days, "selected-long");
  document.querySelectorAll("#onb-training-days .onb-weekday-chip").forEach(btn => {
    btn.onclick = () => {
      const day = btn.dataset.value;
      const set = onbState.trainingDays || (onbState.trainingDays = []);
      const idx = set.indexOf(day);
      if (idx >= 0) set.splice(idx, 1); else set.push(day);
      // Tag rausgenommen -> Schwimmtag/lange Einheiten dort bereinigen
      onbState.swimDays = (onbState.swimDays || []).filter(d => set.includes(d));
      onbState.longDays = (onbState.longDays || []).filter(d => set.includes(d));
      renderOnbAvailabilityPickers();
    };
  });
  document.querySelectorAll("#onb-swim-day .onb-weekday-chip").forEach(btn => {
    btn.onclick = () => {
      if (btn.disabled) return;
      const day = btn.dataset.value;
      const set = onbState.swimDays || (onbState.swimDays = []);
      const idx = set.indexOf(day);
      if (idx >= 0) set.splice(idx, 1); else set.push(day);
      renderOnbAvailabilityPickers();
    };
  });
  document.querySelectorAll("#onb-long-days .onb-weekday-chip").forEach(btn => {
    btn.onclick = () => {
      if (btn.disabled) return;
      const day = btn.dataset.value;
      const set = onbState.longDays || (onbState.longDays = []);
      const idx = set.indexOf(day);
      if (idx >= 0) set.splice(idx, 1); else set.push(day);
      renderOnbAvailabilityPickers();
    };
  });
}


const ONB_RACE_EXP_LABELS = { none: "Noch keine Wettkämpfe", few: "1–3 Rennen", some: "4–10 Rennen", many: "10+ Rennen" };

function buildOnbSummary() {
  const lines = [];
  const personalBits = [];
  if (onbState.name) personalBits.push(onbState.name);
  if (onbState.birthDate) personalBits.push(`geb. ${onbState.birthDate}`);
  if (personalBits.length) lines.push(`<div>Person: <b>${escapeHtml(personalBits.join(" · "))}</b></div>`);
  const expLabel = ONB_EXP_LABELS[onbState.experienceLevel];
  const introBits = [];
  if (expLabel) introBits.push(expLabel);
  const onbAge = getAthleteAgeFromBirthDate(onbState.birthDate);
  if (onbAge != null) introBits.push(`${onbAge} Jahre`);
  if (ONB_RACE_EXP_LABELS[onbState.raceExperience]) introBits.push(ONB_RACE_EXP_LABELS[onbState.raceExperience]);
  if (introBits.length) lines.push(`<div>Erfahrung: <b>${escapeHtml(introBits.join(" · "))}</b></div>`);
  if (onbState.strongDiscipline || onbState.weakDiscipline) {
    lines.push(`<div>Stärke: <b>${onbState.strongDiscipline || "–"}</b> · Schwäche: <b>${onbState.weakDiscipline || "–"}</b></div>`);
  }
  const days = onbState.trainingDays || [];
  if (days.length || onbState.weeklyHours) {
    const dayLabels = days.map(d => WEEKDAY_LABELS[d]).join(", ") || "–";
    lines.push(`<div>Trainingstage: <b>${escapeHtml(dayLabels)}</b>${onbState.weeklyHours ? ` · <b>${onbState.weeklyHours} h</b>/Woche` : ""}</div>`);
  }
  const refineBits = [];
  if ((onbState.swimDays || []).length) refineBits.push(`Schwimmen ${onbState.swimDays.map(d => WEEKDAY_LABELS[d]).join("+")}`);
  if ((onbState.longDays || []).length) refineBits.push(`Lange Einheit ${onbState.longDays.map(d => WEEKDAY_LABELS[d]).join("+")}`);
  if (onbState.typicalSessionMin) refineBits.push(`~${onbState.typicalSessionMin} Min./Einheit`);
  if (refineBits.length) lines.push(`<div>Details: <b>${escapeHtml(refineBits.join(" · "))}</b></div>`);
  const perf = [];
  if (onbState.ftpWatts) perf.push(`FTP ${onbState.ftpWatts}W`);
  if (onbState.runThresholdPace) perf.push(`Lauf ${onbState.runThresholdPace}/km`);
  if (onbState.swimCss) perf.push(`Schwimmen ${onbState.swimCss}/100m`);
  if (onbState.maxHr) perf.push(`Max-HF ${onbState.maxHr}`);
  if (onbState.restingHr) perf.push(`Ruhe-HF ${onbState.restingHr}`);
  if (onbState.weightKg) perf.push(`${onbState.weightKg}kg`);
  if (perf.length) lines.push(`<div>Leistungswerte: <b>${escapeHtml(perf.join(", "))}</b></div>`);
  if (onbState.limitations) lines.push(`<div>Einschränkungen: <b>${escapeHtml(onbState.limitations)}</b></div>`);
  const planBits = [];
  if (onbState.includeStrength) planBits.push("Krafttraining");
  if (onbState.includeMobility) planBits.push("Mobility");
  lines.push(`<div>Trainingsplan: <b>Schwimmen/Rad/Laufen${planBits.length ? " + " + planBits.join(" + ") : ""}</b></div>`);
  if (onbState.goalName && onbState.goalDate) {
    lines.push(`<div>Ziel: <b>${escapeHtml(onbState.goalName)}</b> (${escapeHtml(onbState.goalSport)}) am <b>${escapeHtml(onbState.goalDate)}</b>${onbState.goalIsPrimary ? " · ★ Hauptevent" : ""}</div>`);
  } else {
    lines.push(`<div class="onb-summary-empty">Kein Ziel eingetragen — kannst du später im Formular unten nachholen.</div>`);
  }
  return lines.join("");
}


function renderOnbStep() {
  const barEl = document.getElementById("onb-progress-bar");
  document.getElementById("onb-progress-label").textContent = `Schritt ${onbStep + 1} von ${ONB_STEPS}`;
  barEl.innerHTML = Array.from({ length: ONB_STEPS }, (_, i) => `<div class="onb-progress-seg${i <= onbStep ? " done" : ""}"></div>`).join("");

  let html = "";
  if (onbStep === 0) {
    html = `<div class="onb-step">
      <div class="onb-brand">🏊🚴🏃 <span class="gradient-text">Trainings-Dashboard</span></div>
      <h3>Willkommen!</h3>
      <p class="onb-sub">Ein paar Angaben zum Start, damit dein Coach von Anfang an konkrete, auf dich zugeschnittene Empfehlungen geben kann - alles optional und jederzeit unter ⚙️ Einstellungen änderbar.</p>
      <div class="onb-field"><label for="onb-name">Name</label><input type="text" id="onb-name" class="coach-input" placeholder="z.B. Nico"></div>
      <div class="onb-row">
        <div class="onb-field"><label for="onb-gender">Geschlecht</label>
          <select id="onb-gender" class="coach-input">
            <option value="">– keine Angabe –</option>
            <option value="m">männlich</option>
            <option value="w">weiblich</option>
            <option value="divers">divers</option>
          </select>
        </div>
        <div class="onb-field"><label for="onb-birthdate">Geburtsdatum</label><input type="date" id="onb-birthdate" class="coach-input"></div>
      </div>
    </div>`;
  } else if (onbStep === 1) {
    html = `<div class="onb-step">
      <h3>Über dich</h3>
      <p class="onb-sub">Hilft dem Coach, den Trainingsplan realistisch zu gestalten.</p>
      <div class="onb-field">
        <label>Wie lange trainierst du schon für Ausdauersport/Triathlon?</label>
        ${onbRadioChips("experienceLevel", [["<1", "< 1 Jahr"], ["1-3", "1–3 Jahre"], [">3", "> 3 Jahre"]], onbState.experienceLevel)}
      </div>
      <div class="onb-field">
        <label>Wettkampferfahrung</label>
        ${onbRadioChips("raceExperience", [["none", "Noch keine"], ["few", "1–3 Rennen"], ["some", "4–10 Rennen"], ["many", "10+ Rennen"]], onbState.raceExperience)}
      </div>
      <div class="onb-row">
        <div class="onb-field"><label for="onb-strong">Stärkste Disziplin</label>
          <select id="onb-strong" class="coach-input"><option value="">– auswählen –</option><option value="Schwimmen">Schwimmen</option><option value="Rad">Rad</option><option value="Laufen">Laufen</option></select>
        </div>
        <div class="onb-field"><label for="onb-weak">Größte Schwäche</label>
          <select id="onb-weak" class="coach-input"><option value="">– auswählen –</option><option value="Schwimmen">Schwimmen</option><option value="Rad">Rad</option><option value="Laufen">Laufen</option></select>
        </div>
      </div>
    </div>`;
  } else if (onbStep === 2) {
    html = `<div class="onb-step">
      <h3>Verfügbarkeit</h3>
      <p class="onb-sub">Wie viel Zeit realistisch für Training da ist, bestimmt die Wochenstruktur.</p>
      <div class="onb-field">
        <label>An welchen Tagen möchtest du trainieren?</label>
        <div class="onb-weekday-group" id="onb-training-days"></div>
      </div>
      <div class="onb-row">
        <div class="onb-field">
          <label>Schwimmtag(e)</label>
          <div class="onb-weekday-group" id="onb-swim-day"></div>
          <p class="onb-hint">Nur unter den oben gewählten Tagen wählbar — auch mehrere Tage möglich.</p>
        </div>
        <div class="onb-field">
          <label>Lange Einheit(en)</label>
          <div class="onb-weekday-group" id="onb-long-days"></div>
          <p class="onb-hint">Z.B. langer Lauf/Radausfahrt am Wochenende — auch mehrere Tage möglich.</p>
        </div>
      </div>
      <div class="onb-row">
        <div class="onb-field"><label for="onb-session-min">Übliche Trainingsdauer (Minuten)</label><input type="number" id="onb-session-min" class="coach-input" min="0" step="5" placeholder="z.B. 60"></div>
        <div class="onb-field"><label for="onb-hours">Stunden pro Woche insgesamt (optional)</label><input type="number" id="onb-hours" class="coach-input" min="0" step="0.5" placeholder="z.B. 8"></div>
      </div>
    </div>`;
  } else if (onbStep === 3) {
    html = `<div class="onb-step">
      <h3>Leistungswerte <span style="font-weight:500;color:var(--text-muted)">(optional)</span></h3>
      <p class="onb-sub">Falls bekannt — macht die Empfehlung konkreter. Sonst einfach leer lassen.</p>
      <div class="onb-field"><label for="onb-ftp">FTP Rad (Watt)</label><input type="number" id="onb-ftp" class="coach-input" min="0" placeholder="z.B. 250"></div>
      <div class="onb-row">
        <div class="onb-field"><label for="onb-run-pace">Schwellenpace Laufen (min/km)</label><input type="text" id="onb-run-pace" class="coach-input" placeholder="z.B. 4:45"></div>
        <div class="onb-field"><label for="onb-swim-pace">CSS Schwimmen (min/100m)</label><input type="text" id="onb-swim-pace" class="coach-input" placeholder="z.B. 1:45"></div>
      </div>
      <div class="onb-row-3">
        <div class="onb-field"><label for="onb-max-hr">Maximale Herzfrequenz (bpm)</label><input type="number" id="onb-max-hr" class="coach-input" min="0" placeholder="z.B. 190"></div>
        <div class="onb-field"><label for="onb-resting-hr">Ruhe-Herzfrequenz (bpm)</label><input type="number" id="onb-resting-hr" class="coach-input" min="0" placeholder="z.B. 50"></div>
        <div class="onb-field"><label for="onb-weight-kg">Körpergewicht (kg)</label><input type="number" id="onb-weight-kg" class="coach-input" min="0" step="0.1" placeholder="z.B. 75"></div>
      </div>
      <p class="onb-hint">Max./Ruhe-Herzfrequenz werden für Trainingsbelastung (TRIMP) und Herzfrequenz-Zonen gebraucht, das Gewicht nur für die Rad-Leistungsschätzung aus Watt-Daten — ohne diese Werte bleiben die jeweiligen Auswertungen einfach ausgeblendet, statt geraten zu werden.</p>
    </div>`;
  } else if (onbStep === 4) {
    html = `<div class="onb-step">
      <h3>Trainingsplan <span style="font-weight:500;color:var(--text-muted)">(optional)</span></h3>
      <p class="onb-sub">Der Coach kann dir automatisch konkrete Workout-Vorschläge für die nächsten Tage erstellen (im Kalender + Coach-Tab sichtbar, per Drag & Drop verschiebbar). Sollen dabei auch diese Einheiten mit eingeplant werden?</p>
      <div class="onb-field">
        <label class="onb-checkbox-row"><input type="checkbox" id="onb-strength">Krafttraining einplanen (mit konkreten Übungen)</label>
      </div>
      <div class="onb-field">
        <label class="onb-checkbox-row"><input type="checkbox" id="onb-mobility">Mobility/Beweglichkeit einplanen (mit konkreten Übungen)</label>
      </div>
      <p class="onb-hint">Schwimmen, Rad und Laufen werden immer eingeplant — das hier ist nur die Ergänzung.</p>
      <div class="onb-field">
        <label for="onb-limitations">Verletzungen / Einschränkungen (optional)</label>
        <textarea id="onb-limitations" class="coach-input" rows="2" placeholder="z.B. Knieprobleme beim Laufen, Schulter nach Reha noch vorsichtig belasten..."></textarea>
      </div>
      <p class="onb-hint">Wird bei der KI-Trainingsplan-Erstellung berücksichtigt, um passende Einheiten/Übungen vorzuschlagen — ersetzt keine ärztliche/physiotherapeutische Beratung.</p>
    </div>`;
  } else if (onbStep === 5) {
    html = `<div class="onb-step">
      <h3>Dein Ziel</h3>
      <p class="onb-sub">Das Event, auf das der Coach dich vorbereiten soll (optional — kann auch später ergänzt werden).</p>
      <div class="onb-field"><label for="onb-goal-name">Event / Ziel</label><input type="text" id="onb-goal-name" class="coach-input" placeholder="z.B. Ironman 70.3 Kraichgau"></div>
      <div class="onb-row">
        <div class="onb-field"><label for="onb-goal-sport">Sportart</label>
          <select id="onb-goal-sport" class="coach-input"><option value="Triathlon">Triathlon</option><option value="Laufen">Laufen</option><option value="Rad">Rad</option><option value="Schwimmen">Schwimmen</option></select>
        </div>
        <div class="onb-field"><label for="onb-goal-date">Datum</label><input type="date" id="onb-goal-date" class="coach-input"></div>
      </div>
      <div class="onb-row">
        <div class="onb-field"><label for="onb-goal-time">Zielzeit (optional)</label><input type="text" id="onb-goal-time" class="coach-input" placeholder="z.B. 5:30"></div>
        <div class="onb-field"><label for="onb-goal-distance">Distanz in km (optional)</label><input type="number" id="onb-goal-distance" class="coach-input" min="0" step="0.1" placeholder="z.B. 113"></div>
      </div>
      <div class="onb-field"><label for="onb-goal-notes">Notizen (optional)</label><input type="text" id="onb-goal-notes" class="coach-input" placeholder="z.B. erste Langdistanz, Laufen ist meine Schwäche"></div>
      <div class="onb-field">
        <label class="onb-checkbox-row"><input type="checkbox" id="onb-goal-primary">Dies ist mein Hauptevent (★) — darauf plant der Trainingsplan konkret hin</label>
      </div>
    </div>`;
  } else {
    html = `<div class="onb-step">
      <h3>Fertig!</h3>
      <p class="onb-sub">Kurze Zusammenfassung — mit „Fertig" wird alles gespeichert.</p>
      <div class="onb-summary">${buildOnbSummary()}</div>
    </div>`;
  }
  document.getElementById("onb-step-body").innerHTML = html;
  wireOnbStepInputs();
  document.getElementById("onb-back-btn").style.visibility = onbStep === 0 ? "hidden" : "visible";
  document.getElementById("onb-next-btn").textContent = onbStep === ONB_STEPS - 1 ? "Fertig" : "Weiter";
}


function wireOnbStepInputs() {
  document.querySelectorAll("#onb-step-body .onb-radio-chip").forEach(btn => {
    const group = btn.closest(".onb-radio-group");
    const field = group.dataset.field;
    btn.addEventListener("click", () => {
      onbState[field] = btn.dataset.value;
      group.querySelectorAll(".onb-radio-chip").forEach(b => b.classList.toggle("selected", b === btn));
    });
  });
  const bind = (id, field, parse) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (onbState[field] != null && onbState[field] !== "") el.value = onbState[field];
    el.addEventListener("input", () => { onbState[field] = parse ? parse(el.value) : el.value; });
  };
  bind("onb-name", "name");
  bind("onb-gender", "gender");
  bind("onb-birthdate", "birthDate");
  bind("onb-strong", "strongDiscipline");
  bind("onb-weak", "weakDiscipline");
  bind("onb-session-min", "typicalSessionMin");
  bind("onb-hours", "weeklyHours");
  bind("onb-ftp", "ftpWatts");
  bind("onb-run-pace", "runThresholdPace");
  bind("onb-swim-pace", "swimCss");
  bind("onb-max-hr", "maxHr");
  bind("onb-resting-hr", "restingHr");
  bind("onb-weight-kg", "weightKg");
  bind("onb-limitations", "limitations");
  bind("onb-goal-name", "goalName");
  bind("onb-goal-sport", "goalSport");
  bind("onb-goal-date", "goalDate");
  bind("onb-goal-time", "goalTime");
  bind("onb-goal-distance", "goalDistance");
  bind("onb-goal-notes", "goalNotes");
  const bindCheckbox = (id, field) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = !!onbState[field];
    el.addEventListener("change", () => { onbState[field] = el.checked; });
  };
  bindCheckbox("onb-strength", "includeStrength");
  bindCheckbox("onb-mobility", "includeMobility");
  bindCheckbox("onb-goal-primary", "goalIsPrimary");
  if (document.getElementById("onb-training-days")) renderOnbAvailabilityPickers();
}


function syncProfileInputsFromState() {
  [["profile-name", "name"], ["profile-gender", "gender"], ["profile-birthdate", "birthDate"], ["profile-ftp", "ftpWatts"], ["profile-run-pace", "runThresholdPace"], ["profile-swim-pace", "swimCss"], ["profile-weekly-hours", "weeklyHours"], ["profile-max-hr", "maxHr"], ["profile-resting-hr", "restingHr"], ["profile-weight-kg", "weightKg"]]
    .forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el && athleteProfile[key] != null) el.value = athleteProfile[key];
    });
}


function openOnboarding() {
  resetOnbState();
  onbStep = 0;
  renderOnbStep();
  document.getElementById("onb-overlay").classList.add("open");
}

function closeOnboarding() {
  document.getElementById("onb-overlay").classList.remove("open");
}

function finishOnboarding() {
  // Speichern (Profil + ggf. Ziel) hat Vorrang und darf auf keinen Fall
  // ausbleiben. Das anschließende Neu-Zeichnen der Kacheln ist "nice to
  // have" - falls dabei (z.B. wegen einer alten/unerwarteten Datenform in
  // localStorage) etwas schiefgeht, soll das Overlay trotzdem zugehen und
  // das bereits Gespeicherte bestehen bleiben, statt dass "Fertig" wirkungslos
  // wirkt. Der Fehler landet zusätzlich in der Konsole, damit er sich
  // nachvollziehen lässt.
  try {
    athleteProfile.name = onbState.name ? onbState.name.trim() || null : athleteProfile.name;
    athleteProfile.gender = onbState.gender || athleteProfile.gender || null;
    athleteProfile.birthDate = onbState.birthDate || athleteProfile.birthDate || null;
    athleteProfile.experienceLevel = onbState.experienceLevel || null;
    athleteProfile.raceExperience = onbState.raceExperience || null;
    athleteProfile.strongDiscipline = onbState.strongDiscipline || null;
    athleteProfile.weakDiscipline = onbState.weakDiscipline || null;
    athleteProfile.trainingDays = onbState.trainingDays ? [...onbState.trainingDays] : [];
    athleteProfile.trainingDaysPerWeek = athleteProfile.trainingDays.length || null;
    athleteProfile.swimDays = onbState.swimDays ? [...onbState.swimDays] : [];
    athleteProfile.longDays = onbState.longDays ? [...onbState.longDays] : [];
    athleteProfile.typicalSessionMin = onbState.typicalSessionMin ? Number(onbState.typicalSessionMin) : null;
    athleteProfile.weeklyHours = onbState.weeklyHours ? Number(onbState.weeklyHours) : null;
    athleteProfile.ftpWatts = onbState.ftpWatts ? Number(onbState.ftpWatts) : null;
    athleteProfile.runThresholdPace = onbState.runThresholdPace || null;
    athleteProfile.swimCss = onbState.swimCss || null;
    athleteProfile.maxHr = onbState.maxHr ? Number(onbState.maxHr) : (athleteProfile.maxHr || null);
    athleteProfile.restingHr = onbState.restingHr ? Number(onbState.restingHr) : (athleteProfile.restingHr || null);
    athleteProfile.weightKg = onbState.weightKg ? Number(onbState.weightKg) : (athleteProfile.weightKg || null);
    athleteProfile.limitations = onbState.limitations ? onbState.limitations.trim() || null : null;
    athleteProfile.includeStrength = !!onbState.includeStrength;
    athleteProfile.includeMobility = !!onbState.includeMobility;
    athleteProfile.onboardingDone = true;
    saveAthleteProfile();

    if (onbState.goalName && onbState.goalDate) {
      const makePrimary = onbState.goalIsPrimary !== false;
      if (makePrimary) goals.forEach(g => { g.isPrimary = false; });
      goals.push({
        id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("g" + Date.now() + Math.random().toString(16).slice(2)),
        name: onbState.goalName,
        sport: onbState.goalSport || "Triathlon",
        date: onbState.goalDate,
        targetTime: onbState.goalTime || null,
        distanceKm: onbState.goalDistance ? Number(onbState.goalDistance) : null,
        notes: onbState.goalNotes || null,
        isPrimary: makePrimary || goals.length === 0,
        recommendation: null,
        recommendationAt: null,
      });
      saveGoals();
    }
  } catch (e) {
    console.error("finishOnboarding: Speichern fehlgeschlagen", e);
  }

  // Overlay schließen + Gate freischalten passiert in jedem Fall, auch wenn
  // oben etwas schiefging - das Gespeicherte ist dann trotzdem da.
  revealCoachContent();
  closeOnboarding();

  // Kacheln neu zeichnen - einzeln try/catch-geschützt, damit ein Fehler in
  // einer Kachel nicht die andere(n) mit verhindert.
  try { syncProfileInputsFromState(); } catch (e) { console.error("syncProfileInputsFromState fehlgeschlagen", e); }
  try { renderGoals(); } catch (e) { console.error("renderGoals fehlgeschlagen", e); }
  try { renderTrainingPlanCard(); } catch (e) { console.error("renderTrainingPlanCard fehlgeschlagen", e); }
}

// Baut eine Chip-Reihe (wie beim Onboarding) für ein Feld des Erholungs-
// Checks, wired direkt auf den State und speichert bei jeder Änderung sofort.

function revealCoachContent() {
  const content = document.getElementById("coach-content");
  const gate = document.getElementById("coach-gate");
  if (content) content.classList.remove("gated");
  if (gate) gate.classList.remove("active");
}
// Zeigt das Onboarding-Gate an (nur wenn noch nicht erledigt).

// Bestandsnutzer, die schon ein Profil/Ziel angelegt haben, aber die
// onboardingDone-Flag noch nicht gesetzt bekommen haben, sollen nicht
// plötzlich ausgesperrt werden ("Grandfathering") - zentrale Prüfung,
// von applyCoachGateState() UND vom automatischen Erststart-Onboarding
// (initCoach()) gleichermaßen genutzt.
function hasExistingAthleteData() {
  return !!(
    athleteProfile.experienceLevel || athleteProfile.ftpWatts || athleteProfile.runThresholdPace ||
    athleteProfile.swimCss || athleteProfile.weeklyHours || athleteProfile.trainingDaysPerWeek ||
    (Array.isArray(goals) && goals.length)
  );
}

function applyCoachGateState() {
  const content = document.getElementById("coach-content");
  const gate = document.getElementById("coach-gate");
  if (!content || !gate) return;
  if (athleteProfile.onboardingDone || hasExistingAthleteData()) {
    if (!athleteProfile.onboardingDone) { athleteProfile.onboardingDone = true; saveAthleteProfile(); }
    revealCoachContent();
  } else {
    content.classList.add("gated");
    gate.classList.add("active");
  }
}


function initCoach() {
  loadCoachSettings();
  loadAthleteProfile();
  loadGoals();
  loadPlannedWorkouts();
  loadPlanWishes();
  initGoalsCardCollapse();
  applyCoachGateState();
  const urlInput = document.getElementById("coach-ollama-url");
  const modelInput = document.getElementById("coach-ollama-model");
  urlInput.value = coachSettings.baseUrl;
  modelInput.value = coachSettings.model;
  urlInput.addEventListener("change", () => {
    coachSettings.baseUrl = urlInput.value.trim() || "http://localhost:11434";
    saveCoachSettings();
  });
  modelInput.addEventListener("change", () => {
    coachSettings.model = modelInput.value.trim() || "llama3.1";
    saveCoachSettings();
  });
  document.getElementById("coach-test-btn").addEventListener("click", testOllamaConnection);

  // Claude API-Einstellungen (optional, siehe js/ai/claude.js) - derselbe
  // Aufbau wie bei Ollama oben.
  loadClaudeSettings();
  const claudeKeyInput = document.getElementById("claude-api-key");
  const claudeModelInput = document.getElementById("claude-model");
  claudeKeyInput.value = claudeSettings.apiKey;
  claudeModelInput.value = claudeSettings.model;
  claudeKeyInput.addEventListener("change", () => {
    claudeSettings.apiKey = claudeKeyInput.value.trim();
    saveClaudeSettings();
  });
  claudeModelInput.addEventListener("change", () => {
    claudeSettings.model = claudeModelInput.value.trim() || CLAUDE_DEFAULT_MODEL;
    saveClaudeSettings();
  });
  document.getElementById("claude-test-btn").addEventListener("click", testClaudeConnection);

  // Hybrid-Weiche: pro KI-Aufgabe Ollama oder Claude (siehe js/ai/provider.js).
  loadHybridSettings();
  document.querySelectorAll("#view-settings select[data-task]").forEach(sel => {
    const task = sel.dataset.task;
    sel.value = hybridSettings[task] || "ollama";
    sel.addEventListener("change", () => {
      hybridSettings[task] = sel.value;
      saveHybridSettings();
    });
  });

  const profileFields = [
    ["profile-name", "name", v => v.trim() || null],
    ["profile-gender", "gender", v => v || null],
    ["profile-birthdate", "birthDate", v => v || null],
    ["profile-ftp", "ftpWatts", v => v ? Number(v) : null],
    ["profile-run-pace", "runThresholdPace", v => v.trim() || null],
    ["profile-swim-pace", "swimCss", v => v.trim() || null],
    ["profile-weekly-hours", "weeklyHours", v => v ? Number(v) : null],
    ["profile-max-hr", "maxHr", v => v ? Number(v) : null],
    ["profile-resting-hr", "restingHr", v => v ? Number(v) : null],
    ["profile-weight-kg", "weightKg", v => v ? Number(v) : null],
  ];
  profileFields.forEach(([id, key, parse]) => {
    const input = document.getElementById(id);
    if (athleteProfile[key] != null) input.value = athleteProfile[key];
    input.addEventListener("change", () => {
      athleteProfile[key] = parse(input.value);
      saveAthleteProfile();
    });
  });
  [["profile-include-strength", "includeStrength"], ["profile-include-mobility", "includeMobility"]].forEach(([id, key]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.checked = !!athleteProfile[key];
    input.addEventListener("change", () => {
      athleteProfile[key] = input.checked;
      saveAthleteProfile();
    });
  });

  loadRecoveryCheck();
  renderRecoveryCheck();

  document.getElementById("goal-form").addEventListener("submit", addGoal);

  // Unterdisziplinen (Distanz + Zielzeit je Disziplin) nur beim Ziel-Sportart
  // "Triathlon" anzeigen - bei einer einzelnen Sportart reichen die
  // normalen Distanz-/Zielzeit-Felder oben.
  const goalSportSelect = document.getElementById("goal-sport");
  const goalSubdisciplinesEl = document.getElementById("goal-subdisciplines");
  function toggleGoalSubdisciplines() {
    goalSubdisciplinesEl.style.display = goalSportSelect.value === "Triathlon" ? "flex" : "none";
  }
  goalSportSelect.addEventListener("change", toggleGoalSubdisciplines);
  toggleGoalSubdisciplines();

  document.getElementById("onboarding-start-btn").addEventListener("click", openOnboarding);
  const gateBtn = document.getElementById("onboarding-gate-btn");
  if (gateBtn) gateBtn.addEventListener("click", openOnboarding);
  const gateSkip = document.getElementById("coach-gate-skip");
  if (gateSkip) gateSkip.addEventListener("click", () => {
    athleteProfile.onboardingDone = true;
    saveAthleteProfile();
    revealCoachContent();
  });
  document.getElementById("onb-close").addEventListener("click", closeOnboarding);
  document.getElementById("onb-next-btn").addEventListener("click", () => {
    if (onbStep < ONB_STEPS - 1) { onbStep++; renderOnbStep(); } else { finishOnboarding(); }
  });
  document.getElementById("onb-back-btn").addEventListener("click", () => {
    if (onbStep > 0) { onbStep--; renderOnbStep(); }
  });
  document.getElementById("onb-overlay").addEventListener("click", e => {
    if (e.target.id === "onb-overlay") closeOnboarding();
  });

  initPlanEditOverlay();
  initTrainingPlanWishes();
  initPlanWishForm();
  initIcalSettings();
  renderGoals();
  renderTrainingPlanCard();

  // App-weiter erster Eindruck: beim allerersten Start (kein Profil, kein
  // Ziel, Onboarding noch nicht erledigt) öffnet sich der vereinheitlichte
  // Onboarding-Wizard direkt beim Laden - unabhängig davon, welcher Tab
  // gerade aktiv ist (ersetzt das frühere separate, kleinere Willkommens-
  // Overlay, das nur Name/Geschlecht/Geburtsdatum abgefragt hat).
  if (!athleteProfile.onboardingDone && !hasExistingAthleteData()) {
    openOnboarding();
  }
}

// "Kalender-Abo (iCal)"-Karte in den Einstellungen: zeigt auf Klick die
// persoenliche Abo-Adresse (GET /api/v1/ical-link). Sie enthaelt einen
// geheimen Schluessel statt eines Logins, weil Kalender-Apps sich nicht
// anmelden koennen - und nutzt die Adresse, unter der das Dashboard gerade
// laeuft (localhost, PC-Name oder Tailscale).
function initIcalSettings() {
  const hint = document.getElementById("ical-status-hint");
  const row = document.getElementById("ical-url-row");
  const urlInput = document.getElementById("ical-url-input");
  const copyBtn = document.getElementById("ical-copy-btn");
  if (!hint || !row || !urlInput) return;

  const pruefBtn = document.getElementById("ical-check-btn");
  hint.textContent = "Optional: dein Trainingsplan als Kalender-Abo.";
  row.hidden = true;
  if (pruefBtn) pruefBtn.hidden = false;

  function zeigeAboAdresse() {
    hint.textContent = "Lade ...";
    apiCall("ical-link")
      .then(r => {
        hint.textContent = "Diese persönliche Adresse in deiner Kalender-App als Internetkalender-Abo hinzufügen. Nicht weitergeben – wer sie kennt, sieht deinen Plan.";
        urlInput.value = new URL(r.data.path, window.location.href).href;
        row.hidden = false;
      })
      .catch(e => {
        hint.textContent = e.message;
        row.hidden = true;
      });
  }
  if (pruefBtn) pruefBtn.addEventListener("click", zeigeAboAdresse);

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(urlInput.value);
        copyBtn.textContent = "Kopiert ✓";
        setTimeout(() => { copyBtn.textContent = "Kopieren"; }, 1500);
      } catch (e) {
        urlInput.select();
      }
    });
  }
}

// Globale Einstellungen (Ollama-Verbindung + Athletenprofil), erreichbar
// über das Zahnrad-Icon in der Topbar - nicht mehr an den Coach-Tab gebunden.
// Öffnet als eigene, vollwertige Seite (#view-settings) statt als Fenster/
// Overlay - nutzt dieselbe .view/.tab-btn-Umschaltung wie die übrigen Tabs
// (initTopNav, js/components/app-shell.js), nur dass #view-settings keinen
// eigenen sichtbaren Tab-Button hat. "Zurück" merkt sich den Tab, von dem
// aus die Einstellungen geöffnet wurden, und stellt ihn wieder her.
const globalSettingsBtn = document.getElementById("global-settings-btn");
const settingsBackBtn = document.getElementById("settings-back-btn");
let settingsPreviousView = "overview";

function openSettingsView() {
  const activeTab = document.querySelector(".tab-btn.active");
  settingsPreviousView = activeTab ? activeTab.dataset.view : "overview";
  activateView("settings");
  window.scrollTo(0, 0);
}
function closeSettingsView() {
  activateView(settingsPreviousView || "overview");
}
if (globalSettingsBtn) {
  globalSettingsBtn.addEventListener("click", openSettingsView);
}
if (settingsBackBtn) {
  settingsBackBtn.addEventListener("click", closeSettingsView);
}
document.addEventListener("keydown", e => {
  const settingsView = document.getElementById("view-settings");
  if (e.key === "Escape" && settingsView && settingsView.classList.contains("active")) {
    closeSettingsView();
  }
});

// "+ Neues Ziel/Event"-Button blendet die Formular-Kachel ein/aus, statt sie
// dauerhaft anzuzeigen.
const newGoalToggleBtn = document.getElementById("new-goal-toggle-btn");
const newGoalCard = document.getElementById("new-goal-card");
if (newGoalToggleBtn && newGoalCard) {
  newGoalToggleBtn.addEventListener("click", () => {
    const nowHidden = !newGoalCard.hidden;
    newGoalCard.hidden = nowHidden;
    newGoalToggleBtn.classList.toggle("active", !nowHidden);
    newGoalToggleBtn.textContent = nowHidden ? "+ Neues Ziel/Event" : "✕ Abbrechen";
    if (!nowHidden) {
      newGoalCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const firstField = newGoalCard.querySelector("input, select, textarea");
      if (firstField) firstField.focus();
    }
  });
}

