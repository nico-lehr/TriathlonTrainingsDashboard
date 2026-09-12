# PROJECT_MAP

Beschreibt, wo welche Funktionalität lebt. Bei größeren Architekturänderungen
mit aktualisieren (siehe AI_RULES.md, Abschnitt 26).

## Einstieg

`index.html` öffnen (Doppelklick oder im Browser). Enthält nur Struktur
(Header, Tabs, Karten-Container, Modals, Formulare) — keine Business-Logik,
kein Inline-CSS. Lädt `css/*.css` und `js/**/*.js` über normale `<link>`-
und `<script>`-Tags, was auch beim direkten Öffnen als `file://`-URL
funktioniert (kein Server nötig).

Eine Ausnahme: ein kleines Inline-`<script>` im `<head>` setzt das
gespeicherte Theme, BEVOR irgendetwas gerendert wird (verhindert kurzes
Aufblitzen im falschen Theme). Das ist die einzige absichtlich verbleibende
Inline-Logik.

## Reihenfolge der `<script>`-Tags (wichtig!)

Jede Datei darf beim Laden nur auf Dinge zugreifen, die bereits geladen
sind. Innerhalb von Funktionsrümpfen ist das unkritisch (die werden erst
später beim tatsächlichen Aufruf ausgeführt, wenn ohnehin schon alles
geladen ist) — kritisch ist nur Code, der direkt beim Laden ausgeführt wird
(z. B. `let RAW = EMBEDDED_DATA;` oder die `initXyz()`-Aufrufe ganz am
Ende). Deshalb diese Ladereihenfolge in `index.html`:

```
data/workouts-data.js      (generierte Trainingsdaten, siehe unten)
js/utils/*.js
js/data/*.js
js/analytics/*.js
js/ai/*.js
js/components/*.js
js/app.js                  (muss zuletzt laden: ruft am Ende alle initXyz()
                             + renderAll() auf)
```

## CSS (`css/`)

| Datei | Inhalt |
|---|---|
| `variables.css` | Design-Tokens (`:root`, Light/Dark-Theme-Overrides). |
| `main.css` | Basis-Layout: Reset, `body`, Seiten-Hintergrund/Parallax, Header/Logo, Top-Navigation, globale `@keyframes`. |
| `components.css` | Alles Übrige: Buttons, Chips, Formulare, Karten, Tabellen, Modals, Charts, Kalender, Coach/Onboarding, Erholungs-Check usw. |
| `responsive.css` | Media Queries (`prefers-reduced-motion`, `max-width: 980px`). |

`main.css` vs. `components.css` ist eine pragmatische, keine perfekte
Trennung — bei Bedarf können einzelne Regeln aus `components.css` bei
Gelegenheit weiter in eigene Dateien (z. B. `coach.css`) aufgeteilt werden.

## JavaScript (`js/`)

### `js/utils/` — reine Hilfsfunktionen, keine App-Logik
- `dates.js` — Datum/Zeit-Formatierung, Wochenstart, Pace↔Sekunden.
- `formatting.js` — Text-/Zahlen-Formatierung (`fmtH`, `fmtNum`, `escapeHtml`, …).
- `calculations.js` — reine, DOM-freie Berechnungen (`niceMax`, Bestleistungen).

