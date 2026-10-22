"""Offizielle Garmin-Schnittstelle (Personal API): Schluessel je Person,
Zugangs-Token, Abruf und die Einstellungen-Endpunkte. Garmin wird hier nie
angesprochen - urllib.request.urlopen ist durch eine Attrappe ersetzt, die
Schluessel-Dateien liegen in einem Temp-Ordner.

Aufruf im Projektordner:  python -m unittest backend.test_garmin_personal_api -v
"""
import base64
import io
import json
import os
import shutil
import tempfile
import time
import unittest
import urllib.error
import zipfile
from datetime import date, timedelta
from unittest import mock

import tools.garmin_sync as garmin_sync
from backend import auth, create_app
from backend import garmin_api_routes
from backend.config import config
from tools import garmin_personal_api as personal_api

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"

API_KEY = "test-personal-api-key-0123456789"


def jwt(exp):
    """Ein Token im JWT-Format (nur der exp-Teil zaehlt, Signatur egal)."""
    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode().rstrip("=")
    return f"eyJhbGciOiJub25lIn0.{payload}.sig"


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeGarmin:
    """Ersetzt urlopen: merkt sich jede Anfrage, antwortet aus `routes`
    (Pfad ohne Query -> Bytes, Liste von Bytes nacheinander, oder HTTP-Code)."""

    def __init__(self, routes=None):
        self.routes = dict(routes or {})
        self.requests = []

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        path = req.full_url.split("personal.connectapi.garmin.com", 1)[1].split("?")[0]
        answer = self.routes.get(path, b"")
        if isinstance(answer, list):
            answer = answer.pop(0) if len(answer) > 1 else answer[0]
        if isinstance(answer, int):
            raise urllib.error.HTTPError(req.full_url, answer, "Fehler", {}, None)
        return FakeResponse(answer)

    def paths(self):
        return [r.full_url.split("personal.connectapi.garmin.com", 1)[1] for r in self.requests]


class TempDirsMixin:
    def setUp(self):
        self.key_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.key_dir)
        for target, name, value in ((personal_api, "KEY_DIR", self.key_dir), (garmin_sync, "TOKEN_DIR", self.key_dir),
                                    (garmin_sync, "LOG_PATH", os.path.join(self.key_dir, "garmin-sync.log"))):
            patcher = mock.patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def fake(self, routes=None):
        garmin = FakeGarmin(routes)
        patcher = mock.patch("urllib.request.urlopen", garmin)
        patcher.start()
        self.addCleanup(patcher.stop)
        return garmin


class SchluesselUndTokenTest(TempDirsMixin, unittest.TestCase):
    def test_schluessel_gegen_token_tauschen(self):
        garmin = self.fake({personal_api.TOKEN_PATH: jwt(time.time() + 86400).encode()})
        token, exp = personal_api.exchange_key(API_KEY)
        req = garmin.requests[0]
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.get_header("Authorization"), f"ApiKey {API_KEY}")
        self.assertGreater(exp, time.time())
        self.assertEqual(token.count("."), 2)

    def test_token_wird_zwischengespeichert_und_rechtzeitig_erneuert(self):
        personal_api.save_key(1, API_KEY)
        garmin = self.fake({personal_api.TOKEN_PATH: [jwt(time.time() + 86400).encode()]})
        first = personal_api.obtain_token(1)
        self.assertEqual(personal_api.obtain_token(1), first)
        self.assertEqual(len(garmin.requests), 1)  # zweites Mal aus dem Zwischenspeicher
        # Laeuft in weniger als 1 Stunde ab -> neu holen
        personal_api.cache_token(1, API_KEY, jwt(time.time() + 600), time.time() + 600)
        personal_api.obtain_token(1)
        self.assertEqual(len(garmin.requests), 2)
        # Neuer Schluessel -> alter Token gilt nicht mehr
        personal_api.save_key(1, API_KEY + "-neu")
        personal_api.obtain_token(1)
        self.assertEqual(len(garmin.requests), 3)

    def test_abgelehnter_schluessel_und_rate_limit(self):
        self.fake({personal_api.TOKEN_PATH: 401})
        with self.assertRaises(personal_api.GarminApiAuthenticationError) as ctx:
            personal_api.exchange_key(API_KEY)
        self.assertNotIn(API_KEY, ctx.exception.user_message)
        self.fake({personal_api.TOKEN_PATH: 429})
        with self.assertRaises(personal_api.GarminApiTooManyRequestsError):
            personal_api.exchange_key(API_KEY)

    def test_dateien_nur_fuer_den_eigenen_benutzer_und_ohne_schluessel_im_status(self):
        personal_api.save_key(3, API_KEY, "2027-01-01")
        if os.name == "posix":
            self.assertEqual(os.stat(personal_api.key_path(3)).st_mode & 0o077, 0)
        st = personal_api.key_status(3, today=date(2026, 12, 22))
        self.assertEqual(st, {"configured": True, "expires": "2027-01-01", "days_left": 10})
        self.assertNotIn(API_KEY, json.dumps(st))
        self.assertFalse(personal_api.key_status(4)["configured"])
        personal_api.cache_token(3, API_KEY, "t", 0)
        personal_api.delete_key(3)
        self.assertFalse(os.path.exists(personal_api.key_path(3)))
        self.assertFalse(os.path.exists(personal_api.bearer_path(3)))

    def test_schluessel_format(self):
        self.assertEqual(personal_api.clean_key(f"  {API_KEY}\n"), API_KEY)
        for bad in ("", "kurz", "mit leerzeichen drin 12345", None, 42):
            with self.assertRaises(ValueError):
                personal_api.clean_key(bad)


