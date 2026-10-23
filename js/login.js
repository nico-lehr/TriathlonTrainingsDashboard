// Einstiegspunkt der Login-Seite (login.html): Benutzername + Passwort an
// POST /api/v1/auth/login, Token merken, weiter zum Dashboard. Benutzer legt
// nur backend/create_user.py an - es gibt bewusst keine Registrierung.

(function initLogin() {
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    try {
      const res = await apiCall("auth/login", "POST", {
        username: document.getElementById("login-username").value,
        password: document.getElementById("login-password").value,
      }, { redirectOn401: false });
      setAuthToken(res.data.token);
      window.location.href = "./";
    } catch (err) {
      errorEl.textContent = err.message; // z.B. "Benutzername oder Passwort falsch"
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });
})();
