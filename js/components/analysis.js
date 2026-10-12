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
  renderBikeCard();
  renderBrickCard();
}

function initAnalysis() {
  document.querySelectorAll("#analysis-balance-mode .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      analysisBalanceMode = chip.dataset.mode;
      document.querySelectorAll("#analysis-balance-mode .chip").forEach(c => c.classList.toggle("active", c === chip));
      renderSportBalanceCard();
    });
  });
  // Links "... ändern" springen in die Einstellungen zum passenden Feld
  // (data-ana-settings = ID des Ziels). Delegiert, weil manche Links erst beim Rendern entstehen.
  document.getElementById("view-analysis").addEventListener("click", e => {
    const link = e.target.closest("[data-ana-settings]");
    if (!link) return;
    openSettingsView();
    const target = document.getElementById(link.dataset.anaSettings);
    if (target) { target.scrollIntoView({ block: "center" }); if (target.matches("input")) target.focus(); }
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

/* ---------- Rad ---------- */

function powerZoneRangeText(z, i, last) {
  if (i === 0) return `bis ${z.highW} W`;
  if (i === last) return `ab ${z.lowW} W`; // alles über der Z5-Obergrenze zählt ebenfalls zu Z5
  return `${z.lowW}–${z.highW} W`;
}

function renderBikeCard() {
  const host = document.getElementById("analysis-bike-body");
  if (!host) return;
  const manual = athleteProfile.ftpWatts || null;
  const res = computeBikeAnalysis(DATA, manual);
  const est = res.estimate;
  const tiles = [
    anaTile("FTP (Einstellungen)", manual ? `${fmtNum(manual, 0)} <small>W</small>` : "–", manual ? "" : "nicht eingetragen"),
    est
      ? anaTile("FTP geschätzt", `${est.ftp} <small>W</small>`, `95&nbsp;% von ${est.best20} W (20 min) am ${fmtDate(est.workout._date)}`)
      : anaTile("FTP geschätzt", "–", res.hasPower ? `keine 20 min am Stück in den letzten ${FTP_ESTIMATE_WINDOW_DAYS} Tagen` : "keine Leistungsdaten"),
  ];
  const settingsLink = `<button type="button" class="reset-link" data-ana-settings="profile-ftp">FTP in den Einstellungen ${manual ? "ändern" : "eintragen"}</button>`;
  host.innerHTML = `<div class="pmc-substats ana-tiles">${tiles.join("")}</div>`;

  if (!res.hasPower && !manual) {
    host.insertAdjacentHTML("beforeend", `<p class="ana-hint">Noch keine Leistungsdaten vorhanden. Für FTP-Schätzung, Zonen und Verlauf braucht es Radeinheiten mit Leistungsmesser (Powermeter oder Smart-Trainer). Kennst du deine FTP, kannst du sie auch selbst eintragen — dann siehst du hier deine Zonen.<br>${settingsLink}</p>`);
    return;
  }

  const ftpText = res.ftpSource === "manual" ? `FTP ${res.ftp} W (Einstellungen)` : `geschätzter FTP ${res.ftp} W`;
  const dist = res.distribution;
  const distText = dist
    ? `Zeit in den Zonen: letzte ${POWER_ZONE_WINDOW_DAYS / 7} Wochen, ${dist.rideCount} ${dist.rideCount === 1 ? "Fahrt" : "Fahrten"} mit Leistung`
    : (res.hasPower ? `Keine Leistungsdaten in den letzten ${POWER_ZONE_WINDOW_DAYS / 7} Wochen` : "Wattbereiche je Zone");
  host.insertAdjacentHTML("beforeend", `<p class="ana-note">Zonen berechnet mit ${ftpText} · ${settingsLink}</p>
    <h3 class="ana-subhead">Leistungszonen</h3><p class="card-sub">${distText}</p>`);
  const rows = document.createElement("div");
  rows.className = "ana-zone-rows";
  res.zones.forEach((z, i) => {
    const row = document.createElement("div");
    row.className = "ana-zone-row";
    const share = dist ? dist.seconds[i] / dist.total * 100 : null;
    row.innerHTML = `<span class="ana-zone-name">${z.label} <small>${powerZoneRangeText(z, i, res.zones.length - 1)}</small></span>
      <span class="ana-zone-share">${dist ? anaPct(share) : ""}</span>`;
    if (dist) {
      const svg = svgEl("svg", { class: "ana-zone-bar", width: "100%", height: 8 });
      svg.appendChild(svgEl("rect", { x: 0, y: 0, width: "100%", height: 8, rx: 4, class: "ana-bal-empty" }));
      const bar = svgEl("rect", { x: 0, y: 0, width: share + "%", height: 8, rx: 4, class: `ana-z${i + 1}` });
      bar.addEventListener("mousemove", e => showTip(e, `<b>${z.label}</b><br>${fmtH(dist.seconds[i] / 60)} h · ${anaPct(share)}`, host));
      bar.addEventListener("mouseleave", hideTip);
      svg.appendChild(bar);
      row.appendChild(svg);
    }
    rows.appendChild(row);
  });
  host.appendChild(rows);

  if (!res.hasPower) {
    host.insertAdjacentHTML("beforeend", `<p class="ana-hint">Noch keine Leistungsdaten vorhanden. FTP-Schätzung, Zeit in den Zonen und FTP-Verlauf brauchen Radeinheiten mit Leistungsmesser (Powermeter oder Smart-Trainer).</p>`);
    return;
  }
  host.insertAdjacentHTML("beforeend", `<h3 class="ana-subhead">FTP-Verlauf</h3>
    <p class="card-sub">Geschätzte FTP je Monat (95&nbsp;% der besten 20 Minuten), letzte ${FTP_TREND_MONTHS} Monate</p>`);
  if (!res.trend.length) {
    host.insertAdjacentHTML("beforeend", `<p class="empty-note">Noch kein Monat mit 20 Minuten am Stück Leistungsdaten.</p>`);
    return;
  }
  const chart = document.createElement("div");
  chart.className = "chart-wrap";
  host.appendChild(chart);
  drawMiniLine(chart, res.trend.map(p => {
    const month = p.start.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
    return { y: p.ftp, xLabel: month, tooltip: `<b>${month}</b><br>FTP ≈ ${p.ftp} W · beste 20 min ${p.best20} W am ${fmtDate(p.workout._date)}` };
  }), { color: "var(--c-rad)", fmtAxis: v => fmtNum(v, 0), width: 440, height: 180 });
}

/* ---------- Koppeltraining ---------- */

const ANALYSIS_BRICK_MAX_ROWS = 12; // die Tabelle zeigt die neuesten Koppeleinheiten, die Zusammenfassung zählt alle

// "+12 s" / "−3 s": Abweichung zum normalen Lauf, ohne Wertung per Farbe -
// langsamer nach dem Rad ist normal, die Zahl soll nur zeigen, wie viel.
function brickDeltaText(v, unit) {
  const r = Math.round(v);
  return r === 0 ? `±0${unit}` : `${r > 0 ? "+" : "−"}${Math.abs(r)}${unit}`;
}

function brickSummaryHtml(summary) {
  const { paceSec, hr } = summary;
  if (!paceSec && !hr) {
    return `<p class="ana-hint">Für einen Vergleich fehlen noch normale Läufe mit Sekundendaten (mindestens ${BRICK_MIN_COMPARE_RUNS} in den ${BRICK_COMPARE_WINDOW_DAYS} Tagen vor einer Koppeleinheit).</p>`;
  }
  const units = n => `${n} ${n === 1 ? "Koppeleinheit" : "Koppeleinheiten"} mit Vergleich`;
  const sameCount = paceSec && hr && paceSec.count === hr.count;
  const parts = [];
  if (paceSec) {
    const v = Math.round(paceSec.value);
    parts.push((v === 0 ? "gleich schnell" : `${Math.abs(v)} s/km ${v > 0 ? "langsamer" : "schneller"}`) + (sameCount ? "" : ` (${units(paceSec.count)})`));
  }
  if (hr) {
    const v = Math.round(hr.value);
    parts.push(`Puls ${v === 0 ? "gleich" : `${Math.abs(v)} bpm ${v > 0 ? "höher" : "niedriger"}`}` + (sameCount ? "" : ` (${units(hr.count)})`));
  }
  return `<p class="ana-hint"><b>Im Schnitt nach dem Rad:</b> in den ersten ${BRICK_START_WINDOW_S / 60} Minuten ${parts.join(" und ")} als bei deinen normalen Läufen${sameCount ? ` (${units(paceSec.count)})` : ""}.</p>`;
}

function brickCompareText(s) {
  if (!s.own) return "keine Sekundendaten";
  if (s.compare.paceSec == null && s.compare.hr == null) return `zu wenig normale Läufe (${s.compareCount})`;
  const bits = [];
  if (s.compare.paceSec != null) bits.push(`${secondsToPace(s.compare.paceSec)} /km`);
  if (s.compare.hr != null) bits.push(`${Math.round(s.compare.hr)} bpm`);
  return `Ø ${bits.join(" · ")} <small>(${s.compareCount} Läufe)</small>`;
}

function renderBrickCard() {
  const host = document.getElementById("analysis-brick-body");
  if (!host) return;
  const res = computeBrickAnalysis(DATA);
  if (!res.sessions.length) {
    host.innerHTML = `<p class="empty-note">Noch keine Koppeleinheit erkannt. Als Koppeltraining zählt ein Lauf, der höchstens ${BRICK_MAX_GAP_MIN} Minuten nach dem Ende einer Radeinheit beginnt.</p>`;
    return;
  }
  const shown = res.sessions.slice(0, ANALYSIS_BRICK_MAX_ROWS);
  const rows = shown.map(s => {
    const own = s.own || {};
    const pace = own.paceSec != null
      ? `${secondsToPace(own.paceSec)} /km${s.delta.paceSec != null ? ` <small>${brickDeltaText(s.delta.paceSec, " s")}</small>` : ""}` : "–";
    const hr = own.hr != null
      ? `${Math.round(own.hr)} bpm${s.delta.hr != null ? ` <small>${brickDeltaText(s.delta.hr, "")}</small>` : ""}` : "–";
    return `<tr>
      <td>${fmtDateFull(s.run._date)}</td>
      <td class="ana-brick-ride">${fmtNum(s.ride.duration_min, 0)} min ${rideEnvBadgeHtml(s.ride)}</td>
      <td class="num">${fmtNum(s.gapMin, 0)} min</td>
      <td class="num">${fmtNum(s.run.duration_min, 0)} min</td>
      <td class="num">${pace}</td>
      <td class="num">${hr}</td>
      <td>${brickCompareText(s)}</td>
    </tr>`;
  }).join("");
  const more = res.sessions.length > shown.length
    ? `<p class="ana-note">Die neuesten ${shown.length} von ${res.sessions.length} Koppeleinheiten.</p>` : "";
  host.innerHTML = `${brickSummaryHtml(res.summary)}
    <div class="table-scroll"><table class="workouts workouts-compact ana-brick-table">
      <thead><tr><th>Datum</th><th>Rad</th><th class="num">Wechsel</th><th class="num">Lauf</th>
        <th class="num">Pace 10 min</th><th class="num">Puls 10 min</th><th>Normale Läufe</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${more}`;
  host.querySelectorAll("tbody tr").forEach((tr, i) => tr.addEventListener("click", () => openDetail(shown[i].run)));
}
