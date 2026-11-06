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
