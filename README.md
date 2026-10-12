# Triathlon Trainings-Dashboard

Ein Trainings-Tagebuch für Triathleten, das auf deinem eigenen PC (Windows
oder Mac) läuft. Es liest die Trainingsdateien deiner Garmin-Uhr ein und
macht daraus übersichtliche Auswertungen — Wochenumfang, Form, Bestzeiten,
Erholung, Trainingsplan mit Regel-Prüfung, Wettkampf-Countdown.

**Alles bleibt auf deinem Rechner.** Kein Cloud-Konto, keine monatlichen
Kosten. Bis zu ein paar Freunde können sich über **Tailscale** (ein privates
Netz nur für eure Geräte) mit eigenem Benutzernamen anmelden — jede Person
sieht nur ihre eigenen Daten. Auch am Handy (iPhone: „Zum Home-Bildschirm“).

> **Wichtig:** `index.html` lässt sich nicht mehr per Doppelklick öffnen.
> Das Dashboard läuft jetzt als kleiner Server auf deinem PC: du startest
> ihn (`start.bat` / `start.sh`) und öffnest dann http://localhost:5000 im
> Browser. Die Demo-Version (`build-demo.py`) geht weiterhin ohne Server.

---

# Einrichtung — Schritt für Schritt

Dauert etwa 10 Minuten. **Vorkenntnisse sind nicht nötig.** Die
ausführliche Anleitung (Tailscale, Freunde, Backups, iPhone, Probleme) steht
in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — hier nur die Kurzfassung.

## Schritt 1 — Python installieren

Von [python.org](https://www.python.org/downloads/) herunterladen und
installieren (normaler Installer). **Windows:** im Installer unbedingt
„Add python.exe to PATH“ ankreuzen. Mac: ist es oft schon da.

## Schritt 2 — Die Dateien herunterladen

1. Öffne **https://github.com/nico-lehr/TriathlonTrainingsDashboard**
2. Klicke auf den grünen Knopf **`< > Code`** → **`Download ZIP`**.
3. Die ZIP-Datei entpacken (Doppelklick). Den entstandenen Ordner dorthin
   legen, wo du ihn wiederfindest (z. B. „Dokumente“).

## Schritt 3 — Starten

- **Windows:** im Ordner `start.bat` doppelklicken.
- **Mac:** Terminal öffnen (`⌘` + Leertaste, „Terminal“, Enter), dort
  `bash ` tippen (mit Leerzeichen!), die Datei `start.sh` aus dem Ordner in
  das Fenster ziehen und Enter drücken.

Beim ersten Start werden die nötigen Bibliotheken installiert und die Datei
`.env` mit einem geheimen Schlüssel angelegt. **Das Fenster muss offen
bleiben**, solange das Dashboard laufen soll.

## Schritt 4 — Dich selbst als Benutzer anlegen

In einem **zweiten** Fenster (Windows: Eingabeaufforderung im Projektordner,
Mac: Terminal) eingeben:

```
python backend/create_user.py
```

(Mac: `python3`.) Benutzername und Passwort (mindestens 10 Zeichen)
eingeben. **Lege zuerst dich selbst an, danach deine Freunde** — wer zuerst
angelegt wird, bekommt alle schon vorhandenen Daten zu sehen. Eine
Registrierungsseite gibt es bewusst nicht.

## Schritt 5 — Im Browser öffnen

**http://localhost:5000** → anmelden. Fertig. Freunde dazuholen:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), Abschnitt 2.

---

# Deine Trainingsdaten holen

Nach der Einrichtung ist das Dashboard noch leer. Drei Möglichkeiten:

## Möglichkeit A — Automatisch von Garmin Connect

Einmalig die Garmin-Bibliotheken installieren, dann jede Person anmelden
(die Nummer zeigt `create_user.py` an, bei dir meist `1`):

```
python -m pip install -r requirements.txt
python tools/garmin_sync.py --login --athlete 1
```

Garmin-E-Mail und Passwort werden versteckt abgefragt (bei Zwei-Faktor
zusätzlich der Code). **Das Passwort wird nirgends gespeichert**, nur ein
Zugangsschlüssel außerhalb des Projektordners. Danach holt
`python tools/garmin_sync.py` die Daten **aller** angemeldeten Personen.
Alle Einzelheiten: [docs/GARMIN_SYNC_GUIDE.md](docs/GARMIN_SYNC_GUIDE.md).

## Möglichkeit B — Eigene `.fit`-Dateien ohne Garmin-Konto

Im Dashboard oben rechts auf **Aktualisieren** klicken und den Ordner mit
den `.fit`-Dateien auswählen (oder einzelne Dateien hineinziehen). Sie
werden auf dem Server gespeichert; Doppeltes wird ignoriert.
Dafür brauchst du kein Garmin-Konto.

## Möglichkeit C — Daten vom alten Doppelklick-Dashboard übernehmen

Siehe [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), „Deine bisherigen Daten
übernehmen“ (einmaliger Export + Import).

---

# Der Alltag danach

| Was du willst | Was du tust |
|---|---|
| Dashboard starten | `start.bat` (Windows) / `start.sh` (Mac) |
| Dashboard ansehen | http://localhost:5000 (Freunde: `http://<PC-Name>:5000`) |
| Neue Trainings holen | `python tools/garmin_sync.py` |
| Benutzer anlegen / Passwort vergessen | `python backend/create_user.py` / `… --reset` |
| Sicherung machen | `backup.bat` / `python backup.py` (läuft auch automatisch bei jedem Start) |
| Auf dem iPhone | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), Abschnitt 6 |

