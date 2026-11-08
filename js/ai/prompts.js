// Baut den fertigen Prompt-Text aus dem kompakten Kontext fuer den Ollama-Call.

function buildCoachPrompt(goal) {
  const ctx = buildCompactContext(goal);
  return `Du bist ein erfahrener Triathlon-Coach. Athletendaten (Bestzeiten* sind aus Streckendaten geschätzt, nicht exakt; VO2max ist ebenfalls eine Schätzung, siehe Methode in Klammern):

${ctx}

CTL=Fitness(42-Tage-Schnitt) ATL=Ermüdung(7-Tage-Schnitt) TSB=CTL−ATL(Form; negativ=müde) ACWR=akute÷chronische Belastung (0,8–1,3 optimal, >1,5 erhöhtes Risiko n. Gabbett 2016) Trainingsmonotonie=Ø Tagesbelastung÷Streuung über 7 Tage (>2,0 = zu eintönig n. Foster 1998, erhöht Übertrainingsrisiko trotz moderatem Umfang) Race-Readiness-Score=0-100, wie gut aktuell auf DIESES Ziel vorbereitet.

Alle Einordnungen (in Klammern hinter TSB/ACWR/Monotonie, sowie der Race-Readiness-Score selbst) sind bereits fertig berechnet - nicht selbst neu bewerten oder widersprechen, sondern als Basis nehmen und interpretieren.

Gib eine kurze, konkrete Trainingsempfehlung auf Deutsch:
1. Kurze Formeinschätzung (1-2 Sätze), die den Race-Readiness-Score und seinen schwächsten Faktor einordnet
2. 3-5 konkrete Fokuspunkte bis zum Ziel - bei Zielzeit/Unterdisziplinen: einschätzen, ob sie angesichts von VO2max/Bestzeiten realistisch wirkt (kein exaktes Rechnen, nur grobe Einordnung)
3. Grobe Wochenstruktur (Einheiten je Sportart, Intensitätsverteilung)
4. Bei kritischem ACWR/TSB/Monotonie (Status "erhöht"/"kritisch"/"auffällig" o.ä.): expliziter Warnhinweis, welche Anpassung das konkret bedeutet
5. Falls unter "Erholung heute" Muskelkater, wenig Energie oder eine Verletzung angegeben ist: explizit sagen, wie die Empfehlung dafür angepasst wird (z.B. Einheit tauschen, Intensität senken, Ruhetag einschieben, Arzt/Physio bei Verletzung) - nicht ignorieren.
6. Falls unter "Ernährungsziel heute"/"Wettkampf-Verpflegungsplan" Werte angegeben sind: bei Bedarf kurz darauf Bezug nehmen (z.B. Carb-Loading oder Fettstoffwechsel-Fokus erwähnen, falls das gerade relevant ist) - die Zahlen dort sind bereits fertig berechnet, NICHT selbst neue Gramm-/Kalorienangaben erfinden oder ihnen widersprechen.

Nur normaler Fließtext in kurzen Absätzen - KEIN Markdown (keine **, keine #-Überschriften, keine Aufzählungszeichen/nummerierten Listen), keine Tabellen/Code-Blöcke, max. ca. 240 Wörter.`;
}

