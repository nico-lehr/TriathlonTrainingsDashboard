"""Konto selbst erstellen (nur mit Einladungscode) und "Angemeldet bleiben".

Aufruf im Projektordner:  python -m unittest backend.test_register -v
Laeuft gegen eine Datenbank im Arbeitsspeicher; der Einladungscode liegt in
einem Testordner, nie in ~/.triathlon.
"""
import os
import shutil
import stat
import tempfile
import time
import unittest
from unittest import mock

from itsdangerous.timed import TimestampSigner

from backend import auth, create_app, invites, routes
from backend.config import config
from backend.models import Athlete, AthleteLogin, AthleteStore

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"
app, _ = create_app()
PASSWORD = "richtig-langes-passwort"


def ensure_admin():
    """Betreiber-Konto in der Datenbank, die die Endpunkte gerade benutzen
    (mehrere Testdateien rufen create_app() auf). Betreiber per ADMIN_USERS."""
    session = routes.get_session()
    try:
        login = session.query(AthleteLogin).filter_by(username="betreiber").first()
        return login.athlete_id if login else auth.create_login(session, "betreiber", PASSWORD)
    finally:
        session.close()


ADMIN_ENV = mock.patch.dict(os.environ, {"ADMIN_USERS": "betreiber"})


class RegisterTest(unittest.TestCase):
    def setUp(self):
        ADMIN_ENV.start()
        self.addCleanup(ADMIN_ENV.stop)
        global ADMIN_ID
        ADMIN_ID = ensure_admin()
        self.dir = tempfile.mkdtemp()
        self.patch = mock.patch.object(invites, "KEY_DIR", self.dir)
        self.patch.start()
        auth._failed_logins.clear()
        auth._failed_users.clear()
        auth._registrations.clear()
        self.client = app.test_client()
        with app.app_context():
            self.admin = {"Authorization": "Bearer " + auth.make_token(ADMIN_ID)}

    def tearDown(self):
        self.patch.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def register(self, username, code, password=PASSWORD, ip="203.0.113.1", **extra):
        return self.client.post("/api/v1/auth/register", json={"username": username, "password": password, "code": code, **extra},
                                environ_base={"REMOTE_ADDR": ip})

    def open_invites(self):
        return self.client.put("/api/v1/invites", headers=self.admin, json={"enabled": True}).get_json()["data"]["code"]

    def test_standard_zu(self):
        self.assertFalse(self.client.get("/api/v1/auth/register").get_json()["data"]["open"])
        r = self.register("fremder", "ABCD-EFGH")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.get_json()["code"], "registration_closed")

    def test_mit_code_eigenes_leeres_konto_und_sofort_angemeldet(self):
        code = self.open_invites()
        self.assertRegex(code, r"^[A-Z2-9]{4}-[A-Z2-9]{4}$")
        self.assertTrue(self.client.get("/api/v1/auth/register").get_json()["data"]["open"])
        r = self.register("Lena.M", code.lower().replace("-", " "))  # Kleinschreibung/Leerzeichen egal
        self.assertEqual(r.status_code, 201, r.get_json())
        token = r.get_json()["data"]["token"]
        me = self.client.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + token}).get_json()["data"]
        self.assertEqual(me["username"], "lena.m")
        with app.app_context():
            self.assertNotEqual(auth.athlete_id_from_token(token), ADMIN_ID)
        # Anmelden geht danach ganz normal.
        self.assertEqual(self.client.post("/api/v1/auth/login", json={"username": "lena.m", "password": PASSWORD}).status_code, 200)

    def test_falscher_code_und_bremse(self):
        self.open_invites()
        for _ in range(5):
            self.assertEqual(self.register("rater", "AAAA-AAAA", ip="198.51.100.9").status_code, 403)
        self.assertEqual(self.register("rater", "AAAA-AAAA", ip="198.51.100.9").status_code, 429)

    def test_neuer_code_macht_alten_ungueltig_und_aus_heisst_aus(self):
        old = self.open_invites()
        new = self.client.post("/api/v1/invites/renew", headers=self.admin).get_json()["data"]["code"]
        self.assertNotEqual(old, new)
        self.assertEqual(self.register("alt", old).status_code, 403)
        self.assertEqual(self.register("neu", new).status_code, 201)
        self.client.put("/api/v1/invites", headers=self.admin, json={"enabled": False})
        self.assertEqual(self.register("spaeter", new).status_code, 403)
        mode = stat.S_IMODE(os.stat(os.path.join(self.dir, "invite.json")).st_mode)
        self.assertEqual(mode, 0o600)

    def test_regeln_fuer_name_und_passwort(self):
        code = self.open_invites()
        self.assertEqual(self.register("a", code).status_code, 400)
        self.assertEqual(self.register("mit leerzeichen", code).status_code, 400)
        self.assertEqual(self.register("<script>", code).status_code, 400)
        self.assertEqual(self.register("kurzpw", code, password="kurz").status_code, 400)
        self.assertEqual(self.register("betreiber", code).status_code, 400)  # gibt es schon

    def test_hoechstens_5_konten_je_adresse_und_stunde(self):
        code = self.open_invites()
        for i in range(5):
            self.assertEqual(self.register(f"massen{i}", code, ip="192.0.2.77").status_code, 201)
        self.assertEqual(self.register("massen5", code, ip="192.0.2.77").status_code, 429)

    def test_hoechstzahl_konten(self):
        code = self.open_invites()
        with mock.patch.object(invites, "MAX_ACCOUNTS", 0):
            self.assertEqual(self.register("zuviel", code).status_code, 409)

    def test_registrierung_uebernimmt_nie_fremde_altdaten(self):
        # Ein alter Einzelplatz-Athlet ohne Login mit Daten ...
        session = routes.get_session()
        try:
            session.add(Athlete(athlete_id=999, name="alt"))
            session.add(AthleteStore(athlete_id=999, key="geheim", value="{}"))
            session.commit()
        finally:
            session.close()
        code = self.open_invites()
        r = self.register("neugierig", code)
        token = r.get_json()["data"]["token"]
        with app.app_context():
            self.assertNotEqual(auth.athlete_id_from_token(token), 999)
        # Die Ablage des neuen Kontos ist leer - nichts vom alten Athleten.
        store = self.client.get("/api/v1/store", headers={"Authorization": "Bearer " + token}).get_json()["data"]
        self.assertNotIn("geheim", store)

    def test_nur_betreiber_verwaltet_einladungen(self):
        code = self.open_invites()
        r = self.register("freundin", code)
        friend = {"Authorization": "Bearer " + r.get_json()["data"]["token"]}
        self.assertEqual(self.client.get("/api/v1/invites", headers=friend).get_json()["data"], {"admin": False})
        self.assertEqual(self.client.put("/api/v1/invites", headers=friend, json={"enabled": False}).status_code, 403)
        self.assertEqual(self.client.post("/api/v1/invites/renew", headers=friend).status_code, 403)
        st = self.client.get("/api/v1/invites", headers=self.admin).get_json()["data"]
        self.assertIn("freundin", [a["username"] for a in st["accounts"]])