### `js/data/` — Datenhaltung (Laden/Speichern/Ableiten), keine UI
- `fit-parser.js` — Binärparser für Garmin `.fit`-Dateien (kein Netzwerk, keine Abhängigkeiten). Liest auch Bahnen-Nachrichten (Schwimmen, SWOLF) und generische Developer-Felder mit ein — Fundament für künftige Garmin-Connect-/Strava-Daten, siehe `docs/DATA_MODEL.md`.
- `garmin-wellness.js` — Zugriffsschicht auf die Garmin-Gesundheitsdaten (`GARMIN_WELLNESS` aus `data/wellness-data.js`): `latestWellness()`, `wellnessSeries()`, `wellnessBaseline()`, `wellnessDeviation()` (Abweichung vom eigenen 30-Tage-Mittel — nur so ist ein HRV-Wert interpretierbar) und `syncGarminWeightIntoLog()`. Startet mit leerem Bestand, wenn nie synchronisiert wurde.
- `workouts.js` — Rohdaten (`ALL`/`DATA`), localStorage-Persistenz, Zeitraum-/Sportart-Filter. Braucht `EMBEDDED_DATA` aus `data/workouts-data.js`. Enthält außerdem die zentralen Gruppierungs-Primitive, an denen JEDE Referenzgruppe hängt: `sportGroup()`, `rideEnvironment()` (Indoor/Outdoor beim Rad, als `_rideEnv` materialisiert), `comparisonGroupLabel()`, `isIndoorRide()`, `rideEnvBadgeHtml()` und vor allem `sameComparisonGroup()` — wer mit wem verglichen werden darf, wird nur dort entschieden (siehe `docs/DATA_MODEL.md`, Abschnitt "Indoor/Outdoor-Erkennung beim Rad").
- `goals.js` — Ziel-Events (Laden/Speichern/Anlegen/Löschen).
- `athlete.js` — Athletenprofil (Laden/Speichern), Trainingstage-Konstanten.
- `health.js` — Erholungs-Check-Zustand inkl. täglichem Reset + Logbuch-Archivierung.
- `planned-workouts.js` — geplante/KI-vorgeschlagene Trainingseinheiten (Laden/Speichern/Anlegen/Verschieben), getrennt von den echten Workouts (`ALL`/`DATA`), siehe `docs/DATA_MODEL.md`.
- `fit-workout-writer.js` — schreibt eine geplante Einheit als importierbare `.fit`-Workout-Datei für Garmin Connect (Gegenrichtung zu `fit-parser.js`), siehe `docs/DATA_MODEL.md`.
- `weight-log.js` — Gewichtsverlauf (Laden/Speichern/Eintragen), hält `athleteProfile.weightKg` synchron, siehe `docs/DATA_MODEL.md`.
- `achievements.js` — Laden/Speichern der bereits freigeschalteten Erfolge (`achievementsState`) + Erfolgs-Schnappschuss (z. B. letzte bekannte Bestzeit je Distanz). Die eigentliche Erkennung/Freischaltung passiert in `js/analytics/achievements.js`, siehe `docs/DATA_MODEL.md`.

### `js/analytics/` — reine Berechnungen, kein UI
- `training-load.js` — CTL/ATL/TSB (PMC), ACWR-Zeitreihen, Trainingsmonotonie/-Strain nach Foster (1998, `computeMonotonyStrainSeries`) und der Monatsvergleich (`computeMonthComparison`, aktueller vs. vorheriger Kalendermonat).
- `performance.js` — kompakte Bestzeiten-Zusammenfassung für den KI-Kontext, sowie die getrennte VO2max-Schätzung + Trend für Laufen und Rad (`computeVo2MaxEstimate`, primär per Pace/Watt-Puls-Regression) für die zwei Kennzahlen-Kacheln ganz oben im Überblick.
- `workout-comparison.js` — findet vergleichbare frühere Einheiten (gleiche Sportart, Distanz/Dauer ±20%) für die KI-Auswertung je Einheit.
- `race-readiness.js` — Race Readiness Score (0-100, rein rechnerisch, kein LLM) für Ziele mit Event-Datum: kombiniert Form/TSB, ACWR, Trainingskonstanz und Taper-Phase, siehe `docs/DATA_MODEL.md`.
- `hr-distribution.js` — Puls-Zeitanteil je Sportart aus den Sekunden-Pulswerten (`workout.stream.hr`), geglättetes Histogramm für das Ridgeline-Chart "Herzfrequenzverteilung nach Aktivität". Stellt `hrDensityFromValues()` bereit, die auch `workout-profile.js` nutzt.
- `workout-profile.js` — Trainingsbelastung (TRIMP/Stress-Score), Herzfrequenzprofil und Belastungsprofil (Radar) einer einzelnen Einheit für die Detailansicht, siehe `docs/DATA_MODEL.md`.
- `training-plan.js` — rein deterministischer Teil des automatischen Trainingsplans: Periodisierungs-Phase, rollierendes Planungsfenster, Auto-Nachplan-Check (`computeTrainingPhase`/`computePlanningWindow`/`shouldAutoReplan`), siehe `docs/DATA_MODEL.md`.
- `nutrition.js` — Tagesziel-Makros, Pre-Workout-Timing und Wettkampf-Verpflegungsplan für den "Ernährung"-Tab, rein rechnerisch aus Körpergewicht + Trainingsplan + Hauptevent-Ziel, siehe `docs/DATA_MODEL.md`.
- `streak.js` — Trainingsplan-Treue-Streak (`computeAdherenceStreak`): rein deterministisch, misst Einhaltung des per Profil eigenen Wochenplans (`athleteProfile.trainingDays`), nicht "täglich trainiert". Ruhetage laut Plan zählen automatisch als eingehalten, ein Erholungs-Check-Grund (Verletzung/wenig Energie/starker Muskelkater) friert den Tag statt ihn zu brechen, siehe `docs/DATA_MODEL.md`.
- `achievements.js` — Erfolge/Abzeichen (`checkAndUnlockAchievements`): rein deterministisch aus bereits vorhandenen Werten abgeleitet (Trainingsanzahl, Bestzeiten aus `calculations.js`, Streak aus `streak.js`) — keine erfundenen Punkte/XP (AI_RULES §9). Idempotent, gefahrlos bei jedem `renderAll()` aufrufbar, siehe `docs/DATA_MODEL.md`.

