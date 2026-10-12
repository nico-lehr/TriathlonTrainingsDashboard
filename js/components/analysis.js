// Analyse-Tab: Triathlon-Auswertungen (Berechnung in js/analytics/triathlon.js).
// Nutzt immer die volle Historie (DATA), nicht den Zeitraum-Filter der
// Übersicht - die Filterleiste gibt es nur dort.

const ANALYSIS_SPORT_CLASS = { Schwimmen: "ana-swim", Rad: "ana-bike", Laufen: "ana-run" };

let analysisBalanceMode = "week"; // "week" | "month", umschaltbar per Chip

const anaPct = v => `${fmtNum(v, 0)}&nbsp;%`; // Prozent ohne Zeilenumbruch vor dem "%"

function anaSetStatus(el, text, cls) {
  el.textContent = text;
  el.className = "coach-test-status ana-status" + (cls ? " " + cls : "");
}

// Kleine Kennzahl-Kachel (Optik wie die Substats der PMC-Karte).
function anaTile(label, value, small = "", smallCls = "") {
  return `<div class="sub-tile"><div class="l">${label}</div><div class="v">${value}${small ? ` <small class="${smallCls}">${small}</small>` : ""}</div></div>`;
}

function renderAnalysis() {
  renderSportBalanceCard();
  renderSwimCard();
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
  initSwimCssTest();
  // Profilwerte, die in den Einstellungen geändert werden (FTP, CSS, ...),
  // sofort auch hier zeigen - die Einstellungs-Felder speichern selbst
  // (coach.js), dieser Listener läuft danach (Event-Bubbling).
  document.getElementById("view-settings").addEventListener("change", renderAnalysis);
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
  const setStatus = (text, cls) => anaSetStatus(status, text, cls);
  fill();
  inputs.forEach(input => input.addEventListener("change", () => {
    const values = {};
    inputs.forEach(inp => { values[inp.dataset.balanceSport] = inp.value; });
    const { target, error } = checkSportBalanceTarget(values);
    if (error) { setStatus(error, "err"); return; }
    athleteProfile.sportBalanceTarget = target;
    saveAthleteProfile();
    setStatus("Gespeichert ✓", "ok"); // neu gezeichnet wird über den change-Listener in initAnalysis()
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

/* ---------- Schwimmen ---------- */

const ANALYSIS_SWIM_CHART_MAX = 30; // so viele letzte Einheiten zeigt das Pace-Diagramm

// Woher der CSS-Wert im Profil stammt: aus dem hier eingetragenen Test oder
// manuell aus den Einstellungen (dasselbe Feld athleteProfile.swimCss).
function swimCssSourceText() {
  if (!athleteProfile.swimCss) return "noch kein Wert – Test unten eintragen";
  const test = athleteProfile.swimCssTest;
  if (test && computeSwimCss(test.t400, test.t200).pace === athleteProfile.swimCss) {
    return `aus deinem Test vom ${fmtDateFull(new Date(test.date + "T00:00:00"))}`;
  }
  return "in den Einstellungen eingetragen";
}

// Veränderung als "−7 s" / "+0,8" mit Farbklasse: kleiner ist beim Schwimmen besser.
function swimDelta(delta, dec, unit) {
  if (Math.abs(delta) < 0.5 * Math.pow(10, -dec)) return { text: "unverändert", cls: "" };
  return { text: `${delta < 0 ? "−" : "+"}${fmtNum(Math.abs(delta), dec)}${unit} ggü. davor`, cls: delta < 0 ? "delta-good" : "delta-warn" };
}

function renderSwimCard() {
  const body = document.getElementById("analysis-swim-body");
  const chart = document.getElementById("analysis-swim-chart");
  if (!body || !chart) return;
  const res = computeSwimAnalysis(DATA);
  const cssTile = anaTile("CSS", athleteProfile.swimCss ? `${escapeHtml(athleteProfile.swimCss)} <small>/100 m</small>` : "–");
  chart.innerHTML = "";
  if (!res) {
    body.innerHTML = `<div class="pmc-substats ana-tiles">${cssTile}</div><p class="ana-note">CSS ${swimCssSourceText()}.</p>
      <p class="empty-note">Noch keine Schwimmeinheit mit Pace-Angabe.</p>`;
    return;
  }
  const tiles = [];
  const latest = res.points[res.points.length - 1];
  tiles.push(anaTile(`Letzte Einheit (${fmtDate(new Date(latest.date))})`, `${secondsToPace(latest.paceSec)} <small>/100 m</small>`));
  if (res.paceTrend) {
    const d = swimDelta(res.paceTrend.delta, 0, " s");
    tiles.push(anaTile(`Ø Pace ${SWIM_TREND_WINDOW_DAYS / 7} Wochen`, secondsToPace(res.paceTrend.recent), d.text, d.cls));
  } else {
    tiles.push(anaTile("Pace-Trend", "–", "zu wenig Einheiten"));
  }
  if (res.swolfTrend) {
    const d = swimDelta(res.swolfTrend.delta, 1, "");
    tiles.push(anaTile(`Ø SWOLF ${SWIM_TREND_WINDOW_DAYS / 7} Wochen`, fmtNum(res.swolfTrend.recent, 1), d.text, d.cls));
  } else if (res.swolfCount) {
    const last = res.points.filter(p => p.swolf != null).pop();
    tiles.push(anaTile("SWOLF", fmtNum(last.swolf, 1), `am ${fmtDate(new Date(last.date))}, zu wenig für Trend`));
  } else {
    tiles.push(anaTile("SWOLF", "–", "nur aus Beckenaufzeichnungen mit Bahnen"));
  }
  tiles.push(cssTile);
  const trendNote = res.paceTrend ? "" : ` Für den Trend braucht es je mindestens ${SWIM_TREND_MIN_SWIMS} Einheiten in den letzten ${SWIM_TREND_WINDOW_DAYS / 7} Wochen und den ${SWIM_TREND_WINDOW_DAYS / 7} Wochen davor.`;
  body.innerHTML = `<div class="pmc-substats ana-tiles">${tiles.join("")}</div><p class="ana-note">CSS ${swimCssSourceText()}.${trendNote}</p>`;

  const pts = res.points.slice(-ANALYSIS_SWIM_CHART_MAX);
  document.getElementById("analysis-swim-sub").textContent =
    `Pace je 100 m, SWOLF und CSS · Diagramm: letzte ${pts.length} Einheiten, Gruppe ${res.groupLabel}`;
  drawMiniLine(chart, pts.map(p => ({
    y: p.paceSec, xLabel: fmtDate(new Date(p.date)),
    tooltip: `<b>${fmtDate(new Date(p.date))}</b><br>${secondsToPace(p.paceSec)} /100 m${p.swolf != null ? ` · SWOLF ${fmtNum(p.swolf, 1)}` : ""}`,
  })), { color: "var(--c-schwimmen)", invert: true, fmtAxis: v => secondsToPace(v), width: 440, height: 180 });
}

// CSS-Test: Zeiten prüfen, CSS ausrechnen und als athleteProfile.swimCss
// speichern (dasselbe Feld wie "CSS Schwimmen" in den Einstellungen, damit
// Zonen und KI-Kontext denselben Wert nutzen). Die Testzeiten selbst bleiben
// in athleteProfile.swimCssTest erhalten.
function initSwimCssTest() {
  const in400 = document.getElementById("analysis-css-400");
  const in200 = document.getElementById("analysis-css-200");
  const status = document.getElementById("analysis-css-status");
  const btn = document.getElementById("analysis-css-save-btn");
  if (!in400 || !in200 || !status || !btn) return;
  const test = athleteProfile.swimCssTest;
  if (test) { in400.value = test.t400; in200.value = test.t200; }
  btn.addEventListener("click", () => {
    const res = computeSwimCss(in400.value, in200.value);
    if (res.error) { anaSetStatus(status, res.error, "err"); return; }
    athleteProfile.swimCssTest = { t400: in400.value.trim(), t200: in200.value.trim(), date: todayStr() };
    athleteProfile.swimCss = res.pace;
    saveAthleteProfile();
    syncProfileInputsFromState(); // Feld "CSS Schwimmen" in den Einstellungen nachziehen
    anaSetStatus(status, `CSS ${res.pace} /100 m gespeichert ✓ – gilt jetzt auch in den Einstellungen.`, "ok");
    renderSwimCard();
  });
}
