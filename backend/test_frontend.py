"""Nur die Erlaubt-Liste ist abrufbar.

Aufruf im Projektordner:  python -m unittest backend.test_frontend -v
"""
import collections
import re
import unittest
from pathlib import Path

from backend import create_app
from backend.config import config

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"


class FrontendTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, _ = create_app()

    def setUp(self):
        self.client = self.app.test_client()

    def test_dashboard_abrufbar(self):
        for url in ["/", "/index.html", "/css/main.css", "/js/app.js", "/js/data/api-client.js"]:
            with self.subTest(url=url):
                r = self.client.get(url)
                self.assertEqual(r.status_code, 200)
                r.close()

    def test_alles_andere_gesperrt(self):
        for url in ["/.env", "/training.db", "/backend/app.py", "/backend/config.py",
                    "/data/workouts-data.js", "/workouts-data.js", "/data/wellness-data.js",
                    "/docs/PROJECT_MAP.md", "/backups/training.db", "/fit-files/a.fit",
                    "/.git/config", "/README.md", "/parse_fit.py", "/static/x",
                    "/css/../.env", "/css/%2e%2e/.env", "/js/..%2f.env", "/js/.hidden"]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)


    def test_keine_doppelten_element_kennungen(self):
        # getElementById findet nur das erste Element - eine doppelte Kennung
        # (z. B. "update-status" im Aktualisieren-Menu UND in den Einstellungen)
        # laesst eine Anzeige still ins Leere laufen.
        for page in ("index.html", "login.html"):
            html = (Path(__file__).resolve().parent.parent / page).read_text(encoding="utf-8")
            counts = collections.Counter(re.findall(r'(?<![\w-])id="([^"]+)"', html))
            with self.subTest(page=page):
                self.assertEqual([k for k, v in counts.items() if v > 1], [])


if __name__ == "__main__":
    unittest.main()
