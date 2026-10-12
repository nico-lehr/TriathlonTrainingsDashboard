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
| C Garmin-Workouts auf die Uhr | fertig (geprüft: PASS; kleine Nachbesserungen) | 3 / 3 | 100 % | 2026-10-12 |
| D Handy / iPhone | fertig (geprüft: PASS; kleine CSS-Nachbesserungen eingebaut) | 4 / 4 | 100 % | 2026-10-12 |
| E Equipment, Wetter, Rennplan | fertig (E1 erst FAIL dann PASS; E2 PASS; E3 erst FAIL dann PASS) | 3 / 3 | 100 % | 2026-10-12 |
| F Abschluss-Check | Prüfung F1–F3 und Doku F4 fertig; meine Korrekturen werden von einem zweiten Prüfer kontrolliert | 3 / 4 | 75 % | 2026-10-12 |

**Gesamt: 95 % (20 von 21 Schritten)**

## Offene Fragen

### Aus dem Abschluss-Check F (nicht behoben, optional)

- Alte Endpunkte in `backend/routes.py` (Bestand, Zeilen ~261, 362, 440, 503, 556, 602, 659) geben bei Fehlern den Fehlertext/SQL nach außen und liefern bei kaputter Eingabe 500 statt 400. Sie sind jetzt nur noch nach Anmeldung erreichbar. Standard: so gelassen (alte Endpunkte nicht ändern).
- Login-Bremse nutzt die IP-Adresse; hinter `tailscale serve` (HTTPS) sehen alle `127.0.0.1` und teilen sich die Bremse (siehe unten).
- Doppelte Hilfsfunktionen: Tage bis zum Rennen (`context-builder.js` rechnet selbst, `daysUntilGoal()` in `nutrition.js` gibt es schon), lokale `shift`-Funktionen in `context-builder.js` und `periodization.js` (gibt es als `planShiftDay`). Funktioniert, nur doppelt.
- `race-plan.js` setzt eine Farbe per `style="background:…"` im HTML (wie schon die Sport-Punkte). Optional: CSS-Klasse je Sportart.
- Geteiltes Gerät: `riskCheckLastDate` gilt pro Gerät statt pro Person; ein Claude-API-Schlüssel bleibt nach Ablauf des Logins im Browser stehen (nur „Abmelden“ löscht ihn).
- Die alten Playwright-Skripte (`test_*.py` im Hauptordner) öffnen `index.html` per `file://` und laufen nicht mehr. Nicht gelöscht, in `docs/PROJECT_MAP.md` als veraltet markiert. Löschen oder auf den Server umbauen?
- `sync-garmin.command` (Mac, alter Ablauf) bringt keine Daten mehr ins Dashboard; Ersatz: `python tools/garmin_sync.py`. Nicht angefasst.
- Ein einzelner Login lässt sich nicht zurückziehen (gilt bis zu 30 Tage); alle abmelden geht über einen neuen `SECRET_KEY` in `.env`. In `docs/DEPLOYMENT.md` beschrieben.

### Im Abschluss-Check behoben

- README.md/README.txt beschrieben noch den alten Doppelklick-Ablauf → README neu geschrieben (Start über `start.bat`/`start.sh`, Benutzer anlegen, Garmin, Tailscale-Verweis).
- `escapeHtml()` maskierte keine Anführungszeichen: ein Titel wie `Lauf "locker" 5x1km` wurde im Bearbeiten-Fenster abgeschnitten (und war ein Einfallstor für eingeschleusten Code in den eigenen Daten). Jetzt maskiert (im Browser nachgeprüft).
- Ablage pro Person: Ein lange offener Tab konnte neuere Änderungen vom Handy still überschreiben → jetzt erscheint beim Zurückkehren in den Tab ein Hinweis mit „Neu laden“ (im Browser mit zwei Geräten nachgestellt und geprüft).
- Kalender-Abgleich scheiterte mit Fehler 500, wenn zwei Personen dieselbe Plan-Kennung hatten → Kennung bekommt die Nummer der Person vorangestellt.
- Wer zuerst angelegt wird, bekam alle alten Daten → `create_user.py` fragt vorher nach, `docs/DEPLOYMENT.md` sagt „zuerst dich selbst anlegen“.
- Upload-Grenze 64 MB (vorher keine), 16 statt 8 Server-Threads, Benutzernamen sind über die Antwortzeit nicht mehr erratbar, Start bricht mit klarer Meldung ab, wenn die Sicherung nicht klappt, `.gitignore` und Werkzeug-Version ergänzt.

