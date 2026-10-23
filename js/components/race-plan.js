// "Rennplan" je Ziel im Coach-Tab: aufklappbarer Bereich in den Ziel-Details
// (wie "Erweiterte Einstellungen", buildGoalAdvancedHtml in coach.js) mit
// Pacing, den Checklisten Wechselzone/Ausrüstung und Verpflegung sowie der
// Rennwoche. Berechnung und Standard-Listen: js/analytics/race-plan.js.

function racePlanItemHtml(goalId, list, item, idx) {
  const data = `data-id="${goalId}" data-list="${list}" data-idx="${idx}"`;
  return `
    <div class="race-plan-item${item.done ? " done" : ""}">
      <input type="checkbox" class="race-plan-check" ${data}${item.done ? " checked" : ""} aria-label="Erledigt">
      <span class="race-plan-text" contenteditable="true" role="textbox" ${data} title="Antippen zum Ändern" aria-label="Eintrag (antippen zum Ändern)">${escapeHtml(item.text)}</span>
      <button type="button" class="plan-ex-remove race-plan-remove" ${data} title="Eintrag löschen" aria-label="Eintrag löschen">✕</button>
    </div>`;
}

function racePlanAddHtml(goalId, list, dayOptionsHtml) {
  return `
    <div class="race-plan-add">
      ${dayOptionsHtml ? `<select class="coach-input race-plan-add-day" aria-label="Tag">${dayOptionsHtml}</select>` : ""}
      <input type="text" class="coach-input race-plan-add-text" maxlength="${RACE_PLAN_TEXT_MAX}" placeholder="Neuer Punkt" aria-label="Neuer Punkt">
      <button type="button" class="chip race-plan-add-btn" data-id="${goalId}" data-list="${list}">+ Hinzufügen</button>
    </div>`;
}

function racePlanChecklistHtml(goalId, title, list, items) {
  return `
    <div class="race-plan-section">
      <h4>${title}</h4>
      ${items.map((it, idx) => racePlanItemHtml(goalId, list, it, idx)).join("") || `<p class="race-plan-empty">Noch keine Punkte.</p>`}
      ${racePlanAddHtml(goalId, list)}
    </div>`;
}

function racePacingHtml(goal) {
  const legs = computeRacePacing(goal);
  if (!legs.length) return `<p class="race-plan-empty">Für diese Sportart gibt es kein Pacing.</p>`;
  return legs.map(leg => `
    <div class="race-plan-pace-row">
      <span class="sport-dot" style="background:${sportColor(leg.sport)}"></span>
      <span class="race-plan-pace-label">${leg.label}</span>
      ${leg.text
        ? `<b class="race-plan-pace-value">${leg.text}</b><span class="race-plan-pace-basis">${fmtNum(leg.distanceKm, 1)} km in ${fmtDurationClock(leg.seconds)}</span>`
        : `<span class="race-plan-missing">${escapeHtml(leg.missing.join(" · "))}</span>`}
    </div>`).join("");
}

function raceWeekHtml(goal, plan) {
  const days = raceWeekDays(goal, plannedWorkouts, plan.raceWeek);
  if (!days.length) return `<div class="race-plan-section"><h4>Rennwoche</h4><p class="race-plan-empty">Ohne Renndatum gibt es keine Rennwoche.</p></div>`;
  const offsetLabel = offset => (offset === 0 ? "Renntag" : `${-offset} ${offset === -1 ? "Tag" : "Tage"} vorher`);
  const dayOptions = days.map(d => `<option value="${d.offset}"${d.offset === -1 ? " selected" : ""}>${fmtDateWeekday(new Date(d.date + "T00:00:00"))} · ${offsetLabel(d.offset)}</option>`).join("");
  return `
    <div class="race-plan-section race-week">
      <h4>Rennwoche</h4>
      ${days.map(d => `
        <div class="race-week-day${d.offset === 0 ? " race-week-raceday" : ""}">
          <div class="race-week-day-head"><b>${fmtDateWeekday(new Date(d.date + "T00:00:00"))}</b><span>${offsetLabel(d.offset)}</span></div>
          ${d.sessions.length ? `<div class="cal-planned-list">${d.sessions.map(calPlannedChipHtml).join("")}</div>` : ""}
          ${d.items.map(it => racePlanItemHtml(goal.id, "raceWeek", it, it.idx)).join("")}
          ${!d.sessions.length && !d.items.length ? `<p class="race-plan-empty">Nichts geplant.</p>` : ""}
        </div>`).join("")}
      ${racePlanAddHtml(goal.id, "raceWeek", dayOptions)}
    </div>`;
}

