// Karte "Dein Trainingsprofil" in den Einstellungen - alle Trainingswünsche
// an einer Stelle (Daten: js/data/training-profile.js). Jede Änderung wird
// sofort gespeichert; ein kurzes "Gespeichert" bestätigt es.

function openTrainingProfile() {
  openSettingsView();
  const card = document.getElementById("training-profile-card");
  if (card) requestAnimationFrame(() => card.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function initTrainingProfile() {
  const body = document.getElementById("training-profile-body");
  if (!body) return;
  let savedTimer = null;

  const chipGroup = (name, map, selected, label) => `
    <fieldset class="tp-group">
      <legend class="tp-label">${label}</legend>
      <div class="mob-chips" data-group="${name}">
        ${Object.entries(map).map(([id, text]) => `<button type="button" class="mob-chip${selected.includes(id) ? " is-on" : ""}" data-id="${id}" aria-pressed="${selected.includes(id)}">${escapeHtml(text)}</button>`).join("")}
      </div>
    </fieldset>`;

  const segmented = (name, values, current, suffix, label) => `
    <div class="tp-row">
      <span class="tp-label" id="tp-${name}-label">${label}</span>
      <div class="mob-segmented" data-seg="${name}" role="radiogroup" aria-labelledby="tp-${name}-label">
        ${values.map(v => `<button type="button" role="radio" aria-checked="${v === current}" class="${v === current ? "is-on" : ""}" data-value="${v}">${v}${suffix}</button>`).join("")}
      </div>
    </div>`;

  function render() {
    const tp = trainingProfile();
    body.innerHTML = `
      <div class="tp-section">
        <label class="tp-label" for="tp-goals">Was möchtest du erreichen?</label>
        <textarea id="tp-goals" class="coach-input tp-textarea" rows="2" placeholder="z. B. Hüfte lockerer für die Aero-Position, nach dem Laufen weniger steife Waden">${escapeHtml(tp.goals)}</textarea>
      </div>
      ${chipGroup("focusAreas", MOBILITY_AREAS, tp.focusAreas, "Wo möchtest du beweglicher werden?")}
      ${chipGroup("painAreas", MOBILITY_AREAS, tp.painAreas, "Wo hast du Beschwerden? <span class=\"tp-hint\">Dort wird nur sanft gearbeitet.</span>")}
      <div class="tp-section">
        <label class="tp-label" for="tp-limitations">Verletzungen oder Einschränkungen</label>
        <textarea id="tp-limitations" class="coach-input tp-textarea" rows="2" placeholder="z. B. Knie nach Meniskus-OP, Schulter links empfindlich">${escapeHtml(athleteProfile.limitations || "")}</textarea>
      </div>
      ${chipGroup("avoid", MOBILITY_AVOID, tp.avoid, "Was soll nicht vorkommen?")}
      ${chipGroup("equipment", MOBILITY_EQUIPMENT, tp.equipment, "Was hast du zu Hause? <span class=\"tp-hint\">Eine Matte oder Teppich reicht immer.</span>")}
      <div class="tp-section tp-mobility">
        <div class="tp-row tp-switch-row">
          <label class="tp-label" for="tp-include-mobility">Mobility in den Trainingsplan einbauen</label>
          <input type="checkbox" id="tp-include-mobility" class="switch" role="switch" ${athleteProfile.includeMobility ? "checked" : ""}>
        </div>
        ${segmented("mobilityPerWeek", [1, 2, 3, 4], tp.mobilityPerWeek, "×", "Pro Woche")}
        ${segmented("mobilityMinutes", [10, 15, 20, 30], tp.mobilityMinutes, " Min", "Dauer")}
      </div>
      <div class="tp-section">
        <label class="tp-label" for="tp-wishes">Weitere Wünsche an deinen Trainingsplan</label>
        <textarea id="tp-wishes" class="coach-input tp-textarea" rows="2" placeholder="z. B. montags kein Rad, 1× pro Woche Zugseil">${escapeHtml(athleteProfile.customPlanWishes || "")}</textarea>
      </div>
      <p class="tp-saved" id="tp-saved" role="status" aria-live="polite"></p>`;
    bind();
  }

  function saved() {
    const el = document.getElementById("tp-saved");
    if (!el) return;
    el.textContent = "Gespeichert";
    el.classList.add("is-visible");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => el.classList.remove("is-visible"), 1600);
    if (typeof renderMobilityView === "function") renderMobilityView({ keepSession: true });
  }

  function bind() {
    body.querySelectorAll(".mob-chips[data-group]").forEach(group => {
      group.addEventListener("click", e => {
        const chip = e.target.closest(".mob-chip");
        if (!chip) return;
        const on = !chip.classList.contains("is-on");
        chip.classList.toggle("is-on", on);
        chip.setAttribute("aria-pressed", String(on));
        const ids = [...group.querySelectorAll(".mob-chip.is-on")].map(c => c.dataset.id);
        saveTrainingProfile({ [group.dataset.group]: ids });
        saved();
      });
    });
    body.querySelectorAll(".mob-segmented[data-seg]").forEach(seg => {
      seg.addEventListener("click", e => {
        const btn = e.target.closest("button[data-value]");
        if (!btn) return;
        seg.querySelectorAll("button").forEach(b => { b.classList.toggle("is-on", b === btn); b.setAttribute("aria-checked", String(b === btn)); });
        saveTrainingProfile({ [seg.dataset.seg]: Number(btn.dataset.value) });
        saved();
      });
    });
    const text = (id, apply) => {
      const el = document.getElementById(id);
      el.addEventListener("change", () => { apply(el.value.trim()); saved(); });
    };
    text("tp-goals", v => saveTrainingProfile({ goals: v.slice(0, 500) }));
    text("tp-limitations", v => { athleteProfile.limitations = v || null; saveAthleteProfile(); });
    text("tp-wishes", v => { athleteProfile.customPlanWishes = v; saveAthleteProfile(); });
    document.getElementById("tp-include-mobility").addEventListener("change", e => {
      athleteProfile.includeMobility = e.target.checked;
      saveAthleteProfile();
      const old = document.getElementById("profile-include-mobility");
      if (old) old.checked = e.target.checked;
      saved();
    });
  }

  // Die alte Checkbox ("Planung"-Karte) bleibt synchron.
  const old = document.getElementById("profile-include-mobility");
  if (old) old.addEventListener("change", () => { const sw = document.getElementById("tp-include-mobility"); if (sw) sw.checked = old.checked; });
  render();
  window.renderTrainingProfile = render; // nach Onboarding/Server-Abgleich neu zeichnen
}
