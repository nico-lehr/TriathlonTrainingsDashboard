// Kalender-Tab: Monats-, Wochen- und Tagesansicht + Steuerung (Zeitraum
// wechseln, Ansicht wechseln, Sportart-Filter). In der Tagesansicht lässt
// sich jedes Training einzeln aufklappen (mehrere gleichzeitig möglich) —
// nutzt dafür dieselben Detail-Bausteine wie das Modal (siehe workout-card.js:
// buildWorkoutDetailHtml/renderWorkoutDetailCharts).

let calViewMode = "month"; // "month" | "week" | "day"
let calFocusDay = new Date(); calFocusDay.setHours(0, 0, 0, 0); // fokussierter Tag für Wochen-/Tagesansicht

const CAL_SPORT_ORDER = ["Schwimmen", "Rad", "Laufen", "Sonstiges"];
const CAL_SPORT_COLORS = { Schwimmen: "var(--c-schwimmen)", Rad: "var(--c-rad)", Laufen: "var(--c-laufen)", Sonstiges: "var(--c-sonstiges)" };

function initCalendarControls() {
  document.getElementById("cal-prev").addEventListener("click", () => calNav(-1));
  document.getElementById("cal-next").addEventListener("click", () => calNav(1));
  document.getElementById("cal-today").addEventListener("click", () => {
    calMonth = new Date(); calMonth.setDate(1); calMonth.setHours(0, 0, 0, 0);
    calFocusDay = new Date(); calFocusDay.setHours(0, 0, 0, 0);
    renderCalendar();
  });
  document.getElementById("cal-sport-filter").addEventListener("change", e => {
    calSportFilter = e.target.value;
    renderCalendar();
  });
  document.querySelectorAll(".cal-view-btn").forEach(btn => {
    btn.addEventListener("click", () => setCalViewMode(btn.dataset.mode));
  });
  // Legt eine neue Einheit für den gerade fokussierten Tag an (Monatsansicht:
  // heute bzw. der zuletzt fokussierte Tag, da dort kein einzelner Tag
  // ausgewählt ist; Wochen-/Tagesansicht: der jeweils sichtbare Tag) -
  // nutzt dasselbe Bearbeiten-Overlay wie ein von der KI erstellter Vorschlag
  // (openPlanEdit, js/components/training-plan.js), nur im Neuanlage-Modus.
  const addBtn = document.getElementById("cal-add-workout-btn");
  if (addBtn) addBtn.addEventListener("click", () => {
    const goal = getPrimaryGoal();
    openPlanEdit(null, { date: localDateStr(calFocusDay), goalId: goal ? goal.id : null });
  });
}

