// Equipment-Tracking (Laufschuhe, Rad + Verschleißteile, freie Items) mit
// Kilometer-basierter Warnung vor Service/Aussortieren - siehe
// CHANGE_REQUESTS.md. Rein clientseitig in localStorage, gleiches Muster wie
// athleteProfile (js/data/athlete.js) bzw. hybridSettings (js/ai/provider.js).
// UI + Kalender-/Dashboard-Banner: js/components/equipment.js.
//
// Drei Item-"Arten" - kein eigenes "type"-Feld nötig, ergibt sich aus der
// Kombination der gesetzten Felder:
//   A) Sportart-Ausrüstung (sport gesetzt, parentId leer) - z.B. Laufschuhe,
//      das Rad selbst. Kilometer werden automatisch aus den Workouts der
//      passenden Sportart gezählt, aber NUR während das Item "aktueller
//      Standard" für diese Sportart ist (activeFrom..activeTo-Fenster, siehe
//      setEquipmentDefaultForSport()) - so bleibt die Kilometerzahl alter,
//      bereits abgelöster Ausrüstung eingefroren statt sich weiter zu
//      erhöhen. Wird bei Erreichen des Limits ausrangiert (retired), nicht
//      "gewartet" - für neue Schuhe/ein neues Rad legt man ein neues Item an.
//   B) Verschleißteil (parentId gesetzt, zeigt auf ein Item der Art A) -
//      z.B. Kette/Reifen/Bremsbeläge am selben Rad. Teilt sich die
//      Kilometer des Eltern-Items (dessen aktives Fenster), zählt aber nur
//      seit dem eigenen "resetAt" (wird beim Tausch/Service zurückgesetzt,
//      das Item selbst bleibt bestehen statt neu angelegt zu werden).
//   C) Freies Item (weder sport noch parentId) - z.B. Neoprenanzug,
//      Sportbrille. Keine Workout-Sportart passt eindeutig, also keine
//      automatische Zuordnung möglich - Kilometerstand wird manuell in
//      "manualKm" gepflegt (keine erfundenen Werte, siehe AI_RULES.md).

const EQUIPMENT_ITEMS_KEY = "triathlon_dashboard_equipment_items_v1";

let equipmentItems = [];

function loadEquipmentItems() {
  try {
    const raw = localStorage.getItem(EQUIPMENT_ITEMS_KEY);
    if (raw) equipmentItems = JSON.parse(raw);
  } catch (e) { /* Default (leer) beibehalten */ }
}

function saveEquipmentItems() {
  try { localStorage.setItem(EQUIPMENT_ITEMS_KEY, JSON.stringify(equipmentItems)); } catch (e) { /* ignorieren */ }
}

function genEquipmentId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("eq" + Date.now() + Math.random().toString(16).slice(2));
}

function todayKey() { return new Date().toISOString().slice(0, 10); }

/* ---------- Anlegen / Ändern / Löschen ---------- */

function addEquipmentItem(data) {
  const item = {
    id: genEquipmentId(),
    name: (data.name || "").trim(),
    category: data.category || "Sonstiges", // nur Anzeige/Icon, keine Logik-Abhängigkeit
    sport: data.sport || null, // "Laufen"|"Rad"|"Schwimmen"|null
    parentId: data.parentId || null,
    serviceIntervalKm: data.serviceIntervalKm != null ? Number(data.serviceIntervalKm) : null,
    startKm: data.startKm != null ? Number(data.startKm) : 0,
    activeFrom: null,
    activeTo: null,
    resetAt: data.parentId ? todayKey() : null,
    manualKm: (!data.sport && !data.parentId) ? Number(data.manualKm) || 0 : null,
    retired: false,
    note: data.note ? String(data.note).slice(0, 300) : "",
    createdAt: todayKey(),
  };
  equipmentItems.push(item);
  // Direkt beim Anlegen als Standard setzen, wenn es das erste Item dieser
  // Sportart ist (Komfort - sonst müsste man extra noch einmal klicken).
  if (item.sport && !equipmentItems.some(x => x.id !== item.id && x.sport === item.sport && x.activeTo == null && x.activeFrom)) {
    setEquipmentDefaultForSport(item.id);
  }
  saveEquipmentItems();
  return item;
}

// Setzt ein Sportart-Ausrüstungs-Item (Art A) als aktuellen Standard für
// seine Sportart - alle anderen bisher aktiven Items derselben Sportart
// werden zum heutigen Tag "abgelöst" (activeTo gesetzt, ihre bisherige
// Kilometerzahl bleibt dadurch eingefroren statt weiterzulaufen).
function setEquipmentDefaultForSport(id) {
  const item = equipmentItems.find(x => x.id === id);
  if (!item || !item.sport || item.parentId) return;
  const today = todayKey();
  equipmentItems.forEach(x => {
    if (x.id !== item.id && x.sport === item.sport && !x.parentId && x.activeTo == null && x.activeFrom) {
      x.activeTo = today;
    }
  });
  if (!item.activeFrom) item.activeFrom = today;
  item.activeTo = null;
  item.retired = false;
  saveEquipmentItems();
}

