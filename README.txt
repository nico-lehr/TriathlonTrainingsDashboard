Triathlon Trainings-Dashboard
==============================

Dateien:
- index.html         -> Öffnen im Browser (Doppelklick), zeigt alle Diagramme
                        (lädt automatisch alles aus css/, js/ und data/ mit,
                        auch offline -- einfach diesen ganzen Ordner behalten)
- css/, js/           -> Der eigentliche Programmcode, nach Zweck aufgeteilt
                        (Details siehe docs/PROJECT_MAP.md)
- data/workouts-data.js -> Die aufbereiteten Trainingsdaten, fürs Dashboard
                        aufbereitet aus workouts.json
- workouts.json      -> Die aufbereiteten Trainingsdaten (zentrale Datenbank)
- parse_fit.py       -> Python-Skript (nur für Claude/Entwicklung), liest .fit-Dateien ein
- build_dashboard.py -> Baut data/workouts-data.js aus workouts.json (nur für Claude/Entwicklung)

Stand: komplettes Jahr 2026 (Januar bis 25.08.), 104 Trainingseinheiten.

Selbstständig aktualisieren, ganz ohne Chat
--------------------------------------------------
Oben im Dashboard gibt es jetzt ein Menü (Pfeil neben dem Button) mit zwei
Wegen, neue Trainings einzulesen:

- "Aktualisieren": wie bisher — öffnet den Finder, wähle den Ordner mit
  deinen .fit-Dateien (iCloud Drive > HealthFit > Documents) und öffne ihn.
- "Drag & Drop zur Auswahl": öffnet ein Fenster, in das du einzelne
  .fit-Dateien direkt hineinziehen kannst (z.B. wenn du nur eine bestimmte
  Einheit nachladen willst) — alternativ per Klick auswählen.

Beide Wege lesen die Dateien direkt im Browser ein (komplett offline, es
verlässt nichts deinen Rechner) und ergänzen neue Trainings, ohne die
bestehenden zu ersetzen — neu hinzugekommene Einheiten werden kurz grün
hervorgehoben. Der letzte Stand wird im Browser gespeichert, sodass er beim
nächsten Öffnen sofort wieder da ist.

Der Ordner-Scan schaut dabei bis zu ca. 13 Monate zurück, damit auch nach
einem Jahreswechsel immer der komplette Jahresüberblick aktuell bleibt.
Falls im Browser mal ein alter/unvollständiger Stand hängen bleiben sollte,
bringt "Datenstand zurücksetzen" (neben dem Aktualisieren-Menü) das
Dashboard wieder auf den zuletzt von mir gelieferten Stand zurück.

Tipp: Nach diesem Update lohnt sich einmal "Aktualisieren" über den ganzen
HealthFit-Ordner, auch für längst vorhandene Einheiten — die neuen
Kennzahlen (Kadenz, Höhenprofil usw., siehe unten) stehen für eine Einheit
erst zur Verfügung, sobald ihre .fit-Datei einmal neu eingelesen wurde.

Hinweis: Dein Schwimm-Workout von heute (27.08.) war beim Erstellen dieses
Dashboards noch nicht vollständig von der Uhr über HealthFit nach iCloud
synchronisiert (iCloud zeigte die Datei nur als "Cloud-Platzhalter", noch
nicht lokal heruntergeladen). Sobald sie auf deinem Mac angekommen ist, holt
"Aktualisieren" sie beim nächsten Klick automatisch nach.

Hell/Dunkel & sticky Menü
--------------------------------------------------
Der Kreis-Button links neben dem Zeitstempel schaltet manuell zwischen
hellem und dunklem Design um (überschreibt die Betriebssystem-Einstellung,
merkt sich die Wahl). Die Menüleiste (Übersicht/Kalender/Rekorde/Coach)
bleibt jetzt beim Scrollen oben sichtbar, damit du jederzeit schnell
umschalten kannst.

Menüleiste: Übersicht, Kalender, Rekorde, Coach
--------------------------------------------------
Oben gibt es jetzt vier Bereiche zum Umschalten:

- Übersicht: alle bisherigen Diagramme (Fitness & Form, ACWR,
  Trainingsbelastungsfokus, Herzfrequenz-Zonen usw.), siehe unten. Klick auf
  eine Workout-Zeile öffnet die Detailansicht: Puls- und Pace-Verlauf immer,
  dazu — soweit deine Uhr/dein Zubehör sie aufgezeichnet hat — Höhenprofil,
  Schritt-/Trittfrequenz-Verlauf, Leistungsverlauf, Bodenkontaktzeit- und
  vertikales-Verhältnis-Verlauf sowie Kennzahlen wie Ø/Max-Kadenz, Leistung,
  vertikale Oszillation und Schrittlänge. Kadenz ist bei deinen bisherigen
  Laufeinheiten bereits dabei; Leistung, Bodenkontaktzeit und vertikales
  Verhältnis fehlen aktuell in deinen .fit-Dateien — dafür bräuchtest du
  einen kompatiblen Brustgurt (z.B. HRM-Pro Plus) oder einen
  Running-Dynamics-Pod bzw. eine Laufleistungs-Quelle; das Dashboard zeigt
  die passenden Charts automatisch an, sobald diese Daten mal vorhanden
  sind.
- Kalender: klassische Monatsansicht wie bei TrainingsPeaks — Zeilen sind
  Kalenderwochen, Spalten Mo–So, ganz rechts pro Woche die Zusammenfassung
  (Gesamtzeit, Load, Zeit je Sportart). Jeder Punkt in einem Tag ist ein
  Training (Farbe = Sportart, Klick öffnet die Detailansicht). Über den
  Pfeilen lässt sich der Monat wechseln, "Aktueller Monat" springt zurück
  zu heute, und über das Dropdown kann nach Sportart gefiltert werden.
- Rekorde: persönliche Bestleistungen je Sportart, angelehnt an die
  Personal-Records-Ansicht von TrainingsPeaks (schnellste 1/5/10 km beim
  Laufen, schnellste 10/20/40 km beim Rad, beste Pace beim Schwimmen, dazu
  längste Distanz/Dauer, größter Höhengewinn, höchste Herzfrequenzwerte,
  höchste Trainingsbelastung, meiste Kalorien und die höchste je erreichte
  Fitness (CTL)). Klick auf einen Rekord öffnet die zugehörige Einheit.
  Hinweis: Die "schnellste X km"-Werte sind aus den aufgezeichneten
  Streckendaten geschätzt (auf ca. 200 Punkte je Einheit verdichtet) und
  daher nicht ganz so präzise wie eine sekundengenaue Auswertung — für den
  praktischen Vergleich aber ein guter Anhaltspunkt.
