// Liest die Daten des bisherigen Doppelklick-Dashboards aus diesem Browser
// (localStorage + IndexedDB, siehe frueher js/data/idb-store.js) und speichert
// sie als dashboard-export.json. Danach im Projektordner:
//   python backend/import_workouts_json.py --user <name> --browser-export dashboard-export.json
// Wird NICHT vom Server ausgeliefert - nur per Doppelklick (file://) nutzbar.

const PREFIX = "triathlon_dashboard_";
const SKIP_KEYS = ["triathlon_dashboard_theme_v1", "triathlon_dashboard_token_v1"];

function readLocalStorage() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(PREFIX) && !SKIP_KEYS.includes(key)) out[key] = localStorage.getItem(key);
  }
  return out;
}

// Workouts, die das alte Dashboard nach einem Browser-Import in IndexedDB abgelegt hat.
function readIdbWorkouts() {
  return new Promise(resolve => {
    if (!("indexedDB" in window)) { resolve([]); return; }
    const req = indexedDB.open("triathlon_dashboard_idb");
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) { resolve([]); return; }
      const get = db.transaction("kv", "readonly").objectStore("kv").get("triathlon_dashboard_data_v1");
      get.onsuccess = () => resolve((get.result && Array.isArray(get.result.workouts)) ? get.result.workouts : []);
      get.onerror = () => resolve([]);
    };
  });
}

(async function initExport() {
  const statusEl = document.getElementById("export-status");
  const btn = document.getElementById("export-btn");
  const local = readLocalStorage();
  let workouts = await readIdbWorkouts();
  // Noch aelterer Stand von vor der IndexedDB-Umstellung
  try {
    const legacy = JSON.parse(local.triathlon_dashboard_data_v1 || "null");
    if (!workouts.length && legacy && Array.isArray(legacy.workouts)) workouts = legacy.workouts;
  } catch (e) { /* ignorieren */ }
  delete local.triathlon_dashboard_data_v1;

  const areas = Object.keys(local).length;
  if (!areas && !workouts.length) {
    statusEl.textContent = "In diesem Browser wurden keine Dashboard-Daten gefunden. Öffne die Seite im Browser, mit dem du das alte Dashboard benutzt hast.";
    return;
  }
  statusEl.textContent = `Gefunden: ${areas} Bereiche (Profil, Ziele, Plan …) und ${workouts.length} Workouts.`;
  btn.hidden = false;
  btn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), localStorage: local, workouts })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dashboard-export.json";
    a.click();
    statusEl.textContent = "Gespeichert. Jetzt im Projektordner: python backend/import_workouts_json.py --user <name> --browser-export dashboard-export.json";
  });
})();
