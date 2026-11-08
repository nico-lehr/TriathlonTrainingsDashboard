// Formular "Neues Ziel" / "Ziel bearbeiten" (Coach-Tab, index.html #goal-form):
// Distanz-Vorlagen je Sportart, Staffel mit eigener Teilstrecke, Streckenart.
// Was gespeichert wird, rechnet goalRaceFields() (js/data/race-formats.js);
// angelegt bzw. geändert wird in addGoal() (js/data/goals.js).

let goalEditingId = null; // Ziel, das gerade bearbeitet wird (null = neues Ziel)

const goalFormEl = id => document.getElementById(id);

function goalFormSport() {
  return goalFormEl("goal-sport").value;
}

function goalFormRelay() {
  const r = document.querySelector('input[name="goal-relay"]:checked');
  return goalFormSport() === "Triathlon" && !!r && r.value === "relay";
}

function goalFormRelayLegs() {
  return [...document.querySelectorAll("#goal-relay-legs input:checked")].map(i => i.value);
}

// Auswahllisten "Distanz" und "Streckenart" passend zur Sportart füllen.
function goalFormFillSelects(format, terrain) {
  const sport = goalFormSport();
  const fmt = goalFormEl("goal-format");
  fmt.innerHTML = `<option value="">Eigene Distanz</option>` + raceFormatsFor(sport).map(f => {
    const km = f.legs ? `${fmtNum(f.legs.swim, 2)} / ${fmtNum(f.legs.bike, 0)} / ${fmtNum(f.legs.run, 1)} km` : null;
    return `<option value="${f.key}">${escapeHtml(f.label)}${km ? ` – ${km}` : ""}</option>`;
  }).join("");
  fmt.value = format != null && raceFormatsFor(sport).some(f => f.key === format) ? format : "";
  const ter = goalFormEl("goal-terrain");
  ter.innerHTML = `<option value="">– keine Angabe –</option>` + (RACE_TERRAINS[sport] || []).map(([k, l]) => `<option value="${k}">${escapeHtml(l)}</option>`).join("");
  ter.value = terrain && (RACE_TERRAINS[sport] || []).some(([k]) => k === terrain) ? terrain : "";
}

// Vorlage gewählt → Distanzfelder ausfüllen (bleiben danach änderbar).
function goalFormApplyFormat() {
  const f = raceFormatsFor(goalFormSport()).find(x => x.key === goalFormEl("goal-format").value);
  if (!f) return;
  if (f.legs) RACE_LEG_ORDER.forEach(k => { goalFormEl(`goal-sub-${k}-distance`).value = f.legs[k]; });
  else goalFormEl("goal-distance").value = f.km != null ? f.km : "";
}

// Distanz von Hand geändert und passt nicht mehr zur Vorlage → "Eigene Distanz".
function goalFormCheckCustom() {
  const f = raceFormatsFor(goalFormSport()).find(x => x.key === goalFormEl("goal-format").value);
  if (!f) return;
  const same = (a, b) => b == null || Math.abs(Number(a) - b) < 0.001;
  const fits = f.legs
    ? RACE_LEG_ORDER.every(k => same(goalFormEl(`goal-sub-${k}-distance`).value, f.legs[k]))
    : same(goalFormEl("goal-distance").value, f.km);
  if (!fits) goalFormEl("goal-format").value = "";
}

// Sichtbarkeit: Teilstrecken + Teilnahme nur beim Triathlon, die eigene
// Gesamtdistanz nur bei einer einzelnen Sportart; bei der Staffel sind die
// Teilstrecken der anderen als "Team" markiert.
function goalFormSync() {
  const tri = goalFormSport() === "Triathlon";
  const relay = goalFormRelay();
  const mine = goalFormRelayLegs();
  goalFormEl("goal-subdisciplines").style.display = tri ? "flex" : "none";
  goalFormEl("goal-relay-row").hidden = !tri;
  goalFormEl("goal-relay-legs-row").hidden = !relay;
  goalFormEl("goal-distance-row").hidden = tri;
  goalFormEl("goal-target-time-label").textContent = relay ? "Zielzeit Team gesamt (optional)" : "Zielzeit (optional)";
  document.querySelectorAll("#goal-subdisciplines .goal-subdiscipline-row").forEach(row => {
    row.classList.toggle("is-team", relay && mine.length > 0 && !mine.includes(row.dataset.leg));
  });
}

function goalFormSetRelay(relay, legs) {
  document.querySelectorAll('input[name="goal-relay"]').forEach(r => { r.checked = r.value === (relay ? "relay" : "solo"); });
  document.querySelectorAll("#goal-relay-legs input").forEach(i => { i.checked = !!legs && legs.includes(i.value); });
}

