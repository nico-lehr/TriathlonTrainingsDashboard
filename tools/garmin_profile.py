"""Profilwerte aus Garmin (offizielle Personal API) fuer Onboarding und
Einstellungen: Gewicht, Groesse, Geburtsdatum, Geschlecht, Max-/Ruhepuls,
Laktatschwelle (Puls und Lauf-Pace), FTP und VO2max - soweit Garmin sie
liefert. Garmin dokumentiert dafuer "userprofile/settings" und
"heartRateZones/v2"; FTP und VO2max stehen dort nicht ausdruecklich drin.
Deshalb wird jede Antwort tolerant durchsucht und jeder Wert auf
Plausibilitaet geprueft - was fehlt oder unplausibel ist, bleibt leer
(nie geraten). Das Dashboard zeigt alles vor dem Uebernehmen an.
"""
from datetime import date, timedelta

PROFILE_PATHS = ("/userprofile-service/userprofile/settings",
                 "/userprofile-service/userprofile/user-settings")
ZONES_PATH = "/biometric-service/heartRateZones/v2"


def _walk(obj):
    """Alle (schluessel_klein, wert)-Paare in beliebig verschachteltem JSON."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield str(k).lower(), v
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def _first(objs, names, check):
    names = {n.lower() for n in names}
    for obj in objs:
        for k, v in _walk(obj):
            if k in names and v not in (None, "", 0):
                out = check(v)
                if out is not None:
                    return out
    return None


def _num(lo, hi, scale=None):
    def check(v):
        try:
            x = float(v)
        except (TypeError, ValueError):
            return None
        if scale:
            x = scale(x)
        return x if lo <= x <= hi else None
    return check


def _weight_kg(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x > 1000:  # Garmin speichert Gramm
        x /= 1000
    return round(x, 1) if 30 <= x <= 250 else None


def _height_cm(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x < 3:  # Meter
        x *= 100
    return round(x) if 120 <= x <= 230 else None


def _birth(v):
    s = str(v)[:10]
    try:
        d = date.fromisoformat(s)
    except ValueError:
        return None
    return s if date(1920, 1, 1) <= d <= date.today() - timedelta(days=365 * 10) else None


def _gender(v):
    return {"MALE": "m", "FEMALE": "w"}.get(str(v).upper())


def _pace(v):
    """Laktatschwellen-Tempo -> "m:ss" je km. Garmin liefert es je nach
    Dienst in m/s oder in 0,1 m/s - es wird die Lesart genommen, die ein
    plausibles Lauftempo (2:30-10:00 /km) ergibt."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    for factor in (1.0, 10.0):
        speed = x * factor
        if speed <= 0:
            continue
        sec = 1000 / speed
        if 150 <= sec <= 600:
            sec = round(sec)
            return f"{sec // 60}:{sec % 60:02d}"
    return None


def _latest_weight(weights):
    """Juengste Messung aus weight-service/weight/range."""
    best = None
    for k, v in _walk(weights):
        if k in ("dateweightlist", "dailyweightsummaries") and isinstance(v, list):
            for e in v:
                if not isinstance(e, dict):
                    continue
                w = _weight_kg(e.get("weight"))
                if w is None and isinstance(e.get("latestWeight"), dict):
                    w = _weight_kg(e["latestWeight"].get("weight"))
                when = str(e.get("calendarDate") or e.get("summaryDate") or e.get("date") or "")
                if w and (best is None or when > best[1]):
                    best = (w, when)
    return best


def extract(profiles, zones, weights):
    """Rohantworten -> {feld: wert}. Nur plausible Werte, sonst nicht enthalten."""
    objs = [o for o in (profiles or []) if o]
    zone_objs = [zones] if zones else []
    # Fuer die Zonen zuerst den allgemeinen Eintrag ("DEFAULT"), dann die uebrigen.
    if isinstance(zones, list):
        zone_objs = sorted(zones, key=lambda z: 0 if isinstance(z, dict) and str(z.get("sport", "")).upper() == "DEFAULT" else 1)
    values = {
        "weightKg": None,
        "heightCm": _first(objs, ["height"], _height_cm),
        "birthDate": _first(objs, ["birthDate"], _birth),
        "gender": _first(objs, ["gender"], _gender),
        "maxHr": _first(zone_objs + objs, ["maxHeartRateUsed", "maxHeartRate", "maxHr"], _num(120, 230, round)),
        "restingHr": _first(zone_objs + objs, ["restingHeartRateUsed", "restingHeartRate", "restingHr"], _num(30, 100, round)),
        "lthr": _first(zone_objs + objs, ["lactateThresholdHeartRateUsed", "lactateThresholdHeartRate"], _num(100, 215, round)),
        "runThresholdPace": _first(objs, ["lactateThresholdSpeed"], _pace),
        "ftpWatts": _first(objs + zone_objs, ["functionalThresholdPower", "ftp", "ftpValue", "cyclingFtp"], _num(50, 600, round)),
        "vo2maxRun": _first(objs, ["vo2MaxRunning"], _num(20, 95, round)),
        "vo2maxBike": _first(objs, ["vo2MaxCycling"], _num(20, 95, round)),
    }
    latest = _latest_weight(weights)
    values["weightKg"] = latest[0] if latest else _first(objs, ["weight"], _weight_kg)
    return {k: v for k, v in values.items() if v is not None}


