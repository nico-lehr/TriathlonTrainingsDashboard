"""KI ueber den Server: nur mit Login, Weiterleitung an Ollama, verstaendliche Fehler.
Ollama wird hier durch einen kleinen Test-Server ersetzt - nie ein echtes Modell.

Aufruf im Projektordner:  python -m unittest backend.test_ai -v
"""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from backend import auth, create_app
from backend.config import config

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"


class FakeOllama(BaseHTTPRequestHandler):
    received = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeOllama.received.append(body)
        self.reply({"response": "  Heute locker laufen.  "})

    def do_GET(self):
        self.reply({"models": [{"name": "llama3.1:latest"}]})

    def reply(self, data):
        out = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


class AiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ollama = HTTPServer(("127.0.0.1", 0), FakeOllama)
        threading.Thread(target=cls.ollama.serve_forever, daemon=True).start()
        cls.app, session_factory = create_app()
        session = session_factory()
        auth.create_login(session, "ki-test", "langes-passwort-1")
        session.close()
        client = cls.app.test_client()
        token = client.post("/api/v1/auth/login", json={"username": "ki-test", "password": "langes-passwort-1"}).get_json()["data"]["token"]
        cls.headers = {"Authorization": f"Bearer {token}"}

    @classmethod
    def tearDownClass(cls):
        cls.ollama.shutdown()

    def setUp(self):
        self.client = self.app.test_client()
        config.OLLAMA_URL = f"http://127.0.0.1:{self.ollama.server_port}"

    def test_nur_mit_login(self):
        self.assertEqual(self.client.post("/api/v1/ai/chat", json={"prompt": "x"}).status_code, 401)
        self.assertEqual(self.client.get("/api/v1/ai/models").status_code, 401)

    def test_weiterleitung_an_ollama(self):
        r = self.client.post("/api/v1/ai/chat", headers=self.headers, json={"prompt": "Plan?", "json": True, "model": "qwen2.5"})
        self.assertEqual(r.get_json()["data"]["response"], "Heute locker laufen.")
        self.assertEqual(FakeOllama.received[-1], {"model": "qwen2.5", "prompt": "Plan?", "stream": False, "format": "json"})
        r = self.client.get("/api/v1/ai/models", headers=self.headers)
        self.assertEqual(r.get_json()["data"]["models"], ["llama3.1:latest"])

    def test_ohne_prompt_400(self):
        self.assertEqual(self.client.post("/api/v1/ai/chat", headers=self.headers, json={}).status_code, 400)

    def test_ollama_aus_verstaendlicher_fehler(self):
        config.OLLAMA_URL = "http://127.0.0.1:9"  # dort laeuft nichts
        r = self.client.post("/api/v1/ai/chat", headers=self.headers, json={"prompt": "x"})
        self.assertEqual(r.status_code, 502)
        self.assertIn("nicht erreichbar", r.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
