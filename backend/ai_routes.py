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


# ------------------------------------------------------------ Claude API
# GET    /api/v1/ai/claude        Stand (Schluessel da? Modell? freigegeben? darf ich?)
# PUT    /api/v1/ai/claude        {key?, model?, shared?} - nur Betreiber; neuer Schluessel wird geprueft
# DELETE /api/v1/ai/claude        Schluessel entfernen - nur Betreiber
# POST   /api/v1/ai/claude/chat   {prompt, task?, schema?} -> {response}
# Logik und Ablage in claude_api.py; der Schluessel verlaesst den Server nie.

from . import claude_api, get_current_athlete_id  # noqa: E402
from .auth import is_admin  # noqa: E402
from .routes import get_session  # noqa: E402

TASK_NAMES = {"plan", "analysis", "recommendation", "lessons", "focus", "perfSummary", "mobility"}


def _is_admin():
    session = get_session()
    try:
        return is_admin(session, get_current_athlete_id())
    finally:
        session.close()


def _claude_error(e):
    return response_error(str(e), e.code, e.status)


@api_bp.route("/ai/claude", methods=["GET"])
def get_claude():
    return response_success(claude_api.status(_is_admin()))


@api_bp.route("/ai/claude", methods=["PUT"])
def put_claude():
    admin = _is_admin()
    if not admin:
        return response_error("Den Claude-Schlüssel kann nur der Betreiber des Dashboards ändern.", "forbidden", 403)
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    key = data.get("key") if data.get("key") not in (None, "") else None
    model = data.get("model") if data.get("model") not in (None, "") else None
    shared = data.get("shared") if isinstance(data.get("shared"), bool) else None
    if key is None and model is None and shared is None:
        return response_error("Nichts zu speichern.", "VALIDATION_ERROR", 400)
    try:
        claude_api.save(key=key, model=model, shared=shared)
    except ValueError as e:
        return response_error(str(e), "VALIDATION_ERROR", 400)
    except claude_api.ClaudeError as e:
        return _claude_error(e)
    return response_success(claude_api.status(admin))


@api_bp.route("/ai/claude", methods=["DELETE"])
def delete_claude():
    admin = _is_admin()
    if not admin:
        return response_error("Den Claude-Schlüssel kann nur der Betreiber des Dashboards entfernen.", "forbidden", 403)
    claude_api.delete()
    return response_success(claude_api.status(admin))


@api_bp.route("/ai/claude/chat", methods=["POST"])
def claude_chat():
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    prompt = data.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        return response_error("'prompt' fehlt", "VALIDATION_ERROR", 400)
    if len(prompt) > claude_api.PROMPT_MAX_CHARS:
        return response_error("Die Anfrage ist zu lang.", "VALIDATION_ERROR", 400)
    task = data.get("task") if data.get("task") in TASK_NAMES else ""
    schema = data.get("schema") if isinstance(data.get("schema"), dict) else None
    st = claude_api.status(_is_admin())
    if not st["configured"]:
        return response_error("Für den KI-Coach ist noch kein Schlüssel hinterlegt.", "claude_not_configured", 409)
    if not st["available"] and st["sdk"]:
        return response_error("Der Betreiber hat den KI-Coach für andere Personen nicht freigegeben.", "claude_not_shared", 403)
    from .usage import record
    athlete_id = get_current_athlete_id()
    tokens = {}
    try:
        text = claude_api.chat(prompt, task=task, schema=schema, usage_out=tokens)
    except claude_api.ClaudeError as e:
        record(athlete_id, "ai_error", (e.code or "fehler")[:40])
        if tokens:
            record(athlete_id, "ai_tokens", "in", tokens.get("in", 0))
            record(athlete_id, "ai_tokens", "out", tokens.get("out", 0))
        return _claude_error(e)
    record(athlete_id, "ai", task or "chat")
    record(athlete_id, "ai_tokens", "in", tokens.get("in", 0))
    record(athlete_id, "ai_tokens", "out", tokens.get("out", 0))
    return response_success({"response": text})