// Baut den Prompt für die automatische Trainingsplan-Erstellung. Fordert
// striktes JSON an (Ollama wird zusätzlich mit format:"json" aufgerufen,
// siehe generateTrainingPlan in ollama.js) - die App parst/validiert das
// Ergebnis selbst (parsePlanResponse, js/ai/ollama.js) und übernimmt nie
// ungeprüft, was das Modell liefert.
function buildPlanPrompt(goal, windowDates) {
  const ctx = buildPlanContext(goal, windowDates);
  const sports = ["Schwimmen", "Rad", "Laufen"];
  if (athleteProfile.includeStrength) sports.push("Kraft");
  if (athleteProfile.includeMobility) sports.push("Mobility");

  return `Du bist ein erfahrener Triathlon-Coach und erstellst einen konkreten Trainingsplan für die nächsten ${windowDates.length} Tage. Athletendaten:

${ctx}

Regeln:
- Plane NUR Trainingstage aus dem Profil ("Trainingstage" oben) - an anderen Tagen keine Einheit vorschlagen (Ruhetag).
${buildPlanTrainingDaysRule(windowDates)}
- Sportarten ausschließlich aus: ${sports.join(", ")}. Schwimmen nur am angegebenen Schwimmtag, falls einer gesetzt ist. Lange Einheiten (Laufen/Rad) bevorzugt an den angegebenen "lange Einheit"-Tagen.
${typeof planStructureRuleText === "function" ? planStructureRuleText(planStructureSettings(athleteProfile, trainingProfile()), windowDates) : ""}
- Intensitätsverteilung passend zur Trainingsphase: in Grundlagenausdauer/Aufbau überwiegend "leicht" (polarisiert, ca. 80/20), in der Taper-Phase Umfang deutlich reduzieren, Intensität nur noch kurz und moderat halten.
- Bei "Erholung heute"/Erholungs-Logbuch mit Muskelkater, wenig Energie oder Verletzung: entsprechend leichter planen oder einen zusätzlichen Ruhetag einschieben.
- Bei "Zuletzt von dir vorgeschlagene Einheiten + Status": wiederholt übersprungene Einheiten nicht identisch wiederholen, sondern Umfang/Art anpassen.
- "Ernährungsziel heute"/"Wettkampf-Verpflegungsplan" sind reiner Kontext (z.B. um zu wissen, ob gerade Carb-Loading oder eine Fettstoffwechsel-fokussierte Grundlagenphase läuft) - im JSON-Ergebnis nicht wiederholen, das Schema hat dafür kein Feld.
- Nie einen exakten Trainingsload/TSS-Wert erfinden - nur "intensity": "leicht"|"mittel"|"hart" angeben, keine Zahl.
${typeof strengthPlanRule === "function" ? strengthPlanRule() : "- Bei \"Kraft\": \"exercises\"-Array mit 3-6 konkreten Übungen (Name, Sätze, Wiederholungen, kurzer Hinweis)."}
${mobilityPlanRule()}
${swimPlanRule()}
- Bei Rad/Laufen: "description" MUSS enthalten (a) eine kurze konkrete Struktur mit Einrollen/Hauptteil/Auslaufen (z.B. "10min Einrollen, 6x400m zügig mit 90s Pause, 10min Auslaufen") UND (b) den passenden Ziel-Bereich aus den oben angegebenen Zonen (Herzfrequenz-Zonen/Pace-Zonen/Leistungszonen) für die gewählte Intensität - z.B. "Hauptteil im Bereich Z2 Grundlage (128-142 bpm bzw. 5:20-5:45/km)". Nutze dafür AUSSCHLIESSLICH die im Kontext oben schon berechneten Zonenwerte, erfinde selbst keine Zahlen. Sind für eine Sportart keine Zonen im Kontext angegeben (kein Schwellenwert im Profil hinterlegt), einfach nur "leicht/mittel/hart" ohne Zahlen nennen.
- Bei Schwimmen/Rad/Laufen zusätzlich: falls unter "Zuletzt tatsächlich absolviert" oder in einer früheren Analyse erkennbar ist, dass ähnliche Einheiten dieser Sportart zuletzt zu hart/zu leicht gelaufen sind oder häufig übersprungen wurden, das kurz in der "description" berücksichtigen (z.B. "diesmal bewusst 5min kürzer, da die letzten beiden Tempoläufe übersprungen wurden").
- Kein "exercises"-Feld bei Schwimmen/Rad/Laufen (nur bei Kraft/Mobility, s.o.).
- Alle Textfelder ("description", "title", Übungs-"note") als reiner Klartext ohne Markdown (kein **, kein #, keine Aufzählungszeichen) - werden teilweise in einfachen Textfeldern angezeigt, in denen Markdown-Zeichen nur störend wären.
- Falls oben "Zusätzliche Wünsche des Athleten" angegeben sind: diese aktiv und konkret einplanen, sofern plausibel (z.B. "1x Zugseiltraining pro Woche" -> an einem passenden Tag als Kraft-Einheit mit einer entsprechenden Übung einbauen). Nicht plausibel Umsetzbares (z.B. widerspricht Trainingstagen/Sportart-Liste oben) einfach weglassen statt zu erzwingen.
- Falls oben ein "Streckenprofil" mit Hügeligkeit angegeben ist ("hügelig"/"bergig"): bei Rad-/Lauf-Einheiten in dieser Trainingsphase gezielt auch Anstiege/Höhenmeter einbauen (in der "description" erwähnen, z.B. "inkl. 2-3 längere Anstiege"), nicht nur bei "flach" ignorieren. Falls eine "Priorität" (A/B/C) angegeben ist: bei A-Zielen konsequenter auf das Renndatum hintrainieren (Taper ernster nehmen), bei B/C-Zielen mehr Spielraum für das eigentliche Grundlagentraining lassen. Eine "Wettkampf-Strategie-Notiz" ist zusätzlicher Kontext (z.B. Pacing-Plan) - falls relevant für die Trainingsgestaltung kurz berücksichtigen, sonst ignorieren.
- WICHTIG - Konsistenz zwischen den Feldern EINES Eintrags: "sport" muss exakt zu dem passen, was in "title"/"description" tatsächlich beschrieben wird (z.B. Zugseiltraining, Klimmzüge, Kniebeugen, Kreuzheben, Hanteltraining -> sport MUSS "Kraft" sein, niemals "Rad"/"Laufen"/"Schwimmen", auch wenn der Athlet an dem Tag sonst Rad fährt). "duration_min" muss der tatsächlichen Gesamtdauer entsprechen, die du selbst in "description" nennst (z.B. wenn "description" mit "20min ..." beginnt, muss duration_min=20 sein) - widersprüchliche Angaben zwischen den Feldern derselben Einheit sind ein Fehler.
- WICHTIG - Sicherheit: falls oben "Verletzungen/Einschränkungen des Athleten" angegeben sind, DIESE UNBEDINGT beachten - keine Übungen/Belastungen vorschlagen, die die genannte Einschränkung verschlimmern könnten (z.B. bei Knieproblemen keine tiefen Kniebeugen/Sprünge, bei Schulterproblemen kein Bankdrücken/Zugseiltraining über Kopf), stattdessen alternative Übungen wählen oder die Belastung entsprechend anpassen.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Form, keinerlei Text davor/danach, keine Code-Block-Markierung:
{"workouts":[{"date":"YYYY-MM-DD","sport":"Schwimmen|Rad|Laufen|Kraft|Mobility","title":"kurzer Titel","duration_min":60,"intensity":"leicht|mittel|hart","description":"...","distance_m":1800,"exercises":[{"name":"...","sets":3,"reps":"12","note":"..."}]}]}

"distance_m" nur bei sport="Schwimmen", "exercises" nur bei sport="Kraft"/"Mobility" angeben, sonst weglassen. Jedes "date" muss exakt eines der oben genannten ${windowDates.length} Zeitfenster-Daten sein. Kein Datum außerhalb, keine Duplikate am selben Tag+Sportart.`;
}

