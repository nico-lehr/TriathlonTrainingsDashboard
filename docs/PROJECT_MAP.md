# PROJECT_MAP

Beschreibt, wo welche Funktionalität lebt. Bei größeren Architekturänderungen
mit aktualisieren (siehe AI_RULES.md, Abschnitt 26).

## Einstieg

Der Server (`start.bat` / `start.sh` → `backend/app.py`, waitress) liefert
unter http://localhost:5000 bzw. http://\<PC-Name\>:5000 (Tailscale) sowohl
die Webseite als auch die API aus – gleiche Adresse, daher kein CORS.
Betrieb: `docs/DEPLOYMENT.md`.

- `login.html` + `js/login.js` — Anmeldung (Benutzer legt nur
  `backend/create_user.py` an). Ohne Login springt `index.html` hierher.
- `index.html` — das Dashboard. Enthält nur Struktur (Header, Tabs,
  Karten-Container, Modals, Formulare) — keine Business-Logik, kein
  Inline-CSS. Lädt `css/*.css` und `js/**/*.js` über normale Tags.
- `manifest.json` + `icons/` — „Zum Home-Bildschirm“ auf iPhone/Android
  (Name, Symbol, Farben); die passenden `<meta>`-Tags stehen in `index.html`
  und `login.html`.

Eine Ausnahme: ein kleines Inline-`<script>` im `<head>` (in `index.html`
und `login.html`) setzt das gespeicherte Theme, BEVOR irgendetwas gerendert
wird (verhindert kurzes Aufblitzen im falschen Theme). Das ist die einzige
absichtlich verbleibende Inline-Logik.

Doppelklick auf `index.html` funktioniert nicht mehr (die Daten kommen vom
Server). Die Einzeldatei-Demo von `build-demo.py` läuft weiterhin ohne
Server (sie ersetzt `apiCall()` durch eingebettete Demodaten).

## Reihenfolge der `<script>`-Tags (wichtig!)

Jede Datei darf beim Laden nur auf Dinge zugreifen, die bereits geladen
sind. Innerhalb von Funktionsrümpfen ist das unkritisch (die werden erst
später beim tatsächlichen Aufruf ausgeführt, wenn ohnehin schon alles
geladen ist) — kritisch ist nur Code, der direkt beim Laden ausgeführt wird
(z. B. `let RAW = EMBEDDED_DATA;` oder die `initXyz()`-Aufrufe ganz am
Ende). Deshalb diese Ladereihenfolge in `index.html`:

```
js/data/api-client.js      (apiCall(), Login-Token, Ablage pro Person)
js/utils/*.js
js/data/*.js
js/analytics/*.js
js/ai/*.js
js/components/*.js
js/app.js                  (muss zuletzt laden: prüft den Login, lädt alle
                             Daten vom Server, ruft dann alle initXyz()
                             + renderAll() auf)
```

## CSS (`css/`)

| Datei | Inhalt |
|---|---|
| `variables.css` | Design-Tokens (`:root`, Light/Dark-Theme-Overrides). |
| `main.css` | Basis-Layout: Reset, `body`, Seiten-Hintergrund/Parallax, Header/Logo, Top-Navigation, globale `@keyframes`. |
| `components.css` | Alles Übrige: Buttons, Chips, Formulare, Karten, Tabellen, Modals, Charts, Kalender, Coach/Onboarding, Erholungs-Check usw. |
| `responsive.css` | Media Queries: `prefers-reduced-motion`, breite Bildschirme (`min-width: 2000px`), Tablet/Handy (`max-width: 980px`/`600px`/`480px`), Touch (`pointer: coarse`, `hover: none`). |

Breite: Inhalt höchstens ca. 1680 px (ab 2000 px Bildschirm 1920 px), Karten
im Raster `repeat(auto-fit, minmax(420px, 1fr))`, unter 900 px einspaltig.
Farben/Abstände nur über Variablen aus `variables.css` (u. a. `--accent-fill`,
`--c-*-text`, `--safe-*` für die iPhone-Ränder, `--touch-min` für
Tippflächen).

`main.css` vs. `components.css` ist eine pragmatische, keine perfekte
Trennung — bei Bedarf können einzelne Regeln aus `components.css` bei
Gelegenheit weiter in eigene Dateien (z. B. `coach.css`) aufgeteilt werden.

## JavaScript (`js/`)

