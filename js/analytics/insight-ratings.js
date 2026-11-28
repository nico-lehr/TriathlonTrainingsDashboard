// Bewertung der Kennzahlen auf der Insights-Seite ("Ist mein Wert gut?"):
//   - Kacheln oben (VO2max, Trainingsstatus, Umfang …): Detail mit Verlauf,
//     Bewertung und Erklärung (statDetail, angezeigt von
//     js/components/stat-detail.js),
//   - kurze Ampel-Bewertung unter Fitness & Form, ACWR, Monotonie und
//     Erholung (pmcRatingItems, acwrRatingItems, …).
// Alle Einträge haben dieselbe Form wie die Einordnung in der
// Trainings-Detailansicht (js/analytics/metric-insights.js) und werden mit
// metricInsightsHtml() (js/components/workout-card.js) gezeichnet:
//   { label, valueText, verdict, level, scale, rangeText, compare, plan, explain, tip }
// Stufen: great/good/ok/warn/bad (Farben wie dort).
// Reine Berechnung, nutzt nur vorhandene Werte (CTL/ATL/TSB, VO2max-Schätzung,
// Garmin-Tageswerte) - keine neue Herleitung derselben Zahl.

const IR_DAY_MS = 86400000;
const irFmt = (v, d = 0) => Number(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const irSigned = (v, d = 0) => (v > 0 ? "+" : v < 0 ? "−" : "±") + irFmt(Math.abs(v), d);

// Ein Eintrag aus Bändern [ab, bis, Stufe, Wort] und einem Wert.
function irBandItem({ label, value, valueText, bands, fmt, span, explain, tip, rangeText, compare, plan }) {
  const lo = bands[0][0], hi = bands[bands.length - 1][1];
  const v = Math.max(lo, Math.min(hi - 1e-9, value));
  const band = miBand(bands, v);
  return {
    label, valueText, verdict: band[3], level: band[2],
    scale: miScale(bands, v, fmt, span ? { span } : {}),
    rangeText: rangeText || "", compare: compare || null, plan: plan || null,
    explain, tip: typeof tip === "function" ? tip(band[2], value) : (tip || ""),
  };
}

// Vergleich "jetzt gegen früher". better: "higher" | "lower" | null (neutral:
// mehr/weniger statt besser/schlechter). noise: kleinere Änderungen = gleich.
function irCompare(cur, prev, { better = "higher", noise = 0, dec = 0, unit = "", text, baseText }) {
  if (cur == null || prev == null) return null;
  const delta = cur - prev;
  let dir;
  if (Math.abs(delta) <= noise) dir = "same";
  else if (!better) dir = delta > 0 ? "more" : "less";
  else dir = (better === "higher" ? delta > 0 : delta < 0) ? "better" : "worse";
  const u = unit ? (unit === "%" ? " %" : " " + unit) : "";
  return {
    dir, delta,
    text: text || (dir === "same" ? "etwa gleich" : `${irSigned(delta, dec)}${u}`),
    baseText: baseText || `vorher ${irFmt(prev, dec)}${u}`,
  };
}

/* ---------- VO2max: Bewertung nach Alter und Geschlecht ------------------
   Tabelle des Cooper Institute (dieselbe nutzt Garmin): je Altersgruppe die
   Untergrenzen für "mittelmäßig", "gut", "sehr gut", "hervorragend". Gilt
   für Laufen; Garmin bewertet die Rad-VO2max mit derselben Tabelle. */
const VO2_NORMS = {
  m: [[20, [41.7, 45.4, 51.1, 55.4]], [30, [40.5, 44.0, 48.3, 54.0]], [40, [38.5, 42.4, 46.4, 52.5]],
      [50, [35.6, 39.2, 43.4, 48.9]], [60, [32.3, 35.5, 39.5, 45.7]], [70, [29.4, 32.3, 36.7, 42.1]]],
  w: [[20, [36.1, 39.5, 43.9, 49.6]], [30, [34.4, 37.8, 42.4, 47.4]], [40, [33.0, 36.3, 39.7, 45.3]],
      [50, [30.1, 33.0, 36.7, 41.1]], [60, [27.5, 30.0, 33.0, 37.8]], [70, [25.9, 28.1, 30.9, 36.7]]],
};

// Bänder für Alter + Geschlecht ("m"/"w"), sonst null (dann nur Verlauf).
function vo2NormBands(age, gender) {
  const table = VO2_NORMS[gender];
  if (!table || !(age > 0)) return null;
  let row = table[0];
  table.forEach(r => { if (age >= r[0]) row = r; });
  const [t0, t1, t2, t3] = row[1];
  const from = row[0], to = from === 70 ? null : from + 9;
  return {
    group: `${gender === "w" ? "Frauen" : "Männer"} ${from < 20 ? "unter 30" : to ? `${from}–${to}` : `ab ${from}`} Jahre`,
    ageNote: age < 20 ? " (unter 20: Werte der 20–29-Jährigen)" : "",
    bands: [
      [Math.floor(t0 - 8), t0, "bad", "niedrig"],
      [t0, t1, "warn", "mittelmäßig"],
      [t1, t2, "ok", "gut"],
      [t2, t3, "good", "sehr gut"],
      [t3, Math.ceil(t3 + 8), "great", "hervorragend"],
    ],
  };
}

// Verlauf der VO2max: Garmin-Tageswerte (1 Punkt je Woche), sonst Werte je
// Einheit, sonst die eigene Schätzung für jeden Monat (nur mit den
// Einheiten bis dahin). [{date, value}] aufsteigend.
function vo2History(sport, days = 365) {
  const field = sport === "Rad" ? "vo2max_cycling" : "vo2max";
  const now = Date.now();
  if (typeof wellnessSeries === "function") {
    const pts = wellnessSeries(field, days);
    if (pts.length) {
      const byWeek = new Map();
      pts.forEach(p => byWeek.set(Math.floor((now - p.date.getTime()) / (7 * IR_DAY_MS)), p));
      return { source: "garmin", points: [...byWeek.values()].sort((a, b) => a.date - b.date) };
    }
  }
  const synced = (typeof ALL !== "undefined" ? ALL : [])
    .filter(w => w.sport === sport && w._date && w.vo2max != null && now - w._date.getTime() <= days * IR_DAY_MS)
    .sort((a, b) => a._date - b._date)
    .map(w => ({ date: w._date, value: w.vo2max }));
  if (synced.length) return { source: "garmin", points: synced };
  const est = sport === "Rad" ? computeBikeVo2MaxEstimate : computeRunVo2MaxEstimate;
  const points = [];
  for (let m = Math.floor(days / 30); m >= 0; m--) {
    const at = now - m * 30 * IR_DAY_MS;
    const e = est({ now: at, skipSynced: true });
    if (e && e.value != null) points.push({ date: new Date(at), value: e.value });
  }
  return { source: "estimate", points };
}

// Wert ca. 3 Monate vor dem letzten Punkt (für den Trend), sonst null.
function vo2ValueMonthsAgo(points, months = 3) {
  if (!points.length) return null;
  const last = points[points.length - 1];
  const cutoff = last.date.getTime() - months * 30 * IR_DAY_MS;
  const older = points.filter(p => p.date.getTime() <= cutoff + 7 * IR_DAY_MS);
  return older.length ? older[older.length - 1] : null;
}

function vo2RatingItem(sport, est, history, profile) {
  if (!est) return null;
  const age = typeof getAthleteAge === "function" ? getAthleteAge() : profile.age;
  const norm = vo2NormBands(age, profile.gender);
  const prev = vo2ValueMonthsAgo(history.points);
  const compare = prev ? irCompare(est.value, prev.value, {
    better: "higher", noise: 0.4, dec: 1,
    baseText: `vor ca. 3 Monaten ${irFmt(prev.value, 1)}`,
  }) : null;
  const explain = "VO2max sagt, wie viel Sauerstoff dein Körper pro Minute und Kilo Körpergewicht höchstens verarbeiten kann – also wie groß dein „Ausdauer-Motor“ ist. Höher ist besser."
    + (sport === "Rad" ? " Auf dem Rad liegt der Wert meist etwas unter dem Laufwert, weil weniger Muskeln mitarbeiten." : "")
    + " Die Bewertung vergleicht dich mit Menschen gleichen Alters und Geschlechts (Tabelle des Cooper Institute, die auch Garmin nutzt). Fürs Triathlon zählt aber genauso, wie lange du nah an deiner Grenze durchhältst – das trainierst du mit langen, lockeren Einheiten.";
  const tip = level => (level === "bad" || level === "warn" || level === "ok")
    ? "Am meisten hebt die VO2max: viel lockeres Grundlagentraining (Puls-Zone 2) plus 1× pro Woche Intervalle, z. B. 4–5 × 4 Minuten zügig (Zone 4–5) mit 3 Minuten Trabpause. Nach 6–8 Wochen sieht man meist einen Anstieg."
    : "Sehr guter Wert. Halten kannst du ihn mit Grundlage plus alle 1–2 Wochen harten Intervallen. Weitere Fortschritte kommen jetzt eher über die Schwelle (längere Abschnitte knapp unter „hart“).";
  const valueText = `${irFmt(est.value, 1)} ml/kg/min`;
  if (!norm) {
    return {
      label: `VO2max ${sport}`, valueText, verdict: "", level: "ok", scale: null,
      rangeText: profile.gender === "divers"
        ? "Für „divers“ gibt es keine eigene Vergleichstabelle – du siehst deshalb nur deinen Verlauf."
        : "Für eine Bewertung nach Alter und Geschlecht bitte Geburtsdatum und Geschlecht im Profil eintragen.",
      compare, explain, tip: tip("ok"),
    };
  }
  return irBandItem({
    label: `VO2max ${sport}`, value: est.value, valueText, bands: norm.bands,
    fmt: x => irFmt(x, 1), span: (lo, hi) => `${irFmt(lo, 1)}–${irFmt(hi, 1)}`,
    rangeText: `Vergleich: ${norm.group}${norm.ageNote}`, compare, explain, tip,
  });
}

/* ---------- Fitness & Form, Belastung, Monotonie -------------------------- */

// CTL-Anstieg pro Woche (aus 4 Wochen): wie schnell die Fitness wächst.
function ctlRampItem(state) {
  if (!state || state.ctlDelta == null) return null;
  const perWeek = state.ctlDelta / 4;
  return irBandItem({
    label: "Fitness-Entwicklung", value: perWeek,
    valueText: `${irSigned(perWeek, 1)} CTL pro Woche`,
    bands: [[-6, -1, "warn", "sinkt"], [-1, 1, "ok", "stabil"], [1, 5, "good", "steigt gut"], [5, 8, "warn", "steigt sehr schnell"], [8, 12, "bad", "zu schneller Anstieg"]],
    fmt: x => irSigned(x, 0), span: (lo, hi) => `${irSigned(lo, 0)} bis ${irSigned(hi, 0)}`,
    rangeText: `Fitness (CTL) jetzt ${irFmt(state.ctl, 0)}, vor 4 Wochen ${irFmt(state.ctl - state.ctlDelta, 0)}`,
    explain: "CTL ist deine „Fitness-Zahl“: der Durchschnitt deiner Trainingsbelastung der letzten 6 Wochen. Steigt sie um etwa 1–5 Punkte pro Woche, wirst du fitter, ohne dich zu überfordern. Viel schneller erhöht das Verletzungsrisiko, sinkt sie über Wochen, geht Form verloren.",
    tip: level => level === "warn" || level === "bad"
      ? (state.ctlDelta < 0 ? "Wenn das keine geplante Pause ist: wieder regelmäßig trainieren, lieber öfter kurz als selten lang." : "Belastung etwas langsamer steigern – jede 3.–4. Woche eine leichtere Woche einplanen.")
      : "Passt – so weitermachen und alle 3–4 Wochen eine Entlastungswoche einbauen.",
  });
}

// TSB = Form: frisch oder müde?
function tsbItem(tsb) {
  if (tsb == null) return null;
  return irBandItem({
    label: "Form (TSB)", value: tsb, valueText: irSigned(tsb, 0),
    bands: [[-45, -30, "bad", "stark ermüdet"], [-30, -10, "ok", "müde (im Aufbau normal)"], [-10, 5, "good", "ausgeglichen"], [5, 15, "great", "frisch"], [15, 35, "warn", "sehr frisch"]],
    fmt: x => irSigned(x, 0), span: (lo, hi) => `${irSigned(lo, 0)} bis ${irSigned(hi, 0)}`,
    explain: "Die Form ist Fitness minus Müdigkeit (CTL − ATL). Leicht negativ ist im Training normal – dann trainierst du gerade. Unter −30 bist du sehr müde. Deutlich positiv heißt frisch, z. B. vor einem Wettkampf – hält das lange an, trainierst du aber zu wenig.",
    tip: level => level === "bad" ? "1–2 lockere Tage oder einen Ruhetag einlegen, bevor wieder harte Einheiten kommen."
      : level === "warn" ? "Sehr frisch: gut vor einem Wettkampf. Ohne Wettkampf darf es wieder etwas mehr Training sein."
      : "Gut. Für einen Wettkampf solltest du an dem Tag bei etwa +5 bis +15 liegen.",
  });
}

function acwrItem(acwr) {
  if (acwr == null) return null;
  return irBandItem({
    label: "Belastungsverhältnis (ACWR)", value: acwr, valueText: irFmt(acwr, 2),
    bands: [[0.3, 0.8, "warn", "wenig Belastung"], [0.8, 1.3, "good", "optimal"], [1.3, 1.5, "warn", "erhöht"], [1.5, 2.1, "bad", "hohes Risiko"]],
    fmt: x => irFmt(x, 1), span: (lo, hi) => `${irFmt(lo, 1)}–${irFmt(hi, 1)}`,
    explain: "Vergleicht die letzte Woche mit den letzten 6 Wochen. 1,0 heißt: diese Woche so viel wie sonst. Zwischen 0,8 und 1,3 ist der sichere Bereich. Darüber hast du plötzlich deutlich mehr gemacht als dein Körper gewohnt ist – dann steigt das Verletzungsrisiko.",
    tip: level => level === "bad" || (level === "warn" && acwr > 1)
      ? "Die nächsten Tage etwas ruhiger angehen – lieber locker und kürzer, bis der Wert wieder unter 1,3 ist."
      : level === "warn" ? "Wenig Belastung: nach einer Pause oder Erholungswoche normal. Dann langsam wieder steigern."
      : "Optimal – die Belastung steigt in einem Tempo, das dein Körper verträgt.",
  });
}

function monotonyItem(monotony) {
  if (monotony == null) return null;
  return irBandItem({
    label: "Trainingsmonotonie", value: monotony, valueText: irFmt(monotony, 2),
    bands: [[0, 1.5, "good", "abwechslungsreich"], [1.5, 2, "warn", "grenzwertig"], [2, 3.5, "bad", "zu gleichförmig"]],
    fmt: x => irFmt(x, 1), span: (lo, hi) => `${irFmt(lo, 1)}–${irFmt(hi, 1)}`,
    explain: "Zeigt, ob sich harte und leichte Tage abwechseln. Ist jeder Tag ungefähr gleich anstrengend und es gibt keine echten Ruhetage, steigt der Wert – und damit das Risiko für Übertraining, auch wenn die Gesamtmenge passt.",
    tip: level => level === "good" ? "Gut: harte und lockere Tage wechseln sich ab."
      : "Mehr Abwechslung: harte Tage richtig hart, lockere Tage wirklich locker, und mindestens einen freien Tag pro Woche.",
  });
}

function pmcRatingItems() {
  const state = typeof computePerformanceState === "function" ? computePerformanceState() : null;
  if (!state) return [];
  return [ctlRampItem(state), tsbItem(state.tsb)].filter(Boolean);
}

function acwrRatingItems() {
  const state = typeof computePerformanceState === "function" ? computePerformanceState() : null;
  return state ? [acwrItem(state.acwr)].filter(Boolean) : [];
}

function monotonyRatingItems() {
  const s = typeof computeMonotonyStrainSeries === "function" ? computeMonotonyStrainSeries() : null;
  return s && s.length ? [monotonyItem(s[s.length - 1].monotony)].filter(Boolean) : [];
}

/* ---------- Erholung (Garmin-Tageswerte) ---------------------------------- */

// Ø der letzten 7 Tage und Ø der 8.–60. Tage davor (die eigene Normalität).
function irWellnessWindow(field, tf = v => v) {
  if (typeof wellnessSeries !== "function") return null;
  const now = Date.now();
  const pts = wellnessSeries(field, 60).map(p => ({ age: (now - p.date.getTime()) / IR_DAY_MS, v: tf(p.value) }));
  const recent = pts.filter(p => p.age <= 7).map(p => p.v);
  const base = pts.filter(p => p.age > 7).map(p => p.v);
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  if (!recent.length) return null;
  return { recent: mean(recent), nRecent: recent.length, base: base.length >= 10 ? mean(base) : null };
}

function recoveryRatingItems() {
  const items = [];
  const hrv = irWellnessWindow("hrv_ms");
  if (hrv && hrv.base) {
    const pct = (hrv.recent - hrv.base) / hrv.base * 100;
    items.push(irBandItem({
      label: "HRV (Ø letzte 7 Nächte)", value: pct, valueText: `${irFmt(hrv.recent, 0)} ms`,
      bands: [[-40, -15, "bad", "deutlich unter normal"], [-15, -5, "warn", "etwas niedrig"], [-5, 8, "good", "normal"], [8, 40, "great", "über normal"]],
      fmt: x => `${irSigned(x, 0)} %`, span: (lo, hi) => `${irSigned(lo, 0)} bis ${irSigned(hi, 0)} %`,
      rangeText: `${irSigned(pct, 0)} % gegenüber deinem Normalwert (${irFmt(hrv.base, 0)} ms)`,
      explain: "HRV zeigt, wie entspannt dein Nervensystem in der Nacht ist. Die Zahl selbst ist bei jedem Menschen anders – wichtig ist nur der Vergleich mit deinem eigenen Normalwert. Deutlich niedriger heißt: Körper ist gestresst (hartes Training, wenig Schlaf, Alkohol, beginnender Infekt).",
      tip: level => level === "bad" || level === "warn" ? "Die nächsten 1–2 Tage locker trainieren, früher schlafen und viel trinken. Bleibt der Wert länger niedrig: Entlastungstag einplanen." : "Gute Erholung – harte Einheiten sind jetzt gut verträglich.",
    }));
  }
  const rhr = irWellnessWindow("resting_hr");
  if (rhr && rhr.base) {
    const d = rhr.recent - rhr.base;
    items.push(irBandItem({
      label: "Ruhepuls (Ø letzte 7 Tage)", value: d, valueText: `${irFmt(rhr.recent, 0)} bpm`,
      bands: [[-12, -2, "great", "niedriger als sonst"], [-2, 2, "good", "normal"], [2, 5, "warn", "leicht erhöht"], [5, 15, "bad", "deutlich erhöht"]],
      fmt: x => `${irSigned(x, 0)} bpm`, span: (lo, hi) => `${irSigned(lo, 0)} bis ${irSigned(hi, 0)} bpm`,
      rangeText: `${irSigned(d, 1)} bpm gegenüber deinem Normalwert (${irFmt(rhr.base, 0)} bpm)`,
      explain: "Ein niedriger Ruhepuls ist ein Zeichen guter Ausdauer. Steigt er ein paar Tage lang um mehr als 3–5 Schläge über deinen Normalwert, ist der Körper meist müde oder kämpft gegen einen Infekt.",
      tip: level => level === "bad" ? "Heute nur locker oder gar nicht trainieren und auf Krankheitszeichen achten." : level === "warn" ? "Etwas Erholung einplanen, vor allem wenn auch die HRV niedrig ist." : "Alles im grünen Bereich.",
    }));
  }
  const sleep = irWellnessWindow("sleep_min", v => v / 60);
  if (sleep) {
    items.push(irBandItem({
      label: "Schlaf (Ø letzte 7 Nächte)", value: sleep.recent, valueText: `${irFmt(sleep.recent, 1)} h`,
      bands: [[4, 6, "bad", "zu wenig"], [6, 7, "warn", "knapp"], [7, 8, "good", "gut"], [8, 10.5, "great", "sehr gut"]],
      fmt: x => `${irFmt(x, 0)} h`, span: (lo, hi) => `${irFmt(lo, 0)}–${irFmt(hi, 0)} h`,
      explain: "Im Schlaf repariert der Körper die Muskeln und passt sich ans Training an. Erwachsene brauchen 7–9 Stunden, wer viel trainiert eher 8 und mehr.",
      tip: level => level === "bad" || level === "warn" ? "Versuch 30–60 Minuten früher ins Bett zu gehen – das bringt für die Erholung oft mehr als jede Zusatzeinheit." : "Sehr gut – Schlaf ist dein bester Erholungshelfer.",
    }));
  }
  return items;
}

/* ---------- Umfang: Wochenwerte, Plan, Regelmäßigkeit --------------------- */

// Wochen (Mo–So) der letzten n Wochen, die aktuelle zuletzt (läuft noch).
function irWeekStarts(n, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7 * i));
  return out;
}

