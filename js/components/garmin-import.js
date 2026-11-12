// Werte aus Garmin übernehmen (offizielle Personal API, GET garmin/profile,
// Auswertung in tools/garmin_profile.py): Gewicht, Pulswerte, Laktatschwelle,
// FTP, Geburtsdatum, Geschlecht - soweit Garmin sie liefert. Vor dem
// Übernehmen zeigt ein Fenster jeden Wert (und den bisherigen) zum Abhaken.
// Eingebunden in den Einstellungen ("Trainingswerte") und im Onboarding;
// dort kann man Garmin auch direkt verbinden.

const GARMIN_IMPORT_FIELDS = [
  ["weightKg", "Körpergewicht", v => `${String(v).replace(".", ",")} kg`],
  ["heightCm", "Größe", v => `${v} cm`],
  ["maxHr", "Maximale Herzfrequenz", v => `${v} bpm`],
  ["restingHr", "Ruhe-Herzfrequenz", v => `${v} bpm`],
  ["runThresholdPace", "Schwellenpace Laufen", v => `${v} /km`],
  ["ftpWatts", "FTP Rad", v => `${v} W`],
  ["birthDate", "Geburtsdatum", v => new Date(v + "T12:00:00").toLocaleDateString("de-DE")],
  ["gender", "Geschlecht", v => (v === "m" ? "männlich" : v === "w" ? "weiblich" : v)],
];
const GARMIN_INFO_FIELDS = [
  ["lthr", "Laktatschwelle (Puls)", v => `${v} bpm`],
  ["vo2maxRun", "VO2max Laufen", v => String(v)],
  ["vo2maxBike", "VO2max Rad", v => String(v)],
];

let garminConnectedCache = null;

async function garminConnected(force) {
  if (garminConnectedCache !== null && !force) return garminConnectedCache;
  try {
    garminConnectedCache = !!(await apiCall("garmin/personal-api")).data.configured;
  } catch (e) {
    garminConnectedCache = false;
  }
  return garminConnectedCache;
}

async function refreshGarminImportButtons(root) {
  const ok = await garminConnected();
  (root || document).querySelectorAll("[data-garmin-import]").forEach(b => { b.hidden = !ok; });
  return ok;
}

// Bisheriger Wert je Ziel: Onboarding (onbState) oder gespeichertes Profil.
function garminCurrentValue(target, key) {
  const src = target === "onboarding" && typeof onbState !== "undefined" ? onbState : athleteProfile;
  const v = src ? src[key] : null;
  return v === "" || v == null ? null : v;
}

function garminApply(target, picked) {
  if (target === "onboarding" && typeof onbState !== "undefined") {
    Object.assign(onbState, picked);
    renderOnbStep();
    return;
  }
  Object.entries(picked).forEach(([k, v]) => {
    athleteProfile[k] = GARMIN_NUMERIC.includes(k) ? Number(v) : v;
  });
  saveAthleteProfile();
  if (typeof syncProfileInputsFromState === "function") syncProfileInputsFromState();
  if (typeof renderAll === "function") renderAll();
}

