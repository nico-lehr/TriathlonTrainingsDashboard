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
  const keyRow = document.getElementById("claude-key-row");
  const keyActions = document.getElementById("claude-key-actions");
  const keyHint = document.getElementById("claude-key-hint");
  const manage = document.getElementById("claude-manage");
  const changeBtn = document.getElementById("claude-change-btn");
  const cancelBtn = document.getElementById("claude-cancel-btn");
  const taskBox = document.getElementById("claude-task-box");
  const taskList = document.getElementById("claude-task-models");
  let changing = false; // Schlüssel-Feld nur ohne Schlüssel oder nach "Schlüssel ändern"
  let last = null;
  if (!keyRow || !keyActions || !keyHint || !manage || !changeBtn || !cancelBtn) return;
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
    last = st;
    dot.className = "ai-status-dot";
    if (!st) {
      text.textContent = "Der Dashboard-Server ist gerade nicht erreichbar.";
      dot.classList.add("off");
      adminBox.hidden = true;
      return;
    }
    if (st.available) {
      const perTask = Object.keys(st.task_models || {}).length;
      text.textContent = `Claude ist verbunden · ${modelLabel(st)}${perTask ? ` · für ${perTask === 1 ? "eine Aufgabe" : perTask + " Aufgaben"} ein eigenes Modell` : ""}`;
      dot.classList.add("on");
    } else if (!st.sdk) {
      text.textContent = "Auf dem Server fehlt das Claude-Paket – bitte „pip install -r backend/requirements.txt“ ausführen.";
      dot.classList.add("warn");
    } else if (st.configured && !st.admin) {
      text.textContent = "Claude ist eingerichtet, aber nicht für dich freigegeben. Bis dahin antwortet die lokale KI.";
      dot.classList.add("off");
    } else if (st.admin) {
      text.textContent = "Noch nicht verbunden.";
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
    keyInput.placeholder = st.configured ? "Neuer Schlüssel" : "sk-ant-…";
    if (!st.configured) changing = false;
    const edit = !st.configured || changing;
    keyRow.hidden = keyActions.hidden = keyHint.hidden = !edit;
    manage.hidden = edit;
    cancelBtn.hidden = !st.configured;
    modelSelect.disabled = sharedInput.disabled = !st.configured;
    renderTaskModels(st);
  }

  // Modell je Aufgabe (Plan, Analysen, ...): "Wie Standard" oder ein eigenes.
  function renderTaskModels(st) {
    if (!taskBox || !taskList) return;
    const groups = st.task_groups || [];
    taskBox.hidden = !st.configured || !groups.length;
    if (taskBox.hidden) return;
    const short = id => { const m = (st.models || []).find(x => x.id === id); return m ? m.label.split(" – ")[0].replace(/^Claude /, "") : id; };
    const std = short(st.model);
    const own = st.task_models || {};
    taskList.innerHTML = groups.map(g => `
      <div class="settings-list-row claude-task-row">
        <label for="claude-task-${g.id}"><span>${escapeHtml(g.label)}</span><small>${escapeHtml(g.hint)}</small></label>
        <select id="claude-task-${g.id}" class="coach-input" data-task-group="${g.id}">
          <option value="">Wie Standard (${escapeHtml(std)})</option>
          ${(st.models || []).map(m => `<option value="${m.id}"${own[g.id] === m.id ? " selected" : ""}>${escapeHtml(short(m.id))}</option>`).join("")}
        </select>
      </div>`).join("");
    taskList.querySelectorAll("select[data-task-group]").forEach(sel => sel.addEventListener("change", async () => {
      const g = groups.find(x => x.id === sel.dataset.taskGroup);
      if (await put({ task_models: { [sel.dataset.taskGroup]: sel.value } }, "Speichere …")) {
        setStatus(`${g ? g.label : "Aufgabe"}: ${sel.value ? "eigenes Modell gespeichert" : "wieder wie Standard"}.`, "ok");
      }
    }));
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
    if (ok) { keyInput.value = ""; changing = false; render(last); setStatus("Gespeichert.", "ok"); }
  });
  keyInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); saveBtn.click(); } });
  changeBtn.addEventListener("click", () => { changing = true; setStatus(""); render(last); keyInput.focus(); });
  cancelBtn.addEventListener("click", () => { changing = false; keyInput.value = ""; setStatus(""); render(last); });
  modelSelect.addEventListener("change", async () => { if (await put({ model: modelSelect.value }, "Speichere …")) setStatus("Modell gespeichert.", "ok"); });
  sharedInput.addEventListener("change", async () => {
    if (await put({ shared: sharedInput.checked }, "Speichere …")) {
      setStatus(sharedInput.checked ? "Für alle freigegeben." : "Nur noch für dich.", "ok");
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
