// Login-Seite (login.html): Anmelden oder - mit Einladungscode des
// Betreibers - selbst ein Konto erstellen (POST /api/v1/auth/register).
// "Angemeldet bleiben" (Standard an): Token im localStorage, der Server
// erneuert ihn bei Benutzung; aus: nur bis der Browser geschlossen wird.
// Ein Einladungslink (login.html?code=XXXX-XXXX) öffnet direkt
// "Konto erstellen" mit eingetragenem Code.

(function initLogin() {
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");
  const modeBox = document.getElementById("login-mode");
  const title = document.getElementById("login-title");
  const sub = document.getElementById("login-sub");
  const user = document.getElementById("login-username");
  const pass = document.getElementById("login-password");
  const code = document.getElementById("login-code");
  const remember = document.getElementById("login-remember");
  const params = new URLSearchParams(window.location.search);
  let mode = "login";

  function setMode(next) {
    mode = next;
    modeBox.querySelectorAll("button").forEach(b => {
      const on = b.dataset.mode === mode;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", String(on));
    });
    form.querySelectorAll("[data-for=register]").forEach(el => { el.hidden = mode !== "register"; });
    const reg = mode === "register";
    title.textContent = reg ? "Konto erstellen" : "Willkommen zurück";
    sub.textContent = reg
      ? "Dein eigener Bereich: deine Trainings, Ziele und Einstellungen sieht niemand sonst."
      : "Melde dich an. Jede Person sieht nur ihre eigenen Trainingsdaten.";
    submitBtn.textContent = reg ? "Konto erstellen" : "Anmelden";
    pass.autocomplete = reg ? "new-password" : "current-password";
    errorEl.hidden = true;
  }

  modeBox.addEventListener("click", e => {
    const b = e.target.closest("button[data-mode]");
    if (b) setMode(b.dataset.mode);
  });
  code.addEventListener("input", () => {
    const raw = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    code.value = raw.length > 4 ? raw.slice(0, 4) + "-" + raw.slice(4) : raw;
  });

  // Registrierung nur anbieten, wenn der Betreiber Einladungen erlaubt
  // (oder jemand über einen Einladungslink kommt).
  const invited = params.get("code");
  if (invited) {
    code.value = invited.toUpperCase();
    modeBox.hidden = false;
    setMode("register");
  }
  apiCall("auth/register", "GET", null, { redirectOn401: false })
    .then(res => { if (res.data && res.data.open) modeBox.hidden = false; })
    .catch(() => { /* ohne Server bleibt es beim Anmelden */ });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    if (!user.value.trim() || !pass.value) {
      errorEl.textContent = "Bitte Benutzername und Passwort eingeben.";
      errorEl.hidden = false;
      return;
    }
    submitBtn.disabled = true;
    try {
      const body = { username: user.value, password: pass.value, remember: remember.checked };
      if (mode === "register") body.code = code.value;
      const res = await apiCall(mode === "register" ? "auth/register" : "auth/login", "POST", body, { redirectOn401: false });
      setAuthToken(res.data.token, remember.checked);
      window.location.href = "./";
    } catch (err) {
      errorEl.textContent = err.message; // z. B. "Benutzername oder Passwort falsch"
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });
})();
