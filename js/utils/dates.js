// Datum-/Zeit-Hilfsfunktionen (Formatierung, Wochenstart, Pace<->Sekunden).

function weekStart(d) {
  const nd = new Date(d);
  const day = (nd.getDay() + 6) % 7;
  nd.setDate(nd.getDate() - day);
  nd.setHours(0, 0, 0, 0);
  return nd;
}

const fmtDate = d => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

const fmtDateFull = d => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

const fmtDateWeekday = d => d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });

function paceToSeconds(str) { if (!str) return null; const [m, s] = str.split(":").map(Number); return m * 60 + s; }

function secondsToPace(sec) { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return `${m}:${String(s).padStart(2, "0")}`; }


const DOW_LABELS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];


function fmtDurationClock(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// Gemeinsam von renderRecords() und dem Coach genutzt (kompakter Kontext
// für die KI-Anfrage nutzt exakt dieselbe Bestwerte-Logik wie die Anzeige).
