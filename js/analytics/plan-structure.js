// Wochenplan-Struktur: sorgt dafür, dass ein KI-Plan zu den Vorgaben aus
// Einstellungen → Training & Planung → Wochenplan passt. Die KI bekommt die
// Vorgaben zwar im Prompt (buildPlanStructureRule, js/ai/prompts.js), hält
// sich aber nicht immer daran - deshalb prüft und korrigiert dieser Baustein
// danach fest (deterministisch, ohne KI):
//   - nur an Trainingstagen,
//   - Schwimmen nur an Schwimmtagen und an jedem Schwimmtag eine Schwimmeinheit,
//   - höchstens N Haupttrainings (Schwimmen/Rad/Laufen) pro Tag,
//   - Kraft/Mobility: höchstens eine zusätzlich am Tag ODER nur an eigenen Tagen,
//   - Kraft und Mobility höchstens so oft pro Woche wie gewünscht.
// Verschoben oder gestrichen werden nur die gerade neu geplanten Einheiten
// (mutableIds) - was schon im Plan steht oder manuell eingetragen ist, bleibt.
// Kein UI, kein Speicherzugriff - testbar ohne Browser (tests/js/plan-structure.test.js).

const PLAN_STRUCT_DOW = ["so", "mo", "di", "mi", "do", "fr", "sa"];
const PLAN_STRUCT_EXTRAS = ["Kraft", "Mobility"];
const PLAN_STRUCT_SWIM_MAX = 60;       // ergänzte Schwimmeinheit höchstens so lang
const PLAN_STRUCT_SWIM_DEFAULT = 45;
const PLAN_STRUCT_STRENGTH_DEFAULT = 2;

const planStructWeekday = key => PLAN_STRUCT_DOW[new Date(key + "T00:00:00").getDay()];
const planStructIsExtra = p => PLAN_STRUCT_EXTRAS.includes(p.sport);

// Die Vorgaben aus Athletenprofil + Trainingsprofil, bereinigt.
function planStructureSettings(profile, tp) {
  const p = profile || {}, t = tp || {};
  const days = arr => (Array.isArray(arr) ? arr : []).filter(d => PLAN_STRUCT_DOW.includes(d));
  const trainingDays = days(p.trainingDays);
  const inTraining = d => !trainingDays.length || trainingDays.includes(d);
  return {
    trainingDays,
    swimDays: days(p.swimDays).filter(inTraining),
    longDays: days(p.longDays).filter(inTraining),
    mainPerDay: Number(p.mainPerDay) === 2 ? 2 : 1,
    extrasSameDay: p.extrasMode !== "own",
    strengthPerWeek: p.includeStrength ? ([1, 2, 3].includes(Number(p.strengthPerWeek)) ? Number(p.strengthPerWeek) : PLAN_STRUCT_STRENGTH_DEFAULT) : 0,
    mobilityPerWeek: p.includeMobility ? ([1, 2, 3, 4, 5].includes(Number(t.mobilityPerWeek)) ? Number(t.mobilityPerWeek) : 2) : 0,
    typicalMin: Number(p.typicalSessionMin) > 0 ? Number(p.typicalSessionMin) : PLAN_STRUCT_SWIM_DEFAULT,
  };
}

// Darf eine Einheit `p` (Sportart, Intensität) an Tag `k` stehen, wenn dort
// schon `others` stehen? Nur die Struktur - harte Tage prüft plan-rules.js.
function planStructDayAccepts(s, k, p, others) {
  const wd = planStructWeekday(k);
  if (s.trainingDays.length && !s.trainingDays.includes(wd)) return false;
  if (others.some(o => o.sport === p.sport)) return false;
  const mains = others.filter(o => !planStructIsExtra(o)).length;
  const extras = others.filter(planStructIsExtra).length;
  if (planStructIsExtra(p)) return extras < 1 && (s.extrasSameDay || !mains);
  if (p.sport === "Schwimmen" && s.swimDays.length && !s.swimDays.includes(wd)) return false;
  return mains < s.mainPerDay && (s.extrasSameDay || !extras);
}

