// App-Chrome: Theme-Umschalter, dezenter Parallax-Effekt im Header, Top-Navigation,
// Zeitraum-/Sportart-Filterleiste und die generische Drag-&-Drop-Kachel-Sortierung
// (initDragGrid), die sowohl von der Uebersicht als auch vom Coach-Tab genutzt wird.

const THEME_KEY = "triathlon_dashboard_theme_v1";

const themeToggleBtn = document.getElementById("theme-toggle-btn");

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function currentIsDark() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return systemPrefersDark();
}

function updateThemeToggleIcon() {
  themeToggleBtn.textContent = currentIsDark() ? "☀️" : "🌙";
}
themeToggleBtn.addEventListener("click", () => {
  const next = currentIsDark() ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignorieren */ }
  updateThemeToggleIcon();
});
updateThemeToggleIcon();

/* ======================================================================
   Dezenter Parallax-Effekt für den Hintergrund (wie auf der Landingpage,
   aber gedämpft) - die drei Glow-Flecken verschieben sich minimal mit der
   Maus. Rein optisch, ohne Performance-Einfluss auf Charts/Interaktion.
   ====================================================================== */
(function () {
  const glow1 = document.getElementById("glow1");
  const glow2 = document.getElementById("glow2");
  const glow3 = document.getElementById("glow3");
  if (!glow1 || !glow2 || !glow3) return;
  document.addEventListener("mousemove", e => {
    const xPos = (e.clientX / window.innerWidth) - 0.5;
    const yPos = (e.clientY / window.innerHeight) - 0.5;
    glow1.style.transform = `translate(${xPos * 22}px, ${yPos * 22}px)`;
    glow2.style.transform = `translate(${xPos * -26}px, ${yPos * -26}px)`;
    glow3.style.transform = `translate(${xPos * 16}px, ${yPos * -16}px)`;
  });
})();

/* ======================================================================
   Dashboard-Layout: Übersicht-Karten per Drag & Drop umsortierbar.
   Reine Anzeigereihenfolge im DOM - die Charts selbst rendern weiterhin über
   feste IDs (getElementById), sind also unabhängig von der Kartenreihenfolge.
   Reihenfolge wird je Browser in localStorage gemerkt (kein Server, kein
   Sync); "Layout zurücksetzen" verwirft den gespeicherten Stand wieder.
   Läuft nur mit echtem Maus-Drag (Desktop-Browser) - auf Touch-Geräten
   bleiben die Karten in der Standardreihenfolge, aber voll nutzbar.
   ====================================================================== */
// Generisch für jedes modulare Karten-Grid (Übersicht + Coach): liest den
// Storage-Key aus data-layout-key, damit mehrere unabhängige Grids auf der
// Seite dieselbe Logik nutzen können, ohne Code zu duplizieren.

function initDragGrid(grid, resetBtn) {
  const key = grid.dataset.layoutKey;
  // Urspruengliche Reihenfolge aus dem HTML, bevor applySaved() sie ggf.
  // ueberschreibt - Grundlage fuer den Reset-Button (nur dieses Grid,
  // kein Seiten-Reload).
  const originalOrder = [...grid.children].map(el => el.dataset.cardId);
  let draggedCard = null;

  function applySaved() {
    let order;
    try { order = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { order = null; }
    if (!Array.isArray(order) || !order.length) return;
    const byId = new Map([...grid.children].map(el => [el.dataset.cardId, el]));
    order.forEach(id => { const el = byId.get(id); if (el) grid.appendChild(el); });
  }
  function save() {
    const order = [...grid.children].map(el => el.dataset.cardId);
    try { localStorage.setItem(key, JSON.stringify(order)); } catch (e) { /* ignorieren */ }
  }
  applySaved();

  // Maus-Events statt natives HTML5-Drag&Drop: funktioniert zuverlässig über
  // alle Browser/Trackpads hinweg (natives DnD ist v.a. in Safari mit
  // Trackpad oft unzuverlässig, wenn der Drag an einem verschachtelten
  // Element/Griff startet).
  function onMove(e) {
    if (!draggedCard) return;
    e.preventDefault();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const target = el && el.closest(".card");
    if (!target || target === draggedCard || !grid.contains(target)) return;
    const rect = target.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    const ref = before ? target : target.nextSibling;
    if (draggedCard.nextSibling !== ref) target.parentNode.insertBefore(draggedCard, ref);
  }
  function onEnd() {
    if (!draggedCard) return;
    draggedCard.classList.remove("dragging");
    draggedCard = null;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
    save();
  }
  grid.querySelectorAll(".card-drag-handle").forEach(handle => {
    handle.addEventListener("mousedown", e => {
      const card = handle.closest(".card");
      if (!card) return;
      e.preventDefault();
      draggedCard = card;
      card.classList.add("dragging");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onEnd);
    });
  });
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      try { localStorage.removeItem(key); } catch (e) { /* ignorieren */ }
      // Nur dieses Grid neu anordnen, statt die ganze Seite neu zu laden -
      // betrifft ausschliesslich den Tab, in dem geklickt wurde.
      const byId = new Map([...grid.children].map(el => [el.dataset.cardId, el]));
      originalOrder.forEach(id => { const el = byId.get(id); if (el) grid.appendChild(el); });
    });
  }
}
initDragGrid(document.getElementById("dash-grid"), document.getElementById("reset-layout-btn"));
initDragGrid(document.getElementById("coach-grid"), document.getElementById("reset-coach-layout-btn"));

