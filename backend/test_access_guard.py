"""Schalter "Nur ueber Tailscale" (backend/access_guard.py): Heimnetz-Geraete
werden abgewiesen, Tailscale, der Rechner selbst und "tailscale serve/funnel"
kommen durch; der Betreiber kann sich nicht aussperren.

Aufruf im Projektordner:  python -m unittest backend.test_access_guard -v
"""
import os
import shutil
import tempfile
import unittest
from unittest import mock

from backend import access_guard, auth, create_app
from backend.config import config

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"
PASSWORD = "richtig-langes-passwort"

LAN = {"REMOTE_ADDR": "192.168.1.20"}
TAILNET = {"REMOTE_ADDR": "100.101.102.103"}
TAILNET6 = {"REMOTE_ADDR": "fd7a:115c:a1e0::1234"}
LOCAL = {"REMOTE_ADDR": "127.0.0.1"}


class TailscaleOnlyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, session_factory = create_app()
        session = session_factory()
        auth.create_login(session, "betreiber", PASSWORD)  # erster Benutzer = Betreiber
        auth.create_login(session, "freund", PASSWORD)
        session.close()

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.patches = [mock.patch.object(access_guard, "KEY_DIR", self.dir),
                        mock.patch.object(access_guard, "_cache", None),
                        mock.patch.dict(os.environ, {"NUR_TAILSCALE": ""})]
        for p in self.patches:
            p.start()
        self.client = self.app.test_client()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def headers(self, name, env):
        r = self.client.post("/api/v1/auth/login", json={"username": name, "password": PASSWORD}, environ_base=env)
        return {"Authorization": f"Bearer {r.get_json()['data']['token']}"}

    def put(self, value, env, name="betreiber"):
        return self.client.put("/api/v1/admin/access", json={"tailscale_only": value},
                               headers=self.headers(name, env), environ_base=env)

    def test_ohne_schalter_kommt_jeder_durch(self):
        self.assertEqual(self.client.get("/api/v1/health", environ_base=LAN).status_code, 200)
        self.assertEqual(self.client.get("/", environ_base=LAN).status_code, 200)

    def test_mit_schalter_nur_tailscale_und_der_rechner_selbst(self):
        self.assertEqual(self.put(True, TAILNET).status_code, 200)
        self.assertEqual(self.client.get("/", environ_base=LAN).status_code, 403)
        self.assertIn("nur über Tailscale", self.client.get("/login.html", environ_base=LAN).get_data(as_text=True))
        r = self.client.post("/api/v1/auth/login", json={"username": "freund", "password": PASSWORD}, environ_base=LAN)
        self.assertEqual((r.status_code, r.get_json()["code"]), (403, "tailscale_only"))  # Passwort gar nicht erst geprueft
        for env in (TAILNET, TAILNET6, LOCAL, {"REMOTE_ADDR": "::ffff:100.80.1.2"}):
            self.assertEqual(self.client.get("/api/v1/health", environ_base=env).status_code, 200, env)
        # https-Adresse ueber "tailscale serve/funnel": Besucher-Adresse steht in X-Forwarded-For
        r = self.client.get("/api/v1/health", environ_base={"REMOTE_ADDR": "203.0.113.9"},
                            headers={"X-Forwarded-For": "203.0.113.9", "X-Forwarded-Proto": "https"})
        self.assertEqual(r.status_code, 200)
        # bleibt nach einem Neustart an (Datei, nur fuer den Besitzer lesbar)
        access_guard._cache = None
        self.assertTrue(access_guard.tailscale_only())
        self.assertEqual(os.stat(os.path.join(self.dir, "zugriff.json")).st_mode & 0o777, 0o600)

    def test_nicht_aussperren_und_nur_der_betreiber(self):
        r = self.put(True, LAN)
        self.assertEqual((r.status_code, r.get_json()["code"]), (409, "would_lock_out"))
        self.assertFalse(access_guard.tailscale_only())
        self.assertEqual(self.put(True, TAILNET, name="freund").status_code, 403)
        st = self.client.get("/api/v1/admin/access", headers=self.headers("betreiber", LAN), environ_base=LAN).get_json()["data"]
        self.assertEqual(st, {"tailscale_only": False, "forced": False, "this_device_ok": False})

    def test_notausgang_in_der_env_datei(self):
        self.put(True, TAILNET)
        with mock.patch.dict(os.environ, {"NUR_TAILSCALE": "0"}):
            self.assertEqual(self.client.get("/", environ_base=LAN).status_code, 200)
            r = self.put(False, LAN)
            self.assertEqual(r.get_json()["code"], "forced_by_env")
        with mock.patch.dict(os.environ, {"NUR_TAILSCALE": "1"}):
            access_guard.save(False)
            self.assertEqual(self.client.get("/", environ_base=LAN).status_code, 403)


if __name__ == "__main__":
    unittest.main()
