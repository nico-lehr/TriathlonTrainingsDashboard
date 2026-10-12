// Wettkampf-Countdown im Coach-Tab: Tage bis zum Hauptevent (★), aktuelle
// Trainingsphase mit Erklärung, Wochenumfang Ziel/Ist und der nächste
// Phasenwechsel. Berechnet wird alles in js/analytics/periodization.js,
// hier wird nur dargestellt. Neu gezeichnet über renderCoachSummary()
// (Ziele, Plan, Erholung) und renderAll() (neue Trainings).

function renderRaceCountdown() {
  const host = document.getElementById("race-countdown-body");
  if (!host) return;
  const goal = getPrimaryGoal();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const timeline = getPhaseTimeline(today, goal);
  if (!timeline.length) {
    host.innerHTML = raceCountdownHintHtml(goal);
    const btn = host.querySelector(".rc-new-goal-btn");
    if (btn) btn.addEventListener("click", () => {
      const toggle = document.getElementById("new-goal-toggle-btn");
      if (toggle && !toggle.classList.contains("active")) toggle.click();
    });
    return;
  }

  const raceDate = new Date(goal.date + "T00:00:00");
  const daysUntil = daysUntilGoal(goal);
  const phase = PERIOD_PHASES[timeline[0].phase];
  const week = getWeeklyTargets(goal, plannedWorkouts, DATA, today);
  const thisWeek = week.weeks[0];
  const next = timeline[1];
  const dayWord = n => (n === 1 ? "Tag" : "Tage");
  const dateLabel = key => fmtDateWeekday(new Date(key + "T00:00:00"));
  const daysTo = key => daysUntilGoal({ date: key }); // Tage ab heute, wie beim Rennen

  const hero = daysUntil > 0
    ? { value: daysUntil, sub: `${dayWord(daysUntil)} bis „${escapeHtml(goal.name)}“ am ${fmtDateWeekday(raceDate)}` }
    : daysUntil === 0
      ? { value: "Heute", sub: `ist „${escapeHtml(goal.name)}“ – viel Erfolg!` }
      : { value: -daysUntil, sub: `${dayWord(-daysUntil)} seit „${escapeHtml(goal.name)}“` };

  const nextHtml = next
    ? `<div class="csc-value">${escapeHtml(PERIOD_PHASES[next.phase].label)}</div>
       <div class="csc-sub">ab ${dateLabel(next.from)} · in ${daysTo(next.from)} ${daysTo(next.from) === 1 ? "Tag" : "Tagen"}</div>`
    : `<div class="csc-value">Neues Ziel</div>
       <div class="csc-sub">Erholung bis ${dateLabel(timeline[0].to)} – danach markierst du bei „Deine Ziele“ dein nächstes Rennen mit ★.</div>`;

  host.innerHTML = `
    <div class="race-countdown">
      <div class="coach-summary-chip">
        <div class="csc-label">Countdown</div>
        <div class="rc-hero">${hero.value}</div>
        <div class="csc-sub">${hero.sub}</div>
      </div>
      <div class="coach-summary-chip">
        <div class="csc-label">Phase jetzt</div>
        <div class="csc-value">${escapeHtml(phase.label)}</div>
        <div class="csc-sub">${escapeHtml(phase.text)}</div>
      </div>
      <div class="coach-summary-chip">
        <div class="csc-label">Diese Woche · ${PERIOD_WEEK_LABELS[thisWeek.type]}</div>
        ${raceCountdownWeekHtml(thisWeek, week)}
      </div>
      <div class="coach-summary-chip">
        <div class="csc-label">Nächster Wechsel</div>
        ${nextHtml}
      </div>
    </div>`;
  const meterHost = host.querySelector(".rc-meter-host");
  if (meterHost) drawRaceCountdownMeter(meterHost, thisWeek);
}

// Wochenumfang: Ist (erledigt + noch geplant) gegen das Ziel der Periodisierung.
// Ohne aktuellen Wochenumfang gibt es nur den Prozentwert, keine Minuten.
function raceCountdownWeekHtml(w, plan) {
  const sum = w.doneMin + w.plannedMin;
  if (w.targetMin == null) {
    return `
      <div class="csc-value">${sum} min</div>
      <div class="csc-sub">${w.doneMin} min erledigt, ${w.plannedMin} min noch geplant. Ein Zielwert in Minuten folgt, sobald abgeschlossene Trainingswochen erfasst sind (Ziel: ${Math.round(w.targetPct * 100)} % deines Wochenumfangs).</div>`;
  }
  const diff = w.targetMin - sum;
  const status = diff > 0 ? `noch ${diff} min bis zum Ziel` : diff < 0 ? `${-diff} min über dem Ziel` : "genau im Ziel";
  return `
    <div class="csc-value">${sum} / ${w.targetMin} min</div>
    <div class="rc-meter-host"></div>
    <div class="legend rc-legend">
      <span class="item"><span class="swatch rc-swatch-done"></span>erledigt ${w.doneMin} min</span>
      <span class="item"><span class="swatch rc-swatch-planned"></span>noch geplant ${w.plannedMin} min</span>
      <span class="item"><span class="swatch line rc-swatch-target"></span>Ziel ${w.targetMin} min</span>
    </div>
    <div class="csc-sub">${status} · Ziel = ${Math.round(w.targetPct * 100)} % ${raceCountdownBaselineText(plan)}</div>`;
}

