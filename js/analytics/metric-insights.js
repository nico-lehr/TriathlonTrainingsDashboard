// Einordnung der Messwerte einer Einheit ("Ist mein Wert gut?"):
//   1. Richtwert: in welchem Bereich liegt der Wert (allgemeine Bereiche, z. B.
//      die Farbbereiche von Garmin für die Lauf-Dynamik, Intensität nach FTP/CSS,
//      Pulszonen nach Herzfrequenzreserve),
//   2. Vergleich mit dir selbst: besser oder schlechter als in deinen früheren
//      Einheiten - wenn möglich nur Einheiten mit ähnlichem Tempo, weil
//      Schrittfrequenz, Bodenkontaktzeit & Co. stark vom Tempo abhängen,
//   3. kurze Erklärung + Tipp in einfachen Worten.
// Genutzt in der Detailansicht (js/components/workout-card.js, unter dem
// passenden Diagramm) und als Kontext für die KI-Auswertung
// (js/ai/context-builder.js). Nur Einheiten VOR dieser zählen als "sonst".

const MI_DAY_MS = 86400000;
const MI_BASE_DAYS = 180;   // so weit zurück zählen frühere Einheiten
const MI_BASE_MAX = 10;     // höchstens so viele (die jüngsten)
const MI_BASE_MIN = 3;      // darunter kein Vergleich

