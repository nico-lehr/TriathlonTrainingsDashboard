// Reiner FIT-Binaerparser (inkl. komprimierter Zeitstempel und Developer-Feldern),
// von Hand geschrieben, damit das Dashboard komplett offline ohne Abhaengigkeiten laeuft.

const FIT_EPOCH_OFFSET = 631065600; // Sekunden zwischen 1970-01-01 und 1989-12-31 (FIT-Epoche)


const BASE_TYPES = {
  0x00: { size: 1, signed: false, invalid: 0xFF },
  0x01: { size: 1, signed: true,  invalid: 0x7F },
  0x02: { size: 1, signed: false, invalid: 0xFF },
  0x83: { size: 2, signed: true,  invalid: 0x7FFF },
  0x84: { size: 2, signed: false, invalid: 0xFFFF },
  0x85: { size: 4, signed: true,  invalid: 0x7FFFFFFF },
  0x86: { size: 4, signed: false, invalid: 0xFFFFFFFF },
  0x88: { size: 4, signed: true,  invalid: 0xFFFFFFFF, isFloat: true },
  0x0A: { size: 1, signed: false, invalid: 0x00 },
  0x8B: { size: 2, signed: false, invalid: 0xFFFF },
  0x8C: { size: 4, signed: false, invalid: 0xFFFFFFFF },
  0x0D: { size: 1, signed: false, invalid: 0xFF },
  // 64-Bit-Typen: kommen aktuell nur bei Developer-Feldern vor (z.B. der von
  // HealthFit geschriebene "SESSION ACTIVITY TYPE"). Werte werden als
  // normale JS-Number gelesen - für die hier vorkommenden kleinen Ganzzahlen
  // unproblematisch (weit unter dem sicheren Number-Bereich).
  0x8E: { size: 8, signed: true,  invalid: 0x7FFFFFFFFFFFFFFFn, big: true },
  0x8F: { size: 8, signed: false, invalid: 0xFFFFFFFFFFFFFFFFn, big: true },
  0x90: { size: 8, signed: false, invalid: 0x0000000000000000n, big: true },
};

const FIT_STRING_TYPE = 0x07; // Textfelder: variable Größe, kein Eintrag in BASE_TYPES (siehe readDataFields)

// mesg_num -> { def_num -> {name, scale, offset} }
// Feldnummern stammen aus dem offiziellen Garmin FIT-Profil (record=20,
// session=18) und wurden gegen echte Garmin/HealthFit-.fit-Dateien verifiziert.

