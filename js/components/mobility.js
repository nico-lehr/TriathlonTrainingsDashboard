// Tab "Mobility": die Einheit für heute (aus festen Regeln sofort, auf
// Wunsch von Claude persönlich angepasst), Ablauf, alle Übungen mit
// Zeichnung und Anleitung, Verlauf. Abspielen: js/components/mobility-player.js.

const MOB_DURATIONS = [10, 15, 20, 30];
const mobUi = { minutes: null, focus: [], filter: "all", busy: false };

const mobDateLabel = d => new Date(d + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });

function mobExerciseMeta(ex, seconds) {
  const s = seconds || ex.seconds;
  const amount = ex.kind === "reps" ? `${mobilityRepsFor(ex, s)}×` : `${s} s`;
  return amount + (ex.sides ? " je Seite" : "");
}

// Heute geplante Mobility-Einheit (Kalender) mit Übungen aus der Sammlung.
function mobPlannedToday() {
  const today = todayStr();
  const pw = (typeof plannedWorkouts !== "undefined" ? plannedWorkouts : [])
    .find(p => p.date === today && p.sport === "Mobility" && p.status === "geplant" && (p.exercises || []).some(x => x && MOBILITY_BY_ID[x.id]));
  return pw ? plannedToMobilitySession(pw) : null;
}

function mobRulesSession() {
  const tp = trainingProfile();
  const today = todayStr();
  const last = mobilityState.history[mobilityState.history.length - 1];
  return buildMobilitySession({
    minutes: mobUi.minutes || tp.mobilityMinutes,
    focus: mobUi.focus,
    tp,
    painfulIds: mobilityPainfulIds(today),
    recent: recentMobilitySports(typeof ALL !== "undefined" ? ALL : [], today),
    lastIds: last ? last.exercises || [] : [],
    trend: mobilityDifficultyTrend(),
    today,
  });
}

// Welche Einheit zeigt der Tab gerade? Gespeicherte (heute erstellte) zuerst,
// dann eine für heute eingeplante, sonst ein frischer Vorschlag.
function mobActiveSession() {
  const cur = mobilityState.current;
  if (cur && cur.createdAt && cur.createdAt.slice(0, 10) === todayStr()) return { session: cur, kind: cur.source === "claude" ? "claude" : "saved" };
  const planned = mobPlannedToday();
  if (planned) return { session: planned, kind: "planned" };
  const rules = mobRulesSession();
  return rules ? { session: rules, kind: "rules" } : { session: null, kind: "none" };
}

