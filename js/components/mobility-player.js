// Mitmach-Modus: eine Mobility-Einheit Schritt für Schritt im Vollbild -
// große Zeichnung, Timer, "Seite wechseln", Vorschau auf die nächste Übung.
// Am Ende kurze Rückmeldung (zu leicht / passt / zu schwer, tat etwas weh?),
// die in die nächste Planung einfließt (js/data/training-profile.js).
//
// Gedacht fürs Handy neben der Matte: Bildschirm bleibt an (Wake Lock),
// leise Töne kurz vor jedem Wechsel, optional Sprachansage.

const MOB_SOUND_KEY = "triathlon_dashboard_mobility_sound_v1";
const MOB_PREP_S = 10; // = MOBILITY_TRANSITION_S, damit die angezeigte Dauer stimmt
const MOB_SWITCH_S = 5; // Seitenwechsel, wie in mobilityExerciseSeconds

const MOB_ICONS = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M6 5h2v14H6zM19 5.5v13L9.5 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M16 5h2v14h-2zM5 5.5v13L14.5 12z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.6"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>',
};

function mobSoundOn() {
  try { return localStorage.getItem(MOB_SOUND_KEY) !== "off"; } catch (e) { return true; }
}

// Übung zur id: Mobility- oder Kraft-Sammlung (session.kind === "strength").
function playerLibrary(session) {
  return session.kind === "strength" && typeof STRENGTH_BY_ID !== "undefined" ? STRENGTH_BY_ID : MOBILITY_BY_ID;
}

// Ablauf: Vorbereitung -> Übung (ggf. links, Wechsel, rechts) -> nächste ...
// Kraft: Vorbereitung -> Satz 1 -> Pause -> Satz 2 ... Ein Satz mit
// Wiederholungen läuft ohne Uhr, bis "Satz geschafft" getippt wird.
function mobilityPhases(session) {
  const phases = [];
  const lib = playerLibrary(session);
  session.exercises.forEach((x, i) => {
    const ex = lib[x.id];
    if (!ex) return;
    phases.push({ type: "prep", i, ex, x, dur: MOB_PREP_S });
    if (session.kind === "strength") {
      const sets = x.sets || ex.sets;
      for (let n = 1; n <= sets; n++) {
        phases.push({ type: "set", i, ex, x, set: n, of: sets, dur: ex.hold ? (x.hold || ex.hold) : 0 });
        if (n < sets) phases.push({ type: "rest", i, ex, x, set: n + 1, of: sets, dur: x.rest || ex.rest });
      }
      return;
    }
    if (ex.sides) {
      phases.push({ type: "work", i, ex, x, side: "Linke Seite", dur: x.seconds });
      phases.push({ type: "switch", i, ex, x, dur: MOB_SWITCH_S });
      phases.push({ type: "work", i, ex, x, side: "Rechte Seite", dur: x.seconds });
    } else {
      phases.push({ type: "work", i, ex, x, side: null, dur: x.seconds });
    }
  });
  return phases;
}

