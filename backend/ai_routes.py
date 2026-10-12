"""KI ueber den Server: Das Dashboard ruft Ollama nicht mehr direkt auf,
sondern POST /api/v1/ai/chat - der Server leitet an Ollama auf diesem PC
weiter (OLLAMA_URL aus .env). So brauchen Freunde kein eigenes Ollama und
Ollama muss nicht fuer andere Geraete freigegeben werden.

Haengt am selben Blueprint wie routes.py, ist also nur mit Login erreichbar.
Die Ollama-Adresse kommt nur aus der Server-Konfiguration, nie vom Browser.
"""
import json
import urllib.error
import urllib.request

from flask import request

from .config import config
from .routes import api_bp, response_error, response_success

OLLAMA_TIMEOUT_S = 600  # ein ganzer Trainingsplan braucht auf langsamen PCs Minuten
DEFAULT_MODEL = "llama3.1"


def ollama(path, payload=None, timeout=OLLAMA_TIMEOUT_S):
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(config.OLLAMA_URL + path, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def ollama_error(e):
    if isinstance(e, urllib.error.HTTPError):
        return response_error(f"Ollama meldet Fehler {e.code} - ist das Modell geladen (ollama pull ...)?", "ollama_error", 502)
    return response_error(f"Ollama ist auf dem Dashboard-PC nicht erreichbar ({config.OLLAMA_URL}). Läuft Ollama?",
                          "ollama_unreachable", 502)


@api_bp.route("/ai/chat", methods=["POST"])
def ai_chat():
    """POST /api/v1/ai/chat - {prompt, model?, json?} -> {response}."""
    data = request.get_json(silent=True) or {}
    prompt = data.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return response_error("'prompt' fehlt", "VALIDATION_ERROR", 400)
    payload = {"model": data.get("model") or DEFAULT_MODEL, "prompt": prompt, "stream": False}
    if data.get("json"):
        payload["format"] = "json"
    try:
        answer = ollama("/api/generate", payload)
    except (urllib.error.URLError, OSError, ValueError) as e:  # HTTPError ist eine URLError
        return ollama_error(e)
    return response_success({"response": (answer.get("response") or "").strip()})


@api_bp.route("/ai/models", methods=["GET"])
def ai_models():
    """GET /api/v1/ai/models - installierte Ollama-Modelle (fuer "Verbindung testen")."""
    try:
        tags = ollama("/api/tags", timeout=10)
    except (urllib.error.URLError, OSError, ValueError) as e:
        return ollama_error(e)
    return response_success({"models": [m.get("name") or m.get("model") for m in tags.get("models", [])]})
