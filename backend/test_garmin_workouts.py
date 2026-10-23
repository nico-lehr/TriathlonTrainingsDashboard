"""An Garmin senden: Eintrag nur aus der eigenen Ablage, Umwandlung ins
Garmin-Format, verstaendliche Fehler. Garmin wird hier nie angesprochen -
garminconnect.Garmin ist durch einen Mock ersetzt, die Token-Ordner liegen in
einem Temp-Ordner.

Aufruf im Projektordner:  python -m unittest backend.test_garmin_workouts -v
Ohne garminconnect (nur backend/requirements.txt installiert) werden diese
Tests uebersprungen.
"""
import os
import shutil
import tempfile
import unittest
from unittest import mock

try:
    from garminconnect import (GarminConnectAuthenticationError, GarminConnectConnectionError,
                               GarminConnectTooManyRequestsError)
    HAVE_GARMINCONNECT = True
except ImportError:
    HAVE_GARMINCONNECT = False

import tools.garmin_sync
from backend import auth, create_app
from backend.config import config
from backend.models import AthleteStore

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"

KEY = "triathlon_dashboard_planned_workouts_v1"
RUN_ID = "0f6f7c1e-1111-4a8e-9a51-2f1d1b6c0001"
STRENGTH_ID = "0f6f7c1e-2222-4a8e-9a51-2f1d1b6c0002"
OTHER_ID = "0f6f7c1e-3333-4a8e-9a51-2f1d1b6c0003"
TEXT_DURATION_ID = "0f6f7c1e-4444-4a8e-9a51-2f1d1b6c0004"
RUN = {"id": RUN_ID, "date": "2026-10-14", "sport": "Laufen", "title": "6x400m", "duration_min": 50,
       "intensity": "hart", "description": "Bahn", "status": "geplant"}
STEPS = [
    {"type": "warmup", "duration_min": 15, "target": {"kind": "none"}},
    {"type": "repeat", "count": 6, "steps": [
        {"type": "interval", "distance_km": 0.4, "target": {"kind": "pace_zone", "zone": 4, "low_mps": 3.17, "high_mps": 3.4}},
        {"type": "recovery", "duration_min": 1.5, "target": {"kind": "hr_zone", "zone": 1}},
    ]},
    {"type": "cooldown", "target": {"kind": "none"}},
]