const miFmt = (v, d = 0) => Number(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

// Bänder: [ab, bis, Stufe, Wort]. Stufen great/good/ok/warn/bad (Bewertung)
// oder i1..i5 (nur Intensität - weder gut noch schlecht).
const MI_DEFS = {
  run_cadence: {
    label: "Schrittfrequenz", key: "avg_cadence", unit: "spm", dec: 0, better: "higher", noise: 2, pace: true,
    bands: [[130, 153, "bad", "niedrig"], [153, 164, "warn", "eher niedrig"], [164, 174, "ok", "mittel"], [174, 184, "good", "gut"], [184, 200, "great", "sehr hoch"]],
    explain: "Schritte pro Minute. Mehr, dafür kürzere Schritte landen näher unter dem Körper – das schont Knie und Schienbein und senkt das Auf und Ab. Bei lockerem Tempo ist die Frequenz von Natur aus etwas niedriger.",
    tip: v => v < 170
      ? "Bei lockeren Läufen 5 % mehr Schritte probieren (z. B. von 160 auf 168) – am einfachsten mit dem Metronom der Uhr. Höchstens 5–10 % auf einmal steigern."
      : "Passt gut. Achte darauf, die Frequenz auch am Ende langer Läufe zu halten, wenn die Beine müde werden.",
  },
  run_gct: {
    label: "Bodenkontaktzeit", key: "avg_stance_time_ms", unit: "ms", dec: 0, better: "lower", noise: 5, pace: true,
    bands: [[190, 218, "great", "sehr kurz"], [218, 249, "good", "kurz"], [249, 278, "ok", "mittel"], [278, 309, "warn", "eher lang"], [309, 340, "bad", "lang"]],
    explain: "Wie lange dein Fuß bei jedem Schritt am Boden ist. Kürzer heißt meist: elastischer, sparsamer Schritt. Bei langsamem Tempo wird sie automatisch länger.",
    tip: () => "Lauf-ABC (Skippings, Fußgelenksarbeit), Seilspringen und eine etwas höhere Schrittfrequenz verkürzen die Bodenkontaktzeit.",
  },
  run_vr: {
    label: "Vertikales Verhältnis", key: "avg_vertical_ratio_pct", unit: "%", dec: 1, better: "lower", noise: 0.2, pace: true,
    bands: [[4.8, 6.1, "great", "sehr gut"], [6.1, 7.5, "good", "gut"], [7.5, 8.7, "ok", "mittel"], [8.7, 10.2, "warn", "eher hoch"], [10.2, 11.6, "bad", "hoch"]],
    explain: "Wie viel deiner Kraft nach oben statt nach vorne geht: das Auf und Ab geteilt durch die Schrittlänge. Niedriger heißt mehr Vortrieb pro Schritt. Bei lockerem Tempo ist der Wert meist etwas höher.",
    tip: v => v >= 8.7
      ? "Höhere Schrittfrequenz hilft am meisten (kürzere Schritte = weniger Hüpfen). Dazu aufrecht laufen, Blick nach vorn, „leise“ aufsetzen statt nach oben abzudrücken. Kräftige Waden und ein stabiler Rumpf helfen ebenfalls."
      : "Gut. Behalte die Schrittfrequenz bei – sie hält das Verhältnis niedrig.",
  },
  run_vo: {
    label: "Vertikale Oszillation", key: "avg_vertical_oscillation_mm", unit: "cm", dec: 1, scale: 0.1, better: "lower", noise: 3, pace: true,
    bands: [[47, 64, "great", "sehr gering"], [64, 82, "good", "gering"], [82, 98, "ok", "mittel"], [98, 116, "warn", "eher hoch"], [116, 133, "bad", "hoch"]],
    explain: "Wie stark du bei jedem Schritt auf und ab „hüpfst“. Weniger Hüpfen spart Kraft – zu flach (schlurfen) ist aber auch nicht das Ziel.",
    tip: () => "Kürzere, schnellere Schritte und eine leichte Vorlage aus dem Sprunggelenk senken das Hüpfen.",
  },
  ride_cadence: {
    label: "Trittfrequenz", key: "avg_cadence", unit: "U/min", dec: 0, better: null, noise: 3,
    bands: [[50, 70, "warn", "niedrig"], [70, 80, "ok", "eher niedrig"], [80, 96, "good", "gut"], [96, 106, "ok", "hoch"], [106, 120, "warn", "sehr hoch"]],
    explain: "Kurbelumdrehungen pro Minute. Für Triathlon sind 85–95 ein guter Bereich: das schont die Muskeln für den Lauf danach. Am Berg sinkt sie natürlich.",
    tip: v => v < 80
      ? "Etwas leichtere Gänge wählen und runder treten – das spart Kraft für das Laufen danach."
      : v > 100 ? "Sehr hohe Frequenz kostet Puls. Bei langen Fahrten einen Gang schwerer probieren."
      : "Passt gut für Triathlon.",
  },
  swim_swolf: {
    label: "SWOLF", key: "avg_swolf", unit: "", dec: 0, better: "lower", noise: 1,
    bands: [[25, 35, "great", "sehr gut"], [35, 43, "good", "gut"], [43, 51, "ok", "mittel"], [51, 61, "warn", "eher hoch"], [61, 75, "bad", "hoch"]],
    note: "Richtwert für ein 25-m-Becken",
    explain: "Züge plus Sekunden für eine Bahn. Niedriger heißt: schneller UND mit weniger Zügen – also effizienter. Hängt von der Beckenlänge ab, am besten mit dir selbst vergleichen.",
    tip: () => "Lang machen und gleiten: pro Bahn 1–2 Züge weniger versuchen, ohne langsamer zu werden. Technik-Übungen wie Abschlagschwimmen helfen.",
  },
  swim_stroke: {
    label: "Zugfrequenz", key: "avg_stroke_rate", unit: "Züge/min", dec: 0, better: null, noise: 2,
    bands: null, // je nach Zählweise der Uhr sehr unterschiedlich - nur mit dir selbst vergleichen
    explain: "Wie viele Armzüge du pro Minute machst (die Uhr zählt meist nur den Arm, an dem sie sitzt). Zu langsam heißt oft zu langes Gleiten mit Stillstand, zu schnell oft kurze, wirkungslose Züge.",
    tip: () => "Gleichmäßiger Rhythmus ist wichtiger als die Zahl. Für das Freiwasser hilft eine etwas höhere Frequenz.",
  },
};

const MI_LEVEL_WORD = { great: "sehr gut", good: "gut", ok: "mittel", warn: "ausbaufähig", bad: "verbesserungswürdig" };

function miBand(bands, v) {
  for (const b of bands) if (v < b[1]) return b;
  return bands[bands.length - 1];
}

function miScale(bands, v) {
  return { bands: bands.map(b => ({ from: b[0], to: b[1], level: b[2] })), min: bands[0][0], max: bands[bands.length - 1][1], value: v };
}

// Text eines Bereichs: "6,1–7,4 %"
function miRangeText(def, lo, hi) {
  const s = def.scale || 1, d = def.dec, step = d ? Math.pow(10, -d) : 1;
  return `${miFmt(lo * s, d)}–${miFmt((hi - step / s) * s, d)}${def.unit ? (def.unit === "%" ? " %" : " " + def.unit) : ""}`;
}

function miValueText(def, v) {
  const s = def.scale || 1;
  return `${miFmt(v * s, def.dec)}${def.unit ? (def.unit === "%" ? " %" : " " + def.unit) : ""}`;
}

function miPaceSec(w) {
  if (w.pace_min_per_km) return paceToSeconds(w.pace_min_per_km);
  if (w.pace_min_per_100m) return paceToSeconds(w.pace_min_per_100m);
  return null;
}

// Frühere Einheiten derselben Art (Sportart, Indoor/Outdoor, Becken/Freiwasser)
// mit diesem Wert - wenn genug, nur die mit ähnlichem Tempo.
function miBaseline(w, all, valueOf, { pace = false, similar = null } = {}) {
  if (!w || !w._date || !Array.isArray(all)) return null;
  const t = w._date.getTime();
  const before = all.filter(o => o && o.file !== w.file && !o.is_summary && o._date
    && o._date.getTime() < t && t - o._date.getTime() <= MI_BASE_DAYS * MI_DAY_MS
    && (typeof sameComparisonGroup !== "function" || sameComparisonGroup(w, o)) && valueOf(o) != null)
    .sort((a, b) => b._date - a._date);
  let pool = null, similarPace = false;
  const near = similar || (pace ? miSimilarPace(w) : null);
  if (near) {
    const sim = before.filter(near);
    if (sim.length >= MI_BASE_MIN) { pool = sim; similarPace = true; }
  }
  if (!pool) {
    if (similar) return null; // ohne ähnliche Einheiten wäre der Vergleich hier sinnlos
    if (before.length < MI_BASE_MIN) return null;
    pool = before;
  }
  pool = pool.slice(0, MI_BASE_MAX);
  const vals = pool.map(valueOf);
  return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length, similarPace };
}

