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

# Preise in US-Dollar je 1 Million Tokens (Eingabe, Ausgabe), Stand Oktober 2026,
# fuer die Kostenstatistik (Mehr -> Statistik). Die Kosten werden beim Aufruf
# mit dem dann gueltigen Preis gespeichert - eine spaetere Preisaenderung
# veraendert alte Werte nicht. Auch Modelle, auf die die API bei einer
# Ablehnung selbst ausweicht, stehen hier.
PRICES_USD_PER_MTOK = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-fable-5-1": (10.0, 50.0),
    "claude-fable-5": (10.0, 50.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-sonnet-5": (2.0, 10.0),
}
# Haiku 5.5 kostet bei sehr langen Anfragen (ueber 100.000 Tokens) mehr.
PRICES_LONG = {"claude-haiku-5-5": (100_000, 0.50, 2.50)}
MODEL_SHORT = {
    "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5",
    "claude-fable-5-1": "Fable 5.1", "claude-fable-5": "Fable 5", "claude-opus-5": "Opus 5",
    "claude-opus-4-8": "Opus 4.8", "claude-sonnet-5": "Sonnet 5",
}


# Sammelauftraege (Batches API) kosten die Haelfte.
BATCH_PRICE_FACTOR = 0.5


def cost_micro_usd(model, tokens_in, tokens_out, batch=False):
    """Kosten eines Aufrufs in Millionstel US-Dollar (ganze Zahl), None wenn der Preis unbekannt ist."""
    price = PRICES_USD_PER_MTOK.get(model)
    if price is None:
        return None
    p_in, p_out = price
    long = PRICES_LONG.get(model)
    if long and tokens_in > long[0]:
        p_in, p_out = long[1], long[2]
    # Tokens x Dollar je Million = Millionstel Dollar
    cost = tokens_in * p_in + tokens_out * p_out
    return int(round(cost * (BATCH_PRICE_FACTOR if batch else 1)))


# Modell je Aufgabe: Der Betreiber kann z. B. Plaene mit Opus und Analysen
# mit Sonnet erstellen lassen. Gilt fuer alle, die den Schluessel nutzen.
# Ohne eigene Wahl gilt das Standard-Modell ("model").
TASK_GROUPS = [
    ("plan", "Trainingsplan", "Plan erstellen und ändern, täglicher Plan-Check", {"plan", "planbatch", "dailycheck", "alternative", "replan"}),
    ("analysis", "Analysen", "Auswertung einzelner Einheiten, Lessons Learned, Belastung, Leistungszustand",
     {"analysis", "lessons", "focus", "perfSummary"}),
    ("coach", "Coach & Morgenbericht", "Empfehlungen zum Ziel und der Satz im Morgenbericht", {"recommendation", "morning", ""}),
    ("chat", "Chat mit dem Coach", "Gespräche unter „Frag den Coach“ – viele kurze Nachrichten", {"chat"}),
    ("mobility", "Mobility", "Mobility-Einheiten zusammenstellen", {"mobility"}),
]
TASK_GROUP_OF = {task: gid for gid, _, _, tasks in TASK_GROUPS for task in tasks}
# Eigener Standard einer Gruppe (ohne Wahl des Betreibers), sonst gilt das
# allgemeine Standard-Modell. Der Chat schickt viele Nachrichten mit viel
# Kontext - Haiku ist dafuer schnell und guenstig.
GROUP_DEFAULT_MODEL = {"chat": "claude-haiku-5-5"}

