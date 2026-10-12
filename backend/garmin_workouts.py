"""An Garmin senden: eine geplante Einheit der angemeldeten Person als
Garmin-Workout hochladen und auf den geplanten Tag in den Garmin-Kalender
legen - von dort holt sich die Uhr das Workout beim naechsten Sync.

POST /api/v1/planned-workouts/<id>/send-to-garmin   (id = UUID des Eintrags)
Body (optional): {"steps": [...]} - die Schritte, die das Dashboard dafuer
verwendet (plannedWorkoutSteps, js/data/planned-workouts.js; Pace-Zonen dort
schon als Tempobereich low_mps/high_mps). Ohne Body gelten die steps des
Eintrags, ohne die ein einziger Schritt ueber die geplante Dauer.

Der Eintrag kommt aus der Ablage dieser Person (athlete_store), nie aus einer
fremden. Angemeldet wird mit dem Token des Garmin-Syncs (tools/garmin_sync.py,
~/.triathlon/garmin_<id>.token) - hier wird nie ein Passwort abgefragt.
Die Ablage schreibt der Server NICHT: "gesendet am" traegt der Browser ein,
sonst wuerde ein neuerer Stand im Browser ueberschrieben.
"""
import importlib.util
import os
import re

from flask import request

from tools.garmin_sync import connect, describe_error, token_path

from . import get_current_athlete_id
from .models import AthleteStore
from .routes import api_bp, get_session, response_error, response_success

PLANNED_WORKOUTS_KEY = "triathlon_dashboard_planned_workouts_v1"
MAX_STEPS = 50