function irWeeklySeries(list, valueOf, n = 26, now = new Date()) {
  const starts = irWeekStarts(n, now);
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    const ws = list.filter(w => w._date && w._date >= start && w._date < end);
    return { date: start, value: ws.reduce((s, w) => s + valueOf(w), 0), sessions: ws.length, current: i === starts.length - 1 };
  });
}

// Ø je Woche der letzten 28 Tage und der 12 Wochen davor.
function irWeeklyAverages(list, valueOf, now = Date.now()) {
  const inAge = (w, a, b) => { const age = (now - w._date.getTime()) / IR_DAY_MS; return age >= a && age < b; };
  const sum = arr => arr.reduce((s, w) => s + valueOf(w), 0);
  const ok = list.filter(w => w._date && w._date.getTime() <= now);
  const recent = ok.filter(w => inAge(w, 0, 28));
  const before = ok.filter(w => inAge(w, 28, 112));
  const first = ok.length ? Math.min(...ok.map(w => w._date.getTime())) : now;
  const beforeWeeks = Math.min(12, Math.max(0, (now - 28 * IR_DAY_MS - first) / (7 * IR_DAY_MS)));
  return { recent: sum(recent) / 4, before: beforeWeeks >= 2 ? sum(before) / beforeWeeks : null };
}

