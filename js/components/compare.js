// Workouts vergleichen: Auswahl-Dialog + Vergleichsansicht (übereinander
// gelegte Diagramme oder nebeneinander) für bis zu 4 Einheiten derselben
// Sportart. Ausgelöst über den "Vergleichen"-Button in der Workout-
// Detailansicht (buildWorkoutDetailHtml, workout-card.js) bzw. im
// aufgeklappten Kalender-Tageseintrag (calendar.js) - beide rufen
// openComparePicker(w) auf. Reuse bestehender Bausteine: drawMiniLine/
// drawMultiLine (chart.js), sportColor/fmtDate* (Übersicht), .modal-overlay/
// .modal-card (Basis-Modal-Styles), .legend/.swatch (Legenden), .cal-view-
// toggle (Umschalter, wie in der Kalender-Ansicht), computeTrainingLoadStats/
// computeNegSplitPercent (js/analytics/workout-profile.js) und
// paceOrSpeedSeconds (js/analytics/workout-comparison.js) - dieselben
// Kennzahlen, die auch die Einzel-Detailansicht/KI-Auswertung nutzt, statt
// eigene neue Berechnungen einzuführen.

const COMPARE_COLORS = ["var(--c-hr-max)", "var(--c-rad)", "var(--c-z3)", "var(--c-tsb-pos)"];
const COMPARE_MAX_EXTRA = 3; // + die Ausgangs-Einheit = max. 4 insgesamt

let compareMode = "overlay"; // "overlay" (übereinander) | "sidebyside" (nebeneinander)

const comparePickerOverlay = document.getElementById("compare-picker-overlay");
const compareOverlay = document.getElementById("compare-overlay");

function closeComparePicker() { comparePickerOverlay.classList.remove("open"); }
function closeCompareView() { compareOverlay.classList.remove("open"); }

document.getElementById("compare-picker-close").addEventListener("click", closeComparePicker);
comparePickerOverlay.addEventListener("click", e => { if (e.target === comparePickerOverlay) closeComparePicker(); });
document.getElementById("compare-close").addEventListener("click", closeCompareView);
compareOverlay.addEventListener("click", e => { if (e.target === compareOverlay) closeCompareView(); });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (compareOverlay.classList.contains("open")) closeCompareView();
  else if (comparePickerOverlay.classList.contains("open")) closeComparePicker();
});

/* ---------- Auswahl-Dialog: welche zusätzlichen Einheiten? ---------- */

function openComparePicker(baseWorkout) {
  const body = document.getElementById("compare-picker-body");
  const candidates = ALL
    .filter(w => w.file !== baseWorkout.file && w.sport_raw === baseWorkout.sport_raw)
    .sort((a, b) => (b._date || 0) - (a._date || 0))
    .slice(0, 30); // genug Auswahl, ohne die Liste unendlich lang zu machen - nur dieselbe Sportart, sonst wären Achsen (Pace vs. km/h) nicht vergleichbar

  body.innerHTML = `
    <h3>Mit anderen Einheiten vergleichen</h3>
    <p class="modal-sub">Basis: <b>${baseWorkout.sport}</b>${baseWorkout._date ? " · " + fmtDateFull(baseWorkout._date) : ""} — wähle bis zu ${COMPARE_MAX_EXTRA} weitere ${escapeHtml(baseWorkout.sport)}-Einheiten zum Vergleich.</p>
    ${candidates.length ? `
    <div class="compare-picker-list">
      ${candidates.map(w => `
        <label class="compare-picker-item">
          <input type="checkbox" value="${encodeURIComponent(w.file)}">
          <span class="compare-picker-item-main">${w._date ? fmtDateWeekday(w._date) : "–"} · ${w.duration_min != null ? fmtNum(w.duration_min, 0) + " min" : "–"}</span>
          <span class="compare-picker-item-sub">${w.pace_min_per_km ? w.pace_min_per_km + " /km" : w.pace_min_per_100m ? w.pace_min_per_100m + " /100m" : w.speed_kmh != null ? fmtNum(w.speed_kmh, 1) + " km/h" : "–"}${w.avg_hr != null ? " · Ø " + w.avg_hr + " bpm" : ""}</span>
        </label>`).join("")}
    </div>
    <p class="compare-picker-hint" id="compare-picker-hint"></p>
    <div class="plan-edit-actions">
      <div class="plan-edit-actions-right">
        <button type="button" class="update-btn" id="compare-picker-go-btn" disabled>Vergleichen</button>
      </div>
    </div>` : `<p class="empty-note">Keine weiteren ${escapeHtml(baseWorkout.sport)}-Einheiten zum Vergleichen vorhanden.</p>`}
  `;

  const checkboxes = [...body.querySelectorAll(".compare-picker-list input[type=checkbox]")];
  const goBtn = document.getElementById("compare-picker-go-btn");
  const hint = document.getElementById("compare-picker-hint");
  const updateState = () => {
    const checked = checkboxes.filter(cb => cb.checked);
    checkboxes.forEach(cb => { if (!cb.checked) cb.disabled = checked.length >= COMPARE_MAX_EXTRA; });
    if (goBtn) goBtn.disabled = checked.length === 0;
    if (hint) hint.textContent = checked.length >= COMPARE_MAX_EXTRA ? `Maximal ${COMPARE_MAX_EXTRA} zusätzliche Einheiten wählbar.` : "";
  };
  checkboxes.forEach(cb => cb.addEventListener("change", updateState));
  updateState();

  if (goBtn) goBtn.addEventListener("click", () => {
    const files = [baseWorkout.file, ...checkboxes.filter(cb => cb.checked).map(cb => decodeURIComponent(cb.value))];
    closeComparePicker();
    openCompareView(files);
  });

  comparePickerOverlay.classList.add("open");
}

