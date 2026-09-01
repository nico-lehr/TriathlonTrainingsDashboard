// Erstellt echte, bei Garmin Connect importierbare .fit-Workout-Dateien aus
// einer geplanten Einheit (plannedWorkouts, siehe planned-workouts.js).
//
// Das ist die Gegenrichtung zu fit-parser.js (der liest fertige .fit-
// Aktivitäten ein) - hier wird eine .fit-Datei vom Typ "workout" (kein
// "activity") neu geschrieben, mit genau einem Trainingsschritt.
//
// Bewusste Design-Entscheidung (siehe AI_RULES "keine erfundenen Daten"):
// Es wird IMMER target_type = "open" (kein festes Pace-/Puls-/Leistungsziel)
// verwendet, weil die App für den einzelnen geplanten Schritt keine
// verlässliche Zielzahl hat (nur Intensität als Text). Die Dauer wird nur
// gesetzt, wenn duration_min vorhanden ist - sonst "open duration".
//
// FIT-Binärformat-Grundlagen (offizielle Garmin-FIT-Spezifikation):
// 14-Byte-Datei-Header, dann beliebig viele Definition-/Data-Records,
// abgeschlossen durch eine 2-Byte-CRC über die ganze Datei. Siehe
// docs/DATA_MODEL.md für die Kurzfassung.

const FIT_EPOCH_OFFSET_SECONDS = 631065600; // Sekunden zwischen Unix- und FIT-Epoche (1989-12-31T00:00:00Z)

const FIT_BASE_TYPE = { ENUM: 0x00, UINT8: 0x02, UINT16: 0x84, UINT32: 0x86, STRING: 0x07 };

const FIT_SPORT_BY_NAME = {
  "Laufen": 1,
  "Rad": 2,
  "Schwimmen": 5,
  "Kraft": 10,   // "training" - generischer Sammel-Sport für Kraft/Mobility
  "Mobility": 10,
};

const FIT_WKT_STEP_NAME_SIZE = 48;
const FIT_WKT_NAME_SIZE = 32;

// FIT-eigene CRC-16 (nicht Standard-CRC-16-CCITT) - Referenztabelle aus der
// offiziellen Garmin-FIT-SDK-Beispielimplementierung.
const FIT_CRC_TABLE = [
  0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
  0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
];

function fitCrc16(bytes, startCrc = 0) {
  let crc = startCrc;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    let tmp = FIT_CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[byte & 0xF];
    tmp = FIT_CRC_TABLE[crc & 0xF];
    crc = (crc >> 4) & 0x0FFF;
    crc = crc ^ tmp ^ FIT_CRC_TABLE[(byte >> 4) & 0xF];
  }
  return crc & 0xFFFF;
}

class FitByteWriter {
  constructor() { this.bytes = []; }
  u8(v) { this.bytes.push(v & 0xFF); }
  u16(v) { this.bytes.push(v & 0xFF, (v >> 8) & 0xFF); }
  u32(v) { this.bytes.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF); }
  str(text, size) {
    const enc = new TextEncoder().encode(text || "");
    const cut = enc.slice(0, Math.max(0, size - 1));
    for (let i = 0; i < size; i++) this.u8(i < cut.length ? cut[i] : 0);
  }
  toUint8Array() { return new Uint8Array(this.bytes); }
}

function fitWriteDefinition(w, localType, globalMesgNum, fields) {
  w.u8(0x40 | (localType & 0x0F)); // Definition-Message-Header
  w.u8(0);  // reserved
  w.u8(0);  // Architektur: 0 = little endian
  w.u16(globalMesgNum);
  w.u8(fields.length);
  fields.forEach(f => { w.u8(f.num); w.u8(f.size); w.u8(f.baseType); });
}

function fitWriteDataHeader(w, localType) { w.u8(localType & 0x0F); }

function fitTimestampNow() {
  return Math.floor(Date.now() / 1000) - FIT_EPOCH_OFFSET_SECONDS;
}

