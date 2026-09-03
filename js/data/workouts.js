// Workout-Rohdaten: Laden, Speichern, Ableiten (ALL/DATA), Filterzustand.
// Haengt von data/workouts-data.js (EMBEDDED_DATA) ab, das vor dieser Datei geladen werden muss.

const STORAGE_KEY = "triathlon_dashboard_data_v1";

// Wie weit "Aktualisieren" beim Ordner-Scan zurückschaut. War kurzzeitig auf
// 2 Jahre (730) reduziert, weil 10 Jahre bei Nicos 1000+ .fit-Dateien das
// localStorage-Limit gesprengt haben - das war aber nur eine Notlösung, der
// eigentliche Speicherplatz-Engpass ist jetzt behoben (Umstellung von
// localStorage auf IndexedDB, siehe js/data/idb-store.js und
// loadPersistedWorkouts() unten). Deshalb wieder auf 10 Jahre erhöht.
const SCAN_WINDOW_DAYS = 3650;


// EMBEDDED_DATA kommt aus data/workouts-data.js - diese Datei enthält echte
// Trainingsdaten und wird bewusst NICHT mit ausgeliefert/versioniert (siehe
// .gitignore). Ohne lokal per build_dashboard.py erzeugte Datei existiert die
// Variable also nicht - dann mit einem leeren Datenbestand starten, statt
// dass das komplette Dashboard mit einem ReferenceError abstürzt.
const EMPTY_EMBEDDED_DATA = { generated_at: null, source_folder: null, count: 0, skipped: [], workouts: [] };
let RAW = (typeof EMBEDDED_DATA !== "undefined") ? EMBEDDED_DATA : EMPTY_EMBEDDED_DATA;

// Lädt den zuletzt gespeicherten Workout-Stand aus IndexedDB (js/data/idb-store.js)
// und führt ihn wie bisher mit den eingebetteten Daten zusammen. War früher
// ein synchroner localStorage-Read direkt hier an dieser Stelle (Skript-Ladezeit) -
// IndexedDB ist aber grundsätzlich asynchron, deshalb jetzt eine eigene
// Funktion, die app.js VOR dem ersten renderAll() abwartet (siehe dort).
// Grund für den Wechsel: localStorage ist pro Seite hart auf ca. 5-10MB
// gedeckelt - bei Nicos 1000+ Workouts (auch mit dem bereits vorhandenen
// 200-Punkte-Downsampling der Kurven in fit-parser.js) reicht das nicht mehr.
async function loadPersistedWorkouts() {
  try {
    let saved = await idbGetRaw();

    // Einmalige Migration: falls noch ein alter Stand aus localStorage von
    // VOR dieser Umstellung existiert (und IndexedDB noch leer ist), diesen
    // übernehmen statt ihn kommentarlos zu verlieren.
    if (!saved) {
      try {
        const legacy = localStorage.getItem(STORAGE_KEY);
        if (legacy) {
          const parsedLegacy = JSON.parse(legacy);
          if (parsedLegacy && Array.isArray(parsedLegacy.workouts) && parsedLegacy.workouts.length) {
            saved = parsedLegacy;
            await idbSaveRaw(saved);
          }
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) { /* kein verwertbarer alter Stand - ignorieren */ }
    }

    if (saved && Array.isArray(saved.workouts) && saved.workouts.length) {
      // Den gespeicherten Stand NIE blind übernehmen, sondern immer mit den
      // eingebetteten Daten (dem bei der letzten Erstellung aktuellen,
      // vollständigen Stand) zusammenführen. So kann ein älterer oder
      // unvollständiger Stand (z.B. von einem früheren, fehlerhaften
      // "Aktualisieren"-Versuch) nie dazu führen, dass Trainings beim Öffnen
      // des Dashboards "verschwinden" - er kann nur ergänzen.
      const base = (typeof EMBEDDED_DATA !== "undefined") ? EMBEDDED_DATA : EMPTY_EMBEDDED_DATA;
      const merged = new Map(base.workouts.map(w => [w.file, w]));
      saved.workouts.forEach(w => { if (w && w.file) merged.set(w.file, w); });
      const allWorkouts = [...merged.values()];
      postProcessWorkouts(allWorkouts);
      allWorkouts.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      RAW = { ...base, ...saved, workouts: allWorkouts, count: allWorkouts.length };
    }
  } catch (e) { /* IndexedDB evtl. nicht verfügbar (z.B. privater Modus) - eingebettete Daten nutzen */ }
  recomputeDerived();
}

/* ======================================================================
   Hell/Dunkel-Schalter: übersteuert die automatische Betriebssystem-
   Einstellung, sobald der Nutzer aktiv umschaltet; Wahl wird gemerkt.
   ====================================================================== */

let ALL = [], DATA = [];

let justAddedFiles = new Set(); // Dateinamen, die beim letzten "Aktualisieren" neu hinzugekommen sind (für die Hervorhebung in der Tabelle)

let calMonth = new Date(); calMonth.setDate(1); calMonth.setHours(0, 0, 0, 0); // aktuell angezeigter Monat im Kalender-Tab

let calSportFilter = "all"; // Sportart-Filter im Kalender-Tab ("all" oder z.B. "Rad")

const MONTH_NAMES_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function recomputeDerived() {
  ALL = RAW.workouts.map(w => ({ ...w, _date: w.date ? new Date(w.date) : null }));
  DATA = ALL.filter(w => !w.is_summary);
}
recomputeDerived();


const SPORT_COLOR = { "Schwimmen": "var(--c-schwimmen)", "Rad": "var(--c-rad)", "Laufen": "var(--c-laufen)" };

function sportColor(sport) { return SPORT_COLOR[sport] || "var(--c-sonstiges)"; }

function sportGroup(sport) { return SPORT_COLOR[sport] ? sport : "Sonstiges"; }


// customFrom/customTo (Date | null) überschreiben rangeDays, wenn gesetzt -
// so kann der Zeitraum entweder über die festen Chips (7/30/90/1 Jahr/Alle)
// ODER frei per Von/Bis-Datum gewählt werden (siehe initFilterBar).
const filterState = { rangeDays: 30, sports: new Set(["Schwimmen", "Rad", "Laufen", "Sonstiges"]), customFrom: null, customTo: null };


function getFilteredData() {
  let cutoff = null, upper = null;
  if (filterState.customFrom || filterState.customTo) {
    cutoff = filterState.customFrom || null;
    upper = filterState.customTo || null;
  } else if (filterState.rangeDays != null) {
    cutoff = new Date(Date.now() - filterState.rangeDays * 86400000);
  }
  return DATA.filter(w => {
    if (!w._date) return false;
    if (cutoff && w._date < cutoff) return false;
    if (upper && w._date > upper) return false;
    return filterState.sports.has(sportGroup(w.sport));
  });
}

// Montag der Woche, in der `d` liegt (00:00 Uhr) - gemeinsame Basis für den
// Wochenumfang-Chart und den Kalender, damit beide dieselben Wochengrenzen nutzen.