function buildRacePlanHtml(goal) {
  const open = !!goal._racePlanOpen;
  if (!open) {
    return `<div class="goal-adv"><button type="button" class="chip race-plan-toggle-btn" data-id="${goal.id}">Rennplan</button></div>`;
  }
  const plan = racePlanOf(goal);
  return `
    <div class="goal-adv">
      <button type="button" class="chip race-plan-toggle-btn" data-id="${goal.id}">Rennplan ausblenden</button>
      <div class="goal-adv-body race-plan">
        <div class="race-plan-section">
          <h4>Pacing</h4>
          ${racePacingHtml(goal)}
          <p class="race-plan-note">Gleichmäßiges Tempo aus Distanz und Zielzeit des Ziels.</p>
        </div>
        ${racePlanChecklistHtml(goal.id, raceTransitionTitle(goal), "transition", plan.transition)}
        ${racePlanChecklistHtml(goal.id, "Verpflegung", "nutrition", plan.nutrition)}
        ${raceWeekHtml(goal, plan)}
      </div>
    </div>`;
}

// Ändert eine Kopie des Rennplans und speichert sie im Ziel (setGoalRacePlan);
// rerender = false nur, wenn der Bildschirm die Änderung schon zeigt.
function changeRacePlan(goalId, mutate, rerender = true) {
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return;
  const plan = racePlanOf(goal);
  mutate(plan);
  setGoalRacePlan(goalId, plan, rerender);
}

// Ereignisse im frisch gezeichneten Ziele-Container (renderGoals, coach.js).
function wireRacePlan(rootEl) {
  rootEl.querySelectorAll(".race-plan-toggle-btn").forEach(btn => btn.addEventListener("click", () => {
    const goal = goals.find(g => g.id === btn.dataset.id);
    if (!goal) return;
    goal._racePlanOpen = !goal._racePlanOpen;
    renderGoals();
  }));
  const at = el => [el.dataset.id, el.dataset.list, Number(el.dataset.idx)];
  rootEl.querySelectorAll(".race-plan-check").forEach(input => input.addEventListener("change", () => {
    const [id, list, idx] = at(input);
    changeRacePlan(id, plan => { if (plan[list][idx]) plan[list][idx].done = input.checked; });
  }));
  // Text direkt im Eintrag ändern (bricht anders als ein Eingabefeld um, auch
  // auf dem Handy bleibt alles lesbar); Enter oder Wegtippen speichert.
  // Ein geänderter Text wird nur gespeichert, nicht neu gezeichnet: blur kommt
  // zwischen mousedown und click des nächsten Klicks (Haken, ✕, Hinzufügen) -
  // neu zeichnen würde diesen Klick verschlucken. Nur ein geleerter Text
  // löscht den Punkt und zeichnet neu.
  rootEl.querySelectorAll(".race-plan-text").forEach(el => {
    el.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } });
    el.addEventListener("blur", () => {
      const [id, list, idx] = at(el);
      const goal = goals.find(g => g.id === id);
      const item = goal && racePlanOf(goal)[list][idx];
      const text = el.textContent.replace(/\s+/g, " ").trim().slice(0, RACE_PLAN_TEXT_MAX);
      if (!item || text === item.text) return;
      if (!text) {
        changeRacePlan(id, plan => { plan[list].splice(idx, 1); });
        return;
      }
      if (el.textContent !== text) el.textContent = text; // so anzeigen, wie gespeichert
      changeRacePlan(id, plan => { plan[list][idx].text = text; }, false);
    });
  });
  rootEl.querySelectorAll(".race-plan-remove").forEach(btn => btn.addEventListener("click", () => {
    const [id, list, idx] = at(btn);
    changeRacePlan(id, plan => { plan[list].splice(idx, 1); });
  }));
  rootEl.querySelectorAll(".race-plan-add").forEach(row => {
    const textInput = row.querySelector(".race-plan-add-text");
    const btn = row.querySelector(".race-plan-add-btn");
    const add = () => {
      const text = textInput.value.trim().slice(0, RACE_PLAN_TEXT_MAX);
      if (!text) { textInput.focus(); return; }
      const daySelect = row.querySelector(".race-plan-add-day");
      const item = daySelect ? { text, done: false, dayOffset: Number(daySelect.value) } : { text, done: false };
      changeRacePlan(btn.dataset.id, plan => { plan[btn.dataset.list].push(item); });
    };
    btn.addEventListener("click", add);
    textInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  });
  // Geplante Einheiten der Rennwoche öffnen dasselbe Bearbeiten-Fenster wie im Kalender.
  rootEl.querySelectorAll(".race-week .cal-planned-chip").forEach(chip => chip.addEventListener("click", () => openPlanEdit(chip.dataset.id)));
}

// Die Rennwoche zeigt geplante Einheiten: renderCalendar() (läuft nach jeder
// Plan-Änderung) frischt offene Rennpläne deshalb mit auf.
function refreshOpenRacePlans() {
  if (goals.some(g => g._racePlanOpen)) renderGoals();
}
