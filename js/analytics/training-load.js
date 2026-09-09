// Trainingsbelastung: CTL/ATL/TSB (PMC) und ACWR-Zeitreihen. Reine Berechnung, kein UI.

function computeLoadSeries() {
  const pts = DATA.filter(w => w._date && w.training_load != null).sort((a, b) => a._date - b._date);
  const dayMs = 86400000;
  const dayKey = d => Math.floor(d.getTime() / dayMs);

  const byDay = new Map();
  pts.forEach(p => { const k = dayKey(p._date); byDay.set(k, (byDay.get(k) || 0) + p.training_load); });
  if (byDay.size === 0) return null;

  const firstDay = Math.min(...byDay.keys());
  const lastDay = Math.max(...byDay.keys());
  const days = [];
  for (let d = firstDay; d <= lastDay; d++) days.push(d);

  let ctl = 0, atl = 0;
  return days.map(d => {
    const load = byDay.get(d) || 0;
    const tsb = ctl - atl;
    ctl = ctl + (load - ctl) / 42;
    atl = atl + (load - atl) / 7;
    return { day: d, load, ctl, atl, tsb };
  });
}

/* Trainingsmonotonie/-Strain nach Foster (1998, "Monitoring Training in
   Athletes with Reference to Overtraining Syndrome"): pro Tag wird über ein
   rollierendes 7-Tage-Fenster (dieser Tag + die 6 davor) berechnet:
     Monotonie = Ø Tagesbelastung ÷ Standardabweichung der Tagesbelastung
     Strain    = Monotonie × Wochen-Gesamtbelastung (Summe der 7 Tage)
   Hohe Monotonie (>2,0 laut Literatur) bedeutet: sehr gleichmäßige Belastung
   ohne echte Erholungstage dazwischen - das erhöhte Übertrainings-/
   Verletzungsrisiko kommt hier NICHT aus der absoluten Belastungshöhe
   (das deckt ACWR/CTL/ATL bereits ab), sondern aus der fehlenden Varianz. */
function computeMonotonyStrainSeries() {
  const pts = DATA.filter(w => w._date && w.training_load != null).sort((a, b) => a._date - b._date);
  const dayMs = 86400000;
  const dayKey = d => Math.floor(d.getTime() / dayMs);

  const byDay = new Map();
  pts.forEach(p => { const k = dayKey(p._date); byDay.set(k, (byDay.get(k) || 0) + p.training_load); });
  if (byDay.size === 0) return null;

  const firstDay = Math.min(...byDay.keys());
  const lastDay = Math.max(...byDay.keys());
  const loads = [];
  for (let d = firstDay; d <= lastDay; d++) loads.push(byDay.get(d) || 0);
  if (loads.length < 7) return null; // erste volle 7-Tage-Fenster noch nicht erreicht

  const series = [];
  for (let i = 6; i < loads.length; i++) {
    const week = loads.slice(i - 6, i + 1);
    const mean = week.reduce((a, b) => a + b, 0) / 7;
    const variance = week.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / 7;
    const sd = Math.sqrt(variance);
    // sd=0 (jeden Tag exakt gleiche Belastung, inkl. 0) ist rechnerisch
    // "unendlich monoton" - als Obergrenze gedeckelt statt Infinity anzuzeigen.
    const monotony = sd > 0 ? mean / sd : (mean > 0 ? 6 : 0);
    const weekLoad = week.reduce((a, b) => a + b, 0);
    series.push({ day: firstDay + i, monotony, strain: monotony * weekLoad, weekLoad });
  }
  return series;
}

/* ---------- Status-Texte (TSB/ACWR/Monotonie) ---------- */

// Dieselbe Einordnung wie die jeweilige Status-Badge im Dashboard
// (renderPMC/renderMonotony in js/components/dashboard.js) UND der KI-Kontext
// (js/ai/context-builder.js) nutzen - eine Berechnung, mehrere Anzeigeorte
// (AI_RULES Regel 5), statt dass das LLM die Schwellenwerte selbst rät.
function tsbStatusLabel(tsb) {
  if (tsb == null) return null;
  if (tsb < -30) return { cls: "risk", text: "hohes Übertrainingsrisiko" };
  if (tsb < -10) return { cls: "watch", text: "ermüdet – im Trainingsaufbau normal" };
  if (tsb > 15) return { cls: "ok", text: "sehr frisch (evtl. Tapering-Bereich)" };
  return { cls: "ok", text: "frisch / gut erholt" };
}

