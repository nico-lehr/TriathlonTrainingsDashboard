# AI_CONTEXT

Beschreibt den verfügbaren KI-Kontext, Priorität und Token-Strategie (siehe
AI_RULES.md, Abschnitte 5–9 und 26). Bei Änderungen an `js/ai/*.js`
mit aktualisieren.

## Architektur

```text
Rohdaten (js/data/*.js)
    ↓
Analytics (js/analytics/*.js)  — CTL/ATL/TSB, ACWR, Bestzeiten: reine Berechnung
    ↓
Kontext-Builder (js/ai/context-builder.js) — buildCompactContext()
    ↓
Prompt (js/ai/prompts.js) — buildCoachPrompt()
    ↓
LLM (js/ai/provider.js) — je Aufgabe Ollama (Standard, lokal) oder die
                          Claude API (js/ai/claude.js, bewusst pro Aufgabe
                          zu aktivieren). Ollama wird nie direkt vom Browser
                          gefragt, sondern über den eigenen Server:
                          POST /api/v1/ai/chat (backend/ai_routes.py), der
                          Server kennt die Adresse aus .env (OLLAMA_URL).
```

Der Rest der App kennt keine LLM-Details — nur `js/ai/provider.js`,
`ollama.js` und `claude.js` wissen, wer antwortet. Context-Builder und
Prompts bleiben dafür unverändert.

## Warum kompakter Text statt Rohdaten

Ziel: auch kleinere lokale Modelle sollen mit wenig Kontext ein gutes,
schnelles Ergebnis liefern (Token-/Latenz-Budget). Deshalb bewusst NICHT:

* alle historischen Workouts
* GPS-/Stream-Rohdaten
* jeder einzelne Herzfrequenz-Messpunkt
* alle Gesundheitsmesswerte roh

Stattdessen `buildCompactContext()` (`js/ai/context-builder.js`), aktuell
mit folgenden Zeilen (in dieser Reihenfolge, weggelassen wenn keine Daten
vorhanden sind):

1. **Heute** — aktuelles Datum.
2. **Form** — CTL (Fitness), ATL (Ermüdung), TSB, ACWR (aus
   `js/analytics/training-load.js`, `computeLoadSeries()`), jeweils direkt
   mit der fertigen Textbewertung dahinter (`tsbStatusLabel()`/
   `acwrStatusLabel()`, dieselbe Einordnung wie die Status-Badges im
   Dashboard) — damit die KI die Schwellenwerte nicht selbst raten muss.
3. **Trainingsmonotonie** (7-Tage-Fenster nach Foster 1998,
   `computeMonotonyStrainSeries()`) mit Textbewertung (`monotonyStatusLabel()`).
4. **VO2max Laufen / VO2max Rad** — getrennte Schätzung + Trend je Sportart
   (`computeVo2MaxEstimate()`, siehe DATA_MODEL.md), inkl. Methode in
   Klammern (primär: Regression aus Pace/Puls bzw. Watt/Puls mehrerer
   normaler Trainingseinheiten; Fallback Laufen: VDOT-Formel aus Bestzeit,
   oder grob aus Max-/Ruhepuls), damit die KI die Unsicherheit einordnen
   kann. Zeile fehlt ganz, wenn für die jeweilige Sportart keine
   ausreichende Datenbasis vorliegt (z. B. Rad ohne Leistungsmesser).
5. **Letzte 4 Wochen** — Stunden je Sportart.
6. **Profil** — Alter, Erfahrung, Stärke/Schwäche, Trainingstage-Plan
   (Wochentage, Schwimmtag, lange Einheiten), typische Einheitendauer,
   Leistungswerte (FTP/Schwellenpace/CSS), verfügbare Wochenstunden.
7. **Bestzeiten** je Sportart (aus `js/analytics/performance.js`,
   `computeCompactRecords()` — dieselben Werte wie im Rekorde-Tab).
