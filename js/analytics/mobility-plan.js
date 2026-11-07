// Stellt eine Mobility-Einheit zusammen - immer nur aus der Übungs-Sammlung
// (js/data/mobility-exercises.js), damit jede Übung eine Zeichnung hat.
//
// Zwei Wege mit demselben Ergebnis-Format:
//   buildMobilitySession()   feste Regeln, sofort und ohne Internet
//   Claude (js/components/mobility.js) mit buildMobilityPrompt() und
//   parseMobilityResponse() - Claude darf nur erlaubte Übungen wählen.
//
// Ergebnis: { title, intro, minutes, focus: [Bereiche], source, createdAt,
//             exercises: [{ id, seconds, note }] }

// Welche Bereiche eine Sportart besonders beansprucht.
const MOBILITY_SPORT_AREAS = {
  Laufen: ["calf", "hamstring", "hip", "glute"],
  Rad: ["hip", "quad", "lowback", "upperback"],
  Schwimmen: ["shoulder", "upperback"],
};
const MOBILITY_TRANSITION_S = 10;

// Übungen, die zum Profil passen: Hilfsmittel da, nichts Ausgeschlossenes,
// nichts, was zuletzt weh getan hat; bei Beschwerden nur sanfte Übungen.
function allowedMobilityExercises(tp, painfulIds) {
  const pain = new Set(tp.painAreas);
  return MOBILITY_EXERCISES.filter(ex =>
    ex.equipment.every(eq => tp.equipment.includes(eq)) &&
    !ex.avoid.some(a => tp.avoid.includes(a)) &&
    !(painfulIds && painfulIds.has(ex.id)) &&
    !(ex.level > 1 && ex.areas.some(a => pain.has(a))));
}

// Sportarten der letzten 2 Tage (für "nach deinem Lauf gestern").
function recentMobilitySports(workouts, today) {
  const out = [];
  (workouts || []).forEach(w => {
    const d = w.date ? String(w.date).slice(0, 10) : null;
    if (!d || !MOBILITY_SPORT_AREAS[w.sport]) return;
    const age = daysBetween(d, today);
    if (age >= 0 && age <= 1 && !out.some(x => x.sport === w.sport)) out.push({ sport: w.sport, daysAgo: age });
  });
  return out;
}

// Kleiner fester Zufall je Tag, damit die Auswahl abwechselt, aber an einem
// Tag gleich bleibt (kein Flackern beim Neuzeichnen).
function mobilityDayHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

