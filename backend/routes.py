"""API routes for triathlon dashboard.

Jeder Endpunkt filtert nach der athlete_id aus dem Login-Token
(get_current_athlete_id); ohne gueltigen Token gibt es 401 (require_login),
ausser bei /health und /auth/login.

Response format: {"data": [...], "meta": {}} or {"error": "...", "code": "...", "status": 404}
"""
from flask import Blueprint, request, jsonify, Response
from datetime import datetime, date
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as SessionType

from . import get_current_athlete_id
from .auth import check_login, make_token, note_failed_login, too_many_failed_logins
from .models import Athlete, AthleteLogin, Workout, Wellness, PlannedWorkout, RecoveryCheck, Goal, IcalPlannedWorkout

api_bp = Blueprint("api", __name__)

# Die einzigen Endpunkte, die ohne Login erreichbar sind.
PUBLIC_ENDPOINTS = {"api.health_check", "api.login"}


@api_bp.before_request
def require_login():
    """Ohne gueltigen Bearer-Token: 401 fuer alles ausser PUBLIC_ENDPOINTS."""
    if request.endpoint in PUBLIC_ENDPOINTS:
        return None
    if get_current_athlete_id() is None:
        return response_error("Nicht angemeldet", "unauthorized", 401)
    return None


def response_success(data, meta=None, status=200):
    """Standard success response."""
    return jsonify({
        "data": data,
        "meta": meta or {}
    }), status


def response_error(error, code, status=400):
    """Standard error response."""
    return jsonify({
        "error": error,
        "code": code,
        "status": status
    }), status


def get_session():
    """Get database session - bei jedem Aufruf die aktuelle Fabrik aus
    create_app(), nicht eine beim Import festgehaltene."""
    from . import Session
    return Session()


