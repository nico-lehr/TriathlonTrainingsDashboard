// Uebersicht-Tab: Kennzahlen-Kacheln, Wochenumfang, HF-Trend, Sportverteilung,
// Fitness & Form (PMC), Trainingsbelastungsverhaeltnis (ACWR), Trainingsbelastungsfokus,
// Pace-/Geschwindigkeitsentwicklung.

function renderMeta() {
  const dates = DATA.map(w => w._date).filter(Boolean).sort((a, b) => a - b);
  document.getElementById("meta-range").textContent = dates.length
    ? fmtDateFull(dates[0]) + " – " + fmtDateFull(dates[dates.length - 1])
    : "";
  document.getElementById("footer-note").textContent =
    "Erstellt aus " + RAW.count + " .fit-Dateien · zuletzt aktualisiert " +
    new Date(RAW.generated_at).toLocaleString("de-DE");
  document.getElementById("update-meta").textContent =
    "Stand: " + new Date(RAW.generated_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  renderGarminSyncStatus();
}

// Zeigt im Update-Menue, wann zuletzt mit Garmin synchronisiert wurde und was
// dabei herauskam. Wichtig, weil ein stillschweigend fehlgeschlagener Sync
// sonst unbemerkt bliebe und alte Daten aktuell wirken wuerden.
function renderGarminSyncStatus() {
  const el = document.getElementById("garmin-sync-status");
  if (!el) return;
  const sync = (typeof lastGarminSync === "function") ? lastGarminSync() : null;
  if (!sync || !sync.at) {
    // Noch nie synchronisiert: hier steht der haeufigste Stolperstein. Eine
    // Webseite kann nicht pruefen, ob macOS das URL-Schema kennt - passiert
    // beim Klick nichts oder meldet der Browser "Adresse ungueltig", fehlt
    // die einmalige Einrichtung. Der Hinweis steht deshalb von vornherein da,
    // statt den Nutzer erst in eine unverstaendliche Browser-Fehlermeldung
    // laufen zu lassen.
    el.innerHTML = "Noch nie synchronisiert<br><span class=\"sync-hint\">Passiert beim Klick nichts? Einmalig "
      + "<code>setup.command</code> starten &mdash; oder "
      + "<code>sync-garmin.command</code> direkt doppelklicken.</span>";
    el.className = "update-menu-sync";
    return;
  }
  const d = new Date(sync.at);
  const tageHer = Math.floor((Date.now() - d.getTime()) / 86400000);
  const a = sync.aktivitaeten;
  const bits = [d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })];
  if (a) {
    bits.push(a.neu ? `${a.neu} neu` : "keine neuen");
    if (a.fehler) bits.push(`${a.fehler} Fehler`);
  }
  el.textContent = "Garmin: " + bits.join(" · ");
  // Ab einer Woche ohne Sync sichtbar kennzeichnen - dann stimmt der
  // Datenstand vermutlich nicht mehr.
  el.className = "update-menu-sync" + ((tageHer >= 7 || (a && a.fehler)) ? " stale" : "");
}


function renderStats(data) {
  const totalMin = data.reduce((s, w) => s + (w.duration_min || 0), 0);
  const kmBy = sport => data.filter(w => w.sport === sport).reduce((s, w) => s + (w.distance_km || 0), 0);
  const tiles = [];

  // Trainingsstatus (wie Garmin Connect) - immer als allererste Kachel,
  // nutzt volle Historie (wie PMC/ACWR/VO2max), nicht den Zeitraum-Filter.
  const trainingStatus = computeTrainingStatus();
  tiles.push({
    label: "Trainingsstatus",
    target: 1,
    fmt: () => `${trainingStatus.icon} ${trainingStatus.label}`,
    sub: trainingStatus.desc,
    extraClass: ` training-tile-${trainingStatus.cls}`,
  });

  // Trainingsplan-Treue-Streak (js/analytics/streak.js) - nutzt wie VO2max
  // immer die volle Historie, nicht den Zeitraum-Filter oben, da er einen
  // fortlaufenden Zustand abbildet. Nur sichtbar, wenn Trainingstage im
  // Profil hinterlegt sind (sonst lässt sich "Ruhetag laut Plan" nicht von
  // "Trainingstag verpasst" unterscheiden, siehe streak.js).
  const streak = (typeof computeAdherenceStreak === "function") ? computeAdherenceStreak() : null;
  if (streak) {
    const subBits = [];
    if (streak.atRisk) subBits.push("heute noch offen — importiere dein Training, um ihn zu behalten");
    if (streak.frozenDays > 0) subBits.push(`${streak.frozenDays}× durch Erholungs-Check geschützt`);
    tiles.push({
      label: "Trainingsplan-Treue-Streak",
      target: streak.days,
      fmt: v => "🔥 " + Math.round(v) + (Math.round(v) === 1 ? " Tag" : " Tage"),
      sub: subBits.length ? subBits.join(" · ") : "eingehaltene Trainings- und Ruhetage in Folge",
      extraClass: streak.atRisk ? " at-risk" : "",
    });
  }

  // Rad wird als EINE Kachel dargestellt: Indoor und Outdoor werden immer
  // zusammengerechnet. Die Trennung existiert weiterhin, aber nur dort, wo sie
  // fachlich noetig ist - in den Vergleichsgruppen (sameComparisonGroup() in
  // js/data/workouts.js), damit simulierte Indoor-Kilometer nie gegen echte
  // Strassenwerte verglichen werden.
  const radList = data.filter(w => w.sport === "Rad");
  const radTileSub = radList.length + " Einheiten";

  tiles.push(
    { label: "Trainingseinheiten", target: data.length, fmt: v => fmtNum(v, 0), sub: "im gewählten Zeitraum" },
    { label: "Gesamtzeit", target: totalMin, fmt: v => fmtH(v) + " h", sub: fmtNum(totalMin, 0) + " Minuten" },
    { label: "Rad", target: kmBy("Rad"), fmt: v => fmtNum(v, 1) + " km", sub: radTileSub },
    { label: "Laufen", target: kmBy("Laufen"), fmt: v => fmtNum(v, 1) + " km", sub: data.filter(w => w.sport === "Laufen").length + " Einheiten" },
    { label: "Schwimmen", target: kmBy("Schwimmen"), fmt: v => fmtNum(v, 2) + " km", sub: data.filter(w => w.sport === "Schwimmen").length + " Einheiten" },
  );

  // VO2max nutzt immer die volle Historie (wie PMC/ACWR), nicht den oben
  // gewählten Zeitraum-Filter - es ist ein Fitness-Zustand, kein Zeitraum-Wert.
  // Laufen und Rad bewusst als zwei getrennte Kacheln (siehe performance.js) -
  // wie bei Garmin selbst keine gemeinsame Zahl.
  const vo2 = computeVo2MaxEstimate();
  tiles.push({
    label: "VO2max Laufen",
    target: vo2.laufen ? vo2.laufen.value : 0,
    fmt: v => vo2.laufen ? fmtNum(v, 1) + " ml/kg/min" : "–",
    sub: vo2.laufen ? (vo2.laufen.trendLabel || vo2.laufen.methodLabel) : "Noch keine Laufdaten oder Profil-Herzfrequenzen für eine Schätzung",
    title: vo2.laufen ? vo2.laufen.methodLabel : "",
  });
  tiles.push({
    label: "VO2max Rad",
    target: vo2.rad ? vo2.rad.value : 0,
    fmt: v => vo2.rad ? fmtNum(v, 1) + " ml/kg/min" : "–",
    sub: vo2.rad ? (vo2.rad.trendLabel || vo2.rad.methodLabel) : "Braucht Leistungsmesser-Daten & Körpergewicht im Profil",
    title: vo2.rad ? vo2.rad.methodLabel : "",
  });
  document.getElementById("stat-row").innerHTML = tiles.map((t, i) => `
    <div class="stat-tile${t.extraClass || ""}"${t.title ? ` title="${escapeHtml(t.title)}"` : ""}>
      <div class="label">${t.label}</div>
      <div class="value" id="stat-val-${i}">${t.fmt(0)}</div>
      <div class="sub">${t.sub}</div>
    </div>`).join("");
  tiles.forEach((t, i) => animateStatValue(document.getElementById(`stat-val-${i}`), t.target, t.fmt));
  initStatTileTilt();
}

