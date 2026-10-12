// Equipment-Tracking (Laufschuhe, Rad + Verschleißteile, freie Items) mit
// Kilometer-basierter Warnung vor Service/Aussortieren - siehe
// CHANGE_REQUESTS.md. Gespeichert in der Datenbank auf dem Server (Tabellen
// equipment + equipment_workouts, Endpunkte /api/v1/equipment, siehe
// backend/equipment_routes.py), je Person getrennt. Die Kilometer rechnet
// weiterhin dieses Modul aus den Workouts (ALL) - sie stehen nicht in der DB.
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
//      Einzelne Trainings lassen sich zusätzlich AUSDRÜCKLICH einem Item
//      zuordnen (equipmentAssignments, assignWorkoutToEquipment()): so ein
//      Training zählt dann nur für dieses Item, egal in welchem Zeitfenster
//      es liegt - alle anderen zählen weiter automatisch wie beschrieben.
//   B) Verschleißteil (parentId gesetzt, zeigt auf ein Item der Art A) -
//      z.B. Kette/Reifen/Bremsbeläge am selben Rad. Teilt sich die
//      Kilometer des Eltern-Items (dessen aktives Fenster), zählt aber nur
//      seit dem eigenen "resetAt" (wird beim Tausch/Service zurückgesetzt,
//      das Item selbst bleibt bestehen statt neu angelegt zu werden).
//   C) Freies Item (weder sport noch parentId) - z.B. Neoprenanzug,
//      Sportbrille. Keine Workout-Sportart passt eindeutig, also keine
//      automatische Zuordnung möglich - Kilometerstand wird manuell in
//      "manualKm" gepflegt (keine erfundenen Werte, siehe AI_RULES.md).
//
// Die Items hier haben die Form des Dashboards (category, serviceIntervalKm,
// retired ...); equipmentFromApi()/equipmentToApi() übersetzen in die
// Datenbank-Spalten (typ, max_km, aktiv ...), alles Übrige liegt dort
// unverändert in `details`. Die ids sind Texte (wie früher die UUIDs).

// Warnung "bald fällig" ab diesem Anteil von max_km (serviceIntervalKm).
const EQUIPMENT_WARN_RATIO = 0.9;

// Frühere Ablage der Liste (Ablage pro Person). Wird nur noch einmal gelesen,
// um sie in die Datenbank zu übernehmen, und danach als Sicherheitskopie
// stehen gelassen. EQUIPMENT_MIGRATED_KEY merkt sich, dass das passiert ist -
// sonst käme die alte Liste zurück, sobald man alles gelöscht hat.
const EQUIPMENT_ITEMS_KEY = "triathlon_dashboard_equipment_items_v1";
const EQUIPMENT_MIGRATED_KEY = "triathlon_dashboard_equipment_migrated_v1";

let equipmentItems = [];
let equipmentAssignments = new Map(); // workout.file -> id des Items, dem das Training ausdrücklich zugeordnet ist

/* ---------- Server: Übersetzung, Laden, Speichern ---------- */

function equipmentFromApi(row) {
  const d = row.details || {};
  return {
    id: String(row.id),
    name: row.name,
    category: row.typ,
    sport: row.sport || null,
    parentId: row.parent_id != null ? String(row.parent_id) : null,
    serviceIntervalKm: row.max_km != null ? row.max_km : null,
    startKm: row.start_km || 0,
    activeFrom: d.activeFrom || null,
    activeTo: d.activeTo || null,
    resetAt: d.resetAt || null,
    manualKm: d.manualKm != null ? d.manualKm : null,
    retired: !row.aktiv,
    note: d.note || "",
    createdAt: d.createdAt || null,
  };
}

function equipmentToApi(item) {
  const km = v => (v != null && v !== "" && Number.isFinite(Number(v))) ? Math.max(0, Number(v)) : null;
  return {
    name: String(item.name || "Ohne Namen").slice(0, 255),
    typ: item.category || "Sonstiges",
    sport: item.sport || null,
    parent_id: item.parentId ? Number(item.parentId) : null,
    start_km: km(item.startKm) || 0,
    max_km: km(item.serviceIntervalKm),
    aktiv: !item.retired,
    details: {
      activeFrom: item.activeFrom || null,
      activeTo: item.activeTo || null,
      resetAt: item.resetAt || null,
      manualKm: km(item.manualKm),
      note: item.note || "",
      createdAt: item.createdAt || null,
    },
  };
}

// Body für die einmalige Übernahme der alten Liste (POST equipment/import):
// die alte Kennung wandert als ref/parent_ref mit, der Server vergibt neue ids.
function equipmentImportPayload(oldItems) {
  return {
    items: oldItems.map(item => ({
      ...equipmentToApi({ ...item, parentId: null }),
      ref: String(item.id),
      parent_ref: item.parentId ? String(item.parentId) : null,
    })),
  };
}