function miSimilarPace(w) {
  const sec = miPaceSec(w);
  if (sec != null) {
    const tol = w.pace_min_per_100m ? 8 : 20; // s/100 m bzw. s/km
    return o => { const s = miPaceSec(o); return s != null && Math.abs(s - sec) <= tol; };
  }
  if (w.speed_kmh != null) return o => o.speed_kmh != null && Math.abs(o.speed_kmh - w.speed_kmh) <= w.speed_kmh * 0.1;
  return null;
}

const MI_UNIT_WORD = { Laufen: ["Läufe", "Lauf"], Rad: ["Radeinheiten", "Radeinheit"], Schwimmen: ["Schwimmeinheiten", "Schwimmeinheit"] };

function miBaseText(w, base, valueText, simWord = "ähnlichem Tempo") {
  const g = typeof sportGroup === "function" ? sportGroup(w.sport) : w.sport;
  const word = (MI_UNIT_WORD[g] || ["Einheiten"])[0];
  return base.similarPace
    ? `sonst Ø ${valueText} (${base.n} ${word} mit ${simWord})`
    : `sonst Ø ${valueText} (letzte ${base.n} ${word}, Tempo unterschiedlich)`;
}

// Vergleich mit sich selbst: better/worse/same oder neutral more/less.
function miCompare(def, v, base, w, simWord) {
  if (!base) return null;
  const diff = v - base.avg;
  const baseText = miBaseText(w, base, miValueText(def, base.avg), simWord);
  if (Math.abs(diff) < def.noise) return { dir: "same", delta: 0, text: "wie sonst", baseText };
  const up = diff > 0;
  if (!def.better) return { dir: up ? "more" : "less", delta: diff, text: up ? "höher als sonst" : "niedriger als sonst", baseText };
  const good = def.better === "higher" ? up : !up;
  return { dir: good ? "better" : "worse", delta: diff, text: good ? "besser als sonst" : "schlechter als sonst", baseText };
}