/* ---------- Vergleichsansicht ---------- */

function openCompareView(files) {
  const workouts = files.map(f => ALL.find(w => w.file === f)).filter(Boolean);
  if (workouts.length < 2) return;
  renderCompareView(workouts);
  compareOverlay.classList.add("open");
}

// Pace/Speed als vergleichbare Zahl, bei der IMMER "kleiner = schneller/
// besser" gilt (Rad: km/h wird negiert) - Grundlage für die "schnellste
// Einheit"-Hervorhebung in Tabelle/Zusammenfassung. Für Laufen/Schwimmen
// reuse von paceOrSpeedSeconds() (js/analytics/workout-comparison.js).
function paceSortValue(w) {
  if (w.sport_raw === "cycling") return w.speed_kmh != null ? -w.speed_kmh : null;
  const s = paceOrSpeedSeconds(w);
  return s != null ? s : null;
}

function paceOrSpeedDisplay(w) {
  return w.pace_min_per_km ? w.pace_min_per_km + " /km" : w.pace_min_per_100m ? w.pace_min_per_100m + " /100m" : w.speed_kmh != null ? fmtNum(w.speed_kmh, 1) + " km/h" : "–";
}

// Index der besten (kleinsten) Zahl in `values` (parallel zu den Einheiten),
// null-Werte werden ignoriert - bei weniger als 2 gültigen Werten gibt es
// nichts sinnvoll hervorzuheben (dann -1, keine Auszeichnung).
function bestIndexOf(values) {
  const valid = values.filter(v => v != null);
  if (valid.length < 2) return -1;
  let bestI = -1, bestV = Infinity;
  values.forEach((v, i) => { if (v != null && v < bestV) { bestV = v; bestI = i; } });
  return bestI;
}

