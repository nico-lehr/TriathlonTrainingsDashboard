// Leistungstests alle 8 Wochen (FTP Rad, 5 km Laufen, CSS Schwimmen).
//
// Warum: Alle Zonen (Puls, Watt, Tempo) hängen an den Schwellenwerten im
// Profil. Sind die veraltet, stimmt jede Einheit im Plan nicht mehr. Ein
// kurzer Test alle 8 Wochen hält sie aktuell.
//
// Ablauf:
//   perfTestsDue()      welche Tests im Planungsfenster fällig sind + Wunschtag
//   perfTestsContextLine()  Zeile für den KI-Plan-Kontext (buildPlanContext)
//   perfTestsEnsure()   Sicherheitsnetz: fehlt ein fälliger Test im KI-Plan,
//                       setzt das Dashboard ihn selbst ein (nur ohne neue Regelverstöße)
//   perfTestResults()   Auswertung erledigter Tests -> Vorschlag für neue Schwellen
//
// Nie im Taper, in der Rennwoche oder in der Erholung nach dem Wettkampf.
// Ein Test zählt als gemacht, wenn die geplante Test-Einheit (perfTest-Feld)
// erledigt ist oder im Profil ein Testdatum steht (athleteProfile.perfTestDates).

const PERF_TEST_EVERY_DAYS = 56;
const PERF_TEST_MIN_GAP_DAYS = 2;       // zwei Tests nie näher als 2 Tage beieinander
const PERF_TEST_MIN_SESSIONS = 3;       // nur testen, was in den letzten 6 Wochen trainiert wurde
const PERF_TEST_BLOCKED_PHASES = ["taper", "erholung"];

const PERF_TESTS = [
  {
    key: "ftp", sport: "Rad", label: "FTP-Test Rad", title: "FTP-Test 20 min", duration_min: 60, intensity: "hart",
    description: "15 min einrollen mit 3 kurzen Steigerungen, 5 min locker. Dann 20 min so hart wie gleichmäßig möglich (Test). 15 min ausrollen. Neue FTP = 95 % der 20-Minuten-Leistung.",
    how: "20 min so hart wie gleichmäßig möglich, FTP = 95 % davon",
  },
  {
    key: "run", sport: "Laufen", label: "5-km-Test Laufen", title: "5-km-Test", duration_min: 50, intensity: "hart",
    description: "15 min einlaufen mit 3 Steigerungen. Dann 5 km so schnell wie gleichmäßig möglich (Test, flache Strecke). 10 min auslaufen.",
    how: "5 km so schnell wie gleichmäßig möglich, daraus die Schwellenpace",
  },
  {
    key: "css", sport: "Schwimmen", label: "CSS-Test Schwimmen", title: "CSS-Test 400/200", duration_min: 45, intensity: "hart", distance_m: 1400,
    description: "400 m einschwimmen, 4 × 50 m Steigerung mit 20 s Pause. 400 m Test so schnell wie gleichmäßig möglich, 5 min locker. 200 m Test. 200 m ausschwimmen – zusammen 1.400 m. Beide Zeiten danach unter Analyse → Schwimmen eintragen.",
    how: "400 m und 200 m auf Zeit, daraus die CSS",
  },
];
const PERF_TEST_BY_KEY = Object.fromEntries(PERF_TESTS.map(t => [t.key, t]));

