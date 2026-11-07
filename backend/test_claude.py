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

    def __init__(self):
        outer = self
        self.models = types.SimpleNamespace(retrieve=lambda model: outer._retrieve(model))
        self.messages = types.SimpleNamespace(create=lambda **kw: outer._create(False, kw))
        self.beta = types.SimpleNamespace(messages=types.SimpleNamespace(create=lambda **kw: outer._create(True, kw)))

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

    def test_entfernen(self):
        self.put(self.admin, key=KEY)
        r = self.client.delete("/api/v1/ai/claude", headers=self.admin)
        self.assertFalse(r.get_json()["data"]["configured"])
        self.assertFalse(os.path.exists(os.path.join(self.dir, "claude_api.json")))


if __name__ == "__main__":
    unittest.main()