### `js/utils/` — reine Hilfsfunktionen, keine App-Logik
- `dates.js` — Datum/Zeit-Formatierung, Wochenstart, Pace↔Sekunden, `goalTimeToSeconds()` (der eine Parser für Zielzeiten `H:MM(:SS)`).
- `formatting.js` — Text-/Zahlen-Formatierung (`fmtH`, `fmtNum`, `escapeHtml`, …).
- `calculations.js` — reine, DOM-freie Berechnungen (`niceMax`, Bestleistungen).

### `js/data/` — Datenhaltung (Laden/Speichern/Ableiten), keine UI

Alle persönlichen Daten liegen auf dem Server, je Person getrennt. Die
Module lesen synchron per `storeGet()` aus einem beim Start geladenen Stand
und speichern per `storeSet()` (beides `api-client.js`); localStorage hält
nur noch Login-Token, Theme und Geräte-Einstellungen (Ollama-Modell,
Claude-API-Key, Kartenreihenfolge).

- `api-client.js` — `apiCall()` (relative Adresse `api/v1/…`, Bearer-Token, bei 401 → `login.html`), `requireLogin()`, `logout()` (leert den Browser bis aufs Theme), `showApiError()` (Hinweisbanner), Ablage pro Person `loadUserStore()`/`storeGet()`/`storeSet()` (GET/PUT `/api/v1/store`; mehrere schnelle Änderungen werden zu einer Anfrage zusammengefasst), dazu die älteren `TriathlonApiClient`-Komfortmethoden.
- `fit-parser.js` — Binärparser für Garmin `.fit`-Dateien (kein Netzwerk, keine Abhängigkeiten). Liest auch Bahnen-Nachrichten (Schwimmen, SWOLF) und generische Developer-Felder mit ein — Fundament für künftige Garmin-Connect-/Strava-Daten, siehe `docs/DATA_MODEL.md`.
- `garmin-wellness.js` — Zugriffsschicht auf die Garmin-Gesundheitsdaten (`loadWellness()` → `GET /api/v1/wellness/daily`, je Benutzer vom Garmin-Sync in die Datenbank geschrieben): `latestWellness()`, `wellnessSeries()`, `wellnessBaseline()`, `wellnessDeviation()` (Abweichung vom eigenen 30-Tage-Mittel — nur so ist ein HRV-Wert interpretierbar) und `syncGarminWeightIntoLog()`. Startet mit leerem Bestand, wenn nie synchronisiert wurde.
- `workouts.js` — Rohdaten (`ALL`/`DATA`), Laden vom Server (`loadPersistedWorkouts()` → `GET /api/v1/workouts/full`), Speichern neu eingelesener Workouts (`saveImportedWorkouts()` → `POST /api/v1/workouts`, Doppelte ignoriert der Server), Zeitraum-/Sportart-Filter. Enthält außerdem die zentralen Gruppierungs-Primitive, an denen JEDE Referenzgruppe hängt: `sportGroup()`, `rideEnvironment()` (Indoor/Outdoor beim Rad, als `_rideEnv` materialisiert), `comparisonGroupLabel()`, `isIndoorRide()`, `rideEnvBadgeHtml()` und vor allem `sameComparisonGroup()` — wer mit wem verglichen werden darf, wird nur dort entschieden (siehe `docs/DATA_MODEL.md`, Abschnitt "Indoor/Outdoor-Erkennung beim Rad").
- `goals.js` — Ziel-Events (Laden/Speichern/Anlegen/Löschen).
- `athlete.js` — Athletenprofil (Laden/Speichern), Trainingstage-Konstanten.
- `health.js` — Erholungs-Check-Zustand inkl. täglichem Reset + Logbuch-Archivierung.
- `planned-workouts.js` — geplante/KI-vorgeschlagene Trainingseinheiten (Laden/Speichern/Anlegen/Verschieben), getrennt von den echten Workouts (`ALL`/`DATA`); setzt die Phase je Einheit (`getPhase`), prüft Verschiebungen gegen die Planregeln (`planRuleViolations`, `applyPlanSuggestion`), nimmt KI-Pläne nur geprüft an (`checkedPlanFromAi`) und hält die Schritte einer Einheit (`validateWorkoutSteps`, `defaultWorkoutSteps`), siehe `docs/DATA_MODEL.md`.
- `plan-wishes.js` — Terminwünsche für den Trainingsplan („Do 60 min Schwimmen“), werden bei der nächsten KI-Planung fest eingeplant.
- `fit-workout-writer.js` — schreibt eine geplante Einheit als importierbare `.fit`-Workout-Datei für Garmin Connect (Gegenrichtung zu `fit-parser.js`) und schickt sie auf Wunsch direkt an Garmin (`sendPlannedWorkoutToGarmin` → `backend/garmin_workouts.py`), siehe `docs/DATA_MODEL.md`.
- `weather.js` — Wetter für den Kalender: holt über den eigenen Server die 7-Tage-Vorhersage für den Heimatort (`athleteProfile.homeLocation`), Ortssuche, WMO-Code → Symbol.
- `equipment.js` — Material (Schuhe, Rad, Verschleißteile) über `/api/v1/equipment`, Kilometer und Fälligkeit; übernimmt einmalig die alte Liste aus der Ablage.
- `weight-log.js` — Gewichtsverlauf (Laden/Speichern/Eintragen), hält `athleteProfile.weightKg` synchron, siehe `docs/DATA_MODEL.md`.
- `achievements.js` — Laden/Speichern der bereits freigeschalteten Erfolge (`achievementsState`) + Erfolgs-Schnappschuss (z. B. letzte bekannte Bestzeit je Distanz). Die eigentliche Erkennung/Freischaltung passiert in `js/analytics/achievements.js`, siehe `docs/DATA_MODEL.md`.