Hinweis: Einige Render-Funktionen in `js/components/dashboard.js` (z. B.
`renderPMC`, `renderACWR`) rufen diese Analytics-Funktionen auf, zeichnen
das Ergebnis aber noch selbst als SVG — Berechnung und Rendering sind hier
noch nicht vollständig getrennt. Das ist ein bewusster, pragmatischer
Zwischenstand (siehe AI_RULES Regel 1: nicht over-engineeren) und kann bei
Bedarf schrittweise weiter aufgeteilt werden, sobald es sich lohnt.

### `js/ai/` — KI-Anbindung
- `context-builder.js` — baut den kompakten Text-Kontext für das LLM (siehe `docs/AI_CONTEXT.md`).
- `prompts.js` — baut den fertigen Prompt-Text aus dem Kontext.
- `ollama.js` — Ollama-Einstellungen, Verbindungstest, Empfehlung generieren.

### `js/components/` — UI-Komponenten (Rendering + Interaktion)
- `chart.js` — wiederverwendbare SVG-Bausteine (Tooltip, `svgEl`, Mini-Liniencharts, Animationen).
- `app-shell.js` — Theme-Umschalter, Parallax-Effekt, Top-Navigation, Filterleiste (Zeitraum-Chips + freies Von/Bis-Datum, Sportart), generische Drag-&-Drop-Kachel-Sortierung (`initDragGrid`, von Übersicht UND Coach-Tab genutzt).
- `card-search.js` — Kachel-Suche im Topnav: filtert/hebt beim Tippen die `.card`-Elemente im gerade aktiven Tab hervor (Titel + Untertext), kein Tab-übergreifender Sprung.
- `dashboard.js` — Übersicht-Tab: Kennzahlen-Kacheln (inkl. Trainingsplan-Treue-Streak-Kachel 🔥, sichtbar sobald `athleteProfile.trainingDays` gepflegt ist), Monatsvergleich, Wochenumfang, HF-Trend, Sportverteilung, Fitness & Form, ACWR, Trainingsmonotonie, HF-Zonen, Herzfrequenzverteilung nach Aktivität (Ridgeline), Trainingsbelastungsfokus, Pace-Entwicklung.
- `achievements.js` — Übersicht-Tab: "Erfolge"-Karte (`renderAchievements`, liest `achievementsState.unlocked`) + Feier-Toast beim Freischalten neuer Erfolge (`showAchievementToast`), siehe `docs/DATA_MODEL.md`.
- `calendar.js` — Kalender-Tab: Monats-, Wochen- und Tagesansicht (`calViewMode`). Tagesansicht nutzt die aus `workout-card.js` ausgelagerten `buildWorkoutDetailHtml()`/`renderWorkoutDetailCharts()`, um Trainings einzeln (mehrere gleichzeitig) aufklappbar mit vollem Detail-Chart darzustellen. Zeigt zusätzlich geplante Einheiten (`plannedWorkouts`) als gestrichelte Chips in allen drei Ansichten, per HTML5-Drag&Drop auf einen anderen Tag verschiebbar (`wireCalPlannedDrag`/`wireCalDropTarget`), Klick öffnet das Bearbeiten-Overlay aus `training-plan.js`. Steuerleiste hat zusätzlich einen "+ Workout"-Button, der dasselbe Overlay im Neuanlage-Modus für den gerade fokussierten Tag öffnet (`openPlanEdit(null, {date, goalId})`). Wochenansicht hat zusätzlich einen "Woche für Garmin exportieren"-Button für alle noch geplanten Einheiten der sichtbaren Woche, siehe `docs/DATA_MODEL.md`.
- `records.js` — Rekorde-Tab.
- `health-status.js` — Erholungs-Check-UI (Chips + Status-Badge) im Coach-Tab.
- `coach.js` — Coach-Tab: Onboarding-Assistent (6 Schritte, inkl. Trainingsplan-Präferenzen Kraft/Mobility + Hauptevent-Auswahl) mit Onboarding-Gate, Athletenprofil-Sync, Ziel-Liste (inkl. ★-Hauptevent-Markierung), Ollama-Einstellungsmenü.
- `training-plan.js` — Trainingsplan-Kachel im Coach-Tab (nächste geplante Einheiten + manuelles Nachplanen + Garmin-Export einzeln/gesammelt) und das Bearbeiten-/Neuanlage-Overlay für eine geplante Einheit (`openPlanEdit(id, defaults)`, `id === null` = manuelle Neuanlage; auch aus `calendar.js` aufrufbar), siehe `docs/DATA_MODEL.md`.
- `nutrition.js` — Ernährung-Tab: Gewichtsverlauf-Eingabe, Tagesziel-Makros, Pre-Workout-Timing, Wettkampf-Verpflegungsplan (reines Rendering, Berechnung in `js/analytics/nutrition.js`), siehe `docs/DATA_MODEL.md`.
- `workout-card.js` — Workout-Tabelle + Detailansicht-Modal. Detail-Markup/Charts sind in `buildWorkoutDetailHtml(w)` (HTML-String, Chart-Container per Klasse `.wd-*` statt fixer ID) und `renderWorkoutDetailCharts(w, rootEl)` (zeichnet gescoped auf `rootEl`) ausgelagert — so lässt sich dieselbe Detailansicht in mehreren Containern gleichzeitig zeigen (Modal + Kalender-Tagesansicht), ohne ID-Kollisionen. Enthält außerdem die "Trainingsbelastung"-Kachel sowie die Herzfrequenzprofil-/Belastungsprofil-Diagramme je Einheit (Berechnung in `js/analytics/workout-profile.js`).
- `data-import.js` — neue `.fit`-Dateien einlesen (Ordner-Scan-Menü + Drag & Drop).