// "Monatsvergleich"-Karte: aktueller Kalendermonat (bis heute) vs. derselbe
// Tage-Abschnitt des Vormonats - Berechnung in computeMonthComparison()
// (js/analytics/training-load.js). Reine Vergleichs-Kacheln, kein Chart.
function renderMonthComparison() {
  const host = document.getElementById("monthcompare-stats");
  if (!host) return;
  const cmp = computeMonthComparison();
  // In den ersten Tagen eines Monats ist die Basis (wenige Tage, oft noch
  // gar keine Einheit) zu klein fuer einen sinnvollen Prozentvergleich -
  // ein einzelnes Training mehr/weniger als im Vormonat ergibt dann
  // Ausreisser wie -99%. Bis Tag 4 zeigen wir deshalb nur die reinen
  // Zahlen ohne Prozent-Delta.
  const MIN_DAY_FOR_DELTA = 4;
  const showDelta = cmp.dayOfMonth >= MIN_DAY_FOR_DELTA;
  const pctDelta = (a, b) => {
    if (b > 0) return ((a - b) / b) * 100;
    return a > 0 ? 100 : 0;
  };
  const deltaHtml = (a, b) => {
    if (!showDelta || (a === 0 && b === 0)) return "";
    const d = pctDelta(a, b);
    const sign = d >= 0 ? "+" : "";
    const tone = d >= 0 ? "good" : "warn";
    return ` <small class="delta-${tone}">${sign}${fmtNum(d, 0)} % ggü. ${cmp.prevMonthLabel}</small>`;
  };
  const rows = [
    { l: `Umfang (bis Tag ${cmp.dayOfMonth})`, cur: fmtH(cmp.current.minutes) + " h", delta: deltaHtml(cmp.current.minutes, cmp.previous.minutes) },
    { l: "Einheiten", cur: cmp.current.count, delta: deltaHtml(cmp.current.count, cmp.previous.count) },
    { l: "Load", cur: fmtNum(cmp.current.load, 0), delta: deltaHtml(cmp.current.load, cmp.previous.load) },
  ];
  host.innerHTML = rows.map(r => `<div class="sub-tile"><div class="l">${r.l}</div><div class="v">${r.cur}${r.delta}</div></div>`).join("")
    + (!showDelta ? `<p class="onb-hint" style="flex-basis:100%;margin:2px 0 0;">Prozent-Vergleich erst ab Tag ${MIN_DAY_FOR_DELTA} des Monats (zu wenig Daten für einen sinnvollen Vergleich).</p>` : "");
}

// 3D-Tilt-Effekt für die Übersicht-Kacheln (wie auf der Landingpage): die
// Kachel neigt sich beim Hover leicht in Richtung der Maus. Wird nach jedem
// renderStats() neu gebunden, da #stat-row komplett neu gerendert wird.

function initStatTileTilt() {
  document.querySelectorAll("#stat-row .stat-tile").forEach(tile => {
    tile.addEventListener("mousemove", e => {
      const rect = tile.getBoundingClientRect();
      const cardX = e.clientX - rect.left - rect.width / 2;
      const cardY = e.clientY - rect.top - rect.height / 2;
      const rotateX = (cardY / rect.height) * -12;
      const rotateY = (cardX / rect.width) * 12;
      tile.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });
    tile.addEventListener("mouseleave", () => {
      tile.style.transform = "rotateX(0deg) rotateY(0deg)";
    });
  });
}


function renderWeekly(data) {
  const el = document.getElementById("chart-weekly");
  const legendEl = document.getElementById("legend-weekly");
  const order = ["Schwimmen", "Rad", "Laufen", "Sonstiges"];
  const colors = { Schwimmen: "var(--c-schwimmen)", Rad: "var(--c-rad)", Laufen: "var(--c-laufen)", Sonstiges: "var(--c-sonstiges)" };
  legendEl.innerHTML = order.map(k => `<span class="item"><span class="swatch" style="background:${colors[k]}"></span>${k}</span>`).join("");

  if (!data.length) { el.innerHTML = "<p class='empty-note'>Keine Daten im gewählten Zeitraum.</p>"; return; }

  const W = 560, H = 240, padL = 34, padR = 8, padT = 10, padB = 28;
  const weeks = new Map();
  data.forEach(w => {
    if (!w._date) return;
    const ws = weekStart(w._date).getTime();
    if (!weeks.has(ws)) weeks.set(ws, { Schwimmen: 0, Rad: 0, Laufen: 0, Sonstiges: 0 });
    weeks.get(ws)[sportGroup(w.sport)] += (w.duration_min || 0) / 60;
  });
  const weekKeys = [...weeks.keys()].sort((a, b) => a - b);
  const maxTotal = niceMax(Math.max(1, ...weekKeys.map(k => order.reduce((s, o) => s + weeks.get(k)[o], 0))));
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const bw = Math.min(48, innerW / weekKeys.length * 0.55);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });
  [0, 0.5, 1].forEach(f => {
    const y = padT + innerH - f * innerH;
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: f === 0 ? "baseline" : "grid-line" }));
    const lbl = svgEl("text", { x: padL - 8, y: y + 4, class: "axis-label", "text-anchor": "end" });
    lbl.textContent = fmtNum(maxTotal * f, 0) + "h";
    svg.appendChild(lbl);
  });

  weekKeys.forEach((k, i) => {
    const x = padL + (i + 0.5) * (innerW / weekKeys.length) - bw / 2;
    let yCursor = padT + innerH;
    const wk = weeks.get(k);
    order.forEach(sport => {
      const v = wk[sport];
      if (v <= 0) return;
      const h = (v / maxTotal) * innerH;
      const y = yCursor - h;
      const rect = svgEl("rect", { x, y, width: bw, height: Math.max(0, h - 2), rx: 4, ry: 4, fill: colors[sport], class: "chart-bar bar-grow-y", style: `animation-delay:${Math.min(i, 24) * 12}ms` });
      rect.addEventListener("mousemove", e => showTip(e, `<b>${sport}</b><br>${fmtNum(v, 1)} h · Woche ${new Date(k).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`, el));
      rect.addEventListener("mouseleave", hideTip);
      svg.appendChild(rect);
      yCursor -= h;
    });
    const lbl = svgEl("text", { x: x + bw / 2, y: H - 8, class: "axis-label", "text-anchor": "middle" });
    lbl.textContent = fmtDate(new Date(k));
    svg.appendChild(lbl);
  });

  el.innerHTML = ""; el.appendChild(svg);
}