function renderMobilityView() {
  const view = document.getElementById("view-mobility");
  if (!view) return;
  const tp = trainingProfile();
  if (mobUi.minutes == null) mobUi.minutes = tp.mobilityMinutes;
  const { session, kind } = mobActiveSession();

  // Kopf
  const eyebrow = { claude: "Vom KI-Coach für dich", planned: "Heute eingeplant", saved: "Für dich heute", rules: "Für dich heute", none: "Mobility" }[kind];
  document.getElementById("mob-eyebrow").textContent = eyebrow;
  document.getElementById("mob-title").textContent = session ? session.title : "Keine passende Übung";
  document.getElementById("mob-intro").textContent = session ? session.intro || "" : "Mit deinen aktuellen Einstellungen im Trainingsprofil passt gerade keine Übung. Prüfe Hilfsmittel und Ausschlüsse.";
  const count = session ? session.exercises.filter(x => MOBILITY_BY_ID[x.id]).length : 0;
  document.getElementById("mob-meta").textContent = session ? `${Math.max(1, Math.round(mobilitySessionSeconds(session) / 60))} Min · ${count} Übungen` : "";
  document.getElementById("mob-start-btn").disabled = !session;
  const claudeBtn = document.getElementById("mob-claude-btn");
  claudeBtn.hidden = !claudeAvailable();
  claudeBtn.textContent = kind === "claude" ? "Neu mit dem KI-Coach erstellen" : "Mit dem KI-Coach persönlich anpassen";
  const heroFig = document.getElementById("mob-hero-fig");
  const firstEx = session && MOBILITY_BY_ID[(session.exercises[0] || {}).id];
  const heroKey = firstEx ? firstEx.id : "";
  if (heroFig.dataset.ex !== heroKey) {
    heroFig.dataset.ex = heroKey;
    heroFig.replaceChildren(...(firstEx ? [createMobilityFigure(firstEx, { animate: true, label: false })] : []));
  }

  // Dauer + Schwerpunkt
  document.querySelectorAll("#mob-duration button").forEach(b => {
    const on = Number(b.dataset.value) === mobUi.minutes;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", String(on));
  });
  document.querySelectorAll("#mob-focus .mob-chip").forEach(c => {
    const on = c.dataset.id === "auto" ? !mobUi.focus.length : mobUi.focus.includes(c.dataset.id);
    c.classList.toggle("is-on", on);
    c.setAttribute("aria-pressed", String(on));
  });
  const parts = [];
  if (tp.focusAreas.length) parts.push(tp.focusAreas.map(a => MOBILITY_AREAS[a]).join(", "));
  parts.push(tp.equipment.length ? tp.equipment.map(e => MOBILITY_EQUIPMENT[e].split(" ")[0]).join(", ") : "ohne Hilfsmittel");
  if (tp.painAreas.length) parts.push(`sanft: ${tp.painAreas.map(a => MOBILITY_AREAS[a]).join(", ")}`);
  document.getElementById("mob-profile-summary").textContent = parts.join(" · ");

  // Ablauf
  const list = document.getElementById("mob-session-list");
  list.replaceChildren();
  (session ? session.exercises : []).forEach((x, i) => {
    const ex = MOBILITY_BY_ID[x.id];
    if (!ex) return;
    const li = document.createElement("li");
    li.className = "mob-item";
    li.innerHTML = `
      <button type="button" class="mob-item-main" aria-label="${escapeHtml(ex.name)} – Anleitung öffnen">
        <span class="mob-item-fig"></span>
        <span class="mob-item-text">
          <span class="mob-item-name">${escapeHtml(ex.name)}</span>
          <span class="mob-item-meta">${escapeHtml(mobExerciseMeta(ex, x.seconds))} · ${escapeHtml(MOBILITY_AREAS[ex.areas[0]])}</span>
          ${x.note ? `<span class="mob-item-note">${escapeHtml(x.note)}</span>` : ""}
        </span>
        <span class="mob-chevron" aria-hidden="true">›</span>
      </button>
      ${kind !== "planned" ? `<button type="button" class="mob-swap" data-idx="${i}" aria-label="${escapeHtml(ex.name)} austauschen" title="Austauschen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg></button>` : ""}`;
    li.querySelector(".mob-item-fig").appendChild(createMobilityFigure(ex, { animate: false, label: false }));
    li.querySelector(".mob-item-main").addEventListener("click", () => openMobilityDetail(ex.id));
    const swap = li.querySelector(".mob-swap");
    if (swap) swap.addEventListener("click", () => mobSwapExercise(session, i));
    list.appendChild(li);
  });

  // Kalender-Datum: Standard heute
  const dateInput = document.getElementById("mob-plan-date");
  if (!dateInput.value || dateInput.value < todayStr()) dateInput.value = todayStr();
  dateInput.min = todayStr();
  document.getElementById("mob-plan-btn").disabled = !session || kind === "planned";

  renderMobilityLibrary();
  renderMobilityHistory();
}

function mobSwapExercise(session, i) {
  const tp = trainingProfile();
  const allowed = allowedMobilityExercises(tp, mobilityPainfulIds(todayStr()));
  const current = MOBILITY_BY_ID[session.exercises[i].id];
  const used = new Set(session.exercises.map(x => x.id));
  const pool = allowed.filter(ex => !used.has(ex.id));
  const same = pool.filter(ex => ex.areas.some(a => current.areas.includes(a)));
  const pickFrom = same.length ? same : pool;
  if (!pickFrom.length) { mobStatus("Keine weitere passende Übung gefunden.", "warn"); return; }
  // Reihum durch die Alternativen, damit mehrfaches Tippen weiterblättert.
  const choice = pickFrom[(session.swaps = (session.swaps || 0) + 1) % pickFrom.length];
  const next = { ...session, exercises: session.exercises.map((x, j) => (j === i ? { id: choice.id, seconds: choice.seconds, note: null } : x)), createdAt: session.createdAt || new Date().toISOString() };
  if (next.source !== "claude") next.source = "saved";
  setCurrentMobilitySession(next);
  renderMobilityView();
  mobStatus(`${current.name} → ${choice.name}`, "");
}