function renderCompareView(workouts) {
  const body = document.getElementById("compare-body");
  const legendHtml = workouts.map((w, i) => `
    <span class="item"><span class="swatch" style="background:${COMPARE_COLORS[i]}"></span>${w._date ? fmtDateWeekday(w._date) : "–"} · ${w.sport}</span>`).join("");

  // Zusatz-Kennzahlen je Einheit einmal vorab berechnen (reuse bestehender
  // Analytics, s.o.) statt sie mehrfach in Tabelle + Zusammenfassung neu zu
  // berechnen.
  const paceVals = workouts.map(paceSortValue);
  const loadStats = workouts.map(computeTrainingLoadStats); // TRIMP/Stress-Score, null falls Profil/Pulsdaten fehlen
  const negSplits = workouts.map(computeNegSplitPercent); // %, positiv = 2. Hälfte schneller

  const bestPaceI = bestIndexOf(paceVals);
  const bestNegSplitI = bestIndexOf(negSplits.map(v => v != null ? -v : null)); // größter (positivster) Wert = beste Auszeichnung

  // Optionale Spalten nur einblenden, wenn mindestens eine Einheit dafür
  // Daten hat - sonst würde die Tabelle mit lauter "–"-Spalten vollmüllen
  // (dieselbe Regel wie schon bei den Detail-Charts in workout-card.js).
  const effElev = w => (typeof effectiveElevationGainM === "function") ? effectiveElevationGainM(w) : w.elevation_gain_m;
  const hasElevation = workouts.some(w => effElev(w) != null);
  const hasCalories = workouts.some(w => w.calories != null);
  const hasCadence = workouts.some(w => w.avg_cadence != null);
  const hasLoad = workouts.some(w => w.training_load != null);
  const hasTrimp = loadStats.some(Boolean);
  const hasNegSplit = negSplits.some(v => v != null);
  const cadUnit = workouts[0].sport_raw === "cycling" ? "U/min" : "spm";
  // Eigene Bewertung (js/data/workout-notes.js) - nur eingeblendet, wenn
  // mindestens eine der gewählten Einheiten bewertet wurde (gleiche Regel
  // wie alle anderen optionalen Spalten hier).
  const ratingEntries = workouts.map(w => (typeof getWorkoutNote === "function") ? getWorkoutNote(w.file) : null);
  const hasRating = ratingEntries.some(e => e && e.rating != null);

  const headCells = [
    "Einheit", "Dauer", "Distanz", "Pace / Speed", "Ø / Max HF",
    ...(hasElevation ? ["Höhenmeter"] : []),
    ...(hasCalories ? ["Kalorien"] : []),
    ...(hasCadence ? [`Ø Kadenz (${cadUnit})`] : []),
    ...(hasLoad ? ["Load"] : []),
    ...(hasTrimp ? ["TRIMP"] : []),
    ...(hasNegSplit ? ["Neg. Split"] : []),
    ...(hasRating ? ["Bewertung"] : []),
  ];

  const statsRowsHtml = workouts.map((w, i) => {
    const stats = loadStats[i];
    const negSplit = negSplits[i];
    return `<tr>
      <td><span class="swatch" style="background:${COMPARE_COLORS[i]}; margin-right:6px;"></span>${w._date ? fmtDateFull(w._date) : "–"}</td>
      <td class="num">${w.duration_min != null ? fmtNum(w.duration_min, 0) + " min" : "–"}</td>
      <td class="num">${w.distance_km != null ? fmtNum(w.distance_km, 2) + " km" : "–"}</td>
      <td class="num${i === bestPaceI ? " compare-best" : ""}">${paceOrSpeedDisplay(w)}</td>
      <td class="num">${w.avg_hr ?? "–"} / ${w.max_hr ?? "–"}</td>
      ${hasElevation ? `<td class="num">${effElev(w) != null ? Math.round(effElev(w)) + " m" : "–"}</td>` : ""}
      ${hasCalories ? `<td class="num">${w.calories != null ? Math.round(w.calories) + " kcal" : "–"}</td>` : ""}
      ${hasCadence ? `<td class="num">${w.avg_cadence != null ? Math.round(w.avg_cadence) : "–"}</td>` : ""}
      ${hasLoad ? `<td class="num">${w.training_load != null ? fmtNum(w.training_load, 0) : "–"}</td>` : ""}
      ${hasTrimp ? `<td class="num">${stats ? stats.trimp : "–"}</td>` : ""}
      ${hasNegSplit ? `<td class="num${i === bestNegSplitI ? " compare-best" : ""}">${negSplit != null ? (negSplit >= 0 ? "+" : "") + fmtNum(negSplit, 1) + " %" : "–"}</td>` : ""}
      ${hasRating ? `<td class="num">${ratingEntries[i] && ratingEntries[i].rating != null ? "★".repeat(ratingEntries[i].rating) + "☆".repeat(5 - ratingEntries[i].rating) : "–"}</td>` : ""}
    </tr>`;
  }).join("");

  const summaryHtml = buildCompareSummaryHtml(workouts, { paceVals, loadStats, negSplits, bestPaceI, bestNegSplitI });

  body.innerHTML = `
    <div class="modal-head">
      <h3>Workouts vergleichen</h3>
    </div>
    <div class="legend compare-legend">${legendHtml}</div>
    ${summaryHtml}
    <div class="cal-view-toggle compare-mode-toggle" id="compare-mode-toggle">
      <button class="cal-view-btn${compareMode === "overlay" ? " active" : ""}" data-mode="overlay" type="button">Übereinander</button>
      <button class="cal-view-btn${compareMode === "sidebyside" ? " active" : ""}" data-mode="sidebyside" type="button">Nebeneinander</button>
    </div>
    <div class="table-scroll">
      <table class="workouts compare-stats-table">
        <thead><tr>${headCells.map((h, idx) => idx === 0 ? `<th>${h}</th>` : `<th class="num">${h}</th>`).join("")}</tr></thead>
        <tbody>${statsRowsHtml}</tbody>
      </table>
    </div>
    <div id="compare-charts"></div>
  `;

  document.querySelectorAll("#compare-mode-toggle .cal-view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === compareMode) return;
      compareMode = btn.dataset.mode;
      document.querySelectorAll("#compare-mode-toggle .cal-view-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderCompareCharts(workouts);
    });
  });

  renderCompareCharts(workouts);
}