// Holt Equipment + Zuordnungen vom Server. Läuft NACH loadUserStore() (die
// einmalige Übernahme liest die alte Liste aus der Ablage). Scheitert es,
// startet das Dashboard trotzdem: jede Änderung schreibt nur das jeweilige
// Item, es kann also nichts Bestehendes überschrieben werden.
async function loadEquipmentItems() {
  try {
    const [items, links] = await Promise.all([apiCall("equipment"), apiCall("equipment/assignments")]);
    equipmentItems = items.data.map(equipmentFromApi);
    equipmentAssignments = new Map(links.data.map(l => [l.workout_file, String(l.equipment_id)]));
    if (!equipmentItems.length) await migrateEquipmentFromStore();
  } catch (e) {
    showApiError(`Equipment konnte nicht geladen werden (${e.message}). Bitte die Seite neu laden.`);
  }
}

async function migrateEquipmentFromStore() {
  const old = storeGet(EQUIPMENT_ITEMS_KEY);
  if (storeGet(EQUIPMENT_MIGRATED_KEY) || !Array.isArray(old) || !old.length) return;
  const res = await apiCall("equipment/import", "POST", equipmentImportPayload(old));
  equipmentItems = res.data.map(equipmentFromApi);
  storeSet(EQUIPMENT_MIGRATED_KEY, true);
}

// Änderungen gehen nacheinander zum Server (in der Reihenfolge der Klicks);
// die Anzeige ändert sich sofort. Ein Fehler erscheint im Hinweisbanner.
let equipmentSyncChain = Promise.resolve();

function syncEquipment(endpoint, method, body) {
  equipmentSyncChain = equipmentSyncChain
    .then(() => apiCall(endpoint, method, body))
    .then(() => showApiError(null), e => showApiError(`Equipment speichern fehlgeschlagen (${e.message}). Die letzte Änderung ist evtl. nicht gesichert.`));
  return equipmentSyncChain;
}

function saveEquipmentItem(item) {
  return syncEquipment(`equipment/${item.id}`, "PUT", equipmentToApi(item));
}

function todayKey() { return todayStr(); }

/* ---------- Anlegen / Ändern / Löschen ---------- */

// Legt ein Item an und liefert es zurück (mit der id vom Server) - oder null,
// wenn das Speichern scheitert (Hinweisbanner).
async function addEquipmentItem(data) {
  const draft = {
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
  let item;
  try {
    item = equipmentFromApi((await apiCall("equipment", "POST", equipmentToApi(draft))).data);
  } catch (e) {
    showApiError(`Equipment konnte nicht angelegt werden (${e.message}).`);
    return null;
  }
  equipmentItems.push(item);
  // Direkt beim Anlegen als Standard setzen, wenn es das erste Item dieser
  // Sportart ist (Komfort - sonst müsste man extra noch einmal klicken).
  if (item.sport && !equipmentItems.some(x => x.id !== item.id && x.sport === item.sport && x.activeTo == null && x.activeFrom)) {
    setEquipmentDefaultForSport(item.id);
  }
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
      saveEquipmentItem(x);
    }
  });
  if (!item.activeFrom) item.activeFrom = today;
  item.activeTo = null;
  item.retired = false;
  saveEquipmentItem(item);
}

// Verschleißteil (Art B) als gewartet/getauscht markieren - Zähler startet
// wieder bei 0, das Item selbst bleibt bestehen (anders als bei Art A, wo
// man für neue Ausrüstung ein neues Item anlegt statt zu "resetten").
function resetEquipmentPart(id) {
  const item = equipmentItems.find(x => x.id === id);
  if (!item || !item.parentId) return;
  item.resetAt = todayKey();
  saveEquipmentItem(item);
}

// Manuellen Kilometerstand eines freien Items (Art C) aktualisieren.
function setEquipmentManualKm(id, km) {
  const item = equipmentItems.find(x => x.id === id);
  if (!item) return;
  item.manualKm = Math.max(0, Number(km) || 0);
  saveEquipmentItem(item);
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
  saveEquipmentItem(item);
}

function reactivateEquipmentItem(id) {
  const item = equipmentItems.find(x => x.id === id);
  if (!item) return;
  item.retired = false;
  saveEquipmentItem(item);
}

