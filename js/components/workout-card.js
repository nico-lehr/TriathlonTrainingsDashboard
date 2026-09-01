// Workout-Tabelle (Ausklappen/Einklappen) und Detailansicht-Modal je Einheit.

let currentRowsByFile = new Map();

const TABLE_PREVIEW_COUNT = 10;

let tableExpanded = false;

let lastTableData = [];

function renderTable(data) {
  lastTableData = data;
  const tbody = document.querySelector("#workouts-table tbody");
  const rows = [...data].sort((a, b) => (b._date || 0) - (a._date || 0));
  currentRowsByFile = new Map(rows.map(w => [w.file, w]));
  const visibleRows = tableExpanded ? rows : rows.slice(0, TABLE_PREVIEW_COUNT);
  const expandWrap = document.getElementById("table-expand-wrap");
  const expandBtn = document.getElementById("table-expand-btn");
  if (rows.length > TABLE_PREVIEW_COUNT) {
    expandWrap.style.display = "flex";
    expandBtn.textContent = tableExpanded ? "Weniger anzeigen ↑" : `Alle ${rows.length} anzeigen ↓`;
  } else {
    expandWrap.style.display = "none";
  }
  tbody.innerHTML = visibleRows.map((w, i) => {
    const paceOrSpeed = w.pace_min_per_km ? w.pace_min_per_km + " /km"
      : w.pace_min_per_100m ? w.pace_min_per_100m + " /100m"
      : w.speed_kmh != null ? fmtNum(w.speed_kmh, 1) + " km/h" : "–";
    const cls = "row-enter" + (justAddedFiles.has(w.file) ? " row-added" : "");
    return `<tr data-file="${encodeURIComponent(w.file)}" class="${cls}" style="animation-delay:${Math.min(i, 14) * 22}ms">
      <td>${w._date ? fmtDateWeekday(w._date) : "–"}</td>
      <td class="sport-cell"><span class="sport-dot" style="background:${sportColor(w.sport)}"></span>${w.sport}</td>
      <td class="num" data-col="duration">${w.duration_min != null ? fmtNum(w.duration_min, 0) + " min" : "–"}</td>
      <td class="num" data-col="distance">${w.distance_km != null ? fmtNum(w.distance_km, 2) + " km" : "–"}</td>
      <td class="num" data-col="hravg">${w.avg_hr ?? "–"}</td>
      <td class="num" data-col="hrmax">${w.max_hr ?? "–"}</td>
      <td class="num" data-col="pace">${paceOrSpeed}</td>
      <td class="num" data-col="elevation">${w.elevation_gain_m != null ? Math.round(w.elevation_gain_m) + " m" : "–"}</td>
      <td class="num" data-col="load">${w.training_load != null ? fmtNum(w.training_load, 0) : "–"}</td>
      <td class="num" data-col="kcal">${w.calories != null ? Math.round(w.calories) : "–"}</td>
    </tr>`;
  }).join("");
  if (!rows.length) tbody.innerHTML = `<tr><td colspan="${2 + WORKOUT_TOGGLE_COLUMNS.length}" class="empty-note">Keine Workouts im gewählten Zeitraum.</td></tr>`;
  applyWorkoutColumnVisibility();
}

/* ---------- Kompakte Workout-Tabelle im Coach-Tab -----------------------
   Kleinere Variante derselben Übersicht (nur Datum/Sportart/Dauer/Pace,
   keine Spaltenauswahl, keine "Alle anzeigen"-Ausklappung) - direkt im
   Coach-Tab statt erst in die Übersicht wechseln zu müssen (siehe
   CHANGE_REQUESTS.md). Nutzt dieselbe Detail-Modal-Funktion (openDetail). */
const COACH_TABLE_PREVIEW_COUNT = 6;
let coachRowsByFile = new Map();

function renderCoachWorkoutsMini(data) {
  const tbody = document.querySelector("#coach-workouts-table tbody");
  if (!tbody) return; // Coach-Tab-Markup evtl. noch nicht vorhanden
  const rows = [...data].sort((a, b) => (b._date || 0) - (a._date || 0)).slice(0, COACH_TABLE_PREVIEW_COUNT);
  coachRowsByFile = new Map(rows.map(w => [w.file, w]));
  tbody.innerHTML = rows.map((w, i) => {
    const paceOrSpeed = w.pace_min_per_km ? w.pace_min_per_km + " /km"
      : w.pace_min_per_100m ? w.pace_min_per_100m + " /100m"
      : w.speed_kmh != null ? fmtNum(w.speed_kmh, 1) + " km/h" : "–";
    return `<tr data-file="${encodeURIComponent(w.file)}" class="row-enter" style="animation-delay:${i * 22}ms">
      <td>${w._date ? fmtDateWeekday(w._date) : "–"}</td>
      <td class="sport-cell"><span class="sport-dot" style="background:${sportColor(w.sport)}"></span>${w.sport}</td>
      <td class="num">${w.duration_min != null ? fmtNum(w.duration_min, 0) + " min" : "–"}</td>
      <td class="num">${paceOrSpeed}</td>
    </tr>`;
  }).join("");
  if (!rows.length) tbody.innerHTML = `<tr><td colspan="4" class="empty-note">Keine Workouts im gewählten Zeitraum.</td></tr>`;
}

/* ---------- Spalten-Auswahl der Workout-Tabelle (Übersicht) -------------
   Welche Zusatz-Spalten (über Datum/Sportart hinaus) angezeigt werden, ist
   selbst wählbar und je Gerät gemerkt (siehe CHANGE_REQUESTS.md) - über das
   ⚙-Icon neben der Kartenüberschrift, das denselben Popover-Mechanismus wie
   die (i)-Erklärungen nutzt (initInfoPopovers, chart.js). ------------------ */
const WORKOUT_COLUMNS_KEY = "triathlon_dashboard_workout_columns_v1";
const WORKOUT_TOGGLE_COLUMNS = ["duration", "distance", "hravg", "hrmax", "pace", "elevation", "load", "kcal"];

function loadWorkoutColumnPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(WORKOUT_COLUMNS_KEY) || "null");
    if (Array.isArray(raw)) return new Set(raw.filter(c => WORKOUT_TOGGLE_COLUMNS.includes(c)));
  } catch (e) { /* ignorieren */ }
  return new Set(WORKOUT_TOGGLE_COLUMNS); // Standard: alle Spalten sichtbar (bisheriges Verhalten)
}
let visibleWorkoutColumns = loadWorkoutColumnPrefs();

function saveWorkoutColumnPrefs() {
  try { localStorage.setItem(WORKOUT_COLUMNS_KEY, JSON.stringify([...visibleWorkoutColumns])); } catch (e) { /* ignorieren */ }
}

function applyWorkoutColumnVisibility() {
  const table = document.getElementById("workouts-table");
  if (!table) return;
  WORKOUT_TOGGLE_COLUMNS.forEach(col => {
    const show = visibleWorkoutColumns.has(col);
    table.querySelectorAll(`[data-col="${col}"]`).forEach(el => { el.style.display = show ? "" : "none"; });
  });
}

function initWorkoutColumnToggle() {
  const popover = document.getElementById("workouts-columns-popover");
  if (!popover) return;
  popover.querySelectorAll("input[type=checkbox][data-col]").forEach(cb => {
    cb.checked = visibleWorkoutColumns.has(cb.dataset.col);
    cb.addEventListener("change", () => {
      if (cb.checked) visibleWorkoutColumns.add(cb.dataset.col); else visibleWorkoutColumns.delete(cb.dataset.col);
      saveWorkoutColumnPrefs();
      applyWorkoutColumnVisibility();
    });
  });
  applyWorkoutColumnVisibility();
}
initWorkoutColumnToggle();

document.querySelector("#workouts-table tbody").addEventListener("click", e => {
  const tr = e.target.closest("tr[data-file]");
  if (!tr) return;
  const w = currentRowsByFile.get(decodeURIComponent(tr.dataset.file));
  if (w) openDetail(w);
});
document.getElementById("table-expand-btn").addEventListener("click", () => {
  tableExpanded = !tableExpanded;
  renderTable(lastTableData);
  if (!tableExpanded) document.getElementById("workouts-table").scrollIntoView({ behavior: "smooth", block: "nearest" });
});

const coachWorkoutsTbody = document.querySelector("#coach-workouts-table tbody");
if (coachWorkoutsTbody) coachWorkoutsTbody.addEventListener("click", e => {
  const tr = e.target.closest("tr[data-file]");
  if (!tr) return;
  const w = coachRowsByFile.get(decodeURIComponent(tr.dataset.file));
  if (w) openDetail(w);
});
const coachWorkoutsFullLink = document.getElementById("coach-workouts-full-link");
if (coachWorkoutsFullLink) coachWorkoutsFullLink.addEventListener("click", e => {
  e.preventDefault();
  if (typeof activateView === "function") activateView("overview");
});

/* ---------- Detail-Modal ---------- */