function renderHR(data) {
  const el = document.getElementById("chart-hr");
  const legendEl = document.getElementById("legend-hr");
  legendEl.innerHTML = `<span class="item"><span class="swatch line" style="background:var(--c-hr-avg)"></span>Ø HF</span>
    <span class="item"><span class="swatch line" style="background:var(--c-hr-max)"></span>Max HF</span>`;

  const pts = data.filter(w => w._date && w.avg_hr).sort((a, b) => a._date - b._date);
  if (!pts.length) { el.innerHTML = "<p class='empty-note'>Keine HF-Daten im gewählten Zeitraum.</p>"; return; }

  const W = 560, H = 240, padL = 30, padR = 10, padT = 14, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const allHr = pts.flatMap(p => [p.avg_hr, p.max_hr]).filter(Boolean);
  const minHr = Math.floor(Math.min(...allHr, 60) / 10) * 10 - 10;
  const maxHr = Math.ceil(Math.max(...allHr, 100) / 10) * 10 + 5;

  const x = i => padL + (pts.length <= 1 ? innerW / 2 : i / (pts.length - 1) * innerW);
  const y = v => padT + innerH - (v - minHr) / (maxHr - minHr) * innerH;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });
  [minHr, (minHr + maxHr) / 2, maxHr].forEach(v => {
    const yy = y(v);
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: yy, y2: yy, class: "grid-line" }));
    const lbl = svgEl("text", { x: padL - 8, y: yy + 4, class: "axis-label", "text-anchor": "end" });
    lbl.textContent = Math.round(v);
    svg.appendChild(lbl);
  });

  function line(key, color) {
    let d = "";
    pts.forEach((p, i) => { d += (i === 0 ? "M" : "L") + x(i) + " " + y(p[key]) + " "; });
    const path = svgEl("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", class: "chart-line", style: "--sw:2" });
    svg.appendChild(path);
    animateDraw(path, 800);
    return path;
  }
  const maxPath = line("max_hr", "var(--c-hr-max)");
  const avgPath = line("avg_hr", "var(--c-hr-avg)");
  const hrPaths = [maxPath, avgPath];
  const pathByKey = { max_hr: maxPath, avg_hr: avgPath };

  pts.forEach((p, i) => {
    [["avg_hr", "var(--c-hr-avg)"], ["max_hr", "var(--c-hr-max)"]].forEach(([key, color]) => {
      const dot = svgEl("circle", { cx: x(i), cy: y(p[key]), r: 4, fill: color, stroke: "var(--surface-1)", "stroke-width": 2 });
      dot.addEventListener("mousemove", e => { showTip(e, `<b>${p.sport}</b> · ${fmtDate(p._date)}<br>Ø ${p.avg_hr} bpm · Max ${p.max_hr} bpm`, el); highlightChartLine(pathByKey[key], hrPaths); });
      dot.addEventListener("mouseleave", () => { hideTip(); clearChartLineHighlight(hrPaths); });
      svg.appendChild(dot);
    });
  });

  const step = Math.max(1, Math.ceil(pts.length / 6));
  pts.forEach((p, i) => {
    if (i % step !== 0 && i !== pts.length - 1) return;
    const lbl = svgEl("text", { x: x(i), y: H - 8, class: "axis-label", "text-anchor": "middle" });
    lbl.textContent = fmtDate(p._date);
    svg.appendChild(lbl);
  });

  el.innerHTML = ""; el.appendChild(svg);
}


