@echo off
rem Startet das Triathlon-Dashboard (Webseite + API) auf diesem PC.
rem Freunde erreichen es ueber Tailscale unter http://<PC-Name>:5000
rem Anleitung: docs\DEPLOYMENT.md
cd /d "%~dp0"

set PY=python
where py >nul 2>nul && set PY=py -3
%PY% --version >nul 2>nul || (
  echo Python wurde nicht gefunden. Bitte Python 3 von python.org installieren
  echo und dabei "Add python.exe to PATH" ankreuzen.
  pause
  exit /b 1
)

%PY% -c "import flask, sqlalchemy, waitress, dotenv" >nul 2>nul || (
  echo Einmalig: benoetigte Bibliotheken werden installiert ...
  %PY% -m pip install -r backend\requirements.txt || (
    echo Installation fehlgeschlagen - siehe Meldung oben.
    pause
    exit /b 1
  )
)

%PY% backend\setup_env.py
%PY% backend\app.py
pause