// Dieselben Bänder wie das ACWR-Gauge (renderACWR) und der Race-Readiness-
// Faktor (scoreAcwrFactor in dashboard.js).
function acwrStatusLabel(acwr) {
  if (acwr == null) return null;
  if (acwr > 1.5) return { cls: "risk", text: "hohes Verletzungsrisiko" };
  if (acwr > 1.3) return { cls: "watch", text: "erhöhtes Risiko" };
  if (acwr >= 0.8) return { cls: "ok", text: "optimaler Bereich" };
  return { cls: "watch", text: "Aufbauphase, noch wenig Belastung" };
}

function monotonyStatusLabel(monotony) {
  if (monotony == null) return null;
  if (monotony >= 2.0) return { cls: "risk", text: "auffällig monoton — mehr Abwechslung/Erholungstage einplanen" };
  if (monotony >= 1.5) return { cls: "watch", text: "grenzwertig — im Auge behalten" };
  return { cls: "ok", text: "unauffällig" };
}

/* ---------- Aktueller Leistungszustand (Kurzverdikt für Coach-Tab) ---------- */

// Fasst Fitness-Trend (CTL über die letzten 4 Wochen), Form (TSB) und
// Verletzungsrisiko (ACWR) zu EINEM präzisen Kurzverdikt zusammen - für die
// Leistungszustand-Kachel im Coach-Tab (renderCoachSummary(), coach.js).
// Reine Ableitung aus den bereits vorhandenen PMC-Werten (computeLoadSeries)
// und denselben Schwellenwerten wie tsbStatusLabel()/acwrStatusLabel() weiter
// oben - keine neue Berechnung, keine neue Datenquelle (AI_RULES Regel 5:
// "Analytics feed AI/UI, nie zweimal dieselbe Zahl anders herleiten").
function computePerformanceState() {
  const series = computeLoadSeries();
  if (!series || !series.length) return null;
  const last = series[series.length - 1];

  // CTL vor ca. 4 Wochen (28 Tage) für den Fitness-Trend - fällt bei
  // kürzerer Historie auf den ältesten verfügbaren Punkt zurück, statt
  // NaN/undefined zu produzieren.
  const target = last.day - 28;
  let prev = series[0];
  for (const p of series) { if (p.day <= target) prev = p; else break; }
  const ctlDelta = last.ctl - prev.ctl;

  const acwr = last.ctl > 0.5 ? last.atl / last.ctl : null;
  const acwrStatus = acwrStatusLabel(acwr);
  const tsbStatus = tsbStatusLabel(last.tsb);

  // Verletzungsrisiko/Übertraining haben Vorrang vor der Fitness-Story -
  // ein hohes ACWR bzw. sehr negatives TSB soll nicht von "Fitness steigt"
  // überdeckt werden.
  let verdict, cls;
  if (acwr != null && acwr > 1.5) { verdict = "Erhöhtes Verletzungsrisiko"; cls = "risk"; }
  else if (last.tsb < -30) { verdict = "Übertrainingsrisiko"; cls = "risk"; }
  else if ((acwr != null && acwr > 1.3) || last.tsb < -10) { verdict = "Ermüdet – Belastung im Auge behalten"; cls = "watch"; }
  else if (last.tsb > 15) { verdict = "Sehr frisch / Tapering-Bereich"; cls = "ok"; }
  else if (ctlDelta > 3) { verdict = "Im Aufbau"; cls = "ok"; }
  else if (ctlDelta < -3) { verdict = "Fitness sinkt"; cls = "watch"; }
  else { verdict = "Stabil"; cls = "ok"; }

  return { verdict, cls, ctl: last.ctl, ctlDelta, tsb: last.tsb, tsbStatus, acwr, acwrStatus };
}

