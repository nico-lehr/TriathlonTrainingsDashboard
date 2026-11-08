// Karte "Dein Trainingsprofil" in den Einstellungen - alle Trainingswünsche
// an einer Stelle (Daten: js/data/training-profile.js). Jede Änderung wird
// sofort gespeichert; ein kurzes "Gespeichert" bestätigt es.

function openTrainingProfile() {
  openSettingsPanel("training");
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

  // Körperstellen, Ausstattung ... nur auf Wunsch aufklappen (bleibt offen).
  let tpMoreOpen = false;
  const tpMoreSummary = tp => {
    const n = tp.focusAreas.length + tp.painAreas.length + tp.avoid.length + tp.equipment.length;
    return n ? `${n} ${n === 1 ? "Angabe" : "Angaben"} – Körperstellen, Beschwerden, Ausstattung` : "Körperstellen, Beschwerden, Ausstattung";
  };

  // Wochenplan: was früher nur im Onboarding ging - jetzt jederzeit änderbar.
  // Wird bei jedem neuen KI-Plan fest geprüft (js/analytics/plan-structure.js).
  const dayChips = (field, selected, allowed) => `
      <div class="mob-chips wp-days" data-wp-days="${field}">
        ${WEEKDAYS.map(([id, text]) => {
          const on = selected.includes(id), ok = !allowed || allowed.includes(id);
          return `<button type="button" class="mob-chip${on ? " is-on" : ""}" data-id="${id}" aria-pressed="${on}"${ok ? "" : " disabled"}>${text}</button>`;
        }).join("")}
      </div>`;
  const choice = (field, options, current, label, hint = "", wide = false) => `
    <div class="tp-row${wide ? " wp-col" : ""}">
      <span class="tp-label" id="wp-${field}-label">${label}${hint ? `<small class="tp-hint">${hint}</small>` : ""}</span>
      <div class="mob-segmented${wide ? " mob-segmented-lg" : ""}" data-wp="${field}" role="radiogroup" aria-labelledby="wp-${field}-label">
        ${options.map(([v, t]) => `<button type="button" role="radio" aria-checked="${v === current}" class="${v === current ? "is-on" : ""}" data-value="${v}">${t}</button>`).join("")}
      </div>
    </div>`;
  const DISCIPLINES = [["Schwimmen", "Schwimmen"], ["Rad", "Rad"], ["Laufen", "Laufen"]];

  // Was die App aus dem Kraft-Wunsch herausliest - damit man sieht, dass es ankommt.
  function strengthWishSummary(text) {
    const w = strengthWishParse(text);
    const focus = typeof STRENGTH_AREAS !== "undefined" ? w.focus.map(id => STRENGTH_AREAS[id]).filter(Boolean) : [];
    const bits = [];
    if (focus.length) bits.push(`Schwerpunkt ${focus.join(", ")} – je 2 Übungen in jeder Kraft-Einheit`);
    if (w.goal === "athletic") bits.push("mehr Sätze für Muskelaufbau");
    return bits.length ? `Erkannt: ${bits.join(" · ")}` : "Der ganze Text geht an den Coach.";
  }

  function weekPlanHtml() {
    const p = athleteProfile;
    const tp = trainingProfile();
    const strengthWish = /kraft|muskel|hantel|athletisch|bankdr|liegestütz/i.test(`${p.customPlanWishes || ""} ${tp.goals || ""} ${tp.strengthWish || ""} ${(typeof goals !== "undefined" ? goals : []).map(g => g.notes || "").join(" ")}`);
    const days = p.trainingDays || [];
    const hint = !days.length ? `<p class="tp-intro wp-warn">Wähle deine Trainingstage – sonst plant der Coach an beliebigen Tagen.</p>` : "";
    return `
      <h3 class="pf-group">Wochenplan</h3>
      <p class="tp-intro">So baut der Coach deine Woche. Jeder neue Plan wird danach geprüft und angepasst.</p>
      ${hint}
      <div class="tp-section">
        <span class="tp-label">Trainingstage</span>
        ${dayChips("trainingDays", days, null)}
      </div>
      <div class="tp-section">
        <span class="tp-label">Schwimmtage<small class="tp-hint">Schwimmen nur an diesen Tagen</small></span>
        ${dayChips("swimDays", p.swimDays || [], days.length ? days : null)}
      </div>
      <div class="tp-section">
        <span class="tp-label">Lange Einheit<small class="tp-hint">Langer Lauf oder lange Radfahrt</small></span>
        ${dayChips("longDays", p.longDays || [], days.length ? days : null)}
      </div>
      <div class="tp-section">
        ${choice("mainPerDay", [[1, "1"], [2, "2"]], Number(p.mainPerDay) === 2 ? 2 : 1, "Haupttrainings pro Tag", "Schwimmen, Rad oder Laufen")}
        ${choice("extrasMode", [["same", "Zusätzlich"], ["own", "Eigener Tag"]], p.extrasMode === "own" ? "own" : "same", "Kraft & Mobility", p.extrasMode === "own" ? "Nur an Tagen ohne Haupttraining" : "Höchstens eine zusätzlich am Tag", true)}
        ${strengthWish && !p.includeStrength ? `<div class="wp-note"><span>Du wünschst dir Krafttraining, aber „Krafttraining einplanen“ ist aus – dann plant der Coach keins.</span><button type="button" class="cal-today-btn" id="wp-strength-on">Einschalten</button></div>` : ""}
        <div class="${p.includeStrength ? "" : "wp-off"}">
          ${choice("strengthPerWeek", [[1, "1×"], [2, "2×"], [3, "3×"]], [1, 2, 3].includes(Number(p.strengthPerWeek)) ? Number(p.strengthPerWeek) : 2, "Kraft pro Woche", p.includeStrength ? "" : "Erst oben „Krafttraining einplanen“ einschalten")}
        </div>
        <div class="tp-row">
          <label class="tp-label" for="wp-session-min">Übliche Dauer<small class="tp-hint">Eine normale Einheit</small></label>
          <span class="pf-input-wrap"><input type="number" id="wp-session-min" class="pf-input" min="15" max="240" step="5" placeholder="45" value="${p.typicalSessionMin || ""}"><span class="pf-unit">min</span></span>
        </div>
      </div>
      <h3 class="pf-group">Über dich</h3>
      <div class="tp-section">
        ${choice("experienceLevel", [["<1", "unter 1 Jahr"], ["1-3", "1–3 Jahre"], [">3", "über 3 Jahre"]], p.experienceLevel, "Erfahrung im Ausdauersport", "", true)}
        ${choice("raceExperience", [["none", "Keine"], ["few", "1–3"], ["some", "4–10"], ["many", "10+"]], p.raceExperience, "Wettkämpfe bisher", "", true)}
        ${choice("strongDiscipline", DISCIPLINES, p.strongDiscipline, "Stärkste Disziplin", "", true)}
        ${choice("weakDiscipline", DISCIPLINES, p.weakDiscipline, "Schwächste Disziplin", "", true)}
      </div>
      <div class="sh-actions wp-actions"><button type="button" class="reset-link" id="wp-onboarding-btn">Einrichtung noch einmal durchgehen</button></div>`;
  }

  function bindWeekPlan() {
    body.querySelectorAll("[data-wp-days]").forEach(group => {
      group.addEventListener("click", e => {
        const chip = e.target.closest(".mob-chip");
        if (!chip || chip.disabled) return;
        const field = group.dataset.wpDays;
        const set = new Set(athleteProfile[field] || []);
        if (set.has(chip.dataset.id)) set.delete(chip.dataset.id); else set.add(chip.dataset.id);
        const order = WEEKDAYS.map(([id]) => id);
        athleteProfile[field] = order.filter(d => set.has(d));
        if (field === "trainingDays") {
          // Tag rausgenommen -> Schwimmtag/lange Einheit dort auch raus
          const days = athleteProfile.trainingDays;
          athleteProfile.trainingDaysPerWeek = days.length || null;
          athleteProfile.swimDays = (athleteProfile.swimDays || []).filter(d => days.includes(d));
          athleteProfile.longDays = (athleteProfile.longDays || []).filter(d => days.includes(d));
        }
        saveAthleteProfile();
        render();
        saved();
      });
    });
    body.querySelectorAll(".mob-segmented[data-wp]").forEach(seg => {
      seg.addEventListener("click", e => {
        const btn = e.target.closest("button[data-value]");
        if (!btn) return;
        const field = seg.dataset.wp;
        const numeric = ["mainPerDay", "strengthPerWeek"].includes(field);
        let value = numeric ? Number(btn.dataset.value) : btn.dataset.value;
        // Erfahrung/Disziplin: nochmal tippen = Auswahl aufheben
        if (!numeric && field !== "extrasMode" && athleteProfile[field] === value) value = null;
        athleteProfile[field] = value;
        if (field === "strongDiscipline" && value && athleteProfile.weakDiscipline === value) athleteProfile.weakDiscipline = null;
        if (field === "weakDiscipline" && value && athleteProfile.strongDiscipline === value) athleteProfile.strongDiscipline = null;
        saveAthleteProfile();
        render();
        saved();
      });
    });
    const min = document.getElementById("wp-session-min");
    let timer = null;
    const commit = () => {
      const v = Number(min.value);
      athleteProfile.typicalSessionMin = v > 0 ? Math.min(240, Math.max(15, Math.round(v))) : null;
      saveAthleteProfile();
      saved();
    };
    min.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(commit, 700); });
    min.addEventListener("change", () => { clearTimeout(timer); commit(); });
    const on = document.getElementById("wp-strength-on");
    if (on) on.addEventListener("click", () => {
      athleteProfile.includeStrength = true;
      saveAthleteProfile();
      const sw = document.getElementById("profile-include-strength");
      if (sw) sw.checked = true;
      render();
      saved();
    });
    document.getElementById("wp-onboarding-btn").addEventListener("click", () => { if (typeof openOnboarding === "function") openOnboarding(); });
  }

  function render() {
    const tp = trainingProfile();
    body.innerHTML = `
      ${weekPlanHtml()}
      <h3 class="pf-group">Mobility</h3>
      <div class="tp-section tp-mobility${athleteProfile.includeMobility ? "" : " is-off"}">
        <div class="tp-row tp-switch-row">
          <label class="tp-label" for="tp-include-mobility">Mobility einplanen</label>
          <input type="checkbox" id="tp-include-mobility" class="switch" role="switch" ${athleteProfile.includeMobility ? "checked" : ""}>
        </div>
        ${segmented("mobilityPerWeek", [1, 2, 3, 4], tp.mobilityPerWeek, "×", "Pro Woche")}
        ${segmented("mobilityMinutes", [10, 15, 20, 30], tp.mobilityMinutes, " Min", "Dauer")}
      </div>
      <h3 class="pf-group tp-wish-head">Deine Wünsche</h3>
      <p class="tp-intro">Fließen in jeden Plan ein.</p>
      <div class="tp-section">
        <label class="tp-label" for="tp-goals">Was möchtest du erreichen?</label>
        <textarea id="tp-goals" class="coach-input tp-textarea" rows="2" placeholder="z. B. Hüfte lockerer für die Aero-Position, nach dem Laufen weniger steife Waden">${escapeHtml(tp.goals)}</textarea>
      </div>
      <div class="tp-section">
        <label class="tp-label" for="tp-strength-wish">Was möchtest du mit dem Krafttraining erreichen?</label>
        <textarea id="tp-strength-wish" class="coach-input tp-textarea" rows="2" placeholder="z. B. athletischer Körper, Fokus auf Schultern und Brust">${escapeHtml(tp.strengthWish)}</textarea>
        <p class="tp-hint tp-strength-parsed" id="tp-strength-parsed">${strengthWishSummary(tp.strengthWish)}</p>
      </div>
      <div class="tp-section">
        <label class="tp-label" for="tp-limitations">Verletzungen oder Einschränkungen</label>
        <textarea id="tp-limitations" class="coach-input tp-textarea" rows="2" placeholder="z. B. Knie nach Meniskus-OP, Schulter links empfindlich">${escapeHtml(athleteProfile.limitations || "")}</textarea>
      </div>
      <div class="tp-section">
        <label class="tp-label" for="tp-wishes">Weitere Wünsche an deinen Trainingsplan</label>
        <textarea id="tp-wishes" class="coach-input tp-textarea" rows="2" placeholder="z. B. montags kein Rad, 1× pro Woche Zugseil">${escapeHtml(athleteProfile.customPlanWishes || "")}</textarea>
      </div>
      <details class="tp-more"${tpMoreOpen ? " open" : ""}>
        <summary><span>Mobility genauer einstellen<small>${escapeHtml(tpMoreSummary(tp))}</small></span></summary>
        ${chipGroup("focusAreas", MOBILITY_AREAS, tp.focusAreas, "Wo möchtest du beweglicher werden?")}
        ${chipGroup("painAreas", MOBILITY_AREAS, tp.painAreas, "Wo hast du Beschwerden? <span class=\"tp-hint\">Dort wird nur sanft gearbeitet.</span>")}
        ${chipGroup("avoid", MOBILITY_AVOID, tp.avoid, "Was soll nicht vorkommen?")}
        ${chipGroup("equipment", MOBILITY_EQUIPMENT, tp.equipment, "Was hast du zu Hause? <span class=\"tp-hint\">Eine Matte oder Teppich reicht immer.</span>")}
      </details>
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
    bindWeekPlan();
    const more = body.querySelector(".tp-more");
    if (more) more.addEventListener("toggle", () => { tpMoreOpen = more.open; });
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
      let timer = null; // schon beim Tippen speichern, nicht erst beim Verlassen des Felds
      el.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => apply(el.value.trim()), 800); });
      el.addEventListener("change", () => { clearTimeout(timer); apply(el.value.trim()); saved(); });
    };
    text("tp-goals", v => saveTrainingProfile({ goals: v.slice(0, 500) }));
    text("tp-strength-wish", v => saveTrainingProfile({ strengthWish: v.slice(0, 500) }));
    const sw = document.getElementById("tp-strength-wish"), swOut = document.getElementById("tp-strength-parsed");
    sw.addEventListener("input", () => { swOut.textContent = strengthWishSummary(sw.value); });
    text("tp-limitations", v => { athleteProfile.limitations = v || null; saveAthleteProfile(); });
    text("tp-wishes", v => { athleteProfile.customPlanWishes = v; saveAthleteProfile(); });
    document.getElementById("tp-include-mobility").addEventListener("change", e => {
      athleteProfile.includeMobility = e.target.checked;
      e.target.closest(".tp-mobility").classList.toggle("is-off", !e.target.checked);
      saveAthleteProfile();
      const old = document.getElementById("profile-include-mobility");
      if (old) old.checked = e.target.checked;
      saved();
    });
  }

  // Die alte Checkbox ("Planung"-Karte) bleibt synchron.
  const old = document.getElementById("profile-include-mobility");
  if (old) old.addEventListener("change", () => { const sw = document.getElementById("tp-include-mobility"); if (sw) sw.checked = old.checked; });
  // Kraft an/aus oben -> "Kraft pro Woche" frei-/ausgrauen
  const strength = document.getElementById("profile-include-strength");
  if (strength) strength.addEventListener("change", () => setTimeout(render, 0));
  render();
  window.renderTrainingProfile = render; // nach Onboarding/Server-Abgleich neu zeichnen
}
