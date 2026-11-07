"""Offizielle Garmin Training API - VORBEREITET, ausgeschaltet.

Garmin erlaubt das Senden von Workouts offiziell nur ueber die Training API
des Garmin Connect Developer Program. Dafuer braucht der Betreiber eine
Freischaltung durch Garmin (Bewerbung unter developer.garmin.com). Danach:

  1. In der .env eintragen (nie ins Repository):
       GARMIN_TRAINING_CLIENT_ID=...
       GARMIN_TRAINING_CLIENT_SECRET=...
       GARMIN_TRAINING_REDIRECT_URL=https://<dashboard-adresse>/?garmin_oauth=1
  2. Dashboard neu starten. In Einstellungen → Garmin erscheint
     "Mit Garmin verbinden (offiziell)". Jede Person stimmt dort einmal bei
     Garmin zu (OAuth 2.0 mit PKCE) - ohne Passwort im Dashboard.
  3. Ab dann nimmt backend/garmin_push.py automatisch diesen Weg.

Ohne diese Eintraege ist alles hier aus: enabled() ist False, keine Anfrage
geht nach draussen. Adressen und Feldnamen folgen Garmins Training-API- und
OAuth2-PKCE-Beschreibung; vor dem Einschalten mit der Doku abgleichen, die
Garmin nach der Freischaltung bereitstellt (siehe docs/GARMIN_TRAINING_API.md).

Die Tokens liegen je Person unter ~/.triathlon/garmin_training_<id>.json
(Rechte 0600, ausserhalb des Projekts) und gehen nie an den Browser.
"""
import base64
import hashlib
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

from flask import request

from . import get_current_athlete_id
from .routes import api_bp, response_error, response_success

TOKEN_DIR = os.path.expanduser("~/.triathlon")
AUTHORIZE_URL = "https://connect.garmin.com/oauth2Confirm"
TOKEN_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token"
API_BASE = "https://apis.garmin.com"
WORKOUT_PATH = "/workoutportal/workout/v2"
SCHEDULE_PATH = "/training-api/schedule"
PROVIDER = "Triathlon-Dashboard"
STATE_TTL_S = 600

_pending = {}  # state -> (athlete_id, code_verifier, Ablaufzeit) - nur im Speicher


def setting(name):
    return (os.environ.get(name) or "").strip()


def enabled():
    return bool(setting("GARMIN_TRAINING_CLIENT_ID") and setting("GARMIN_TRAINING_CLIENT_SECRET")
                and setting("GARMIN_TRAINING_REDIRECT_URL"))


def token_file(athlete_id):
    return os.path.join(TOKEN_DIR, f"garmin_training_{int(athlete_id)}.json")


def load_tokens(athlete_id):
    try:
        with open(token_file(athlete_id), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) and data.get("access_token") else None
    except (OSError, ValueError):
        return None


def save_tokens(athlete_id, data):
    os.makedirs(TOKEN_DIR, mode=0o700, exist_ok=True)
    path = token_file(athlete_id)
    tmp = f"{path}.{secrets.token_hex(6)}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def connected(athlete_id):
    return enabled() and load_tokens(athlete_id) is not None


def connected_athletes():
    if not enabled() or not os.path.isdir(TOKEN_DIR):
        return []
    out = []
    for name in os.listdir(TOKEN_DIR):
        if name.startswith("garmin_training_") and name.endswith(".json"):
            try:
                out.append(int(name[len("garmin_training_"):-5]))
            except ValueError:
                pass
    return out


def status(athlete_id):
    return {"available": enabled(), "connected": connected(athlete_id)}


# ------------------------------------------------------------------- HTTP

class TrainingApiError(Exception):
    def __init__(self, status, message):
        super().__init__(f"API Error {status}: {message}")
        self.status = status


def http(method, url, *, data=None, form=None, token=None, timeout=30):
    """Eine Anfrage; Tests ersetzen diese Funktion (nie echtes Garmin in Tests)."""
    headers = {"Accept": "application/json"}
    body = None
    if form is not None:
        body = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise TrainingApiError(e.code, e.reason) from None


