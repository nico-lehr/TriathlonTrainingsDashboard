@echo off
rem Sichert training.db nach backups\ (eine Datei pro Tag, die letzten 14 bleiben).
rem Taeglich automatisch: siehe docs\DEPLOYMENT.md (Aufgabenplanung).
cd /d "%~dp0"
set PY=python
where py >nul 2>nul && set PY=py -3
%PY% backup.py
