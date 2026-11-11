// Einstellungen → Garmin → "Trainings auf die Uhr": einmal mit Garmin
// anmelden (ggf. mit Zwei-Faktor-Code), wählen, was automatisch kommt (nur
// heute / 7 Tage / nur per Knopf), Stand der Einheiten, "Jetzt abgleichen". Das Passwort geht nur einmal an den eigenen
// Dashboard-Server, wird dort gegen eine Anmeldung getauscht und vergessen.
// Daten und Abgleich: js/data/garmin-push.js, backend/garmin_push.py.

let gpForm = { step: "login", busy: false, msg: "", msgKind: "" };

function gpEsc(v) { return escapeHtml(String(v == null ? "" : v)); }

function gpWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = todayStr();
  const day = localDateStr(d) === today ? "heute" : d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
}

function gpResultText(r) {
  if (!r) return "";
  const parts = [];
  if (r.created) parts.push(`${r.created} neu`);
  if (r.updated) parts.push(`${r.updated} aktualisiert`);
  if (r.moved) parts.push(`${r.moved} verschoben`);
  if (r.removed) parts.push(`${r.removed} gelöscht`);
  return parts.length ? parts.join(" · ") : "alles aktuell";
}

function gpUpcomingTitle() {
  return garminPush.mode === "week" ? "Nächste 7 Tage" : garminPush.mode === "manual" ? "Von dir gesendet" : "Heute";
}

function gpUpcomingHtml() {
  const list = garminPushCandidates().sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);
  if (!list.length) {
    const empty = garminPush.mode === "manual" ? "Noch nichts gesendet. Öffne eine Einheit und tippe auf „An Garmin senden“."
      : garminPush.mode === "week" ? "In den nächsten 7 Tagen ist nichts geplant, das auf die Uhr kann."
        : "Heute ist nichts geplant, das auf die Uhr kann. Andere Tage kannst du in der Einheit mit „An Garmin senden“ schicken.";
    return `<p class="card-sub gp-empty">${empty}</p>`;
  }
  const failed = new Map(((garminPush.last_result || {}).failed || []).map(f => [f.id, f.message]));
  return `<div class="settings-list gp-list">${list.map(p => {
    const link = garminPush.links[p.id];
    const st = link ? `<span class="gp-st ok"><i></i>Auf der Uhr</span>`
      : failed.has(p.id) ? `<span class="gp-st bad" title="${gpEsc(failed.get(p.id))}">Fehler</span>`
        : `<span class="gp-st wait">Kommt gleich</span>`;
    const day = new Date(p.date + "T00:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
    return `<div class="settings-list-row gp-row"><span class="gp-what"><b>${gpEsc(p.title || p.sport)}</b><small>${gpEsc(day)} · ${gpEsc(p.sport)}</small></span>${st}</div>`;
  }).join("")}</div>`;
}

function gpOfficialHtml() {
  const o = garminPush.official || {};
  if (o.connected) return `<p class="card-sub gp-official ok">Offizielle Garmin-Schnittstelle verbunden – Trainings laufen über Garmins Training API.</p>
    <button type="button" class="reset-link" id="gp-official-off">Offizielle Verbindung trennen</button>`;
  if (o.available) return `<div class="coach-settings-row"><button type="button" class="cal-today-btn" id="gp-official-on">Offiziell mit Garmin verbinden</button></div>
    <p class="card-sub">Ohne Passwort – du stimmst direkt bei Garmin zu.</p>`;
  return `<details class="settings-disclosure gp-official"><summary>Offizielle Garmin-Schnittstelle</summary>
    <p class="card-sub">Vorbereitet. Sobald Garmin sie freischaltet, verbindest du hier ohne Passwort.</p></details>`;
}

function gpMsgHtml() {
  return gpForm.msg ? `<p class="coach-test-status ${gpForm.msgKind}" role="status">${gpEsc(gpForm.msg)}</p>` : "";
}