def exchange(form):
    data = http("POST", TOKEN_URL, form={**form, "client_id": setting("GARMIN_TRAINING_CLIENT_ID"),
                                          "client_secret": setting("GARMIN_TRAINING_CLIENT_SECRET")})
    if not isinstance(data, dict) or not data.get("access_token"):
        raise TrainingApiError(502, "kein Token")
    data["expires_at"] = time.time() + float(data.get("expires_in") or 3600) - 60
    return data


def access_token(athlete_id):
    tokens = load_tokens(athlete_id)
    if tokens is None:
        raise TrainingApiError(401, "nicht verbunden")
    if tokens.get("expires_at", 0) < time.time() and tokens.get("refresh_token"):
        fresh = exchange({"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"]})
        fresh.setdefault("refresh_token", tokens["refresh_token"])
        save_tokens(athlete_id, fresh)
        tokens = fresh
    return tokens["access_token"]


# ------------------------------------------------- Format: Connect -> Training API

SPORT = {"running": "RUNNING", "cycling": "CYCLING", "swimming": "LAP_SWIMMING",
         "strength_training": "STRENGTH_TRAINING", "mobility": "STRENGTH_TRAINING", "other": "GENERIC"}
INTENSITY = {"warmup": "WARMUP", "cooldown": "COOLDOWN", "interval": "INTERVAL", "recovery": "RECOVERY", "rest": "REST"}
DURATION = {"time": "TIME", "distance": "DISTANCE", "lap.button": "OPEN", "reps": "REPS"}
TARGET = {"heart.rate.zone": "HEART_RATE", "power.zone": "POWER", "pace.zone": "PACE"}
STROKE = {"free": "FREESTYLE", "backstroke": "BACKSTROKE", "breaststroke": "BREASTSTROKE", "fly": "BUTTERFLY",
          "drill": "DRILL", "individual_medley": "IM"}


def convert_step(s):
    if s["type"] == "RepeatGroupDTO":
        return {"type": "WorkoutRepeatStep", "stepOrder": s["stepOrder"], "repeatType": "REPEAT_UNTIL_STEPS_CMPLT",
                "repeatValue": s["numberOfIterations"], "steps": [convert_step(c) for c in s["workoutSteps"]]}
    out = {"type": "WorkoutStep", "stepOrder": s["stepOrder"],
           "intensity": INTENSITY.get(s["stepType"]["stepTypeKey"], "ACTIVE"),
           "description": s.get("description"),
           "durationType": DURATION.get(s["endCondition"]["conditionTypeKey"], "OPEN"),
           "durationValue": s.get("endConditionValue"),
           "targetType": TARGET.get(s["targetType"]["workoutTargetTypeKey"]) or "OPEN"}
    if "zoneNumber" in s:
        out["targetValue"] = s["zoneNumber"]
    if "targetValueOne" in s:
        out["targetValueLow"], out["targetValueHigh"] = s["targetValueOne"], s["targetValueTwo"]
    stroke = STROKE.get((s.get("strokeType") or {}).get("strokeTypeKey"))
    if stroke:
        out["strokeType"] = stroke
    if s.get("category"):
        out["exerciseCategory"], out["exerciseName"] = s["category"], s.get("exerciseName")
    if s.get("weightValue"):
        out["weightValue"], out["weightDisplayUnit"] = s["weightValue"] / 1000.0, "KILOGRAM"
    return {k: v for k, v in out.items() if v is not None}


def convert_workout(payload):
    sport = SPORT.get(payload["sportType"]["sportTypeKey"], "GENERIC")
    segment = payload["workoutSegments"][0]
    out = {"workoutName": payload["workoutName"], "description": payload.get("description"), "sport": sport,
           "estimatedDurationInSecs": payload.get("estimatedDurationInSecs"),
           "workoutProvider": PROVIDER, "workoutSourceId": PROVIDER,
           "segments": [{"segmentOrder": 1, "sport": sport, "steps": [convert_step(s) for s in segment["workoutSteps"]]}]}
    if payload.get("poolLength"):
        out["poolLength"], out["poolLengthUnit"] = payload["poolLength"], "METER"
        out["segments"][0].update(poolLength=payload["poolLength"], poolLengthUnit="METER")
    return out


