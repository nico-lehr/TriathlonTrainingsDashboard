// Ernährung → "Energie & Bedarf": Kalorienverbrauch heute, Ø-Bedarf,
// Verlauf, Energiebilanz aus dem Gewichtsverlauf und Kennzahlen.
// Alle Rechnungen stehen in js/analytics/energy.js - hier nur Darstellung.

const ENERGY_COLORS = { bmr: "var(--en-bmr)", alltag: "var(--en-alltag)", training: "var(--en-train)" };
const ENERGY_PARTS = [["bmr", "Grundumsatz"], ["alltag", "Alltag"], ["training", "Training"]];
let energyRange = "30"; // Verlauf: "30" | "90" | "12m"

const enKcal = v => (v == null ? "–" : fmtNum(Math.round(v), 0));
const enSigned = (v, dec = 0) => (v > 0 ? "+" : v < 0 ? "−" : "±") + fmtNum(Math.abs(v), dec);
const enDate = ds => new Date(ds + "T12:00:00").toLocaleDateString("de-DE", { day: "numeric", month: "short" });
const enInfo = text => `<span class="info-wrap"><button type="button" class="info-btn" aria-label="Erklärung anzeigen">i</button><div class="info-popover">${text}</div></span>`;

// Alle Eingaben einmal einsammeln und durchrechnen.
function energyModel() {
  const today = todayStr();
  const weightKg = getLatestWeightKg();
  const ctx = {
    today, age: getAthleteAge(), profile: athleteProfile, weights: weightLog,
    wellness: wellnessDaily(), byDay: energyWorkoutsByDay(ALL, weightKg),
  };
  const series = energySeries(ctx, energyAddDays(today, -400), today);
  const stats = energyStats(series, today);
  const balance = energyBalance(series, weightLog, today, 28) || energyBalance(series, weightLog, today, 56);
  const fat = latestWellness("body_fat_pct", 60);
  return {
    today, weightKg, ctx, series, stats, balance,
    todayDay: series.find(d => d.date === today) || null,
    forecast: energyTodayForecast(stats, plannedWorkouts, ALL, weightKg, today),
    figures: energyKeyFigures(stats, athleteProfile, weightKg, fat && fat.value, today),
  };
}

function energySegBar(parts, total) {
  return `<div class="en-segbar" role="img" aria-label="${ENERGY_PARTS.map(([k, l]) => `${l} ${enKcal(parts[k])} kcal`).join(", ")}">
    ${ENERGY_PARTS.map(([k]) => parts[k] > 0 ? `<i style="flex:${parts[k] / total};background:${ENERGY_COLORS[k]}"></i>` : "").join("")}
  </div>
  <div class="en-legend">${ENERGY_PARTS.map(([k, l]) => `<span><i style="background:${ENERGY_COLORS[k]}"></i>${l} <b>${enKcal(parts[k])}</b></span>`).join("")}</div>`;
}

function energySourceNote(share, days) {
  if (share == null) return "";
  if (share >= 0.95) return "Werte von Garmin";
  if (share <= 0.05) return "geschätzt (keine Garmin-Kalorien)";
  return `${Math.round(share * days)} von ${days} Tagen von Garmin, Rest geschätzt`;
}

function renderEnergyToday(m) {
  const host = document.getElementById("energy-today-body");
  if (!host) return;
  const f = m.forecast;
  if (!f) {
    host.innerHTML = m.weightKg
      ? `<p class="empty-note">Noch zu wenig Daten. Sobald ein paar Tage mit Garmin-Daten oder Trainings da sind, siehst du hier deinen Tagesverbrauch.</p>`
      : `<p class="empty-note">Trag unten bei „Gewicht & Energiebilanz“ dein Gewicht ein – ohne Körpergewicht lässt sich der Verbrauch nicht berechnen.</p>`;
    return;
  }
  const soFar = m.todayDay && m.todayDay.source === "garmin" ? m.todayDay.total : null;
  const items = f.items.length
    ? `<ul class="en-list">${f.items.map(i => `<li><span>${escapeHtml(i.title)} · ${Math.round(i.minutes)} min</span><b>≈ ${enKcal(i.kcal)} kcal</b></li>`).join("")}</ul>`
    : `<p class="card-sub">Heute ist kein Training geplant – also ein Ruhetag-Bedarf.</p>`;
  host.innerHTML = `
    <div class="en-hero">
      <div><div class="en-hero-label">Voraussichtlich heute</div><div class="en-hero-value">${enKcal(f.total)}<small> kcal</small></div></div>
      ${soFar ? `<div class="en-hero-side"><div class="en-hero-label">Bisher laut Garmin</div><div class="en-hero-small">${enKcal(soFar)} kcal</div></div>` : ""}
    </div>
    ${energySegBar(f, f.total)}
    ${items}`;
}

