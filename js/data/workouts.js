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
      // Dubletten zusammenfuehren, BEVOR die Multisport-/Wechsel-Erkennung
      // laeuft - die gruppiert nach Tag und wuerde sich von doppelten
      // Einheiten in die Irre fuehren lassen.
      const allWorkouts = dedupeWorkouts([...merged.values()]);
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

// _rideEnv wird hier EINMAL pro Laden materialisiert (gleiche Konvention wie
// _date) - das macht Indoor/Outdoor ohne Schema-Migration und ohne Re-Import
// verfügbar: Altdaten werden aus den bereits gespeicherten Feldern abgeleitet
// (sub_sport/is_indoor), fehlt alles, bleibt der Wert null.
function recomputeDerived() {
  // Dubletten hier zentral entfernen und in RAW zurueckschreiben, damit auch
  // ein anschliessendes Speichern (IndexedDB) einen sauberen Stand sichert -
  // sonst wuerden sich Doppelungen ueber die Zeit aufsummieren.
  const clean = dedupeWorkouts(RAW.workouts);
  if (clean.length !== RAW.workouts.length) {
    clean.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    RAW = { ...RAW, workouts: clean, count: clean.length };
  }
  ALL = RAW.workouts.map(w => ({ ...w, _date: w.date ? new Date(w.date) : null, _rideEnv: rideEnvironment(w) }));
  DATA = ALL.filter(w => !w.is_summary);
}
// Erstaufruf steht bewusst WEITER UNTEN, nach den const-Definitionen
// (SPORT_COLOR, RIDE_ENV_*), die rideEnvironment() braucht - sonst liefe er in
// die temporal dead zone der Konstanten.


const SPORT_COLOR = { "Schwimmen": "var(--c-schwimmen)", "Rad": "var(--c-rad)", "Laufen": "var(--c-laufen)" };

// Akzeptiert auch die zusammengesetzten Labels aus comparisonGroupLabel()
// ("Rad (Indoor)", "Schwimmen (Becken)") - die behalten die Farbe ihrer
// Sportart, unterschieden wird dort über Strichart/Text, nicht über die Farbe.
function sportColor(sport) { return SPORT_COLOR[sport] || SPORT_COLOR[String(sport).replace(/\s*\(.*\)$/, "")] || "var(--c-sonstiges)"; }

function sportGroup(sport) { return SPORT_COLOR[sport] ? sport : "Sonstiges"; }


/* ======================================================================
   INDOOR/OUTDOOR BEIM RAD ("Umgebung")

   Indoor-/virtuelles Radtraining (Rollentrainer + Plattform wie MyWhoosh,
   Zwift, Rouvy) bleibt bewusst eine UNTERkategorie von sport="Rad":
   w.sport === "Rad" trifft solche Einheiten weiter, alle Rad-Summen und
   -Farben bleiben unverändert. Eine eigene Sportart wäre die schlechtere
   Lösung - dann würde Indoor aus den Rad-Gesamtwerten herausfallen.

   Der Grund für die Trennung ist ein anderer: Distanz und km/h werden
   indoor von der Plattform SIMULIERT (Kurs, Windschatten, Avatar-Gewicht)
   und sind mit echten Straßenwerten nicht vergleichbar. Jede
   Referenzgruppe muss deshalb innerhalb einer Umgebung bleiben, und die
   Auswertung stützt sich indoor auf Leistung (Watt/NP/W-pro-kg/%FTP),
   Herzfrequenz, Dauer und Trainingsbelastung statt auf Kilometer.
   ====================================================================== */

// Signale nach Verlässlichkeit geordnet (siehe rideEnvironment). Bewusst
// deutsche UND englische Rohwerte, weil backend/garmin_sync.py den
// activitySubType von Garmin Connect als englisches Token durchreicht.
const RIDE_ENV_INDOOR_LABELS = new Set(["Indoor", "Virtuell", "Rolle", "indoor_cycling", "virtual_activity", "virtual_ride", "spin"]);
const RIDE_ENV_OUTDOOR_LABELS = new Set(["Straße", "road", "gravel_cycling", "mountain", "cyclocross", "commuting"]);

