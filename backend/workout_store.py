"""Workouts aus dem .fit-Parser (Browser: js/data/fit-parser.js, oder
parse_fit.py) in die Datenbank schreiben - EINE Stelle fuer alle Wege:
POST /api/v1/workouts, backend/import_workouts_json.py und tools/garmin_sync.py.

Das komplette Parser-Ergebnis (inkl. Kurven) landet in fit_data - das liest
das Dashboard (GET /api/v1/workouts/full). Die Spalten sind eine Kurzfassung
fuer die bestehenden Endpunkte.
"""
from datetime import datetime

from .models import Workout


def parse_start(value):
    """Startzeit als datetime. Browser ("...Z") und parse_fit.py ("...+00:00")
    schreiben dieselbe Zeit unterschiedlich - verglichen wird deshalb der
    Zeitpunkt, nicht der Text."""
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def local_day(workout):
    """Kalendertag in lokaler Zeit: ein Training um 23 Uhr gehoert zum heutigen Tag."""
    start = parse_start(workout.get("date"))
    return start.astimezone().date() if start else None


def find_same_workout(session, athlete_id, day, workout, only_without_garmin_id=False):
    """Dieselbe Einheit schon gespeichert? Gleicher Tag + gleiche Startzeit +
    gleiche Sportart (sport_raw)."""
    start = parse_start(workout.get("date"))
    if day is None or start is None:
        return None
    query = session.query(Workout).filter_by(athlete_id=athlete_id, date=day)
    if only_without_garmin_id:
        query = query.filter(Workout.garmin_activity_id.is_(None))
    for row in query:
        fd = row.fit_data or {}
        if fd.get("sport_raw") == workout.get("sport_raw") and parse_start(fd.get("date")) == start:
            return row
    return None


def workout_from_parsed(athlete_id, workout, day, source, garmin_activity_id=None):
    """Neue Workout-Zeile aus einem Parser-Ergebnis."""
    return Workout(
        athlete_id=athlete_id,
        garmin_activity_id=garmin_activity_id,
        date=day,
        sport=workout.get("sport") or "Sonstiges",
        sub_sport=workout.get("sub_sport") or None,
        duration_min=workout.get("duration_min") or 0,
        distance_km=workout.get("distance_km"),
        elevation_m=workout.get("elevation_gain_m"),
        calories=workout.get("calories"),
        avg_hr=workout.get("avg_hr"),
        max_hr=workout.get("max_hr"),
        avg_power_watts=workout.get("avg_power_w"),
        avg_cadence=workout.get("avg_cadence"),
        training_load_score=workout.get("training_load"),
        source=source,
        fit_data=workout,
    )
