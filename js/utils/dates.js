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

// Zielzeit eines Ziels ("H:MM:SS" oder "H:MM") -> Sekunden, sonst null. Zwei
// Teile heißen Stunden:Minuten wie in den Ziel-Formularen ("z.B. 5:30" =
// 5 h 30 min). Der EINE Parser für Zielzeiten (Rennplan, Ernährung).
function goalTimeToSeconds(str) {
  const m = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(String(str == null ? "" : str).trim());
  if (!m) return null;
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  return sec > 0 ? sec : null;
}

// Erst auf ganze Sekunden runden, dann teilen - sonst wird z.B. 119,6 s zu "1:60".
function secondsToPace(sec) { const r = Math.round(sec), m = Math.floor(r / 60), s = r % 60; return `${m}:${String(s).padStart(2, "0")}`; }


const DOW_LABELS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];


function fmtDurationClock(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// Gemeinsam von renderRecords() und dem Coach genutzt (kompakter Kontext
// für die KI-Anfrage nutzt exakt dieselbe Bestwerte-Logik wie die Anzeige).
