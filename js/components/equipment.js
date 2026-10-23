// Equipment-Tab in den Einstellungen (bewusst dort "versteckt", nicht als
// eigene Übersicht-Kachel - siehe CHANGE_REQUESTS.md) + Hinweis-Banner in
// Kalender/Dashboard, sobald etwas fällig oder bald fällig ist. Datenlogik
// (Kilometerberechnung, Fälligkeits-Status) steckt komplett in
// js/data/equipment.js - hier nur Rendering + Verkabelung, gleiches Muster
// wie renderGoals() in js/components/coach.js.

const EQUIPMENT_STATE_LABEL = { ok: "OK", soon: "bald fällig", due: "fällig", retired: "aussortiert", nolimit: "kein Limit" };

function equipmentStatusBadgeHtml(status) {
  const label = EQUIPMENT_STATE_LABEL[status.state] || status.state;
  return `<span class="equipment-badge equipment-badge-${status.state}">${label}</span>`;
}

function equipmentKmLabel(item, status) {
  const km = fmtNum(status.km, item.parentId ? 0 : 1);
  return item.serviceIntervalKm ? `${km} / ${item.serviceIntervalKm} km · ${Math.round(status.km / item.serviceIntervalKm * 100)} %` : `${km} km`;
}

/* ---------- Liste in den Einstellungen ---------- */

function renderEquipmentList() {
  const host = document.getElementById("equipment-list");
  if (!host) return;

  if (!equipmentItems.length) {
    host.innerHTML = "<p class='empty-note'>Noch kein Equipment hinterlegt — z.B. Laufschuhe oder dein Rad mit Verschleißteilen (Kette, Reifen, Bremsbeläge).</p>";
    renderEquipmentBanner();
    return;
  }

  // Hauptausrüstung (Art A) zuerst, mit ihren Verschleißteilen (Art B)
  // direkt eingerückt darunter, danach freie Items (Art C) ohne Zuordnung.
  const mains = equipmentItems.filter(x => !x.parentId).sort((a, b) => (a.retired === b.retired ? 0 : a.retired ? 1 : -1));

  const itemRowHtml = (item, status, indented) => {
    const isPart = !!item.parentId;
    const isFree = !item.sport && !item.parentId;
    const isActiveMain = item.sport && !item.parentId && item.activeFrom && item.activeTo == null;
    const actions = [];
    if (!item.retired) {
      if (item.sport && !item.parentId && !isActiveMain) actions.push(`<button type="button" class="chip equipment-action-btn" data-action="setdefault" data-id="${item.id}">Als Standard für ${escapeHtml(item.sport)}</button>`);
      if (isPart) actions.push(`<button type="button" class="chip equipment-action-btn" data-action="reset" data-id="${item.id}">Als gewartet markieren</button>`);
      actions.push(`<button type="button" class="chip equipment-action-btn" data-action="retire" data-id="${item.id}">Aussortieren</button>`);
    } else {
      actions.push(`<button type="button" class="chip equipment-action-btn" data-action="reactivate" data-id="${item.id}">Reaktivieren</button>`);
    }
    actions.push(`<button type="button" class="equipment-delete" data-id="${item.id}" title="Endgültig löschen">✕</button>`);

    return `
      <div class="equipment-item${indented ? " equipment-item-indented" : ""}${item.retired ? " equipment-item-retired" : ""}">
        <div class="equipment-item-main">
          <span class="equipment-item-name">${escapeHtml(item.name)}</span>
          ${isActiveMain ? `<span class="equipment-badge equipment-badge-active">Standard</span>` : ""}
          ${equipmentStatusBadgeHtml(status)}
        </div>
        <div class="equipment-item-sub">
          ${escapeHtml(item.category)}${item.sport ? " · " + escapeHtml(item.sport) : ""} · ${equipmentKmLabel(item, status)}
          ${isFree ? `<input type="number" class="coach-input equipment-manual-km" data-id="${item.id}" min="0" step="0.1" value="${item.manualKm || 0}" title="Kilometerstand manuell eintragen" style="width:80px; margin-left:8px;">` : ""}
          ${item.note ? ` · ${escapeHtml(item.note)}` : ""}
        </div>
        <div class="equipment-item-actions">${actions.join("")}</div>
      </div>`;
  };

  host.innerHTML = mains.map(main => {
    const status = equipmentStatus(main);
    const children = equipmentItems.filter(x => x.parentId === main.id);
    return itemRowHtml(main, status, false) + children.map(c => itemRowHtml(c, equipmentStatus(c), true)).join("");
  }).join("");

  host.querySelectorAll('.equipment-action-btn[data-action="setdefault"]').forEach(btn => btn.addEventListener("click", () => { setEquipmentDefaultForSport(btn.dataset.id); renderEquipmentList(); }));
  host.querySelectorAll('.equipment-action-btn[data-action="reset"]').forEach(btn => btn.addEventListener("click", () => { resetEquipmentPart(btn.dataset.id); renderEquipmentList(); }));
  host.querySelectorAll('.equipment-action-btn[data-action="reactivate"]').forEach(btn => btn.addEventListener("click", () => { reactivateEquipmentItem(btn.dataset.id); renderEquipmentList(); }));
  host.querySelectorAll('.equipment-action-btn[data-action="retire"]').forEach(btn => btn.addEventListener("click", async () => {
    const item = equipmentItems.find(x => x.id === btn.dataset.id);
    const ok = await confirmDialog(`„${item ? item.name : "Equipment"}“ als aussortiert markieren? Es zählt danach nicht mehr für Warnungen, bleibt aber in der Liste (kann jederzeit reaktiviert werden).`);
    if (ok) { retireEquipmentItem(btn.dataset.id); renderEquipmentList(); }
  }));
  host.querySelectorAll(".equipment-manual-km").forEach(input => input.addEventListener("change", () => { setEquipmentManualKm(input.dataset.id, input.value); renderEquipmentList(); }));
  host.querySelectorAll(".equipment-delete").forEach(btn => btn.addEventListener("click", async () => {
    const item = equipmentItems.find(x => x.id === btn.dataset.id);
    const hasChildren = equipmentItems.some(x => x.parentId === btn.dataset.id);
    const msg = `„${item ? item.name : "Equipment"}“ endgültig löschen?${hasChildren ? " Zugehörige Verschleißteile werden mitgelöscht." : ""} Das kann nicht rückgängig gemacht werden.`;
    const ok = await confirmDialog(msg);
    if (ok) { deleteEquipmentItem(btn.dataset.id); renderEquipmentList(); }
  }));

  renderEquipmentBanner();
}

