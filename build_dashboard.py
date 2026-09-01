#!/usr/bin/env python3
"""
Erzeugt data/workouts-data.js aus workouts.json.

Die App (index.html) ist ein modulares, mehrere Dateien umfassendes
Projekt (css/, js/, data/) und braucht dafuer KEINEN Build-Schritt mehr --
index.html laesst sich direkt per Doppelklick oeffnen. Nur die
Trainingsdaten selbst werden hier als kleine generierte JS-Datei
eingebettet (statt per fetch() geladen), weil ein Doppelklick-Aufruf
(file://) in Chrome/Safari kein fetch() auf lokale JSON-Dateien erlaubt --
ein <script src="..."> laedt aber ganz normal.

Nach jedem "Aktualisieren" via parse_fit.py (oder direkt im Browser ueber
den Update-Button) hier erneut ausfuehren, um data/workouts-data.js auf
den neuesten Stand zu bringen -- nur relevant fuer den Fall, dass man
workouts.json ausserhalb des Browsers aktualisiert hat.
"""
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(BASE, "workouts.json"), encoding="utf-8") as f:
    data = json.load(f)

embedded_json = json.dumps(data, ensure_ascii=False)

os.makedirs(os.path.join(BASE, "data"), exist_ok=True)
out_path = os.path.join(BASE, "data", "workouts-data.js")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(
        "// Automatisch erzeugt von build_dashboard.py aus workouts.json.\n"
        "// Nicht von Hand bearbeiten -- enthaelt die echten, persoenlichen\n"
        "// Trainingsdaten und ist deshalb ueber .gitignore vom Repository\n"
        "// ausgeschlossen.\n"
        f"const EMBEDDED_DATA = {embedded_json};\n"
    )

print(f"data/workouts-data.js geschrieben ({len(embedded_json)} Zeichen Daten)")