---

# Wenn etwas nicht klappt

Eine Tabelle mit den häufigsten Problemen (Server nicht erreichbar, Port
belegt, Firewall, Passwort vergessen, KI antwortet nicht) steht in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), Abschnitt 5. Zwei Klassiker:

- **„Server nicht erreichbar“ beim Anmelden:** Das Start-Fenster ist
  geschlossen, oder du hast `index.html` per Doppelklick geöffnet. Starte
  den Server (Schritt 3) und rufe http://localhost:5000 auf.
- **Die Synchronisierung bricht mit einem Anmeldefehler ab:** Garmin ändert
  gelegentlich etwas an seiner Schnittstelle. Meistens hilft ein Update:
  `python -m pip install -U garminconnect curl_cffi`

---

# Was mit deinen Daten passiert

- **Alles bleibt auf deinem PC** (Datei `training.db`). Nach außen spricht
  der Server nur mit: Ollama (KI, normalerweise auf demselben PC), Garmin
  (Sync und „An Garmin senden“, mit dem Zugangsschlüssel der jeweiligen
  Person) und Open-Meteo (Wetter, nur der Ortsname bzw. die Koordinaten
  deines Heimatorts, falls du einen einstellst).
- **Jede Person sieht nur ihre eigenen Daten.** Ohne Anmeldung ist nur die
  Login-Seite erreichbar; Passwörter werden nur als Hash gespeichert.
- **Garmin-Passwörter werden nie gespeichert.** Der Zugangsschlüssel liegt
  außerhalb des Projektordners (`~/.triathlon/`) und ist nur für dich lesbar.
- `.env`, `training.db`, `backups/` und alle Trainingsdaten sind so
  eingerichtet, dass sie **nicht versehentlich ins Internet hochgeladen**
  werden (`.gitignore`) und der Server sie **nie ausliefert**.
- Nutzt du den KI-Coach mit einem Anthropic-Schlüssel (optional), gehen
  zusammengefasste Kennzahlen an diesen Dienst. Mit Ollama bleibt auch das
  komplett lokal.

---

# Für Fortgeschrittene

### Voraussetzungen im Überblick

| Wofür | Was nötig ist | Pflicht? |
|---|---|---|
| Dashboard betreiben | Python 3 (aktuelle Version; `start.bat`/`start.sh` installieren den Rest) und ein Browser | **ja** |
| Freunde / Handy | Tailscale (kostenlos) | optional |
| Automatische Garmin-Synchronisierung, „An Garmin senden“ | Garmin-Konto und einmalig `python -m pip install -r requirements.txt` | optional |
| KI-Coach | Ollama auf dem Dashboard-PC **oder** ein Anthropic-Schlüssel | optional |

### KI-Coach einrichten (optional)

Der Coach-Bereich wertet einzelne Einheiten aus und erstellt Trainingspläne
und Empfehlungen (heute / diese Woche / nächste Woche). Jeder KI-Plan wird
zusätzlich vom Regelwerk des Dashboards geprüft (siehe unten).