class TrainingApiClient:
    """Gleiche Methoden wie der garminconnect-Client, den garmin_push benutzt."""

    def __init__(self, athlete_id):
        self.athlete_id = athlete_id

    def _call(self, method, path, data=None):
        return http(method, API_BASE + path, data=data, token=access_token(self.athlete_id))

    def upload_workout(self, payload):
        return self._call("POST", WORKOUT_PATH, convert_workout(payload))

    def update_workout(self, workout_id, payload):
        return self._call("PUT", f"{WORKOUT_PATH}/{int(workout_id)}", {**convert_workout(payload), "workoutId": int(workout_id)})

    def delete_workout(self, workout_id):
        return self._call("DELETE", f"{WORKOUT_PATH}/{int(workout_id)}")

    def schedule_workout(self, workout_id, date_str):
        return self._call("POST", SCHEDULE_PATH, {"workoutId": int(workout_id), "date": date_str})


# ------------------------------------------------------------ Verbinden (OAuth)

@api_bp.route("/garmin/official/start", methods=["POST"])
def garmin_official_start():
    """-> {url}: dorthin schickt der Browser die Person zur Zustimmung bei Garmin."""
    if not enabled():
        return response_error("Die offizielle Garmin-Verbindung ist noch nicht freigeschaltet.", "not_enabled", 409)
    now = time.time()
    for k in [k for k, v in _pending.items() if v[2] < now]:
        _pending.pop(k, None)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    state = secrets.token_urlsafe(24)
    _pending[state] = (get_current_athlete_id(), verifier, now + STATE_TTL_S)
    url = AUTHORIZE_URL + "?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": setting("GARMIN_TRAINING_CLIENT_ID"), "code_challenge": challenge,
        "code_challenge_method": "S256", "redirect_uri": setting("GARMIN_TRAINING_REDIRECT_URL"), "state": state})
    return response_success({"url": url})


@api_bp.route("/garmin/official/finish", methods=["POST"])
def garmin_official_finish():
    """{code, state} aus der Rueckleitung -> Tokens ablegen. Nur fuer dieselbe Person."""
    body = request.get_json(silent=True)
    body = body if isinstance(body, dict) else {}
    code, state = body.get("code"), body.get("state")
    pending = _pending.pop(state, None) if isinstance(state, str) else None
    athlete_id = get_current_athlete_id()
    if not enabled():
        return response_error("Die offizielle Garmin-Verbindung ist noch nicht freigeschaltet.", "not_enabled", 409)
    if not pending or pending[0] != athlete_id or pending[2] < time.time() or not isinstance(code, str) or len(code) > 2000:
        return response_error("Die Verbindung mit Garmin ist abgelaufen. Bitte noch einmal starten.", "oauth_state", 400)
    try:
        tokens = exchange({"grant_type": "authorization_code", "code": code, "code_verifier": pending[1],
                           "redirect_uri": setting("GARMIN_TRAINING_REDIRECT_URL")})
    except Exception as e:
        print(f"Garmin offiziell Nutzer {athlete_id}: {type(e).__name__}", flush=True)
        return response_error("Garmin hat die Verbindung nicht bestätigt. Bitte erneut versuchen.", "oauth_failed", 502)
    save_tokens(athlete_id, tokens)
    return response_success(status(athlete_id))


@api_bp.route("/garmin/official/disconnect", methods=["POST"])
def garmin_official_disconnect():
    athlete_id = get_current_athlete_id()
    try:
        os.remove(token_file(athlete_id))
    except OSError:
        pass
    return response_success(status(athlete_id))
