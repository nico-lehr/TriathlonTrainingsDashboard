"""Morgenbericht + Mitteilungen (backend/morning.py, backend/web_push.py).

Es wird NIE ein echter Push-Dienst angesprochen: der Versand (web_push._post)
ist in jedem Test ersetzt. Aufruf:  python -m unittest backend.test_morning -v
"""
import os
import shutil
import tempfile
import unittest
from datetime import date, datetime, timedelta
from unittest import mock

from backend import auth, create_app, morning, web_push
from backend.config import config
from backend.models import AthleteStore, MorningState, PushSubscription, Wellness

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"
PASSWORD = "langes-passwort-1"
APPLE = "https://web.push.apple.com/QGuS9h"


def device_keys():
    """Schluessel wie von einem echten Browser -> (privat, p256dh, auth)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    key = ec.generate_private_key(ec.SECP256R1())
    pub = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    secret = os.urandom(16)
    return key, web_push.b64url(pub), web_push.b64url(secret)


def decrypt(body, key, auth_b64):
    """Gegenstueck zu web_push.encrypt (so wie es das Geraet macht)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt, idlen = body[:16], body[20]
    as_public = body[21:21 + idlen]
    ua_public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public))
    h = web_push._hmac
    ikm = h(h(web_push.b64url_decode(auth_b64), shared), b"WebPush: info\x00" + ua_public + as_public + b"\x01")
    prk = h(salt, ikm)
    plain = AESGCM(h(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]).decrypt(
        h(prk, b"Content-Encoding: nonce\x00\x01")[:12], body[21 + idlen:], None)
    assert plain.endswith(b"\x02")
    return plain[:-1]


