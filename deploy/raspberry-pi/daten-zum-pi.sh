#!/bin/bash
# Kopiert deine bisherigen Dashboard-Daten vom ALTEN Rechner (Mac/Linux) auf
# den Raspberry Pi: training.db, .env, fit-files/ und die Garmin-Schluessel
# (~/.triathlon). Auf dem Pi wird das Dashboard dafuer kurz angehalten.
#
# Aufruf auf dem alten Rechner, im Projektordner:
#   bash deploy/raspberry-pi/daten-zum-pi.sh <benutzer>@<pi-name>.local [Projektordner-auf-dem-Pi]
# Beispiel:
#   bash deploy/raspberry-pi/daten-zum-pi.sh nico@raspberrypi.local
# Ohne zweite Angabe: ~/TriathlonTrainingsDashboard auf dem Pi.
#
# Vorher: das Dashboard auf dem alten Rechner beenden (Fenster schliessen),
# damit training.db in Ruhe kopiert werden kann.
set -euo pipefail

PI="${1:-}"
REMOTE_DIR="${2:-TriathlonTrainingsDashboard}"
if [ -z "$PI" ]; then
  echo "Bitte angeben, wohin: bash deploy/raspberry-pi/daten-zum-pi.sh <benutzer>@<pi-name>.local"
  exit 1
fi
cd "$(dirname "$0")/../.."
[ -f training.db ] || { echo "Hier liegt keine training.db - bitte im Projektordner des alten Rechners starten."; exit 1; }

echo "==> Sicherung auf diesem Rechner (backups/) ..."
python3 backup.py || true

echo "==> Dashboard auf dem Pi anhalten ..."
ssh -t "$PI" "sudo systemctl stop triathlon-dashboard"

echo "==> Kopieren ..."
ssh "$PI" "test -f '$REMOTE_DIR/training.db' && cp '$REMOTE_DIR/training.db' '$REMOTE_DIR/training.db.vor-umzug' || true"
scp training.db .env "$PI:$REMOTE_DIR/"
[ -d fit-files ] && scp -r fit-files "$PI:$REMOTE_DIR/"
if [ -d "$HOME/.triathlon" ]; then
  ssh "$PI" "mkdir -p ~/.triathlon && chmod 700 ~/.triathlon"
  scp -p "$HOME"/.triathlon/* "$PI:.triathlon/" 2>/dev/null || true
  scp -rp "$HOME"/.triathlon/*.token "$PI:.triathlon/" 2>/dev/null || true
fi

echo "==> Dashboard auf dem Pi starten ..."
ssh -t "$PI" "sudo systemctl start triathlon-dashboard"
echo "Fertig. Auf dem alten Rechner das Dashboard ab jetzt NICHT mehr starten - sonst gibt es zwei getrennte Datenstaende."