function renderDonut(data) {
  const el = document.getElementById("chart-donut");
  const order = ["Schwimmen", "Rad", "Laufen", "Sonstiges"];
  const colors = { Schwimmen: "var(--c-schwimmen)", Rad: "var(--c-rad)", Laufen: "var(--c-laufen)", Sonstiges: "var(--c-sonstiges)" };
  const totals = {}; order.forEach(k => totals[k] = 0);
  data.forEach(w => { totals[sportGroup(w.sport)] += (w.duration_min || 0); });
  const grandTotal = order.reduce((s, k) => s + totals[k], 0);

  if (!grandTotal) { el.innerHTML = "<p class='empty-note'>Keine Daten im gewählten Zeitraum.</p>"; return; }

  const W = 560, H = 240;
  const cx = 120, cy = H / 2, r = 78, rInner = 50;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });

  let angle = -Math.PI / 2;
  order.forEach(k => {
    const frac = totals[k] / grandTotal;
    if (frac <= 0) return;
    const a0 = angle, a1 = angle + frac * 2 * Math.PI;
    angle = a1;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const gap = 0.012;
    const ga0 = a0 + gap, ga1 = a1 - gap;
    const p = (a, rr) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    const [x0, y0] = p(ga0, r), [x1, y1] = p(ga1, r);
    const [xi1, yi1] = p(ga1, rInner), [xi0, yi0] = p(ga0, rInner);
    const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${rInner} ${rInner} 0 ${large} 0 ${xi0} ${yi0} Z`;
    const path = svgEl("path", { d, fill: colors[k], class: "donut-arc", style: `transform-origin:${cx}px ${cy}px; animation-delay:${order.indexOf(k) * 70}ms` });
    path.addEventListener("mousemove", e => showTip(e, `<b>${k}</b><br>${fmtH(totals[k])} h (${Math.round(frac * 100)}%)`, el));
    path.addEventListener("mouseleave", hideTip);
    svg.appendChild(path);
  });

  const centerLbl1 = svgEl("text", { x: cx, y: cy - 3, "text-anchor": "middle", "font-size": "18", "font-weight": "650", fill: "var(--text-primary)" });
  centerLbl1.textContent = fmtH(grandTotal) + " h";
  const centerLbl2 = svgEl("text", { x: cx, y: cy + 15, "text-anchor": "middle", "font-size": "11", fill: "var(--text-muted)" });
  centerLbl2.textContent = "gesamt";
  svg.appendChild(centerLbl1); svg.appendChild(centerLbl2);

  let ly = cy - (order.filter(k => totals[k] > 0).length - 1) * 13;
  order.forEach(k => {
    if (totals[k] <= 0) return;
    const sw = svgEl("rect", { x: 250, y: ly - 9, width: 9, height: 9, rx: 2, fill: colors[k] });
    const lbl = svgEl("text", { x: 266, y: ly, "font-size": "12.5", fill: "var(--text-secondary)" });
    lbl.textContent = `${k} — ${fmtH(totals[k])} h (${Math.round(totals[k] / grandTotal * 100)}%)`;
    svg.appendChild(sw); svg.appendChild(lbl);
    ly += 24;
  });

  el.innerHTML = ""; el.appendChild(svg);
}

/* Fitness & Form: CTL/ATL/TSB werden immer aus der VOLLEN Historie (DATA)
   berechnet, nicht aus dem gefilterten Zeitraum - sonst würde ein Wechsel
   auf "7 Tage" die 42-Tage-Fitness verfälschen. */
// Tägliche Load-Summe + CTL/ATL/TSB (EWMA 42/7 Tage) aus der VOLLEN Historie -
// gemeinsame Grundlage für den PMC-Chart und den ACWR-Gauge, damit beide immer
// exakt dieselben Fitness-/Ermüdungswerte zeigen.

function renderPMC() {
  const el = document.getElementById("chart-pmc");
  const legendEl = document.getElementById("legend-pmc");
  legendEl.innerHTML = `
    <span class="item"><span class="swatch" style="background:var(--c-load)"></span>Load / Tag</span>
    <span class="item"><span class="swatch line" style="background:var(--c-ctl)"></span>CTL (Fitness)</span>
    <span class="item"><span class="swatch line" style="background:var(--c-atl)"></span>ATL (Ermüdung)</span>
    <span class="item"><span class="swatch line" style="background:var(--text-primary)"></span>TSB (Form)</span>`;

  const dayMs = 86400000;
  const series = computeLoadSeries();
  if (!series) {
    el.innerHTML = "<p class='empty-note'>Keine Load-Daten vorhanden.</p>";
    document.getElementById("pmc-substats").innerHTML = "";
    document.getElementById("load-status-badge").innerHTML = "";
    return;
  }

  const W = 1120, H = 260, padL = 36, padR = 36, padT = 14, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxCtlAtl = niceMax(Math.max(1, ...series.map(s => Math.max(s.ctl, s.atl))));
  const maxLoad = niceMax(Math.max(1, ...series.map(s => s.load)));

  const x = i => padL + (series.length <= 1 ? innerW / 2 : i / (series.length - 1) * innerW);
  const yLoad = v => padT + innerH - (v / maxLoad) * innerH * 0.55;
  const yFit = v => padT + innerH - (v / maxCtlAtl) * innerH;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });
  [0, 0.5, 1].forEach(f => {
    const yy = padT + innerH - f * innerH;
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: yy, y2: yy, class: f === 0 ? "baseline" : "grid-line" }));
    const lbl = svgEl("text", { x: padL - 8, y: yy + 4, class: "axis-label", "text-anchor": "end" });
    lbl.textContent = fmtNum(maxCtlAtl * f, 0);
    svg.appendChild(lbl);
  });

  const bw = Math.max(2, innerW / series.length * 0.6);
  series.forEach((s, i) => {
    if (s.load <= 0) return;
    const yTop = yLoad(s.load);
    const rect = svgEl("rect", { x: x(i) - bw / 2, y: yTop, width: bw, height: Math.max(0, (padT + innerH) - yTop), rx: 2, ry: 2, fill: "var(--c-load)", opacity: "0.6", class: "chart-bar bar-grow-y" });
    rect.addEventListener("mousemove", e => showTip(e, `<b>${new Date(s.day * dayMs).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}</b><br>Load ${fmtNum(s.load, 0)}`, el));
    rect.addEventListener("mouseleave", hideTip);
    svg.appendChild(rect);
  });

  function line(key, color, width = 2) {
    let d = "";
    series.forEach((s, i) => { d += (i === 0 ? "M" : "L") + x(i) + " " + yFit(s[key]) + " "; });
    const path = svgEl("path", { d, fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round", class: "chart-line", style: `--sw:${width}` });
    svg.appendChild(path);
    animateDraw(path, 900);
    return path;
  }
  const atlPath = line("atl", "var(--c-atl)");
  const ctlPath = line("ctl", "var(--c-ctl)", 2.5);

  const maxTsbAbs = Math.max(10, ...series.map(s => Math.abs(s.tsb)));
  const yTsb = v => padT + innerH * 0.28 - (v / maxTsbAbs) * (innerH * 0.22);
  let tsbPath = "";
  series.forEach((s, i) => { tsbPath += (i === 0 ? "M" : "L") + x(i) + " " + yTsb(s.tsb) + " "; });
  const tsbPathEl = svgEl("path", { d: tsbPath, fill: "none", stroke: "var(--text-primary)", "stroke-width": 1.5, "stroke-dasharray": "3 3", opacity: "0.7", class: "chart-line", style: "--sw:1.5" });
  svg.appendChild(tsbPathEl);
  const pmcLines = [ctlPath, atlPath, tsbPathEl];

  series.forEach((s, i) => {
    if (i % Math.max(1, Math.ceil(series.length / 40)) !== 0 && i !== series.length - 1) return;
    const dot = svgEl("circle", { cx: x(i), cy: yFit(s.ctl), r: 9, fill: "transparent" });
    dot.addEventListener("mousemove", e => {
      showTip(e, `<b>${new Date(s.day * dayMs).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}</b><br>CTL ${fmtNum(s.ctl, 1)} · ATL ${fmtNum(s.atl, 1)}<br>TSB ${s.tsb >= 0 ? "+" : ""}${fmtNum(s.tsb, 1)}`, el);
      pmcLines.forEach(p => p.classList.add("chart-line-active"));
    });
    dot.addEventListener("mouseleave", () => { hideTip(); pmcLines.forEach(p => p.classList.remove("chart-line-active")); });
    svg.appendChild(dot);
  });

  const step = Math.max(1, Math.ceil(series.length / 8));
  series.forEach((s, i) => {
    if (i % step !== 0 && i !== series.length - 1) return;
    const lbl = svgEl("text", { x: x(i), y: H - 8, class: "axis-label", "text-anchor": "middle" });
    lbl.textContent = new Date(s.day * dayMs).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    svg.appendChild(lbl);
  });

  el.innerHTML = ""; el.appendChild(svg);

  const last = series[series.length - 1];
  const tsbStatus = tsbStatusLabel(last.tsb) || { cls: "ok", text: "frisch / gut erholt" };
  const dotColorByCls = { ok: "var(--c-good)", watch: "var(--c-warn)", risk: "var(--c-crit)" };
  document.getElementById("load-status-badge").innerHTML = `<span class="load-status ${tsbStatus.cls}"><span class="dot" style="background:${dotColorByCls[tsbStatus.cls]}"></span>${tsbStatus.text}</span>`;

  // Dieselbe Monotonie-Berechnung wie im eigenen "Trainingsmonotonie"-Chart
  // (computeMonotonyStrainSeries in training-load.js) - hier nur der jeweils
  // aktuellste Wert für die Kennzahlen-Kachel.
  const monotonySeries = computeMonotonyStrainSeries();
  const monotony = monotonySeries && monotonySeries.length ? monotonySeries[monotonySeries.length - 1].monotony : null;

  document.getElementById("pmc-substats").innerHTML = `
    <div class="sub-tile"><div class="l">CTL — Fitness (aktuell)</div><div class="v">${fmtNum(last.ctl, 1)}</div></div>
    <div class="sub-tile"><div class="l">ATL — Ermüdung (aktuell)</div><div class="v">${fmtNum(last.atl, 1)}</div></div>
    <div class="sub-tile"><div class="l">TSB — Form (aktuell)</div><div class="v">${last.tsb >= 0 ? "+" : ""}${fmtNum(last.tsb, 1)}</div></div>
    <div class="sub-tile"><div class="l">Monotonie (7 Tage)</div><div class="v">${monotony != null ? fmtNum(monotony, 2) : "–"}${monotony != null ? ` <small>${monotony >= 2 ? "erhöht" : "ok"}</small>` : ""}</div></div>`;
}


function renderHRZones(data) {
  const el = document.getElementById("chart-hrzones");
  const pts = data.filter(w => w.avg_hr && w.duration_min);
  if (!pts.length) { el.innerHTML = "<p class='empty-note'>Keine HF-Daten im gewählten Zeitraum.</p>"; return; }

  const allAvg = pts.map(p => p.avg_hr);
  const lo = Math.min(...allAvg), hi = Math.max(...allAvg);
  const span = Math.max(1, hi - lo);
  const zoneNames = ["Z1 Locker", "Z2 Grundlage", "Z3 Mittel", "Z4 Schwelle", "Z5 Hart"];
  const zoneColors = ["var(--c-z1)", "var(--c-z2)", "var(--c-z3)", "var(--c-z4)", "var(--c-z5)"];
  const zoneMin = [() => -Infinity, () => lo + span * 0.2, () => lo + span * 0.4, () => lo + span * 0.6, () => lo + span * 0.8];
  const totals = [0, 0, 0, 0, 0];
  pts.forEach(p => {
    let zi = 0;
    for (let i = 4; i >= 0; i--) { if (p.avg_hr >= zoneMin[i]()) { zi = i; break; } }
    totals[zi] += p.duration_min;
  });
  const grand = totals.reduce((a, b) => a + b, 0) || 1;

  const W = 560, H = 240, padL = 10, padR = 10, padT = 10;
  const barH = 30, gap = 14;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });
  const innerW = W - padL - padR;
  zoneNames.forEach((name, i) => {
    const y = padT + i * (barH + gap);
    const frac = totals[i] / grand;
    const w = Math.max(2, frac * innerW);
    svg.appendChild(svgEl("rect", { x: padL, y, width: innerW, height: barH, rx: 8, fill: "var(--page)" }));
    const rect = svgEl("rect", { x: padL, y, width: w, height: barH, rx: 8, fill: zoneColors[i], class: "chart-bar bar-grow-x", style: `animation-delay:${i * 45}ms` });
    rect.addEventListener("mousemove", e => showTip(e, `<b>${name}</b><br>${fmtH(totals[i])} h (${Math.round(frac * 100)}%)`, el));
    rect.addEventListener("mouseleave", hideTip);
    svg.appendChild(rect);
    if (w > 90) {
      const lbl = svgEl("text", { x: padL + 10, y: y + barH / 2 + 4, "font-size": "12", fill: "#fff", "font-weight": "600" });
      lbl.textContent = `${name} · ${Math.round(frac * 100)}%`;
      svg.appendChild(lbl);
    } else {
      const outLbl = svgEl("text", { x: padL + w + 8, y: y + barH / 2 + 4, "font-size": "12", fill: "var(--text-secondary)" });
      outLbl.textContent = `${name} · ${Math.round(frac * 100)}%`;
      svg.appendChild(outLbl);
    }
  });
  el.innerHTML = ""; el.appendChild(svg);
}

/* Trainingsbelastungsverhältnis (Acute:Chronic Workload Ratio, ACWR) - das
   Verhältnis der akuten (7-Tage-Ø = ATL) zur chronischen (42-Tage-Ø = CTL)
   Belastung. Nach Gabbett (2016, "training-injury prevention paradox") gilt
   ein Bereich von ~0,8-1,3 als "Sweet Spot": genug Reiz, aber die Belastung
   wächst nicht schneller, als der Körper sich anpassen kann. Deutlich höhere
   Werte gelten als Frühwarnsignal für ein erhöhtes Verletzungs-/
   Übertrainingsrisiko. Nutzt immer die volle Historie (wie die PMC), damit
   CTL/ATL stabil bleiben. */

function renderACWR() {
  const el = document.getElementById("chart-acwr");
  const series = computeLoadSeries();
  if (!series) { el.innerHTML = "<p class='empty-note'>Keine Load-Daten vorhanden.</p>"; return; }

  const last = series[series.length - 1];
  // Bei sehr niedrigem CTL (frühe Trainingsphase) ist das Verhältnis kaum
  // aussagekräftig (kleine Nenner -> große Ausschläge) - dann lieber "-" zeigen.
  const acwr = last.ctl > 0.5 ? last.atl / last.ctl : null;

  const W = 320, H = 205, cx = 160, cy = 172, r = 122, sw = 24, vMax = 2.0;
  const bands = [
    { from: 0,   to: 0.8, color: "var(--c-z1)",   label: "Aufbau",  range: "< 0,8" },
    { from: 0.8, to: 1.3, color: "var(--c-good)", label: "optimaler Bereich", range: "0,8–1,3" },
    { from: 1.3, to: 1.5, color: "var(--c-warn)", label: "erhöhtes Risiko",   range: "1,3–1,5" },
    { from: 1.5, to: vMax, color: "var(--c-crit)", label: "hohes Verletzungsrisiko", range: "> 1,5" },
  ];
  const angleFor = v => 180 - (Math.min(v, vMax) / vMax) * 180; // 180°=links(0) .. 0°=rechts(vMax)
  const polar = (deg, rr) => [cx + rr * Math.cos(deg * Math.PI / 180), cy - rr * Math.sin(deg * Math.PI / 180)];

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });
  bands.forEach(b => {
    const a0 = angleFor(b.from), a1 = angleFor(b.to);
    const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r);
    const d = `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
    const path = svgEl("path", { d, fill: "none", stroke: b.color, "stroke-width": sw, "stroke-linecap": "butt", class: "gauge-band" });
    path.addEventListener("mousemove", e => showTip(e, `<b>${b.label}</b><br>ACWR ${b.range}`, el));
    path.addEventListener("mouseleave", hideTip);
    svg.appendChild(path);
  });

  // Zone (für Nadel-/Zahlenfarbe) vorab bestimmen - dieselben Bänder wie oben.
  const zone = acwr == null ? null : bands.find(b => acwr < b.to) || bands[bands.length - 1];
  const zoneColor = zone ? zone.color : "var(--text-primary)";

  // Nadel: als senkrechte Linie nach oben gezeichnet und per CSS-Rotation auf
  // den Zielwinkel gedreht - so lässt sie sich sauber "einschwingen" animieren.
  // Farbe passend zur aktuellen Kategorie, statt immer neutral.
  const needleLen = r - sw / 2 - 14;
  const needle = svgEl("line", { x1: cx, y1: cy, x2: cx, y2: cy - needleLen, stroke: zoneColor, "stroke-width": 3, "stroke-linecap": "round" });
  svg.appendChild(needle);
  svg.appendChild(svgEl("circle", { cx, cy, r: 6, fill: zoneColor }));
  const targetRot = acwr != null ? (Math.min(acwr, vMax) / vMax) * 180 - 90 : 0;
  needle.style.transformOrigin = `${cx}px ${cy}px`;
  needle.style.transform = "rotate(-90deg)";
  requestAnimationFrame(() => {
    needle.style.transition = "transform 0.9s cubic-bezier(.34,1.56,.64,1)";
    needle.style.transform = `rotate(${targetRot}deg)`;
  });

  const bigText = svgEl("text", { x: cx, y: cy - 34, "text-anchor": "middle", "font-size": "26", "font-weight": "680", fill: zoneColor });
  bigText.textContent = acwr != null ? fmtNum(acwr, 2) : "–";
  svg.appendChild(bigText);
  const subText = svgEl("text", { x: cx, y: cy - 15, "text-anchor": "middle", "font-size": "11.5", fill: "var(--text-secondary)" });
  subText.textContent = zone ? zone.label : "noch nicht genug Daten";
  svg.appendChild(subText);
  ["0", "1,0", "2,0"].forEach((lbl, i) => {
    const v = i * 1.0;
    const [tx, ty] = polar(angleFor(v), r + 16);
    const t = svgEl("text", { x: tx, y: ty + 4, "text-anchor": "middle", class: "axis-label" });
    t.textContent = lbl;
    svg.appendChild(t);
  });

  el.innerHTML = ""; el.appendChild(svg);
  const legendEl = document.createElement("div");
  legendEl.className = "gauge-legend";
  legendEl.innerHTML = bands.map(b => `<span class="item"><span class="swatch" style="background:${b.color}"></span>${b.label} (${b.range})</span>`).join("");
  el.appendChild(legendEl);
  const foot = document.createElement("p");
  foot.className = "gauge-foot";
  foot.textContent = "ACWR = 7-Tage-Belastung (ATL) ÷ 42-Tage-Belastung (CTL). Werte über 1,5 gelten in der Sportwissenschaft (Gabbett 2016) als erhöhtes Verletzungsrisiko.";
  el.appendChild(foot);
}

