#!/bin/bash
# Macht das Dashboard auf dem Raspberry Pi unter einer festen, sicheren
# Internet-Adresse erreichbar (https://<pi-name>.<dein-netz>.ts.net) - fuer
# dich unterwegs und fuer deine Freunde, ohne App und ohne Router-Einstellung.
# Technik: Tailscale Funnel. Tailscale stellt die Adresse und das HTTPS-
# Zertifikat; der Pi muss dafuer nur ins Internet koennen.
#
# Aufruf im Projektordner auf dem Pi:
#   bash deploy/raspberry-pi/oeffentlich.sh          einschalten (mehrfach harmlos)
#   bash deploy/raspberry-pi/oeffentlich.sh status   Adresse anzeigen
#   bash deploy/raspberry-pi/oeffentlich.sh aus      oeffentliche Adresse abschalten
set -euo pipefail

DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$DIR"
PORT="$(grep -E '^DASHBOARD_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)"
PORT="${PORT:-5000}"

say() { printf '\n==> %s\n' "$*"; }

if [ "$(id -u)" -eq 0 ]; then
  echo "Bitte als normaler Benutzer starten (nicht mit sudo)."
  exit 1
fi

case "${1:-an}" in
  status)
    sudo tailscale funnel status
    exit 0 ;;
  aus)
    sudo tailscale funnel reset
    echo "Die oeffentliche Adresse ist abgeschaltet. Im Heimnetz geht das Dashboard weiter."
    exit 0 ;;
  an) ;;
  *)
    echo "Unbekannt: $1 (erlaubt: status, aus)"; exit 1 ;;
esac

if ! command -v tailscale >/dev/null; then
  say "Tailscale installieren (offizielles Installationsprogramm) ..."
  curl -fsSL https://tailscale.com/install.sh | sh
fi

if ! tailscale status >/dev/null 2>&1; then
  say "Bei Tailscale anmelden: Gleich erscheint ein Link. Oeffne ihn am Mac oder Handy"
  echo "    und melde dich an (z. B. mit deinem Google- oder Apple-Konto)."
  sudo tailscale up
fi

curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/v1/health" || {
  echo "Das Dashboard antwortet auf dem Pi nicht (Port $PORT). Erst installieren: bash deploy/raspberry-pi/install.sh"
  exit 1
}

say "Oeffentliche Adresse einschalten ..."
echo "    Beim ersten Mal zeigt Tailscale evtl. einen Link, um HTTPS/Funnel zu erlauben:"
echo "    Link oeffnen, bestaetigen, dann laeuft es hier von selbst weiter."
sudo tailscale funnel --bg "$PORT"

say "Fertig. Deine Adresse (von ueberall, auch fuer Freunde):"
sudo tailscale funnel status | grep -Eo 'https://[^ ]+' | head -1 | sed 's/^/    /'
echo
echo "    Die Adresse bleibt nach einem Neustart des Pi bestehen."
echo "    Jede Person braucht ein eigenes Konto: bash deploy/raspberry-pi/benutzer.sh"
