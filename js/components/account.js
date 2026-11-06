// "Konto"-Karte in den Einstellungen: zeigt, wer angemeldet ist, und meldet
// ab (logout(), js/data/api-client.js - entfernt auch alles Persönliche aus
// diesem Browser, damit die nächste Person am selben Gerät nichts davon sieht).

function initAccount() {
  const nameEl = document.getElementById("account-username");
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  if (nameEl) {
    apiCall("auth/me")
      .then(r => { nameEl.textContent = r.data.username || r.data.name || "–"; })
      .catch(() => { /* Name ist nur Anzeige */ });
  }
}

// "Darstellung" (Konto-Karte): Automatisch (wie das Gerät), Hell oder Dunkel.
// Auf dem Handy ersetzt das den Mond-Knopf oben (der dort ausgeblendet ist).
function initThemeChoice() {
  const box = document.getElementById("theme-choice");
  if (!box) return;
  const current = () => document.documentElement.getAttribute("data-theme") || "auto";
  const render = () => box.querySelectorAll("button").forEach(b => {
    const on = b.dataset.themeChoice === current();
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", String(on));
  });
  box.addEventListener("click", e => {
    const b = e.target.closest("button[data-theme-choice]");
    if (!b) return;
    const v = b.dataset.themeChoice;
    if (v === "auto") {
      document.documentElement.removeAttribute("data-theme");
      try { localStorage.removeItem(THEME_KEY); } catch (err) { /* nur Komfort */ }
    } else {
      document.documentElement.setAttribute("data-theme", v);
      try { localStorage.setItem(THEME_KEY, v); } catch (err) { /* nur Komfort */ }
    }
    if (typeof updateThemeToggleIcon === "function") updateThemeToggleIcon();
    render();
  });
  const btn = document.getElementById("theme-toggle-btn");
  if (btn) btn.addEventListener("click", () => setTimeout(render, 0));
  render();
}
