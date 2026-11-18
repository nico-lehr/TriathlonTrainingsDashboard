"""Dateirechte: Datenbank, Sicherungen und geheime Dateien darf nur der
eigene Benutzer lesen (wichtig, wenn auf dem Rechner noch andere Konten sind).

backend/app.py ruft secure_files() vor jedem Start auf:
- umask 077: alles, was der Server ab jetzt anlegt (Sicherungen, Garmin-Token,
  Protokolle, ...), ist nur fuer den eigenen Benutzer lesbar.
- Vorhandenes wird nachgezogen: .env, training.db (mit -wal/-shm/-journal),
  backups/ und ~/.triathlon (Claude-, Garmin-, Push-Schluessel).
Unter Windows passiert nichts - dort schuetzt das Benutzerprofil.
"""
import os
import stat
from pathlib import Path

DIR_MODE, FILE_MODE = 0o700, 0o600


def _tighten(path, mode):
    """Rechte hoechstens auf mode setzen (nie lockern). Fremde Dateien ueberspringen."""
    try:
        st = os.lstat(path)
        if stat.S_ISLNK(st.st_mode) or st.st_uid != os.getuid():
            return
        if stat.S_IMODE(st.st_mode) & ~mode:
            os.chmod(path, stat.S_IMODE(st.st_mode) & mode)
    except OSError:
        pass


def _tighten_tree(root):
    if not root.is_dir():
        return
    _tighten(root, DIR_MODE)
    for dirpath, dirnames, filenames in os.walk(root):
        for d in dirnames:
            _tighten(os.path.join(dirpath, d), DIR_MODE)
        for f in filenames:
            _tighten(os.path.join(dirpath, f), FILE_MODE)


def secure_files(base=None, home=None):
    if os.name == "nt":
        return
    os.umask(0o077)
    base = Path(base) if base else Path(__file__).parent.parent
    home = Path(home) if home else Path.home()
    for name in (".env", "training.db", "training.db-wal", "training.db-shm", "training.db-journal"):
        if (base / name).exists():
            _tighten(base / name, FILE_MODE)
    _tighten_tree(base / "backups")
    _tighten_tree(home / ".triathlon")
