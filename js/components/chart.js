// Wiederverwendbare SVG-Chart-Bausteine: Tooltip, SVG-Helper, Mini-Liniencharts,
// Zeichen-/Wert-Animationen.

const tooltipEl = document.getElementById("tooltip");

function showTip(evt, html, wrapEl) {
  const rect = wrapEl.getBoundingClientRect();
  tooltipEl.innerHTML = html;
  tooltipEl.style.opacity = "1";
  tooltipEl.style.left = (evt.clientX - rect.left) + "px";
  tooltipEl.style.top = (evt.clientY - rect.top - 12) + "px";
  wrapEl.appendChild(tooltipEl);
}

function hideTip() { tooltipEl.style.opacity = "0"; }


const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

/* ---------- Hover-Hervorhebung für Linien-Charts ----------
   Gemeinsam genutzt von drawMiniLine() und den mehrlinigen Charts in
   dashboard.js (HF-Trend, Fitness & Form): macht die Linie unter der Maus
   dicker (per CSS-Variable --sw, siehe .chart-line-active in components.css)
   und dimmt die übrigen Linien im selben Chart leicht ab. */
function highlightChartLine(activePath, allPaths) {
  allPaths.forEach(p => {
    if (!p) return;
    p.classList.toggle("chart-line-active", p === activePath);
    p.classList.toggle("chart-line-dim", allPaths.length > 1 && p !== activePath);
  });
}

function clearChartLineHighlight(allPaths) {
  allPaths.forEach(p => { if (p) p.classList.remove("chart-line-active", "chart-line-dim"); });
}

function animateDraw(pathEl, duration = 750) {
  try {
    const len = pathEl.getTotalLength();
    if (!len) return;
    pathEl.style.strokeDasharray = String(len);
    pathEl.style.strokeDashoffset = String(len);
    pathEl.getBoundingClientRect(); // Reflow erzwingen, damit die Transition greift
    pathEl.style.transition = `stroke-dashoffset ${duration}ms cubic-bezier(.16,1,.3,1)`;
    requestAnimationFrame(() => { pathEl.style.strokeDashoffset = "0"; });
  } catch (e) { /* getTotalLength kann bei leeren/unsichtbaren Pfaden fehlschlagen - dann einfach ohne Animation zeigen */ }
}
// Zählt eine Kachel-Zahl von 0 auf den Zielwert hoch (kleiner "Premium"-Effekt für Kennzahlen).

function animateStatValue(el, target, formatFn, duration = 650) {
  if (!el) return;
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatFn(target * eased);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = formatFn(target);
  }
  requestAnimationFrame(frame);
}

/* ---------- Menüleiste (Übersicht / Kalender / Rekorde) ---------- */

