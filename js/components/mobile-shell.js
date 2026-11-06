// Handy-Ansicht nach dem Vorbild von iPhone-Apps: Tab-Leiste unten (vier
// Bereiche + "Mehr"), großer Titel oben, Einstellungen als aufklappbare
// Liste. Am Computer bleibt alles wie gehabt - alles hier greift nur, wenn
// das Fenster schmal ist (MOBILE_QUERY, passend zu css "Handy").

const MOBILE_QUERY = "(max-width: 700px)";
const VIEW_TITLES = {
  overview: "Übersicht", calendar: "Kalender", coach: "Coach", mobility: "Mobility",
  nutrition: "Ernährung", records: "Rekorde", analysis: "Analyse", settings: "Einstellungen",
};
const MORE_VIEWS = [
  ["nutrition", "Ernährung", '<path d="M7 3v8a3 3 0 006 0V3M10 3v18M17 3c-1.7 1.3-2 3.5-2 6v3h3V3zM16 12v9"/>'],
  ["records", "Rekorde", '<path d="M7 4h10v5a5 5 0 01-10 0zM4 5h3v2a3 3 0 01-3-2zM20 5h-3v2a3 3 0 003-2zM12 14v4M8 21h8"/>'],
  ["analysis", "Analyse", '<path d="M4 19l5-6 4 3 7-9M4 4v15h16"/>'],
  ["settings", "Einstellungen", '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'],
];

const isMobile = () => window.matchMedia && window.matchMedia(MOBILE_QUERY).matches;

function updateMobileChrome(id) {
  const title = document.getElementById("mobile-title");
  if (title) title.textContent = VIEW_TITLES[id] || "";
  const inMore = MORE_VIEWS.some(([v]) => v === id);
  document.querySelectorAll("#tabbar .tabbar-btn").forEach(b => {
    const on = b.hasAttribute("data-more") ? inMore : b.dataset.view === id;
    b.classList.toggle("is-active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  document.body.dataset.view = id;
}

function openMoreSheet() {
  const lastFocus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "mob-sheet-overlay more-sheet-overlay";
  overlay.innerHTML = `
    <div class="mob-sheet more-sheet" role="dialog" aria-modal="true" aria-label="Weitere Bereiche">
      <div class="mob-sheet-grabber" aria-hidden="true"></div>
      <div class="settings-list more-list">
        ${MORE_VIEWS.map(([v, label, icon]) => `
          <button type="button" class="settings-list-row more-row" data-view="${v}">
            <span class="more-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></span>
            <span class="more-label">${label}</span>
            <span class="mob-chevron" aria-hidden="true">›</span>
          </button>`).join("")}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  const close = () => {
    overlay.classList.remove("is-open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => overlay.remove(), 250);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", e => {
    const row = e.target.closest(".more-row");
    if (row) {
      close();
      if (row.dataset.view === "settings") openSettingsView(); else activateView(row.dataset.view);
      return;
    }
    if (e.target === overlay) close();
  });
  const first = overlay.querySelector(".more-row");
  if (first) first.focus();
}

/* ---- Einstellungen als aufklappbare Liste (nur Handy) ---- */

function setupSettingsAccordion() {
  const cards = [...document.querySelectorAll("#view-settings .dash-grid > .card")];
  const mobile = isMobile();
  cards.forEach(card => {
    const h2 = card.querySelector(":scope > h2");
    if (!h2) return;
    if (!card.dataset.accordion) {
      card.dataset.accordion = "1";
      h2.classList.add("settings-acc-head");
      h2.setAttribute("tabindex", "0");
      h2.setAttribute("role", "button");
      const toggle = e => {
        if (!isMobile() || (e.target.closest && e.target.closest(".info-wrap, button, a, input"))) return;
        const open = card.classList.toggle("is-open");
        h2.setAttribute("aria-expanded", String(open));
      };
      h2.addEventListener("click", toggle);
      h2.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); } });
    }
    card.classList.toggle("settings-acc", mobile);
    h2.setAttribute("aria-expanded", String(card.classList.contains("is-open")));
  });
}

// Bestimmte Einstellungs-Karte zeigen (z. B. "Dein Trainingsprofil" aus dem
// Mobility-Tab): auf dem Handy aufklappen, dann hinscrollen.
function revealSettingsCard(id) {
  const card = document.getElementById(id);
  if (!card) return;
  card.classList.add("is-open");
  const h2 = card.querySelector(":scope > h2");
  if (h2) h2.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => card.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function initMobileShell() {
  const bar = document.getElementById("tabbar");
  if (bar) {
    bar.addEventListener("click", e => {
      const b = e.target.closest(".tabbar-btn");
      if (!b) return;
      if (b.hasAttribute("data-more")) { openMoreSheet(); return; }
      activateView(b.dataset.view);
      window.scrollTo({ top: 0 });
    });
  }
  // activateView (app-shell.js) zentral erweitern: Titel + Tab-Leiste mitführen.
  const original = activateView;
  activateView = function (id) {
    original(id);
    updateMobileChrome(id);
  };
  const active = document.querySelector(".view.active");
  updateMobileChrome(active ? active.id.replace(/^view-/, "") : "overview");
  setupSettingsAccordion();
  if (window.matchMedia) window.matchMedia(MOBILE_QUERY).addEventListener("change", setupSettingsAccordion);
}
