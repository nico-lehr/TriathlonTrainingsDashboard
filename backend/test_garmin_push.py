"""Trainings auf die Uhr (backend/garmin_push.py) und die vorbereitete
offizielle Training API (backend/garmin_official.py).

Garmin wird hier NIE angesprochen: der Abgleich bekommt einen FakeGarmin,
die Anmeldung ein gemocktes garminconnect.Garmin, die offizielle API eine
ersetzte http()-Funktion. Token-Ordner liegen in einem Temp-Ordner.

Aufruf im Projektordner:  python -m unittest backend.test_garmin_push -v
"""
import json
import os
import shutil
import tempfile
import unittest
from datetime import date
from unittest import mock

import tools.garmin_sync
from backend import auth, create_app, garmin_official, garmin_push
from backend.config import config
from backend.models import AthleteStore, GarminPushState, GarminWorkoutLink

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"

KEY = "triathlon_dashboard_planned_workouts_v1"
TODAY = date(2026, 11, 9)  # Montag
PASSWORD = "langes-passwort-1"


class ApiError(Exception):
    pass


class RateLimited(Exception):
    pass


RateLimited.__name__ = "GarminConnectTooManyRequestsError"


class FakeGarmin:
    """Merkt sich alle Aufrufe; Workouts liegen in self.workouts."""

    def __init__(self):
        self.calls, self.workouts, self.next_id = [], {}, 100
        self.fail_upload = []  # Ausnahmen, die die naechsten Uploads werfen

    def upload_workout(self, payload):
        self.calls.append(("upload", payload["workoutName"]))
        if self.fail_upload:
            raise self.fail_upload.pop(0)
        self.next_id += 1
        self.workouts[str(self.next_id)] = payload
        return {"workoutId": self.next_id}

    def update_workout(self, workout_id, payload):
        self.calls.append(("update", str(workout_id)))
        if str(workout_id) not in self.workouts:
            raise ApiError("API Error 404 - not found")
        self.workouts[str(workout_id)] = payload
        return {}

    def delete_workout(self, workout_id):
        self.calls.append(("delete", str(workout_id)))
        if self.workouts.pop(str(workout_id), None) is None:
            raise ApiError("API Error 404 - not found")

    def schedule_workout(self, workout_id, date_str):
        self.calls.append(("schedule", str(workout_id), date_str))
        return {"workoutScheduleId": 9}


def entry(pid, day, sport="Laufen", **extra):
    return {"id": pid, "date": day, "sport": sport, "title": f"{sport} {pid}", "duration_min": 40,
            "intensity": "leicht", "status": "geplant", **extra}


class PushTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, cls.Session = create_app()
        session = cls.Session()
        cls.aid = auth.create_login(session, "paula", PASSWORD)
        session.close()

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for patcher in (mock.patch.object(tools.garmin_sync, "TOKEN_DIR", self.tmp),
                        mock.patch.object(garmin_official, "TOKEN_DIR", self.tmp)):
            patcher.start()
            self.addCleanup(patcher.stop)
        session = self.Session()
        session.query(GarminWorkoutLink).delete()
        session.query(GarminPushState).delete()
        session.query(AthleteStore).delete()
        session.commit()
        session.close()
        self.fake = FakeGarmin()
        self.factory_calls = 0

    def set_plan(self, entries):
        session = self.Session()
        row = session.query(AthleteStore).filter_by(athlete_id=self.aid, key=KEY).first()
        if row is None:
            session.add(AthleteStore(athlete_id=self.aid, key=KEY, value=entries))
        else:
            row.value = entries
        session.commit()
        session.close()

    def factory(self, athlete_id):
        self.factory_calls += 1
        return self.fake, "connect"

    def push(self, **kw):
        kw.setdefault("today", TODAY)
        return garmin_push.run_push(self.aid, self.Session, client_factory=self.factory, **kw)

    def links(self):
        session = self.Session()
        try:
            return {l.planned_id: (l.state, l.garmin_workout_id, l.date)
                    for l in session.query(GarminWorkoutLink).filter_by(athlete_id=self.aid)}
        finally:
            session.close()


