"""Legt beim allerersten Start die Datei .env mit einem zufaelligen SECRET_KEY an
(Vorlage: .env.example). Gibt es .env schon, passiert nichts. Wird von
start.bat / start.sh aufgerufen - der Server selbst verweigert den Start ohne
SECRET_KEY weiterhin.
"""
import secrets
from pathlib import Path

BASE = Path(__file__).parent.parent
ENV = BASE / ".env"

if not ENV.exists():
    template = (BASE / ".env.example").read_text(encoding="utf-8")
    ENV.write_text(template.replace("SECRET_KEY=\n", f"SECRET_KEY={secrets.token_hex(32)}\n"), encoding="utf-8")
    print("Datei .env mit neuem geheimen Schluessel angelegt.")
