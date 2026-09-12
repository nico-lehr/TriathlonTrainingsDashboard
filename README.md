# Triathlon Trainings-Dashboard

Ein Trainings-Tagebuch für Triathleten, das auf deinem eigenen Mac läuft.
Es liest die Trainingsdateien deiner Garmin-Uhr ein und macht daraus
übersichtliche Auswertungen — Wochenumfang, Form, Bestzeiten, Erholung.

**Alles bleibt auf deinem Rechner.** Kein Konto, keine Cloud, keine
monatlichen Kosten. Es gibt auch nichts zu programmieren — du klickst
das Dashboard einfach auf wie eine normale Datei.

---

# Einrichtung — Schritt für Schritt

Dauert etwa 10 Minuten. Du brauchst nur einen Mac und eine
Internetverbindung. **Vorkenntnisse sind nicht nötig** — jeder Schritt
wird unten genau erklärt.

> Diese Anleitung ist für **Mac**. Für Windows gibt es die Einrichtung
> noch nicht.

## Schritt 1 — Die Dateien herunterladen

1. Öffne diese Seite im Browser:
   **https://github.com/nico-lehr/TriathlonTrainingsDashboard**
2. Klicke rechts oben auf den grünen Knopf **`< > Code`**.
3. Wähle im Menü ganz unten **`Download ZIP`**.
4. Die Datei landet in deinem Ordner **Downloads**.

## Schritt 2 — Die Dateien entpacken

Doppelklicke die heruntergeladene Datei
`TriathlonTrainingsDashboard-main.zip`.

Daneben entsteht ein Ordner mit demselben Namen. **Lass ihn ruhig in
Downloads liegen** — oder ziehe ihn irgendwohin, wo du ihn wiederfindest,
zum Beispiel in „Dokumente". Merk dir nur, wohin.

## Schritt 3 — Das Terminal öffnen

> **Was ist das Terminal?** Ein Programm, das bei jedem Mac dabei ist. Statt
> zu klicken, tippt man dort Befehle ein. Klingt technischer als es ist —
> du brauchst genau **einen** Befehl, und den musst du nicht einmal
> abtippen. Danach nie wieder.

So öffnest du es:

1. Drücke **`⌘` (Command) und die Leertaste** gleichzeitig. Oben in der
   Mitte erscheint ein Suchfeld.
2. Tippe **`Terminal`**.
3. Drücke **Enter**.

Es öffnet sich ein meist weißes oder schwarzes Fenster mit etwas Text und
einem blinkenden Strich. Das ist richtig so.

## Schritt 4 — Die Einrichtung starten

Jetzt kommt der einzige Befehl. Du tippst nur den ersten Teil — den Rest
erledigt ein Trick:

1. Tippe im Terminal-Fenster:

   ```
   bash 
   ```

   **Wichtig: mit einem Leerzeichen am Ende.** Drücke noch NICHT Enter.

2. Öffne den entpackten Ordner aus Schritt 2 im Finder.

3. **Ziehe die Datei `setup.command` mit der Maus in das Terminal-Fenster**
   und lass sie dort los.

   Der Mac trägt daraufhin automatisch den kompletten Pfad ein. Die Zeile
   sieht dann ungefähr so aus:

   ```
   bash /Users/deinname/Downloads/TriathlonTrainingsDashboard-main/setup.command
   ```

4. Jetzt **Enter** drücken.

Die Einrichtung läuft los und meldet jeden Schritt mit einem grünen Haken.
Am Ende öffnet sich das Dashboard von selbst im Browser.

> **Warum über das Terminal und nicht per Doppelklick?** Weil macOS bei
> Dateien aus dem Internet zuerst eine Sicherheitswarnung zeigt. Über das
> Terminal umgehst du diese Warnung auf saubere Weise — und die Einrichtung
> hebt die Sperre danach für dich auf. **Ab dann funktionieren Doppelklicks
> ganz normal**, und du brauchst das Terminal nie wieder.

### Was passiert, wenn Python fehlt?