function renderEnergyNeed(m) {
  const host = document.getElementById("energy-need-body");
  if (!host) return;
  const { w7, w30, w90, trend } = m.stats;
  if (!w7) { host.innerHTML = `<p class="empty-note">Noch keine abgeschlossenen Tage mit Daten.</p>`; return; }
  const tile = (label, w) => `<div class="stat-tile"><div class="label">${label}</div><div class="value">${w ? enKcal(w.total) : "–"}</div><div class="sub">${w ? "kcal pro Tag" : "zu wenig Daten"}</div></div>`;
  const base = w30 || w7;
  let trendText = "";
  if (trend) {
    const dir = Math.abs(trend.deltaKcal) < 50 ? "ist etwa gleich geblieben" : trend.deltaKcal > 0 ? "ist gestiegen" : "ist gesunken";
    const train = Math.abs(trend.trainingDeltaH) >= 1
      ? ` Du hast ${fmtNum(Math.abs(trend.trainingDeltaH), 1)} h ${trend.trainingDeltaH > 0 ? "mehr" : "weniger"} trainiert als im Monat davor.` : "";
    trendText = `<p class="en-note">Dein Verbrauch ${dir}: <b>${enSigned(trend.deltaKcal)} kcal pro Tag</b> (${enSigned(trend.deltaPct)} %) im Vergleich zu den 30 Tagen davor.${train}</p>`;
  }
  host.innerHTML = `
    <div class="stat-row en-tiles3">${tile("Ø 7 Tage", w7)}${tile("Ø 30 Tage", w30)}${tile("Ø 90 Tage", w90)}</div>
    <div class="en-split">
      <div><span>Ruhetag</span><b>${enKcal(base.restDay)} kcal</b><small>${base.restDays} Tage</small></div>
      <div><span>Trainingstag</span><b>${enKcal(base.trainDay)} kcal</b><small>${base.trainDays} Tage</small></div>
    </div>
    <p class="card-sub">So setzt sich ein Durchschnittstag (${base.days} Tage) zusammen:</p>
    ${energySegBar(base, base.total)}
    ${trendText}
    <p class="card-sub en-src">${energySourceNote(base.garminShare, base.days)}</p>`;
}

// Diagrammbreite = tatsächliche Breite der Karte, damit die Schrift nicht
// mitwächst (die SVGs werden per CSS auf volle Breite gezogen).
function energyChartWidth(host) {
  const w = host.clientWidth || (host.parentElement && host.parentElement.clientWidth) || 680;
  return Math.max(300, Math.min(1400, Math.round(w)));
}

