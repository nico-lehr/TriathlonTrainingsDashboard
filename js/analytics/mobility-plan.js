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

  return {
    title: mobilitySessionTitle(areas, minutes),
    intro: mobilitySessionReason(focus, recent, tp),
    minutes: Math.max(1, Math.round(used / 60)),
    focus: areas,
    source: "rules",
    createdAt: new Date().toISOString(),
    exercises: items.map(it => ({ id: it.ex.id, seconds: it.seconds, note: null })),
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
- seconds = Dauer je Seite, zwischen 20 und 90.
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
    throw new Error("Die Antwort von Claude war nicht lesbar.");
  }
  const allowed = new Set(allowedIds);
  const seen = new Set();
  const exercises = (Array.isArray(data.exercises) ? data.exercises : []).filter(x => {
    if (!x || !allowed.has(x.id) || seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  }).map(x => ({
    id: x.id,
    seconds: Math.min(90, Math.max(20, Math.round(Number(x.seconds) || MOBILITY_BY_ID[x.id].seconds))),
    note: x.note ? String(x.note).slice(0, 120) : null,
  }));
  if (exercises.length < 2) throw new Error("Claude hat zu wenige passende Übungen geliefert.");
  // Deutlich zu kurz geraten? Halte-Zeiten anheben (höchstens 90 s), damit
  // die gewünschte Dauer ungefähr stimmt.
  const sum = () => exercises.reduce((s, x) => s + mobilityExerciseSeconds(MOBILITY_BY_ID[x.id], x.seconds) + MOBILITY_TRANSITION_S, 0);
  if (minutes && sum() < minutes * 60 * 0.8) {
    for (let round = 0; round < 14 && sum() < minutes * 60 * 0.95; round++) {
      exercises.forEach(x => { if (MOBILITY_BY_ID[x.id].kind === "hold" && x.seconds < 90) x.seconds += 5; });
    }
  }
  const total = exercises.reduce((s, x) => s + mobilityExerciseSeconds(MOBILITY_BY_ID[x.id], x.seconds) + MOBILITY_TRANSITION_S, 0);
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

function mobilitySessionSeconds(session) {
  return session.exercises.reduce((s, x) => {
    const ex = MOBILITY_BY_ID[x.id];
    return ex ? s + mobilityExerciseSeconds(ex, x.seconds) + MOBILITY_TRANSITION_S : s;
  }, 0);
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
      return { id: x.id, name: ex.name, sets: null, reps: ex.kind === "reps" ? `${ex.reps}×` : `${x.seconds} s${ex.sides ? " je Seite" : ""}`, note: x.note || null, seconds: x.seconds };
    }),
    source: "mobility",
  };
}

// Umgekehrt: geplante Einheit mit Übungen aus der Sammlung -> abspielbare Einheit.
function plannedToMobilitySession(pw) {
  const exercises = (pw.exercises || []).filter(x => x && MOBILITY_BY_ID[x.id]).map(x => ({
    id: x.id,
    seconds: Number(x.seconds) > 0 ? Math.min(90, Math.max(15, Math.round(Number(x.seconds)))) : MOBILITY_BY_ID[x.id].seconds,
    note: x.note || null,
  }));
  if (!exercises.length) return null;
  return { title: pw.title || "Mobility", intro: pw.description || "", minutes: pw.duration_min, focus: [], source: "plan", plannedId: pw.id, exercises };
}