8. **Erholung heute** — Muskelkater (+ Lokalisierung), Energie, Verletzung
   (aus `js/data/health.js`), nur wenn heute ausgefüllt.
9. **Ernährungsziel heute** (`js/analytics/nutrition.js`,
   `computeDailyMacroTargets()`) — Kohlenhydrate/Eiweiß/Fett in Gramm,
   dieselbe Zahl wie im "Ernährung"-Tab, inkl. Grund (heutiger Trainingsumfang,
   Trainingsphase-Bias "train low"/"train high", oder Carb-Loading kurz vorm
   Wettkampf) — damit Coach-Empfehlung und Trainingsplan nicht unabhängig
   davon eigene, ggf. widersprüchliche Ernährungstipps geben, sondern auf
   denselben Zahlen aufbauen (siehe `buildCoachPrompt()`/`buildPlanPrompt()`
   unten: die KI darf darauf Bezug nehmen, aber nichts Eigenes erfinden).
   Fehlt, wenn kein Körpergewicht hinterlegt ist.
10. **Ziel** — Name, Sportart, Datum, Tage bis dahin, optional Zielzeit/
   Distanz/Notizen.
11. **Race-Readiness-Score** (`js/analytics/race-readiness.js`,
    `computeRaceReadiness(goal)`) — Score 0-100 + die 4 Einzelfaktoren
    (Form, Verletzungsrisiko, Trainingskonstanz, Taper-Phase), speziell für
    dieses eine Ziel berechnet; vorher nur im Coach-Tab sichtbar, nie an die
    KI selbst weitergegeben.

`buildWorkoutAnalysisContext()` (dieselbe Datei, für die Einzel-Workout-
Auswertung) bekommt zusätzlich zu Pace/HF/Load/Höhenmeter/Kadenz-Vergleich
auch die im selben Detail-Modal ohnehin berechnete Trainingsbelastung
(TRIMP, Herzfrequenzreserve, Stress-Score) und den negativen Split
(`js/analytics/workout-profile.js`) — dieselbe Berechnung, jetzt auch als
KI-Kontext statt nur visuell in der Kachel/im Chart.

`buildCoachPrompt()`/`buildWorkoutAnalysisPrompt()` (`js/ai/prompts.js`)
verpacken diesen Kontext zusammen mit einer kurzen System-Anweisung in den
finalen Prompt-Text für Ollama — inkl. der expliziten Anweisung, die
mitgelieferten Einordnungen (Status-Texte, Score) als Basis zu nehmen statt
sie selbst neu zu bewerten oder ihnen zu widersprechen.

## Automatischer Trainingsplan (dritter Anwendungsfall)

Dritter Kontext/Prompt-Pfad neben Ziel-Tipps und Workout-Auswertung:
`buildPlanContext(goal, windowDates)` (`context-builder.js`) baut auf
`buildCompactContext()` auf (spart doppelten Kontextaufbau) und ergänzt:

* die Periodisierung (`js/analytics/periodization.js`): Phase heute mit
  Erklärung, je Woche des Planungsfensters Wochentyp (Belastung/Entlastung/
  Taper/Rennwoche/Erholung), Zielumfang in Minuten und was davon schon
  absolviert/geplant ist, der aktuelle Wochenumfang (bzw. „Wiedereinstieg
  nach n leichteren Wochen“) und der nächste Phasenwechsel. Die KI plant den
  Rest bis zum Ziel, statt eigene Umfänge zu erfinden. Die Regel
  „Umfang“ (`planVolumeRule`, `prompts.js`, ab 2.5.54) verlangt mindestens
  90 % des Zielumfangs, nie mehr als das Ziel und die verfügbaren Stunden;
  mit 2 Haupttrainings pro Tag darf die KI dafür eine kurze zweite lockere
  Einheit ergänzen. Die verfügbaren Stunden (`weeklyHours`) sind Obergrenze
  der Zielkurve; darunter steigt sie um 10 % je Belastungswoche.
  Hält sich die KI nicht daran, füllt `planGuardTopUp`
  (`js/analytics/plan-guard.js`, ab 2.5.55) nach `generateTrainingPlan`
  ohne KI auf: neue lockere Rad-/Laufeinheiten länger (max. +50 %,
  höchstens 120 min), mit 2 Haupttrainings pro Tag eine kurze zweite
  Einheit; nie mit neuem Regelverstoß, nie über das Wochenbudget.