// o: { settings, mutableIds (Set/Array), from, to, todayKey, goal, defaults }
// Ergebnis: { list, changes: [Text] }
function planStructureApply(list, o) {
  const s = o.settings;
  const mutable = new Set(o.mutableIds || []);
  const start = o.from > o.todayKey ? o.from : o.todayKey;
  const raceDay = o.goal && o.goal.date ? o.goal.date : null;
  const goalSports = (o.goal && PLAN_GOAL_SPORTS[o.goal.sport]) || ["Schwimmen", "Rad", "Laufen"];
  let cur = (list || []).map(p => ({ ...p }));
  const changes = [];

  const active = p => p.status !== "uebersprungen";
  const isMut = p => mutable.has(p.id) && p.status === "geplant" && p.date >= start && p.date <= o.to;
  const onDay = (k, except) => cur.filter(p => p.date === k && active(p) && p !== except);
  const inWindow = k => k >= start && k <= o.to && k !== raceDay;
  const label = k => planDayLabel(k);
  const title = p => `„${p.title || p.sport}“`;
  const dist = (a, b) => Math.abs(Date.parse(a) - Date.parse(b));
  const hardNear = (k, p) => [planShiftDay(k, -1), k, planShiftDay(k, 1)].some(d => onDay(d, p).some(planIsHard));
  const isSwimDay = k => s.swimDays.includes(planStructWeekday(k));
  const drop = (p, why) => { cur = cur.filter(x => x !== p); changes.push(`${title(p)} (${label(p.date)}) gestrichen – ${why}.`); };

  // Bester freier Tag in derselben Woche: nah, nicht neben einer harten
  // Einheit (wenn selbst hart), Haupttrainings möglichst nicht auf einen
  // Schwimmtag, der noch keine Schwimmeinheit hat.
  function target(p) {
    const swimTaken = k => onDay(k, p).some(x => x.sport === "Schwimmen");
    const score = k => (planIsHard(p) && hardNear(k, p) ? 4 : 0)
      + (!planStructIsExtra(p) && p.sport !== "Schwimmen" && isSwimDay(k) && !swimTaken(k) ? 2 : 0);
    return planWeekDays(planWeekKey(p.date))
      .filter(k => k !== p.date && inWindow(k) && planStructDayAccepts(s, k, p, onDay(k, p)))
      .sort((a, b) => score(a) - score(b) || dist(a, p.date) - dist(b, p.date) || a.localeCompare(b))[0] || null;
  }
  function moveOrDrop(p, why) {
    const k = target(p);
    if (!k) return drop(p, why);
    changes.push(`${title(p)} von ${label(p.date)} auf ${label(k)} verschoben – ${why}.`);
    p.date = k;
    if (typeof plannedWorkoutPhase === "function") p.phase = plannedWorkoutPhase(p);
  }
  const days = () => [...new Set(cur.filter(isMut).map(p => p.date))].sort();

  // 1. Kraft/Mobility nicht öfter als gewünscht pro Woche (spätere zuerst weg).
  [["Kraft", s.strengthPerWeek], ["Mobility", s.mobilityPerWeek]].forEach(([sport, max]) => {
    const weeks = [...new Set(cur.filter(p => isMut(p) && p.sport === sport).map(p => planWeekKey(p.date)))];
    weeks.forEach(wk => {
      const inWeek = cur.filter(p => p.sport === sport && active(p) && planWeekKey(p.date) === wk).sort((a, b) => a.date.localeCompare(b.date));
      let over = inWeek.length - max;
      inWeek.filter(isMut).reverse().forEach(p => {
        if (over-- > 0) drop(p, max ? `höchstens ${max}× ${sport} pro Woche` : `${sport} ist in deinen Einstellungen nicht eingeplant`);
      });
    });
  });

  // 2. Nichts an Tagen, die keine Trainingstage sind.
  if (s.trainingDays.length) {
    cur.filter(p => isMut(p) && !s.trainingDays.includes(planStructWeekday(p.date)))
      .forEach(p => moveOrDrop(p, `${label(p.date)} ist kein Trainingstag`));
  }

  // 3. Schwimmen nur an Schwimmtagen - erst auf einen freien Schwimmtag
  // verschieben, sonst mit einem Haupttraining dort tauschen.
  if (s.swimDays.length) {
    cur.filter(p => isMut(p) && p.sport === "Schwimmen" && !isSwimDay(p.date)).forEach(p => {
      const why = "Schwimmen nur an deinen Schwimmtagen";
      if (target(p)) return moveOrDrop(p, why);
      const swap = planWeekDays(planWeekKey(p.date))
        .filter(k => isSwimDay(k) && inWindow(k) && !onDay(k).some(x => x.sport === "Schwimmen"))
        .map(k => onDay(k).find(x => isMut(x) && !planStructIsExtra(x)))
        .filter(x => x && planStructDayAccepts(s, p.date, x, onDay(p.date, p).filter(y => y !== x)))
        .sort((a, b) => dist(a.date, p.date) - dist(b.date, p.date))[0];
      if (!swap) return drop(p, why);
      changes.push(`${title(p)} (${label(p.date)}) und ${title(swap)} (${label(swap.date)}) getauscht – ${why}.`);
      [p.date, swap.date] = [swap.date, p.date];
      if (typeof plannedWorkoutPhase === "function") { p.phase = plannedWorkoutPhase(p); swap.phase = plannedWorkoutPhase(swap); }
    });
  }

  // 4. Pro Tag höchstens N Haupttrainings, keine Sportart doppelt,
  // Kraft/Mobility höchstens einmal bzw. nur an eigenen Tagen.
  days().forEach(k => {
    const here = () => onDay(k);
    const mains = () => here().filter(p => !planStructIsExtra(p));
    // Zuerst die kürzere/leichtere Einheit verschieben; am Schwimmtag bleibt Schwimmen.
    const pick = list => list.filter(isMut).sort((a, b) =>
      (a.sport === "Schwimmen" && isSwimDay(k) ? 1 : 0) - (b.sport === "Schwimmen" && isSwimDay(k) ? 1 : 0)
      || (planIsHard(a) ? 1 : 0) - (planIsHard(b) ? 1 : 0) || (a.duration_min || 0) - (b.duration_min || 0))[0];
    [...new Set(here().map(p => p.sport))].forEach(sport => {
      const same = here().filter(p => p.sport === sport);
      same.filter(isMut).slice(0, same.length - 1).forEach(p => moveOrDrop(p, `zweimal ${sport} am selben Tag`));
    });
    while (mains().length > s.mainPerDay) {
      const p = pick(mains());
      if (!p) break;
      moveOrDrop(p, `höchstens ${s.mainPerDay === 1 ? "ein Haupttraining" : `${s.mainPerDay} Haupttrainings`} pro Tag`);
    }
    const extras = () => here().filter(planStructIsExtra);
    if (!s.extrasSameDay && mains().length) {
      extras().filter(isMut).forEach(p => moveOrDrop(p, "Kraft und Mobility an eigenen Tagen"));
    }
    while (extras().length > 1) {
      const p = pick(extras());
      if (!p) break;
      moveOrDrop(p, "höchstens eine Kraft- oder Mobility-Einheit pro Tag");
    }
  });

  // 5. Jeder Schwimmtag bekommt eine Schwimmeinheit (nur bei Ziel mit Schwimmen):
  // ergänzen, wenn noch Platz ist, sonst ein neu geplantes Haupttraining dort
  // verschieben oder in lockeres Schwimmen umwandeln.
  if (s.swimDays.length && goalSports.includes("Schwimmen")) {
    for (let k = start; k <= o.to; k = planShiftDay(k, 1)) {
      if (!isSwimDay(k) || !inWindow(k) || (raceDay && k === planShiftDay(raceDay, -1))) continue;
      if (onDay(k).some(p => p.sport === "Schwimmen")) continue;
      // Tage ganz ohne neue Einheit hat die KI bewusst frei gelassen (oder sie
      // gehören zum Bestand) - dort füllt der Plan-Check nach seinen Regeln.
      const fresh = onDay(k).filter(isMut);
      if (!fresh.length) continue;
      const swim = { sport: "Schwimmen", intensity: "leicht" };
      let dur = Math.min(PLAN_STRUCT_SWIM_MAX, s.typicalMin);
      if (!planStructDayAccepts(s, k, swim, onDay(k))) {
        const m = fresh.filter(p => !planStructIsExtra(p)).sort((a, b) => (planIsHard(a) ? 1 : 0) - (planIsHard(b) ? 1 : 0) || (a.duration_min || 0) - (b.duration_min || 0))[0];
        if (!m) continue;
        const to = target(m);
        // Eine harte Einheit ist wertvoller als ein lockerer Lauf/Radtag an
        // einem anderen Tag der Woche - dann lieber diesen ersetzen.
        const easy = !to && planIsHard(m) ? planWeekDays(planWeekKey(k))
          .filter(d => d !== k && inWindow(d) && !isSwimDay(d) && !s.longDays.includes(planStructWeekday(d)))
          .map(d => onDay(d).find(x => isMut(x) && !planStructIsExtra(x) && x.sport !== "Schwimmen" && planIsEasy(x)))
          .filter(x => x && ![planShiftDay(x.date, -1), x.date, planShiftDay(x.date, 1)].some(d => onDay(d).some(y => y !== x && y !== m && planIsHard(y)))
            && planStructDayAccepts(s, x.date, m, onDay(x.date, x)))
          .sort((a, b) => dist(a.date, k) - dist(b.date, k))[0] : null;
        if (to) {
          changes.push(`${title(m)} von ${label(k)} auf ${label(to)} verschoben – ${label(k)} ist dein Schwimmtag.`);
          m.date = to;
          if (typeof plannedWorkoutPhase === "function") m.phase = plannedWorkoutPhase(m);
        } else if (easy) {
          changes.push(`${title(m)} von ${label(k)} auf ${label(easy.date)} verschoben, dafür entfällt ${title(easy)} – ${label(k)} ist dein Schwimmtag.`);
          m.date = easy.date;
          if (typeof plannedWorkoutPhase === "function") m.phase = plannedWorkoutPhase(m);
          cur = cur.filter(x => x !== easy);
        } else {
          dur = Math.min(PLAN_STRUCT_SWIM_MAX, Math.max(30, Math.round((m.duration_min || dur) / 5) * 5));
          changes.push(`${title(m)} (${label(k)}) wird zu lockerem Schwimmen – das ist dein Schwimmtag.`);
          cur = cur.filter(x => x !== m);
        }
        if (!planStructDayAccepts(s, k, swim, onDay(k))) continue;
      } else {
        changes.push(`${label(k)}: Schwimmen ergänzt – das ist dein Schwimmtag.`);
      }
      const entry = {
        ...(o.defaults || {}), date: k, sport: "Schwimmen", title: "Lockeres Schwimmen", duration_min: dur, intensity: "leicht",
        description: "Ruhig und technisch sauber schwimmen, du kannst gleichmäßig atmen (Zone 2). Ergänzt, weil das dein Schwimmtag ist.",
      };
      const pw = typeof buildPlannedWorkout === "function" ? buildPlannedWorkout(entry) : { id: `ps-${k}`, status: "geplant", ...entry };
      mutable.add(pw.id);
      cur.push(pw);
    }
  }

  return { list: cur, changes };
}

