"""Nutzungsstatistik fuer den Betreiber (Mehr -> Statistik).

    POST /api/v1/usage        {events: [{kind, name}]} - jeder angemeldete Nutzer, nur erlaubte Namen
    GET  /api/v1/admin/stats  ?days=30 - nur Betreiber (auth.is_admin)

Gespeichert werden nur Tageszaehler je Person (Tabelle usage_daily): wie oft
das Dashboard geoeffnet, welcher Bereich angetippt, wie oft Claude gefragt,
ob der Garmin-Abruf klappte. Keine Inhalte - keine Trainings, keine
Gesundheitswerte, keine Coach-Nachrichten. Trainingssummen (Anzahl, Stunden)
rechnet die Statistik beim Abruf aus der Tabelle workouts aus.
"""
from datetime import date, timedelta

from flask import request
from sqlalchemy import func

from . import get_current_athlete_id
from .auth import is_admin
from .models import AthleteLogin, AthleteStore, UsageDaily, Workout
from .routes import api_bp, get_session, response_error, response_success

# Was der Browser melden darf (alles andere wird still verworfen).
CLIENT_EVENTS = {
    "open": {"mobile", "desktop"},
    "page": {"heute", "kalender", "coach", "training", "mehr",
             "overview", "nutrition", "records", "analysis", "settings", "calendar", "mobility"},
    "feature": {"coach-note", "coach-undo", "outlook", "mob-start", "strength-start", "mob-claude",
                "plan-new", "plan-open", "workout-open", "garmin-send", "garmin-push-login", "classic-view"},
    "error": {"js"},
}
MAX_EVENTS_PER_REQUEST = 50
MAX_PER_DAY = 2000  # Deckel je Zaehler und Tag - schuetzt vor Endlosschleifen im Browser


def bump(session, athlete_id, kind, name, n=1, day=None):
    """Zaehler erhoehen (legt die Zeile bei Bedarf an). Commit macht der Aufrufer."""
    if not athlete_id or n <= 0:
        return
    day = day or date.today()
    row = session.query(UsageDaily).filter_by(athlete_id=athlete_id, day=day, kind=kind, name=name).first()
    if row is None:
        row = UsageDaily(athlete_id=athlete_id, day=day, kind=kind, name=name, count=0)
        session.add(row)
    row.count = min(MAX_PER_DAY if kind != "ai_tokens" else 10**9, (row.count or 0) + int(n))


def record(athlete_id, kind, name, n=1, session_factory=None):
    """Zaehlen mit eigener Sitzung - nie ein Fehler fuer den eigentlichen Ablauf."""
    if session_factory is None:
        from . import Session as session_factory  # noqa: N813
    session = session_factory()
    try:
        bump(session, athlete_id, kind, name, n)
        session.commit()
    except Exception:  # Statistik ist Nebensache
        session.rollback()
    finally:
        session.close()


@api_bp.route("/usage", methods=["POST"])
def post_usage():
    data = request.get_json(silent=True)
    events = data.get("events") if isinstance(data, dict) else None
    if not isinstance(events, list):
        return response_error("'events' fehlt", "VALIDATION_ERROR", 400)
    counts = {}
    for ev in events[:MAX_EVENTS_PER_REQUEST]:
        if not isinstance(ev, dict):
            continue
        kind, name = ev.get("kind"), ev.get("name")
        if kind in CLIENT_EVENTS and name in CLIENT_EVENTS[kind]:
            counts[(kind, name)] = counts.get((kind, name), 0) + 1
    athlete_id = get_current_athlete_id()
    session = get_session()
    try:
        for (kind, name), n in counts.items():
            bump(session, athlete_id, kind, name, n)
        session.commit()
    finally:
        session.close()
    return response_success({"saved": sum(counts.values())})


def _store_value(session, athlete_id, key):
    row = session.query(AthleteStore).filter_by(athlete_id=athlete_id, key=key).first()
    return row.value if row else None


def _week_start(d):
    return d - timedelta(days=d.weekday())


