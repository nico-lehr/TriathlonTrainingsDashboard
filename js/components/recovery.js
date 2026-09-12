// Erholungs-Karte in der Übersicht: gemessene Werte aus Garmin Connect
// (Schlaf, HRV, Ruhepuls, Body Battery) als Kacheln + Verläufe.
//
// Daten kommen aus js/data/garmin-wellness.js. Die ganze Karte bleibt
// ausgeblendet, solange nichts synchronisiert wurde - so verändert sich für
// jemanden ohne Garmin-Sync nichts am Dashboard.
//
// Gezeichnet wird mit drawMiniLine() aus js/components/chart.js und dem
// Kachel-Muster aus renderPace()/renderStats() - bewusst kein eigener
// Chart-Baukasten.

// invert: true = kleinerer Wert ist besser (Ruhepuls). Wird an drawMiniLine
// durchgereicht, das dieselbe Konvention schon für Pace nutzt.
const RECOVERY_METRICS = [
  { field: "hrv_ms", label: "HRV", unit: "ms", digits: 0, invert: false, color: "var(--c-schwimmen)",
    hint: "Herzfrequenzvariabilität über Nacht" },
  { field: "resting_hr", label: "Ruhepuls", unit: "bpm", digits: 0, invert: true, color: "var(--c-laufen)",
    hint: "Ruheherzfrequenz" },
  { field: "sleep_min", label: "Schlaf", unit: "h", digits: 1, invert: false, color: "var(--c-rad)",
    hint: "Schlafdauer", transform: v => v / 60 },
  { field: "body_battery_high", label: "Body Battery", unit: "", digits: 0, invert: false, color: "var(--c-sonstiges)",
    hint: "Tageshöchstwert der Energiereserve" },
];

function renderRecovery() {
  const card = document.getElementById("recovery-card");
  if (!card) return;
  if (typeof hasWellnessData !== "function" || !hasWellnessData()) { card.hidden = true; return; }

  const tiles = document.getElementById("recovery-tiles");
  const charts = document.getElementById("recovery-charts");
  const sub = document.getElementById("recovery-sub");
  if (!tiles || !charts) return;

  // Zeitraum aus der Filterleiste übernehmen, damit die Karte demselben
  // Zeitraum folgt wie der Rest der Übersicht. "Alle" (rangeDays = null)
  // wird auf 365 Tage begrenzt - ein Verlauf über Jahre wäre im Miniatur-
  // Chart nicht mehr lesbar.
  const days = filterState.rangeDays || 365;

  let anyValue = false;
  tiles.innerHTML = "";
  charts.innerHTML = "";

  RECOVERY_METRICS.forEach(m => {
    const latest = latestWellness(m.field);
    const baseline = wellnessBaseline(m.field, 30);
    const tf = m.transform || (v => v);

    // --- Kachel ---
    const tile = document.createElement("div");
    tile.className = "stat-tile";
    if (latest) {
      anyValue = true;
      const val = tf(latest.value);
      let subText = m.hint;
      if (baseline != null) {
        const base = tf(baseline);
        const delta = val - base;
        const baseTxt = `Ø ${fmtNum(base, m.digits)}${m.unit ? " " + m.unit : ""}`;
        // Rundet die Abweichung in der angezeigten Genauigkeit auf 0, waere
        // "+0"/"-0" eine Scheingenauigkeit - dann lieber im Klartext sagen,
        // dass der Wert dem eigenen Mittel entspricht.
        const step = Math.pow(10, -m.digits);
        if (Math.abs(delta) < step / 2) {
          subText = `${baseTxt} · entspricht dem 30-Tage-Mittel`;
        } else {
          // Bei Ruhepuls ist "weniger" besser - die Wertung dreht sich, nicht die Zahl.
          const better = m.invert ? delta < 0 : delta > 0;
          const sign = delta > 0 ? "+" : "−";
          // Klassen delta-good/delta-warn sind die im Projekt bereits genutzte
          // Konvention (siehe Monatsvergleich in dashboard.js). Abweichungen
          // unter 2% bleiben ungefaerbt - das ist Rauschen, keine Aussage.
          const cls = Math.abs(delta) < (base * 0.02) ? "" : (better ? "delta-good" : "delta-warn");
          subText = `${baseTxt} · <small class="${cls}">${sign}${fmtNum(Math.abs(delta), m.digits)}</small> ggü. 30-Tage-Mittel`;
        }
      }
      const ageDays = Math.round((Date.now() - new Date(latest.date).getTime()) / 86400000);
      // Aelteren Wert mit Datum kennzeichnen, damit ein zwei Wochen alter
      // Messwert nicht wie der von heute Nacht aussieht.
      const stale = ageDays >= 2 ? ` <small>(${fmtDate(new Date(latest.date))})</small>` : "";
      tile.innerHTML = `<div class="label">${m.label}${stale}</div>`
        + `<div class="value">${fmtNum(val, m.digits)}${m.unit ? " " + m.unit : ""}</div>`
        + `<div class="sub">${subText}</div>`;
    } else {
      tile.innerHTML = `<div class="label">${m.label}</div><div class="value">–</div>`
        + `<div class="sub">keine Messwerte</div>`;
    }
    tiles.appendChild(tile);

    // --- Verlauf ---
    const series = wellnessSeries(m.field, days);
    const wrap = document.createElement("div");
    wrap.className = "mini";
    const unitTxt = m.unit ? m.unit + " · " : "";
    wrap.innerHTML = `<h3>${m.label}</h3><p class="mini-sub">${unitTxt}${series.length ? series.length + " Tage mit Messwert" : "keine Daten im gewählten Zeitraum"}</p>`;
    const host = document.createElement("div");
    host.className = "chart-wrap";
    wrap.appendChild(host);
    charts.appendChild(wrap);
    if (!series.length) return;

    drawMiniLine(host, series.map(p => ({
      y: tf(p.value),
      raw: fmtNum(tf(p.value), m.digits),
      xLabel: fmtDate(p.date),
      tooltip: `<b>${fmtDate(p.date)}</b><br>${fmtNum(tf(p.value), m.digits)} ${m.unit}`,
    })), { color: m.color, unit: m.unit, invert: false, fmtAxis: v => fmtNum(v, m.digits) });
  });

  card.hidden = !anyValue;

  const sync = (typeof lastGarminSync === "function") ? lastGarminSync() : null;
  if (sub && sync && sync.at) {
    const d = new Date(sync.at);
    sub.textContent = `Zuletzt gemessene Werte im Vergleich zum eigenen Mittel · synchronisiert ${fmtDateFull(d)}`;
  }
}
