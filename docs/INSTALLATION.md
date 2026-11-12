# Installation & Betrieb – ausführlich

Diese Anleitung erklärt Schritt für Schritt, wie du das Triathlon
Trainings-Dashboard auf deinem Mac/PC einrichtest, deine Trainingsdaten
holst und es im Alltag nutzt. Einen Überblick über das Projekt gibt das
[README](../README.de.md).

> **Empfohlen: auf einem Raspberry Pi betreiben.** Dann läuft das Dashboard
> Tag und Nacht bei dir zu Hause, ist unter einer festen https-Adresse von
> überall erreichbar, und jede Person hat ihr eigenes Konto. Anleitung für
> Einsteiger: **[RASPBERRY_PI_ANLEITUNG.md](RASPBERRY_PI_ANLEITUNG.md)**.

> **Ausprobieren ohne Installation:** `python3 build-demo.py` erzeugt die
> Datei `dashboard-demo.html` mit erfundenen Beispieldaten – per Doppelklick
> öffnen, fertig.

## Einrichtung — Schritt für Schritt

Dauert etwa 10 Minuten. **Vorkenntnisse sind nicht nötig.** Die
ausführliche Anleitung (Tailscale, Freunde, Backups, iPhone, Probleme) steht
in **[DEPLOYMENT.md](DEPLOYMENT.md)** — hier nur die Kurzfassung.

### Schritt 1 — Python installieren

