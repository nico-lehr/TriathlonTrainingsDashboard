"""Nachlesen aelterer Garmin-Einheiten: neue Parser-Felder (gefuehlte
Anstrengung, Runden, Temperatur) werden aus der archivierten .fit-Datei
nachgetragen, ohne den Rest von fit_data anzufassen.

Die .fit-Testdatei baut tests/js/fit-builder.js (Node). Ohne Node oder
fitdecode werden die Tests uebersprungen.

Aufruf im Projektordner:  python -m unittest backend.test_garmin_reparse -v
"""
import importlib.util
import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import date

from backend.config import config

HAVE_TOOLS = shutil.which("node") is not None and importlib.util.find_spec("fitdecode") is not None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@unittest.skipUnless(HAVE_TOOLS, "node oder fitdecode fehlt")
class ReparseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old_uri, cls.old_key = config.SQLALCHEMY_DATABASE_URI, config.SECRET_KEY
        config.SQLALCHEMY_DATABASE_URI = "sqlite:///" + os.path.join(cls.tmp.name, "reparse.db")
        config.SECRET_KEY = "nur-fuer-tests"
        from backend import create_app
        cls.app, cls.session_factory = create_app()

    @classmethod
    def tearDownClass(cls):
        cls.session_factory.remove()
        cls.session_factory.get_bind().dispose()
        config.SQLALCHEMY_DATABASE_URI, config.SECRET_KEY = cls.old_uri, cls.old_key
        cls.tmp.cleanup()

    def setUp(self):
        from backend.models import Workout
        self.fit_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.fit_dir)
        script = ("const fs=require('fs');const {sampleRunFit}=require(process.argv[1]);"
                  "fs.writeFileSync(process.argv[2], sampleRunFit());")
        subprocess.run(["node", "-e", script, os.path.join(ROOT, "tests", "js", "fit-builder.js"),
                        os.path.join(self.fit_dir, "lauf.fit")], check=True)
        s = self.session_factory()
        s.query(Workout).delete()
        old = {"file": "lauf.fit", "sport": "Laufen", "notiz": "bleibt", "avg_hr": 150}
        s.add(Workout(athlete_id=1, date=date(2026, 10, 1), sport="Laufen", duration_min=20,
                      source="garmin", fit_data=old))
        s.add(Workout(athlete_id=1, date=date(2026, 10, 2), sport="Laufen", duration_min=30,
                      source="garmin", fit_data={"file": "fehlt.fit"}))
        s.add(Workout(athlete_id=1, date=date(2026, 10, 3), sport="Laufen", duration_min=30,
                      source="upload", fit_data={"file": "lauf.fit"}))
        s.commit()

    def rows(self):
        from backend.models import Workout
        s = self.session_factory()
        s.expire_all()
        return {r.date.day: r for r in s.query(Workout).order_by(Workout.date)}

    def test_neue_felder_werden_nachgetragen(self):
        import tools.garmin_sync as garmin_sync
        s = self.session_factory()
        self.assertEqual(garmin_sync.reparse_outdated(s, 1, self.fit_dir), 1)
        rows = self.rows()
        fd = rows[1].fit_data
        self.assertEqual((fd["rpe"], fd["feel"], fd["avg_temp_c"], fd["max_temp_c"]), (7, 75, 21, 24))
        self.assertEqual(len(fd["laps"]), 2)
        self.assertEqual(fd["laps"][1]["intensity"], "interval")
        self.assertEqual((fd["notiz"], fd["avg_hr"]), ("bleibt", 150))  # Rest unveraendert
        self.assertEqual(fd["parser_version"], garmin_sync.parser_version())
        # Ohne Archivdatei: nur der Stand vermerkt, damit es nicht ewig wiederholt wird.
        self.assertEqual(rows[2].fit_data, {"file": "fehlt.fit", "parser_version": garmin_sync.parser_version()})
        self.assertEqual(rows[3].fit_data, {"file": "lauf.fit"})  # Browser-Upload bleibt unberuehrt
        # Zweiter Lauf: nichts mehr zu tun.
        self.assertEqual(garmin_sync.reparse_outdated(self.session_factory(), 1, self.fit_dir), 0)

    def test_limit_je_lauf(self):
        import tools.garmin_sync as garmin_sync
        garmin_sync.reparse_outdated(self.session_factory(), 1, self.fit_dir, limit=1)
        rows = self.rows()
        self.assertIn("parser_version", rows[1].fit_data)
        self.assertNotIn("parser_version", rows[2].fit_data)


if __name__ == "__main__":
    unittest.main()
