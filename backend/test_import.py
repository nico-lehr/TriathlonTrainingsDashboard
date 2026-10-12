"""Import: Doppelte werden ignoriert - egal ueber welchen Weg ein Workout kommt.

Aufruf im Projektordner:  python -m unittest backend.test_import -v
"""
import unittest

from backend import auth, create_app
from backend.config import config
from backend.import_workouts_json import import_store, import_workouts
from backend.models import AthleteStore, Workout

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"

# Dieselbe Einheit, wie parse_fit.py sie schreibt ...
LAUF_PY = {"file": "2026-10-01-08-30-00.fit", "date": "2026-10-01T06:30:00+00:00",
           "sport": "Laufen", "sport_raw": "running", "duration_min": 30.0, "stream": {"t": [0, 1]}}
# ... und wie der Browser-Parser sie schreibt (andere Schreibweise derselben Zeit).
LAUF_JS = {**LAUF_PY, "file": "lauf.fit", "date": "2026-10-01T06:30:00.000Z"}


class ImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, cls.session_factory = create_app()
        session = cls.session_factory()
        cls.a = auth.create_login(session, "import-a", "langes-passwort-1")
        cls.b = auth.create_login(session, "import-b", "langes-passwort-1")
        session.close()

    def setUp(self):
        self.session = self.session_factory()

    def tearDown(self):
        self.session.query(Workout).delete()
        self.session.query(AthleteStore).delete()
        self.session.commit()
        self.session.close()

    def post(self, user, workout):
        client = self.app.test_client()
        token = client.post("/api/v1/auth/login", json={"username": user, "password": "langes-passwort-1"}).get_json()["data"]["token"]
        return client.post("/api/v1/workouts", headers={"Authorization": f"Bearer {token}"},
                           json={"date": "2026-10-01", "sport": workout["sport"], "duration_min": 30, "fit_data": workout})

    def test_browser_import_doppelt_ignoriert(self):
        self.assertEqual(self.post("import-a", LAUF_JS).status_code, 201)
        r = self.post("import-a", LAUF_JS)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["meta"]["duplicate"])
        self.assertEqual(self.session.query(Workout).count(), 1)

    def test_json_import_und_browser_import_erkennen_sich(self):
        self.assertEqual(import_workouts(self.session, self.a, [LAUF_PY, LAUF_PY], "import"), (1, 1))
        self.assertTrue(self.post("import-a", LAUF_JS).get_json()["meta"]["duplicate"])
        self.assertEqual(import_workouts(self.session, self.a, [LAUF_JS], "import"), (0, 1))
        self.assertEqual(self.session.query(Workout).count(), 1)
        self.assertEqual(self.session.query(Workout).one().fit_data["stream"], {"t": [0, 1]})

    def test_andere_person_andere_startzeit_andere_sportart_sind_neu(self):
        import_workouts(self.session, self.a, [LAUF_PY], "import")
        self.assertEqual(self.post("import-b", LAUF_JS).status_code, 201)  # gleiche Einheit, andere Person
        spaeter = {**LAUF_PY, "date": "2026-10-01T17:00:00+00:00"}
        rad = {**LAUF_PY, "sport": "Rad", "sport_raw": "cycling"}
        self.assertEqual(import_workouts(self.session, self.a, [spaeter, rad], "import"), (2, 0))

    def test_browser_export_in_ablage(self):
        export = {"triathlon_dashboard_goals_v1": '[{"id": "g1"}]',
                  "triathlon_dashboard_claude_settings_v1": '{"apiKey": "geheim"}',  # bleibt draussen
                  "triathlon_dashboard_athlete_profile_v1": "kaputt{"}
        self.assertEqual(import_store(self.session, self.a, export, False), (["triathlon_dashboard_goals_v1"], []))
        export["triathlon_dashboard_goals_v1"] = '[{"id": "g2"}]'
        self.assertEqual(import_store(self.session, self.a, export, False), ([], ["triathlon_dashboard_goals_v1"]))
        import_store(self.session, self.a, export, True)
        self.assertEqual(self.session.query(AthleteStore).filter_by(athlete_id=self.a).one().value, [{"id": "g2"}])
        self.assertEqual(self.session.query(AthleteStore).filter_by(athlete_id=self.b).count(), 0)


if __name__ == "__main__":
    unittest.main()