/* Trainingsbelastungsfokus: Zeitanteil je Intensitätszone, gruppiert nach dem
   polarisierten Trainingsmodell (Seiler) in niedrig-aerob / hoch-aerob /
   anaerob. Nutzt dieselbe relative HF-Bandbreite wie der Herzfrequenz-Zonen-
   Chart (Z1+Z2 / Z3+Z4 / Z5), damit beide Charts konsistent bleiben - hier
   aber zu 3 Trainingsbereichen zusammengefasst und mit dem in der
   Ausdauerwissenschaft gängigen ~80/10/10-Richtwert verglichen. */

function renderTrainingFocus(data) {
  const el = document.getElementById("chart-focus");
  const pts = data.filter(w => w.avg_hr && w.duration_min);
  if (!pts.length) { el.innerHTML = "<p class='empty-note'>Keine HF-Daten im gewählten Zeitraum.</p>"; return; }

  const allAvg = pts.map(p => p.avg_hr);
  const lo = Math.min(...allAvg), hi = Math.max(...allAvg);
  const span = Math.max(1, hi - lo);
  const b2 = lo + span * 0.4, b4 = lo + span * 0.8; // Grenzen Z2/Z3 und Z4/Z5

  const zones = [
    { name: "Niedrig-aerob", sub: "lockere Grundlage · Z1–Z2", color: "var(--c-good)", target: 80 },
    { name: "Hoch-aerob", sub: "Schwelle / Tempo · Z3–Z4", color: "var(--c-warn)", target: 10 },
    { name: "Anaerob", sub: "hart / intensiv · Z5", color: "var(--c-crit)", target: 10 },
  ];
  const totals = [0, 0, 0];
  pts.forEach(p => {
    const zi = p.avg_hr < b2 ? 0 : p.avg_hr < b4 ? 1 : 2;
    totals[zi] += p.duration_min;
  });
  const grand = totals.reduce((a, b) => a + b, 0) || 1;

  const W = 560, H = 200, padL = 10, padR = 10, padT = 6;
  const barH = 34, gap = 22;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });
  const innerW = W - padL - padR;
  zones.forEach((zone, i) => {
    const y = padT + i * (barH + gap);
    const frac = totals[i] / grand;
    const w = Math.max(2, frac * innerW);
    svg.appendChild(svgEl("rect", { x: padL, y, width: innerW, height: barH, rx: 8, fill: "var(--page)" }));
    const rect = svgEl("rect", { x: padL, y, width: w, height: barH, rx: 8, fill: zone.color, class: "chart-bar bar-grow-x", style: `animation-delay:${i * 60}ms` });
    rect.addEventListener("mousemove", e => showTip(e, `<b>${zone.name}</b><br>${fmtH(totals[i])} h (${Math.round(frac * 100)}%) · Ziel ~${zone.target}%`, el));
    rect.addEventListener("mouseleave", hideTip);
    svg.appendChild(rect);
    // Ziel-Marke (Seiler ~80/10/10) zum Vergleich - als Karet über der Leiste
    // (immer auf dem hellen Hintergrund, also immer sichtbar) plus dünner
    // Strich, dessen Farbe sich danach richtet, ob er über der gefüllten
    // Leiste oder über der leeren Spur liegt.
    const tickX = padL + (zone.target / 100) * innerW;
    const overFill = tickX < padL + w;
    const tick = svgEl("line", { x1: tickX, x2: tickX, y1: y, y2: y + barH, stroke: overFill ? "#fff" : "var(--text-primary)", "stroke-width": 1.5, "stroke-dasharray": "3 3", opacity: overFill ? "0.7" : "0.4" });
    tick.addEventListener("mousemove", e => showTip(e, `Ziel (Seiler-Modell): ~${zone.target}%`, el));
    tick.addEventListener("mouseleave", hideTip);
    svg.appendChild(tick);
    const caret = svgEl("path", { d: `M ${tickX - 4} ${y - 8} L ${tickX + 4} ${y - 8} L ${tickX} ${y - 2} Z`, fill: "var(--text-secondary)" });
    caret.addEventListener("mousemove", e => showTip(e, `Ziel (Seiler-Modell): ~${zone.target}%`, el));
    caret.addEventListener("mouseleave", hideTip);
    svg.appendChild(caret);
    const lblColor = w > 130 ? "#fff" : "var(--text-secondary)";
    const lblX = w > 130 ? padL + 10 : padL + w + 8;
    const lbl = svgEl("text", { x: lblX, y: y + barH / 2 - 3, "font-size": "12.5", "font-weight": "620", fill: lblColor });
    lbl.textContent = `${zone.name} · ${Math.round(frac * 100)}%`;
    svg.appendChild(lbl);
    const sub = svgEl("text", { x: lblX, y: y + barH / 2 + 12, "font-size": "10.5", fill: w > 130 ? "rgba(255,255,255,0.85)" : "var(--text-muted)" });
    sub.textContent = zone.sub;
    svg.appendChild(sub);
  });
  el.innerHTML = ""; el.appendChild(svg);
  renderFocusInsight();
}

