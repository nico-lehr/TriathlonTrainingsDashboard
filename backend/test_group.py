"""Gruppe: Highlights, Reaktionen, Challenges - und vor allem, dass nur
Ergebnisse geteilt werden und wer nicht mitmacht, nichts sieht.

Aufruf im Projektordner:  python -m unittest backend.test_group -v
Laeuft gegen eine Datenbank im Arbeitsspeicher - training.db bleibt unberuehrt.
"""
import json
import unittest
from datetime import date, datetime, timedelta

from backend import auth, create_app
from backend.config import config
from backend.models import (Challenge, ChallengeMember, GroupHighlight, GroupMember, GroupReaction, Workout)

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"

PASSWORD = "richtig-langes-passwort"


def now_iso(delta=timedelta()):
    return (datetime.utcnow() + delta).isoformat(timespec="seconds") + "Z"


class GroupTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, cls.session_factory = create_app()
        session = cls.session_factory()
        cls.ids = {}
        for name in ("gr-anna", "gr-tom", "gr-lea"):
            auth.create_login(session, name, PASSWORD)
        session.close()

    def setUp(self):
        auth._failed_logins.clear()
        self.client = self.app.test_client()
        self.anna, self.tom, self.lea = (self.headers(n) for n in ("gr-anna", "gr-tom", "gr-lea"))

    def tearDown(self):
        session = self.session_factory()
        for model in (GroupReaction, GroupHighlight, ChallengeMember, Challenge, GroupMember, Workout):
            session.query(model).delete()
        session.commit()
        session.close()

    # ------------------------------------------------------------ Helfer
    def headers(self, username):
        token = self.client.post("/api/v1/auth/login", json={"username": username, "password": PASSWORD}).get_json()["data"]["token"]
        return {"Authorization": f"Bearer {token}"}

    def uid(self, headers):
        return self.state(headers)["me"]["uid"]

    def state(self, headers):
        r = self.client.get("/api/v1/group", headers=headers)
        self.assertEqual(r.status_code, 200, r.get_json())
        return r.get_json()["data"]

    def join(self, headers, name):
        r = self.client.put("/api/v1/group/me", json={"display_name": name}, headers=headers)
        self.assertEqual(r.status_code, 200, r.get_json())
        return r.get_json()["data"]

    def share(self, headers, *items):
        return self.client.post("/api/v1/group/highlights", json={"items": list(items)}, headers=headers)

    def challenge(self, headers, **fields):
        body = {"title": "Dezember-Kilometer", "kind": "group", "sport": "Rad", "metric": "km",
                "start": date.today().isoformat(), "end": (date.today() + timedelta(days=10)).isoformat(), "target": 100, **fields}
        return self.client.post("/api/v1/group/challenges", json=body, headers=headers)

    def workout(self, headers, sport="Rad", km=30.0, minutes=60, day=None, **fit):
        session = self.session_factory()
        session.add(Workout(athlete_id=self.uid(headers), date=day or date.today(), sport=sport, distance_km=km,
                            duration_min=minutes, avg_hr=151, fit_data={"sport": sport, **fit}))
        session.commit()
        session.close()

    # ------------------------------------------------------------ Tests
    def test_ohne_login_401(self):
        for method, url in [("get", "/api/v1/group"), ("put", "/api/v1/group/me"), ("delete", "/api/v1/group/me"),
                            ("post", "/api/v1/group/highlights"), ("delete", "/api/v1/group/highlights/1"),
                            ("post", "/api/v1/group/highlights/1/reactions"), ("post", "/api/v1/group/challenges"),
                            ("post", "/api/v1/group/challenges/1/join"), ("delete", "/api/v1/group/challenges/1")]:
            with self.subTest(method=method, url=url):
                self.assertEqual(getattr(self.client, method)(url, json={}).status_code, 401)

    def test_wer_nicht_mitmacht_sieht_nichts(self):
        self.join(self.anna, "Anna")
        self.assertEqual(self.share(self.anna, {"type": "count", "value": 100, "achieved_at": now_iso()}).status_code, 200)
        s = self.state(self.tom)
        self.assertFalse(s["me"]["joined"])
        self.assertEqual(s["member_count"], 1)
        for key in ("highlights", "challenges", "members"):
            self.assertNotIn(key, s)
        # Teilen und Reagieren ohne Mitmachen geht nicht.
        self.assertEqual(self.share(self.tom, {"type": "count", "value": 10, "achieved_at": now_iso()}).status_code, 403)
        hid = self.state(self.anna)["highlights"][0]["id"]
        self.assertEqual(self.client.post(f"/api/v1/group/highlights/{hid}/reactions", json={"emoji": "fire"}, headers=self.tom).status_code, 403)
        self.assertEqual(self.challenge(self.tom).status_code, 403)

    def test_anzeigename_wird_geprueft(self):
        for bad in ("", "   ", "x" * 31, 42, None):
            with self.subTest(name=bad):
                r = self.client.put("/api/v1/group/me", json={"display_name": bad}, headers=self.anna)
                self.assertEqual(r.status_code, 400)
        self.join(self.anna, "  Anna   Maria ")
        self.assertEqual(self.state(self.anna)["me"]["display_name"], "Anna Maria")

    def test_abzeichen_teilen_nur_bekannte_und_neue(self):
        self.join(self.anna, "Anna")
        r = self.share(self.anna,
                       {"type": "count", "value": 100, "achieved_at": now_iso()},
                       {"type": "streak", "value": 30, "achieved_at": now_iso()},
                       {"type": "pb", "sport": "Laufen", "meters": 10000, "value": 2892, "achieved_at": now_iso()},
                       {"type": "count", "value": 99, "achieved_at": now_iso()},             # keine Stufe
                       {"type": "pb", "sport": "Laufen", "meters": 4200, "value": 900, "achieved_at": now_iso()},  # keine Distanz
                       {"type": "frei", "value": "Hallo", "achieved_at": now_iso()},           # unbekannte Art
                       {"type": "count", "value": 250, "achieved_at": now_iso(timedelta(days=-1))},  # vor dem Beitritt
                       {"type": "count", "value": 100, "achieved_at": now_iso()})             # doppelt
        self.assertEqual(r.get_json()["data"], {"added": 3, "skipped": 5})
        feed = self.state(self.anna)["highlights"]
        self.assertEqual(sorted(h["kind"] for h in feed), ["count", "pb", "streak"])
        pb = next(h for h in feed if h["kind"] == "pb")
        self.assertEqual(pb["data"], {"sport": "Laufen", "meters": 10000, "value": 2892})
        self.assertTrue(pb["mine"])
        self.assertEqual(pb["name"], "Anna")

    def test_reaktionen_an_und_aus(self):
        self.join(self.anna, "Anna")
        self.join(self.tom, "Tom")
        self.join(self.lea, "Lea")
        self.share(self.anna, {"type": "count", "value": 50, "achieved_at": now_iso()})
        hid = self.state(self.tom)["highlights"][0]["id"]
        url = f"/api/v1/group/highlights/{hid}/reactions"
        self.client.post(url, json={"emoji": "fire"}, headers=self.tom)
        r = self.client.post(url, json={"emoji": "fire"}, headers=self.lea).get_json()["data"]
        self.assertEqual(r["reactions"], [{"emoji": "fire", "count": 2, "mine": True, "names": ["Tom", "Lea"]}])
        # zweiter Tipp nimmt sie wieder weg
        r = self.client.post(url, json={"emoji": "fire"}, headers=self.lea).get_json()["data"]
        self.assertEqual(r["reactions"], [{"emoji": "fire", "count": 1, "mine": False, "names": ["Tom"]}])
        # nicht aufs eigene, nur feste Emojis, unbekannte id
        self.assertEqual(self.client.post(url, json={"emoji": "fire"}, headers=self.anna).status_code, 400)
        self.assertEqual(self.client.post(url, json={"emoji": "💩"}, headers=self.tom).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/group/highlights/999999/reactions", json={"emoji": "fire"}, headers=self.tom).status_code, 404)
        self.assertEqual(self.client.post("/api/v1/group/highlights/99999999999/reactions", json={"emoji": "fire"}, headers=self.tom).status_code, 404)

    def test_nur_eigene_highlights_loeschen(self):
        self.join(self.anna, "Anna")
        self.join(self.tom, "Tom")
        self.share(self.anna, {"type": "count", "value": 50, "achieved_at": now_iso()})
        hid = self.state(self.anna)["highlights"][0]["id"]
        # gr-anna ist als erste angelegt -> Betreiberin; Tom darf nicht
        self.assertEqual(self.client.delete(f"/api/v1/group/highlights/{hid}", headers=self.tom).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/v1/group/highlights/{hid}", headers=self.anna).status_code, 200)
        self.assertEqual(self.state(self.anna)["highlights"], [])

    def test_austreten_loescht_eigene_spuren(self):
        self.join(self.anna, "Anna")
        self.join(self.tom, "Tom")
        self.share(self.anna, {"type": "count", "value": 50, "achieved_at": now_iso()})
        self.share(self.tom, {"type": "count", "value": 25, "achieved_at": now_iso()})
        feed = {h["name"]: h["id"] for h in self.state(self.anna)["highlights"]}
        self.client.post(f"/api/v1/group/highlights/{feed['Tom']}/reactions", json={"emoji": "clap"}, headers=self.anna)
        cid = self.challenge(self.tom).get_json()["data"]["id"]
        self.client.post(f"/api/v1/group/challenges/{cid}/join", headers=self.anna)

        self.assertEqual(self.client.delete("/api/v1/group/me", headers=self.anna).status_code, 200)
        s = self.state(self.tom)
        self.assertEqual([h["name"] for h in s["highlights"]], ["Tom"])
        self.assertEqual(s["highlights"][0]["reactions"], [])
        self.assertEqual([m["name"] for m in s["challenges"][0]["members"]], ["Tom"])
        self.assertEqual([m["name"] for m in s["members"]], ["Tom"])
        self.assertFalse(self.state(self.anna)["me"]["joined"])

    def test_challenge_wird_geprueft(self):
        self.join(self.anna, "Anna")
        today = date.today()
        bad = [
            {"kind": "duell"}, {"sport": "Rudern"}, {"metric": "watt"},
            {"sport": "alle", "metric": "km"},
            {"end": (today - timedelta(days=1)).isoformat()},
            {"start": (today + timedelta(days=5)).isoformat(), "end": (today + timedelta(days=2)).isoformat()},
            {"start": (today - timedelta(days=40)).isoformat()},
            {"end": (today + timedelta(days=400)).isoformat()},
            {"target": 0}, {"target": "viel"}, {"title": ""}, {"title": "x" * 61}, {"start": "morgen"},
        ]
        for fields in bad:
            with self.subTest(fields=fields):
                self.assertEqual(self.challenge(self.anna, **fields).status_code, 400)
        # Rangliste braucht kein Ziel
        self.assertEqual(self.challenge(self.anna, kind="ranking", target=None, sport="alle", metric="hours").status_code, 201)

    def test_gruppenziel_zaehlt_nur_teilnehmer_sportart_und_zeitraum(self):
        self.join(self.anna, "Anna")
        self.join(self.tom, "Tom")
        self.join(self.lea, "Lea")
        cid = self.challenge(self.anna, target=100).get_json()["data"]["id"]
        self.client.post(f"/api/v1/group/challenges/{cid}/join", headers=self.tom)
        self.workout(self.anna, km=30)
        self.workout(self.tom, km=40.5)
        self.workout(self.tom, sport="Laufen", km=12)                       # andere Sportart
        self.workout(self.tom, km=50, day=date.today() - timedelta(days=1))  # vor dem Start
        self.workout(self.tom, km=80, is_summary=True)                      # Tageszusammenfassung
        self.workout(self.lea, km=90)                                       # macht nicht mit
        c = self.state(self.anna)["challenges"][0]
        self.assertEqual(c["total"], 70.5)
        self.assertEqual([(m["name"], m["value"]) for m in c["members"]], [("Tom", 40.5), ("Anna", 30.0)])
        self.assertTrue(c["joined"])
        self.assertIsNone(c["completed"])
        self.assertFalse(self.state(self.lea)["challenges"][0]["joined"])

        # Ziel erreicht -> einmal ein Highlight fuer die ganze Gruppe
        self.workout(self.anna, km=30)
        s = self.state(self.tom)
        self.assertIsNotNone(s["challenges"][0]["completed"])
        group = [h for h in s["highlights"] if h["kind"] == "challenge_group"]
        self.assertEqual(len(group), 1)
        self.assertIsNone(group[0]["uid"])
        self.assertEqual(group[0]["data"]["title"], "Dezember-Kilometer")
        self.state(self.anna)
        self.assertEqual(len([h for h in self.state(self.lea)["highlights"] if h["kind"] == "challenge_group"]), 1)
        # auf das Gruppen-Highlight darf jede/r reagieren
        r = self.client.post(f"/api/v1/group/highlights/{group[0]['id']}/reactions", json={"emoji": "party"}, headers=self.anna)
        self.assertEqual(r.status_code, 200)

    def test_persoenliche_challenge_highlight_je_person(self):
        self.join(self.anna, "Anna")
        self.join(self.tom, "Tom")
        cid = self.challenge(self.anna, kind="personal", sport="Laufen", metric="sessions", target=2).get_json()["data"]["id"]
        self.client.post(f"/api/v1/group/challenges/{cid}/join", headers=self.tom)
        self.workout(self.anna, sport="Laufen", km=8)
        self.workout(self.anna, sport="Laufen", km=10)
        self.workout(self.tom, sport="Laufen", km=5)
        s = self.state(self.tom)
        c = s["challenges"][0]
        self.assertEqual({m["name"]: (m["value"], m["done"]) for m in c["members"]}, {"Anna": (2, True), "Tom": (1, False)})
        done = [h for h in s["highlights"] if h["kind"] == "challenge_done"]
        self.assertEqual([h["name"] for h in done], ["Anna"])
        self.state(self.anna)  # nicht doppelt
        self.assertEqual(len([h for h in self.state(self.tom)["highlights"] if h["kind"] == "challenge_done"]), 1)

    def test_rangliste_nach_dem_ende(self):
        self.join(self.anna, "Anna")
        self.join(self.tom, "Tom")
        cid = self.challenge(self.anna, kind="ranking", target=None, sport="Schwimmen", metric="km",
                             start=(date.today() - timedelta(days=3)).isoformat(), end=date.today().isoformat()).get_json()["data"]["id"]
        self.client.post(f"/api/v1/group/challenges/{cid}/join", headers=self.tom)
        self.workout(self.anna, sport="Schwimmen", km=2.5, day=date.today() - timedelta(days=1))
        self.workout(self.tom, sport="Schwimmen", km=3.8, day=date.today() - timedelta(days=2))
        self.assertEqual(self.state(self.anna)["challenges"][0]["status"], "running")
        self.assertEqual([h for h in self.state(self.anna)["highlights"] if h["kind"] == "challenge_win"], [])
        session = self.session_factory()
        session.get(Challenge, cid).end_date = date.today() - timedelta(days=1)
        session.commit()
        session.close()
        s = self.state(self.anna)
        self.assertEqual(s["challenges"][0]["status"], "ended")
        win = [h for h in s["highlights"] if h["kind"] == "challenge_win"]
        self.assertEqual([(h["name"], h["data"]["value"]) for h in win], [("Tom", 3.8)])
        # vorbei -> nicht mehr beitreten
        self.join(self.lea, "Lea")
        self.assertEqual(self.client.post(f"/api/v1/group/challenges/{cid}/join", headers=self.lea).status_code, 400)

    def test_challenge_loeschen_nur_ersteller_oder_betreiber(self):
        self.join(self.anna, "Anna")
        self.join(self.tom, "Tom")
        self.join(self.lea, "Lea")
        cid = self.challenge(self.tom).get_json()["data"]["id"]
        self.assertEqual(self.client.delete(f"/api/v1/group/challenges/{cid}", headers=self.lea).status_code, 404)
        self.assertFalse(self.state(self.lea)["challenges"][0]["can_delete"])
        self.assertTrue(self.state(self.anna)["challenges"][0]["can_delete"])  # Betreiberin
        self.assertEqual(self.client.delete(f"/api/v1/group/challenges/{cid}", headers=self.tom).status_code, 200)
        self.assertEqual(self.state(self.tom)["challenges"], [])

    def test_keine_trainingsdetails_in_der_antwort(self):
        self.join(self.anna, "Anna")
        self.join(self.tom, "Tom")
        cid = self.challenge(self.anna).get_json()["data"]["id"]
        self.client.post(f"/api/v1/group/challenges/{cid}/join", headers=self.tom)
        self.workout(self.tom, km=42.2, minutes=95, avg_power_w=231, hr=[120, 140])
        self.share(self.tom, {"type": "count", "value": 10, "achieved_at": now_iso()})
        text = json.dumps(self.state(self.anna))
        for secret in ("151", "avg_hr", "231", "power", "fit_data", "hr"):
            self.assertNotIn(f'"{secret}"' if not secret.isdigit() else secret, text)


if __name__ == "__main__":
    unittest.main()