function setCalViewMode(mode) {
  calViewMode = mode;
  document.querySelectorAll(".cal-view-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  renderCalendar();
}

function calNav(dir) {
  if (calViewMode === "month") calMonth.setMonth(calMonth.getMonth() + dir);
  else if (calViewMode === "week") calFocusDay.setDate(calFocusDay.getDate() + dir * 7);
  else calFocusDay.setDate(calFocusDay.getDate() + dir);
  renderCalendar();
}

// Wechselt in die Tagesansicht für einen bestimmten Tag (Klick auf eine
// Monats-/Wochenzelle). Klicks auf einen einzelnen Trainings-Punkt öffnen
// weiterhin direkt das Modal (siehe Dot-Handler unten, stoppt die Bubblung).
function openCalDay(dayDate) {
  calFocusDay = new Date(dayDate); calFocusDay.setHours(0, 0, 0, 0);
  setCalViewMode("day");
}

function calTitle() {
  if (calViewMode === "month") return `${MONTH_NAMES_DE[calMonth.getMonth()]} ${calMonth.getFullYear()}`;
  if (calViewMode === "week") {
    const ws = weekStart(calFocusDay);
    const we = new Date(ws.getTime() + 6 * 86400000);
    return ws.getMonth() === we.getMonth()
      ? `${ws.getDate()}.–${we.getDate()}. ${MONTH_NAMES_DE[we.getMonth()]} ${we.getFullYear()}`
      : `${fmtDate(ws)} – ${fmtDate(we)} ${we.getFullYear()}`;
  }
  return calFocusDay.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function renderCalendar() {
  const titleEl = document.getElementById("cal-month-title");
  if (titleEl) titleEl.textContent = calTitle();
  if (calViewMode === "week") renderCalendarWeek();
  else if (calViewMode === "day") renderCalendarDay();
  else renderCalendarMonth();
  renderCalWeatherNote();
  // Wetter beim ersten Zeichnen und danach höchstens stündlich neu holen
  // (js/data/weather.js) - ohne Heimatort gar nicht.
  if (weatherNeedsRefresh()) loadWeatherForecast().then(() => renderCalendar());
  // renderCalendar() wird von praktisch jeder Stelle aufgerufen, die
  // plannedWorkouts verändert (KI-Plan erzeugen/ersetzen, Einheit anlegen/
  // bearbeiten/löschen/verschieben) - der Ernährungs-Tab (Vor-dem-Training-
  // Timing + Wettkampf-Verpflegung, siehe js/components/nutrition.js) hängt
  // an genau diesen Daten, wurde bisher aber nur einmal beim App-Start
  // gerendert und zeigte danach veraltete/nicht mehr zum Kalender passende
  // Empfehlungen. Hier zentral mit auffrischen, statt an jeder einzelnen
  // Aufrufstelle einzeln daran denken zu müssen.
  if (typeof renderNutrition === "function") renderNutrition();
}

// Sportart-Filter im Kalender. Indoor/Outdoor wird bewusst NICHT unterschieden -
// im Dashboard wird Rad durchgehend zusammen dargestellt; die Trennung existiert
// nur noch in den Vergleichsgruppen (sameComparisonGroup in js/data/workouts.js).
function calMatchesFilter(w) {
  if (calSportFilter === "all") return true;
  return sportGroup(w.sport) === calSportFilter;
}

function calWorkoutsOfDay(dayDate) {
  const key = localDateStr(dayDate);
  return ALL.filter(w => w._date && localDateStr(w._date) === key && calMatchesFilter(w));
}

function calPlannedOfDay(dayDate) {
  return plannedWorkoutsOfDay(dayDate).filter(calMatchesFilter);
}

/* Drag & Drop: eine geplante Einheit auf einen anderen Kalendertag ziehen,
   um sie zu verschieben - native HTML5-Drag&Drop (im Unterschied zur
   Karten-Umsortierung in app-shell.js, die mit rohen Maus-Events arbeitet,
   weil dort während des Ziehens eine Animation läuft; hier reicht der
   einfachere Browser-Mechanismus, weil nur ein Datum geändert wird). */
function wireCalPlannedDrag(chipEl, plannedId) {
  chipEl.draggable = true;
  chipEl.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/plain", plannedId);
    e.dataTransfer.effectAllowed = "move";
    chipEl.classList.add("dragging");
  });
  chipEl.addEventListener("dragend", () => chipEl.classList.remove("dragging"));
}

function wireCalDropTarget(cellEl, dayDate) {
  cellEl.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; cellEl.classList.add("cal-drop-target"); });
  cellEl.addEventListener("dragleave", () => cellEl.classList.remove("cal-drop-target"));
  cellEl.addEventListener("drop", async e => {
    e.preventDefault();
    cellEl.classList.remove("cal-drop-target");
    const id = e.dataTransfer.getData("text/plain");
    const pw = id && plannedWorkouts.find(p => p.id === id);
    const newDate = localDateStr(dayDate);
    if (!pw || pw.date === newDate) return;
    // Erst nach der Regelprüfung verschieben (Rückfrage/Vorschlag, siehe
    // commitCheckedPlanChange in training-plan.js).
    await commitCheckedPlanChange(patchedPlannedWorkouts(plannedWorkouts, id, { date: newDate }));
    renderCalendar();
    renderTrainingPlanCard();
  });
}

function calPlannedChipHtml(p) {
  return `<div class="cal-planned-chip cal-planned-${p.status}" data-id="${p.id}" style="--sport-color:${sportColor(p.sport)}" title="${escapeHtml(p.sport)} · ${escapeHtml(p.title)}${p.duration_min ? " · " + Math.round(p.duration_min) + " min" : ""}">
    <span class="sport-dot" style="background:${sportColor(p.sport)}"></span>${escapeHtml(p.title)}
  </div>`;
}

/* Wetter an Outdoor-Einheiten: Vorhersage aus js/data/weather.js, ob eine
   Einheit draußen stattfindet entscheidet isOutdoorPlannedWorkout()
   (js/data/workouts.js). Nur an Tagen mit Vorhersage UND mindestens einer
   geplanten Outdoor-Einheit; fehlende Werte werden weggelassen. */
