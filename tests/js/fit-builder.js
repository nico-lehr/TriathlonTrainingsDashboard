// Baut kleine, gültige .fit-Dateien für Tests (Header, Definitionen, Daten,
// CRC) - damit sich beide Parser (js/data/fit-parser.js und parse_fit.py)
// an derselben Datei prüfen lassen, ohne echte Uhr-Dateien im Repo.
const FIT_EPOCH = 631065600;
const CRC_TABLE = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
function crc16(bytes) {
  let crc = 0;
  for (const b of bytes) {
    let tmp = CRC_TABLE[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc = crc ^ tmp ^ CRC_TABLE[b & 0xF];
    tmp = CRC_TABLE[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xF];
  }
  return crc;
}
// Typen: [baseType, size]
const T = { enum: [0x00, 1], sint8: [0x01, 1], uint8: [0x02, 1], uint16: [0x84, 2], uint32: [0x86, 4] };
const fitTime = d => Math.round(d.getTime() / 1000) - FIT_EPOCH;

// messages: [{ num, fields: [[defNum, typeName, rawValue], ...] }, ...]
function buildFit(messages) {
  const body = [];
  messages.forEach((m, i) => {
    const local = i % 16;
    body.push(0x40 | local, 0, 0, m.num & 0xFF, m.num >> 8, m.fields.length);
    m.fields.forEach(([def, type]) => body.push(def, T[type][1], T[type][0]));
    body.push(local);
    m.fields.forEach(([, type, v]) => {
      const size = T[type][1];
      for (let b = 0; b < size; b++) body.push((v >>> (8 * b)) & 0xFF);
    });
  });
  const header = [14, 0x20, 0x08, 0x08, ...[0, 8, 16, 24].map(s => (body.length >>> s) & 0xFF), 0x2E, 0x46, 0x49, 0x54];
  const hcrc = crc16(header);
  const all = [...header, hcrc & 0xFF, hcrc >> 8, ...body];
  const crc = crc16(all);
  return Uint8Array.from([...all, crc & 0xFF, crc >> 8]);
}

// Ein 20-min-Lauf mit 2 Intervall-Runden, RPE 7 und Gefühl "gut" (75).
function sampleRunFit() {
  const start = new Date("2026-11-20T07:00:00Z");
  const t = s => fitTime(new Date(start.getTime() + s * 1000));
  const records = [];
  for (let s = 0; s <= 1200; s += 10) {
    records.push({ num: 20, fields: [[253, "uint32", t(s)], [3, "uint8", s < 600 ? 140 : 165], [5, "uint32", s * 300], [73, "uint32", 3000], [4, "uint8", 85]] });
  }
  const lap = (from, dur, hr, speed, intensity, trigger) => ({ num: 19, fields: [
    [253, "uint32", t(from + dur)], [2, "uint32", t(from)], [7, "uint32", dur * 1000], [8, "uint32", dur * 1000],
    [9, "uint32", dur * speed * 100], [15, "uint8", hr], [16, "uint8", hr + 8], [17, "uint8", 86],
    [23, "enum", intensity], [24, "enum", trigger], [50, "sint8", 21], [110, "uint32", speed * 1000],
  ] });
  return buildFit([
    { num: 0, fields: [[0, "enum", 4], [1, "uint16", 1], [4, "uint32", t(0)]] }, // file_id: activity
    ...records,
    lap(0, 600, 140, 3, 2, 0),     // warmup, manual
    lap(600, 600, 165, 3.5, 5, 1), // interval, time
    { num: 18, fields: [
      [253, "uint32", t(1200)], [2, "uint32", t(0)], [5, "enum", 1], [6, "enum", 0],
      [7, "uint32", 1200000], [8, "uint32", 1200000], [9, "uint32", 390000], [16, "uint8", 152], [17, "uint8", 173],
      [57, "sint8", 21], [58, "sint8", 24], [192, "uint8", 75], [193, "uint8", 70],
    ] },
  ]);
}

module.exports = { buildFit, sampleRunFit, crc16 };