// Gestapelte Balken (Grundumsatz/Alltag/Training) mit Ø-Linie.
function drawEnergyBars(host, bars, avg) {
  host.innerHTML = "";
  if (!bars.length) { host.innerHTML = `<p class="empty-note">Keine Daten in diesem Zeitraum.</p>`; return; }
  const W = energyChartWidth(host), H = 230, padL = 44, padR = 8, padT = 10, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(...bars.map(b => b.total)) * 1.08;
  const stepK = max > 4000 ? 1000 : 500;
  const y = v => padT + ih - v / max * ih;
  const slot = iw / bars.length, bw = Math.max(2, Math.min(28, slot * 0.72));
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });
  for (let v = 0; v <= max; v += stepK) {
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: "grid-line" }));
    const t = svgEl("text", { x: padL - 6, y: y(v) + 4, class: "axis-label", "text-anchor": "end" });
    t.textContent = fmtNum(v, 0);
    svg.appendChild(t);
  }
  const labelEvery = Math.max(1, Math.ceil(bars.length / 7));
  bars.forEach((b, i) => {
    const cx = padL + slot * i + slot / 2;
    const g = svgEl("g", { class: "en-bar" + (b.partial ? " is-partial" : "") });
    let base = 0;
    ENERGY_PARTS.forEach(([k]) => {
      if (!(b[k] > 0)) return;
      g.appendChild(svgEl("rect", { x: cx - bw / 2, y: y(base + b[k]), width: bw, height: Math.max(0, y(base) - y(base + b[k])), fill: ENERGY_COLORS[k], rx: bw > 6 ? 1.5 : 0 }));
      base += b[k];
    });
    // breite, unsichtbare Fläche für den Tooltip
    const hit = svgEl("rect", { x: padL + slot * i, y: padT, width: slot, height: ih, fill: "transparent" });
    const tip = `<b>${b.label}</b>${b.partial ? " (bisher)" : ""}<br>${enKcal(b.total)} kcal${b.days ? ` Ø pro Tag (${b.days} Tage)` : ""}<br>`
      + ENERGY_PARTS.map(([k, l]) => `${l}: ${enKcal(b[k])}`).join("<br>") + (b.source === "estimate" ? "<br><i>geschätzt</i>" : "");
    hit.addEventListener("mousemove", e => { g.classList.add("is-hover"); showTip(e, tip, host); });
    hit.addEventListener("mouseleave", () => { g.classList.remove("is-hover"); hideTip(); });
    g.appendChild(hit);
    svg.appendChild(g);
    if (i % labelEvery === 0) {
      const t = svgEl("text", { x: cx, y: H - 6, class: "axis-label", "text-anchor": "middle" });
      t.textContent = b.xLabel;
      svg.appendChild(t);
    }
  });
  if (avg) {
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y(avg), y2: y(avg), class: "en-avg-line" }));
    const t = svgEl("text", { x: W - padR, y: y(avg) - 5, class: "axis-label en-avg-label", "text-anchor": "end" });
    t.textContent = `Ø ${fmtNum(Math.round(avg), 0)}`;
    svg.appendChild(t);
  }
  host.appendChild(svg);
}

function renderEnergyHistory(m) {
  const host = document.getElementById("energy-history-chart");
  if (!host) return;
  document.querySelectorAll("#energy-range button").forEach(b => b.classList.toggle("is-on", b.dataset.range === energyRange));
  let bars;
  if (energyRange === "12m") {
    bars = energyMonthly(m.series, 12).map(x => {
      const label = new Date(x.month + "-15T12:00:00").toLocaleDateString("de-DE", { month: "long", year: "numeric" });
      return { ...x, label, xLabel: new Date(x.month + "-15T12:00:00").toLocaleDateString("de-DE", { month: "short" }) };
    });
  } else {
    const from = energyAddDays(m.today, -Number(energyRange) + 1);
    bars = m.series.filter(d => d.date >= from).map(d => ({ ...d, label: enDate(d.date), xLabel: enDate(d.date) }));
  }
  const full = bars.filter(b => !b.partial);
  const avg = full.length ? full.reduce((a, b) => a + b.total, 0) / full.length : null;
  drawEnergyBars(host, bars, avg);
}

function drawEnergyWeight(host, points) {
  host.innerHTML = "";
  if (points.filter(p => p.raw != null).length < 2) { host.innerHTML = `<p class="empty-note">Für den Verlauf brauchst du mindestens zwei Wiegungen.</p>`; return; }
  const W = energyChartWidth(host), H = 170, padL = 44, padR = 8, padT = 10, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  const vals = points.flatMap(p => [p.trend, p.raw]).filter(v => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  lo -= 0.2; hi += 0.2;
  const x = i => padL + (points.length <= 1 ? iw / 2 : i / (points.length - 1) * iw);
  const y = v => padT + ih - (v - lo) / (hi - lo) * ih;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart-enter" });
  [lo + 0.2, (lo + hi) / 2, hi - 0.2].forEach(v => {
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: "grid-line" }));
    const t = svgEl("text", { x: padL - 6, y: y(v) + 4, class: "axis-label", "text-anchor": "end" });
    t.textContent = fmtNum(v, 1);
    svg.appendChild(t);
  });
  points.forEach((p, i) => { if (p.raw != null) svg.appendChild(svgEl("circle", { cx: x(i), cy: y(p.raw), r: 2.6, class: "en-weight-dot" })); });
  const d = points.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.trend).toFixed(1)).join(" ");
  const path = svgEl("path", { d, class: "en-weight-trend" });
  svg.appendChild(path);
  animateDraw(path, 700);
  const step = Math.max(1, Math.ceil(points.length / 5));
  points.forEach((p, i) => {
    if (i % step) return;
    const t = svgEl("text", { x: x(i), y: H - 6, class: "axis-label", "text-anchor": "middle" });
    t.textContent = enDate(p.date);
    svg.appendChild(t);
  });
  const hit = svgEl("rect", { x: padL, y: padT, width: iw, height: ih, fill: "transparent" });
  hit.addEventListener("mousemove", e => {
    const r = host.getBoundingClientRect();
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) * W / r.width - padL) / iw * (points.length - 1))));
    const p = points[i];
    showTip(e, `<b>${enDate(p.date)}</b><br>Trend ${fmtNum(p.trend, 1)} kg${p.raw != null ? `<br>Gewogen ${fmtNum(p.raw, 1)} kg` : ""}`, host);
  });
  hit.addEventListener("mouseleave", hideTip);
  svg.appendChild(hit);
  host.appendChild(svg);
}