* das konkrete, zu planende Zeitfenster (rollierend, siehe `computePlanningWindow`)
* ob Kraft-/Mobility-Einheiten gewünscht sind (`athleteProfile.includeStrength/includeMobility`)
* die letzten tatsächlich absolvierten Einheiten (granularer als die
  4-Wochen-Aggregation, damit die KI nicht z.B. auf eine gerade erst
  gemachte harte Einheit draufsetzt)
* die zuletzt vorgeschlagenen Einheiten + ob sie eingehalten wurden
  (`status` aus `plannedWorkouts`) — einfache Form von Adherence-Feedback

Sparsam mit Tokens: `buildPlanContext` ruft `buildCompactContext(goal, { forPlan: true })`
auf. Für die Planung lässt das weg, was die KI dort nicht braucht: VO2max,
Bestzeiten, Körperzusammensetzung, Ernährungsziel, die „Diese Woche“-Zeile und
die Einzelfaktoren des Race-Readiness-Scores (nur der Score bleibt). Die
Verpflegungs-Planung für den Wettkampf steht nicht mehr im Plan-Kontext.
`buildPlanPrompt()` nimmt Sonderregeln (Erholung, Wünsche, Streckenprofil,
Priorität, Strategie-Notiz, Verletzungen, zuletzt vorgeschlagene Einheiten)
nur auf, wenn der Kontext dazu überhaupt etwas enthält; Taper- und
Nach-dem-Rennen-Regeln (`planRulesText(goal, { daysUntil })`) nur, wenn das
Rennen höchstens 35 Tage entfernt oder gerade vorbei ist. Kraft- und
Mobility-Übungen gibt die KI nur als `{"id", "sets", "reps"}` bzw.
`{"id", "seconds"}` zurück; Name, Hinweise und Wiederholungen ergänzt
`parsePlanResponse()`/`fitPlanMobility()` aus der Übungsbibliothek. Titel
höchstens 4 Wörter, Beschreibung höchstens 2 kurze Sätze - das spart
Antwort-Tokens, die am teuersten sind.

`buildPlanPrompt()` fordert striktes JSON (`{"workouts":[...]}`) an; der
Ollama-Call in `generateTrainingPlan()` (`js/ai/ollama.js`) nutzt zusätzlich
`format:"json"`. `parsePlanResponse()` validiert jeden Eintrag (Datum
innerhalb des angefragten Fensters, erlaubte Sportart, plausible Dauer,
keine Duplikate) und verwirft ungültige Einträge einzeln, statt die ganze
Antwort zu verwerfen oder ungeprüft zu übernehmen — die KI liefert hier
zwar konkrete Trainingsinhalte (das ist ihre Aufgabe), aber nie ungeprüft
in die App.

**Regelwerk statt KI-Urteil.** Ob ein Plan zu hart oder zu viel ist,
entscheidet nicht die KI, sondern `validatePlan()`
(`js/analytics/plan-rules.js`, 7 Regeln, siehe `docs/DATA_MODEL.md`):

* Der Prompt enthält die Regeln als Text (`buildPlanRulesPrompt()` →
  `planRulesText(goal)`, dieselben Zahlen wie die Prüfung) und die festen
  Terminwünsche (`buildPlanWishesPrompt()`).
