// Neue .fit-Dateien einlesen: Ordner-Scan-Update-Menue und Drag&Drop-Dateiauswahl,
// beide ueber processFitFiles/handleDndFiles.

const fileInput = document.getElementById("file-input");

const fileInputSingle = document.getElementById("file-input-single");

const updateBtn = document.getElementById("update-menu-trigger");

const updateStatusEl = document.getElementById("update-status");

const resetBtn = document.getElementById("reset-btn");

// Gemeinsame Verarbeitungs-Pipeline für neu eingelesene .fit-Dateien, egal
// ob sie über den Ordner-Scan oder per Drag & Drop / Dateiauswahl kommen:
// filtert auf .fit-Dateien im Scan-Zeitfenster, parst sie im Browser, führt
// sie mit dem bestehenden Datenbestand zusammen (nach Dateiname, nichts wird
// ersetzt) und speichert/rendert das Ergebnis neu.

async function processFitFiles(files, onProgress) {
  const notify = onProgress || showUpdateStatus;

  const cutoff = new Date(Date.now() - SCAN_WINDOW_DAYS * 86400000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const candidates = files.filter(f => {
    const name = f.name;
    if (!/\.fit$/i.test(name)) return false;
    const datePart = name.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return true; // Datum unbekannt -> sicherheitshalber lesen
    return datePart >= cutoffStr;
  });

  if (!candidates.length) {
    const msg = `Keine .fit-Dateien der letzten ${SCAN_WINDOW_DAYS} Tage gefunden.`;
    notify(msg, true);
    return { ok: false, isErr: true, message: msg };
  }

  notify(`Lese ${candidates.length} Dateien ein … 0 / ${candidates.length}`, false);

  const newWorkouts = [];
  let errors = 0;
  for (let i = 0; i < candidates.length; i++) {
    const f = candidates[i];
    try {
      const buf = await f.arrayBuffer();
      const parsed = parseFitArrayBuffer(buf);
      const w = buildWorkoutFromParsed(f.name, parsed);
      if (w) newWorkouts.push(w);
    } catch (e) {
      errors++;
    }
    if (i % 5 === 0 || i === candidates.length - 1) {
      notify(`Lese Dateien ein … ${i + 1} / ${candidates.length}`, false);
      await new Promise(r => setTimeout(r, 0)); // UI aktuell halten
    }
  }

  if (!newWorkouts.length) {
    const msg = "Es konnten keine Workouts aus den gewählten Dateien gelesen werden.";
    notify(msg, true);
    return { ok: false, isErr: true, message: msg };
  }

  // WICHTIG: neu eingelesene Workouts mit dem bestehenden Datenbestand
  // zusammenführen (nach Dateiname), statt ihn zu ersetzen. Sonst würden
  // ältere Trainings verschwinden, sobald der Scan sie diesmal nicht erneut
  // liefert (z.B. weil nur ein Teilordner, eine einzelne neue Datei oder ein
  // Drag & Drop mit wenigen Dateien verwendet wurde, oder weil sie außerhalb
  // von SCAN_WINDOW_DAYS liegen).
  const merged = new Map(RAW.workouts.map(w => [w.file, w]));
  let addedCount = 0, refreshedCount = 0;
  const addedFiles = [];
  newWorkouts.forEach(w => {
    if (merged.has(w.file)) refreshedCount++; else { addedCount++; addedFiles.push(w.file); }
    merged.set(w.file, w);
  });
  justAddedFiles = new Set(addedFiles);
  setTimeout(() => { justAddedFiles = new Set(); }, 4000); // Hervorhebung nur kurz nach dem Update aktiv
  const allWorkouts = [...merged.values()];
  // Multisport-/Wechsel-Erkennung über den GESAMTEN (zusammengeführten)
  // Bestand neu laufen lassen, nicht nur über die neuen Dateien - sonst
  // würde z.B. eine bereits gespeicherte Triathlon-Session nicht mehr richtig
  // erkannt, wenn heute nur eine ihrer Teildisziplinen neu eingelesen wird.
  postProcessWorkouts(allWorkouts);
  allWorkouts.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  RAW = {
    generated_at: new Date().toISOString(),
    source_folder: "Browser-Scan",
    count: allWorkouts.length,
    skipped: [],
    workouts: allWorkouts,
  };

  // Gespeichert wird in IndexedDB statt localStorage (js/data/idb-store.js,
  // idbSaveRaw) - localStorage war pro Seite hart auf ca. 5-10MB gedeckelt
  // und ist bei Nicos 1000+ Workouts (auch mit dem 200-Punkte-Downsampling
  // der Kurven, buildStream() in fit-parser.js) übergelaufen. Ein Fehler
  // hier (z.B. wenn wirklich der gesamte Plattenplatz voll ist) wird
  // sichtbar in der Update-Meldung gemeldet statt lautlos verschluckt zu
  // werden - sonst wären neu eingelesene Workouts nur bis zum nächsten
  // Neuladen sichtbar gewesen, ohne dass Nico das gemerkt hätte.
  let persistError = null;
  try {
    const result = await idbSaveRawFiltered(RAW, 185); // 185 = dein max HR (anpassen!)

    let message = `✓ Gespeichert: ${RAW.count} Workouts (letzte 2 Jahre)`;
    if (result.removed > 0) {
      message += `\n⚠️  ${result.removed} Workouts gelöscht (älter als 2 Jahre)`;
    }
    message += `\n✨ Training Effects berechnet`;

    console.log(message);

    const statusEl = document.getElementById('import-status');
    if (statusEl) {
      statusEl.innerHTML = message.replace(/\n/g, '<br>');
      statusEl.style.color = result.removed > 0 ? '#ff9800' : '#4caf50';
    }
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      persistError = "Browser-Speicher voll! Zu viele Workouts.";
    } else {
      persistError = `Konnte nicht dauerhaft gespeichert werden (${(e && e.message) || e}) - die Workouts unten sind nur für diese Sitzung sichtbar.`;
    }
  }

  recomputeDerived();
  renderAll();

  const parts = [];
  if (addedCount) parts.push(`${addedCount} neu hinzugefügt`);
  if (refreshedCount) parts.push(`${refreshedCount} aktualisiert`);
  const summary = parts.length ? parts.join(", ") : "keine Änderungen";
  const msg = `${summary} · ${allWorkouts.length} Workouts insgesamt`
    + (errors ? ` (${errors} Dateien übersprungen)` : "")
    + (persistError ? ` — ⚠️ ${persistError}` : "");
  notify(msg, !!persistError);
  return { ok: true, isErr: !!persistError, message: msg, addedCount, refreshedCount, total: allWorkouts.length, errors, persistError };
}