// KI-Einordnung Ist-Belastung (letzte 7 Tage) vs. Soll-Hochrechnung (naechste
// 7 Tage aus dem KI-Trainingsplan) unter dem Trainingsbelastungsfokus-Chart -
// gleiches Muster (Button + Ergebnis/Fehler/Lade-Zustand) wie
// buildPlanEditLessonsHtml (training-plan.js), aber global statt pro Einheit
// (siehe focusInsight, js/ai/ollama.js).
function buildFocusInsightHtml() {
  const btnLabel = focusInsight.loading ? "Analysiere …" : (focusInsight.text ? "Neu einordnen" : "KI-Einordnung abrufen");
  return `
    <div class="onb-field pe-lessons" id="focus-insight-block">
      <label>KI-Einordnung <span class="wd-analysis-hint">Ist vs. geplante Soll-Belastung, mit KI-Prognose aus dem Trainingsplan</span></label>
      <div class="goal-actions">
        <button type="button" class="chip" id="focus-insight-btn" ${focusInsight.loading ? "disabled" : ""}>${btnLabel}</button>
        ${focusInsight.at ? `<span class="goal-rec-date">Stand: ${fmtDateFull(new Date(focusInsight.at))}</span>` : ""}
      </div>
      ${focusInsight.error ? `<p class="goal-error">${escapeHtml(focusInsight.error)}</p>` : ""}
      ${focusInsight.text ? `<div class="goal-recommendation">${formatRecommendation(focusInsight.text)}</div>` : ""}
    </div>`;
}