/* ======================================================================
   Generischer Bestätigungs-Dialog ("Bist du sicher?") - Promise-basiert,
   für alle destruktiven Aktionen wiederverwendbar (aktuell: Ziel/Event
   löschen, siehe coach.js). Nutzt dieselbe .modal-overlay-Struktur wie die
   übrigen Overlays (siehe PROJECT_MAP.md Rule 5 - keine Duplikate).
   ====================================================================== */
function confirmDialog(message) {
  const overlay = document.getElementById("confirm-overlay");
  const messageEl = document.getElementById("confirm-message");
  const okBtn = document.getElementById("confirm-ok-btn");
  const cancelBtn = document.getElementById("confirm-cancel-btn");
  if (!overlay || !messageEl || !okBtn || !cancelBtn) return Promise.resolve(window.confirm(message));

  messageEl.textContent = message;
  overlay.classList.add("open");

  return new Promise(resolve => {
    function cleanup(result) {
      overlay.classList.remove("open");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlay);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlay(e) { if (e.target === overlay) cleanup(false); }
    function onKey(e) { if (e.key === "Escape") cleanup(false); }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlay);
    document.addEventListener("keydown", onKey);
  });
}

/* ======================================================================
   2) VANILLA-JS .FIT-PARSER (für den "Aktualisieren"-Button)
   Deckt genau die Felder ab, die dieses Dashboard braucht (Session- und
   Record-Nachrichten). Feldnummern wurden anhand echter Garmin/HealthFit
   .fit-Dateien verifiziert.
   ====================================================================== */

// Schaltet auf den Tab/View mit der gegebenen ID um (z.B. "overview",
// "settings") - zentral statt dupliziert, damit initTopNav, die Settings-
// Seite (coach.js: openSettingsView/closeSettingsView) UND die globale
// Suche (card-search.js: Sprung zu Treffern in einem anderen Tab) dieselbe
// Logik nutzen (siehe PROJECT_MAP.md Rule 5 - keine Duplikate).
function activateView(id) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === id));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${id}`));
}

function initTopNav() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => activateView(btn.dataset.view));
  });
}

/* ---------- Kalender-Steuerung (Monatsnavigation & Sportart-Filter) ---------- */

function initFilterBar() {
  const rangeEl = document.getElementById("range-filter");
  const fromEl = document.getElementById("range-from");
  const toEl = document.getElementById("range-to");
  const ranges = [["7", 7], ["30", 30], ["90", 90], ["1J", 365], ["Alle", null]];
  ranges.forEach(([label, days]) => {
    const btn = document.createElement("button");
    btn.className = "chip range-chip" + (filterState.rangeDays === days ? " active" : "");
    btn.textContent = label === "Alle" ? "Alle" : label === "1J" ? "1 Jahr" : label + " Tage";
    btn.dataset.range = label;
    btn.addEventListener("click", () => {
      filterState.rangeDays = days;
      filterState.customFrom = null;
      filterState.customTo = null;
      if (fromEl) fromEl.value = "";
      if (toEl) toEl.value = "";
      rangeEl.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      renderAll();
    });
    rangeEl.appendChild(btn);
  });

  // Freier Von/Bis-Zeitraum - überschreibt die Chips oben, solange
  // mindestens eines der beiden Felder ausgefüllt ist (siehe getFilteredData).
  if (fromEl && toEl) {
    const applyCustomRange = () => {
      filterState.customFrom = fromEl.value ? new Date(fromEl.value + "T00:00:00") : null;
      filterState.customTo = toEl.value ? new Date(toEl.value + "T23:59:59") : null;
      if (filterState.customFrom || filterState.customTo) {
        rangeEl.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      }
      renderAll();
    };
    fromEl.addEventListener("change", applyCustomRange);
    toEl.addEventListener("change", applyCustomRange);
  }

  const sportEl = document.getElementById("sport-filter");
  ["Rad", "Laufen", "Schwimmen", "Sonstiges"].forEach(sport => {
    const btn = document.createElement("button");
    btn.className = "chip sport-chip" + (filterState.sports.has(sport) ? " active" : "");
    btn.textContent = sport;
    btn.dataset.sport = sport;
    btn.addEventListener("click", () => {
      if (filterState.sports.has(sport)) filterState.sports.delete(sport);
      else filterState.sports.add(sport);
      btn.classList.toggle("active");
      renderAll();
    });
    sportEl.appendChild(btn);
  });

}


/* ======================================================================
   4) RENDER-FUNKTIONEN (parametrisiert über die gefilterten Daten)
   ====================================================================== */
