// "Garmin-Verbindung"-Karte in den Einstellungen: jede Person hinterlegt
// ihren eigenen Personal-API-Schlüssel (offizielle Garmin-Schnittstelle, nur
// lesen) und holt ihre Daten auf Knopfdruck. Der Schlüssel geht einmal an den
// Server (backend/garmin_api_routes.py), der ihn bei Garmin prüft und auf dem
// PC ablegt - zurück ins Dashboard kommt er nie, auch nicht in die Ablage.

const GARMIN_SYNC_POLL_MS = 5000;

// Gemeinsamer Stand der Garmin-Verbindung (Einstellungen, Menü
// "Aktualisieren", Handy-Ansicht): { loaded, configured, expires, days_left,
// sync: { running, at, ok, message } }. Wer sich mit onGarminState() meldet,
// bekommt jede Änderung.
let garminState = { loaded: false, configured: false, sync: {} };
const garminStateListeners = [];

function onGarminState(fn) { garminStateListeners.push(fn); }

function setGarminState(data) {
  garminState = { ...(data || {}), loaded: true, configured: !!(data && data.configured), sync: (data && data.sync) || {} };
  garminStateListeners.forEach(fn => { try { fn(garminState); } catch (e) { console.error(e); } });
  if (garminState.sync.running) watchGarminSync();
}

async function refreshGarminState() {
  try { setGarminState((await apiCall("garmin/personal-api")).data); } catch (e) { /* bleibt beim alten Stand */ }
  return garminState;
}

// Nach einem Abruf die neuen Trainings und Gesundheitsdaten zeigen - ohne
// die Seite neu zu laden.
async function reloadGarminData() {
  await Promise.all([loadPersistedWorkouts(), loadWellness()]);
  if (typeof syncGarminWeightIntoLog === "function") syncGarminWeightIntoLog();
  renderAll();
}

// Wartet, bis ein laufender Abruf fertig ist (läuft nur einmal gleichzeitig)
// und lädt danach die Daten neu. Ergebnis: der Abschluss-Stand des Abrufs.
let garminWatch = null;
function watchGarminSync() {
  if (garminWatch) return garminWatch;
  garminWatch = (async () => {
    try {
      for (let i = 0; i < 240; i++) {
        await new Promise(r => setTimeout(r, GARMIN_SYNC_POLL_MS));
        let data;
        try { data = (await apiCall("garmin/personal-api")).data; } catch (e) { continue; }
        if (data.sync && data.sync.running) continue;
        if (data.sync && data.sync.ok) { try { await reloadGarminData(); } catch (e) { console.error(e); } }
        garminWatch = null;
        setGarminState(data);
        return garminState.sync;
      }
      return garminState.sync;
    } finally {
      garminWatch = null;
    }
  })();
  return garminWatch;
}

// Abruf starten (oder an einen laufenden anhängen) und auf das Ende warten.
// Fehler beim Starten (z. B. kein Schlüssel) kommen als Error.
async function startGarminSync() {
  try {
    setGarminState((await apiCall("garmin/sync", "POST")).data);
  } catch (e) {
    if (!/läuft schon/.test(e.message)) throw e;
    setGarminState({ ...garminState, sync: { ...garminState.sync, running: true } });
  }
  return watchGarminSync();
}

