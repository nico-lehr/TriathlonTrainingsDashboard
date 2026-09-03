// Minimaler IndexedDB-Wrapper NUR für den Workout-Rohdatenbestand (RAW)
// Mit 2-Jahres-Filter und Training Effects Berechnung

const IDB_DB_NAME = "triathlon_dashboard_idb";
const IDB_STORE_NAME = "kv";
const IDB_RAW_KEY = "triathlon_dashboard_data_v1";
const TWO_YEARS_DAYS = 730; // Ungefähr 2 Jahre

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

// Filter: nur Workouts der letzten 2 Jahre behalten
function filterWorkoutsByDate(workouts, daysToKeep = TWO_YEARS_DAYS) {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - daysToKeep * 24 * 60 * 60 * 1000);

  const filtered = workouts.filter(w => {
    const wDate = new Date(w.date);
    return wDate >= cutoffDate;
  });

  const removed = workouts.length - filtered.length;

  return {
    workouts: filtered,
    removed: removed,
    cutoffDate: cutoffDate.toISOString().split('T')[0]
  };
}

// Speichern mit Filter + Training Effects
async function idbSaveRawFiltered(raw, userMaxHR = 185) {
  // 1. Filter auf 2 Jahre
  const filterResult = filterWorkoutsByDate(raw.workouts);

  // 2. Training Effects für alle verbleibenden Workouts berechnen
  const workoutsWithEffects = filterResult.workouts.map(w => {
    if (!w.training_effects) {
      w.training_effects = calculateTrainingEffects(w, userMaxHR);
    }
    return w;
  });

  // 3. Neue RAW zusammenstellen
  const filteredRaw = {
    ...raw,
    workouts: workoutsWithEffects,
    last_filtered: new Date().toISOString(),
    workouts_removed_before: filterResult.cutoffDate,
    workouts_removed_count: filterResult.removed
  };

  // 4. In IndexedDB speichern
  const db = await openWorkoutsIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, "readwrite");
    tx.objectStore(IDB_STORE_NAME).put(filteredRaw, IDB_RAW_KEY);
    tx.oncomplete = () => {
      resolve({
        success: true,
        message: `Speichert ${workoutsWithEffects.length} Workouts (${filterResult.removed} älter als 2 Jahre gelöscht)`,
        removed: filterResult.removed
      });
    };
    tx.onerror = () => reject(tx.error);
  });
}

// Alte Version ohne Filter (für Kompatibilität)
async function idbSaveRaw(raw, userMaxHR = 185) {
  // Training Effects berechnen, aber OHNE 2-Jahres-Filter
  const workoutsWithEffects = raw.workouts.map(w => {
    if (!w.training_effects) {
      w.training_effects = calculateTrainingEffects(w, userMaxHR);
    }
    return w;
  });

  const rawWithEffects = {
    ...raw,
    workouts: workoutsWithEffects
  };

  const db = await openWorkoutsIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, "readwrite");
    tx.objectStore(IDB_STORE_NAME).put(rawWithEffects, IDB_RAW_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Abrufen
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

// Löschen
async function idbClearRaw() {
  const db = await openWorkoutsIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, "readwrite");
    tx.objectStore(IDB_STORE_NAME).delete(IDB_RAW_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