@unittest.skipUnless(HAVE_GARMINCONNECT, "garminconnect nicht installiert (requirements.txt)")
class GarminWorkoutTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, session_factory = create_app()
        session = session_factory()
        cls.ids = {name: auth.create_login(session, name, "langes-passwort-1") for name in ("anna", "ben")}
        session.add(AthleteStore(athlete_id=cls.ids["anna"], key=KEY, value=[
            RUN, {"id": STRENGTH_ID, "date": "2026-10-15", "sport": "Kraft", "title": "Rumpf", "duration_min": 30},
            {**RUN, "id": TEXT_DURATION_ID, "duration_min": "50"}]))
        session.add(AthleteStore(athlete_id=cls.ids["ben"], key=KEY, value=[{**RUN, "id": OTHER_ID}]))
        session.commit()
        session.close()
        client = cls.app.test_client()
        token = client.post("/api/v1/auth/login", json={"username": "anna", "password": "langes-passwort-1"}).get_json()["data"]["token"]
        cls.headers = {"Authorization": f"Bearer {token}"}

    def setUp(self):
        self.client = self.app.test_client()
        self.token_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.token_dir)
        patcher = mock.patch.object(tools.garmin_sync, "TOKEN_DIR", self.token_dir)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.garmin = mock.MagicMock()
        self.garmin.return_value.upload_workout.return_value = {"workoutId": 4711, "workoutName": "6x400m"}
        patcher = mock.patch("garminconnect.Garmin", self.garmin)
        patcher.start()
        self.addCleanup(patcher.stop)

    def connect_garmin(self):
        os.makedirs(tools.garmin_sync.token_path(self.ids["anna"]))

    def send(self, workout_id=RUN_ID, body=None):
        return self.client.post(f"/api/v1/planned-workouts/{workout_id}/send-to-garmin", headers=self.headers, json=body or {})

    def test_nur_mit_login(self):
        self.assertEqual(self.client.post(f"/api/v1/planned-workouts/{RUN_ID}/send-to-garmin").status_code, 401)

    def test_erfolg_hochladen_und_in_den_kalender(self):
        self.connect_garmin()
        r = self.send(body={"steps": STEPS})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["data"], {"garmin_workout_id": 4711, "scheduled_date": "2026-10-14"})
        self.garmin.return_value.login.assert_called_once_with(tools.garmin_sync.token_path(self.ids["anna"]))
        self.garmin.return_value.schedule_workout.assert_called_once_with(4711, "2026-10-14")

        payload = self.garmin.return_value.upload_workout.call_args.args[0]
        self.assertEqual(payload["workoutName"], "6x400m")
        self.assertEqual(payload["sportType"]["sportTypeKey"], "running")
        self.assertEqual(payload["estimatedDurationInSecs"], 15 * 60 + 6 * 90)  # nur Zeit-Schritte
        warmup, repeat, cooldown = payload["workoutSegments"][0]["workoutSteps"]
        self.assertEqual((warmup["stepType"]["stepTypeKey"], warmup["endCondition"]["conditionTypeKey"], warmup["endConditionValue"]), ("warmup", "time", 900.0))
        self.assertEqual((repeat["type"], repeat["numberOfIterations"], repeat["stepOrder"]), ("RepeatGroupDTO", 6, 2))
        interval, recovery = repeat["workoutSteps"]
        self.assertEqual((interval["stepOrder"], interval["endCondition"]["conditionTypeKey"], interval["endConditionValue"]), (3, "distance", 400.0))
        self.assertEqual((interval["targetType"]["workoutTargetTypeKey"], interval["targetValueOne"], interval["targetValueTwo"]), ("pace.zone", 3.17, 3.4))
        self.assertEqual((recovery["targetType"]["workoutTargetTypeKey"], recovery["zoneNumber"]), ("heart.rate.zone", 1))
        self.assertEqual((cooldown["stepOrder"], cooldown["endCondition"]["conditionTypeKey"], cooldown["targetType"]["workoutTargetTypeKey"]), (5, "lap.button", "no.target"))

    def test_ohne_schritte_ein_block_ueber_die_dauer(self):
        self.connect_garmin()
        self.assertEqual(self.send().status_code, 200)
        steps = self.garmin.return_value.upload_workout.call_args.args[0]["workoutSegments"][0]["workoutSteps"]
        self.assertEqual([(s["stepType"]["stepTypeKey"], s["endConditionValue"]) for s in steps], [("interval", 3000.0)])

    def test_kalender_klappt_nicht_workout_trotzdem_gesendet(self):
        self.connect_garmin()
        self.garmin.return_value.schedule_workout.side_effect = GarminConnectConnectionError("API Error 500")
        r = self.send()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["data"], {"garmin_workout_id": 4711, "scheduled_date": None})

    def test_ohne_token_hinweis_auf_login(self):
        r = self.send()
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.get_json()["code"], "garmin_not_connected")
        self.assertIn(f"--login --athlete {self.ids['anna']}", r.get_json()["error"])
        self.garmin.assert_not_called()

    def test_token_abgelaufen(self):
        self.connect_garmin()
        self.garmin.return_value.login.side_effect = GarminConnectAuthenticationError("Username and password are required")
        r = self.send()
        self.assertEqual((r.status_code, r.get_json()["code"]), (409, "garmin_reconnect"))
        self.assertIn("abgelaufen", r.get_json()["error"])

    def test_garmin_blockt(self):
        self.connect_garmin()
        for error in (GarminConnectTooManyRequestsError("429"), GarminConnectConnectionError("API Error 429 - Too Many Requests")):
            self.garmin.return_value.upload_workout.side_effect = error
            r = self.send()
            self.assertEqual((r.status_code, r.get_json()["code"]), (429, "garmin_rate_limited"))
            self.assertIn(".fit-Datei", r.get_json()["error"])

    def test_sonstiger_garmin_fehler(self):
        self.connect_garmin()
        self.garmin.return_value.upload_workout.side_effect = GarminConnectConnectionError("API Error 400 - Invalid workout")
        r = self.send()
        self.assertEqual((r.status_code, r.get_json()["code"]), (502, "garmin_error"))

    def test_eintrag_einer_anderen_person_404(self):
        self.connect_garmin()
        r = self.send(OTHER_ID)
        self.assertEqual((r.status_code, r.get_json()["code"]), (404, "not_found"))
        self.assertEqual(self.send("gibt-es-nicht").status_code, 404)
        self.garmin.return_value.upload_workout.assert_not_called()

    def test_kraft_wird_nicht_unterstuetzt(self):
        self.connect_garmin()
        r = self.send(STRENGTH_ID)
        self.assertEqual((r.status_code, r.get_json()["code"]), (422, "unsupported_sport"))

    def test_ungueltige_schritte_400(self):
        self.connect_garmin()
        for steps in ([{"type": "sprint"}], [{"type": "interval", "duration_min": -1}],
                      [{"type": "repeat", "count": 2, "steps": [{"type": "repeat", "count": 2, "steps": [{"type": "rest"}]}]}],
                      [{"type": "interval", "target": {"kind": "hr_zone", "zone": 9}}], "kaputt",
                      # true/false sind keine Zahlen (bool ist in Python ein int)
                      [{"type": "interval", "target": {"kind": "hr_zone", "zone": True}}],
                      [{"type": "repeat", "count": True, "steps": [{"type": "rest"}]}],
                      [{"type": "interval", "duration_min": True}],
                      [{"type": ["interval"]}], [{"type": "interval", "target": {"kind": ["hr_zone"], "zone": 2}}]):
            r = self.send(body={"steps": steps})
            self.assertEqual(r.status_code, 400, steps)
        self.garmin.return_value.upload_workout.assert_not_called()

    def test_body_ohne_json_objekt_wie_ohne_body(self):
        self.connect_garmin()
        for body in ([1, 2], "x", 5):
            self.assertEqual(self.send(body=body).status_code, 200, body)
        r = self.client.post(f"/api/v1/planned-workouts/{RUN_ID}/send-to-garmin", headers=self.headers,
                             data="kein json", content_type="application/json")
        self.assertEqual(r.status_code, 200)

    def test_dauer_als_text_in_der_ablage(self):
        self.connect_garmin()
        r = self.send(TEXT_DURATION_ID, body={"steps": [{"type": "interval", "distance_km": 10}]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(self.garmin.return_value.upload_workout.call_args.args[0]["estimatedDurationInSecs"], 3000)


if __name__ == "__main__":
    unittest.main()