// options: { minutes, focus: [Bereiche] | null, tp, painfulIds, recent: [{sport}],
//            lastIds: [id], trend: -1|0|1, today }
function buildMobilitySession(options) {
  const { minutes = 15, tp, painfulIds = new Set(), recent = [], lastIds = [], trend = 0, today = todayStr() } = options;
  const focus = options.focus && options.focus.length ? options.focus : null;
  const allowed = allowedMobilityExercises(tp, painfulIds);
  if (!allowed.length) return null;

  const wantAreas = new Map(); // Bereich -> Gewicht
  const bump = (a, w) => wantAreas.set(a, (wantAreas.get(a) || 0) + w);
  (focus || tp.focusAreas).forEach(a => bump(a, focus ? 4 : 2.5));
  recent.forEach(r => (MOBILITY_SPORT_AREAS[r.sport] || []).forEach(a => bump(a, r.daysAgo === 0 ? 2 : 1.5)));
  if (!wantAreas.size) Object.keys(MOBILITY_AREAS).forEach(a => bump(a, 1));

  const score = ex => {
    let s = ex.areas.reduce((sum, a, i) => sum + (wantAreas.get(a) || 0) * (i === 0 ? 1 : 0.6), 0);
    if (recent.some(r => ex.sports.includes(r.sport))) s += 0.5;
    if (lastIds.includes(ex.id)) s -= 1.5;               // Abwechslung
    if (trend < 0 && ex.level >= 2) s -= 1.5;             // zuletzt zu schwer
    if (trend > 0 && ex.level === 1) s -= 0.5;            // zuletzt zu leicht
    if (tp.painAreas.some(a => ex.areas.includes(a))) s -= 0.3; // sanft, aber nicht zu viel davon
    return s + mobilityDayHash(today + ex.id) * 0.8;
  };
  const ranked = allowed.map(ex => ({ ex, s: score(ex) })).sort((a, b) => b.s - a.s);

  const budget = minutes * 60;
  const picked = [];
  let used = 0;
  const areaCount = new Map();
  // Lieber wenige Übungen in Ruhe als viele hektisch: ca. eine je 2 Minuten.
  const maxCount = Math.max(3, Math.round(minutes / 2.2));
  let cap = maxCount;
  const fits = ex => picked.length < cap && used + mobilityExerciseSeconds(ex) + MOBILITY_TRANSITION_S <= budget + 20;
  const take = ex => {
    picked.push(ex);
    used += mobilityExerciseSeconds(ex) + MOBILITY_TRANSITION_S;
    ex.areas.forEach(a => areaCount.set(a, (areaCount.get(a) || 0) + 1));
  };

  // 1. Zum Aufwärmen eine sanfte Bewegungsübung.
  const warm = ranked.find(r => r.ex.kind === "reps" && r.ex.level === 1);
  if (warm && fits(warm.ex)) take(warm.ex);
  // 2. Danach nach Punkten - kein Bereich mehr als dreimal.
  ranked.forEach(({ ex }) => {
    if (picked.includes(ex) || !fits(ex)) return;
    if ((areaCount.get(ex.areas[0]) || 0) >= (focus && focus.includes(ex.areas[0]) ? 4 : 3)) return;
    take(ex);
  });
  if (!picked.length) take(ranked[0].ex);
  // Viele kurze Übungen erwischt (ohne Seitenwechsel)? Dann darf es eine mehr sein.
  const maxStretch = picked.reduce((t, ex) => t + ((ex.kind === "hold" ? 75 : 60) - ex.seconds) * (ex.sides ? 2 : 1), 0);
  if (used + maxStretch < budget * 0.85) {
    cap = maxCount + 2;
    ranked.forEach(({ ex }) => { if (!picked.includes(ex) && fits(ex)) take(ex); });
  }

  // Aufwärmen bleibt vorn, dann Bewegung, dann Halten - die sanftesten zum Schluss.
  const order = ex => (ex.kind === "reps" ? 0 : ex.level >= 2 ? 1 : 2);
  const [first, ...rest] = picked;
  picked.splice(0, picked.length, first, ...rest.sort((a, b) => order(a) - order(b)));

  const areas = [...wantAreas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a);
  // Übrige Zeit auf die Übungen verteilen (halten bis 75 s, Bewegung bis 60 s je Seite).
  const items = picked.map(ex => ({ ex, seconds: ex.seconds }));
  let left = budget - used;
  for (let round = 0; left > 0 && round < 12; round++) {
    let grew = false;
    items.forEach(it => {
      if (it.seconds >= (it.ex.kind === "hold" ? 75 : 60)) return;
      const cost = it.ex.sides ? 10 : 5;
      if (left < cost) return;
      it.seconds += 5;
      left -= cost;
      used += cost;
      grew = true;
    });
    if (!grew) break;
  }

  const exercises = fitMobilityExercises(items.map(it => ({ id: it.ex.id, seconds: it.seconds, note: null })), minutes, allowed);
  return {
    title: mobilitySessionTitle(areas, minutes),
    intro: mobilitySessionReason(focus, recent, tp),
    minutes: Math.max(1, Math.round(mobilityTotalSeconds(exercises) / 60)),
    focus: areas,
    source: "rules",
    createdAt: new Date().toISOString(),
    exercises,
  };
}

function mobilitySessionTitle(areas, minutes) {
  const names = areas.map(a => MOBILITY_AREAS[a]).filter(Boolean);
  return names.length ? `${names.join(" · ")}` : `${minutes} Minuten Beweglichkeit`;
}

function mobilitySessionReason(focus, recent, tp) {
  if (focus) return `Schwerpunkt ${focus.map(a => MOBILITY_AREAS[a]).join(" und ")} – so wie du es ausgewählt hast.`;
  const r = recent[0];
  if (r) {
    const when = r.daysAgo === 0 ? "heute" : "gestern";
    const what = { Laufen: "deinem Lauf", Rad: "deiner Radeinheit", Schwimmen: "dem Schwimmen" }[r.sport];
    return `Passend zu ${what} ${when} – lockert, was dabei am meisten gearbeitet hat.`;
  }
  if (tp.focusAreas.length) return `Für deine Ziele aus dem Trainingsprofil: ${tp.focusAreas.map(a => MOBILITY_AREAS[a]).join(", ")}.`;
  return "Eine ausgewogene Einheit für den ganzen Körper.";
}