function calWeatherText(d) {
  const info = weatherCodeInfo(d.code);
  return [
    info ? info.label : null,
    d.temp_min != null && d.temp_max != null ? `${Math.round(d.temp_min)}–${Math.round(d.temp_max)} °C` : null,
    d.precip_prob != null ? `Regen ${Math.round(d.precip_prob)} %` : null,
    d.wind_max != null ? `Wind bis ${Math.round(d.wind_max)} km/h` : null,
  ].filter(Boolean).join(" · ");
}

// variant: "month" (Symbol + max/min), "week" (+ Regen/Wind), "day" (ganzer Text + Ort)
function calWeatherHtml(dayDate, dayPlanned, variant) {
  const d = weatherForDate(localDateStr(dayDate));
  if (!d || !dayPlanned.some(isOutdoorPlannedWorkout)) return "";
  const info = weatherCodeInfo(d.code);
  const icon = info ? `<span aria-hidden="true">${info.icon}</span>` : "";
  const text = calWeatherText(d);
  if (variant === "day") {
    const place = athleteProfile.homeLocation ? athleteProfile.homeLocation.name : "";
    return `<div class="cal-weather cal-weather-day">${icon}<span>${escapeHtml(text)}</span><span class="cal-weather-sub">Vorhersage für ${escapeHtml(place)}</span></div>`;
  }
  const temps = d.temp_max != null && d.temp_min != null ? `${Math.round(d.temp_max)}° / ${Math.round(d.temp_min)}°` : "";
  const extra = variant === "week"
    ? [d.precip_prob != null ? `<span>💧 ${Math.round(d.precip_prob)} %</span>` : "", d.wind_max != null ? `<span>💨 ${Math.round(d.wind_max)} km/h</span>` : ""].join("")
    : "";
  return `<div class="cal-weather" title="Wetter-Vorhersage: ${escapeHtml(text)}">${icon}<span>${temps}</span>${extra ? `<span class="cal-weather-sub">${extra}</span>` : ""}</div>`;
}

// Hinweis über dem Kalender: Fehlertext, wenn das Wetter gerade nicht kommt -
// ohne Heimatort ein Tipp, aber nur, wenn in den nächsten 7 Tagen überhaupt
// eine Outdoor-Einheit geplant ist.
function renderCalWeatherNote() {
  const el = document.getElementById("cal-weather-note");
  if (!el) return;
  let text = "";
  if (athleteProfile.homeLocation) {
    if (weatherState.error) text = `Wetter gerade nicht verfügbar: ${weatherState.error}`;
  } else {
    const end = new Date(); end.setDate(end.getDate() + 6);
    const from = todayStr(), to = localDateStr(end);
    if (plannedWorkouts.some(p => p.date >= from && p.date <= to && isOutdoorPlannedWorkout(p))) {
      text = "Tipp: Heimatort unter ⚙️ Einstellungen → „Wetter im Kalender“ eintragen, dann steht an Outdoor-Einheiten der nächsten 7 Tage die Vorhersage.";
    }
  }
  el.textContent = text;
  el.hidden = !text;
}

function wireCalPlannedChips(rootEl) {
  rootEl.querySelectorAll(".cal-planned-chip").forEach(chip => {
    wireCalPlannedDrag(chip, chip.dataset.id);
    chip.addEventListener("click", e => { e.stopPropagation(); openPlanEdit(chip.dataset.id); });
  });
}

/* ---------- Monatsansicht ---------- */