// Baut die rohen Bytes einer .fit-Workout-Datei aus einer geplanten Einheit
// (ein plannedWorkouts-Eintrag, siehe planned-workouts.js). Ergebnis: genau
// ein Trainingsschritt mit offenem Ziel (siehe Kommentar oben).
function buildFitWorkoutFile(pw) {
  const body = new FitByteWriter();

  // --- file_id (Pflicht-Message, muss als erstes stehen) ---
  fitWriteDefinition(body, 0, 0, [
    { num: 0, size: 1, baseType: FIT_BASE_TYPE.ENUM },   // type
    { num: 1, size: 2, baseType: FIT_BASE_TYPE.UINT16 }, // manufacturer
    { num: 2, size: 2, baseType: FIT_BASE_TYPE.UINT16 }, // product
    { num: 3, size: 4, baseType: FIT_BASE_TYPE.UINT32 }, // serial_number
    { num: 4, size: 4, baseType: FIT_BASE_TYPE.UINT32 }, // time_created
  ]);
  fitWriteDataHeader(body, 0);
  body.u8(5);                    // type = 5 ("workout")
  body.u16(255);                 // manufacturer = 255 ("development", keine Garmin-Herstellerkennung erfunden)
  body.u16(0);                   // product
  body.u32(1);                   // serial_number (Platzhalter)
  body.u32(fitTimestampNow());   // time_created

  // --- workout (genau eine Message: Name, Sportart, Anzahl Schritte) ---
  fitWriteDefinition(body, 1, 26, [
    { num: 4, size: 1, baseType: FIT_BASE_TYPE.ENUM },
    { num: 6, size: 2, baseType: FIT_BASE_TYPE.UINT16 },
    { num: 8, size: FIT_WKT_NAME_SIZE, baseType: FIT_BASE_TYPE.STRING },
  ]);
  fitWriteDataHeader(body, 1);
  body.u8(FIT_SPORT_BY_NAME[pw.sport] ?? 0);
  body.u16(1); // num_valid_steps
  body.str(pw.title || pw.sport, FIT_WKT_NAME_SIZE);

  // --- workout_step (genau ein Schritt) ---
  fitWriteDefinition(body, 2, 27, [
    { num: 254, size: 2, baseType: FIT_BASE_TYPE.UINT16 },                    // message_index
    { num: 0, size: FIT_WKT_STEP_NAME_SIZE, baseType: FIT_BASE_TYPE.STRING }, // wkt_step_name
    { num: 1, size: 1, baseType: FIT_BASE_TYPE.ENUM },                        // duration_type
    { num: 2, size: 4, baseType: FIT_BASE_TYPE.UINT32 },                      // duration_value
    { num: 3, size: 1, baseType: FIT_BASE_TYPE.ENUM },                        // target_type
    { num: 4, size: 4, baseType: FIT_BASE_TYPE.UINT32 },                      // target_value
    { num: 6, size: 1, baseType: FIT_BASE_TYPE.ENUM },                        // intensity
  ]);
  fitWriteDataHeader(body, 2);
  body.u16(0); // message_index
  body.str(pw.title || pw.sport, FIT_WKT_STEP_NAME_SIZE);
  if (pw.duration_min) {
    body.u8(0); // duration_type = time
    body.u32(Math.round(pw.duration_min * 60 * 1000)); // ms
  } else {
    body.u8(5); // duration_type = open (keine Dauer erfunden)
    body.u32(0);
  }
  body.u8(2); // target_type = open (kein erfundenes Pace-/Puls-/Leistungsziel)
  body.u32(0);
  body.u8(0); // intensity = active

  const bodyBytes = body.toUint8Array();

  // --- Datei-Header (14 Byte) ---
  const header = new FitByteWriter();
  header.u8(14);    // Header-Größe
  header.u8(0x10);  // Protokollversion 1.0
  header.u16(2140); // Profilversion (Platzhalter, wie bei gängigen Encodern)
  header.u32(bodyBytes.length);
  [0x2e, 0x46, 0x49, 0x54].forEach(b => header.u8(b)); // ".FIT"-Signatur
  const headerBeforeCrc = header.toUint8Array();
  header.u16(fitCrc16(headerBeforeCrc)); // Header-CRC über die ersten 12 Byte
  const headerBytes = header.toUint8Array();

  let fileCrc = fitCrc16(headerBytes);
  fileCrc = fitCrc16(bodyBytes, fileCrc);

  const out = new Uint8Array(headerBytes.length + bodyBytes.length + 2);
  out.set(headerBytes, 0);
  out.set(bodyBytes, headerBytes.length);
  out[out.length - 2] = fileCrc & 0xFF;
  out[out.length - 1] = (fileCrc >> 8) & 0xFF;
  return out;
}

function fitExportFilename(pw) {
  const datePart = (pw.date || "workout").replace(/-/g, "");
  const sportPart = (pw.sport || "workout").toLowerCase().replace(/[^a-z0-9]/g, "") || "workout";
  return `${datePart}_${sportPart}.fit`;
}

function downloadFitBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Diese beiden Funktionen sind bewusst die EINZIGEN Stellen im Code, an
// denen eine geplante Einheit tatsächlich "nach Garmin exportiert" wird -
// alle Buttons (Coach-Tab, Kalender-Tages-/Wochenansicht, Bearbeiten-Overlay)
// rufen ausschließlich diese beiden Funktionen auf, nie direkt
// downloadFitBytes()/buildFitWorkoutFile(). Sobald es einmal eine direkte
// Garmin-Connect-API-Anbindung gibt (Hochladen statt Datei-Download), muss
// nur HIER der Versandweg ausgetauscht/ergänzt werden (z. B. downloadFitBytes
// durch einen fetch()-Aufruf ersetzen) - keine der aufrufenden Stellen
// müsste sich ändern.

// Exportiert eine einzelne geplante Einheit als .fit-Datei (Download-Klick).
function exportPlannedWorkoutAsFit(id) {
  const pw = plannedWorkouts.find(p => p.id === id);
  if (!pw) return;
  downloadFitBytes(buildFitWorkoutFile(pw), fitExportFilename(pw));
}

// Exportiert mehrere geplante Einheiten nacheinander (leicht zeitversetzt,
// damit der Browser nicht alle Downloads gleichzeitig blockiert) - genutzt
// für "alle anstehenden" (Coach-Tab) und "diese Woche" (Kalender-Wochenansicht).
function exportPlannedWorkoutsAsFit(list) {
  list.forEach((pw, i) => {
    setTimeout(() => downloadFitBytes(buildFitWorkoutFile(pw), fitExportFilename(pw)), i * 350);
  });
}