Von [python.org](https://www.python.org/downloads/) herunterladen und
installieren (normaler Installer). **Windows:** im Installer unbedingt
„Add python.exe to PATH“ ankreuzen. Mac: ist es oft schon da.

### Schritt 2 — Die Dateien herunterladen

1. Öffne **https://github.com/nico-lehr/TriathlonTrainingsDashboard**
2. Klicke auf den grünen Knopf **`< > Code`** → **`Download ZIP`**.
3. Die ZIP-Datei entpacken (Doppelklick). Den entstandenen Ordner dorthin
   legen, wo du ihn wiederfindest (z. B. „Dokumente“).

### Schritt 3 — Starten

- **Windows:** im Ordner `start.bat` doppelklicken.
- **Mac:** Terminal öffnen (`⌘` + Leertaste, „Terminal“, Enter), dort
  `bash ` tippen (mit Leerzeichen!), die Datei `start.sh` aus dem Ordner in
  das Fenster ziehen und Enter drücken.

Beim ersten Start werden die nötigen Bibliotheken installiert und die Datei
`.env` mit einem geheimen Schlüssel angelegt. **Das Fenster muss offen
bleiben**, solange das Dashboard laufen soll.

### Schritt 4 — Dich selbst als Benutzer anlegen

In einem **zweiten** Fenster (Windows: Eingabeaufforderung im Projektordner,
Mac: Terminal) eingeben:

```
python backend/create_user.py
```

(Mac: `python3`.) Benutzername und Passwort (mindestens 10 Zeichen)
eingeben. **Lege zuerst dich selbst an, danach deine Freunde** — wer zuerst
angelegt wird, bekommt alle schon vorhandenen Daten zu sehen. Eine
Registrierungsseite gibt es bewusst nicht.

### Schritt 5 — Im Browser öffnen

**http://localhost:5000** → anmelden. Fertig. Freunde dazuholen:
[DEPLOYMENT.md](DEPLOYMENT.md), Abschnitt 2.

---

## Deine Trainingsdaten holen

Nach der Einrichtung ist das Dashboard noch leer. Drei Möglichkeiten.
(**Mac:** in allen Befehlen hier `python3` statt `python` schreiben.)

### Möglichkeit A — Automatisch von Garmin Connect (offizielle Schnittstelle)

1. Einmalig am PC: `python -m pip install -r requirements.txt`
2. Jede Person erstellt in Garmin Connect ihren eigenen Schlüssel:
   Einstellungen → **Personal API**
   (https://connect.garmin.com/app/settings/personalApiToken).
3. Im Dashboard: Einstellungen → **Garmin-Verbindung** → Schlüssel
   einfügen → „Schlüssel prüfen & speichern“ → **„Jetzt von Garmin holen“**.

Kein Garmin-Passwort nötig, der Schlüssel kann nur lesen. Danach holt auch
`python tools/garmin_sync.py` am PC die Daten **aller** Personen mit
Schlüssel. Für „An Garmin senden“ (Workouts auf die Uhr) braucht es
zusätzlich die alte Anmeldung (`python tools/garmin_sync.py --login --athlete 1`).
Alle Einzelheiten: [GARMIN_SYNC_GUIDE.md](GARMIN_SYNC_GUIDE.md).

### Möglichkeit B — Eigene `.fit`-Dateien ohne Garmin-Konto

Im Dashboard oben rechts auf **Aktualisieren** klicken und den Ordner mit
den `.fit`-Dateien auswählen (oder einzelne Dateien hineinziehen). Sie
werden auf dem Server gespeichert; Doppeltes wird ignoriert.
Dafür brauchst du kein Garmin-Konto.

### Möglichkeit C — Daten vom alten Doppelklick-Dashboard übernehmen

Siehe [DEPLOYMENT.md](DEPLOYMENT.md), „Deine bisherigen Daten
übernehmen“ (einmaliger Export + Import).

---

## Der Alltag danach

Auf dem Mac in allen Befehlen `python3` statt `python` schreiben.

| Was du willst | Was du tust |
|---|---|
| Dashboard starten | `start.bat` (Windows) / `start.sh` (Mac) |
| Dashboard ansehen | http://localhost:5000 (Freunde: `http://<PC-Name>:5000`) |
| Neue Trainings holen | `python tools/garmin_sync.py` |
| Benutzer anlegen / Passwort vergessen | `python backend/create_user.py` / `… --reset` |
| Sicherung machen | `backup.bat` / `python backup.py` (läuft auch automatisch bei jedem Start) |
| Neue Version installieren | Hinweis oben im Dashboard → „Installieren“ (nur für dich als Betreiber; siehe [DEPLOYMENT.md](DEPLOYMENT.md), „Updates“) |
| Dauerhaft auf einem Raspberry Pi | [DEPLOYMENT.md](DEPLOYMENT.md), Abschnitt 9 (ein Installationsbefehl, startet von selbst) |
| Auf dem iPhone | [DEPLOYMENT.md](DEPLOYMENT.md), Abschnitt 6 (Tailscale) oder Abschnitt 8 (VS Code-Port-Weiterleitung, ohne Tailscale) |

---

## Wenn etwas nicht klappt

Eine Tabelle mit den häufigsten Problemen (Server nicht erreichbar, Port
belegt, Firewall, Passwort vergessen, KI antwortet nicht) steht in
[DEPLOYMENT.md](DEPLOYMENT.md), Abschnitt 5. Zwei Klassiker:

- **„Server nicht erreichbar“ beim Anmelden:** Das Start-Fenster ist
  geschlossen, oder du hast `index.html` per Doppelklick geöffnet. Starte
  den Server (Schritt 3) und rufe http://localhost:5000 auf.
- **Die Synchronisierung bricht mit einem Anmeldefehler ab:** Garmin ändert
  gelegentlich etwas an seiner Schnittstelle. Meistens hilft ein Update:
  `python -m pip install -U garminconnect curl_cffi`

---

## Was mit deinen Daten passiert

- **Alles bleibt auf deinem PC** (Datei `training.db`). Nach außen spricht
  der Server nur mit: Claude bzw. Ollama (KI), Garmin
  (Sync und „An Garmin senden“, mit dem Zugangsschlüssel der jeweiligen
  Person), Open-Meteo (Wetter, nur der Ortsname bzw. die Koordinaten
  deines Heimatorts, falls du einen einstellst) und GitHub (einmal am Tag
  „gibt es eine neue Version?“, beim Installieren der Download – dazu
  Python-Bibliotheken von PyPI). An GitHub und PyPI gehen keine
  persönlichen Daten.
- **Jede Person sieht nur ihre eigenen Daten.** Ohne Anmeldung ist nur die
  Login-Seite erreichbar; Passwörter werden nur als Hash gespeichert.
- **Garmin-Passwörter werden nie gespeichert.** Garmin-Schlüssel und
  -Token liegen außerhalb des Projektordners (`~/.triathlon/`) und sind nur
  für deinen Computer-Benutzer lesbar.
- `.env`, `training.db`, `backups/` und alle Trainingsdaten sind so
  eingerichtet, dass sie **nicht versehentlich ins Internet hochgeladen**
  werden (`.gitignore`) und der Server sie **nie ausliefert**.
- Nutzt du den KI-Coach mit Claude (optional), gehen zusammengefasste
  Kennzahlen und dein Trainingsprofil an Anthropic. Der Claude-Schlüssel
  liegt nur auf dem Dashboard-Server (`~/.triathlon/claude_api.json`, nur
  für deinen Computer-Benutzer lesbar), nie im Browser. Mit Ollama bleibt
  auch das komplett lokal.

---

## Für Fortgeschrittene

### Voraussetzungen im Überblick

| Wofür | Was nötig ist | Pflicht? |
|---|---|---|
| Dashboard betreiben | Python 3 (aktuelle Version; `start.bat`/`start.sh` installieren den Rest) und ein Browser | **ja** |
| Freunde / Handy | Tailscale (kostenlos) | optional |
| Automatische Garmin-Synchronisierung, „An Garmin senden“ | Garmin-Konto und einmalig `python -m pip install -r requirements.txt` | optional |
| KI-Coach | ein Claude-Schlüssel (Anthropic) **oder** Ollama auf dem Dashboard-PC | optional |

### KI-Coach einrichten (optional)

Der Coach-Bereich wertet einzelne Einheiten aus und erstellt Trainingspläne
und Empfehlungen (heute / diese Woche / nächste Woche). Jeder KI-Plan wird
zusätzlich vom Regelwerk des Dashboards geprüft (7 feste Trainingsregeln, siehe [README](../README.de.md)).

- **Claude (empfohlen):** Schlüssel auf
  [console.anthropic.com](https://console.anthropic.com/settings/keys)
  erstellen und als Betreiber in den Einstellungen → **KI-Coach** eintragen.
  Er liegt dann nur auf dem Dashboard-Server; alle deine Geräte nutzen ihn.
  Mit „Für alle Personen freigeben“ dürfen auch deine Freunde Claude nutzen
  (über dein Guthaben). Modell wählbar: Opus 5.5 (beste Qualität, Standard),
  Sonnet 5.5 oder Haiku 5.5 (am günstigsten).
- **Lokal mit Ollama** (kostenlos, nichts verlässt den Rechner), wenn kein
  Claude eingerichtet ist:
  [ollama.com](https://ollama.com) auf dem Dashboard-PC installieren, dann
  `ollama pull llama3.1`. Die Freunde brauchen kein eigenes Ollama — ihr
  Browser fragt den Dashboard-Server, der fragt Ollama. Anderer Rechner:
  `OLLAMA_URL=http://…:11434` in `.env` eintragen.

Ohne beides funktioniert alles andere normal — nur der Coach-Bereich bleibt leer.

### Ordnerstruktur

```
start.bat / start.sh    Server starten (installiert beim ersten Mal alles, startet nach Updates neu)
VERSION                 Installierte Programmversion (für die Update-Prüfung)
CHANGELOG.md            Was ist neu – je Version
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
Datentrennung). Die Datei-Übersicht steht in [PROJECT_MAP.md](PROJECT_MAP.md).

---

## Funktionsweise

`start.bat` / `start.sh` startet über `backend/launcher.py` den Server
`backend/app.py` (waitress; nach einem Update startet der Starter ihn neu). Der Server
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

Die Datei-Übersicht steht in [PROJECT_MAP.md](PROJECT_MAP.md), die Datenformen in
[DATA_MODEL.md](DATA_MODEL.md), der Betrieb in [DEPLOYMENT.md](DEPLOYMENT.md).

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
Analytics/KI/Komponenten, siehe [PROJECT_MAP.md](PROJECT_MAP.md)). Berechnungen
(Belastung, Planregeln, Periodisierung) sind reine Funktionen ohne Browser-
Zugriff und deshalb per `node --test tests/js/` testbar. Der FIT-Binärparser
(inkl. komprimierter Zeitstempel und Developer-Feldern) ist von Hand
geschrieben, damit der Browser keine externen Abhängigkeiten braucht.