function renderCalendarMonth() {
  const el = document.getElementById("calendar-grid");

  const withDate = ALL.filter(w => w._date && calMatchesFilter(w));
  const byDay = new Map(); // "YYYY-MM-DD" -> Workouts
  withDate.forEach(w => {
    const key = localDateStr(w._date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(w);
  });

  // Monatsraster: von Montag der ersten bis Sonntag der letzten sichtbaren Woche
  // (angrenzende Tage aus Vor-/Folgemonat werden abgeblendet mit angezeigt, wie
  // in einer klassischen Monatsansicht).
  const firstOfMonth = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
  const lastOfMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0);
  const gridStart = weekStart(firstOfMonth).getTime();
  const gridEndWs = weekStart(lastOfMonth).getTime();
  const dayMs = 86400000, weekMs = 7 * dayMs;
  const todayKey = todayStr();

  const frag = document.createDocumentFragment();

  DOW_LABELS_DE.forEach(lbl => {
    const h = document.createElement("div");
    h.className = "cal-dow-header";
    h.textContent = lbl;
    frag.appendChild(h);
  });
  const summaryHeader = document.createElement("div");
  summaryHeader.className = "cal-dow-header";
  summaryHeader.textContent = "Woche";
  frag.appendChild(summaryHeader);

  for (let ws = gridStart; ws <= gridEndWs; ws += weekMs) {
    const weekWorkouts = [];
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(ws + d * dayMs);
      const key = localDateStr(dayDate);
      const dayWorkouts = byDay.get(key) || [];
      weekWorkouts.push(...dayWorkouts);
      const inMonth = dayDate.getMonth() === calMonth.getMonth();

      const cell = document.createElement("div");
      cell.className = "cal-cell" + (inMonth ? "" : " muted") + (key === todayKey ? " today" : "");
      cell.addEventListener("click", () => openCalDay(dayDate));

      const num = document.createElement("div");
      num.className = "cal-daynum";
      num.textContent = dayDate.getDate();
      cell.appendChild(num);

      const dots = document.createElement("div");
      dots.className = "cal-dots";
      dayWorkouts.forEach(w => {
        const dot = document.createElement("span");
        dot.className = "cal-dot";
        dot.style.background = sportColor(w.sport);
        dot.title = `${w.sport} · ${w.duration_min != null ? fmtNum(w.duration_min, 0) + " min" : ""}`;
        dot.addEventListener("click", e => { e.stopPropagation(); openDetail(w); });
        dots.appendChild(dot);
      });
      cell.appendChild(dots);

      const realDayMin = dayWorkouts.filter(w => !w.is_summary).reduce((s, w) => s + (w.duration_min || 0), 0);
      if (realDayMin > 0) {
        const minEl = document.createElement("div");
        minEl.className = "cal-day-min";
        minEl.textContent = `${fmtNum(realDayMin, 0)} min`;
        cell.appendChild(minEl);
      }

      const dayPlanned = calPlannedOfDay(dayDate);
      if (dayPlanned.length) {
        const plannedEl = document.createElement("div");
        plannedEl.className = "cal-planned-list";
        plannedEl.innerHTML = calWeatherHtml(dayDate, dayPlanned, "month") + dayPlanned.map(calPlannedChipHtml).join("");
        cell.appendChild(plannedEl);
      }
      wireCalDropTarget(cell, dayDate);

      frag.appendChild(cell);
    }

    // Wochen-Zusammenfassung: Zeit, Load & Zeit je Sportart (Triathlon-Gesamt-
    // Einträge ausgeschlossen, damit nichts doppelt gezählt wird - wie überall
    // sonst im Dashboard). Zählt immer die ganze Kalenderwoche, auch wenn
    // einzelne Tage in den Vor-/Folgemonat fallen.
    const summary = document.createElement("div");
    summary.className = "cal-summary-cell";
    summary.innerHTML = calSummaryHtml(weekWorkouts);
    frag.appendChild(summary);
  }

  el.innerHTML = "";
  el.className = "cal-grid-month chart-enter";
  el.appendChild(frag);
  wireCalPlannedChips(el);
}

function calSummaryHtml(workouts) {
  const realWorkouts = workouts.filter(w => !w.is_summary);
  const totalMin = realWorkouts.reduce((s, w) => s + (w.duration_min || 0), 0);
  const totalLoad = realWorkouts.reduce((s, w) => s + (w.training_load || 0), 0);
  const bySport = {}; CAL_SPORT_ORDER.forEach(k => bySport[k] = 0);
  realWorkouts.forEach(w => { bySport[sportGroup(w.sport)] += (w.duration_min || 0); });
  const activeSports = CAL_SPORT_ORDER.filter(k => bySport[k] > 0);
  return realWorkouts.length ? `
    <div class="cal-summary-time">${fmtH(totalMin)} h</div>
    <div class="cal-summary-load">Load <b>${totalLoad > 0 ? fmtNum(totalLoad, 0) : "–"}</b></div>
    ${activeSports.map(k => `<div class="cal-summary-sport"><span class="dot" style="background:${CAL_SPORT_COLORS[k]}"></span>${fmtH(bySport[k])} h</div>`).join("")}
  ` : `<div class="cal-summary-empty">Ruhewoche</div>`;
}