const FIELD_MAP = {
  18: { // session
    2:   { name: "start_time", ts: true },
    253: { name: "timestamp", ts: true },
    5:   { name: "sport" },
    6:   { name: "sub_sport" },
    7:   { name: "total_elapsed_time", scale: 1000 },
    8:   { name: "total_timer_time", scale: 1000 },
    9:   { name: "total_distance", scale: 100 },
    10:  { name: "total_cycles" }, // = "Total Strides" bei Laufen
    11:  { name: "total_calories" },
    14:  { name: "avg_speed", scale: 1000 },
    15:  { name: "max_speed", scale: 1000 },
    16:  { name: "avg_heart_rate" },
    17:  { name: "max_heart_rate" },
    64:  { name: "min_heart_rate" },
    18:  { name: "avg_cadence" },
    19:  { name: "max_cadence" },
    20:  { name: "avg_power" },
    21:  { name: "max_power" },
    22:  { name: "total_ascent" },
    23:  { name: "total_descent" },
    34:  { name: "normalized_power" },
    52:  { name: "avg_grade", scale: 100 },
    89:  { name: "avg_vertical_oscillation", scale: 10 },
    90:  { name: "avg_stance_time_percent", scale: 100 },
    91:  { name: "avg_stance_time", scale: 10 },
    132: { name: "avg_vertical_ratio", scale: 100 },
    134: { name: "avg_step_length", scale: 10 },
    168: { name: "training_load_peak", scale: 65536 },
  },
  20: { // record
    253: { name: "timestamp", ts: true },
    0:   { name: "position_lat" }, // Rohwert in Semicircles - hier nur für die
    1:   { name: "position_long" }, // Becken/Freiwasser-Erkennung als Präsenz-Flag genutzt (kein Grad-Umrechnen nötig)
    2:   { name: "altitude", scale: 5, offset: 500 },
    3:   { name: "heart_rate" },
    4:   { name: "cadence" },
    5:   { name: "distance", scale: 100 },
    7:   { name: "power" },
    9:   { name: "grade", scale: 100 },
    39:  { name: "vertical_oscillation", scale: 10 },
    41:  { name: "stance_time", scale: 10 },
    53:  { name: "fractional_cadence", scale: 128 },
    73:  { name: "enhanced_speed", scale: 1000 },
    78:  { name: "enhanced_altitude", scale: 5, offset: 500 },
    83:  { name: "vertical_ratio", scale: 100 },
    84:  { name: "stance_time_balance", scale: 100 },
    85:  { name: "step_length", scale: 10 },
  },
  // length (Schwimmbahn, eine Nachricht pro geschwommener Bahn) - liefert
  // Zugzahl + Zugfrequenz je Bahn, daraus lässt sich SWOLF berechnen. NUR bei
  // Becken-Schwimmen vorhanden (Freiwasser trackt kontinuierlich per GPS statt
  // in Bahnen) - genau das nutzen wir weiter unten zur Becken/Freiwasser-
  // Erkennung. WICHTIG: Feldnummern sind aus dem öffentlichen FIT-SDK-Profil
  // übernommen, anders als session/record oben NICHT an einer echten Datei
  // verifiziert (im aktuellen Datenbestand gibt es keine Becken-Schwimmdatei,
  // siehe DATA_MODEL.md) - beim ersten echten Becken-Import unbedingt mit
  // verify_parser.py gegen die Python/fitdecode-Referenz gegenchecken.
  101: { // length
    253: { name: "timestamp", ts: true },
    3:   { name: "total_elapsed_time", scale: 1000 },
    4:   { name: "total_timer_time", scale: 1000 },
    5:   { name: "total_strokes" },
    6:   { name: "avg_speed", scale: 1000 },
    7:   { name: "swim_stroke" },
    9:   { name: "avg_swimming_cadence" },
    12:  { name: "length_type" },
  },
  // field_description: von HealthFit (und potenziell künftig Garmin Connect/
  // Strava) genutzt, um zusätzliche "Developer-Felder" mit Klartext-Namen in
  // die Datei zu schreiben (z.B. "SESSION INDOOR") - siehe readDevFieldDescs().
  206: {
    0: { name: "dev_data_index" },
    1: { name: "field_def_num" },
    2: { name: "fit_base_type" },
    3: { name: "field_name", isString: true },
  },
};

const LENGTH_TYPE_ACTIVE = 1; // length_type: 0=idle (Pause/Wende-Rest), 1=active (geschwommene Bahn)
// HINWEIS Schwimmstil (swim_stroke, Feld 7 in mesg 101): bewusst NICHT
// ausgewertet. Die length-Feldnummern sind unverifiziertes FIT-SDK-Profil-
// Raten (siehe Kommentar oben) und der erkannte Stil war in der Praxis
// falsch (siehe CHANGE_REQUESTS.md) - ungenutzt von der KI (context-builder.js
// nutzt nur avg_swolf/avg_stroke_rate), also lieber weglassen als eine
// falsche Angabe anzuzeigen. SWOLF/Zugfrequenz bleiben unberührt.


const SPORT_ENUM = { 0: "generic", 1: "running", 2: "cycling", 5: "swimming", 10: "training", 62: "hiit" };

const SPORT_MAP_DE = { running: "Laufen", cycling: "Rad", swimming: "Schwimmen", hiit: "Intervalltraining", training: "Krafttraining", generic: "Sonstiges", flexibility_training: "Flexibilität" };
// sport="training" ist mehrdeutig (Kraft-/Cardio-/Beweglichkeitstraining) - erst
// der sub_sport unterscheidet sie. Werte empirisch verifiziert (fitdecode) über
// den kompletten 2026er-Datensatz.