function perfDayShift(key, n) {
  const d = new Date(key + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}
const perfDayDiff = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

// Letztes Testdatum je Test: erledigte Test-Einheiten im Plan oder Datum im Profil.
function perfTestLastDates(planned, profile) {
  const out = {};
  PERF_TESTS.forEach(t => { out[t.key] = null; });
  (planned || []).forEach(p => {
    if (p.perfTest && out.hasOwnProperty(p.perfTest) && p.status === "erledigt" && (!out[p.perfTest] || p.date > out[p.perfTest])) out[p.perfTest] = p.date;
  });
  const saved = { ...((profile && profile.perfTestDates) || {}) };
  // CSS-Test unter Analyse → Schwimmen (js/components/analysis.js)
  const swimTest = profile && profile.swimCssTest && profile.swimCssTest.date;
  if (swimTest && (!saved.css || swimTest > saved.css)) saved.css = swimTest;
  Object.keys(out).forEach(k => { if (saved[k] && (!out[k] || saved[k] > out[k])) out[k] = saved[k]; });
  return out;
}

// Welche Tests im Fenster fällig sind. Ergebnis: [{ ...Test, last, dueFrom, date, candidates }]
// options: { planned, history, profile, todayKey }
function perfTestsDue(goal, windowDates, options = {}) {
  if (!windowDates || !windowDates.length) return [];
  const planned = options.planned || [];
  const profile = options.profile || {};
  const todayKey = options.todayKey || localDateStr(new Date());
  const history = options.history || [];
  const sports = goal && typeof goalRaceSports === "function" ? goalRaceSports(goal) : ["Schwimmen", "Rad", "Laufen"];
  const last = perfTestLastDates(planned, profile);
  const end = windowDates[windowDates.length - 1];
  const dow = ["so", "mo", "di", "mi", "do", "fr", "sa"];
  const trainingDays = Array.isArray(profile.trainingDays) ? profile.trainingDays : [];
  const swimDays = Array.isArray(profile.swimDays) ? profile.swimDays : [];
  const since = perfDayShift(todayKey, -42);
  const group = s => (typeof sportGroup === "function" ? sportGroup(s) : s);
  const taken = (planned || []).filter(p => p.perfTest && p.status === "geplant").map(p => p.date);

  const out = [];
  PERF_TESTS.forEach(t => {
    if (!sports.includes(t.sport)) return;
    // Schon ein offener Test dieser Art geplant? Dann nichts Neues.
    if ((planned || []).some(p => p.perfTest === t.key && p.status === "geplant" && p.date >= todayKey)) return;
    const sessions = history.filter(w => {
      const d = w._date ? localDateStr(w._date) : String(w.date || "").slice(0, 10);
      return d >= since && d <= todayKey && group(w.sport) === t.sport;
    }).length;
    if (sessions < PERF_TEST_MIN_SESSIONS) return;
    const dueFrom = last[t.key] ? perfDayShift(last[t.key], PERF_TEST_EVERY_DAYS) : perfDayShift(todayKey, 1);
    if (dueFrom > end) return;
    const candidates = windowDates.filter(d => {
      if (d <= todayKey || d < dueFrom) return false;
      if (goal && PERF_TEST_BLOCKED_PHASES.includes(typeof getPhase === "function" ? getPhase(d, goal) : null)) return false;
      const wd = dow[new Date(d + "T00:00:00").getDay()];
      if (trainingDays.length && !trainingDays.includes(wd)) return false;
      if (t.sport === "Schwimmen" && swimDays.length && !swimDays.includes(wd)) return false;
      return true;
    });
    if (!candidates.length) return;
    out.push({ ...t, last: last[t.key], dueFrom, candidates, date: null });
  });

  // Wunschtag: frühester Kandidat mit Abstand zu anderen Tests. Wer die
  // wenigsten möglichen Tage hat (z. B. nur ein Schwimmtag), wählt zuerst.
  const chosen = [...taken];
  [...out].sort((a, b) => a.candidates.length - b.candidates.length).forEach(t => {
    const free = t.candidates.filter(d => chosen.every(c => Math.abs(perfDayDiff(c, d)) >= PERF_TEST_MIN_GAP_DAYS));
    t.candidates = free;
    t.date = free[0] || null;
    if (t.date) chosen.push(t.date);
  });
  return out.filter(t => t.date);
}

function perfTestsContextLine(due) {
  if (!due || !due.length) return "";
  const fmt = d => (typeof fmtDate === "function" ? fmtDate(new Date(d + "T00:00:00")) : d);
  const bits = due.map(t => `${t.label} am ${t.date} (${t.how}; letzter Test: ${t.last ? fmt(t.last) : "noch keiner"})`);
  return `Leistungstests fällig (alle ${PERF_TEST_EVERY_DAYS / 7} Wochen, damit die Zonen stimmen): ${bits.join(" | ")}. Plane jeden genau an diesem Tag als Einheit mit "test":"<ftp|run|css>", Intensität "hart", Tag davor locker oder frei.`;
}

// Planeintrag (für buildPlannedWorkout) für einen fälligen Test.
function perfTestEntry(t, date, defaults = {}) {
  return {
    ...defaults, date, sport: t.sport, title: t.title, duration_min: t.duration_min, intensity: t.intensity,
    description: t.description, ...(t.distance_m ? { distance_m: t.distance_m } : {}), perfTest: t.key,
  };
}

// Sicherheitsnetz nach der KI: fehlt ein fälliger Test, setzt das Dashboard
// ihn selbst ein - am Wunschtag, sonst an einem anderen Kandidaten-Tag.
// Neue Einheiten dieses Plans (mutableIds) an dem Tag in derselben Sportart
// oder mit "hart" weichen dem Test. Übernommen wird nur, was keine neuen
// "block"-Verstöße erzeugt (validate = planRuleViolations).
// Ergebnis: { list, added: [Eintrag], skipped: [Test-Label] }
function perfTestsEnsure(list, due, { validate, build, defaults = {}, mutableIds = [] } = {}) {
  let cur = list;
  const added = [], skipped = [];
  const mutable = new Set(mutableIds);
  const blocks = l => (validate ? validate(l).filter(v => v.severity === "block") : []);
  (due || []).forEach(t => {
    if (cur.some(p => p.perfTest === t.key && p.status === "geplant")) return;
    const known = new Set(blocks(cur).map(v => `${v.rule}|${v.date}|${v.workoutId}`));
    let ok = false;
    for (const date of [t.date, ...t.candidates.filter(d => d !== t.date)]) {
      const dayItems = cur.filter(p => p.date === date && p.status === "geplant");
      // Fremde (nicht in diesem Plan erstellte) Einheiten nie verdrängen.
      const clash = dayItems.filter(p => p.sport === t.sport || p.intensity === "hart");
      if (clash.some(p => !mutable.has(p.id))) continue;
      const entry = build ? build(perfTestEntry(t, date, defaults)) : perfTestEntry(t, date, defaults);
      const next = [...cur.filter(p => !clash.includes(p)), entry];
      const fresh = blocks(next).filter(v => !known.has(`${v.rule}|${v.date}|${v.workoutId}`));
      if (fresh.length) continue;
      cur = next;
      added.push(entry);
      ok = true;
      break;
    }
    if (!ok) skipped.push(t.label);
  });
  return { list: cur, added, skipped };
}

// Auswertung erledigter Tests der letzten 21 Tage: passende Trainingsdatei am
// Testtag suchen und daraus einen Vorschlag berechnen. Nie raten - ohne
// Messwert kein Vorschlag. Ergebnis: [{ key, date, label, value, current, text }]
function perfTestResults(planned, history, profile, todayKey = localDateStr(new Date())) {
  const out = [];
  const since = perfDayShift(todayKey, -21);
  const group = s => (typeof sportGroup === "function" ? sportGroup(s) : s);
  (planned || []).filter(p => p.perfTest && p.status === "erledigt" && p.date >= since && p.date <= todayKey).forEach(p => {
    const t = PERF_TEST_BY_KEY[p.perfTest];
    if (!t) return;
    const sameDay = (history || []).filter(w => (w._date ? localDateStr(w._date) : String(w.date || "").slice(0, 10)) === p.date && group(w.sport) === t.sport);
    if (t.key === "ftp") {
      const best = Math.max(0, ...sameDay.map(w => (typeof bestAveragePower === "function" ? bestAveragePower(w.stream, 1200) : 0) || 0));
      if (best >= 60) {
        const ftp = Math.round(best * 0.95);
        out.push({ key: "ftp", date: p.date, label: t.label, value: ftp, current: profile && profile.ftpWatts || null,
          text: `FTP-Test vom ${p.date}: 20 min mit Ø ${Math.round(best)} W → neue FTP etwa ${ftp} W${profile && profile.ftpWatts ? ` (bisher ${profile.ftpWatts} W)` : ""}.` });
      }
    } else if (t.key === "run") {
      const best = typeof bestEffortForDistance === "function" ? bestEffortForDistance(sameDay, 5000) : null;
      if (best && best.seconds > 600 && best.seconds < 3600) {
        // Schwellenpace (ca. 1 Stunde Renntempo) liegt rund 6 % langsamer als das 5-km-Tempo.
        const pace = secondsToPace(best.seconds / 5 * 1.06);
        out.push({ key: "run", date: p.date, label: t.label, value: pace, current: profile && profile.runThresholdPace || null,
          text: `5-km-Test vom ${p.date}: ${fmtDurationClock(best.seconds)} → Schwellenpace etwa ${pace} /km${profile && profile.runThresholdPace ? ` (bisher ${profile.runThresholdPace} /km)` : ""}.` });
      }
    } else if (t.key === "css") {
      out.push({ key: "css", date: p.date, label: t.label, value: null, current: profile && profile.swimCss || null,
        text: `CSS-Test vom ${p.date}: Zeiten für 400 m und 200 m unter Analyse → Schwimmen eintragen, dann rechnet das Dashboard die neue CSS aus.` });
    }
  });
  return out;
}