/* ---------- Wochenansicht ---------- */

function renderCalendarWeek() {
  const el = document.getElementById("calendar-grid");
  const ws = weekStart(calFocusDay);
  const dayMs = 86400000;
  const todayKey = todayStr();
  const weekWorkouts = [];
  const weekPlanned = []; // für den "Für Garmin exportieren"-Button unten - alle geplanten (noch nicht erledigten) Einheiten dieser Woche

  const cols = DOW_LABELS_DE.map((lbl, i) => {
    const dayDate = new Date(ws.getTime() + i * dayMs);
    const key = localDateStr(dayDate);
    const dayWorkouts = calWorkoutsOfDay(dayDate);
    weekWorkouts.push(...dayWorkouts);
    const isToday = key === todayKey;
    const dayPlanned = calPlannedOfDay(dayDate);
    weekPlanned.push(...dayPlanned.filter(p => p.status === "geplant"));
    const itemsHtml = (dayWorkouts.length || dayPlanned.length) ? (
      dayWorkouts.map(w => `
      <div class="cal-week-item" data-file="${encodeURIComponent(w.file)}">
        <span class="sport-dot" style="background:${sportColor(w.sport)}"></span>
        <span class="cal-week-item-sport">${w.sport}</span>
        <span class="cal-week-item-dur">${w.duration_min != null ? fmtNum(w.duration_min, 0) + " min" : ""}</span>
      </div>`).join("") + calWeatherHtml(dayDate, dayPlanned, "week") + dayPlanned.map(calPlannedChipHtml).join("")
    ) : `<div class="cal-week-empty">–</div>`;
    return `
      <div class="cal-week-day-col${isToday ? " today" : ""}" data-day-idx="${i}">
        <button type="button" class="cal-week-day-head" data-day-idx="${i}">
          <span class="cal-week-day-name">${lbl}</span>
          <span class="cal-week-day-num">${dayDate.getDate()}</span>
        </button>
        <div class="cal-week-day-list">${itemsHtml}</div>
      </div>`;
  }).join("");

  el.innerHTML = `
    <div class="cal-week-days">${cols}</div>
    <div class="cal-week-summary">
      ${calSummaryHtml(weekWorkouts)}
      ${weekPlanned.length ? `<button type="button" class="chip cal-week-export-btn" title="Alle geplanten Einheiten dieser Woche als .fit-Dateien für Garmin Connect herunterladen">Woche für Garmin exportieren</button>` : ""}
    </div>`;
  el.className = "cal-grid-week chart-enter";

  const weekExportBtn = el.querySelector(".cal-week-export-btn");
  if (weekExportBtn) weekExportBtn.addEventListener("click", () => exportPlannedWorkoutsAsFit(weekPlanned));

  el.querySelectorAll(".cal-week-day-head").forEach(btn => {
    const dayDate = new Date(ws.getTime() + Number(btn.dataset.dayIdx) * dayMs);
    btn.addEventListener("click", () => openCalDay(dayDate));
  });
  el.querySelectorAll(".cal-week-item").forEach(item => {
    const w = ALL.find(x => x.file === decodeURIComponent(item.dataset.file));
    if (w) item.addEventListener("click", () => openDetail(w));
  });
  el.querySelectorAll(".cal-week-day-col").forEach(col => {
    const dayDate = new Date(ws.getTime() + Number(col.dataset.dayIdx) * dayMs);
    wireCalDropTarget(col, dayDate);
  });
  wireCalPlannedChips(el);
}

/* ---------- Tagesansicht ---------- */
// Kurze Tageszusammenfassung oben, darunter jedes Training einzeln aufklappbar
// (mehrere gleichzeitig offen möglich) mit den vollen Detail-Diagrammen —
// wiederverwendet dieselben Bausteine wie das Modal (workout-card.js).