function miFromDef(id, w, all) {
  const def = MI_DEFS[id];
  const v = w[def.key];
  if (v == null || !isFinite(v)) return null;
  const base = miBaseline(w, all, o => (o[def.key] != null && isFinite(o[def.key]) ? o[def.key] : null), { pace: def.pace });
  if (!def.bands) {
    const compare = miCompare(def, v, base, w);
    if (!compare) return null; // ohne Richtwert und ohne Vergleich gibt es nichts einzuordnen
    return { id, label: def.label, value: v, valueText: miValueText(def, v), level: "ok", verdict: null, rangeText: def.note || null,
      scale: null, compare, explain: def.explain, tip: def.tip(v) };
  }
  const band = miBand(def.bands, v);
  const gut = def.bands.filter(b => b[2] === "good" || b[2] === "great");
  const goodRange = gut.length ? miRangeText(def, Math.min(...gut.map(b => b[0])), Math.max(...gut.map(b => b[1]))) : null;
  const goodTxt = def.better === "lower" && gut.length ? `gut: unter ${miValueText(def, Math.max(...gut.map(b => b[1])))}`
    : def.better === "higher" && gut.length ? `gut: ab ${miValueText(def, Math.min(...gut.map(b => b[0])))}`
    : goodRange ? `gut: ${goodRange}` : null;
  return {
    id, label: def.label, value: v, valueText: miValueText(def, v),
    level: band[2], verdict: band[3],
    rangeText: [goodTxt, def.note].filter(Boolean).join(" · "),
    scale: miScale(def.bands, v),
    compare: miCompare(def, v, base, w),
    explain: def.explain, tip: def.tip(v),
  };
}

// Was war an diesem Tag geplant? -> "leicht" | "mittel" | "hart" | null
function miPlannedIntensity(w) {
  if (!w._date || typeof plannedWorkouts === "undefined" || typeof localDateStr !== "function") return null;
  const key = localDateStr(w._date);
  const p = plannedWorkouts.find(x => x.date === key && x.sport === w.sport && x.intensity);
  return p ? p.intensity : null;
}

// Puls in Zonen nach Herzfrequenzreserve (Karvonen) - braucht Max- und Ruhepuls.
function miHrZone(w, profile) {
  const max = profile && Number(profile.maxHr), rest = profile && Number(profile.restingHr);
  if (!w.avg_hr || !max || !rest || max <= rest) return null;
  const pct = (w.avg_hr - rest) / (max - rest) * 100;
  const bands = [[30, 60, "i1", "Zone 1 · sehr locker"], [60, 70, "i2", "Zone 2 · locker (Grundlage)"], [70, 80, "i3", "Zone 3 · mittel"], [80, 90, "i4", "Zone 4 · hart (Schwelle)"], [90, 101, "i5", "Zone 5 · sehr hart"]];
  const band = miBand(bands, pct);
  const planned = miPlannedIntensity(w);
  let plan = null;
  if (planned === "leicht" && pct >= 70) plan = { level: "warn", text: "härter als geplant (locker geplant)" };
  else if (planned === "leicht") plan = { level: "good", text: "passt zum Plan (locker)" };
  else if (planned === "mittel" && pct >= 85) plan = { level: "warn", text: "härter als geplant (mittel geplant)" };
  else if (planned === "mittel" && pct < 60) plan = { level: "ok", text: "lockerer als geplant" };
  else if (planned) plan = { level: "good", text: `passt zum Plan (${planned})` };
  return {
    id: "hr_zone", label: "Puls-Intensität", value: pct, valueText: `Ø ${Math.round(w.avg_hr)} bpm · ${Math.round(pct)} % Reserve`,
    level: band[2], verdict: band[3], plan,
    rangeText: "Grundlage: 60–70 % der Herzfrequenzreserve",
    scale: miScale(bands, pct),
    compare: null,
    explain: "Wie anstrengend die Einheit im Schnitt war – gemessen an deinem Max- und Ruhepuls. Der Großteil des Trainings (etwa 80 %) sollte locker in Zone 1–2 sein, damit die Ausdauer wächst, ohne dich zu ermüden.",
    tip: plan && plan.level === "warn"
      ? "Lockere Einheiten wirklich locker halten: Tempo rausnehmen, am Berg gehen oder leichter treten. Ein Puls-Alarm auf der Uhr hilft."
      : "Passt. Halte die lockeren Tage locker, dann hast du für die harten Einheiten genug Kraft.",
  };
}