// Kompakte "Auf einen Blick"-Zeile über der Tabelle: welche Einheit war am
// schnellsten/am weitesten/hatte die meisten Höhenmeter/das beste Pacing -
// rein deterministisch aus den ohnehin vorhandenen Feldern abgeleitet (kein
// KI-Anteil, siehe AI_RULES: Analytics berechnet, KI interpretiert nur).
// Jeder Punkt erscheint nur, wenn er sich zwischen mind. 2 Einheiten
// tatsächlich unterscheidet - sonst wäre er keine Aussage wert.
function buildCompareSummaryHtml(workouts, { paceVals, loadStats, negSplits, bestPaceI, bestNegSplitI }) {
  const items = [];
  const label = w => w._date ? fmtDateWeekday(w._date) : w.sport;

  if (bestPaceI >= 0) {
    items.push(`<span class="item"><b>Schnellste Einheit:</b> ${label(workouts[bestPaceI])} (${paceOrSpeedDisplay(workouts[bestPaceI])})</span>`);
  }

  const distIdx = bestIndexOf(workouts.map(w => w.distance_km != null ? -w.distance_km : null));
  if (distIdx >= 0) {
    items.push(`<span class="item"><b>Größte Distanz:</b> ${label(workouts[distIdx])} (${fmtNum(workouts[distIdx].distance_km, 2)} km)</span>`);
  }

  const effElevSummary = w => (typeof effectiveElevationGainM === "function") ? effectiveElevationGainM(w) : w.elevation_gain_m;
  const eleIdx = bestIndexOf(workouts.map(w => effElevSummary(w) != null ? -effElevSummary(w) : null));
  if (eleIdx >= 0 && effElevSummary(workouts[eleIdx]) > 0) {
    items.push(`<span class="item"><b>Meiste Höhenmeter:</b> ${label(workouts[eleIdx])} (${Math.round(effElevSummary(workouts[eleIdx]))} m)</span>`);
  }

  const hrIdx = bestIndexOf(workouts.map(w => w.avg_hr));
  if (hrIdx >= 0) {
    items.push(`<span class="item"><b>Niedrigste Ø-HF:</b> ${label(workouts[hrIdx])} (${workouts[hrIdx].avg_hr} bpm)</span>`);
  }

  if (bestNegSplitI >= 0 && negSplits[bestNegSplitI] > 0) {
    items.push(`<span class="item"><b>Bestes Pacing:</b> ${label(workouts[bestNegSplitI])} (negativer Split, 2. Hälfte ${fmtNum(negSplits[bestNegSplitI], 1)} % schneller)</span>`);
  }

  const trimpIdx = bestIndexOf(loadStats.map(s => s ? -s.trimp : null));
  if (trimpIdx >= 0) {
    items.push(`<span class="item"><b>Höchste Belastung:</b> ${label(workouts[trimpIdx])} (TRIMP ${loadStats[trimpIdx].trimp})</span>`);
  }

  if (!items.length) return "";
  return `<div class="legend compare-summary">${items.join("")}</div>`;
}

