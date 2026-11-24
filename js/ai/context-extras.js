// Zusätzlicher KI-Kontext (3.0): fertig berechnete Fakten statt Rohdaten.
// Die KI soll einordnen, nicht rechnen - siehe docs/AI_CONTEXT.md.
//
//   ctxIntensityLine     tatsächliche Intensität aus dem Puls (nicht die geplanten Etiketten)
//   ctxAdherenceLine     Soll-Ist: geplant vs. gemacht (Dauer, zu hart gelaufen, übersprungen)
//   ctxTrendLine         7-Tage-Trends HRV, Ruhepuls, Schlaf, Stress gegen die eigenen 4 Wochen davor
//   ctxSpecialDaysLine   besondere Tage aus dem Lifestyle-Protokoll der Uhr (krank, Reise, Alkohol ...) + Zyklus
//   ctxGarminMetricsLine Kennwerte der Uhr (Belastung akut/chronisch, Fokus, Prognosen, Scores)
//   ctxRpeLine           gefühlte Anstrengung (RPE) der letzten Einheiten, mit Puls-Abgleich
//   ctxWeatherLine       Wetter-Vorhersage für das Planungsfenster
//   ctxMemoryLine        "Gedächtnis": Muster aus 90 Tagen (oft ausgelassene Tage, zu harte lockere Einheiten ...)
//   ctxLapsLine          Runden/Intervalle einer einzelnen Einheit
//
// Alle Funktionen sind rein (Daten als Parameter) und liefern "" ohne Daten.

const CTX_EASY_HRR = 0.70;   // bis 70 % der Herzfrequenzreserve = locker (Z1-Z2)
const CTX_HARD_HRR = 0.80;   // ab 80 % = hart (Z4-Z5)
const CTX_TOO_HARD_SHARE = 0.25; // eine "lockere" Einheit mit > 25 % der Zeit über Z2 war zu hart