// Puls bei ähnlichem Tempo (Laufen/Schwimmen) bzw. ähnlicher Leistung (Rad):
// niedriger = fitter bzw. sparsamer unterwegs.
function miHrAtPace(w, all) {
  if (!w.avg_hr) return null;
  const g = typeof sportGroup === "function" ? sportGroup(w.sport) : w.sport;
  let similar = null, simWord = "ähnlichem Tempo";
  const power = w.normalized_power_w ?? w.avg_power_w;
  if (g === "Rad" && power) {
    similar = o => { const p = o.normalized_power_w ?? o.avg_power_w; return p != null && Math.abs(p - power) <= power * 0.07; };
    simWord = "ähnlicher Leistung";
  } else if (g === "Laufen" || (g === "Rad" && !(typeof isIndoorRide === "function" && isIndoorRide(w)))) {
    similar = miSimilarPace(w);
  }
  if (!similar) return null;
  const base = miBaseline(w, all, o => o.avg_hr || null, { similar });
  if (!base) return null;
  const def = { unit: "bpm", dec: 0, better: "lower", noise: 2 };
  const cmp = miCompare(def, w.avg_hr, base, w, simWord);
  const diff = Math.round(w.avg_hr) - Math.round(base.avg); // passt zu den gezeigten, gerundeten Werten
  return {
    id: "hr_at_pace", label: g === "Rad" && power ? "Puls bei ähnlicher Leistung" : "Puls bei ähnlichem Tempo",
    value: w.avg_hr, valueText: `Ø ${Math.round(w.avg_hr)} bpm (${diff > 0 ? "+" : ""}${diff})`,
    level: cmp.dir === "better" ? "good" : cmp.dir === "worse" ? "warn" : "ok", verdict: null,
    rangeText: null, scale: null, compare: cmp,
    explain: "Wie hoch dein Puls bei gleichem Tempo bzw. gleicher Leistung war. Sinkt er mit der Zeit, wirst du fitter. Hitze, wenig Schlaf, Stress oder ein Infekt treiben ihn nach oben.",
    tip: cmp.dir === "worse"
      ? "Ein höherer Puls als sonst ist oft ein Zeichen für Müdigkeit, Hitze oder wenig Trinken – heute lieber etwas ruhiger machen."
      : "Gutes Zeichen für deine Form.",
  };
}

