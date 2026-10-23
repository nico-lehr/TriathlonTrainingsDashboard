"""Offizielle Garmin-Schnittstelle "Personal API" - nur LESEN, je Person mit
eigenem Schluessel (in Garmin Connect selbst erstellt, gueltig 30 Tage bis
1 Jahr). Ersetzt fuer das Abholen der Daten den Passwort-Login aus
garmin_sync.connect(); Workouts SENDEN kann diese Schnittstelle nicht.

Ablauf: Schluessel -> Zugangs-Token (24 h gueltig, wird zwischengespeichert)
-> Anfragen an personal.connectapi.garmin.com. Adressen und Ablauf wie in
Garmins eigenem Beispiel-Client (github.com/garmin/connect-personal-api-python);
die Pfade sind dieselben Garmin-Dienste, die auch garminconnect benutzt -
deshalb passen die Antworten in die vorhandene Aufbereitung (garmin_sync.normalize).

Ablage je Person (ausserhalb des Projekts, nur fuer den eigenen Benutzer lesbar):
  ~/.triathlon/garmin_api_<id>.json         Schluessel + "gueltig bis"
  ~/.triathlon/garmin_api_<id>.bearer.json  Zugangs-Token (24 h)
Der Schluessel wird nie ausgegeben, geloggt oder an das Dashboard zurueckgegeben.

Keine Zusatz-Bibliothek: Anfragen per urllib (wie backend/ai_routes.py).
"""
import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

BASE_URL = os.environ.get("GARMIN_PERSONAL_API_BASE_URL", "https://personal.connectapi.garmin.com").rstrip("/")
TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token"
KEY_DIR = os.path.expanduser("~/.triathlon")  # wie TOKEN_DIR in garmin_sync.py
TIMEOUT_S = 30
TOKEN_REFRESH_S = 60 * 60   # Token neu holen, wenn er in weniger als 1 Stunde ablaeuft
PAGE_SIZE = 20              # Aktivitaeten je Anfrage (wie Garmins Beispiel-Client)
MAX_PAGES = 500
STEPS_CHUNK_DAYS = 28       # Garmin liefert Schritte hoechstens fuer 28 Tage je Anfrage
KEY_MIN_LEN, KEY_MAX_LEN = 10, 4096


class GarminApiError(Exception):
    """Fehler mit einem verstaendlichen deutschen Satz in user_message."""

    def __init__(self, user_message):
        super().__init__(user_message)
        self.user_message = user_message


class GarminApiAuthenticationError(GarminApiError):
    pass


class GarminApiTooManyRequestsError(GarminApiError):
    pass


class GarminApiUnreachableError(GarminApiError):
    pass


KEY_REJECTED = ("Garmin hat den Schlüssel abgelehnt (abgelaufen oder in Garmin Connect gelöscht). "
                "Bitte in den Dashboard-Einstellungen einen neuen eintragen.")


# ------------------------------------------------------------ Ablage

def key_path(athlete_id):
    return os.path.join(KEY_DIR, f"garmin_api_{int(athlete_id)}.json")


def bearer_path(athlete_id):
    return os.path.join(KEY_DIR, f"garmin_api_{int(athlete_id)}.bearer.json")