// Für Schwimmen (open_water/lap_swimming) bewusst KEINE Enum-Werte hier
// eingetragen: die passenden FIT-Zahlen ließen sich an keiner echten Datei
// verifizieren (HealthFit befüllt sub_sport beim Schwimmen aktuell ohnehin
// immer mit 0/generic, siehe buildWorkoutFromParsed) - ein geratener falscher
// Wert wäre schlechter als gar keiner. Die Becken/Freiwasser-Erkennung läuft
// stattdessen robust über Bahnen-Nachrichten + Dateiname (siehe dort).
const SUB_SPORT_ENUM = { 0: "generic", 6: "indoor_cycling", 19: "flexibility_training", 20: "strength_training", 26: "cardio_training", 45: "indoor_running", 70: "hiit" };

const TRAINING_SUBSPORT_MAP_DE = { flexibility_training: "Flexibilität", strength_training: "Krafttraining", cardio_training: "Cardiotraining" };

const SUBSPORT_MAP_DE = { generic: "", open_water: "Freiwasser", lap_swimming: "Bahnenschwimmen", road: "Straße", indoor_cycling: "Indoor", treadmill: "Laufband", indoor_running: "Indoor", hiit: "HIIT" };

/** Parsed eine .fit-ArrayBuffer -> { session: {...}, records: [{timestamp,heart_rate,enhanced_speed,distance}] } */

