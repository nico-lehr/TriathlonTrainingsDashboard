"""Events (Wettkaempfe) aus dem Garmin-Connect-Kalender lesen.

    GET /api/v1/garmin/events   -> {events: [...], via: "personal"|"connect", at}

Garmin liefert Events im selben Monats-Kalender wie geplante Workouts
(/calendar-service/year/<J>/month/<M-1>, M ist dort 0-basiert) als Eintraege
mit itemType "event": Titel, Datum, isRace, primaryEvent, Zieldistanz
(completionTarget), Startzeit, Ort. Die eigene Zielzeit steht nur in den
Details eines Events (/calendar-service/event/<id>, eventCustomization.customGoal).

Nur LESEN. Zuerst ueber die offizielle Personal API (eigener Schluessel); bietet
die den Kalender nicht an, ueber die Garmin-Anmeldung fuer "Trainings auf die
Uhr" (garminconnect-Token). Das Ergebnis haelt der Server einige Stunden vor -
das Dashboard fragt hoechstens einmal am Tag (js/data/garmin-events.js).
Uebernommen werden die Events im Browser als Ziele; geloescht wird dabei nie etwas.
"""
import os
import re
import threading
import time
from datetime import date, datetime

from tools import garmin_personal_api as personal_api
from tools import garmin_sync

from . import get_current_athlete_id
from .routes import api_bp, response_error, response_success

MONTHS_AHEAD = 12          # Garmin erlaubt Events nur im naechsten Jahr
MAX_DETAILS = 15           # Detail-Abfragen (Zielzeit) je Abruf
CACHE_S = 6 * 60 * 60
_cache = {}                # athlete_id -> (zeit, ergebnis)
_lock = threading.Lock()

_UNIT_KM = {"meter": 0.001, "kilometer": 1.0, "yard": 0.0009144, "mile": 1.609344}

# Sportart fuer das Dashboard-Ziel: zuerst Garmins Event-Typ, sonst der Titel.
_TYPE_SPORT = {
    "running": "Laufen", "trail_running": "Laufen", "road_running": "Laufen", "track_running": "Laufen",
    "cycling": "Rad", "road_biking": "Rad", "mountain_biking": "Rad", "gravel_cycling": "Rad",
    "swimming": "Schwimmen", "open_water_swimming": "Schwimmen", "lap_swimming": "Schwimmen",
    "triathlon": "Triathlon", "multi_sport": "Triathlon", "duathlon": "Triathlon",
}
_TITLE_SPORT = [
    (re.compile(r"triathlon|ironman|70\.3|\btri\b|duathlon|challenge roth", re.I), "Triathlon"),
    (re.compile(r"marathon|lauf|run\b|running|\b(5|10|21|42)\s?k\b|trail|crosslauf|volkslauf", re.I), "Laufen"),
    (re.compile(r"rad|bike|cycl|gran\s?fondo|velo|tour\b|gravel|mtb|zeitfahren", re.I), "Rad"),
    (re.compile(r"schwimm|swim|open\s?water|freiwasser", re.I), "Schwimmen"),
]


def _dict(value):
    return value if isinstance(value, dict) else {}


def _text(value, limit=120):
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    return value[:limit] or None


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _type_key(item):
    for key in ("eventType", "activityType", "sportType"):
        v = item.get(key)
        if isinstance(v, dict):
            v = v.get("typeKey") or v.get("key")
        if isinstance(v, str) and v.strip():
            return v.strip().lower()
    return None


def event_sport(item, title):
    key = _type_key(item)
    if key in _TYPE_SPORT:
        return _TYPE_SPORT[key]
    for pattern, sport in _TITLE_SPORT:
        if title and pattern.search(title):
            return sport
    return "Sonstiges"


def _distance_km(item):
    target = _dict(item.get("completionTarget"))
    value, scale = _number(target.get("value")), _UNIT_KM.get(target.get("unit"))
    if target.get("unitType") != "distance" or value is None or scale is None or value <= 0:
        return None
    return round(value * scale, 2)