const modalOverlay = document.getElementById("modal-overlay");
document.getElementById("modal-close").addEventListener("click", closeDetail);
modalOverlay.addEventListener("click", e => { if (e.target === modalOverlay) closeDetail(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDetail(); });

function closeDetail() { modalOverlay.classList.remove("open"); }


function openDetail(w) {
  const body = document.getElementById("modal-body");
  body.innerHTML = buildWorkoutDetailHtml(w);
  modalOverlay.classList.add("open");
  renderWorkoutDetailCharts(w, body);
  const compareBtn = body.querySelector(".wd-compare-btn");
  if (compareBtn) compareBtn.addEventListener("click", () => { if (typeof openComparePicker === "function") openComparePicker(w); });
}

// Baut das Detail-Markup einer Trainingseinheit (Kennzahl-Kacheln + Diagramm-
// Platzhalter) als HTML-String. Wiederverwendbar für das Modal UND für die
// aufklappbaren Einträge in der Kalender-Tagesansicht — deshalb Klassen statt
// fixer IDs für die Chart-Container (renderWorkoutDetailCharts sucht darin
// jeweils gescoped auf das übergebene Root-Element).
function buildWorkoutDetailHtml(w) {
  const stream = w.stream;
  const paceOrSpeed = w.pace_min_per_km ? w.pace_min_per_km + " min/km"
    : w.pace_min_per_100m ? w.pace_min_per_100m + " min/100m"
    : w.speed_kmh != null ? fmtNum(w.speed_kmh, 1) + " km/h" : "–";

  // Zusätzliche Kennzahl-Kacheln nur anzeigen, wenn das Gerät/Zubehör die
  // jeweiligen Werte tatsächlich aufgezeichnet hat (Lauf-Dynamik/Leistung
  // brauchen z.B. eine HRM-Pro-Brustgurt oder einen Running-Dynamics-Pod).
  const extraStats = [];
  const cadUnit = w.sport_raw === "cycling" ? "U/min" : "spm";
  if (w.avg_cadence != null) extraStats.push(["Ø Kadenz" + (w.max_cadence != null ? " / Max" : ""), `${Math.round(w.avg_cadence)}${w.max_cadence != null ? " / " + Math.round(w.max_cadence) : ""} ${cadUnit}`]);
  if (w.avg_power_w != null) extraStats.push(["Ø Leistung" + (w.max_power_w != null ? " / Max" : ""), `${Math.round(w.avg_power_w)}${w.max_power_w != null ? " / " + Math.round(w.max_power_w) : ""} W`]);
  if (w.normalized_power_w != null) extraStats.push(["Normalized Power", `${Math.round(w.normalized_power_w)} W`]);
  if (w.avg_stance_time_ms != null) extraStats.push(["Ø Bodenkontaktzeit", `${fmtNum(w.avg_stance_time_ms, 0)} ms`]);
  if (w.avg_vertical_ratio_pct != null) extraStats.push(["Vertikales Verhältnis", `${fmtNum(w.avg_vertical_ratio_pct, 1)} %`]);
  if (w.avg_vertical_oscillation_mm != null) extraStats.push(["Vertikale Oszillation", `${fmtNum(w.avg_vertical_oscillation_mm, 1)} mm`]);
  if (w.avg_step_length_mm != null) extraStats.push(["Ø Schrittlänge", `${Math.round(w.avg_step_length_mm)} mm`]);
  if (w.total_steps != null) extraStats.push(["Gesamtschritte", `${w.total_steps.toLocaleString("de-DE")}`]);
  if (w.avg_grade_pct != null) extraStats.push(["Ø Steigung", `${fmtNum(w.avg_grade_pct, 1)} %`]);
  // SWOLF/Zugfrequenz: nur bei nativen Becken-Aufzeichnungen mit Bahnen-Daten
  // vorhanden (aktuell bei keiner HealthFit-Datei der Fall, siehe
  // DATA_MODEL.md) - Kachel bleibt bis dahin einfach weg statt "–" zu zeigen.
  if (w.avg_swolf != null) extraStats.push(["SWOLF" + (w.best_swolf != null ? " (Ø / Beste Bahn)" : ""), `${fmtNum(w.avg_swolf, 1)}${w.best_swolf != null ? " / " + w.best_swolf : ""}`]);
  if (w.avg_stroke_rate != null) extraStats.push(["Ø Zugfrequenz", `${fmtNum(w.avg_stroke_rate, 0)} Züge/min`]);
  // Schwimmstil (dominant_stroke) bewusst nicht mehr angezeigt - die Erkennung
  // war falsch (unverifizierte FIT-Feldnummern, siehe fit-parser.js) und wird
  // von der KI ohnehin nicht genutzt, siehe CHANGE_REQUESTS.md.
  const extraStatsHtml = extraStats.map(([l, v]) => `<div class="st"><div class="l">${l}</div><div class="v">${v}</div></div>`).join("");

  // Welche Detail-Charts (über HF/Pace hinaus) tatsächlich Sekundendaten
  // haben - nur die werden als Block eingefügt, damit das Modal nicht mit
  // leeren "keine Daten"-Kästen für nicht aufgezeichnete Werte vollläuft.
  const hasAlt = !!(stream && stream.alt && stream.alt.some(v => v != null));
  const hasCad = !!(stream && stream.cad && stream.cad.some(v => v != null));
  const hasPower = !!(stream && stream.power && stream.power.some(v => v != null));
  const hasGct = !!(stream && stream.gct && stream.gct.some(v => v != null));
  const hasVr = !!(stream && stream.vr && stream.vr.some(v => v != null));
  const missingRunDynamics = w.sport_raw === "running" && !hasPower && !hasGct && !hasVr;

  return `
    <div class="modal-head">
      <span class="sport-dot" style="background:${sportColor(w.sport)}"></span>
      <h3>${w.sport}</h3>
      <button type="button" class="chip wd-compare-btn" data-file="${encodeURIComponent(w.file)}" title="Diese Einheit mit anderen vergleichen">⚖ Vergleichen</button>
    </div>
    <p class="modal-sub">${w._date ? fmtDateFull(w._date) + " · " + w._date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr" : ""}</p>
    <div class="modal-stats">
      <div class="st"><div class="l">Dauer</div><div class="v">${w.duration_min != null ? fmtNum(w.duration_min, 0) + " min" : "–"}</div></div>
      <div class="st"><div class="l">Distanz</div><div class="v">${w.distance_km != null ? fmtNum(w.distance_km, 2) + " km" : "–"}</div></div>
      <div class="st"><div class="l">Ø HF / Max HF</div><div class="v">${w.avg_hr ?? "–"} / ${w.max_hr ?? "–"}</div></div>
      <div class="st"><div class="l">Pace / Speed</div><div class="v">${paceOrSpeed}</div></div>
      <div class="st"><div class="l">Höhenmeter${w.elevation_gain_m == null && effectiveElevationGainM(w) != null ? " (nachgetragen)" : ""}</div><div class="v">${effectiveElevationGainM(w) != null ? Math.round(effectiveElevationGainM(w)) + " m" : "–"}</div></div>
      <div class="st"><div class="l">Load</div><div class="v">${w.training_load != null ? fmtNum(w.training_load, 0) : "–"}</div></div>
      <div class="st"><div class="l">Kalorien</div><div class="v">${w.calories != null ? Math.round(w.calories) + " kcal" : "–"}</div></div>
      ${extraStatsHtml}
      <div class="st"><div class="l">Datei</div><div class="v" style="font-size:11px; font-weight:500; word-break:break-all;">${w.file}</div></div>
    </div>
    <div class="modal-charts">
      <div>
        <h4>Herzfrequenz-Verlauf</h4>
        <div class="chart-wrap wd-hr-chart"></div>
      </div>
      <div>
        <h4>Pace- / Geschwindigkeitsverlauf</h4>
        <div class="chart-wrap wd-pace-chart"></div>
      </div>
      ${hasAlt ? `<div><h4>Höhenprofil</h4><div class="chart-wrap wd-alt-chart"></div></div>` : ""}
      ${hasCad ? `<div><h4>Schrittfrequenz-Verlauf</h4><div class="chart-wrap wd-cad-chart"></div></div>` : ""}
      ${hasPower ? `<div><h4>Leistungsverlauf</h4><div class="chart-wrap wd-power-chart"></div></div>` : ""}
      ${hasGct ? `<div><h4>Bodenkontaktzeit-Verlauf</h4><div class="chart-wrap wd-gct-chart"></div></div>` : ""}
      ${hasVr ? `<div><h4>Vertikales Verhältnis-Verlauf</h4><div class="chart-wrap wd-vr-chart"></div></div>` : ""}
      ${missingRunDynamics ? `<p class="empty-note" style="padding:4px 0 0;">Leistung, Bodenkontaktzeit und vertikales Verhältnis sind in dieser Aufzeichnung nicht enthalten — dafür braucht die Uhr einen kompatiblen Brustgurt (z.B. HRM-Pro Plus) oder einen Running-Dynamics-Pod bzw. eine Laufleistungs-Quelle.</p>` : ""}
      <div><h4>Herzfrequenzprofil</h4><div class="chart-wrap wd-hrprofile-chart"></div></div>
      <div><h4>Belastungsprofil</h4><div class="chart-wrap wd-radar-chart"></div></div>
    </div>
    ${buildWorkoutLoadStatsHtml(w)}
    ${buildWorkoutRatingHtml(w)}
    ${buildWorkoutAnalysisHtml(w)}`;
}

// Eigene Bewertung (1-5 Sterne, Klick toggelt an/aus) + Notiz zu dieser
// Einheit (js/data/workout-notes.js) - bewusst VOR dem KI-Auswertungs-Block
// platziert, damit die eigene Einschätzung zuerst kommt. Sterne speichern
// sofort bei Klick, die Notiz erst über den "Speichern"-Button (wie beim
// Gewichts-Eintrag im Ernährungs-Tab), damit nicht bei jedem Tastenanschlag
// geschrieben wird.
function buildWorkoutRatingHtml(w) {
  const entry = getWorkoutNote(w.file) || {};
  const stars = [1, 2, 3, 4, 5].map(n =>
    `<button type="button" class="wd-rating-star${entry.rating >= n ? " filled" : ""}" data-n="${n}" title="${n} von 5 Sternen">★</button>`
  ).join("");
  // Höhenmeter-Nachtrag nur anbieten, wenn die Aufzeichnung selbst KEINE
  // Höhenmeter hat (sonst wäre das verwirrend - der echte Wert hat immer
  // Vorrang, siehe effectiveElevationGainM(), js/data/workout-notes.js).
  const elevationRowHtml = w.elevation_gain_m == null ? `
      <div class="wd-rating-elevation-row">
        <label for="wd-rating-elevation-${encodeURIComponent(w.file)}">Höhenmeter nachtragen (fehlt in der Aufzeichnung)</label>
        <div class="wd-rating-elevation-inputs">
          <input type="number" id="wd-rating-elevation-${encodeURIComponent(w.file)}" class="coach-input wd-rating-elevation" min="0" step="1" value="${entry.elevationOverrideM != null ? entry.elevationOverrideM : ""}" placeholder="m">
          <button type="button" class="chip wd-rating-gpx-btn">GPX hochladen</button>
          <input type="file" accept=".gpx" class="wd-rating-gpx-input" hidden>
        </div>
      </div>` : "";
  return `
    <div class="wd-rating" data-file="${encodeURIComponent(w.file)}">
      <h4>Deine Bewertung</h4>
      <div class="wd-rating-stars">${stars}</div>
      <textarea class="coach-input wd-rating-note" placeholder="Notiz zu dieser Einheit (z.B. wie es sich angefühlt hat, Wetter, Besonderheiten) …" maxlength="500">${escapeHtml(entry.note || "")}</textarea>
      <div class="wd-analysis-actions">
        <button type="button" class="chip wd-rating-save-btn">Notiz speichern</button>
        ${entry.updatedAt ? `<span class="goal-rec-date">Zuletzt geändert: ${fmtDateFull(new Date(entry.updatedAt))}</span>` : ""}
      </div>
      ${elevationRowHtml}
    </div>`;
}

// Verkabelt Sterne + Notiz-Button EINER Bewertungs-Instanz - gescoped auf
// rootEl, gleiches Muster wie renderWorkoutDetailCharts (mehrere gleichzeitig
// offene Instanzen derselben Einheit möglich: Modal + Kalender-Tageszeile).
function wireWorkoutRatingBlock(rootEl, file) {
  const block = rootEl.querySelector(`.wd-rating[data-file="${encodeURIComponent(file)}"]`);
  if (!block) return;
  const starBtns = block.querySelectorAll(".wd-rating-star");
  starBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const n = Number(btn.dataset.n);
      const current = getWorkoutNote(file);
      // Erneutes Klicken auf den bereits gesetzten Wert entfernt die
      // Bewertung wieder (Toggle) - sonst liesse sich z.B. eine
      // 1-Sterne-Bewertung nicht mehr löschen.
      setWorkoutRating(file, current && current.rating === n ? null : n);
      const updated = getWorkoutNote(file);
      starBtns.forEach((s, i) => s.classList.toggle("filled", (updated && updated.rating || 0) >= (i + 1)));
    });
  });
  const saveBtn = block.querySelector(".wd-rating-save-btn");
  const textarea = block.querySelector(".wd-rating-note");
  if (saveBtn && textarea) {
    saveBtn.addEventListener("click", () => {
      setWorkoutNoteText(file, textarea.value);
      saveBtn.textContent = "Gespeichert ✓";
      setTimeout(() => { saveBtn.textContent = "Notiz speichern"; }, 1500);
    });
  }

  const elevationInput = block.querySelector(".wd-rating-elevation");
  if (elevationInput) elevationInput.addEventListener("change", () => setWorkoutElevationOverride(file, elevationInput.value));
  const gpxBtn = block.querySelector(".wd-rating-gpx-btn");
  const gpxInput = block.querySelector(".wd-rating-gpx-input");
  if (gpxBtn && gpxInput) {
    gpxBtn.addEventListener("click", () => gpxInput.click());
    gpxInput.addEventListener("change", async () => {
      const gpxFile = gpxInput.files && gpxInput.files[0];
      if (!gpxFile) return;
      const text = await gpxFile.text();
      const profile = parseGpxElevation(text);
      if (!profile) {
        const hint = block.querySelector(".wd-rating-elevation-row");
        if (hint && !hint.querySelector(".goal-error")) hint.insertAdjacentHTML("beforeend", `<p class="goal-error">Konnte aus dieser GPX-Datei kein Höhenprofil lesen (keine Höhendaten in den Trackpunkten gefunden).</p>`);
        return;
      }
      setWorkoutElevationOverride(file, profile.ascentM);
      if (elevationInput) elevationInput.value = profile.ascentM;
    });
  }
}

