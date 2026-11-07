"""Claude API (Anthropic) ueber den Dashboard-Server.

Der Betreiber hinterlegt den Schluessel EINMAL in den Einstellungen; danach
koennen alle seine Geraete (und - wenn er es freigibt - seine Freunde) die
KI nutzen, ohne dass der Schluessel je im Browser liegt.

Ablage: ~/.triathlon/claude_api.json (nur fuer den eigenen Benutzer lesbar,
0600) mit {key, model, shared}. Der Schluessel wird nie zurueckgegeben und
nie geloggt - nach aussen gehen nur "configured", Modell und Freigabe.

Aufrufe laufen ueber das offizielle Anthropic-SDK (Paket "anthropic").
Fehlt das Paket, meldet status() das verstaendlich statt abzustuerzen.
"""
import json
import os
import threading

KEY_DIR = os.path.expanduser("~/.triathlon")  # wie die Garmin-Schluessel
KEY_FILE = "claude_api.json"

# Auswahl in den Einstellungen - Reihenfolge = Anzeige. Standard: Opus.
MODELS = {
    "claude-opus-5-5": "Claude Opus 5.5 – beste Qualität",
    "claude-sonnet-5-5": "Claude Sonnet 5.5 – ausgewogen",
    "claude-haiku-5-5": "Claude Haiku 5.5 – am günstigsten",
}
DEFAULT_MODEL = "claude-opus-5-5"
# Bei einer Ablehnung durch die Sicherheitsfilter springt die API selbst auf
# ein passendes anderes Modell um ("default"); Haiku kennt das nicht.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5"}
FALLBACK_BETA = "server-side-fallback-2026-07-01"

KEY_MIN_LEN, KEY_MAX_LEN = 20, 300
PROMPT_MAX_CHARS = 120_000
# Obergrenze der Antwort je Aufgabe. Denken zaehlt bei den aktuellen Modellen
# mit hinein, deshalb grosszuegig - bezahlt wird nur, was wirklich entsteht.
MAX_TOKENS = {"plan": 16000, "mobility": 8000}
MAX_TOKENS_DEFAULT = 6000
# Gruendlichkeit je Aufgabe: kurze Texte brauchen wenig Nachdenken.
EFFORT = {"plan": "medium", "mobility": "medium", "dailycheck": "medium"}
EFFORT_DEFAULT = "low"
TIMEOUT_S = 300

_lock = threading.Lock()


class ClaudeError(Exception):
    """Fehler mit einer Meldung, die man so im Dashboard zeigen kann."""

    def __init__(self, message, code="claude_error", status=502):
        super().__init__(message)
        self.code = code
        self.status = status


# ------------------------------------------------------------ Ablage

def key_path():
    return os.path.join(KEY_DIR, KEY_FILE)


def _read():
    try:
        with open(key_path(), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(data):
    os.makedirs(KEY_DIR, exist_ok=True)
    tmp = key_path() + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, key_path())


def clean_key(key):
    key = key.strip() if isinstance(key, str) else ""
    if not (KEY_MIN_LEN <= len(key) <= KEY_MAX_LEN) or any(not ("!" <= c <= "~") for c in key):
        raise ValueError("Das sieht nicht wie ein Claude-Schlüssel aus (beginnt meist mit „sk-ant-“). Bitte komplett kopieren und einfügen.")
    return key


def sdk_available():
    try:
        import anthropic  # noqa: F401
        return True
    except ImportError:
        return False


def settings():
    data = _read()
    model = data.get("model") if data.get("model") in MODELS else DEFAULT_MODEL
    return {"configured": bool(data.get("key")), "model": model, "shared": bool(data.get("shared"))}


def status(admin):
    st = settings()
    return {
        **st,
        "admin": bool(admin),
        "available": st["configured"] and (admin or st["shared"]) and sdk_available(),
        "sdk": sdk_available(),
        "models": [{"id": k, "label": v} for k, v in MODELS.items()],
    }


def save(key=None, model=None, shared=None):
    """Aenderungen uebernehmen. Ein neuer Schluessel wird vorher geprueft."""
    with _lock:
        data = _read()
        if model is not None:
            if model not in MODELS:
                raise ValueError("Unbekanntes Modell.")
            data["model"] = model
        if shared is not None:
            data["shared"] = bool(shared)
        if key is not None:
            key = clean_key(key)
            verify_key(key, data.get("model") or DEFAULT_MODEL)
            data["key"] = key
        if not data.get("key"):
            raise ValueError("Bitte zuerst einen Schlüssel eintragen.")
        _write(data)


def delete():
    with _lock:
        try:
            os.remove(key_path())
        except FileNotFoundError:
            pass


# ------------------------------------------------------------ Aufrufe