function renderMobilityLibrary() {
  const grid = document.getElementById("mob-library");
  const tp = trainingProfile();
  const allowed = new Set(allowedMobilityExercises(tp, mobilityPainfulIds(todayStr())).map(e => e.id));
  const list = MOBILITY_EXERCISES.filter(ex => mobUi.filter === "all" || ex.areas.includes(mobUi.filter));
  document.getElementById("mob-library-count").textContent = `${list.length} Übungen`;
  document.querySelectorAll("#mob-library-filter .mob-chip").forEach(c => {
    const on = c.dataset.id === mobUi.filter;
    c.classList.toggle("is-on", on);
    c.setAttribute("aria-pressed", String(on));
  });
  if (grid.dataset.key === mobUi.filter + "|" + [...allowed].join(",")) return; // unverändert - Figuren nicht neu bauen
  grid.dataset.key = mobUi.filter + "|" + [...allowed].join(",");
  grid.replaceChildren();
  list.forEach(ex => {
    const fits = allowed.has(ex.id);
    const missing = ex.equipment.filter(eq => !tp.equipment.includes(eq)).map(eq => MOBILITY_EQUIPMENT[eq].split(" ")[0]);
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "mob-tile" + (fits ? "" : " is-muted");
    tile.innerHTML = `
      <span class="mob-tile-fig"></span>
      <span class="mob-tile-name">${escapeHtml(ex.name)}</span>
      <span class="mob-tile-meta">${escapeHtml(ex.areas.map(a => MOBILITY_AREAS[a]).slice(0, 2).join(" · "))}</span>
      ${fits ? "" : `<span class="mob-tile-badge">${missing.length ? "Braucht " + escapeHtml(missing.join(", ")) : "Passt nicht zu deinem Profil"}</span>`}`;
    tile.querySelector(".mob-tile-fig").appendChild(createMobilityFigure(ex, { animate: true, label: false }));
    tile.addEventListener("click", () => openMobilityDetail(ex.id));
    grid.appendChild(tile);
  });
}

function renderMobilityHistory() {
  const card = document.getElementById("mob-history-card");
  const ul = document.getElementById("mob-history");
  const items = mobilityState.history.slice(-5).reverse();
  card.hidden = !items.length;
  const words = { easy: "Zu leicht", ok: "Genau richtig", hard: "Zu schwer" };
  ul.innerHTML = items.map(h => `
    <li class="mob-history-item">
      <span class="mob-history-date">${escapeHtml(mobDateLabel(h.date))}</span>
      <span class="mob-history-title">${escapeHtml(h.title || "Mobility")}</span>
      <span class="mob-history-meta">${h.minutes || "?"} Min · ${escapeHtml(words[h.rating] || "")}${h.pain && h.pain.length ? " · tat weh: " + escapeHtml(h.pain.map(id => (MOBILITY_BY_ID[id] || {}).name).filter(Boolean).join(", ")) : ""}</span>
    </li>`).join("");
}

function mobStatus(text, kind) {
  const el = document.getElementById("mob-status");
  if (!el) return;
  el.textContent = text || "";
  el.className = "mob-status" + (kind ? " " + kind : "");
}

/* ------------------------------------------------------------ Detail */