function renderEnergyBalance(m) {
  const host = document.getElementById("energy-balance-body");
  if (!host) return;
  const b = m.balance;
  let top;
  if (b) {
    const weeks = Math.round(b.days / 7);
    const kind = Math.abs(b.balance) < 75 ? "ausgeglichen" : b.balance < 0 ? "Defizit" : "Überschuss";
    const sentence = Math.abs(b.deltaKg) < 0.2
      ? `Dein Gewicht ist in den letzten ${weeks} Wochen stabil geblieben – du isst also ungefähr so viel, wie du verbrauchst.`
      : `Du hast in den letzten ${weeks} Wochen etwa <b>${fmtNum(Math.abs(b.deltaKg), 1)} kg ${b.deltaKg < 0 ? "abgenommen" : "zugenommen"}</b>. Das heißt: Du hast im Schnitt rund <b>${enKcal(Math.abs(b.balance))} kcal pro Tag ${b.balance < 0 ? "weniger gegessen als verbraucht" : "mehr gegessen als verbraucht"}</b>.`;
    top = `
      <div class="stat-row en-tiles4">
        <div class="stat-tile"><div class="label">Gewichtstrend</div><div class="value">${enSigned(b.kgPerWeek, 2)}</div><div class="sub">kg pro Woche</div></div>
        <div class="stat-tile"><div class="label">Ø Bilanz</div><div class="value">${enSigned(b.balance)}</div><div class="sub">kcal/Tag · ${kind}</div></div>
        <div class="stat-tile"><div class="label">Du isst ungefähr</div><div class="value">${enKcal(b.intake)}</div><div class="sub">kcal pro Tag</div></div>
        <div class="stat-tile"><div class="label">Zum Halten</div><div class="value">${enKcal(b.expenditure)}</div><div class="sub">kcal pro Tag</div></div>
      </div>
      <p class="en-note">${sentence}</p>`;
  } else {
    top = `<p class="empty-note">Für die Energiebilanz brauche ich mindestens 3 Wiegungen, verteilt über 2 Wochen oder mehr. Am besten wiegst du dich ein paarmal pro Woche morgens nach dem Aufstehen.</p>`;
  }
  const latest = weightLog.length ? weightLog[weightLog.length - 1] : null;
  host.innerHTML = `${top}
    <div class="chart-wrap" id="energy-weight-chart"></div>
    <div class="en-weigh">
      <label for="energy-weight-input">Gewicht heute</label>
      <input type="number" id="energy-weight-input" class="coach-input" step="0.1" min="30" max="250" inputmode="decimal" placeholder="z.B. 72,3" value="${latest && latest.date === m.today ? latest.weightKg : ""}">
      <span>kg</span>
      <button type="button" class="cal-today-btn" id="energy-weight-save">Eintragen</button>
    </div>
    ${latest ? `<p class="card-sub en-src">Letzte Wiegung: ${fmtNum(latest.weightKg, 1)} kg am ${enDate(latest.date)}</p>` : ""}`;
  drawEnergyWeight(document.getElementById("energy-weight-chart"), weightTrendSeries(weightLog, energyAddDays(m.today, -90), m.today));
}