### `js/analytics/` — reine Berechnungen, kein UI
- `training-load.js` — CTL/ATL/TSB (PMC), ACWR-Zeitreihen, Trainingsmonotonie/-Strain nach Foster (1998, `computeMonotonyStrainSeries`) und der Monatsvergleich (`computeMonthComparison`, aktueller vs. vorheriger Kalendermonat).
- `performance.js` — kompakte Bestzeiten-Zusammenfassung für den KI-Kontext, sowie die getrennte VO2max-Schätzung + Trend für Laufen und Rad (`computeVo2MaxEstimate`, primär per Pace/Watt-Puls-Regression) für die zwei Kennzahlen-Kacheln ganz oben im Überblick.
- `workout-comparison.js` — findet vergleichbare frühere Einheiten (gleiche Sportart, Distanz/Dauer ±20%) für die KI-Auswertung je Einheit.
- `race-readiness.js` — Race Readiness Score (0-100, rein rechnerisch, kein LLM) für Ziele mit Event-Datum: kombiniert Form/TSB, ACWR, Trainingskonstanz und Taper-Phase, siehe `docs/DATA_MODEL.md`.
- `hr-distribution.js` — Puls-Zeitanteil je Sportart aus den Sekunden-Pulswerten (`workout.stream.hr`), geglättetes Histogramm für das Ridgeline-Chart "Herzfrequenzverteilung nach Aktivität". Stellt `hrDensityFromValues()` bereit, die auch `workout-profile.js` nutzt.
- `workout-profile.js` — Trainingsbelastung (TRIMP/Stress-Score), Herzfrequenzprofil und Belastungsprofil (Radar) einer einzelnen Einheit für die Detailansicht, siehe `docs/DATA_MODEL.md`.
- `training-plan.js` — rein deterministischer Teil des automatischen Trainingsplans: Phase als Text (aus `periodization.js`), rollierendes Planungsfenster, Auto-Nachplan-Check (`computeTrainingPhase`/`computePlanningWindow`/`shouldAutoReplan`), siehe `docs/DATA_MODEL.md`.
- `plan-rules.js` — Regelwerk für Trainingspläne (`validatePlan`, 7 Regeln, „block“/„warn“ mit konkretem Vorschlag). Entscheidet allein, ob ein Plan zu hart ist — die KI schlägt nur vor.
- `periodization.js` — Trainingsphase eines Tages vor dem Hauptevent (`getPhase`, `getPhaseTimeline`) und Zielumfang je Woche (`getWeeklyTargets`). Einzige Quelle für Phasen.
- `race-plan.js` — Rennplan je Ziel: Tempo je Disziplin aus Distanz + Zielzeit, Tage der Rennwoche, Standard-Checklisten.
- `triathlon.js` — Analyse-Tab: Sport-Balance, Schwimm-CSS + Trend, Rad-FTP-Schätzung + Leistungszonen, Koppeltraining.
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
- `ollama.js` — Ollama-Einstellungen, Verbindungstest, Empfehlung generieren, Trainingsplan erstellen (Empfehlung Heute / Diese Woche / Nächste Woche; jeder KI-Plan läuft durch `validatePlan`, mit Auto-Korrektur oder höchstens 2 Nachfragen). Fragt nie Ollama direkt, sondern den eigenen Server (`POST /api/v1/ai/chat`, `GET /api/v1/ai/models`); die Ollama-Adresse steht in `.env` (`OLLAMA_URL`).