function fmtClock(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function openMobilityPlayer(session, { onFinish } = {}) {
  const phases = mobilityPhases(session);
  if (!phases.length) return;
  const lib = playerLibrary(session);
  const strength = session.kind === "strength";
  const exCount = session.exercises.filter(x => lib[x.id]).length;
  const lastFocus = document.activeElement;

  const root = document.createElement("div");
  root.className = "mob-player";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", `Mobility: ${session.title}`);
  root.innerHTML = `
    <div class="mob-player-top">
      <button type="button" class="mob-icon-btn" data-act="close" aria-label="Einheit beenden">${MOB_ICONS.close}</button>
      <div class="mob-progress" aria-hidden="true">${session.exercises.filter(x => lib[x.id]).map(() => '<span class="mob-progress-seg"><span class="mob-progress-fill"></span></span>').join("")}</div>
      <button type="button" class="mob-icon-btn" data-act="sound" aria-pressed="${mobSoundOn()}" aria-label="Ton">${mobSoundOn() ? MOB_ICONS.soundOn : MOB_ICONS.soundOff}</button>
    </div>
    <div class="mob-player-body">
      <div class="mob-player-stage"><div class="mob-player-fig"></div><span class="mob-player-badge" hidden></span></div>
      <div class="mob-player-info">
        <p class="mob-player-kicker"></p>
        <h2 class="mob-player-name"></h2>
        <p class="mob-player-note" hidden></p>
        <div class="mob-timer" aria-hidden="true">
          <svg viewBox="0 0 120 120"><circle class="mob-timer-track" cx="60" cy="60" r="52"/><circle class="mob-timer-bar" cx="60" cy="60" r="52"/></svg>
          <span class="mob-timer-num"></span>
        </div>
        <p class="mob-player-sub"></p>
        <div class="mob-weight" hidden>
          <button type="button" class="mob-icon-btn" data-act="minus" aria-label="Weniger Gewicht">−</button>
          <span class="mob-weight-val" aria-live="polite"></span>
          <button type="button" class="mob-icon-btn" data-act="plus" aria-label="Mehr Gewicht">+</button>
        </div>
        <div class="mob-player-controls">
          <button type="button" class="mob-icon-btn mob-ctrl" data-act="back" aria-label="Zurück">${MOB_ICONS.back}</button>
          <button type="button" class="mob-icon-btn mob-ctrl mob-ctrl-main" data-act="toggle" aria-label="Pause">${MOB_ICONS.pause}</button>
          <button type="button" class="mob-icon-btn mob-ctrl" data-act="next" aria-label="Weiter">${MOB_ICONS.next}</button>
        </div>
        <details class="mob-player-howto"><summary>So geht's</summary><ol></ol><p class="mob-player-feel"></p></details>
        <p class="sr-only" aria-live="assertive" data-live></p>
      </div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add("mob-player-open");
  requestAnimationFrame(() => root.classList.add("is-open"));

  const $ = sel => root.querySelector(sel);
  const figHost = $(".mob-player-fig"), badge = $(".mob-player-badge");
  const kicker = $(".mob-player-kicker"), nameEl = $(".mob-player-name"), noteEl = $(".mob-player-note");
  const timerNum = $(".mob-timer-num"), timerBar = $(".mob-timer-bar"), subEl = $(".mob-player-sub");
  const toggleBtn = $('[data-act="toggle"]'), soundBtn = $('[data-act="sound"]');
  const howtoList = $(".mob-player-howto ol"), feelEl = $(".mob-player-feel"), live = $("[data-live]");
  const segs = [...root.querySelectorAll(".mob-progress-fill")];
  const weightBox = $(".mob-weight"), weightVal = $(".mob-weight-val");
  const fmtKg = kg => (kg > 0 ? `${String(kg).replace(".", ",")} kg` : "ohne Gewicht");
  const manualSet = ph => ph.type === "set" && !ph.dur;
  const RING = 2 * Math.PI * 52;
  timerBar.style.strokeDasharray = RING;

  let worked = 0; // wirklich gemachte Sekunden (Überspringen zählt nicht)
  let idx = 0, remaining = phases[0].dur, paused = false, lastTick = performance.now(), shownEx = null, timer = null, done = false;
  let sound = mobSoundOn();
  let wakeLock = null;
  let audio = null;

  function beep(freq = 880, len = 0.12, vol = 0.08) {
    if (!sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + len);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + len);
    } catch (e) { /* kein Ton möglich */ }
  }
  function say(text) {
    live.textContent = text;
    if (!sound || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "de-DE";
      u.rate = 1.02;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ohne Sprache weiter */ }
  }
  async function keepAwake() {
    try { if (navigator.wakeLock && !wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) { /* egal */ }
  }

  function showExercise(ph) {
    if (shownEx === ph.i) return;
    shownEx = ph.i;
    figHost.replaceChildren(createMobilityFigure(ph.ex, { animate: true }));
    nameEl.textContent = ph.ex.name;
    noteEl.textContent = ph.x.note || "";
    noteEl.hidden = !ph.x.note;
    howtoList.innerHTML = ph.ex.steps.map(s => `<li>${escapeHtml(s)}</li>`).join("");
    feelEl.textContent = "Spüren: " + ph.ex.feel;
  }

  function changeWeight(dir) {
    const ph = phases[idx];
    if (!ph || !ph.ex.weight) return;
    const kg = ph.x.kg != null ? ph.x.kg : (ph.ex.startKg || 0);
    const step = kg < 10 || (kg === 10 && dir < 0) ? 1 : 2;
    ph.x.kg = Math.max(0, kg + dir * step);
    if (typeof setStrengthWeight === "function") setStrengthWeight(ph.ex.id, ph.x.kg);
    render();
  }

  function render() {
    const ph = phases[idx];
    showExercise(ph);
    const n = ph.i + 1;
    const nextEx = phases.slice(idx + 1).find(p => p.i !== ph.i);
    kicker.textContent = `Übung ${n} von ${exCount}` + (ph.side ? ` · ${ph.side}` : "") + (ph.set ? ` · Satz ${ph.set} von ${ph.of}` : "");
    root.dataset.phase = ph.type;
    const showWeight = strength && ph.ex.weight && ph.type !== "rest";
    weightBox.hidden = !showWeight;
    if (showWeight) weightVal.textContent = fmtKg(ph.x.kg != null ? ph.x.kg : (ph.ex.startKg || 0));
    const amount = ph.ex.hold ? `${ph.x.hold || ph.ex.hold} s halten` : String(ph.x.reps || ph.ex.reps).replace(/^(\S+)(.*)$/, "$1 Wiederholungen$2");
    if (strength && ph.type === "prep") {
      badge.hidden = false;
      badge.textContent = "Gleich geht's los";
      subEl.textContent = `${ph.x.sets || ph.ex.sets} Sätze · ${amount}`;
    } else if (ph.type === "set") {
      badge.hidden = true;
      subEl.textContent = ph.dur ? "Halten und ruhig atmen" : `${amount} – dann „Satz geschafft“`;
    } else if (ph.type === "rest") {
      badge.hidden = false;
      badge.textContent = "Pause";
      subEl.textContent = `Gleich: Satz ${ph.set} von ${ph.of}`;
    } else if (ph.type === "prep") {
      badge.hidden = false;
      badge.textContent = "Gleich geht's los";
      subEl.textContent = ph.ex.kind === "reps" ? `${mobilityRepsFor(ph.ex, ph.x.seconds)} Wiederholungen${ph.ex.sides ? " je Seite" : ""} – in deinem Tempo` : (ph.ex.sides ? "Erst links, dann rechts" : "Ruhig halten und atmen");
    } else if (ph.type === "switch") {
      badge.hidden = false;
      badge.textContent = "Seite wechseln";
      subEl.textContent = "Kurz lösen und zur anderen Seite";
    } else {
      badge.hidden = true;
      subEl.textContent = nextEx ? `Danach: ${nextEx.ex.name}` : "Letzte Übung";
    }
    const frac = manualSet(ph) ? 1 : ph.dur ? Math.max(0, remaining) / ph.dur : 0;
    timerBar.style.strokeDashoffset = String(RING * (1 - frac));
    timerNum.textContent = manualSet(ph) ? String(parseInt(ph.x.reps || ph.ex.reps, 10) || ph.x.reps || ph.ex.reps) : fmtClock(remaining);
    root.classList.toggle("is-manual", manualSet(ph));
    segs.forEach((s, i) => {
      let w = 0;
      if (i < ph.i) w = 1;
      else if (i === ph.i) {
        const own = phases.filter(p => p.i === i && (p.type === "work" || p.type === "set"));
        if (strength) {
          w = own.filter(p => phases.indexOf(p) < idx).length / Math.max(1, own.length);
        } else {
          const total = own.reduce((t, p) => t + p.dur, 0);
          const before = own.filter(p => phases.indexOf(p) < idx).reduce((t, p) => t + p.dur, 0);
          w = total ? (before + (ph.type === "work" ? ph.dur - Math.max(0, remaining) : 0)) / total : 0;
        }
      }
      s.style.transform = `scaleX(${Math.min(1, w)})`;
    });
    if (manualSet(ph)) {
      toggleBtn.innerHTML = MOB_ICONS.check;
      toggleBtn.setAttribute("aria-label", "Satz geschafft");
    } else {
      toggleBtn.innerHTML = paused ? MOB_ICONS.play : MOB_ICONS.pause;
      toggleBtn.setAttribute("aria-label", paused ? "Weiter" : "Pause");
    }
    root.classList.toggle("is-paused", paused);
    figAnimator.setPaused(figHost.firstChild, paused);
  }

  function announce(ph) {
    if (ph.type === "prep") say(`${ph.ex.name}.`);
    else if (ph.type === "switch") say("Seite wechseln.");
    else if (ph.type === "work") { beep(1046, 0.18); if (ph.side) say(ph.side === "Linke Seite" ? "Links." : "Rechts."); }
    else if (ph.type === "set") { beep(1046, 0.18); say(`Satz ${ph.set}.`); }
    else if (ph.type === "rest") say("Pause.");
  }

  function go(to) {
    if (to >= phases.length) { finish(); return; }
    idx = Math.max(0, to);
    remaining = phases[idx].dur;
    announce(phases[idx]);
    render();
  }

  function tick() {
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    if (paused || done) return;
    if (manualSet(phases[idx])) { worked += Math.min(dt, 1); return; } // wartet auf "Satz geschafft"
    const before = Math.ceil(remaining);
    remaining -= dt;
    if (phases[idx].type === "work" || phases[idx].type === "set") worked += Math.min(dt, 1);
    const after = Math.ceil(remaining);
    if (after !== before && after > 0 && after <= 3) beep(660, 0.08, 0.05);
    if (remaining <= 0) go(idx + 1);
    else render();
  }

  // Zurück: an den Anfang der aktuellen Übung - steht man schon dort, eine davor.
  function back() {
    const ph = phases[idx];
    const first = phases.findIndex(p => p.i === ph.i);
    const atStart = idx === first && ph.dur - remaining < 2;
    if (atStart && ph.i > 0) go(phases.findIndex(p => p.i === ph.i - 1));
    else go(first);
  }
  function next() {
    const ph = phases[idx];
    const nextIdx = phases.findIndex((p, j) => j > idx && p.i !== ph.i);
    go(nextIdx === -1 ? phases.length : nextIdx);
  }

  function close() {
    clearInterval(timer);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisible);
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* egal */ }
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* egal */ }
    try { if (audio) audio.close(); } catch (e) { /* egal */ }
    root.classList.remove("is-open");
    document.body.classList.remove("mob-player-open");
    setTimeout(() => root.remove(), 250);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  async function askClose() {
    if (done) { close(); return; }
    const wasPaused = paused;
    paused = true;
    render();
    const ok = await confirmDialog("Einheit beenden? Dein Fortschritt wird nicht gespeichert.", { okLabel: "Beenden" });
    if (ok) close();
    else { paused = wasPaused; lastTick = performance.now(); render(); }
  }

  function finish() {
    done = true;
    clearInterval(timer);
    beep(784, 0.16); setTimeout(() => beep(1046, 0.22), 170);
    say("Geschafft. Gut gemacht!");
    const minutes = Math.max(1, Math.round(worked / 60));
    segs.forEach(sg => { sg.style.transform = "scaleX(1)"; });
    const body = root.querySelector(".mob-player-body");
    root.dataset.phase = "done";
    body.innerHTML = `
      <div class="mob-done">
        <div class="mob-done-check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>
        <h2 class="mob-done-title">Geschafft!</h2>
        <p class="mob-done-sub">${minutes} Minuten · ${exCount} Übungen</p>
        <fieldset class="mob-done-group">
          <legend>Wie war's?</legend>
          <div class="mob-segmented mob-segmented-lg" role="radiogroup" aria-label="Wie war's?">
            <button type="button" role="radio" aria-checked="false" data-rating="easy">Zu leicht</button>
            <button type="button" role="radio" aria-checked="true" class="is-on" data-rating="ok">Genau richtig</button>
            <button type="button" role="radio" aria-checked="false" data-rating="hard">Zu schwer</button>
          </div>
        </fieldset>
        <fieldset class="mob-done-group">
          <legend>Hat etwas weh getan? <span class="tp-hint">Antippen – kommt dann 3 Wochen nicht mehr vor.</span></legend>
          <div class="mob-chips">${session.exercises.filter(x => lib[x.id]).map(x => `<button type="button" class="mob-chip" aria-pressed="false" data-pain="${x.id}">${escapeHtml(lib[x.id].name)}</button>`).join("")}</div>
        </fieldset>
        <button type="button" class="mob-btn mob-btn-primary mob-done-btn" data-act="save">Fertig</button>
      </div>`;
    body.querySelector(".mob-segmented").addEventListener("click", e => {
      const b = e.target.closest("button[data-rating]");
      if (!b) return;
      body.querySelectorAll("[data-rating]").forEach(x => { x.classList.toggle("is-on", x === b); x.setAttribute("aria-checked", String(x === b)); });
    });
    body.querySelectorAll("[data-pain]").forEach(c => c.addEventListener("click", () => {
      const on = !c.classList.contains("is-on");
      c.classList.toggle("is-on", on);
      c.setAttribute("aria-pressed", String(on));
    }));
    body.querySelector('[data-act="save"]').addEventListener("click", () => {
      const rating = (body.querySelector("[data-rating].is-on") || {}).dataset;
      const result = {
        date: todayStr(),
        title: session.title,
        minutes,
        exercises: session.exercises.map(x => x.id),
        rating: rating ? rating.rating : "ok",
        pain: [...body.querySelectorAll("[data-pain].is-on")].map(c => c.dataset.pain),
        source: session.source || null,
        kind: session.kind || "mobility",
        weights: strength ? Object.fromEntries(session.exercises.filter(x => x.kg != null).map(x => [x.id, x.kg])) : undefined,
      };
      close();
      if (onFinish) onFinish(result);
    });
    body.querySelector('[data-act="save"]').focus();
  }

  function onKey(e) {
    if (document.querySelector("#confirm-overlay.open, .modal-overlay.open")) return;
    if (e.key === "Escape") { e.preventDefault(); askClose(); }
    if (done) return;
    if (e.key === " " && !(e.target && e.target.tagName === "BUTTON")) {
      e.preventDefault();
      if (manualSet(phases[idx])) { go(idx + 1); return; }
      paused = !paused; lastTick = performance.now(); render();
    }
    if (e.key === "ArrowRight") next();
    if (e.key === "ArrowLeft") back();
  }
  function onVisible() {
    lastTick = performance.now(); // im Hintergrund nicht weiterzählen
    if (!document.hidden) keepAwake();
  }

  root.addEventListener("click", e => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "close") askClose();
    else if (act === "toggle") {
      if (manualSet(phases[idx])) { go(idx + 1); return; }
      paused = !paused; lastTick = performance.now(); render();
    }
    else if (act === "minus" || act === "plus") {
      changeWeight(act === "plus" ? 1 : -1);
      // Mit Maus/Finger getippt: Fokus lösen, damit die Leertaste danach
      // wieder "Satz geschafft" bedeutet (mit der Tastatur bleibt er stehen).
      if (e.detail > 0) btn.blur();
    }
    else if (act === "next") next();
    else if (act === "back") back();
    else if (act === "sound") {
      sound = !sound;
      try { localStorage.setItem(MOB_SOUND_KEY, sound ? "on" : "off"); } catch (err) { /* nur Komfort */ }
      soundBtn.innerHTML = sound ? MOB_ICONS.soundOn : MOB_ICONS.soundOff;
      soundBtn.setAttribute("aria-pressed", String(sound));
      if (!sound && window.speechSynthesis) window.speechSynthesis.cancel();
    }
  });
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisible);
  keepAwake();
  announce(phases[0]);
  render();
  toggleBtn.focus();
  timer = setInterval(tick, 200);
}