function renderFocusInsight() {
  const card = document.querySelector('.card[data-card-id="focus"]');
  if (!card) return;
  let host = document.getElementById("focus-insight-block");
  if (host) {
    host.outerHTML = buildFocusInsightHtml();
  } else {
    card.insertAdjacentHTML("beforeend", buildFocusInsightHtml());
  }
  const btn = document.getElementById("focus-insight-btn");
  if (btn) btn.addEventListener("click", () => generateFocusInsight());
}

/* Herzfrequenzverteilung nach Aktivität: ein "Ridgeline"-Chart (eine Zeile
   pro Sportart, Kurven leicht überlappend, wie in Garmin Connect) -
   Berechnung in js/analytics/hr-distribution.js (computeHrDistribution).
   Nutzt den gewählten Zeitraum/Filter wie die anderen HF-Charts. */
function renderHrDistribution(data) {
  const el = document.getElementById("chart-hrdist");
  const dist = computeHrDistribution(data);
  if (!dist) { el.innerHTML = "<p class='empty-note'>Noch nicht genug Puls-Streckendaten im gewählten Zeitraum (mind. 20 Messpunkte je Sportart nötig).</p>"; return; }

  const { minHr, maxHr, binCount, rows, zoneBounds } = dist;
  const rowStep = 58, peakH = rowStep * 1.55;
  const W = 1120, padL = 96, padR = 20, padT = 26, padB = 30;
  const innerW = W - padL - padR;
  const H = padT + rows.length * rowStep + padB + (peakH - rowStep);
  const baselineY = i => padT + (peakH - rowStep) + (i + 1) * rowStep;
  const x = i => padL + (binCount <= 1 ? innerW / 2 : i / (binCount - 1) * innerW);
  const span = maxHr - minHr;
  const xForHr = hr => padL + ((hr - minHr) / span) * innerW;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });

  // Ein gemeinsamer, bpm-basierter Farbverlauf (blau -> grün -> gelb -> rot)
  // für alle Zeilen - dieselbe Position auf der x-Achse hat also überall
  // dieselbe Farbe, unabhängig von der Sportart (wie im Garmin-Original).
  const defs = svgEl("defs", {});
  const grad = svgEl("linearGradient", { id: "hrdist-gradient", gradientUnits: "userSpaceOnUse", x1: padL, x2: W - padR, y1: 0, y2: 0 });
  const zoneColors = ["var(--c-z1)", "var(--c-z2)", "var(--c-z3)", "var(--c-z4)", "var(--c-z5)"];
  zoneColors.forEach((c, i) => {
    grad.appendChild(svgEl("stop", { offset: `${(i / 5) * 100}%`, "stop-color": c }));
  });
  grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": zoneColors[zoneColors.length - 1] }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  // Zonen-Trennlinien + Z1-Z5-Beschriftung oben, Grenzwerte (bpm) unten.
  zoneBounds.forEach((b, i) => {
    if (i > 0 && i < zoneBounds.length - 1) {
      svg.appendChild(svgEl("line", { x1: xForHr(b), x2: xForHr(b), y1: padT - 14, y2: H - padB, class: "grid-line" }));
      const numLbl = svgEl("text", { x: xForHr(b), y: H - padB + 16, class: "axis-label", "text-anchor": "middle", "font-weight": "650" });
      numLbl.textContent = Math.round(b);
      svg.appendChild(numLbl);
    }
  });
  zoneColors.forEach((c, i) => {
    const midHr = (zoneBounds[i] + zoneBounds[i + 1]) / 2;
    const lbl = svgEl("text", { x: xForHr(midHr), y: padT - 18, "text-anchor": "middle", "font-size": "11", "font-weight": "700", fill: c });
    lbl.textContent = `Z${i + 1}`;
    svg.appendChild(lbl);
  });

  rows.forEach((row, ri) => {
    const base = baselineY(ri);
    let d = `M ${x(0)} ${base} `;
    row.density.forEach((v, i) => { d += `L ${x(i)} ${base - v * peakH} `; });
    d += `L ${x(binCount - 1)} ${base} Z`;
    const area = svgEl("path", { d, fill: "url(#hrdist-gradient)", opacity: "0.82", stroke: "var(--text-primary)", "stroke-width": "1.1", "stroke-opacity": "0.35", "stroke-linejoin": "round", class: "chart-enter chart-area", style: `animation-delay:${ri * 70}ms` });
    area.addEventListener("mousemove", e => showTip(e, `<b>${row.sport}</b><br>${row.workouts} Einheiten · ${row.samples.toLocaleString("de-DE")} Messpunkte`, el));
    area.addEventListener("mouseleave", hideTip);
    svg.appendChild(area);

    const label = svgEl("text", { x: padL - 12, y: base - 6, "text-anchor": "end", "font-size": "13", "font-weight": "640", fill: sportColor(row.sport) });
    label.textContent = row.sport;
    svg.appendChild(label);
    const sub = svgEl("text", { x: padL - 12, y: base + 12, "text-anchor": "end", class: "axis-label" });
    sub.textContent = `${row.workouts} Einheiten`;
    svg.appendChild(sub);
  });

  el.innerHTML = ""; el.appendChild(svg);
}

/* Trainingsmonotonie nach Foster (1998) - Berechnung in
   js/analytics/training-load.js (computeMonotonyStrainSeries). Nutzt wie
   PMC/ACWR immer die volle Historie, damit der Zeitraum-Filter die Werte
   nicht verfälscht (ein rollierendes 7-Tage-Fenster braucht Kontext davor). */