// Bezugswert der Prozentangabe: die letzte normale Woche, beim
// Wiedereinstieg nach leichteren Wochen der Ausgangswert aus Regel 4.
function raceCountdownBaselineText(plan) {
  return plan.returnAfterWeeks
    ? `deines Wiedereinstiegs-Werts (${plan.baselineMin} min nach ${plan.returnAfterWeeks} leichteren Wochen in Folge)`
    : `deiner letzten normalen Trainingswoche (ab ${fmtDate(new Date(plan.baselineWeek + "T00:00:00"))}: ${plan.baselineMin} min)`;
}

// Balken: erledigt + noch geplant, Strich = Ziel. Gestreckt auf volle Breite
// (preserveAspectRatio none), Striche bleiben per non-scaling-stroke 2px breit.
function drawRaceCountdownMeter(hostEl, w) {
  const sum = w.doneMin + w.plannedMin;
  const max = Math.max(w.targetMin, sum, 1) * 1.1;
  const x = min => (min / max) * 100;
  const svg = svgEl("svg", { class: "rc-meter", viewBox: "0 0 100 10", preserveAspectRatio: "none", role: "img",
    "aria-label": `${w.doneMin} min erledigt, ${w.plannedMin} min geplant, Ziel ${w.targetMin} min` });
  svg.appendChild(svgEl("rect", { class: "rc-meter-track", x: 0, y: 0, width: 100, height: 10 }));
  const segs = [
    { cls: "rc-meter-done", from: 0, min: w.doneMin, label: "erledigt" },
    { cls: "rc-meter-planned", from: w.doneMin, min: w.plannedMin, label: "noch geplant" },
  ];
  segs.filter(s => s.min > 0).forEach(s => {
    const rect = svgEl("rect", { class: s.cls, x: x(s.from), y: 0, width: x(s.min), height: 10 });
    rect.addEventListener("mousemove", e => showTip(e, `<b>${s.label}</b> ${s.min} min`, hostEl));
    rect.addEventListener("mouseleave", hideTip);
    svg.appendChild(rect);
  });
  if (w.doneMin > 0 && w.plannedMin > 0) {
    svg.appendChild(svgEl("line", { class: "rc-meter-gap", x1: x(w.doneMin), x2: x(w.doneMin), y1: 0, y2: 10, "vector-effect": "non-scaling-stroke" }));
  }
  svg.appendChild(svgEl("line", { class: "rc-meter-target", x1: x(w.targetMin), x2: x(w.targetMin), y1: 0, y2: 10, "vector-effect": "non-scaling-stroke" }));
  hostEl.appendChild(svg);
}

// Ohne Phase: kein Ziel, kein Hauptevent, keins mit Datum, oder Rennen samt
// Erholung vorbei. Der Knopf öffnet dasselbe Formular wie „+ Neues Ziel/Event“.
function raceCountdownHintHtml(goal) {
  const tail = "dann zählt hier der Countdown, und du siehst, in welcher Trainingsphase du gerade bist.";
  if (goals.length && !goal) {
    return `<div class="rc-hint"><p>Markiere bei „Deine Ziele“ deinen wichtigsten Wettkampf mit ★ als Hauptevent – ${tail}</p></div>`;
  }
  const text = !goals.length ? `Noch kein Wettkampf eingetragen. Leg dein Rennen mit Datum an – ${tail}`
    : !goal.date ? `Dein Hauptevent „${escapeHtml(goal.name)}“ hat noch kein Datum. Leg es mit Datum neu an – ${tail}`
      : `„${escapeHtml(goal.name)}“ liegt hinter dir. Markiere dein nächstes Rennen bei „Deine Ziele“ mit ★ oder leg ein neues an – dann startet hier der nächste Countdown.`;
  return `
    <div class="rc-hint">
      <p>${text}</p>
      <button type="button" class="cal-today-btn rc-new-goal-btn">+ Neues Ziel/Event</button>
    </div>`;
}
