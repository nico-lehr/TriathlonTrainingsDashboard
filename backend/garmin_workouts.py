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
import math
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
# Kraft und Mobility: Uebungs-Workouts. Garmin kennt "mobility" erst auf neueren
# Uhren - lehnt Garmin es ab, folgt Krafttraining, zuletzt "Sonstiges".
EXERCISE_SPORTS = {
    "Kraft": [(5, "strength_training", 5), (3, "other", 3)],
    "Mobility": [(11, "mobility", 11), (5, "strength_training", 5), (3, "other", 3)],
}
STEP_TYPES = {"warmup": 1, "cooldown": 2, "interval": 3, "recovery": 4, "rest": 5, "repeat": 6}
TARGETS = {"power_zone": (2, "power.zone"), "hr_zone": (4, "heart.rate.zone"), "pace_zone": (6, "pace.zone")}
NO_TARGET = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}
END_TIME = {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True}
END_DISTANCE = {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": True}
END_LAP_BUTTON = {"conditionTypeId": 1, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": True}
END_ITERATIONS = {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": False}
END_REPS = {"conditionTypeId": 10, "conditionTypeKey": "reps", "displayOrder": 10, "displayable": True}
WEIGHT_KG = {"unitId": 8, "unitKey": "kilogram", "factor": 1000.0}
# Schwimmen: Stil je Schritt (Garmin strokeType) und 25-m-Bahn.
STROKES = {"any": (1, "any_stroke"), "back": (2, "backstroke"), "breast": (3, "breaststroke"), "drill": (4, "drill"),
           "fly": (5, "fly"), "free": (6, "free"), "im": (7, "individual_medley")}
POOL_25M = {"poolLength": 25.0, "poolLengthUnit": {"unitId": 1, "unitKey": "meter", "factor": 100.0}}

# Uebungen der Dashboard-Sammlungen (js/data/strength-exercises.js,
# js/data/mobility-exercises.js) -> Garmins Uebungskatalog (Kategorie, Uebung).
# So zeigt die Uhr die passende Uebung mit Bild/Animation; ohne Eintrag steht
# nur der Name im Hinweis des Schritts.
GARMIN_EXERCISES = {
    "goblet-kniebeuge": ("SQUAT", "GOBLET_SQUAT"),
    "ausfallschritt": ("LUNGE", "LUNGE"),
    "step-up": ("SQUAT", "STEP_UP"),
    "rumaenisches-kreuzheben": ("DEADLIFT", "ROMANIAN_DEADLIFT"),
    "beckenheben-einbeinig": ("HIP_RAISE", "SINGLE_LEG_HIP_RAISE"),
    "liegestuetz": ("PUSH_UP", "PUSH_UP"),
    "schulterdruecken": ("SHOULDER_PRESS", "DUMBBELL_SHOULDER_PRESS"),
    "rudern-vorgebeugt": ("ROW", "DUMBBELL_ROW"),
    "zugseil": ("BANDED_EXERCISES", "ROW"),
    "face-pull": ("ROW", "FACE_PULL"),
    "latzug-band": ("PULL_UP", "KNEELING_LAT_PULLDOWN"),
    "unterarmstuetz": ("PLANK", "PLANK"),
    "dead-bug": ("HIP_STABILITY", "DEAD_BUG"),
    "vogel-hund": ("WARM_UP", "OPPOSITE_ARM_AND_LEG_BALANCE"),
    "wadenheben": ("CALF_RAISE", "STANDING_CALF_RAISE"),
    # Kraft: Eigengewicht, Kurzhanteln, Kettlebell, Band, Studio
    "kniebeuge": ("SQUAT", "AIR_SQUAT"),
    "wandsitzen": ("SQUAT", "BODY_WEIGHT_WALL_SQUAT"),
    "bulgarische-kniebeuge": ("LUNGE", "DUMBBELL_BULGARIAN_SPLIT_SQUAT"),
    "huefthub": ("HIP_RAISE", "HIP_RAISE"),
    "einbeiniges-kreuzheben": ("DEADLIFT", "SINGLE_LEG_ROMANIAN_DEADLIFT_WITH_DUMBBELL"),
    "superman": ("HYPEREXTENSION", "SUPERMAN_FROM_FLOOR"),
    "y-heben": ("SHOULDER_STABILITY", "FLOOR_Y_RAISE"),
    "klimmzug": ("PULL_UP", "PULL_UP"),
    "dips-stuhl": ("TRICEPS_EXTENSION", "BENCH_DIP"),
    "bergsteiger": ("PLANK", "MOUNTAIN_CLIMBER"),
    "hohlkoerper": ("CRUNCH", "HOLLOW_ROCK"),
    "kh-bankdruecken": ("BENCH_PRESS", "DUMBBELL_BENCH_PRESS"),
    "einarmiges-rudern": ("ROW", "ONE_ARM_BENT_OVER_ROW"),
    "y-heben-vorgebeugt": ("SHOULDER_STABILITY", "WEIGHTED_INCLINE_Y_RAISE"),
    "farmers-walk": ("CARRY", "FARMERS_WALK"),
    "frontheben": ("SHOULDER_PRESS", "DUMBBELL_FRONT_RAISE"),
    "thruster": ("SQUAT", "DUMBBELL_THRUSTERS"),
    "kb-swing": ("HIP_RAISE", "KETTLEBELL_SWING"),
    "kb-kniebeuge": ("SQUAT", "KETTLEBELL_SQUAT"),
    "kb-kreuzheben": ("DEADLIFT", "KETTLEBELL_DEADLIFT"),
    "kb-rudern": ("ROW", "KETTLEBELL_ROW"),
    "kb-brustpresse": ("BENCH_PRESS", "KETTLEBELL_CHEST_PRESS"),
    "band-kniebeuge": ("BANDED_EXERCISES", "SQUAT"),
    "band-kreuzheben": ("BANDED_EXERCISES", "DEADLIFT"),
    "band-rudern": ("BANDED_EXERCISES", "ROW"),
    "band-armzug": ("PULL_UP", "STRAIGHT_ARM_PULLDOWN"),
    "band-brustpresse": ("PUSH_UP", "CHEST_PRESS_WITH_BAND"),
    "band-trizeps": ("BANDED_EXERCISES", "TRICEP_EXTENSION"),
    "lh-kniebeuge": ("SQUAT", "BARBELL_BACK_SQUAT"),
    "lh-kreuzheben": ("DEADLIFT", "BARBELL_DEADLIFT"),
    "lh-bankdruecken": ("BENCH_PRESS", "BARBELL_BENCH_PRESS"),
    "latziehen": ("PULL_UP", "LAT_PULLDOWN"),
    "kabelrudern": ("ROW", "SEATED_CABLE_ROW"),
    "beinpresse": ("SQUAT", "LEG_PRESS"),
    "trizeps-kabel": ("TRICEPS_EXTENSION", "TRICEPS_PRESSDOWN"),
    # Mobility
    "hueftbeuger-kniend": ("WARM_UP", "STRETCH_LUNGING_HIP_FLEXOR"),
    "hueftbeuger-stehend": ("WARM_UP", "STRETCH_HIP_FLEXOR_AND_QUAD"),
    "couch-stretch": ("WARM_UP", "STRETCH_HIP_FLEXOR_AND_QUAD"),
    "taube": ("WARM_UP", "STRETCH_PIGEON_POSE"),
    "liegende-vier": ("WARM_UP", "STRETCH_LYING_PIRIFORMIS"),
    "beinpendel": ("WARM_UP", "FORWARD_AND_BACKWARD_LEG_SWINGS"),
    "frosch": ("WARM_UP", "STRETCH_BUTTERFLY"),
    "beckenheben": ("HIP_RAISE", "HIP_RAISE"),
    "weltbeste-dehnung": ("WARM_UP", "STRETCH_LUNGE_WITH_SPINAL_TWIST"),
    "beinrueckseite-liegend": ("WARM_UP", "STRETCH_HAMSTRING"),
    "vorbeuge-stehend": ("WARM_UP", "STANDING_HAMSTRING_STRETCH"),
    "beinrueckseite-kniend": ("WARM_UP", "STRETCH_HAMSTRING"),
    "wade-wand": ("WARM_UP", "STRETCH_CALF"),
    "wade-tief": ("WARM_UP", "STRETCH_CALF"),
    "knie-zur-wand": ("WARM_UP", "ANKLE_DORSIFLEXION_WITH_BAND"),
    "oberschenkel-stehend": ("WARM_UP", "STRETCH_QUAD"),
    "katze-kuh": ("WARM_UP", "STRETCH_CAT_COW"),
    "kindhaltung": ("WARM_UP", "STRETCH_CHILDS_POSE"),
    "knie-zur-brust": ("WARM_UP", "STRETCH_LYING_KNEE_TO_CHEST"),
    "sphinx": ("WARM_UP", "STRETCH_COBRA"),
    "vierfuessler-drehung": ("WARM_UP", "THORACIC_ROTATION"),
    "nadel-einfaedeln": ("WARM_UP", "THORACIC_ROTATION"),
    "wandrutschen": ("LATERAL_RAISE", "WALL_SLIDE"),
    "brust-tuerrahmen": ("WARM_UP", "STRETCH_PECTORAL"),
    "schulter-band": ("BANDED_EXERCISES", "PULL_APART"),
    "lat-dehnung": ("WARM_UP", "STRETCH_LAT"),
    "armkreisen": ("WARM_UP", "ARM_CIRCLES"),
    "raupe": ("CORE", "INCHWORM"),
}
MAX_EXERCISES = 20

RECONNECT = "python tools/garmin_sync.py --login --athlete {id}"
FIT_HINT = "Bis dahin die Einheit als .fit-Datei herunterladen."


def positive(value, maximum):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 < value <= maximum


def whole(value, low, high):
    """Ganze Zahl im Bereich - true/false zaehlen nicht (bool ist in Python ein int)."""
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def minutes_or_zero(value):
    """Geplante Dauer als Zahl, auch wenn in der Ablage Text steht ("50"); sonst 0."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if math.isfinite(number) and number > 0 else 0.0


WARMUP_WORD = {"Laufen": "einlaufen", "Rad": "einrollen", "Schwimmen": "einschwimmen"}
COOLDOWN_WORD = {"Laufen": "auslaufen", "Rad": "ausrollen", "Schwimmen": "ausschwimmen"}
ZONE_WORDS = {1: "sehr locker", 2: "locker, Reden geht", 3: "zügig", 4: "hart, an der Schwelle", 5: "sehr hart"}


def pace_text(mps, sport):
    """m/s -> "5:10" (je km) bzw. je 100 m beim Schwimmen."""
    seconds = (100 if sport == "Schwimmen" else 1000) / mps
    return f"{int(seconds // 60)}:{int(round(seconds % 60)):02d}".replace(":60", ":59")


def step_note(step, sport):
    """Kurzer Hinweis, den die Uhr beim Schritt zeigt - eigener Text (note) geht vor."""
    note = step.get("note")
    if isinstance(note, str) and note.strip():
        return note.strip()[:100]
    target = step.get("target") if isinstance(step.get("target"), dict) else {}
    kind, zone = target.get("kind"), target.get("zone")
    if kind == "hr_zone" and whole(zone, 1, 5):
        aim = f"Puls Zone {zone} · {ZONE_WORDS[zone]}"
    elif kind == "power_zone" and whole(zone, 1, 5):
        aim = f"Leistung Zone {zone} · {ZONE_WORDS[zone]}"
    elif kind == "pace_zone" and positive(target.get("low_mps"), 50) and positive(target.get("high_mps"), 50):
        unit = "/100 m" if sport == "Schwimmen" else "/km"
        aim = f"Pace {pace_text(target['high_mps'], sport)}–{pace_text(target['low_mps'], sport)} {unit}"
    else:
        aim = ""
    lead = {"warmup": f"Locker {WARMUP_WORD.get(sport, 'aufwärmen')}", "cooldown": f"Locker {COOLDOWN_WORD.get(sport, 'abwärmen')}",
            "recovery": "Erholen", "rest": "Pause", "interval": None if aim else "Hauptteil"}.get(step.get("type"))
    return " · ".join(x for x in (lead, aim) if x) or None


def garmin_target(step):
    target = step.get("target") or {"kind": "none"}
    if not isinstance(target, dict):
        raise ValueError("Ziel ungültig")
    kind = target.get("kind", "none")
    if kind == "none":
        return {"targetType": NO_TARGET}
    if not isinstance(kind, str) or kind not in TARGETS:
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
    if not whole(zone, 1, 5):
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


def garmin_stroke(step):
    stroke = step.get("stroke")
    if isinstance(stroke, str) and stroke in STROKES:
        sid, key = STROKES[stroke]
        return {"strokeType": {"strokeTypeId": sid, "strokeTypeKey": key, "displayOrder": sid}}
    return {}


def garmin_steps(steps, counter, nested=False, sport=None):
    """Schritte im Dashboard-Format -> workoutSteps von Garmin. stepOrder zaehlt
    durch alle Ebenen fortlaufend (Wiederholung vor ihren Schritten)."""
    if not isinstance(steps, list) or not steps:
        raise ValueError("keine Schritte")
    out = []
    for step in steps:
        if not isinstance(step, dict) or not isinstance(step.get("type"), str) or step["type"] not in STEP_TYPES:
            raise ValueError("unbekannte Schritt-Art")
        counter[0] += 1
        if counter[0] > MAX_STEPS:
            raise ValueError(f"höchstens {MAX_STEPS} Schritte")
        type_id = STEP_TYPES[step["type"]]
        base = {"stepOrder": counter[0], "stepType": {"stepTypeId": type_id, "stepTypeKey": step["type"], "displayOrder": type_id}}
        if step["type"] == "repeat":
            count = step.get("count")
            if nested or not whole(count, 1, 50):
                raise ValueError("Wiederholung ungültig")
            out.append({"type": "RepeatGroupDTO", **base, "numberOfIterations": count,
                        "workoutSteps": garmin_steps(step.get("steps"), counter, nested=True, sport=sport),
                        "endCondition": END_ITERATIONS, "endConditionValue": float(count), "smartRepeat": False})
        else:
            item = {"type": "ExecutableStepDTO", **base, **garmin_end(step), **garmin_target(step)}
            if sport == "Schwimmen":
                item.update(garmin_stroke(step))
            note = step_note(step, sport)
            if note:
                item["description"] = note
            out.append(item)
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


INTENSITY_TEXT = {"leicht": "Locker", "mittel": "Mittel", "hart": "Hart"}


def workout_description(entry):
    """Beschreibung in Garmin Connect: Text des Coaches + Intensitaet."""
    parts = []
    if entry.get("description"):
        parts.append(str(entry["description"]).strip())
    if entry.get("intensity") in INTENSITY_TEXT:
        parts.append(f"Intensität: {INTENSITY_TEXT[entry['intensity']]}")
    parts.append("Aus deinem Triathlon-Dashboard")
    return "\n".join(parts)[:1000]


def garmin_workout(entry, steps):
    """Geplante Einheit + Schritte -> JSON fuer Garmin.upload_workout(). Wirft
    ValueError bei ungueltigen Schritten."""
    sport_id, sport_key, order = SPORTS[entry["sport"]]
    sport = {"sportTypeId": sport_id, "sportTypeKey": sport_key, "displayOrder": order}
    workout_steps = garmin_steps(steps, [0], sport=entry["sport"])
    estimate = minutes_or_zero(entry.get("duration_min")) * 60 if entry["sport"] == "Schwimmen" else timed_seconds(workout_steps)
    workout = {
        "workoutName": str(entry.get("title") or entry["sport"])[:80],
        "sportType": sport,
        "estimatedDurationInSecs": int(estimate or timed_seconds(workout_steps) or minutes_or_zero(entry.get("duration_min")) * 60),
        "workoutSegments": [{"segmentOrder": 1, "sportType": sport, "workoutSteps": workout_steps}],
        "description": workout_description(entry),
    }
    if entry["sport"] == "Schwimmen":
        workout.update(POOL_25M)
    return workout


def without_swim_details(workout):
    """Vorsichtige Ersatz-Variante, falls Garmin Stil/Bahnlaenge ablehnt."""
    def strip(steps):
        out = []
        for st in steps:
            st = {k: v for k, v in st.items() if k != "strokeType"}
            if st["type"] == "RepeatGroupDTO":
                st["workoutSteps"] = strip(st["workoutSteps"])
            out.append(st)
        return out
    plain = {k: v for k, v in workout.items() if k not in POOL_25M}
    plain["workoutSegments"] = [{**seg, "workoutSteps": strip(seg["workoutSteps"])} for seg in workout["workoutSegments"]]
    return plain


def number_in(text):
    """Erste ganze Zahl in "8 je Seite" / "12" -> 8 / 12, sonst None."""
    m = re.search(r"\d+", str(text or ""))
    return int(m.group()) if m else None


def clean_exercise(x):
    """Uebung aus dem Browser (garminExercises) oder roh aus der Ablage ->
    {id, name, sets, reps, seconds, sides, rest_s, weight_kg, note}. None = unbrauchbar."""
    if not isinstance(x, dict):
        return None
    name = str(x.get("name") or "").strip()[:60]
    if not name:
        return None
    reps_text = x.get("reps")
    reps = x.get("reps") if whole(x.get("reps"), 1, 500) else number_in(reps_text)
    seconds = x.get("seconds") if positive(x.get("seconds"), 3600) else None
    if seconds is None and isinstance(reps_text, str) and re.search(r"\d+\s*(s|sek|min)", reps_text):
        seconds = number_in(reps_text) * (60 if "min" in reps_text else 1)
        reps = None
    sets = x.get("sets") if whole(x.get("sets"), 1, 20) else 1
    rest = x.get("rest_s") if positive(x.get("rest_s"), 600) else None
    weight = x.get("weight_kg") if positive(x.get("weight_kg"), 500) else None
    sides = bool(x.get("sides")) or bool(re.search(r"je Seite", str(reps_text or "")))
    note = str(x.get("note") or "").strip()[:80] or None
    return {"id": str(x.get("id") or "")[:60] or None, "name": name, "sets": sets, "reps": reps if whole(reps, 1, 500) else None,
            "seconds": seconds, "sides": sides, "rest_s": rest, "weight_kg": weight, "note": note}


def exercise_steps(exercises, mobility, with_catalog, counter):
    """Uebungen -> Garmin-Schritte. Kraft: je Uebung "Saetze x (Uebung, Pause)".
    Mobility: je Uebung (und Seite) ein Zeit-Schritt, kurze Wechselpause."""
    out = []

    def step(kind, end, value, x=None, label=None):
        counter[0] += 1
        if counter[0] > MAX_STEPS:
            raise ValueError(f"höchstens {MAX_STEPS} Schritte")
        type_id = STEP_TYPES[kind]
        item = {"type": "ExecutableStepDTO", "stepOrder": counter[0],
                "stepType": {"stepTypeId": type_id, "stepTypeKey": kind, "displayOrder": type_id},
                "endCondition": end, "targetType": NO_TARGET}
        if value is not None:
            item["endConditionValue"] = float(value)
        if x is not None:
            text = label or x["name"]
            if x["note"]:
                text = f"{text} · {x['note']}"
            item["description"] = text[:100]
            if with_catalog and x["id"] in GARMIN_EXERCISES:
                item["category"], item["exerciseName"] = GARMIN_EXERCISES[x["id"]]
            if x["weight_kg"]:
                item["weightValue"] = float(x["weight_kg"]) * 1000.0
                item["weightUnit"] = dict(WEIGHT_KG)
        return item

    def work(x, label=None):
        if x["seconds"]:
            return step("interval", END_TIME, x["seconds"], x, label)
        if x["reps"]:
            return step("interval", END_REPS, x["reps"], x, label)
        return step("interval", END_LAP_BUTTON, None, x, label)

    for x in exercises:
        if mobility:
            if x["sides"] and x["seconds"]:
                labels = [f"{x['name']} links", f"{x['name']} rechts"]
            else:
                labels = [f"{x['name']} (je Seite)" if x["sides"] else x["name"]]
            for label in labels:
                out.append(work(x, label))
            out.append(step("rest", END_TIME, 10))
            continue
        label = f"{x['name']} (je Seite)" if x["sides"] else x["name"]
        rest = x["rest_s"] or 60
        if x["sets"] > 1:
            counter[0] += 1
            order = counter[0]
            inner = [work(x, label), step("rest", END_TIME, rest)]
            out.append({"type": "RepeatGroupDTO", "stepOrder": order,
                        "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
                        "numberOfIterations": x["sets"], "workoutSteps": inner,
                        "endCondition": END_ITERATIONS, "endConditionValue": float(x["sets"]), "smartRepeat": False})
        else:
            out.append(work(x, label))
            out.append(step("rest", END_TIME, rest))
    if out and out[-1]["type"] == "ExecutableStepDTO" and out[-1]["stepType"]["stepTypeKey"] == "rest":
        out.pop()  # keine Pause nach der letzten Uebung
    renumber(out, [0])
    return out


def renumber(steps, counter):
    """stepOrder lueckenlos 1, 2, 3 ... (Wiederholung vor ihren Schritten)."""
    for s in steps:
        counter[0] += 1
        s["stepOrder"] = counter[0]
        if s["type"] == "RepeatGroupDTO":
            renumber(s["workoutSteps"], counter)


def exercise_workouts(entry, exercises):
    """Kraft/Mobility -> Liste von Varianten (beste zuerst): erst mit Garmins
    Uebungskatalog und eigener Sportart, dann vorsichtiger. Lehnt Garmin eine
    Variante ab, wird die naechste versucht (siehe backend/garmin_push.py)."""
    cleaned = [c for c in (clean_exercise(x) for x in (exercises or [])) if c][:MAX_EXERCISES]
    if not cleaned:
        raise ValueError("keine Übungen")
    mobility = entry["sport"] == "Mobility"
    variants = []
    sports = EXERCISE_SPORTS[entry["sport"]]
    for i, (sport_id, sport_key, order) in enumerate(sports):
        with_catalog = i < len(sports) - 1  # letzte Stufe: ohne Katalog, nur Namen
        sport = {"sportTypeId": sport_id, "sportTypeKey": sport_key, "displayOrder": order}
        steps = exercise_steps(cleaned, mobility, with_catalog, [0])
        variants.append({
            "workoutName": str(entry.get("title") or entry["sport"])[:80],
            "sportType": sport,
            "estimatedDurationInSecs": int(minutes_or_zero(entry.get("duration_min")) * 60) or int(timed_seconds(steps)),
            "workoutSegments": [{"segmentOrder": 1, "sportType": sport, "workoutSteps": steps}],
            "description": workout_description(entry),
        })
    return variants


DEFAULT_HR_ZONE = {"leicht": 2, "mittel": 3, "hart": 4}
SWIM_PACE_S = 120  # ohne CSS: 2:00 /100 m
MAIN_SET = re.compile(r"(\d{1,2})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(km|m|min|sek|s)\b", re.I)
SET_REST = re.compile(r"(?:/|mit|P(?:ause)?|Trabpause)\s*(\d+(?:[.,]\d+)?)\s*(min|sek|s)\b", re.I)


def parse_main_set(entry):
    """Wie parseMainSet() im Browser: "6×800 m mit 2 min Trabpause" -> Satz."""
    text = f"{entry.get('title') or ''} {entry.get('description') or ''}"
    m = MAIN_SET.search(text)
    if not m:
        return None
    count, value, unit = int(m.group(1)), float(m.group(2).replace(",", ".")), m.group(3).lower()
    if not (2 <= count <= 30) or value <= 0:
        return None
    out = {"count": count}
    if unit in ("km", "m"):
        out["distance_km"] = value if unit == "km" else value / 1000
        if not 0.025 <= out["distance_km"] <= 20:
            return None
    else:
        out["duration_min"] = value if unit == "min" else value / 60
        if not 0.25 <= out["duration_min"] <= 60:
            return None
    r = SET_REST.search(text[m.end():m.end() + 40])
    if r:
        v = float(r.group(1).replace(",", "."))
        rest = v if r.group(2).lower() == "min" else v / 60
        if 0 < rest <= 15:
            out["rest_min"] = rest
    return out


def jsround(x):
    """Runden wie Math.round im Browser (2.5 -> 3), damit beide Seiten gleich rechnen."""
    return math.floor(x + 0.5)


def sec_round(minutes):
    return jsround(minutes * 60) / 60


def tstep(kind, minutes, target, note):
    return {"type": kind, "duration_min": sec_round(minutes), "target": target, "note": note}


def fit_set(left, work, rest, low, high):
    count = int(left // (work + rest))
    if count < low:
        count = low
        per = left / count
        rest = min(rest, max(0.5, math.floor(per / 3 * 2) / 2))
        work = max(1.0, math.floor((per - rest) * 2) / 2)
    return min(count, high), work, rest


def land_steps(entry, d, intensity):
    """Laufen/Rad wie landSteps() im Browser (Ziele hier immer Puls-Zonen)."""
    run = entry["sport"] == "Laufen"

    def tgt(zone):
        return {"kind": "hr_zone", "zone": zone} if zone and zone > 1 else {"kind": "none"}
    if d < 20:
        return [tstep("interval", d, tgt(DEFAULT_HR_ZONE[intensity]), "Locker und gleichmäßig")]
    warm = 15 if d >= 60 else 10 if d >= 30 else 5
    cool = 10 if d >= 60 else 5
    word = ("Einlaufen", "Auslaufen") if run else ("Einrollen", "Ausrollen")
    out = [tstep("warmup", warm, tgt(1), f"{word[0]} · ganz locker")]
    left = d - warm - cool
    parsed = parse_main_set(entry)
    work_end, note, zone = None, "", 2
    if parsed:
        short = parsed.get("distance_km", 99) <= 0.6 or parsed.get("duration_min", 99) <= 3
        zone = (5 if short else 4) if intensity == "hart" else 3 if intensity == "mittel" else 2
        count = parsed["count"]
        if "duration_min" in parsed:
            work_min = parsed["duration_min"]
            work_end = {"duration_min": sec_round(work_min)}
            amount = f"{sec_round(work_min):g} min"
        else:
            km = parsed["distance_km"]
            work_min = km * 330 / 60 if run else km / 0.5
            work_end = {"distance_km": km}
            amount = f"{jsround(km * 1000)} m" if km < 1 else f"{km:g} km"
        rest = parsed.get("rest_min", 2 if intensity == "hart" else 1.5)
        note = f"{count}× {amount} · Zone {zone}"
    elif intensity == "mittel":
        count, work_min, rest = fit_set(left, (10 if d >= 60 else 8) if run else (15 if d >= 75 else 10), 2 if run else 5,
                                        2, 5 if run else 4)
        zone, note = 3, "Tempo · zügig, aber kontrolliert" if run else "Sweet Spot · kräftig, gleichmäßig treten"
    elif intensity == "hart":
        vo2 = d < 50
        count, work_min, rest = fit_set(left, (3 if vo2 else 5) if run else (3 if vo2 else 8),
                                        2 if run else (3 if vo2 else 4), 3, 8 if vo2 else 6)
        zone = 5 if vo2 else 4
        note = "Hart · VO2max, letzte Wiederholung gleich schnell" if vo2 else "Schwelle · hart, aber gleichmäßig"
    if parsed or intensity in ("mittel", "hart"):
        base = left - count * (work_min + rest)
        if parsed:
            base = jsround(base)  # Saetze aus dem Text: geschaetzt -> ganze Minuten
        if base >= 5:
            out.append(tstep("interval", base, tgt(2), "Grundlage · locker, Reden geht"))
        elif base > 0:
            out[0]["duration_min"] = sec_round(out[0]["duration_min"] + base)
        work = {"type": "interval", **(work_end or {"duration_min": sec_round(work_min)}), "target": tgt(zone), "note": note}
        rec = tstep("recovery", rest, tgt(1), "Traben · locker erholen" if run else "Locker kurbeln · erholen")
        out.append({"type": "repeat", "count": count, "steps": [work, rec]})
    elif d >= 40:
        n, w, r, z, wn, rn = ((4, 20 / 60, 40 / 60, None, "Steigerung · locker schnell, kein Sprint", "Gehen oder traben") if run
                              else (3, 1, 2, 3, "Hohe Trittfrequenz · über 100/min", "Locker kurbeln"))
        out.append(tstep("interval", left - n * (w + r), tgt(2), "Grundlage · locker, Reden geht"))
        out.append({"type": "repeat", "count": n, "steps": [tstep("interval", w, tgt(z), wn), tstep("recovery", r, tgt(1), rn)]})
    else:
        out.append(tstep("interval", left, tgt(2), "Grundlage · locker, Reden geht"))
    out.append(tstep("cooldown", cool, tgt(1), f"{word[1]} · ganz locker"))
    return out


def swim_steps(entry, d, intensity):
    """Schwimmen wie swimSteps() im Browser (ohne CSS: 2:00 /100 m, ohne Pace-Ziel)."""
    def secs(m, f):
        return m / 100 * SWIM_PACE_S * f

    def swim(kind, meters, stroke, note):
        return {"type": kind, "distance_km": jsround(meters) / 1000, "stroke": stroke, "target": {"kind": "none"}, "note": note}

    def rest(s):
        return {"type": "rest", "duration_min": s / 60, "target": {"kind": "none"}, "note": "Pause am Rand"}
    budget = d * 60
    warm = min(400, max(100, jsround(d * 60 * 0.15 / secs(1, 1.25) / 50) * 50))
    cool = 200 if d >= 45 else 100
    out = [swim("warmup", warm, "free", "Einschwimmen · locker, lang gleiten")]
    budget -= secs(warm, 1.25) + secs(cool, 1.3)
    if d >= 25:
        n = 8 if d >= 50 else 6 if d >= 35 else 4
        out.append({"type": "repeat", "count": n, "steps": [swim("interval", 50, "drill", "Technik · z. B. Abschlag, Faust, Zählen"), rest(15)]})
        budget -= n * (secs(50, 1.4) + 15) - 15
    parsed = parse_main_set(entry)
    if parsed and "distance_km" in parsed:
        length = min(1500, max(25, jsround(parsed["distance_km"] * 1000 / 25) * 25))
        zone = (5 if length <= 50 else 4) if intensity == "hart" else 3 if intensity == "mittel" else 2
        count = parsed["count"]
        rest_s = jsround(parsed["rest_min"] * 60) if "rest_min" in parsed else (20 if length <= 100 else 30)
    else:
        length = {"leicht": 300 if d >= 60 else 200, "mittel": 200 if d >= 60 else 100, "hart": 50 if d < 35 else 100}[intensity]
        rest_s = {"leicht": 20, "mittel": 15, "hart": 30 if length <= 50 else 20}[intensity]
        zone = {"leicht": 2, "mittel": 3, "hart": 5 if length <= 50 else 4}[intensity]
        f = {2: 1.15, 3: 1.05, 4: 1.0, 5: 0.94}[zone]
        count = min(30, max(2, int((budget + rest_s) // (secs(length, f) + rest_s))))
    words = {2: "Gleichmäßig locker · saubere Technik", 3: "Zügig · gleichmäßiges Tempo", 4: "Hart · CSS-Tempo halten",
             5: "Sehr schnell · volle Kraft"}
    out.append({"type": "repeat", "count": count, "steps": [swim("interval", length, "free", f"Hauptsatz · {words[zone]}"), rest(rest_s)]})
    out.append(swim("cooldown", cool, "any", "Ausschwimmen · locker, beliebiger Stil"))
    return out


def default_steps(entry):
    """Wie defaultWorkoutSteps() in js/data/planned-workouts.js - fuer Einheiten,
    deren Schritte der Browser (noch) nicht geschickt hat: vollstaendiger
    Ablauf mit Aufwaermen, Hauptsatz als Wiederholung, Pausen, Ausklang."""
    d = minutes_or_zero(entry.get("duration_min")) or None
    intensity = entry.get("intensity") if entry.get("intensity") in DEFAULT_HR_ZONE else "leicht"
    if not d:
        zone = DEFAULT_HR_ZONE.get(entry.get("intensity")) if entry.get("sport") != "Schwimmen" else None
        return [{"type": "interval", "target": {"kind": "hr_zone", "zone": zone} if zone else {"kind": "none"}}]
    return swim_steps(entry, d, intensity) if entry.get("sport") == "Schwimmen" else land_steps(entry, d, intensity)


def workout_variants(entry, steps=None, exercises=None):
    """Alle Sportarten: Liste der Garmin-Workouts (beste Variante zuerst)."""
    sport = entry.get("sport")
    if sport in EXERCISE_SPORTS:
        return exercise_workouts(entry, exercises if exercises else entry.get("exercises"))
    if sport in SPORTS:
        workout = garmin_workout(entry, steps or entry.get("steps") or default_steps(entry))
        return [workout, without_swim_details(workout)] if sport == "Schwimmen" else [workout]
    raise ValueError("Sportart nicht unterstützt")


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
    """POST - Einheit jetzt an Garmin (anlegen oder aktualisieren, nie doppelt)
    -> {garmin_workout_id, scheduled_date}. Body: {steps?, exercises?}."""
    from . import Session
    from .garmin_push import PushStopped, library_available, open_client, run_push

    athlete_id = get_current_athlete_id()
    entry = find_planned_workout(athlete_id, workout_id)
    if entry is None:
        return response_error("Diese geplante Einheit gibt es nicht (mehr). Seite neu laden und erneut versuchen.",
                              "not_found", 404)
    if not isinstance(entry.get("sport"), str) or entry["sport"] not in SPORTS and entry["sport"] not in EXERCISE_SPORTS:
        return response_error(f"{entry.get('sport') or 'Diese'}-Einheiten kann Garmin nicht als Workout übernehmen. "
                              "Lade die Einheit stattdessen als .fit-Datei herunter.", "unsupported_sport", 422)
    body = request.get_json(silent=True)
    body = body if isinstance(body, dict) else {}  # z. B. [1, 2] oder "x" -> wie ohne Body
    if body.get("steps") is not None and not isinstance(body.get("steps"), list):
        return response_error("Die Schritte dieser Einheit sind ungültig. Bitte im Bearbeiten-Fenster prüfen.",
                              "VALIDATION_ERROR", 400)
    steps = body.get("steps") or None
    exercises = body.get("exercises") if isinstance(body.get("exercises"), list) else None
    try:
        workout_variants(entry, steps, exercises)
    except ValueError as e:
        return response_error(f"Die Schritte dieser Einheit sind ungültig ({e}). Bitte im Bearbeiten-Fenster prüfen.",
                              "VALIDATION_ERROR", 400)
    if importlib.util.find_spec("garminconnect") is None and not library_available():
        return response_error("Auf dem Dashboard-PC fehlt die Garmin-Bibliothek: "
                              "python -m pip install -r requirements.txt", "garmin_library_missing", 503)
    item = {"id": workout_id, **({"steps": steps} if steps else {}), **({"exercises": exercises} if exercises else {})}
    result = run_push(athlete_id, Session, items=[item], only=[workout_id], pin=True, client_factory=open_client)
    if result["stopped"]:
        st = result["stopped"]
        return response_error(f"{st['message']} {FIT_HINT}", st["code"], st["status"])
    link = result["links"].get(workout_id)
    if result["failed"] or link is None:
        return response_error("Garmin hat das Workout nicht angenommen oder ist nicht erreichbar. Später erneut "
                              "versuchen - oder die Einheit als .fit-Datei herunterladen.", "garmin_error", 502)
    return response_success({"garmin_workout_id": link["garmin_workout_id"], "scheduled_date": link["date"]})