const RIDE_ENV_LABEL_DE = { indoor: "Indoor", outdoor: "Outdoor" };

// "indoor" | "outdoor" | null (=ehrlich unbekannt, wird NIE geraten).
// Nur Radeinheiten haben diese Dimension.
function rideEnvironment(w) {
  if (!w || sportGroup(w.sport) !== "Rad") return null;
  if (w.sub_sport && RIDE_ENV_INDOOR_LABELS.has(w.sub_sport)) return "indoor";
  if (w.is_indoor === true) return "indoor";                      // Developer-Feld "SESSION INDOOR" (HealthFit)
  if (w.sub_sport && RIDE_ENV_OUTDOOR_LABELS.has(w.sub_sport)) return "outdoor";
  if (w.is_indoor === false) return "outdoor";
  if (w.has_gps === true) return "outdoor";                       // GPS-Track -> zwingend draußen
  if (w.has_gps === false) return "indoor";                       // Rad ohne GPS -> Rolle
  return null;                                                    // Altbestand ohne diese Felder
}

// Schlüssel/Label ALLER Referenzgruppen - eine Definition statt der früher
// an mehreren Stellen duplizierten sportGroup()-Bedingung.
function comparisonGroupLabel(w) {
  const grp = sportGroup(w.sport);
  if (grp === "Rad") {
    const env = w._rideEnv !== undefined ? w._rideEnv : rideEnvironment(w);
    return env ? `Rad (${RIDE_ENV_LABEL_DE[env]})` : "Rad";
  }
  if (grp === "Schwimmen" && w.sub_sport) return `Schwimmen (${w.sub_sport})`;
  return grp;
}

// Darf `cand` in die Referenzgruppe von `ref`?
//
// Bewusste Asymmetrie: beim Rad STRIKT, beim Schwimmen weiter tolerant. Bei
// Becken/Freiwasser ist die Pace nur verzerrt, bei Indoor-Kilometern ist sie
// erfunden - dort gilt "lieber keine Vergleichsgruppe als eine falsche".
// Ist die eigene Umgebung unbekannt (Altdaten), wird nicht gefiltert, damit
// bestehende Auswertungen nicht ersatzlos wegfallen.
function sameComparisonGroup(ref, cand) {
  const grp = sportGroup(ref.sport);
  if (sportGroup(cand.sport) !== grp) return false;
  if (grp === "Rad") {
    const a = ref._rideEnv !== undefined ? ref._rideEnv : rideEnvironment(ref);
    if (a == null) return true;
    const b = cand._rideEnv !== undefined ? cand._rideEnv : rideEnvironment(cand);
    return a === b;
  }
  if (grp === "Schwimmen" && ref.sub_sport) return !cand.sub_sport || cand.sub_sport === ref.sub_sport;
  return true;
}

function isIndoorRide(w) { return (w._rideEnv !== undefined ? w._rideEnv : rideEnvironment(w)) === "indoor"; }


/* ======================================================================
   DUBLETTEN ZUSAMMENFUEHREN

   Der Dublettenschutz haengt ueblicherweise am Dateinamen (w.file). Das
   reicht nicht, sobald dasselbe Training aus zwei Quellen kommt - die
   Dateinamen unterscheiden sich dann:
     MyWhoosh-Export : "MyNewActivity-6.1.0_2026-09-09_205100.fit"
     Garmin-Sync     : "2026-09-09-06-07-16.fit"

   An echten Daten beobachtete Faelle:
     1. Dieselbe Einheit mehrfach aus derselben Quelle exportiert
        (MyWhoosh legt bei jedem Export eine neue Datei an).
     2. Dieselbe Fahrt von ZWEI Geraeten aufgezeichnet (Uhr + Rollen-App).
        Dann weichen die Startzeiten um bis zu ein paar Minuten ab, das
        ENDE stimmt aber ueberein - deshalb wird beides geprueft.

   Bewusst KEIN Zusammenfuehren allein ueber die Startzeit: zwei echte,
   kurz aufeinanderfolgende Einheiten wuerden sonst faelschlich zu einer.
   ====================================================================== */