def _write_private(path, data):
    """Schreibt JSON so, dass nur der eigene Betriebssystem-Benutzer es lesen kann."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def clean_key(key):
    """Schluessel pruefen (nur sichtbare Zeichen, keine Leerzeichen) - ValueError sonst."""
    key = key.strip() if isinstance(key, str) else ""
    if not (KEY_MIN_LEN <= len(key) <= KEY_MAX_LEN) or any(not ("!" <= c <= "~") for c in key):
        raise ValueError("Das sieht nicht wie ein Garmin-Schlüssel aus. Bitte komplett kopieren und einfügen.")
    return key


def has_key(athlete_id):
    return os.path.isfile(key_path(athlete_id))


def load_key(athlete_id):
    data = _read_json(key_path(athlete_id)) or {}
    return data.get("key") if isinstance(data.get("key"), str) else None


def key_status(athlete_id, today=None):
    """Fuer die Einstellungen - ohne den Schluessel selbst."""
    data = _read_json(key_path(athlete_id))
    if not data or not isinstance(data.get("key"), str):
        return {"configured": False, "expires": None, "days_left": None}
    expires = data.get("expires")
    days_left = None
    if isinstance(expires, str):
        try:
            days_left = (date.fromisoformat(expires) - (today or date.today())).days
        except ValueError:
            expires = None
    return {"configured": True, "expires": expires, "days_left": days_left}


def save_key(athlete_id, key, expires=None):
    _write_private(key_path(athlete_id), {
        "key": key, "expires": expires, "saved_at": datetime.now().isoformat(timespec="seconds"),
    })


def delete_key(athlete_id):
    for path in (key_path(athlete_id), bearer_path(athlete_id)):
        try:
            os.remove(path)
        except FileNotFoundError:
            pass


# ------------------------------------------------------------ HTTP

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Weiterleitungen nicht folgen: urllib wuerde den Authorization-Header
    (Schluessel/Token) sonst auch an eine andere Adresse mitschicken."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # -> HTTPError mit dem 3xx-Code


_OPENER = urllib.request.build_opener(_NoRedirect)


def _open(req):
    return _OPENER.open(req, timeout=TIMEOUT_S)


def _request(method, path, *, token=None, api_key=None, params=None, accept="application/json", missing_ok=False):
    """Eine Anfrage an die Personal API -> Bytes der Antwort. Mit missing_ok
    (Tageswerte) heisst 404 "keine Daten" -> None; sonst ist 404 ein Fehler
    (z. B. geaenderter Pfad - nie still "0 Aktivitaeten"). Fehlermeldungen
    nennen nur den Pfad, nie Schluessel oder Token."""
    url = BASE_URL + path + ("?" + urllib.parse.urlencode(params) if params else "")
    headers = {"Accept": accept, "User-Agent": "TriathlonDashboard"}
    if api_key:
        headers["Authorization"] = f"ApiKey {api_key}"
    elif token:
        headers["Authorization"] = f"Bearer {token}"
    if method == "POST":
        headers["Content-Length"] = "0"  # leerer POST wie im Garmin-Client (ohne Formular-Content-Type)
    req = urllib.request.Request(url, method=method, headers=headers)
    try:
        with _open(req) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise GarminApiAuthenticationError(KEY_REJECTED) from None
        if e.code == 429:
            raise GarminApiTooManyRequestsError("Garmin blockt gerade (zu viele Anfragen). Später erneut versuchen.") from None
        if e.code == 404 and missing_ok:
            return None
        raise GarminApiError(f"Garmin antwortet mit Fehler {e.code} ({path.split('?')[0]}).") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise GarminApiUnreachableError("Garmin ist nicht erreichbar – Internetverbindung prüfen und später erneut versuchen.") from None


def _jwt_expiration(token):
    """Ablaufzeit (exp) aus dem Token lesen, ohne die Signatur zu pruefen."""
    try:
        part = token.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        return float(payload["exp"])
    except (IndexError, KeyError, TypeError, ValueError):
        raise GarminApiError("Garmin hat einen unerwarteten Zugangs-Token geliefert.") from None


def exchange_key(api_key):
    """Schluessel -> (Token, Ablaufzeit). Prueft damit auch, ob der Schluessel gilt."""
    token = _request("POST", TOKEN_PATH, api_key=api_key, accept="*/*").decode("utf-8", "replace").strip()
    return token, _jwt_expiration(token)


def _fingerprint(api_key):
    return hashlib.sha256(f"{BASE_URL}\0{api_key}".encode()).hexdigest()


def cache_token(athlete_id, api_key, token, expires_at):
    _write_private(bearer_path(athlete_id), {
        "fingerprint": _fingerprint(api_key), "access_token": token, "expires_at": expires_at,
    })


def obtain_token(athlete_id, force=False):
    """Gueltigen Zugangs-Token fuer diese Person: aus dem Zwischenspeicher oder neu."""
    api_key = load_key(athlete_id)
    if not api_key:
        raise GarminApiAuthenticationError("Kein Garmin-Schlüssel hinterlegt (Dashboard → Einstellungen → Garmin).")
    if not force:
        cached = _read_json(bearer_path(athlete_id)) or {}
        try:
            expires_at = float(cached.get("expires_at") or 0)
        except (TypeError, ValueError):
            expires_at = 0  # kaputter Zwischenspeicher: einfach neu holen
        if (cached.get("fingerprint") == _fingerprint(api_key) and isinstance(cached.get("access_token"), str)
                and expires_at - time.time() > TOKEN_REFRESH_S):
            return cached["access_token"]
    token, expires_at = exchange_key(api_key)
    cache_token(athlete_id, api_key, token, expires_at)
    return token


# ------------------------------------------------------------ Client

class PersonalApiClient:
    """Dieselben Methodennamen wie die garminconnect-Bibliothek, soweit
    garmin_sync.py sie nutzt - so laeuft der vorhandene Sync unveraendert.
    Was die Personal API nicht anbietet (VO2max, Trainingszustand), fehlt
    hier; garmin_sync.call() liefert dafuer None."""

    def __init__(self, athlete_id):
        self.athlete_id = athlete_id
        self._token = None

    def _get_bytes(self, path, params=None, accept="application/json", missing_ok=False):
        if self._token is None:
            self._token = obtain_token(self.athlete_id)
        kwargs = {"params": params, "accept": accept, "missing_ok": missing_ok}
        try:
            return _request("GET", path, token=self._token, **kwargs)
        except GarminApiAuthenticationError:
            # Token vorzeitig ungueltig (z. B. widerrufen): einmal neu holen.
            self._token = obtain_token(self.athlete_id, force=True)
            return _request("GET", path, token=self._token, **kwargs)

    def _get(self, path, params=None, missing_ok=False):
        body = self._get_bytes(path, params, missing_ok=missing_ok)
        return json.loads(body) if body else None  # None: keine Daten (leer, bzw. 404 bei missing_ok)

    # Aktivitaeten
    def get_activities_by_date(self, startdate, enddate):
        activities = []
        for page in range(MAX_PAGES):
            batch = self._get("/activitylist-service/activities/search/activities", {
                "start": page * PAGE_SIZE, "limit": PAGE_SIZE, "startDate": startdate, "endDate": enddate,
            })
            if not isinstance(batch, list) or not batch:
                break
            activities.extend(batch)
            if len(batch) < PAGE_SIZE:
                break
        return activities

    def download_original(self, activity_id):
        """Original-Datei als ZIP (darin die .fit)."""
        aid = str(activity_id)
        if not (aid.isascii() and aid.isdecimal() and int(aid) > 0):
            raise GarminApiError("Ungültige Aktivitäts-Nummer.")
        return self._get_bytes(f"/download-service/files/activity/{activity_id}",
                               accept="application/zip, application/x-zip-compressed, application/octet-stream")

    # Gesundheitsdaten je Tag (404 = an diesem Tag keine Daten)
    def get_sleep_data(self, cdate):
        return self._get("/sleep-service/sleep/dailySleep", {"date": cdate}, missing_ok=True)

    def get_hrv_data(self, cdate):
        return self._get(f"/hrv-service/hrv/{cdate}", missing_ok=True)

    def get_rhr_day(self, cdate):
        # Tages-Herzfrequenz; enthaelt restingHeartRate (liest normalize() direkt)
        return self._get("/wellness-service/wellness/dailyHeartRate", {"date": cdate}, missing_ok=True)

    # Gesundheitsdaten fuer einen Zeitraum
    def get_body_battery(self, startdate, enddate):
        return self._get("/wellness-service/wellness/bodyBattery/reports/daily",
                         {"startDate": startdate, "endDate": enddate})

    def get_body_composition(self, startdate, enddate):
        return self._get(f"/weight-service/weight/range/{startdate}/{enddate}", {"includeAll": "true"})

    def _chunked(self, startdate, enddate, fetch):
        """Zeitraum in Stuecken von STEPS_CHUNK_DAYS Tagen abfragen, Listen aneinanderhaengen."""
        out = []
        cur, end = date.fromisoformat(startdate), date.fromisoformat(enddate)
        while cur <= end:
            chunk_end = min(cur + timedelta(days=STEPS_CHUNK_DAYS - 1), end)
            out.extend(fetch(cur.isoformat(), chunk_end.isoformat()) or [])
            cur = chunk_end + timedelta(days=1)
        return out

    def get_daily_steps(self, startdate, enddate):
        return self._chunked(startdate, enddate, lambda s, e: self._get(f"/usersummary-service/stats/steps/daily/{s}/{e}"))

    def get_daily_summaries(self, startdate, enddate):
        """Tageszusammenfassungen (u. a. Body Battery) fuer einen Zeitraum - eine
        Anfrage je 28 Tage statt einer je Tag. Feldnamen sind nicht dokumentiert;
        normalize() sucht die Body-Battery-Werte deshalb auch verschachtelt."""
        def fetch(s, e):
            data = self._get("/usersummary-service/v2/dailysummaries", {"startDate": s, "endDate": e})
            items = data.get("data") if isinstance(data, dict) else data
            return items if isinstance(items, list) else []
        items = self._chunked(startdate, enddate, fetch)
        return {"data": items} if items else None  # leer: alten Stand im Zwischenspeicher behalten
