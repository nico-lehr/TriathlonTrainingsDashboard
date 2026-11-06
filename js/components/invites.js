// "Freunde einladen" in den Einstellungen (nur Betreiber): Registrierung
// mit Einladungscode an/aus, Code teilen oder erneuern, Liste der Konten.
// Server: backend/invite_routes.py, backend/invites.py.

function initInvites() {
  const card = document.getElementById("invite-card");
  if (!card) return;
  const toggle = document.getElementById("invite-enabled");
  const active = document.getElementById("invite-active");
  const codeEl = document.getElementById("invite-code");
  const shareBtn = document.getElementById("invite-share-btn");
  const renewBtn = document.getElementById("invite-renew-btn");
  const statusEl = document.getElementById("invite-status");
  const list = document.getElementById("invite-accounts");
  const listTitle = document.getElementById("invite-accounts-title");
  let current = null;

  const setStatus = (text, kind) => {
    statusEl.textContent = text || "";
    statusEl.className = "coach-test-status" + (kind ? " " + kind : "");
  };
  const inviteLink = code => new URL("login.html?code=" + encodeURIComponent(code), window.location.href).href;

  function render(st) {
    current = st;
    card.hidden = !st || !st.admin;
    if (card.hidden) return;
    toggle.checked = !!st.enabled;
    active.hidden = !st.enabled;
    codeEl.textContent = st.code || "––––-––––";
    const accounts = st.accounts || [];
    listTitle.textContent = `Konten (${accounts.length} von höchstens ${st.max_accounts})`;
    list.innerHTML = accounts.map(a => `<li><span>${escapeHtml(a.username)}</span><small>${a.created ? escapeHtml(new Date(a.created + "T12:00:00").toLocaleDateString("de-DE")) : ""}</small></li>`).join("");
  }

  toggle.addEventListener("change", async () => {
    try {
      render((await apiCall("invites", "PUT", { enabled: toggle.checked })).data);
      setStatus(toggle.checked ? "Einladungen sind an – teile den Code mit deinen Freunden." : "Einladungen sind aus. Niemand kann mehr ein Konto erstellen.", "ok");
    } catch (e) {
      toggle.checked = !toggle.checked;
      setStatus(e.message, "err");
    }
  });

  renewBtn.addEventListener("click", async () => {
    if (!(await confirmDialog("Neuen Code erzeugen? Der alte Code und alte Einladungslinks funktionieren dann nicht mehr. Bestehende Konten bleiben.", { okLabel: "Neuer Code", danger: false }))) return;
    try {
      render((await apiCall("invites/renew", "POST")).data);
      setStatus("Neuer Code erstellt.", "ok");
    } catch (e) {
      setStatus(e.message, "err");
    }
  });

  shareBtn.addEventListener("click", async () => {
    if (!current || !current.code) return;
    const link = inviteLink(current.code);
    const text = `Komm in mein Triathlon-Dashboard! Öffne den Link und erstelle dein Konto – der Einladungscode ist schon eingetragen (${current.code}).`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Einladung zum TriDashboard", text, url: link });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${link}`);
      setStatus("Einladung kopiert – jetzt z. B. in WhatsApp einfügen.", "ok");
    } catch (e) {
      if (e && e.name === "AbortError") return; // Teilen abgebrochen
      setStatus(`Link: ${link}`, "");
    }
  });

  apiCall("invites").then(res => render(res.data)).catch(() => { card.hidden = true; });
}