function parseFitArrayBuffer(buf) {
  const dv = new DataView(buf);
  if (dv.byteLength < 14) throw new Error("Datei zu klein");
  const headerSize = dv.getUint8(0);
  const sig = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
  if (sig !== ".FIT") throw new Error("Kein gültiges .fit-Format");
  const dataSize = dv.getUint32(4, true);
  let offset = headerSize;
  const dataEnd = headerSize + dataSize;

  const localDefs = {};
  let sessionFields = null;
  const records = [];
  const lengths = []; // Schwimmbahnen (mesg 101) - siehe FIELD_MAP-Kommentar oben
  // Developer-Feld-Beschreibungen (mesg 206, "field_description"), Key
  // "devDataIndex:defNum" -> {name, baseType}. Werden VOR ihrer Verwendung in
  // der Datei geschrieben (FIT-Spec-Vorgabe), ein einziger Vorwärts-Durchlauf
  // reicht deshalb.
  const devFieldDescs = {};
  let lastTimestampRaw = null; // für "compressed timestamp" Header (rollierende 5-Bit-Zeit)

  function readValue(bt, littleEndian, pos) {
    let v;
    if (bt.size === 1) v = bt.signed ? dv.getInt8(pos) : dv.getUint8(pos);
    else if (bt.size === 2) v = bt.signed ? dv.getInt16(pos, littleEndian) : dv.getUint16(pos, littleEndian);
    else if (bt.size === 4) v = bt.isFloat ? dv.getFloat32(pos, littleEndian) : (bt.signed ? dv.getInt32(pos, littleEndian) : dv.getUint32(pos, littleEndian));
    else if (bt.size === 8 && bt.big) {
      const big = bt.signed ? dv.getBigInt64(pos, littleEndian) : dv.getBigUint64(pos, littleEndian);
      if (big === bt.invalid) return null;
      return Number(big); // nur für kleine Ganzzahlen genutzt (z.B. Developer-Feld-Enums) - unproblematisch
    }
    else return null;
    if (v === bt.invalid) return null;
    return v;
  }

  // Liest ein Textfeld (FIT-Basistyp 0x07, variable Größe) als UTF-8-String,
  // abgeschnitten am ersten Null-Byte.
  function readString(pos, size) {
    const bytes = [];
    for (let i = 0; i < size; i++) {
      const b = dv.getUint8(pos + i);
      if (b === 0) break;
      bytes.push(b);
    }
    if (!bytes.length) return null;
    try { return new TextDecoder("utf-8").decode(new Uint8Array(bytes)); } catch (e) { return String.fromCharCode(...bytes); }
  }

  // Liest die Felder einer Daten-Nachricht ab `pos`, gibt {values, newOffset} zurück.
  // injectedTsRaw: bei komprimiertem Timestamp-Header der rekonstruierte Rohwert (FIT-Sekunden).
  function readDataFields(def, pos, injectedTsRaw) {
    const fieldMap = FIELD_MAP[def.globalMesgNum];
    const values = {};
    for (const f of def.fields) {
      const known = fieldMap && fieldMap[f.defNum];
      if (f.baseType === FIT_STRING_TYPE) {
        // Textfeld (aktuell nur field_description.field_name, mesg 206)
        if (known && known.isString) values[known.name] = readString(pos, f.size);
        pos += f.size;
        continue;
      }
      const bt = BASE_TYPES[f.baseType];
      if (bt && f.defNum === 253 && bt.size && f.size >= bt.size) {
        // Timestamp-Feld IMMER lesen (auch bei unbekanntem mesg-Typ), um die
        // rollierende Referenzzeit für komprimierte Header aktuell zu halten.
        const raw = readValue(bt, def.littleEndian, pos);
        if (raw !== null) lastTimestampRaw = raw;
      }
      if (bt && known && bt.size && f.size >= bt.size) {
        const raw = readValue(bt, def.littleEndian, pos);
        if (raw !== null) {
          let val = raw;
          if (known.ts) val = new Date((raw + FIT_EPOCH_OFFSET) * 1000);
          else if (known.scale) val = raw / known.scale - (known.offset || 0);
          values[known.name] = val;
        }
      }
      pos += f.size;
    }
    // Developer-Feldwerte: nur lesbar, wenn vorher eine passende
    // field_description-Nachricht (mesg 206) auftauchte (FIT-Spec-Vorgabe -
    // steht immer davor). Unbekannte/undeklarierte Developer-Felder werden
    // weiterhin nur überlesen (Größe ist ja bekannt), nicht interpretiert.
    for (const df of def.devFields) {
      const desc = devFieldDescs[df.devDataIndex + ":" + df.defNum];
      if (desc) {
        const bt = BASE_TYPES[desc.baseType];
        if (bt && bt.size && df.size >= bt.size) {
          const raw = readValue(bt, def.littleEndian, pos);
          if (raw !== null) values[desc.name] = raw;
        }
      }
      pos += df.size;
    }
    if (injectedTsRaw != null && fieldMap && fieldMap[253]) {
      values[fieldMap[253].name] = new Date((injectedTsRaw + FIT_EPOCH_OFFSET) * 1000);
    }
    return { values, newOffset: pos };
  }

  function storeMessage(globalMesgNum, values) {
    if (globalMesgNum === 18) {
      sessionFields = { ...(sessionFields || {}), ...values };
    } else if (globalMesgNum === 20 && Object.keys(values).length) {
      records.push(values);
    } else if (globalMesgNum === 101 && Object.keys(values).length) {
      lengths.push(values);
    } else if (globalMesgNum === 206 && values.dev_data_index != null && values.field_def_num != null) {
      devFieldDescs[values.dev_data_index + ":" + values.field_def_num] = { name: values.field_name || `dev${values.dev_data_index}.${values.field_def_num}`, baseType: values.fit_base_type };
    }
  }

  while (offset < dataEnd) {
    const headerByte = dv.getUint8(offset); offset += 1;

    if (headerByte & 0x80) {
      // Komprimierter Timestamp-Header: 2-Bit lokaler Typ + 5-Bit Zeitoffset
      const localType = (headerByte >> 5) & 0x03;
      const timeOffset = headerByte & 0x1F;
      const def = localDefs[localType];
      if (!def) throw new Error("Unbekannte lokale Nachricht (compressed header, Definition fehlt)");
      if (lastTimestampRaw === null) throw new Error("Komprimierter Timestamp ohne Referenzzeit");
      const lastOffset5 = lastTimestampRaw & 0x1F;
      let ts = timeOffset >= lastOffset5 ? (lastTimestampRaw - lastOffset5) + timeOffset : (lastTimestampRaw - lastOffset5) + timeOffset + 32;
      lastTimestampRaw = ts;
      const { values, newOffset } = readDataFields(def, offset, ts);
      offset = newOffset;
      storeMessage(def.globalMesgNum, values);
      continue;
    }

    const isDefinition = (headerByte & 0x40) !== 0;
    const localType = headerByte & 0x0F;

    if (isDefinition) {
      const hasDevFields = (headerByte & 0x20) !== 0;
      offset += 1; // reserved
      const arch = dv.getUint8(offset); offset += 1;
      const littleEndian = arch === 0;
      const globalMesgNum = dv.getUint16(offset, littleEndian); offset += 2;
      const numFields = dv.getUint8(offset); offset += 1;
      const fields = [];
      for (let i = 0; i < numFields; i++) {
        fields.push({ defNum: dv.getUint8(offset), size: dv.getUint8(offset + 1), baseType: dv.getUint8(offset + 2) });
        offset += 3;
      }
      const devFields = [];
      if (hasDevFields) {
        const numDev = dv.getUint8(offset); offset += 1;
        for (let i = 0; i < numDev; i++) {
          // Byte-Layout je Developer-Feld-Definition: field_number, size,
          // developer_data_index (siehe FIT-Spec) - defNum+devDataIndex
          // brauchen wir, um den Wert später über devFieldDescs einer
          // field_description-Nachricht zuzuordnen (readDataFields).
          devFields.push({ defNum: dv.getUint8(offset), size: dv.getUint8(offset + 1), devDataIndex: dv.getUint8(offset + 2) });
          offset += 3;
        }
      }
      localDefs[localType] = { globalMesgNum, fields, littleEndian, devFields };
      continue;
    }

    const def = localDefs[localType];
    if (!def) throw new Error("Unbekannte lokale Nachricht (Definition fehlt)");
    const { values, newOffset } = readDataFields(def, offset, null);
    offset = newOffset;
    storeMessage(def.globalMesgNum, values);
  }

  return { session: sessionFields, records, lengths };
}


