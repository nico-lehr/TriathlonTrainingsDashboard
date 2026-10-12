// Trainingsplan-UI: Kachel im Coach-Tab (Übersicht der nächsten geplanten
// Einheiten + manuelles Nachplanen) und das Bearbeiten-Overlay für eine
// einzelne geplante Einheit (auch von calendar.js aus geöffnet, siehe
// openPlanEdit weiter unten). Einheiten kommen entweder von der KI
// (generateTrainingPlan, js/ai/ollama.js) ODER werden manuell angelegt
// (openPlanEdit(null, defaults) - "+ Einheit" hier im Coach-Tab bzw.
// "+ Workout" im Kalender, siehe calendar.js) - dasselbe Overlay/Datenmodell
// (plannedWorkouts) für beide, nur `source` unterscheidet sich ("ai"/"manual").

const PLAN_INTENSITY_LABELS = { leicht: "leicht", mittel: "mittel", hart: "hart" };
const PLAN_STATUS_LABELS = { geplant: "geplant", erledigt: "erledigt", uebersprungen: "übersprungen" };

function renderTrainingPlanCard() {
  renderPlanWishList(); // Status offen/eingeplant hängt am Plan
  const host = document.getElementById("trainingplan-body");
  if (!host) return;
  const timelineHost = document.getElementById("plan-timeline");
  const goal = getPrimaryGoal();
  if (!goal) {
    host.innerHTML = `<p class="empty-note">Markiere eines deiner Ziele weiter oben mit dem ★-Symbol als Hauptevent, damit der Coach dafür einen Trainingsplan erstellen kann.</p>`;
    if (timelineHost) timelineHost.innerHTML = "";
    if (typeof renderCoachSummary === "function") renderCoachSummary();
    return;
  }

  const daysUntil = goal.date ? Math.round((new Date(goal.date + "T00:00:00") - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000) : null;
  const phase = computeTrainingPhase(daysUntil);
  const upcoming = plannedWorkoutsForGoal(goal.id)
    .filter(p => p.date >= todayStr())
    .sort((a, b) => a.date.localeCompare(b.date));

  if (timelineHost) renderPlanTimeline(timelineHost, goal, phase, daysUntil, upcoming);

  const btnLabel = goal._planLoading ? "Plane …" : (upcoming.length ? "Weitere Woche planen" : "Trainingsplan erstellen");
  const dowShort = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const planUntilRaw = upcoming.length ? upcoming[upcoming.length - 1].date : null;
  const planUntil = planUntilRaw ? (() => {
    const d = new Date(planUntilRaw + "T00:00:00");
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
  })() : null;

  const listHtml = upcoming.length ? upcoming.map(p => {
    const d = new Date(p.date + "T00:00:00");
    return `
      <div class="plan-item plan-item-clickable plan-item-${p.status}" data-id="${p.id}" tabindex="0" role="button" title="Details ansehen/bearbeiten">
        <div class="plan-item-date">${dowShort[d.getDay()]}<br>${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.</div>
        <div class="plan-item-main">
          <div class="plan-item-head">
            <span class="sport-dot" style="background:${sportColor(p.sport)}"></span>
            <span class="plan-item-sport">${escapeHtml(p.sport)}</span>
            <span class="plan-item-title">${escapeHtml(p.title)}</span>
            ${p.intensity ? `<span class="plan-intensity plan-intensity-${p.intensity}">${PLAN_INTENSITY_LABELS[p.intensity]}</span>` : ""}
          </div>
          <div class="plan-item-meta">${p.duration_min != null ? Math.round(p.duration_min) + " min" : ""}${p.status !== "geplant" ? " · " + PLAN_STATUS_LABELS[p.status] : ""}</div>
        </div>
        <button type="button" class="plan-item-export" data-id="${p.id}" title="Als .fit für Garmin exportieren">⬇</button>
        <button type="button" class="plan-item-edit" data-id="${p.id}" title="Bearbeiten">✎</button>
      </div>`;
  }).join("") : `<p class="empty-note">Noch kein Trainingsplan erstellt.</p>`;

  host.innerHTML = `
    <div class="plan-head">
      <div class="plan-head-info">
        <span class="goal-name">${escapeHtml(goal.name)}</span>
        <span class="plan-phase-label">${escapeHtml(phase.label)}</span>
        ${upcoming.length ? `<span class="plan-status-badge" title="Es besteht bereits ein Trainingsplan für dieses Ziel">
            <span class="dot"></span> Aktueller Plan bis ${planUntil}
          </span>` : `<span class="plan-status-badge plan-status-none">Noch kein aktiver Plan</span>`}
      </div>
      <div class="plan-head-actions">
        ${upcoming.length ? `<button type="button" class="chip plan-export-all-btn" title="Alle geplanten Einheiten als .fit-Dateien für Garmin Connect herunterladen">Für Garmin exportieren</button>` : ""}
        <button type="button" class="chip plan-add-btn">+ Einheit</button>
        ${upcoming.length ? `<button type="button" class="chip plan-replace-btn" ${goal._planLoading ? "disabled" : ""} title="Löscht den aktuellen Plan ab heute und erstellt einen komplett neuen, statt nur zu ergänzen">Plan neu erstellen</button>` : ""}
        <button type="button" class="chip plan-generate-btn" ${goal._planLoading ? "disabled" : ""}>${btnLabel}</button>
      </div>
    </div>
    ${goal._planError ? `<p class="goal-error">${escapeHtml(goal._planError)}</p>` : ""}
    <div class="plan-item-list">${listHtml}</div>
  `;

  host.querySelector(".plan-generate-btn").addEventListener("click", () => generateTrainingPlan(goal.id));
  const replaceBtn = host.querySelector(".plan-replace-btn");
  if (replaceBtn) replaceBtn.addEventListener("click", () => generateTrainingPlan(goal.id, { replace: true }));
  host.querySelector(".plan-add-btn").addEventListener("click", () => openPlanEdit(null, { goalId: goal.id, phase: phase.key }));
  host.querySelectorAll(".plan-item-edit").forEach(btn => btn.addEventListener("click", () => openPlanEdit(btn.dataset.id)));
  host.querySelectorAll(".plan-item-export").forEach(btn => btn.addEventListener("click", e => { e.stopPropagation(); exportPlannedWorkoutAsFit(btn.dataset.id); }));
  // Ganze Zeile klickbar (wie ein Trainings-Punkt im Kalender) - öffnet
  // dieselbe Detailansicht wie der Stift-Button, nur ohne extra Zielklick.
  host.querySelectorAll(".plan-item-clickable").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      openPlanEdit(row.dataset.id);
    });
    row.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPlanEdit(row.dataset.id); }
    });
  });
  const exportAllBtn = host.querySelector(".plan-export-all-btn");
  if (exportAllBtn) exportAllBtn.addEventListener("click", () => exportPlannedWorkoutsAsFit(upcoming));

  if (typeof renderCoachSummary === "function") renderCoachSummary();
}