KEY_MIN_LEN, KEY_MAX_LEN = 20, 300
PROMPT_MAX_CHARS = 120_000
# Obergrenze der Antwort je Aufgabe. Denken zaehlt bei den aktuellen Modellen
# mit hinein, deshalb grosszuegig - bezahlt wird nur, was wirklich entsteht.
MAX_TOKENS = {"plan": 16000, "planbatch": 16000, "replan": 16000, "mobility": 8000, "chat": 8000}
MAX_TOKENS_DEFAULT = 6000
# Gruendlichkeit je Aufgabe: kurze Texte brauchen wenig Nachdenken.
# "alternative" (eine einzelne Einheit neu vorschlagen) ist klein und klar
# umrissen - dafuer reicht wenig Nachdenken; "replan" (Nachricht an den Coach)
# aendert meist nur wenige Tage einer Woche.
EFFORT = {"plan": "medium", "replan": "medium", "mobility": "medium", "dailycheck": "medium", "alternative": "low"}
EFFORT_DEFAULT = "low"
# Nachdenken beim Trainingsplan (Plan erstellen + Nachricht an den Coach):
# vom Betreiber waehlbar, um Qualitaet und Kosten zu vergleichen. Nachdenken
# zaehlt als geschriebener Text und ist damit der groesste Kostenanteil.
PLAN_EFFORT_TASKS = {"plan", "planbatch", "replan"}
PLAN_EFFORTS = ("low", "medium")
PLAN_EFFORT_DEFAULT = "low"
# Tagesgrenze je Person (ausser dem Betreiber): so viele Anfragen an Claude
# (direkt und Sammelauftrag) pro Kalendertag. 0 = ohne Grenze. Gezaehlt wird
# in backend/usage.py (take_claude_call). Ein normaler Tag mit Morgenbericht,
# Plan-Check, Auswertungen und ein paar Fragen braucht etwa 10.
DAILY_LIMIT_DEFAULT = 30
DAILY_LIMIT_MAX = 500


def plan_effort(data):
    return data.get("plan_effort") if data.get("plan_effort") in PLAN_EFFORTS else PLAN_EFFORT_DEFAULT


def daily_limit(data):
    v = data.get("daily_limit")
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= DAILY_LIMIT_MAX else DAILY_LIMIT_DEFAULT


def effort_for(data, task):
    if task in PLAN_EFFORT_TASKS:
        return plan_effort(data)
    return EFFORT.get(task, EFFORT_DEFAULT)
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


def _task_models(data):
    raw = data.get("task_models") if isinstance(data.get("task_models"), dict) else {}
    return {g: m for g, m in raw.items() if g in TASK_GROUP_OF.values() and m in MODELS}


def model_for(data, task):
    """Modell fuer eine Aufgabe: eigene Wahl der Gruppe, sonst Standard."""
    own = _task_models(data).get(TASK_GROUP_OF.get(task or ""))
    if own:
        return own
    group_default = GROUP_DEFAULT_MODEL.get(TASK_GROUP_OF.get(task or ""))
    if group_default in MODELS:
        return group_default
    return data.get("model") if data.get("model") in MODELS else DEFAULT_MODEL


def settings():
    data = _read()
    model = data.get("model") if data.get("model") in MODELS else DEFAULT_MODEL
    return {"configured": bool(data.get("key")), "model": model, "shared": bool(data.get("shared")),
            "task_models": _task_models(data), "plan_effort": plan_effort(data), "daily_limit": daily_limit(data)}


def status(admin):
    st = settings()
    return {
        **st,
        "admin": bool(admin),
        "available": st["configured"] and (admin or st["shared"]) and sdk_available(),
        "sdk": sdk_available(),
        "models": [{"id": k, "label": v} for k, v in MODELS.items()],
        "task_groups": [{"id": gid, "label": label, "hint": hint, "default_model": GROUP_DEFAULT_MODEL.get(gid)}
                        for gid, label, hint, _ in TASK_GROUPS],
    }