### Weitere

- Zählfehler korrigiert: A–E sind 17 Schritte (3+4+3+4+3), nicht 18. Mit der fertigen Doku (F4) sind es jetzt 18 von 21.
- iPhone über HTTPS (`tailscale serve`): Der Server sieht dann alle Anfragen von `127.0.0.1`. Die Login-Bremse (5 Fehlversuche/Minute) gilt damit für alle HTTPS-Nutzer gemeinsam – tippt einer 5-mal falsch, müssen alle über HTTPS eine Minute warten. Standard: so gelassen (selten, nach 1 Minute vorbei). Änderbar, indem der Server bei Anfragen von `127.0.0.1` die von Tailscale mitgeschickte echte Adresse nimmt.
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
- C: Mit einem echten Garmin-Konto ist „An Garmin senden“ noch NICHT getestet (nur mit nachgebautem Garmin) – bitte selbst ausprobieren. Schwimm-Workouts könnte Garmin ablehnen; dann bietet das Dashboard den .fit-Download an. Erneutes Senden legt in Garmin ein zweites Workout an.
- C: „An Garmin senden“ braucht auf dem Dashboard-PC die Garmin-Bibliotheken (`python -m pip install -r requirements.txt`) und eine einmalige Garmin-Anmeldung je Person (`tools/garmin_sync.py --login --athlete <Nummer>`). Ohne sie erklärt das Dashboard, was fehlt, und bietet den .fit-Download an.
- E3: Zielzeiten werden überall als Std:Min(:Sek) gelesen („3:30“ = 3 h 30 min) – so geben es die Eingabefelder vor. Der Ernährungs-Tab las „3:30“ vorher als 3 min 30 s (alter Fehler, jetzt behoben).
- E2: „See“/„Meer“ zählen nur als eigenes Wort als Freiwasser („Seeschwimmen“ zählt deshalb als Becken). Wetter gibt es nur an Tagen mit Draußen-Einheit innerhalb der 7-Tage-Vorhersage.
- E3: Ziele lassen sich nach dem Anlegen nicht bearbeiten – fehlt die Zielzeit, steht im Rennplan „fehlt“, bis das Ziel neu angelegt wird. Ziele bearbeitbar machen?
- C1: Die Plan-Einheiten liegen in der Ablage pro Person, nicht in der alten Tabelle `planned_workouts` (die das Dashboard nicht nutzt). Standard: `steps` wird ein Feld der Plan-Einheit statt einer neuen Spalte – damit ist keine Datenbank-Änderung nötig.
- C2: Hochgeladen wird mit dem Garmin-Token aus dem Garmin-Sync (`~/.triathlon/garmin_<Nummer>.token`). Ohne Token gibt es eine Anleitung statt einer Passwort-Abfrage.
- E1: Equipment gab es schon im Browser. Es wird auf die neue Tabelle umgestellt; vorhandene Einträge werden einmalig übernommen.
- Welle 2 startete auf einer gemeinsamen Basis (Arbeitsstand + A vor Korrektur), damit weniger Konflikte entstehen.
- Reihenfolge: A startet erst nach Trainingsplaner 2/3 (gleiche Dateien), D erst nach dem Layout (gleiches CSS).
- Passwort vergessen: zusätzlich `backend/create_user.py --reset` gebaut (sonst gäbe es keinen Weg zurück).
- Altes Doppelklick-Dashboard: Daten lassen sich mit `tools/export-browser-data.html` exportieren und mit `backend/import_workouts_json.py --browser-export` übernehmen.

- Die Regeldateien AI_RULES.md, DESIGN_GUIDE.md und docs/TECH_DESIGN_2026.md gibt es nicht. Entscheidung (mit dir abgestimmt): Regeln aus deinen Nachrichten; Farben, Radien und Schatten aus `css/variables.css`.
- Tailscale-Fragen 2, 3 und 5: Empfehlungen übernommen (geheimer Kalender-Link, Ablage pro Person, alle Browser-Daten auf den Server).