function openMobilityDetail(id) {
  const ex = MOBILITY_BY_ID[id];
  if (!ex) return;
  const lastFocus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "mob-sheet-overlay";
  overlay.innerHTML = `
    <div class="mob-sheet" role="dialog" aria-modal="true" aria-labelledby="mob-sheet-title">
      <div class="mob-sheet-grabber" aria-hidden="true"></div>
      <button type="button" class="mob-icon-btn mob-sheet-close" aria-label="Schließen">${MOB_ICONS.close}</button>
      <div class="mob-sheet-fig"></div>
      <h2 class="mob-sheet-title" id="mob-sheet-title">${escapeHtml(ex.name)}</h2>
      <p class="mob-sheet-meta">${escapeHtml(mobExerciseMeta(ex))} · ${escapeHtml(MOBILITY_LEVELS[ex.level])}${ex.equipment.length ? " · " + escapeHtml(ex.equipment.map(e => MOBILITY_EQUIPMENT[e]).join(", ")) : ""}</p>
      <div class="mob-chips mob-sheet-areas">${ex.areas.map(a => `<span class="mob-chip is-static">${escapeHtml(MOBILITY_AREAS[a])}</span>`).join("")}</div>
      <h3>So geht's</h3>
      <ol class="mob-steps">${ex.steps.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
      <h3>Das spürst du</h3>
      <p>${escapeHtml(ex.feel)}</p>
      <h3>Achte darauf</h3>
      <ul class="mob-mistakes">${ex.mistakes.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
      <div class="mob-variants">
        <div class="mob-variant"><span class="mob-variant-label">Leichter</span><p>${escapeHtml(ex.easier)}</p></div>
        <div class="mob-variant"><span class="mob-variant-label">Schwerer</span><p>${escapeHtml(ex.harder)}</p></div>
      </div>
      <div class="mob-sheet-actions">
        <button type="button" class="mob-btn mob-btn-primary" data-act="try">Jetzt ausprobieren</button>
        <a class="mob-btn mob-btn-secondary" href="${mobilityVideoUrl(ex)}" target="_blank" rel="noopener">Video ansehen ↗</a>
      </div>
    </div>`;
  overlay.querySelector(".mob-sheet-fig").appendChild(createMobilityFigure(ex, { animate: true }));
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-open"));
  const close = () => {
    overlay.classList.remove("is-open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => overlay.remove(), 250);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };
  const onKey = e => { if (e.key === "Escape" && !document.querySelector(".mob-player")) close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  overlay.querySelector(".mob-sheet-close").addEventListener("click", close);
  overlay.querySelector('[data-act="try"]').addEventListener("click", () => {
    close();
    openMobilityPlayer({ title: ex.name, intro: "", source: "single", exercises: [{ id: ex.id, seconds: ex.seconds, note: null }] }, { onFinish: mobOnFinish });
  });
  overlay.querySelector(".mob-sheet-close").focus();
}

/* ---------------------------------------------------- Starten/Planen */

function mobOnFinish(result, session) {
  addMobilityHistory(result);
  if (session && session.plannedId && typeof updatePlannedWorkout === "function") {
    updatePlannedWorkout(session.plannedId, { status: "erledigt" });
    if (typeof renderCalendar === "function") renderCalendar();
    if (typeof renderTrainingPlanCard === "function") renderTrainingPlanCard();
  }
  if (session && mobilityState.current && session.createdAt === mobilityState.current.createdAt) setCurrentMobilitySession(null);
  renderMobilityView();
  mobStatus(result.pain.length ? "Gespeichert. Was weh getan hat, lasse ich die nächsten 3 Wochen weg." : "Gespeichert – die nächste Einheit passt sich an.", "ok");
}

function startMobilitySession(session) {
  openMobilityPlayer(session, { onFinish: res => mobOnFinish(res, session) });
}

async function mobGenerateWithClaude() {
  if (mobUi.busy) return;
  const tp = trainingProfile();
  const allowed = allowedMobilityExercises(tp, mobilityPainfulIds(todayStr()));
  if (allowed.length < 2) { mobStatus("Mit deinem Profil passen zu wenige Übungen – bitte Hilfsmittel/Ausschlüsse prüfen.", "warn"); return; }
  const btn = document.getElementById("mob-claude-btn");
  mobUi.busy = true;
  btn.disabled = true;
  btn.classList.add("is-busy");
  mobStatus("Der KI-Coach stellt deine Einheit zusammen …", "");
  try {
    const minutes = mobUi.minutes || tp.mobilityMinutes;
    const contextLines = [...trainingProfileContextLines()];
    if (athleteProfile.limitations) contextLines.push(`Verletzungen/Einschränkungen: ${athleteProfile.limitations}`);
    const prompt = buildMobilityPrompt({
      minutes, focus: mobUi.focus, allowed, contextLines,
      recent: recentMobilitySports(typeof ALL !== "undefined" ? ALL : [], todayStr()),
      history: mobilityState.history,
    });
    const ids = allowed.map(e => e.id);
    const text = await callAiText(prompt, { task: "mobility", json: true, schema: mobilityResponseSchema(ids) });
    const session = parseMobilityResponse(text, ids, minutes);
    setCurrentMobilitySession(session);
    renderMobilityView();
    mobStatus("", "");
  } catch (e) {
    mobStatus(describeAiError(e), "err");
  } finally {
    mobUi.busy = false;
    btn.disabled = false;
    btn.classList.remove("is-busy");
  }
}

function mobPlanIntoCalendar() {
  const { session } = mobActiveSession();
  if (!session) return;
  const date = document.getElementById("mob-plan-date").value || todayStr();
  addPlannedWorkout(mobilitySessionToPlanned(session, date));
  if (typeof renderCalendar === "function") renderCalendar();
  if (typeof renderTrainingPlanCard === "function") renderTrainingPlanCard();
  mobStatus(`Im Kalender eingetragen (${mobDateLabel(date)}) – dort kannst du sie auch starten.`, "ok");
}

// Aus dem Kalender/Plan: geplante Mobility-Einheit direkt mitmachen.
function startPlannedMobility(pw) {
  const session = plannedToMobilitySession(pw);
  if (session) startMobilitySession(session);
}

function initMobility() {
  if (!document.getElementById("view-mobility")) return;
  loadMobilityState();
  const tp = trainingProfile();
  mobUi.minutes = tp.mobilityMinutes;

  const dur = document.getElementById("mob-duration");
  dur.innerHTML = MOB_DURATIONS.map(m => `<button type="button" role="radio" aria-checked="false" data-value="${m}">${m} Min</button>`).join("");
  dur.addEventListener("click", e => {
    const b = e.target.closest("button[data-value]");
    if (!b) return;
    mobUi.minutes = Number(b.dataset.value);
    setCurrentMobilitySession(null);
    mobStatus("", "");
    renderMobilityView();
  });

  const focus = document.getElementById("mob-focus");
  focus.innerHTML = `<button type="button" class="mob-chip" data-id="auto" aria-pressed="true">Automatisch</button>` +
    Object.entries(MOBILITY_AREAS).map(([id, label]) => `<button type="button" class="mob-chip" data-id="${id}" aria-pressed="false">${escapeHtml(label)}</button>`).join("");
  focus.addEventListener("click", e => {
    const c = e.target.closest(".mob-chip");
    if (!c) return;
    if (c.dataset.id === "auto") mobUi.focus = [];
    else mobUi.focus = mobUi.focus.includes(c.dataset.id) ? mobUi.focus.filter(a => a !== c.dataset.id) : [...mobUi.focus, c.dataset.id];
    setCurrentMobilitySession(null);
    mobStatus("", "");
    renderMobilityView();
  });

  const filter = document.getElementById("mob-library-filter");
  filter.innerHTML = `<button type="button" class="mob-chip" data-id="all">Alle</button>` +
    Object.entries(MOBILITY_AREAS).map(([id, label]) => `<button type="button" class="mob-chip" data-id="${id}">${escapeHtml(label)}</button>`).join("");
  filter.addEventListener("click", e => {
    const c = e.target.closest(".mob-chip");
    if (!c) return;
    mobUi.filter = c.dataset.id;
    renderMobilityLibrary();
  });

  document.getElementById("mob-start-btn").addEventListener("click", () => {
    const { session } = mobActiveSession();
    if (session) startMobilitySession(session);
  });
  document.getElementById("mob-claude-btn").addEventListener("click", mobGenerateWithClaude);
  document.getElementById("mob-plan-btn").addEventListener("click", mobPlanIntoCalendar);
  document.getElementById("mob-profile-link").addEventListener("click", openTrainingProfile);

  renderMobilityView();
  // Ob Claude verfügbar ist, weiß der Server - danach den Knopf ein-/ausblenden.
  ensureClaudeStatus().then(() => renderMobilityView());
}