// Kurzer Text für den Prompt: Tagesraster des Zeitfensters + Mengen.
function planStructureRuleText(s, windowDates) {
  const names = { mo: "Mo", di: "Di", mi: "Mi", do: "Do", fr: "Fr", sa: "Sa", so: "So" };
  const lines = [];
  if (s.trainingDays.length || s.swimDays.length || s.longDays.length) {
    const grid = windowDates.map(d => {
      const wd = planStructWeekday(d);
      if (s.trainingDays.length && !s.trainingDays.includes(wd)) return `${d} ${names[wd]}: Ruhetag`;
      const tags = [];
      if (s.swimDays.includes(wd)) tags.push("Schwimmtag (hier Schwimmen)");
      if (s.longDays.includes(wd)) tags.push("lange Einheit");
      return `${d} ${names[wd]}: ${tags.length ? tags.join(", ") : "Training"}`;
    });
    lines.push(`- Tagesraster (verbindlich): ${grid.join(" · ")}.`);
  }
  if (s.swimDays.length) lines.push(`- Schwimmen AUSSCHLIESSLICH an den Schwimmtagen und an JEDEM Schwimmtag genau eine Schwimmeinheit.`);
  const extra = s.extrasSameDay
    ? "Dazu höchstens EINE Kraft- ODER Mobility-Einheit am selben Tag (nie beides)."
    : "Kraft und Mobility nur an Tagen OHNE Haupttraining (eigene Tage).";
  lines.push(`- Pro Tag höchstens ${s.mainPerDay === 1 ? "EIN Haupttraining" : `${s.mainPerDay} Haupttrainings`} (Schwimmen, Rad oder Laufen, jede Sportart höchstens einmal). ${extra}`);
  if (s.strengthPerWeek) lines.push(`- Kraft: genau ${s.strengthPerWeek}× pro Woche (Mo-So), nicht öfter.`);
  if (s.mobilityPerWeek) lines.push(`- Mobility: genau ${s.mobilityPerWeek}× pro Woche (Mo-So), nicht öfter.`);
  return lines.join("\n");
}