// Schwimmen in Metern statt mit Tempo-Vorgabe (Wunsch aus der Praxis: am
// Beckenrand zählt man Bahnen, nicht Sekunden pro 100 m). Richtwert aus der
// CSS (Schwellentempo) inkl. Pausen, ohne CSS 2:00 /100 m.
function swimMetersPer10Min() {
  const css = (typeof paceToSeconds === "function" && paceToSeconds(athleteProfile.swimCss)) || 120;
  return Math.max(200, Math.round(600 / (css * 1.3) * 100 / 50) * 50);
}

function swimPlanRule() {
  return `- Bei "Schwimmen": "description" in METERN statt Minuten und OHNE Tempo-Vorgabe (keine Zeiten pro 100 m, keine Pace-Zonen), z.B. "400 m einschwimmen locker, 6 × 50 m Technik, 8 × 100 m zügig mit 20 s Pause, 200 m ausschwimmen – zusammen 1.900 m". Die Intensität nur in Worten (locker, zügig, hart, Atemgefühl). Zusätzlich "distance_m" = Gesamtmeter als Zahl (Vielfaches von 50). Richtwert für diese Person: etwa ${swimMetersPer10Min()} m pro 10 Minuten inklusive Pausen - die Meter müssen zu "duration_min" passen.`;
}

// Die Trainingstage im Zeitfenster ausdrücklich nennen: Ohne diese Liste
// ließ die KI oft mehrere Trainingstage leer (Plan mit nur 2-3 Einheiten
// pro Woche, obwohl 6 Tage angegeben waren). Tage, an denen schon etwas
// geplant oder absolviert ist, zählen nicht als offen.
function buildPlanTrainingDaysRule(windowDates) {
  const days = (athleteProfile && athleteProfile.trainingDays) || [];
  if (!days.length) return "";
  const dow = ["so", "mo", "di", "mi", "do", "fr", "sa"];
  const dowFull = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const busy = new Set((plannedWorkouts || []).filter(p => p.sport !== "Mobility").map(p => p.date));
  (typeof DATA !== "undefined" ? DATA : []).forEach(w => { if (w._date) busy.add(localDateStr(w._date)); });
  const open = windowDates.filter(d => days.includes(dow[new Date(d + "T00:00:00").getDay()]) && !busy.has(d));
  if (!open.length) return "";
  return `- Offene Trainingstage im Zeitfenster: ${open.map(d => `${d} (${dowFull[new Date(d + "T00:00:00").getDay()]})`).join(", ")}. Plane an JEDEM davon mindestens eine Einheit - der Athlet hat diese Tage ausdrücklich zum Trainieren freigehalten. Einzige Ausnahmen: ein komplett freier Tag pro Woche (Mo-So), falls die Woche sonst keinen hätte, und Tage, an denen "Erholung heute" oder die Belastung einen Ruhetag nötig macht. Reicht der Zielumfang der Woche nicht für alle Tage, plane lieber kürzere lockere Einheiten (mindestens 20 min) statt Tage leer zu lassen.`;
}

function buildWorkoutAnalysisPrompt(w, comparable) {
  const ctx = buildWorkoutAnalysisContext(w, comparable);
  return `Du bist ein erfahrener Triathlon-Coach. Analysiere eine einzelne Trainingseinheit im Vergleich zu ähnlichen früheren Einheiten desselben Athleten (gleiche Sportart UND gleiche Umgebung - Indoor wird nur mit Indoor verglichen, Outdoor nur mit Outdoor -, ähnliche Distanz/Dauer):

${ctx}

Gib eine kurze Auswertung auf Deutsch:
1. Auffälligkeiten im Vergleich zur Vergleichsgruppe (z.B. ungewöhnliche Pace/HF-Kombination, überdurchschnittliche Anstrengung, deutliche Verbesserung/Verschlechterung, auffällige Kadenz). Falls angegeben: auch die Trainingsbelastung (TRIMP/Herzfrequenzreserve/Stress-Score) und der negative Split einordnen, aber nicht selbst nachrechnen - sind bereits fertig berechnet. Wenn nichts auffällt, das kurz so bestätigen statt etwas zu erfinden.
2. Falls eine eigene Notiz und/oder Bewertung des Athleten zu dieser oder ähnlichen früheren Einheiten angegeben ist: das subjektive Gefühl mit den objektiven Werten (Pace/HF/Load) in Bezug setzen (z.B. "fühlte sich hart an" bei unauffälligen Werten, oder eine niedrige Bewertung trotz guter Pace) - ist keine Notiz/Bewertung vorhanden, diesen Punkt einfach auslassen statt etwas zu vermuten.
3. Falls eine "Einordnung der Messwerte" angegeben ist: die 1-3 aussagekräftigsten Werte bewerten (gut/mittel/verbesserungswürdig und ob besser oder schlechter als sonst) und kurz in einfachen Worten erklären, was das bedeutet. Wenn der Athlet laut Notiz gezielt an etwas arbeitet (z. B. höhere Schrittfrequenz), genau dazu Rückmeldung geben, ob es wirkt. Die Richtwerte sind allgemeine Orientierung - der Vergleich mit den eigenen früheren Werten bei ähnlichem Tempo ist wichtiger.
4. 2-4 konkrete, sofort umsetzbare Tipps für die nächsten ähnlichen Einheiten.

Zeitlinie beachten (sehr wichtig):
- Die Vergleichsgruppe enthält nur Einheiten VOR dieser Einheit. Was unter "SEIT dieser Einheit schon absolviert" steht, geschah DANACH. Beschreibe spätere Einheiten nie als "damals" oder "früher".
- "Deine Notiz" ist ausschließlich die eigene Notiz zu DIESER Einheit. Notizen und Bewertungen anderer Einheiten immer mit ihrem Datum nennen und nie dieser Einheit zuschreiben.
- Deine Tipps müssen zum heutigen Stand passen: Empfiehl nichts, was seitdem schon erledigt wurde (z. B. keinen neuen Test, wenn danach schon einer gemacht wurde), und nutze die aktuellen Schwellenwerte im Profil bzw. die Ergebnisse späterer Tests.
- Ziehe die Körperwerte am Tag der Einheit (Schlaf, HRV, Ruhepuls) und die Belastung der Tage davor heran, wenn sie die Leistung erklären. Was nicht angegeben ist, nicht vermuten.

Nur normaler Fließtext in kurzen Absätzen - KEIN Markdown (keine **, keine #-Überschriften, keine Aufzählungszeichen/nummerierten Listen), keine Tabellen/Code-Blöcke, max. ca. 220 Wörter.`;
}