### `js/components/` — UI-Komponenten (Rendering + Interaktion)
- `chart.js` — wiederverwendbare SVG-Bausteine (Tooltip, `svgEl`, Mini-Liniencharts, Animationen).
- `app-shell.js` — Theme-Umschalter, Parallax-Effekt, Top-Navigation, Filterleiste (Zeitraum-Chips + freies Von/Bis-Datum, Sportart), generische Drag-&-Drop-Kachel-Sortierung (`initDragGrid`, von Übersicht UND Coach-Tab genutzt).
- `card-search.js` — Kachel-Suche im Topnav: filtert/hebt beim Tippen die `.card`-Elemente im gerade aktiven Tab hervor (Titel + Untertext), kein Tab-übergreifender Sprung.
- `dashboard.js` — Übersicht-Tab: Kennzahlen-Kacheln (inkl. Trainingsplan-Treue-Streak-Kachel 🔥, sichtbar sobald `athleteProfile.trainingDays` gepflegt ist), Monatsvergleich, Wochenumfang, HF-Trend, Sportverteilung, Fitness & Form, ACWR, Trainingsmonotonie, HF-Zonen, Herzfrequenzverteilung nach Aktivität (Ridgeline), Trainingsbelastungsfokus, Pace-Entwicklung.
- `achievements.js` — Übersicht-Tab: "Erfolge"-Karte (`renderAchievements`, liest `achievementsState.unlocked`) + Feier-Toast beim Freischalten neuer Erfolge (`showAchievementToast`), siehe `docs/DATA_MODEL.md`.
- `calendar.js` — Kalender-Tab (mit Wetter je Tag, falls ein Heimatort gesetzt ist): Monats-, Wochen- und Tagesansicht (`calViewMode`). Tagesansicht nutzt die aus `workout-card.js` ausgelagerten `buildWorkoutDetailHtml()`/`renderWorkoutDetailCharts()`, um Trainings einzeln (mehrere gleichzeitig) aufklappbar mit vollem Detail-Chart darzustellen. Zeigt zusätzlich geplante Einheiten (`plannedWorkouts`) als gestrichelte Chips in allen drei Ansichten, per HTML5-Drag&Drop auf einen anderen Tag verschiebbar (`wireCalPlannedDrag`/`wireCalDropTarget`), Klick öffnet das Bearbeiten-Overlay aus `training-plan.js`. Steuerleiste hat zusätzlich einen "+ Workout"-Button, der dasselbe Overlay im Neuanlage-Modus für den gerade fokussierten Tag öffnet (`openPlanEdit(null, {date, goalId})`). Wochenansicht hat zusätzlich einen "Woche für Garmin exportieren"-Button für alle noch geplanten Einheiten der sichtbaren Woche, siehe `docs/DATA_MODEL.md`.
- `records.js` — Rekorde-Tab.
- `health-status.js` — Erholungs-Check-UI (Chips + Status-Badge) im Coach-Tab.
- `coach.js` — Coach-Tab: Onboarding-Assistent (6 Schritte, inkl. Trainingsplan-Präferenzen Kraft/Mobility + Hauptevent-Auswahl) mit Onboarding-Gate, Athletenprofil-Sync, Ziel-Liste (inkl. ★-Hauptevent-Markierung), Ollama-Einstellungsmenü.
- `training-plan.js` — Trainingsplan-Kachel im Coach-Tab (nächste geplante Einheiten + manuelles Nachplanen + Terminwünsche + Regel-Hinweise + Garmin-Export einzeln/gesammelt + „An Garmin senden“) und das Bearbeiten-/Neuanlage-Overlay für eine geplante Einheit (`openPlanEdit(id, defaults)`, `id === null` = manuelle Neuanlage; auch aus `calendar.js` aufrufbar), siehe `docs/DATA_MODEL.md`.
- `nutrition.js` — Ernährung-Tab: Gewichtsverlauf-Eingabe, Tagesziel-Makros, Pre-Workout-Timing, Wettkampf-Verpflegungsplan (reines Rendering, Berechnung in `js/analytics/nutrition.js`), siehe `docs/DATA_MODEL.md`.
- `workout-card.js` — Workout-Tabelle + Detailansicht-Modal. Detail-Markup/Charts sind in `buildWorkoutDetailHtml(w)` (HTML-String, Chart-Container per Klasse `.wd-*` statt fixer ID) und `renderWorkoutDetailCharts(w, rootEl)` (zeichnet gescoped auf `rootEl`) ausgelagert — so lässt sich dieselbe Detailansicht in mehreren Containern gleichzeitig zeigen (Modal + Kalender-Tagesansicht), ohne ID-Kollisionen. Enthält außerdem die "Trainingsbelastung"-Kachel sowie die Herzfrequenzprofil-/Belastungsprofil-Diagramme je Einheit (Berechnung in `js/analytics/workout-profile.js`).
- `race-countdown.js` — Wettkampf-Countdown im Coach-Tab: Tage bis zum Hauptevent, aktuelle Phase mit Erklärung, Wochenumfang Ziel/Ist, nächster Phasenwechsel.
- `race-plan.js` — „Rennplan“ je Ziel im Coach-Tab (Pacing, Checklisten Wechselzone/Ausrüstung und Verpflegung, Rennwoche).
- `analysis.js` — Analyse-Tab (Triathlon-Auswertungen, Berechnung in `js/analytics/triathlon.js`).
- `weather.js` — Einstellungen: „Wetter im Kalender“ (Heimatort suchen und speichern).
- `equipment.js` — Material-Bereich in den Einstellungen + Hinweis, wenn etwas fällig ist.
- `data-import.js` — neue `.fit`-Dateien einlesen (Ordner-Scan-Menü + Drag & Drop) und auf dem Server speichern.
- `account.js` — „Konto“-Karte in den Einstellungen: angemeldeter Benutzer, Abmelden.