def save(key=None, model=None, shared=None, task_models=None, plan_effort=None, daily_limit=None):
    """Aenderungen uebernehmen. Ein neuer Schluessel wird vorher geprueft.
    task_models: {gruppe: modell} - "" setzt die Gruppe auf das Standard-Modell zurueck."""
    with _lock:
        data = _read()
        if model is not None:
            if model not in MODELS:
                raise ValueError("Unbekanntes Modell.")
            data["model"] = model
        if task_models is not None:
            groups = set(TASK_GROUP_OF.values())
            current = _task_models(data)
            for gid, m in task_models.items():
                if gid not in groups:
                    raise ValueError("Unbekannte Aufgabe.")
                if m in (None, ""):
                    current.pop(gid, None)
                elif m in MODELS:
                    current[gid] = m
                else:
                    raise ValueError("Unbekanntes Modell.")
            data["task_models"] = current
        if plan_effort is not None:
            if plan_effort not in PLAN_EFFORTS:
                raise ValueError("Unbekannte Stufe.")
            data["plan_effort"] = plan_effort
        if daily_limit is not None:
            if isinstance(daily_limit, bool) or not isinstance(daily_limit, int) or not 0 <= daily_limit <= DAILY_LIMIT_MAX:
                raise ValueError(f"Tagesgrenze: eine ganze Zahl von 0 bis {DAILY_LIMIT_MAX} (0 = ohne Grenze).")
            data["daily_limit"] = daily_limit
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


def _params(data, prompt, task, schema):
    """Anfrage-Parameter - gleich fuer direkte Anfrage und Sammelauftrag."""
    output_config = {"effort": effort_for(data, task)}
    if schema:
        output_config["format"] = {"type": "json_schema", "schema": schema}
    return {
        "model": model_for(data, task),
        "max_tokens": MAX_TOKENS.get(task, MAX_TOKENS_DEFAULT),
        "output_config": output_config,
        "messages": [{"role": "user", "content": prompt}],
    }


def _usage(response, model, usage_out):
    if usage_out is None:
        return
    u = getattr(response, "usage", None)
    usage_out["in"] = int(getattr(u, "input_tokens", 0) or 0)
    usage_out["out"] = int(getattr(u, "output_tokens", 0) or 0)
    # Das Modell, das wirklich geantwortet hat (bei einer Ablehnung kann
    # die API auf ein anderes ausweichen).
    served = getattr(response, "model", None)
    usage_out["model"] = served if isinstance(served, str) and served else model


def _text_of(response):
    """Text der Antwort - oder ein verstaendlicher Fehler."""
    if response.stop_reason == "refusal":
        raise ClaudeError("Der KI-Coach hat diese Anfrage abgelehnt. Bitte anders formulieren.", "claude_refusal", 422)
    if response.stop_reason == "max_tokens":
        raise ClaudeError("Die Antwort vom KI-Coach war zu lang und wurde abgeschnitten. Bitte einen kürzeren Zeitraum wählen.", "claude_too_long", 502)
    text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text").strip()
    if not text:
        raise ClaudeError("Der KI-Coach hat keine Antwort geliefert. Bitte noch einmal versuchen.", "claude_empty", 502)
    return text


def _key_or_error(data):
    key = data.get("key")
    if not key:
        raise ClaudeError("Für den KI-Coach ist noch kein Schlüssel hinterlegt.", "claude_not_configured", 409)
    return key


def chat(prompt, task="", schema=None, usage_out=None):
    """Ein Text-Aufruf. Mit schema kommt garantiert gueltiges JSON zurueck.
    usage_out (dict): bekommt die verbrauchten Tokens (fuer die Admin-Statistik)."""
    data = _read()
    key = _key_or_error(data)
    params = _params(data, prompt, task, schema)
    model = params["model"]
    anthropic, client = _client(key)
    try:
        if model in FALLBACK_MODELS:
            response = client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **params)
        else:
            response = client.messages.create(**params)
    except anthropic.AnthropicError as e:
        raise _translate(anthropic, e)
    _usage(response, model, usage_out)
    return _text_of(response)


# ------------------------------------------------------------ Sammelauftraege