Die Einrichtung sagt dir das und bietet an, die Download-Seite zu öffnen.
Installiere Python von dort (normaler Installer, „Weiter, Weiter, Fertig"),
und starte dann Schritt 4 noch einmal.

Python wird **nur** für die automatische Garmin-Synchronisierung gebraucht.
Das Dashboard selbst funktioniert auch ohne.

---

# Deine Trainingsdaten holen

Nach der Einrichtung ist das Dashboard noch leer. Zwei Möglichkeiten:

## Möglichkeit A — Automatisch von Garmin Connect

Doppelklicke im Projektordner auf **`sync-garmin.command`**.

Beim ersten Mal wirst du nach deiner Garmin-E-Mail und deinem Passwort
gefragt. Tippe sie ein und drücke Enter. Falls du die Bestätigung in zwei
Schritten nutzt, wird zusätzlich der Code abgefragt.

> **Dein Passwort wird nirgends gespeichert.** Es wird einmal verwendet, um
> einen Zugangsschlüssel zu erhalten, und dann sofort verworfen. Ab dem
> zweiten Mal musst du gar nichts mehr eingeben — es läuft einfach durch.

Der erste Durchlauf holt die letzten 300 Tage und dauert ein paar Minuten.
Danach öffnet sich dein fertiges Dashboard. Jeder weitere Durchlauf holt
nur noch Neues und ist in Sekunden fertig.

**Ab jetzt ist es ganz einfach:** Wenn du neue Trainings sehen willst,
doppelklickst du `sync-garmin.command`. Mehr nicht.

## Möglichkeit B — Eigene Dateien ohne Garmin-Konto

Hast du deine `.fit`-Dateien schon irgendwo auf dem Rechner (zum Beispiel
über die App HealthFit in iCloud)?

1. Öffne das Dashboard (`index.html` doppelklicken).
2. Klicke oben rechts auf **Aktualisieren**.
3. Wähle im Menü **📁 Aktualisieren**.
4. Such den Ordner mit deinen `.fit`-Dateien aus.

Dafür brauchst du kein Python und kein Garmin-Konto.

---

# Der Alltag danach

| Was du willst | Was du tust |
|---|---|
| Dashboard ansehen | `index.html` doppelklicken |
| Neue Trainings holen | `sync-garmin.command` doppelklicken |
| Dashboard griffbereit haben | `index.html` ins Dock ziehen oder ein Lesezeichen anlegen |

---

# Wenn etwas nicht klappt

### „... kann nicht geöffnet werden, da es von einem nicht verifizierten Entwickler stammt"

Das passiert, wenn du eine Datei **vor** der Einrichtung doppelklickst.
Führe zuerst Schritt 4 aus (über das Terminal) — danach tritt die Meldung
nicht mehr auf.

Kommt sie trotzdem noch einmal:
1. Klicke im Fenster auf **Fertig**.
2. Öffne **Systemeinstellungen ▸ Datenschutz & Sicherheit**.
3. Scrolle nach unten. Dort steht, dass eine Datei blockiert wurde.
4. Klicke daneben auf **Trotzdem öffnen** und bestätige.

### Das Terminal sagt „command not found: bash"

Dann hast du vermutlich das Leerzeichen nach `bash` vergessen oder einen
Tippfehler. Schreib die Zeile noch einmal neu — erst `bash`, dann
Leerzeichen, dann die Datei hineinziehen.

### Das Dashboard ist leer

Es sind noch keine Trainingsdaten da. Siehe „Deine Trainingsdaten holen".
Ob und wann zuletzt synchronisiert wurde, steht im Menü **Aktualisieren**.

### Die Synchronisierung bricht mit einem Anmeldefehler ab

Garmin ändert gelegentlich etwas an seiner Schnittstelle. Meistens hilft
ein Update. Öffne dafür das Terminal (Schritt 3) und gib ein:

```
python3 -m pip install -U garminconnect curl_cffi
```

### Der Knopf „Mit Garmin Connect synchronisieren" im Dashboard tut nichts

Doppelklicke stattdessen `sync-garmin.command` im Projektordner — das
funktioniert immer.

---

# Was mit deinen Daten passiert

- **Alles bleibt auf deinem Mac.** Das Dashboard hat keine Verbindung nach
  außen und kennt keine Zugangsdaten.
- Die Synchronisierung ist ein **eigenes kleines Programm**, das du bewusst
  startest. Es lädt nur herunter, nie hoch.
- **Passwörter werden nie gespeichert.** Der Zugangsschlüssel liegt
  außerhalb des Projektordners und ist nur für dich lesbar.
- Deine Trainings- und Gesundheitsdaten sind so eingerichtet, dass sie
  **nicht versehentlich ins Internet hochgeladen** werden können.
- Nutzt du den KI-Coach mit einem Anthropic-Schlüssel, gehen deine
  zusammengefassten Kennzahlen an diesen Dienst. Mit Ollama (siehe unten)
  bleibt auch das komplett lokal.

---

# Für Fortgeschrittene

### Alternative: per Terminal klonen

Wer `git` hat, kann Schritt 1 und 2 ersetzen durch:

```bash
git clone https://github.com/nico-lehr/TriathlonTrainingsDashboard.git Dashboard
cd Dashboard && bash setup.command
```

Vorteil: keine Sicherheitswarnung, weil die Dateien nicht als
„aus dem Internet geladen" markiert werden.

### Voraussetzungen im Überblick

| Wofür | Was nötig ist | Pflicht? |
|---|---|---|
| Dashboard ansehen, eigene `.fit`-Dateien | Nur ein Browser | **ja** |
| Automatische Garmin-Synchronisierung | Python 3.9+ (Einrichtung installiert den Rest) | nur für Möglichkeit A |
| KI-Coach | Ollama (lokal) **oder** ein Anthropic-Schlüssel | optional |
| Trainingsplan als Kalender-Abo | Das Backend in `backend/` | optional |

### KI-Coach einrichten (optional)

Der Coach-Bereich wertet einzelne Einheiten aus und erstellt
Trainingspläne. Dafür braucht er ein Sprachmodell:

- **Lokal mit Ollama** (kostenlos, nichts verlässt den Rechner):
  [ollama.com](https://ollama.com) installieren, dann im Terminal
  `ollama pull llama3.1` ausführen. Das Dashboard erwartet Ollama unter
  `http://localhost:11434`; die Adresse lässt sich im Coach-Tab hinter dem
  Zahnrad ändern.
- **Anthropic-Schlüssel**: ebenfalls im Coach-Tab hinterlegbar.

Ohne beides funktioniert alles andere ganz normal — nur der Coach-Bereich
bleibt leer.

### Ordnerstruktur

```
index.html              Das Dashboard — zum Ansehen doppelklicken
setup.command           Einmalige Einrichtung
sync-garmin.command     Neue Trainings holen

css/  js/               Der Programmcode des Dashboards
tools/garmin_sync.py    Holt die Daten von Garmin
parse_fit.py            Liest .fit-Dateien ein   → workouts.json
build_dashboard.py      Erzeugt daraus           → data/workouts-data.js
docs/                   Technische Dokumentation

fit-files/              Deine heruntergeladenen Trainingsdateien
data/                   Die aufbereiteten Daten fürs Dashboard
```

Beim Synchronisieren läuft immer dieselbe Kette:
**Garmin → `fit-files/` → `parse_fit.py` → `build_dashboard.py` → Dashboard.**
`sync-garmin.command` erledigt das alles zusammen.

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
  Browser gespeichert, mit "Layout zurücksetzen".
- Erholungs-Check im Coach-Tab (Muskelkater inkl. Lokalisierung, Energie,
  Verletzung), fließt automatisch in die nächste Trainingsempfehlung ein
  und wird täglich zurückgesetzt — die Werte des Vortags landen in einem
  Logbuch (letzte 90 Tage), das der KI-Coach für spätere Auswertungen zur
  Verfügung steht.
- Design: dezenter Parallax-Effekt im Kopfbereich, Gradient-Titel/Logo und
  3D-Tilt-Effekt auf den Kennzahlen-Kacheln in der Übersicht.

## Funktionsweise

`index.html` ist reiner Code (kein Platzhalter, keine eingebetteten Daten)
und liegt normal im Repository. Nur die Trainingsdaten selbst werden lokal
generiert — siehe `docs/PROJECT_MAP.md` für die vollständige Datei-Übersicht:

| Datei | Zweck |
|---|---|
| `index.html`, `css/`, `js/` | Der eigentliche Quelltext des Dashboards (Struktur, Styles, Logik) — reiner Code, keine persönlichen Daten. |
| `parse_fit.py` | Python-Referenzimplementierung (`fitdecode`), liest `.fit`-Dateien in ein zentrales `workouts.json`. Dient auch als Vergleichsbasis für den JS-Parser. |
| `build_dashboard.py` | Erzeugt `data/workouts-data.js` aus `workouts.json` (Daten werden dort als JS-Konstante eingebettet, damit `index.html` sie auch bei `file://`-Aufruf laden kann). |
| `verify_parser.py` | Playwright-Test, der den JS-Parser im Browser Feld für Feld gegen die Python-Referenz vergleicht. |

`workouts.json` und die generierte `data/workouts-data.js` enthalten die
**echten persönlichen Trainingsdaten** (Herzfrequenz, Zeiten, Distanzen,
Kalorien) und sind deshalb bewusst über `.gitignore` von diesem Repository
ausgeschlossen. Wer das Dashboard selbst nutzen will, generiert beide
Dateien lokal aus den eigenen `.fit`-Dateien:

```bash
pip install fitdecode
python3 parse_fit.py        # liest fit-files/ ein -> workouts.json
python3 build_dashboard.py  # erzeugt data/workouts-data.js daraus

# Beides zusammen mit dem Download erledigt sync-garmin.command automatisch.
```

Danach `index.html` einfach im Browser öffnen. Über den
"Aktualisieren"-Button lassen sich später weitere `.fit`-Dateien direkt im
Browser nachladen (Merge, nichts wird ersetzt) — ganz ohne die Python-Skripte
erneut auszuführen.

## Hintergrund der Kennzahlen

- **PMC (CTL/ATL/TSB)**: Performance-Management-Chart-Methodik, wie sie u. a.
  TrainingsPeaks verwendet — CTL (Fitness, 42-Tage-EWMA), ATL (Ermüdung,
  7-Tage-EWMA), TSB = CTL − ATL (Form).
- **ACWR**: Acute:Chronic Workload Ratio nach Gabbett (2016) — Verhältnis aus
  kurzfristiger (7 Tage) zu langfristiger (42 Tage) Trainingsbelastung.
- **Polarisiertes Training**: ~80/10/10-Verteilung nach Seiler zwischen
  niedrig-aerobem, hoch-aerobem und anaerobem Trainingsanteil.

## Technik

Reines Vanilla JavaScript/HTML/CSS, keine Frameworks, kein Build-Step für das
Dashboard selbst (nur die Trainingsdaten werden einmalig mit
`build_dashboard.py` generiert, siehe oben). Modular aufgeteilt nach
Verantwortlichkeit (Struktur/Styling/Logik/Daten/Analytics/KI/Komponenten,
siehe `docs/PROJECT_MAP.md`) statt einer einzelnen
HTML-Datei. Der FIT-Binärparser (inkl. komprimierter Zeitstempel und
Developer-Feldern) ist von Hand geschrieben, damit das Dashboard ganz ohne
externe Abhängigkeiten offline läuft.

## Lizenz

Privates Projekt zur eigenen Trainingsauswertung, veröffentlicht als
Referenz/Inspiration für andere. Keine Garantie auf Korrektheit der
sportwissenschaftlichen Kennzahlen — für ernsthafte Trainingsentscheidungen
im Zweifel einen Coach oder eine etablierte Plattform konsultieren.