// Setzt den im Browser gespeicherten Update-Stand zurück auf den zuletzt von
// Claude gebauten, vollständigen Datenstand - als Ausweg, falls im
// gespeicherten Stand mal etwas durcheinandergerät.
resetBtn.addEventListener("click", async () => {
  try { await idbClearRaw(); } catch (e) { /* ignorieren */ }
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* falls noch ein alter Stand von vor der IndexedDB-Umstellung da ist */ }
  RAW = (typeof EMBEDDED_DATA !== "undefined") ? EMBEDDED_DATA : EMPTY_EMBEDDED_DATA;
  justAddedFiles = new Set();
  recomputeDerived();
  renderAll();
  showUpdateStatus(`Zurückgesetzt auf den gespeicherten Stand (${RAW.count} Workouts).`, false);
  setTimeout(() => { updateStatusEl.style.display = "none"; }, 6000);
});

// --- Aktualisieren-Dropdown-Menü -----------------------------------------

const updateMenu = document.getElementById("update-menu");

const updateMenuWrap = document.getElementById("update-menu-wrap");


function openUpdateMenu() {
  updateMenu.classList.add("open");
  updateBtn.setAttribute("aria-expanded", "true");
}

function closeUpdateMenu() {
  updateMenu.classList.remove("open");
  updateBtn.setAttribute("aria-expanded", "false");
}
updateBtn.addEventListener("click", () => {
  updateMenu.classList.contains("open") ? closeUpdateMenu() : openUpdateMenu();
});
document.addEventListener("click", e => {
  if (!updateMenuWrap.contains(e.target)) closeUpdateMenu();
});
document.getElementById("menu-item-folder").addEventListener("click", () => {
  closeUpdateMenu();
  fileInput.click();
});
document.getElementById("menu-item-dnd").addEventListener("click", () => {
  closeUpdateMenu();
  openDndOverlay();
});

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  fileInput.value = "";
  if (!files.length) return;
  updateBtn.disabled = true;
  updateBtn.classList.add("loading");
  try {
    const result = await processFitFiles(files);
    if (result.ok) {
      updateBtn.classList.remove("success");
      void updateBtn.offsetWidth;
      updateBtn.classList.add("success");
    }
  } catch (e) {
    // Sollte processFitFiles selbst einen unerwarteten Fehler werfen, darf
    // die Bedienung trotzdem nicht dauerhaft blockiert bleiben (siehe finally).
    showUpdateStatus("Unerwarteter Fehler beim Einlesen. Bitte Seite neu laden und erneut versuchen.", true);
  } finally {
    updateBtn.disabled = false;
    updateBtn.classList.remove("loading");
    setTimeout(() => { updateStatusEl.style.display = "none"; }, 6000);
  }
});