async function openGarminImport(target, btn) {
  if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
  let values;
  try {
    values = (await apiCall("garmin/profile", "GET", null, { timeoutMs: 60000 })).data.values || {};
  } catch (e) {
    if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
    await confirmDialog(e.message, { okLabel: "OK", danger: false });
    return;
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); }
  }
  const rows = GARMIN_IMPORT_FIELDS.filter(([k]) => values[k] != null);
  const info = GARMIN_INFO_FIELDS.filter(([k]) => values[k] != null);
  const missing = GARMIN_IMPORT_FIELDS.filter(([k]) => values[k] == null).map(([, label]) => label);

  const overlay = document.createElement("div");
  overlay.className = "mob-sheet-overlay";
  overlay.innerHTML = `
    <div class="mob-sheet garmin-import-sheet" role="dialog" aria-modal="true" aria-labelledby="garmin-import-title">
      <div class="mob-sheet-grabber" aria-hidden="true"></div>
      <h2 class="mob-sheet-title" id="garmin-import-title">Aus Garmin übernehmen</h2>
      <p class="mob-sheet-meta">${rows.length ? "Wähle, was übernommen werden soll." : "Garmin hat dafür gerade keine passenden Werte geliefert."}</p>
      ${rows.length ? `<div class="settings-list">${rows.map(([k, label, fmt]) => {
        const cur = garminCurrentValue(target, k);
        const same = cur != null && String(cur) === String(values[k]);
        return `<label class="settings-list-row garmin-import-row">
          <span class="garmin-import-text"><span>${escapeHtml(label)}</span><small>${escapeHtml(fmt(values[k]))}${cur != null && !same ? ` · bisher ${escapeHtml(String(cur))}` : same ? " · schon eingetragen" : ""}</small></span>
          <input type="checkbox" class="switch" data-key="${k}" ${same ? "" : "checked"}>
        </label>`;
      }).join("")}</div>` : ""}
      ${info.length ? `<p class="garmin-import-info">Außerdem von Garmin: ${info.map(([k, label, fmt]) => `${escapeHtml(label)} ${escapeHtml(fmt(values[k]))}`).join(" · ")}</p>` : ""}
      ${missing.length ? `<p class="garmin-import-info">Nicht von Garmin geliefert: ${escapeHtml(missing.join(", "))} – bitte selbst eintragen.</p>` : ""}
      <div class="mob-sheet-actions">
        ${rows.length ? `<button type="button" class="mob-btn mob-btn-primary" data-act="apply">Übernehmen</button>` : ""}
        <button type="button" class="mob-btn mob-btn-secondary" data-act="close">${rows.length ? "Abbrechen" : "Schließen"}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  const close = () => { overlay.classList.remove("is-open"); setTimeout(() => overlay.remove(), 250); };
  overlay.addEventListener("click", e => {
    if (e.target === overlay || e.target.closest('[data-act="close"]')) close();
    if (e.target.closest('[data-act="apply"]')) {
      const picked = {};
      overlay.querySelectorAll("input[data-key]:checked").forEach(c => { picked[c.dataset.key] = values[c.dataset.key]; });
      garminApply(target, picked);
      close();
    }
  });
}

// Onboarding, erster Schritt: Garmin verbinden (Schlüssel). Sobald Garmin
// verbunden ist, holt das Onboarding die Werte selbst und trägt sie ein –
// diese Felder werden in den späteren Schritten nicht mehr abgefragt.
function onbGarminBlockHtml() {
  const st = typeof onbState !== "undefined" ? onbState : {};
  const got = GARMIN_IMPORT_FIELDS.filter(([k]) => (st.garminKeys || []).includes(k) && st[k] != null && st[k] !== "");
  const info = GARMIN_INFO_FIELDS.filter(([k]) => st.garminInfo && st.garminInfo[k] != null);
  return `<div class="onb-garmin">
      <div class="onb-garmin-text" data-onb-garmin-intro hidden><b>Garmin verbinden</b>
        <span>Dafür brauchst du einen Schlüssel aus Garmin Connect – das geht in einer Minute. Dein Garmin-Passwort brauchst du nicht.</span></div>
      <ol class="onb-garmin-steps" data-onb-garmin-form hidden>
        <li><a href="https://connect.garmin.com/app/settings/personalApiToken" target="_blank" rel="noopener">Garmin Connect öffnen ↗</a> und dort „Schlüssel erstellen“ tippen</li>
        <li>Den Schlüssel kopieren</li>
        <li>Hier einfügen:
          <div class="onb-garmin-form">
            <input type="password" class="coach-input" data-onb-garmin-key autocomplete="off" spellcheck="false" placeholder="Garmin-Schlüssel einfügen" aria-label="Garmin-Schlüssel">
            <button type="button" class="mob-btn mob-btn-primary" data-onb-garmin-connect>Verbinden</button>
          </div>
        </li>
      </ol>
      <div class="onb-garmin-ok" data-onb-garmin-ok hidden>
        <b>✓ Mit Garmin verbunden</b>
        ${got.length ? `<span>Übernommen: ${got.map(([k, label, fmt]) => `${escapeHtml(label)} ${escapeHtml(fmt(st[k]))}`).join(" · ")}</span>`
          : st.garminLoaded ? `<span>Garmin hat noch keine Profilwerte geliefert – du kannst sie gleich selbst eintragen.</span>` : `<span>Hole deine Werte von Garmin …</span>`}
        ${info.length ? `<span>Außerdem: ${info.map(([k, label, fmt]) => `${escapeHtml(label)} ${escapeHtml(fmt(st.garminInfo[k]))}`).join(" · ")}</span>` : ""}
        <span>Deine Trainings und Schlafwerte kommen ab jetzt von selbst.</span>
      </div>
      <p class="coach-test-status" data-onb-garmin-status></p>
      <p class="onb-hint" data-onb-garmin-skip hidden>Keine Garmin-Uhr? Einfach auf „Weiter“ – dann fragen wir die Werte kurz ab.</p>
    </div>`;
}

// Garmin-Werte ins Onboarding übernehmen (ohne Rückfrage – der Nutzer
// kann jeden Wert später mit "ändern" selbst überschreiben).
async function onbLoadGarminValues(status) {
  if (typeof onbState === "undefined" || onbState.garminLoaded) return;
  onbState.garminLoaded = true;
  try {
    const values = (await apiCall("garmin/profile", "GET", null, { timeoutMs: 60000 })).data.values || {};
    const keys = [];
    GARMIN_IMPORT_FIELDS.forEach(([k]) => {
      if (values[k] != null && values[k] !== "") { onbState[k] = values[k]; keys.push(k); }
    });
    onbState.garminKeys = keys;
    onbState.garminRaw = Object.fromEntries(keys.map(k => [k, values[k]]));
    onbState.garminInfo = {};
    GARMIN_INFO_FIELDS.forEach(([k]) => { if (values[k] != null) onbState.garminInfo[k] = values[k]; });
  } catch (e) {
    if (status) { status.textContent = e.message; status.className = "coach-test-status err"; }
    return;
  }
  if (document.getElementById("onb-overlay")?.classList.contains("open")) renderOnbStep();
}

async function initOnbGarmin(root) {
  const form = root.querySelector("[data-onb-garmin-form]");
  const connected = await refreshGarminImportButtons(root);
  if (!form) return;
  const status = root.querySelector("[data-onb-garmin-status]");
  form.hidden = connected;
  root.querySelector("[data-onb-garmin-intro]").hidden = connected;
  root.querySelector("[data-onb-garmin-skip]").hidden = connected;
  root.querySelector("[data-onb-garmin-ok]").hidden = !connected;
  if (connected) { onbLoadGarminValues(status); return; }
  const input = root.querySelector("[data-onb-garmin-key]");
  const btn = root.querySelector("[data-onb-garmin-connect]");
  btn.addEventListener("click", async () => {
    const key = input.value.trim();
    if (!key) { status.textContent = "Bitte zuerst den Schlüssel einfügen."; status.className = "coach-test-status warn"; return; }
    btn.disabled = true;
    status.textContent = "Prüfe den Schlüssel bei Garmin …";
    status.className = "coach-test-status";
    try {
      await apiCall("garmin/personal-api", "PUT", { key, expires: null }, { timeoutMs: 45000 });
      input.value = "";
      garminConnectedCache = true;
      status.textContent = "";
      apiCall("garmin/sync", "POST").catch(() => { /* erster Abruf ist nur Komfort */ });
      if (typeof onbState !== "undefined") onbState.garminLoaded = false;
      renderOnbStep(); // zeigt "verbunden" und holt die Werte
    } catch (e) {
      status.textContent = e.message;
      status.className = "coach-test-status err";
    } finally {
      btn.disabled = false;
    }
  });
}

/* ----------------------------------------------------------------------
   Einstellungen "Dein Profil": Werte, die Garmin liefert, werden nur
   angezeigt (mit "ändern"). Das Dashboard gleicht sie einmal am Tag von
   selbst mit Garmin ab. Was man selbst ändert, bleibt (garminOverrides),
   bis man "Garmin-Wert nehmen" tippt.
   athleteProfile.garminValues    – zuletzt von Garmin gelieferte Werte
   athleteProfile.garminOverrides – Felder, die man selbst überschrieben hat
   athleteProfile.garminSyncedAt  – letzter Abgleich (ISO)
   ---------------------------------------------------------------------- */
const GARMIN_NUMERIC = ["weightKg", "heightCm", "maxHr", "restingHr", "ftpWatts"];
const GARMIN_SYNC_EVERY_MS = 20 * 3600 * 1000;

function profileFromGarmin(key) {
  const gv = athleteProfile.garminValues || {};
  return gv[key] != null && !(athleteProfile.garminOverrides || []).includes(key);
}

function garminFieldFmt(key) {
  const f = GARMIN_IMPORT_FIELDS.find(([k]) => k === key);
  return f ? f[2] : v => String(v);
}

async function renderProfileGarmin() {
  const card = document.getElementById("profile-card");
  if (!card) return;
  const gv = athleteProfile.garminValues || {};
  card.querySelectorAll(".pf-row[data-pf]").forEach(row => {
    const key = row.dataset.pf;
    const fromG = profileFromGarmin(key) && athleteProfile[key] != null;
    row.classList.toggle("is-garmin", fromG);
    row.querySelector(".pf-garmin-val").textContent = fromG ? garminFieldFmt(key)(athleteProfile[key]) : "";
    const src = row.querySelector(".pf-src");
    if (fromG) { src.hidden = true; }
    else if (gv[key] != null) { src.hidden = false; src.textContent = "↺ Garmin"; src.title = `Garmin-Wert nehmen (${garminFieldFmt(key)(gv[key])})`; src.dataset.act = "garmin"; }
    else { src.hidden = true; }
  });
  const status = document.getElementById("pf-garmin-status");
  if (!status) return;
  const ok = await garminConnected();
  if (ok) {
    const at = athleteProfile.garminSyncedAt ? new Date(athleteProfile.garminSyncedAt) : null;
    const when = at ? at.toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
    status.innerHTML = `<span class="pf-status-dot ok"></span><span class="pf-status-text"><b>Garmin verbunden</b><small>${when ? `Werte mit Garmin abgeglichen · ${escapeHtml(when)}` : "Werte werden mit Garmin abgeglichen"}</small></span>
      <button type="button" class="pf-status-btn" data-pf-sync>Jetzt abgleichen</button>`;
  } else {
    status.innerHTML = `<span class="pf-status-dot"></span><span class="pf-status-text"><b>Garmin nicht verbunden</b><small>Verbinde Garmin, dann füllen sich Gewicht, Pulswerte und Schwellen von selbst.</small></span>
      <button type="button" class="pf-status-btn" data-pf-connect>Verbinden</button>`;
  }
}

function applyGarminProfileValues(values) {
  const got = {};
  GARMIN_IMPORT_FIELDS.forEach(([k]) => { if (values[k] != null && values[k] !== "") got[k] = values[k]; });
  athleteProfile.garminValues = got;
  const over = athleteProfile.garminOverrides || [];
  Object.entries(got).forEach(([k, v]) => {
    if (!over.includes(k)) athleteProfile[k] = GARMIN_NUMERIC.includes(k) ? Number(v) : v;
  });
  athleteProfile.garminSyncedAt = new Date().toISOString();
  saveAthleteProfile();
  if (typeof syncProfileInputsFromState === "function") syncProfileInputsFromState();
  renderProfileGarmin();
}

// force=false: höchstens etwa einmal am Tag (beim Start des Dashboards).
async function syncProfileFromGarmin(force, btn) {
  if (!(await garminConnected())) return;
  const last = athleteProfile.garminSyncedAt ? Date.parse(athleteProfile.garminSyncedAt) : 0;
  if (!force && Date.now() - last < GARMIN_SYNC_EVERY_MS) return;
  if (btn) { btn.disabled = true; btn.textContent = "Gleiche ab …"; }
  try {
    const values = (await apiCall("garmin/profile", "GET", null, { timeoutMs: 60000 })).data.values || {};
    applyGarminProfileValues(values);
  } catch (e) {
    if (force) await confirmDialog(e.message, { okLabel: "OK", danger: false });
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = "Jetzt abgleichen"; }
  }
}

function initProfileGarmin() {
  const card = document.getElementById("profile-card");
  if (!card) return;
  card.addEventListener("click", e => {
    const src = e.target.closest(".pf-src") || e.target.closest(".pf-garmin-val");
    if (src && !src.dataset.act) src.dataset.act = "edit";
    if (src) {
      const key = src.closest(".pf-row").dataset.pf;
      const over = new Set(athleteProfile.garminOverrides || []);
      if (src.dataset.act === "edit") {
        over.add(key);
        athleteProfile.garminOverrides = [...over];
        saveAthleteProfile();
        renderProfileGarmin();
        const input = src.closest(".pf-row").querySelector(".pf-input");
        if (input) input.focus();
      } else {
        over.delete(key);
        athleteProfile.garminOverrides = [...over];
        const v = (athleteProfile.garminValues || {})[key];
        athleteProfile[key] = GARMIN_NUMERIC.includes(key) ? Number(v) : v;
        saveAthleteProfile();
        if (typeof syncProfileInputsFromState === "function") syncProfileInputsFromState();
        renderProfileGarmin();
      }
      return;
    }
    const sync = e.target.closest("[data-pf-sync]");
    if (sync) { syncProfileFromGarmin(true, sync); return; }
    if (e.target.closest("[data-pf-connect]")) {
      openSettingsPanel("garmin");
    }
  });
  renderProfileGarmin();
  syncProfileFromGarmin(false);
}

function initGarminImport() {
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-garmin-import]");
    if (b) openGarminImport(b.dataset.garminImport, b);
  });
  refreshGarminImportButtons(document);
  initProfileGarmin();
}
