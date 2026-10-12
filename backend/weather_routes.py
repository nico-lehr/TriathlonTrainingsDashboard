"""Wetter fuer den Kalender: 7-Tage-Vorhersage von Open-Meteo (kostenlos, kein API-Key).

Der Browser fragt nie Open-Meteo direkt, sondern diesen Server:
  GET /api/v1/weather/geocode?name=Heidelberg -> passende Orte {name, region, lat, lon}
  GET /api/v1/weather?lat=49.41&lon=8.69       -> je Tag Wettercode (WMO), min/max Grad C,
                                                  Regenwahrscheinlichkeit, max. Wind (km/h)

Antworten von Open-Meteo bleiben CACHE_TTL_S im Speicher, damit nicht jeder
Seitenaufruf dort anfragt. Ist Open-Meteo nicht erreichbar, kommt eine
verstaendliche Meldung (502) - der Kalender laeuft dann ohne Wetter weiter.

Haengt am selben Blueprint wie routes.py, ist also nur mit Login erreichbar.
Die Adressen von Open-Meteo kommen nur aus der Server-Konfiguration (.env).
"""
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request

from flask import request

from .config import config
from .routes import api_bp, response_error, response_success

CACHE_TTL_S = 60 * 60        # Vorhersage und Ortssuche 1 Stunde wiederverwenden
CACHE_MAX_ENTRIES = 500      # Obergrenze, falls sehr viele verschiedene Orte gesucht werden
TIMEOUT_S = 8
FORECAST_DAYS = 7
COORD_DECIMALS = 2           # ca. 1 km - reicht fuer eine Tagesvorhersage und trifft oefter den Cache
GEOCODE_MAX_RESULTS = 5
GEOCODE_NAME_MAX_LEN = 100
DAILY_FIELDS = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max"

_cache = {}  # Adresse -> (Zeitpunkt, gepruefte Antwort)


def fetch_json(url, parse):
    """GET auf Open-Meteo; parse() prueft die Antwort und baut das Ergebnis
    (ValueError bei unerwarteter Form). Nur ein geprueftes Ergebnis bleibt
    CACHE_TTL_S lang im Speicher - eine kaputte Antwort nie."""
    now = time.time()
    hit = _cache.get(url)
    if hit and now - hit[0] < CACHE_TTL_S:
        return hit[1]
    with urllib.request.urlopen(url, timeout=TIMEOUT_S) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("unerwartete Antwort")
    result = parse(data)
    if len(_cache) >= CACHE_MAX_ENTRIES:
        _cache.clear()
    _cache[url] = (now, result)
    return result


def weather_error(e):
    if isinstance(e, urllib.error.HTTPError):
        return response_error(f"Der Wetterdienst Open-Meteo meldet Fehler {e.code}. "
                              "Der Kalender funktioniert weiter, nur ohne Wetter.", "weather_error", 502)
    if isinstance(e, ValueError):  # kein JSON oder unerwartete Form
        return response_error("Der Wetterdienst Open-Meteo hat unerwartete Daten geliefert. "
                              "Der Kalender funktioniert weiter, nur ohne Wetter.", "weather_bad_data", 502)
    return response_error("Der Wetterdienst Open-Meteo ist gerade nicht erreichbar (Internetverbindung des "
                          "Dashboard-PCs?). Der Kalender funktioniert weiter, nur ohne Wetter.", "weather_unreachable", 502)


def read_coord(name, limit):
    """Koordinate aus der Adresse, gerundet - None, wenn ungueltig."""
    try:
        value = float(request.args.get(name, ""))
    except ValueError:
        return None
    if not math.isfinite(value) or abs(value) > limit:
        return None
    return round(value, COORD_DECIMALS)


def finite_number(value):
    """Zahl oder None - NaN/Unendlich (Python liest "NaN" aus JSON) wuerden die Antwort ungueltig machen."""
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def text_or_none(value):
    return value if isinstance(value, str) and value.strip() else None