* Jeder KI-Plan wird zusammen mit den schon geplanten und den zuletzt
  absolvierten Einheiten geprüft (`checkedPlanFromAi()`). Verstöße mit
  fertigem Vorschlag werden automatisch korrigiert; sonst wird die KI
  höchstens 2-mal mit der Liste der Verstöße neu gefragt
  (`buildPlanRetryPrompt()`). Bleibt ein „block“-Verstoß, wird nichts
  übernommen und der alte Plan bleibt erhalten.
* Mit Hauptevent kommen Regel 4 (Zielumfang der Phase: Taper-, Renn- und
  Erholungswochen haben einen festen Zielumfang) und Regel 7 (nach dem
  Wettkampf nur lockere Einheiten) dazu.

## Kosten der Plan-Aufgaben (Stand 2.4.47)

Am teuersten ist bei der KI das, was sie schreibt (inklusive Nachdenken),
nicht das, was sie liest. Deshalb:

* **Täglicher Plan-Check** (`js/components/plan-check.js`): Die festen Regeln
  laufen immer (kostenlos). Die KI wird nur noch gefragt, wenn es etwas
  abzuwägen gibt - `planGuardAiReasons()` (`js/analytics/plan-guard.js`):
  auffälliger Erholungs-Check, verpasste Einheit, ACWR ab 1,2, eine feste
  Regel hat angeschlagen oder mindestens zwei Uhr-Werte sind leicht auffällig
  (HRV −5 %, Ruhepuls +3, Schlaf −15 %, Trainingsbereitschaft unter 50).
  Sonst wäre die Antwort praktisch immer „behalten“. Der Knopf „Jetzt prüfen“
  fragt die KI trotzdem.
* **Nachricht an den Coach** (`replanFromCoachNote`, Task `replan`): Die KI
  schickt nur die geänderten Tage (`geaenderte_tage` + `workouts`), der Rest
  der Woche bleibt. Ohne `geaenderte_tage` gilt die Antwort wie früher als
  kompletter Plan.
* **Nachdenken beim Trainingsplan** (Einstellungen → Claude): „Wenig“ (Standard
  ab 2.4.48, `effort: low`) oder „Mittel“ (`medium`), gilt für `plan` und
  `replan` (`claude_api.plan_effort`). Nachdenken wird wie geschriebener Text
  bezahlt und ist beim Plan der größte Kostenanteil.
* **Alternative zu einer Einheit** (`generatePlannedWorkoutAlternative`,
  Task `alternative`): gleiches Modell wie der Plan, aber Gründlichkeit „low“.
* **Automatischer Wochenplan als Sammelauftrag** (`js/ai/plan-batch.js`,
  Task `planbatch`, ab 2.4.49): Mit Claude geht die nächste Woche schon raus,
  wenn nur noch **5 Tage** geplant sind - über die Batches API zum halben
  Preis (`POST/GET /api/v1/ai/claude/batch`, Auftrag in
  `~/.triathlon/claude_batches.json`). Die App holt das Ergebnis beim Start,
  alle 10 Minuten und beim Zurückkehren in die App ab und baut es mit
  `generateTrainingPlan(goalId, {windowDates, firstRaw})` ein (gleiche
  Prüfung/Reparatur wie sofort). Ist nur noch **1 Tag** geplant (Auftrag
  hängt, App lange zu), wird sofort zum vollen Preis geplant. Überholte
  Ergebnisse (Tage inzwischen geplant, Hauptziel gewechselt) werden
  verworfen. Knöpfe und Coach-Nachricht bleiben sofort; ohne Claude (Ollama)
  plant die App wie bisher bei weniger als 3 Tagen. Der vorab erstellte Plan
  bekommt den Hinweis, dass der tägliche Plan-Check die Tage kurz vorher an
  die Verfassung anpasst (`buildPlanAheadPrompt`). Reihenfolge am Morgen
  bleibt: Plan-Check, danach Morgenbericht.
