"""Zugriffsschutz fuer ALLE Endpunkte und Datentrennung bei den neueren Endpunkten.

1. LoginPflichtTest geht app.url_map durch: jeder Endpunkt unter /api/v1 muss
   ohne (gueltigen) Login 401 liefern - ausser den dokumentierten oeffentlichen.
   Ein kuenftiger Endpunkt kann so nicht unbemerkt oeffentlich werden.
2. DatentrennungTest: Person B kann Daten von Person A weder lesen noch
   ueberschreiben - auch nicht ueber die Ablage, Garmin-/Datei-Kennungen,
   Gesundheitsdaten je Tag oder den Kalender-Abgleich.
3. GarminDatentrennungTest: "An Garmin senden" nimmt nur eigene Eintraege und
   nur das eigene Garmin-Token. Garmin wird nie angesprochen (Mock).

Aufruf im Projektordner:  python -m unittest backend.test_access -v
Laeuft gegen eine Datenbank im Arbeitsspeicher - training.db bleibt unberuehrt.
Ollama/Open-Meteo werden nie gefragt (Adressen zeigen auf einen geschlossenen Port).
"""
import os
import re
import shutil
import tempfile
import time
import unittest
from unittest import mock

from itsdangerous import URLSafeTimedSerializer
from itsdangerous.timed import TimestampSigner

import tools.garmin_sync
from backend import auth, create_app, garmin_api_routes, routes
from tools import garmin_personal_api
from backend.config import config

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"

PASSWORD = "richtig-langes-passwort"
CLOSED_PORT = "http://127.0.0.1:9"  # dort laeuft nichts - kein echter Dienst wird gefragt

# Die einzigen Endpunkte ohne Login (siehe routes.PUBLIC_ENDPOINTS und docs/DEPLOYMENT.md).
# Wer hier etwas ergaenzt, macht einen Endpunkt bewusst oeffentlich.
DOCUMENTED_PUBLIC = {"api.health_check", "api.login", "api.get_ical_feed"}
# Ausserhalb der API gibt es nur die Auslieferung der Erlaubt-Liste (backend/frontend.py).
FRONTEND_ENDPOINTS = {"frontend.index", "frontend.public_file"}

PLANNED_KEY = "triathlon_dashboard_planned_workouts_v1"

try:
    import garminconnect  # noqa: F401
    HAVE_GARMINCONNECT = True
except ImportError:
    HAVE_GARMINCONNECT = False


def api_calls(app):
    """(Methode, Adresse, Endpunkt) fuer jeden Endpunkt unter /api/v1 - Platzhalter
    in der Adresse werden mit Beispielwerten gefuellt (Zahl 1, sonst "x")."""
    calls = []
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith("/api/v1/"):
            continue
        url = re.sub(r"<int:[^>]+>", "1", rule.rule)
        url = re.sub(r"<[^>]+>", "x", url)
        for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            calls.append((method, url, rule.endpoint))
    return calls


def make_user(session_factory, name):
    session = session_factory()
    try:
        return auth.create_login(session, name, PASSWORD)
    finally:
        session.close()


class AccessTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_urls = (config.OLLAMA_URL, config.OPEN_METEO_URL, config.OPEN_METEO_GEOCODING_URL)
        config.OLLAMA_URL = config.OPEN_METEO_URL = config.OPEN_METEO_GEOCODING_URL = CLOSED_PORT
        # Die Durchsicht ruft JEDEN Endpunkt auf - auch "Garmin-Schluessel entfernen"
        # und "Abruf starten". Nie den echten ~/.triathlon des Nutzers anfassen und
        # keinen echten Abruf-Thread starten.
        cls.garmin_dir = tempfile.mkdtemp()
        cls.garmin_patchers = [
            mock.patch.object(garmin_personal_api, "KEY_DIR", cls.garmin_dir),
            mock.patch.object(tools.garmin_sync, "TOKEN_DIR", cls.garmin_dir),
            mock.patch.object(tools.garmin_sync, "LOG_PATH", os.path.join(cls.garmin_dir, "garmin-sync.log")),
            mock.patch.object(garmin_api_routes.threading, "Thread"),
        ]
        for patcher in cls.garmin_patchers:
            patcher.start()
        cls.app, cls.session_factory = create_app()

    @classmethod
    def tearDownClass(cls):
        config.OLLAMA_URL, config.OPEN_METEO_URL, config.OPEN_METEO_GEOCODING_URL = cls.old_urls
        for patcher in cls.garmin_patchers:
            patcher.stop()
        shutil.rmtree(cls.garmin_dir, ignore_errors=True)

    def setUp(self):
        auth._failed_logins.clear()
        self.client = self.app.test_client()

    def headers(self, username):
        r = self.client.post("/api/v1/auth/login", json={"username": username, "password": PASSWORD})
        self.assertEqual(r.status_code, 200, r.get_json())
        return {"Authorization": f"Bearer {r.get_json()['data']['token']}"}