/* ------------------------------------------------------------- Claude */

function mobilityResponseSchema(allowedIds) {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      intro: { type: "string" },
      exercises: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: allowedIds },
            seconds: { type: "integer" },
            note: { type: "string" },
          },
          required: ["id", "seconds", "note"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "intro", "exercises"],
    additionalProperties: false,
  };
}

function buildMobilityPrompt({ minutes, focus, allowed, contextLines, recent, history }) {
  const catalog = allowed.map(ex =>
    `- ${ex.id}: ${ex.name} | ${ex.areas.map(a => MOBILITY_AREAS[a]).join(", ")} | Stufe ${ex.level} | ${ex.kind === "hold" ? "halten" : ex.reps + " Wdh."} | ${ex.seconds} s${ex.sides ? " je Seite" : ""}`).join("\n");
  const recentText = recent.length
    ? recent.map(r => `${r.sport} ${r.daysAgo === 0 ? "heute" : "gestern"}`).join(", ")
    : "keine Einheit in den letzten 2 Tagen";
  const lastText = history.slice(-3).map(h => `${h.date}: ${h.title || "Mobility"} (${({ easy: "zu leicht", ok: "passend", hard: "zu schwer" })[h.rating] || "ohne Rückmeldung"})`).join("; ") || "noch keine";
  return `Du bist ein erfahrener Physiotherapeut und Triathlon-Coach. Stelle eine Mobility-Einheit (Beweglichkeit) für genau diese Person zusammen.

Über die Person:
${contextLines.map(l => "- " + l).join("\n")}

Training zuletzt: ${recentText}
Letzte Mobility-Einheiten: ${lastText}
Gewünschte Dauer: ca. ${minutes} Minuten (inkl. ca. ${MOBILITY_TRANSITION_S} s Wechsel je Übung; bei "je Seite" zählt die Zeit doppelt).
${focus && focus.length ? `Gewünschter Schwerpunkt heute: ${focus.map(a => MOBILITY_AREAS[a]).join(", ")}` : "Schwerpunkt: wähle selbst, was heute am sinnvollsten ist."}

Erlaubte Übungen (nur diese ids verwenden, andere gibt es nicht):
${catalog}

Regeln:
- Beginne mit einer sanften Bewegungsübung, ende mit einer ruhigen Halte-Übung.
- Beachte Beschwerden, Ausschlüsse und Rückmeldungen. Bei "zu schwer" sanfter, bei "zu leicht" etwas fordernder.
- seconds = Dauer je Seite. Dehnungen (halten) 30–90 s, Bewegungsübungen so lange wie angegeben bis 60 s.
- WICHTIG: Alle Übungen zusammen müssen ca. ${minutes} Minuten ergeben. Rechne nach: je Übung seconds (bei "je Seite" ×2 + 5 s) + ${MOBILITY_TRANSITION_S} s Wechsel. Lieber weniger Übungen länger halten als viele kurz.
- title: kurz (max. 40 Zeichen), z. B. "Lockere Hüfte nach dem Lauf".
- intro: 1–2 Sätze in einfachem Deutsch, per du, warum diese Einheit heute passt.
- note: ein kurzer persönlicher Tipp je Übung (max. 90 Zeichen) oder leer.
- Reiner Text, kein Markdown.`;
}

