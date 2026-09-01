// Ernährungs-Tab-UI: Gewichtsverlauf-Eingabe, Tagesziel-Makros,
// Pre-Workout-Timing und Wettkampf-Verpflegungsplan. Die eigentlichen
// Berechnungen kommen aus js/analytics/nutrition.js - hier wird nur
// angezeigt (siehe AI_RULES: Berechnung vs. Darstellung getrennt).

const PLAN_INTENSITY_LABELS_NUTRITION = { leicht: "leicht", mittel: "mittel", hart: "hart" };

function renderWeightSummary() {
  const host = document.getElementById("nutrition-weight-summary");
  if (!host) return;
  if (!weightLog.length) {
    host.innerHTML = `<p class="empty-note">Noch kein Gewicht eingetragen.</p>`;
    return;
  }
  const latest = weightLog[weightLog.length - 1];
  const trend = weightTrend(30);
  const trendHtml = trend
    ? `<div class="card-sub">${trend.deltaKg >= 0 ? "+" : ""}${fmtNum(trend.deltaKg, 1)} kg ggü. ${fmtDateFull(new Date(trend.fromDate + "T00:00:00"))}</div>`
    : `<div class="card-sub">Noch zu wenig Verlauf für einen Trend.</div>`;
  const recent = weightLog.slice(-5).reverse();
  host.innerHTML = `
    <div class="stat-tile" style="margin-top:12px;">
      <div class="label">Letzter Eintrag (${fmtDateFull(new Date(latest.date + "T00:00:00"))})</div>
      <div class="value">${fmtNum(latest.weightKg, 1)} kg</div>
      ${trendHtml}
    </div>
    <table class="nutrition-weight-table">
      <tbody>
        ${recent.map(e => `<tr><td>${fmtDateFull(new Date(e.date + "T00:00:00"))}</td><td>${fmtNum(e.weightKg, 1)} kg</td></tr>`).join("")}
      </tbody>
    </table>`;
}

function renderNutritionMacros() {
  const host = document.getElementById("nutrition-macros-body");
  if (!host) return;
  const m = computeDailyMacroTargets();
  if (!m) {
    host.innerHTML = `<p class="empty-note">Trage links dein Körpergewicht ein (oder im Athletenprofil) - ohne Körpergewicht keine seriöse g/kg-Angabe.</p>`;
    return;
  }
  const phaseBits = [m.loadingNote || m.category.label];
  if (!m.isCarbLoading && m.biasNote) phaseBits.push(m.biasNote);
  if (m.phaseLabel) phaseBits.push(m.phaseLabel);
  host.innerHTML = `
    <p class="card-sub">${escapeHtml(phaseBits.join(" · "))} · ${m.todaysMinutes ? Math.round(m.todaysMinutes) + " min geplant heute" : "kein Training heute geplant"}</p>
    <div class="stat-row" style="grid-template-columns:repeat(3,1fr);margin-bottom:0;">
      <div class="stat-tile">
        <div class="label">Kohlenhydrate</div>
        <div class="value">${m.carbG} g</div>
        <div class="sub">${m.carbRangeG[0]}-${m.carbRangeG[1]} g Richtbereich</div>
      </div>
      <div class="stat-tile">
        <div class="label">Eiweiß</div>
        <div class="value">${m.proteinG} g</div>
        <div class="sub">${PROTEIN_G_PER_KG} g/kg</div>
      </div>
      <div class="stat-tile">
        <div class="label">Fett</div>
        <div class="value">${m.fatG} g</div>
        <div class="sub">mind. ${FAT_G_PER_KG_MIN} g/kg</div>
      </div>
    </div>
    <p class="card-sub" style="margin-top:12px;">≈ ${m.kcal} kcal aus diesen drei Makros (${fmtNum(m.weightKg, 1)} kg Körpergewicht zugrunde gelegt).</p>`;
}

// Baut die Pre-Workout-Fueling-Tabelle als HTML - gemeinsam genutzt vom
// Ernährungs-Tab (renderPreWorkoutTiming, s.u.) und der Einheiten-
// Detailansicht (openPlanEdit, js/components/training-plan.js), damit an
// beiden Stellen exakt dieselbe Darstellung erscheint (siehe AI_RULES:
// Berechnung in analytics/, Darstellung hier).
function preWorkoutStepsTableHtml(t) {
  return `<table class="nutrition-timing-table">
    <tbody>
      ${t.steps.map(s => `<tr><td class="nutrition-timing-when">${escapeHtml(s.when)}</td><td>${escapeHtml(s.what)}</td></tr>`).join("")}
    </tbody>
  </table>`;
}

