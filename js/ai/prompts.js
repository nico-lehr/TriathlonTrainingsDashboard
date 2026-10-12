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
- Sportarten ausschließlich aus: ${sports.join(", ")}. Schwimmen nur am angegebenen Schwimmtag, falls einer gesetzt ist. Lange Einheiten (Laufen/Rad) bevorzugt an den angegebenen "lange Einheit"-Tagen.
- Intensitätsverteilung passend zur Trainingsphase: in Grundlagenausdauer/Aufbau überwiegend "leicht" (polarisiert, ca. 80/20), in der Taper-Phase Umfang deutlich reduzieren, Intensität nur noch kurz und moderat halten.
- Bei "Erholung heute"/Erholungs-Logbuch mit Muskelkater, wenig Energie oder Verletzung: entsprechend leichter planen oder einen zusätzlichen Ruhetag einschieben.
- Bei "Zuletzt von dir vorgeschlagene Einheiten + Status": wiederholt übersprungene Einheiten nicht identisch wiederholen, sondern Umfang/Art anpassen.
- "Ernährungsziel heute"/"Wettkampf-Verpflegungsplan" sind reiner Kontext (z.B. um zu wissen, ob gerade Carb-Loading oder eine Fettstoffwechsel-fokussierte Grundlagenphase läuft) - im JSON-Ergebnis nicht wiederholen, das Schema hat dafür kein Feld.
- Nie einen exakten Trainingsload/TSS-Wert erfinden - nur "intensity": "leicht"|"mittel"|"hart" angeben, keine Zahl.
- Bei "Kraft"/"Mobility": ein "exercises"-Array mit 3-6 konkreten Übungen (Name, Sätze, Wiederholungen, kurzer Hinweis) angeben - passend zu Triathlon (Rumpf-/Beinstabilität, Verletzungsprävention), ohne Annahmen über verfügbares Equipment (nur Körpergewicht/einfache Kurzhanteln annehmen).
- Bei Schwimmen/Rad/Laufen: "description" MUSS enthalten (a) eine kurze konkrete Struktur mit Einrollen/Hauptteil/Auslaufen (z.B. "10min Einrollen, 6x400m zügig mit 90s Pause, 10min Auslaufen") UND (b) den passenden Ziel-Bereich aus den oben angegebenen Zonen (Herzfrequenz-Zonen/Pace-Zonen/Leistungszonen) für die gewählte Intensität - z.B. "Hauptteil im Bereich Z2 Grundlage (128-142 bpm bzw. 5:20-5:45/km)". Nutze dafür AUSSCHLIESSLICH die im Kontext oben schon berechneten Zonenwerte, erfinde selbst keine Zahlen. Sind für eine Sportart keine Zonen im Kontext angegeben (kein Schwellenwert im Profil hinterlegt), einfach nur "leicht/mittel/hart" ohne Zahlen nennen.
- Bei Schwimmen/Rad/Laufen zusätzlich: falls unter "Zuletzt tatsächlich absolviert" oder in einer früheren Analyse erkennbar ist, dass ähnliche Einheiten dieser Sportart zuletzt zu hart/zu leicht gelaufen sind oder häufig übersprungen wurden, das kurz in der "description" berücksichtigen (z.B. "diesmal bewusst 5min kürzer, da die letzten beiden Tempoläufe übersprungen wurden").
- Kein "exercises"-Feld bei Schwimmen/Rad/Laufen (nur bei Kraft/Mobility, s.o.).
- Alle Textfelder ("description", "title", Übungs-"note") als reiner Klartext ohne Markdown (kein **, kein #, keine Aufzählungszeichen) - werden teilweise in einfachen Textfeldern angezeigt, in denen Markdown-Zeichen nur störend wären.
- Falls oben "Zusätzliche Wünsche des Athleten" angegeben sind: diese aktiv und konkret einplanen, sofern plausibel (z.B. "1x Zugseiltraining pro Woche" -> an einem passenden Tag als Kraft-Einheit mit einer entsprechenden Übung einbauen). Nicht plausibel Umsetzbares (z.B. widerspricht Trainingstagen/Sportart-Liste oben) einfach weglassen statt zu erzwingen.
- Falls oben ein "Streckenprofil" mit Hügeligkeit angegeben ist ("hügelig"/"bergig"): bei Rad-/Lauf-Einheiten in dieser Trainingsphase gezielt auch Anstiege/Höhenmeter einbauen (in der "description" erwähnen, z.B. "inkl. 2-3 längere Anstiege"), nicht nur bei "flach" ignorieren. Falls eine "Priorität" (A/B/C) angegeben ist: bei A-Zielen konsequenter auf das Renndatum hintrainieren (Taper ernster nehmen), bei B/C-Zielen mehr Spielraum für das eigentliche Grundlagentraining lassen. Eine "Wettkampf-Strategie-Notiz" ist zusätzlicher Kontext (z.B. Pacing-Plan) - falls relevant für die Trainingsgestaltung kurz berücksichtigen, sonst ignorieren.
- WICHTIG - Konsistenz zwischen den Feldern EINES Eintrags: "sport" muss exakt zu dem passen, was in "title"/"description" tatsächlich beschrieben wird (z.B. Zugseiltraining, Klimmzüge, Kniebeugen, Kreuzheben, Hanteltraining -> sport MUSS "Kraft" sein, niemals "Rad"/"Laufen"/"Schwimmen", auch wenn der Athlet an dem Tag sonst Rad fährt). "duration_min" muss der tatsächlichen Gesamtdauer entsprechen, die du selbst in "description" nennst (z.B. wenn "description" mit "20min ..." beginnt, muss duration_min=20 sein) - widersprüchliche Angaben zwischen den Feldern derselben Einheit sind ein Fehler.
- WICHTIG - Sicherheit: falls oben "Verletzungen/Einschränkungen des Athleten" angegeben sind, DIESE UNBEDINGT beachten - keine Übungen/Belastungen vorschlagen, die die genannte Einschränkung verschlimmern könnten (z.B. bei Knieproblemen keine tiefen Kniebeugen/Sprünge, bei Schulterproblemen kein Bankdrücken/Zugseiltraining über Kopf), stattdessen alternative Übungen wählen oder die Belastung entsprechend anpassen.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Form, keinerlei Text davor/danach, keine Code-Block-Markierung:
{"workouts":[{"date":"YYYY-MM-DD","sport":"Schwimmen|Rad|Laufen|Kraft|Mobility","title":"kurzer Titel","duration_min":60,"intensity":"leicht|mittel|hart","description":"...","exercises":[{"name":"...","sets":3,"reps":"12","note":"..."}]}]}

"exercises" nur bei sport="Kraft"/"Mobility" angeben, sonst weglassen. Jedes "date" muss exakt eines der oben genannten ${windowDates.length} Zeitfenster-Daten sein. Kein Datum außerhalb, keine Duplikate am selben Tag+Sportart.`;
}

function buildWorkoutAnalysisPrompt(w, comparable) {
  const ctx = buildWorkoutAnalysisContext(w, comparable);
  return `Du bist ein erfahrener Triathlon-Coach. Analysiere eine einzelne Trainingseinheit im Vergleich zu ähnlichen früheren Einheiten desselben Athleten (gleiche Sportart UND gleiche Umgebung - Indoor wird nur mit Indoor verglichen, Outdoor nur mit Outdoor -, ähnliche Distanz/Dauer):

${ctx}

Gib eine kurze Auswertung auf Deutsch:
1. Auffälligkeiten im Vergleich zur Vergleichsgruppe (z.B. ungewöhnliche Pace/HF-Kombination, überdurchschnittliche Anstrengung, deutliche Verbesserung/Verschlechterung, auffällige Kadenz). Falls angegeben: auch die Trainingsbelastung (TRIMP/Herzfrequenzreserve/Stress-Score) und der negative Split einordnen, aber nicht selbst nachrechnen - sind bereits fertig berechnet. Wenn nichts auffällt, das kurz so bestätigen statt etwas zu erfinden.
2. Falls eine eigene Notiz und/oder Bewertung des Athleten zu dieser oder ähnlichen früheren Einheiten angegeben ist: das subjektive Gefühl mit den objektiven Werten (Pace/HF/Load) in Bezug setzen (z.B. "fühlte sich hart an" bei unauffälligen Werten, oder eine niedrige Bewertung trotz guter Pace) - ist keine Notiz/Bewertung vorhanden, diesen Punkt einfach auslassen statt etwas zu vermuten.
3. 2-4 konkrete, sofort umsetzbare Tipps für die nächsten ähnlichen Einheiten.

Nur normaler Fließtext in kurzen Absätzen - KEIN Markdown (keine **, keine #-Überschriften, keine Aufzählungszeichen/nummerierten Listen), keine Tabellen/Code-Blöcke, max. ca. 180 Wörter.`;
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
- Nutze für den Zielbereich (Herzfrequenz/Pace/Leistung) AUSSCHLIESSLICH die oben angegebenen Zonenwerte, erfinde selbst keine Zahlen. Sind keine Zonen angegeben, nur "leicht/mittel/hart" ohne Zahlen nennen.
- Bei Kraft/Mobility: "exercises"-Array mit 3-6 konkreten Übungen (Name, Sätze, Wiederholungen, kurzer Hinweis), sonst kein "exercises"-Feld.
- Alle Textfelder als reiner Klartext ohne Markdown (kein **, kein #, keine Aufzählungszeichen).
- Falls oben "Zusätzliche Wünsche des Athleten" angegeben sind, nach Möglichkeit berücksichtigen.
- WICHTIG - Konsistenz: "sport" muss exakt zur tatsächlichen Aktivität in "title"/"description" passen (z.B. Zugseiltraining/Klimmzüge/Kniebeugen -> sport MUSS "Kraft" sein), und "duration_min" muss der in "description" genannten Gesamtdauer entsprechen, falls dort eine genannt wird.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Form, keinerlei Text davor/danach, keine Code-Block-Markierung:
{"workouts":[{"date":"${pw.date}","sport":"...","title":"kurzer Titel","duration_min":45,"intensity":"leicht|mittel|hart","description":"...","exercises":[{"name":"...","sets":3,"reps":"12","note":"..."}]}]}

"exercises" nur bei sport="Kraft"/"Mobility" angeben, sonst weglassen. Genau EIN Eintrag im Array, mit date="${pw.date}".`;
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
