// Erholungs-Check-UI (Chips fuer Muskelkater/Energie/Verletzung + Status-Badge)
// im Coach-Tab. Nutzt den Zustand aus js/data/health.js.

function recoveryChipGroup(groupId, options, key) {
  const el = document.getElementById(groupId);
  el.innerHTML = options.map(o =>
    `<button type="button" class="onb-radio-chip recovery-chip${recoveryCheck[key] === o.value ? " selected" : ""}" data-value="${o.value}">${o.label}</button>`
  ).join("");
  el.querySelectorAll(".recovery-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      recoveryCheck[key] = btn.dataset.value;
      saveRecoveryCheck();
      renderRecoveryCheck();
    });
  });
}

function updateRecoveryBadge() {
  const badge = document.getElementById("recovery-status-badge");
  if (!badge) return;
  const bad = recoveryCheck.injury === "yes" || recoveryCheck.soreness === "severe" || recoveryCheck.energy === "low";
  const caution = recoveryCheck.soreness === "moderate" || recoveryCheck.energy === "reduced";
  const untouched = !recoveryCheck.soreness && !recoveryCheck.energy && recoveryCheck.injury === "no";
  let cls = "ok", dot = "#0a7a0a", text = "Bereit";
  if (bad) { cls = "risk"; dot = "#b13030"; text = "Vorsicht geboten"; }
  else if (caution) { cls = "watch"; dot = "#93650a"; text = "Angeschlagen"; }
  else if (untouched) { cls = "muted"; dot = ""; text = "Noch nicht ausgefüllt"; }
  badge.innerHTML = untouched
    ? `<span class="load-status muted">${text}</span>`
    : `<span class="load-status ${cls}"><span class="dot" style="background:${dot}"></span>${text}</span>`;
  // Erholungs-Check kann die Streak einfrieren (siehe streak.js) - Coach-
  // Zusammenfassung ganz oben deshalb bei jeder Änderung mit auffrischen.
  if (typeof renderCoachSummary === "function") renderCoachSummary();
}

function renderRecoveryCheck() {
  recoveryChipGroup("recovery-soreness-group", RECOVERY_SORENESS_OPTIONS, "soreness");
  recoveryChipGroup("recovery-energy-group", RECOVERY_ENERGY_OPTIONS, "energy");
  recoveryChipGroup("recovery-injury-group", RECOVERY_INJURY_OPTIONS, "injury");

  const locRow = document.getElementById("recovery-soreness-location-row");
  const locInput = document.getElementById("recovery-soreness-location");
  const showLoc = recoveryCheck.soreness && recoveryCheck.soreness !== "none";
  locRow.style.display = showLoc ? "block" : "none";
  if (locInput.value !== (recoveryCheck.sorenessLocation || "")) locInput.value = recoveryCheck.sorenessLocation || "";
  locInput.onchange = () => {
    recoveryCheck.sorenessLocation = locInput.value.trim() || null;
    saveRecoveryCheck();
  };

  const noteRow = document.getElementById("recovery-injury-note-row");
  const noteInput = document.getElementById("recovery-injury-note");
  noteRow.style.display = recoveryCheck.injury === "yes" ? "block" : "none";
  if (noteInput.value !== (recoveryCheck.injuryNote || "")) noteInput.value = recoveryCheck.injuryNote || "";
  noteInput.onchange = () => {
    recoveryCheck.injuryNote = noteInput.value.trim() || null;
    saveRecoveryCheck();
  };
  updateRecoveryBadge();
}

// Blendet den Coach-Bereich frei (Onboarding erledigt oder übersprungen).
