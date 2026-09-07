// Automatische Risiko-Kontrolle (Konzept siehe CHANGE_REQUESTS.md): rein
// deterministische Prüfung von ACWR/TSB/Trainingsmonotonie + heutigem
// Erholungs-Check - KEINE KI-Anfrage. Nutzt ausschließlich bereits
// vorhandene Berechnungen (computeLoadSeries/computeMonotonyStrainSeries,
// js/analytics/training-load.js) wieder, statt irgendetwas neu herzuleiten
// (AI_RULES Regel 5). Das Ergebnis entscheidet in js/components/risk-adjust.js,
// ob überhaupt eine (kostenpflichtige) KI-Anfrage für einen Anpassungs-
// vorschlag ausgelöst wird - an den meisten Tagen (alles im grünen Bereich)
// bleibt es bei dieser einen, kostenlosen Berechnung.
function computeCurrentRiskStatus() {
  const series = computeLoadSeries();
  if (!series || !series.length) return null;
  const last = series[series.length - 1];
  const acwr = last.ctl > 0.5 ? last.atl / last.ctl : null;
  const acwrStatus = acwrStatusLabel(acwr);
  const tsbStatus = tsbStatusLabel(last.tsb);

  const monoSeries = computeMonotonyStrainSeries();
  const monotony = (monoSeries && monoSeries.length) ? monoSeries[monoSeries.length - 1].monotony : null;
  const monoStatus = monotonyStatusLabel(monotony);

  const critical = [];
  if (acwrStatus && acwrStatus.cls === "risk") critical.push({ key: "acwr", text: `Belastungsverhältnis (ACWR ${fmtNum(acwr, 2)}) — ${acwrStatus.text}` });
  if (tsbStatus && tsbStatus.cls === "risk") critical.push({ key: "tsb", text: `Form (TSB ${fmtNum(last.tsb, 0)}) — ${tsbStatus.text}` });
  if (monoStatus && monoStatus.cls === "risk") critical.push({ key: "monotony", text: `Trainingsmonotonie — ${monoStatus.text}` });

  // Heutiger Erholungs-Check (js/data/health.js) - eine gemeldete Verletzung
  // ist immer kritisch, unabhängig von den PMC-Werten oben.
  if (typeof recoveryCheck !== "undefined" && recoveryCheck && recoveryCheck.date === todayStr() && recoveryCheck.injury === "yes") {
    critical.push({ key: "injury", text: `Erholungs-Check heute: Verletzung gemeldet${recoveryCheck.injuryNote ? " (" + recoveryCheck.injuryNote + ")" : ""}` });
  }

  return { acwr, acwrStatus, tsb: last.tsb, tsbStatus, monotony, monoStatus, critical };
}