// Baut den Prompt fuer "Lessons Learned" EINER geplanten (noch nicht
// absolvierten) Einheit - vorausschauend: Muster aus aehnlichen frueheren
// Einheiten + ggf. bereits vorhandene KI-Auswertungen davon, als konkrete
// Tipps fuer die BEVORSTEHENDE Einheit (nicht rueckblickend wie
// buildWorkoutAnalysisPrompt).
function buildLessonsPrompt(pw, comparable) {
  const ctx = buildLessonsContext(pw, comparable);
  return `Du bist ein erfahrener Triathlon-Coach. Ein Athlet hat folgende Einheit geplant - hilf ihm, aus aehnlichen frueheren Einheiten zu lernen ("Lessons Learned"):

${ctx}

Gib eine kurze, vorausschauende Einordnung auf Deutsch:
1. Falls eine Vergleichsgruppe vorhanden ist: 1-2 Saetze zu Mustern aus den frueheren aehnlichen Einheiten (z.B. wiederkehrende Pace-/HF-Auffaelligkeiten, was in frueheren Auswertungen schon aufgefallen ist, oder wiederkehrende eigene Notizen/Bewertungen des Athleten - NICHT einfach wiederholen, sondern daraus ableiten, was fuer DIESE Einheit relevant ist).
2. 2-3 konkrete Hinweise, worauf der Athlet bei dieser bevorstehenden Einheit besonders achten sollte.
3. Falls KEINE Vergleichsgruppe vorhanden ist: das ehrlich so sagen (keine Muster erfinden) und stattdessen 1-2 allgemeine, aber konkrete Tipps fuer diese Sportart/Intensitaet geben.

Nur normaler Fließtext in kurzen Absaetzen - KEIN Markdown (keine **, keine #-Ueberschriften, keine Aufzaehlungszeichen/nummerierten Listen), keine Tabellen/Code-Bloecke, max. ca. 150 Wörter.`;
}

// Prompt fuer eine "Kuerzere Variante" oder "Alternative Einheit" EINER
// geplanten Einheit (Dropdown im Bearbeiten-Dialog, js/components/
// training-plan.js) - nutzt bewusst denselben Kontext-Baustein wie die
// normale Trainingsplan-Erstellung (buildPlanContext), nur auf den einen
// betroffenen Tag beschraenkt, und dasselbe Antwortformat (ein "workouts"-
// Array mit einem Eintrag), damit parsePlanResponse() unveraendert
// wiederverwendet werden kann statt einen eigenen Parser zu brauchen.
function buildRegeneratePrompt(pw, mode, goal) {
  const ctx = buildPlanContext(goal, [pw.date]);
  const sports = ["Schwimmen", "Rad", "Laufen"];
  if (athleteProfile.includeStrength) sports.push("Kraft");
  if (athleteProfile.includeMobility) sports.push("Mobility");

  const bisher = `${pw.sport}${pw.title ? " – " + pw.title : ""}, ${pw.duration_min != null ? pw.duration_min + " min" : "Dauer offen"}${pw.intensity ? ", Intensität " + pw.intensity : ""}${pw.description ? " – " + pw.description : ""}`;

  const modeInstruction = mode === "shorter"
    ? `Erstelle eine KÜRZERE Variante derselben Einheit: gleiche Sportart (${pw.sport}), gleicher Charakter/Fokus wie bisher, aber nur ca. 40-60% der bisherigen Dauer${pw.duration_min != null ? ` (bisher ${pw.duration_min} min)` : ""} - z.B. für einen Tag mit wenig Zeit.`
    : `Erstelle eine ALTERNATIVE Einheit für denselben Tag als Ersatz für die bisherige - falls sinnvoll (z.B. bei Ermüdung/keine Lust auf die bisherige Sportart) auch mit anderem Fokus oder anderer Sportart aus: ${sports.join(", ")}, ansonsten ähnliche Gesamtdauer wie bisher${pw.duration_min != null ? ` (${pw.duration_min} min)` : ""}.`;

  return `Du bist ein erfahrener Triathlon-Coach. Ein Athlet hat für ${pw.date} folgende Einheit geplant und möchte stattdessen eine Alternative vorgeschlagen bekommen:

Bisher geplant: ${bisher}

${ctx}

${modeInstruction}

Regeln:
- Sportart ausschließlich aus: ${sports.join(", ")}.
- Rad/Laufen: Nutze für den Zielbereich (Herzfrequenz/Pace/Leistung) AUSSCHLIESSLICH die oben angegebenen Zonenwerte, erfinde selbst keine Zahlen. Sind keine Zonen angegeben, nur "leicht/mittel/hart" ohne Zahlen nennen.
${swimPlanRule()}
${typeof strengthPlanRule === "function" ? strengthPlanRule() : "- Bei Kraft: \"exercises\"-Array mit 3-6 konkreten Übungen."} Sonst (Schwimmen/Rad/Laufen) kein "exercises"-Feld.
${mobilityPlanRule()}
- Alle Textfelder als reiner Klartext ohne Markdown (kein **, kein #, keine Aufzählungszeichen).
- Falls oben "Zusätzliche Wünsche des Athleten" angegeben sind, nach Möglichkeit berücksichtigen.
- WICHTIG - Konsistenz: "sport" muss exakt zur tatsächlichen Aktivität in "title"/"description" passen (z.B. Zugseiltraining/Klimmzüge/Kniebeugen -> sport MUSS "Kraft" sein), und "duration_min" muss der in "description" genannten Gesamtdauer entsprechen, falls dort eine genannt wird.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Form, keinerlei Text davor/danach, keine Code-Block-Markierung:
{"workouts":[{"date":"${pw.date}","sport":"...","title":"kurzer Titel","duration_min":45,"intensity":"leicht|mittel|hart","description":"...","distance_m":1800,"exercises":[{"name":"...","sets":3,"reps":"12","note":"..."}]}]}

"distance_m" nur bei sport="Schwimmen", "exercises" nur bei sport="Kraft"/"Mobility" angeben, sonst weglassen. Genau EIN Eintrag im Array, mit date="${pw.date}".`;
}

