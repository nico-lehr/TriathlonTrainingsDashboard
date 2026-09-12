// Gesundheitsdaten aus Garmin Connect (Schlaf, HRV, Ruhepuls, Body Battery,
// Gewicht, VO2max, Trainingszustand).
//
// Die Daten kommen aus data/wellness-data.js, das von tools/garmin_sync.py
// erzeugt wird (const GARMIN_WELLNESS). Dieselbe Mechanik wie EMBEDDED_DATA in
// data/workouts-data.js: eine generierte .js-Datei statt JSON, weil der Browser
// beim Doppelklick-Aufruf (file://) kein fetch() auf lokale Dateien erlaubt.
//
// Fehlt die Datei (noch nie synchronisiert), wird mit leerem Bestand
// gestartet, statt dass das Dashboard mit einem ReferenceError abstuerzt -
// dieselbe Absicherung wie bei EMPTY_EMBEDDED_DATA in js/data/workouts.js.

const EMPTY_WELLNESS = { generated_at: null, sync: null, daily: {} };

const WELLNESS = (typeof GARMIN_WELLNESS !== "undefined" && GARMIN_WELLNESS) ? GARMIN_WELLNESS : EMPTY_WELLNESS;

function wellnessDaily() { return WELLNESS.daily || {}; }

function hasWellnessData() {
  return Object.keys(wellnessDaily()).length > 0;
}

// Datum -> "YYYY-MM-DD" (lokale Zeit, nicht UTC: ein Training um 23 Uhr
// gehoert zum heutigen Tag, nicht zum morgigen).
function wellnessDateKey(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt)) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function wellnessForDate(d) {
  const key = wellnessDateKey(d);
  return key ? (wellnessDaily()[key] || null) : null;
}

// Letzter Tag, an dem `field` tatsaechlich einen Wert hat. Garmin traegt
// Werte teils verspaetet nach und nicht jeder Tag hat jeden Wert (Uhr nicht
// getragen) - deshalb wird rueckwaerts gesucht statt stur "gestern" zu nehmen.
function latestWellness(field, maxDaysBack = 14) {
  const daily = wellnessDaily();
  const keys = Object.keys(daily).sort().reverse();
  const cutoff = new Date(Date.now() - maxDaysBack * 86400000);
  for (const key of keys) {
    if (new Date(key) < cutoff) break;
    const v = daily[key] ? daily[key][field] : null;
    if (v != null) return { date: key, value: v };
  }
  return null;
}

// Verlauf eines Feldes: [{date: Date, value}] aufsteigend. Tage ohne Wert
// werden ausgelassen (nie als 0 gezaehlt) - dieselbe Regel wie bei
// averageComparisonStat() in js/analytics/workout-comparison.js.
function wellnessSeries(field, days = 30) {
  const daily = wellnessDaily();
  const cutoff = new Date(Date.now() - days * 86400000);
  return Object.keys(daily).sort()
    .map(key => ({ date: new Date(key), value: daily[key][field] }))
    .filter(p => p.value != null && !isNaN(p.date) && p.date >= cutoff);
}

// Mittelwert eines Feldes ueber n Tage - die Basislinie, gegen die ein
// Einzelwert erst interpretierbar wird. Ein HRV-Wert von 62 ms sagt fuer sich
// genommen nichts; erst "12% unter dem eigenen 30-Tage-Mittel" ist eine Aussage.
function wellnessBaseline(field, days = 30) {
  const vals = wellnessSeries(field, days).map(p => p.value);
  if (vals.length < 3) return null; // zu duenne Basis waere irrefuehrend
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Abweichung des letzten Wertes von der eigenen Basislinie, in Prozent.
function wellnessDeviation(field, days = 30) {
  const latest = latestWellness(field);
  const base = wellnessBaseline(field, days);
  if (!latest || base == null || !base) return null;
  return { ...latest, baseline: base, deltaPct: ((latest.value - base) / base) * 100 };
}

// Zeitpunkt/Ergebnis des letzten Syncs - fuer die Statusanzeige im Update-Menue.
function lastGarminSync() { return WELLNESS.sync || null; }

// Uebernimmt die Garmin-Waagedaten in das vorhandene Gewichts-Log
// (js/data/weight-log.js). Bewusst NUR fuer Tage, an denen dort noch kein
// Eintrag steht: ein von Hand eingetragener Wert soll nie ueberschrieben
// werden. logWeight() haelt die Regel "max. ein Eintrag pro Tag" bereits ein
// und fuehrt athleteProfile.weightKg automatisch nach.
function syncGarminWeightIntoLog() {
  if (typeof logWeight !== "function" || typeof weightLog === "undefined") return 0;
  const daily = wellnessDaily();
  const known = new Set(weightLog.map(e => e.date));
  let added = 0;
  Object.keys(daily).sort().forEach(key => {
    const kg = daily[key].weight_kg;
    if (kg != null && !known.has(key)) { logWeight(kg, key); added++; }
  });
  return added;
}
