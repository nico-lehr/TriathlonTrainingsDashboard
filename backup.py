"""Sichert training.db nach backups/training-JJJJ-MM-TT.db und behaelt die letzten 14.

Aufruf im Projektordner:  python backup.py   (Windows: Doppelklick auf backup.bat)
Laeuft auch, waehrend der Server laeuft: SQLite kopiert dabei einen in sich
stimmigen Stand (Backup-Funktion von SQLite statt einfachem Datei-Kopieren).
Pro Tag gibt es eine Datei; ein zweiter Lauf am selben Tag ersetzt sie.
backend/app.py ruft backup_db() vor jedem Start auf (dabei koennen neue
Tabellen dazukommen).
"""
import sqlite3
from datetime import date
from pathlib import Path

BASE = Path(__file__).parent
DB_PATH = BASE / "training.db"  # wie SQLALCHEMY_DATABASE_URI in backend/config.py
BACKUP_DIR = BASE / "backups"
KEEP = 14


def backup_db():
    """Gibt den Pfad der Sicherung zurueck, oder None, wenn es noch keine training.db gibt."""
    if not DB_PATH.exists():
        return None
    BACKUP_DIR.mkdir(exist_ok=True)
    target = BACKUP_DIR / f"training-{date.today():%Y-%m-%d}.db"
    src, dst = sqlite3.connect(DB_PATH), sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    for old in sorted(BACKUP_DIR.glob("training-*.db"))[:-KEEP]:
        old.unlink()
    return target


if __name__ == "__main__":
    saved = backup_db()
    print(f"Gesichert: {saved}" if saved else "Keine training.db gefunden - nichts zu sichern.")
