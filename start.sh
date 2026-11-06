#!/bin/sh
# Startet das Triathlon-Dashboard (Webseite + API) auf diesem Rechner (Mac/Linux).
# Freunde erreichen es ueber Tailscale unter http://<Rechnername>:5000
# Anleitung: docs/DEPLOYMENT.md (Raspberry Pi als Dauerdienst: Abschnitt 9)
cd "$(dirname "$0")" || exit 1

# Eigene Python-Umgebung .venv bevorzugen (legt deploy/raspberry-pi/install.sh
# an, oder unten automatisch, wenn das System pip verweigert).
if [ -x .venv/bin/python ]; then
  PY=.venv/bin/python
else
  PY=$(command -v python3 || command -v python)
fi
if [ -z "$PY" ]; then
  echo "Python 3 wurde nicht gefunden. Bitte von python.org installieren."
  exit 1
fi

if ! "$PY" -c "import flask, sqlalchemy, waitress, dotenv" 2>/dev/null; then
  echo "Einmalig: benoetigte Bibliotheken werden installiert ..."
  if ! "$PY" -m pip install -r backend/requirements.txt && ! "$PY" -m pip install --user -r backend/requirements.txt; then
    # Neuere Linux-Systeme (z. B. Raspberry Pi OS) erlauben pip nur in einer
    # eigenen Umgebung - dann eben dort.
    echo "Lege eine eigene Python-Umgebung (.venv) an ..."
    "$PY" -m venv .venv && PY=.venv/bin/python && "$PY" -m pip install -r backend/requirements.txt || exit 1
  fi
fi

# Starter: startet den Server nach einem Update automatisch neu.
"$PY" backend/setup_env.py && exec "$PY" backend/launcher.py
