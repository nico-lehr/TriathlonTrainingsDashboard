"""Login + Datentrennung zwischen Benutzern.

Aufruf im Projektordner:  python -m unittest backend.test_auth -v
Laeuft gegen eine Datenbank im Arbeitsspeicher - training.db bleibt unberuehrt.
"""
import unittest

from itsdangerous import URLSafeTimedSerializer

from backend import auth, create_app
from backend.config import config
from backend.models import AthleteLogin

# Hier setzen statt per Umgebungsvariable: config ist beim Laden dieser Datei
# schon fertig eingelesen (das Paket backend wird zuerst importiert).
config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"

app, session_factory = create_app()
PASSWORD = "richtig-langes-passwort"


def make_user(name):
    session = session_factory()
    try:
        return auth.create_login(session, name, PASSWORD)
    finally:
        session.close()


class AuthTest(unittest.TestCase):
    def setUp(self):
        auth._failed_logins.clear()
        self.client = app.test_client()

    def login(self, username, password=PASSWORD):
        return self.client.post("/api/v1/auth/login", json={"username": username, "password": password})

    def headers(self, username):
        token = self.login(username).get_json()["data"]["token"]
        return {"Authorization": f"Bearer {token}"}

    def test_health_ohne_login(self):
        self.assertEqual(self.client.get("/api/v1/health").status_code, 200)

    def test_ohne_token_401(self):
        for method, url in [
            ("get", "/api/v1/auth/me"), ("get", "/api/v1/athlete"), ("put", "/api/v1/athlete"),
            ("get", "/api/v1/workouts"), ("post", "/api/v1/workouts"),
            ("get", "/api/v1/wellness"), ("post", "/api/v1/wellness"),
            ("get", "/api/v1/planned-workouts"), ("post", "/api/v1/planned-workouts"),
            ("get", "/api/v1/recovery-checks"), ("post", "/api/v1/recovery-checks"),
            ("get", "/api/v1/goals"), ("post", "/api/v1/goals"),
            ("post", "/api/v1/ical-sync"), ("get", "/api/v1/ical/1.ics"),
        ]:
            with self.subTest(url=url, method=method):
                self.assertEqual(getattr(self.client, method)(url, json={}).status_code, 401)

    def test_falscher_oder_fremd_signierter_token_401(self):
        make_user("tokentest")
        fremd = URLSafeTimedSerializer("anderer-schluessel", salt="login-token").dumps({"athlete_id": 1})
        for token in ["kaputt", fremd]:
            r = self.client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
            self.assertEqual(r.status_code, 401)

    def test_login_und_me(self):
        athlete_id = make_user("Anna")
        self.assertEqual(self.login("anna", "falsches-passwort").status_code, 401)
        self.assertEqual(self.login("gibtsnicht").status_code, 401)
        r = self.client.get("/api/v1/auth/me", headers=self.headers("  ANNA "))  # Gross/klein egal
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["data"]["username"], "anna")
        with app.app_context():
            token = self.headers("anna")["Authorization"][len("Bearer "):]
            self.assertEqual(auth.athlete_id_from_token(token), athlete_id)

    def test_passwort_nur_als_hash(self):
        make_user("hashtest")
        session = session_factory()
        try:
            stored = session.query(AthleteLogin).filter_by(username="hashtest").one().password_hash
        finally:
            session.close()
        self.assertNotIn(PASSWORD, stored)

    def test_create_login_regeln(self):
        session = session_factory()
        try:
            with self.assertRaises(ValueError):
                auth.create_login(session, "kurz", "123456789")  # 9 Zeichen
            auth.create_login(session, "doppelt", PASSWORD)
            with self.assertRaises(ValueError):
                auth.create_login(session, "Doppelt", PASSWORD)
        finally:
            session.close()

    def test_bremse_nach_5_fehlversuchen(self):
        make_user("bremse")
        for _ in range(5):
            self.assertEqual(self.login("bremse", "falsch-falsch").status_code, 401)
        # Der 6. Versuch wird abgewiesen - selbst mit richtigem Passwort.
        self.assertEqual(self.login("bremse").status_code, 429)

    def test_user_b_sieht_nichts_von_user_a(self):
        a_id = make_user("user-a")
        make_user("user-b")
        a, b = self.headers("user-a"), self.headers("user-b")

        writes = [
            ("/api/v1/workouts", {"date": "2026-10-01", "sport": "running", "duration_min": 45}),
            ("/api/v1/wellness", {"date": "2026-10-01", "hrv_ms": 60}),
            ("/api/v1/recovery-checks", {"date": "2026-10-01", "energy_level": 4}),
            ("/api/v1/goals", {"name": "Ironman A", "start_date": "2026-10-01"}),
        ]
        for url, body in writes:
            self.assertEqual(self.client.post(url, json=body, headers=a).status_code, 201, url)
        goal_id = self.client.get("/api/v1/goals", headers=a).get_json()["data"][0]["id"]
        r = self.client.post("/api/v1/planned-workouts", json={"date": "2026-10-02", "goal_id": goal_id}, headers=a)
        self.assertEqual(r.status_code, 201)
        self.client.post("/api/v1/ical-sync", headers=a,
                         json={"workouts": [{"id": "a-1", "date": "2026-10-02", "title": "Geheim", "status": "geplant"}]})

        lists = ["/api/v1/workouts", "/api/v1/wellness", "/api/v1/recovery-checks",
                 "/api/v1/goals", "/api/v1/planned-workouts"]
        for url in lists:
            with self.subTest(url=url):
                self.assertEqual(len(self.client.get(url, headers=a).get_json()["data"]), 1)  # A sieht seins
                self.assertEqual(self.client.get(url, headers=b).get_json()["data"], [])      # B sieht nichts

        self.assertNotEqual(self.client.get("/api/v1/athlete", headers=b).get_json()["data"]["id"],
                            self.client.get("/api/v1/athlete", headers=a).get_json()["data"]["id"])
        self.assertIn(b"Geheim", self.client.get(f"/api/v1/ical/{a_id}.ics", headers=a).data)
        self.assertEqual(self.client.get(f"/api/v1/ical/{a_id}.ics", headers=b).status_code, 404)
        # B darf keinen Plan an das Ziel von A haengen.
        r = self.client.post("/api/v1/planned-workouts", json={"date": "2026-10-02", "goal_id": goal_id}, headers=b)
        self.assertEqual(r.status_code, 404)

    def test_start_ohne_secret_key_verweigert(self):
        original = config.SECRET_KEY
        config.SECRET_KEY = ""
        try:
            with self.assertRaises(RuntimeError):
                create_app()
        finally:
            config.SECRET_KEY = original


if __name__ == "__main__":
    unittest.main()