function renderGarminPushCard() {
  const body = document.getElementById("gp-body");
  if (!body) return;
  if (!garminPush.loaded) { body.innerHTML = `<p class="card-sub">Lade …</p>`; return; }
  if (!garminPush.connected) {
    const mfa = gpForm.step === "mfa";
    body.innerHTML = `
      <form id="gp-login-form" autocomplete="on">
        <div class="settings-list">
          ${mfa ? `
          <div class="settings-list-row"><label for="gp-code">Code</label>
            <input type="text" id="gp-code" class="coach-input" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="8"></div>` : `
          <div class="settings-list-row"><label for="gp-email">Garmin-E-Mail</label>
            <input type="email" id="gp-email" class="coach-input" autocomplete="username" placeholder="name@beispiel.de"></div>
          <div class="settings-list-row"><label for="gp-password">Passwort</label>
            <input type="password" id="gp-password" class="coach-input" autocomplete="current-password"></div>`}
        </div>
        <p class="card-sub settings-list-foot">${mfa ? "Garmin hat dir einen Code geschickt (E-Mail oder App). Bitte hier eingeben."
          : "Dein Passwort wird nicht gespeichert."}</p>
        <div class="coach-settings-row">
          <button type="submit" class="update-btn" id="gp-login-btn"${gpForm.busy ? " disabled" : ""}>${gpForm.busy ? "Melde an … (kann 30 s dauern)" : mfa ? "Code bestätigen" : "Mit Garmin anmelden"}</button>
          ${mfa ? `<button type="button" class="reset-link" id="gp-mfa-cancel">Abbrechen</button>` : ""}
        </div>
      </form>
      ${gpMsgHtml()}
      ${gpOfficialHtml()}`;
    return;
  }
  const r = garminPush.last_result;
  const stopped = r && r.stopped ? r.stopped.message : "";
  const err = garminPush.error || stopped;
  body.innerHTML = `
    <div class="ai-status-row"><span class="ai-status-dot on" aria-hidden="true"></span>
      <span class="ai-status-text">Verbunden${garminPush.last_run_at ? ` · abgeglichen ${gpEsc(gpWhen(garminPush.last_run_at))}` : ""}</span></div>
    ${err ? `<p class="coach-test-status err">${gpEsc(err)}</p>` : ""}
    <h3 class="gp-h">Was kommt automatisch auf die Uhr?</h3>
    <div class="settings-list gp-modes" role="radiogroup" aria-label="Was kommt automatisch auf die Uhr?">
      ${GARMIN_PUSH_MODES.map(m => `
      <label class="settings-list-row gp-mode">
        <span class="gp-what"><b>${gpEsc(m.label)}</b><small>${gpEsc(m.sub)}</small></span>
        <input type="radio" name="gp-mode" value="${m.key}"${garminPush.mode === m.key ? " checked" : ""}>
      </label>`).join("")}
    </div>
    <p class="card-sub settings-list-foot">Jede Einheit kannst du außerdem jederzeit selbst schicken: Einheit öffnen → „An Garmin senden“.</p>
    <h3 class="gp-h">${gpUpcomingTitle()}</h3>
    ${gpUpcomingHtml()}
    ${gpMsgHtml()}
    <div class="sh-actions">
      <button type="button" class="cal-today-btn" id="gp-sync-now"${garminPush.busy ? " disabled" : ""}>${garminPush.busy ? "Gleiche ab …" : "Jetzt abgleichen"}</button>
      <button type="button" class="reset-link" id="gp-logout">Abmelden</button>
    </div>
    ${gpOfficialHtml()}`;
}

function gpSetMsg(msg, kind = "") { gpForm.msg = msg; gpForm.msgKind = kind; }

async function gpSubmitLogin(e) {
  e.preventDefault();
  if (gpForm.busy) return;
  const code = document.getElementById("gp-code");
  const email = document.getElementById("gp-email");
  const pass = document.getElementById("gp-password");
  gpForm.busy = true; gpSetMsg("");
  renderGarminPushCard();
  try {
    if (code) {
      await apiCall("garmin/workouts/login/mfa", "POST", { code: code.value });
    } else {
      const res = await apiCall("garmin/workouts/login", "POST", { email: email.value.trim(), password: pass.value }, { timeoutMs: 90000 });
      pass.value = "";
      if (res.data.mfa_required) { gpForm.step = "mfa"; gpForm.busy = false; renderGarminPushCard(); return; }
    }
    gpForm.step = "login";
    gpSetMsg("Verbunden. Deine nächsten Einheiten kommen jetzt auf die Uhr.", "ok");
    if (typeof mTrack === "function") mTrack("feature", "garmin-push-login");
    await refreshGarminPush();
    runGarminPush();
  } catch (err) {
    if (err.code === "garmin_mfa_expired") gpForm.step = "login";
    gpSetMsg(err.message, "err");
  }
  gpForm.busy = false;
  renderGarminPushCard();
}

function initGarminPushSettings() {
  const body = document.getElementById("gp-body");
  if (!body) return;
  body.addEventListener("submit", e => { if (e.target.id === "gp-login-form") gpSubmitLogin(e); });
  body.addEventListener("change", async e => {
    if (e.target.name !== "gp-mode") return;
    try {
      const res = await apiCall("garmin/workouts/settings", "PUT", { mode: e.target.value });
      setGarminPush(res.data);
      // Gleich abgleichen: neue Einheiten schicken bzw. nicht mehr gewünschte aus Garmin entfernen.
      const r = await runGarminPush();
      if (r && r.removed) gpSetMsg(`${r.removed} ${r.removed === 1 ? "Workout" : "Workouts"} aus Garmin Connect entfernt.`, "ok");
      renderGarminPushCard();
    } catch (err) { gpSetMsg(err.message, "err"); renderGarminPushCard(); }
  });
  body.addEventListener("click", async e => {
    const id = e.target.id;
    if (id === "gp-mfa-cancel") { gpForm.step = "login"; gpSetMsg(""); renderGarminPushCard(); }
    else if (id === "gp-sync-now") { gpSetMsg(""); const r = await runGarminPush(); if (r) gpSetMsg(`Abgeglichen: ${gpResultText(r)}.`, "ok"); renderGarminPushCard(); }
    else if (id === "gp-logout") {
      if (!(await confirmDialog("Garmin-Anmeldung für Trainings entfernen? Workouts, die schon in Garmin sind, bleiben dort.", { okLabel: "Abmelden" }))) return;
      const res = await apiCall("garmin/workouts/disconnect", "POST", {});
      gpSetMsg(""); setGarminPush(res.data);
    } else if (id === "gp-official-on") {
      try { const res = await apiCall("garmin/official/start", "POST", {}); location.href = res.data.url; }
      catch (err) { gpSetMsg(err.message, "err"); renderGarminPushCard(); }
    } else if (id === "gp-official-off") {
      await apiCall("garmin/official/disconnect", "POST", {});
      await refreshGarminPush();
    }
  });
  onGarminPush(() => {
    renderGarminPushCard();
    if (typeof renderTrainingPlanCard === "function") renderTrainingPlanCard();
    if (typeof renderMApp === "function" && typeof mEnabled === "function" && mEnabled()) renderMApp();
  });
  renderGarminPushCard();
  initGarminPush();
}