// "Trainingsbelastung"-Kachel (TRIMP, TRIMP/Min., eigener Stress-Score,
// Ø-Herzfrequenzreserve) - braucht Max-/Ruhe-Herzfrequenz im Athletenprofil,
// siehe computeTrainingLoadStats() in js/analytics/workout-profile.js. Ohne
// diese zwei Profilwerte (oder ohne Pulsdaten in dieser Einheit) bleibt der
// Block komplett weg statt erfundene Zahlen zu zeigen.
function buildWorkoutLoadStatsHtml(w) {
  const stats = computeTrainingLoadStats(w);
  if (!stats) return "";
  return `
    <div class="wd-loadstats">
      <h4>Trainingsbelastung</h4>
      <div class="modal-stats">
        <div class="st"><div class="l">TRIMP</div><div class="v">${stats.trimp}</div></div>
        <div class="st"><div class="l">TRIMP / Min.</div><div class="v">${fmtNum(stats.trimpPerMin, 2)}</div></div>
        <div class="st"><div class="l">Herzfrequenz-Stress-Score</div><div class="v">${stats.stressScore}</div></div>
        <div class="st"><div class="l">Ø Herzfrequenzreserve</div><div class="v">${fmtNum(stats.hrrPercent, 0)}<small> %</small></div></div>
      </div>
    </div>`;
}

