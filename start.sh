#!/bin/sh
# Startet das Triathlon-Dashboard (Webseite + API) auf diesem Rechner (Mac/Linux).
# Freunde erreichen es ueber Tailscale unter http://<Rechnername>:5000
# Anleitung: docs/DEPLOYMENT.md
cd "$(dirname "$0")" || exit 1

PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then
  echo "Python 3 wurde nicht gefunden. Bitte von python.org installieren."
  exit 1
fi

if ! "$PY" -c "import flask, sqlalchemy, waitress, dotenv" 2>/dev/null; then
  echo "Einmalig: benoetigte Bibliotheken werden installiert ..."
  "$PY" -m pip install -r backend/requirements.txt || "$PY" -m pip install --user -r backend/requirements.txt || exit 1
fi

"$PY" backend/setup_env.py && exec "$PY" backend/app.py
