#!/bin/bash
# Einmalige Einrichtung des Trainings-Dashboards auf einem Mac.
#
# Doppelklick genuegt. Das Skript
#   1. prueft, ob Python 3 vorhanden ist,
#   2. installiert die benoetigten Python-Bibliotheken,
#   3. legt die Arbeitsordner an,
#   4. registriert den Sync-Knopf im Dashboard (URL-Schema),
#   5. hebt die macOS-Blockade fuer die Start-Dateien auf,
#   6. oeffnet das Dashboard.
#
# Alles laeuft lokal. Es werden keine Daten hochgeladen und keine
# Zugangsdaten gespeichert (siehe README.md).

cd "$(dirname "$0")" || exit 1
PROJECT="$(pwd)"

# Farben nur, wenn das Terminal sie kann
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m';
else B=""; G=""; Y=""; R=""; N=""; fi

ok()   { echo "${G}✓${N} $1"; }
warn() { echo "${Y}!${N} $1"; }
fail() { echo "${R}✗${N} $1"; }

ende() {
  echo
  echo "Fenster kann geschlossen werden (oder Enter druecken)."
  read -r
  exit "${1:-0}"
}

echo
echo "${B}════════════════════════════════════════${N}"
echo "${B}  Trainings-Dashboard — Einrichtung${N}"
echo "${B}════════════════════════════════════════${N}"
echo
echo "Ordner: $PROJECT"
echo

# ---------------------------------------------------------------- 1. Python
echo "${B}[1/6] Python${N}"
PY=""
for cand in python3 /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
  if command -v "$cand" >/dev/null 2>&1; then
    if "$cand" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,9) else 1)' 2>/dev/null; then
      PY="$cand"; break
    fi
  fi
done

if [ -z "$PY" ]; then
  fail "Python 3.9 oder neuer wurde nicht gefunden."
  echo
  echo "  Python wird nur fuer den Garmin-Sync gebraucht."
  echo "  Das Dashboard selbst laeuft auch ohne - dann einfach index.html oeffnen."
  echo
  echo "  Installation (eine der beiden Varianten):"
  echo "    • Installer laden:  https://www.python.org/downloads/macos/"
  echo "    • oder per Homebrew:  brew install python"
  echo
  read -r -p "  Soll die Download-Seite jetzt geoeffnet werden? [j/N] " a
  case "$a" in j|J|y|Y) open "https://www.python.org/downloads/macos/" ;; esac
  echo
  warn "Nach der Python-Installation dieses Setup bitte erneut starten."
  ende 1
fi
ok "Python gefunden: $("$PY" -V 2>&1) ($PY)"

# ------------------------------------------------------- 2. Bibliotheken
echo
echo "${B}[2/6] Python-Bibliotheken${N}"
if "$PY" -c "import garminconnect, curl_cffi, fitdecode" >/dev/null 2>&1; then
  ok "Alle Bibliotheken bereits vorhanden."
else
  echo "  Installiere garminconnect, curl_cffi, fitdecode ..."
  if "$PY" -m pip install --quiet --upgrade pip >/dev/null 2>&1; then :; fi
  if "$PY" -m pip install --quiet -r requirements.txt; then
    ok "Bibliotheken installiert."
  else
    # Haeufigster Fall auf neueren Systemen: pip verweigert die Installation
    # in die System-Python-Umgebung (PEP 668).
    warn "Normale Installation fehlgeschlagen - versuche es mit --user ..."
    if "$PY" -m pip install --quiet --user -r requirements.txt; then
      ok "Bibliotheken im Benutzerordner installiert."
    else
      fail "Die Bibliotheken konnten nicht installiert werden."
      echo "    Bitte von Hand ausfuehren und die Meldung pruefen:"
      echo "      $PY -m pip install -r requirements.txt"
      echo
      warn "Das Dashboard selbst funktioniert trotzdem - nur der Garmin-Sync nicht."
    fi
  fi
fi

# ---------------------------------------------------------- 3. Arbeitsordner
echo
echo "${B}[3/6] Arbeitsordner${N}"
mkdir -p fit-files data

