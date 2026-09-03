// Minimaler IndexedDB-Wrapper NUR für den Workout-Rohdatenbestand (RAW),
// als Ersatz für den bisherigen localStorage-Eintrag "triathlon_dashboard_data_v1".
// Grund: localStorage ist pro Seite hart auf ca. 5-10MB gedeckelt (browserabhängig,
// nicht einstellbar) - bei 1000+ Workouts mit Kurvendaten (auch nach dem
// 200-Punkte-Downsampling in fit-parser.js, siehe buildStream()) reicht das
// nicht mehr. IndexedDB hat dieses harte Limit nicht (üblicherweise ein
// Vielfaches, abhängig vom freien Plattenplatz).
//
// Bewusst NUR dieser eine Speicherplatz wird umgestellt - alle anderen Daten
// (Profil, Ziele, Einstellungen etc.) sind winzig und bleiben unverändert in
// localStorage (siehe AI_RULES Rule 3: kleine, gezielte Änderungen).
//
// Wird als EIN Objekt unter einem festen Key gespeichert (wie vorher der
// eine localStorage-JSON-Blob) - der Rest des Codes (RAW/ALL/DATA in
// workouts.js) merkt davon nichts, nur WO das JSON landet, ändert sich.

const IDB_DB_NAME = "triathlon_dashboard_idb";
const IDB_STORE_NAME = "kv";
const IDB_RAW_KEY = "triathlon_dashboard_data_v1"; // gleicher Name wie der bisherige localStorage-Key, zur Wiedererkennung

function openWorkoutsIdb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("IndexedDB in diesem Browser nicht verfügbar")); return; }
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE_NAME)) {
        req.result.createObjectStore(IDB_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB konnte nicht geöffnet werden"));
  });
}

// Liefert den gespeicherten RAW-Stand oder null (nichts gespeichert / IndexedDB
// nicht verfügbar z.B. im privaten Modus mancher Browser) - wirft NIE, damit
// der Aufrufer in dem Fall einfach mit den eingebetteten Daten weiterlaufen kann.
async function idbGetRaw() {
  try {
    const db = await openWorkoutsIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_STORE_NAME).get(IDB_RAW_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

// Speichert den RAW-Stand - wirft bewusst weiter (im Unterschied zu
// idbGetRaw), damit der Aufrufer (processFitFiles, data-import.js) einen
// Fehler (z.B. Speicher/Plattenplatz voll) sichtbar melden kann, statt ihn
// wie bisher bei localStorage still zu verschlucken.
async function idbSaveRaw(raw) {
  const db = await openWorkoutsIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, "readwrite");
    tx.objectStore(IDB_STORE_NAME).put(raw, IDB_RAW_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClearRaw() {
  const db = await openWorkoutsIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, "readwrite");
    tx.objectStore(IDB_STORE_NAME).delete(IDB_RAW_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