// Verschleißteil (Art B) als gewartet/getauscht markieren - Zähler startet
// wieder bei 0, das Item selbst bleibt bestehen (anders als bei Art A, wo
// man für neue Ausrüstung ein neues Item anlegt statt zu "resetten").
function resetEquipmentPart(id) {
  const item = equipmentItems.find(x => x.id === id);
  if (!item || !item.parentId) return;
  item.resetAt = todayKey();
  saveEquipmentItems();
}

// Manuellen Kilometerstand eines freien Items (Art C) aktualisieren.
function setEquipmentManualKm(id, km) {
  const item = equipmentItems.find(x => x.id === id);
  if (!item) return;
  item.manualKm = Number(km) || 0;
  saveEquipmentItems();
}

// Item aussortieren - stoppt bei Art A das aktive Zähl-Fenster (falls
// gerade aktiv), Verschleißteile/freie Items werden nur als retired markiert.
function retireEquipmentItem(id) {
  const item = equipmentItems.find(x => x.id === id);
  if (!item) return;
  item.retired = true;
  if (item.sport && !item.parentId && item.activeFrom && item.activeTo == null) {
    item.activeTo = todayKey();
  }
  saveEquipmentItems();
}

function reactivateEquipmentItem(id) {
  const item = equipmentItems.find(x => x.id === id);
  if (!item) return;
  item.retired = false;
  saveEquipmentItems();
}

// Löscht ein Item - hängt daran ein Rad (Art A) mit Verschleißteilen (Art B),
// werden diese mitgelöscht (sonst blieben verwaiste Teile ohne Eltern-Rad
// zurück, deren Kilometerberechnung dann ins Leere liefe).
function deleteEquipmentItem(id) {
  const childIds = equipmentItems.filter(x => x.parentId === id).map(x => x.id);
  const toRemove = new Set([id, ...childIds]);
  equipmentItems = equipmentItems.filter(x => !toRemove.has(x.id));
  saveEquipmentItems();
}

/* ---------- Kilometerstand / Fälligkeit ---------- */

// Summe der Distanzen aller (nicht-Zusammenfassungs-)Workouts einer
// Sportart in einem Datumsfenster [fromKey, toKey) - toKey=null heißt "bis
// heute". Reuse von sportGroup()/ALL (js/data/workouts.js) statt einer
// eigenen Workout-Sportart-Zuordnung.
function kmForSportWindow(sport, fromKey, toKey) {
  if (!fromKey) return 0;
  return ALL.reduce((sum, w) => {
    if (w.is_summary || !w._date || sportGroup(w.sport) !== sport) return sum;
    const key = w._date.toISOString().slice(0, 10);
    if (key < fromKey) return sum;
    if (toKey && key >= toKey) return sum;
    return sum + (w.distance_km || 0);
  }, 0);
}

// Aktueller Kilometerstand eines Items, unabhängig von der Art (A/B/C).
function equipmentKm(item) {
  if (item.parentId) {
    const parent = equipmentItems.find(x => x.id === item.parentId);
    if (!parent || !parent.activeFrom) return 0;
    // Verschleißteil zählt nur, seit es zuletzt gewartet wurde, UND nur
    // innerhalb des aktiven Fensters des Eltern-Rads (falls das Rad
    // zwischenzeitlich abgelöst wurde, zählt für das Teil danach nichts
    // mehr automatisch dazu).
    const fromKey = item.resetAt && item.resetAt > parent.activeFrom ? item.resetAt : parent.activeFrom;
    return kmForSportWindow(parent.sport, fromKey, parent.activeTo);
  }
  if (item.sport) {
    return (item.startKm || 0) + kmForSportWindow(item.sport, item.activeFrom, item.activeTo);
  }
  return item.manualKm || 0;
}

// Status eines Items für Warnungen/Badges: "retired" (aussortiert),
// "nolimit" (kein Service-Intervall hinterlegt, rein informativ), "ok",
// "soon" (>=85% des Intervalls) oder "due" (Intervall erreicht/überschritten).
function equipmentStatus(item) {
  const km = equipmentKm(item);
  if (item.retired) return { state: "retired", km };
  if (!item.serviceIntervalKm) return { state: "nolimit", km };
  const pct = km / item.serviceIntervalKm;
  const state = pct >= 1 ? "due" : pct >= 0.85 ? "soon" : "ok";
  return { state, km, pct };
}

// Alle aktiven (nicht aussortierten) Items, die fällig oder bald fällig
// sind - Grundlage für den Kalender-/Dashboard-Hinweis (siehe
// renderEquipmentBanner(), js/components/equipment.js).
function dueEquipmentItems() {
  return equipmentItems
    .filter(item => !item.retired)
    .map(item => ({ item, status: equipmentStatus(item) }))
    .filter(x => x.status.state === "due" || x.status.state === "soon")
    .sort((a, b) => (b.status.pct || 0) - (a.status.pct || 0));
}