// Puls-Drift (aerobe Entkopplung): steigt der Puls in der zweiten Hälfte bei
// gleichem Tempo/gleicher Leistung? Nur bei gleichmäßigen Einheiten ab 40 min.
function miDecoupling(w) {
  const s = w.stream;
  if (!s || !Array.isArray(s.t) || !Array.isArray(s.hr) || !w.duration_min || w.duration_min < 40) return null;
  const g = typeof sportGroup === "function" ? sportGroup(w.sport) : w.sport;
  if (g !== "Laufen" && g !== "Rad") return null;
  if (miPlannedIntensity(w) === "hart") return null;
  const usePower = g === "Rad" && Array.isArray(s.power) && s.power.filter(v => v != null).length > s.t.length * 0.5;
  const out = usePower ? s.power : s.speed;
  if (!Array.isArray(out)) return null;
  const pts = [];
  const startT = s.t[0] + (s.t[s.t.length - 1] - s.t[0]) * 0.1; // ersten 10 % = Einlaufen/-fahren
  for (let i = 0; i < s.t.length; i++) {
    const o = out[i], h = s.hr[i];
    if (s.t[i] < startT || o == null || h == null || h < 60 || (usePower ? o < 30 : o < 1)) continue;
    pts.push({ o, h });
  }
  if (pts.length < 40) return null;
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const outs = pts.map(p => p.o), avgO = mean(outs);
  const cv = Math.sqrt(mean(outs.map(o => (o - avgO) ** 2))) / avgO;
  if (cv > (usePower ? 0.35 : 0.2)) return null; // Intervalle/Stopps: Drift sagt nichts
  const half = Math.floor(pts.length / 2);
  const ef = arr => mean(arr.map(p => p.o)) / mean(arr.map(p => p.h));
  const ef1 = ef(pts.slice(0, half)), ef2 = ef(pts.slice(half));
  const pct = (ef1 - ef2) / ef1 * 100;
  const bands = [[-10, 5, "good", "stabil"], [5, 10, "ok", "leichte Drift"], [10, 25, "warn", "deutliche Drift"]];
  const v = Math.max(-10, Math.min(24.9, pct));
  const band = miBand(bands, v);
  return {
    id: "decoupling", label: "Puls-Drift", value: pct, valueText: `${pct >= 0 ? "+" : ""}${miFmt(pct, 1)} %`,
    level: band[2], verdict: band[3],
    rangeText: "gut: unter 5 %",
    scale: miScale(bands, v), compare: null,
    explain: `Wie stark dein Puls in der zweiten Hälfte steigt, obwohl ${usePower ? "die Leistung" : "das Tempo"} gleich bleibt. Unter 5 % zeigt eine gute Ausdauerbasis. Zu schnelles Angehen, Hitze oder zu wenig Trinken erhöhen die Drift.`,
    tip: pct >= 5
      ? "Ruhiger anfangen und unterwegs trinken. Viele lockere, lange Einheiten verbessern die Ausdauerbasis – dann sinkt die Drift."
      : "Starke Ausdauerbasis für diese Dauer und dieses Tempo.",
  };
}

// Rad mit Leistung: Intensität (NP ÷ FTP) und Gleichmäßigkeit (NP ÷ Ø Leistung).
function miRidePower(w, profile) {
  const list = [];
  const np = w.normalized_power_w, ap = w.avg_power_w;
  const ftp = profile && Number(profile.ftpWatts);
  if (ftp && (np || ap)) {
    const iF = (np || ap) / ftp;
    const bands = [[0.4, 0.75, "i2", "locker / Grundlage"], [0.75, 0.85, "i3", "zügig (Tempo)"], [0.85, 0.95, "i4", "hart (Schwelle)"], [0.95, 1.05, "i5", "sehr hart"], [1.05, 1.3, "i5", "maximal"]];
    const band = miBand(bands, Math.min(1.29, Math.max(0.4, iF)));
    const planned = miPlannedIntensity(w);
    const plan = planned === "leicht" && iF > 0.8 ? { level: "warn", text: "härter als geplant (locker geplant)" }
      : planned === "leicht" ? { level: "good", text: "passt zum Plan (locker)" }
      : planned ? { level: "good", text: `geplant: ${planned}` } : null;
    const kg = profile && Number(profile.weightKg);
    list.push({
      id: "ride_if", label: "Intensität (% FTP)", value: iF,
      valueText: `${Math.round(iF * 100)} % FTP${kg && ap ? ` · ${miFmt(ap / kg, 2)} W/kg` : ""}`,
      level: band[2], verdict: band[3], plan,
      rangeText: "Grundlage: unter 75 % · Triathlon-Renntempo meist 70–85 %",
      scale: miScale(bands, Math.min(1.29, Math.max(0.4, iF))), compare: null,
      explain: "Wie hart die Fahrt war, gemessen an deiner FTP (der Leistung, die du etwa eine Stunde halten kannst). Für eine Mitteldistanz fährt man meist 75–83 % FTP, damit der Lauf danach noch geht.",
      tip: iF > 0.85 && (!planned || planned === "leicht") ? "Lange, lockere Fahrten unter 75 % FTP halten – das trainiert die Ausdauer, ohne zu ermüden." : "Passt.",
    });
  }
  if (np && ap && ap > 0) {
    const vi = np / ap;
    const bands = [[1, 1.05, "good", "sehr gleichmäßig"], [1.05, 1.1, "ok", "gleichmäßig"], [1.1, 1.2, "warn", "wechselnd"], [1.2, 1.5, "bad", "sehr unruhig"]];
    const v = Math.min(1.49, vi);
    const band = miBand(bands, v);
    list.push({
      id: "ride_vi", label: "Gleichmäßigkeit", value: vi, valueText: `${miFmt(vi, 2)} (NP ÷ Ø Leistung)`,
      level: band[2], verdict: band[3],
      rangeText: "für Triathlon ideal: unter 1,05",
      scale: miScale(bands, v), compare: null,
      explain: "Wie gleichmäßig du getreten hast. 1,00 heißt völlig gleichmäßig. Im Triathlon spart gleichmäßiges Fahren Kraft für den Lauf. Bei Intervallen oder im Hügelland ist ein höherer Wert normal.",
      tip: vi >= 1.1 ? "An Anstiegen nicht „draufdrücken“ und bergab weitertreten – so wird die Fahrt gleichmäßiger." : "Sehr gut eingeteilt.",
    });
  }
  return list;
}