function renderCompareCharts(workouts) {
  const host = document.getElementById("compare-charts");
  if (!host) return;
  if (compareMode === "sidebyside") renderCompareSideBySide(workouts, host);
  else renderCompareOverlay(workouts, host);
}

/* ---------- Rohdaten je Einheit für die Vergleichs-Charts -----------------
   Dieselbe Logik wie renderWorkoutDetailCharts (HF-/Pace-/Höhen-/Kadenz-/
   Leistungs-Aufbereitung, inkl. der "looksFlat"-Erkennung für die bekannte
   Durchschnitts-statt-Sekundenwert-Problematik, siehe CHANGE_REQUESTS.md) -
   hier aber ohne direktes Zeichnen, damit dieselben Punkte sowohl für die
   übereinandergelegte (normierte % der Dauer) als auch die nebeneinander
   (absolute Zeit) angezeigte Variante wiederverwendet werden können. ---- */

// Generische Sekunden-Stream-Extraktion für ein beliebiges Feld (hr/alt/cad/
// power) - dieselbe Mindestpunktzahl (5) wie überall sonst im Dashboard, um
// vereinzelte Ausreißer nicht als "Verlauf" zu werten.
function metricStreamPoints(w, key) {
  const stream = w.stream;
  if (!stream || !stream[key]) return null;
  const pts = stream.t.map((t, i) => ({ t, y: stream[key][i] })).filter(p => p.y != null);
  if (pts.length < 5) return null;
  return pts;
}

function hrStreamPoints(w) { return metricStreamPoints(w, "hr"); }
function altStreamPoints(w) { return metricStreamPoints(w, "alt"); }
function cadStreamPoints(w) { return metricStreamPoints(w, "cad"); }
function powerStreamPoints(w) { return metricStreamPoints(w, "power"); }

function paceStreamPoints(w) {
  const stream = w.stream;
  const invert = w.sport_raw !== "cycling";
  const swimLengths = (w.sport_raw === "swimming" && Array.isArray(w.lengths))
    ? w.lengths.filter(l => l.speed_mps != null && l.speed_mps > 0)
    : null;
  if (swimLengths && swimLengths.length >= 2) {
    let cum = 0;
    const pts = swimLengths.map(l => { cum += l.duration_s || 0; return { t: cum, y: 100 / l.speed_mps }; });
    return { pts, invert, unit: "/100m" };
  }
  if (!stream || !stream.speed || !stream.speed.some(v => v != null)) return null;
  const rawSpeeds = stream.speed.filter(v => v != null && v > 0);
  const distinctSpeeds = new Set(rawSpeeds.map(v => Math.round(v * 1000)));
  const looksFlat = rawSpeeds.length >= 5 && distinctSpeeds.size <= 1;
  if (looksFlat) return null; // ehrlich weglassen statt eine Durchschnitts-Gerade als Verlauf zu zeigen
  const pts = stream.t.map((t, i) => {
    const sp = stream.speed[i];
    if (sp == null || sp <= 0) return null;
    let val;
    if (w.sport_raw === "running") val = 1000 / sp;
    else if (w.sport_raw === "swimming") val = 100 / sp;
    else val = sp * 3.6;
    return { t, y: val };
  }).filter(Boolean);
  if (!pts.length) return null;
  const unit = w.sport_raw === "running" ? "/km" : w.sport_raw === "swimming" ? "/100m" : "km/h";
  return { pts, invert, unit };
}

// Zusätzliche Verlaufs-Metriken über HF/Pace hinaus - je Sportart nur die,
// die tatsächlich Sinn ergeben (Höhenprofil nicht beim Schwimmen, Leistung
// nur wenn irgendeine der Einheiten einen Leistungsmesser/HRM-Pro nutzt).
// Nur ins Diagramm aufgenommen, wenn MINDESTENS EINE der ausgewählten
// Einheiten dafür Sekundendaten hat (sonst leerer Chart-Container).
function extraCompareMetrics(workouts) {
  const cadUnit = workouts[0].sport_raw === "cycling" ? "U/min" : "spm";
  const metrics = [];
  if (workouts[0].sport_raw !== "swimming") {
    metrics.push({ key: "alt", label: "Höhenprofil", getPts: altStreamPoints, unit: "m", fmtVal: v => fmtNum(v, 0), fmtAxis: v => Math.round(v) });
  }
  metrics.push({ key: "cad", label: "Kadenz", getPts: cadStreamPoints, unit: cadUnit, fmtVal: v => Math.round(v), fmtAxis: v => Math.round(v) });
  metrics.push({ key: "power", label: "Leistung", getPts: powerStreamPoints, unit: "W", fmtVal: v => Math.round(v), fmtAxis: v => Math.round(v) });
  return metrics.filter(m => workouts.some(w => m.getPts(w)));
}