// Prompt fuer die kurze KI-Einordnung im "Trainingsbelastungsfokus"-Chart
// (Dashboard) - Ist vs. Soll der naechsten/letzten 7 Tage, siehe
// buildFocusContext(). Bewusst kurz gehalten (Chart-Kachel, kein eigener
// Dialog wie bei Lessons Learned).
function buildFocusPrompt() {
  const ctx = buildFocusContext();
  return `Du bist ein erfahrener Triathlon-Coach. Hier ist ein kurzer Ist/Soll-Vergleich der Trainingsbelastung eines Athleten:

${ctx}

Gib eine kurze Einordnung auf Deutsch (max. ca. 100 Wörter):
1. Wie die tatsaechliche Belastung der letzten 7 Tage im Vergleich zur geplanten Belastung der naechsten 7 Tage einzuordnen ist (z.B. deutlicher Anstieg/Rückgang, passender Aufbau, zu sprunghaft).
2. Falls TSB/ACWR-Werte angegeben sind: kurz einbeziehen, ob der geplante Anstieg/die geplante Reduktion angesichts des aktuellen Erholungsstatus sinnvoll erscheint.
3. Nutze AUSSCHLIESSLICH die oben angegebenen Zahlen - erfinde keine weiteren Werte. Ist keine Soll-Hochrechnung vorhanden, das kurz so benennen statt zu spekulieren.

Nur normaler Fließtext in 1-2 kurzen Absaetzen - KEIN Markdown (keine **, keine #-Ueberschriften, keine Aufzaehlungszeichen/nummerierten Listen), keine Tabellen/Code-Bloecke.`;
}


// Prompt fuer die kurze KI-Zusammenfassung "aktueller Leistungszustand" im
// Coach-Tab (Kachel unter Form/Streak/Hauptevent/Naechstes Training) - freier
// Text statt einer weiteren Zahlen-Kachel, siehe buildPerformanceSummaryContext()
// (context-builder.js). Bewusst sehr kurz (Kurzueberblick-Kachel, kein
// eigener Dialog wie bei der Ziel-Empfehlung).
function buildPerformanceSummaryPrompt() {
  const ctx = buildPerformanceSummaryContext();
  return `Du bist ein erfahrener Triathlon-Coach. Hier ist der aktuelle Trainingszustand eines Athleten:

${ctx}

Fasse den aktuellen Leistungszustand in einer kurzen, praezisen Zusammenfassung auf Deutsch zusammen (max. ca. 80 Woerter, 2-4 Saetze, EIN einziger Absatz):
- Wie die Form (TSB), Fitness-Trend (CTL) und das Verletzungsrisiko (ACWR) gerade zusammenspielen - nutze dafuer das oben bereits berechnete Kurzverdikt als Basis, nicht selbst neu bewerten oder widersprechen.
- Falls ein Ziel/Hauptevent angegeben ist: kurz einordnen, ob der aktuelle Zustand dazu passt (z.B. rechtzeitig im Aufbau, oder Taper faellig).
- Falls unter "Erholung heute" Muskelkater, wenig Energie oder eine Verletzung angegeben ist, das kurz erwaehnen.
- Auf den Punkt gebracht, keine Wiederholung der reinen Zahlen (die stehen bereits in den Kacheln daneben) - stattdessen die Einordnung/Bedeutung fuer den Athleten in Worten.

Nur normaler Fliesstext - KEIN Markdown (keine **, keine #-Ueberschriften, keine Aufzaehlungszeichen/nummerierten Listen), keine Tabellen/Code-Bloecke.`;
}

// Ergänzung zum Trainingsplan-Prompt (generateTrainingPlan, js/ai/ollama.js):
// feste Terminwünsche des Athleten (js/data/plan-wishes.js) für Tage im
// Planungsfenster. Ohne Wünsche ein leerer Text.
function buildPlanWishesPrompt(wishes) {
  if (!wishes || !wishes.length) return "";
  const lines = wishes.map(w => {
    const weekday = new Date(w.date + "T00:00:00").toLocaleDateString("de-DE", { weekday: "long" });
    return `- ${w.date} (${weekday}): ${w.sport}, ${w.duration_min} min${w.note ? `, Notiz des Athleten: "${w.note}"` : ""}`;
  });
  return `

Feste Terminwünsche des Athleten - genau so einplanen (gleiches Datum, gleiche Sportart, diese Dauer), auch wenn der Tag laut Profil kein Trainingstag ist, und die übrigen Einheiten darauf abstimmen (z.B. keine harte Einheit direkt davor oder danach):
${lines.join("\n")}`;
}