// Merkt sich, welcher Tag im "Vor dem Training"-Umschalter aktuell
// ausgewählt ist - ein Reiter pro TAG, nicht pro Workout (siehe
// CHANGE_REQUESTS.md #4: mehrere Einheiten am selben Tag teilen sich einen
// Reiter mit kombinierter Tagesempfehlung). Rein transient (UI-Zustand,
// keine Persistierung nötig), analog zu calFocusDay in calendar.js. Wird
// automatisch zurückgesetzt, sobald der ausgewählte Tag aus der Liste der
// nächsten Tage verschwindet (Einheiten erledigt/gelöscht/verschoben).
let nutritionPreworkoutSelectedDate = null;

function renderPreWorkoutTiming() {
  const host = document.getElementById("nutrition-preworkout-body");
  if (!host) return;
  const t = computePreWorkoutTiming(nutritionPreworkoutSelectedDate);
  if (!t) {
    nutritionPreworkoutSelectedDate = null;
    host.innerHTML = `<p class="empty-note">Keine anstehende geplante Einheit gefunden (Coach-Tab → Trainingsplan).</p>`;
    return;
  }
  nutritionPreworkoutSelectedDate = t.date;
  const d = new Date(t.date + "T00:00:00");
  const dowDate = `${DOW_LABELS_DE[(d.getDay() + 6) % 7]}<br>${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;

  const switcherHtml = t.days.length > 1 ? `
    <div class="nutrition-preworkout-switcher">
      ${t.days.map(day => {
        const cd = new Date(day.date + "T00:00:00");
        const first = day.workouts[0];
        const title = day.workouts.map(w => `${w.sport} · ${w.title}`).join(", ");
        return `<button type="button" class="chip nutrition-preworkout-chip${day.date === t.date ? " active" : ""}" data-date="${day.date}" title="${escapeHtml(title)}">
          <span class="sport-dot" style="background:${sportColor(first.sport)}"></span>${DOW_LABELS_DE[(cd.getDay() + 6) % 7]} ${String(cd.getDate()).padStart(2, "0")}.${String(cd.getMonth() + 1).padStart(2, "0")}.${day.workouts.length > 1 ? ` (${day.workouts.length})` : ""}
        </button>`;
      }).join("")}
    </div>` : "";

  // Alle Einheiten dieses Tages zur Orientierung auflisten (klickbar, wie
  // gewohnt) - die Fueling-Empfehlung darunter ist EINE kombinierte
  // Tagesempfehlung, keine separate Tabelle pro Einheit.
  const workoutsHtml = t.workouts.map(pw => `
    <div class="plan-item plan-item-clickable" data-id="${pw.id}" tabindex="0" role="button" title="Details zu dieser Einheit ansehen (wie im Kalender)">
      <div class="plan-item-date">${dowDate}</div>
      <div class="plan-item-main">
        <div class="plan-item-head">
          <span class="sport-dot" style="background:${sportColor(pw.sport)}"></span>
          <span class="plan-item-sport">${escapeHtml(pw.sport)}</span>
          <span class="plan-item-title">${escapeHtml(pw.title)}</span>
          ${pw.intensity ? `<span class="plan-intensity plan-intensity-${pw.intensity}">${PLAN_INTENSITY_LABELS_NUTRITION[pw.intensity]}</span>` : ""}
        </div>
        <div class="plan-item-meta">${pw.duration_min != null ? Math.round(pw.duration_min) + " min" : ""}</div>
      </div>
    </div>`).join("");

  host.innerHTML = `
    ${switcherHtml}
    ${workoutsHtml}
    ${preWorkoutStepsTableHtml(t)}`;

  host.querySelectorAll(".nutrition-preworkout-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      nutritionPreworkoutSelectedDate = btn.dataset.date;
      renderPreWorkoutTiming();
    });
  });
  if (typeof openPlanEdit === "function") {
    host.querySelectorAll(".plan-item-clickable").forEach(detailRow => {
      detailRow.addEventListener("click", () => openPlanEdit(detailRow.dataset.id));
      detailRow.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPlanEdit(detailRow.dataset.id); }
      });
    });
  }
}

// Ab wie vielen Tagen vor dem Event die Wettkampf-Verpflegungs-Kachel
// ausführlich wird - dieselbe Schwelle wie der Beginn der Taper-Phase
// (computeTrainingPhase "taper-beginn", js/analytics/training-plan.js), da
// sich Zielzeiten/Renneinteilung vorher noch ändern können und konkrete
// Verpflegungsangaben so früh eher verwirren als helfen.
const RACE_FUELING_TAPER_DAYS = 14;

function renderRaceFueling() {
  const host = document.getElementById("nutrition-racefueling-body");
  const cardEl = document.getElementById("racefueling-card");
  if (!host) return;
  const goal = (typeof getPrimaryGoal === "function") ? getPrimaryGoal() : null;
  const daysUntil = (goal && goal.date) ? Math.round((new Date(goal.date + "T00:00:00") - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000) : null;
  const inTaperWindow = daysUntil != null && daysUntil >= 0 && daysUntil <= RACE_FUELING_TAPER_DAYS;

  if (cardEl) cardEl.classList.toggle("racefueling-minimal", !inTaperWindow);

  if (!inTaperWindow) {
    const note = !goal
      ? "Markiere ein Ziel mit dem ★-Symbol als Hauptevent, damit hier rechtzeitig vor dem Wettkampf ein Verpflegungsplan erscheint."
      : daysUntil == null
        ? "Kein Zieldatum beim Hauptevent hinterlegt."
        : daysUntil < 0
          ? "Das Hauptevent liegt in der Vergangenheit."
          : `Erscheint automatisch ab der Taper-Phase, ${RACE_FUELING_TAPER_DAYS} Tage vor „${escapeHtml(goal.name)}" (noch ${daysUntil} ${daysUntil === 1 ? "Tag" : "Tage"}).`;
    host.innerHTML = `<p class="empty-note racefueling-waiting">${note}</p>`;
    return;
  }

  const plan = computeRaceFuelingPlan();
  if (!plan) {
    host.innerHTML = `<p class="empty-note">Kein Hauptevent-Ziel mit hinterlegter Zielzeit gefunden (Coach-Tab → Deine Ziele, ★ markieren + Zielzeit(en) eintragen).</p>`;
    return;
  }
  const legsHtml = plan.legs.map(leg => {
    if (leg.hours == null) return `<div class="plan-item"><div class="plan-item-main"><div class="plan-item-head"><span class="plan-item-sport">${escapeHtml(leg.label)}</span></div><div class="plan-item-meta">keine Zielzeit hinterlegt</div></div></div>`;
    const c = leg.carb;
    return `
      <div class="plan-item">
        <div class="plan-item-main">
          <div class="plan-item-head">
            <span class="sport-dot" style="background:${sportColor(leg.label)}"></span>
            <span class="plan-item-sport">${escapeHtml(leg.label)}</span>
            <span class="plan-item-title">${leg.hours.toFixed(1)} h (Ziel ${escapeHtml(leg.targetTime)})</span>
          </div>
          <div class="plan-item-meta">${c ? escapeHtml(c.note) : ""}</div>
        </div>
      </div>`;
  }).join("");

  host.innerHTML = `
    <p class="card-sub">${escapeHtml(plan.goal.name)}</p>
    ${legsHtml}
    <p class="card-sub" style="margin-top:12px;">Gesamt über den Wettkampf: ca. ${plan.totalCarbG[0]}-${plan.totalCarbG[1]} g Kohlenhydrate.</p>
    <p class="card-sub">${plan.fluidNote}</p>`;
}

function renderNutrition() {
  renderWeightSummary();
  renderNutritionMacros();
  renderPreWorkoutTiming();
  renderRaceFueling();
}

function initNutrition() {
  loadWeightLog();
  const input = document.getElementById("nutrition-weight-input");
  const btn = document.getElementById("nutrition-weight-save-btn");
  if (weightLog.length) input.value = weightLog[weightLog.length - 1].weightKg;
  else if (athleteProfile.weightKg) input.value = athleteProfile.weightKg;
  btn.addEventListener("click", () => {
    const v = Number(input.value);
    if (!v || v <= 0) return;
    logWeight(v);
    try { syncProfileInputsFromState(); } catch (e) { /* Coach-Tab evtl. noch nicht initialisiert */ }
    renderNutrition();
  });
}
