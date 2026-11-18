"""Legt beim allerersten Start die Datei .env mit einem zufaelligen SECRET_KEY an
(Vorlage: .env.example). Gibt es .env schon, passiert nichts. Wird von
start.bat / start.sh aufgerufen - der Server selbst verweigert den Start ohne
SECRET_KEY weiterhin.
"""
import os
import secrets
from pathlib import Path

BASE = Path(__file__).parent.parent
ENV = BASE / ".env"

if not ENV.exists():
    template = (BASE / ".env.example").read_text(encoding="utf-8")
    # Gleich beim Anlegen nur fuer den eigenen Benutzer lesbar (enthaelt den
    # geheimen Schluessel) - nicht erst danach. Windows: schuetzt das Benutzerprofil.
    fd = os.open(ENV, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(template.replace("SECRET_KEY=\n", f"SECRET_KEY={secrets.token_hex(32)}\n"))
    print("Datei .env mit neuem geheimen Schluessel angelegt.")