# Leere Platzhalter anlegen, damit der Browser beim ersten Start keine
# 404-Meldungen in der Konsole zeigt (die <script>-Tags in index.html
# verweisen fest auf diese Dateien). Der erste Sync ueberschreibt sie mit den
# echten Daten. Vorhandene Dateien werden NIE angetastet.
if [ ! -f data/workouts-data.js ]; then
  cat > data/workouts-data.js <<'PLATZHALTER'
// Platzhalter, angelegt von setup.command - wird beim ersten Einlesen
// (build_dashboard.py) durch die echten Trainingsdaten ersetzt.
const EMBEDDED_DATA = {"generated_at":null,"source_folder":null,"count":0,"skipped":[],"workouts":[]};
PLATZHALTER
fi
if [ ! -f data/wellness-data.js ]; then
  cat > data/wellness-data.js <<'PLATZHALTER'
// Platzhalter, angelegt von setup.command - wird beim ersten Garmin-Sync
// (tools/garmin_sync.py) durch die echten Gesundheitsdaten ersetzt.
const GARMIN_WELLNESS = {"generated_at":null,"sync":null,"daily":{}};
PLATZHALTER
fi
ok "fit-files/ und data/ bereit."

# ------------------------------------------------- 4. macOS-Blockade loesen
echo
echo "${B}[4/6] macOS-Blockade${N}"
# Beim Download als ZIP markiert macOS alle Dateien als "aus dem Internet"
# und verweigert den Doppelklick. Hier einmalig entfernen, damit der Nutzer
# sich nicht mit Rechtsklick-Tricks herumschlagen muss.
CLEANED=0
for f in setup.command sync-garmin.command tools/install-url-scheme.command; do
  [ -f "$f" ] || continue
  chmod +x "$f" 2>/dev/null
  if xattr -p com.apple.quarantine "$f" >/dev/null 2>&1; then
    xattr -d com.apple.quarantine "$f" 2>/dev/null && CLEANED=$((CLEANED+1))
  fi
done
if [ "$CLEANED" -gt 0 ]; then ok "Blockade fuer $CLEANED Datei(en) aufgehoben."
else ok "Keine Blockade vorhanden."; fi

# --------------------------------------------------------- 5. Sync-Knopf
echo
echo "${B}[5/6] Sync-Knopf im Dashboard${N}"
APP="$HOME/Applications/GarminSync.app"
mkdir -p "$HOME/Applications"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>GarminSync</string>
  <key>CFBundleIdentifier</key><string>local.tridash.garminsync</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>GarminSync</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>CFBundleURLTypes</key>
  <array><dict>
    <key>CFBundleURLName</key><string>Triathlon Dashboard Garmin Sync</string>
    <key>CFBundleURLSchemes</key><array><string>tridash-sync</string></array>
  </dict></array>
</dict>
</plist>
PLIST
cat > "$APP/Contents/MacOS/GarminSync" <<LAUNCHER
#!/bin/bash
open -a Terminal "$PROJECT/sync-garmin.command"
LAUNCHER
chmod +x "$APP/Contents/MacOS/GarminSync"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$APP" >/dev/null 2>&1
ok "Registriert. Der Knopf im Update-Menue startet jetzt den Sync."

# ----------------------------------------------------------- 6. Abschluss
echo
echo "${B}[6/6] Dashboard oeffnen${N}"
open index.html
ok "Geoeffnet."

echo
echo "${B}════════════════════════════════════════${N}"
echo "${B}  Fertig.${N}"
echo "${B}════════════════════════════════════════${N}"
echo
echo "So geht es weiter:"
echo
echo "  ${B}Mit Garmin Connect synchronisieren${N}"
echo "    Doppelklick auf  sync-garmin.command"
echo "    (oder im Dashboard: Aktualisieren ▸ Mit Garmin Connect synchronisieren)"
echo
echo "    Beim ersten Mal werden E-Mail und Passwort abgefragt."
echo "    Das Passwort wird NICHT gespeichert - nur ein Token, das sich"
echo "    danach selbst erneuert. Ab dem zweiten Mal keine Eingabe mehr."
echo
echo "  ${B}Ohne Garmin: eigene .fit-Dateien einlesen${N}"
echo "    Im Dashboard oben rechts: Aktualisieren ▸ Ordner waehlen"
echo
ende 0
