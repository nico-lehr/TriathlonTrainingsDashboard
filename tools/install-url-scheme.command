#!/bin/bash
# Einmalige Einrichtung: registriert das URL-Schema "tridash-sync://" bei macOS.
#
# Danach loest der Knopf "Mit Garmin Connect synchronisieren" im Dashboard den
# Sync aus - auch wenn das Dashboard per Doppelklick (file://) geoeffnet wurde.
# Eine Webseite darf kein Programm starten; ueber ein registriertes URL-Schema
# uebernimmt macOS das Starten, und fragt beim ersten Mal zur Bestaetigung.
#
# Rueckgaengig machen: einfach GarminSync.app in den Papierkorb legen.

set -e
cd "$(dirname "$0")/.." || exit 1
PROJECT="$(pwd)"
APP="$HOME/Applications/GarminSync.app"

echo "Richte den Sync-Knopf fuer das Dashboard ein ..."
echo "Projektordner: $PROJECT"

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
  <array>
    <dict>
      <key>CFBundleURLName</key><string>Triathlon Dashboard Garmin Sync</string>
      <key>CFBundleURLSchemes</key><array><string>tridash-sync</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST

# Startet die eigentliche Sync-Datei in einem sichtbaren Terminalfenster,
# damit Fortschritt, Passwortabfrage und Fehler sichtbar sind.
cat > "$APP/Contents/MacOS/GarminSync" <<LAUNCHER
#!/bin/bash
open -a Terminal "$PROJECT/sync-garmin.command"
LAUNCHER

chmod +x "$APP/Contents/MacOS/GarminSync"

# Bei macOS registrieren (Launch Services)
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$APP" 2>/dev/null || true

echo
echo "Fertig. GarminSync.app liegt unter ~/Applications."
echo
echo "So testest du es:"
echo "  1. Dashboard oeffnen (index.html)"
echo "  2. Oben rechts auf 'Aktualisieren' klicken"
echo "  3. 'Mit Garmin Connect synchronisieren' waehlen"
echo "  4. macOS fragt einmal nach - bestaetigen."
echo
echo "Falls nichts passiert: sync-garmin.command einfach direkt per Doppelklick"
echo "starten - das funktioniert immer, auch ohne diese Einrichtung."
echo
echo "Fenster mit Enter schliessen."
read -r
