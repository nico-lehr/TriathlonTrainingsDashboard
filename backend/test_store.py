"""Ablage pro Person: zwei Tabs speichern denselben Bereich gleichzeitig zum
ersten Mal - beide Anfragen gelingen, es bleibt genau eine Zeile.

Aufruf im Projektordner:  python -m unittest backend.test_store -v
"""
import os
import tempfile
import threading
import unittest

from backend import auth, create_app
from backend.config import config
from backend.models import AthleteStore

PASSWORD = "langes-passwort-1"
THREADS = 6


class StoreRaceTest(unittest.TestCase):
    # Datenbank-DATEI statt :memory: (sonst bekommt jeder Thread eine eigene, leere DB).
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old_uri, cls.old_key = config.SQLALCHEMY_DATABASE_URI, config.SECRET_KEY
        config.SQLALCHEMY_DATABASE_URI = "sqlite:///" + os.path.join(cls.tmp.name, "store.db")
        config.SECRET_KEY = "nur-fuer-tests"
        cls.app, cls.session_factory = create_app()

    @classmethod
    def tearDownClass(cls):
        cls.session_factory.remove()
        cls.session_factory.get_bind().dispose()
        config.SQLALCHEMY_DATABASE_URI, config.SECRET_KEY = cls.old_uri, cls.old_key
        cls.tmp.cleanup()

    def test_gleichzeitige_erst_speicherung(self):
        session = self.session_factory()
        for runde in range(5):
            name = f"store-race-{runde}"
            athlete_id = auth.create_login(session, name, PASSWORD)
            token = self.app.test_client().post("/api/v1/auth/login", json={"username": name, "password": PASSWORD}).get_json()["data"]["token"]
            barrier, codes = threading.Barrier(THREADS), []

            def tab(i):
                client = self.app.test_client()
                barrier.wait()
                r = client.put("/api/v1/store/triathlon_dashboard_achievements_v1", json={"value": {"tab": i}},
                               headers={"Authorization": f"Bearer {token}"})
                codes.append(r.status_code)

            threads = [threading.Thread(target=tab, args=(i,)) for i in range(THREADS)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            with self.subTest(runde=runde):
                self.assertEqual(codes, [200] * THREADS)
                self.assertEqual(session.query(AthleteStore).filter_by(athlete_id=athlete_id).count(), 1)
        session.close()


if __name__ == "__main__":
    unittest.main()