// Formular in den Ausgangszustand (neues Ziel, Standard-Vorlage der Sportart).
function resetGoalForm() {
  goalEditingId = null;
  goalFormEl("goal-form").reset();
  goalFormSetRelay(false, null);
  goalFormFillSelects("", null);
  goalFormEl("goal-form-title").textContent = "Neues Ziel";
  goalFormEl("goal-submit-btn").textContent = "Ziel hinzufügen";
  goalFormEl("goal-edit-cancel-btn").hidden = true;
  goalFormSync();
}

// Bestehendes Ziel ins Formular laden und die Formular-Kachel öffnen.
function openGoalEditor(id) {
  const goal = goals.find(g => g.id === id);
  if (!goal) return;
  resetGoalForm();
  goalEditingId = id;
  goalFormEl("goal-name").value = goal.name || "";
  goalFormEl("goal-sport").value = RACE_FORMATS[goal.sport] ? goal.sport : "Triathlon";
  goalFormEl("goal-date").value = goal.date || "";
  goalFormEl("goal-target-time").value = goal.targetTime || "";
  goalFormEl("goal-distance").value = goal.distanceKm != null ? goal.distanceKm : "";
  goalFormEl("goal-notes").value = goal.notes || "";
  goalFormFillSelects(goal.format || "", goal.terrain || null);
  RACE_LEG_ORDER.forEach(k => {
    const s = (goal.subDisciplines || []).find(x => x && x.key === k) || {};
    goalFormEl(`goal-sub-${k}-distance`).value = s.distanceKm != null ? s.distanceKm : "";
    goalFormEl(`goal-sub-${k}-time`).value = s.targetTime || "";
  });
  goalFormSetRelay(goalIsRelay(goal), goal.relayLegs);
  goalFormEl("goal-form-title").textContent = "Ziel bearbeiten";
  goalFormEl("goal-submit-btn").textContent = "Änderungen speichern";
  goalFormEl("goal-edit-cancel-btn").hidden = false;
  goalFormSync();
  showGoalFormCard(true);
}

function showGoalFormCard(show) {
  const card = goalFormEl("new-goal-card");
  const toggleBtn = goalFormEl("new-goal-toggle-btn");
  if (card) card.hidden = !show;
  if (toggleBtn) {
    toggleBtn.classList.toggle("active", show);
    toggleBtn.textContent = show ? "✕ Abbrechen" : "+ Neues Ziel/Event";
  }
  if (show && card) {
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const first = goalFormEl("goal-name");
    if (first) first.focus({ preventScroll: true });
  }
}

// Formular lesen → { name, sport, date, notes, ...goalRaceFields } oder
// { error } (z.B. Staffel ohne eigene Teilstrecke).
function readGoalForm() {
  const sport = goalFormSport();
  const relay = goalFormRelay();
  const relayLegs = goalFormRelayLegs();
  if (relay && !relayLegs.length) return { error: "Bitte wähle bei der Staffel aus, welche Teilstrecke du selbst machst." };
  if (relay && relayLegs.length === 3) return { error: "Bei einer Staffel machst du nicht alle drei Teilstrecken – sonst wähle „Allein“." };
  const legs = {};
  RACE_LEG_ORDER.forEach(k => {
    legs[k] = { distanceKm: goalFormEl(`goal-sub-${k}-distance`).value, targetTime: goalFormEl(`goal-sub-${k}-time`).value };
  });
  return {
    name: goalFormEl("goal-name").value.trim(),
    sport,
    date: goalFormEl("goal-date").value,
    notes: goalFormEl("goal-notes").value.trim() || null,
    ...goalRaceFields({
      sport, relay, relayLegs, legs,
      format: goalFormEl("goal-format").value,
      terrain: goalFormEl("goal-terrain").value,
      distanceKm: goalFormEl("goal-distance").value,
      targetTime: goalFormEl("goal-target-time").value,
    }),
  };
}

function initGoalForm() {
  const form = goalFormEl("goal-form");
  if (!form) return;
  goalFormEl("goal-sport").addEventListener("change", () => {
    goalFormFillSelects("", null);
    goalFormEl("goal-distance").value = "";
    goalFormSync();
  });
  goalFormEl("goal-format").addEventListener("change", () => { goalFormApplyFormat(); goalFormSync(); });
  ["goal-distance", ...RACE_LEG_ORDER.map(k => `goal-sub-${k}-distance`)].forEach(id => goalFormEl(id).addEventListener("input", goalFormCheckCustom));
  document.querySelectorAll('input[name="goal-relay"], #goal-relay-legs input').forEach(i => i.addEventListener("change", goalFormSync));
  goalFormEl("goal-edit-cancel-btn").addEventListener("click", () => { resetGoalForm(); showGoalFormCard(false); });
  resetGoalForm();
}