/* ---------- Trainingsstatus (Garmin-Connect-artige Einordnung) ---------- */

// Fasst Fitness-Trend (CTL-Verlauf), Form (TSB) und Belastungsverhältnis
// (ACWR) zu EINER von 5 Kategorien zusammen, angelehnt an Garmin Connects
// "Trainingsstatus": Formaufbau, Formerhalt, Erholung, Übertraining,
// Formverlust. Reine Ableitung aus computePerformanceState() (ctlDelta/tsb/
// acwr) - KEINE neue Berechnung/Datenquelle (AI_RULES Regel 5), nur eine
// andere Einordnung derselben drei Werte für die Kachel ganz oben im
// Übersicht-Tab (renderTrainingStatus(), js/components/dashboard.js).
//
// Priorität (wie computePerformanceState()): Risiko zuerst, dann Erholung,
// dann Fitness-Trend, mit "Formerhalt" als neutralem Standardfall.
const TRAINING_STATUS_DEFS = {
  uebertraining: { label: "Übertraining", icon: "⚠️", cls: "risk", desc: "Belastung liegt deutlich über dem verträglichen Bereich — erhöhtes Verletzungs-/Übertrainingsrisiko. Entlastung oder Ruhetag einplanen." },
  erholung:      { label: "Erholung", icon: "😌", cls: "recovery", desc: "Belastung ist bewusst reduziert, die Form erholt sich gerade." },
  formverlust:   { label: "Formverlust", icon: "📉", cls: "watch", desc: "Belastung liegt seit längerem zu niedrig — die aufgebaute Fitness sinkt." },
  formaufbau:    { label: "Formaufbau", icon: "📈", cls: "good", desc: "Fitness steigt bei angemessener Belastung — guter, produktiver Trainingsreiz." },
  formerhalt:    { label: "Formerhalt", icon: "⚖️", cls: "good", desc: "Belastung und Form sind stabil, weder deutlicher Auf- noch Abbau." },
  unklar:        { label: "Noch keine Einordnung", icon: "❔", cls: "muted", desc: "Dafür werden mehr Trainingsdaten benötigt (mindestens ein paar Wochen Historie)." },
};

function computeTrainingStatus() {
  const state = computePerformanceState();
  if (!state) return { key: "unklar", ...TRAINING_STATUS_DEFS.unklar, ctlDelta: null, tsb: null, acwr: null };

  const { ctlDelta, tsb, acwr } = state;
  let key;
  if ((acwr != null && acwr > 1.5) || tsb < -30) key = "uebertraining";
  else if (tsb > 10 && ctlDelta <= 2) key = "erholung";
  else if (ctlDelta < -3 && (acwr == null || acwr < 0.8)) key = "formverlust";
  else if (ctlDelta > 2 && acwr != null && acwr >= 0.8 && acwr <= 1.3) key = "formaufbau";
  else key = "formerhalt";

  return { key, ...TRAINING_STATUS_DEFS[key], ctlDelta, tsb, acwr };
}

/* ---------- Monatsvergleich (aktueller vs. vorheriger Kalendermonat) ---------- */

// Vergleicht den aktuellen Kalendermonat (Tag 1 bis heute) mit demselben
// Tage-Abschnitt des Vormonats (Tag 1 bis zum selben Tag-im-Monat, gekappt
// auf die tatsächliche Länge des Vormonats) - so wird nicht ein voller
// Vormonat mit einem noch unvollständigen aktuellen Monat verglichen.
// Nutzt immer die volle Historie (ALL/DATA), unabhängig vom Zeitraum-Filter.
function computeMonthComparison() {
  const now = new Date();
  const curStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const dayOfMonth = now.getDate();
  const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  const clampedDay = Math.min(dayOfMonth, prevMonthLastDay);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const prevEnd = new Date(now.getFullYear(), now.getMonth() - 1, clampedDay, 23, 59, 59, 999);

  const inRange = (w, start, end) => w._date && w._date >= start && w._date <= end;
  const summarize = arr => ({
    count: arr.length,
    minutes: arr.reduce((s, w) => s + (w.duration_min || 0), 0),
    load: arr.reduce((s, w) => s + (w.training_load || 0), 0),
  });

  const current = summarize(DATA.filter(w => inRange(w, curStart, now)));
  const previous = summarize(DATA.filter(w => inRange(w, prevStart, prevEnd)));
  return { current, previous, dayOfMonth: clampedDay, monthLabel: MONTH_NAMES_DE[now.getMonth()], prevMonthLabel: MONTH_NAMES_DE[(now.getMonth() + 11) % 12] };
}