function fmtPacePerKm(avgSpeed) {
  if (!avgSpeed || avgSpeed <= 0) return null;
  const sec = 1000 / avgSpeed;
  let m = Math.floor(sec / 60), s = Math.round(sec % 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtPacePer100m(avgSpeed) {
  if (!avgSpeed || avgSpeed <= 0) return null;
  const sec = 100 / avgSpeed;
  let m = Math.floor(sec / 60), s = Math.round(sec % 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Kombiniert das rohe FIT-"cadence"-Feld (pro Bein, wie beim Radfahren) mit
// dem Nachkomma-Anteil; bei Laufen verdoppelt Garmin es zur "Schrittfrequenz"
// (beide Füße). Siehe auch buildWorkoutFromParsed() für dieselbe Logik auf
// Session-Ebene (avg_cadence/max_cadence).

function combineCadence(cadence, fractional, sportRaw) {
  if (cadence == null) return null;
  let v = cadence + (fractional || 0);
  if (sportRaw === "running") v *= 2;
  return Math.round(v * 10) / 10;
}


function buildStream(records, startTime, sportRaw) {
  if (!records.length || !startTime) return null;
  const startMs = startTime.getTime();
  const pts = records
    .filter(r => r.timestamp)
    .map(r => ({
      t: Math.round((r.timestamp.getTime() - startMs) / 100) / 10,
      hr: r.heart_rate ?? null,
      speed: r.enhanced_speed ?? null,
      dist: r.distance ?? null,
      alt: r.enhanced_altitude ?? r.altitude ?? null,
      power: r.power ?? null,
      cad: combineCadence(r.cadence, r.fractional_cadence, sportRaw),
      grade: r.grade ?? null,
      vo: r.vertical_oscillation ?? null,
      gct: r.stance_time ?? null,
      vr: r.vertical_ratio ?? null,
      sl: r.step_length ?? null,
    }))
    .filter(p => p.t >= 0);
  const n = pts.length;
  if (!n) return null;
  // Bucket-Downsampling (nicht simples "jeden n-ten Punkt nehmen"): so gehen
  // vereinzelte HF-Messpunkte (z.B. bei Sensor-Aussetzern) nicht einfach
  // unter, weil sie zwischen zwei genommenen Punkten liegen.
  const target = 200;
  const bucketSize = Math.max(1, Math.ceil(n / target));
  const avgKey = (bucket, key, decimals) => {
    const vals = bucket.map(p => p[key]).filter(v => v != null);
    if (!vals.length) return null;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const f = Math.pow(10, decimals);
    return Math.round(avg * f) / f;
  };
  const out = { t: [], hr: [], speed: [], dist: [], alt: [], power: [], cad: [], grade: [], vo: [], gct: [], vr: [], sl: [] };
  for (let i = 0; i < n; i += bucketSize) {
    const bucket = pts.slice(i, i + bucketSize);
    const distVals = bucket.map(p => p.dist).filter(v => v != null);
    out.t.push(bucket[0].t);
    out.hr.push(avgKey(bucket, "hr", 0));
    out.speed.push(avgKey(bucket, "speed", 3));
    out.dist.push(distVals.length ? Math.round(distVals[distVals.length - 1] * 10) / 10 : null);
    out.alt.push(avgKey(bucket, "alt", 1));
    out.power.push(avgKey(bucket, "power", 0));
    out.cad.push(avgKey(bucket, "cad", 0));
    out.grade.push(avgKey(bucket, "grade", 1));
    out.vo.push(avgKey(bucket, "vo", 1));
    out.gct.push(avgKey(bucket, "gct", 0));
    out.vr.push(avgKey(bucket, "vr", 1));
    out.sl.push(avgKey(bucket, "sl", 0));
  }
  return out;
}


function buildWorkoutFromParsed(fname, parsed) {
  const s = parsed.session;
  if (!s) return null;
  const sportRaw = SPORT_ENUM[s.sport] ?? "generic";
  const subSportRaw = SUB_SPORT_ENUM[s.sub_sport] ?? "generic";
  const sportDe = (sportRaw === "training" && TRAINING_SUBSPORT_MAP_DE[subSportRaw])
    ? TRAINING_SUBSPORT_MAP_DE[subSportRaw]
    : SPORT_MAP_DE[sportRaw] || (sportRaw.charAt(0).toUpperCase() + sportRaw.slice(1));
  const startTime = s.start_time instanceof Date ? s.start_time : null;
  const durationS = s.total_timer_time ?? s.total_elapsed_time ?? null;
  const distanceM = s.total_distance ?? null;
  const avgSpeed = s.avg_speed ?? null;
  const maxSpeed = s.max_speed ?? null;

  let paceStr = null, speedKmh = null, maxSpeedKmh = null;
  if (avgSpeed) {
    if (sportRaw === "running") paceStr = fmtPacePerKm(avgSpeed);
    else if (sportRaw === "swimming") paceStr = fmtPacePer100m(avgSpeed);
    else if (sportRaw === "cycling") speedKmh = Math.round(avgSpeed * 3.6 * 10) / 10;
  }
  if (maxSpeed && sportRaw === "cycling") maxSpeedKmh = Math.round(maxSpeed * 3.6 * 10) / 10;

  // Kadenz auf Session-Ebene: dasselbe Rohfeld wie beim Rad (pro Bein bei
  // Laufen), siehe combineCadence() für den Stream. Ohne Nachkommaanteil auf
  // Session-Ebene (den liefert FIT hier nicht separat), daher nur *2 bei Laufen.
  const avgCadence = s.avg_cadence != null ? (sportRaw === "running" ? s.avg_cadence * 2 : s.avg_cadence) : null;
  const maxCadence = s.max_cadence != null ? (sportRaw === "running" ? s.max_cadence * 2 : s.max_cadence) : null;
  // "Total Strides" (Laufen): total_cycles ist die Zahl voller Schrittzyklen
  // (=2 Bodenkontakte); Garmin Connect zeigt diesen Rohwert bereits als
  // "Gesamtschritte" (kein *2 nötig, das ist Konvention bei Garmin selbst).
  const totalSteps = (sportRaw === "running" && s.total_cycles != null) ? s.total_cycles : null;

  // ---- Schwimm-Bahnen (mesg 101) -> SWOLF + Zugfrequenz -------------------
  // Nur vorhanden bei nativen Garmin-Becken-Aufzeichnungen (siehe Kommentar
  // bei FIELD_MAP[101]) - bei den bisherigen HealthFit-Dateien immer leer,
  // dann bleiben alle Werte hier bewusst null statt geraten.
  let avgSwolf = null, bestSwolf = null, numActiveLengths = null, avgStrokeRate = null, lengthsOut = null;
  if (parsed.lengths && parsed.lengths.length) {
    const active = parsed.lengths.filter(l => l.length_type == null || l.length_type === LENGTH_TYPE_ACTIVE);
    const swolfVals = [], strokeRates = [];
    lengthsOut = active.map((l, i) => {
      const t = l.total_timer_time ?? l.total_elapsed_time ?? null;
      const swolf = (t != null && l.total_strokes != null) ? Math.round(t + l.total_strokes) : null;
      if (swolf != null) swolfVals.push(swolf);
      if (l.avg_swimming_cadence != null) strokeRates.push(l.avg_swimming_cadence);
      return {
        length_no: i + 1,
        duration_s: t != null ? Math.round(t * 10) / 10 : null,
        strokes: l.total_strokes ?? null,
        stroke_rate: l.avg_swimming_cadence ?? null,
        swolf,
        speed_mps: l.avg_speed ?? null,
      };
    });
    if (swolfVals.length) {
      avgSwolf = Math.round((swolfVals.reduce((a, b) => a + b, 0) / swolfVals.length) * 10) / 10;
      bestSwolf = Math.min(...swolfVals);
    }
    if (strokeRates.length) avgStrokeRate = Math.round((strokeRates.reduce((a, b) => a + b, 0) / strokeRates.length) * 10) / 10;
    numActiveLengths = active.length;
  }

  // ---- Becken/Freiwasser-Erkennung -----------------------------------------
  // Das native sub_sport-Feld ist bei Schwimmen über HealthFit nicht
  // verlässlich (immer "generic") - siehe DATA_MODEL.md. Der Dateiname wird
  // BEWUSST NICHT als Signal genutzt: er spiegelt nur das auf der Uhr
  // ausgewählte Aktivitätsprofil, nicht wo tatsächlich geschwommen wurde -
  // bei falsch gewähltem Profil "Freiwasserschwimmen" landen sonst
  // tatsächliche Becken-Einheiten fälschlich als Freiwasser markiert.
  //
  // Reihenfolge nach Verlässlichkeit:
  //   1. Bahnen-Nachrichten vorhanden -> zwingend Becken (SWOLF möglich)
  //   2. Kein Bahnen, aber echter GPS-Track (position_lat/long in
  //      record-Nachrichten) -> zwingend Freiwasser (Freiwasser trackt immer
  //      per GPS, ein Becken nie)
  //   3. Weder Bahnen noch GPS -> Becken (am wahrscheinlichsten: Becken ohne
  //      Bahnenerkennung, z.B. falsches Aktivitätsprofil auf der Uhr gewählt)
  let subSportDe = SUBSPORT_MAP_DE[subSportRaw] ?? subSportRaw;
  if (sportRaw === "swimming") {
    if (numActiveLengths) {
      subSportDe = "Becken";
    } else {
      const hasGps = parsed.records.some(r => r.position_lat != null && r.position_long != null);
      subSportDe = hasGps ? "Freiwasser" : "Becken";
    }
  }

  // ---- Developer-Felder (z.B. von HealthFit geschrieben) -------------------
  // "SESSION INDOOR"/"WORKOUT RPE ESTIMATED"/"AVG METs" sind aktuell die
  // einzigen bekannten, teils befüllten Felder - alles andere landet
  // ungefiltert in dev_raw, damit künftige, heute noch unbekannte
  // Zusatzfelder (z.B. eine spätere Becken/Freiwasser-Kennung) automatisch
  // mitgenommen werden, ohne dass der Parser dafür angepasst werden muss.
  const isIndoor = s["SESSION INDOOR"] != null ? !!s["SESSION INDOOR"] : null;
  const rpeEstimated = s["WORKOUT RPE ESTIMATED"] ?? null;
  const avgMets = s["AVG METs"] ?? null;
  const promotedDevKeys = new Set(["SESSION INDOOR", "WORKOUT RPE ESTIMATED", "AVG METs", "SESSION UUID"]);
  const devRaw = {};
  Object.keys(s).forEach(k => {
    if (k.includes(" ") && !promotedDevKeys.has(k)) devRaw[k] = s[k];
  });

  return {
    file: fname,
    date: startTime ? startTime.toISOString() : null,
    sport: sportDe,
    sport_raw: sportRaw,
    sub_sport: subSportDe,
    duration_min: durationS != null ? Math.round((durationS / 60) * 10) / 10 : null,
    duration_s: durationS != null ? Math.round(durationS * 10) / 10 : null,
    distance_km: distanceM != null ? Math.round((distanceM / 1000) * 100) / 100 : null,
    avg_hr: s.avg_heart_rate ?? null,
    max_hr: s.max_heart_rate ?? null,
    min_hr: s.min_heart_rate ?? null,
    pace_min_per_km: sportRaw === "running" ? paceStr : null,
    pace_min_per_100m: sportRaw === "swimming" ? paceStr : null,
    speed_kmh: speedKmh,
    max_speed_kmh: maxSpeedKmh,
    elevation_gain_m: s.total_ascent ?? null,
    elevation_loss_m: s.total_descent ?? null,
    calories: s.total_calories ?? null,
    avg_power_w: s.avg_power ?? null,
    max_power_w: s.max_power ?? null,
    normalized_power_w: s.normalized_power ?? null,
    training_load: s.training_load_peak != null ? Math.round(s.training_load_peak * 10) / 10 : null,
    avg_cadence: avgCadence,
    max_cadence: maxCadence,
    total_steps: totalSteps,
    avg_grade_pct: s.avg_grade ?? null,
    avg_vertical_oscillation_mm: s.avg_vertical_oscillation ?? null,
    avg_stance_time_ms: s.avg_stance_time ?? null,
    avg_stance_time_pct: s.avg_stance_time_percent ?? null,
    avg_vertical_ratio_pct: s.avg_vertical_ratio ?? null,
    avg_step_length_mm: s.avg_step_length ?? null,
    avg_swolf: avgSwolf,
    best_swolf: bestSwolf,
    num_active_lengths: numActiveLengths,
    avg_stroke_rate: avgStrokeRate,
    lengths: lengthsOut,
    is_indoor: isIndoor,
    rpe_estimated: rpeEstimated,
    avg_mets: avgMets,
    dev_raw: Object.keys(devRaw).length ? devRaw : null,
    stream: buildStream(parsed.records, startTime, sportRaw),
    is_summary: false,
  };
}

/** Erkennt Multisport-Gesamt-Sessions & Wechselzeiten (Portierung von parse_fit.py) */

function postProcessWorkouts(workouts) {
  workouts.forEach(w => {
    w._start = w.date ? new Date(w.date) : null;
    w._end = (w._start && w.duration_s != null) ? new Date(w._start.getTime() + w.duration_s * 1000) : null;
    w.is_summary = false;
  });
  const byDay = new Map();
  workouts.forEach(w => {
    if (!w._start) return;
    const key = w._start.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(w);
  });
  const toleranceMs = 180 * 1000;
  byDay.forEach(group => {
    if (group.length < 2) return;
    group.forEach(w => {
      if (w.sport_raw !== "generic" || !w._start || !w._end) return;
      const others = group.filter(o => o !== w);
      if (!others.length) return;
      const enclosesAll = others.every(o => o._start && o._end &&
        w._start.getTime() <= o._start.getTime() + toleranceMs &&
        w._end.getTime() + toleranceMs >= o._end.getTime());
      if (enclosesAll && w.duration_min && w.duration_min > 15) {
        w.is_summary = true; w.sport = "Triathlon (Gesamt)";
      } else if (w.duration_min && w.duration_min <= 15 && others.some(o => ["swimming", "cycling", "running"].includes(o.sport_raw))) {
        w.sport = "Wechsel (T1/T2)";
      }
    });
  });
  workouts.forEach(w => { delete w._start; delete w._end; });
  return workouts;
}

/* ======================================================================
   3) STATE, FILTER, RENDER-PIPELINE
   ====================================================================== */