// Ergänzung zum Trainingsplan-Prompt für "Sag dem Coach Bescheid"
// (replanFromCoachNote, js/ai/ollama.js): die Nachricht des Athleten und der
// bisherige Plan im Zeitfenster. Die Antwort bekommt zusätzlich ein Feld
// "antwort" (1-2 Sätze an den Athleten).
function buildCoachNotePrompt(note, oldPlan, windowDates) {
  const today = windowDates[0];
  const weekday = d => new Date(d + "T00:00:00").toLocaleDateString("de-DE", { weekday: "long" });
  const lines = oldPlan.length
    ? oldPlan.map(p => `- ${p.date} (${weekday(p.date)}): ${p.sport} – ${p.title || p.sport}, ${p.duration_min != null ? p.duration_min + " min" : "Dauer offen"}${p.intensity ? ", " + p.intensity : ""}${p.description ? " – " + p.description : ""}`)
    : ["- (in diesem Zeitraum war noch nichts geplant)"];
  return `

Bisheriger Plan in diesem Zeitraum (heute ist ${today}, ${weekday(today)}):
${lines.join("\n")}

Nachricht des Athleten an dich: "${String(note).replace(/"/g, "'")}"

Setze diese Nachricht um und gib den kompletten Plan für ALLE ${windowDates.length} Tage im Zeitfenster zurück:
- Die Nachricht hat Vorrang vor den Trainingstagen, Schwimmtagen und dem Tagesraster im Profil (z.B. "heute spontan 45 min schwimmen" -> heute Schwimmen, 45 min, auch wenn heute kein Trainings- oder Schwimmtag ist).
- Ändere nur, was dafür nötig ist: übrige Einheiten möglichst unverändert übernehmen (gleiche Sportart, Dauer, Beschreibung), nur verschieben oder anpassen, wenn sonst die Belastung zu hoch wird (z.B. zwei harte Einheiten direkt hintereinander) oder die Nachricht es verlangt.
- Was nicht mehr im Plan stehen soll, einfach weglassen.
- Zusätzlich das Feld "antwort": 1-2 kurze Sätze an den Athleten (du-Form, Klartext), was du geändert hast und warum.

Antwortformat diesmal: {"antwort":"...","workouts":[...]} - "workouts" genau wie oben beschrieben, darf leer sein, wenn im ganzen Zeitraum nichts geplant sein soll.`;
}

// Ergänzung zum Trainingsplan-Prompt: die festen Regeln des Regelwerks als
// Text (planRulesText, js/analytics/plan-rules.js) - dieselben Zahlen, mit
// denen generateTrainingPlan() den Vorschlag danach prüft.
function buildPlanRulesPrompt(goal) {
  return `

Feste Trainingsregeln - dein Plan wird danach automatisch geprüft (zusammen mit den schon geplanten und den zuletzt absolvierten Einheiten); Verstöße werden korrigiert oder der Plan wird verworfen:
${planRulesText(goal)}`;
}

// Zweiter Versuch der Trainingsplan-Erstellung: diese Regelverstöße hatte der
// erste Vorschlag (Texte aus validatePlan()). Ohne Verstöße ein leerer Text.
function buildPlanRetryPrompt(violations) {
  if (!violations || !violations.length) return "";
  return `

Dein letzter Vorschlag verstieß gegen diese Regeln. Erstelle den Plan komplett neu und vermeide genau diese Fehler:
${violations.map(v => "- " + v.text).join("\n")}`;
}

// KI-Empfehlungen "Heute / Diese Woche / Nächste Woche" (Coach-Tab,
// generateOutlook in js/ai/ollama.js). Alle Zahlen stehen fertig berechnet
// in `facts` (buildOutlookFacts, context-builder.js); die KI ordnet nur ein.
// Antwort als JSON, damit jede Empfehlung ihre eigene Begründung bekommt.
function buildOutlookPrompt(facts, goal) {
  const section = (title, lines) => `${title}:\n${lines.map(l => "- " + l).join("\n")}`;
  return `Du bist ein erfahrener Triathlon-Coach. Hier sind fertig berechnete Fakten zu einem Athleten:

${section("Heute", facts.today)}

${section("Diese Woche", facts.thisWeek)}

${section("Nächste Woche", facts.nextWeek)}
${facts.ruleHints.length ? `\n${section("Hinweise des Regelwerks zum aktuellen Trainingsplan", facts.ruleHints)}\n` : ""}
Feste Trainingsregeln, an die sich jede Empfehlung halten muss:
${planRulesText(goal)}

Gib drei kurze Empfehlungen auf Deutsch: für heute, für diese Woche und für nächste Woche. Je Empfehlung:
- "empfehlung": 1-2 Sätze, konkret (was trainieren oder lieber nicht, wie intensiv, ob der geplante Plan so passt). Zahlen hier höchstens als Trainingsdauer in Minuten.
- "begruendung": 1-2 Sätze, warum - mit Bezug auf Belastung/Form (ACWR, TSB), Erholung (Erholungs-Check, Garmin-Werte) und den Wettkampf, soweit oben Fakten dazu stehen.
WICHTIG: In "begruendung" ausschließlich Zahlen verwenden, die oben in den Fakten stehen - keine eigenen Zahlen, Prozentwerte, Zeiten oder Pulswerte erfinden oder umrechnen. Fehlt eine Angabe, lass sie weg statt zu schätzen.
Alle Texte als reiner Klartext ohne Markdown.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Form, keinerlei Text davor/danach:
{"heute":{"empfehlung":"...","begruendung":"..."},"diese_woche":{"empfehlung":"...","begruendung":"..."},"naechste_woche":{"empfehlung":"...","begruendung":"..."}}`;
}