def _swim_css(v):
    """Kritische Schwimmgeschwindigkeit (m/s) -> "m:ss" je 100 m (1:00-3:30)."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if x <= 0:
        return None
    sec = 100 / x
    if not 60 <= sec <= 210:
        return None
    sec = round(sec)
    return f"{sec // 60}:{sec % 60:02d}"


def _secs(lo, hi):
    return _num(lo, hi, round)


# Weitere Kennwerte, die die Uhr berechnet. Ob die offizielle Personal API sie
# freigibt, ist nicht dokumentiert - jeder Abruf ist deshalb einzeln und
# tolerant: fehlt ein Dienst (404) oder antwortet er anders, bleibt der Wert leer.
def metric_paths(today):
    d = today.isoformat()
    return {
        "race": ("/metrics-service/metrics/racepredictions", None),
        "endurance": ("/metrics-service/metrics/endurancescore", {"calendarDate": d}),
        "hill": ("/metrics-service/metrics/hillscore", {"calendarDate": d}),
        "heat": (f"/metrics-service/metrics/heataltitudeacclimation/latest/{d}", None),
        "css": (f"/biometric-service/criticalSwimSpeed/latest/{d}", None),
    }


def extract_metrics(raw):
    """Rohantworten {name: json} -> flache, plausible Kennwerte."""
    raw = raw or {}
    def one(key):
        v = raw.get(key)
        if isinstance(v, list):  # manche Dienste liefern eine Liste - der juengste zuerst/zuletzt
            v = v[-1] if v else None
        return [v] if v else []
    out = {
        "race5kS": _first(one("race"), ["time5K"], _secs(600, 3600)),
        "race10kS": _first(one("race"), ["time10K"], _secs(1200, 7200)),
        "raceHalfS": _first(one("race"), ["timeHalfMarathon"], _secs(2700, 14400)),
        "raceMarathonS": _first(one("race"), ["timeMarathon"], _secs(5400, 28800)),
        "enduranceScore": _first(one("endurance"), ["overallScore", "enduranceScore"], _num(1000, 15000, round)),
        "hillScore": _first(one("hill"), ["overallScore", "hillScore"], _num(1, 100, round)),
        "heatAcclimationPct": _first(one("heat"), ["heatAcclimationPercentage"], _num(0, 100, round)),
        "altitudeAcclimationM": _first(one("heat"), ["altitudeAcclimation", "currentAltitude"], _num(0, 9000, round)),
        "swimCss": _first(one("css"), ["criticalSwimSpeed", "speed", "value"], _swim_css),
    }
    return {k: v for k, v in out.items() if v is not None}


def fetch_metrics(client, today=None):
    from tools.garmin_personal_api import GarminApiError
    raw = {}
    for key, (path, params) in metric_paths(today or date.today()).items():
        try:
            raw[key] = client._get(path, params, missing_ok=True)
        except GarminApiError:
            raw[key] = None  # z.B. 403: dieser Dienst ist fuer die Personal API gesperrt
    return extract_metrics(raw)


def fetch(client):
    """Holt die Rohdaten ueber einen PersonalApiClient und wertet sie aus.
    Fehlende Dienste (404) sind kein Fehler - der Wert bleibt dann leer."""
    profiles = [client._get(p, missing_ok=True) for p in PROFILE_PATHS]
    zones = client._get(ZONES_PATH, missing_ok=True)
    end = date.today()
    weights = client._get(f"/weight-service/weight/range/{(end - timedelta(days=365)).isoformat()}/{end.isoformat()}",
                          {"includeAll": "true"}, missing_ok=True)
    return extract(profiles, zones, weights)
