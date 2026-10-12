# PROGRESS – Arbeitspaket

Zweig: `feature/arbeitspaket` (enthält auch `feature/login-tailscale`). `main` bleibt unverändert.
Ein Schritt zählt erst als erledigt, wenn Tests und Prüfung bestanden sind.

## Vorarbeiten (Voraussetzung für das Paket, nicht in den 21 Schritten)

| Vorarbeit | Status | Letzte Änderung |
|---|---|---|
| Tailscale Etappe 1 – Login (Backend) | fertig | 2026-10-12 |
| Tailscale Etappe 2 – Frontend ausliefern | fertig | 2026-10-12 |
| Tailscale Etappe 3 – Frontend auf API | fertig | 2026-10-12 |
| Tailscale Etappe 4 – Import | fertig | 2026-10-12 |
| Tailscale Etappe 5 – KI über Backend | fertig | 2026-10-12 |
| Tailscale Etappe 6 – Betrieb | fertig | 2026-10-12 |
| Tailscale Etappe 7 – Garmin mehrere Nutzer | fertig | 2026-10-12 |
| Layout (breitere Seite) | fertig | 2026-10-12 |
| Trainingsplaner 1 – Regelwerk plan-rules.js | fertig | 2026-10-12 |
| Trainingsplaner 2 – Verschieben & Wünsche | fertig | 2026-10-12 |
| Trainingsplaner 3 – KI-Empfehlungen | fertig | 2026-10-12 |

## Arbeitspaket (21 Schritte)

| Aufgabe | Status | Erledigte Schritte | Prozent | Letzte Änderung |
|---|---|---|---|---|
| A Wettkampf-Countdown & Periodisierung | fertig (geprüft in 3 Runden, zuletzt PASS) | 3 / 3 | 100 % | 2026-10-12 |
| B Triathlon-Auswertungen | fertig (geprüft: erst FAIL, nach Korrektur PASS) | 4 / 4 | 100 % | 2026-10-12 |
| C Garmin-Workouts auf die Uhr | läuft | 0 / 3 | 0 % | 2026-10-12 |
| D Handy / iPhone | fertig (geprüft: PASS; kleine CSS-Nachbesserungen eingebaut) | 4 / 4 | 100 % | 2026-10-12 |
| E Equipment, Wetter, Rennplan | E1 in Prüfung, E2+E3 läuft | 0 / 3 | 0 % | 2026-10-12 |
| F Abschluss-Check | offen | 0 / 4 | 0 % | – |

**Gesamt: 52 % (11 von 21 Schritten)**

## Offene Fragen

- `.btn-primary` / `.btn-secondary` gibt es im CSS nicht. Standard: Hauptknopf = `.update-btn`, Nebenknopf = `.cal-today-btn` (beide vorhanden).
- Einen „Analyse“-Tab gab es nicht. Standard: Aufgabe B legt ihn neu an (ein Tab-Knopf + eine Ansicht).
- Layout: Mit der gewünschten Mindestbreite 420 px stehen bei 1680 px drei Karten nebeneinander; weil die Übersicht-Karten in Zweier-/Vierergruppen kommen, bleiben in manchen Reihen Lücken. Wer keine Lücken will: Mindestbreite in `.dash-grid` auf ca. 540 px setzen (dann 2 Spalten bis ca. 2000 px). Vorerst wie gewünscht 420 px.
- Layout: Diagramm-Beschriftungen wachsen auf sehr breiten Karten mit (SVG wird skaliert); Eingabefelder in den Einstellungen werden sehr breit. Optional später.
- Trainingsplaner: Eine Verschiebung oder ein KI-Plan wird nur an den Verstößen gemessen, die er NEU erzeugt (vorhandene Probleme blockieren nichts). Bleibt nach Selbstkorrektur und 2. KI-Versuch ein „block“, wird der KI-Plan nicht gespeichert und der alte Plan bleibt erhalten.
- B: Der neue Tab „Analyse“ steht hinten (nach „Rekorde“) und nutzt immer die ganze Historie (der Zeitraum-Filter gibt es nur in der Übersicht). Koppeltraining ist nur mit erfundenen Daten getestet – mit echten Multisport-Dateien noch einmal ansehen.
- A: Die Phasen-Angaben (Taper 7–14 Tage, Spezifisch 4–6 Wochen, Aufbau 6–8 Wochen) überschneiden sich, wenn man sie als Abstand zum Rennen liest. Standard: als Phasen-LÄNGEN gelesen – Taper 2 Wochen (inkl. Rennwoche), Spezifisch 6, Aufbau 8, davor Grundlage; Wechsel immer montags. Änderbar über Konstanten in `js/analytics/periodization.js`.
- A: Plan-Einheiten nutzen das vorhandene Feld `phase` (statt eines zweiten Felds `training_phase`). Neue Regel 7 „Erholungswoche nach dem Rennen“ ist eine Warnung, kein Block.
- D: iPhone-Layout braucht iOS 16 oder neuer; Kalender-Monatsansicht scrollt auf dem Handy innerhalb der Karte; Kopieren-Knöpfe gehen auf dem iPhone nur über HTTPS (`tailscale serve`).
- A: Wochenziel = letzte normale Trainingswoche × Wachstum (Grundlage +3 %, Aufbau +5 %, max. +30 %); nach 2+ leichten Wochen (z. B. krank) startet die Kurve vorsichtig bei höchstens der Hälfte des alten Umfangs. Taper 70 %, Rennwoche 50 %, Erholung 40 %.
- E1: Die „Fällig“-Banner in Übersicht/Kalender hattest du im September entfernt; die 90-%-Warnung erscheint deshalb nur als Hinweis „bald fällig“ in den Einstellungen. Banner wieder einbauen? (zwei Zeilen)
- C1: Die Plan-Einheiten liegen in der Ablage pro Person, nicht in der alten Tabelle `planned_workouts` (die das Dashboard nicht nutzt). Standard: `steps` wird ein Feld der Plan-Einheit statt einer neuen Spalte – damit ist keine Datenbank-Änderung nötig.
- C2: Hochgeladen wird mit dem Garmin-Token aus dem Garmin-Sync (`~/.triathlon/garmin_<Nummer>.token`). Ohne Token gibt es eine Anleitung statt einer Passwort-Abfrage.
- E1: Equipment gab es schon im Browser. Es wird auf die neue Tabelle umgestellt; vorhandene Einträge werden einmalig übernommen.
- Welle 2 startete auf einer gemeinsamen Basis (Arbeitsstand + A vor Korrektur), damit weniger Konflikte entstehen.
- Reihenfolge: A startet erst nach Trainingsplaner 2/3 (gleiche Dateien), D erst nach dem Layout (gleiches CSS).
- Passwort vergessen: zusätzlich `backend/create_user.py --reset` gebaut (sonst gäbe es keinen Weg zurück).
- Altes Doppelklick-Dashboard: Daten lassen sich mit `tools/export-browser-data.html` exportieren und mit `backend/import_workouts_json.py --browser-export` übernehmen.

- Die Regeldateien AI_RULES.md, DESIGN_GUIDE.md und docs/TECH_DESIGN_2026.md gibt es nicht. Entscheidung (mit dir abgestimmt): Regeln aus deinen Nachrichten; Farben, Radien und Schatten aus `css/variables.css`.
- Tailscale-Fragen 2, 3 und 5: Empfehlungen übernommen (geheimer Kalender-Link, Ablage pro Person, alle Browser-Daten auf den Server).