// Mobility im Trainingsplan: nur Übungen aus der Sammlung (mit Zeichnung),
// passend zum Trainingsprofil - parsePlanResponse übernimmt nur gültige ids.
function mobilityPlanRule() {
  if (typeof allowedMobilityExercises !== "function") return "- Bei \"Mobility\": \"exercises\"-Array mit 4-8 Übungen (Name, Wiederholungen, kurzer Hinweis).";
  const allowed = allowedMobilityExercises(trainingProfile(), mobilityPainfulIds(todayStr()));
  const list = allowed.map(ex => `${ex.id} (${ex.name})`).join(", ");
  return `- Bei "Mobility": "exercises"-Array mit 4-8 Übungen AUSSCHLIESSLICH aus dieser Liste, je Eintrag {"id": exakt die id, "name": Name, "seconds": Dauer je Seite, "reps": z.B. "45 s je Seite", "note": kurzer Tipp}. Erlaubt: ${list}. Dauer passend zum Mobility-Wunsch im Profil. WICHTIG: Die Übungen müssen zusammen "duration_min" ergeben. Rechnung je Übung: seconds (bei "je Seite" doppelt) + 10 s Wechsel. Beispiel 10 Minuten: 5 Übungen à 45 s je Seite ≈ 10 Min. Dehnungen mindestens 30 s halten, höchstens 90 s.`;
}