class LoginPflichtTest(AccessTestBase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.athlete_id = make_user(cls.session_factory, "login-pflicht")

    def test_oeffentliche_endpunkte_sind_genau_die_dokumentierten(self):
        self.assertEqual(routes.PUBLIC_ENDPOINTS, DOCUMENTED_PUBLIC)

    def test_ausserhalb_der_api_nur_die_auslieferung_der_webseite(self):
        # require_login() haengt am API-Blueprint: eine Route ausserhalb von
        # /api/v1 waere NICHT geschuetzt - deshalb darf es keine geben.
        for rule in self.app.url_map.iter_rules():
            with self.subTest(rule=rule.rule):
                if rule.rule.startswith("/api/v1/"):
                    self.assertTrue(rule.endpoint.startswith("api."), rule.endpoint)
                else:
                    self.assertIn(rule.endpoint, FRONTEND_ENDPOINTS)

    def assert_all_401(self, headers, label):
        calls = [c for c in api_calls(self.app) if c[2] not in DOCUMENTED_PUBLIC]
        self.assertGreater(len(calls), 30)  # Plausibilitaet: die Durchsicht findet die Endpunkte wirklich
        for method, url, endpoint in calls:
            with self.subTest(token=label, method=method, url=url):
                r = self.client.open(url, method=method, json={}, headers=headers)
                self.assertEqual(r.status_code, 401, f"{endpoint} ist ohne gueltigen Login erreichbar")
                self.assertEqual(r.get_json()["code"], "unauthorized")

    def test_ohne_token_401(self):
        self.assert_all_401({}, "ohne")

    def test_kaputter_oder_falsch_geschriebener_token_401(self):
        token = self.headers("login-pflicht")["Authorization"][len("Bearer "):]
        for label, value in [("kaputt", "Bearer kaputt"), ("leer", "Bearer "), ("ohne Bearer", token),
                             ("Basic", "Basic " + token), ("veraendert", "Bearer " + token[:-2] + ("AA" if token[-2:] != "AA" else "BB"))]:
            self.assert_all_401({"Authorization": value}, label)

    def test_fremd_signierter_token_401(self):
        fremd = URLSafeTimedSerializer("anderer-schluessel", salt="login-token").dumps({"athlete_id": self.athlete_id})
        self.assert_all_401({"Authorization": f"Bearer {fremd}"}, "fremd signiert")

    def test_kalender_schluessel_ist_kein_login(self):
        with self.app.app_context():
            key = auth.make_ical_key(self.athlete_id)
        self.assert_all_401({"Authorization": f"Bearer {key}"}, "Kalender-Schluessel")

    def test_abgelaufener_token_401(self):
        vor_31_tagen = int(time.time()) - auth.TOKEN_MAX_AGE_S - 24 * 3600
        with self.app.app_context(), mock.patch.object(TimestampSigner, "get_timestamp", return_value=vor_31_tagen):
            alt = auth.make_token(self.athlete_id)
        self.assert_all_401({"Authorization": f"Bearer {alt}"}, "abgelaufen")
        # Gegenprobe: ein frischer Token derselben Person gilt.
        with self.app.app_context():
            frisch = auth.make_token(self.athlete_id)
        self.assertEqual(self.client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {frisch}"}).status_code, 200)

    def test_mit_gueltigem_token_kein_401(self):
        # Gegenprobe: das 401 oben kommt wirklich vom fehlenden Login, nicht vom Endpunkt selbst.
        h = self.headers("login-pflicht")
        for method, url, endpoint in api_calls(self.app):
            with self.subTest(method=method, url=url):
                r = self.client.open(url, method=method, json={}, headers=h)
                if endpoint != "api.login":  # Login mit leerem Koerper: falsche Zugangsdaten
                    self.assertNotEqual(r.status_code, 401, endpoint)

    def test_oeffentliche_endpunkte_verraten_ohne_login_nichts(self):
        self.assertEqual(self.client.get("/api/v1/health").get_json()["data"]["status"], "ok")
        r = self.client.post("/api/v1/auth/login", json={})
        self.assertEqual((r.status_code, r.get_json()["code"]), (401, "invalid_credentials"))
        self.assertNotIn("data", r.get_json())
        # Kalender-Feed: ohne Schluessel/Token wie "gibt es nicht" - auch fuer die eigene Nummer.
        self.assertEqual(self.client.get(f"/api/v1/ical/{self.athlete_id}.ics").status_code, 404)
        self.assertEqual(self.client.get(f"/api/v1/ical/{self.athlete_id}.ics?key=geraten").status_code, 404)


class DatentrennungTest(AccessTestBase):
    """Neuere Endpunkte und Schreibwege, die test_auth/test_equipment noch nicht abdecken."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.a_id = make_user(cls.session_factory, "trennung-a")
        cls.b_id = make_user(cls.session_factory, "trennung-b")

    def setUp(self):
        super().setUp()
        self.a, self.b = self.headers("trennung-a"), self.headers("trennung-b")

    def test_ablage_b_ueberschreibt_nicht_den_wert_von_a(self):
        key = "/api/v1/store/triathlon_dashboard_athlete_profile_v1"
        self.assertEqual(self.client.put(key, json={"value": {"name": "A", "weightKg": 70}}, headers=self.a).status_code, 200)
        self.assertEqual(self.client.put(key, json={"value": {"name": "B"}}, headers=self.b).status_code, 200)
        a = self.client.get("/api/v1/store", headers=self.a).get_json()["data"]
        b = self.client.get("/api/v1/store", headers=self.b).get_json()["data"]
        self.assertEqual(a["triathlon_dashboard_athlete_profile_v1"], {"name": "A", "weightKg": 70})
        self.assertEqual(b["triathlon_dashboard_athlete_profile_v1"], {"name": "B"})

    def test_gleiche_garmin_nummer_aendert_nicht_das_training_von_a(self):
        r = self.client.post("/api/v1/workouts", headers=self.a, json={
            "date": "2026-09-01", "sport": "running", "duration_min": 30, "garmin_activity_id": 4242, "notes": "A-geheim"})
        self.assertEqual(r.status_code, 201)
        r = self.client.post("/api/v1/workouts", headers=self.b, json={
            "date": "2026-09-01", "sport": "running", "duration_min": 99, "garmin_activity_id": 4242})
        self.assertEqual(r.status_code, 201)  # neu fuer B, kein "Update" des Trainings von A
        self.assertNotIn("A-geheim", r.get_data(as_text=True))
        mine = [w for w in self.client.get("/api/v1/workouts", headers=self.a).get_json()["data"] if w["date"] == "2026-09-01"]
        self.assertEqual([(w["duration_min"], w["notes"]) for w in mine], [(30.0, "A-geheim")])

    def test_gleiche_fit_datei_ist_bei_b_kein_duplikat_von_a(self):
        fit = {"file": "2026-09-02-07-00-00.fit", "date": "2026-09-02T07:00:00+00:00", "sport_raw": "running",
               "sport": "Laufen", "duration_min": 40, "notes_secret": "nur A"}
        body = {"date": "2026-09-02", "sport": "Laufen", "duration_min": 40, "fit_data": fit}
        r_a = self.client.post("/api/v1/workouts", headers=self.a, json=body)
        self.assertEqual(r_a.status_code, 201)
        r_b = self.client.post("/api/v1/workouts", headers=self.b, json={**body, "fit_data": {**fit, "notes_secret": "nur B"}})
        # Waere die Duplikat-Suche nicht nach Person getrennt, bekaeme B hier das Training von A zurueck.
        self.assertEqual(r_b.status_code, 201)
        self.assertFalse(r_b.get_json()["meta"].get("duplicate"))
        self.assertNotEqual(r_b.get_json()["data"]["id"], r_a.get_json()["data"]["id"])
        full_a = [w for w in self.client.get("/api/v1/workouts/full", headers=self.a).get_json()["data"] if w.get("file") == fit["file"]]
        full_b = [w for w in self.client.get("/api/v1/workouts/full", headers=self.b).get_json()["data"] if w.get("file") == fit["file"]]
        self.assertEqual([w["notes_secret"] for w in full_a], ["nur A"])
        self.assertEqual([w["notes_secret"] for w in full_b], ["nur B"])

    def test_gesundheitsdaten_gleicher_tag_bleiben_getrennt(self):
        self.assertEqual(self.client.post("/api/v1/wellness", headers=self.a, json={"date": "2026-09-03", "hrv_ms": 50}).status_code, 201)
        self.assertEqual(self.client.post("/api/v1/wellness", headers=self.b, json={"date": "2026-09-03", "hrv_ms": 99}).status_code, 201)
        hrv = lambda h: [w["hrv_ms"] for w in self.client.get("/api/v1/wellness", headers=h).get_json()["data"] if w["date"] == "2026-09-03"]
        self.assertEqual((hrv(self.a), hrv(self.b)), ([50.0], [99.0]))
        daily = lambda h: self.client.get("/api/v1/wellness/daily", headers=h).get_json()["data"]["daily"]["2026-09-03"]["hrv_ms"]
        self.assertEqual((daily(self.a), daily(self.b)), (50.0, 99.0))

    def test_kalender_abgleich_von_b_loescht_nichts_von_a(self):
        sync = lambda h, wid, title: self.client.post("/api/v1/ical-sync", headers=h, json={
            "workouts": [{"id": wid, "date": "2026-10-20", "title": title, "status": "geplant"}]})
        self.assertEqual(sync(self.a, "a-plan-1", "Plan-von-A").status_code, 200)
        self.assertEqual(sync(self.b, "b-plan-1", "Plan-von-B").status_code, 200)
        feed_a = self.client.get(f"/api/v1/ical/{self.a_id}.ics", headers=self.a).get_data(as_text=True)
        feed_b = self.client.get(f"/api/v1/ical/{self.b_id}.ics", headers=self.b).get_data(as_text=True)
        self.assertIn("Plan-von-A", feed_a)
        self.assertNotIn("Plan-von-B", feed_a)
        self.assertIn("Plan-von-B", feed_b)
        self.assertNotIn("Plan-von-A", feed_b)

    def test_kalender_abgleich_gleiche_kennung_bei_zwei_personen(self):
        # ical_planned_workouts.id ist tabellenweit eindeutig; die Kennung
        # bekommt deshalb die Nummer der Person vorangestellt (sonst 500, wenn
        # z. B. derselbe Browser-Export bei zwei Personen importiert wurde).
        body = {"workouts": [{"id": "gleiche-kennung", "date": "2026-10-21", "title": "Kopie", "status": "geplant"}]}
        self.assertEqual(self.client.post("/api/v1/ical-sync", headers=self.a, json=body).status_code, 200)
        self.assertEqual(self.client.post("/api/v1/ical-sync", headers=self.b, json=body).status_code, 200)
        self.assertIn("Kopie", self.client.get(f"/api/v1/ical/{self.b_id}.ics", headers=self.b).get_data(as_text=True))

    def test_zu_grosse_anfrage_wird_abgelehnt(self):
        # config.MAX_CONTENT_LENGTH (64 MB) schuetzt die Platte vor Riesen-Uploads;
        # hier mit einer kleinen Grenze geprueft, damit der Test schnell bleibt.
        self.assertEqual(self.app.config["MAX_CONTENT_LENGTH"], 64 * 1024 * 1024)
        self.app.config["MAX_CONTENT_LENGTH"] = 1000
        try:
            r = self.client.put("/api/v1/store/gross", headers=self.a, json={"value": "x" * 5000})
            self.assertEqual(r.status_code, 413)
            r = self.client.put("/api/v1/store/klein", headers=self.a, json={"value": "ok"})
            self.assertEqual(r.status_code, 200)
        finally:
            self.app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024

    def test_konto_zeigt_die_eigene_person(self):
        me = lambda h: self.client.get("/api/v1/auth/me", headers=h).get_json()["data"]["username"]
        self.assertEqual((me(self.a), me(self.b)), ("trennung-a", "trennung-b"))


@unittest.skipUnless(HAVE_GARMINCONNECT, "garminconnect nicht installiert (requirements.txt)")
class GarminDatentrennungTest(AccessTestBase):
    """Gegenrichtung zu test_garmin_workouts: auch wenn BEIDE mit Garmin verbunden sind."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.ids = {name: make_user(cls.session_factory, name) for name in ("garmin-a", "garmin-b")}
        h = {}
        client = cls.app.test_client()
        for name in cls.ids:
            token = client.post("/api/v1/auth/login", json={"username": name, "password": PASSWORD}).get_json()["data"]["token"]
            h[name] = {"Authorization": f"Bearer {token}"}
            client.put(f"/api/v1/store/{PLANNED_KEY}", headers=h[name], json={"value": [
                {"id": f"plan-{name}", "date": "2026-10-14", "sport": "Laufen", "title": f"Lauf {name}", "duration_min": 40, "status": "geplant"}]})
        cls.h = h

    def setUp(self):
        super().setUp()
        token_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, token_dir)
        patcher = mock.patch.object(tools.garmin_sync, "TOKEN_DIR", token_dir)
        patcher.start()
        self.addCleanup(patcher.stop)
        for athlete_id in self.ids.values():
            os.makedirs(tools.garmin_sync.token_path(athlete_id))
        self.garmin = mock.MagicMock()
        self.garmin.return_value.upload_workout.return_value = {"workoutId": 99}
        patcher = mock.patch("garminconnect.Garmin", self.garmin)
        patcher.start()
        self.addCleanup(patcher.stop)

    def send(self, who, workout_id):
        return self.client.post(f"/api/v1/planned-workouts/{workout_id}/send-to-garmin", headers=self.h[who], json={})

    def test_fremder_eintrag_404_ohne_garmin_kontakt(self):
        r = self.send("garmin-b", "plan-garmin-a")
        self.assertEqual((r.status_code, r.get_json()["code"]), (404, "not_found"))
        self.garmin.assert_not_called()
        self.garmin.return_value.upload_workout.assert_not_called()

    def test_eigener_eintrag_nur_mit_eigenem_token(self):
        r = self.send("garmin-b", "plan-garmin-b")
        self.assertEqual(r.status_code, 200, r.get_json())
        self.garmin.return_value.login.assert_called_once_with(tools.garmin_sync.token_path(self.ids["garmin-b"]))
        self.assertEqual(self.garmin.return_value.upload_workout.call_args[0][0]["workoutName"], "Lauf garmin-b")


if __name__ == "__main__":
    unittest.main()