function ctxDayKey(w) {
  if (w._date) return localDateStr(w._date);
  return String(w.date || "").slice(0, 10);
}
function ctxShift(key, n) {
  const d = new Date(key + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}
const ctxShort = key => { const d = new Date(key + "T00:00:00"); return `${d.getDate()}.${d.getMonth() + 1}.`; };
const ctxGroup = s => (typeof sportGroup === "function" ? sportGroup(s) : s);
const ctxPct = x => `${Math.round(x * 100)} %`;

// Zeit (Minuten) je Intensitätsband einer Einheit aus der Pulskurve:
// { easy, mid, hard, total } oder null ohne brauchbare Pulsdaten.
// Ohne Kurve zählt der Ø-Puls für die ganze Dauer.
function ctxHrBands(w, profile) {
  const max = profile && profile.maxHr, rest = profile && profile.restingHr;
  if (!max || !rest || max <= rest) return null;
  const hrr = max - rest;
  const band = hr => { const r = (hr - rest) / hrr; return r < CTX_EASY_HRR ? "easy" : r < CTX_HARD_HRR ? "mid" : "hard"; };
  const out = { easy: 0, mid: 0, hard: 0, total: 0 };
  const s = w.stream;
  if (s && Array.isArray(s.t) && Array.isArray(s.hr)) {
    // Üblicher Punktabstand (Median): deutlich größere Sprünge sind Pausen.
    const steps = [];
    for (let i = 1; i < s.t.length; i++) if (s.t[i] > s.t[i - 1]) steps.push(s.t[i] - s.t[i - 1]);
    steps.sort((a, b) => a - b);
    const maxStep = steps.length ? Math.max(60, steps[Math.floor(steps.length / 2)] * 3) : 0;
    for (let i = 1; i < s.t.length; i++) {
      if (s.hr[i] == null || s.hr[i - 1] == null) continue;
      const raw = s.t[i] - s.t[i - 1];
      if (!(raw > 0) || raw > maxStep) continue; // Pausen nicht mitzählen
      const dt = raw / 60;
      out[band((s.hr[i] + s.hr[i - 1]) / 2)] += dt;
      out.total += dt;
    }
  }
  if (out.total < 5 && w.avg_hr && w.duration_min) {
    const b = { easy: 0, mid: 0, hard: 0, total: w.duration_min };
    b[band(w.avg_hr)] = w.duration_min;
    return b;
  }
  return out.total >= 5 ? out : null;
}

function ctxIntensityLine(workouts, profile, todayKey, days = 28) {
  const since = ctxShift(todayKey, -days);
  const sum = { easy: 0, mid: 0, hard: 0, total: 0 }; let n = 0;
  (workouts || []).forEach(w => {
    const k = ctxDayKey(w);
    if (k < since || k > todayKey || w.is_summary || !["Schwimmen", "Rad", "Laufen"].includes(ctxGroup(w.sport))) return;
    const b = ctxHrBands(w, profile);
    if (!b) return;
    n++; ["easy", "mid", "hard", "total"].forEach(x => { sum[x] += b[x]; });
  });
  if (n < 3 || sum.total < 60) return "";
  const easy = sum.easy / sum.total;
  const verdict = easy >= 0.75 ? "passt zur 80/20-Regel" : easy >= 0.6 ? "etwas zu wenig locker" : "deutlich zu wenig locker - viele Einheiten im mittleren Bereich";
  return `Tatsächliche Intensität laut Puls (letzte ${days / 7} Wochen, ${n} Einheiten): ${ctxPct(easy)} locker (Z1-2), ${ctxPct(sum.mid / sum.total)} mittel (Z3), ${ctxPct(sum.hard / sum.total)} hart (Z4-5) - ${verdict}.`;
}

// Geplante Einheit -> echte Einheit am selben Tag in derselben Sportart.
function ctxMatchActual(p, workouts) {
  return (workouts || []).find(w => ctxDayKey(w) === p.date && ctxGroup(w.sport) === p.sport && !w.is_summary) || null;
}

// Soll-Ist der letzten `days` Tage. Ergebnis-Zeilen (0-2).
function ctxAdherenceLines(planned, workouts, profile, todayKey, days = 14) {
  const since = ctxShift(todayKey, -days);
  const past = (planned || []).filter(p => p.date >= since && p.date < todayKey && ["Schwimmen", "Rad", "Laufen", "Kraft", "Mobility"].includes(p.sport));
  if (past.length < 3) return [];
  let done = 0, skipped = 0, open = 0, durSum = 0, durN = 0;
  const tooHard = [], tooShort = [];
  past.forEach(p => {
    const actual = ctxMatchActual(p, workouts);
    if (p.status === "uebersprungen") { skipped++; return; }
    if (p.status !== "erledigt" && !actual) { open++; return; }
    done++;
    if (!actual || !p.duration_min || !actual.duration_min) return;
    const ratio = actual.duration_min / p.duration_min;
    durSum += ratio; durN++;
    if (ratio < 0.7) tooShort.push(`${ctxShort(p.date)} ${p.sport} ${Math.round(actual.duration_min)} statt ${Math.round(p.duration_min)} min`);
    if (p.intensity === "leicht") {
      const b = ctxHrBands(actual, profile);
      if (b && b.total && (b.mid + b.hard) / b.total > CTX_TOO_HARD_SHARE) tooHard.push(`${ctxShort(p.date)} ${p.sport} (${ctxPct((b.mid + b.hard) / b.total)} der Zeit über Z2)`);
    }
  });
  const lines = [];
  const bits = [`${past.length} geplant`, `${done} gemacht`];
  if (skipped) bits.push(`${skipped} übersprungen`);
  if (open) bits.push(`${open} ohne Eintrag`);
  if (durN) bits.push(`Dauer im Schnitt ${ctxPct(durSum / durN)} des Plans`);
  lines.push(`Soll-Ist (letzte ${days} Tage): ${bits.join(", ")}.`);
  const notes = [];
  if (tooHard.length) notes.push(`als "leicht" geplant, aber zu hart gelaufen: ${tooHard.slice(0, 4).join(", ")}`);
  if (tooShort.length) notes.push(`deutlich kürzer als geplant: ${tooShort.slice(0, 3).join(", ")}`);
  if (notes.length) lines.push(`Soll-Ist Auffälligkeiten: ${notes.join(" | ")}.`);
  return lines;
}

// Mittelwert eines Wellness-Felds über die Tage [from, to] (nur vorhandene Werte).
function ctxWellAvg(daily, field, from, to) {
  const vals = Object.entries(daily || {}).filter(([k, v]) => k >= from && k <= to && v && typeof v[field] === "number").map(([, v]) => v[field]);
  return vals.length ? { avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length } : null;
}

// Wie viele Tage in Folge (bis heute/gestern) ein Wert gefallen bzw. gestiegen ist.
function ctxStreak(daily, field, todayKey) {
  const keys = Object.keys(daily || {}).filter(k => k <= todayKey && daily[k] && typeof daily[k][field] === "number").sort().slice(-8);
  if (keys.length < 3 || keys[keys.length - 1] < ctxShift(todayKey, -1)) return 0;
  let dir = 0, n = 0;
  for (let i = keys.length - 1; i > 0; i--) {
    const d = Math.sign(daily[keys[i]][field] - daily[keys[i - 1]][field]);
    if (!d || (dir && d !== dir)) break;
    dir = d; n++;
  }
  return n >= 3 ? dir * n : 0;
}

function ctxTrendLine(daily, todayKey) {
  const recentFrom = ctxShift(todayKey, -6), baseFrom = ctxShift(todayKey, -34), baseTo = ctxShift(todayKey, -7);
  const defs = [
    ["hrv_ms", "HRV", v => `${Math.round(v)} ms`, true],
    ["resting_hr", "Ruhepuls", v => `${Math.round(v)}`, false],
    ["sleep_min", "Schlaf", v => `${fmtNum(v / 60, 1)} h`, true],
    ["stress_avg", "Stress", v => `${Math.round(v)}`, false],
  ];
  const bits = [];
  defs.forEach(([field, label, fmt]) => {
    const recent = ctxWellAvg(daily, field, recentFrom, todayKey), base = ctxWellAvg(daily, field, baseFrom, baseTo);
    if (!recent || recent.n < 3 || !base || base.n < 7) return;
    const delta = (recent.avg - base.avg) / base.avg;
    const streak = ctxStreak(daily, field, todayKey);
    const s = streak ? `, ${streak > 0 ? "steigt" : "fällt"} seit ${Math.abs(streak)} Tagen` : "";
    bits.push(`${label} Ø ${fmt(recent.avg)} (${delta >= 0 ? "+" : "−"}${Math.round(Math.abs(delta) * 100)} % ggü. den 4 Wochen davor${s})`);
  });
  return bits.length ? `Trend 7 Tage (Garmin): ${bits.join(" | ")}` : "";
}

function ctxSpecialDaysLine(daily, todayKey, days = 14) {
  const since = ctxShift(todayKey, -days);
  const bits = Object.keys(daily || {}).filter(k => k >= since && k <= todayKey).sort().reverse()
    .map(k => (Array.isArray(daily[k] && daily[k].special) && daily[k].special.length ? `${ctxShort(k)} ${daily[k].special.join(", ")}` : null))
    .filter(Boolean).slice(0, 8);
  const lines = [];
  if (bits.length) lines.push(`Besondere Tage laut Uhr (Lifestyle-Protokoll, letzte ${days} Tage): ${bits.join(" | ")}`);
  const cycleKey = Object.keys(daily || {}).filter(k => k >= ctxShift(todayKey, -2) && k <= todayKey && daily[k] && daily[k].cycle_phase).sort().pop();
  if (cycleKey) {
    const c = daily[cycleKey];
    const phase = { MENSTRUAL: "Periode", FOLLICULAR: "Follikelphase", OVULATION: "Eisprung", LUTEAL: "Lutealphase" }[String(c.cycle_phase).toUpperCase()] || c.cycle_phase;
    lines.push(`Zyklus (Garmin): ${phase}${c.cycle_day ? `, Tag ${c.cycle_day}` : ""}`);
  }
  return lines.join("\n");
}

const CTX_LOAD_BALANCE_DE = {
  AEROBIC_LOW_SHORTAGE: "zu wenig lockere Grundlage", AEROBIC_HIGH_SHORTAGE: "zu wenig Tempo/Schwelle", ANAEROBIC_SHORTAGE: "zu wenig sehr harte Intervalle",
  BALANCED: "ausgewogen", AEROBIC_LOW_FOCUS: "Fokus Grundlage", AEROBIC_HIGH_FOCUS: "Fokus Tempo", ANAEROBIC_FOCUS: "Fokus Intervalle",
};

function ctxGarminMetricsLine(daily, metrics, todayKey) {
  const bits = [];
  const latest = field => {
    const k = Object.keys(daily || {}).filter(x => x <= todayKey && x >= ctxShift(todayKey, -3) && daily[x] && daily[x][field] != null).sort().pop();
    return k ? daily[k][field] : null;
  };
  const acute = latest("load_acute"), chronic = latest("load_chronic"), acwr = latest("acwr");
  if (acute != null && chronic != null) bits.push(`Belastung akut ${Math.round(acute)} / chronisch ${Math.round(chronic)}${acwr != null ? ` (Verhältnis ${fmtNum(acwr, 2)}, gut: 0,8-1,3)` : ""}`);
  const lb = latest("load_balance");
  const focus = [["load_aerobic_low", "Grundlage"], ["load_aerobic_high", "Tempo"], ["load_anaerobic", "Intervalle"]]
    .map(([f, l]) => { const v = latest(f), t = latest(f + "_target"); return v != null ? `${l} ${Math.round(v)}${Array.isArray(t) && t[1] ? ` (Ziel ${Math.round(t[0] || 0)}-${Math.round(t[1])})` : ""}` : null; })
    .filter(Boolean);
  if (focus.length) bits.push(`Belastungsfokus 4 Wochen: ${focus.join(", ")}${lb ? ` - ${CTX_LOAD_BALANCE_DE[String(lb).toUpperCase()] || lb}` : ""}`);
  const m = metrics || {};
  const clock = s => (typeof fmtDurationClock === "function" ? fmtDurationClock(s) : `${Math.round(s / 60)} min`);
  const race = [["race5kS", "5 km"], ["race10kS", "10 km"], ["raceHalfS", "HM"], ["raceMarathonS", "M"]].filter(([k]) => m[k]).map(([k, l]) => `${l} ${clock(m[k])}`);
  if (race.length) bits.push(`Wettkampfprognose der Uhr: ${race.join(", ")}`);
  if (m.enduranceScore) bits.push(`Ausdauer-Score ${m.enduranceScore}`);
  if (m.hillScore) bits.push(`Hill-Score ${m.hillScore}`);
  if (m.heatAcclimationPct != null) bits.push(`Hitze-Gewöhnung ${m.heatAcclimationPct} %`);
  return bits.length ? `Kennwerte der Uhr: ${bits.join(" | ")}` : "";
}

// Gefühlte Anstrengung (RPE 1-10, Gefühl 0-100) der letzten Einheiten, mit
// Abgleich gegen den Puls: fühlt sich locker gelaufener Puls hart an, ist das
// ein frühes Müdigkeitszeichen.
function ctxRpeLine(workouts, profile, todayKey, max = 8) {
  const since = ctxShift(todayKey, -21);
  const list = (workouts || []).filter(w => w.rpe != null && ctxDayKey(w) >= since && ctxDayKey(w) <= todayKey)
    .sort((a, b) => ctxDayKey(b).localeCompare(ctxDayKey(a))).slice(0, max);
  if (!list.length) return "";
  const feel = v => (v == null ? "" : v >= 75 ? ", Gefühl sehr gut" : v >= 50 ? ", Gefühl gut" : v >= 25 ? ", Gefühl mäßig" : ", Gefühl schlecht");
  let mismatch = 0;
  const bits = list.map(w => {
    const b = ctxHrBands(w, profile);
    let note = "";
    if (b && b.total) {
      const easy = b.easy / b.total;
      if (w.rpe >= 7 && easy >= 0.8) { note = " (Puls locker, fühlte sich hart an)"; mismatch++; }
      else if (w.rpe <= 3 && easy < 0.5) note = " (Puls hoch, fühlte sich leicht an)";
    }
    return `${ctxShort(ctxDayKey(w))} ${w.sport} ${Math.round(w.duration_min || 0)} min RPE ${fmtNum(w.rpe, 1)}${feel(w.feel)}${note}`;
  });
  const warn = mismatch >= 2 ? ` Achtung: ${mismatch}× fühlte sich lockerer Puls hart an - mögliches Zeichen für Müdigkeit.` : "";
  return `Gefühlte Anstrengung (auf der Uhr eingetragen, RPE 1-10): ${bits.join(" | ")}.${warn}`;
}

function ctxWeatherLine(windowDates, weatherFor) {
  if (!windowDates || !windowDates.length || typeof weatherFor !== "function") return "";
  const bits = windowDates.map(d => {
    const w = weatherFor(d);
    if (!w || w.temp_max == null) return null;
    const info = typeof weatherCodeInfo === "function" ? weatherCodeInfo(w.code) : null;
    const parts = [`${Math.round(w.temp_max)}°/${w.temp_min != null ? Math.round(w.temp_min) + "°" : "?"}`];
    if (info) parts.push(info.label);
    if (w.precip_prob != null && w.precip_prob >= 50) parts.push(`Regen ${Math.round(w.precip_prob)} %`);
    if (w.wind_max != null && w.wind_max >= 30) parts.push(`Wind ${Math.round(w.wind_max)} km/h`);
    return `${ctxShort(d)} ${parts.join(" ")}`;
  }).filter(Boolean);
  return bits.length ? `Wetter-Vorhersage am Wohnort: ${bits.join(" | ")}` : "";
}

// "Gedächtnis" des Coaches: Muster aus den letzten 90 Tagen, jedes nur mit
// genug Beispielen (nie aus 1-2 Fällen schließen).
function ctxMemoryLine(planned, workouts, profile, todayKey, days = 90) {
  const since = ctxShift(todayKey, -days);
  const past = (planned || []).filter(p => p.date >= since && p.date < todayKey && (p.status === "erledigt" || p.status === "uebersprungen"));
  const bits = [];
  const dowName = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const rate = (list, key) => {
    const g = {};
    list.forEach(p => { const k = key(p); g[k] = g[k] || { n: 0, skip: 0 }; g[k].n++; if (p.status === "uebersprungen") g[k].skip++; });
    return Object.entries(g).filter(([, v]) => v.n >= 4 && v.skip / v.n >= 0.4);
  };
  rate(past, p => new Date(p.date + "T00:00:00").getDay()).forEach(([d, v]) => bits.push(`${dowName[d]}s fällt oft aus (${v.skip} von ${v.n} übersprungen)`));
  rate(past, p => p.sport).forEach(([s, v]) => bits.push(`${s} wird oft ausgelassen (${v.skip} von ${v.n})`));
  const long = past.filter(p => p.duration_min >= 90);
  if (long.length >= 4 && long.filter(p => p.status === "uebersprungen").length / long.length >= 0.4) bits.push(`lange Einheiten (ab 90 min) fallen oft aus`);
  // Lockere Einheiten zu hart?
  let easyN = 0, easyHard = 0;
  past.filter(p => p.status === "erledigt" && p.intensity === "leicht").forEach(p => {
    const a = ctxMatchActual(p, workouts);
    const b = a && ctxHrBands(a, profile);
    if (!b || !b.total) return;
    easyN++;
    if ((b.mid + b.hard) / b.total > CTX_TOO_HARD_SHARE) easyHard++;
  });
  if (easyN >= 4 && easyHard / easyN >= 0.4) bits.push(`lockere Einheiten werden oft zu hart gelaufen (${easyHard} von ${easyN}) - Pulsobergrenze klar nennen`);
  // RPE im Schnitt bei lockeren Einheiten
  const rpes = (workouts || []).filter(w => w.rpe != null && ctxDayKey(w) >= since).map(w => ({ w, b: ctxHrBands(w, profile) }))
    .filter(x => x.b && x.b.total && x.b.easy / x.b.total >= 0.8).map(x => x.w.rpe);
  if (rpes.length >= 4) {
    const avg = rpes.reduce((a, b) => a + b, 0) / rpes.length;
    if (avg >= 5) bits.push(`lockere Einheiten fühlen sich oft anstrengend an (Ø RPE ${fmtNum(avg, 1)})`);
  }
  // Hitze: Puls bei warmen Einheiten (ab 25 °C) gegen kühle (unter 18 °C), gleiche Sportart
  ["Laufen", "Rad"].forEach(sport => {
    const ws = (workouts || []).filter(w => ctxGroup(w.sport) === sport && w.avg_temp_c != null && w.avg_hr && ctxDayKey(w) >= ctxShift(todayKey, -365));
    const warm = ws.filter(w => w.avg_temp_c >= 25), cool = ws.filter(w => w.avg_temp_c < 18);
    if (warm.length >= 3 && cool.length >= 3) {
      const avg = l => l.reduce((a, w) => a + w.avg_hr, 0) / l.length;
      const d = avg(warm) - avg(cool);
      if (d >= 5) bits.push(`${sport}: bei Hitze ab 25 °C Puls im Schnitt ${Math.round(d)} Schläge höher`);
    }
  });
  return bits.length ? `Gedächtnis (Muster aus ${days} Tagen, berechnet): ${bits.join(" | ")}` : "";
}

// Runden/Intervalle einer Einheit kompakt (höchstens `max` Runden).
const CTX_LAP_DE = { warmup: "Einlaufen", cooldown: "Auslaufen", rest: "Pause", recovery: "Erholung", interval: "Intervall", active: "aktiv", other: "" };
function ctxLapsLine(w, max = 16) {
  const laps = Array.isArray(w && w.laps) ? w.laps : [];
  if (laps.length < 2) return "";
  const sport = ctxGroup(w.sport);
  const clock = s => (typeof fmtDurationClock === "function" ? fmtDurationClock(s) : `${Math.round(s)} s`);
  const pace = speed => {
    if (!speed) return null;
    if (sport === "Laufen") return `${secondsToPace(1000 / speed)}/km`;
    if (sport === "Schwimmen") return `${secondsToPace(100 / speed)}/100m`;
    return `${fmtNum(speed * 3.6, 1)} km/h`;
  };
  const bits = laps.slice(0, max).map(l => {
    const parts = [`R${l.n}${CTX_LAP_DE[l.intensity] ? " " + CTX_LAP_DE[l.intensity] : ""}`, clock(l.dur_s || 0)];
    if (l.dist_m) parts.push(l.dist_m >= 1000 ? `${fmtNum(l.dist_m / 1000, 2)} km` : `${Math.round(l.dist_m)} m`);
    const p = pace(l.speed); if (p) parts.push(p);
    if (l.power) parts.push(`${Math.round(l.power)} W`);
    if (l.hr) parts.push(`${Math.round(l.hr)} bpm`);
    return parts.join(" ");
  });
  return `Runden/Intervalle (${laps.length}${laps.length > max ? `, erste ${max}` : ""}): ${bits.join(" | ")}`;
}

// Sammelt alle Zeilen aus den globalen Daten des Dashboards.
// opts: { forPlan, windowDates }
function extraContextLines({ forPlan = false, windowDates = null } = {}) {
  const today = typeof todayStr === "function" ? todayStr() : localDateStr(new Date());
  const data = typeof DATA !== "undefined" ? DATA : [];
  const planned = typeof plannedWorkouts !== "undefined" ? plannedWorkouts : [];
  const profile = typeof athleteProfile !== "undefined" ? athleteProfile : {};
  const daily = typeof wellnessDaily === "function" ? wellnessDaily() : {};
  const lines = [
    ctxIntensityLine(data, profile, today),
    ...ctxAdherenceLines(planned, data, profile, today),
    ctxTrendLine(daily, today),
    ctxSpecialDaysLine(daily, today),
    ctxGarminMetricsLine(daily, profile.garminMetrics, today),
    ctxRpeLine(data, profile, today),
    ctxMemoryLine(planned, data, profile, today),
  ];
  if (forPlan && windowDates) lines.push(ctxWeatherLine(windowDates, typeof weatherForDate === "function" ? weatherForDate : null));
  return lines.filter(Boolean);
}
