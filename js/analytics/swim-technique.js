// Schwimmtechnik aus den Uhrdaten: Woran sollte diese Person im Wasser
// arbeiten - und welche Technikübungen (js/data/swim-drills.js) passen heute?
//
// Grundlage sind die Bahnen der Beckeneinheiten der letzten 90 Tage
// (workout.lengths: Zeit, Züge, Zugfrequenz, Stil je Bahn - von parse_fit.py
// bzw. fit-parser.js). Garmin zählt die Züge NUR am Arm mit der Uhr, darum
// sind alle Zugzahlen hier "Züge des Uhr-Arms pro 25 m".
//
// Richtwerte (Kraul, erwachsene Altersklassen-Triathleten, Uhr-Arm je 25 m):
//   bis 13 Züge     effizient
//   14-16 Züge      Luft nach oben beim Gleiten/Abdruck
//   ab 17 Züge      viel Kraft geht verloren
// Zugfrequenz (Uhr-Arm): unter ca. 24/min = lange Pause vorne,
// über ca. 34/min bei vielen Zügen = die Hand rutscht durchs Wasser.

const SWIM_TECH_DAYS = 90;
const SWIM_TECH_FOCUS_ORDER = ["atmung", "lage", "gleiten", "zug", "rotation", "rhythmus", "beine", "freiwasser"];