function renderEnergyFigures(m) {
  const host = document.getElementById("energy-figures-body");
  if (!host) return;
  const k = m.figures;
  const tiles = [
    ["Grundumsatz", k.bmr ? `${enKcal(k.bmr)}` : "–", k.bmr ? `kcal/Tag · ${k.bmrSource === "garmin" ? "von Garmin" : "geschätzt"}` : "Gewicht fehlt",
      "So viel verbrennt dein Körper in völliger Ruhe – nur fürs Atmen, Herz, Gehirn und Wärme. Das ist der größte Teil deines Verbrauchs."],
    ["Aktivitätslevel (PAL)", k.pal ? fmtNum(k.pal, 2) : "–", k.palCategory ? k.palCategory.label : "zu wenig Daten",
      "Gesamtverbrauch geteilt durch Grundumsatz. Bürojob ohne Sport ≈ 1,4–1,5, aktiv ≈ 1,7–2,0, Ausdauersportler im Training oft 2,0 und mehr."],
    ["Verbrauch pro kg", k.kcalPerKg ? `${k.kcalPerKg}` : "–", "kcal je kg Körpergewicht",
      "Macht den Bedarf zwischen Menschen vergleichbar. Ausdauersportler liegen oft bei 40–60 kcal pro kg."],
    ["Pro Trainingsstunde", k.kcalPerTrainingHour ? enKcal(k.kcalPerTrainingHour) : "–", "kcal zusätzlich",
      "So viel verbrauchst du im Schnitt pro Stunde Training zusätzlich zum Grundumsatz."],
    ["Anteil Training", k.trainingShare != null ? `${k.trainingShare} %` : "–", "am Gesamtverbrauch",
      "Welcher Teil deines Tagesverbrauchs aufs Training geht. Der Rest ist Grundumsatz und Alltag (Gehen, Stehen, Verdauung)."],
    ["BMI", k.bmi ? fmtNum(k.bmi, 1) : "–", k.bmi ? k.bmiCategory : "Größe im Profil eintragen",
      "Gewicht geteilt durch Größe². Grobe Orientierung – bei viel Muskeln ist der BMI oft zu hoch und sagt wenig aus."],
  ];
  if (k.leanKg) tiles.push(["Magermasse", fmtNum(k.leanKg, 1), `kg · ${fmtNum(k.bodyFatPct, 1)} % Körperfett`,
    "Alles außer Fett: Muskeln, Knochen, Organe, Wasser. Aus dem Körperfett deiner Garmin-Waage."]);
  host.innerHTML = `<div class="en-figures">${tiles.map(([label, val, sub, info]) => `
    <div class="stat-tile"><div class="label">${label} ${enInfo(info)}</div><div class="value">${val}</div><div class="sub">${sub}</div></div>`).join("")}</div>`;
}

function renderEnergy() {
  if (!document.getElementById("energy-section")) return;
  let m;
  try { m = energyModel(); } catch (e) { console.error("Energie-Berechnung fehlgeschlagen", e); return; }
  renderEnergyToday(m);
  renderEnergyNeed(m);
  renderEnergyHistory(m);
  renderEnergyBalance(m);
  renderEnergyFigures(m);
}

function initEnergy() {
  const sec = document.getElementById("energy-section");
  if (!sec) return;
  // Die Diagramme richten sich nach der Kartenbreite: neu zeichnen, sobald
  // die Seite sichtbar wird (vorher Breite 0) oder sich die Breite ändert.
  if (typeof ResizeObserver === "function") {
    let lastW = 0, timer = null;
    new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (!w || Math.abs(w - lastW) < 8) return;
      const first = !lastW;
      lastW = w;
      clearTimeout(timer);
      timer = setTimeout(renderEnergy, first ? 0 : 150);
    }).observe(sec);
  }
  sec.addEventListener("click", e => {
    const r = e.target.closest("#energy-range button");
    if (r) { energyRange = r.dataset.range; renderEnergyHistory(energyModel()); return; }
    if (e.target.closest("#energy-weight-save")) {
      const input = document.getElementById("energy-weight-input");
      const v = Number(String(input.value).replace(",", "."));
      if (!v || v < 30 || v > 250) { input.focus(); return; }
      logWeight(v);
      try { syncProfileInputsFromState(); } catch (err) { /* Coach-Tab evtl. noch nicht initialisiert */ }
      renderNutrition();
    }
  });
  sec.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.id === "energy-weight-input") document.getElementById("energy-weight-save").click();
  });
}
