"""Events aus dem Garmin-Kalender (backend/garmin_events.py).

Garmin wird NIE angesprochen: die Zugaenge werden durch FakeCalendar ersetzt.
Aufruf im Projektordner:  python -m unittest backend.test_garmin_events -v
"""
import os
import shutil
import tempfile
import unittest
from datetime import date
from unittest import mock

import tools.garmin_sync
from backend import auth, create_app, garmin_events
from backend.config import config
from tools import garmin_personal_api as personal_api

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"
PASSWORD = "langes-passwort-1"
TODAY = date(2026, 11, 9)


def ev(eid, day, title, **extra):
    return {"itemType": "event", "id": eid, "date": day, "title": title, **extra}


class FakeCalendar:
    """Wie garminconnect: get_scheduled_workouts(Jahr, Monat 1-12) + connectapi(Pfad)."""

    def __init__(self, months, details=None):
        self.months, self.details, self.calls = months, details or {}, []

    def get_scheduled_workouts(self, year, month):
        self.calls.append((year, month))
        return {"calendarItems": self.months.get((year, month), [])}

    def connectapi(self, path):
        return self.details.get(path, {})


class EventsTest(unittest.TestCase):
    def test_nur_kommende_events_mit_allen_angaben(self):
        cal = FakeCalendar({
            (2026, 11): [ev(1, "2026-11-01", "Herbstlauf"),  # vorbei
                         {"itemType": "workout", "id": 2, "date": "2026-11-20", "title": "Intervalle"},
                         ev(3, "2026-11-22", "Nikolauslauf 10 km", isRace=True,
                            completionTarget={"value": 10000, "unit": "meter", "unitType": "distance"},
                            eventTimeLocal={"startTimeHhMm": "10:30"}, location="  Köln  ")],
            (2027, 6): [ev(4, "2027-06-13", "IRONMAN 70.3 Kraichgau", isRace=True, primaryEvent=True,
                           completionTarget={"value": 113, "unit": "kilometer", "unitType": "distance"})],
            (2027, 7): [ev(4, "2027-06-13", "IRONMAN 70.3 Kraichgau")],  # Monatsrand doppelt
        }, details={"/calendar-service/event/4": {"eventCustomization": {"customGoal": {"value": 19800, "unit": "second", "unitType": "time"}}}})
        events = garmin_events.fetch_events(cal, today=TODAY)
        self.assertEqual([e["garminId"] for e in events], ["3", "4"])
        run, tri = events
        self.assertEqual((run["sport"], run["distanceKm"], run["startTime"], run["location"], run["isRace"]), ("Laufen", 10.0, "10:30", "Köln", True))
        self.assertEqual((tri["sport"], tri["primary"], tri["targetTime"], tri["distanceKm"]), ("Triathlon", True, "5:30:00", 113.0))
        self.assertEqual(len(cal.calls), 13)  # dieser Monat + 12 voraus
        self.assertEqual(cal.calls[0], (2026, 11))

    def test_sportart_aus_typ_oder_titel(self):
        self.assertEqual(garmin_events.event_sport({"eventType": {"typeKey": "cycling"}}, "Irgendwas"), "Rad")
        self.assertEqual(garmin_events.event_sport({}, "Gran Fondo Mallorca"), "Rad")
        self.assertEqual(garmin_events.event_sport({}, "Freiwasser-Schwimmen am See"), "Schwimmen")
        self.assertEqual(garmin_events.event_sport({}, "Berlin Marathon"), "Laufen")
        self.assertEqual(garmin_events.event_sport({}, "Firmenfeier"), "Sonstiges")

    def test_event_liste_als_ersatz(self):
        cal = FakeCalendar({}, details={
            "/calendar-service/events?startDate=2026-11-09&pageIndex=1&limit=100&sortOrder=eventDate_asc":
                [{"id": 11, "eventName": "Silvesterlauf Trier", "eventDate": "2026-12-31", "isRace": True}],
        })
        events = garmin_events.fetch_events(cal, today=TODAY)
        self.assertEqual([(e["name"], e["date"], e["sport"]) for e in events], [("Silvesterlauf Trier", "2026-12-31", "Laufen")])

    def test_personal_api_nutzt_0_basierten_monat(self):
        client = personal_api.PersonalApiClient.__new__(personal_api.PersonalApiClient)
        seen = []
        client._get = lambda path, params=None, missing_ok=False: seen.append(path) or {"calendarItems": []}
        garmin_events.month_items(client, 2027, 1)
        self.assertEqual(seen, ["/calendar-service/year/2027/month/0"])


class EndpunktTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, cls.Session = create_app()
        session = cls.Session()
        cls.aid = auth.create_login(session, "ella", PASSWORD)
        session.close()

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for p in (mock.patch.object(tools.garmin_sync, "TOKEN_DIR", self.tmp), mock.patch.object(personal_api, "KEY_DIR", self.tmp)):
            p.start()
            self.addCleanup(p.stop)
        garmin_events._cache.clear()
        auth._failed_logins.clear()
        self.client = self.app.test_client()
        r = self.client.post("/api/v1/auth/login", json={"username": "ella", "password": PASSWORD})
        self.h = {"Authorization": f"Bearer {r.get_json()['data']['token']}"}

    def test_nur_mit_login(self):
        self.assertEqual(self.client.get("/api/v1/garmin/events").status_code, 401)

    def test_ohne_garmin_verbindung(self):
        r = self.client.get("/api/v1/garmin/events", headers=self.h)
        self.assertEqual(r.status_code, 409)

    def test_anmeldung_als_ersatz_und_zwischenspeicher(self):
        os.makedirs(tools.garmin_sync.token_path(self.aid))
        cal = FakeCalendar({(date.today().year, date.today().month): [ev(7, date.today().isoformat(), "Stadtlauf")]})
        with mock.patch.object(tools.garmin_sync, "connect", return_value=cal) as connect:
            data = self.client.get("/api/v1/garmin/events", headers=self.h).get_json()["data"]
            self.client.get("/api/v1/garmin/events", headers=self.h)
        self.assertEqual((data["via"], [e["name"] for e in data["events"]]), ("connect", ["Stadtlauf"]))
        self.assertEqual(connect.call_count, 1)  # zweiter Aufruf aus dem Zwischenspeicher

    def test_schluessel_ohne_kalender_meldet_was_fehlt(self):
        with mock.patch.object(personal_api, "has_key", return_value=True), \
             mock.patch.object(garmin_events, "fetch_events", side_effect=personal_api.GarminApiError("Garmin antwortet mit Fehler 403")):
            r = self.client.get("/api/v1/garmin/events", headers=self.h)
        self.assertEqual(r.status_code, 409)
        self.assertIn("Trainings auf die Uhr", r.get_json()["error"])

    def test_schluessel_404_weicht_auf_anmeldung_aus(self):
        """Personal API kennt den Kalender nicht (404 -> None): nicht still
        "0 Events" melden, sondern die Garmin-Anmeldung fragen."""
        os.makedirs(tools.garmin_sync.token_path(self.aid))
        today = date.today()
        cal = FakeCalendar({(today.year, today.month): [ev(8, today.isoformat(), "Silvesterlauf")]})
        with mock.patch.object(personal_api, "has_key", return_value=True), \
             mock.patch.object(personal_api.PersonalApiClient, "__init__", return_value=None), \
             mock.patch.object(personal_api.PersonalApiClient, "_get", return_value=None), \
             mock.patch.object(tools.garmin_sync, "connect", return_value=cal):
            data = self.client.get("/api/v1/garmin/events", headers=self.h).get_json()["data"]
        self.assertEqual((data["via"], [e["name"] for e in data["events"]]), ("connect", ["Silvesterlauf"]))

    def test_schluessel_404_ohne_anmeldung_sagt_was_fehlt(self):
        with mock.patch.object(personal_api, "has_key", return_value=True), \
             mock.patch.object(personal_api.PersonalApiClient, "__init__", return_value=None), \
             mock.patch.object(personal_api.PersonalApiClient, "_get", return_value=None):
            r = self.client.get("/api/v1/garmin/events", headers=self.h)
        self.assertEqual(r.status_code, 409)
        self.assertIn("Trainings auf die Uhr", r.get_json()["error"])

    def test_schluessel_leer_dann_anmeldung_fragen(self):
        os.makedirs(tools.garmin_sync.token_path(self.aid))
        today = date.today()
        cal = FakeCalendar({(today.year, today.month): [ev(9, today.isoformat(), "Crosslauf")]})
        with mock.patch.object(personal_api, "has_key", return_value=True), \
             mock.patch.object(personal_api.PersonalApiClient, "__init__", return_value=None), \
             mock.patch.object(personal_api.PersonalApiClient, "_get", return_value={"calendarItems": []}), \
             mock.patch.object(tools.garmin_sync, "connect", return_value=cal):
            data = self.client.get("/api/v1/garmin/events", headers=self.h).get_json()["data"]
        self.assertEqual([e["name"] for e in data["events"]], ["Crosslauf"])


if __name__ == "__main__":
    unittest.main()