// Auswertungs-Block (Button + Ergebnis/Fehler/Lade-Zustand) für die KI-
// Auswertung einer einzelnen Einheit im Vergleich zu ähnlichen früheren
// Einheiten. Eigene Funktion, damit sich nach dem Generieren NUR dieser Block
// neu zeichnen lässt (renderWorkoutAnalysisBlock), ohne die Diagramme
// drumherum neu aufzubauen.
function buildWorkoutAnalysisHtml(w) {
  const state = workoutAnalysisCache[w.file] || {};
  const btnLabel = state.loading ? "Werte aus …" : (state.analysis ? "Neu auswerten" : "KI-Auswertung starten");
  return `
    <div class="wd-analysis" data-file="${encodeURIComponent(w.file)}">
      <div class="wd-analysis-head">
        <h4>KI-Auswertung <span class="wd-analysis-hint">vergleicht mit ähnlichen früheren Einheiten (gleiche Sportart, Distanz/Dauer ±20%)</span></h4>
        <div class="wd-analysis-actions">
          <button type="button" class="chip wd-analysis-btn" ${state.loading ? "disabled" : ""}>${btnLabel}</button>
          ${state.analysisAt ? `<span class="goal-rec-date">Stand: ${fmtDateFull(new Date(state.analysisAt))}</span>` : ""}
        </div>
      </div>
      ${state.error ? `<p class="goal-error">${escapeHtml(state.error)}</p>` : ""}
      ${state.analysis ? `<div class="goal-recommendation">${formatRecommendation(state.analysis)}</div>` : ""}
    </div>`;
}

// Aktualisiert NUR den Auswertungs-Block einer Einheit (kann mehrfach
// gleichzeitig existieren: Modal + aufgeklappte Kalender-Tageszeile) - baut
// dessen HTML neu und verkabelt den Button erneut (geht bei outerHTML-Ersatz
// verloren).
function renderWorkoutAnalysisBlock(file) {
  const w = ALL.find(x => x.file === file);
  if (!w) return;
  document.querySelectorAll(`.wd-analysis[data-file="${encodeURIComponent(file)}"]`).forEach(el => {
    el.outerHTML = buildWorkoutAnalysisHtml(w);
  });
  document.querySelectorAll(`.wd-analysis[data-file="${encodeURIComponent(file)}"] .wd-analysis-btn`).forEach(btn => {
    btn.addEventListener("click", () => generateWorkoutAnalysis(file));
  });
}