class KeyDirMixin:
    def use_key_dir(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        p = mock.patch.object(web_push, "KEY_DIR", tmp)
        p.start()
        self.addCleanup(p.stop)


@unittest.skipUnless(web_push.available(), "cryptography fehlt")
class WebPushTest(KeyDirMixin, unittest.TestCase):
    def setUp(self):
        self.use_key_dir()

    def test_verschluesselung_kann_das_geraet_lesen(self):
        key, p256dh, auth_b64 = device_keys()
        body = web_push.encrypt({"title": "Guten Morgen", "body": "Schlaf 7:20 · Ü"}, p256dh, auth_b64)
        self.assertIn("Schlaf 7:20 · Ü", decrypt(body, key, auth_b64).decode("utf-8"))

    def test_schluessel_bleibt_und_ist_privat(self):
        first = web_push.public_key()
        self.assertEqual(first, web_push.public_key())
        self.assertEqual(len(web_push.b64url_decode(first)), 65)
        mode = os.stat(os.path.join(web_push.KEY_DIR, web_push.KEY_FILE)).st_mode & 0o777
        self.assertEqual(mode, 0o600)

    def test_nur_bekannte_push_dienste(self):
        ok = [APPLE, "https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x"]
        bad = ["https://evil.example/x", "http://web.push.apple.com/x", "https://web.push.apple.com.evil.example/x",
               "https://web.push.apple.com:8443/x", "https://127.0.0.1/x", None]
        self.assertTrue(all(web_push.allowed_endpoint(e) for e in ok))
        self.assertFalse(any(web_push.allowed_endpoint(e) for e in bad))

    def test_abgemeldetes_geraet(self):
        _, p256dh, auth_b64 = device_keys()
        sub = {"endpoint": APPLE, "p256dh": p256dh, "auth": auth_b64}
        with self.assertRaises(web_push.PushGone):
            web_push.send(sub, {"title": "x"}, post=lambda *a: 410)
        seen = {}
        web_push.send(sub, {"title": "x"}, post=lambda url, body, headers: seen.update(headers) or 201)
        self.assertEqual(seen["Content-Encoding"], "aes128gcm")
        self.assertTrue(seen["Authorization"].startswith("vapid t="))


class MessageTest(unittest.TestCase):
    def n(self, **today):
        return {"today": {"sleep_min": 440, **today}, "base": {"hrv_ms": 60.0, "resting_hr": 48.0, "sleep_min": 430.0}}

    def test_normaler_morgen(self):
        msg = morning.build_message(self.n(hrv_ms=61, resting_hr=47), [{"title": "Lockerer Lauf", "sport": "Laufen", "duration_min": 45}])
        self.assertEqual(msg["body"], "Schlaf 7:20 · HRV 61 ms (normal) · Ruhepuls 47. Heute: Lockerer Lauf · 45 min.")

    def test_wenig_erholung_wird_zuerst_genannt(self):
        msg = morning.build_message(self.n(hrv_ms=50, resting_hr=55), [])
        self.assertTrue(msg["body"].startswith("Deine Uhr meldet wenig Erholung."))
        self.assertIn("HRV 50 ms (niedriger als sonst)", msg["body"])
        self.assertIn("Ruhepuls 55 (erhöht)", msg["body"])
        self.assertIn("Heute ist nichts geplant.", msg["body"])
        hard = [{"title": "6 × 800 m", "sport": "Laufen", "duration_min": 55, "intensity": "hart"}]
        self.assertIn("Geplant: 6 × 800 m · 55 min – dein Coach prüft, ob das heute passt.", morning.build_message(self.n(hrv_ms=50), hard)["body"])
        self.assertIn("Heute: 6 × 800 m · 55 min.", morning.build_message(self.n(hrv_ms=61), hard)["body"])


@unittest.skipUnless(web_push.available(), "cryptography fehlt")
class AblaufTest(KeyDirMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, cls.Session = create_app()
        session = cls.Session()
        cls.aid = auth.create_login(session, "mia", PASSWORD)
        session.close()

    def setUp(self):
        self.use_key_dir()
        self.day = date(2026, 11, 9)
        s = self.Session()
        for model in (Wellness, PushSubscription, MorningState, AthleteStore):
            s.query(model).delete()
        _, p256dh, auth_b64 = device_keys()
        s.add(PushSubscription(athlete_id=self.aid, endpoint=APPLE, p256dh=p256dh, auth=auth_b64))
        for i in range(1, 6):
            s.add(Wellness(athlete_id=self.aid, date=self.day - timedelta(days=i), sleep_min=420, hrv_ms=60, resting_hr=48))
        s.add(AthleteStore(athlete_id=self.aid, key=morning.PLANNED_KEY, value=[
            {"id": "a", "date": "2026-11-09", "sport": "Mobility", "title": "Mobility", "duration_min": 10, "status": "geplant"},
            {"id": "b", "date": "2026-11-09", "sport": "Rad", "title": "Grundlage Rad", "duration_min": 60, "status": "geplant"}]))
        s.commit()
        self.s = s
        self.addCleanup(s.close)
        self.posts = []

    def post(self, url, body, headers):
        self.posts.append(url)
        return 201

    def add_night(self):
        self.s.add(Wellness(athlete_id=self.aid, date=self.day, sleep_min=455, hrv_ms=62, resting_hr=47))
        self.s.commit()

    def at(self, hh, mm=0):
        return datetime(2026, 11, 9, hh, mm)

    def test_einmal_am_tag_sobald_die_nacht_da_ist(self):
        sync = mock.Mock()
        self.assertEqual(morning.run_once(self.s, self.at(6), start_sync=sync, post=self.post), [])
        self.add_night()
        self.assertEqual(morning.run_once(self.s, self.at(6, 5), start_sync=sync, post=self.post), [(self.aid, "sent")])
        self.assertEqual(morning.run_once(self.s, self.at(9), start_sync=sync, post=self.post), [])
        self.assertEqual(len(self.posts), 1)
        sync.assert_not_called()
        msg = morning.build_message(morning.night(self.s, self.aid, self.day), morning.today_plan(self.s, self.aid, self.day))
        self.assertIn("Heute: Grundlage Rad · 60 min.", msg["body"])  # Training vor Mobility

    def test_um_acht_einmal_neu_abrufen(self):
        sync = mock.Mock()
        morning.run_once(self.s, self.at(7, 55), start_sync=sync, post=self.post)
        sync.assert_not_called()
        self.assertEqual(morning.run_once(self.s, self.at(8), start_sync=sync, post=self.post), [(self.aid, "sync")])
        morning.run_once(self.s, self.at(8, 30), start_sync=sync, post=self.post)
        sync.assert_called_once_with(self.aid)
        self.add_night()
        self.assertEqual(morning.run_once(self.s, self.at(8, 35), start_sync=sync, post=self.post), [(self.aid, "sent")])

    def test_nichts_ausserhalb_des_morgens_oder_wenn_schon_gesehen(self):
        self.add_night()
        self.assertEqual(morning.run_once(self.s, self.at(4), post=self.post), [])
        self.assertEqual(morning.run_once(self.s, self.at(12, 30), post=self.post), [])
        self.s.add(MorningState(athlete_id=self.aid, enabled=True, seen_day="2026-11-09"))
        self.s.commit()
        self.assertEqual(morning.run_once(self.s, self.at(7), post=self.post), [])
        self.assertEqual(self.posts, [])

    def test_ausgeschaltet(self):
        self.add_night()
        self.s.add(MorningState(athlete_id=self.aid, enabled=False))
        self.s.commit()
        self.assertEqual(morning.run_once(self.s, self.at(7), post=self.post), [])

    def test_abgelaufenes_abo_wird_entfernt(self):
        self.add_night()
        morning.run_once(self.s, self.at(7), post=lambda *a: 410)
        self.assertEqual(self.s.query(PushSubscription).count(), 0)
        self.assertIsNone(self.s.get(MorningState, self.aid).sent_day)


@unittest.skipUnless(web_push.available(), "cryptography fehlt")
class EndpunktTest(KeyDirMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, cls.Session = create_app()
        session = cls.Session()
        cls.aid = auth.create_login(session, "ben", PASSWORD)
        cls.other = auth.create_login(session, "lea", PASSWORD)
        session.close()

    def setUp(self):
        self.use_key_dir()
        s = self.Session()
        s.query(PushSubscription).delete()
        s.query(MorningState).delete()
        s.commit()
        s.close()
        auth._failed_logins.clear()
        self.client = self.app.test_client()
        self.h = self.login("ben")

    def login(self, name):
        r = self.client.post("/api/v1/auth/login", json={"username": name, "password": PASSWORD})
        return {"Authorization": f"Bearer {r.get_json()['data']['token']}"}

    def subscribe(self, h, endpoint=APPLE):
        _, p256dh, auth_b64 = device_keys()
        return self.client.post("/api/v1/push/subscribe", headers=h, json={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth_b64}, "label": "iPhone"})

    def test_nur_mit_login(self):
        self.assertEqual(self.client.get("/api/v1/push/status").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/push/test").status_code, 401)

    def test_anmelden_und_status(self):
        st = self.client.get("/api/v1/push/status", headers=self.h).get_json()["data"]
        self.assertEqual((st["available"], st["devices"], len(web_push.b64url_decode(st["publicKey"]))), (True, 0, 65))
        self.assertEqual(self.subscribe(self.h).status_code, 200)
        st = self.client.get("/api/v1/push/status", headers=self.h, query_string={"endpoint": APPLE}).get_json()["data"]
        self.assertEqual((st["devices"], st["thisDevice"], st["morning"]["enabled"]), (1, True, True))
        self.assertNotIn("PRIVATE", str(st))

    def test_fremde_adressen_und_kaputte_schluessel(self):
        self.assertEqual(self.subscribe(self.h, "https://evil.example/x").status_code, 400)
        r = self.client.post("/api/v1/push/subscribe", headers=self.h, json={"endpoint": APPLE, "keys": {"p256dh": "abc", "auth": "x"}})
        self.assertEqual(r.status_code, 400)

    def test_probe_nur_an_eigene_geraete(self):
        self.assertEqual(self.client.post("/api/v1/push/test", headers=self.h).status_code, 409)
        other = self.login("lea")
        self.subscribe(other, APPLE + "-lea")
        self.subscribe(self.h)
        sent = []
        with mock.patch.object(web_push, "_post", lambda url, body, headers: sent.append(url) or 201):
            r = self.client.post("/api/v1/push/test", headers=self.h)
        self.assertEqual((r.status_code, sent), (200, [APPLE]))

    def test_abmelden_ausschalten_gesehen(self):
        self.subscribe(self.h)
        st = self.client.post("/api/v1/push/unsubscribe", headers=self.h, json={"endpoint": APPLE}).get_json()["data"]
        self.assertEqual(st["devices"], 0)
        st = self.client.put("/api/v1/morning/settings", headers=self.h, json={"enabled": False}).get_json()["data"]
        self.assertFalse(st["morning"]["enabled"])
        self.client.post("/api/v1/morning/seen", headers=self.h)
        st = self.client.get("/api/v1/push/status", headers=self.h).get_json()["data"]
        self.assertEqual(st["morning"]["seenDay"], date.today().isoformat())


class FrontendTest(unittest.TestCase):
    def test_service_worker_ist_abrufbar(self):
        from backend.frontend import is_public
        self.assertTrue(is_public("sw.js"))


if __name__ == "__main__":
    unittest.main()