// Prüft Claudes Antwort: nur erlaubte Übungen, keine doppelten, Zeiten im Rahmen.
function parseMobilityResponse(text, allowedIds, minutes) {
  let data;
  try {
    const m = String(text).match(/\{[\s\S]*\}/);
    data = JSON.parse(m ? m[0] : text);
  } catch (e) {
    throw new Error("Die Antwort vom KI-Coach war nicht lesbar.");
  }
  const allowed = new Set(allowedIds);
  const seen = new Set();
  const exercises = (Array.isArray(data.exercises) ? data.exercises : []).filter(x => {
    if (!x || !allowed.has(x.id) || seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  }).map(x => ({
    id: x.id,
    seconds: Number(x.seconds) || MOBILITY_BY_ID[x.id].seconds,
    note: x.note ? String(x.note).slice(0, 120) : null,
  }));
  if (exercises.length < 2) throw new Error("Der KI-Coach hat zu wenige passende Übungen geliefert.");
  // Zeiten auf die gewünschte Dauer bringen - der KI-Coach verrechnet sich gern.
  const pool = [...allowed].map(id => MOBILITY_BY_ID[id]).filter(Boolean);
  const fitted = minutes ? fitMobilityExercises(exercises, minutes, pool) : fitMobilityExercises(exercises, mobilityTotalSeconds(exercises) / 60);
  exercises.splice(0, exercises.length, ...fitted);
  const total = mobilityTotalSeconds(exercises);
  return {
    title: String(data.title || "Deine Mobility-Einheit").slice(0, 60),
    intro: String(data.intro || "").slice(0, 300),
    minutes: Math.max(1, Math.round(total / 60)),
    focus: [],
    source: "claude",
    createdAt: new Date().toISOString(),
    exercises,
    wanted: minutes,
  };
}

/* -------------------------------------------- Dauer passend machen */

// Grenzen je Übung (Sekunden je Seite): Dehnungen unter 30 s bringen kaum
// etwas, Bewegungsübungen brauchen mindestens ihre Zeit für die Wiederholungen.
function mobilitySecondsRange(ex) {
  return ex.kind === "hold" ? [30, 90] : [Math.max(20, ex.seconds), 60];
}

function mobilityTotalSeconds(exercises) {
  return exercises.reduce((s, x) => {
    const ex = MOBILITY_BY_ID[x.id];
    return ex ? s + mobilityExerciseSeconds(ex, x.seconds) + MOBILITY_TRANSITION_S : s;
  }, 0);
}

// Bringt die Zeiten einer Einheit auf die gewünschte Dauer (±8 %) - egal ob
// sie von den Regeln, vom KI-Coach oder aus einem KI-Trainingsplan kommt:
// erst Zeiten je Übung strecken/kürzen (in den Grenzen oben), reicht das
// nicht, passende Übungen aus "pool" ergänzen bzw. Übungen weglassen.
// Aufwärmen (erste) und ruhiger Abschluss (letzte) bleiben stehen.
// exercises: [{ id, seconds, note }] (nur Übungen aus der Sammlung).
function fitMobilityExercises(exercises, minutes, pool = []) {
  const list = exercises.filter(x => x && MOBILITY_BY_ID[x.id]).map(x => {
    const ex = MOBILITY_BY_ID[x.id];
    const [lo, hi] = mobilitySecondsRange(ex);
    const sec = Math.round((Number(x.seconds) || ex.seconds) / 5) * 5;
    return { ...x, seconds: Math.min(hi, Math.max(lo, sec)) };
  });
  const target = Math.round(Number(minutes) * 60);
  if (!list.length || !(target > 0)) return list;
  const low = target * 0.92, high = target * 1.08;
  const total = () => mobilityTotalSeconds(list);
  // Schrittweise allen gleich viel geben bzw. nehmen - Halten zuerst.
  const step = (dir, cap = Infinity) => {
    let changed = false;
    for (const kind of ["hold", "reps"]) {
      list.forEach(x => {
        const ex = MOBILITY_BY_ID[x.id];
        if (ex.kind !== kind || (dir > 0 ? total() >= low : total() <= high)) return;
        const [lo, hi] = mobilitySecondsRange(ex);
        const next = x.seconds + dir * 5;
        if (next < lo || next > Math.min(hi, cap)) return;
        x.seconds = next;
        changed = true;
      });
      if (dir > 0 ? total() >= low : total() <= high) break;
    }
    return changed;
  };
  // Erst bis 60 s je Seite strecken, dann lieber eine Übung mehr, erst
  // danach länger halten (bis 90 s).
  for (let i = 0; i < 40 && total() < low && step(1, 60); i++);
  // Zu kurz: Übungen ergänzen, am liebsten für dieselben Bereiche.
  const used = new Set(list.map(x => x.id));
  const areas = new Set(list.flatMap(x => MOBILITY_BY_ID[x.id].areas));
  // Keine Variante einer schon gewählten Übung (z. B. Hüftbeuger kniend + im Stehen),
  // und nicht zu oft derselbe Hauptbereich.
  const family = id => id.split("-")[0];
  const families = new Set(list.map(x => family(x.id)));
  const primary = a => list.filter(x => MOBILITY_BY_ID[x.id].areas[0] === a).length;
  const extra = pool.filter(ex => ex && MOBILITY_BY_ID[ex.id] && !used.has(ex.id) && !families.has(family(ex.id)))
    .map(ex => ({ ex, s: ex.areas.filter(a => areas.has(a)).length + (ex.kind === "hold" ? 0.5 : 0) - (ex.level - 1) * 0.3 - primary(ex.areas[0]) * 0.8 }))
    .sort((a, b) => b.s - a.s).map(r => r.ex);
  while (total() < low && extra.length) {
    const ex = extra.shift();
    if (families.has(family(ex.id))) continue;
    families.add(family(ex.id));
    const [, hi] = mobilitySecondsRange(ex);
    const gap = target - total() - MOBILITY_TRANSITION_S - (ex.sides ? 5 : 0);
    const per = Math.round(Math.min(hi, 60, Math.max(mobilitySecondsRange(ex)[0], gap / (ex.sides ? 2 : 1))) / 5) * 5;
    list.splice(Math.max(1, list.length - 1), 0, { id: ex.id, seconds: per, note: null });
  }
  for (let i = 0; i < 40 && total() < low && step(1); i++);
  for (let i = 0; i < 40 && total() > high && step(-1); i++);
  // Immer noch zu lang: von hinten (vor dem Abschluss) Übungen weglassen.
  while (total() > high && list.length > 2) {
    const without = list.filter((_, i) => i !== list.length - 2);
    if (mobilityTotalSeconds(without) < low) break;
    list.splice(list.length - 2, 1);
  }
  return list;
}

// Übungen, die für diese Person erlaubt sind (zum Ergänzen) - leer, wenn das
// Trainingsprofil nicht geladen ist (z. B. in Tests ohne Profil).
function mobilityFillPool() {
  try {
    if (typeof trainingProfile !== "function" || typeof allowedMobilityExercises !== "function") return [];
    const painful = typeof mobilityPainfulIds === "function" ? mobilityPainfulIds(todayStr()) : new Set();
    return allowedMobilityExercises(trainingProfile(), painful);
  } catch (e) {
    return [];
  }
}

function mobilitySessionSeconds(session) {
  return mobilityTotalSeconds(session.exercises);
}

// Für den Kalender: Mobility-Einheit -> geplante Einheit (js/data/planned-workouts.js).
function mobilitySessionToPlanned(session, date) {
  return {
    date,
    sport: "Mobility",
    title: session.title,
    duration_min: Math.max(5, Math.round(mobilitySessionSeconds(session) / 60)),
    intensity: "leicht",
    description: session.intro || null,
    exercises: session.exercises.filter(x => MOBILITY_BY_ID[x.id]).map(x => {
      const ex = MOBILITY_BY_ID[x.id];
      return { id: x.id, name: ex.name, sets: null, reps: ex.kind === "reps" ? `${mobilityRepsFor(ex, x.seconds)}×${ex.sides ? " je Seite" : ""}` : `${x.seconds} s${ex.sides ? " je Seite" : ""}`, note: x.note || null, seconds: x.seconds };
    }),
    source: "mobility",
  };
}

// Umgekehrt: geplante Einheit mit Übungen aus der Sammlung -> abspielbare Einheit.
function plannedToMobilitySession(pw) {
  const raw = (pw.exercises || []).filter(x => x && MOBILITY_BY_ID[x.id]).map(x => ({
    id: x.id,
    seconds: Number(x.seconds) > 0 ? Number(x.seconds) : MOBILITY_BY_ID[x.id].seconds,
    note: x.note || null,
  }));
  if (!raw.length) return null;
  // Ältere Einheiten aus KI-Plänen waren oft viel kürzer als geplant: beim
  // Abspielen auf die geplante Dauer bringen.
  const exercises = Number(pw.duration_min) > 0 ? fitMobilityExercises(raw, pw.duration_min, mobilityFillPool()) : raw;
  return { title: pw.title || "Mobility", intro: pw.description || "", minutes: pw.duration_min, focus: [], source: "plan", plannedId: pw.id, exercises };
}
