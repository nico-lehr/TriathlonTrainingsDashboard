"""Admin-Statistik: Zaehler (nur Zahlen, keine Inhalte) und Abruf nur fuer den Betreiber.

Aufruf im Projektordner:  python -m unittest backend.test_usage -v
Datenbank im Arbeitsspeicher, keine echten Garmin- oder Claude-Aufrufe.
"""
import os
import unittest
from datetime import date, timedelta
from unittest import mock

from backend import auth, create_app, routes, usage
from backend.config import config
from backend.models import AthleteLogin, AthleteStore, UsageDaily, Workout

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"
app, _ = create_app()
PASSWORD = "richtig-langes-passwort"
ADMIN_ENV = mock.patch.dict(os.environ, {"ADMIN_USERS": "betreiber"})


def ensure(username):
    session = routes.get_session()
    try:
        login = session.query(AthleteLogin).filter_by(username=username).first()
        return login.athlete_id if login else auth.create_login(session, username, PASSWORD, claim_unclaimed=False)
    finally:
        session.close()


class UsageTest(unittest.TestCase):
    def setUp(self):
        ADMIN_ENV.start()
        self.addCleanup(ADMIN_ENV.stop)
        auth._failed_logins.clear()
        auth._failed_users.clear()
        self.admin_id = ensure("betreiber")
        self.friend_id = ensure("freundin")
        session = routes.get_session()
        session.query(UsageDaily).delete()
        session.query(Workout).filter(Workout.athlete_id.in_([self.admin_id, self.friend_id])).delete(synchronize_session=False)
        session.commit()
        session.close()
        self.client = app.test_client()
        with app.app_context():
            self.admin = {"Authorization": "Bearer " + auth.make_token(self.admin_id)}
            self.friend = {"Authorization": "Bearer " + auth.make_token(self.friend_id)}
        patcher = mock.patch("tools.garmin_personal_api.has_key", lambda aid: aid == self.friend_id)
        patcher.start()
        self.addCleanup(patcher.stop)

    def rows(self, athlete_id):
        session = routes.get_session()
        try:
            return {(r.kind, r.name): r.count for r in session.query(UsageDaily).filter_by(athlete_id=athlete_id)}
        finally:
            session.close()

    def test_nur_mit_login(self):
        self.assertEqual(self.client.post("/api/v1/usage", json={"events": []}).status_code, 401)
        self.assertEqual(self.client.get("/api/v1/admin/stats").status_code, 401)

    def test_nur_erlaubte_namen_werden_gezaehlt(self):
        r = self.client.post("/api/v1/usage", headers=self.friend, json={"events": [
            {"kind": "open", "name": "mobile"}, {"kind": "page", "name": "coach"}, {"kind": "page", "name": "coach"},
            {"kind": "page", "name": "<script>"}, {"kind": "geheim", "name": "x"}, "kaputt",
            {"kind": "feature", "name": "outlook"}]})
        self.assertEqual(r.get_json()["data"]["saved"], 4)
        self.assertEqual(self.rows(self.friend_id), {("open", "mobile"): 1, ("page", "coach"): 2, ("feature", "outlook"): 1})
        self.assertEqual(self.client.post("/api/v1/usage", headers=self.friend, json={"x": 1}).status_code, 400)

    def test_hoechstens_50_ereignisse_je_anfrage(self):
        self.client.post("/api/v1/usage", headers=self.friend, json={"events": [{"kind": "page", "name": "heute"}] * 500})
        self.assertEqual(self.rows(self.friend_id)[("page", "heute")], usage.MAX_EVENTS_PER_REQUEST)

    def test_login_wird_gezaehlt(self):
        r = self.client.post("/api/v1/auth/login", json={"username": "freundin", "password": PASSWORD})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.rows(self.friend_id).get(("login", "ok")), 1)

    def test_statistik_nur_fuer_betreiber(self):
        r = self.client.get("/api/v1/admin/stats", headers=self.friend)
        self.assertEqual(r.status_code, 403)

    def test_statistik_summen_ohne_inhalte(self):
        session = routes.get_session()
        today = date.today()
        usage.bump(session, self.friend_id, "open", "desktop", 3)
        usage.bump(session, self.friend_id, "page", "kalender", 2, day=today - timedelta(days=2))
        usage.bump(session, self.friend_id, "ai", "chat", 5)
        usage.bump(session, self.friend_id, "garmin", "fehler")
        usage.bump(session, self.admin_id, "open", "mobile", day=today - timedelta(days=40))  # ausserhalb 30 Tage
        session.add(Workout(athlete_id=self.friend_id, date=today, sport="running", sub_sport="Geheimer Titel", duration_min=90))
        session.add(AthleteStore(athlete_id=self.friend_id, key="triathlon_dashboard_goals_v1", value=[{"name": "Ironman"}]))
        session.commit()
        session.close()

        data = self.client.get("/api/v1/admin/stats?days=30", headers=self.admin).get_json()["data"]
        friend = next(u for u in data["users"] if u["username"] == "freundin")
        self.assertEqual(friend["opens"], {"desktop": 3})
        self.assertEqual(friend["active_days"], 2)
        self.assertEqual(friend["ai_requests"], 5)
        self.assertEqual(friend["garmin"], {"connected": True, "ok": 0, "fehler": 1})
        self.assertEqual((friend["workouts"], friend["hours"]), (1, 1.5))
        self.assertTrue(friend["goal"])
        admin = next(u for u in data["users"] if u["username"] == "betreiber")
        self.assertEqual(admin["active_days"], 0)
        self.assertEqual(admin["last_seen"], (today - timedelta(days=40)).isoformat())
        self.assertEqual(data["totals"]["active"], 1)
        self.assertEqual(len(data["daily_active"]), 30)
        self.assertEqual(len(data["weekly_active"]), 12)
        # Nur Zahlen: weder Trainingstitel noch Zielname tauchen auf
        text = str(data)
        self.assertNotIn("Geheimer Titel", text)
        self.assertNotIn("Ironman", text)

    def test_ki_kosten_je_modell_und_aufgabe(self):
        # Opus: 10.000 Tokens rein, 2.000 raus = 0,04 + 0,04 = 0,08 $
        usage.record_ai_call(self.friend_id, "plan", {"in": 10_000, "out": 2_000, "model": "claude-opus-5-5"})
        # Sonnet: 5.000 rein, 1.000 raus = 0,01 + 0,01 = 0,02 $ (zweimal)
        usage.record_ai_call(self.friend_id, "analysis", {"in": 5_000, "out": 1_000, "model": "claude-sonnet-5-5"})
        usage.record_ai_call(self.admin_id, "analysis", {"in": 5_000, "out": 1_000, "model": "claude-sonnet-5-5"})
        # Abgeschnittene Antwort: kostet trotzdem, zählt als Fehler
        usage.record_ai_call(self.admin_id, "morning", {"in": 1_000_000, "out": 0, "model": "claude-haiku-5-5"}, ok=False, error_code="claude_too_long")
        # Unbekanntes Modell: Tokens ja, Kosten nein
        usage.record_ai_call(self.admin_id, "plan", {"in": 100, "out": 100, "model": "claude-zukunft-9"})
        # Alte Zählung ohne Modell (vor 2.4.37)
        usage.record(self.admin_id, "ai_tokens", "in", 7)

        data = self.client.get("/api/v1/admin/stats?days=30", headers=self.admin).get_json()["data"]
        models = {m["model"]: m for m in data["ai_models"]}
        self.assertEqual(models["claude-opus-5-5"]["cost_usd"], 0.08)
        self.assertEqual(models["claude-opus-5-5"]["label"], "Opus 5.5")
        self.assertEqual((models["claude-sonnet-5-5"]["requests"], models["claude-sonnet-5-5"]["tokens_in"], models["claude-sonnet-5-5"]["cost_usd"]), (2, 10_000, 0.04))
        # Haiku über 100.000 Tokens: höherer Preis 0,50 $ je Million
        self.assertEqual(models["claude-haiku-5-5"]["cost_usd"], 0.5)
        self.assertFalse(models["claude-zukunft-9"]["price_known"])
        self.assertEqual(models["claude-zukunft-9"]["cost_usd"], 0)
        self.assertEqual(data["ai_models"][0]["model"], "claude-haiku-5-5")  # teuerstes zuerst
        self.assertEqual(data["totals"]["ai_cost_usd"], 0.62)
        self.assertEqual(data["ai_cost_tasks"], {"plan": 0.08, "analysis": 0.04, "morning": 0.5})
        self.assertEqual(data["ai_tokens_without_model"], {"in": 7, "out": 0})
        self.assertEqual(data["totals"]["ai_errors"], 1)
        friend = next(u for u in data["users"] if u["username"] == "freundin")
        self.assertEqual(friend["ai_cost_usd"], 0.1)
        self.assertEqual(friend["ai_requests"], 2)

    def test_zaehler_hat_deckel(self):
        session = routes.get_session()
        usage.bump(session, self.friend_id, "page", "heute", 10**6)
        session.commit()
        session.close()
        self.assertEqual(self.rows(self.friend_id)[("page", "heute")], usage.MAX_PER_DAY)


if __name__ == "__main__":
    unittest.main()