### `js/app.js` — Einstiegspunkt
Definiert `renderAll()` (ruft die Render-Funktionen aller Tabs auf) und
startet am Ende die App: prüft den Login (`requireLogin()`), lädt Ablage,
Trainings, Gesundheitsdaten und Material vom Server (bei Fehler: Hinweis
und Abbruch), dann `initTopNav(); initFilterBar(); initCalendarControls();
initCoach(); renderAll();`. Muss als letztes Skript laden.

## Daten (Server, `training.db`)

Alle Daten liegen in der SQLite-Datenbank `training.db` (per `.gitignore`
ausgeschlossen), jede Zeile mit `athlete_id`:

- `workouts` — Trainings. Das komplette Parser-Ergebnis (inkl. Kurven) steht in
  `fit_data`; Doppelte verhindert `backend/workout_store.py` (gleicher Tag +
  Startzeit + Sportart) bzw. `UNIQUE(athlete_id, garmin_activity_id)`.
- `wellness` — Garmin-Gesundheitsdaten je Tag (alle Werte in `garmin_wellness_data`).
- `athlete_store` — Ablage pro Person: Profil, Ziele, Plan, Erholung, Gewicht,
  Material, Notizen, Erfolge, KI-Auswertungen – genau das JSON, das der Browser
  kennt (Schlüssel wie früher in localStorage).
- `athlete_logins` — Benutzername + Passwort-Hash.
- `equipment`, `equipment_workouts` — Material je Person und die ausdrückliche
  Zuordnung Training → Material.
- Die älteren Tabellen (`goals`, `planned_workouts`, `recovery_checks`) und ihre
  Endpunkte bestehen unverändert weiter, das Dashboard nutzt sie nicht.

`data/workouts-data.js` und `data/wellness-data.js` lädt das Dashboard nicht
mehr (der Server liefert `data/` bewusst nicht aus). Bisherige Daten übernimmt
einmalig `backend/import_workouts_json.py`, siehe `docs/DEPLOYMENT.md`.

## Backend (`backend/`)