const DUPLICATE_TOLERANCE_S = 180; // Start und Ende duerfen je bis zu 3 Min. abweichen

function workoutStartEndMs(w) {
  const start = w.date ? new Date(w.date).getTime() : NaN;
  if (isNaN(start)) return null;
  const durS = w.duration_s != null ? w.duration_s : (w.duration_min != null ? w.duration_min * 60 : null);
  return { start, end: durS != null ? start + durS * 1000 : start };
}

// Wie "reichhaltig" ist ein Datensatz? Bei Dubletten gewinnt der vollstaendigere -
// in der Praxis die Original-.fit aus dem Garmin-Sync, weil sie Sekundenkurven,
// Leistung und Bahnen enthaelt, waehrend aeltere Importe oft nur Eckdaten haben.
function workoutRichness(w) {
  let score = 0;
  if (w.stream && w.stream.t) score += 1000 + w.stream.t.length;
  if (w.lengths && w.lengths.length) score += 500;
  Object.keys(w).forEach(k => { if (w[k] != null && !k.startsWith("_")) score++; });
  return score;
}

// Fasst Einheiten zusammen, die dasselbe Training beschreiben. Der reichhaltigste
// Datensatz gewinnt; fehlende Einzelwerte werden aus den schwaecheren Dubletten
// ergaenzt, damit nichts verloren geht (z.B. eine Notiz/Bewertung am alten Eintrag).
function dedupeWorkouts(workouts) {
  const withTime = [], withoutTime = [];
  workouts.forEach(w => (workoutStartEndMs(w) ? withTime : withoutTime).push(w));
  withTime.sort((a, b) => workoutStartEndMs(a).start - workoutStartEndMs(b).start);

  const groups = [];
  withTime.forEach(w => {
    const t = workoutStartEndMs(w);
    const hit = groups.find(g =>
      g.sport === w.sport_raw &&
      Math.abs(g.start - t.start) <= DUPLICATE_TOLERANCE_S * 1000 &&
      Math.abs(g.end - t.end) <= DUPLICATE_TOLERANCE_S * 1000);
    if (hit) hit.items.push(w);
    else groups.push({ sport: w.sport_raw, start: t.start, end: t.end, items: [w] });
  });

  const merged = groups.map(g => {
    if (g.items.length === 1) return g.items[0];
    const sorted = [...g.items].sort((a, b) => workoutRichness(b) - workoutRichness(a));
    const best = { ...sorted[0] };
    sorted.slice(1).forEach(other => {
      Object.keys(other).forEach(k => {
        if (best[k] == null && other[k] != null) best[k] = other[k];
      });
    });
    // Nachvollziehbar machen, dass hier zusammengefasst wurde.
    best._mergedFrom = sorted.slice(1).map(o => o.file);
    return best;
  });

  return merged.concat(withoutTime);
}

// Kennzeichnung in Tabelle/Kalender/Detailansicht. BEWUSST nur für Indoor:
// Outdoor ist der Normalfall, ein Label an jeder Straßenausfahrt wäre Rauschen.
function rideEnvBadgeHtml(w) {
  if (!isIndoorRide(w)) return "";
  const txt = w.sub_sport === "Virtuell" ? "Virtuell" : "Indoor";
  return `<span class="env-badge" title="Indoor-/virtuelle Radeinheit (Rolle bzw. Plattform) — Distanz und Geschwindigkeit sind simuliert und werden nur mit anderen Indoor-Einheiten verglichen">${txt}</span>`;
}

recomputeDerived(); // erst hier: alle von rideEnvironment() genutzten Konstanten sind jetzt initialisiert


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