def forecast_days(raw):
    """Open-Meteo "daily" (je Feld eine Liste) -> eine Zeile je Tag; fehlende Werte bleiben None.
    ValueError, wenn die Form nicht stimmt."""
    daily = raw.get("daily")
    if not isinstance(daily, dict) or not isinstance(daily.get("time"), list):
        raise ValueError("unerwartete Antwort")
    columns = {key: daily.get(key, []) for key in DAILY_FIELDS.split(",")}
    if not all(isinstance(values, list) for values in columns.values()) or not all(isinstance(d, str) for d in daily["time"]):
        raise ValueError("unerwartete Antwort")

    def value(key, i):
        values = columns[key]
        return finite_number(values[i]) if i < len(values) else None

    return [{
        "date": day,
        "code": value("weather_code", i),
        "temp_max": value("temperature_2m_max", i),
        "temp_min": value("temperature_2m_min", i),
        "precip_prob": value("precipitation_probability_max", i),
        "wind_max": value("wind_speed_10m_max", i),
    } for i, day in enumerate(daily["time"])]


def geocode_places(raw, name):
    """Open-Meteo "results" -> [{name, region, lat, lon}]. Ohne Treffer fehlt "results" ganz.
    Orte ohne gueltige Koordinaten werden ausgelassen."""
    results = raw.get("results", [])
    if not isinstance(results, list):
        raise ValueError("unerwartete Antwort")
    places = []
    for r in results:
        if not isinstance(r, dict):
            continue
        lat, lon = finite_number(r.get("latitude")), finite_number(r.get("longitude"))
        if lat is None or lon is None or abs(lat) > 90 or abs(lon) > 180:
            continue
        places.append({
            "name": text_or_none(r.get("name")) or name,
            "region": ", ".join(x for x in (text_or_none(r.get("admin1")), text_or_none(r.get("country"))) if x),
            "lat": round(lat, COORD_DECIMALS),
            "lon": round(lon, COORD_DECIMALS),
        })
    return places


@api_bp.route("/weather", methods=["GET"])
def weather_forecast():
    """GET /api/v1/weather?lat=..&lon=.. - 7-Tage-Vorhersage fuer diesen Ort."""
    lat, lon = read_coord("lat", 90), read_coord("lon", 180)
    if lat is None or lon is None:
        return response_error("Ungültige Koordinaten - bitte den Heimatort in den Einstellungen neu suchen.",
                              "VALIDATION_ERROR", 400)
    query = urllib.parse.urlencode({"latitude": lat, "longitude": lon, "daily": DAILY_FIELDS,
                                    "timezone": "auto", "forecast_days": FORECAST_DAYS})
    try:
        days = fetch_json(f"{config.OPEN_METEO_URL}?{query}", forecast_days)
    except (urllib.error.URLError, OSError, ValueError) as e:  # HTTPError ist eine URLError
        return weather_error(e)
    return response_success({"lat": lat, "lon": lon, "days": days})


@api_bp.route("/weather/geocode", methods=["GET"])
def weather_geocode():
    """GET /api/v1/weather/geocode?name=.. - bis zu 5 passende Orte."""
    name = (request.args.get("name") or "").strip()
    if not 2 <= len(name) <= GEOCODE_NAME_MAX_LEN:
        return response_error(f"Bitte einen Ortsnamen eingeben (2 bis {GEOCODE_NAME_MAX_LEN} Zeichen).",
                              "VALIDATION_ERROR", 400)
    query = urllib.parse.urlencode({"name": name, "count": GEOCODE_MAX_RESULTS, "language": "de", "format": "json"})
    try:
        places = fetch_json(f"{config.OPEN_METEO_GEOCODING_URL}?{query}", lambda raw: geocode_places(raw, name))
    except (urllib.error.URLError, OSError, ValueError) as e:
        return weather_error(e)
    return response_success({"places": places})