function renderMonotony() {
  const el = document.getElementById("chart-monotony");
  const series = computeMonotonyStrainSeries();
  if (!series || !series.length) {
    el.innerHTML = "<p class='empty-note'>Noch nicht genug Historie (mind. 7 Tage mit Load-Daten nötig).</p>";
    document.getElementById("monotony-status-badge").innerHTML = "";
    return;
  }

  const dayMs = 86400000;
  const W = 1120, H = 220, padL = 36, padR = 36, padT = 14, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const RISK_THRESHOLD = 2.0;
  const maxV = niceMax(Math.max(RISK_THRESHOLD * 1.15, ...series.map(s => s.monotony)));

  const x = i => padL + (series.length <= 1 ? innerW / 2 : i / (series.length - 1) * innerW);
  const y = v => padT + innerH - (Math.min(v, maxV) / maxV) * innerH;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });

  const riskY = y(RISK_THRESHOLD);
  if (RISK_THRESHOLD < maxV) {
    svg.appendChild(svgEl("rect", { x: padL, y: padT, width: innerW, height: Math.max(0, riskY - padT), fill: "var(--c-crit)", opacity: "0.07" }));
  }

  [0, 0.5, 1].forEach(f => {
    const yy = padT + innerH - f * innerH;
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: yy, y2: yy, class: f === 0 ? "baseline" : "grid-line" }));
    const lbl = svgEl("text", { x: padL - 8, y: yy + 4, class: "axis-label", "text-anchor": "end" });
    lbl.textContent = fmtNum(maxV * f, 1);
    svg.appendChild(lbl);
  });

  const thresholdLine = svgEl("line", { x1: padL, x2: W - padR, y1: riskY, y2: riskY, stroke: "var(--c-crit)", "stroke-width": 1.5, "stroke-dasharray": "4 4", opacity: "0.55" });
  svg.appendChild(thresholdLine);
  const thresholdLbl = svgEl("text", { x: W - padR, y: riskY - 6, class: "axis-label", "text-anchor": "end" });
  thresholdLbl.textContent = "Risikoschwelle 2,0 (Foster 1998)";
  svg.appendChild(thresholdLbl);

  let d = "";
  series.forEach((s, i) => { d += (i === 0 ? "M" : "L") + x(i) + " " + y(s.monotony) + " "; });
  const path = svgEl("path", { d, fill: "none", stroke: "var(--c-load)", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round", class: "chart-line", style: "--sw:2.2" });
  svg.appendChild(path);
  animateDraw(path, 800);

  series.forEach((s, i) => {
    if (i % Math.max(1, Math.ceil(series.length / 40)) !== 0 && i !== series.length - 1) return;
    const dot = svgEl("circle", { cx: x(i), cy: y(s.monotony), r: 9, fill: "transparent" });
    dot.addEventListener("mousemove", e => {
      showTip(e, `<b>${new Date(s.day * dayMs).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}</b><br>Monotonie ${fmtNum(s.monotony, 2)}<br>Strain ${fmtNum(s.strain, 0)} · Wochenlast ${fmtNum(s.weekLoad, 0)}`, el);
      path.classList.add("chart-line-active");
    });
    dot.addEventListener("mouseleave", () => { hideTip(); path.classList.remove("chart-line-active"); });
    svg.appendChild(dot);
  });

  const step = Math.max(1, Math.ceil(series.length / 8));
  series.forEach((s, i) => {
    if (i % step !== 0 && i !== series.length - 1) return;
    const lbl = svgEl("text", { x: x(i), y: H - 8, class: "axis-label", "text-anchor": "middle" });
    lbl.textContent = new Date(s.day * dayMs).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    svg.appendChild(lbl);
  });

  el.innerHTML = ""; el.appendChild(svg);

  const last = series[series.length - 1];
  const monoStatus = monotonyStatusLabel(last.monotony) || { cls: "ok", text: "unauffällig" };
  const dotColorByCls = { ok: "var(--c-good)", watch: "var(--c-warn)", risk: "var(--c-crit)" };
  document.getElementById("monotony-status-badge").innerHTML = `<span class="load-status ${monoStatus.cls}"><span class="dot" style="background:${dotColorByCls[monoStatus.cls]}"></span>${monoStatus.text}</span>`;
}

/** Generische kleine Linien-Chart-Komponente (Pace-Kacheln + Detail-Modal) */

function renderPace(data) {
  const container = document.getElementById("chart-pace");
  // filter/valueOf sind optional: das Rad-Chart muss Indoor-Einheiten
  // ausschließen, weil die simulierte Plattform-Geschwindigkeit die
  // Geschwindigkeitsentwicklung sonst verrauscht (ein leichter virtueller Kurs
  // sieht wie ein Formsprung aus). Indoor bekommt stattdessen ein eigenes
  // Watt-Chart - dort ist die Entwicklung tatsächlich aussagekräftig.
  const configs = [
    { sport: "Laufen", title: "Laufen", unit: "min/km", key: "pace_min_per_km", invert: true, color: "var(--c-laufen)" },
    { sport: "Rad", title: "Rad", unit: "km/h", key: "speed_kmh", invert: false, color: "var(--c-rad)" },
    { sport: "Schwimmen", title: "Schwimmen", unit: "min/100m", key: "pace_min_per_100m", invert: true, color: "var(--c-schwimmen)" },
  ];
  container.innerHTML = "";
  configs.forEach(cfg => {
    const getValue = cfg.getValue || (w => w[cfg.key]);
    const pts = data.filter(w => w.sport === cfg.sport && w._date && getValue(w) != null && (!cfg.filter || cfg.filter(w)))
      .map(w => { const raw = getValue(w); return { date: w._date, raw: cfg.invert ? raw : fmtNum(raw, cfg.unit === "W" ? 0 : 1), val: cfg.invert ? paceToSeconds(raw) : raw, distance: cfg.unit === "W" ? null : w.distance_km }; })
      .sort((a, b) => a.date - b.date);

    // Kacheln, die ohne passende Daten gar nicht erscheinen sollen (Indoor-Watt),
    // vor dem Anlegen des Containers abbrechen - sonst bliebe eine leere stehen.
    if (!pts.length && cfg.hideWhenEmpty) return;

    const wrap = document.createElement("div");
    wrap.className = "mini";
    const sub = pts.length ? `${pts.length} Einheiten` : "keine Daten im gewählten Zeitraum";
    wrap.innerHTML = `<h3>${cfg.title}</h3><p class="mini-sub">${cfg.unit} · ${sub}</p>`;
    const chartHost = document.createElement("div");
    chartHost.className = "chart-wrap";
    wrap.appendChild(chartHost);
    container.appendChild(wrap);
    if (!pts.length) return;

    drawMiniLine(chartHost, pts.map(p => ({
      y: p.val, raw: p.raw, xLabel: fmtDate(p.date),
      tooltip: `<b>${fmtDate(p.date)}</b><br>${p.raw} ${cfg.unit}${p.distance ? ` · ${fmtNum(p.distance, 2)} km` : ""}`
    })), { color: cfg.color, unit: cfg.unit, invert: cfg.invert, fmtAxis: v => cfg.invert ? secondsToPace(v) : fmtNum(v, 1) });
  });
}

/* ======================================================================
   KALENDER — jede Spalte eine Woche, mit Wochen-Zusammenfassung am Ende
   ====================================================================== */