function renderCalendarDay() {
  const el = document.getElementById("calendar-grid");
  const dayWorkouts = calWorkoutsOfDay(calFocusDay);
  const realWorkouts = dayWorkouts.filter(w => !w.is_summary);
  const totalMin = realWorkouts.reduce((s, w) => s + (w.duration_min || 0), 0);
  const totalLoad = realWorkouts.reduce((s, w) => s + (w.training_load || 0), 0);
  const sportsUsed = CAL_SPORT_ORDER.filter(k => realWorkouts.some(w => sportGroup(w.sport) === k));

  const summaryHtml = realWorkouts.length ? `
    <div class="cal-day-summary">
      <div class="cal-day-summary-time">${fmtH(totalMin)} h</div>
      <div class="cal-day-summary-meta">
        <span class="cal-day-summary-load">Load <b>${totalLoad > 0 ? fmtNum(totalLoad, 0) : "–"}</b></span>
        ${sportsUsed.map(k => `<span class="cal-summary-sport"><span class="dot" style="background:${CAL_SPORT_COLORS[k]}"></span>${k}</span>`).join("")}
      </div>
    </div>` : `<div class="cal-day-summary cal-day-summary-empty">Ruhetag — keine Einheiten erfasst.</div>`;

  const rowsHtml = dayWorkouts.map((w, i) => {
    const paceOrSpeed = w.pace_min_per_km ? w.pace_min_per_km + " /km"
      : w.pace_min_per_100m ? w.pace_min_per_100m + " /100m"
      : w.speed_kmh != null ? fmtNum(w.speed_kmh, 1) + " km/h" : "–";
    return `
    <div class="cal-day-item" data-idx="${i}">
      <button type="button" class="cal-day-item-head">
        <span class="sport-dot" style="background:${sportColor(w.sport)}"></span>
        <span class="cal-day-item-sport">${w.sport}</span>${rideEnvBadgeHtml(w)}
        <span class="cal-day-item-stat">${w.duration_min != null ? fmtNum(w.duration_min, 0) + " min" : "–"}</span>
        <span class="cal-day-item-stat">${w.distance_km != null ? fmtNum(w.distance_km, 2) + " km" : ""}</span>
        <span class="cal-day-item-stat">${w.avg_hr != null ? "Ø " + w.avg_hr + " bpm" : ""}</span>
        <span class="cal-day-item-stat">${paceOrSpeed}</span>
        <span class="cal-day-item-caret">›</span>
      </button>
      <div class="cal-day-item-body"></div>
    </div>`;
  }).join("");

  const dayPlanned = calPlannedOfDay(calFocusDay);
  const plannedHtml = dayPlanned.length ? `
    <div class="cal-day-planned">
      <h4>Geplant</h4>
      ${calWeatherHtml(calFocusDay, dayPlanned, "day")}
      <div class="cal-planned-list cal-planned-list-day">${dayPlanned.map(calPlannedChipHtml).join("")}</div>
    </div>` : "";

  el.innerHTML = `${summaryHtml}${plannedHtml}<div class="cal-day-list">${rowsHtml || "<p class='empty-note' style='padding:8px 0;'>Keine Trainings an diesem Tag.</p>"}</div>`;
  el.className = "cal-grid-day chart-enter";
  wireCalPlannedChips(el);

  el.querySelectorAll(".cal-day-item").forEach(item => {
    const w = dayWorkouts[Number(item.dataset.idx)];
    const head = item.querySelector(".cal-day-item-head");
    const bodyEl = item.querySelector(".cal-day-item-body");
    head.addEventListener("click", () => {
      const opening = !item.classList.contains("open");
      item.classList.toggle("open", opening);
      if (opening && !item.dataset.rendered) {
        bodyEl.innerHTML = buildWorkoutDetailHtml(w);
        renderWorkoutDetailCharts(w, bodyEl);
        const compareBtn = bodyEl.querySelector(".wd-compare-btn");
        if (compareBtn) compareBtn.addEventListener("click", () => { if (typeof openComparePicker === "function") openComparePicker(w); });
        item.dataset.rendered = "1";
      }
    });
  });
}

/* ======================================================================
   REKORDE — Bestleistungen je Sportart (angelehnt an TrainingsPeaks)
   ====================================================================== */
// Sucht in den (downgesampleten) Streckendaten das schnellste Zeitfenster für
// eine Zieldistanz (z.B. "schnellste 5 km"). Da die Aufzeichnung auf ca. 200
// Punkte je Einheit verdichtet ist, ist das eine Annäherung, keine exakte
// Sekunden-für-Sekunden-Auswertung wie bei TrainingsPeaks selbst - wird in der
// Anzeige entsprechend gekennzeichnet.