// Zeichnet die Diagramme in die von buildWorkoutDetailHtml() erzeugten
// Platzhalter — gescoped auf rootEl, damit dieselbe Einheit gleichzeitig
// in mehreren Containern (Modal + mehrere aufgeklappte Tageszeilen) ohne
// ID-Kollisionen dargestellt werden kann.
function renderWorkoutDetailCharts(w, rootEl) {
  const stream = w.stream;
  const cadUnit = w.sport_raw === "cycling" ? "U/min" : "spm";
  const hasAlt = !!(stream && stream.alt && stream.alt.some(v => v != null));
  const hasCad = !!(stream && stream.cad && stream.cad.some(v => v != null));
  const hasPower = !!(stream && stream.power && stream.power.some(v => v != null));
  const hasGct = !!(stream && stream.gct && stream.gct.some(v => v != null));
  const hasVr = !!(stream && stream.vr && stream.vr.some(v => v != null));

  const fmtMin = t => { const m = Math.floor(t / 60), s = Math.round(t % 60); return `${m}:${String(s).padStart(2, "0")}`; };

  const hrHost = rootEl.querySelector(".wd-hr-chart");
  const hrPts = stream ? stream.t.map((t, i) => ({ t, y: stream.hr[i] })).filter(p => p.y != null) : [];
  const hrCoverage = stream ? hrPts.length / stream.t.length : 0;
  if (stream && hrPts.length >= 5 && hrCoverage >= 0.15) {
    drawMiniLine(hrHost, hrPts.map(p => ({ y: p.y, xLabel: fmtMin(p.t), tooltip: `<b>${fmtMin(p.t)}</b><br>${p.y} bpm` })),
      { color: "var(--c-hr-max)", width: 600, height: 150, maxLabels: 6, fmtAxis: v => Math.round(v) });
  } else if (stream && hrPts.length) {
    hrHost.innerHTML = `<p class='empty-note' style='padding:12px 0;'>Herzfrequenz war in dieser Aufzeichnung nur lückenhaft verfügbar (${hrPts.length} Messpunkte) — Ø ${w.avg_hr ?? "–"} bpm laut Gerät.</p>`;
  } else {
    hrHost.innerHTML = "<p class='empty-note' style='padding:12px 0;'>Keine Sekundendaten für diese Einheit vorhanden.</p>";
  }

  const paceHost = rootEl.querySelector(".wd-pace-chart");
  // Becken-Schwimmen: die Sekunden-Stream-Daten (record-Nachrichten) sind
  // beim Schwimmen kein echtes GPS-/Beschleunigungssignal, sondern werden
  // vom Gerät zwischen den Bahnen-Wandanschlägen nur LINEAR INTERPOLIERT
  // (echte Distanz ist erst am Bahnende bekannt) - genau das ergab die
  // "immer linear" wirkende Kurve, die real nichts über Schwankungen
  // innerhalb der Einheit aussagt (siehe CHANGE_REQUESTS.md). Die
  // Bahnen-Nachrichten (mesg 101, w.lengths) liefern dagegen eine echte
  // Ø-Geschwindigkeit JE BAHN - das ist die feinste ehrliche Auflösung, die
  // bei Becken-Schwimmen überhaupt zur Verfügung steht.
  const swimLengths = (w.sport_raw === "swimming" && Array.isArray(w.lengths))
    ? w.lengths.filter(l => l.speed_mps != null && l.speed_mps > 0)
    : null;
  if (swimLengths && swimLengths.length >= 2) {
    let cum = 0;
    const pts = swimLengths.map(l => {
      cum += l.duration_s || 0;
      return { t: cum, y: 100 / l.speed_mps, n: l.length_no };
    });
    drawMiniLine(paceHost, pts.map(p => ({
      y: p.y, xLabel: `Bahn ${p.n}`,
      tooltip: `<b>Bahn ${p.n}</b><br>${secondsToPace(p.y)} /100m`
    })), { color: "var(--c-rad)", width: 600, height: 150, maxLabels: 6, invert: true, fmtAxis: v => secondsToPace(v) });
  } else if (stream && stream.speed && stream.speed.some(v => v != null)) {
    const invert = w.sport_raw === "running" || w.sport_raw === "swimming";
    const unit = w.sport_raw === "running" ? "min/km" : w.sport_raw === "swimming" ? "min/100m" : "km/h";
    // Bekannter Datenfehler (siehe CHANGE_REQUESTS.md): bei den bisher
    // geprüften Dateien enthält record.speed/enhanced_speed für JEDE Sekunde
    // exakt denselben Wert (= Ø-Pace der ganzen Einheit) statt echter
    // Schwankung - Ursache vermutlich im Python-Build (parse_fit.py:
    // get_record_stream) oder im Garmin-Connect-Export selbst, an echten
    // Rohdaten noch nicht verifiziert. Eine perfekt flache "Sekunden"-Kurve
    // sähe hier nach echten Messwerten aus, ist aber nur der Durchschnitt -
    // deshalb lieber ehrlich sagen, dass keine echte Kurve vorliegt, statt
    // eine vorzutäuschen (AI_RULES: keine erfundenen Daten).
    const rawSpeeds = stream.speed.filter(v => v != null && v > 0);
    const distinctSpeeds = new Set(rawSpeeds.map(v => Math.round(v * 1000)));
    const looksFlat = rawSpeeds.length >= 5 && distinctSpeeds.size <= 1;
    const pts = looksFlat ? [] : stream.t.map((t, i) => {
      const sp = stream.speed[i];
      if (sp == null || sp <= 0) return null;
      let val;
      if (w.sport_raw === "running") val = 1000 / sp;
      else if (w.sport_raw === "swimming") val = 100 / sp;
      else val = sp * 3.6;
      return { t, y: val };
    }).filter(Boolean);
    if (looksFlat) {
      const avgLabel = w.pace_min_per_km ? `${w.pace_min_per_km} min/km` : w.pace_min_per_100m ? `${w.pace_min_per_100m} min/100m` : w.speed_kmh != null ? `${fmtNum(w.speed_kmh, 1)} km/h` : "–";
      paceHost.innerHTML = `<p class='empty-note' style='padding:12px 0;'>Diese Datei enthält keine echte Sekunden-Pace, nur einen konstanten Durchschnittswert (${avgLabel}) - eine Kurve würde hier eine Genauigkeit vortäuschen, die nicht vorhanden ist.</p>`;
    } else if (pts.length) {
      drawMiniLine(paceHost, pts.map(p => ({
        y: p.y, xLabel: fmtMin(p.t),
        tooltip: `<b>${fmtMin(p.t)}</b><br>${invert ? secondsToPace(p.y) : fmtNum(p.y, 1)} ${unit}`
      })), { color: "var(--c-rad)", width: 600, height: 150, maxLabels: 6, invert, fmtAxis: v => invert ? secondsToPace(v) : fmtNum(v, 1) });
    } else {
      paceHost.innerHTML = "<p class='empty-note' style='padding:12px 0;'>Keine Pace-/Speed-Daten für diese Einheit vorhanden.</p>";
    }
  } else {
    paceHost.innerHTML = "<p class='empty-note' style='padding:12px 0;'>Keine Sekundendaten für diese Einheit vorhanden.</p>";
  }

  // Höhenprofil (Meter über NN im Zeitverlauf)
  if (hasAlt) {
    const pts = stream.t.map((t, i) => ({ t, y: stream.alt[i] })).filter(p => p.y != null);
    drawMiniLine(rootEl.querySelector(".wd-alt-chart"), pts.map(p => ({
      y: p.y, xLabel: fmtMin(p.t), tooltip: `<b>${fmtMin(p.t)}</b><br>${fmtNum(p.y, 0)} m`
    })), { color: "var(--c-sonstiges)", width: 600, height: 150, maxLabels: 6, fmtAxis: v => Math.round(v) + " m" });
  }

  // Schrittfrequenz- bzw. Trittfrequenz-Verlauf
  if (hasCad) {
    const pts = stream.t.map((t, i) => ({ t, y: stream.cad[i] })).filter(p => p.y != null);
    drawMiniLine(rootEl.querySelector(".wd-cad-chart"), pts.map(p => ({
      y: p.y, xLabel: fmtMin(p.t), tooltip: `<b>${fmtMin(p.t)}</b><br>${Math.round(p.y)} ${cadUnit}`
    })), { color: "var(--c-schwimmen)", width: 600, height: 150, maxLabels: 6, fmtAxis: v => Math.round(v) });
  }

  // Leistungsverlauf (Watt)
  if (hasPower) {
    const pts = stream.t.map((t, i) => ({ t, y: stream.power[i] })).filter(p => p.y != null);
    drawMiniLine(rootEl.querySelector(".wd-power-chart"), pts.map(p => ({
      y: p.y, xLabel: fmtMin(p.t), tooltip: `<b>${fmtMin(p.t)}</b><br>${Math.round(p.y)} W`
    })), { color: "var(--c-warn)", width: 600, height: 150, maxLabels: 6, fmtAxis: v => Math.round(v) + " W" });
  }

  // Bodenkontaktzeit-Verlauf (ms)
  if (hasGct) {
    const pts = stream.t.map((t, i) => ({ t, y: stream.gct[i] })).filter(p => p.y != null);
    drawMiniLine(rootEl.querySelector(".wd-gct-chart"), pts.map(p => ({
      y: p.y, xLabel: fmtMin(p.t), tooltip: `<b>${fmtMin(p.t)}</b><br>${Math.round(p.y)} ms`
    })), { color: "var(--c-laufen)", width: 600, height: 150, maxLabels: 6, fmtAxis: v => Math.round(v) + " ms" });
  }

  // Vertikales-Verhältnis-Verlauf (%)
  if (hasVr) {
    const pts = stream.t.map((t, i) => ({ t, y: stream.vr[i] })).filter(p => p.y != null);
    drawMiniLine(rootEl.querySelector(".wd-vr-chart"), pts.map(p => ({
      y: p.y, xLabel: fmtMin(p.t), tooltip: `<b>${fmtMin(p.t)}</b><br>${fmtNum(p.y, 1)} %`
    })), { color: "var(--c-tsb-neg)", width: 600, height: 150, maxLabels: 6, fmtAxis: v => fmtNum(v, 1) + "%" });
  }

  const hrProfileHost = rootEl.querySelector(".wd-hrprofile-chart");
  if (hrProfileHost) renderWorkoutHrProfile(w, hrProfileHost);
  const radarHost = rootEl.querySelector(".wd-radar-chart");
  if (radarHost) renderWorkoutLoadRadar(w, radarHost);

  const analysisBtn = rootEl.querySelector(".wd-analysis-btn");
  if (analysisBtn) analysisBtn.addEventListener("click", () => generateWorkoutAnalysis(w.file));
  wireWorkoutRatingBlock(rootEl, w.file);
}

