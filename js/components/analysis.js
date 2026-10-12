// Analyse-Tab: Triathlon-Auswertungen (Berechnung in js/analytics/triathlon.js).
// Nutzt immer die volle Historie (DATA), nicht den Zeitraum-Filter der
// Übersicht - die Filterleiste gibt es nur dort.

const ANALYSIS_SPORT_CLASS = { Schwimmen: "ana-swim", Rad: "ana-bike", Laufen: "ana-run" };

let analysisBalanceMode = "week"; // "week" | "month", umschaltbar per Chip

const anaPct = v => `${fmtNum(v, 0)}&nbsp;%`; // Prozent ohne Zeilenumbruch vor dem "%"

function renderAnalysis() {
  renderSportBalanceCard();
}

function initAnalysis() {
  document.querySelectorAll("#analysis-balance-mode .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      analysisBalanceMode = chip.dataset.mode;
      document.querySelectorAll("#analysis-balance-mode .chip").forEach(c => c.classList.toggle("active", c === chip));
      renderSportBalanceCard();
    });
  });
  const settingsLink = document.getElementById("analysis-balance-settings-link");
  if (settingsLink) settingsLink.addEventListener("click", () => {
    openSettingsView();
    document.getElementById("profile-balance-card").scrollIntoView({ block: "center" });
  });
  initSportBalanceSettings();
}

/* ---------- Sport-Balance ---------- */

// Zielverteilung in den Einstellungen: gespeichert wird nur eine gültige
// Verteilung (zusammen 100 %), sonst ein Hinweis neben den Feldern.
function initSportBalanceSettings() {
  const inputs = [...document.querySelectorAll("[data-balance-sport]")];
  const status = document.getElementById("profile-balance-status");
  if (!inputs.length || !status) return;
  const fill = () => {
    const target = sportBalanceTarget(athleteProfile.sportBalanceTarget);
    inputs.forEach(input => { input.value = target[input.dataset.balanceSport]; });
  };
  const setStatus = (text, cls) => { status.textContent = text; status.className = "coach-test-status" + (cls ? " " + cls : ""); };
  fill();
  inputs.forEach(input => input.addEventListener("change", () => {
    const values = {};
    inputs.forEach(inp => { values[inp.dataset.balanceSport] = inp.value; });
    const { target, error } = checkSportBalanceTarget(values);
    if (error) { setStatus(error, "err"); return; }
    athleteProfile.sportBalanceTarget = target;
    saveAthleteProfile();
    setStatus("Gespeichert ✓", "ok");
    renderSportBalanceCard();
  }));
  document.getElementById("profile-balance-reset-btn").addEventListener("click", () => {
    athleteProfile.sportBalanceTarget = null;
    saveAthleteProfile();
    fill();
    setStatus("Standard wiederhergestellt ✓", "ok");
    renderSportBalanceCard();
  });
}

function sportBalancePeriodLabel(p, mode) {
  const label = mode === "month"
    ? p.start.toLocaleDateString("de-DE", { month: "short", year: "2-digit" })
    : "ab " + fmtDate(p.start);
  return p.running ? `${label} <small>läuft</small>` : label;
}

// Gestapelter 100-%-Balken einer Periode. SVG ohne viewBox, Positionen in
// Prozent der Breite: so bleibt der Balken auf jeder Bildschirmbreite gleich
// hoch und die Schrift daneben (HTML) in normaler Größe.
function sportBalanceBar(p, target, hostEl) {
  const svg = svgEl("svg", { class: "ana-bal-bar", width: "100%", height: 18 });
  if (!p.shares) {
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: "100%", height: 18, rx: 4, class: "ana-bal-empty" }));
  } else {
    let x = 0;
    TRI_SPORTS.forEach(s => {
      const share = p.shares[s];
      if (share <= 0) return;
      const rect = svgEl("rect", { x: x + "%", y: 0, width: share + "%", height: 18, class: "ana-seg " + ANALYSIS_SPORT_CLASS[s] });
      rect.addEventListener("mousemove", e => showTip(e, `<b>${s}</b><br>${fmtH(p.minutes[s])} h · ${anaPct(share)} (Ziel ${anaPct(target[s])})`, hostEl));
      rect.addEventListener("mouseleave", hideTip);
      svg.appendChild(rect);
      x += share;
    });
  }
  // Ziel-Grenzen: Ende des Schwimm- und des Rad-Anteils laut Zielverteilung.
  [target.Schwimmen, target.Schwimmen + target.Rad].forEach(pos => {
    svg.appendChild(svgEl("line", { x1: pos + "%", x2: pos + "%", y1: -3, y2: 21, class: "ana-target-mark" }));
  });
  return svg;
}

function renderSportBalanceCard() {
  const host = document.getElementById("analysis-balance-body");
  if (!host) return;
  const mode = analysisBalanceMode;
  const target = sportBalanceTarget(athleteProfile.sportBalanceTarget);
  const res = computeSportBalance(DATA, mode, target);
  const unit = mode === "month" ? "Monaten" : "Wochen";

  host.innerHTML = `<div class="legend">${TRI_SPORTS.map(s =>
    `<span class="item"><span class="swatch ${ANALYSIS_SPORT_CLASS[s]}"></span>${s} · Ziel ${anaPct(target[s])}</span>`).join("")}
    <span class="item"><span class="ana-target-swatch"></span>Ziel-Grenze</span></div>`;

  if (res.periods.every(p => !p.total)) {
    host.insertAdjacentHTML("beforeend", `<p class="empty-note">Noch keine Schwimm-, Rad- oder Laufeinheiten in den letzten ${res.periods.length} ${unit}.</p>`);
    return;
  }

  const rows = document.createElement("div");
  rows.className = "ana-bal-rows";
  res.periods.slice().reverse().forEach(p => {
    const row = document.createElement("div");
    row.className = "ana-bal-row";
    row.innerHTML = `<span class="ana-bal-label">${sportBalancePeriodLabel(p, mode)}</span>`;
    row.appendChild(sportBalanceBar(p, target, host));
    row.insertAdjacentHTML("beforeend", `<span class="ana-bal-total">${p.total ? fmtH(p.total) + " h" : "–"}</span>`);
    if (p.short.length) {
      row.insertAdjacentHTML("beforeend", `<span class="ana-bal-short"><span class="ana-warn-icon">⚠</span> zu kurz: ${p.short.map(s => `${s} ${anaPct(p.shares[s])}`).join(", ")}</span>`);
    }
    rows.appendChild(row);
  });
  host.appendChild(rows);

  const o = res.overall;
  const span = `den letzten ${o.periodCount} abgeschlossenen ${unit}`;
  let hint;
  if (!o.shares) {
    hint = `<p class="ana-hint">Noch keine Schwimm-, Rad- oder Laufeinheiten in ${span}.</p>`;
  } else {
    const actual = TRI_SPORTS.map(s => `${s} ${anaPct(o.shares[s])}`).join(" · ");
    hint = o.short.length
      ? `<p class="ana-hint warn">${o.short.map(s => `<b>${s} kommt zu kurz:</b> ${anaPct(o.shares[s])} statt ${anaPct(target[s])} deiner Trainingszeit`).join("<br>")} (in ${span}).<br>Ist-Verteilung: ${actual}</p>`
      : `<p class="ana-hint"><b>Passt:</b> In ${span} liegt keine Sportart mehr als ${SPORT_BALANCE_TOLERANCE_PCT} Prozentpunkte unter ihrem Ziel.<br>Ist-Verteilung: ${actual}</p>`;
  }
  host.insertAdjacentHTML("beforeend", hint);
}