// KI-Tages-Check (js/components/plan-check.js): prüft NUR die fordernden
// Einheiten von heute/morgen gegen die aktuelle Verfassung. Bewusst kompakt
// (kein kompletter Coach-Kontext, keine Bestzeiten/Ernährung) - aber mit
// allem, was für "passt die Einheit heute?" zählt: Belastung, Erholung,
// Garmin-Nacht, letzte 7 Tage, verpasste Einheiten, Plan der Woche, was das
// Regelwerk schon geändert hat, Zonen nur der betroffenen Sportarten.
function buildDailyCheckContext(goal, candidates, signals, guardEntry) {
  const now = new Date();
  const todayKey = localDateStr(now);
  const dayFmt = d => new Date(d + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
  const n = (x, d = 0) => (x == null || !isFinite(x) ? "–" : fmtNum(x, d));
  const lines = [];
  lines.push(`Heute: ${now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}, ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} Uhr`);

  if (goal) {
    const days = goal.date ? Math.round((new Date(goal.date + "T00:00:00") - new Date(todayKey + "T00:00:00")) / 86400000) : null;
    const phase = goal.date && typeof getPhase === "function" ? getPhase(now, goal) : null;
    const raceBits = typeof goalRaceBits === "function" ? goalRaceBits(goal) : [];
    lines.push(`Ziel: ${goal.name}${goal.sport ? ` (${[goal.sport, ...raceBits].join(", ")})` : ""}${goal.date ? `, am ${goal.date}, in ${days} Tagen` : ""}${phase && PERIOD_PHASES[phase] ? `, Phase ${PERIOD_PHASES[phase].label}` : ""}`);
    const targets = goal.date ? getWeeklyTargets(goal, plannedWorkouts, DATA) : null;
    const wk = targets && targets.weeks[0];
    if (wk) lines.push(`Diese Woche (Mo-So): ${PERIOD_WEEK_LABELS[wk.type] || wk.type}${wk.targetMin != null ? `, Zielumfang ${wk.targetMin} min` : ""}, absolviert ${wk.doneMin} min, noch geplant ${wk.plannedMin} min`);
  }

  const series = typeof computeLoadSeries === "function" ? computeLoadSeries() : null;
  if (series && series.length) {
    const last = series[series.length - 1];
    const acwr = last.ctl > 0.5 ? last.atl / last.ctl : null;
    const mono = typeof computeMonotonyStrainSeries === "function" ? computeMonotonyStrainSeries() : null;
    const m = mono && mono.length ? mono[mono.length - 1].monotony : null;
    const st = (f, v) => { const s = f(v); return s ? ` (${s.text})` : ""; };
    lines.push(`Belastung: Fitness CTL ${n(last.ctl)}, Ermüdung ATL ${n(last.atl)}, Form TSB ${n(last.tsb)}${st(tsbStatusLabel, last.tsb)}, ACWR ${n(acwr, 2)}${st(acwrStatusLabel, acwr)}${m != null ? `, Monotonie ${n(m, 1)}${st(monotonyStatusLabel, m)}` : ""}`);
  }

  const rc = typeof recoveryCheck !== "undefined" && recoveryCheck && recoveryCheck.date === todayKey ? recoveryCheck : null;
  const rcBits = [];
  if (rc && rc.soreness) rcBits.push(`Muskelkater ${RECOVERY_SORENESS_LABELS[rc.soreness]}${rc.sorenessLocation ? ` (${rc.sorenessLocation})` : ""}`);
  if (rc && rc.energy) rcBits.push(`Energie ${RECOVERY_ENERGY_LABELS[rc.energy]}`);
  if (rc && rc.injury === "yes") rcBits.push(`Verletzung${rc.injuryNote ? `: ${rc.injuryNote}` : ""}`);
  lines.push(`Erholungs-Check heute (eigenes Gefühl): ${rcBits.length ? rcBits.join(", ") : "nicht ausgefüllt"}`);

  const garmin = typeof garminRecoveryBits === "function" ? garminRecoveryBits().filter(b => !/^Schritte/.test(b)) : [];
  const night = typeof latestWellness === "function" ? (latestWellness("sleep_min", 3) || latestWellness("hrv_ms", 3)) : null;
  lines.push(garmin.length ? `Garmin${night ? ` (Nacht zum ${dayFmt(night.date)})` : ""}: ${garmin.join(" | ")}` : "Garmin: keine aktuellen Werte");

  const from = new Date(now.getTime() - 7 * 86400000);
  const recent = (DATA || []).filter(w => w._date && w._date >= from).sort((a, b) => a._date - b._date);
  lines.push(`Letzte 7 Tage absolviert: ${recent.length ? recent.map(w => `${dayFmt(localDateStr(w._date))} ${w.sport} ${Math.round(w.duration_min || 0)} min${w.training_load != null ? `, Load ${Math.round(w.training_load)}` : ""}${w.avg_hr ? `, Ø HF ${Math.round(w.avg_hr)}` : ""}`).join("; ") : "nichts"}`);

  const missed = typeof planCheckMissed === "function" ? planCheckMissed(todayKey) : [];
  if (missed.length) lines.push(`Verpasst oder übersprungen (letzte 3 Tage): ${missed.map(p => `${dayFmt(p.date)} ${p.sport} ${p.duration_min} min ${p.intensity || ""}`.trim()).join("; ")}`);

  const ids = new Set(candidates.map(p => p.id));
  const until = planShiftDay(todayKey, 6);
  const plan = (plannedWorkouts || []).filter(p => p.date >= todayKey && p.date <= until && p.status === "geplant").sort((a, b) => a.date.localeCompare(b.date));
  lines.push(`Plan der nächsten 7 Tage (zu prüfen sind nur die Einheiten mit ID):\n${plan.map(p => `- ${dayFmt(p.date)}: ${p.sport} „${p.title || p.sport}“, ${p.duration_min} min, ${p.intensity || "Intensität offen"}${ids.has(p.id) ? ` [ID ${p.id}]${p.description ? ` – ${String(p.description).slice(0, 160)}` : ""}` : ""}`).join("\n") || "- nichts"}`);

  const findings = [...signals.gate.reasons, ...signals.strain, ...signals.signs];
  if (findings.length) lines.push(`Auffällig laut fester Regeln: ${findings.join("; ")}`);
  if (guardEntry && guardEntry.items.length) lines.push(`Vom Regelwerk heute schon geändert: ${guardEntry.items.map(i => `${i.day}: ${i.text}`).join("; ")}`);

  const sports = new Set(candidates.map(p => p.sport));
  const zoneKey = { Laufen: /^Lauf/, Rad: /^Rad/, Schwimmen: /^Schwimm/ };
  const zones = typeof formatZonesForContext === "function" ? formatZonesForContext().filter(l => /^Herzfrequenz/.test(l) || [...sports].some(sp => zoneKey[sp] && zoneKey[sp].test(l))) : [];
  zones.forEach(l => lines.push(l));
  if (athleteProfile && athleteProfile.limitations && athleteProfile.limitations.trim()) lines.push(`Einschränkungen des Athleten: ${athleteProfile.limitations.trim()}`);
  return lines.join("\n");
}

function buildDailyCheckPrompt(goal, candidates, signals, guardEntry) {
  return `Du bist ein erfahrener Triathlon-Coach und machst den täglichen Sicherheits-Check des Trainingsplans: Passen die Einheiten von heute und morgen zur aktuellen Verfassung des Athleten?

${buildDailyCheckContext(goal, candidates, signals, guardEntry)}

So entscheidest du für JEDE Einheit mit ID:
- "behalten", wenn Gefühl, Garmin-Werte und Belastung im normalen Bereich sind. Im Zweifel behalten - jede unnötige Änderung kostet Trainingswirkung, und die festen Regeln haben die klaren Fälle schon abgefangen.
- "anpassen" nur bei einem klaren Grund aus den Daten oben: mehrere Erholungswerte gleichzeitig schlecht (z. B. kurzer Schlaf UND HRV unter dem Schnitt UND hoher Ruhepuls), Gefühl und Werte zeigen beide Müdigkeit, eine harte Einheit direkt nach einem sehr belastenden Tag, eine verpasste Einheit, die jetzt nicht nachgeholt werden darf, oder eine Einschränkung, die zur Sportart nicht passt. Anpassen heißt NUR leichter und/oder kürzer (mindestens 15 min); eine Ausdauereinheit darf gegen eine andere getauscht werden (z. B. Rad statt Laufen bei schweren Beinen). Nie härter, nie länger, keine neue Einheit.
- "ruhetag" nur, wenn Training heute/morgen eher schadet (z. B. Verletzung, deutliche Krankheitszeichen wie erhöhte Temperatur plus erhöhter Ruhepuls).
- Bei "anpassen": sport, title, duration_min, intensity und eine kurze "description" (Ablauf mit Einrollen/Hauptteil/Auslaufen; Zielbereich nur aus den Zonen oben, sonst ohne Zahlen).
- "grund": 1 kurzer Satz in du-Form, warum. "pruefung": 1-2 kurze Sätze an den Athleten, wie es heute aussieht und was das für sein Training bedeutet.
WICHTIG: Nur Zahlen verwenden, die oben stehen - nichts erfinden oder umrechnen. Reiner Klartext ohne Markdown.

Antworte AUSSCHLIESSLICH mit JSON: {"pruefung":"...","einheiten":[{"id":"...","entscheidung":"behalten|anpassen|ruhetag","sport":"...","title":"...","duration_min":45,"intensity":"leicht|mittel|hart","description":"...","grund":"..."}]}`;
}
