// Einstellungen als übersichtliche Liste (wie am iPhone): oben wer angemeldet
// ist, darunter Gruppen mit je einer Zeile pro Bereich und dem aktuellen
// Stand rechts ("Verbunden", "8 h/Woche" ...). Ein Tipp öffnet nur diesen
// Bereich, "‹ Einstellungen" führt zurück.
//
// Die Bereiche selbst sind die bisherigen Karten in index.html (Attribut
// data-sp="<bereich>"); ihre Logik bleibt in den jeweiligen Dateien.

const SH_ICONS = {
  profil: ["#7fb2ff", '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.2-3.6 4-5.3 7-5.3s5.8 1.7 7 5.3"/>'],
  training: ["#4fd18b", '<path d="M3.5 9.5v5M6.5 7.5v9M17.5 7.5v9M20.5 9.5v5M6.5 12h11"/>'],
  garmin: ["#4cc3b0", '<circle cx="12" cy="12" r="6.5"/><path d="M12 8.5V12l2.5 1.5M9 3.5h6M9 20.5h6"/>'],
  ki: ["#a99bff", '<path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z"/><path d="M18 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'],
  kalender: ["#f08a5d", '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'],
  wetter: ["#f2c14e", '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>'],
  equipment: ["#c9a0ff", '<path d="M4 15.5c3 0 4-1.5 5.5-4l1.5 1.5c1.5-.5 3-.5 4.5.5L20 16v2.5H4z"/>'],
  mitteilungen: ["#f2705e", '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'],
  updates: ["#6f9cf0", '<path d="M12 4v10M7.5 10 12 14.5 16.5 10M5 19.5h14"/>'],
  einladen: ["#f2705e", '<circle cx="9.5" cy="9" r="3"/><path d="M4 18.5c.9-2.7 3-4 5.5-4s4.6 1.3 5.5 4M17.5 8v6M14.5 11h6"/>'],
  statistik: ["#4fd18b", '<path d="M5 19.5V12M10 19.5V7M15 19.5v-5M20 19.5V4.5"/>'],
};

const SH_PANELS = {
  profil: ["Profil", ""],
  training: ["Training & Planung", ""],
  garmin: ["Garmin", ""],
  ki: ["KI-Coach", "Claude erstellt Pläne, Mobility und Auswertungen."],
  kalender: ["Kalender & Wetter", ""],
  equipment: ["Equipment", "Kilometer von Schuhen und Rad, automatisch gezählt."],
  mitteilungen: ["Mitteilungen", ""],
  updates: ["Programm-Updates", ""],
  einladen: ["Freunde einladen", ""],
};

let shPanel = null;

function shEsc(v) { return escapeHtml(String(v == null ? "" : v)); }

function shStatus(id) {
  const p = typeof athleteProfile !== "undefined" ? athleteProfile : {};
  switch (id) {
    case "profil": return p.name || "Noch nicht ausgefüllt";
    case "training": {
      const parts = [];
      if (p.weeklyHours) parts.push(`${String(p.weeklyHours).replace(".", ",")} h/Woche`);
      if (p.includeStrength) parts.push("Kraft");
      if (p.includeMobility) {
        const tp = typeof trainingProfile === "function" ? trainingProfile() : {};
        parts.push(`Mobility ${tp.mobilityPerWeek || 2}×`);
      }
      return parts.join(" · ") || "Noch nichts eingestellt";
    }
    case "garmin": {
      const gs = typeof garminState !== "undefined" ? garminState : null;
      if (!gs || !gs.loaded) return "…";
      const watch = typeof garminPush !== "undefined" && garminPush.connected;
      if (gs.configured) return { text: watch ? "Verbunden · Uhr" : "Verbunden", ok: true };
      return watch ? { text: "Nur Uhr verbunden", ok: true } : { text: "Nicht verbunden", warn: true };
    }
    case "ki": {
      if (typeof claudeAvailable !== "function") return "";
      return claudeAvailable() ? { text: "Claude aktiv", ok: true } : "Aus";
    }
    case "kalender": return p.homeLocation ? p.homeLocation.name.replace(/ \(.*\)$/, "") : "";
    case "equipment": {
      const n = typeof equipmentItems !== "undefined" ? equipmentItems.filter(e => !e.retired).length : 0;
      return n ? `${n} ${n === 1 ? "Teil" : "Teile"}` : "Keins";
    }
    case "mitteilungen": {
      if (typeof webPush === "undefined" || !webPush.loaded) return "…";
      if (webPush.thisDevice) return { text: webPush.morning.enabled ? "Morgenbericht an" : "An", ok: true };
      return webPush.devices ? "Anderes Gerät" : "Aus";
    }
    case "updates": {
      const v = document.getElementById("app-update-version");
      const m = v && v.textContent.match(/\d+\.\d+\.\d+/);
      return m ? `Version ${m[0]}` : "";
    }
    default: return "";
  }
}