### `js/app.js` — Einstiegspunkt
Definiert `renderAll()` (ruft die Render-Funktionen aller Tabs auf) und
startet am Ende die App: `initTopNav(); initFilterBar(); initCalendarControls();
initCoach(); renderAll();`. Muss als letztes Skript laden.

## Daten (`data/`)

`data/workouts-data.js` wird von `build_dashboard.py` aus `workouts.json`
generiert (`const EMBEDDED_DATA = [...]`) und enthält die echten,
persönlichen Trainingsdaten — deshalb über `.gitignore` vom Repository
ausgeschlossen. Ein `<script src="data/workouts-data.js">`-Tag lädt sie
ganz normal auch bei `file://`-Aufruf (im Unterschied zu `fetch()`, das
Chrome/Safari für lokale Dateien blockiert — deshalb kein direktes
`fetch("workouts.json")`).

`data/wellness-data.js` (`const GARMIN_WELLNESS = {...}`) wird von
`tools/garmin_sync.py` erzeugt und enthält die Gesundheitsdaten aus Garmin
Connect — gleiche Mechanik und gleicher Grund wie oben, ebenfalls in
`.gitignore`. `data/garmin-raw-cache.json` hält die Garmin-Rohantworten, damit
der Sync inkrementell bleibt. Beide sind optional: fehlen sie, startet das
Dashboard mit leerem Bestand (`EMPTY_WELLNESS`), und die Erholungs-Karte
blendet sich selbst aus.

## Garmin-Connect-Sync (`tools/`)

Getrenntes, freiwillig gestartetes lokales Werkzeug — **nicht Teil der App**.
Das Dashboard selbst bleibt serverlos, loginfrei und offline; es liest nur die
erzeugten lokalen Dateien. Siehe `docs/DATA_MODEL.md`, Abschnitt
„Abgrenzung zum Garmin-Sync".

| Datei | Zweck |
|---|---|
| `tools/garmin_sync.py` | Lädt Original-`.fit`-Dateien nach `fit-files/` und Gesundheitsdaten nach `data/wellness-data.js`. Anmeldung per Token unter `~/.garminconnect` (außerhalb des Projekts, da dieses in iCloud liegt); das Passwort wird nie gespeichert. |
| `sync-garmin.command` | Doppelklick-Start der kompletten Kette: Download → `parse_fit.py` → `build_dashboard.py` → Dashboard öffnen. |
| `tools/install-url-scheme.command` | Einmalige Einrichtung des URL-Schemas `tridash-sync://`, damit der Knopf im Update-Menü den Sync auslösen kann (eine Webseite darf kein Programm starten — macOS übernimmt das über das registrierte Schema). |

## Build/Entwicklungs-Skripte (nicht Teil der App selbst)

| Datei | Zweck |
|---|---|
| `parse_fit.py` | Python-Referenzimplementierung, liest `.fit`-Dateien (Standard: `fit-files/`) in `workouts.json`. Quellordner/Ziel per Argument überschreibbar. |
| `build_dashboard.py` | Erzeugt `data/workouts-data.js` aus `workouts.json`. |
| `verify_parser.py` | Vergleicht den JS-FIT-Parser Feld für Feld gegen die Python-Referenz. |
| `test_full_ui.py`, `test_new_features.py`, `test_dnd_ui.py` | Playwright-Regressionstests gegen `index.html`. |