class AbgleichTest(PushTestBase):
    def test_nur_die_naechsten_7_tage_und_nur_geplantes(self):
        self.set_plan([
            entry("a", "2026-11-09"), entry("b", "2026-11-15"),            # heute + letzter Tag im Fenster
            entry("c", "2026-11-16"),                                         # Tag 8: noch nicht
            entry("d", "2026-11-08"),                                         # gestern
            entry("e", "2026-11-10", status="erledigt"),
            entry("f", "2026-11-10", sport="Ruhetag"),
            entry("g", "2026-11-11", garminOff=True),
        ])
        r = self.push()
        self.assertEqual((r["created"], r["failed"], r["stopped"]), (2, [], None))
        self.assertEqual(set(r["links"]), {"a", "b"})
        self.assertIn(("schedule", "101", "2026-11-09"), self.fake.calls)

    def test_ohne_aenderung_wird_garmin_nicht_gefragt(self):
        self.set_plan([entry("a", "2026-11-10")])
        self.push()
        self.factory_calls = 0
        r = self.push()
        self.assertEqual((r["unchanged"], self.factory_calls), (1, 0))

    def test_aenderung_aktualisiert_dasselbe_workout(self):
        self.set_plan([entry("a", "2026-11-10")])
        self.push()
        self.set_plan([entry("a", "2026-11-10", title="Neuer Titel")])
        r = self.push()
        self.assertEqual(r["updated"], 1)
        self.assertEqual(self.fake.calls.count(("upload", "Neuer Titel")), 0)
        self.assertEqual(self.fake.workouts["101"]["workoutName"], "Neuer Titel")

    def test_verschoben_alt_weg_neu_am_neuen_tag(self):
        self.set_plan([entry("a", "2026-11-10")])
        self.push()
        self.set_plan([entry("a", "2026-11-12")])
        r = self.push()
        self.assertEqual(r["moved"], 1)
        self.assertIn(("delete", "101"), self.fake.calls)
        self.assertEqual(self.links()["a"], ("active", "102", "2026-11-12"))
        self.assertEqual(list(self.fake.workouts), ["102"])

    def test_geloescht_oder_uebersprungen_wird_in_garmin_geloescht_erledigt_bleibt(self):
        self.set_plan([entry("a", "2026-11-10"), entry("b", "2026-11-11"), entry("c", "2026-11-12")])
        self.push()
        self.set_plan([entry("b", "2026-11-11", status="uebersprungen"), entry("c", "2026-11-12", status="erledigt")])
        r = self.push()
        self.assertEqual(r["removed"], 2)
        self.assertEqual(self.links()["a"][0], "removed")
        self.assertEqual(self.links()["b"][0], "removed")
        self.assertEqual(self.links()["c"][0], "active")
        self.assertEqual(list(self.fake.workouts), ["103"])

    def test_vergangenes_bleibt_unangetastet(self):
        self.set_plan([entry("a", "2026-11-10")])
        self.push()
        r = self.push(today=date(2026, 11, 12))  # zwei Tage spaeter
        self.assertEqual((r["removed"], r["created"]), (0, 0))
        self.assertIn("101", self.fake.workouts)

    def test_in_garmin_von_hand_geloescht_wird_neu_angelegt(self):
        self.set_plan([entry("a", "2026-11-10")])
        self.push()
        self.fake.workouts.clear()
        self.set_plan([entry("a", "2026-11-10", title="Anders")])
        r = self.push()
        self.assertEqual((r["updated"], r["failed"]), (1, []))
        self.assertEqual(self.links()["a"][1], "102")
        self.assertIn("102", self.fake.workouts)

    def test_von_hand_gesendet_bleibt_ausserhalb_der_7_tage(self):
        self.set_plan([entry("a", "2026-11-25")])
        r = self.push(only=["a"], pin=True)
        self.assertEqual(r["created"], 1)
        r = self.push()
        self.assertEqual((r["removed"], r["unchanged"]), (0, 1))

    def test_altes_gesendetes_workout_wird_ersetzt_statt_verdoppelt(self):
        self.fake.workouts["55"] = {"workoutName": "alt"}
        self.set_plan([entry("a", "2026-11-10", garminWorkoutId=55)])
        r = self.push()
        self.assertEqual(r["created"], 1)
        self.assertEqual(self.fake.calls[0], ("delete", "55"))
        self.assertNotIn("55", self.fake.workouts)

    def test_garmin_blockt_bricht_ab_und_merkt_den_rest(self):
        self.set_plan([entry("a", "2026-11-10"), entry("b", "2026-11-11"), entry("c", "2026-11-12")])
        real = self.fake.upload_workout
        count = {"n": 0}

        def upload(payload):
            count["n"] += 1
            if count["n"] == 2:
                raise RateLimited("429")
            return real(payload)
        self.fake.upload_workout = upload
        r = self.push()
        self.assertEqual((r["created"], r["pending"], r["stopped"]["code"]), (1, 2, "garmin_rate_limited"))
        self.fake.upload_workout = real
        r = self.push()
        self.assertEqual((r["created"], r["stopped"]), (2, None))  # der Rest kommt beim naechsten Mal

    def test_ohne_anmeldung_nichts_kaputt(self):
        self.set_plan([entry("a", "2026-11-10")])
        r = garmin_push.run_push(self.aid, self.Session, today=TODAY)  # echter open_client, aber kein Token
        self.assertEqual(r["stopped"]["code"], "garmin_not_connected")
        self.assertEqual(r["pending"], 1)

    def test_einzelner_fehler_stoppt_die_anderen_nicht(self):
        self.set_plan([entry("a", "2026-11-10"), entry("b", "2026-11-11")])
        self.fake.fail_upload = [ApiError("API Error 400 - kaputt")]
        r = self.push()
        self.assertEqual((r["created"], len(r["failed"])), (1, 1))
        self.assertEqual(r["failed"][0]["id"], "a")

    def test_mobility_faellt_auf_krafttraining_zurueck(self):
        ex = [{"id": "taube", "name": "Taube", "seconds": 40, "sides": True}]
        self.set_plan([entry("m", "2026-11-10", sport="Mobility", exercises=ex)])
        self.fake.fail_upload = [ApiError("API Error 400 - unknown sport")]
        r = self.push()
        self.assertEqual(r["created"], 1)
        payload = self.fake.workouts["101"]
        self.assertEqual(payload["sportType"]["sportTypeKey"], "strength_training")
        steps = payload["workoutSegments"][0]["workoutSteps"]
        self.assertEqual([s["description"] for s in steps], ["Taube links", "Taube rechts"])
        self.assertEqual(steps[0]["exerciseName"], "STRETCH_PIGEON_POSE")
        session = self.Session()
        self.assertEqual(session.query(GarminWorkoutLink).filter_by(planned_id="m").one().variant, 1)
        session.close()

    def test_schritte_vom_browser_werden_gemerkt(self):
        self.set_plan([entry("a", "2026-11-10")])
        steps = [{"type": "interval", "duration_min": 40, "target": {"kind": "pace_zone", "zone": 2, "low_mps": 3.0, "high_mps": 3.2},
                  "note": "Ganz locker bleiben"}]
        self.push(items=[{"id": "a", "steps": steps}, {"id": "gibt-es-nicht", "steps": steps}])
        step = self.fake.workouts["101"]["workoutSegments"][0]["workoutSteps"][0]
        self.assertEqual((step["targetValueOne"], step["description"]), (3.0, "Ganz locker bleiben"))
        session = self.Session()
        self.assertEqual(set(session.get(GarminPushState, self.aid).details), {"a"})  # Fremdes vergessen
        session.close()

    def test_zeitplan_morgens_nur_mit_anmeldung_und_automatik(self):
        self.set_plan([entry("a", date.today().isoformat())])
        os.makedirs(tools.garmin_sync.token_path(self.aid))
        lines = []
        with mock.patch.object(garmin_push, "open_client", self.factory):
            garmin_push.run_scheduled_pushes(self.Session, log=lines.append)
        self.assertEqual(len(self.fake.workouts), 1)
        self.assertIn("1 neu", lines[0])
        session = self.Session()
        session.get(GarminPushState, self.aid).auto = False
        session.commit()
        session.close()
        lines.clear()
        garmin_push.run_scheduled_pushes(self.Session, log=lines.append)
        self.assertEqual(lines, [])


