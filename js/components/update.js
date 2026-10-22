// Programm-Updates: Hinweis oben im Dashboard ("Neue Version verfügbar") und
// die Karte "Programm-Updates" in den Einstellungen. Prüfen und Installieren
// macht der Server (backend/updater.py); beides sieht und darf nur der
// Betreiber - alle anderen sehen nur die Versionsnummer.
// "Später" merkt sich dieses Gerät je Version (reine Geräte-Einstellung).

const UPDATE_DISMISS_KEY = "triathlon_dashboard_update_dismissed_v1";
const UPDATE_POLL_MS = 2000;
const UPDATE_RESTART_WAIT_MS = 3 * 60 * 1000;

function initUpdates() {
  const banner = document.getElementById("app-update-banner");
  const versionLine = document.getElementById("app-update-version");
  const adminBox = document.getElementById("app-update-admin");
  const statusEl = document.getElementById("app-update-status");
  const notesEl = document.getElementById("app-update-notes");
  const checkBtn = document.getElementById("app-update-check-btn");
  const installBtn = document.getElementById("app-update-install-btn");
  if (!banner || !versionLine || !adminBox || !statusEl || !notesEl || !checkBtn || !installBtn) return;
  let pollTimer = null;

  function dismissed(version) {
    try { return localStorage.getItem(UPDATE_DISMISS_KEY) === version; } catch (e) { return false; }
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.classList.remove("ok", "warn", "err");
    if (kind) statusEl.classList.add(kind);
  }

  function button(label, cls, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function renderBanner(st) {
    banner.replaceChildren();
    const latest = st.latest;
    const show = st.admin && (st.install.running || (st.available && latest && !dismissed(latest.version)));
    banner.hidden = !show;
    if (!show) return;
    const text = document.createElement("span");
    text.className = "app-update-banner-text";
    text.textContent = st.install.running
      ? `Update wird installiert: ${st.install.step || "…"}`
      : `Neue Version ${latest.version} verfügbar (du hast ${st.current}).`;
    banner.appendChild(text);
    if (st.install.running) return;
    banner.appendChild(button("Was ist neu?", "chip", () => { openSettingsView(); document.getElementById("app-update-card").scrollIntoView({ behavior: "smooth" }); }));
    banner.appendChild(button("Installieren", "update-btn", install));
    banner.appendChild(button("Später", "reset-link", () => {
      try { localStorage.setItem(UPDATE_DISMISS_KEY, latest.version); } catch (e) { /* nur Komfort */ }
      banner.hidden = true;
    }));
  }

  function render(st) {
    versionLine.textContent = `Installierte Version: ${st.current}`;
    adminBox.hidden = !st.admin;
    renderBanner(st);
    if (!st.admin) return;
    const latest = st.latest;
    const inst = st.install || {};
    if (inst.running) {
      setStatus(`Update läuft: ${inst.step || "…"}`, "");
    } else if (inst.ok === false) {
      setStatus(inst.message, "err");
    } else if (inst.ok) {
      setStatus(inst.message, "ok");
    } else if (st.available) {
      setStatus(`Neue Version ${latest.version} verfügbar${latest.published_at ? ` (veröffentlicht am ${fmtDateFull(new Date(latest.published_at))})` : ""}.`, "warn");
    } else if (st.error) {
      setStatus(st.error, "err");
    } else if (st.checked_at) {
      setStatus(latest ? "Du hast die neueste Version." : "Auf GitHub ist noch keine Version veröffentlicht.", "ok");
    } else {
      setStatus("Noch nicht geprüft – der Server prüft einmal am Tag.", "");
    }
    notesEl.hidden = !(st.available && latest && latest.notes);
    notesEl.textContent = st.available && latest ? latest.notes : "";
    installBtn.hidden = !st.available || inst.running;
    installBtn.textContent = latest ? `Version ${latest.version} installieren` : "Installieren";
    checkBtn.disabled = !!inst.running;
    clearTimeout(pollTimer);
    if (inst.running) pollTimer = setTimeout(refresh, UPDATE_POLL_MS);
  }

  async function refresh() {
    try {
      render((await apiCall("update")).data);
    } catch (e) {
      versionLine.textContent = e.message;
    }
  }

  async function check() {
    checkBtn.disabled = true;
    setStatus("Prüfe bei GitHub …", "");
    try {
      render((await apiCall("update/check", "POST", null, { timeoutMs: 45000 })).data);
    } catch (e) {
      setStatus(e.message, "err");
    } finally {
      checkBtn.disabled = false;
    }
  }

  // Nach dem Neustart: warten, bis ein NEUER Server-Lauf (andere instance)
  // mit der neuen Version antwortet, dann die Seite neu laden. Die
  // Versionsnummer allein reicht nicht: die meldet schon der alte Lauf kurz
  // vor seinem Neustart - ein Neuladen genau dann landete im Nichts.
  async function waitForRestart(target, oldInstance) {
    const until = Date.now() + UPDATE_RESTART_WAIT_MS;
    while (Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, UPDATE_POLL_MS));
      try {
        const st = (await apiCall("update", "GET", null, { timeoutMs: 4000 })).data;
        if (st.current === target && st.instance !== oldInstance) { window.location.reload(); return; }
        if (st.install && !st.install.running && st.install.ok === false) { render(st); return; }
        if (st.install && !st.install.running && st.install.ok && !st.supervised) { render(st); return; }
      } catch (e) { /* Server startet gerade neu */ }
    }
    setStatus("Der Server meldet sich nicht zurück. Bitte das Dashboard-Fenster am PC prüfen und die Seite neu laden.", "err");
  }

  async function install() {
    const st = (await apiCall("update")).data;
    if (!st.available) { render(st); return; }
    const ok = await confirmDialog(
      `Version ${st.latest.version} installieren? Vorher werden Datenbank und Programm gesichert. ` +
      "Der Server startet danach kurz neu – alle, die gerade angemeldet sind, sind etwa eine Minute getrennt.",
      { okLabel: "Installieren", danger: false });
    if (!ok) return;
    try {
      render((await apiCall("update/install", "POST")).data);
      waitForRestart(st.latest.version, st.instance);
    } catch (e) {
      setStatus(e.message, "err");
    }
  }

  checkBtn.addEventListener("click", check);
  installBtn.addEventListener("click", install);
  refresh();
}
