// Energie & Bedarf (Ernährung, js/components/energy.js): Kalorienverbrauch je
// Tag, Durchschnitte, Verlauf, Energiebilanz aus dem Gewichtsverlauf und
// Kennzahlen. Reine Rechenfunktionen ohne DOM - Eingaben werden übergeben,
// damit alles per node --test prüfbar ist (tests/js/energy.test.js).
//
// Quellen je Tag:
//  - Garmin (Tageszusammenfassung, tools/garmin_sync.py): kcal_total,
//    kcal_bmr (Grundumsatz), kcal_active (Aktivität inkl. Training).
//  - Sonst eigene Schätzung: Grundumsatz (Mifflin-St Jeor mit Größe, sonst
//    Henry/Oxford nur mit Gewicht) + Alltag (Schritte bzw. Pauschale)
//    + Training (kcal der Einheit bzw. MET-Schätzung).
// Der heutige Tag ist noch nicht vorbei: er zählt nie in Durchschnitte.

const KCAL_PER_KG_FAT = 7700;        // Faustwert: 1 kg Körpergewicht ≈ 7.700 kcal
const ENERGY_KCAL_PER_STEP_KG = 0.0005; // Gehen: ≈ 0,5 kcal je kg und km bei ≈ 1.000 Schritten/km (70 kg: 0,035 kcal/Schritt)
const ENERGY_REST_ALLTAG = 0.25;     // ohne Schritte: Bewegung im Alltag ≈ 25 % des Grundumsatzes
const ENERGY_TEF = 0.10;             // Verdauung ≈ 10 % des GESAMTverbrauchs (Thermic Effect of Food)
// MET-Werte (Compendium of Physical Activities), nur wenn eine Einheit keine kcal hat
const ENERGY_MET = { Laufen: 10, Rad: 8, Schwimmen: 8, Kraft: 5, Mobility: 2.5, Sonstiges: 5 };
const ENERGY_INTENSITY_FACTOR = { leicht: 0.85, mittel: 1, hart: 1.15 };