def _goal_time(detail):
    """Eigene Zielzeit des Events als "h:mm:ss" (oder None)."""
    goal = _dict(_dict(detail.get("eventCustomization")).get("customGoal"))
    secs = _number(goal.get("value"))
    if goal.get("unitType") != "time" or goal.get("unit") != "second" or not secs or secs <= 0:
        return None
    secs = int(round(secs))
    return f"{secs // 3600}:{secs % 3600 // 60:02d}:{secs % 60:02d}"


def _valid_date(value):
    return isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is not None


def normalize_event(item, detail=None):
    """Ein Garmin-Kalender-Event in die kompakte Form fuers Dashboard."""
    title = _text(item.get("title")) or "Garmin-Event"
    start = _dict(item.get("eventTimeLocal"))
    detail = detail or {}
    custom = _dict(detail.get("eventCustomization"))
    raw_id = item.get("id")
    uuid = _text(item.get("shareableEventUuid"), 64)
    return {
        "garminId": str(raw_id) if isinstance(raw_id, (int, str)) and not isinstance(raw_id, bool) else uuid,
        "name": title,
        "date": item.get("date"),
        "sport": event_sport(item, title),
        "isRace": bool(item.get("isRace")),
        "primary": bool(item.get("primaryEvent") or custom.get("isPrimaryEvent")),
        "distanceKm": _distance_km(item),
        "targetTime": _goal_time(detail),
        "startTime": _text(start.get("startTimeHhMm"), 5),
        "location": _text(item.get("location")),
    }


class CalendarMissing(Exception):
    """Der Zugang kennt den Garmin-Kalender nicht (z. B. Personal API: 404).
    Frueher wurde das still als "keine Events" gewertet - dann kam nie etwas an."""
    user_message = "Garmin gibt den Kalender über diesen Zugang nicht heraus."


def month_items(client, year, month):
    """Rohe Kalender-Eintraege eines Monats (month 1-12)."""
    if isinstance(client, personal_api.PersonalApiClient):
        data = client._get(f"/calendar-service/year/{year}/month/{month - 1}", missing_ok=True)
        if not isinstance(data, dict) or not isinstance(data.get("calendarItems"), list):
            raise CalendarMissing()
    else:
        data = client.get_scheduled_workouts(year, month)
    items = _dict(data).get("calendarItems")
    return items if isinstance(items, list) else []


EVENTS_LIST_LIMIT = 100


def list_items(client, today):
    """Garmins Event-Liste ("Meine Events", /calendar-service/events) als
    Ersatz, falls der Monatskalender keine Events zeigt. Felder dort heissen
    teils anders (eventName/eventDate) - auf die Kalender-Form gebracht.
    Fehler -> leere Liste (der Monatskalender bleibt die Hauptquelle)."""
    path = "/calendar-service/events"
    params = {"startDate": today.isoformat(), "pageIndex": 1, "limit": EVENTS_LIST_LIMIT, "sortOrder": "eventDate_asc"}
    try:
        if isinstance(client, personal_api.PersonalApiClient):
            data = client._get(path, params=params, missing_ok=True)
        else:
            query = "&".join(f"{k}={v}" for k, v in params.items())
            data = client.connectapi(f"{path}?{query}")
    except Exception:
        return []
    rows = data if isinstance(data, list) else _dict(data).get("events") or _dict(data).get("calendarItems") or []
    out = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        item = dict(row)
        item["itemType"] = "event"
        item.setdefault("title", row.get("eventName") or row.get("name"))
        day = row.get("date") or row.get("eventDate")
        item["date"] = day[:10] if isinstance(day, str) else None
        out.append(item)
    return out


