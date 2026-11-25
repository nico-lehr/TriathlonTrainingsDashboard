// Garmin-Datencheck (Einstellungen -> Daten von Garmin): fragt über den
// Server jede Garmin-Datenquelle einmal ab (POST /api/v1/garmin/datacheck,
// tools/garmin_datacheck.py) und zeigt je Quelle, ob Daten ankommen.
// Nur lesen - im Dashboard ändert sich dadurch nichts.

const GARMIN_CHECK_MARK = {
  ok: ["✅", "geliefert"],
  empty: ["⚪", "leer"],
  blocked: ["⛔", "nicht freigegeben"],
  error: ["❌", "Fehler"],
  skipped: ["…", "nicht geprüft"],
};

// Ergebnis des Servers -> HTML (Zusammenfassung + Liste je Gruppe).
function garminCheckHtml(result) {
  const items = (result && result.items) || [];
  if (!items.length) return "";
  const c = result.counts || {};
  const sum = [["ok", "geliefert"], ["empty", "leer"], ["blocked", "nicht freigegeben"], ["error", "Fehler"], ["skipped", "nicht geprüft"]]
    .filter(([k]) => c[k]).map(([k, label]) => `${GARMIN_CHECK_MARK[k][0]} ${c[k]} ${label}`).join(" · ");
  const groups = [];
  items.forEach(it => {
    let g = groups.find(x => x.name === it.group);
    if (!g) groups.push(g = { name: it.group, items: [] });
    g.items.push(it);
  });
  const row = it => {
    const [mark, word] = GARMIN_CHECK_MARK[it.status] || ["?", it.status];
    return `<li class="gc-row gc-${escapeHtml(it.status)}"><span class="gc-mark" title="${escapeHtml(word)}" aria-label="${escapeHtml(word)}">${mark}</span>`
      + `<span class="gc-text"><span><b>${escapeHtml(it.label)}</b>${it.used === false ? ' <span class="gc-new">noch nicht genutzt</span>' : ""}</span>`
      + `<small>${escapeHtml(it.detail || "")}</small></span></li>`;
  };
  const hint = result.stopped
    ? `<p class="coach-test-status warn">Abgebrochen: ${escapeHtml(result.stopped)} Den Rest später nochmal prüfen.</p>` : "";
  return `<p class="gc-sum">${sum}</p>${hint}`
    + groups.map(g => `<h4 class="gc-group">${escapeHtml(g.name)}</h4><ul class="gc-list">${g.items.map(row).join("")}</ul>`).join("")
    + `<p class="card-sub">⚪ leer heißt: Garmin antwortet, hat dafür aber gerade nichts (z. B. Uhr nachts nicht getragen). ⛔ heißt: Garmin gibt diese Daten für deinen Schlüssel nicht heraus – das kann das Dashboard nicht ändern.</p>`;
}

function initGarminDatacheck() {
  const box = document.getElementById("garmin-check");
  const btn = document.getElementById("garmin-check-btn");
  const status = document.getElementById("garmin-check-status");
  const out = document.getElementById("garmin-check-result");
  if (!box || !btn || !status || !out) return;

  const setStatus = (text, kind) => {
    status.textContent = text || "";
    status.classList.remove("ok", "warn", "err");
    if (kind) status.classList.add(kind);
  };

  if (typeof onGarminState === "function") onGarminState(st => { box.hidden = !st.configured; });

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    out.innerHTML = "";
    setStatus("Frage Garmin ab … das dauert etwa eine halbe Minute.", "");
    try {
      const res = await apiCall("garmin/datacheck", "POST", {}, { timeoutMs: 180000 });
      out.innerHTML = garminCheckHtml(res.data);
      const when = new Date();
      setStatus(`Geprüft um ${when.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr.`, "ok");
    } catch (e) {
      setStatus(e.message, "err");
    } finally {
      btn.disabled = false;
    }
  });
}
