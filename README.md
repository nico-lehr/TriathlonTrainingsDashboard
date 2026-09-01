# Triathlon Trainings-Dashboard

Ein komplett lokales, offline-fähiges Trainings-Dashboard für Triathleten, das
Garmin-`.fit`-Dateien (z. B. über [HealthFit](https://www.healthfit.app/) nach
iCloud Drive synchronisiert) einliest und daraus ein Jahresüberblick-Dashboard
mit wissenschaftlich fundierten Kennzahlen baut — inspiriert von
[TrainingsPeaks](https://www.trainingpeaks.com/).

Keine Server, kein Login, keine Cloud: `index.html` wird per Doppelklick im
Browser geöffnet und funktioniert komplett offline — auch wenn die App
technisch aus mehreren Dateien besteht (`css/`, `js/`, `data/`), lädt der
Browser sie beim `file://`-Aufruf ganz normal mit, ganz ohne Server. Über
ein Menü lassen sich neue `.fit`-Dateien direkt im Browser einlesen (über
einen selbstgeschriebenen JavaScript-FIT-Parser) — nichts verlässt den
eigenen Rechner.

Das Projekt ist modular aufgebaut (siehe `docs/PROJECT_MAP.md` für eine
Datei-für-Datei-Übersicht und `AI_RULES.md` für die zugrundeliegenden
Architektur-Prinzipien):

```text
index.html              Struktur (kein Inline-CSS/JS außer dem Theme-Bootstrap)
css/                     variables.css, main.css, components.css, responsive.css
js/
  utils/                 Datum/Zeit, Formatierung, reine Berechnungen
  data/                  Rohdaten laden/speichern (Workouts, Ziele, Profil, Erholung)
  analytics/             Trainingsbelastung (CTL/ATL/TSB/ACWR), Bestzeiten
  ai/                     Kontext-Builder, Prompts, Ollama-Anbindung
  components/            UI je Tab (Übersicht, Kalender, Rekorde, Coach, …)
  app.js                 Einstiegspunkt, startet die App
data/workouts-data.js    generierte Trainingsdaten (siehe unten, nicht im Repo)
docs/                    PROJECT_MAP.md, DATA_MODEL.md, AI_CONTEXT.md
```

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
python3 parse_fit.py        # erzeugt workouts.json aus den eigenen .fit-Dateien
python3 build_dashboard.py  # erzeugt data/workouts-data.js daraus
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
siehe `docs/PROJECT_MAP.md` und `AI_RULES.md`) statt einer einzelnen
HTML-Datei. Der FIT-Binärparser (inkl. komprimierter Zeitstempel und
Developer-Feldern) ist von Hand geschrieben, damit das Dashboard ganz ohne
externe Abhängigkeiten offline läuft.

## Lizenz

Privates Projekt zur eigenen Trainingsauswertung, veröffentlicht als
Referenz/Inspiration für andere. Keine Garantie auf Korrektheit der
sportwissenschaftlichen Kennzahlen — für ernsthafte Trainingsentscheidungen
im Zweifel einen Coach oder eine etablierte Plattform konsultieren.