def event_detail(client, item):
    raw_id = item.get("id")
    if not (isinstance(raw_id, int) or (isinstance(raw_id, str) and raw_id.isdecimal())):
        return {}
    path = f"/calendar-service/event/{raw_id}"
    try:
        if isinstance(client, personal_api.PersonalApiClient):
            return _dict(client._get(path, missing_ok=True))
        return _dict(client.connectapi(path))
    except Exception:  # ohne Zielzeit ist das Event trotzdem brauchbar
        return {}


def fetch_events(client, today=None, months=MONTHS_AHEAD):
    """Alle Events von heute bis `months` Monate voraus, nach Datum sortiert."""
    today = today or date.today()
    year, month = today.year, today.month
    seen, events, details = set(), [], 0
    rows = []
    for _ in range(months + 1):
        rows.extend(month_items(client, year, month))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    if not any(isinstance(i, dict) and i.get("itemType") == "event" for i in rows):
        rows.extend(list_items(client, today))
    for item in rows:
        if not isinstance(item, dict) or item.get("itemType") != "event":
            continue
        day = item.get("date")
        if not _valid_date(day) or day < today.isoformat():
            continue
        key = (item.get("id"), item.get("shareableEventUuid"), day)
        if key in seen:  # Monatsraender koennen Eintraege doppelt liefern
            continue
        seen.add(key)
        detail = event_detail(client, item) if details < MAX_DETAILS else {}
        details += 1
        events.append(normalize_event(item, detail))
    events.sort(key=lambda e: (e["date"], e["name"]))
    return events


def _clients(athlete_id):
    """Moegliche Zugaenge in sinnvoller Reihenfolge: (Name, Fabrik)."""
    out = []
    if personal_api.has_key(athlete_id):
        out.append(("personal", lambda: personal_api.PersonalApiClient(athlete_id)))
    if os.path.isdir(garmin_sync.token_path(athlete_id)):
        out.append(("connect", lambda: garmin_sync.connect(athlete_id)))
    return out


def load_events(athlete_id, force=False, now=None):
    """-> (ergebnis, None) oder (None, (fehlertext, http-status)). Haelt
    Ergebnisse CACHE_S Sekunden vor."""
    now = now or time.time()
    with _lock:
        hit = _cache.get(athlete_id)
        if hit and not force and now - hit[0] < CACHE_S:
            return hit[1], None
    clients = _clients(athlete_id)
    if not clients:
        return None, ("Garmin ist noch nicht verbunden.", 409)
    last_error, empty = None, None
    for via, factory in clients:
        try:
            events = fetch_events(factory())
        except personal_api.GarminApiTooManyRequestsError as e:
            return None, (e.user_message, 429)
        except Exception as e:  # z. B. Personal API ohne Kalender -> naechster Zugang
            last_error = getattr(e, "user_message", None) or garmin_sync.describe_error(e, athlete_id)
            continue
        result = {"events": events, "via": via, "at": datetime.now().isoformat(timespec="seconds")}
        if not events and via != clients[-1][0]:
            # Leer ueber den einen Zugang? Der andere sieht evtl. mehr.
            empty = empty or result
            continue
        with _lock:
            _cache[athlete_id] = (now, result)
        return result, None
    if empty:
        with _lock:
            _cache[athlete_id] = (now, empty)
        return empty, None
    if [c[0] for c in clients] == ["personal"]:
        return None, ("Garmin gibt die Events über den Schlüssel nicht heraus. Melde dich einmal unter "
                      "Einstellungen → Garmin → „Trainings auf die Uhr“ an, dann klappt es.", 409)
    return None, (last_error or "Events konnten nicht geholt werden.", 502)


@api_bp.route("/garmin/events", methods=["GET"])
def get_garmin_events():
    from flask import request
    athlete_id = get_current_athlete_id()
    result, error = load_events(athlete_id, force=request.args.get("force") == "1")
    if error:
        return response_error(error[0], "garmin_events_unavailable", error[1])
    return response_success(result)
