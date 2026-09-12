# Triathlon Trainings-Dashboard

Ein komplett lokales, offline-fähiges Trainings-Dashboard für Triathleten.
Es liest Garmin-`.fit`-Dateien ein und baut daraus einen Jahresüberblick mit
sportwissenschaftlich fundierten Kennzahlen — inspiriert von
[TrainingsPeaks](https://www.trainingpeaks.com/).

**Keine Cloud, kein Konto, kein Server.** Das Dashboard ist eine normale
HTML-Datei, die du per Doppelklick öffnest. Deine Trainings- und
Gesundheitsdaten bleiben auf deinem Rechner.

> Diese Anleitung gilt für **macOS**. Unter Windows lässt sich das Dashboard
> selbst öffnen und per Ordner-Import nutzen, für den Garmin-Sync gibt es dort
> aber noch keine Start-Datei.

---

# Installation

## Schritt 1 — Projekt herunterladen

**Empfohlen: per Terminal klonen.** Das ist der einfachste Weg, weil macOS
heruntergeladene ZIP-Dateien blockiert (siehe Hinweis unten).

```bash
git clone https://github.com/wnd5qqmxqt-lgtm/TriathlonTrainingsDashboard.git Dashboard
cd Dashboard
```

*Alternativ als ZIP:* Auf GitHub „Code ▸ Download ZIP", dann entpacken.
macOS markiert alle Dateien daraus als „aus dem Internet geladen" und
verweigert zunächst den Doppelklick. Das Setup-Skript hebt diese Blockade
für dich auf — du musst es nur **einmalig** an der Sperre vorbeistarten:
**Rechtsklick auf `setup.command` ▸ Öffnen ▸ Öffnen**.

## Schritt 2 — Setup ausführen

Doppelklick auf **`setup.command`**.

Das Skript erledigt alles Weitere und sagt bei jedem Schritt, was es tut:

| Schritt | Was passiert |
|---|---|
| 1 | Prüft, ob Python 3 vorhanden ist |
| 2 | Installiert die drei benötigten Python-Bibliotheken |
| 3 | Legt die Arbeitsordner `fit-files/` und `data/` an |
| 4 | Hebt die macOS-Blockade für die Start-Dateien auf |
| 5 | Richtet den Sync-Knopf im Dashboard ein |
| 6 | Öffnet das Dashboard |

Fehlt Python, sagt das Skript Bescheid und bietet an, die Download-Seite zu
öffnen. Danach das Setup einfach erneut starten.

## Schritt 3 — Daten holen

Jetzt fehlen nur noch deine Trainings. Zwei Wege:

### Weg A: Garmin Connect (empfohlen)

Doppelklick auf **`sync-garmin.command`** — oder im Dashboard oben rechts
**Aktualisieren ▸ Mit Garmin Connect synchronisieren**.

Beim ersten Mal wirst du nach E-Mail und Passwort gefragt, bei aktivierter
Zwei-Faktor-Authentifizierung zusätzlich nach dem Code.

> **Dein Passwort wird nicht gespeichert.** Es wird einmalig gegen ein Token
> getauscht und sofort verworfen. Das Token liegt unter `~/.garminconnect`
> und erneuert sich selbst — ab dem zweiten Mal brauchst du gar nichts mehr
> einzugeben. Erfahrungsgemäß ist das Passwort etwa einmal im Jahr wieder
> nötig.

Der erste Lauf holt die letzten 300 Tage und dauert ein paar Minuten. Jeder
weitere Lauf lädt nur noch Neues und ist in Sekunden fertig.

### Weg B: Eigene `.fit`-Dateien

Ohne Garmin-Konto: im Dashboard oben rechts auf **Aktualisieren** klicken und
im Menü nochmals **📁 Aktualisieren** wählen — dann den Ordner mit deinen
`.fit`-Dateien angeben (z. B. von
[HealthFit](https://www.healthfit.app/) nach iCloud Drive synchronisiert).
Alternativ **⬆️ Drag & Drop zur Auswahl**, um einzelne Dateien hineinzuziehen.
Dafür wird kein Python gebraucht.

---

# Voraussetzungen im Detail

| Wofür | Was du brauchst | Pflicht? |
|---|---|---|
| Dashboard ansehen, eigene `.fit`-Dateien einlesen | Nur ein Browser | **ja** |
| Garmin-Sync | Python 3.9+ und drei Bibliotheken | nur für Weg A |
| KI-Coach | Ollama (lokal) **oder** ein Anthropic-Schlüssel | optional |
| Kalender-Export (iCal) | Das Flask-Backend in `backend/` | optional |

Die Python-Bibliotheken installiert das Setup automatisch:
`garminconnect`, `curl_cffi` und `fitdecode` (siehe `requirements.txt`).

## KI-Coach einrichten (optional)

Der Coach-Bereich analysiert einzelne Einheiten und erstellt Trainingspläne.
Er braucht ein Sprachmodell — entweder lokal oder über eine Schnittstelle:

- **Lokal mit Ollama** (kostenlos, Daten bleiben auf dem Rechner):
  [ollama.com](https://ollama.com) installieren, dann `ollama pull llama3.1`.
  Das Dashboard erwartet Ollama unter `http://localhost:11434`; die Adresse
  lässt sich im Coach-Tab hinter dem Zahnrad ändern.
- **Anthropic-Schlüssel**: ebenfalls im Coach-Tab hinterlegbar.

Ohne beides funktioniert das Dashboard vollständig — nur der Coach-Bereich
bleibt leer.

---

# Was mit deinen Daten passiert

- Alles bleibt **lokal auf deinem Rechner**. Das Dashboard selbst hat keinen
  Netzwerkzugriff und kennt keine Zugangsdaten.
- Der Garmin-Sync ist ein **getrenntes Programm**, das du bewusst startest.
  Es lädt herunter, nie hoch.
- Passwörter werden nie gespeichert, Tokens liegen außerhalb des
  Projektordners (`~/.garminconnect`, nur für dich lesbar).
- Deine Trainingsdaten (`data/`, `fit-files/`, `workouts.json`) sind über
  `.gitignore` vom Repository ausgeschlossen — ein versehentliches Hochladen
  ist damit ausgeschlossen.
- Nutzt du den Coach mit einem Anthropic-Schlüssel, werden die
  zusammengefassten Kennzahlen an diese Schnittstelle geschickt. Mit Ollama
  bleibt auch das lokal.

---

# Wenn etwas nicht funktioniert

**„... kann nicht geöffnet werden, da es von einem nicht verifizierten
Entwickler stammt"**
Du hast das ZIP heruntergeladen. Einmalig Rechtsklick auf die Datei ▸
**Öffnen** ▸ **Öffnen**. Nach dem ersten Setup-Lauf tritt das nicht mehr auf.

**„Safari kann die Seite nicht öffnen, da die Adresse ungültig ist"**
Der Sync-Knopf im Dashboard funktioniert erst, wenn `setup.command` gelaufen
ist. Alternativ jederzeit `sync-garmin.command` direkt doppelklicken — das
geht immer.

**Der Sync bricht mit einem Anmeldefehler ab**
Garmin ändert gelegentlich seine interne Schnittstelle. Meist hilft:

```bash
python3 -m pip install -U garminconnect curl_cffi
```

**Das Dashboard ist leer**
Noch keine Daten eingelesen — siehe Schritt 3. Ob und wann zuletzt
synchronisiert wurde, steht im Menü **Aktualisieren**.

**Python wird nicht gefunden, obwohl es installiert ist**
Das Setup sucht in den üblichen Pfaden. Hilft das nicht, einmal im Terminal
`python3 -V` ausführen und prüfen, ob eine Version 3.9 oder neuer erscheint.

---

# Ordnerstruktur

```
index.html              Das Dashboard — per Doppelklick öffnen
setup.command           Einmalige Einrichtung
sync-garmin.command     Garmin-Sync starten

css/  js/               Code des Dashboards
tools/garmin_sync.py    Der Garmin-Downloader
parse_fit.py            Liest .fit-Dateien ein  → workouts.json
build_dashboard.py      Erzeugt daraus          → data/workouts-data.js
docs/                   Datenmodell und Projektkarte

fit-files/              Deine heruntergeladenen .fit-Dateien (lokal)
data/                   Erzeugte Trainings- und Gesundheitsdaten (lokal)
```

Die Kette beim Sync ist immer dieselbe:
**Garmin → `fit-files/` → `parse_fit.py` → `build_dashboard.py` → Dashboard.**
`sync-garmin.command` führt sie komplett aus.

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
