// Baut den kompakten Text-Kontext (Form, Umfang, Bestzeiten, Profil, Erholung, Ziel)
// fuer das LLM - bewusst aggregiert statt Rohdaten, siehe docs/AI_CONTEXT.md.

// `goal` ist optional - ohne Ziel (z.B. für die allgemeine KI-
// Leistungszustand-Zusammenfassung im Coach-Tab, siehe buildPerformanceSummaryPrompt()
// in prompts.js) werden die zielspezifischen Zeilen (Ziel/Unterdisziplinen/
// Race-Readiness) einfach weggelassen statt mit leeren Werten aufzufüllen.
function buildCompactContext(goal) {
  const series = computeLoadSeries();
  const last = series && series.length ? series[series.length - 1] : null;
  const ctl = last ? last.ctl : null;
  const atl = last ? last.atl : null;
  const tsb = last ? last.tsb : null;
  const acwr = (last && last.ctl > 0.5) ? last.atl / last.ctl : null;

  const cutoff = new Date(Date.now() - 28 * 86400000);
  const recent = DATA.filter(w => w._date && w._date >= cutoff);
  const hBySport = { Schwimmen: 0, Rad: 0, Laufen: 0 };
  recent.forEach(w => {
    const g = sportGroup(w.sport);
    if (hBySport[g] != null) hBySport[g] += (w.duration_min || 0);
  });

  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const eventDate = goal && goal.date ? new Date(goal.date + "T00:00:00") : null;
  const daysUntil = eventDate ? Math.round((eventDate - todayMid) / 86400000) : null;

  const lines = [];
  lines.push(`Heute: ${todayStr()}`);

  // Status-Texte (tsbStatusLabel/acwrStatusLabel, js/analytics/training-load.js)
  // sind dieselbe Einordnung wie die Badges im Dashboard - so muss die KI die
  // Schwellenwerte nicht selbst raten, sondern bekommt die fertige Einordnung.
  const tsbStatus = tsbStatusLabel(tsb);
  const acwrStatus = acwrStatusLabel(acwr);
  const formBits = [];
  if (ctl != null) formBits.push(`CTL ${fmtNum(ctl, 1)}`);
  if (atl != null) formBits.push(`ATL ${fmtNum(atl, 1)}`);
  if (tsb != null) formBits.push(`TSB ${tsb >= 0 ? "+" : ""}${fmtNum(tsb, 1)}${tsbStatus ? " (" + tsbStatus.text + ")" : ""}`);
  if (acwr != null) formBits.push(`ACWR ${fmtNum(acwr, 2)}${acwrStatus ? " (" + acwrStatus.text + ")" : ""}`);
  if (formBits.length) lines.push(`Form: ${formBits.join(" | ")}`);

  // Trainingsmonotonie (Foster 1998, computeMonotonyStrainSeries) - relevant
  // fürs Übertrainings-/Verletzungsrisiko, bisher nicht Teil des Kontexts.
  const monotonySeries = computeMonotonyStrainSeries();
  const monotony = monotonySeries && monotonySeries.length ? monotonySeries[monotonySeries.length - 1].monotony : null;
  if (monotony != null) {
    const monoStatus = monotonyStatusLabel(monotony);
    lines.push(`Trainingsmonotonie (7 Tage): ${fmtNum(monotony, 2)}${monoStatus ? " (" + monoStatus.text + ")" : ""}`);
  }

  // VO2max-Schätzung + Trend, getrennt je Sportart (js/analytics/performance.js)
  // - hilft, Zielzeiten realistisch einzuschätzen statt dass die KI dafür
  // raten muss. Laufen und Rad bewusst nicht vermischt (siehe dort).
  const vo2 = computeVo2MaxEstimate();
  if (vo2.laufen) {
    lines.push(`VO2max Laufen: ${fmtNum(vo2.laufen.value, 1)} ml/kg/min (${vo2.laufen.methodLabel})${vo2.laufen.trendLabel ? ", " + vo2.laufen.trendLabel : ""}`);
  }
  if (vo2.rad) {
    lines.push(`VO2max Rad: ${fmtNum(vo2.rad.value, 1)} ml/kg/min (${vo2.rad.methodLabel})${vo2.rad.trendLabel ? ", " + vo2.rad.trendLabel : ""}`);
  }

  const volBits = [];
  if (hBySport.Schwimmen > 0) volBits.push(`Schwimmen ${fmtH(hBySport.Schwimmen)}h`);
  if (hBySport.Rad > 0) volBits.push(`Rad ${fmtH(hBySport.Rad)}h`);
  if (hBySport.Laufen > 0) volBits.push(`Laufen ${fmtH(hBySport.Laufen)}h`);
  if (volBits.length) lines.push(`Letzte 4 Wochen: ${volBits.join(" | ")}`);

  const profBits = [];
  const athleteAge = getAthleteAge();
  if (athleteAge != null) profBits.push(`${athleteAge} Jahre`);
  if (athleteProfile.experienceLevel) profBits.push(`Erfahrung ${ONB_EXP_LABELS[athleteProfile.experienceLevel] || athleteProfile.experienceLevel}`);
  if (athleteProfile.strongDiscipline) profBits.push(`Stärke ${athleteProfile.strongDiscipline}`);
  if (athleteProfile.weakDiscipline) profBits.push(`Schwäche ${athleteProfile.weakDiscipline}`);
  if (Array.isArray(athleteProfile.trainingDays) && athleteProfile.trainingDays.length) {
    profBits.push(`Trainingstage ${athleteProfile.trainingDays.map(d => WEEKDAY_LABELS[d] || d).join("/")}`);
  } else if (athleteProfile.trainingDaysPerWeek) {
    profBits.push(`${athleteProfile.trainingDaysPerWeek} Tage/Woche`);
  }
  if (Array.isArray(athleteProfile.swimDays) && athleteProfile.swimDays.length) {
    profBits.push(`Schwimmtage ${athleteProfile.swimDays.map(d => WEEKDAY_LABELS[d] || d).join("+")}`);
  }
  if (Array.isArray(athleteProfile.longDays) && athleteProfile.longDays.length) {
    profBits.push(`lange Einheit ${athleteProfile.longDays.map(d => WEEKDAY_LABELS[d] || d).join("+")}`);
  }
  if (athleteProfile.typicalSessionMin) profBits.push(`~${athleteProfile.typicalSessionMin} Min./Einheit`);
  if (athleteProfile.ftpWatts) profBits.push(`FTP ${athleteProfile.ftpWatts}W`);
  if (athleteProfile.runThresholdPace) profBits.push(`Schwellenpace Lauf ${athleteProfile.runThresholdPace}/km`);
  if (athleteProfile.swimCss) profBits.push(`CSS Schwimmen ${athleteProfile.swimCss}/100m`);
  if (athleteProfile.weeklyHours) profBits.push(`verfügbar ${athleteProfile.weeklyHours}h/Woche`);
  if (profBits.length) lines.push(`Profil: ${profBits.join(" | ")}`);

  const rec = computeCompactRecords();
  if (rec.laufen) {
    const b = [];
    ["1km", "5km", "10km"].forEach(k => { if (rec.laufen[k]) b.push(`${k} ${rec.laufen[k]}`); });
    if (rec.laufen.pace) b.push(`Ø ${rec.laufen.pace}`);
    if (b.length) lines.push(`Bestzeiten Laufen: ${b.join(" | ")}`);
  }
  if (rec.rad_outdoor) {
    const b = [];
    ["10km", "20km", "40km"].forEach(k => { if (rec.rad_outdoor[k]) b.push(`${k} ${rec.rad_outdoor[k]}`); });
    if (rec.rad_outdoor.geschw) b.push(`Ø ${rec.rad_outdoor.geschw}`);
    if (b.length) lines.push(`Bestzeiten Rad (Outdoor): ${b.join(" | ")}`);
  }
  // Indoor bewusst über die Leistung statt über Distanz/Tempo - die virtuellen
  // Kilometer der Plattform taugen nicht als Bestwert (siehe computeCompactRecords).
  if (rec.rad_indoor) {
    const b = [];
    if (rec.rad_indoor.watt_avg) b.push(`höchste Ø-Leistung ${rec.rad_indoor.watt_avg}`);
    if (rec.rad_indoor.np) b.push(`höchste NP ${rec.rad_indoor.np}`);
    if (rec.rad_indoor.w_pro_kg) b.push(`${rec.rad_indoor.w_pro_kg} W/kg`);
    if (rec.rad_indoor.laengste_dauer) b.push(`längste Dauer ${rec.rad_indoor.laengste_dauer}`);
    if (b.length) lines.push(`Bestwerte Rad (Indoor, Rolle/virtuell - Distanz & km/h simuliert, daher leistungsbasiert): ${b.join(" | ")}`);
  }
  if (rec.schwimmen && rec.schwimmen.pace) lines.push(`Bestzeit Schwimmen: Ø ${rec.schwimmen.pace}`);

  const recBits = [];
  if (recoveryCheck.soreness) recBits.push(`Muskelkater ${RECOVERY_SORENESS_LABELS[recoveryCheck.soreness]}${recoveryCheck.sorenessLocation ? " (" + recoveryCheck.sorenessLocation + ")" : ""}`);
  if (recoveryCheck.energy) recBits.push(`Energie ${RECOVERY_ENERGY_LABELS[recoveryCheck.energy]}`);
  if (recoveryCheck.injury === "yes") recBits.push(`Verletzung${recoveryCheck.injuryNote ? ": " + recoveryCheck.injuryNote : " (keine Details angegeben)"}`);
  if (recBits.length) lines.push(`Erholung heute: ${recBits.join(" | ")}`);

  // Gemessene Erholungswerte aus Garmin Connect - bewusst ERGAENZEND zur
  // subjektiven Abfrage oben, nicht als Ersatz: Gefuehl und Messwert fallen
  // regelmaessig auseinander, und genau diese Diskrepanz ist fuer eine
  // Empfehlung die interessanteste Information.
  //
  // HRV und Ruhepuls werden als Abweichung von der EIGENEN Basislinie
  // ausgegeben, nicht als nackte Zahl: ein HRV-Wert von 62 ms ist ohne
  // Vergleichsgroesse bedeutungslos, "12% unter dem eigenen 30-Tage-Mittel"
  // dagegen eine Aussage. Fehlende Tage bleiben Luecken (nie 0).
  const wellBits = [];
  if (typeof latestWellness === "function") {
    const hrv = wellnessDeviation("hrv_ms");
    if (hrv) {
      const d = Math.round(hrv.deltaPct);
      wellBits.push(`HRV ${Math.round(hrv.value)} ms (${d >= 0 ? "+" : ""}${d}% ggue. 30-Tage-Mittel ${Math.round(hrv.baseline)} ms)`);
    }
    const hrvStatus = latestWellness("hrv_status");
    if (hrvStatus) wellBits.push(`HRV-Status laut Garmin: ${hrvStatus.value}`);
    const rhr = wellnessDeviation("resting_hr");
    if (rhr) {
      const d = Math.round(rhr.value - rhr.baseline);
      wellBits.push(`Ruhepuls ${Math.round(rhr.value)} bpm (${d >= 0 ? "+" : ""}${d} ggue. Mittel ${Math.round(rhr.baseline)})`);
    }
    const sleep = latestWellness("sleep_min");
    if (sleep) {
      const base = wellnessBaseline("sleep_min");
      const h = Math.floor(sleep.value / 60), m = Math.round(sleep.value % 60);
      wellBits.push(`Schlaf ${h}:${String(m).padStart(2, "0")} h${base ? ` (Mittel ${fmtNum(base / 60, 1)} h)` : ""}`);
    }
    const score = latestWellness("sleep_score");
    if (score) wellBits.push(`Schlafscore ${Math.round(score.value)}/100`);
    // Schlafphasen: sagen mehr ueber die Erholungsqualitaet aus als die reine
    // Dauer - 7 Stunden mit wenig Tiefschlaf erholen schlechter als 6,5 mit viel.
    const deep = latestWellness("sleep_deep_min"), rem = latestWellness("sleep_rem_min");
    if (deep || rem) {
      const parts = [];
      if (deep) parts.push(`Tiefschlaf ${Math.round(deep.value)} min`);
      if (rem) parts.push(`REM ${Math.round(rem.value)} min`);
      wellBits.push(parts.join(", "));
    }
    // Garmins eigener Normbereich - die Einordnung "innerhalb/ausserhalb" stammt
    // damit von Garmin selbst und nicht aus unserer 30-Tage-Naeherung.
    const bLow = latestWellness("hrv_baseline_low"), bHigh = latestWellness("hrv_baseline_high");
    if (bLow && bHigh) wellBits.push(`HRV-Normbereich laut Garmin: ${Math.round(bLow.value)}-${Math.round(bHigh.value)} ms`);
    const bb = latestWellness("body_battery_high"), bbLow = latestWellness("body_battery_low");
    if (bb) {
      // Tagestief mitgeben: ein Hoch von 90 sagt wenig, wenn der Wert auf 5 faellt.
      wellBits.push(`Body Battery ${Math.round(bb.value)} max${bbLow ? ` / ${Math.round(bbLow.value)} min` : ""}`);
    }
    const steps = latestWellness("steps");
    if (steps) wellBits.push(`Schritte ${Math.round(steps.value).toLocaleString("de-DE")}`);
    const ts = latestWellness("training_status");
    if (ts) wellBits.push(`Trainingszustand laut Garmin: ${ts.value}`);
  }

  // Koerperzusammensetzung als eigene Zeile mit Trend - fuer die Bewertung von
  // Gewichtsveraenderungen ist entscheidend, OB Muskelmasse oder Fett schwankt.
  if (typeof latestWellness === "function") {
    const compBits = [];
    const w = latestWellness("weight_kg", 30);
    if (w) {
      const base = wellnessBaseline("weight_kg", 60);
      const d = base != null ? w.value - base : null;
      compBits.push(`Gewicht ${fmtNum(w.value, 1)} kg${d != null && Math.abs(d) >= 0.1 ? ` (${d > 0 ? "+" : "−"}${fmtNum(Math.abs(d), 1)} kg ggue. 60-Tage-Mittel)` : ""}`);
    }
    const fat = latestWellness("body_fat_pct", 30);
    if (fat) compBits.push(`Koerperfett ${fmtNum(fat.value, 1)}%`);
    const muscle = latestWellness("muscle_mass_kg", 30);
    if (muscle) compBits.push(`Muskelmasse ${fmtNum(muscle.value, 1)} kg`);
    if (compBits.length) lines.push(`Koerperzusammensetzung (Garmin): ${compBits.join(" | ")}`);
  }
  if (wellBits.length) {
    lines.push(`Gemessene Erholung (Garmin, zuletzt verfuegbare Werte): ${wellBits.join(" | ")}`);
  }

  // Kompakte Zusammenfassung des Erholungs-Logbuchs der letzten 7 Tage, damit
  // die Empfehlung auch ein Muster erkennen kann (z.B. wiederkehrender
  // Muskelkater in derselben Körperregion), ohne den Kontext aufzublähen.
  const recentLog = recoveryLog.filter(e => !isRecoveryCheckEmpty(e)).slice(-7);
  if (recentLog.length) {
    const logBits = recentLog.map(e => {
      const parts = [];
      if (e.soreness && e.soreness !== "none") parts.push(`Muskelkater ${RECOVERY_SORENESS_LABELS[e.soreness]}${e.sorenessLocation ? " (" + e.sorenessLocation + ")" : ""}`);
      if (e.energy) parts.push(`Energie ${RECOVERY_ENERGY_LABELS[e.energy]}`);
      if (e.injury === "yes") parts.push(`Verletzung${e.injuryNote ? ": " + e.injuryNote : ""}`);
      return `${e.date}: ${parts.join(", ") || "unauffällig"}`;
    });
    lines.push(`Erholungs-Logbuch (letzte ${recentLog.length} Tage mit Eintrag): ${logBits.join(" | ")}`);
  }

  // Ernährungsziel heute (js/analytics/nutrition.js, "Ernährung"-Tab) - dieselbe
  // Berechnung, die auch dort angezeigt wird, damit die Trainingsempfehlung/der
  // Trainingsplan nicht unabhängig davon eigene Ernährungstipps erfindet,
  // sondern auf denselben (schon fertig berechneten) Zahlen aufbaut.
  const macroTargets = (typeof computeDailyMacroTargets === "function") ? computeDailyMacroTargets() : null;
  if (macroTargets) {
    const bits = [`Kohlenhydrate ${macroTargets.carbG}g`];
    if (macroTargets.loadingNote) bits.push(macroTargets.loadingNote);
    else if (macroTargets.biasNote) bits.push(macroTargets.biasNote);
    else bits.push(macroTargets.category.label);
    bits.push(`Eiweiß ${macroTargets.proteinG}g`, `Fett ${macroTargets.fatG}g`);
    lines.push(`Ernährungsziel heute: ${bits.join(" | ")}`);
  }

  if (goal) {
    const zielBits = [`${goal.name}`, goal.sport, goal.date];
    if (daysUntil != null) zielBits.push(`in ${daysUntil} Tagen`);
    if (goal.targetTime) zielBits.push(`Zielzeit ${goal.targetTime}`);
    if (goal.distanceKm) zielBits.push(`${fmtNum(goal.distanceKm, 1)}km`);
    lines.push(`Ziel: ${zielBits.join(" | ")}`);
    if (goal.subDisciplines && goal.subDisciplines.length) {
      const subBits = goal.subDisciplines.map(s => {
        const parts = [];
        if (s.distanceKm) parts.push(`${fmtNum(s.distanceKm, 1)}km`);
        if (s.targetTime) parts.push(`Ziel ${s.targetTime}`);
        return `${s.label}${parts.length ? " " + parts.join(", ") : ""}`;
      });
      lines.push(`Unterdisziplinen: ${subBits.join(" | ")}`);
    }
    if (goal.notes) lines.push(`Notiz: ${goal.notes}`);

    // Race Readiness Score (js/analytics/race-readiness.js) - fasst Form/ACWR/
    // Trainingskonstanz/Taper-Phase speziell für dieses Ziel zu einer
    // Einschätzung zusammen; wurde bisher nur im Coach-Tab angezeigt, nie an
    // die KI selbst weitergegeben, obwohl genau dafür berechnet.
    const readiness = computeRaceReadiness(goal);
    if (readiness) {
      const factorBits = readiness.factors.map(f => `${f.label}: ${f.note}`).join(" | ");
      lines.push(`Race-Readiness-Score: ${readiness.score}/100 (${readiness.level.label}) — ${factorBits}`);
    }
  }

  return lines.join("\n");
}