function initGarminSettings() {
  const statusEl = document.getElementById("garmin-api-status");
  const keyInput = document.getElementById("garmin-api-key");
  const expiresInput = document.getElementById("garmin-api-expires");
  const saveBtn = document.getElementById("garmin-api-save-btn");
  const syncBtn = document.getElementById("garmin-api-sync-btn");
  const syncStatusEl = document.getElementById("garmin-api-sync-status");
  const deleteBtn = document.getElementById("garmin-api-delete-btn");
  const actions = document.getElementById("garmin-api-actions");
  const form = document.getElementById("garmin-api-form");
  const changeBtn = document.getElementById("garmin-api-change-btn");
  const cancelBtn = document.getElementById("garmin-api-cancel-btn");
  let changing = false; // Schlüssel-Felder nur zeigen, wenn keiner da ist oder "Ändern" angetippt
  if (!actions || !form || !changeBtn || !cancelBtn || !statusEl || !keyInput || !expiresInput || !saveBtn || !syncBtn || !syncStatusEl || !deleteBtn) return;

  function setStatus(el, text, kind) {
    el.textContent = text || "";
    el.classList.remove("ok", "warn", "err");
    if (kind) el.classList.add(kind);
  }

  function keyText(st) {
    if (!st.configured) {
      return ["Noch nicht verbunden.", ""];
    }
    if (st.days_left == null) return ["Verbunden.", "ok"];
    const until = fmtDateFull(new Date(st.expires + "T00:00:00"));
    if (st.days_left < 0) return [`Schlüssel abgelaufen seit ${until} – bitte einen neuen eintragen.`, "err"];
    if (st.days_left <= 14) return [`Schlüssel läuft am ${until} ab – bald einen neuen eintragen.`, "warn"];
    return [`Verbunden · gültig bis ${until}.`, "ok"];
  }

  function render(st) {
    const [text, kind] = keyText(st);
    setStatus(statusEl, text, kind);
    if (!st.configured) changing = false;
    actions.hidden = !st.configured || changing;
    form.hidden = !!st.configured && !changing;
    cancelBtn.hidden = !st.configured;
    if (typeof garminConnectedCache !== "undefined" && garminConnectedCache !== !!st.configured) {
      garminConnectedCache = !!st.configured;
      refreshGarminImportButtons(document);
    }
    const sync = st.sync || {};
    syncBtn.disabled = !!sync.running;
    syncStatusEl.replaceChildren();
    if (sync.running) {
      setStatus(syncStatusEl, "Hole Daten … beim ersten Mal dauert das einige Minuten.", "");
    } else if (sync.at) {
      const when = new Date(sync.at);
      setStatus(syncStatusEl, `Zuletzt geholt ${fmtDate(when)}, ${when.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr${sync.ok ? "" : ` – ${sync.message || "fehlgeschlagen"}`}`, sync.ok ? "" : "err");
    } else {
      setStatus(syncStatusEl, "", "");
    }
  }

  async function refresh() {
    const before = garminState.loaded;
    await refreshGarminState();
    if (!before && !garminState.loaded) setStatus(statusEl, "Garmin-Stand konnte nicht geladen werden.", "err");
  }

  async function save() {
    const key = keyInput.value.trim();
    if (!key) { setStatus(statusEl, "Bitte zuerst den Schlüssel einfügen.", "warn"); return; }
    saveBtn.disabled = true;
    setStatus(statusEl, "Prüfe den Schlüssel bei Garmin …", "");
    try {
      const res = await apiCall("garmin/personal-api", "PUT", { key, expires: expiresInput.value || null }, { timeoutMs: 45000 });
      keyInput.value = "";
      expiresInput.value = "";
      changing = false;
      setGarminState(res.data); // der Server startet gleich den ersten Abruf
    } catch (e) {
      setStatus(statusEl, e.message, "err");
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function startSync() {
    syncBtn.disabled = true;
    try {
      await startGarminSync();
    } catch (e) {
      setStatus(syncStatusEl, e.message, "err");
      syncBtn.disabled = false;
    }
  }

  async function remove() {
    if (!(await confirmDialog("Garmin-Schlüssel entfernen? Danach holt das Dashboard keine neuen Garmin-Daten mehr für dich (bereits geholte bleiben). Zurückziehen kannst du ihn zusätzlich in Garmin Connect.", { okLabel: "Entfernen" }))) return;
    try {
      setGarminState((await apiCall("garmin/personal-api", "DELETE")).data);
    } catch (e) {
      setStatus(statusEl, e.message, "err");
    }
  }

  saveBtn.addEventListener("click", save);
  keyInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); save(); } });
  syncBtn.addEventListener("click", startSync);
  deleteBtn.addEventListener("click", remove);
  changeBtn.addEventListener("click", () => { changing = true; render(garminState); keyInput.focus(); });
  cancelBtn.addEventListener("click", () => { changing = false; keyInput.value = ""; render(garminState); });
  onGarminState(render);
  refresh();
}

// Menü "Aktualisieren" → "Von Garmin holen": derselbe Abruf wie in den
// Einstellungen, über die offizielle Garmin-Schnittstelle auf dem Server.
async function startGarminSyncFromMenu() {
  const el = document.getElementById("garmin-sync-status");
  const show = (html, cls) => { if (el) { el.innerHTML = html; el.className = "update-menu-sync" + (cls ? " " + cls : ""); } };
  show("Abruf läuft … beim ersten Mal kann das einige Minuten dauern.");
  let sync;
  try {
    sync = await startGarminSync();
  } catch (e) {
    show(`${escapeHtml(e.message)}<br><a href="#" class="sync-hint" data-open-garmin-settings>Garmin-Verbindung öffnen</a>`, "err");
    return;
  }
  if (sync && sync.ok) show(`${escapeHtml(sync.message || "Fertig.")} Die Daten sind aktualisiert.`, "ok");
  else show(escapeHtml((sync && sync.message) || "Abruf fehlgeschlagen."), "err");
}

function initGarminMenu() {
  const btn = document.getElementById("menu-item-garmin");
  if (btn) btn.addEventListener("click", startGarminSyncFromMenu);
  document.addEventListener("click", e => {
    if (e.target.closest("[data-reload]")) { e.preventDefault(); window.location.reload(); }
    if (e.target.closest("[data-open-garmin-settings]")) {
      e.preventDefault();
      openSettingsPanel("garmin");
    }
  });
}