class ClientTest(TempDirsMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        personal_api.save_key(1, API_KEY)
        personal_api.cache_token(1, API_KEY, jwt(time.time() + 86400), time.time() + 86400)

    def test_aktivitaeten_seitenweise(self):
        page1 = [{"activityId": i} for i in range(personal_api.PAGE_SIZE)]
        garmin = self.fake({"/activitylist-service/activities/search/activities":
                            [json.dumps(page1).encode(), json.dumps([{"activityId": 99}]).encode()]})
        acts = personal_api.PersonalApiClient(1).get_activities_by_date("2026-01-01", "2026-10-01")
        self.assertEqual(len(acts), personal_api.PAGE_SIZE + 1)
        self.assertEqual(len(garmin.requests), 2)
        self.assertIn("start=20", garmin.paths()[1])
        self.assertTrue(garmin.requests[0].get_header("Authorization").startswith("Bearer "))

    def test_schritte_in_28_tage_stuecken(self):
        garmin = self.fake()
        personal_api.PersonalApiClient(1).get_daily_steps("2026-01-01", "2026-03-01")  # 60 Tage
        self.assertEqual(len(garmin.requests), 3)
        self.assertTrue(garmin.paths()[0].endswith("/2026-01-01/2026-01-28"))

    def test_abgelaufener_token_wird_einmal_erneuert(self):
        garmin = self.fake({"/hrv-service/hrv/2026-10-01": [401, b'{"hrvSummary": {"lastNightAvg": 61}}'],
                            personal_api.TOKEN_PATH: jwt(time.time() + 86400).encode()})
        data = personal_api.PersonalApiClient(1).get_hrv_data("2026-10-01")
        self.assertEqual(data["hrvSummary"]["lastNightAvg"], 61)
        self.assertEqual([p.split("?")[0] for p in garmin.paths()],
                         ["/hrv-service/hrv/2026-10-01", personal_api.TOKEN_PATH, "/hrv-service/hrv/2026-10-01"])

    def test_ohne_schluessel_klare_meldung(self):
        personal_api.delete_key(1)
        with self.assertRaises(personal_api.GarminApiAuthenticationError) as ctx:
            personal_api.PersonalApiClient(1).get_hrv_data("2026-10-01")
        self.assertIn("Einstellungen", garmin_sync.describe_error(ctx.exception, 1))


class SyncMitApiTest(TempDirsMixin, unittest.TestCase):
    def test_schluessel_hat_vorrang_vor_altem_token(self):
        os.makedirs(garmin_sync.token_path(2))
        personal_api.save_key(5, API_KEY)
        self.assertEqual(garmin_sync.athletes_with_token(), [2, 5])
        self.assertIsInstance(garmin_sync.client_for(5), personal_api.PersonalApiClient)
        with mock.patch.object(garmin_sync, "connect") as connect:
            garmin_sync.client_for(2)
            connect.assert_called_once_with(2, fresh_login=False)
            garmin_sync.client_for(5, fresh_login=True)  # --login bleibt der alte Weg
            connect.assert_called_with(5, fresh_login=True)

    def test_aufbereitung_versteht_die_antworten_der_api(self):
        cache = {"days": {"2026-10-01": {
            "sleep": {"sleepTimeSeconds": 27000, "deepSleepSeconds": 5400},  # Werte direkt oben
            "hrv": {"hrvSummary": {"lastNightAvg": 58, "status": "BALANCED"}},
            "rhr": {"restingHeartRate": 47},
            "max_metrics": None, "training_status": None, "summary": None,
        }}, "ranges": {"body_composition": {"dailyWeightSummaries": [
            {"summaryDate": "2026-10-01", "latestWeight": {"weight": 72400.0, "bodyFat": 15.5}}]}}}
        day = garmin_sync.normalize(cache)["2026-10-01"]
        self.assertEqual((day["sleep_min"], day["sleep_deep_min"], day["hrv_ms"], day["resting_hr"]), (450, 90, 58, 47))
        self.assertEqual((day["weight_kg"], day["body_fat_pct"]), (72.4, 15.5))
        self.assertIsNone(day["vo2max"])  # liefert die Personal API nicht - nie geraten

    def test_aktivitaeten_ueber_die_api(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("123_ACTIVITY.fit", b"FIT")
        client = mock.Mock(spec=["get_activities_by_date", "download_original"])
        client.get_activities_by_date.return_value = [{"activityId": 123, "startTimeLocal": "2026-10-01 07:00:00"}]
        client.download_original.return_value = buf.getvalue()
        session = mock.MagicMock()
        session.query.return_value.filter_by.return_value = []
        with mock.patch.object(garmin_sync, "athlete_dir", return_value=self.key_dir), \
                mock.patch.object(garmin_sync, "store_workouts") as store, mock.patch.object(garmin_sync, "REQUEST_PAUSE_S", 0):
            garmin_sync.sync_activities(client, date(2026, 9, 1), date(2026, 10, 1), 1, session)
        client.download_original.assert_called_once_with(123)
        self.assertEqual(list(store.call_args[0][3]), ["2026-10-01-07-00-00.fit"])

    def test_rate_limit_bricht_ab_und_speichert_das_geladene(self):
        client = mock.Mock(spec=["get_activities_by_date", "download_original"])
        client.get_activities_by_date.return_value = [{"activityId": 1}, {"activityId": 2}]
        client.download_original.side_effect = personal_api.GarminApiTooManyRequestsError("blockt")
        session = mock.MagicMock()
        session.query.return_value.filter_by.return_value = []
        with mock.patch.object(garmin_sync, "athlete_dir", return_value=self.key_dir), \
                mock.patch.object(garmin_sync, "store_workouts") as store, mock.patch.object(garmin_sync, "REQUEST_PAUSE_S", 0):
            with self.assertRaises(personal_api.GarminApiTooManyRequestsError):
                garmin_sync.sync_activities(client, date(2026, 9, 1), date(2026, 10, 1), 1, session)
        self.assertEqual(client.download_original.call_count, 1)
        store.assert_called_once()


class EinstellungenTest(TempDirsMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, session_factory = create_app()
        session = session_factory()
        cls.ids = {n: auth.create_login(session, n, "langes-passwort-1") for n in ("garmin-anna", "garmin-ben")}
        session.close()
        client = cls.app.test_client()
        cls.h = {}
        for n in cls.ids:
            token = client.post("/api/v1/auth/login", json={"username": n, "password": "langes-passwort-1"}).get_json()["data"]["token"]
            cls.h[n] = {"Authorization": f"Bearer {token}"}

    def setUp(self):
        super().setUp()
        self.client = self.app.test_client()
        garmin_api_routes._sync_state.clear()

    def put(self, who, body):
        return self.client.put("/api/v1/garmin/personal-api", headers=self.h[who], json=body)

    def test_speichern_nur_nach_pruefung_und_nur_fuer_die_eigene_person(self):
        self.fake({personal_api.TOKEN_PATH: jwt(time.time() + 86400).encode()})
        expires = (date.today() + timedelta(days=200)).isoformat()
        r = self.put("garmin-anna", {"key": API_KEY, "expires": expires})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn(API_KEY, r.get_data(as_text=True))
        self.assertEqual(r.get_json()["data"]["days_left"], 200)
        self.assertEqual(personal_api.load_key(self.ids["garmin-anna"]), API_KEY)
        # Ben sieht davon nichts und kann ihn nicht entfernen
        ben = self.client.get("/api/v1/garmin/personal-api", headers=self.h["garmin-ben"]).get_json()["data"]
        self.assertFalse(ben["configured"])
        self.client.delete("/api/v1/garmin/personal-api", headers=self.h["garmin-ben"])
        self.assertTrue(personal_api.has_key(self.ids["garmin-anna"]))
        anna = self.client.get("/api/v1/garmin/personal-api", headers=self.h["garmin-anna"])
        self.assertNotIn(API_KEY, anna.get_data(as_text=True))
        self.client.delete("/api/v1/garmin/personal-api", headers=self.h["garmin-anna"])
        self.assertFalse(personal_api.has_key(self.ids["garmin-anna"]))

    def test_abgelehnter_oder_falscher_schluessel_wird_nicht_gespeichert(self):
        self.fake({personal_api.TOKEN_PATH: 401})
        r = self.put("garmin-anna", {"key": API_KEY})
        self.assertEqual(r.status_code, 400)
        self.assertIn("abgelehnt", r.get_json()["error"])
        self.assertEqual(self.put("garmin-anna", {"key": "kurz"}).status_code, 400)
        self.assertEqual(self.put("garmin-anna", {"key": API_KEY, "expires": "2020-01-01"}).status_code, 400)
        self.assertEqual(self.put("garmin-anna", {"key": API_KEY, "expires": "morgen"}).status_code, 400)
        self.assertFalse(personal_api.has_key(self.ids["garmin-anna"]))

    def test_abruf_im_hintergrund(self):
        self.assertEqual(self.client.post("/api/v1/garmin/sync", headers=self.h["garmin-anna"]).status_code, 409)
        personal_api.save_key(self.ids["garmin-anna"], API_KEY)
        with mock.patch.object(garmin_sync, "sync_user", return_value="Aktivitaeten 2 neu") as sync_user, \
                mock.patch("threading.Thread") as thread:
            r = self.client.post("/api/v1/garmin/sync", headers=self.h["garmin-anna"])
            self.assertEqual(r.status_code, 202)
            self.assertTrue(r.get_json()["data"]["sync"]["running"])
            # Laeuft schon -> kein zweiter Abruf
            self.assertEqual(self.client.post("/api/v1/garmin/sync", headers=self.h["garmin-anna"]).status_code, 409)
            thread.call_args.kwargs["target"](*thread.call_args.kwargs["args"])  # Thread-Inhalt ausfuehren
        self.assertEqual(sync_user.call_args[0][0], self.ids["garmin-anna"])
        st = self.client.get("/api/v1/garmin/personal-api", headers=self.h["garmin-anna"]).get_json()["data"]["sync"]
        self.assertEqual((st["running"], st["ok"], st["message"]), (False, True, "Aktivitaeten 2 neu"))
        # Ben ist davon nicht betroffen
        self.assertIsNone(self.client.get("/api/v1/garmin/personal-api", headers=self.h["garmin-ben"]).get_json()["data"]["sync"]["running"])

    def test_fehlende_bibliothek_klare_meldung(self):
        personal_api.save_key(self.ids["garmin-anna"], API_KEY)
        real = __import__("importlib").util.find_spec
        with mock.patch("importlib.util.find_spec", side_effect=lambda name, *a: None if name == "fitdecode" else real(name, *a)):
            r = self.client.post("/api/v1/garmin/sync", headers=self.h["garmin-anna"])
        self.assertEqual(r.status_code, 503)
        self.assertIn("requirements.txt", r.get_json()["error"])

    def test_fehler_beim_abruf_als_klare_meldung(self):
        personal_api.save_key(self.ids["garmin-anna"], API_KEY)
        with mock.patch.object(garmin_sync, "sync_user", side_effect=personal_api.GarminApiAuthenticationError(personal_api.KEY_REJECTED)), \
                mock.patch("threading.Thread") as thread:
            self.client.post("/api/v1/garmin/sync", headers=self.h["garmin-anna"])
            thread.call_args.kwargs["target"](*thread.call_args.kwargs["args"])
        st = self.client.get("/api/v1/garmin/personal-api", headers=self.h["garmin-anna"]).get_json()["data"]["sync"]
        self.assertFalse(st["ok"])
        self.assertIn("neuen eintragen", st["message"])


if __name__ == "__main__":
    unittest.main()