// Baut den kompakten Text-Kontext fuer die KI-Auswertung EINER Trainingseinheit
// im Vergleich zu `comparable` (gleiche Sportart + Umgebung + ähnliche Distanz/Dauer,
// siehe findComparableWorkouts). Deltas werden hier fertig berechnet - das
// Modell soll nur noch einordnen/interpretieren, nicht selbst rechnen.

// Baut den Kontext für die automatische Trainingsplan-Erstellung (siehe
// generateTrainingPlan in ollama.js): der komplette Ziel-Kontext von
// buildCompactContext() (Form, Monotonie, VO2max, Profil, Bestzeiten,
// Erholung, Race-Readiness) PLUS die planspezifischen Zusatzinfos - eine
// Berechnung wiederverwendet statt den Kontext zweimal aufzubauen.
function buildPlanContext(goal, windowDates) {
  const base = buildCompactContext(goal);
  const lines = [base];

  const daysUntil = goal.date ? Math.round((new Date(goal.date + "T00:00:00") - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000) : null;
  const phase = computeTrainingPhase(daysUntil);
  lines.push(`Trainingsphase: ${phase.label}`);

  // "Erweiterte Einstellungen" des Ziels (js/components/coach.js,
  // js/data/goals.js) - alle optional, nur wenn tatsächlich hinterlegt.
  if (goal.priority) {
    const prioLabel = { A: "Hauptrennen", B: "Nebenziel", C: "Trainingswettkampf" }[goal.priority];
    lines.push(`Priorität dieses Ziels: ${goal.priority} (${prioLabel})`);
  }
  if (goal.courseElevationM != null) {
    lines.push(`Streckenprofil: ${goal.courseProfileLabel || goal.courseElevationM + " Hm"}`);
  }
  if (goal.strategyNote) {
    lines.push(`Wettkampf-Strategie-Notiz des Athleten: "${goal.strategyNote}"`);
  }

  // Wettkampf-Verpflegungsplan (js/analytics/nutrition.js) - nur relevant,
  // wenn er tatsächlich existiert (Zielzeiten hinterlegt) und das Fenster
  // nah am Wettkampf liegt, damit der Kontext bei einer Grundlagenwoche
  // nicht unnötig aufgebläht wird.
  if (daysUntil != null && daysUntil <= 21) {
    const fueling = (typeof computeRaceFuelingPlan === "function") ? computeRaceFuelingPlan() : null;
    if (fueling) {
      lines.push(`Wettkampf-Verpflegungsplan: ${fueling.totalCarbG[0]}-${fueling.totalCarbG[1]}g Kohlenhydrate gesamt, ${fueling.fluidNote}`);
    }
  }

  const dowFull = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const windowBits = windowDates.map(d => `${d} (${dowFull[new Date(d + "T00:00:00").getDay()]})`);
  lines.push(`Zu planendes Zeitfenster (genau diese ${windowDates.length} Tage, keine anderen Daten verwenden): ${windowBits.join(", ")}`);

  const wantStrength = [];
  if (athleteProfile.includeStrength) wantStrength.push("Krafttraining");
  if (athleteProfile.includeMobility) wantStrength.push("Mobility/Beweglichkeit");
  lines.push(`Zusätzlich gewünscht: ${wantStrength.length ? wantStrength.join(" + ") : "kein Kraft-/Mobility-Training, nur Schwimmen/Rad/Laufen"}`);

  // Verletzungen/Einschränkungen (im Onboarding erfragt, js/data/athlete.js)
  // - reiner Nutzertext, 1:1 weitergereicht. Sicherheitsrelevant: die KI soll
  // Übungen/Belastungen meiden, die laut Athlet problematisch sind, statt
  // das zu ignorieren.
  if (athleteProfile.limitations && athleteProfile.limitations.trim()) {
    lines.push(`Verletzungen/Einschränkungen des Athleten (unbedingt berücksichtigen): ${athleteProfile.limitations.trim()}`);
  }

  // Freie Zusatzwünsche des Athleten ("Erweiterte Einstellungen" in der
  // Trainingsplan-Kachel, z.B. "1x Zugseiltraining pro Woche") - reiner
  // Nutzertext, wird 1:1 weitergereicht, die KI entscheidet in buildPlanPrompt
  // ob/wie sie plausibel eingebaut werden.
  if (athleteProfile.customPlanWishes && athleteProfile.customPlanWishes.trim()) {
    lines.push(`Zusätzliche Wünsche des Athleten: ${athleteProfile.customPlanWishes.trim()}`);
  }

  // Fertig berechnete Trainingszonen (js/analytics/zones.js) - die KI soll
  // für Ausdauereinheiten konkrete HF-/Pace-/Watt-Bereiche aus DIESEN Zahlen
  // zitieren statt "leicht/mittel/hart" unkonkret zu lassen (siehe
  // CHANGE_REQUESTS.md: präzisere Trainingsvorschläge). Nur vorhanden, wenn
  // die nötigen Schwellenwerte im Profil hinterlegt sind.
  const zoneLines = (typeof formatZonesForContext === "function") ? formatZonesForContext() : [];
  zoneLines.forEach(l => lines.push(l));

  // Zuletzt TATSÄCHLICH absolvierte Einheiten (granularer als die 4-Wochen-
  // Aggregation in buildCompactContext) - damit die KI nicht z.B. drei
  // Ruhetage in Folge vorschlägt, obwohl gerade erst eine Pause war, oder
  // umgekehrt nicht auf eine bereits gemachte harte Einheit draufsetzt.
  const cutoff14 = new Date(Date.now() - 14 * 86400000);
  const recentDone = DATA.filter(w => w._date && w._date >= cutoff14 && !w.is_summary)
    .sort((a, b) => b._date - a._date).slice(0, 12);
  if (recentDone.length) {
    const bits = recentDone.map(w => `${fmtDate(w._date)} ${w.sport} ${w.duration_min != null ? Math.round(w.duration_min) + "min" : ""}${w.training_load != null ? " Load " + Math.round(w.training_load) : ""}`);
    lines.push(`Zuletzt tatsächlich absolviert (neueste zuerst): ${bits.join(" | ")}`);
  } else {
    lines.push(`Zuletzt tatsächlich absolviert: keine Einheiten in den letzten 14 Tagen erfasst.`);
  }

  // Zuletzt VORGESCHLAGENE Einheiten + ob sie eingehalten wurden (Adherence) -
  // damit die KI aus der Reaktion des Athleten lernen kann (z.B. Einheiten
  // wiederholt übersprungen -> Umfang/Intensität anpassen).
  const recentPlanned = plannedWorkoutsForGoal(goal.id)
    .filter(p => p.date < windowDates[0])
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  if (recentPlanned.length) {
    const bits = recentPlanned.map(p => `${p.date} ${p.sport} ${p.duration_min ? Math.round(p.duration_min) + "min" : ""} (${p.status})`);
    lines.push(`Zuletzt von dir vorgeschlagene Einheiten + Status: ${bits.join(" | ")}`);
  }

  return lines.join("\n");
}

// Baut 0-2 Kontext-Zeilen aus vorhandenen Nutzer-Bewertungen/Notizen einer
// Vergleichsgruppe (js/data/workout-notes.js) - genutzt von der
// Workout-Auswertung UND von Lessons Learned, damit die KI echtes
// Nutzer-Feedback aus ähnlichen früheren Einheiten mit einbeziehen kann statt
// nur Zahlen zu sehen. Nur Einheiten mit tatsächlich eingetragener Bewertung/
// Notiz fließen ein - AI_RULES: nichts wird ergänzt oder geraten.
function workoutFeedbackContextLines(comparable) {
  const lines = [];
  if (typeof getWorkoutNote !== "function") return lines;
  const rated = comparable
    .map(o => ({ o, entry: getWorkoutNote(o.file) }))
    .filter(x => x.entry && (x.entry.rating != null || x.entry.note));
  if (!rated.length) return lines;

  const ratings = rated.map(x => x.entry.rating).filter(r => r != null);
  if (ratings.length) {
    const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    lines.push(`Ø Nutzer-Bewertung ähnlicher früherer Einheiten: ${fmtNum(avg, 1)}/5 Sterne (${ratings.length} bewertet)`);
  }
  const notes = rated.filter(x => x.entry.note).slice(0, 3).map(x => `"${x.entry.note}"`);
  if (notes.length) lines.push(`Notizen aus ähnlichen früheren Einheiten: ${notes.join(" | ")}`);

  return lines;
}

function buildWorkoutAnalysisContext(w, comparable) {
  const lines = [];
  const indoor = isIndoorRide(w);
  const paceOrSpeed = w.pace_min_per_km ? `${w.pace_min_per_km} min/km`
    : w.pace_min_per_100m ? `${w.pace_min_per_100m} min/100m`
    : w.speed_kmh != null ? `${fmtNum(w.speed_kmh, 1)} km/h${indoor ? " (virtuell)" : ""}` : null;

  const ownEntry = (typeof getWorkoutNote === "function") ? getWorkoutNote(w.file) : null;

  // Bei Indoor-Einheiten stehen die Leistungswerte VORNE und die Distanz wird
  // als virtuell markiert - das Modell soll die Einheit über Watt beurteilen,
  // nicht über simulierte Kilometer.
  const bits = [indoor ? `${w.sport} (Indoor/virtuell)` : w.sport, w._date ? fmtDateFull(w._date) : null];
  if (indoor) {
    if (w.avg_power_w != null) bits.push(`Ø ${Math.round(w.avg_power_w)} W`);
    if (w.normalized_power_w != null) bits.push(`NP ${Math.round(w.normalized_power_w)} W`);
    const kg = (typeof athleteProfile !== "undefined" && athleteProfile) ? athleteProfile.weightKg : null;
    if (kg && w.avg_power_w != null) bits.push(`${fmtNum(w.avg_power_w / kg, 2)} W/kg`);
    const ftp = (typeof athleteProfile !== "undefined" && athleteProfile) ? athleteProfile.ftpWatts : null;
    const np = w.normalized_power_w ?? w.avg_power_w;
    if (ftp && np != null) bits.push(`IF ${fmtNum(np / ftp, 2)} (${Math.round((np / ftp) * 100)}% FTP)`);
  }
  if (w.distance_km != null) bits.push(`${fmtNum(w.distance_km, 2)} km${indoor ? " (virtuell)" : ""}`);
  if (w.duration_min != null) bits.push(`${fmtNum(w.duration_min, 0)} min`);
  if (paceOrSpeed) bits.push(paceOrSpeed);
  if (w.avg_hr != null) bits.push(`Ø HF ${w.avg_hr}`);
  if (w.avg_cadence != null) bits.push(`Ø Kadenz ${Math.round(w.avg_cadence)}`);
  if (w.training_load != null) bits.push(`Load ${fmtNum(w.training_load, 0)}`);
  const effElev = (typeof effectiveElevationGainM === "function") ? effectiveElevationGainM(w) : w.elevation_gain_m;
  if (effElev != null && !indoor) bits.push(`${Math.round(effElev)} Hm${w.elevation_gain_m == null ? " (nachgetragen)" : ""}`);
  if (ownEntry && ownEntry.rating != null) bits.push(`eigene Bewertung ${ownEntry.rating}/5`);
  lines.push(`Diese Einheit: ${bits.filter(Boolean).join(" | ")}`);
  if (ownEntry && ownEntry.note) lines.push(`Eigene Notiz des Athleten zu dieser Einheit: "${ownEntry.note}"`);

  // Der Hinweis steht VOR der Vergleichsgruppe und den Kennzahlen, damit das
  // Modell die folgenden Zahlen von Anfang an richtig einordnet: sonst liest es
  // simulierte Kilometer/km-h als Leistungsfortschritt.
  if (indoor) {
    lines.push("Hinweis: Indoor-/virtuelle Radeinheit (Rollentrainer mit virtueller Plattform). Distanz, Geschwindigkeit und Höhenmeter werden von der Plattform simuliert und sind NICHT mit Outdoor-Werten vergleichbar - auf keinen Fall als Geschwindigkeits- oder Streckenfortschritt interpretieren. Belastbar sind ausschließlich Leistung (Ø Watt, NP, W/kg, % FTP), Herzfrequenz, Dauer und Trainingsbelastung. Beachte außerdem: auf der Rolle liegt der Puls bei gleicher Leistung wärmebedingt oft höher als draußen.");
  }

  const dates = comparable.map(o => o._date).filter(Boolean);
  const spanBits = dates.length ? [`vom ${fmtDate(new Date(Math.min(...dates)))} bis ${fmtDate(new Date(Math.max(...dates)))}`] : [];
  const groupNote = indoor
    ? " - die Gruppe enthält ausschließlich Indoor-Einheiten, die Ähnlichkeit wurde über die DAUER (±20%) bestimmt, nicht über die Distanz"
    : "";
  lines.push(`Vergleichsgruppe: ${comparable.length} ähnliche ${comparisonGroupLabel(w)}-Einheiten${spanBits.length ? " (" + spanBits.join("") + ")" : ""}${groupNote}`);

  const avgPaceSec = averageComparisonStat(comparable.map(o => ({ v: paceOrSpeedSeconds(o) })), "v");
  const thisPaceSec = paceOrSpeedSeconds(w);
  const avgLines = [];
  if (indoor) {
    // Indoor: Leistungs-Delta statt Geschwindigkeits-Delta - das ist die
    // eigentliche Anpassung der Auswertung, km/h wären hier bedeutungslos.
    const npKey = comparable.some(o => o.normalized_power_w != null) && w.normalized_power_w != null ? "normalized_power_w" : "avg_power_w";
    const avgPower = averageComparisonStat(comparable, npKey);
    const ownPower = w[npKey];
    if (avgPower != null && ownPower != null) {
      const deltaPct = Math.round(((ownPower - avgPower) / avgPower) * 100);
      avgLines.push(`Ø ${npKey === "normalized_power_w" ? "NP" : "Leistung"} ${Math.round(avgPower)} W (diese Einheit ${deltaPct >= 0 ? "+" : ""}${deltaPct}%)`);
    }
  } else if (avgPaceSec != null && thisPaceSec != null) {
    const deltaPct = Math.round(((thisPaceSec - avgPaceSec) / avgPaceSec) * -100); // positiv = schneller als Ø
    avgLines.push(`Ø Pace/Tempo ${secondsToPace(avgPaceSec)} (diese Einheit ${deltaPct >= 0 ? deltaPct + "% schneller" : Math.abs(deltaPct) + "% langsamer"})`);
  } else if (comparable.some(o => o.speed_kmh != null) && w.speed_kmh != null) {
    const avgSpeed = averageComparisonStat(comparable, "speed_kmh");
    if (avgSpeed) {
      const deltaPct = Math.round(((w.speed_kmh - avgSpeed) / avgSpeed) * 100);
      avgLines.push(`Ø Geschwindigkeit ${fmtNum(avgSpeed, 1)} km/h (diese Einheit ${deltaPct >= 0 ? "+" : ""}${deltaPct}%)`);
    }
  }
  const avgHr = averageComparisonStat(comparable, "avg_hr");
  if (avgHr != null && w.avg_hr != null) {
    const deltaHr = Math.round(w.avg_hr - avgHr);
    avgLines.push(`Ø HF ${Math.round(avgHr)} bpm (diese Einheit ${deltaHr >= 0 ? "+" : ""}${deltaHr})`);
  }
  const avgLoad = averageComparisonStat(comparable, "training_load");
  if (avgLoad != null && w.training_load != null) avgLines.push(`Ø Load ${fmtNum(avgLoad, 0)} (diese Einheit ${fmtNum(w.training_load, 0)})`);
  // Höhenmeter indoor weglassen: simuliert, also kein verwertbarer Vergleich.
  const avgElev = indoor ? null : averageComparisonStat(comparable, "elevation_gain_m");
  if (avgElev != null && effElev != null) avgLines.push(`Ø Höhenmeter ${Math.round(avgElev)} (diese Einheit ${Math.round(effElev)})`);
  const cadLine = cadenceComparisonLine(w, comparable);
  if (cadLine) avgLines.push(cadLine);
  if (avgLines.length) lines.push(avgLines.join(" | "));

  // Bereits im Detail-Modal derselben Einheit berechnete Kennzahlen
  // (js/analytics/workout-profile.js) - dieselbe Berechnung, jetzt auch als
  // Kontext für die KI-Auswertung statt nur visuell in der Kachel/im Chart.
  const loadStats = computeTrainingLoadStats(w);
  if (loadStats) {
    lines.push(`Trainingsbelastung: TRIMP ${loadStats.trimp} (${fmtNum(loadStats.trimpPerMin, 2)}/Min.) | Ø Herzfrequenzreserve ${fmtNum(loadStats.hrrPercent, 0)}% | Stress-Score ${loadStats.stressScore}`);
  }
  const negSplit = computeNegSplitPercent(w);
  if (negSplit != null) {
    lines.push(`Negativer Split: ${negSplit >= 0 ? "+" : ""}${fmtNum(negSplit, 1)}% (zweite Hälfte ${negSplit >= 0 ? "schneller" : "langsamer"} als erste)`);
  }

  lines.push(...workoutFeedbackContextLines(comparable));

  return lines.join("\n");
}

// Kontext fuer "Lessons Learned" EINER geplanten (noch nicht absolvierten)
// Einheit - vorausschauend statt rueckblickend: nutzt dieselbe
// Vergleichsgruppen-Logik wie die Workout-Auswertung (findComparableWorkouts
// toleriert auch ein Objekt ohne file/distance_km, siehe planned-workouts.js
// Schema), zusaetzlich aber bis zu 3 bereits vorhandene fruehere KI-Auswertungen
// (workoutAnalysisCache) aehnlicher Einheiten - so lernen Einheiten
// "voneinander", ohne dass fuer jede geplante Einheit neu wiederholt werden
// muss, was in der letzten Auswertung schon stand.
function buildLessonsContext(pw, comparable) {
  const lines = [];
  const bits = [pw.sport, pw.title, pw.duration_min != null ? `${pw.duration_min} min` : null, pw.intensity ? `Intensitaet ${pw.intensity}` : null];
  lines.push(`Geplante Einheit: ${bits.filter(Boolean).join(" | ")}`);
  if (pw.description) lines.push(`Geplante Beschreibung: ${pw.description}`);

  if (!comparable.length) {
    lines.push("Vergleichsgruppe: keine aehnlichen frueheren Einheiten gefunden (gleiche Sportart und Umgebung, Distanz/Dauer +/-20%).");
    return lines.join("\n");
  }

  const dates = comparable.map(o => o._date).filter(Boolean);
  const spanBits = dates.length ? [`vom ${fmtDate(new Date(Math.min(...dates)))} bis ${fmtDate(new Date(Math.max(...dates)))}`] : [];
  lines.push(`Vergleichsgruppe: ${comparable.length} aehnliche ${comparisonGroupLabel(pw)}-Einheiten${spanBits.length ? " (" + spanBits.join("") + ")" : ""}`);

  const avgPaceSec = averageComparisonStat(comparable.map(o => ({ v: paceOrSpeedSeconds(o) })), "v");
  if (avgPaceSec != null) lines.push(`Ø Pace/Tempo bisher: ${secondsToPace(avgPaceSec)}`);
  const avgHr = averageComparisonStat(comparable, "avg_hr");
  if (avgHr != null) lines.push(`Ø HF bisher: ${Math.round(avgHr)} bpm`);
  const avgLoad = averageComparisonStat(comparable, "training_load");
  if (avgLoad != null) lines.push(`Ø Load bisher: ${fmtNum(avgLoad, 0)}`);

  const priorAnalyses = comparable
    .map(o => (typeof workoutAnalysisCache !== "undefined" ? workoutAnalysisCache[o.file] : null))
    .filter(a => a && a.analysis)
    .slice(0, 3)
    .map(a => a.analysis.split(/\n\s*\n/)[0].slice(0, 300));
  if (priorAnalyses.length) {
    lines.push("Auszuege aus frueheren KI-Auswertungen aehnlicher Einheiten (bereits vorhanden, nicht neu erfinden):");
    priorAnalyses.forEach((a, i) => lines.push(`(${i + 1}) ${a}`));
  }

  lines.push(...workoutFeedbackContextLines(comparable));

  return lines.join("\n");
}

// Kontext fuer die kurze KI-Einordnung im "Trainingsbelastungsfokus"-Chart
// (Ist-Belastung letzte 7 Tage vs. hochgerechnete Soll-Belastung aus dem
// KI-Trainingsplan der naechsten 7 Tage) - nutzt ausschliesslich die bereits
// fertig berechneten Zahlen aus computeFocusForecast() (js/analytics/
// training-load.js), erfindet nichts selbst.
function buildFocusContext() {
  const f = computeFocusForecast();
  const lines = [];
  lines.push(`Tatsaechliche Trainingsbelastung letzte 7 Tage (Ist): ${f.istLoad}`);
  if (f.sollLoad != null) {
    lines.push(`Hochgerechnete geplante Belastung naechste 7 Tage (Soll, aus ${f.upcomingCount} geplanten Einheiten): ${f.sollLoad}`);
    const diffPct = f.istLoad > 0 ? Math.round(((f.sollLoad - f.istLoad) / f.istLoad) * 100) : null;
    if (diffPct != null) lines.push(`Differenz Soll vs. Ist: ${diffPct >= 0 ? "+" : ""}${diffPct}%`);
  } else {
    lines.push("Keine Soll-Hochrechnung moeglich (noch zu wenig Trainingshistorie mit Load-Werten fuer eine seriöse Schaetzung).");
  }
  if (f.tsb != null && f.tsbStatus) lines.push(`Aktueller Erholungsstatus (TSB): ${fmtNum(f.tsb, 0)} - ${f.tsbStatus.text}`);
  if (f.acwr != null && f.acwrStatus) lines.push(`Aktuelles Belastungsverhaeltnis (ACWR): ${fmtNum(f.acwr, 2)} - ${f.acwrStatus.text}`);
  return lines.join("\n");
}


// Kontext fuer die kurze KI-Zusammenfassung "aktueller Leistungszustand" im
// Coach-Tab (siehe buildPerformanceSummaryPrompt(), prompts.js) - der
// allgemeine Athletenkontext OHNE Ziel-Bezug (buildCompactContext(goal)),
// PLUS das bereits deterministisch berechnete Kurzverdikt aus
// computePerformanceState() (js/analytics/training-load.js) als fertige
// Einordnung, die die KI nur noch in Worte fassen, nicht neu bewerten soll
// (AI_RULES: "Analytics feed AI, AI doesn't calculate"). Nutzt trotzdem das
// Hauptevent als Kontext, falls eines hinterlegt ist (fuer "wie gut passt
// das gerade zum Ziel"), ohne dass die Zusammenfassung zwingend eines braucht.
function buildPerformanceSummaryContext() {
  const goal = typeof getPrimaryGoal === "function" ? getPrimaryGoal() : null;
  const lines = [buildCompactContext(goal)];
  const state = typeof computePerformanceState === "function" ? computePerformanceState() : null;
  if (state) {
    lines.push(`Bereits berechnetes Kurzverdikt: "${state.verdict}" (Fitness/CTL ${fmtNum(state.ctl, 1)}, Trend ${state.ctlDelta >= 0 ? "+" : ""}${fmtNum(state.ctlDelta, 1)} ggü. vor 4 Wochen).`);
  }
  return lines.join("\n\n");
}

// Fakten für die Empfehlungen "Heute / Diese Woche / Nächste Woche"
// (generateOutlook, js/ai/ollama.js). Jede Zahl stammt aus den vorhandenen
// Berechnungen - computePerformanceState() (Form, ACWR, Fitness), heutiger
// Erholungs-Check, wellnessDeviation() (Garmin), Hauptevent-Datum,
// Trainingsplan, Regelwerk (planRuleViolations) - und steht hier schon als
// fertiger Satz: dieselben Sätze bekommt die KI im Prompt und sieht der
// Athlet unter jeder Empfehlung ("Grundlage"). Fehlt ein Wert, fehlt der Satz.
function buildOutlookFacts() {
  const facts = { today: [], thisWeek: [], nextWeek: [], ruleHints: [] };
  const signed = (n, dec) => `${n >= 0 ? "+" : "-"}${fmtNum(Math.abs(n), dec)}`;
  const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  const todayKey = localDateStr(todayMid);
  const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return localDateStr(x); };
  const wk = weekStart(todayMid);
  const doneMin = (from, to) => Math.round(DATA.filter(w => w._date && localDateStr(w._date) >= from && localDateStr(w._date) <= to)
    .reduce((sum, w) => sum + (w.duration_min || 0), 0));
  const openPlan = (from, to) => plannedWorkouts.filter(p => p.status === "geplant" && p.date >= todayKey && p.date >= from && p.date <= to);
  const planSummary = list => `${list.length} ${list.length === 1 ? "Einheit" : "Einheiten"}, ${Math.round(list.reduce((sum, p) => sum + (Number(p.duration_min) || 0), 0))} min, davon ${list.filter(p => planIsHard({ ...p, duration_min: Number(p.duration_min) || 0 })).length} hart`;

  // Heute: Belastung/Form, Erholung (Selbsteinschätzung + Garmin), Plan
  const state = computePerformanceState();
  if (state) {
    facts.today.push(`Form (TSB) ${signed(state.tsb, 1)}: ${state.tsbStatus.text}`);
    if (state.acwr != null) facts.today.push(`Belastungsverhältnis (ACWR) ${fmtNum(state.acwr, 2)}: ${state.acwrStatus.text}`);
  } else {
    facts.today.push("Belastung und Form: noch zu wenige Trainings mit Belastungswert");
  }
  const rec = recoveryCheck.date === todayKey ? recoveryCheck : {};
  const recBits = [];
  if (rec.soreness) recBits.push(`Muskelkater ${RECOVERY_SORENESS_LABELS[rec.soreness]}`);
  if (rec.energy) recBits.push(`Energie ${RECOVERY_ENERGY_LABELS[rec.energy]}`);
  if (rec.injury === "yes") recBits.push(`Verletzung gemeldet${rec.injuryNote ? ` (${rec.injuryNote})` : ""}`);
  facts.today.push(recBits.length ? `Erholungs-Check heute: ${recBits.join(", ")}` : "Erholungs-Check heute: nicht ausgefüllt");
  const hrv = wellnessDeviation("hrv_ms");
  if (hrv) facts.today.push(`HRV (Garmin, ${fmtDate(new Date(hrv.date + "T00:00:00"))}): ${signed(Math.round(hrv.deltaPct), 0)} % gegenüber dem eigenen 30-Tage-Mittel`);
  const rhr = wellnessDeviation("resting_hr");
  if (rhr) facts.today.push(`Ruhepuls (Garmin, ${fmtDate(new Date(rhr.date + "T00:00:00"))}): ${signed(Math.round(rhr.value - rhr.baseline), 0)} Schläge gegenüber dem eigenen 30-Tage-Mittel`);
  const todayPlan = openPlan(todayKey, todayKey);
  facts.today.push(todayPlan.length
    ? `Heute geplant: ${todayPlan.map(p => [p.sport, p.duration_min != null ? `${Math.round(p.duration_min)} min` : "", p.intensity || ""].filter(Boolean).join(" ")).join(", ")}`
    : "Heute ist kein Training geplant");

  // Diese Woche: Umfang bisher/geplant, Vorwoche, Wettkampf
  facts.thisWeek.push(`Diese Woche bisher absolviert: ${doneMin(localDateStr(wk), todayKey)} min`);
  const restOfWeek = openPlan(localDateStr(wk), shift(wk, 6));
  facts.thisWeek.push(restOfWeek.length ? `Diese Woche noch geplant: ${planSummary(restOfWeek)}` : "Diese Woche ist nichts mehr geplant");
  facts.thisWeek.push(`Letzte Woche absolviert: ${doneMin(shift(wk, -7), shift(wk, -1))} min`);
  const goal = getPrimaryGoal();
  const daysUntil = goal && goal.date ? Math.round((new Date(goal.date + "T00:00:00") - todayMid) / 86400000) : null;
  if (daysUntil != null && daysUntil >= 0) {
    facts.thisWeek.push(`Wettkampf „${goal.name}“ in ${Math.floor(daysUntil / 7)} Wochen (${daysUntil} Tage), Phase jetzt: ${computeTrainingPhase(daysUntil).label}`);
  } else {
    facts.thisWeek.push("Kein Hauptevent mit Datum in der Zukunft");
  }

  // Nächste Woche: Plan, Phase, Fitness-Trend
  const nextWeek = openPlan(shift(wk, 7), shift(wk, 13));
  facts.nextWeek.push(nextWeek.length ? `Nächste Woche geplant: ${planSummary(nextWeek)}` : "Nächste Woche ist noch nichts geplant");
  if (daysUntil != null && daysUntil >= 0) {
    const nextPhase = getPhase(shift(wk, 7), goal);
    if (nextPhase) facts.nextWeek.push(`Phase nächste Woche: ${PERIOD_PHASES[nextPhase].label}`);
  }
  if (state) facts.nextWeek.push(`Fitness (CTL) ${fmtNum(state.ctl, 1)}, ${signed(state.ctlDelta, 1)} in den letzten 4 Wochen (${state.verdict})`);

  facts.ruleHints = planRuleViolations(plannedWorkouts).slice(0, 6).map(v => `${v.severity === "block" ? "Regelverstoß" : "Hinweis"}: ${v.text}`);
  return facts;
}
