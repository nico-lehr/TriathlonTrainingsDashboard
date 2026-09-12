#!/bin/bash
# Doppelklick-Start fuer den Garmin-Sync.
#
# Fuehrt die komplette Kette aus:
#   1. tools/garmin_sync.py   - laedt .fit-Dateien + Gesundheitsdaten
#   2. parse_fit.py           - liest die .fit-Dateien ein -> workouts.json
#   3. build_dashboard.py     - erzeugt data/workouts-data.js
#   4. oeffnet das Dashboard im Browser
#
# Beim ersten Lauf wird einmalig nach E-Mail und Passwort gefragt. Das Passwort
# wird NICHT gespeichert - nur ein Token unter ~/.garminconnect, das sich
# danach selbst erneuert.

cd "$(dirname "$0")" || exit 1

# Zeitraum: ohne Argumente gilt der Standard aus tools/garmin_sync.py
# (DEFAULT_DAYS = 300 Tage). Das deckt alle Auswertungen ab; die Begruendung
# steht dort im Kommentar.
#
# Mehr Historie einmalig nachholen (z.B. fuer Allzeit-Bestwerte im
# Rekorde-Tab) - vorhandene Dateien werden dabei uebersprungen, es geht also
# nichts verloren und es kostet nur einmalig Zeit:
#     ./sync-garmin.command --days 1095
#
# Hinweis zum Zusammenspiel: parse_fit.py + build_dashboard.py bauen
# data/workouts-data.js aus ALLEN Dateien in fit-files/ neu auf - der Ordner
# ist das Archiv, nicht nur ein Zwischenlager. Was einmal heruntergeladen
# wurde, bleibt also erhalten, auch wenn spaetere Laeufe ein kleineres
# Zeitfenster nutzen.
ARGS=("$@")

PY=$(command -v python3)
if [ -z "$PY" ]; then
  echo "python3 wurde nicht gefunden. Bitte Python 3 installieren."
  echo "Fenster mit Enter schliessen."; read -r; exit 1
fi

echo "======================================"
echo "  Garmin Connect -> Dashboard"
echo "======================================"

# Fehlende Abhaengigkeiten einmalig nachinstallieren (still, wenn alles da ist)
if ! "$PY" -c "import garminconnect, fitdecode" >/dev/null 2>&1; then
  echo
  echo "Es fehlen noch Python-Bibliotheken - sie werden jetzt installiert ..."
  "$PY" -m pip install --quiet -r requirements.txt || {
    echo "Installation fehlgeschlagen. Bitte von Hand ausfuehren:"
    echo "  python3 -m pip install -r requirements.txt"
    echo "Fenster mit Enter schliessen."; read -r; exit 1
  }
fi

echo
"$PY" tools/garmin_sync.py "${ARGS[@]}" || {
  echo
  echo "Der Sync wurde nicht sauber beendet (siehe Meldung oben)."
  echo "Bereits geladene Daten bleiben erhalten - ein erneuter Start macht dort weiter."
  echo "Fenster mit Enter schliessen."; read -r; exit 1
}

echo
echo "--- .fit-Dateien einlesen ---"
"$PY" parse_fit.py || { echo "Einlesen fehlgeschlagen."; echo "Fenster mit Enter schliessen."; read -r; exit 1; }

echo
echo "--- Dashboard-Daten erzeugen ---"
"$PY" build_dashboard.py || { echo "Erzeugen fehlgeschlagen."; echo "Fenster mit Enter schliessen."; read -r; exit 1; }

echo
echo "Fertig. Dashboard wird geoeffnet ..."
open index.html

echo
echo "Fenster kann geschlossen werden (oder Enter druecken)."
read -r -t 15
