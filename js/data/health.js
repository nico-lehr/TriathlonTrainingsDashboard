// Erholungs-Check: Laden/Speichern, taeglicher Reset mit Logbuch-Archivierung.

const RECOVERY_KEY = "triathlon_dashboard_recovery_v1";

const RECOVERY_LOG_KEY = "triathlon_dashboard_recovery_log_v1";

const RECOVERY_LOG_MAX_DAYS = 90;

let recoveryCheck = { date: null, soreness: null, sorenessLocation: null, energy: null, injury: "no", injuryNote: null };

let recoveryLog = [];

const RECOVERY_SORENESS_OPTIONS = [
  { value: "none", label: "Keiner" }, { value: "light", label: "Leicht" },
  { value: "moderate", label: "Mittel" }, { value: "severe", label: "Stark" },
];

const RECOVERY_ENERGY_OPTIONS = [
  { value: "low", label: "Erschöpft" }, { value: "reduced", label: "Reduziert" },
  { value: "normal", label: "Normal" }, { value: "high", label: "Top fit" },
];

const RECOVERY_INJURY_OPTIONS = [{ value: "no", label: "Keine" }, { value: "yes", label: "Ja" }];

const RECOVERY_SORENESS_LABELS = Object.fromEntries(RECOVERY_SORENESS_OPTIONS.map(o => [o.value, o.label.toLowerCase()]));

const RECOVERY_ENERGY_LABELS = Object.fromEntries(RECOVERY_ENERGY_OPTIONS.map(o => [o.value, o.label.toLowerCase()]));


// Gespeichert in der Ablage pro Person auf dem Server (js/data/api-client.js).
function loadRecoveryLog() {
  recoveryLog = storeGet(RECOVERY_LOG_KEY) || [];
  if (!Array.isArray(recoveryLog)) recoveryLog = [];
}

function saveRecoveryLog() {
  storeSet(RECOVERY_LOG_KEY, recoveryLog.slice(-RECOVERY_LOG_MAX_DAYS));
}

function isRecoveryCheckEmpty(c) {
  return !c.soreness && !c.energy && c.injury !== "yes";
}
// Prüft beim Laden, ob der gespeicherte Stand noch von heute ist. Falls
// nicht: Vortag (sofern ausgefüllt) ins Logbuch schreiben, dann für den
// neuen Tag zurücksetzen.

function loadRecoveryCheck() {
  loadRecoveryLog();
  const today = todayStr();
  const saved = storeGet(RECOVERY_KEY);
  if (saved) recoveryCheck = { ...recoveryCheck, ...saved };
  if (recoveryCheck.date && recoveryCheck.date !== today) {
    if (!isRecoveryCheckEmpty(recoveryCheck)) {
      recoveryLog.push({
        date: recoveryCheck.date,
        soreness: recoveryCheck.soreness,
        sorenessLocation: recoveryCheck.sorenessLocation || null,
        energy: recoveryCheck.energy,
        injury: recoveryCheck.injury,
        injuryNote: recoveryCheck.injuryNote || null,
      });
      saveRecoveryLog();
    }
    recoveryCheck = { date: today, soreness: null, sorenessLocation: null, energy: null, injury: "no", injuryNote: null };
    saveRecoveryCheck();
  } else if (!recoveryCheck.date) {
    recoveryCheck.date = today;
  }
}

function saveRecoveryCheck() {
  recoveryCheck.date = todayStr();
  storeSet(RECOVERY_KEY, recoveryCheck);
}