/* ---------- Modus "Übereinander": ein Diagramm, mehrere Linien ---------- */

function renderCompareOverlay(workouts, host) {
  const extraMetrics = extraCompareMetrics(workouts);

  host.innerHTML = `
    <div><h4>Herzfrequenz <span class="wd-analysis-hint">Verlauf über % der jeweiligen Trainingsdauer</span></h4><div class="chart-wrap" id="compare-hr-chart"></div></div>
    <div><h4>Pace / Geschwindigkeit <span class="wd-analysis-hint">Verlauf über % der jeweiligen Trainingsdauer</span></h4><div class="chart-wrap" id="compare-pace-chart"></div></div>
    ${extraMetrics.map(m => `<div><h4>${m.label} <span class="wd-analysis-hint">Verlauf über % der jeweiligen Trainingsdauer</span></h4><div class="chart-wrap" id="compare-${m.key}-chart"></div></div>`).join("")}
  `;

  const hrSeries = workouts.map((w, i) => {
    const pts = hrStreamPoints(w);
    if (!pts) return null;
    const total = pts[pts.length - 1].t || 1;
    return { label: w._date ? fmtDateWeekday(w._date) : w.sport, color: COMPARE_COLORS[i], points: pts.map(p => ({ xPct: p.t / total, y: p.y, tooltip: `${Math.round(p.y)} bpm` })) };
  });
  const hrHost = document.getElementById("compare-hr-chart");
  if (hrSeries.some(Boolean)) {
    drawMultiLine(hrHost, hrSeries, { width: 760, height: 190, fmtAxis: v => Math.round(v) });
  } else {
    hrHost.innerHTML = "<p class='empty-note' style='padding:12px 0;'>Keine vergleichbaren Herzfrequenz-Daten vorhanden.</p>";
  }

  let paceInvert = null, paceUnit = "";
  const paceResults = workouts.map(w => paceStreamPoints(w));
  paceResults.forEach(res => { if (res && paceInvert == null) { paceInvert = res.invert; paceUnit = res.unit; } });
  const paceSeries = workouts.map((w, i) => {
    const res = paceResults[i];
    if (!res) return null;
    const total = res.pts[res.pts.length - 1].t || 1;
    return { label: w._date ? fmtDateWeekday(w._date) : w.sport, color: COMPARE_COLORS[i], points: res.pts.map(p => ({ xPct: p.t / total, y: p.y, tooltip: `${paceInvert ? secondsToPace(p.y) : fmtNum(p.y, 1)} ${paceUnit}` })) };
  });
  const paceHost = document.getElementById("compare-pace-chart");
  const validPaceCount = paceSeries.filter(Boolean).length;
  if (validPaceCount > 0) {
    drawMultiLine(paceHost, paceSeries, { invert: paceInvert, width: 760, height: 190, fmtAxis: v => paceInvert ? secondsToPace(v) : fmtNum(v, 1) });
    if (validPaceCount < workouts.length) {
      paceHost.insertAdjacentHTML("afterend", `<p class="empty-note" style="padding:6px 0 0;">Hinweis: bei ${workouts.length - validPaceCount} der ausgewählten Einheiten liegt keine echte Sekunden-Pace vor (nur ein konstanter Durchschnittswert) — diese Kurve fehlt bewusst, statt eine falsche zu zeigen (siehe CHANGE_REQUESTS.md).</p>`);
    }
  } else {
    paceHost.innerHTML = "<p class='empty-note' style='padding:12px 0;'>Keine echten Pace-/Geschwindigkeits-Verlaufsdaten für diese Einheiten vorhanden.</p>";
  }

  extraMetrics.forEach(m => {
    const chHost = document.getElementById(`compare-${m.key}-chart`);
    const series = workouts.map((w, i) => {
      const pts = m.getPts(w);
      if (!pts) return null;
      const total = pts[pts.length - 1].t || 1;
      return { label: w._date ? fmtDateWeekday(w._date) : w.sport, color: COMPARE_COLORS[i], points: pts.map(p => ({ xPct: p.t / total, y: p.y, tooltip: `${m.fmtVal(p.y)} ${m.unit}` })) };
    });
    if (series.some(Boolean)) {
      drawMultiLine(chHost, series, { width: 760, height: 190, fmtAxis: m.fmtAxis });
    } else {
      chHost.innerHTML = `<p class='empty-note' style='padding:12px 0;'>Keine ${m.label}-Daten vorhanden.</p>`;
    }
  });
}