class EndpunkteTest(PushTestBase):
    def setUp(self):
        super().setUp()
        auth._failed_logins.clear()
        self.client = self.app.test_client()
        r = self.client.post("/api/v1/auth/login", json={"username": "paula", "password": PASSWORD})
        self.h = {"Authorization": f"Bearer {r.get_json()['data']['token']}"}
        garmin_push._pending_mfa.clear()

    def test_alles_nur_mit_login(self):
        for method, url in (("GET", "status"), ("POST", "login"), ("POST", "login/mfa"), ("POST", "disconnect"),
                            ("PUT", "settings"), ("POST", "sync")):
            self.assertEqual(self.client.open(f"/api/v1/garmin/workouts/{url}", method=method, json={}).status_code, 401)

    def test_status_und_automatik_aus(self):
        r = self.client.get("/api/v1/garmin/workouts/status", headers=self.h).get_json()["data"]
        self.assertEqual((r["connected"], r["auto"], r["official"]["available"]), (False, True, False))
        r = self.client.put("/api/v1/garmin/workouts/settings", headers=self.h, json={"auto": False})
        self.assertFalse(r.get_json()["data"]["auto"])
        os.makedirs(tools.garmin_sync.token_path(self.aid))
        r = self.client.post("/api/v1/garmin/workouts/sync", headers=self.h, json={}).get_json()["data"]
        self.assertEqual(r["skipped"], "auto_off")
        self.assertEqual(self.client.put("/api/v1/garmin/workouts/settings", headers=self.h, json={"auto": "ja"}).status_code, 400)

    def test_sync_ohne_anmeldung_ueberspringt(self):
        r = self.client.post("/api/v1/garmin/workouts/sync", headers=self.h, json={}).get_json()["data"]
        self.assertEqual(r["skipped"], "not_connected")

    def test_sync_ueber_den_endpunkt(self):
        os.makedirs(tools.garmin_sync.token_path(self.aid))
        self.set_plan([entry("a", date.today().isoformat())])
        with mock.patch.object(garmin_push, "open_client", self.factory):
            r = self.client.post("/api/v1/garmin/workouts/sync", headers=self.h, json={"items": [{"id": "a"}]})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["data"]["created"], 1)
        self.assertEqual(list(r.get_json()["data"]["links"]), ["a"])

    def login(self, garmin_mock, body=None):
        with mock.patch.object(garmin_push, "library_available", return_value=True), \
                mock.patch("garminconnect.Garmin", garmin_mock):
            return self.client.post("/api/v1/garmin/workouts/login", headers=self.h,
                                    json=body or {"email": "p@example.org", "password": "geheim-123"})

    def test_anmeldung_speichert_nur_das_token(self):
        g = mock.MagicMock()
        g.return_value.login.return_value = (None, None)
        g.return_value.client.dump.side_effect = lambda path: (os.makedirs(path, exist_ok=True), open(
            os.path.join(path, "garmin_tokens.json"), "w").write('{"di_token": "t"}'))
        with mock.patch("builtins.print") as printed:
            r = self.login(g)
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertTrue(r.get_json()["data"]["connected"])
        g.assert_called_once_with("p@example.org", "geheim-123", return_on_mfa=True)
        self.assertIsNone(g.return_value.password)  # vergessen
        for root, _, files in os.walk(self.tmp):
            for f in files:
                self.assertNotIn("geheim-123", open(os.path.join(root, f)).read())
        self.assertNotIn("geheim-123", repr(printed.call_args_list))
        self.assertTrue(self.client.get("/api/v1/garmin/workouts/status", headers=self.h).get_json()["data"]["connected"])
        r = self.client.post("/api/v1/garmin/workouts/disconnect", headers=self.h)
        self.assertFalse(r.get_json()["data"]["connected"])

    def test_anmeldung_mit_zwei_faktor_code(self):
        g = mock.MagicMock()
        g.return_value.login.return_value = ("needs_mfa", None)
        r = self.login(g)
        self.assertEqual(r.get_json()["data"], {"connected": False, "mfa_required": True})
        self.assertIsNone(g.return_value.password)
        self.assertEqual(self.client.post("/api/v1/garmin/workouts/login/mfa", headers=self.h, json={"code": "abc"}).status_code, 400)
        r = self.client.post("/api/v1/garmin/workouts/login/mfa", headers=self.h, json={"code": "123456"})
        self.assertEqual(r.status_code, 200, r.get_json())
        g.return_value.resume_login.assert_called_once_with(None, "123456")
        g.return_value.client.dump.assert_called_once_with(tools.garmin_sync.token_path(self.aid))
        r = self.client.post("/api/v1/garmin/workouts/login/mfa", headers=self.h, json={"code": "123456"})
        self.assertEqual(r.get_json()["code"], "garmin_mfa_expired")

    def test_falsches_passwort(self):
        class AuthErr(Exception):
            pass
        AuthErr.__name__ = "GarminConnectAuthenticationError"
        g = mock.MagicMock()
        g.return_value.login.side_effect = AuthErr("bad geheim-123")
        with mock.patch("builtins.print") as printed:
            r = self.login(g)
        self.assertEqual((r.status_code, r.get_json()["code"]), (401, "garmin_login_failed"))
        self.assertNotIn("geheim-123", repr(printed.call_args_list) + json.dumps(r.get_json()))
        self.assertFalse(os.path.exists(tools.garmin_sync.token_path(self.aid)))

    def test_anmeldung_braucht_email_und_passwort(self):
        for body in ({"email": "x", "password": "y"}, {"email": "a@b.de"}, {"email": "a@b.de", "password": 5}):
            self.assertEqual(self.login(mock.MagicMock(), body).status_code, 400, body)


