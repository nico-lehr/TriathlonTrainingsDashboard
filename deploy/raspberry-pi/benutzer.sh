#!/bin/bash
# Konten auf dem Raspberry Pi verwalten - jede Person hat ihren eigenen,
# getrennten Bereich (eigene Trainings, Ziele, Garmin-Schluessel ...).
# Eine Registrierung im Internet gibt es bewusst nicht: neue Konten legst
# nur du hier auf dem Pi an.
#
#   bash deploy/raspberry-pi/benutzer.sh            neue Person anlegen
#   bash deploy/raspberry-pi/benutzer.sh passwort   Passwort neu setzen
set -euo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)"
PY=.venv/bin/python
[ -x "$PY" ] || { echo "Erst installieren: bash deploy/raspberry-pi/install.sh"; exit 1; }
case "${1:-neu}" in
  neu) "$PY" backend/create_user.py ;;
  passwort) "$PY" backend/create_user.py --reset ;;
  *) echo "Unbekannt: $1 (erlaubt: passwort)"; exit 1 ;;
esac