# Nicht eilige Aufgaben (der automatische Wochenplan) laufen als Sammelauftrag
# (Batches API): halber Preis, fertig meist in unter einer Stunde, spaetestens
# nach 24 Stunden. Welcher Auftrag wem gehoert, steht in claude_batches.json
# (gleicher Ordner wie der Schluessel, nur fuer den eigenen Benutzer lesbar) -
# so kann niemand das Ergebnis eines anderen abholen. Das fertige Ergebnis wird
# dort zwischengespeichert, damit die Kosten genau einmal gezaehlt werden.
BATCH_FILE = "claude_batches.json"
BATCH_KEEP_DAYS = 7
BATCH_FAILED = {
    "errored": "Der Sammelauftrag ist bei Claude fehlgeschlagen.",
    "expired": "Der Sammelauftrag wurde nicht rechtzeitig bearbeitet (nach 24 Stunden abgelaufen).",
    "canceled": "Der Sammelauftrag wurde abgebrochen.",
}


def _batch_path():
    return os.path.join(KEY_DIR, BATCH_FILE)


def _read_batches():
    try:
        with open(_batch_path(), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_batches(jobs):
    import datetime
    cut = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=BATCH_KEEP_DAYS)).isoformat()
    jobs = {k: v for k, v in jobs.items() if isinstance(v, dict) and str(v.get("created", "")) >= cut}
    os.makedirs(KEY_DIR, exist_ok=True)
    tmp = _batch_path() + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(jobs, f)
    os.replace(tmp, _batch_path())


def submit_batch(prompt, task, owner, schema=None):
    """Sammelauftrag mit einer Anfrage abgeben. Gibt die Auftrags-ID zurueck."""
    import datetime
    data = _read()
    key = _key_or_error(data)
    params = _params(data, prompt, task, schema)
    anthropic, client = _client(key)
    try:
        batch = client.messages.batches.create(requests=[{"custom_id": "auftrag", "params": params}])
    except anthropic.AnthropicError as e:
        raise _translate(anthropic, e)
    with _lock:
        jobs = _read_batches()
        jobs[batch.id] = {"owner": owner, "task": task, "model": params["model"], "state": "pending",
                          "created": datetime.datetime.now(datetime.timezone.utc).isoformat()}
        _write_batches(jobs)
    return batch.id


def batch_result(batch_id, owner, usage_out=None):
    """Stand eines Sammelauftrags: {"status": "pending"|"done"|"failed", "text"?, "error"?}.
    usage_out bekommt die Tokens nur beim ersten Abholen (fuer die Statistik)."""
    job = _read_batches().get(batch_id)
    if not job or job.get("owner") != owner:
        raise ClaudeError("Diesen Sammelauftrag gibt es nicht (mehr).", "claude_batch_unknown", 404)
    if job.get("state") in ("done", "failed"):
        return {"status": job["state"], "text": job.get("text"), "error": job.get("error")}
    key = _key_or_error(_read())
    anthropic, client = _client(key)
    try:
        batch = client.messages.batches.retrieve(batch_id)
        if batch.processing_status != "ended":
            return {"status": "pending"}
        result = next(iter(client.messages.batches.results(batch_id)), None)
    except anthropic.AnthropicError as e:
        raise _translate(anthropic, e)
    tokens = {}
    outcome = {"status": "failed", "error": BATCH_FAILED["errored"]}
    kind = getattr(getattr(result, "result", None), "type", None)
    if kind == "succeeded":
        message = result.result.message
        _usage(message, job.get("model"), tokens)
        tokens["batch"] = True
        try:
            outcome = {"status": "done", "text": _text_of(message)}
        except ClaudeError as e:
            outcome = {"status": "failed", "error": str(e)}
    elif kind in BATCH_FAILED:
        outcome = {"status": "failed", "error": BATCH_FAILED[kind]}
    with _lock:
        jobs = _read_batches()
        current = jobs.get(batch_id) or job
        if current.get("state") in ("done", "failed"):
            # Inzwischen von einer anderen Anfrage abgeholt - nicht doppelt zaehlen
            return {"status": current["state"], "text": current.get("text"), "error": current.get("error")}
        jobs[batch_id] = {**current, "state": outcome["status"], "text": outcome.get("text"), "error": outcome.get("error")}
        _write_batches(jobs)
    if usage_out is not None and tokens:
        usage_out.update(tokens)
    return {"status": outcome["status"], "text": outcome.get("text"), "error": outcome.get("error")}
