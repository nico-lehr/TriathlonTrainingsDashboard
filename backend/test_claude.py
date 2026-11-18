"""Claude ueber den Server: Schluessel nur fuer den Betreiber, nie zurueck,
Freigabe fuer andere, verstaendliche Fehler. Das Anthropic-SDK wird komplett
ersetzt (FakeClient) - es geht nie eine echte Anfrage an Claude.

Aufruf im Projektordner:  python -m unittest backend.test_claude -v
"""
import json
import os
import shutil
import stat
import tempfile
import types
import unittest
from unittest import mock

from backend import auth, claude_api, create_app
from backend.config import config

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"

KEY = "sk-ant-test-" + "x" * 40


class FakeErrors:
    """Nachbau der SDK-Fehlerklassen (gleiche Namen, gleiche Vererbung)."""
    class AnthropicError(Exception):
        pass

    class APIConnectionError(AnthropicError):
        pass

    class APIStatusError(AnthropicError):
        message = ""

    class AuthenticationError(APIStatusError):
        pass

    class PermissionDeniedError(APIStatusError):
        pass

    class NotFoundError(APIStatusError):
        pass

    class RateLimitError(APIStatusError):
        pass

    class BadRequestError(APIStatusError):
        pass


class FakeClient:
    calls = []
    raise_on_retrieve = None
    reply = None
    # Sammelauftraege: id -> {"status": "in_progress"|"ended", "result": SimpleNamespace}
    batches = {}

    def __init__(self):
        outer = self
        self.models = types.SimpleNamespace(retrieve=lambda model: outer._retrieve(model))
        batches = types.SimpleNamespace(create=lambda **kw: outer._batch_create(kw),
                                        retrieve=lambda bid: outer._batch_retrieve(bid),
                                        results=lambda bid: outer._batch_results(bid))
        self.messages = types.SimpleNamespace(create=lambda **kw: outer._create(False, kw), batches=batches)
        self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(create=lambda **kw: outer._create(True, kw)))

    def _batch_create(self, kw):
        FakeClient.calls.append(("batch_create", kw))
        bid = f"msgbatch_{len(FakeClient.batches) + 1}"
        FakeClient.batches[bid] = {"status": "in_progress", "result": None}
        return types.SimpleNamespace(id=bid, processing_status="in_progress")

    def _batch_retrieve(self, bid):
        FakeClient.calls.append(("batch_retrieve", bid))
        return types.SimpleNamespace(id=bid, processing_status=FakeClient.batches[bid]["status"])

    def _batch_results(self, bid):
        FakeClient.calls.append(("batch_results", bid))
        return iter([types.SimpleNamespace(custom_id="auftrag", result=FakeClient.batches[bid]["result"])])

    def _retrieve(self, model):
        FakeClient.calls.append(("retrieve", model))
        if FakeClient.raise_on_retrieve:
            raise FakeClient.raise_on_retrieve

    def _create(self, beta, kw):
        FakeClient.calls.append(("beta" if beta else "create", kw))
        return FakeClient.reply or types.SimpleNamespace(
            stop_reason="end_turn", content=[types.SimpleNamespace(type="text", text='  {"ok": true}  ')])


class ClaudeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, session_factory = create_app()
        session = session_factory()
        auth.create_login(session, "betreiber", "langes-passwort-1")  # erster Benutzer = Betreiber
        auth.create_login(session, "freund", "langes-passwort-2")
        session.close()
        client = cls.app.test_client()

        def login(name, pw):
            t = client.post("/api/v1/auth/login", json={"username": name, "password": pw}).get_json()["data"]["token"]
            return {"Authorization": f"Bearer {t}"}
        cls.admin = login("betreiber", "langes-passwort-1")
        cls.friend = login("freund", "langes-passwort-2")

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        FakeClient.calls = []
        FakeClient.raise_on_retrieve = None
        FakeClient.reply = None
        FakeClient.batches = {}
        self.patches = [
            mock.patch.object(claude_api, "KEY_DIR", self.dir),
            mock.patch.object(claude_api, "_client", lambda key: (FakeErrors, FakeClient())),
            mock.patch.object(claude_api, "sdk_available", lambda: True),
        ]
        for p in self.patches:
            p.start()
        self.client = self.app.test_client()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def put(self, headers, **body):
        return self.client.put("/api/v1/ai/claude", headers=headers, json=body)

    def test_nur_mit_login(self):
        self.assertEqual(self.client.get("/api/v1/ai/claude").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/ai/claude/chat", json={"prompt": "x"}).status_code, 401)

    def test_schluessel_wird_geprueft_gespeichert_und_nie_zurueckgegeben(self):
        r = self.put(self.admin, key=KEY)
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(FakeClient.calls, [("retrieve", claude_api.DEFAULT_MODEL)])  # pruefen ohne Text zu erzeugen
        self.assertNotIn(KEY, r.get_data(as_text=True))
        g = self.client.get("/api/v1/ai/claude", headers=self.admin)
        self.assertNotIn(KEY, g.get_data(as_text=True))
        st = g.get_json()["data"]
        self.assertTrue(st["configured"] and st["available"] and st["admin"])
        path = os.path.join(self.dir, "claude_api.json")
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        with open(path) as f:
            self.assertEqual(json.load(f)["key"], KEY)

    def test_freund_darf_nichts_aendern_und_ohne_freigabe_nicht_nutzen(self):
        self.put(self.admin, key=KEY)
        self.assertEqual(self.put(self.friend, key=KEY).status_code, 403)
        self.assertEqual(self.put(self.friend, shared=True).status_code, 403)
        self.assertEqual(self.client.delete("/api/v1/ai/claude", headers=self.friend).status_code, 403)
        st = self.client.get("/api/v1/ai/claude", headers=self.friend).get_json()["data"]
        self.assertFalse(st["available"])
        r = self.client.post("/api/v1/ai/claude/chat", headers=self.friend, json={"prompt": "Hallo"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual([c for c in FakeClient.calls if c[0] != "retrieve"], [])
        # Nach der Freigabe darf der Freund.
        self.put(self.admin, shared=True)
        r = self.client.post("/api/v1/ai/claude/chat", headers=self.friend, json={"prompt": "Hallo"})
        self.assertEqual(r.status_code, 200)

    def test_abgelehnter_schluessel_wird_nicht_gespeichert(self):
        FakeClient.raise_on_retrieve = FakeErrors.AuthenticationError("401")
        r = self.put(self.admin, key=KEY)
        self.assertEqual(r.status_code, 502)
        self.assertIn("abgelehnt", r.get_json()["error"])
        self.assertFalse(os.path.exists(os.path.join(self.dir, "claude_api.json")))

    def test_unsinniger_schluessel_400(self):
        self.assertEqual(self.put(self.admin, key="kurz").status_code, 400)
        self.assertEqual(self.put(self.admin, key="sk-ant mit leerzeichen und so weiter").status_code, 400)
        self.assertEqual(FakeClient.calls, [])

    def test_chat_mit_schema_und_fallback(self):
        self.put(self.admin, key=KEY)
        schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}
        r = self.client.post("/api/v1/ai/claude/chat", headers=self.admin, json={"prompt": "Plan?", "task": "mobility", "schema": schema})
        self.assertEqual(r.get_json()["data"]["response"], '{"ok": true}')
        kind, kw = FakeClient.calls[-1]
        self.assertEqual(kind, "beta")  # Opus: mit Ausweich-Modell bei Ablehnung
        self.assertEqual(kw["fallbacks"], "default")
        self.assertEqual(kw["model"], "claude-opus-5-5")
        self.assertEqual(kw["output_config"]["format"], {"type": "json_schema", "schema": schema})
        self.assertEqual(kw["max_tokens"], claude_api.MAX_TOKENS["mobility"])
        self.assertNotIn("thinking", kw)

    def test_tages_check_aufgabe(self):
        self.put(self.admin, key=KEY)
        schema = {"type": "object", "properties": {"pruefung": {"type": "string"}}, "required": ["pruefung"], "additionalProperties": False}
        self.client.post("/api/v1/ai/claude/chat", headers=self.admin, json={"prompt": "Heute?", "task": "dailycheck", "schema": schema})
        _, kw = FakeClient.calls[-1]
        self.assertEqual(kw["output_config"]["effort"], "medium")
        self.assertEqual(kw["output_config"]["format"], {"type": "json_schema", "schema": schema})
        self.assertEqual(kw["max_tokens"], claude_api.MAX_TOKENS_DEFAULT)

    def test_haiku_ohne_fallback(self):
        self.put(self.admin, key=KEY, model="claude-haiku-5-5")
        self.client.post("/api/v1/ai/claude/chat", headers=self.admin, json={"prompt": "x"})
        kind, kw = FakeClient.calls[-1]
        self.assertEqual(kind, "create")
        self.assertEqual(kw["model"], "claude-haiku-5-5")
        self.assertEqual(kw["output_config"], {"effort": "low"})

    def test_modell_je_aufgabe_gilt_fuer_alle(self):
        self.put(self.admin, key=KEY, shared=True)
        r = self.put(self.admin, task_models={"analysis": "claude-sonnet-5-5", "coach": "claude-haiku-5-5"})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["data"]["task_models"], {"analysis": "claude-sonnet-5-5", "coach": "claude-haiku-5-5"})
        self.assertEqual([g["id"] for g in r.get_json()["data"]["task_groups"]], ["plan", "analysis", "coach", "mobility"])

        def model(headers, task):
            self.client.post("/api/v1/ai/claude/chat", headers=headers, json={"prompt": "x", "task": task})
            return FakeClient.calls[-1][1]["model"]
        self.assertEqual(model(self.friend, "plan"), "claude-opus-5-5")  # ohne eigene Wahl: Standard
        self.assertEqual(model(self.friend, "analysis"), "claude-sonnet-5-5")
        self.assertEqual(model(self.friend, "lessons"), "claude-sonnet-5-5")
        self.assertEqual(model(self.admin, "morning"), "claude-haiku-5-5")
        self.assertEqual(model(self.admin, ""), "claude-haiku-5-5")
        # "" setzt auf den Standard zurück, der Standard selbst bleibt wählbar
        self.put(self.admin, task_models={"analysis": ""}, model="claude-sonnet-5-5")
        self.assertEqual(model(self.admin, "analysis"), "claude-sonnet-5-5")
        self.assertEqual(model(self.admin, "plan"), "claude-sonnet-5-5")
        # nur der Betreiber, nur bekannte Gruppen und Modelle
        self.assertEqual(self.put(self.friend, task_models={"plan": "claude-haiku-5-5"}).status_code, 403)
        self.assertEqual(self.put(self.admin, task_models={"plan": "gpt-4"}).status_code, 400)
        self.assertEqual(self.put(self.admin, task_models={"egal": "claude-haiku-5-5"}).status_code, 400)

    def test_nachdenken_beim_trainingsplan_waehlbar(self):
        self.put(self.admin, key=KEY, shared=True)

        def effort(headers, task):
            self.client.post("/api/v1/ai/claude/chat", headers=headers, json={"prompt": "x", "task": task})
            return FakeClient.calls[-1][1]["output_config"]["effort"]
        # Standard: wenig - fuer Plan und Coach-Nachricht, der Rest unveraendert
        self.assertEqual(self.client.get("/api/v1/ai/claude", headers=self.admin).get_json()["data"]["plan_effort"], "low")
        self.assertEqual(effort(self.friend, "plan"), "low")
        self.assertEqual(effort(self.friend, "replan"), "low")
        self.assertEqual(effort(self.friend, "dailycheck"), "medium")
        self.assertEqual(effort(self.friend, "alternative"), "low")
        r = self.put(self.admin, plan_effort="medium")
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(r.get_json()["data"]["plan_effort"], "medium")
        self.assertEqual(effort(self.friend, "plan"), "medium")
        self.assertEqual(effort(self.friend, "replan"), "medium")
        self.assertEqual(effort(self.friend, "analysis"), "low")
        # nur der Betreiber, nur bekannte Stufen
        self.assertEqual(self.put(self.friend, plan_effort="low").status_code, 403)
        self.assertEqual(self.put(self.admin, plan_effort="max").status_code, 400)

    def _fertig(self, bid, text='{"workouts": []}', stop="end_turn", kind="succeeded"):
        msg = types.SimpleNamespace(stop_reason=stop, model="claude-opus-5-5",
                                    usage=types.SimpleNamespace(input_tokens=10_000, output_tokens=4_000),
                                    content=[types.SimpleNamespace(type="text", text=text)])
        FakeClient.batches[bid] = {"status": "ended",
                                   "result": types.SimpleNamespace(type=kind, message=msg if kind == "succeeded" else None)}

    def test_sammelauftrag_abgeben_und_abholen(self):
        from backend import usage
        self.put(self.admin, key=KEY, shared=True, plan_effort="low")
        r = self.client.post("/api/v1/ai/claude/batch", headers=self.friend, json={"prompt": "Plan bitte", "task": "planbatch"})
        self.assertEqual(r.status_code, 200, r.get_json())
        bid = r.get_json()["data"]["id"]
        kind, kw = FakeClient.calls[-1]
        self.assertEqual(kind, "batch_create")
        params = kw["requests"][0]["params"]
        self.assertEqual(params["model"], "claude-opus-5-5")
        self.assertEqual(params["output_config"], {"effort": "low"})
        self.assertNotIn("fallbacks", params)  # gibt es bei Sammelauftraegen nicht
        self.assertEqual(params["messages"], [{"role": "user", "content": "Plan bitte"}])
        # Noch in Arbeit
        get = lambda h: self.client.get(f"/api/v1/ai/claude/batch/{bid}", headers=h)
        self.assertEqual(get(self.friend).get_json()["data"], {"status": "pending"})
        # Fremde Auftraege sind nicht abrufbar
        self.assertEqual(get(self.admin).status_code, 404)
        self.assertEqual(self.client.get("/api/v1/ai/claude/batch/x/../y", headers=self.friend).status_code, 404)
        # Fertig: Text kommt, Kosten zaehlen genau einmal und zum halben Preis
        recorded = []
        with mock.patch.object(usage, "record_ai_call", lambda *a, **k: recorded.append((a, k))):
            self._fertig(bid, '  {"workouts": [1]}  ')
            self.assertEqual(get(self.friend).get_json()["data"], {"status": "done", "text": '{"workouts": [1]}', "error": None})
            self.assertEqual(get(self.friend).get_json()["data"]["status"], "done")
        self.assertEqual(len(recorded), 1)
        (aid, task, tokens), _ = recorded[0]
        self.assertEqual(task, "planbatch")
        self.assertEqual((tokens["in"], tokens["out"], tokens["batch"]), (10_000, 4_000, True))
        # Opus: 10.000 x 4 $ + 4.000 x 20 $ je Mio. = 0,12 $ - halbiert 0,06 $
        self.assertEqual(claude_api.cost_micro_usd("claude-opus-5-5", 10_000, 4_000, batch=True), 60_000)
        self.assertEqual(claude_api.cost_micro_usd("claude-opus-5-5", 10_000, 4_000), 120_000)
        # Die Auftrags-Datei ist nur fuer den eigenen Benutzer lesbar
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.dir, claude_api.BATCH_FILE)).st_mode), 0o600)

    def test_sammelauftrag_fehler_und_grenzen(self):
        self.put(self.admin, key=KEY)
        post = lambda body: self.client.post("/api/v1/ai/claude/batch", headers=self.admin, json=body)
        # Nur der automatische Plan darf als Sammelauftrag laufen
        self.assertEqual(post({"prompt": "x", "task": "analysis"}).status_code, 400)
        self.assertEqual(post({"prompt": "", "task": "planbatch"}).status_code, 400)
        # Freund ohne Freigabe: nicht erlaubt
        self.assertEqual(self.client.post("/api/v1/ai/claude/batch", headers=self.friend, json={"prompt": "x", "task": "planbatch"}).status_code, 403)
        # Abgelaufen / abgeschnitten -> failed mit verstaendlicher Meldung
        bid = post({"prompt": "x", "task": "planbatch"}).get_json()["data"]["id"]
        self._fertig(bid, kind="expired")
        data = self.client.get(f"/api/v1/ai/claude/batch/{bid}", headers=self.admin).get_json()["data"]
        self.assertEqual(data["status"], "failed")
        self.assertIn("abgelaufen", data["error"])
        bid2 = post({"prompt": "x", "task": "planbatch"}).get_json()["data"]["id"]
        self._fertig(bid2, stop="max_tokens")
        data = self.client.get(f"/api/v1/ai/claude/batch/{bid2}", headers=self.admin).get_json()["data"]
        self.assertEqual(data["status"], "failed")
        self.assertIn("abgeschnitten", data["error"])
        # Unbekannte ID
        self.assertEqual(self.client.get("/api/v1/ai/claude/batch/msgbatch_999", headers=self.admin).status_code, 404)

    def test_kosten_mit_dem_modell_das_geantwortet_hat(self):
        self.put(self.admin, key=KEY)
        FakeClient.reply = types.SimpleNamespace(stop_reason="end_turn", model="claude-opus-5",
                                                 usage=types.SimpleNamespace(input_tokens=1000, output_tokens=500),
                                                 content=[types.SimpleNamespace(type="text", text="ok")])
        calls = []
        with mock.patch("backend.usage.record_many", lambda aid, items, sf=None: calls.extend(items)):
            r = self.client.post("/api/v1/ai/claude/chat", headers=self.admin, json={"prompt": "x", "task": "plan"})
        self.assertEqual(r.status_code, 200)
        got = {(k, n): v for k, n, v in calls}
        self.assertEqual(got[("ai_model", "claude-opus-5")], 1)  # Ausweich-Modell, nicht das eingestellte
        self.assertEqual(got[("ai_cost", "claude-opus-5")], 1000 * 5 + 500 * 25)  # Millionstel Dollar
        self.assertEqual(got[("ai_cost_task", "plan")], 17_500)
        self.assertEqual(got[("ai", "plan")], 1)

    def test_unbekanntes_modell_400(self):
        self.put(self.admin, key=KEY)
        self.assertEqual(self.put(self.admin, model="gpt-4").status_code, 400)

    def test_ablehnung_und_abgeschnitten_verstaendlich(self):
        self.put(self.admin, key=KEY)
        FakeClient.reply = types.SimpleNamespace(stop_reason="refusal", content=[])
        r = self.client.post("/api/v1/ai/claude/chat", headers=self.admin, json={"prompt": "x"})
        self.assertEqual(r.status_code, 422)
        FakeClient.reply = types.SimpleNamespace(stop_reason="max_tokens", content=[types.SimpleNamespace(type="text", text="{")])
        r = self.client.post("/api/v1/ai/claude/chat", headers=self.admin, json={"prompt": "x"})
        self.assertIn("abgeschnitten", r.get_json()["error"])

    def test_ohne_schluessel_409_und_ohne_prompt_400(self):
        self.assertEqual(self.client.post("/api/v1/ai/claude/chat", headers=self.admin, json={"prompt": "x"}).status_code, 409)
        self.assertEqual(self.client.post("/api/v1/ai/claude/chat", headers=self.admin, json={}).status_code, 400)

    def _quota_zuruecksetzen(self):
        import backend
        from backend.models import UsageDaily
        session = backend.Session()
        session.query(UsageDaily).filter_by(kind="quota").delete()
        session.commit()
        session.close()

    def _frage(self, headers):
        return self.client.post("/api/v1/ai/claude/chat", headers=headers, json={"prompt": "Hallo"})

    def test_tagesgrenze_je_person_der_betreiber_ist_frei(self):
        self._quota_zuruecksetzen()
        self.put(self.admin, key=KEY, shared=True)
        st = self.client.get("/api/v1/ai/claude", headers=self.admin).get_json()["data"]
        self.assertEqual(st["daily_limit"], claude_api.DAILY_LIMIT_DEFAULT)
        self.assertEqual(self.put(self.friend, daily_limit=0).status_code, 403)  # nur der Betreiber
        self.assertEqual(self.put(self.admin, daily_limit=-1).status_code, 400)
        self.assertEqual(self.put(self.admin, daily_limit="5").status_code, 400)
        self.assertEqual(self.put(self.admin, daily_limit=claude_api.DAILY_LIMIT_MAX + 1).status_code, 400)
        self.assertEqual(self.put(self.admin, daily_limit=2).status_code, 200)

        self.assertEqual(self._frage(self.friend).status_code, 200)
        q = self.client.get("/api/v1/ai/claude", headers=self.friend).get_json()["data"]
        self.assertEqual(q["quota"], {"limit": 2, "used": 1, "exempt": False})
        self.assertNotIn("daily_limit", q)  # die Einstellung sieht nur der Betreiber
        self.assertEqual(self._frage(self.friend).status_code, 200)
        calls = len(FakeClient.calls)
        r = self._frage(self.friend)
        self.assertEqual(r.status_code, 429)
        self.assertEqual(r.get_json()["code"], "claude_daily_limit")
        self.assertIn("2 Anfragen", r.get_json()["error"])
        self.assertEqual(len(FakeClient.calls), calls)  # Claude wurde gar nicht erst gefragt
        # Sammelauftrag zaehlt mit
        r = self.client.post("/api/v1/ai/claude/batch", headers=self.friend, json={"prompt": "x", "task": "planbatch"})
        self.assertEqual(r.status_code, 429)
        # Betreiber: keine Grenze, wird aber mitgezaehlt
        for _ in range(3):
            self.assertEqual(self._frage(self.admin).status_code, 200)
        q = self.client.get("/api/v1/ai/claude", headers=self.admin).get_json()["data"]["quota"]
        self.assertEqual(q, {"limit": 0, "used": 3, "exempt": True})
        # Hoeher stellen gibt sofort wieder frei, 0 = ohne Grenze
        self.put(self.admin, daily_limit=3)
        self.assertEqual(self._frage(self.friend).status_code, 200)
        self.assertEqual(self._frage(self.friend).status_code, 429)
        self.put(self.admin, daily_limit=0)
        self.assertEqual(self._frage(self.friend).status_code, 200)

    def test_tagesgrenze_fehlgeschlagene_anfrage_ohne_kosten_zaehlt_nicht(self):
        self._quota_zuruecksetzen()
        self.put(self.admin, key=KEY, shared=True, daily_limit=1)

        def kaputt(beta, kw):
            raise FakeErrors.APIConnectionError("weg")
        with mock.patch.object(FakeClient, "_create", lambda self, beta, kw: kaputt(beta, kw)):
            self.assertGreaterEqual(self._frage(self.friend).status_code, 500)
        self.assertEqual(self._frage(self.friend).status_code, 200)  # Versuch nicht verloren
        self.assertEqual(self._frage(self.friend).status_code, 429)

    def test_entfernen(self):
        self.put(self.admin, key=KEY)
        r = self.client.delete("/api/v1/ai/claude", headers=self.admin)
        self.assertFalse(r.get_json()["data"]["configured"])
        self.assertFalse(os.path.exists(os.path.join(self.dir, "claude_api.json")))


if __name__ == "__main__":
    unittest.main()
