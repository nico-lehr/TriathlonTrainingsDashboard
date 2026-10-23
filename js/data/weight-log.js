// Gewichtsverlauf: separates Log fürs Körpergewicht über die Zeit (Basis für
// künftige Trend-Auswertungen), getrennt vom "aktuellen" Wert im
// Athletenprofil (athleteProfile.weightKg), der weiterhin die primäre Quelle
// für alle Berechnungen bleibt (z.B. Rad-VO2max, Ernährungs-Tab). Beim
// Eintragen eines neuen Gewichts wird athleteProfile.weightKg IMMER mit
// aktualisiert, damit beide Werte nie auseinanderlaufen.

const WEIGHT_LOG_KEY = "triathlon_dashboard_weight_log_v1";

let weightLog = []; // [{ date: "YYYY-MM-DD", weightKg: 72.3 }, ...], aufsteigend nach Datum sortiert

// Gespeichert in der Ablage pro Person auf dem Server (js/data/api-client.js).
function loadWeightLog() {
  weightLog = storeGet(WEIGHT_LOG_KEY) || [];
  if (!Array.isArray(weightLog)) weightLog = [];
}

function saveWeightLog() {
  storeSet(WEIGHT_LOG_KEY, weightLog);
}

// Trägt einen Gewichtswert für ein Datum ein (Standard: heute). Existiert für
// dieses Datum bereits ein Eintrag, wird er überschrieben (max. ein Wert pro
// Tag) statt einen Duplikat-Eintrag anzulegen.
function logWeight(weightKg, date) {
  const d = date || todayStr();
  const w = Number(weightKg);
  if (!w || w <= 0) return null;
  const existing = weightLog.find(e => e.date === d);
  if (existing) existing.weightKg = w;
  else weightLog.push({ date: d, weightKg: w });
  weightLog.sort((a, b) => a.date.localeCompare(b.date));
  saveWeightLog();
  // athleteProfile.weightKg bleibt der "aktuelle" Wert - nur aktualisieren,
  // wenn dieser Eintrag tatsächlich der neueste im Log ist (z.B. kein
  // nachträglicher Eintrag für ein älteres Datum).
  const latest = weightLog[weightLog.length - 1];
  if (latest.date === d) {
    athleteProfile.weightKg = w;
    saveAthleteProfile();
  }
  return weightLog;
}

// Aktuellstes bekanntes Gewicht: aus dem Log, sonst Fallback auf das manuelle
// Profil-Feld (z.B. wenn noch nie über den Verlauf eingetragen wurde).
function getLatestWeightKg() {
  if (weightLog.length) return weightLog[weightLog.length - 1].weightKg;
  return athleteProfile.weightKg || null;
}

// Veränderung gegenüber vor `days` Tagen (nächstliegender Eintrag <= Zieldatum) -
// null, wenn dafür zu wenig Historie vorhanden ist (nie geraten/interpoliert).
function weightTrend(days = 30) {
  if (weightLog.length < 2) return null;
  const latest = weightLog[weightLog.length - 1];
  const targetTime = new Date(latest.date + "T00:00:00").getTime() - days * 86400000;
  let ref = null;
  for (const e of weightLog) {
    if (new Date(e.date + "T00:00:00").getTime() <= targetTime) ref = e;
  }
  if (!ref || ref.date === latest.date) return null;
  return { deltaKg: latest.weightKg - ref.weightKg, fromDate: ref.date, toDate: latest.date };
}
