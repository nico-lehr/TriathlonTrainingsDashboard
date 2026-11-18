// "Sicherheit" in den Einstellungen:
// - für alle: "Überall abmelden" (beendet jede Anmeldung dieser Person auf
//   allen Geräten, backend/routes.py: POST auth/logout-all)
// - nur Betreiber: "Nur über Tailscale erreichbar" (backend/access_guard.py)

let securityState = null; // {tailscale_only, forced, this_device_ok} - nur für den Betreiber

function initSecuritySettings() {
  const allBtn = document.getElementById("logout-all-btn");
  const adminBox = document.getElementById("access-admin");
  const sw = document.getElementById("access-tailscale-only");
  const statusEl = document.getElementById("security-status");
  if (!allBtn || !adminBox || !sw || !statusEl) return;

  function setStatus(msg, kind) {
    statusEl.textContent = msg || "";
    statusEl.className = "coach-test-status" + (kind ? " " + kind : "");
  }

  function render(st) {
    securityState = st;
    adminBox.hidden = !st;
    if (!st) return;
    sw.checked = !!st.tailscale_only;
    sw.disabled = !!st.forced;
    if (st.forced) setStatus("Fest in der Datei .env eingestellt (NUR_TAILSCALE).", "");
    if (typeof renderSettingsHub === "function" && typeof shPanel !== "undefined" && !shPanel) renderSettingsHub();
  }

  allBtn.addEventListener("click", async () => {
    const ok = await confirmDialog("Auf allen Geräten abmelden?\n\nDanach musst du dich überall neu anmelden – auch hier.", { okLabel: "Überall abmelden" });
    if (!ok) return;
    allBtn.disabled = true;
    setStatus("Melde überall ab …", "");
    try {
      await logout({ everywhere: true });
    } catch (e) {
      allBtn.disabled = false;
      setStatus(e.message || String(e), "err");
    }
  });

  sw.addEventListener("change", async () => {
    const want = sw.checked;
    setStatus("Speichere …", "");
    try {
      render((await apiCall("admin/access", "PUT", { tailscale_only: want })).data);
      setStatus(want ? "Ab jetzt nur noch über Tailscale erreichbar." : "Wieder auch im WLAN erreichbar.", "ok");
    } catch (e) {
      sw.checked = !want;
      setStatus(e.message || String(e), "err");
    }
  });

  apiCall("admin/access")
    .then(r => render(r.data))
    .catch(() => render(null)); // 403: kein Betreiber -> Schalter bleibt versteckt
}
