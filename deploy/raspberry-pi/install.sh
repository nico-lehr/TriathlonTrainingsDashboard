#!/bin/bash
# Richtet das Triathlon-Dashboard auf einem Raspberry Pi (Raspberry Pi OS,
# oder einem anderen Linux mit systemd) als Dauerdienst ein:
#   - Python-Umgebung .venv im Projektordner mit allen Bibliotheken
#   - .env mit geheimem Schluessel (falls noch keine da ist)
#   - Dienst "triathlon-dashboard": startet beim Hochfahren, nach Absturz
#     und nach einem Programm-Update von selbst neu
#   - taeglich 03:15 Sicherung (backup.py), taeglich 05:45 Garmin-Abruf
# Mehrfach ausfuehren ist harmlos (z. B. nach einem Update).
#
# Aufruf im Projektordner, als normaler Benutzer (nicht als root):
#   bash deploy/raspberry-pi/install.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SERVICE=triathlon-dashboard
RUN_USER="$(id -un)"
cd "$DIR"

say() { printf '\n==> %s\n' "$*"; }

if [ "$(id -u)" -eq 0 ]; then
  echo "Bitte als normaler Benutzer starten (nicht mit sudo) - sudo wird nur fuer einzelne Schritte gefragt."
  exit 1
fi

say "Systempakete (Python-Umgebung, git) ..."
if [ "${SKIP_APT:-0}" != "1" ] && command -v apt-get >/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq python3-venv python3-pip git avahi-daemon
fi

say "Python-Umgebung .venv ..."
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/python -m pip install -q --upgrade pip
if ! .venv/bin/python -m pip install -q -r backend/requirements.txt; then
  # Claude-Paket (anthropic) braucht Bausteine, die es auf alten 32-Bit-
  # Systemen evtl. nicht gibt - das Dashboard laeuft trotzdem, nur ohne Claude.
  echo "Hinweis: nicht alle Bibliotheken liessen sich installieren - ohne Claude-Paket noch einmal."
  .venv/bin/python -m pip install -q -r <(grep -vE '^(anthropic|cryptography)' backend/requirements.txt)
  echo "Hinweis: Claude (KI-Coach) geht so nicht. Abhilfe: Raspberry Pi OS (64-bit) verwenden."
fi
if [ "$(getconf LONG_BIT)" != "64" ]; then
  echo "Hinweis: Dies ist ein 32-Bit-System. Empfohlen ist Raspberry Pi OS (64-bit)."
fi
# Garmin und .fit-Leser: auf alten 32-Bit-Systemen fehlt evtl. ein Baustein
# (curl_cffi) - das Dashboard laeuft trotzdem, nur der alte Garmin-Login nicht.
if ! .venv/bin/python -m pip install -q -r requirements.txt; then
  echo "Hinweis: Garmin-Bibliotheken nicht vollstaendig installiert - nur fitdecode wird versucht."
  .venv/bin/python -m pip install -q fitdecode || echo "Hinweis: fitdecode fehlt - Garmin-Abruf und .fit-Import am Server gehen dann nicht."
fi

say "Einstellungen .env ..."
.venv/bin/python backend/setup_env.py

if [ "${SKIP_SYSTEMD:-0}" = "1" ]; then
  echo "SKIP_SYSTEMD=1: Dienst wird nicht eingerichtet."
  exit 0
fi

say "Dienst $SERVICE ..."
UNIT_DIR="${UNIT_DIR:-/etc/systemd/system}"  # nur fuer Tests aenderbar
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/$SERVICE.service" <<UNIT
[Unit]
Description=Triathlon-Dashboard
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=$DIR/.venv/bin/python $DIR/backend/launcher.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
cat > "$tmp/$SERVICE-backup.service" <<UNIT
[Unit]
Description=Triathlon-Dashboard: taegliche Sicherung

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$DIR
ExecStart=$DIR/.venv/bin/python $DIR/backup.py
UNIT
cat > "$tmp/$SERVICE-backup.timer" <<UNIT
[Unit]
Description=Triathlon-Dashboard: Sicherung jeden Tag um 03:15

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
cat > "$tmp/$SERVICE-garmin.service" <<UNIT
[Unit]
Description=Triathlon-Dashboard: taeglicher Garmin-Abruf (alle mit Schluessel/Token)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$RUN_USER
WorkingDirectory=$DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=$DIR/.venv/bin/python $DIR/tools/garmin_sync.py
UNIT
cat > "$tmp/$SERVICE-garmin.timer" <<UNIT
[Unit]
Description=Triathlon-Dashboard: Garmin-Abruf jeden Tag um 05:45

[Timer]
OnCalendar=*-*-* 05:45:00
Persistent=true
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
UNIT
sudo install -m 644 "$tmp"/$SERVICE*.service "$tmp"/$SERVICE*.timer "$UNIT_DIR"/
sudo systemctl daemon-reload
sudo systemctl enable -q --now $SERVICE-backup.timer $SERVICE-garmin.timer
sudo systemctl enable -q $SERVICE
sudo systemctl restart $SERVICE

say "Pruefe, ob das Dashboard antwortet ..."
PORT="$(grep -E '^DASHBOARD_PORT=' .env | cut -d= -f2 || true)"
PORT="${PORT:-5000}"
ok=0
for _ in $(seq 1 30); do
  if .venv/bin/python -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:$PORT/api/v1/health', timeout=2)" 2>/dev/null; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  echo "Das Dashboard antwortet nicht. Details: sudo journalctl -u $SERVICE -n 50"
  exit 1
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<TXT

Fertig - das Dashboard laeuft auf dem Raspberry Pi und startet ab jetzt von selbst.

  Im Heimnetz (Handy, Mac, PC):  http://$(hostname).local:$PORT
  oder mit der IP-Adresse:       http://$IP:$PORT

Naechste Schritte (siehe docs/DEPLOYMENT.md, Abschnitt 9):
  - Benutzer anlegen:  .venv/bin/python backend/create_user.py
  - Daten vom alten Rechner holen:  deploy/raspberry-pi/daten-zum-pi.sh (auf dem ALTEN Rechner)
  - Unterwegs erreichbar: Tailscale auf dem Pi installieren

Verwalten:  sudo systemctl status $SERVICE   |   sudo journalctl -u $SERVICE -f
TXT