class UpdateSettingsTest(unittest.TestCase):
    def setUp(self):
        ADMIN_ENV.start()
        self.addCleanup(ADMIN_ENV.stop)
        self.dir = tempfile.mkdtemp()
        p = mock.patch("backend.updater.SETTINGS_DIR", self.dir)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.client = app.test_client()
        with app.app_context():
            self.admin = {"Authorization": "Bearer " + auth.make_token(ensure_admin())}
            session = routes.get_session()
            try:
                login = session.query(AthleteLogin).filter_by(username="nur-freund").first()
                fid = login.athlete_id if login else auth.create_login(session, "nur-freund", PASSWORD)
            finally:
                session.close()
            self.friend = {"Authorization": "Bearer " + auth.make_token(fid)}

    def test_nur_betreiber_schaltet_automatik(self):
        self.assertEqual(self.client.put("/api/v1/update/settings", headers=self.friend, json={"auto_install": True}).status_code, 403)
        r = self.client.put("/api/v1/update/settings", headers=self.admin, json={"auto_install": True})
        self.assertTrue(r.get_json()["data"]["auto_install"])
        self.assertEqual(self.client.put("/api/v1/update/settings", headers=self.admin, json={"auto_install": "ja"}).status_code, 400)


class RememberTest(unittest.TestCase):
    def setUp(self):
        global ADMIN_ID
        ADMIN_ID = ensure_admin()
        auth._failed_logins.clear()
        auth._failed_users.clear()
        self.client = app.test_client()

    def token_from(self, seconds_ago, remember):
        with app.app_context(), mock.patch.object(TimestampSigner, "get_timestamp", return_value=int(time.time()) - seconds_ago):
            return auth.make_token(ADMIN_ID, remember=remember)

    def me(self, token):
        return self.client.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + token})

    def test_login_merkt_sich_die_wahl(self):
        r = self.client.post("/api/v1/auth/login", json={"username": "betreiber", "password": PASSWORD, "remember": False})
        with app.app_context():
            self.assertFalse(auth.token_info(r.get_json()["data"]["token"])[1])
        r = self.client.post("/api/v1/auth/login", json={"username": "betreiber", "password": PASSWORD})
        with app.app_context():
            self.assertTrue(auth.token_info(r.get_json()["data"]["token"])[1])

    def test_angemeldet_bleiben_wird_bei_benutzung_erneuert(self):
        r = self.me(self.token_from(60, True))
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("X-Renewed-Token", r.headers)  # frisch: nichts zu tun
        old = self.token_from(80 * 24 * 3600, True)  # 80 Tage alt, noch gueltig
        r = self.me(old)
        self.assertEqual(r.status_code, 200)
        fresh = r.headers["X-Renewed-Token"]
        with app.app_context():
            self.assertLess(auth.token_info(fresh)[2], 5)
        self.assertEqual(self.me(fresh).status_code, 200)

    def test_nach_90_tagen_ohne_besuch_abgemeldet(self):
        self.assertEqual(self.me(self.token_from(91 * 24 * 3600, True)).status_code, 401)

    def test_ohne_haken_hoechstens_ein_tag_und_keine_erneuerung(self):
        r = self.me(self.token_from(3600, False))
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("X-Renewed-Token", r.headers)
        self.assertEqual(self.me(self.token_from(25 * 3600, False)).status_code, 401)

    def test_alte_token_ohne_wahl_gelten_weiter(self):
        with app.app_context(), mock.patch.object(TimestampSigner, "get_timestamp", return_value=int(time.time()) - 10 * 24 * 3600):
            legacy = auth._serializer().dumps({"athlete_id": ADMIN_ID})
        r = self.me(legacy)
        self.assertEqual(r.status_code, 200)
        self.assertIn("X-Renewed-Token", r.headers)

    def test_fehler_antworten_bekommen_keinen_neuen_token(self):
        r = self.client.get("/api/v1/invites/gibts-nicht", headers={"Authorization": "Bearer " + self.token_from(3 * 24 * 3600, True)})
        self.assertNotIn("X-Renewed-Token", r.headers)


if __name__ == "__main__":
    unittest.main()