// Datum "YYYY-MM-DD" + n Tage (rechnet in UTC, damit Sommerzeit nichts verschiebt)
function energyAddDays(ds, n) {
  const d = new Date(ds + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function energyDaysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

function energyAge(birthDate, today) {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age--;
  return age > 0 && age < 120 ? age : null;
}

// Grundumsatz (BMR) aus Körperdaten - { kcal, method } oder null.
function bmrEstimate({ weightKg, heightCm, age, gender }) {
  const w = Number(weightKg);
  if (!w || w < 30 || w > 250) return null;
  const a = age || 35;
  // ohne Angabe/divers: Mittelwert aus der Formel für Männer und Frauen
  const mix = gender === "m" ? 1 : gender === "w" ? 0 : 0.5;
  const h = Number(heightCm);
  if (h && h > 120 && h < 230) {
    const kcal = 10 * w + 6.25 * h - 5 * a + mix * 5 + (1 - mix) * -161;
    return { kcal: Math.round(kcal), method: "Mifflin-St Jeor" };
  }
  // Henry (2005, "Oxford"): nur Gewicht, je Alter und Geschlecht
  const m = a < 30 ? [16.0, 545] : a < 60 ? [14.2, 593] : [13.5, 514];
  const f = a < 30 ? [13.1, 558] : a < 60 ? [9.74, 694] : [10.1, 569];
  const kcal = mix * (m[0] * w + m[1]) + (1 - mix) * (f[0] * w + f[1]);
  return { kcal: Math.round(kcal), method: "Henry (nur Gewicht)" };
}

function energySportKey(sport) {
  const s = String(sport || "");
  if (/lauf|run/i.test(s)) return "Laufen";
  if (/rad|bike|cycl|rolle/i.test(s)) return "Rad";
  if (/schwimm|swim/i.test(s)) return "Schwimmen";
  if (/kraft|strength/i.test(s)) return "Kraft";
  if (/mobil|yoga|dehn/i.test(s)) return "Mobility";
  return "Sonstiges";
}

// Brutto-kcal einer erledigten Einheit: vom Gerät, sonst MET × kg × Stunden.
function workoutKcal(w, weightKg) {
  if (w && w.calories > 0) return { kcal: w.calories, estimated: false };
  const min = Number(w && w.duration_min) || 0;
  if (!min || !weightKg) return { kcal: 0, estimated: true };
  return { kcal: Math.round(ENERGY_MET[energySportKey(w.sport)] * weightKg * min / 60), estimated: true };
}

// Erledigte Einheiten je Tag: { "YYYY-MM-DD": { kcal, minutes, steps, count } }
function energyWorkoutsByDay(workouts, weightKg) {
  const out = {};
  (workouts || []).forEach(w => {
    if (!w || w.is_summary || !w.date) return;
    const ds = w._date instanceof Date && !isNaN(w._date) ? localDateStr(w._date) : String(w.date).slice(0, 10);
    const e = out[ds] || (out[ds] = { kcal: 0, minutes: 0, steps: 0, count: 0 });
    e.kcal += workoutKcal(w, weightKg).kcal;
    e.minutes += Number(w.duration_min) || 0;
    e.steps += Number(w.total_steps) || 0;
    e.count += 1;
  });
  return out;
}

// Gewicht an einem Tag: letzter Eintrag bis dahin (sonst der erste bekannte).
function energyWeightAt(weights, ds, fallback) {
  let kg = null;
  for (const e of weights || []) {
    if (e.date <= ds) kg = e.weightKg; else break;
  }
  if (kg == null && weights && weights.length) kg = weights[0].weightKg;
  return kg || fallback || null;
}

// Ein Tag: { date, total, bmr, alltag, training, source, partial, trainingMin }.
// Garmin-Werte haben Vorrang; der Trainingsanteil kommt aus den Einheiten
// (netto, also ohne den Grundumsatz, der in der Zeit ohnehin angefallen wäre).
function energyDay(ds, ctx) {
  const wl = (ctx.wellness || {})[ds] || {};
  const wk = (ctx.byDay || {})[ds] || { kcal: 0, minutes: 0, steps: 0, count: 0 };
  const kg = energyWeightAt(ctx.weights, ds, ctx.profile && ctx.profile.weightKg);
  const est = bmrEstimate({ weightKg: kg, heightCm: ctx.profile && ctx.profile.heightCm, age: ctx.age, gender: ctx.profile && ctx.profile.gender });
  const partial = ds === ctx.today;
  const trainingNet = bmr => Math.max(0, Math.round(wk.kcal - (bmr / 1440) * wk.minutes));

  if (wl.kcal_total) {
    const bmr = wl.kcal_bmr || (wl.kcal_active != null ? Math.max(0, wl.kcal_total - wl.kcal_active) : null) || (est && est.kcal) || 0;
    const active = Math.max(0, wl.kcal_total - bmr);
    const training = Math.min(active, trainingNet(bmr));
    return { date: ds, total: Math.round(wl.kcal_total), bmr: Math.round(bmr), alltag: Math.round(active - training), training,
      source: "garmin", partial, trainingMin: Math.round(wk.minutes), weightKg: kg };
  }
  if (!est) return null;
  const bmr = est.kcal;
  const training = trainingNet(bmr);
  const steps = Number(wl.steps) || 0;
  // Bewegung im Alltag: aus den Schritten (ohne die beim Laufen), sonst Pauschale
  const move = steps ? Math.max(0, steps - wk.steps) * kg * ENERGY_KCAL_PER_STEP_KG : ENERGY_REST_ALLTAG * bmr;
  // Verdauung ist ein Anteil am Gesamtverbrauch: gesamt = (Rest) / (1 − 10 %)
  const tef = (bmr + move + training) * ENERGY_TEF / (1 - ENERGY_TEF);
  const alltag = Math.round(move + tef);
  return { date: ds, total: bmr + alltag + training, bmr, alltag, training, source: "estimate", partial,
    trainingMin: Math.round(wk.minutes), weightKg: kg };
}

// Alle Tage von `from` bis `to`. Tage vor den ersten Daten (Training oder
// Garmin) werden weggelassen - dort gäbe es nur einen geratenen Grundumsatz.
function energySeries(ctx, from, to) {
  const known = Object.keys(ctx.wellness || {}).concat(Object.keys(ctx.byDay || {})).sort();
  if (!known.length) return [];
  const start = known[0] > from ? known[0] : from;
  const out = [];
  for (let ds = start; ds <= to; ds = energyAddDays(ds, 1)) {
    const d = energyDay(ds, ctx);
    if (d) out.push(d);
  }
  return out;
}

const energyAvg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

// Durchschnitt über die letzten `days` vollständigen Tage vor `today`.
function energyWindow(series, today, days, offset = 0) {
  const to = energyAddDays(today, -1 - offset), from = energyAddDays(today, -days - offset);
  return series.filter(d => !d.partial && d.date >= from && d.date <= to);
}

function energyWindowStats(list) {
  if (!list.length) return null;
  const rest = list.filter(d => d.trainingMin < 15), train = list.filter(d => d.trainingMin >= 15);
  const r = x => (x == null ? null : Math.round(x));
  return {
    days: list.length,
    total: r(energyAvg(list.map(d => d.total))),
    bmr: r(energyAvg(list.map(d => d.bmr))),
    alltag: r(energyAvg(list.map(d => d.alltag))),
    training: r(energyAvg(list.map(d => d.training))),
    restDay: r(energyAvg(rest.map(d => d.total))), restDays: rest.length,
    trainDay: r(energyAvg(train.map(d => d.total))), trainDays: train.length,
    garminShare: list.filter(d => d.source === "garmin").length / list.length,
    trainingHours: list.reduce((a, d) => a + d.trainingMin, 0) / 60,
    trainingKcal: list.reduce((a, d) => a + d.training, 0),
  };
}

// Ø 7/30/90 Tage + Vergleich der letzten 30 Tage mit den 30 davor.
function energyStats(series, today) {
  const w7 = energyWindowStats(energyWindow(series, today, 7));
  const w30 = energyWindowStats(energyWindow(series, today, 30));
  const w90 = energyWindowStats(energyWindow(series, today, 90));
  const prev30 = energyWindowStats(energyWindow(series, today, 30, 30));
  const trend = w30 && prev30 && w30.days >= 14 && prev30.days >= 14
    ? { deltaKcal: w30.total - prev30.total, deltaPct: (w30.total - prev30.total) / prev30.total * 100,
        trainingDeltaH: w30.trainingHours - prev30.trainingHours }
    : null;
  return { w7, w30, w90, prev30, trend };
}

// Monatsmittel (z. B. 12 Monate): [{ month: "YYYY-MM", total, bmr, alltag, training, days }]
function energyMonthly(series, months = 12) {
  const by = {};
  series.filter(d => !d.partial).forEach(d => { (by[d.date.slice(0, 7)] = by[d.date.slice(0, 7)] || []).push(d); });
  return Object.keys(by).sort().slice(-months).map(m => {
    const list = by[m], r = k => Math.round(energyAvg(list.map(d => d[k])));
    return { month: m, total: r("total"), bmr: r("bmr"), alltag: r("alltag"), training: r("training"), days: list.length };
  });
}

// Geglätteter Gewichtstrend (exponentiell, 10 % je Tag - Wassereinlagerungen
// und Tagesschwankungen fallen so kaum ins Gewicht). Lücken: Trend bleibt stehen.
function weightTrendSeries(weights, from, to) {
  const sorted = (weights || []).filter(e => e && e.weightKg > 0).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return [];
  const byDate = Object.fromEntries(sorted.map(e => [e.date, e.weightKg]));
  let trend = null;
  const out = [];
  for (let ds = sorted[0].date; ds <= to; ds = energyAddDays(ds, 1)) {
    const raw = byDate[ds];
    if (raw != null) trend = trend == null ? raw : trend + 0.1 * (raw - trend);
    if (ds >= from) out.push({ date: ds, raw: raw ?? null, trend: Math.round(trend * 100) / 100 });
  }
  return out;
}

// Energiebilanz aus dem Gewichtstrend der letzten `days` Tage:
// Abnahme = Defizit, Zunahme = Überschuss. Braucht mind. 3 Wiegungen,
// die mind. halb so lang auseinanderliegen wie der Zeitraum.
function energyBalance(series, weights, today, days = 28) {
  const from = energyAddDays(today, -days), to = energyAddDays(today, -1);
  const inWin = (weights || []).filter(e => e.date >= from && e.date <= today);
  if (inWin.length < 3 || energyDaysBetween(inWin[0].date, inWin[inWin.length - 1].date) < days / 2) return null;
  const trend = weightTrendSeries(weights, from, today);
  if (trend.length < 2) return null;
  const startKg = trend[0].trend, endKg = trend[trend.length - 1].trend;
  const span = energyDaysBetween(trend[0].date, trend[trend.length - 1].date) || 1;
  const deltaKg = endKg - startKg;
  const expList = series.filter(d => !d.partial && d.date >= from && d.date <= to);
  if (expList.length < days / 2) return null;
  const expenditure = Math.round(energyAvg(expList.map(d => d.total)));
  const balance = Math.round(deltaKg * KCAL_PER_KG_FAT / span);
  return {
    days, weighIns: inWin.length, startKg, endKg, deltaKg: Math.round(deltaKg * 100) / 100,
    kgPerWeek: Math.round(deltaKg / span * 7 * 100) / 100,
    balance,                          // kcal/Tag: + Überschuss, − Defizit
    expenditure,                      // Ø Verbrauch = Bedarf zum Halten
    intake: expenditure + balance,    // so viel wurde im Schnitt ungefähr gegessen
    garminShare: expList.filter(d => d.source === "garmin").length / expList.length,
  };
}

// Kcal einer GEPLANTEN Einheit: aus deinen eigenen Einheiten derselben
// Sportart (kcal pro Minute, Median der letzten 120 Tage), sonst MET.
function plannedWorkoutKcal(pw, workouts, weightKg, today) {
  const min = Number(pw && pw.duration_min) || 0;
  if (!min) return null;
  const key = energySportKey(pw.sport);
  const since = energyAddDays(today, -120);
  const rates = (workouts || []).filter(w => w && !w.is_summary && w.calories > 0 && w.duration_min >= 10
    && energySportKey(w.sport) === key && String(w.date).slice(0, 10) >= since).map(w => w.calories / w.duration_min).sort((a, b) => a - b);
  const factor = ENERGY_INTENSITY_FACTOR[pw.intensity] || 1;
  if (rates.length >= 3) {
    const med = rates[Math.floor(rates.length / 2)];
    return { kcal: Math.round(med * min * factor), basis: "history", samples: rates.length };
  }
  if (!weightKg) return null;
  return { kcal: Math.round(ENERGY_MET[key] * weightKg * min / 60 * factor), basis: "met", samples: 0 };
}

// Prognose für heute: Ø Grundumsatz + Alltag (letzte 30 Tage) + geplantes Training (netto).
function energyTodayForecast(stats, planned, workouts, weightKg, today) {
  const base = stats && (stats.w30 || stats.w7);
  if (!base) return null;
  const todays = (planned || []).filter(p => p.date === today && (p.status || "geplant") === "geplant");
  const items = todays.map(p => {
    const k = plannedWorkoutKcal(p, workouts, weightKg, today);
    return k ? { id: p.id, sport: p.sport, title: p.title || p.sport, minutes: p.duration_min,
      kcal: Math.max(0, Math.round(k.kcal - base.bmr / 1440 * p.duration_min)), basis: k.basis } : null;
  }).filter(Boolean);
  const training = items.reduce((a, i) => a + i.kcal, 0);
  return { bmr: base.bmr, alltag: base.alltag, training, total: base.bmr + base.alltag + training, items };
}

// Aktivitätslevel (PAL = Verbrauch ÷ Grundumsatz), Einteilung nach FAO/WHO.
function palCategory(pal) {
  if (!pal) return null;
  if (pal < 1.4) return { label: "kaum aktiv", level: "low" };
  if (pal < 1.7) return { label: "leicht aktiv", level: "mid" };
  if (pal < 2.0) return { label: "aktiv", level: "good" };
  if (pal < 2.4) return { label: "sehr aktiv", level: "good" };
  return { label: "extrem aktiv", level: "high" };
}

function bmiCategory(bmi) {
  if (!bmi) return null;
  if (bmi < 18.5) return "Untergewicht";
  if (bmi < 25) return "Normalgewicht";
  if (bmi < 30) return "Übergewicht";
  return "Adipositas";
}

// Kennzahlen für die Kachel "Kennzahlen".
function energyKeyFigures(stats, profile, weightKg, bodyFatPct, today) {
  const base = stats && (stats.w30 || stats.w7);
  const h = Number(profile && profile.heightCm);
  const bmi = weightKg && h > 120 ? weightKg / ((h / 100) ** 2) : null;
  const pal = base && base.bmr ? base.total / base.bmr : null;
  const ffm = weightKg && bodyFatPct > 3 && bodyFatPct < 60 ? weightKg * (1 - bodyFatPct / 100) : null;
  const est = bmrEstimate({ weightKg, heightCm: h, age: energyAge(profile && profile.birthDate, today), gender: profile && profile.gender });
  return {
    bmr: base ? base.bmr : est && est.kcal,
    bmrSource: base && base.garminShare >= 0.5 ? "garmin" : est ? est.method : null,
    pal: pal ? Math.round(pal * 100) / 100 : null, palCategory: palCategory(pal),
    kcalPerKg: base && weightKg ? Math.round(base.total / weightKg) : null,
    bmi: bmi ? Math.round(bmi * 10) / 10 : null, bmiCategory: bmiCategory(bmi),
    bodyFatPct: ffm ? bodyFatPct : null, leanKg: ffm ? Math.round(ffm * 10) / 10 : null,
    kcalPerTrainingHour: base && base.trainingHours >= 1 ? Math.round(base.trainingKcal / base.trainingHours) : null,
    trainingShare: base && base.total ? Math.round(base.training / base.total * 100) : null,
  };
}