class OffiziellTest(PushTestBase):
    ENV = {"GARMIN_TRAINING_CLIENT_ID": "cid", "GARMIN_TRAINING_CLIENT_SECRET": "sec",
           "GARMIN_TRAINING_REDIRECT_URL": "https://dash.example/?garmin_oauth=1"}

    def setUp(self):
        super().setUp()
        auth._failed_logins.clear()
        self.client = self.app.test_client()
        r = self.client.post("/api/v1/auth/login", json={"username": "paula", "password": PASSWORD})
        self.h = {"Authorization": f"Bearer {r.get_json()['data']['token']}"}

    def test_ohne_freischaltung_aus(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            for k in self.ENV:
                os.environ.pop(k, None)
            self.assertFalse(garmin_official.enabled())
            r = self.client.post("/api/v1/garmin/official/start", headers=self.h)
            self.assertEqual((r.status_code, r.get_json()["code"]), (409, "not_enabled"))

    def test_verbinden_und_senden_ueber_die_offizielle_api(self):
        calls = []

        def http(method, url, data=None, form=None, token=None, timeout=30):
            calls.append((method, url, data, form, token))
            if url == garmin_official.TOKEN_URL:
                return {"access_token": "acc", "refresh_token": "ref", "expires_in": 3600}
            if method == "POST" and url.endswith("/workout/v2"):
                return {"workoutId": 777}
            return {}
        with mock.patch.dict(os.environ, self.ENV), mock.patch.object(garmin_official, "http", http):
            url = self.client.post("/api/v1/garmin/official/start", headers=self.h).get_json()["data"]["url"]
            self.assertIn("code_challenge_method=S256", url)
            state = url.split("state=")[1]
            r = self.client.post("/api/v1/garmin/official/finish", headers=self.h, json={"code": "c1", "state": state})
            self.assertTrue(r.get_json()["data"]["connected"], r.get_json())
            self.assertEqual(calls[0][3]["grant_type"], "authorization_code")
            self.assertIn("code_verifier", calls[0][3])
            # derselbe state geht nur einmal
            r = self.client.post("/api/v1/garmin/official/finish", headers=self.h, json={"code": "c1", "state": state})
            self.assertEqual(r.status_code, 400)
            self.assertEqual(oct(os.stat(garmin_official.token_file(self.aid)).st_mode & 0o777), "0o600")

            self.set_plan([entry("a", "2026-11-10", intensity="mittel")])
            r = garmin_push.run_push(self.aid, self.Session, today=TODAY)
            self.assertEqual((r["created"], r["stopped"]), (1, None))
            upload = next(c for c in calls if c[0] == "POST" and c[1].endswith("/workout/v2"))
            self.assertEqual((upload[2]["sport"], upload[4]), ("RUNNING", "acc"))
            main = upload[2]["segments"][0]["steps"][1]
            self.assertEqual((main["intensity"], main["durationType"], main["targetType"], main["targetValue"]),
                             ("INTERVAL", "TIME", "HEART_RATE", 3))
            sched = next(c for c in calls if c[1].endswith("/training-api/schedule"))
            self.assertEqual(sched[2], {"workoutId": 777, "date": "2026-11-10"})
            session = self.Session()
            self.assertEqual(session.query(GarminWorkoutLink).filter_by(planned_id="a").one().via, "official")
            session.close()


if __name__ == "__main__":
    unittest.main()
