// Rekorde-Tab: persoenliche Bestleistungen je Sportart.

function renderRecords() {
  const el = document.getElementById("records-grid");
  if (!DATA.length) { el.innerHTML = "<p class='empty-note'>Keine Daten vorhanden.</p>"; return; }

  const rows = []; // gesammelte {label, value, date, workout}-Zeilen je Karte, gerendert am Ende

  function row(label, w, valueText, dateOverride) {
    if (!w) return `<div class="record-empty">${label}: noch keine Daten</div>`;
    const d = dateOverride || (w._date ? fmtDateFull(w._date) : "");
    return `<div class="record-row" data-file="${encodeURIComponent(w.file)}">
      <span class="record-label">${label}</span>
      <span class="record-value-wrap"><div class="record-value">${valueText}</div><div class="record-date">${d}</div></span>
    </div>`;
  }

  let cardIndex = 0; // für gestaffelte Eintritts-Animation (animation-delay je Karte, siehe .record-card in components.css)
  function cardDelayStyle() { return ` style="animation-delay:${(cardIndex++) * 70}ms"`; }

  function sportCard(sportName, color, extraRowsFn) {
    const list = DATA.filter(w => w.sport === sportName);
    if (!list.length) return "";
    let html = `<div class="record-card"${cardDelayStyle()}><h3><span class="dot" style="background:${color}"></span>${sportName}</h3>`;
    html += extraRowsFn(list);
    html += row("Längste Distanz", bestBy(list, w => w.distance_km), (() => { const w = bestBy(list, w => w.distance_km); return w ? fmtNum(w.distance_km, 2) + " km" : ""; })());
    html += row("Längste Dauer", bestBy(list, w => w.duration_min), (() => { const w = bestBy(list, w => w.duration_min); return w ? fmtH(w.duration_min) + " h" : ""; })());
    html += row("Größter Höhengewinn", bestBy(list, w => w.elevation_gain_m), (() => { const w = bestBy(list, w => w.elevation_gain_m); return w ? Math.round(w.elevation_gain_m) + " m" : ""; })());
    html += row("Höchste Ø-Herzfrequenz", bestBy(list, w => w.avg_hr), (() => { const w = bestBy(list, w => w.avg_hr); return w ? w.avg_hr + " bpm" : ""; })());
    html += row("Höchste Max-Herzfrequenz", bestBy(list, w => w.max_hr), (() => { const w = bestBy(list, w => w.max_hr); return w ? w.max_hr + " bpm" : ""; })());
    html += "</div>";
    return html;
  }

  let html = "";

  // Laufen: schnellste 1/5/10 km (aus Streckendaten geschätzt) + klassische Bestwerte
  html += sportCard("Laufen", "var(--c-laufen)", list => {
    let h = "";
    [[1000, "Schnellste 1 km"], [5000, "Schnellste 5 km"], [10000, "Schnellste 10 km"]].forEach(([m, label]) => {
      const best = bestEffortForDistance(list, m);
      h += row(label + " *", best?.workout, best ? fmtDurationClock(best.seconds) : "", best ? fmtDateFull(best.workout._date) : "");
    });
    const bestPace = bestBy(list, w => w.pace_min_per_km ? -paceToSeconds(w.pace_min_per_km) : null);
    h += row("Schnellste Ø-Pace (Einheit)", bestPace, bestPace ? bestPace.pace_min_per_km + " /km" : "");
    return h;
  });

  // Rad: schnellste 10/20/40 km (geschätzt) + klassische Bestwerte
  html += sportCard("Rad", "var(--c-rad)", list => {
    let h = "";
    [[10000, "Schnellste 10 km"], [20000, "Schnellste 20 km"], [40000, "Schnellste 40 km"]].forEach(([m, label]) => {
      const best = bestEffortForDistance(list, m);
      h += row(label + " *", best?.workout, best ? fmtDurationClock(best.seconds) : "", best ? fmtDateFull(best.workout._date) : "");
    });
    const bestSpeed = bestBy(list, w => w.speed_kmh);
    h += row("Höchste Ø-Geschwindigkeit", bestSpeed, bestSpeed ? fmtNum(bestSpeed.speed_kmh, 1) + " km/h" : "");
    const bestMaxSpeed = bestBy(list, w => w.max_speed_kmh);
    h += row("Höchste Max-Geschwindigkeit", bestMaxSpeed, bestMaxSpeed ? fmtNum(bestMaxSpeed.max_speed_kmh, 1) + " km/h" : "");
    return h;
  });

  // Schwimmen: schnellste Ø-Pace/100m + klassische Bestwerte
  html += sportCard("Schwimmen", "var(--c-schwimmen)", list => {
    const bestPace = bestBy(list, w => w.pace_min_per_100m ? -paceToSeconds(w.pace_min_per_100m) : null);
    return row("Schnellste Ø-Pace (Einheit)", bestPace, bestPace ? bestPace.pace_min_per_100m + " /100m" : "");
  });

  // Allgemein: sportartübergreifende Bestwerte
  const realAll = DATA.filter(w => !w.is_summary);
  const bestLoad = bestBy(realAll, w => w.training_load);
  const bestCal = bestBy(realAll, w => w.calories);
  const series = computeLoadSeries();
  const bestCtl = series ? series.reduce((m, s) => Math.max(m, s.ctl), 0) : null;
  html += `<div class="record-card"${cardDelayStyle()}><h3><span class="dot" style="background:var(--text-primary)"></span>Allgemein</h3>`;
  html += row("Höchste Trainingsbelastung (Einheit)", bestLoad, bestLoad ? fmtNum(bestLoad.training_load, 0) : "");
  html += row("Meiste Kalorien (Einheit)", bestCal, bestCal ? Math.round(bestCal.calories) + " kcal" : "");
  html += bestCtl != null
    ? `<div class="record-row" style="cursor:default"><span class="record-label">Höchste je erreichte Fitness (CTL)</span><span class="record-value-wrap"><div class="record-value">${fmtNum(bestCtl, 1)}</div></span></div>`
    : "";
  html += "</div>";

  html += `<p class="card-sub" style="grid-column:1/-1; margin-top:-6px;">* Geschätzt aus der aufgezeichneten Streckendaten (auf ca. 200 Punkte je Einheit verdichtet) — nicht so präzise wie eine sekundengenaue Auswertung, aber ein guter Anhaltspunkt.</p>`;

  el.className = "records-grid";
  el.innerHTML = html;
  el.querySelectorAll(".record-row[data-file]").forEach(rowEl => {
    rowEl.addEventListener("click", () => {
      const w = ALL.find(x => x.file === decodeURIComponent(rowEl.dataset.file));
      if (w) openDetail(w);
    });
  });
}

// Dieselben Bestwerte wie im Rekorde-Tab, aber als kompaktes Objekt statt
// HTML - Grundlage für den Coach-Kontext (siehe buildCompactContext unten).
// Sportarten/Werte ohne Daten werden weggelassen, damit der Prompt kurz bleibt.
