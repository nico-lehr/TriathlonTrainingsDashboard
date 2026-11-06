// Werte aus Garmin übernehmen (offizielle Personal API, GET garmin/profile,
// Auswertung in tools/garmin_profile.py): Gewicht, Pulswerte, Laktatschwelle,
// FTP, Geburtsdatum, Geschlecht - soweit Garmin sie liefert. Vor dem
// Übernehmen zeigt ein Fenster jeden Wert (und den bisherigen) zum Abhaken.
// Eingebunden in den Einstellungen ("Trainingswerte") und im Onboarding;
// dort kann man Garmin auch direkt verbinden.

const GARMIN_IMPORT_FIELDS = [
  ["weightKg", "Körpergewicht", v => `${String(v).replace(".", ",")} kg`],
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
  ["heightCm", "Größe", v => `${v} cm`],
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
    athleteProfile[k] = ["weightKg", "maxHr", "restingHr", "ftpWatts"].includes(k) ? Number(v) : v;
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

// Onboarding, erster Schritt: Garmin verbinden (Schlüssel) oder - wenn schon
// verbunden - gleich die Werte übernehmen.
function onbGarminBlockHtml() {
  return `<div class="onb-garmin">
      <div class="onb-garmin-text"><b>Mit Garmin schneller starten</b>
        <span>Gewicht, Pulswerte und Schwellen werden übernommen, und deine Trainings kommen von selbst ins Dashboard.</span></div>
      <div class="onb-garmin-form" data-onb-garmin-form hidden>
        <input type="password" class="coach-input" data-onb-garmin-key autocomplete="off" spellcheck="false" placeholder="Garmin-Schlüssel einfügen" aria-label="Garmin-Schlüssel">
        <button type="button" class="mob-btn mob-btn-primary" data-onb-garmin-connect>Verbinden</button>
        <a href="https://connect.garmin.com/app/settings/personalApiToken" target="_blank" rel="noopener">Schlüssel in Garmin Connect erstellen ↗</a>
      </div>
      <button type="button" class="mob-btn mob-btn-primary" data-garmin-import="onboarding" hidden>Werte aus Garmin übernehmen</button>
      <p class="coach-test-status" data-onb-garmin-status></p>
    </div>`;
}

async function initOnbGarmin(root) {
  const form = root.querySelector("[data-onb-garmin-form]");
  const connected = await refreshGarminImportButtons(root);
  if (!form) return;
  form.hidden = connected;
  const status = root.querySelector("[data-onb-garmin-status]");
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
      form.hidden = true;
      status.textContent = "Verbunden. Deine Trainings werden ab jetzt automatisch geholt.";
      status.className = "coach-test-status ok";
      await refreshGarminImportButtons(root);
      apiCall("garmin/sync", "POST").catch(() => { /* erster Abruf ist nur Komfort */ });
      openGarminImport("onboarding");
    } catch (e) {
      status.textContent = e.message;
      status.className = "coach-test-status err";
    } finally {
      btn.disabled = false;
    }
  });
}

function initGarminImport() {
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-garmin-import]");
    if (b) openGarminImport(b.dataset.garminImport, b);
  });
  refreshGarminImportButtons(document);
}