- **Lokal mit Ollama** (kostenlos, nichts verlässt den Rechner):
  [ollama.com](https://ollama.com) auf dem Dashboard-PC installieren, dann
  `ollama pull llama3.1`. Die Freunde brauchen kein eigenes Ollama — ihr
  Browser fragt den Dashboard-Server, der fragt Ollama. Anderer Rechner:
  `OLLAMA_URL=http://…:11434` in `.env` eintragen.
- **Anthropic-Schlüssel**: im Coach-Tab hinterlegbar (bleibt nur in diesem
  Browser; „Abmelden“ löscht ihn).

Ohne beides funktioniert alles andere normal — nur der Coach-Bereich bleibt leer.

### Ordnerstruktur

```
start.bat / start.sh    Server starten (installiert beim ersten Mal alles)
backup.py / backup.bat  Datenbank sichern (backups/, die letzten 14)

index.html, login.html  Dashboard und Anmeldung (vom Server ausgeliefert)
css/  js/               Der Programmcode im Browser
manifest.json, icons/   „Zum Home-Bildschirm“ (iPhone/Android)

backend/                Server (Flask + SQLite): Login, API, Datenbank
tools/garmin_sync.py    Holt die Daten von Garmin (alle Benutzer)
docs/                   Anleitungen und technische Dokumentation
tests/js/               Tests der Rechenlogik (node --test tests/js/)

training.db             Deine Daten (entsteht beim Start, nie im Repository)
.env                    Geheimer Schlüssel (entsteht beim Start, nie im Repository)
```

Weitere Tests: `python -m unittest discover -s backend -t .` (Server, Login,
Datentrennung). Die Datei-Übersicht steht in `docs/PROJECT_MAP.md`.

---

## Funktionen

- **Übersicht**: Trainingsumfang pro Woche, Verteilung nach Sportart,
  Fitness & Form (Performance Management Chart mit CTL/ATL/TSB wie bei
  TrainingsPeaks), Trainingsbelastungsverhältnis (ACWR) als Tacho-Gauge,
  Trainingsbelastungsfokus (polarisiertes Training nach Seiler,
  niedrig-/hoch-aerob/anaerob), Herzfrequenz-Zonen, Pace-/Geschwindigkeits-
  entwicklung je Sportart, filterbare Workout-Tabelle mit Detailansicht.
- **Detailansicht je Einheit**: Puls- und Pace-/Geschwindigkeitsverlauf,
  plus — soweit vom Gerät/Zubehör aufgezeichnet — Höhenprofil, Schritt-
  bzw. Trittfrequenz-Verlauf, Leistungsverlauf, Bodenkontaktzeit- und
  vertikales-Verhältnis-Verlauf sowie Kennzahlen wie Ø/Max-Kadenz,
  Ø/Max-/Normalized Power, vertikale Oszillation, Schrittlänge und
  Gesamtschritte. Lauf-Dynamik (Bodenkontaktzeit, vertikales Verhältnis,
  vertikale Oszillation) und Leistung brauchen einen kompatiblen Brustgurt
  (z. B. HRM-Pro Plus) bzw. einen Running-Dynamics-Pod oder eine
  Leistungsmess-Quelle — ohne passendes Zubehör zeichnet die Uhr diese
  Werte nicht auf, dann bleibt der jeweilige Chart schlicht weg.
- **Kalender**: Monatsansicht wie bei TrainingsPeaks — jede Zeile eine
  Kalenderwoche, jede Spalte ein Wochentag, rechts die Wochenzusammenfassung
  (Zeit, Trainingsbelastung, Zeit je Sportart). Monatsnavigation und
  Sportart-Filter.
- **Rekorde**: Persönliche Bestleistungen je Sportart, angelehnt an die
  Personal-Records-Ansicht von TrainingsPeaks (schnellste 1/5/10 km beim
  Laufen, 10/20/40 km beim Rad, beste Pace beim Schwimmen, längste
  Distanz/Dauer, Höhengewinn, Herzfrequenzwerte, Trainingsbelastung,
  Kalorien, höchste je erreichte Fitness).
- **Coach**: modularer, per Drag & Drop frei umsortierbarer Kartenbereich
  (eigenes Layout, unabhängig von der Übersicht), mit den Ollama-Zugangs-
  daten dezent hinter einem Zahnradmenü. Vor der ersten Nutzung ist der
  Bereich hinter einem minimalistischen Onboarding-Gate verborgen (zentraler
  Button, Hintergrund unscharf) — erst nach Abschluss des kurzen
  Onboarding-Assistenten (oder bewusstem Überspringen) wird der Coach-Bereich
  sichtbar. Der Fragenkatalog fragt Erfahrung, Stärken/Schwächen, Alter,
  anklickbare Trainingstage (inkl. Verfeinerung: welcher Tag ist Schwimmtag,
  welche Tage sind lange Einheiten), typische Einheitendauer, verfügbare
  Wochenstunden, optionale Leistungswerte sowie das aktuelle Ziel ab und legt
  daraus Athletenprofil und Ziel direkt an; alles lässt sich jederzeit auch
  einzeln nachpflegen. Aus Profil (inkl. Trainingstage-Plan), Ziel-Events
  (Datum/Zielzeit) und der aktuellen Form lässt sich eine Trainingsempfehlung
  generieren — der Kontext (Fitness/Ermüdung/ACWR, Trainingsumfang,
  persönliche Bestzeiten, Profil, Erholungs-Check, Ziel) wird dabei bewusst
  als kompakter Text statt verschachteltem JSON an das Modell übergeben, um
  Tokens/Latenz zu sparen, ohne Informationen zu verlieren. Läuft über ein
  lokales KI-Modell via [Ollama](https://ollama.com) (kein Cloud-Dienst,
  keine Kosten, keine Daten verlassen den Rechner).
- **Daten aktualisieren**: Menü mit zwei Wegen, neue `.fit`-Dateien
  einzulesen — der bisherige Ordner-Scan ("Aktualisieren") oder eine
  Drag-&-Drop-Fläche für einzelne Dateien (mit Klick-Fallback zur
  Dateiauswahl). Beide laufen über dieselbe Einlese- und
  Zusammenführungs-Logik, nichts wird ersetzt.
- Sticky Menüleiste (bleibt beim Scrollen oben sichtbar), manueller
  Hell/Dunkel-Schalter (übersteuert bei Bedarf die Betriebssystem-
  Einstellung), Micro-Animationen, responsives Layout.
- Workout-Tabelle mit Ausklappen/Einklappen (Vorschau der letzten 10
  Einheiten, "Alle anzeigen"-Button bei Bedarf).
- Übersicht- und Coach-Karten (je eigenes Layout) per Drag & Drop frei
  umsortierbar (Griff oben rechts an jeder Karte), Reihenfolge wird pro
  Gerät gespeichert, mit "Layout zurücksetzen".
- Erholungs-Check im Coach-Tab (Muskelkater inkl. Lokalisierung, Energie,
  Verletzung), fließt automatisch in die nächste Trainingsempfehlung ein
  und wird täglich zurückgesetzt — die Werte des Vortags landen in einem
  Logbuch (letzte 90 Tage), das der KI-Coach für spätere Auswertungen zur
  Verfügung steht.
- Design: dezenter Parallax-Effekt im Kopfbereich, Gradient-Titel/Logo und
  3D-Tilt-Effekt auf den Kennzahlen-Kacheln in der Übersicht.
- **Trainingsplaner mit Regelwerk**: Der Plan (KI oder von Hand) wird gegen
  7 feste Regeln geprüft — nie zwei harte Tage hintereinander, höchstens 3
  harte Einheiten pro Woche und ~80 % locker, mindestens ein freier Tag,
  Wochenumfang höchstens +10 % mit Entlastungswoche, nach Belastungsspitze
  oder schlechter Erholung nur locker, lockere Grundlage je Ziel-Sportart,
  nach dem Wettkampf nur locker. Beim Verschieben im Kalender erscheint ein
  Hinweis („Trotzdem verschieben“ bzw. ein Vorschlag per Klick); KI-Pläne
  werden korrigiert oder abgelehnt. Terminwünsche („Donnerstag schwimmen“)
  plant die KI fest ein.
- **Wettkampf-Countdown & Periodisierung**: Tage bis zum Hauptevent, aktuelle
  Phase (Grundlage / Aufbau / Spezifisch / Taper / Erholung) mit Erklärung und
  Zielumfang je Woche.
- **Analyse-Tab**: Sport-Balance (Schwimmen/Rad/Laufen gegen Ziel), Schwimm-CSS
  und Trend, Rad-FTP-Schätzung mit Leistungszonen, Koppeltraining.
- **Rennplan** je Ziel: Tempo je Disziplin aus der Zielzeit, Checklisten
  (Wechselzone, Verpflegung), Rennwoche.
- **„An Garmin senden“**: geplante Lauf-/Rad-/Schwimmeinheit mit Schritten
  direkt in den Garmin-Kalender (Uhr holt sie beim nächsten Sync); `.fit`-Export
  als Plan B.
- **Wetter im Kalender** (7-Tage-Vorhersage für deinen Heimatort),
  **Material** (Schuhe, Rad, Verschleißteile mit Kilometerstand).
- **Handy**: Layout für iPhone/Android, als App auf den Home-Bildschirm legbar.

## Funktionsweise

`start.bat` / `start.sh` startet `backend/app.py` (waitress). Der Server
liefert die Webseite (`index.html`, `login.html`, `css/`, `js/`, `icons/`) und
die API unter derselben Adresse aus — nur diese Erlaubt-Liste, nichts sonst.
Alle persönlichen Daten liegen in `training.db` (SQLite), jede Zeile mit der
Nummer der Person; jede Anfrage prüft den Login und filtert danach. Der
Browser hält nur Login-Token, Hell/Dunkel-Design und Geräte-Einstellungen.

| Datei | Zweck |
|---|---|
| `index.html`, `css/`, `js/` | Der Quelltext des Dashboards (Struktur, Styles, Logik) — reiner Code, keine persönlichen Daten. |
| `backend/` | Server: Login (`auth.py`), API (`routes.py`, `dashboard_routes.py`, …), Tabellen (`models.py`). |
| `tools/garmin_sync.py` | Garmin-Sync für alle Benutzer, schreibt in die Datenbank. |
| `parse_fit.py`, `build_dashboard.py` | Altes Einzelplatz-Werkzeug: `.fit`-Ordner → `workouts.json`; dessen Inhalt übernimmt `backend/import_workouts_json.py` einmalig in die Datenbank. |
| `verify_parser.py` | Playwright-Test, der den JS-Parser im Browser Feld für Feld gegen die Python-Referenz vergleicht. |

Die Datei-Übersicht steht in `docs/PROJECT_MAP.md`, die Datenformen in
`docs/DATA_MODEL.md`, der Betrieb in `docs/DEPLOYMENT.md`.

## Hintergrund der Kennzahlen

- **PMC (CTL/ATL/TSB)**: Performance-Management-Chart-Methodik, wie sie u. a.
  TrainingsPeaks verwendet — CTL (Fitness, 42-Tage-EWMA), ATL (Ermüdung,
  7-Tage-EWMA), TSB = CTL − ATL (Form).
- **ACWR**: Acute:Chronic Workload Ratio nach Gabbett (2016) — Verhältnis aus
  kurzfristiger (7 Tage) zu langfristiger (42 Tage) Trainingsbelastung.
- **Polarisiertes Training**: ~80/10/10-Verteilung nach Seiler zwischen
  niedrig-aerobem, hoch-aerobem und anaerobem Trainingsanteil.

## Technik

Im Browser reines Vanilla JavaScript/HTML/CSS ohne Frameworks und ohne
Build-Step; dahinter ein kleiner Python-Server (Flask + SQLite, waitress).
Modular aufgeteilt nach Verantwortlichkeit (Struktur/Styling/Logik/Daten/
Analytics/KI/Komponenten, siehe `docs/PROJECT_MAP.md`). Berechnungen
(Belastung, Planregeln, Periodisierung) sind reine Funktionen ohne Browser-
Zugriff und deshalb per `node --test tests/js/` testbar. Der FIT-Binärparser
(inkl. komprimierter Zeitstempel und Developer-Feldern) ist von Hand
geschrieben, damit der Browser keine externen Abhängigkeiten braucht.

## Lizenz

Privates Projekt zur eigenen Trainingsauswertung, veröffentlicht als
Referenz/Inspiration für andere. Keine Garantie auf Korrektheit der
sportwissenschaftlichen Kennzahlen — für ernsthafte Trainingsentscheidungen
im Zweifel einen Coach oder eine etablierte Plattform konsultieren.
