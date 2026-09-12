// Erfolge/Abzeichen: rein deterministisch aus bereits berechneten Werten
// abgeleitet (Trainingsanzahl, Bestzeiten aus records.js/calculations.js,
// Streak aus streak.js) - keine erfundenen Punkte/XP, jedes Abzeichen bildet
// eine echte, nachvollziehbare Leistung ab (siehe AI_RULES §9).

const ACHIEVEMENT_COUNT_MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
const ACHIEVEMENT_STREAK_MILESTONES = [7, 14, 30, 60, 100, 200, 365];

// Distanzen, für die records.js/performance.js ohnehin schon eine Bestzeit
// schätzt (bestEffortForDistance) - dieselbe Berechnung, hier nur auf eine
// NEUE Bestleistung seit dem letzten Check geprüft.
const ACHIEVEMENT_PB_TARGETS = [
  { sport: "Laufen", meters: 1000, label: "1 km Laufen" },
  { sport: "Laufen", meters: 5000, label: "5 km Laufen" },
  { sport: "Laufen", meters: 10000, label: "10 km Laufen" },
  // env: "outdoor" - Indoor-/virtuelle Fahrten sind hier ausgeschlossen, weil
  // ihre Distanz von der Plattform simuliert wird: eine Bestzeit über
  // "40 virtuelle km" wäre kein Leistungsfortschritt, würde aber den echten
  // Outdoor-Rekord dauerhaft unerreichbar machen.
  { sport: "Rad", meters: 10000, label: "10 km Rad", env: "outdoor" },
  { sport: "Rad", meters: 20000, label: "20 km Rad", env: "outdoor" },
  { sport: "Rad", meters: 40000, label: "40 km Rad", env: "outdoor" },
];

function maybeUnlockAchievement(id, label, newlyList) {
  if (achievementsState.unlocked.some(a => a.id === id)) return;
  const entry = { id, label, achievedAt: new Date().toISOString(), seen: false };
  achievementsState.unlocked.push(entry);
  newlyList.push(entry);
}

// Prüft alle Erfolgs-Kategorien und schaltet neu erreichte frei. Idempotent -
// gefahrlos bei jedem renderAll() aufrufbar, da bereits freigeschaltete IDs
// übersprungen werden. Rückgabe: Array der GERADE NEU freigeschalteten
// Erfolge (leer, wenn nichts Neues) - Grundlage für den Feier-Toast.
function checkAndUnlockAchievements() {
  const newly = [];

  const count = ALL.filter(w => !w.is_summary).length;
  ACHIEVEMENT_COUNT_MILESTONES.forEach(n => {
    if (count >= n) maybeUnlockAchievement(`count_${n}`, `${n}. Training absolviert`, newly);
  });

  const streak = (typeof computeAdherenceStreak === "function") ? computeAdherenceStreak() : null;
  if (streak) {
    ACHIEVEMENT_STREAK_MILESTONES.forEach(n => {
      if (streak.days >= n) maybeUnlockAchievement(`streak_${n}`, `${n} Tage Trainingsplan-Treue-Streak`, newly);
    });
  }

  ACHIEVEMENT_PB_TARGETS.forEach(t => {
    // Einheiten mit unbekannter Umgebung (Altdaten) gelten als Outdoor - so
    // bleiben bestehende Rad-Bestzeiten erhalten.
    const list = DATA.filter(w => w.sport === t.sport && (!t.env || (w._rideEnv ?? "outdoor") === t.env));
    const best = bestEffortForDistance(list, t.meters);
    if (!best) return;
    // env im Schlüssel: sonst würde ein alter, evtl. aus einer virtuellen Fahrt
    // entstandener Wert den neuen Outdoor-Rekord dauerhaft blockieren. Der
    // prevSec-Schutz unten verhindert, dass der erste Lauf nach dem
    // Schlüsselwechsel fälschlich etwas feiert - er legt nur die Basislinie.
    const key = `pb_${t.sport}_${t.env ?? "all"}_${t.meters}`;
    const prevSec = achievementsState.snapshot.pbSeconds[key];
    if (prevSec == null || best.seconds < prevSec) {
      achievementsState.snapshot.pbSeconds[key] = best.seconds;
      // Nur feiern, wenn vorher schon ein Wert bekannt war - sonst würde die
      // allererste Berechnung nach Einführung dieses Features jede
      // bestehende Bestzeit fälschlich als "neu" melden.
      if (prevSec != null) {
        maybeUnlockAchievement(`${key}_${best.seconds}`, `Neue Bestzeit ${t.label}: ${fmtDurationClock(best.seconds)}`, newly);
      }
    }
  });

  saveAchievements();
  return newly;
}