function showUpdateStatus(msg, isErr) {
  updateStatusEl.style.display = "block";
  updateStatusEl.textContent = msg;
  updateStatusEl.classList.toggle("err", !!isErr);
}

// --- Drag & Drop Upload-Overlay ------------------------------------------

const dndOverlay = document.getElementById("dnd-overlay");

const dndZone = document.getElementById("dnd-zone");

const dndFilelist = document.getElementById("dnd-filelist");

const dndStatusEl = document.getElementById("dnd-status");

let dndBusy = false;


function openDndOverlay() {
  dndStatusEl.textContent = "";
  dndStatusEl.classList.remove("err");
  dndFilelist.innerHTML = "";
  dndOverlay.classList.add("open");
}

function closeDndOverlay() {
  if (dndBusy) return;
  dndOverlay.classList.remove("open");
}

function showDndStatus(msg, isErr) {
  dndStatusEl.textContent = msg;
  dndStatusEl.classList.toggle("err", !!isErr);
}


async function handleDndFiles(fileListLike) {
  const files = Array.from(fileListLike || []).filter(f => /\.fit$/i.test(f.name));
  if (!files.length) {
    showDndStatus("Bitte .fit-Dateien auswählen bzw. ablegen.", true);
    return;
  }
  dndFilelist.innerHTML = files.map(f => `<div class="dnd-file-row"><span>${escapeHtml(f.name)}</span></div>`).join("");
  dndBusy = true;
  dndZone.style.pointerEvents = "none";
  try {
    const result = await processFitFiles(files, showDndStatus);
    if (result.ok) {
      setTimeout(() => { if (!dndBusy) closeDndOverlay(); }, 1600);
    }
  } catch (e) {
    // Nie den Dialog dauerhaft blockieren, auch wenn processFitFiles selbst
    // einen unerwarteten Fehler wirft - siehe finally unten.
    showDndStatus("Unerwarteter Fehler beim Einlesen. Bitte Seite neu laden und erneut versuchen.", true);
  } finally {
    dndBusy = false;
    dndZone.style.pointerEvents = "";
  }
}

document.getElementById("dnd-close").addEventListener("click", closeDndOverlay);
dndOverlay.addEventListener("click", e => {
  if (e.target.id === "dnd-overlay") closeDndOverlay();
});
dndZone.addEventListener("click", () => fileInputSingle.click());
fileInputSingle.addEventListener("change", () => {
  const files = Array.from(fileInputSingle.files || []);
  fileInputSingle.value = "";
  if (files.length) handleDndFiles(files);
});
["dragenter", "dragover"].forEach(evt => {
  dndZone.addEventListener(evt, e => {
    e.preventDefault();
    e.stopPropagation();
    dndZone.classList.add("drag-over");
  });
});
["dragleave", "dragend"].forEach(evt => {
  dndZone.addEventListener(evt, e => {
    e.preventDefault();
    e.stopPropagation();
    dndZone.classList.remove("drag-over");
  });
});
dndZone.addEventListener("drop", e => {
  e.preventDefault();
  e.stopPropagation();
  dndZone.classList.remove("drag-over");
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) handleDndFiles(files);
});
// Verhindert, dass ein versehentlich außerhalb der Dropzone abgelegtes File
// die Seite im Browser-Tab öffnet/ersetzt.
["dragover", "drop"].forEach(evt => {
  document.addEventListener(evt, e => { e.preventDefault(); });
});
