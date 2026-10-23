"""Endpunkte fuer das Dashboard im Browser: Ablage pro Person, komplette
Workouts, Gesundheitsdaten je Tag, geheimer Kalender-Link.

Haengen am selben Blueprint wie routes.py - require_login() schuetzt sie also
automatisch, und jede Abfrage filtert nach der athlete_id aus dem Token.
Die bestehenden Endpunkte in routes.py bleiben unveraendert.
"""
import gzip
import json
import re
from datetime import datetime

from flask import Response, request
from sqlalchemy.exc import IntegrityError

from . import get_current_athlete_id
from .auth import make_ical_key
from .models import AthleteStore, Wellness, Workout
from .routes import api_bp, get_session, response_error, response_success

STORE_KEY_RE = re.compile(r"^[a-z0-9_]{1,64}$")


def json_response(payload):
    """Wie response_success, aber gepackt (gzip), wenn der Browser das kann -
    die Workout-Liste mit allen Kurven ist sonst schnell viele MB gross."""
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = {"Vary": "Accept-Encoding"}
    if "gzip" in request.headers.get("Accept-Encoding", ""):
        body = gzip.compress(body, compresslevel=5)
        headers["Content-Encoding"] = "gzip"
    return Response(body, mimetype="application/json", headers=headers)


# ============================================================================
# ABLAGE PRO PERSON (ersetzt localStorage im Browser)
# ============================================================================

@api_bp.route("/store", methods=["GET"])
def get_store():
    """GET /api/v1/store - alle abgelegten Werte des Athleten als {key: value}."""
    session = get_session()
    try:
        rows = session.query(AthleteStore).filter_by(athlete_id=get_current_athlete_id()).all()
        return response_success({r.key: r.value for r in rows})
    finally:
        session.close()


@api_bp.route("/store/<key>", methods=["PUT"])
def put_store(key):
    """PUT /api/v1/store/<key> - {value: ...} speichern (ersetzt den alten Wert)."""
    if not STORE_KEY_RE.match(key):
        return response_error("Ungueltiger Schluessel", "invalid_key", 400)
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or "value" not in data:
        return response_error("'value' fehlt", "VALIDATION_ERROR", 400)

    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        # Zweiter Versuch nur fuer den Wettlauf zweier gleichzeitiger
        # Erst-Speicherungen (zwei Tabs): dann gibt es die Zeile inzwischen
        # und es wird einfach sie aktualisiert.
        for attempt in range(2):
            row = session.query(AthleteStore).filter_by(athlete_id=athlete_id, key=key).first()
            if row is None:
                row = AthleteStore(athlete_id=athlete_id, key=key)
                session.add(row)
            row.value = data["value"]
            row.updated_at = datetime.utcnow()
            try:
                session.commit()
                return response_success({"key": key})
            except IntegrityError:
                session.rollback()
        return response_error("Bitte erneut speichern", "conflict", 409)
    finally:
        session.close()


# ============================================================================
# WORKOUTS UND GESUNDHEITSDATEN IN DER FORM, DIE DAS DASHBOARD KENNT
# ============================================================================

def workout_for_dashboard(w: Workout) -> dict:
    """Das komplette Parser-Ergebnis (fit_data, mit Kurven) - oder, fuer
    Eintraege ohne .fit-Datei, ein schlankes Objekt aus den Spalten."""
    if w.fit_data:
        return w.fit_data
    return {
        "file": f"db-{w.id}",
        "date": w.date.isoformat() if w.date else None,
        "sport": w.sport,
        "sub_sport": w.sub_sport,
        "duration_min": w.duration_min,
        "duration_s": w.duration_min * 60 if w.duration_min else None,
        "distance_km": w.distance_km,
        "elevation_gain_m": w.elevation_m,
        "calories": w.calories,
        "avg_hr": w.avg_hr,
        "max_hr": w.max_hr,
        "avg_power_w": w.avg_power_watts,
        "avg_cadence": w.avg_cadence,
        "training_load": w.training_load_score,
    }


@api_bp.route("/workouts/full", methods=["GET"])
def get_workouts_full():
    """GET /api/v1/workouts/full - alle Workouts des Athleten mit allen Details."""
    session = get_session()
    try:
        rows = session.query(Workout).filter_by(athlete_id=get_current_athlete_id()).order_by(Workout.date).all()
        return json_response({"data": [workout_for_dashboard(w) for w in rows], "meta": {"count": len(rows)}})
    finally:
        session.close()


@api_bp.route("/wellness/daily", methods=["GET"])
def get_wellness_daily():
    """GET /api/v1/wellness/daily - Gesundheitsdaten je Tag in derselben Form
    wie frueher data/wellness-data.js ({sync, daily: {"YYYY-MM-DD": {...}}})."""
    session = get_session()
    try:
        rows = session.query(Wellness).filter_by(athlete_id=get_current_athlete_id()).all()
        daily = {}
        for r in rows:
            daily[r.date.isoformat()] = r.garmin_wellness_data or {
                "sleep_min": r.sleep_min, "hrv_ms": r.hrv_ms, "resting_hr": r.resting_hr, "steps": r.steps,
            }
        last = max((r.updated_at for r in rows if r.updated_at), default=None)
        return response_success({
            "generated_at": last.isoformat() if last else None,
            "sync": {"at": last.isoformat()} if last else None,
            "daily": daily,
        })
    finally:
        session.close()


@api_bp.route("/ical-link", methods=["GET"])
def get_ical_link():
    """GET /api/v1/ical-link - persoenliche Abo-Adresse fuer Kalender-Apps
    (mit geheimem Schluessel statt Login, siehe auth.make_ical_key)."""
    athlete_id = get_current_athlete_id()
    return response_success({"path": f"api/v1/ical/{athlete_id}.ics?key={make_ical_key(athlete_id)}"})
