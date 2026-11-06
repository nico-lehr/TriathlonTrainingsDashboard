// "KI-Coach"-Karte in den Einstellungen: Stand der Claude-Verbindung für alle,
// Schlüssel/Modell/Freigabe nur für den Betreiber (backend/claude_api.py).
// Der Schlüssel geht einmal an den Server und kommt nie zurück.

function initAiSettings() {
  const dot = document.getElementById("claude-status-dot");
  const text = document.getElementById("claude-status-text");
  const adminBox = document.getElementById("claude-admin");
  const keyInput = document.getElementById("claude-api-key");
  const modelSelect = document.getElementById("claude-model");
  const sharedInput = document.getElementById("claude-shared");
  const saveBtn = document.getElementById("claude-save-btn");
  const deleteBtn = document.getElementById("claude-delete-btn");
  const statusEl = document.getElementById("claude-test-status");
  if (!dot || !text || !adminBox || !keyInput || !modelSelect || !sharedInput || !saveBtn || !deleteBtn || !statusEl) return;
  forgetLegacyClaudeKey();

  function setStatus(msg, kind) {
    statusEl.textContent = msg || "";
    statusEl.className = "coach-test-status" + (kind ? " " + kind : "");
  }

  function modelLabel(st) {
    const m = (st.models || []).find(x => x.id === st.model);
    return m ? m.label.split(" – ")[0] : st.model;
  }

  function render(st) {
    dot.className = "ai-status-dot";
    if (!st) {
      text.textContent = "Der Dashboard-Server ist gerade nicht erreichbar.";
      dot.classList.add("off");
      adminBox.hidden = true;
      return;
    }
    if (st.available) {
      text.textContent = `Claude ist verbunden · ${modelLabel(st)}`;
      dot.classList.add("on");
    } else if (!st.sdk) {
      text.textContent = "Auf dem Server fehlt das Claude-Paket – bitte „pip install -r backend/requirements.txt“ ausführen.";
      dot.classList.add("warn");
    } else if (st.configured && !st.admin) {
      text.textContent = "Claude ist eingerichtet, aber nicht für dich freigegeben. Bis dahin antwortet die lokale KI.";
      dot.classList.add("off");
    } else if (st.admin) {
      text.textContent = "Noch nicht verbunden. Trag unten deinen Claude-Schlüssel ein.";
      dot.classList.add("off");
    } else {
      text.textContent = "Claude richtet der Betreiber des Dashboards ein. Bis dahin antwortet die lokale KI.";
      dot.classList.add("off");
    }
    adminBox.hidden = !st.admin;
    if (!st.admin) return;
    if (!modelSelect.options.length) {
      (st.models || []).forEach(m => modelSelect.add(new Option(m.label, m.id)));
    }
    modelSelect.value = st.model;
    sharedInput.checked = !!st.shared;
    keyInput.placeholder = st.configured ? "•••••••• (gespeichert – nur zum Ersetzen ausfüllen)" : "sk-ant-…";
    saveBtn.textContent = st.configured ? "Neuen Schlüssel prüfen & speichern" : "Schlüssel prüfen & speichern";
    deleteBtn.hidden = !st.configured;
    modelSelect.disabled = sharedInput.disabled = !st.configured;
  }

  async function put(body, busyText) {
    setStatus(busyText, "");
    try {
      const res = await apiCall("ai/claude", "PUT", body, { timeoutMs: 45000 });
      claudeStatus = res.data;
      render(res.data);
      return true;
    } catch (e) {
      setStatus(e.message, "err");
      return false;
    }
  }

  saveBtn.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key) { setStatus("Bitte zuerst den Schlüssel einfügen.", "warn"); keyInput.focus(); return; }
    saveBtn.disabled = true;
    const ok = await put({ key, model: modelSelect.value || null, shared: sharedInput.checked }, "Prüfe den Schlüssel bei Claude …");
    saveBtn.disabled = false;
    if (ok) { keyInput.value = ""; setStatus("Gespeichert. Claude ist ab jetzt auf allen Geräten verfügbar.", "ok"); }
  });
  keyInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); saveBtn.click(); } });
  modelSelect.addEventListener("change", async () => { if (await put({ model: modelSelect.value }, "Speichere …")) setStatus("Modell gespeichert.", "ok"); });
  sharedInput.addEventListener("change", async () => {
    if (await put({ shared: sharedInput.checked }, "Speichere …")) {
      setStatus(sharedInput.checked ? "Freigegeben – alle Personen im Dashboard nutzen jetzt Claude." : "Nur noch du nutzt Claude.", "ok");
    }
  });
  deleteBtn.addEventListener("click", async () => {
    if (!(await confirmDialog("Claude-Schlüssel vom Dashboard-Server entfernen? Danach antwortet wieder die lokale KI (Ollama), falls eingerichtet.", { okLabel: "Entfernen" }))) return;
    try {
      const res = await apiCall("ai/claude", "DELETE");
      claudeStatus = res.data;
      render(res.data);
      setStatus("Schlüssel entfernt.", "ok");
    } catch (e) {
      setStatus(e.message, "err");
    }
  });

  refreshClaudeStatus().then(render);
}