const IR_PLAN_BANDS = [[0.3, 0.7, "warn", "deutlich unter Plan"], [0.7, 0.9, "ok", "etwas unter Plan"], [0.9, 1.1, "good", "im Plan"], [1.1, 1.3, "ok", "etwas über Plan"], [1.3, 1.7, "warn", "deutlich über Plan"]];

function irPlanItem({ label, value, target, valueText, targetText, explain }) {
  return irBandItem({
    label, value: value / target, valueText, bands: IR_PLAN_BANDS,
    fmt: x => `${irFmt(x * 100, 0)} %`, span: (lo, hi) => `${irFmt(lo * 100, 0)}–${irFmt(hi * 100, 0)} %`,
    rangeText: `${irFmt(value / target * 100, 0)} % von deinem Ziel (${targetText})`,
    explain,
    tip: level => level === "good" ? "Du hältst deinen Plan – genau so entsteht Fortschritt."
      : value < target ? "Lieber regelmäßig kürzere Einheiten als selten lange. Wenn das Ziel dauerhaft nicht passt, passe es in den Einstellungen an."
      : "Mehr als geplant ist nur gut, wenn du dich frisch fühlst. Achte auf Form und Belastungsverhältnis.",
  });
}

// Regelmäßigkeit: in wie vielen der letzten 8 Wochen gab es diese Sportart?
function irRegularityItem(sport, list, now = new Date()) {
  const weeks = irWeeklySeries(list, () => 0, 9, now).slice(0, 8); // ohne die laufende Woche
  const withSport = weeks.filter(w => w.sessions > 0).length;
  return irBandItem({
    label: "Regelmäßigkeit", value: withSport, valueText: `${withSport} von 8 Wochen`,
    bands: [[0, 3, "bad", "selten"], [3, 5, "warn", "unregelmäßig"], [5, 7, "good", "regelmäßig"], [7, 8.01, "great", "sehr regelmäßig"]],
    fmt: x => `${irFmt(Math.min(8, x), 0)} Wo.`, span: (lo, hi) => `${irFmt(lo, 0)}–${irFmt(Math.min(8, Math.ceil(hi) - 1), 0)} Wo.`,
    explain: `In wie vielen der letzten 8 abgeschlossenen Wochen du mindestens einmal ${sport === "Laufen" ? "laufen" : sport === "Rad" ? "Rad fahren" : "schwimmen"} warst. Für Fortschritt zählt Regelmäßigkeit mehr als einzelne lange Einheiten – vor allem beim Schwimmen geht das Wassergefühl nach 1–2 Wochen Pause schnell verloren.`,
    tip: level => level === "good" || level === "great" ? "Sehr gut – dranbleiben." : "Plane jede Woche mindestens eine feste Einheit dieser Sportart ein, auch wenn sie kurz ist.",
  });
}