function shRow(id, label, extra = "") {
  const [color, icon] = SH_ICONS[id];
  let st = shStatus(id);
  if (typeof st === "string") st = { text: st };
  const cls = st.ok ? " ok" : st.warn ? " warn" : "";
  return `<button type="button" class="sh-row" data-sh-open="${id}">
    <span class="sh-ic" style="--c:${color}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></span>
    <span class="sh-label">${shEsc(label)}</span>
    <span class="sh-val${cls}">${st.ok ? "<i></i>" : ""}${shEsc(st.text || "")}</span>${extra}
    <span class="sh-chev" aria-hidden="true">›</span></button>`;
}

function renderSettingsHub() {
  const hub = document.getElementById("settings-hub");
  if (!hub) return;
  const p = typeof athleteProfile !== "undefined" ? athleteProfile : {};
  const user = (document.getElementById("account-username") || {}).textContent || "";
  const name = p.name || user || "Du";
  const isAdmin = typeof mAdmin !== "undefined" && mAdmin.isAdmin;
  const invite = document.getElementById("invite-card");
  hub.innerHTML = `
    <section class="sh-me">
      <span class="sh-avatar">${shEsc(name.trim().charAt(0).toUpperCase() || "?")}</span>
      <span class="sh-me-text"><b>${shEsc(name)}</b><small>${user && user !== "…" ? `Angemeldet als ${shEsc(user)}` : ""}</small></span>
    </section>
    <div class="sh-group"><h3>Du</h3><div class="sh-list">
      ${shRow("profil", "Profil")}
      ${shRow("training", "Training & Planung")}
      ${shRow("equipment", "Equipment")}
    </div></div>
    <div class="sh-group"><h3>Verbindungen</h3><div class="sh-list">
      ${shRow("garmin", "Garmin")}
      ${shRow("ki", "KI-Coach")}
      ${shRow("kalender", "Kalender & Wetter")}
    </div></div>
    <div class="sh-group"><h3>App</h3><div class="sh-list">
      ${shRow("mitteilungen", "Mitteilungen")}
      ${shRow("updates", "Programm-Updates")}
      ${invite && !invite.hidden ? shRow("einladen", "Freunde einladen") : ""}
      ${isAdmin && typeof mShow === "function" ? shRow("statistik", "Admin · Statistik") : ""}
    </div></div>
    <div class="sh-group"><div class="sh-list">
      <button type="button" class="sh-row sh-logout" id="sh-logout">Abmelden</button>
    </div></div>`;
}

function showSettingsHub() {
  shPanel = null;
  const view = document.getElementById("view-settings");
  if (view) view.classList.remove("sh-in-panel");
  document.getElementById("settings-panel-head").hidden = true;
  document.querySelectorAll("#settings-panels [data-sp]").forEach(c => c.classList.remove("sh-show"));
  renderSettingsHub();
  const t = document.getElementById("m-classic-title");
  if (t && document.body.classList.contains("m-classic")) t.textContent = "Einstellungen";
}

function openSettingsPanel(id) {
  if (id === "statistik") { if (typeof mShow === "function") mShow("admin"); return; }
  if (id === "wetter") id = "kalender"; // früher eigener Bereich
  if (!SH_PANELS[id]) return;
  const view = document.getElementById("view-settings");
  if (!view || !view.classList.contains("active")) openSettingsView();
  shPanel = id;
  view.classList.add("sh-in-panel");
  const [title, sub] = SH_PANELS[id];
  document.getElementById("settings-panel-head").hidden = false;
  document.getElementById("settings-panel-title").textContent = title;
  const subEl = document.getElementById("settings-panel-sub");
  subEl.textContent = sub;
  subEl.hidden = !sub;
  document.querySelectorAll("#settings-panels [data-sp]").forEach(c => c.classList.toggle("sh-show", c.dataset.sp === id));
  const t = document.getElementById("m-classic-title");
  if (t && document.body.classList.contains("m-classic")) t.textContent = title;
  window.scrollTo({ top: 0 });
  if (typeof mTrack === "function") mTrack("page", "settings");
}

// Zurück aus einem Bereich zur Liste. true = erledigt (für die Zurück-Knöpfe).
function settingsPanelBack() {
  if (!shPanel) return false;
  showSettingsHub();
  window.scrollTo({ top: 0 });
  return true;
}

function initSettingsHub() {
  const hub = document.getElementById("settings-hub");
  if (!hub) return;
  hub.addEventListener("click", e => {
    const row = e.target.closest("[data-sh-open]");
    if (row) { openSettingsPanel(row.dataset.shOpen); return; }
    if (e.target.closest("#sh-logout")) { if (typeof logout === "function") logout(); }
  });
  document.getElementById("settings-panel-back").addEventListener("click", settingsPanelBack);
  // Stand rechts aktuell halten (Garmin-Status kommt erst nach dem Laden).
  if (typeof onGarminState === "function") onGarminState(() => { if (!shPanel) renderSettingsHub(); });
  if (typeof onGarminPush === "function") onGarminPush(() => { if (!shPanel) renderSettingsHub(); });
  showSettingsHub();
}