const swimMedian = arr => {
  const a = arr.filter(v => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

const swimPaceText = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

// Eine Beckeneinheit -> Kennzahlen (oder null, wenn zu wenig Bahnen).
function swimSessionStats(w) {
  const lengths = Array.isArray(w.lengths) ? w.lengths.filter(l => l && Number(l.duration_s) > 0) : [];
  if (lengths.length < 8 || !(Number(w.distance_km) > 0)) return null;
  const raw = Number(w.distance_km) * 1000 / lengths.length;
  const pool = raw > 37.5 ? 50 : 25;
  if (Math.abs(raw - pool) > pool * 0.25) return null; // passt zu keiner Bahnlänge
  const isFree = l => !l.stroke_type || l.stroke_type === "Kraul";
  const breast = lengths.filter(l => l.stroke_type === "Brust").length;
  let free = lengths.filter(l => isFree(l) && Number(l.strokes) > 0);
  // Ausreißer raus (angehalten, an der Wand gewartet, Bahn halb getaucht)
  const medT = swimMedian(free.map(l => Number(l.duration_s)));
  free = free.filter(l => Number(l.duration_s) <= medT * 1.6 && Number(l.duration_s) >= medT * 0.5);
  if (free.length < 6) return { pool, lengths: lengths.length, breastShare: breast / lengths.length, free: 0 };
  const spl = free.map(l => Number(l.strokes) * 25 / pool);
  const sec100 = free.map(l => Number(l.duration_s) * 100 / pool);
  const rates = free.map(l => Number(l.stroke_rate)).filter(v => v > 0);
  // Nachlassen: mittlerer Teil der Einheit (ohne Ein-/Ausschwimmen), erste vs. zweite Hälfte
  let drift = null, fade = null;
  if (free.length >= 16) {
    const cut = Math.floor(free.length * 0.2);
    const mid = free.slice(cut, free.length - cut);
    const half = Math.floor(mid.length / 2);
    const a = mid.slice(0, half), b = mid.slice(half);
    const sA = swimMedian(a.map(l => Number(l.strokes) * 25 / pool)), sB = swimMedian(b.map(l => Number(l.strokes) * 25 / pool));
    const tA = swimMedian(a.map(l => Number(l.duration_s))), tB = swimMedian(b.map(l => Number(l.duration_s)));
    drift = sB - sA;
    fade = tA > 0 ? (tB - tA) / tA : null;
  }
  return {
    pool, lengths: lengths.length, free: free.length, breastShare: breast / lengths.length,
    spl: swimMedian(spl), sec100: swimMedian(sec100), rate: swimMedian(rates), drift, fade,
  };
}

// Hauptziel mit Freiwasser-Schwimmen (Triathlon oder Schwimmen "Freiwasser")
// in den nächsten 12 Wochen -> { name, weeks } sonst null.
function swimOpenWaterRace(today) {
  if (typeof goals === "undefined" || !Array.isArray(goals)) return null;
  const t0 = new Date(today); t0.setHours(0, 0, 0, 0);
  const soon = goals.filter(g => g && g.date && (g.sport === "Triathlon" && g.terrain !== "pool" || g.sport === "Schwimmen" && g.terrain === "open"))
    .map(g => ({ g, days: Math.round((new Date(g.date + "T00:00:00") - t0) / 86400000) }))
    .filter(x => x.days >= 0 && x.days <= 84)
    .sort((a, b) => (b.g.isPrimary ? 1 : 0) - (a.g.isPrimary ? 1 : 0) || a.days - b.days);
  return soon.length ? { name: soon[0].g.name || "Wettkampf", weeks: Math.max(1, Math.round(soon[0].days / 7)) } : null;
}

/* Auswertung: { sessions, poolSessions, metrics, focus: [{ id, label, score, reason }], level, note }
   focus ist nach Wichtigkeit sortiert; Grundlagen (Atmung, Wasserlage)
   gehen bei gleichem Gewicht vor. */
function swimTechniqueAnalysis(list, today = new Date(), profile) {
  const prof = profile || (typeof athleteProfile !== "undefined" ? athleteProfile : {});
  const all = Array.isArray(list) ? list : (typeof DATA !== "undefined" ? DATA : []);
  const since = new Date(today).getTime() - SWIM_TECH_DAYS * 86400000;
  const group = w => (typeof sportGroup === "function" ? sportGroup(w.sport) : w.sport);
  const swims = all.filter(w => w && group(w) === "Schwimmen" && new Date(w._date || w.date).getTime() >= since && new Date(w._date || w.date).getTime() <= new Date(today).getTime());
  const stats = swims.map(swimSessionStats).filter(Boolean);
  const withFree = stats.filter(s => s.free > 0);

  const metrics = {
    spl: swimMedian(withFree.map(s => s.spl)),
    rate: swimMedian(withFree.map(s => s.rate)),
    sec100: swimMedian(withFree.map(s => s.sec100)),
    drift: swimMedian(withFree.map(s => s.drift)),
    fade: swimMedian(withFree.map(s => s.fade)),
    breastShare: stats.length ? stats.reduce((a, s) => a + s.breastShare * s.lengths, 0) / stats.reduce((a, s) => a + s.lengths, 0) : null,
  };
  const round1 = v => Math.round(v * 10) / 10;
  if (metrics.spl != null) metrics.spl = round1(metrics.spl);
  if (metrics.rate != null) metrics.rate = Math.round(metrics.rate);
  const css = typeof paceToSeconds === "function" ? paceToSeconds(prof.swimCss) : null;
  const pace = metrics.sec100 || css || null;

  // Gewichte je Schwerpunkt (0-3) + Begründung in einfachen Worten
  const focus = {};
  const add = (id, score, reason) => {
    if (!focus[id] || focus[id].score < score) focus[id] = { id, label: SWIM_FOCUS[id], score, reason: reason || (focus[id] && focus[id].reason) };
  };
  const { spl, rate, drift, fade, breastShare } = metrics;
  if (spl != null && spl >= 17) add("gleiten", 3, `Du brauchst im Schnitt ${fmtSwimNum(spl)} Züge pro 25 m (gezählt am Uhr-Arm). Gut sind etwa 11–14 – jeder Zug bringt dir noch zu wenig Vortrieb.`);
  else if (spl != null && spl >= 14.5) add("gleiten", 2, `Im Schnitt ${fmtSwimNum(spl)} Züge pro 25 m (Uhr-Arm). Mit etwas mehr Gleiten und einem längeren Abdruck geht das mit 1–2 Zügen weniger.`);
  if (spl != null && spl >= 14.5 && rate != null && rate >= 34) add("zug", 3, `Viele und schnelle Züge (${rate} pro Minute): Die Hand rutscht durchs Wasser, statt es festzuhalten.`);
  else if (spl != null && spl >= 14.5) add("zug", 1, "Mehr Vortrieb pro Zug kommt vom festen Fassen vorne mit hohem Ellbogen.");
  if (rate != null && rate < 24 && (spl == null || spl < 14.5)) add("rhythmus", 2, `Ruhiger Rhythmus (${rate} Züge pro Minute) mit langer Pause vorne. Im Freiwasser und im Neo ist ein flüssiger Takt schneller.`);
  if (drift != null && drift >= 1.5 || fade != null && fade >= 0.06) {
    const why = drift != null && drift >= 1.5
      ? `In der zweiten Hälfte deiner Einheiten brauchst du ${fmtSwimNum(round1(drift))} Züge mehr pro Bahn – wenn du müde wirst, lässt die Technik nach.`
      : `In der zweiten Hälfte deiner Einheiten wirst du rund ${Math.round(fade * 100)} % langsamer – wenn du müde wirst, lässt die Technik nach.`;
    add("lage", 2, `${why} Eine stabile Wasserlage hält länger.`);
    metrics.fatigue = true;
  }
  if (breastShare != null && breastShare >= 0.2) {
    const pct = Math.round(breastShare * 100);
    add("atmung", 3, `${pct} % deiner Bahnen schwimmst du Brust. Meistens heißt das: Die Kraul-Atmung ist noch anstrengend.`);
    add("lage", 2, "Wer entspannt atmet, liegt auch flacher im Wasser.");
  }
  if (pace && pace >= 140) {
    add("lage", 2, `Bei ${swimPaceText(pace)} min pro 100 m bringt eine bessere Wasserlage am meisten: Liegen Hüfte und Beine höher, bremst der Körper weniger.`);
    add("atmung", 1, "Ruhiges Ausatmen unter Wasser macht jede Bahn entspannter.");
  }
  const race = swimOpenWaterRace(today);
  if (race) add("freiwasser", race.weeks <= 6 ? 3 : 2, `„${race.name}“ ist in ${race.weeks} ${race.weeks === 1 ? "Woche" : "Wochen"}. Im Freiwasser gibt es keine Linie am Boden – wer geradeaus schwimmt, spart Meter.`);
  // Grundbausteine, damit es Abwechslung gibt
  add("rotation", 1, "Aus der Körperdrehung kommt die Kraft für jeden Zug – gehört in jede Technikeinheit.");
  add("atmung", 1, "Ruhiges Ausatmen unter Wasser macht jede Bahn entspannter.");
  add("gleiten", 1, "Lange, ruhige Züge sparen Kraft für Rad und Laufen.");

  const ordered = Object.values(focus).sort((a, b) => b.score - a.score || SWIM_TECH_FOCUS_ORDER.indexOf(a.id) - SWIM_TECH_FOCUS_ORDER.indexOf(b.id));
  const level = !pace ? (prof.experienceLevel === ">3" ? 2 : 1) : pace <= 105 ? 3 : pace <= 135 ? 2 : 1;
  const note = !swims.length ? "Noch keine Schwimmeinheit in den letzten 90 Tagen – die Übungen sind erst einmal Grundlagen."
    : !withFree.length ? "Deine Schwimmeinheiten haben keine Bahn-Daten (Zugzahl). Starte auf der Uhr das Profil „Bahnenschwimmen“, dann wird die Auswertung genauer."
      : null;
  return { sessions: swims.length, poolSessions: withFree.length, metrics, focus: ordered, level, note, race };
}

function fmtSwimNum(v) {
  return String(Math.round(v * 10) / 10).replace(".", ",");
}

// Auswertung zwischenspeichern (wird pro Einheit mehrfach gebraucht).
let swimTechCache = { key: null, value: null };
function currentSwimTechnique() {
  const list = typeof DATA !== "undefined" ? DATA : [];
  const prof = typeof athleteProfile !== "undefined" ? athleteProfile : {};
  const goalKey = typeof goals !== "undefined" && Array.isArray(goals) ? goals.map(g => `${g.id}${g.date}${g.terrain}${g.isPrimary}`).join() : "";
  const key = `${list.length}|${list.length ? list[list.length - 1].date : ""}|${prof.swimCss}|${prof.experienceLevel}|${goalKey}|${new Date().toDateString()}`;
  if (swimTechCache.key !== key) swimTechCache = { key, value: swimTechniqueAnalysis(list, new Date(), prof) };
  return swimTechCache.value;
}

/* Übungen für eine Einheit am Tag `date` (YYYY-MM-DD): bis zu 3 IDs.
   Je Schwerpunkt (nach Wichtigkeit) eine passende Übung; welche aus der
   Auswahl drankommt, wechselt mit dem Datum - so wiederholt sich nicht jede
   Einheit, bleibt aber beim gleichen Tag gleich (Uhr und App zeigen
   dasselbe). Nur Übungen mit vorhandenen Hilfsmitteln und passendem Niveau. */
function pickSwimDrills(date, analysis, gear, count = 3) {
  const a = analysis || currentSwimTechnique();
  const have = new Set(gear || swimGear());
  const ok = SWIM_DRILLS.filter(d => d.gear.every(g => have.has(g)) && d.level <= Math.max(1, a.level));
  const day = Math.floor(new Date(`${date || "2026-01-01"}T12:00:00Z`).getTime() / 86400000);
  // Schwerpunkte: Top-Schwerpunkt bekommt bei hohem Gewicht zwei Übungen
  const top = a.focus.slice(0, 3).map(f => f.id);
  const plan = a.focus[0] && a.focus[0].score >= 3 ? [top[0], top[1], top[0]] : top;
  // Je Einheit höchstens eine Beinschlag- und eine "Kraul mit Aufgabe"-Übung,
  // der Rest echte Technikübungen (25 m Übung + 25 m Kraul).
  const out = [];
  const used = { kick: 0, swim: 0 };
  const mix = (Math.imul(day, 2654435761) >>> 0) % 997; // je Tag anders, aber fest
  plan.slice(0, count).forEach((f, k) => {
    const fresh = d => !out.includes(d.id);
    let pool = ok.filter(d => d.focus.includes(f) && fresh(d) && (d.kind === "drill" || !used[d.kind]));
    if (!pool.length) pool = ok.filter(d => d.focus.includes(f) && fresh(d));
    if (!pool.length) return;
    const pick = pool[(mix + k * 5) % pool.length];
    if (pick.kind !== "drill") used[pick.kind]++;
    out.push(pick.id);
  });
  // zu wenig gefunden: mit Grundübungen auffüllen
  ["abschlag", "seitlage", "dreier-atmung", "faust"].forEach(id => {
    if (out.length < count && !out.includes(id) && ok.some(d => d.id === id)) out.push(id);
  });
  return out.slice(0, count);
}

// Warum diese Übung? Die Begründung des passenden Schwerpunkts.
function swimDrillReason(drill, analysis) {
  const a = analysis || currentSwimTechnique();
  const hit = a.focus.find(f => drill.focus.includes(f.id));
  return hit ? hit.reason : "";
}

// Kurztext für den KI-Coach: Kennzahlen, Schwerpunkte, erlaubte Übungen.
function swimTechniqueContextText(analysis, gear) {
  const a = analysis || currentSwimTechnique();
  const m = a.metrics;
  const bits = [];
  if (a.poolSessions) {
    const data = [m.spl != null && `Ø ${fmtSwimNum(m.spl)} Züge/25 m (Uhr-Arm)`, m.rate != null && `${m.rate} Züge/min`,
      m.sec100 && `${swimPaceText(m.sec100)}/100 m`, m.breastShare >= 0.1 && `${Math.round(m.breastShare * 100)} % Brust-Bahnen`,
      m.fatigue && "Technik lässt in der 2. Hälfte nach"].filter(Boolean).join(", ");
    bits.push(`Schwimmtechnik aus ${a.poolSessions} Beckeneinheiten (90 Tage): ${data}.`);
  } else if (a.note) bits.push(`Schwimmtechnik: ${a.note}`);
  bits.push(`Technik-Schwerpunkte: ${a.focus.slice(0, 3).map(f => `${f.label}${f.score >= 2 ? " (wichtig)" : ""}`).join(", ")}.`);
  const have = new Set(gear || swimGear());
  const ok = SWIM_DRILLS.filter(d => d.gear.every(g => have.has(g)) && d.level <= Math.max(1, a.level));
  const topIds = a.focus.slice(0, 3).map(f => f.id);
  const fit = ok.filter(d => d.focus.some(f => topIds.includes(f)));
  bits.push(`Passende Technikübungen (id: Name – Schwerpunkt): ${fit.map(d => `${d.id}: ${d.name} – ${SWIM_FOCUS[d.focus[0]]}`).join("; ")}.`);
  bits.push(`Hilfsmittel beim Schwimmen: ${[...have].map(g => SWIM_GEAR[g]).join(", ") || "keine"}.`);
  return bits.join("\n");
}