// Löscht ein Item - hängt daran ein Rad (Art A) mit Verschleißteilen (Art B),
// werden diese mitgelöscht (sonst blieben verwaiste Teile ohne Eltern-Rad
// zurück, deren Kilometerberechnung dann ins Leere liefe).
function deleteEquipmentItem(id) {
  const childIds = equipmentItems.filter(x => x.parentId === id).map(x => x.id);
  const toRemove = new Set([id, ...childIds]);
  equipmentItems = equipmentItems.filter(x => !toRemove.has(x.id));
  equipmentAssignments.forEach((eqId, file) => { if (toRemove.has(eqId)) equipmentAssignments.delete(file); });
  syncEquipment(`equipment/${id}`, "DELETE"); // der Server löscht Teile + Zuordnungen mit
}

/* ---------- Einzelne Trainings zuordnen ---------- */

// Sportart-Items (Art A), aus denen man für dieses Training wählen kann.
function equipmentChoicesForWorkout(w) {
  const assigned = equipmentAssignments.get(w.file);
  return equipmentItems.filter(x => x.sport === sportGroup(w.sport) && !x.parentId && (!x.retired || x.id === assigned));
}

// Das Item, für das dieses Training ohne ausdrückliche Zuordnung zählt
// (Standard an diesem Tag), oder null.
function automaticEquipmentForWorkout(w) {
  if (!w._date || w.is_summary) return null;
  const key = localDateStr(w._date);
  return equipmentItems.find(x => x.sport === sportGroup(w.sport) && !x.parentId && equipmentInWindow(x, key)) || null;
}

// Training dem Item mit dieser id zuordnen - oder mit null die Zuordnung
// aufheben, dann zählt es wieder automatisch.
function assignWorkoutToEquipment(file, equipmentId) {
  const previous = equipmentAssignments.get(file);
  if (equipmentId) {
    equipmentAssignments.set(file, equipmentId);
    syncEquipment(`equipment/${equipmentId}/workouts`, "POST", { workout_file: file });
  } else if (previous != null) {
    equipmentAssignments.delete(file);
    syncEquipment(`equipment/${previous}/workouts?workout_file=${encodeURIComponent(file)}`, "DELETE");
  }
}

/* ---------- Kilometerstand / Fälligkeit ---------- */

// Lag dieser Tag im Fenster [activeFrom, activeTo), in dem das Item "Standard" war?
function equipmentInWindow(item, dayKey) {
  return !!item.activeFrom && dayKey >= item.activeFrom && (!item.activeTo || dayKey < item.activeTo);
}

// Zählt dieses Training für das Sportart-Item (Art A)? Ausdrücklich
// zugeordnet (equipmentAssignments): nur für das zugeordnete Item. Sonst
// automatisch: Sportart passt und der Tag liegt im Standard-Fenster. Reuse
// von sportGroup() (js/data/workouts.js) statt einer eigenen
// Sportart-Zuordnung.
function equipmentCountsWorkout(item, w, dayKey) {
  if (w.is_summary || sportGroup(w.sport) !== item.sport) return false;
  const assigned = equipmentAssignments.get(w.file);
  return assigned != null ? assigned === item.id : equipmentInWindow(item, dayKey);
}

// Summe der Distanzen aller Workouts, die für das Sportart-Item zählen -
// fromKey (optional) schneidet alles davor ab.
function equipmentWorkoutKm(item, fromKey) {
  return ALL.reduce((sum, w) => {
    if (!w._date) return sum;
    const key = localDateStr(w._date);
    if (fromKey && key < fromKey) return sum;
    return equipmentCountsWorkout(item, w, key) ? sum + (w.distance_km || 0) : sum;
  }, 0);
}

// Aktueller Kilometerstand eines Items, unabhängig von der Art (A/B/C).
function equipmentKm(item) {
  if (item.parentId) {
    const parent = equipmentItems.find(x => x.id === item.parentId);
    if (!parent) return 0;
    // Verschleißteil zählt nur, seit es zuletzt gewartet wurde, UND nur die
    // Trainings, die für das Eltern-Rad zählen (falls das Rad zwischenzeitlich
    // abgelöst wurde, zählt für das Teil danach nichts mehr automatisch dazu).
    return equipmentWorkoutKm(parent, item.resetAt);
  }
  if (item.sport) {
    return (item.startKm || 0) + equipmentWorkoutKm(item, null);
  }
  return item.manualKm || 0;
}

// Status eines Items für Warnungen/Badges: "retired" (aussortiert),
// "nolimit" (kein Service-Intervall hinterlegt, rein informativ), "ok",
// "soon" (ab EQUIPMENT_WARN_RATIO = 90 % des Intervalls) oder "due"
// (Intervall erreicht/überschritten).
function equipmentStatus(item) {
  const km = equipmentKm(item);
  if (item.retired) return { state: "retired", km };
  if (!item.serviceIntervalKm) return { state: "nolimit", km };
  const pct = km / item.serviceIntervalKm;
  const state = pct >= 1 ? "due" : pct >= EQUIPMENT_WARN_RATIO ? "soon" : "ok";
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