/* ---------- Trainingsplan-Zeitleiste: grobe Periodisierungs-Übersicht ----------
   Zeigt als Balken die Trainingsphasen (Grundlage/Aufbau/Spezifisch/Taper,
   siehe computeTrainingPhase in js/analytics/training-plan.js) von heute bis
   zum Zieldatum, damit auf einen Blick klar wird, was in den nächsten
   Wochen/Monaten grob ansteht und in welcher Phase man sich gerade befindet
   - unabhängig davon, wie weit die konkrete Einheiten-Planung (rollierendes
   Fenster) schon vorausgeplant ist. Kleine Punkte markieren zusätzlich
   Kalenderwochen, für die bereits konkrete Einheiten geplant sind. */
// Dieselbe 5-stufige Zonen-Farbskala wie die Herzfrequenz-Zonen-Charts
// (--c-z1..z5, css/variables.css) - dort schon als klar unterscheidbare
// Eskalationsskala erprobt und passt inhaltlich gut (Grundlage = ruhig,
// Wettkampfwoche = "heißeste" Zone). Vorher nutzten "Spezifisch" und
// "Taper" beide --c-warn (dasselbe Orange) und waren nicht zu unterscheiden.
const PLAN_PHASE_COLOR_VARS = {
  grundlage: "--c-z1", aufbau: "--c-z2", spezifisch: "--c-z3",
  "taper-beginn": "--c-z4", "taper-final": "--c-z5",
};
// Segment-Grenzen in "Tage bis Event" (absteigend) - dieselben Schwellen wie computeTrainingPhase.
const PLAN_PHASE_SEGMENTS = [
  { key: "grundlage", label: "Grundlage", untilMax: Infinity, untilMin: 85 },
  { key: "aufbau", label: "Aufbau", untilMax: 84, untilMin: 29 },
  { key: "spezifisch", label: "Spezifisch", untilMax: 28, untilMin: 15 },
  { key: "taper-beginn", label: "Taper", untilMax: 14, untilMin: 7 },
  { key: "taper-final", label: "Wettkampfwoche", untilMax: 6, untilMin: 0 },
];