/* ---------- Modus "Nebeneinander": eine Spalte je Einheit --------------- */

function renderCompareSideBySide(workouts, host) {
  const extraMetrics = extraCompareMetrics(workouts);

  host.innerHTML = `<div class="compare-columns">${workouts.map((w, i) => `
    <div class="compare-column">
      <div class="compare-column-head"><span class="swatch" style="background:${COMPARE_COLORS[i]}"></span>${w._date ? fmtDateFull(w._date) : "–"}</div>
      <div><h4>Herzfrequenz</h4><div class="chart-wrap compare-col-hr" data-idx="${i}"></div></div>
      <div><h4>Pace / Geschwindigkeit</h4><div class="chart-wrap compare-col-pace" data-idx="${i}"></div></div>
      ${extraMetrics.map(m => `<div><h4>${m.label}</h4><div class="chart-wrap compare-col-${m.key}" data-idx="${i}"></div></div>`).join("")}
    </div>`).join("")}</div>`;

  const fmtMin = t => { const m = Math.floor(t / 60), s = Math.round(t % 60); return `${m}:${String(s).padStart(2, "0")}`; };

  workouts.forEach((w, i) => {
    const hrHost = host.querySelector(`.compare-col-hr[data-idx="${i}"]`);
    const hrPts = hrStreamPoints(w);
    if (hrPts) {
      drawMiniLine(hrHost, hrPts.map(p => ({ y: p.y, xLabel: fmtMin(p.t), tooltip: `<b>${fmtMin(p.t)}</b><br>${Math.round(p.y)} bpm` })),
        { color: COMPARE_COLORS[i], width: 320, height: 140, maxLabels: 4, fmtAxis: v => Math.round(v) });
    } else {
      hrHost.innerHTML = "<p class='empty-note' style='padding:8px 0;'>Keine Sekundendaten.</p>";
    }
    const paceHost = host.querySelector(`.compare-col-pace[data-idx="${i}"]`);
    const res = paceStreamPoints(w);
    if (res) {
      drawMiniLine(paceHost, res.pts.map(p => ({ y: p.y, xLabel: fmtMin(p.t), tooltip: `<b>${fmtMin(p.t)}</b><br>${res.invert ? secondsToPace(p.y) : fmtNum(p.y, 1)} ${res.unit}` })),
        { color: COMPARE_COLORS[i], width: 320, height: 140, maxLabels: 4, invert: res.invert, fmtAxis: v => res.invert ? secondsToPace(v) : fmtNum(v, 1) });
    } else {
      paceHost.innerHTML = "<p class='empty-note' style='padding:8px 0;'>Keine echte Sekunden-Pace vorhanden.</p>";
    }

    extraMetrics.forEach(m => {
      const mHost = host.querySelector(`.compare-col-${m.key}[data-idx="${i}"]`);
      const pts = m.getPts(w);
      if (pts) {
        drawMiniLine(mHost, pts.map(p => ({ y: p.y, xLabel: fmtMin(p.t), tooltip: `<b>${fmtMin(p.t)}</b><br>${m.fmtVal(p.y)} ${m.unit}` })),
          { color: COMPARE_COLORS[i], width: 320, height: 140, maxLabels: 4, fmtAxis: m.fmtAxis });
      } else {
        mHost.innerHTML = `<p class='empty-note' style='padding:8px 0;'>Keine ${m.label}-Daten.</p>`;
      }
    });
  });
}