// Schwimmen: Tempo im Verhältnis zur CSS (Schwellentempo) + Vergleich.
function miSwimPace(w, all, profile) {
  const sec = w.pace_min_per_100m ? paceToSeconds(w.pace_min_per_100m) : null;
  if (sec == null) return null;
  const css = profile && profile.swimCss ? paceToSeconds(String(profile.swimCss)) : null;
  const base = miBaseline(w, all, o => (o.pace_min_per_100m ? paceToSeconds(o.pace_min_per_100m) : null));
  const cmpDef = { unit: "", dec: 0, better: "lower", noise: 2 };
  let compare = null;
  if (base) {
    compare = miCompare(cmpDef, sec, base, w);
    compare.baseText = `sonst Ø ${secondsToPace(base.avg)} min/100 m (letzte ${base.n} Schwimmeinheiten)`;
  }
  if (!css) {
    if (!compare) return null;
    return { id: "swim_pace", label: "Schwimmtempo", value: sec, valueText: `${w.pace_min_per_100m} min/100 m`, level: "ok", verdict: null, rangeText: "Tipp: CSS im Profil eintragen für eine Einordnung", scale: null, compare,
      explain: "Dein Tempo pro 100 m im Vergleich zu früheren Einheiten.", tip: "Mit einem CSS-Test weißt du, welches Tempo für dich locker, mittel oder hart ist." };
  }
  const d = sec - css;
  const bands = [[-20, -2, "i5", "schneller als CSS"], [-2, 6, "i4", "Schwelle (CSS)"], [6, 15, "i3", "zügig / Ausdauer"], [15, 40, "i2", "locker"]];
  const v = Math.max(-20, Math.min(39, d));
  const band = miBand(bands, v);
  return {
    id: "swim_pace", label: "Schwimmtempo", value: sec, valueText: `${w.pace_min_per_100m} min/100 m (${d >= 0 ? "+" : "−"}${Math.abs(Math.round(d))} s zur CSS)`,
    level: band[2], verdict: band[3],
    rangeText: `deine CSS: ${secondsToPace(css)} min/100 m`,
    scale: miScale(bands, v), compare,
    explain: "Die CSS ist dein Schwellentempo: so schnell kannst du etwa 30 Minuten schwimmen. Lockeres Ausdauerschwimmen liegt etwa 10–15 Sekunden pro 100 m darüber. Der Ø enthält auch Pausen am Rand.",
    tip: d < 6 ? "Viel Tempo heute – gönn dir in der nächsten Einheit ruhige Technikbahnen." : "Passt für eine Ausdauereinheit.",
  };
}