function renderPlanTimeline(hostEl, goal, phase, daysUntil, upcoming) {
  if (!goal.date) {
    hostEl.innerHTML = `<p class="empty-note plan-timeline-empty">Kein Zieldatum hinterlegt — trag ein Datum bei „Deine Ziele" ein, damit hier die Trainingsphasen bis dahin angezeigt werden können.</p>`;
    return;
  }
  if (daysUntil < 0) {
    hostEl.innerHTML = `<p class="empty-note plan-timeline-empty">Das Zieldatum liegt in der Vergangenheit.</p>`;
    return;
  }
  const totalDays = Math.max(daysUntil, 1);

  // Sehr kurze Segmente (z.B. die 1-wöchige "Wettkampfwoche" bei einem noch
  // weit entfernten Ziel) bekommen eine Mindestbreite, damit sie als eigene
  // Farbe erkennbar/hoverbar bleiben - flex-shrink gleicht die Differenz bei
  // den übrigen Segmenten wieder aus (siehe .plan-timeline-bar CSS), die
  // Reihenfolge/Proportionen bleiben dabei erhalten.
  const MIN_SEG_PCT = 6;
  const segments = PLAN_PHASE_SEGMENTS
    .filter(seg => seg.untilMin <= totalDays)
    .map(seg => {
      const offsetStart = totalDays - Math.min(totalDays, seg.untilMax);
      const offsetEnd = totalDays - seg.untilMin;
      return { ...seg, offsetStart, offsetEnd, widthPct: Math.max(MIN_SEG_PCT, ((offsetEnd - offsetStart) / totalDays) * 100) };
    })
    .filter(seg => seg.offsetEnd > seg.offsetStart);

  // Kalenderwochen mit bereits geplanten Einheiten -> als Punkt auf der
  // Zeitleiste markieren (Tagesoffset ihres Montags, damit mehrere Einheiten
  // derselben Woche nicht mehrfach Punkte erzeugen).
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const plannedWeekOffsets = [...new Set(upcoming.map(p => {
    const d = Math.round((new Date(p.date + "T00:00:00") - todayMid) / 86400000);
    return Math.floor(d / 7) * 7;
  }))];

  const todayLabel = todayMid.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  const eventLabel = new Date(goal.date + "T00:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

  hostEl.innerHTML = `
    <div class="plan-timeline">
      <div class="plan-timeline-head">
        <span class="plan-timeline-current">Du befindest dich hier: <b>${escapeHtml(phase.label)}</b></span>
        <span class="plan-timeline-countdown">noch ${totalDays} ${totalDays === 1 ? "Tag" : "Tage"} bis ${escapeHtml(goal.name)}</span>
      </div>
      <div class="plan-timeline-bar">
        ${segments.map(seg => `
          <span class="plan-timeline-seg${seg.key === phase.key ? " active" : ""}" style="flex-basis:${seg.widthPct}%; background:var(${PLAN_PHASE_COLOR_VARS[seg.key]});" data-seg="${seg.key}"></span>`).join("")}
        ${plannedWeekOffsets.map(off => `<span class="plan-timeline-plan-dot" style="left:${Math.min(100, (off / totalDays) * 100)}%" title="Einheiten für diese Woche bereits geplant"></span>`).join("")}
      </div>
      <div class="plan-timeline-foot">
        <span>${todayLabel}</span>
        <span class="plan-timeline-legend">
          ${segments.map(seg => `<span class="plan-timeline-legend-item${seg.key === phase.key ? " active" : ""}"><span class="dot" style="background:var(${PLAN_PHASE_COLOR_VARS[seg.key]})"></span>${escapeHtml(seg.label)}</span>`).join("")}
        </span>
        <span>${eventLabel}</span>
      </div>
    </div>
  `;

  hostEl.querySelectorAll(".plan-timeline-seg").forEach(el => {
    el.addEventListener("mousemove", e => {
      const seg = PLAN_PHASE_SEGMENTS.find(s => s.key === el.dataset.seg);
      const isCurrent = seg.key === phase.key;
      showTip(e, `<b>${escapeHtml(seg.label)}</b>${isCurrent ? " · aktuell" : ""}`, hostEl);
    });
    el.addEventListener("mouseleave", hideTip);
  });
}

// Ernährungs-Abschnitt in der Einheiten-Detailansicht (openPlanEdit, s.u.) -
// dieselbe Fueling-Tabelle wie im Ernährungs-Tab (preWorkoutStepsForWorkout/
// preWorkoutStepsTableHtml, js/analytics/nutrition.js bzw. js/components/
// nutrition.js), nur hier direkt für DIESE eine Einheit statt für die
// "nächste anstehende" - "alles über das Workout an einer Stelle" statt
// zwischen Kalender/Coach-Tab und Ernährungs-Tab hin- und herwechseln zu
// müssen. Nur für bereits existierende Ausdauereinheiten sinnvoll (bei einer
// neuen Einheit stehen Dauer/Intensität noch nicht fest, Kraft/Mobility
// haben kein Kohlenhydrat-Timing).
function planEditNutritionInnerHtml(p, isNew) {
  if (isNew) return "";
  if (typeof preWorkoutStepsForWorkout !== "function" || typeof preWorkoutStepsTableHtml !== "function") return "";
  const t = preWorkoutStepsForWorkout(p);
  if (!t) return "";
  return `<h4>Ernährung vor dieser Einheit</h4>${preWorkoutStepsTableHtml(t)}`;
}
// Immer als (ggf. leerer) Container gerendert, damit sich der Inhalt live
// nachziehen lässt, sobald Sportart/Dauer/Intensität im Formular geändert
// werden (siehe refreshPlanEditNutrition weiter unten), ohne das ganze
// Overlay neu aufbauen zu müssen.
function planEditNutritionHtml(p, isNew) {
  const inner = planEditNutritionInnerHtml(p, isNew);
  return `<div class="plan-edit-nutrition" id="plan-edit-nutrition"${inner ? "" : ' style="display:none;"'}>${inner}</div>`;
}

/* ---------- Bearbeiten-Overlay (auch von calendar.js aus genutzt) ---------- */

// id === null -> neue Einheit anlegen statt eine bestehende zu bearbeiten.
// `defaults` (nur bei Neuanlage relevant): { date, goalId, phase } - z.B.
// vorbelegtes Datum aus dem Kalendertag, oder das Hauptevent-Ziel aus der
// Trainingsplan-Kachel, damit die manuell angelegte Einheit dort genauso
// erscheint wie eine von der KI erstellte.
// "Lessons Learned"-Block (Button + Ergebnis/Fehler/Lade-Zustand) fuer eine
// bereits gespeicherte geplante Einheit - vorausschauende KI-Einordnung
// basierend auf aehnlichen frueheren Einheiten (siehe generateLessons,
// js/ai/ollama.js). Nur bei bestehenden Einheiten sinnvoll (isNew hat noch
// keine id, an die generateLessons anknuepfen koennte).
function buildPlanEditLessonsHtml(p) {
  const btnLabel = p._lessonsLoading ? "Analysiere …" : (p.lessons ? "Neu einordnen" : "Lessons Learned abrufen");
  return `
    <div class="onb-field pe-lessons" data-id="${p.id}">
      <label>Lessons Learned <span class="wd-analysis-hint">Muster &amp; Tipps aus aehnlichen frueheren Einheiten</span></label>
      <div class="goal-actions">
        <button type="button" class="chip pe-lessons-btn" ${p._lessonsLoading ? "disabled" : ""}>${btnLabel}</button>
        ${p.lessonsAt ? `<span class="goal-rec-date">Stand: ${fmtDateFull(new Date(p.lessonsAt))}</span>` : ""}
      </div>
      ${p._lessonsError ? `<p class="goal-error">${escapeHtml(p._lessonsError)}</p>` : ""}
      ${p.lessons ? `<div class="goal-recommendation">${formatRecommendation(p.lessons)}</div>` : ""}
    </div>`;
}

// Aktualisiert NUR den Lessons-Learned-Block im offenen Bearbeiten-Dialog
// (outerHTML-Ersatz verliert die Button-Verkabelung, deshalb hier neu wiring).
function renderPlanEditLessons(pw) {
  document.querySelectorAll(`.pe-lessons[data-id="${pw.id}"]`).forEach(el => {
    el.outerHTML = buildPlanEditLessonsHtml(pw);
  });
  document.querySelectorAll(`.pe-lessons[data-id="${pw.id}"] .pe-lessons-btn`).forEach(btn => {
    btn.addEventListener("click", () => generateLessons(pw.id));
  });
}

function openPlanEdit(id, defaults) {
  const isNew = !id;
  const p = isNew ? {
    date: (defaults && defaults.date) || todayStr(),
    sport: "Laufen", title: "", duration_min: null, intensity: null, description: null,
    exercises: null, status: "geplant",
    goalId: (defaults && defaults.goalId) || null, phase: (defaults && defaults.phase) || null,
  } : plannedWorkouts.find(x => x.id === id);
  if (!p) return;
  const host = document.getElementById("plan-edit-body");
  // isStrengthLike wird unten per Sportart-Wechsel live nachgezogen (nicht
  // nur beim Öffnen bestimmt) - bei einer neu angelegten Einheit ist die
  // Sportart ja noch nicht final, anders als bei einer von der KI schon
  // fertig vorgeschlagenen.
  const isStrengthLike = p.sport === "Kraft" || p.sport === "Mobility";
  const exercisesHtml = `
    <div class="onb-field" id="plan-edit-exercises-field" style="display:${isStrengthLike ? "" : "none"};">
      <label>Übungen</label>
      <div id="plan-edit-exercises">${(p.exercises || []).map((ex, i) => `
        <div class="plan-exercise-row" data-idx="${i}">
          <input type="text" class="coach-input plan-ex-name" value="${escapeHtml(ex.name || "")}" placeholder="Übung">
          <input type="text" class="coach-input plan-ex-sets" value="${escapeHtml(String(ex.sets ?? ""))}" placeholder="Sätze" style="max-width:70px;">
          <input type="text" class="coach-input plan-ex-reps" value="${escapeHtml(ex.reps || "")}" placeholder="Wdh." style="max-width:70px;">
          <button type="button" class="plan-ex-remove" data-idx="${i}" title="Entfernen">✕</button>
        </div>`).join("")}</div>
      <button type="button" class="chip" id="plan-ex-add">+ Übung</button>
    </div>`;

  host.innerHTML = `
    <div class="onb-step">
      <h3>${isNew ? "Neue Einheit planen" : "Geplante Einheit bearbeiten"}</h3>
      <div class="onb-row">
        <div class="onb-field"><label for="plan-edit-date">Datum</label><input type="date" id="plan-edit-date" class="coach-input" value="${p.date}"></div>
        <div class="onb-field"><label for="plan-edit-sport">Sportart</label>
          <select id="plan-edit-sport" class="coach-input">
            ${PLAN_ALLOWED_SPORTS.map(s => `<option value="${s}"${p.sport === s ? " selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="onb-field"><label for="plan-edit-title">Titel</label><input type="text" id="plan-edit-title" class="coach-input" value="${escapeHtml(p.title || "")}" placeholder="z.B. Lockerer Dauerlauf"></div>
      <div class="onb-row">
        <div class="onb-field"><label for="plan-edit-duration">Dauer (Minuten)</label><input type="number" id="plan-edit-duration" class="coach-input" min="0" value="${p.duration_min ?? ""}"></div>
        <div class="onb-field"><label for="plan-edit-intensity">Intensität</label>
          <select id="plan-edit-intensity" class="coach-input">
            <option value="">–</option>
            <option value="leicht"${p.intensity === "leicht" ? " selected" : ""}>leicht</option>
            <option value="mittel"${p.intensity === "mittel" ? " selected" : ""}>mittel</option>
            <option value="hart"${p.intensity === "hart" ? " selected" : ""}>hart</option>
          </select>
        </div>
      </div>
      <div class="onb-field"><label for="plan-edit-desc">Beschreibung / Struktur</label><textarea id="plan-edit-desc" class="coach-input plan-edit-textarea" rows="3" placeholder="z.B. 10min Einrollen, 6x400m zügig mit 90s Pause, 10min Auslaufen">${escapeHtml(p.description || "")}</textarea></div>
      ${exercisesHtml}
      ${isNew ? "" : `
      <div class="onb-field">
        <label>Status</label>
        <div class="onb-radio-group" id="plan-edit-status" data-field="status">
          ${["geplant", "erledigt", "uebersprungen"].map(s => `<button type="button" class="onb-radio-chip${p.status === s ? " selected" : ""}" data-value="${s}">${PLAN_STATUS_LABELS[s]}</button>`).join("")}
        </div>
      </div>`}
      ${planEditNutritionHtml(p, isNew)}
      ${isNew ? "" : buildPlanEditLessonsHtml(p)}
      ${isNew ? "" : `
      <div class="pe-regen">
        <button type="button" class="chip pe-regen-btn">Alternativer Vorschlag</button>
        <p class="goal-error pe-regen-error" style="display:none;"></p>
      </div>`}
      <div class="plan-edit-actions">
        ${isNew ? "" : `<button type="button" class="chip plan-edit-delete" style="color:var(--c-crit);">Löschen</button>`}
        <div class="plan-edit-actions-right">
          ${isNew ? "" : `<button type="button" class="chip plan-edit-export">Als .fit exportieren</button>`}
          <button type="button" class="update-btn plan-edit-save">${isNew ? "Anlegen" : "Speichern"}</button>
        </div>
      </div>
    </div>`;

  // Ernährungsvorschau live nachziehen, sobald Sportart/Dauer/Intensität im
  // Formular geändert werden (z.B. Kraft gewählt -> Vorschau verschwindet;
  // Dauer auf >=90min erhöht -> zusätzlicher Fueling-Schritt erscheint) -
  // arbeitet mit dem AKTUELLEN Formularstand, nicht mit den gespeicherten
  // Werten von p, damit die Vorschau schon vor dem Speichern stimmt.
  const refreshPlanEditNutrition = () => {
    const draft = {
      sport: host.querySelector("#plan-edit-sport").value,
      duration_min: Number(host.querySelector("#plan-edit-duration").value) || null,
      intensity: host.querySelector("#plan-edit-intensity").value || null,
    };
    const wrap = host.querySelector("#plan-edit-nutrition");
    if (!wrap) return;
    const inner = planEditNutritionInnerHtml(draft, isNew);
    wrap.innerHTML = inner;
    wrap.style.display = inner ? "" : "none";
  };

  host.querySelector("#plan-edit-sport").addEventListener("change", e => {
    const strengthLike = e.target.value === "Kraft" || e.target.value === "Mobility";
    host.querySelector("#plan-edit-exercises-field").style.display = strengthLike ? "" : "none";
    refreshPlanEditNutrition();
  });
  host.querySelector("#plan-edit-duration").addEventListener("input", refreshPlanEditNutrition);
  host.querySelector("#plan-edit-intensity").addEventListener("change", refreshPlanEditNutrition);

  let statusVal = p.status;
  host.querySelectorAll("#plan-edit-status .onb-radio-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      statusVal = btn.dataset.value;
      host.querySelectorAll("#plan-edit-status .onb-radio-chip").forEach(b => b.classList.toggle("selected", b === btn));
    });
  });

  const wireExerciseRemove = () => {
    host.querySelectorAll(".plan-ex-remove").forEach(btn => {
      btn.addEventListener("click", () => btn.closest(".plan-exercise-row").remove());
    });
  };
  wireExerciseRemove();
  const addBtn = host.querySelector("#plan-ex-add");
  if (addBtn) addBtn.addEventListener("click", () => {
    const list = host.querySelector("#plan-edit-exercises");
    const row = document.createElement("div");
    row.className = "plan-exercise-row";
    row.innerHTML = `<input type="text" class="coach-input plan-ex-name" placeholder="Übung"><input type="text" class="coach-input plan-ex-sets" placeholder="Sätze" style="max-width:70px;"><input type="text" class="coach-input plan-ex-reps" placeholder="Wdh." style="max-width:70px;"><button type="button" class="plan-ex-remove" title="Entfernen">✕</button>`;
    list.appendChild(row);
    row.querySelector(".plan-ex-remove").addEventListener("click", () => row.remove());
  });

  // "Alternativer Vorschlag" (KI-Schnellaktion, nur bei bereits gespeicherten
  // Einheiten - siehe CHANGE_REQUESTS.md). Übernimmt den Vorschlag NUR ins
  // Formular, nicht direkt in plannedWorkouts - Nico sieht/prüft das
  // Ergebnis und speichert bewusst selbst (bestehender "Speichern"-Button
  // unten), kein automatischer Datenverlust bei einem unpassenden Vorschlag.
  const regenBtn = host.querySelector(".pe-regen-btn");
  const regenError = host.querySelector(".pe-regen-error");
  if (regenBtn) regenBtn.addEventListener("click", async () => {
    regenError.style.display = "none";
    regenBtn.disabled = true;
    const prevLabel = regenBtn.textContent;
    regenBtn.textContent = "Erstelle Vorschlag …";
    try {
      const suggestion = await generatePlannedWorkoutAlternative(p, "alternative");
      host.querySelector("#plan-edit-title").value = suggestion.title || "";
      host.querySelector("#plan-edit-duration").value = suggestion.duration_min ?? "";
      host.querySelector("#plan-edit-intensity").value = suggestion.intensity || "";
      host.querySelector("#plan-edit-desc").value = suggestion.description || "";
      const sportSelect = host.querySelector("#plan-edit-sport");
      if (suggestion.sport && sportSelect.value !== suggestion.sport) {
        sportSelect.value = suggestion.sport;
        sportSelect.dispatchEvent(new Event("change"));
      }
      const exList = host.querySelector("#plan-edit-exercises");
      if (exList) {
        exList.innerHTML = (suggestion.exercises || []).map((ex, i) => `
          <div class="plan-exercise-row" data-idx="${i}">
            <input type="text" class="coach-input plan-ex-name" value="${escapeHtml(ex.name || "")}" placeholder="Übung">
            <input type="text" class="coach-input plan-ex-sets" value="${escapeHtml(String(ex.sets ?? ""))}" placeholder="Sätze" style="max-width:70px;">
            <input type="text" class="coach-input plan-ex-reps" value="${escapeHtml(ex.reps || "")}" placeholder="Wdh." style="max-width:70px;">
            <button type="button" class="plan-ex-remove" data-idx="${i}" title="Entfernen">✕</button>
          </div>`).join("");
        wireExerciseRemove();
      }
      refreshPlanEditNutrition();
    } catch (e) {
      regenError.textContent = describeAiError(e, "plan");
      regenError.style.display = "";
    } finally {
      regenBtn.disabled = false;
      regenBtn.textContent = prevLabel;
    }
  });

  const exportBtn = host.querySelector(".plan-edit-export");
  if (exportBtn) exportBtn.addEventListener("click", () => exportPlannedWorkoutAsFit(id));

  const lessonsBtn = host.querySelector(".pe-lessons-btn");
  if (lessonsBtn) lessonsBtn.addEventListener("click", () => generateLessons(id));

  const deleteBtn = host.querySelector(".plan-edit-delete");
  if (deleteBtn) deleteBtn.addEventListener("click", () => {
    deletePlannedWorkout(id);
    closePlanEdit();
    renderTrainingPlanCard();
    renderCalendar();
  });

  host.querySelector(".plan-edit-save").addEventListener("click", async () => {
    // Live-Sportart-Auswahl entscheidet, nicht die beim Öffnen erfasste
    // isStrengthLike - die kann sich per Sportart-Wechsel geändert haben (s.o.).
    const currentSport = document.getElementById("plan-edit-sport").value;
    const currentlyStrengthLike = currentSport === "Kraft" || currentSport === "Mobility";
    const exercises = currentlyStrengthLike ? [...host.querySelectorAll(".plan-exercise-row")].map(row => ({
      name: row.querySelector(".plan-ex-name").value.trim(),
      sets: row.querySelector(".plan-ex-sets").value.trim() ? Number(row.querySelector(".plan-ex-sets").value.trim()) || null : null,
      reps: row.querySelector(".plan-ex-reps").value.trim() || null,
      note: null,
    })).filter(ex => ex.name) : null;
    const patch = {
      date: document.getElementById("plan-edit-date").value || p.date,
      sport: currentSport,
      title: document.getElementById("plan-edit-title").value.trim() || currentSport,
      duration_min: Number(document.getElementById("plan-edit-duration").value) || null,
      intensity: document.getElementById("plan-edit-intensity").value || null,
      description: document.getElementById("plan-edit-desc").value.trim() || null,
      exercises: exercises && exercises.length ? exercises : null,
    };
    if (isNew) {
      addPlannedWorkout({ ...patch, goalId: p.goalId, phase: p.phase, source: "manual" });
    } else {
      patch.status = statusVal;
      // Jede Änderung einer bestehenden Einheit (neues Datum, aber auch ein
      // übernommener "Alternativer Vorschlag" der KI) läuft durch das
      // Regelwerk; bei Abbruch bleibt der Dialog offen.
      const label = patch.date !== p.date ? "Trotzdem verschieben" : "Trotzdem speichern";
      if (!(await commitCheckedPlanChange(patchedPlannedWorkouts(plannedWorkouts, id, patch), label))) return;
    }
    closePlanEdit();
    renderTrainingPlanCard();
    renderCalendar();
  });

  document.getElementById("plan-edit-overlay").classList.add("open");
}

function closePlanEdit() {
  document.getElementById("plan-edit-overlay").classList.remove("open");
}

/* ---------- Regelprüfung bei Änderungen (Verschieben, Bearbeiten) ----------
   Eine geänderte Planliste wird erst nach validatePlan() (js/analytics/
   plan-rules.js) übernommen. Gezeigt wird nur, was die Änderung NEU
   verursacht: "warn" -> Rückfrage mit `okLabel` (z. B. "Trotzdem
   verschieben"); "block" -> so wird nichts gespeichert, der Knopf bietet
   stattdessen den Vorschlag des Regelwerks an (applyPlanSuggestion) und
   danach wird erneut geprüft. true = übernommen und gespeichert. */
const PLAN_CHANGE_MAX_ROUNDS = 4;

async function commitCheckedPlanChange(nextList, okLabel = "Trotzdem verschieben") {
  const before = planRuleViolations(plannedWorkouts);
  const goal = getPrimaryGoal();
  let next = nextList;
  for (let round = 0; ; round++) {
    const fresh = newPlanViolations(before, planRuleViolations(next));
    if (!fresh.length) break;
    const block = fresh.find(v => v.severity === "block");
    if (block && round >= PLAN_CHANGE_MAX_ROUNDS) return false;
    const intro = block ? "Das verstößt gegen eine Trainingsregel:" : "Bitte beachten:";
    const ordered = [...fresh].sort((a, b) => (a.severity === "block" ? 0 : 1) - (b.severity === "block" ? 0 : 1));
    const ok = await confirmDialog([intro, ...ordered.map(v => v.text)].join("\n\n"), { okLabel: block ? block.suggestion.text.replace(/\.$/, "") : okLabel, danger: false });
    if (!ok) return false;
    if (!block) break;
    next = applyPlanSuggestion(next, block.suggestion, { goalId: goal ? goal.id : null, source: "manual" });
    if (!next) return false;
  }
  replacePlannedWorkouts(next);
  return true;
}

/* ---------- Terminwünsche ("Ich möchte Donnerstag schwimmen") ----------
   Neben dem freien Wunschtext im ⚙-Menü der Trainingsplan-Kachel, Daten in
   js/data/plan-wishes.js. Der Status (offen/eingeplant) kommt aus dem Plan,
   deshalb zeichnet renderTrainingPlanCard() die Liste jedes Mal mit. */
function renderPlanWishList() {
  const host = document.getElementById("plan-wish-list");
  if (!host) return;
  const list = upcomingPlanWishes();
  if (!list.length) {
    host.innerHTML = `<p class="plan-wish-empty">Noch keine Terminwünsche.</p>`;
    return;
  }
  host.innerHTML = list.map(w => {
    const planned = isPlanWishPlanned(w);
    return `
      <div class="plan-wish-item">
        <div class="plan-wish-main">
          <span class="plan-wish-what">${fmtDateWeekday(new Date(w.date + "T00:00:00"))} · ${escapeHtml(w.sport)} · ${w.duration_min} min</span>
          ${w.note ? `<span class="plan-wish-note">${escapeHtml(w.note)}</span>` : ""}
        </div>
        <span class="plan-wish-state${planned ? " planned" : ""}">${planned ? "eingeplant" : "offen"}</span>
        <button type="button" class="plan-ex-remove plan-wish-delete" data-id="${w.id}" title="Wunsch löschen" aria-label="Wunsch löschen">✕</button>
      </div>`;
  }).join("");
  host.querySelectorAll(".plan-wish-delete").forEach(btn => btn.addEventListener("click", e => {
    // Sonst schließt der Klick das ⚙-Menü (der Knopf ist nach dem Neuzeichnen
    // nicht mehr im Popover, siehe initInfoPopovers).
    e.stopPropagation();
    deletePlanWish(btn.dataset.id);
    renderPlanWishList();
  }));
}

function initPlanWishForm() {
  const sportSelect = document.getElementById("plan-wish-sport");
  const addBtn = document.getElementById("plan-wish-add-btn");
  if (!sportSelect || !addBtn) return;
  sportSelect.innerHTML = PLAN_ALLOWED_SPORTS.map(s => `<option value="${s}">${s}</option>`).join("");
  const dateInput = document.getElementById("plan-wish-date");
  dateInput.min = todayStr();
  addBtn.addEventListener("click", () => {
    const status = document.getElementById("plan-wish-status");
    const wish = addPlanWish({
      date: dateInput.value,
      sport: sportSelect.value,
      duration_min: document.getElementById("plan-wish-duration").value,
      note: document.getElementById("plan-wish-note").value,
    });
    status.textContent = wish ? "✓ Gespeichert – kommt in die nächste Planung" : `Bitte Datum (ab heute), Sportart und Dauer (1–${PLAN_WISH_MAX_MIN} min) angeben.`;
    status.className = "coach-test-status " + (wish ? "ok" : "err");
    if (!wish) return;
    setTimeout(() => { status.textContent = ""; status.className = "coach-test-status"; }, 2500);
    document.getElementById("plan-wish-duration").value = "";
    document.getElementById("plan-wish-note").value = "";
    renderPlanWishList();
  });
  renderPlanWishList();
}

// "Erweiterte Einstellungen" (⚙ an der Trainingsplan-Kartenüberschrift) -
// freie Zusatzwünsche für die KI-Trainingsplan-Erstellung, persistiert im
// Athletenprofil (athleteProfile.customPlanWishes, siehe context-builder.js/
// prompts.js). Einmalig verkabelt (statisches Markup in index.html, wie
// initWorkoutColumnToggle für die Spaltenauswahl), nicht bei jedem Render.
function initTrainingPlanWishes() {
  const textarea = document.getElementById("trainingplan-custom-wishes");
  const saveBtn = document.getElementById("trainingplan-wishes-save-btn");
  const status = document.getElementById("trainingplan-wishes-status");
  if (!textarea || !saveBtn) return;
  textarea.value = athleteProfile.customPlanWishes || "";
  saveBtn.addEventListener("click", () => {
    athleteProfile.customPlanWishes = textarea.value.trim();
    saveAthleteProfile();
    if (status) {
      status.textContent = "✓ Gespeichert";
      status.className = "coach-test-status ok";
      setTimeout(() => { status.textContent = ""; status.className = "coach-test-status"; }, 2000);
    }
  });
}

function initPlanEditOverlay() {
  const closeBtn = document.getElementById("plan-edit-close");
  const overlay = document.getElementById("plan-edit-overlay");
  if (closeBtn) closeBtn.addEventListener("click", closePlanEdit);
  if (overlay) overlay.addEventListener("click", e => { if (e.target === overlay) closePlanEdit(); });
}