@api_bp.route("/admin/stats", methods=["GET"])
def admin_stats():
    athlete_id = get_current_athlete_id()
    try:
        days = max(7, min(365, int(request.args.get("days", 30))))
    except ValueError:
        days = 30
    today = date.today()
    since = today - timedelta(days=days - 1)
    session = get_session()
    try:
        if not is_admin(session, athlete_id):
            return response_error("Die Statistik sieht nur der Betreiber des Dashboards.", "forbidden", 403)
        try:
            from tools import garmin_personal_api
        except Exception:  # pragma: no cover - ohne tools/ einfach "unbekannt"
            garmin_personal_api = None

        logins = session.query(AthleteLogin).order_by(AthleteLogin.id).all()
        rows = session.query(UsageDaily).filter(UsageDaily.day >= since).all()
        last_seen = dict(session.query(UsageDaily.athlete_id, func.max(UsageDaily.day)).group_by(UsageDaily.athlete_id).all())

        users = []
        for login in logins:
            aid = login.athlete_id
            mine = [r for r in rows if r.athlete_id == aid]
            by = {}
            for r in mine:
                by.setdefault(r.kind, {})
                by[r.kind][r.name] = by[r.kind].get(r.name, 0) + r.count
            workouts = session.query(Workout).filter(Workout.athlete_id == aid, Workout.date >= since).all()
            total_workouts = session.query(func.count(Workout.id)).filter(Workout.athlete_id == aid).scalar() or 0
            goals = _store_value(session, aid, "triathlon_dashboard_goals_v1")
            profile = _store_value(session, aid, "triathlon_dashboard_athlete_profile_v1") or {}
            garmin = None
            if garmin_personal_api is not None:
                try:
                    garmin = bool(garmin_personal_api.has_key(aid))
                except Exception:
                    garmin = None
            seen = last_seen.get(aid)
            users.append({
                "username": login.username,
                "since": login.created_at.date().isoformat() if login.created_at else None,
                "last_seen": seen.isoformat() if seen else None,
                "active_days": len({r.day for r in mine if r.kind in ("open", "page", "login")}),
                "opens": by.get("open", {}),
                "logins": sum(by.get("login", {}).values()),
                "pages": by.get("page", {}),
                "features": by.get("feature", {}),
                "ai_requests": sum(by.get("ai", {}).values()),
                "ai_tasks": by.get("ai", {}),
                "ai_errors": sum(by.get("ai_error", {}).values()),
                "ai_tokens": by.get("ai_tokens", {}),
                "garmin": {"connected": garmin, "ok": by.get("garmin", {}).get("ok", 0), "fehler": by.get("garmin", {}).get("fehler", 0)},
                "js_errors": by.get("error", {}).get("js", 0),
                "workouts": len(workouts),
                "workouts_total": total_workouts,
                "hours": round(sum(w.duration_min or 0 for w in workouts) / 60, 1),
                "goal": bool(goals) if isinstance(goals, list) else False,
                "onboarding": bool(isinstance(profile, dict) and profile.get("onboardingDone")),
            })

        # Aktive Personen je Tag (Zeitraum) und je Woche (12 Wochen)
        daily = {}
        for r in rows:
            if r.kind in ("open", "page", "login"):
                daily.setdefault(r.day, set()).add(r.athlete_id)
        daily_active = [{"day": (since + timedelta(days=i)).isoformat(), "users": len(daily.get(since + timedelta(days=i), ()))}
                        for i in range(days)]
        first_week = _week_start(today) - timedelta(weeks=11)
        week_rows = session.query(UsageDaily.athlete_id, UsageDaily.day).filter(
            UsageDaily.day >= first_week, UsageDaily.kind.in_(["open", "page", "login"])).all()
        weeks = {}
        for aid, d in week_rows:
            weeks.setdefault(_week_start(d), set()).add(aid)
        weekly_active = [{"week": (first_week + timedelta(weeks=i)).isoformat(), "users": len(weeks.get(first_week + timedelta(weeks=i), ()))}
                         for i in range(12)]

        totals = {
            "accounts": len(logins),
            "active": sum(1 for u in users if u["active_days"] > 0),
            "active_7d": len({r.athlete_id for r in rows if r.day >= today - timedelta(days=6) and r.kind in ("open", "page", "login")}),
            "opens_mobile": sum(u["opens"].get("mobile", 0) for u in users),
            "opens_desktop": sum(u["opens"].get("desktop", 0) for u in users),
            "ai_requests": sum(u["ai_requests"] for u in users),
            "ai_errors": sum(u["ai_errors"] for u in users),
            "ai_tokens_in": sum(u["ai_tokens"].get("in", 0) for u in users),
            "ai_tokens_out": sum(u["ai_tokens"].get("out", 0) for u in users),
            "garmin_ok": sum(u["garmin"]["ok"] for u in users),
            "garmin_fehler": sum(u["garmin"]["fehler"] for u in users),
            "garmin_connected": sum(1 for u in users if u["garmin"]["connected"]),
            "js_errors": sum(u["js_errors"] for u in users),
            "workouts": sum(u["workouts"] for u in users),
            "hours": round(sum(u["hours"] for u in users), 1),
        }
        pages, features = {}, {}
        for u in users:
            for k, v in u["pages"].items():
                pages[k] = pages.get(k, 0) + v
            for k, v in u["features"].items():
                features[k] = features.get(k, 0) + v
        return response_success({"days": days, "since": since.isoformat(), "totals": totals, "pages": pages, "features": features,
                                 "daily_active": daily_active, "weekly_active": weekly_active, "users": users})
    finally:
        session.close()