/* ---------- Hinweis-Banner (Kalender + Übersicht/Dashboard) ---------- */

// Eine Funktion füllt BEIDE Banner-Container (Übersicht + Kalender, siehe
// index.html) mit demselben Inhalt, statt zwei separate Render-Pfade zu
// pflegen - beide zeigen exakt dieselbe Information.
function renderEquipmentBanner() {
  const targets = ["equipment-banner-overview", "equipment-banner-calendar"].map(id => document.getElementById(id)).filter(Boolean);
  if (!targets.length) return;

  const due = dueEquipmentItems();
  if (!due.length) {
    targets.forEach(el => { el.hidden = true; el.innerHTML = ""; });
    return;
  }

  const dueCount = due.filter(x => x.status.state === "due").length;
  const soonCount = due.length - dueCount;
  const headline = [
    dueCount ? `${dueCount}× Equipment fällig` : null,
    soonCount ? `${soonCount}× bald fällig` : null,
  ].filter(Boolean).join(" · ");

  const itemsHtml = due.slice(0, 4).map(({ item, status }) =>
    `<span class="equipment-banner-item${status.state === "due" ? " due" : ""}">${escapeHtml(item.name)} (${equipmentKmLabel(item, status)})</span>`
  ).join("");

  const html = `
    <span class="equipment-banner-icon">🔧</span>
    <span class="equipment-banner-text"><b>${headline}:</b> ${itemsHtml}</span>
    <button type="button" class="equipment-banner-link" data-action="open-equipment-settings">Equipment verwalten →</button>`;

  targets.forEach(el => { el.hidden = false; el.innerHTML = html; });
  document.querySelectorAll('.equipment-banner-link[data-action="open-equipment-settings"]').forEach(btn => {
    btn.addEventListener("click", () => {
      openSettingsView();
      requestAnimationFrame(() => document.getElementById("equipment-add-toggle-btn")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    });
  });
}

/* ---------- Zuordnung in der Trainings-Detailansicht ---------- */

// "Equipment"-Auswahl für EINE Einheit (eingebunden in buildWorkoutDetailHtml(),
// js/components/workout-card.js): ausdrücklich einem Schuh/Rad zuordnen oder
// "Automatisch" lassen. Nur sichtbar, wenn Equipment der passenden Sportart existiert.
function buildWorkoutEquipmentHtml(w) {
  const choices = equipmentChoicesForWorkout(w);
  if (!choices.length) return "";
  const assigned = equipmentAssignments.get(w.file);
  const auto = automaticEquipmentForWorkout(w);
  const options = choices.map(x => `<option value="${x.id}"${x.id === assigned ? " selected" : ""}>${escapeHtml(x.name)}</option>`).join("");
  return `
    <div class="wd-equipment" data-file="${encodeURIComponent(w.file)}">
      <h4>Equipment</h4>
      <select class="coach-input wd-equipment-select" aria-label="Equipment für diese Einheit">
        <option value="">Automatisch${auto ? ": " + escapeHtml(auto.name) : " (kein Standard zu diesem Datum)"}</option>
        ${options}
      </select>
    </div>`;
}

function wireWorkoutEquipmentBlock(rootEl, file) {
  const select = rootEl.querySelector(`.wd-equipment[data-file="${encodeURIComponent(file)}"] .wd-equipment-select`);
  if (!select) return;
  select.addEventListener("change", () => {
    assignWorkoutToEquipment(file, select.value || null);
    renderEquipmentList(); // Kilometerstände + Warnbanner neu
  });
}

/* ---------- Anlage-Formular ---------- */

function equipmentParentOptionsHtml() {
  const parents = equipmentItems.filter(x => x.sport && !x.parentId && !x.retired);
  if (!parents.length) return `<option value="">– kein Rad/Hauptausrüstung vorhanden –</option>`;
  return parents.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
}

// Die Liste wird vorher von js/app.js geladen (loadEquipmentItems()).
function initEquipment() {
  renderEquipmentList();

  const toggleBtn = document.getElementById("equipment-add-toggle-btn");
  const addCard = document.getElementById("equipment-add-card");
  const cancelBtn = document.getElementById("equipment-cancel-btn");
  const form = document.getElementById("equipment-form");
  const categorySelect = document.getElementById("equipment-category");
  const sportSelect = document.getElementById("equipment-sport");
  const parentRow = document.getElementById("equipment-parent-row");
  const parentSelect = document.getElementById("equipment-parent");
  const sportRow = document.getElementById("equipment-sport-row");
  const startKmRow = document.getElementById("equipment-startkm-row");

  const updateFormRows = () => {
    const isPart = categorySelect.value === "Verschleißteil";
    parentRow.style.display = isPart ? "" : "none";
    sportRow.style.display = isPart ? "none" : "";
    startKmRow.style.display = isPart ? "none" : "";
    if (isPart) parentSelect.innerHTML = equipmentParentOptionsHtml();
  };

  if (toggleBtn && addCard) {
    toggleBtn.addEventListener("click", () => {
      addCard.hidden = !addCard.hidden;
      if (!addCard.hidden) updateFormRows();
    });
  }
  if (cancelBtn && form && addCard) {
    cancelBtn.addEventListener("click", () => { form.reset(); addCard.hidden = true; });
  }
  if (categorySelect) categorySelect.addEventListener("change", updateFormRows);

  if (form) {
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const isPart = categorySelect.value === "Verschleißteil";
      const submitBtn = form.querySelector('[type="submit"]');
      submitBtn.disabled = true; // kein Doppelklick = kein doppeltes Item
      const item = await addEquipmentItem({
        name: document.getElementById("equipment-name").value,
        category: categorySelect.value,
        sport: isPart ? null : (sportSelect.value || null),
        parentId: isPart ? (parentSelect.value || null) : null,
        serviceIntervalKm: document.getElementById("equipment-interval").value || null,
        startKm: document.getElementById("equipment-startkm").value || 0,
        note: document.getElementById("equipment-note").value,
      });
      submitBtn.disabled = false;
      if (!item) return; // Speichern fehlgeschlagen (Hinweisbanner): Eingaben bleiben stehen
      form.reset();
      addCard.hidden = true;
      renderEquipmentList();
    });
  }
}