def serialize_athlete(a: Athlete) -> dict:
    """Convert Athlete model to dict."""
    return {
        "id": a.id,
        "name": a.name,
        "email": a.email,
        "weight_kg": a.weight_kg,
        "height_cm": a.height_cm,
        "ftp_watts": a.ftp_watts,
        "lthr_bpm": a.lthr_bpm,
        "training_days": a.training_days.split(",") if a.training_days else [],
        "training_experience": a.training_experience,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def serialize_workout(w: Workout) -> dict:
    """Convert Workout model to dict."""
    return {
        "id": w.id,
        "date": w.date.isoformat() if w.date else None,
        "sport": w.sport,
        "sub_sport": w.sub_sport,
        "duration_min": w.duration_min,
        "distance_km": w.distance_km,
        "elevation_m": w.elevation_m,
        "calories": w.calories,
        "avg_hr": w.avg_hr,
        "max_hr": w.max_hr,
        "avg_pace_sec_per_km": w.avg_pace_sec_per_km,
        "avg_power_watts": w.avg_power_watts,
        "avg_cadence": w.avg_cadence,
        "training_load_score": w.training_load_score,
        "source": w.source,
        "notes": w.notes,
        "created_at": w.created_at.isoformat() if w.created_at else None,
    }


def serialize_wellness(w: Wellness) -> dict:
    """Convert Wellness model to dict."""
    return {
        "id": w.id,
        "date": w.date.isoformat() if w.date else None,
        "sleep_min": w.sleep_min,
        "sleep_quality": w.sleep_quality,
        "hrv_ms": w.hrv_ms,
        "resting_hr": w.resting_hr,
        "body_battery_start": w.body_battery_start,
        "body_battery_end": w.body_battery_end,
        "stress_level": w.stress_level,
        "training_readiness": w.training_readiness,
        "steps": w.steps,
        "created_at": w.created_at.isoformat() if w.created_at else None,
    }


def serialize_planned_workout(pw: PlannedWorkout) -> dict:
    """Convert PlannedWorkout model to dict."""
    return {
        "id": pw.id,
        "date": pw.date.isoformat() if pw.date else None,
        "sport": pw.sport,
        "name": pw.name,
        "description": pw.description,
        "duration_min": pw.duration_min,
        "distance_km": pw.distance_km,
        "intensity": pw.intensity,
        "training_phase": pw.training_phase,
        "status": pw.status,
        "source": pw.source,
        "notes": pw.notes,
        "created_at": pw.created_at.isoformat() if pw.created_at else None,
    }


def serialize_recovery_check(rc: RecoveryCheck) -> dict:
    """Convert RecoveryCheck model to dict."""
    return {
        "id": rc.id,
        "date": rc.date.isoformat() if rc.date else None,
        "energy_level": rc.energy_level,
        "muscle_soreness": rc.muscle_soreness,
        "motivation": rc.motivation,
        "skip_reasons": rc.skip_reasons or [],
        "notes": rc.notes,
        "created_at": rc.created_at.isoformat() if rc.created_at else None,
    }


def serialize_goal(g: Goal) -> dict:
    """Convert Goal model to dict."""
    return {
        "id": g.id,
        "name": g.name,
        "description": g.description,
        "goal_type": g.goal_type,
        "disciplines": g.disciplines.split(",") if g.disciplines else [],
        "event_date": g.event_date.isoformat() if g.event_date else None,
        "start_date": g.start_date.isoformat() if g.start_date else None,
        "end_date": g.end_date.isoformat() if g.end_date else None,
        "is_primary": g.is_primary,
        "status": g.status,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }


# ============================================================================
# AUTH ENDPOINTS (Benutzer legt nur backend/create_user.py an)
# ============================================================================

@api_bp.route("/auth/login", methods=["POST"])
def login():
    """POST /api/v1/auth/login - {username, password} -> {token, athlete}."""
    ip = request.remote_addr or "unknown"
    if too_many_failed_logins(ip):
        return response_error("Zu viele Fehlversuche - bitte eine Minute warten", "too_many_attempts", 429)

    data = request.get_json(silent=True) or {}
    session = get_session()
    try:
        athlete_id = check_login(session, data.get("username"), data.get("password"))
        if athlete_id is None:
            note_failed_login(ip)
            return response_error("Benutzername oder Passwort falsch", "invalid_credentials", 401)
        athlete = session.query(Athlete).filter_by(athlete_id=athlete_id).first()
        return response_success({"token": make_token(athlete_id), "athlete": serialize_athlete(athlete)})
    finally:
        session.close()


@api_bp.route("/auth/me", methods=["GET"])
def auth_me():
    """GET /api/v1/auth/me - Der angemeldete Athlet (inkl. Benutzername)."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        athlete = session.query(Athlete).filter_by(athlete_id=athlete_id).first()
        if not athlete:
            return response_error("Athlete not found", "athlete_not_found", 404)
        login_row = session.query(AthleteLogin).filter_by(athlete_id=athlete_id).first()
        return response_success({**serialize_athlete(athlete), "username": login_row.username if login_row else None})
    finally:
        session.close()


# ============================================================================
# ATHLETE ENDPOINTS
# ============================================================================

@api_bp.route("/athlete", methods=["GET"])
def get_athlete():
    """GET /api/v1/athlete - Get current athlete profile."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        athlete = session.query(Athlete).filter_by(athlete_id=athlete_id).first()

        if not athlete:
            return response_error("Athlete not found", "athlete_not_found", 404)

        return response_success(serialize_athlete(athlete))
    finally:
        session.close()


@api_bp.route("/athlete", methods=["PUT"])
def update_athlete():
    """PUT /api/v1/athlete - Update athlete profile."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        athlete = session.query(Athlete).filter_by(athlete_id=athlete_id).first()

        if not athlete:
            return response_error("Athlete not found", "athlete_not_found", 404)

        data = request.get_json()
        if data.get("name"):
            athlete.name = data["name"]
        if data.get("email"):
            athlete.email = data["email"]
        if data.get("weight_kg"):
            athlete.weight_kg = data["weight_kg"]
        if data.get("height_cm"):
            athlete.height_cm = data["height_cm"]
        if data.get("ftp_watts"):
            athlete.ftp_watts = data["ftp_watts"]
        if data.get("lthr_bpm"):
            athlete.lthr_bpm = data["lthr_bpm"]
        if data.get("training_days"):
            athlete.training_days = ",".join(data["training_days"]) if isinstance(data["training_days"], list) else data["training_days"]
        if data.get("training_experience"):
            athlete.training_experience = data["training_experience"]

        athlete.updated_at = datetime.utcnow()
        session.commit()

        return response_success(serialize_athlete(athlete))
    except Exception as e:
        session.rollback()
        return response_error(str(e), "update_error", 500)
    finally:
        session.close()


# ============================================================================
# WORKOUT ENDPOINTS
# ============================================================================

@api_bp.route("/workouts", methods=["GET"])
def get_workouts():
    """GET /api/v1/workouts - List workouts with optional filtering."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        query = session.query(Workout).filter_by(athlete_id=athlete_id)

        # Optional filters
        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")
        sport = request.args.get("sport")

        if start_date:
            query = query.filter(Workout.date >= datetime.fromisoformat(start_date).date())
        if end_date:
            query = query.filter(Workout.date <= datetime.fromisoformat(end_date).date())
        if sport:
            query = query.filter_by(sport=sport)

        workouts = query.order_by(Workout.date.desc()).all()
        return response_success([serialize_workout(w) for w in workouts])
    finally:
        session.close()


@api_bp.route("/workouts", methods=["POST"])
def create_workout():
    """POST /api/v1/workouts - Create or update workout."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        data = request.get_json()

        # Check for UNIQUE constraint (athlete_id, garmin_activity_id)
        if data.get("garmin_activity_id"):
            existing = session.query(Workout).filter_by(
                athlete_id=athlete_id,
                garmin_activity_id=data["garmin_activity_id"]
            ).first()
            if existing:
                # Update existing
                for key in ["date", "sport", "sub_sport", "duration_min", "distance_km", "elevation_m",
                           "calories", "avg_hr", "max_hr", "avg_pace_sec_per_km", "avg_power_watts",
                           "avg_cadence", "training_load_score", "notes"]:
                    if key in data:
                        setattr(existing, key, data[key])
                existing.updated_at = datetime.utcnow()
                session.commit()
                return response_success(serialize_workout(existing))

        # Create new
        workout = Workout(
            athlete_id=athlete_id,
            date=datetime.fromisoformat(data["date"]).date() if isinstance(data["date"], str) else data["date"],
            sport=data.get("sport", "running"),
            sub_sport=data.get("sub_sport"),
            duration_min=data.get("duration_min", 0),
            distance_km=data.get("distance_km"),
            elevation_m=data.get("elevation_m"),
            calories=data.get("calories"),
            avg_hr=data.get("avg_hr"),
            max_hr=data.get("max_hr"),
            avg_pace_sec_per_km=data.get("avg_pace_sec_per_km"),
            avg_power_watts=data.get("avg_power_watts"),
            avg_cadence=data.get("avg_cadence"),
            training_load_score=data.get("training_load_score"),
            source=data.get("source", "manual"),
            garmin_activity_id=data.get("garmin_activity_id"),
            notes=data.get("notes"),
        )
        session.add(workout)
        session.commit()
        return response_success(serialize_workout(workout), status=201)
    except IntegrityError as e:
        session.rollback()
        return response_error("Duplicate or constraint error", "constraint_error", 400)
    except Exception as e:
        session.rollback()
        return response_error(str(e), "create_error", 500)
    finally:
        session.close()


# ============================================================================
# WELLNESS ENDPOINTS
# ============================================================================

@api_bp.route("/wellness", methods=["GET"])
def get_wellness():
    """GET /api/v1/wellness - List wellness data."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        query = session.query(Wellness).filter_by(athlete_id=athlete_id)

        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")

        if start_date:
            query = query.filter(Wellness.date >= datetime.fromisoformat(start_date).date())
        if end_date:
            query = query.filter(Wellness.date <= datetime.fromisoformat(end_date).date())

        wellness = query.order_by(Wellness.date.desc()).all()
        return response_success([serialize_wellness(w) for w in wellness])
    finally:
        session.close()


@api_bp.route("/wellness", methods=["POST"])
def create_or_update_wellness():
    """POST /api/v1/wellness - Create or update wellness data."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        data = request.get_json()
        wellness_date = datetime.fromisoformat(data["date"]).date() if isinstance(data["date"], str) else data["date"]

        # Check for existing (UNIQUE athlete_id, date)
        existing = session.query(Wellness).filter_by(
            athlete_id=athlete_id,
            date=wellness_date
        ).first()

        if existing:
            # Update
            for key in ["sleep_min", "sleep_quality", "hrv_ms", "resting_hr", "body_battery_start",
                       "body_battery_end", "stress_level", "training_readiness", "steps"]:
                if key in data:
                    setattr(existing, key, data[key])
            existing.updated_at = datetime.utcnow()
            session.commit()
            return response_success(serialize_wellness(existing))

        # Create
        wellness = Wellness(
            athlete_id=athlete_id,
            date=wellness_date,
            sleep_min=data.get("sleep_min"),
            sleep_quality=data.get("sleep_quality"),
            hrv_ms=data.get("hrv_ms"),
            resting_hr=data.get("resting_hr"),
            body_battery_start=data.get("body_battery_start"),
            body_battery_end=data.get("body_battery_end"),
            stress_level=data.get("stress_level"),
            training_readiness=data.get("training_readiness"),
            steps=data.get("steps"),
        )
        session.add(wellness)
        session.commit()
        return response_success(serialize_wellness(wellness), status=201)
    except IntegrityError:
        session.rollback()
        return response_error("Duplicate date", "duplicate_date", 400)
    except Exception as e:
        session.rollback()
        return response_error(str(e), "create_error", 500)
    finally:
        session.close()


# ============================================================================
# PLANNED WORKOUT ENDPOINTS
# ============================================================================

@api_bp.route("/planned-workouts", methods=["GET"])
def get_planned_workouts():
    """GET /api/v1/planned-workouts - List planned workouts."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        query = session.query(PlannedWorkout).filter_by(athlete_id=athlete_id)

        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")

        if start_date:
            query = query.filter(PlannedWorkout.date >= datetime.fromisoformat(start_date).date())
        if end_date:
            query = query.filter(PlannedWorkout.date <= datetime.fromisoformat(end_date).date())

        workouts = query.order_by(PlannedWorkout.date).all()
        return response_success([serialize_planned_workout(w) for w in workouts])
    finally:
        session.close()


@api_bp.route("/planned-workouts", methods=["POST"])
def create_planned_workout():
    """POST /api/v1/planned-workouts - Create planned workout."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        data = request.get_json()

        # Nur an ein EIGENES Ziel haengen, nie an das eines anderen Athleten.
        if data.get("goal_id") and not session.query(Goal).filter_by(id=data["goal_id"], athlete_id=athlete_id).first():
            return response_error("Goal not found", "goal_not_found", 404)

        workout = PlannedWorkout(
            athlete_id=athlete_id,
            goal_id=data.get("goal_id"),
            date=datetime.fromisoformat(data["date"]).date() if isinstance(data["date"], str) else data["date"],
            sport=data.get("sport", "running"),
            name=data.get("name"),
            description=data.get("description"),
            duration_min=data.get("duration_min"),
            distance_km=data.get("distance_km"),
            intensity=data.get("intensity"),
            training_phase=data.get("training_phase"),
            status=data.get("status", "geplant"),
            source=data.get("source", "manual"),
            notes=data.get("notes"),
        )
        session.add(workout)
        session.commit()
        return response_success(serialize_planned_workout(workout), status=201)
    except Exception as e:
        session.rollback()
        return response_error(str(e), "create_error", 500)
    finally:
        session.close()


# ============================================================================
# RECOVERY CHECK ENDPOINTS
# ============================================================================

@api_bp.route("/recovery-checks", methods=["GET"])
def get_recovery_checks():
    """GET /api/v1/recovery-checks - List recovery checks."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        query = session.query(RecoveryCheck).filter_by(athlete_id=athlete_id)

        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")

        if start_date:
            query = query.filter(RecoveryCheck.date >= datetime.fromisoformat(start_date).date())
        if end_date:
            query = query.filter(RecoveryCheck.date <= datetime.fromisoformat(end_date).date())

        checks = query.order_by(RecoveryCheck.date.desc()).all()
        return response_success([serialize_recovery_check(c) for c in checks])
    finally:
        session.close()


@api_bp.route("/recovery-checks", methods=["POST"])
def create_recovery_check():
    """POST /api/v1/recovery-checks - Create recovery check."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        data = request.get_json()

        check = RecoveryCheck(
            athlete_id=athlete_id,
            date=datetime.fromisoformat(data["date"]).date() if isinstance(data["date"], str) else data["date"],
            energy_level=data.get("energy_level"),
            muscle_soreness=data.get("muscle_soreness"),
            motivation=data.get("motivation"),
            skip_reasons=data.get("skip_reasons"),
            notes=data.get("notes"),
        )
        session.add(check)
        session.commit()
        return response_success(serialize_recovery_check(check), status=201)
    except Exception as e:
        session.rollback()
        return response_error(str(e), "create_error", 500)
    finally:
        session.close()


# ============================================================================
# GOAL ENDPOINTS
# ============================================================================

@api_bp.route("/goals", methods=["GET"])
def get_goals():
    """GET /api/v1/goals - List goals."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        goals = session.query(Goal).filter_by(athlete_id=athlete_id).order_by(Goal.created_at.desc()).all()
        return response_success([serialize_goal(g) for g in goals])
    finally:
        session.close()


@api_bp.route("/goals", methods=["POST"])
def create_goal():
    """POST /api/v1/goals - Create goal."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        data = request.get_json()

        goal = Goal(
            athlete_id=athlete_id,
            name=data.get("name", "New Goal"),
            description=data.get("description"),
            goal_type=data.get("goal_type"),
            disciplines=",".join(data["disciplines"]) if isinstance(data.get("disciplines"), list) else data.get("disciplines", ""),
            event_date=datetime.fromisoformat(data["event_date"]).date() if data.get("event_date") else None,
            start_date=datetime.fromisoformat(data["start_date"]).date() if isinstance(data.get("start_date"), str) else data.get("start_date"),
            end_date=datetime.fromisoformat(data["end_date"]).date() if data.get("end_date") else None,
            is_primary=data.get("is_primary", False),
            status=data.get("status", "active"),
        )
        session.add(goal)
        session.commit()
        return response_success(serialize_goal(goal), status=201)
    except Exception as e:
        session.rollback()
        return response_error(str(e), "create_error", 500)
    finally:
        session.close()


# ============================================================================
# HEALTH CHECK
# ============================================================================

@api_bp.route("/health", methods=["GET"])
def health_check():
    """GET /api/v1/health - API health check."""
    return response_success({"status": "ok", "version": "1.0.0"})

# ============================================================================
# ICAL-KALENDER-ABO (CHANGE_REQUESTS.md) - siehe IcalPlannedWorkout in
# models.py fuer den "warum eine eigene Tabelle statt PlannedWorkout"-Hintergrund.
# Funktioniert nur, waehrend dieser Flask-Server lokal laeuft; kein "online"
# Zugriff, bis das Projekt selbst gehostet wird (siehe DEPLOYMENT.md).
# ============================================================================

@api_bp.route("/ical-sync", methods=["POST"])
def sync_ical_planned_workouts():
    """POST /api/v1/ical-sync - Frontend schickt den KOMPLETTEN aktuellen
    Trainingsplan (js/data/planned-workouts.js: plannedWorkouts) bei jeder
    Aenderung (savePlannedWorkouts()). Ersetzt hier einfach ALLES fuer diesen
    Athleten (loeschen + neu einfuegen) statt einzelne Eintraege abzugleichen
    - deutlich einfacher und robust genug fuer eine reine Lese-Ansicht wie
    einen Kalender-Feed (kein Datenverlust, da die eigentliche Quelle der
    Wahrheit weiterhin der Browser/localStorage bleibt)."""
    athlete_id = get_current_athlete_id()
    data = request.get_json(silent=True) or {}
    workouts = data.get("workouts")
    if not isinstance(workouts, list):
        return response_error("'workouts' muss ein Array sein", "VALIDATION_ERROR", 400)

    session: SessionType = get_session()
    try:
        session.query(IcalPlannedWorkout).filter_by(athlete_id=athlete_id).delete()
        for w in workouts:
            if not w.get("id") or not w.get("date") or w.get("status") != "geplant":
                continue  # erledigte/uebersprungene Einheiten gehoeren nicht in einen Vorschau-Kalender
            session.add(IcalPlannedWorkout(
                id=str(w["id"]),
                athlete_id=athlete_id,
                date=w["date"],
                sport=w.get("sport"),
                title=w.get("title"),
                duration_min=w.get("duration_min"),
                intensity=w.get("intensity"),
                description=w.get("description"),
                status=w.get("status"),
            ))
        session.commit()
        return response_success({"synced": len(workouts)})
    except Exception as e:
        session.rollback()
        return response_error(str(e), "sync_error", 500)
    finally:
        session.close()


def _ics_escape(text):
    """Escape von Komma/Semikolon/Backslash/Zeilenumbruch nach RFC 5545."""
    if not text:
        return ""
    return (
        str(text).replace("\\", "\\\\").replace(",", "\\,")
        .replace(";", "\\;").replace("\n", "\\n")
    )


def _ics_fold(line):
    """RFC 5545 verlangt das Umbrechen von Zeilen >75 Oktett - je Folgezeile
    mit genau einem Leerzeichen eingerueckt."""
    if len(line.encode("utf-8")) <= 75:
        return line
    out, rest = line[:75], line[75:]
    while rest:
        out += "\r\n " + rest[:74]
        rest = rest[74:]
    return out


INTENSITY_LABEL_DE = {"leicht": "leicht", "mittel": "mittel", "hart": "hart"}


@api_bp.route("/ical/<int:athlete_id>.ics", methods=["GET"])
def get_ical_feed(athlete_id):
    """GET /api/v1/ical/<athlete_id>.ics - Abonnierbarer Kalender-Feed
    (webcal://.../api/v1/ical/1.ics bzw. http:// als Fallback) mit allen noch
    geplanten Einheiten. Ganztaegige Termine (VALUE=DATE), da geplante
    Einheiten keine Uhrzeit haben (siehe DATA_MODEL.md). Nur der eigene Feed
    ist abrufbar - fremde athlete_ids sehen aus wie nicht vorhanden."""
    if athlete_id != get_current_athlete_id():
        return response_error("Kalender nicht gefunden", "not_found", 404)
    session: SessionType = get_session()
    try:
        rows = session.query(IcalPlannedWorkout).filter_by(athlete_id=athlete_id).order_by(IcalPlannedWorkout.date).all()
        lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Triathlon Dashboard//iCal Export//DE", "CALSCALE:GREGORIAN"]
        now_stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        for r in rows:
            date_compact = r.date.replace("-", "")
            summary = f"{r.sport or 'Training'}: {r.title or ''}".strip(": ")
            desc_bits = []
            if r.duration_min:
                desc_bits.append(f"{int(r.duration_min)} min")
            if r.intensity:
                desc_bits.append(INTENSITY_LABEL_DE.get(r.intensity, r.intensity))
            if r.description:
                desc_bits.append(r.description)
            lines += [
                "BEGIN:VEVENT",
                f"UID:{r.id}@triathlon-dashboard.local",
                f"DTSTAMP:{now_stamp}",
                f"DTSTART;VALUE=DATE:{date_compact}",
                _ics_fold(f"SUMMARY:{_ics_escape(summary)}"),
                _ics_fold(f"DESCRIPTION:{_ics_escape(' | '.join(desc_bits))}"),
                "END:VEVENT",
            ]
        lines.append("END:VCALENDAR")
        body = "\r\n".join(lines) + "\r\n"
        return Response(body, mimetype="text/calendar", headers={"Content-Disposition": "inline; filename=trainingsplan.ics"})
    finally:
        session.close()