# Garmin-Kennungen (dieselben Zahlen wie garminconnect.workout: SportType,
# StepType, ConditionType, TargetType) - als JSON gebaut, weil die typisierten
# Bausteine der Bibliothek pydantic voraussetzen.
SPORTS = {"Laufen": (1, "running", 1), "Rad": (2, "cycling", 2), "Schwimmen": (4, "swimming", 3)}
STEP_TYPES = {"warmup": 1, "cooldown": 2, "interval": 3, "recovery": 4, "rest": 5, "repeat": 6}
TARGETS = {"power_zone": (2, "power.zone"), "hr_zone": (4, "heart.rate.zone"), "pace_zone": (6, "pace.zone")}
NO_TARGET = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}
END_TIME = {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True}
END_DISTANCE = {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": True}
END_LAP_BUTTON = {"conditionTypeId": 1, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": True}
END_ITERATIONS = {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": False}

RECONNECT = "python tools/garmin_sync.py --login --athlete {id}"
FIT_HINT = "Bis dahin die Einheit als .fit-Datei herunterladen."


def positive(value, maximum):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 < value <= maximum


def garmin_target(step):
    target = step.get("target") or {"kind": "none"}
    if not isinstance(target, dict):
        raise ValueError("Ziel ungültig")
    kind = target.get("kind", "none")
    if kind == "none":
        return {"targetType": NO_TARGET}
    if kind not in TARGETS:
        raise ValueError("unbekanntes Ziel")
    type_id, key = TARGETS[kind]
    target_type = {"workoutTargetTypeId": type_id, "workoutTargetTypeKey": key, "displayOrder": 1}
    if kind == "pace_zone":
        # Garmin kennt keine nummerierten Pace-Zonen, nur einen Tempobereich (m/s, langsam .. schnell).
        low, high = target.get("low_mps"), target.get("high_mps")
        if not (positive(low, 50) and positive(high, 50) and low <= high):
            return {"targetType": NO_TARGET}
        return {"targetType": target_type, "targetValueOne": low, "targetValueTwo": high}
    zone = target.get("zone")
    if not (isinstance(zone, int) and 1 <= zone <= 5):
        raise ValueError("Zone 1-5 angeben")
    return {"targetType": target_type, "zoneNumber": zone}


def garmin_end(step):
    minutes, km = step.get("duration_min"), step.get("distance_km")
    if minutes is not None and km is not None:
        raise ValueError("Dauer ODER Distanz, nicht beides")
    if minutes is not None:
        if not positive(minutes, 1440):
            raise ValueError("Dauer ungültig")
        return {"endCondition": END_TIME, "endConditionValue": float(minutes * 60)}
    if km is not None:
        if not positive(km, 1000):
            raise ValueError("Distanz ungültig")
        return {"endCondition": END_DISTANCE, "endConditionValue": float(km * 1000)}
    return {"endCondition": END_LAP_BUTTON}  # ohne Dauer/Distanz: weiter per Lap-Taste


def garmin_steps(steps, counter, nested=False):
    """Schritte im Dashboard-Format -> workoutSteps von Garmin. stepOrder zaehlt
    durch alle Ebenen fortlaufend (Wiederholung vor ihren Schritten)."""
    if not isinstance(steps, list) or not steps:
        raise ValueError("keine Schritte")
    out = []
    for step in steps:
        if not isinstance(step, dict) or step.get("type") not in STEP_TYPES:
            raise ValueError("unbekannte Schritt-Art")
        counter[0] += 1
        if counter[0] > MAX_STEPS:
            raise ValueError(f"höchstens {MAX_STEPS} Schritte")
        type_id = STEP_TYPES[step["type"]]
        base = {"stepOrder": counter[0], "stepType": {"stepTypeId": type_id, "stepTypeKey": step["type"], "displayOrder": type_id}}
        if step["type"] == "repeat":
            count = step.get("count")
            if nested or not (isinstance(count, int) and 1 <= count <= 50):
                raise ValueError("Wiederholung ungültig")
            out.append({"type": "RepeatGroupDTO", **base, "numberOfIterations": count,
                        "workoutSteps": garmin_steps(step.get("steps"), counter, nested=True),
                        "endCondition": END_ITERATIONS, "endConditionValue": float(count), "smartRepeat": False})
        else:
            out.append({"type": "ExecutableStepDTO", **base, **garmin_end(step), **garmin_target(step)})
    return out


def timed_seconds(steps):
    """Geschaetzte Dauer aus den Zeit-Schritten (Distanz/Lap-Taste zaehlen nicht)."""
    total = 0.0
    for s in steps:
        if s["type"] == "RepeatGroupDTO":
            total += s["numberOfIterations"] * timed_seconds(s["workoutSteps"])
        elif s["endCondition"]["conditionTypeKey"] == "time":
            total += s["endConditionValue"]
    return total


def garmin_workout(entry, steps):
    """Geplante Einheit + Schritte -> JSON fuer Garmin.upload_workout(). Wirft
    ValueError bei ungueltigen Schritten."""
    sport_id, sport_key, order = SPORTS[entry["sport"]]
    sport = {"sportTypeId": sport_id, "sportTypeKey": sport_key, "displayOrder": order}
    workout_steps = garmin_steps(steps, [0])
    payload = {
        "workoutName": str(entry.get("title") or entry["sport"])[:80],
        "sportType": sport,
        "estimatedDurationInSecs": int(timed_seconds(workout_steps) or (entry.get("duration_min") or 0) * 60),
        "workoutSegments": [{"segmentOrder": 1, "sportType": sport, "workoutSteps": workout_steps}],
    }
    if entry.get("description"):
        payload["description"] = str(entry["description"])[:500]
    return payload


def find_planned_workout(athlete_id, workout_id):
    """Der Eintrag aus der Ablage DIESER Person - None, wenn es ihn dort nicht gibt."""
    session = get_session()
    try:
        row = session.query(AthleteStore).filter_by(athlete_id=athlete_id, key=PLANNED_WORKOUTS_KEY).first()
        entries = row.value if row is not None and isinstance(row.value, list) else []
    finally:
        session.close()
    return next((p for p in entries if isinstance(p, dict) and p.get("id") == workout_id), None)


def garmin_error(e, athlete_id):
    """Garmin-Fehler -> verstaendliche Meldung mit passendem HTTP-Code."""
    from garminconnect import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError

    print(f"Garmin-Versand Nutzer {athlete_id}: {describe_error(e, athlete_id)}", flush=True)
    status = re.match(r"API Error (\d+)", str(e))
    status = int(status.group(1)) if status else None
    if isinstance(e, GarminConnectTooManyRequestsError) or status in (403, 429):
        return response_error("Garmin blockt gerade (zu viele Anfragen). In ein paar Stunden erneut versuchen - "
                              "oder die Einheit als .fit-Datei herunterladen.", "garmin_rate_limited", 429)
    if isinstance(e, GarminConnectAuthenticationError) or status == 401:
        return response_error("Die Garmin-Anmeldung ist abgelaufen. Einmal neu verbinden, auf dem Dashboard-PC: "
                              f"{RECONNECT.format(id=athlete_id)}. {FIT_HINT}", "garmin_reconnect", 409)
    return response_error("Garmin hat das Workout nicht angenommen oder ist nicht erreichbar. Später erneut "
                          "versuchen - oder die Einheit als .fit-Datei herunterladen.", "garmin_error", 502)


@api_bp.route("/planned-workouts/<workout_id>/send-to-garmin", methods=["POST"])
def send_planned_workout_to_garmin(workout_id):
    """POST - Einheit als Garmin-Workout hochladen -> {garmin_workout_id, scheduled_date}."""
    athlete_id = get_current_athlete_id()
    entry = find_planned_workout(athlete_id, workout_id)
    if entry is None:
        return response_error("Diese geplante Einheit gibt es nicht (mehr). Seite neu laden und erneut versuchen.",
                              "not_found", 404)
    if entry.get("sport") not in SPORTS:
        return response_error(f"{entry.get('sport') or 'Diese'}-Einheiten kann Garmin nicht als Workout übernehmen "
                              "(nur Laufen, Rad, Schwimmen). Lade die Einheit stattdessen als .fit-Datei herunter.",
                              "unsupported_sport", 422)
    body = request.get_json(silent=True) or {}
    steps = body.get("steps") or entry.get("steps") or [{"type": "interval", "duration_min": entry.get("duration_min")}]
    try:
        payload = garmin_workout(entry, steps)
    except ValueError as e:
        return response_error(f"Die Schritte dieser Einheit sind ungültig ({e}). Bitte im Bearbeiten-Fenster prüfen.",
                              "VALIDATION_ERROR", 400)

    if importlib.util.find_spec("garminconnect") is None:
        return response_error("Auf dem Dashboard-PC fehlt die Garmin-Bibliothek: "
                              "python -m pip install -r requirements.txt", "garmin_library_missing", 503)
    if not os.path.isdir(token_path(athlete_id)):
        return response_error("Garmin ist für dich noch nicht verbunden. Einmalig auf dem Dashboard-PC anmelden: "
                              f"{RECONNECT.format(id=athlete_id)} (siehe docs/GARMIN_SYNC_GUIDE.md). {FIT_HINT}",
                              "garmin_not_connected", 409)
    try:
        client = connect(athlete_id)
        result = client.upload_workout(payload)
    except Exception as e:  # jede Garmin-/Netzwerk-Panne wird zu einer verstaendlichen Meldung
        return garmin_error(e, athlete_id)
    garmin_id = result.get("workoutId") if isinstance(result, dict) else None
    if not garmin_id:
        return response_error("Garmin hat das Workout ohne Nummer bestätigt - bitte in Garmin Connect nachsehen.",
                              "garmin_error", 502)

    # In den Garmin-Kalender legen: erst dann landet es auf der Uhr. Klappt das
    # nicht, ist das Workout trotzdem in Garmin Connect (unter "Workouts").
    scheduled = None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(entry.get("date") or "")):
        try:
            client.schedule_workout(garmin_id, entry["date"])
            scheduled = entry["date"]
        except Exception as e:
            print(f"Garmin-Kalender Nutzer {athlete_id}: {describe_error(e, athlete_id)}", flush=True)
    return response_success({"garmin_workout_id": garmin_id, "scheduled_date": scheduled})
