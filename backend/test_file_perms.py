"""Dateirechte (backend/file_perms.py): Datenbank, Sicherungen, .env und
~/.triathlon werden nur fuer den eigenen Benutzer lesbar.

Aufruf im Projektordner:  python -m unittest backend.test_file_perms -v
"""
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from backend.file_perms import secure_files


@unittest.skipIf(os.name == "nt", "Windows kennt diese Rechte nicht")
class FilePermsTest(unittest.TestCase):
    def setUp(self):
        self.old_umask = os.umask(0o022)
        self.tmp = Path(tempfile.mkdtemp())
        self.base, self.home = self.tmp / "projekt", self.tmp / "home"
        for d in (self.base / "backups", self.home / ".triathlon" / "garmin"):
            d.mkdir(parents=True)
        self.files = [self.base / "training.db", self.base / ".env", self.base / "backups" / "training-2026-11-18.db",
                      self.home / ".triathlon" / "garmin" / "oauth2_token.json", self.home / ".triathlon" / "garmin-sync.log"]
        for f in self.files:
            f.write_text("x")
            f.chmod(0o644)
        (self.base / "index.html").write_text("x")
        (self.base / "index.html").chmod(0o644)

    def tearDown(self):
        os.umask(self.old_umask)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def mode(self, p):
        return os.stat(p).st_mode & 0o777

    def test_nur_eigener_benutzer(self):
        secure_files(self.base, self.home)
        for f in self.files:
            self.assertEqual(self.mode(f), 0o600, f)
        for d in (self.base / "backups", self.home / ".triathlon", self.home / ".triathlon" / "garmin"):
            self.assertEqual(self.mode(d), 0o700, d)
        self.assertEqual(self.mode(self.base / "index.html"), 0o644)  # Programmdateien bleiben, wie sie sind
        # ab jetzt neu angelegte Dateien sind gleich geschuetzt
        neu = self.base / "backups" / "neu.db"
        neu.write_text("x")
        self.assertEqual(self.mode(neu), 0o600)

    def test_lockert_nie(self):
        (self.base / ".env").chmod(0o400)
        secure_files(self.base, self.home)
        self.assertEqual(self.mode(self.base / ".env"), 0o400)


if __name__ == "__main__":
    unittest.main()
