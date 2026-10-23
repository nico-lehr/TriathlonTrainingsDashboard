// Erfolge/Abzeichen: Laden/Speichern der bereits freigeschalteten Erfolge.
// Die eigentliche Erkennung (WELCHE Erfolge gerade neu erreicht wurden)
// passiert rein rechnerisch in js/analytics/achievements.js - hier wird nur
// der Zustand gehalten: welche IDs schon mal freigeschaltet wurden (damit
// nichts doppelt gefeiert wird) und ein kleiner Schnappschuss für Werte, bei
// denen "neu" nur im Vergleich zum letzten bekannten Stand erkennbar ist
// (aktuell: Bestzeiten je Distanz).

const ACHIEVEMENTS_KEY = "triathlon_dashboard_achievements_v1";

let achievementsState = {
  unlocked: [], // [{ id, label, achievedAt, seen }] - id ist eindeutig, verhindert Duplikate
  snapshot: { pbSeconds: {} }, // zuletzt bekannte Bestzeit (Sekunden) je Distanz-Schlüssel
};

function loadAchievements() {
  // Gespeichert in der Ablage pro Person auf dem Server (js/data/api-client.js).
  const saved = storeGet(ACHIEVEMENTS_KEY);
  if (saved) achievementsState = { ...achievementsState, ...saved };
  if (!Array.isArray(achievementsState.unlocked)) achievementsState.unlocked = [];
  if (!achievementsState.snapshot) achievementsState.snapshot = { pbSeconds: {} };
  if (!achievementsState.snapshot.pbSeconds) achievementsState.snapshot.pbSeconds = {};
}

function saveAchievements() {
  storeSet(ACHIEVEMENTS_KEY, achievementsState);
}

// Merkt neu unlockte Erfolge als "gesehen" (z.B. sobald die Erfolge-Karte
// einmal sichtbar gerendert wurde) - der Toast beim Freischalten selbst
// hängt NICHT daran, siehe checkAndUnlockAchievements() (js/analytics/achievements.js).
function markAchievementsSeen() {
  let changed = false;
  achievementsState.unlocked.forEach(a => { if (!a.seen) { a.seen = true; changed = true; } });
  if (changed) saveAchievements();
}