// Aerober Trainingseffekt von Garmin (0-5): was die Einheit bewirkt hat.
function miTrainingEffect(w) {
  if (w.aerobic_te == null) return null;
  const bands = [[0, 1, "i1", "keine Wirkung"], [1, 2, "i2", "Erholung"], [2, 3, "i3", "erhaltend"], [3, 4, "i4", "verbessernd"], [4, 5, "i5", "stark verbessernd"], [5, 5.01, "i5", "sehr hohe Belastung"]];
  const band = miBand(bands, Math.min(5, w.aerobic_te));
  const planned = miPlannedIntensity(w);
  const plan = planned === "leicht" && w.aerobic_te >= 3.5 ? { level: "warn", text: "für eine lockere Einheit recht hoch" } : null;
  return {
    id: "aerobic_te", label: "Trainingseffekt (aerob)", value: w.aerobic_te, valueText: `${miFmt(w.aerobic_te, 1)} von 5`,
    level: band[2], verdict: band[3], plan,
    rangeText: "locker: 2–3 · Reiz für mehr Ausdauer: 3–4",
    scale: miScale(bands.slice(0, 5), Math.min(4.99, w.aerobic_te)), compare: null,
    explain: "Garmins Einschätzung, wie stark die Einheit deine Ausdauer anregt. Lockere Tage liegen bei 2–3, Schlüsseleinheiten bei 3–4. Werte über 4 brauchen danach mehr Erholung.",
    tip: plan ? "Lockere Tage dürfen sich leicht anfühlen – genau dann wirken die harten Tage besser." : "Passt.",
  };
}

// Alle Einordnungen einer Einheit. chart: unter welchem Diagramm sie steht.
function workoutMetricInsights(w, all, profile) {
  if (!w) return [];
  all = all || (typeof ALL !== "undefined" ? ALL : []);
  profile = profile || (typeof athleteProfile !== "undefined" ? athleteProfile : {}) || {};
  const g = typeof sportGroup === "function" ? sportGroup(w.sport) : w.sport;
  const out = [];
  const add = (ins, chart) => { if (ins) out.push({ ...ins, chart }); };
  if (g === "Laufen" || w.sport_raw === "running") {
    add(miFromDef("run_cadence", w, all), "cad");
    add(miFromDef("run_gct", w, all), "gct");
    add(miFromDef("run_vr", w, all), "vr");
    add(miFromDef("run_vo", w, all), "vr");
    add(miHrAtPace(w, all), "pace");
  } else if (g === "Rad") {
    add(miFromDef("ride_cadence", w, all), "cad");
    miRidePower(w, profile).forEach(ins => add(ins, "power"));
    add(miHrAtPace(w, all), (w.normalized_power_w ?? w.avg_power_w) ? "power" : "pace");
  } else if (g === "Schwimmen") {
    add(miSwimPace(w, all, profile), "pace");
    add(miFromDef("swim_swolf", w, all), "pace");
    if (w.avg_stroke_rate != null) add(miFromDef("swim_stroke", w, all), "pace");
  }
  add(miHrZone(w, profile), "hrprofile");
  add(miDecoupling(w), "hr");
  add(miTrainingEffect(w), "hrprofile");
  return out;
}

// Eine Zeile je Wert für die KI ("Einordnung der Messwerte").
function workoutMetricInsightLines(w, all, profile) {
  return workoutMetricInsights(w, all, profile).map(ins => {
    const bits = [`${ins.label}: ${ins.valueText}`];
    if (ins.verdict) bits.push(`Bereich: ${ins.verdict}${ins.rangeText ? ` (${ins.rangeText})` : ""}`);
    if (ins.plan) bits.push(ins.plan.text);
    if (ins.compare) bits.push(`${ins.compare.text} – ${ins.compare.baseText}`);
    return `- ${bits.join("; ")}`;
  });
}