function drawMiniLine(hostEl, points, opts) {
  // points: [{x:Date|num, y:num, raw, label}], opts:{color, unit, invert, xIsDate}
  hostEl.innerHTML = "";
  if (!points.length) { hostEl.innerHTML = "<p class='empty-note' style='padding:12px 0;'>Keine Daten</p>"; return; }
  const W = opts.width || 340, H = opts.height || 170, padL = 34, padR = 10, padT = 10, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  let vals = points.map(p => p.y);
  let minV = Math.min(...vals), maxV = Math.max(...vals);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const pad = (maxV - minV) * 0.15;
  minV -= pad; maxV += pad;

  const x = i => padL + (points.length <= 1 ? innerW / 2 : i / (points.length - 1) * innerW);
  const y = v => opts.invert ? padT + (v - minV) / (maxV - minV) * innerH : padT + innerH - (v - minV) / (maxV - minV) * innerH;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });
  [minV, maxV].forEach(v => {
    const yy = y(v);
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: yy, y2: yy, class: "grid-line" }));
    const lbl = svgEl("text", { x: padL - 6, y: yy + 4, class: "axis-label", "text-anchor": "end" });
    lbl.textContent = opts.fmtAxis ? opts.fmtAxis(v) : fmtNum(v, 1);
    svg.appendChild(lbl);
  });

  let d = "";
  points.forEach((p, i) => { d += (i === 0 ? "M" : "L") + x(i) + " " + y(p.y) + " "; });
  const linePath = svgEl("path", { d, fill: "none", stroke: opts.color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", class: "chart-line", style: "--sw:2" });
  svg.appendChild(linePath);
  animateDraw(linePath, 700);

  const dense = points.length > 30;
  if (!dense) {
    // Wenige Punkte (z.B. Trainings-Kacheln): jeder Punkt bekommt einen sichtbaren Marker.
    points.forEach((p, i) => {
      const dot = svgEl("circle", { cx: x(i), cy: y(p.y), r: opts.dotR || 4, fill: opts.color, stroke: "var(--surface-1)", "stroke-width": 2 });
      dot.addEventListener("mousemove", e => { showTip(e, p.tooltip || `${p.raw ?? fmtNum(p.y)} ${opts.unit || ""}`, hostEl); highlightChartLine(linePath, [linePath]); });
      dot.addEventListener("mouseleave", () => { hideTip(); clearChartLineHighlight([linePath]); });
      svg.appendChild(dot);
    });
  } else {
    // Viele Punkte (Sekundendaten): keine Punktwolke, sondern ein Fadenkreuz,
    // das dem nächsten Punkt unter dem Mauszeiger folgt.
    const crosshair = svgEl("circle", { r: 5, fill: opts.color, stroke: "var(--surface-1)", "stroke-width": 2, opacity: "0" });
    svg.appendChild(crosshair);
    const hitRect = svgEl("rect", { x: padL, y: padT, width: innerW, height: innerH, fill: "transparent" });
    hitRect.addEventListener("mousemove", e => {
      const rect = hostEl.getBoundingClientRect();
      const scaleX = W / rect.width;
      const mx = (e.clientX - rect.left) * scaleX;
      const idx = Math.round(((mx - padL) / innerW) * (points.length - 1));
      const i = Math.max(0, Math.min(points.length - 1, idx));
      const p = points[i];
      crosshair.setAttribute("cx", x(i));
      crosshair.setAttribute("cy", y(p.y));
      crosshair.setAttribute("opacity", "1");
      showTip(e, p.tooltip || `${p.raw ?? fmtNum(p.y)} ${opts.unit || ""}`, hostEl);
      highlightChartLine(linePath, [linePath]);
    });
    hitRect.addEventListener("mouseleave", () => { crosshair.setAttribute("opacity", "0"); hideTip(); clearChartLineHighlight([linePath]); });
    svg.appendChild(hitRect);
  }

  const step = Math.max(1, Math.ceil(points.length / (opts.maxLabels || 4)));
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    const lbl = svgEl("text", { x: x(i), y: H - 6, class: "axis-label", "text-anchor": "middle" });
    lbl.textContent = p.xLabel || "";
    svg.appendChild(lbl);
  });

  hostEl.appendChild(svg);
}