// Herzfrequenzprofil dieser einen Einheit (Fläche, bpm-Farbverlauf) im
// Vergleich zur sonstigen Verteilung derselben Sportart (gestrichelte
// Vergleichskurve) - Berechnung in computeWorkoutHrProfile()
// (js/analytics/workout-profile.js). Eindeutige Gradient-ID pro Aufruf
// nötig, da dieselbe Einheit gleichzeitig in mehreren Containern (Modal +
// mehrere aufgeklappte Kalendertage) dargestellt werden kann.
let wdHrProfileGradientCounter = 0;

function renderWorkoutHrProfile(w, host) {
  const profile = computeWorkoutHrProfile(w, ALL);
  if (!profile) { host.innerHTML = "<p class='empty-note' style='padding:12px 0;'>Zu wenig Puls-Streckendaten für ein Herzfrequenzprofil dieser Einheit.</p>"; return; }

  const { minHr, maxHr, binCount, ownDensity, compareDensity, variability, zoneBounds } = profile;
  const W = 600, padL = 44, padR = 16, padT = 30, padB = 34, peakH = 108;
  const innerW = W - padL - padR;
  const H = padT + peakH + padB;
  const baseline = padT + peakH;
  const span = maxHr - minHr;
  const x = i => padL + (binCount <= 1 ? innerW / 2 : i / (binCount - 1) * innerW);
  const xForHr = hr => padL + ((hr - minHr) / span) * innerW;

  const gradId = `wd-hrprofile-gradient-${++wdHrProfileGradientCounter}`;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });
  const defs = svgEl("defs", {});
  const grad = svgEl("linearGradient", { id: gradId, gradientUnits: "userSpaceOnUse", x1: padL, x2: W - padR, y1: 0, y2: 0 });
  const zoneColors = ["var(--c-z1)", "var(--c-z2)", "var(--c-z3)", "var(--c-z4)", "var(--c-z5)"];
  zoneColors.forEach((c, i) => grad.appendChild(svgEl("stop", { offset: `${(i / 5) * 100}%`, "stop-color": c })));
  grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": zoneColors[zoneColors.length - 1] }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  zoneBounds.forEach((b, i) => {
    if (i > 0 && i < zoneBounds.length - 1) {
      svg.appendChild(svgEl("line", { x1: xForHr(b), x2: xForHr(b), y1: padT - 14, y2: baseline, class: "grid-line" }));
      const lbl = svgEl("text", { x: xForHr(b), y: baseline + 16, class: "axis-label", "text-anchor": "middle", "font-weight": "650" });
      lbl.textContent = Math.round(b);
      svg.appendChild(lbl);
    }
  });
  zoneColors.forEach((c, i) => {
    const midHr = (zoneBounds[i] + zoneBounds[i + 1]) / 2;
    const lbl = svgEl("text", { x: xForHr(midHr), y: padT - 18, "text-anchor": "middle", "font-size": "11", "font-weight": "700", fill: c });
    lbl.textContent = `Z${i + 1}`;
    svg.appendChild(lbl);
  });

  if (compareDensity) {
    let d = `M ${x(0)} ${baseline} `;
    compareDensity.forEach((v, i) => { d += `L ${x(i)} ${baseline - v * peakH} `; });
    d += `L ${x(binCount - 1)} ${baseline} Z`;
    svg.appendChild(svgEl("path", { d, fill: "none", stroke: "var(--text-muted)", "stroke-width": 1.5, "stroke-dasharray": "4 4", opacity: "0.85" }));
  }

  let d2 = `M ${x(0)} ${baseline} `;
  ownDensity.forEach((v, i) => { d2 += `L ${x(i)} ${baseline - v * peakH} `; });
  d2 += `L ${x(binCount - 1)} ${baseline} Z`;
  const ownArea = svgEl("path", { d: d2, fill: `url(#${gradId})`, opacity: "0.85", stroke: "var(--text-primary)", "stroke-width": "1.2", "stroke-opacity": "0.4", class: "chart-area" });
  svg.appendChild(ownArea);

  host.innerHTML = ""; host.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = `<span class="item"><b>${variability}</b></span>` +
    (compareDensity ? `<span class="item"><span class="swatch line" style="background:var(--text-muted)"></span>Ø ${sportGroup(w.sport)} sonst</span>` : "");
  host.appendChild(legend);
}

