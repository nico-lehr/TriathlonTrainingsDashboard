"""Login + Datentrennung zwischen Benutzern.

Aufruf im Projektordner:  python -m unittest backend.test_auth -v
Laeuft gegen eine Datenbank im Arbeitsspeicher - training.db bleibt unberuehrt.
"""
import unittest
from unittest import mock

from itsdangerous import URLSafeTimedSerializer

from backend import auth, create_app
from backend.config import config
from backend.models import AthleteLogin

# Hier setzen statt per Umgebungsvariable: config ist beim Laden dieser Datei
# schon fertig eingelesen (das Paket backend wird zuerst importiert).
config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"

app = session_factory = None
PASSWORD = "richtig-langes-passwort"


def setUpModule():
    # Erst hier statt beim Import: laufen mehrere Testdateien zusammen, bekommt
    # so jede ihre eigene frische Datenbank direkt vor ihren Tests.
    global app, session_factory
    app, session_factory = create_app()


def make_user(name):
    session = session_factory()
    try:
        return auth.create_login(session, name, PASSWORD)
    finally:
        session.close()


class AuthTest(unittest.TestCase):
    def setUp(self):
        auth._failed_logins.clear()
        auth._failed_users.clear()
        self.client = app.test_client()

    def login(self, username, password=PASSWORD):
        return self.client.post("/api/v1/auth/login", json={"username": username, "password": password})

    def headers(self, username):
        token = self.login(username).get_json()["data"]["token"]
        return {"Authorization": f"Bearer {token}"}

    def test_api_bremse_je_person(self):
        make_user("vielfrager")
        make_user("ruhig")
        busy, calm = self.headers("vielfrager"), self.headers("ruhig")
        now = [1000.0]
        with mock.patch.dict(app.config, {"API_RATE_PER_MINUTE": 5}), \
                mock.patch.object(auth.time, "monotonic", lambda: now[0]):
            app.extensions["api_hits"].clear()
            for _ in range(5):
                self.assertEqual(self.client.get("/api/v1/auth/me", headers=busy).status_code, 200)
            now[0] += 20
            r = self.client.get("/api/v1/auth/me", headers=busy)
            self.assertEqual(r.status_code, 429)
            self.assertEqual(r.get_json()["code"], "rate_limited")
            self.assertEqual(r.headers["Retry-After"], "40")  # die erste Anfrage faellt nach 60 s heraus
            # andere Personen merken davon nichts, der Login auch nicht
            self.assertEqual(self.client.get("/api/v1/auth/me", headers=calm).status_code, 200)
            self.assertEqual(self.login("vielfrager").status_code, 200)
            now[0] += 41
            self.assertEqual(self.client.get("/api/v1/auth/me", headers=busy).status_code, 200)
        with mock.patch.dict(app.config, {"API_RATE_PER_MINUTE": 0}):  # 0 = aus
            for _ in range(20):
                self.assertEqual(self.client.get("/api/v1/auth/me", headers=busy).status_code, 200)

    def test_ueberall_abmelden_beendet_alle_anmeldungen(self):
        athlete_id = make_user("handy-weg")
        make_user("unbeteiligt")
        handy, laptop, other = self.headers("handy-weg"), self.headers("handy-weg"), self.headers("unbeteiligt")
        self.assertEqual(self.client.get("/api/v1/auth/me", headers=handy).status_code, 200)
        self.assertEqual(self.client.post("/api/v1/auth/logout-all", headers=laptop).status_code, 200)
        for h in (handy, laptop):  # beide Geraete sind abgemeldet
            r = self.client.get("/api/v1/auth/me", headers=h)
            self.assertEqual((r.status_code, r.get_json()["code"]), (401, "unauthorized"))
        # Kalender-Feed nimmt den alten Token auch nicht mehr
        self.assertEqual(self.client.get(f"/api/v1/ical/{athlete_id}.ics", headers=handy).status_code, 404)
        # Andere Personen bleiben angemeldet, neu anmelden klappt
        self.assertEqual(self.client.get("/api/v1/auth/me", headers=other).status_code, 200)
        self.assertEqual(self.client.get("/api/v1/auth/me", headers=self.headers("handy-weg")).status_code, 200)

    def test_erneuerter_token_behaelt_den_stand(self):
        from itsdangerous import TimestampSigner
        athlete_id = make_user("lange-dabei")
        session = session_factory()
        auth.end_all_logins(session, athlete_id)
        session.commit()
        session.close()
        vor_2_tagen = int(__import__("time").time()) - 2 * 24 * 3600
        with app.app_context(), mock.patch.object(TimestampSigner, "get_timestamp", return_value=vor_2_tagen):
            alt = auth.make_token(athlete_id, version=1)
        r = self.client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {alt}"})
        self.assertEqual(r.status_code, 200)
        renewed = r.headers["X-Renewed-Token"]
        with app.app_context():
            self.assertEqual(auth.token_info(renewed)[3], 1)
        self.assertEqual(self.client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {renewed}"}).status_code, 200)

    def test_neues_passwort_meldet_alte_geraete_ab(self):
        make_user("passwort-neu")
        old = self.headers("passwort-neu")
        session = session_factory()
        auth.reset_password(session, "passwort-neu", "ganz-neues-passwort")
        session.close()
        self.assertEqual(self.client.get("/api/v1/auth/me", headers=old).status_code, 401)
        r = self.login("passwort-neu", "ganz-neues-passwort")
        self.assertEqual(r.status_code, 200)

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
            ("post", "/api/v1/ical-sync"), ("get", "/api/v1/ical-link"),
            ("get", "/api/v1/store"), ("put", "/api/v1/store/triathlon_dashboard_goals_v1"),
            ("get", "/api/v1/workouts/full"), ("get", "/api/v1/wellness/daily"),
        ]:
            with self.subTest(url=url, method=method):
                self.assertEqual(getattr(self.client, method)(url, json={}).status_code, 401)
        # Der Kalender-Feed prueft selbst (Token oder geheimer Schluessel) und
        # verraet ohne beides nicht einmal, ob es den Athleten gibt.
        self.assertEqual(self.client.get("/api/v1/ical/1.ics").status_code, 404)

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

    def test_vorhandene_daten_gehen_an_den_ersten_benutzer(self):
        # Ein Athlet ohne Login mit Daten (z. B. nach dem Import) faellt dem
        # naechsten neuen Benutzer zu - unclaimed_data_count() macht das sichtbar,
        # damit create_user.py vorher nachfragen kann.
        from datetime import date
        from backend.models import Athlete, AthleteStore, Workout
        session = session_factory()
        try:
            athlete = Athlete(athlete_id=9001, name="Altbestand")
            session.add(athlete)
            session.flush()
            session.add(Workout(athlete_id=9001, date=date(2026, 1, 2), sport="Laufen", duration_min=30))
            session.commit()
            self.assertEqual(auth.unclaimed_athlete(session).athlete_id, 9001)
            self.assertEqual(auth.unclaimed_data_count(session), 1)
            # Auch Ablage-Eintraege (Plan, Ziele ...) zaehlen, nicht nur Trainings.
            session.add(AthleteStore(athlete_id=9001, key="triathlon_dashboard_goals_v1", value=[]))
            session.commit()
            self.assertEqual(auth.unclaimed_data_count(session), 2)
            new_id = auth.create_login(session, "erbe", PASSWORD)
            self.assertEqual(new_id, 9001)
            self.assertEqual(auth.unclaimed_data_count(session), 0)
        finally:
            session.close()

    def test_unbekannter_name_wird_genauso_geprueft(self):
        # Kein Hinweis aus der Antwortzeit auf vorhandene Benutzernamen:
        # auch ohne Treffer wird ein Hash berechnet.
        session = session_factory()
        try:
            with mock.patch.object(auth, "check_password_hash", wraps=auth.check_password_hash) as check:
                self.assertIsNone(auth.check_login(session, "gibts-nicht", "irgendwas-langes"))
            check.assert_called_once_with(auth._dummy_hash, "irgendwas-langes")
        finally:
            session.close()

    def test_passwort_zuruecksetzen(self):
        make_user("vergesslich")
        session = session_factory()
        try:
            with self.assertRaises(ValueError):
                auth.reset_password(session, "gibtsnicht", "neues-passwort-1")
            with self.assertRaises(ValueError):
                auth.reset_password(session, "vergesslich", "kurz")
            auth.reset_password(session, "Vergesslich", "neues-passwort-1")
        finally:
            session.close()
        self.assertEqual(self.login("vergesslich").status_code, 401)
        self.assertEqual(self.login("vergesslich", "neues-passwort-1").status_code, 200)

    def test_bremse_nach_5_fehlversuchen(self):
        make_user("bremse")
        for _ in range(5):
            self.assertEqual(self.login("bremse", "falsch-falsch").status_code, 401)
        # Der 6. Versuch wird abgewiesen - selbst mit richtigem Passwort.
        self.assertEqual(self.login("bremse").status_code, 429)

    def via_proxy(self, username, ip, password="falsch-falsch"):
        # So kommt eine Anfrage ueber Tailscale Funnel an: vom lokalen Proxy,
        # die echte Besucher-Adresse im X-Forwarded-For-Kopf.
        return self.client.post("/api/v1/auth/login", json={"username": username, "password": password},
                                headers={"X-Forwarded-For": ip, "X-Forwarded-Proto": "https"},
                                environ_base={"REMOTE_ADDR": "127.0.0.1"})

    def test_hinter_oeffentlicher_adresse_zaehlt_die_echte_besucher_adresse(self):
        make_user("proxy-a")
        make_user("proxy-b")
        for _ in range(5):
            self.assertEqual(self.via_proxy("proxy-a", "203.0.113.7").status_code, 401)
        self.assertEqual(self.via_proxy("proxy-a", "203.0.113.7", PASSWORD).status_code, 429)
        # Eine andere Person ueber denselben Proxy ist davon nicht betroffen.
        self.assertEqual(self.via_proxy("proxy-b", "198.51.100.4", PASSWORD).status_code, 200)

    def test_gefaelschter_weiterleitungs_kopf_hilft_nicht(self):
        make_user("faelscher")
        for i in range(5):
            r = self.client.post("/api/v1/auth/login", json={"username": "faelscher", "password": "falsch-falsch"},
                                 headers={"X-Forwarded-For": f"10.0.0.{i}"}, environ_base={"REMOTE_ADDR": "192.168.1.50"})
            self.assertEqual(r.status_code, 401)
        r = self.client.post("/api/v1/auth/login", json={"username": "faelscher", "password": PASSWORD},
                             headers={"X-Forwarded-For": "10.0.0.99"}, environ_base={"REMOTE_ADDR": "192.168.1.50"})
        self.assertEqual(r.status_code, 429)

    def test_konto_sperre_auch_bei_wechselnden_adressen(self):
        make_user("ziel")
        for i in range(10):
            self.assertEqual(self.via_proxy("ziel", f"203.0.113.{i}").status_code, 401)
        self.assertEqual(self.via_proxy("Ziel", "198.51.100.200", PASSWORD).status_code, 429)
        # Andere Konten bleiben erreichbar.
        make_user("andere")
        self.assertEqual(self.via_proxy("andere", "198.51.100.200", PASSWORD).status_code, 200)

    def test_schutz_kopfzeilen(self):
        r = self.client.get("/api/v1/health")
        self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(r.headers["X-Frame-Options"], "DENY")
        self.assertNotIn("Strict-Transport-Security", r.headers)  # im Heimnetz ohne HTTPS
        r = self.client.get("/api/v1/health", headers={"X-Forwarded-Proto": "https"}, environ_base={"REMOTE_ADDR": "127.0.0.1"})
        self.assertIn("Strict-Transport-Security", r.headers)
        # Content-Security-Policy: nur Skripte und Verbindungen von hier, auch fuer die Webseite
        for url in ("/api/v1/health", "/", "/login.html"):
            csp = self.client.get(url).headers["Content-Security-Policy"]
            self.assertIn("script-src 'self';", csp, url)
            self.assertIn("connect-src 'self';", csp, url)
            self.assertIn("frame-ancestors 'none'", csp, url)

    def test_seiten_ohne_eingebettete_skripte(self):
        # Sonst blockiert die Content-Security-Policy sie (script-src 'self').
        import re
        from pathlib import Path
        for name in ("index.html", "login.html"):
            html = (Path(__file__).parent.parent / name).read_text(encoding="utf-8")
            self.assertEqual(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html), [], name)
            self.assertIsNone(re.search(r"\son[a-z]+=\"", html), name)

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

        r = self.client.put("/api/v1/store/triathlon_dashboard_goals_v1", headers=a,
                            json={"value": [{"id": "g1", "name": "Geheimes Ziel"}]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get("/api/v1/store", headers=a).get_json()["data"],
                         {"triathlon_dashboard_goals_v1": [{"id": "g1", "name": "Geheimes Ziel"}]})
        self.assertEqual(self.client.get("/api/v1/store", headers=b).get_json()["data"], {})
        self.assertNotEqual(self.client.put("/api/v1/store/../x", headers=a, json={"value": 1}).status_code, 200)
        self.assertEqual(self.client.put("/api/v1/store/GROSS", headers=a, json={"value": 1}).status_code, 400)

        lists = ["/api/v1/workouts", "/api/v1/wellness", "/api/v1/recovery-checks",
                 "/api/v1/goals", "/api/v1/planned-workouts", "/api/v1/workouts/full"]
        for url in lists:
            with self.subTest(url=url):
                self.assertEqual(len(self.client.get(url, headers=a).get_json()["data"]), 1)  # A sieht seins
                self.assertEqual(self.client.get(url, headers=b).get_json()["data"], [])      # B sieht nichts

        self.assertNotEqual(self.client.get("/api/v1/athlete", headers=b).get_json()["data"]["id"],
                            self.client.get("/api/v1/athlete", headers=a).get_json()["data"]["id"])
        self.assertEqual(len(self.client.get("/api/v1/wellness/daily", headers=a).get_json()["data"]["daily"]), 1)
        self.assertEqual(self.client.get("/api/v1/wellness/daily", headers=b).get_json()["data"]["daily"], {})

        self.assertIn(b"Geheim", self.client.get(f"/api/v1/ical/{a_id}.ics", headers=a).data)
        self.assertEqual(self.client.get(f"/api/v1/ical/{a_id}.ics", headers=b).status_code, 404)
        # Kalender-Apps: geheimer Link ohne Login funktioniert - aber nur der eigene.
        link_a = self.client.get("/api/v1/ical-link", headers=a).get_json()["data"]["path"]
        link_b = self.client.get("/api/v1/ical-link", headers=b).get_json()["data"]["path"]
        self.assertIn(b"Geheim", self.client.get("/" + link_a).data)
        self.assertEqual(self.client.get(f"/api/v1/ical/{a_id}.ics?key=geraten").status_code, 404)
        self.assertEqual(self.client.get(f"/api/v1/ical/{a_id}.ics?key=" + link_b.split("key=")[1]).status_code, 404)
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