/* ---------- Detail je Kachel -------------------------------------------- */

const IR_SPORT_UNIT = { Laufen: ["km", 1], Rad: ["km", 0], Schwimmen: ["km", 1] };

// key: status | streak | count | time | Laufen | Rad | Schwimmen | vo2run | vo2bike
function statDetail(key) {
  const profile = (typeof athleteProfile !== "undefined" && athleteProfile) || {};
  const all = (typeof ALL !== "undefined" ? ALL : []).filter(w => w._date && !w.is_summary);
  const weekLabel = p => `Woche ab ${p.date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}${p.current ? " (läuft)" : ""}`;

  if (key === "vo2run" || key === "vo2bike") {
    const sport = key === "vo2run" ? "Laufen" : "Rad";
    const est = (key === "vo2run" ? computeRunVo2MaxEstimate : computeBikeVo2MaxEstimate)();
    const history = vo2History(sport);
    const item = vo2RatingItem(sport, est, history, profile);
    return {
      title: `VO2max ${sport}`,
      value: est ? `${irFmt(est.value, 1)} ml/kg/min` : "–",
      items: item ? [item] : [],
      empty: est ? "" : (sport === "Rad" ? "Für eine Rad-VO2max braucht es Leistungsmesser-Daten, Körpergewicht, max. Puls und Ruhepuls – oder den Wert von Garmin." : "Noch keine Laufdaten oder Herzfrequenzen im Profil für eine Schätzung."),
      history: {
        title: history.source === "garmin" ? "Verlauf (Garmin, 12 Monate)" : "Verlauf (eigene Schätzung je Monat)",
        unit: "ml/kg/min", dec: 1,
        points: history.points.map(p => ({ date: p.date, value: p.value, label: p.date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" }) })),
      },
      source: est ? `Quelle: ${est.methodLabel}` : "",
    };
  }

  if (key === "status") {
    const st = computeTrainingStatus();
    const state = typeof computePerformanceState === "function" ? computePerformanceState() : null;
    const mono = typeof computeMonotonyStrainSeries === "function" ? computeMonotonyStrainSeries() : null;
    const series = typeof computeLoadSeries === "function" ? (computeLoadSeries() || []) : [];
    const tail = series.slice(-182).filter((_, i, a) => i % 7 === (a.length - 1) % 7);
    return {
      title: "Trainingsstatus", value: `${st.icon} ${st.label}`, lead: st.desc,
      items: state ? [ctlRampItem(state), tsbItem(state.tsb), acwrItem(state.acwr), mono && mono.length ? monotonyItem(mono[mono.length - 1].monotony) : null].filter(Boolean) : [],
      empty: state ? "" : "Dafür braucht es ein paar Wochen Trainingsdaten mit Trainingsbelastung.",
      history: { title: "Fitness (CTL), letzte 6 Monate", unit: "", dec: 0,
        points: tail.map(s => ({ date: new Date(s.day * IR_DAY_MS), value: s.ctl, label: new Date(s.day * IR_DAY_MS).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) })) },
      source: "Der Status fasst Fitness-Entwicklung, Form und Belastungsverhältnis zusammen (ähnlich wie Garmin).",
    };
  }

  if (key === "streak") {
    const streak = typeof computeAdherenceStreak === "function" ? computeAdherenceStreak() : null;
    const days = streak ? streak.days : 0;
    return {
      title: "Trainingsplan-Treue-Streak", value: `🔥 ${days} ${days === 1 ? "Tag" : "Tage"}`,
      items: [irBandItem({
        label: "Serie", value: days, valueText: `${days} ${days === 1 ? "Tag" : "Tage"}`,
        bands: [[0, 3, "ok", "Start"], [3, 14, "good", "gut"], [14, 60, "great", "sehr stark"]],
        fmt: x => `${irFmt(x, 0)} T.`, span: (lo, hi) => `${irFmt(lo, 0)}–${irFmt(hi - 1, 0)} T.`,
        explain: "Zählt die Tage in Folge, an denen du deinen Plan eingehalten hast – Trainingstage mit Training und Ruhetage mit Ruhe. Ein freier Tag laut Plan bricht die Serie also nicht.",
        tip: () => "Die Serie ist ein Motivationshelfer. Wichtiger als eine lange Serie: auf den Körper hören – ein Ruhetag bei Müdigkeit ist richtig.",
      })],
      history: null,
    };
  }

  if (key === "count" || key === "time") {
    const isTime = key === "time";
    const valueOf = isTime ? (w => (w.duration_min || 0) / 60) : (() => 1);
    const avg = irWeeklyAverages(all, valueOf);
    const dec = isTime ? 1 : 1;
    const unit = isTime ? "h" : "";
    const items = [];
    const target = isTime ? profile.weeklyHours : profile.trainingDaysPerWeek;
    if (target > 0) {
      items.push(irPlanItem({
        label: isTime ? "Trainingszeit pro Woche" : "Einheiten pro Woche", value: avg.recent, target,
        valueText: `${irFmt(avg.recent, 1)} ${isTime ? "h" : "Einheiten"} (Ø 4 Wochen)`,
        targetText: isTime ? `${irFmt(target, 1)} h pro Woche` : `${target} Trainingstage pro Woche`,
        explain: isTime ? "Vergleicht deine durchschnittliche Trainingszeit der letzten 4 Wochen mit der Wochenzeit aus deinem Profil." : "Vergleicht, wie oft du in den letzten 4 Wochen pro Woche trainiert hast, mit deinen Trainingstagen aus dem Profil. Zwei Einheiten an einem Tag zählen hier doppelt.",
      }));
    }
    const cmp = irCompare(avg.recent, avg.before, { better: null, noise: Math.max(0.3, (avg.before || 0) * 0.1), dec, unit, baseText: avg.before != null ? `davor Ø ${irFmt(avg.before, 1)}${unit ? " " + unit : ""} pro Woche` : "" });
    items.push({
      label: "Entwicklung", valueText: `${irFmt(avg.recent, 1)}${unit ? " " + unit : ""} pro Woche`,
      verdict: "", level: "ok", scale: null,
      rangeText: avg.before == null ? "Für einen Vergleich fehlen noch ältere Daten." : "Ø der letzten 4 Wochen gegenüber den 12 Wochen davor",
      compare: cmp,
      explain: "Zeigt, ob du in letzter Zeit mehr oder weniger trainierst als vorher. Mehr ist nicht automatisch besser – wichtig ist ein langsamer, gleichmäßiger Aufbau (höchstens etwa 10 % pro Woche).",
      tip: target > 0 ? "" : `Trag in den Einstellungen ${isTime ? "deine Wochenstunden" : "deine Trainingstage pro Woche"} ein, dann bekommst du hier auch eine Bewertung gegen dein Ziel.`,
    });
    const weeks = irWeeklySeries(all, valueOf);
    return {
      title: isTime ? "Gesamtzeit" : "Trainingseinheiten",
      value: `${irFmt(avg.recent, 1)}${isTime ? " h" : ""} pro Woche`,
      items,
      history: { title: "Pro Woche, letzte 6 Monate", unit: isTime ? "h" : "Einheiten", dec: isTime ? 1 : 0,
        points: weeks.map(p => ({ date: p.date, value: p.value, label: weekLabel(p) })) },
      source: "Die Kachel selbst zeigt die Summe im gewählten Zeitraum, die Bewertung nutzt immer die letzten Wochen.",
    };
  }

  if (IR_SPORT_UNIT[key]) {
    const sport = key;
    const list = all.filter(w => w.sport === sport);
    const valueOf = w => w.distance_km || 0;
    const avg = irWeeklyAverages(list, valueOf);
    const dec = IR_SPORT_UNIT[sport][1];
    const items = [];
    if (list.length) items.push(irRegularityItem(sport, list));
    items.push({
      label: "Umfang pro Woche", valueText: `${irFmt(avg.recent, dec)} km (Ø 4 Wochen)`,
      verdict: "", level: "ok", scale: null,
      rangeText: avg.before == null ? "Für einen Vergleich fehlen noch ältere Daten." : "Ø der letzten 4 Wochen gegenüber den 12 Wochen davor",
      compare: irCompare(avg.recent, avg.before, { better: null, noise: Math.max(sport === "Schwimmen" ? 0.2 : 1, (avg.before || 0) * 0.1), dec, unit: "km",
        baseText: avg.before != null ? `davor Ø ${irFmt(avg.before, dec)} km pro Woche` : "" }),
      explain: sport === "Laufen"
        ? "Beim Laufen ist der Körper (Sehnen, Knochen) am empfindlichsten. Steigere den Wochenumfang langsam – höchstens etwa 10 % pro Woche."
        : sport === "Rad" ? "Auf dem Rad kannst du am meisten Ausdauer mit wenig Verletzungsrisiko sammeln – der Umfang darf hier am stärksten wachsen."
        : "Beim Schwimmen zählt Regelmäßigkeit mehr als Kilometer: 2–3 Einheiten pro Woche halten Technik und Wassergefühl.",
      tip: "",
    });
    const weeks = irWeeklySeries(list, valueOf);
    return {
      title: sport, value: `${irFmt(avg.recent, dec)} km pro Woche`, items,
      history: { title: "Kilometer pro Woche, letzte 6 Monate", unit: "km", dec,
        points: weeks.map(p => ({ date: p.date, value: p.value, label: `${weekLabel(p)} · ${p.sessions} ${p.sessions === 1 ? "Einheit" : "Einheiten"}` })) },
      source: "Die Kachel selbst zeigt die Summe im gewählten Zeitraum, die Bewertung nutzt immer die letzten Wochen.",
    };
  }
  return null;
}

// Kurze Bewertung für die Kachel selbst (Chip), sonst null.
function statTileRating(key) {
  if (key !== "vo2run" && key !== "vo2bike") return null;
  const profile = (typeof athleteProfile !== "undefined" && athleteProfile) || {};
  const est = (key === "vo2run" ? computeRunVo2MaxEstimate : computeBikeVo2MaxEstimate)();
  if (!est) return null;
  const age = typeof getAthleteAge === "function" ? getAthleteAge() : profile.age;
  const norm = vo2NormBands(age, profile.gender);
  if (!norm) return null;
  const b = miBand(norm.bands, est.value);
  return { level: b[2], word: b[3] };
}