def _client(key):
    try:
        import anthropic
    except ImportError:
        raise ClaudeError("Auf dem Dashboard-Server fehlt das Paket „anthropic“. Bitte im Projektordner "
                          "„pip install -r backend/requirements.txt“ ausführen und neu starten.", "claude_sdk_missing", 503)
    return anthropic, anthropic.Anthropic(api_key=key, timeout=TIMEOUT_S, max_retries=2)


def _translate(anthropic, e):
    """SDK-Fehler -> verstaendliche Meldung (spezifisch zuerst)."""
    if isinstance(e, anthropic.AuthenticationError):
        return ClaudeError("Der KI-Coach kommt nicht an: der Schlüssel wurde abgelehnt. Bitte in den Einstellungen einen gültigen eintragen.", "claude_key_rejected", 502)
    if isinstance(e, anthropic.PermissionDeniedError):
        return ClaudeError("Der Schlüssel darf dieses Modell nicht nutzen. Bitte ein anderes Modell wählen.", "claude_forbidden", 502)
    if isinstance(e, anthropic.NotFoundError):
        return ClaudeError("Das gewählte KI-Modell gibt es nicht (mehr). Bitte in den Einstellungen ein anderes wählen.", "claude_model", 502)
    if isinstance(e, anthropic.RateLimitError):
        return ClaudeError("Der KI-Coach ist gerade ausgelastet oder das Guthaben-Limit ist erreicht. Bitte kurz warten.", "claude_rate_limit", 429)
    if isinstance(e, anthropic.BadRequestError):
        msg = str(getattr(e, "message", "") or "")
        if "credit" in msg.lower() or "balance" in msg.lower():
            return ClaudeError("Das KI-Guthaben ist aufgebraucht. Bitte in der Anthropic Console aufladen.", "claude_credit", 402)
        return ClaudeError("Der KI-Coach konnte die Anfrage nicht verarbeiten.", "claude_bad_request", 502)
    if isinstance(e, anthropic.APIStatusError):
        return ClaudeError("Der KI-Coach meldet gerade einen Fehler. Bitte gleich noch einmal versuchen.", "claude_server", 502)
    if isinstance(e, anthropic.APIConnectionError):
        return ClaudeError("Der KI-Coach ist vom Dashboard-Server aus nicht erreichbar (Internet?).", "claude_unreachable", 502)
    return ClaudeError("Unerwarteter Fehler bei der Anfrage an den KI-Coach.", "claude_error", 502)


def verify_key(key, model):
    """Schluessel pruefen, ohne Text zu erzeugen (kostet nichts)."""
    anthropic, client = _client(key)
    try:
        client.models.retrieve(model)
    except anthropic.AnthropicError as e:
        raise _translate(anthropic, e)


def chat(prompt, task="", schema=None, usage_out=None):
    """Ein Text-Aufruf. Mit schema kommt garantiert gueltiges JSON zurueck.
    usage_out (dict): bekommt die verbrauchten Tokens (fuer die Admin-Statistik)."""
    data = _read()
    key = data.get("key")
    if not key:
        raise ClaudeError("Für den KI-Coach ist noch kein Schlüssel hinterlegt.", "claude_not_configured", 409)
    model = data.get("model") if data.get("model") in MODELS else DEFAULT_MODEL
    anthropic, client = _client(key)
    output_config = {"effort": EFFORT.get(task, EFFORT_DEFAULT)}
    if schema:
        output_config["format"] = {"type": "json_schema", "schema": schema}
    params = {
        "model": model,
        "max_tokens": MAX_TOKENS.get(task, MAX_TOKENS_DEFAULT),
        "output_config": output_config,
        "messages": [{"role": "user", "content": prompt}],
    }
    try:
        if model in FALLBACK_MODELS:
            response = client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **params)
        else:
            response = client.messages.create(**params)
    except anthropic.AnthropicError as e:
        raise _translate(anthropic, e)

    if usage_out is not None:
        u = getattr(response, "usage", None)
        usage_out["in"] = int(getattr(u, "input_tokens", 0) or 0)
        usage_out["out"] = int(getattr(u, "output_tokens", 0) or 0)
    if response.stop_reason == "refusal":
        raise ClaudeError("Der KI-Coach hat diese Anfrage abgelehnt. Bitte anders formulieren.", "claude_refusal", 422)
    if response.stop_reason == "max_tokens":
        raise ClaudeError("Die Antwort vom KI-Coach war zu lang und wurde abgeschnitten. Bitte einen kürzeren Zeitraum wählen.", "claude_too_long", 502)
    text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text").strip()
    if not text:
        raise ClaudeError("Der KI-Coach hat keine Antwort geliefert. Bitte noch einmal versuchen.", "claude_empty", 502)
    return text
