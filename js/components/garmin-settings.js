// "Garmin-Verbindung"-Karte in den Einstellungen: jede Person hinterlegt
// ihren eigenen Personal-API-Schlüssel (offizielle Garmin-Schnittstelle, nur
// lesen) und holt ihre Daten auf Knopfdruck. Der Schlüssel geht einmal an den
// Server (backend/garmin_api_routes.py), der ihn bei Garmin prüft und auf dem
// PC ablegt - zurück ins Dashboard kommt er nie, auch nicht in die Ablage.

const GARMIN_SYNC_POLL_MS = 5000;

function initGarminSettings() {
  const statusEl = document.getElementById("garmin-api-status");
  const keyInput = document.getElementById("garmin-api-key");
  const expiresInput = document.getElementById("garmin-api-expires");
  const saveBtn = document.getElementById("garmin-api-save-btn");
  const syncBtn = document.getElementById("garmin-api-sync-btn");
  const syncStatusEl = document.getElementById("garmin-api-sync-status");
  const deleteBtn = document.getElementById("garmin-api-delete-btn");
  if (!statusEl || !keyInput || !expiresInput || !saveBtn || !syncBtn || !syncStatusEl || !deleteBtn) return;
  let pollTimer = null;

  function setStatus(el, text, kind) {
    el.textContent = text || "";
    el.classList.remove("ok", "warn", "err");
    if (kind) el.classList.add(kind);
  }

  function keyText(st) {
    if (!st.configured) {
      return [st.old_login
        ? "Noch kein Schlüssel – deine Daten kommen bisher über die alte Garmin-Anmeldung am Dashboard-PC."
        : "Noch kein Schlüssel hinterlegt.", ""];
    }
    if (st.days_left == null) return ["Schlüssel hinterlegt.", "ok"];
    const until = fmtDateFull(new Date(st.expires + "T00:00:00"));
    if (st.days_left < 0) return [`Schlüssel abgelaufen (seit ${until}) – bitte in Garmin Connect einen neuen erstellen und hier eintragen.`, "err"];
    if (st.days_left <= 14) return [`Schlüssel läuft bald ab (${until}, noch ${st.days_left} ${st.days_left === 1 ? "Tag" : "Tage"}) – rechtzeitig einen neuen erstellen.`, "warn"];
    return [`Schlüssel hinterlegt – gültig bis ${until} (noch ${st.days_left} Tage).`, "ok"];
  }

  function render(st) {
    const [text, kind] = keyText(st);
    setStatus(statusEl, text, kind);
    deleteBtn.hidden = !st.configured;
    syncBtn.hidden = !st.configured && !st.old_login;
    const sync = st.sync || {};
    syncBtn.disabled = !!sync.running;
    syncStatusEl.replaceChildren();
    if (sync.running) {
      setStatus(syncStatusEl, "Abruf läuft … beim ersten Mal kann das einige Minuten dauern.", "");
    } else if (sync.at) {
      const when = new Date(sync.at);
      setStatus(syncStatusEl, `Letzter Abruf ${fmtDate(when)} ${when.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}: ${sync.message || ""} `, sync.ok ? "ok" : "err");
      if (sync.ok) {
        const reload = document.createElement("button");
        reload.type = "button";
        reload.className = "chip";
        reload.textContent = "Neu laden, um die Daten zu sehen";
        reload.addEventListener("click", () => window.location.reload());
        syncStatusEl.appendChild(reload);
      }
    } else {
      setStatus(syncStatusEl, "", "");
    }
    clearTimeout(pollTimer);
    if (sync.running) pollTimer = setTimeout(refresh, GARMIN_SYNC_POLL_MS);
  }

  async function refresh() {
    try {
      render((await apiCall("garmin/personal-api")).data);
    } catch (e) {
      setStatus(statusEl, e.message, "err");
    }
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
      render(res.data);
    } catch (e) {
      setStatus(statusEl, e.message, "err");
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function startSync() {
    syncBtn.disabled = true;
    try {
      render((await apiCall("garmin/sync", "POST")).data);
    } catch (e) {
      setStatus(syncStatusEl, e.message, "err");
      syncBtn.disabled = false;
    }
  }

  async function remove() {
    if (!(await confirmDialog("Garmin-Schlüssel entfernen? Danach holt das Dashboard keine neuen Garmin-Daten mehr für dich (bereits geholte bleiben). Zurückziehen kannst du ihn zusätzlich in Garmin Connect.", { okLabel: "Entfernen" }))) return;
    try {
      render((await apiCall("garmin/personal-api", "DELETE")).data);
    } catch (e) {
      setStatus(statusEl, e.message, "err");
    }
  }

  saveBtn.addEventListener("click", save);
  keyInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); save(); } });
  syncBtn.addEventListener("click", startSync);
  deleteBtn.addEventListener("click", remove);
  refresh();
}