* **Nur wenn jemand da ist** (`js/utils/user-active.js`, ab 2.5.53):
  Automatischer Wochenplan, täglicher Plan-Check und Morgenbericht-Text
  laufen nur bei sichtbarer App und Benutzung (Tippen, Klicken, Scrollen) in
  den letzten 2 Stunden. Ein offen liegender Tab verbraucht keine Tokens;
  `onUserBack` holt alles nach, sobald jemand zurückkommt. Knöpfe und
  Coach-Nachricht sind nicht betroffen. Der Server fragt die KI nie von sich
  aus (Morgen-Mitteilung und Garmin-Abruf kommen ohne KI aus).
* **Zweiter Versuch beim Plan:** Alle „harten“ Regelverstöße (zwei harte Tage
  hintereinander, kein Ruhetag, schlechte Erholung) repariert das Dashboard
  selbst; ein zweiter KI-Durchlauf ist nur der seltene Notfall.
* **Statistik** (Mehr → Statistik): je Aufgabe Anzahl Anfragen, Ø Kosten und
  Ø geschriebene Tokens (`ai_task_stats`, `backend/usage.py`).

## Empfehlungen Heute / Diese Woche / Nächste Woche (vierter Anwendungsfall)

`buildOutlookFacts()` (`context-builder.js`) sammelt fertige Sätze aus den
vorhandenen Berechnungen: Form/ACWR/Fitness (`computePerformanceState()`),
heutiger Erholungs-Check, HRV/Ruhepuls als Abweichung vom eigenen Mittel,
Umfang bisher/geplant, Wettkampf und Phase, Periodisierung der Woche, und
bis zu 6 Hinweise des Regelwerks zum aktuellen Plan. `buildOutlookPrompt()`
(`prompts.js`) gibt dazu die festen Regeln mit und verlangt JSON mit je
Empfehlung + Begründung. Die Begründung darf nur Zahlen aus den Fakten
nutzen; dieselben Fakten sieht der Athlet unter jeder Empfehlung
(„Grundlage“).

## Priorität, falls der Kontext eingekürzt werden muss

Absteigend nach Wichtigkeit (siehe AI_RULES Abschnitt 8), noch nicht als
hartes Token-Budget implementiert, aber als Leitlinie für zukünftige
Erweiterungen:

1. Aktuelles Workout / aktuelle Frage
2. Aktuelle Erholung/Gesundheit
3. Aktuelle Trainingsbelastung (CTL/ATL/TSB/ACWR)
4. Relevante aktuelle Workouts (letzte 4 Wochen)
5. Relevante Trends
6. Langfristiges Athletenprofil
7. Ältere historische Informationen

Niedrigwertige Informationen werden nicht "nur weil sie existieren"
mitgeschickt.

## Deterministische Berechnung vs. LLM-Interpretation

Alles, was die App selbst zuverlässig berechnen kann (CTL/ATL/TSB, ACWR,
Bestzeiten, Trainingsumfang), wird von `js/analytics/*.js` berechnet — NIE
vom LLM. Das LLM bekommt die fertigen Zahlen und soll sie interpretieren
und Empfehlungen ableiten, nicht selbst nachrechnen. Das verbessert
Genauigkeit, Token-Effizienz, Geschwindigkeit und Reproduzierbarkeit.

## Aktueller Stand vs. Ausbaustufen aus AI_RULES.md

Aktuell umgesetzt: `athlete_profile`, ein Teil von `athlete_state`
(Form/ACWR über die Analytics-Funktionen), `training_summary` (letzte 4
Wochen), `health_summary` (Erholungs-Check + Logbuch).

Noch nicht umgesetzt (spätere Ausbaustufen, siehe AI_RULES Abschnitt 6):
ein strukturiertes `training_memory` (Freitext-Beobachtungen über Zeit,
über den reinen Logbuch-Datensatz hinaus), ein explizites Token-Budget mit
harter Kürzung nach Priorität, sowie Chat-/adaptive-Coaching-Funktionen
(AI_RULES Abschnitt 27, Punkte 8–10).
