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
| Trainingsplaner 2 – Verschieben & Wünsche | läuft | 2026-10-12 |
| Trainingsplaner 3 – KI-Empfehlungen | läuft | 2026-10-12 |

## Arbeitspaket (21 Schritte)

| Aufgabe | Status | Erledigte Schritte | Prozent | Letzte Änderung |
|---|---|---|---|---|
| A Wettkampf-Countdown & Periodisierung | offen | 0 / 3 | 0 % | – |
| B Triathlon-Auswertungen | läuft | 0 / 4 | 0 % | 2026-10-12 |
| C Garmin-Workouts auf die Uhr | offen | 0 / 3 | 0 % | – |
| D Handy / iPhone | läuft | 0 / 4 | 0 % | 2026-10-12 |
| E Equipment, Wetter, Rennplan | offen | 0 / 3 | 0 % | – |
| F Abschluss-Check | offen | 0 / 4 | 0 % | – |

**Gesamt: 0 % (0 von 21 Schritten)**

## Offene Fragen

- `.btn-primary` / `.btn-secondary` gibt es im CSS nicht. Standard: Hauptknopf = `.update-btn`, Nebenknopf = `.cal-today-btn` (beide vorhanden).
- Einen „Analyse“-Tab gab es nicht. Standard: Aufgabe B legt ihn neu an (ein Tab-Knopf + eine Ansicht).
- Layout: Mit der gewünschten Mindestbreite 420 px stehen bei 1680 px drei Karten nebeneinander; weil die Übersicht-Karten in Zweier-/Vierergruppen kommen, bleiben in manchen Reihen Lücken. Wer keine Lücken will: Mindestbreite in `.dash-grid` auf ca. 540 px setzen (dann 2 Spalten bis ca. 2000 px). Vorerst wie gewünscht 420 px.
- Layout: Diagramm-Beschriftungen wachsen auf sehr breiten Karten mit (SVG wird skaliert); Eingabefelder in den Einstellungen werden sehr breit. Optional später.
- Reihenfolge: A startet erst nach Trainingsplaner 2/3 (gleiche Dateien), D erst nach dem Layout (gleiches CSS).
- Passwort vergessen: zusätzlich `backend/create_user.py --reset` gebaut (sonst gäbe es keinen Weg zurück).
- Altes Doppelklick-Dashboard: Daten lassen sich mit `tools/export-browser-data.html` exportieren und mit `backend/import_workouts_json.py --browser-export` übernehmen.

- Die Regeldateien AI_RULES.md, DESIGN_GUIDE.md und docs/TECH_DESIGN_2026.md gibt es nicht. Entscheidung (mit dir abgestimmt): Regeln aus deinen Nachrichten; Farben, Radien und Schatten aus `css/variables.css`.
- Tailscale-Fragen 2, 3 und 5: Empfehlungen übernommen (geheimer Kalender-Link, Ablage pro Person, alle Browser-Daten auf den Server).