// Mehrlinien-Chart für den Workout-Vergleich (js/components/compare.js) -
// zeichnet mehrere Serien (z.B. HF mehrerer Einheiten) in EIN gemeinsames
// Diagramm. Die x-Achse ist bewusst der ANTEIL der jeweiligen Trainingsdauer
// (0-100%), nicht die absolute Zeit - so lassen sich unterschiedlich lange
// Einheiten trotzdem an derselben relativen Stelle vergleichen ("bei 50% der
// Einheit"). series: [{label, color, points:[{xPct:0..1, y, tooltip}]}].
function drawMultiLine(hostEl, series, opts = {}) {
  hostEl.innerHTML = "";
  const activeSeries = series.filter(s => s && s.points && s.points.length);
  if (!activeSeries.length) { hostEl.innerHTML = "<p class='empty-note' style='padding:12px 0;'>Keine vergleichbaren Daten vorhanden.</p>"; return; }

  const W = opts.width || 600, H = opts.height || 170, padL = 34, padR = 10, padT = 10, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const allY = activeSeries.flatMap(s => s.points.map(p => p.y));
  let minV = Math.min(...allY), maxV = Math.max(...allY);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const pad = (maxV - minV) * 0.15;
  minV -= pad; maxV += pad;

  const x = xf => padL + xf * innerW;
  const y = v => opts.invert ? padT + (v - minV) / (maxV - minV) * innerH : padT + innerH - (v - minV) / (maxV - minV) * innerH;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });
  [minV, maxV].forEach(v => {
    const yy = y(v);
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: yy, y2: yy, class: "grid-line" }));
    const lbl = svgEl("text", { x: padL - 6, y: yy + 4, class: "axis-label", "text-anchor": "end" });
    lbl.textContent = opts.fmtAxis ? opts.fmtAxis(v) : fmtNum(v, 1);
    svg.appendChild(lbl);
  });
  [0, 0.25, 0.5, 0.75, 1].forEach(xf => {
    const lbl = svgEl("text", { x: x(xf), y: H - 6, class: "axis-label", "text-anchor": "middle" });
    lbl.textContent = Math.round(xf * 100) + "%";
    svg.appendChild(lbl);
  });

  const paths = activeSeries.map(s => {
    let d = "";
    s.points.forEach((p, i) => { d += (i === 0 ? "M" : "L") + x(p.xPct) + " " + y(p.y) + " "; });
    const path = svgEl("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", class: "chart-line", style: "--sw:2" });
    svg.appendChild(path);
    animateDraw(path, 700);
    return path;
  });

  // Gemeinsames Fadenkreuz je Serie: folgt dem jeweils nächstgelegenen Punkt
  // an der relativen x-Position der Maus und zeigt einen kombinierten
  // Tooltip mit dem Wert JEDER Serie an dieser Stelle.
  const crosshairs = activeSeries.map(s => svgEl("circle", { r: 4.5, fill: s.color, stroke: "var(--surface-1)", "stroke-width": 2, opacity: "0" }));
  crosshairs.forEach(c => svg.appendChild(c));
  const hitRect = svgEl("rect", { x: padL, y: padT, width: innerW, height: innerH, fill: "transparent" });
  hitRect.addEventListener("mousemove", e => {
    const rect = hostEl.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;
    const xf = Math.max(0, Math.min(1, (mx - padL) / innerW));
    const lines = [];
    activeSeries.forEach((s, si) => {
      let nearest = s.points[0], best = Infinity;
      s.points.forEach(p => { const d = Math.abs(p.xPct - xf); if (d < best) { best = d; nearest = p; } });
      crosshairs[si].setAttribute("cx", x(nearest.xPct));
      crosshairs[si].setAttribute("cy", y(nearest.y));
      crosshairs[si].setAttribute("opacity", "1");
      lines.push(`<span style="color:${s.color}">●</span> ${s.label}: ${nearest.tooltip}`);
    });
    showTip(e, lines.join("<br>"), hostEl);
  });
  hitRect.addEventListener("mouseleave", () => { crosshairs.forEach(c => c.setAttribute("opacity", "0")); hideTip(); });
  svg.appendChild(hitRect);

  hostEl.appendChild(svg);
  return paths;
}

// Einheitliches (i)-Info-Symbol an Karten-Überschriften: klappt bei Klick
// einen kleinen Popover mit dem Erklärtext auf (Markup dazu: ein
// ".info-wrap" mit einem ".info-btn" und einem ".info-popover" als
// Geschwister-Element, siehe index.html). Ein Klick woanders oder Escape
// schließt wieder.
//
// Per Event-Delegation auf document (nicht auf die einzelnen .info-wrap-
// Elemente) implementiert, damit auch Info-Buttons funktionieren, die ERST
// NACH diesem init-Aufruf ins DOM kommen - z.B. durch renderGoals()/
// renderTrainingPlanCard(), die ihre Kachel per innerHTML komplett neu
// aufbauen, oder Inhalte hinter dem Onboarding-Gate. Eine einmalige
// querySelectorAll()-Bindung beim App-Start (wie zuvor) würde solche später
// hinzugekommenen Buttons nie verkabeln - genau das war der ursprüngliche
// "i-Button geht teilweise nicht"-Bug. Trotzdem weiterhin einmalig beim
// App-Start aufgerufen (js/app.js), aber jetzt reicht das für die gesamte
// App-Laufzeit.
function initInfoPopovers() {
  function closeAll(except) {
    document.querySelectorAll(".info-wrap .info-btn.open, .info-wrap .info-popover.open").forEach(el => {
      if (except && except.contains(el)) return;
      el.classList.remove("open");
    });
  }
  document.addEventListener("click", e => {
    const btn = e.target.closest(".info-btn");
    if (btn) {
      const wrap = btn.closest(".info-wrap");
      const popover = wrap && wrap.querySelector(".info-popover");
      if (!popover) return;
      e.stopPropagation();
      const opening = !popover.classList.contains("open");
      closeAll(wrap);
      btn.classList.toggle("open", opening);
      popover.classList.toggle("open", opening);
      return;
    }
    // Klick INNERHALB eines offenen Popovers nicht schließen - manche
    // Popover haben interaktive Inhalte (z.B. die Spalten-Checkboxen der
    // Workouts-Tabelle, siehe workout-card.js), nicht nur Lesetext.
    if (e.target.closest(".info-popover.open")) return;
    closeAll(null);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeAll(null); });
}