// Belastungsprofil (Radar, 6 Achsen) dieser Einheit im Vergleich zum
// Sportart-Durchschnitt - Berechnung in computeLoadRadar()
// (js/analytics/workout-profile.js). Werte je Achse sind bereits 0..1
// normiert (Min-Max über Vergleichsgruppe + diese Einheit).
function fmtRadarValue(axis, useAvg) {
  const v = useAvg ? axis.avgRaw : axis.ownRaw;
  switch (axis.label) {
    case "Ø-Schnitt": return fmtNum(v, 1) + " km/h";
    case "kcal/Min.": return fmtNum(v, 1) + " kcal/min";
    case "HF Ø": return Math.round(v) + " bpm";
    case "Strecke": return fmtNum(v, 2) + " km";
    case "Dauer": return fmtNum(v, 0) + " min";
    case "Negativer Split": return (v >= 0 ? "+" : "") + fmtNum(v, 1) + " %";
    default: return fmtNum(v, 1);
  }
}

function renderWorkoutLoadRadar(w, host) {
  const axes = computeLoadRadar(w, ALL);
  if (!axes) { host.innerHTML = "<p class='empty-note' style='padding:12px 0;'>Noch nicht genug vergleichbare Einheiten dieser Sportart für ein Belastungsprofil (mind. 5 nötig).</p>"; return; }

  const n = axes.length;
  const W = 320, H = 300, cx = W / 2, cy = H / 2 - 6, r = 106;
  const angleFor = i => -Math.PI / 2 + i * (2 * Math.PI / n);
  const pointAt = (i, frac) => {
    const a = angleFor(i);
    const rr = r * Math.max(0, Math.min(1, frac));
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  };
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });

  [0.25, 0.5, 0.75, 1].forEach(f => {
    let d = "";
    for (let i = 0; i < n; i++) { const [x, y] = pointAt(i, f); d += (i === 0 ? "M" : "L") + x + " " + y + " "; }
    d += "Z";
    svg.appendChild(svgEl("path", { d, fill: "none", stroke: "var(--grid)", "stroke-width": 1 }));
  });
  for (let i = 0; i < n; i++) {
    const [x, y] = pointAt(i, 1);
    svg.appendChild(svgEl("line", { x1: cx, y1: cy, x2: x, y2: y, stroke: "var(--grid)", "stroke-width": 1 }));
  }
  axes.forEach((axis, i) => {
    const [x, y] = pointAt(i, 1.22);
    const t = svgEl("text", { x, y: y + 4, "text-anchor": "middle", class: "axis-label", "font-weight": "620" });
    t.textContent = axis.label;
    svg.appendChild(t);
  });

  function polygon(valueKey) {
    let d = "";
    axes.forEach((axis, i) => { const [x, y] = pointAt(i, axis[valueKey]); d += (i === 0 ? "M" : "L") + x + " " + y + " "; });
    d += "Z";
    return d;
  }

  svg.appendChild(svgEl("path", { d: polygon("avg"), fill: "none", stroke: "var(--text-muted)", "stroke-width": 1.5, "stroke-dasharray": "4 4" }));
  svg.appendChild(svgEl("path", { d: polygon("own"), fill: "var(--accent-wash)", stroke: "var(--accent)", "stroke-width": 2, "stroke-linejoin": "round", class: "chart-area" }));

  axes.forEach((axis, i) => {
    const [x, y] = pointAt(i, axis.own);
    const visDot = svgEl("circle", { cx: x, cy: y, r: 3.5, fill: "var(--accent)", class: "chart-bar", style: "cursor:pointer;" });
    const dot = svgEl("circle", { cx: x, cy: y, r: 9, fill: "transparent" });
    dot.addEventListener("mousemove", e => { showTip(e, `<b>${axis.label}</b><br>Diese Einheit: ${fmtRadarValue(axis)}<br>Ø ${sportGroup(w.sport)}: ${fmtRadarValue(axis, true)}`, host); visDot.classList.add("chart-line-active"); visDot.setAttribute("r", "5"); });
    dot.addEventListener("mouseleave", () => { hideTip(); visDot.setAttribute("r", "3.5"); });
    svg.appendChild(visDot);
    svg.appendChild(dot);
  });

  host.innerHTML = ""; host.appendChild(svg);
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = `<span class="item"><span class="swatch line" style="background:var(--accent)"></span>Diese Einheit</span><span class="item"><span class="swatch line" style="background:var(--text-muted)"></span>Ø ${sportGroup(w.sport)}</span>`;
  host.appendChild(legend);
}

/* ---------- Alles neu rendern ---------- */