| Datei | Zweck |
|---|---|
| `app.py` | Start mit waitress (Host 0.0.0.0, Port 5000, änderbar in `.env`); sichert vorher `training.db` (`backup.py`). |
| `__init__.py` | `create_app()` (verweigert den Start ohne `SECRET_KEY`), `get_current_athlete_id()` liest den Bearer-Token. |
| `config.py` | Einstellungen, lädt `.env` (`SECRET_KEY`, `OLLAMA_URL`). |
| `auth.py` | Passwort-Hash, signierte Token (30 Tage), geheimer Kalender-Schlüssel, Bremse 5 Fehlversuche/Minute/IP. |
| `routes.py` | Bestehende Endpunkte + `require_login()` (401 außer `/health`, `/auth/login`) + `/auth/login`, `/auth/me`. |
| `dashboard_routes.py` | `/store`, `/workouts/full`, `/wellness/daily`, `/ical-link`. |
| `ai_routes.py` | `/ai/chat`, `/ai/models` – Weiterleitung an Ollama. |
| `equipment_routes.py` | `/equipment…` – Material anlegen/ändern/löschen, Zuordnungen, einmaliger Import. |
| `garmin_workouts.py` | `/planned-workouts/<id>/send-to-garmin` – geplante Einheit als Garmin-Workout hochladen und in den Garmin-Kalender legen (Token des Garmin-Syncs). |
| `weather_routes.py` | `/weather`, `/weather/geocode` – Open-Meteo-Vorhersage und Ortssuche, 1 Stunde zwischengespeichert. |
| `frontend.py` | Liefert nur die Erlaubt-Liste aus (`index.html`, `login.html`, `manifest.json`, `css/`, `js/`, `icons/`). |
| `workout_store.py` | Gemeinsame Duplikat-Regel + Workout-Zeile aus Parser-Ergebnis (POST, Import, Garmin-Sync). |
| `models.py` | Tabellen. |
| `create_user.py` | Benutzer anlegen / `--reset` Passwort neu. |
| `import_workouts_json.py` | Einmal-Import `workouts.json` und Browser-Export für einen Benutzer. |
| `setup_env.py` | Legt beim ersten Start `.env` mit Zufallsschlüssel an. |
| `test_*.py` | Tests: `python -m unittest discover -s backend -t .` |

## Garmin-Connect-Sync (`tools/`)

Getrennt gestartetes Werkzeug, schreibt für jeden Benutzer mit Garmin-Token
Trainings und Gesundheitsdaten in die Datenbank. Anleitung:
`docs/GARMIN_SYNC_GUIDE.md`.

| Datei | Zweck |
|---|---|
| `tools/garmin_sync.py` | `--athlete <id>` / alle mit Token; `--login --athlete <id>` meldet bei Garmin an (Token unter `~/.triathlon/garmin_<id>.token`, Passwort wird nie gespeichert). Original-.fit-Archiv je Benutzer unter `fit-files/athlete_<id>/`. Eine Log-Zeile je Benutzer in `~/.triathlon/garmin-sync.log`. |
| `tools/__init__.py` | Macht `tools/` importierbar (der Server nutzt die Garmin-Anmeldung aus `garmin_sync.py` für „An Garmin senden“). |
| `tools/export-browser-data.html` | Einmal-Export der Daten des alten Doppelklick-Dashboards aus dem Browser (nur per Doppelklick, wird nicht ausgeliefert). |
| `sync-garmin.command`, `tools/install-url-scheme.command` | Alter Mac-Einzelplatz-Ablauf (Sync → `parse_fit.py` → `build_dashboard.py`); bringt keine Daten mehr ins Server-Dashboard. |

## Build/Entwicklungs-Skripte (nicht Teil der App selbst)

| Datei | Zweck |
|---|---|
| `start.bat` / `start.sh` | Startet den Server (installiert beim ersten Mal die Bibliotheken, legt `.env` an). |
| `backup.py` / `backup.bat` | Sichert `training.db` nach `backups/` (eine Datei pro Tag, die letzten 14). |
| `parse_fit.py` | Python-Referenzimplementierung, liest `.fit`-Dateien (Standard: `fit-files/`) in `workouts.json`. Quellordner/Ziel per Argument überschreibbar. |
| `build_dashboard.py` | Erzeugt `data/workouts-data.js` aus `workouts.json`. |
| `verify_parser.py` | Vergleicht den JS-FIT-Parser Feld für Feld gegen die Python-Referenz. |
| `test_full_ui.py`, `test_new_features.py`, `test_dnd_ui.py` | Playwright-Regressionstests gegen `index.html`. |
| `tests/js/*.test.js` | Tests der Rechenlogik ohne Browser (Planregeln, Periodisierung, Rennplan, Wetter, Triathlon-Auswertungen, Material, Schritte): `node --test tests/js/` |
| `PROGRESS.md` | Fortschritt und offene Fragen des Arbeitspakets. |
