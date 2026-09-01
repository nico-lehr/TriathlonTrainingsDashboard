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
LLM (js/ai/ollama.js) — aktuell Ollama/lokal; so gebaut, dass später auch
                          eine Remote-API angeschlossen werden kann, ohne
                          dass context-builder.js/prompts.js sich ändern
                          müssten.
```

Der Rest der App kennt keine LLM-Details — nur `js/ai/ollama.js` weiß,
dass es gerade Ollama ist.

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

* die berechnete Trainingsphase (`computeTrainingPhase`, `training-plan.js`)
* das konkrete, zu planende Zeitfenster (rollierend, siehe `computePlanningWindow`)
* ob Kraft-/Mobility-Einheiten gewünscht sind (`athleteProfile.includeStrength/includeMobility`)
* die letzten tatsächlich absolvierten Einheiten (granularer als die
  4-Wochen-Aggregation, damit die KI nicht z.B. auf eine gerade erst
  gemachte harte Einheit draufsetzt)
* die zuletzt vorgeschlagenen Einheiten + ob sie eingehalten wurden
  (`status` aus `plannedWorkouts`) — einfache Form von Adherence-Feedback
* falls das Hauptevent-Ziel ≤ 21 Tage entfernt ist und Zielzeiten hinterlegt
  sind: den Wettkampf-Verpflegungsplan (`computeRaceFuelingPlan()`,
  Gesamt-Kohlenhydratbedarf + Flüssigkeits-Faustregel) — bewusst nur nah am
  Wettkampf, damit der Kontext in einer normalen Grundlagenwoche nicht
  unnötig aufgebläht wird

`buildPlanPrompt()` fordert striktes JSON (`{"workouts":[...]}`) an; der
Ollama-Call in `generateTrainingPlan()` (`js/ai/ollama.js`) nutzt zusätzlich
`format:"json"`. `parsePlanResponse()` validiert jeden Eintrag (Datum
innerhalb des angefragten Fensters, erlaubte Sportart, plausible Dauer,
keine Duplikate) und verwirft ungültige Einträge einzeln, statt die ganze
Antwort zu verwerfen oder ungeprüft zu übernehmen — die KI liefert hier
zwar konkrete Trainingsinhalte (das ist ihre Aufgabe), aber nie ungeprüft
in die App.

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