- Coach: Beim allerersten Öffnen ist der Bereich hinter einem kurzen
  Onboarding zentral verborgen (Button mittig, Rest im Hintergrund unscharf)
  — entweder "Onboarding starten" klicken oder bewusst "Ohne Onboarding
  fortfahren" wählen, um direkt reinzuspringen. Das Onboarding führt durch
  die wichtigsten Fragen: Erfahrung, Stärken/Schwächen, Alter, anklickbare
  Trainingstage (welche Wochentage trainierst du generell), dazu die
  Verfeinerung welcher Tag dein Schwimmtag ist und an welchen Tagen lange
  Einheiten stattfinden sollen, die normale Dauer einer Einheit, optional
  verfügbare Wochenstunden und Leistungswerte wie FTP/Schwellenpace, sowie
  dein aktuelles Ziel — und legt daraus direkt Athletenprofil und Ziel an.
  Ist das Onboarding einmal erledigt, bleibt der Coach-Bereich immer sofort
  sichtbar; alle Angaben lassen sich jederzeit auch als einzelne Felder
  weiter unten nachpflegen. Dann Ziel-Events eintragen (z.B. "Ironman 70.3
  Kraichgau", Datum, optional Zielzeit/Distanz/Notizen) und dir dazu eine
  Trainingsempfehlung erstellen lassen. Die Empfehlung basiert auf deiner
  aktuellen Form (Fitness/CTL, Ermüdung/ATL, ACWR), deinem Trainingsumfang
  der letzten 4 Wochen, deinen Bestzeiten (dieselben wie im Rekorde-Tab),
  deinem Profil (inkl. Trainingstage-Plan) und deinem Erholungs-Check,
  falls ausgefüllt — alles kompakt zusammengefasst, damit auch kleinere
  lokale Modelle schnell und mit möglichst wenig Kontext ein gutes Ergebnis
  liefern. Die Ollama-Zugangsdaten findest du über das Zahnrad-Symbol oben
  im Coach-Tab. Läuft über ein KI-Modell, das lokal auf deinem Mac läuft
  (Ollama) — es wird nichts ins Internet geschickt, alles bleibt auf deinem
  Rechner. Einmalige Einrichtung (nur einmal nötig):
    1. Ollama installieren: https://ollama.com/download
    2. Im Terminal ein Modell laden, z.B.: ollama pull llama3.1
       (kleinere/schnellere Alternative: ollama pull llama3.2)
    3. Ollama für den Zugriff aus einer lokalen HTML-Datei freischalten,
       im Terminal: launchctl setenv OLLAMA_ORIGINS "*"
       Danach Ollama einmal beenden und neu starten (Menüleiste > Quit,
       dann die Ollama-App wieder öffnen), damit die Einstellung greift.
    4. Im Coach-Tab auf "Verbindung testen" klicken — sollte grün bestätigen.
  Danach reicht es, dass Ollama im Hintergrund läuft (App-Icon in der
  Menüleiste), wenn du eine Trainingsempfehlung generieren willst.

Das Aktualisieren-Menü, "Datenstand zurücksetzen", der Hell/Dunkel-Schalter
und der Zeitstempel sind dank sticky Menüleiste auf allen vier Bereichen und
beim Scrollen jederzeit oben sichtbar.

Neu: Workout-Tabelle, individuelles Layout, Erholungs-Check, Design
--------------------------------------------------
- Die Workout-Tabelle in der Übersicht zeigt jetzt standardmäßig die letzten
  10 Einheiten, darunter ein Button "Alle X anzeigen" / "Weniger anzeigen".
- Sowohl die Übersicht als auch der Coach-Tab bestehen jetzt aus Karten, die
  sich per Drag & Drop (Griff oben rechts an jeder Karte) frei umsortieren
  lassen — jeder Bereich hat sein eigenes, unabhängiges Layout, das im
  Browser gespeichert wird. "Layout zurücksetzen" stellt jeweils die
  Standardreihenfolge wieder her.
- Im Coach-Tab gibt es einen Erholungs-Check (Muskelkater inkl. Angabe, wo
  genau, Energie, Verletzung). Die Angaben fließen automatisch in die
  nächste Trainingsempfehlung ein, sodass sie bei Bedarf angepasst oder
  umgeplant wird. Der Check setzt sich jeden Tag neu zurück — die Werte des
  Vortags wandern automatisch in ein Logbuch (letzte 90 Tage), das dem
  KI-Coach für spätere Auswertungen zur Verfügung steht.
- Neuer Look: dezenter Parallax-Effekt im Kopfbereich, Gradient-Titel
  "TriDashboard" mit kleinem Logo, und ein leichter 3D-Kipp-Effekt auf den
  Kennzahlen-Kacheln in der Übersicht (Trainingseinheiten, Gesamtzeit, Rad,
  Laufen, Schwimmen).

Zeiträume, Filter & Detailansicht
--------------------------------------------------
In der Übersicht lässt sich der Betrachtungszeitraum umschalten (7 / 30 / 90
Tage, 1 Jahr, Alle) und nach Sportart filtern. Klick auf eine Workout-Zeile
in der Tabelle zeigt den Puls- und Pace-Verlauf der einzelnen Einheit.

Wissenschaftliche Auswertungen (wie bei TrainingsPeaks)
--------------------------------------------------
- Fitness & Form (PMC): CTL (Fitness, 42-Tage-Schnitt), ATL (Ermüdung,
  7-Tage-Schnitt) und TSB (Form = CTL−ATL) — zeigen, ob du gerade frisch,
  im normalen Aufbau oder übertrainingsgefährdet bist. Nutzt immer die
  komplette geladene Historie, damit die Werte stabil bleiben.
- Trainingsbelastungsverhältnis (ACWR): Verhältnis aus kurzfristiger (7 Tage)
  zu langfristiger (42 Tage) Belastung, als Tacho-Skala. 0,8–1,3 gilt in der
  Sportwissenschaft als "Sweet Spot", Werte über 1,5 als erhöhtes
  Verletzungsrisiko (nach Gabbett 2016).
- Trainingsbelastungsfokus: zeigt, wie sich deine Trainingszeit auf
  niedrig-aeroben, hoch-aeroben und anaeroben Bereich verteilt, verglichen
  mit dem in der Ausdauerwissenschaft üblichen ~80/10/10-Richtwert
  (polarisiertes Training nach Seiler).
- Herzfrequenz-Zonen: Verteilung der Trainingszeit nach 5 Intensitätsstufen.

Falls du willst, dass ich (Claude) das Dashboard einmalig neu aufsetze oder
erweitere, sag einfach Bescheid.