/* ---------- Trainingsbelastungsfokus: Ist vs. Soll (fuer KI-Auswertung) ---------- */

// Grobe, klar als Schaetzung gekennzeichnete Gewichtung je geplanter
// Intensitaet - geplante Einheiten haben (bewusst, siehe AI_RULES: "Nie
// einen exakten Trainingsload/TSS-Wert erfinden") KEIN training_load-Feld.
// Die Basis (Load pro Minute) kommt trotzdem aus echten Daten des Athleten
// selbst (Ø aus abgeschlossenen Einheiten), nur die relative Gewichtung
// zwischen leicht/mittel/hart ist eine dokumentierte Annahme - analog zum
// bereits genutzten Seiler-80/10/10-Richtwert (renderTrainingFocus,
// dashboard.js).
const FOCUS_INTENSITY_FACTOR = { leicht: 0.65, mittel: 1.0, hart: 1.4 };

// Vergleicht die tatsaechliche Belastung der letzten 7 Tage ("ist") mit der
// aus dem KI-Trainingsplan HOCHGERECHNETEN Belastung der naechsten 7 Tage
// ("soll") - reine Berechnung (AI_RULES: "Analytics fuettert KI, KI
// berechnet nicht"), die KI bekommt nur diese fertigen Zahlen zur
// sprachlichen Einordnung, erfindet selbst keine.
function computeFocusForecast() {
  const series = computeLoadSeries();
  const last = series && series.length ? series[series.length - 1] : null;
  const tsb = last ? last.tsb : null;
  const acwr = (last && last.ctl > 0.5) ? last.atl / last.ctl : null;

  const dayMs = 86400000;
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const weekAgo = new Date(todayMid.getTime() - 6 * dayMs);
  const weekAhead = new Date(todayMid.getTime() + 6 * dayMs);

  const istLoad = DATA
    .filter(w => w._date && w._date >= weekAgo && w._date <= new Date(todayMid.getTime() + dayMs - 1) && w.training_load != null)
    .reduce((s, w) => s + w.training_load, 0);

  // Ø Load/Minute aus allen abgeschlossenen Einheiten mit echtem Load-Wert -
  // ohne diese Basis (z.B. ganz neuer Nutzer ohne Historie) keine seriöse
  // Hochrechnung möglich, dann bleibt sollLoad null statt geraten.
  const withLoad = DATA.filter(w => w.training_load != null && w.duration_min);
  const avgLoadPerMin = withLoad.length
    ? withLoad.reduce((s, w) => s + w.training_load / w.duration_min, 0) / withLoad.length
    : null;

  const upcoming = plannedWorkouts.filter(pw => {
    if (pw.status !== "geplant" || !pw.date) return false;
    const d = new Date(pw.date + "T00:00:00");
    return d >= todayMid && d <= weekAhead;
  });

  const sollLoad = avgLoadPerMin != null
    ? upcoming.reduce((s, pw) => {
        const factor = FOCUS_INTENSITY_FACTOR[pw.intensity] || FOCUS_INTENSITY_FACTOR.mittel;
        return s + (pw.duration_min || 0) * factor * avgLoadPerMin;
      }, 0)
    : null;

  return {
    istLoad: Math.round(istLoad),
    sollLoad: sollLoad != null ? Math.round(sollLoad) : null,
    upcomingCount: upcoming.length,
    tsb, acwr,
    tsbStatus: tsbStatusLabel(tsb),
    acwrStatus: acwrStatusLabel(acwr),
    hasBaseline: avgLoadPerMin != null,
  };
}
