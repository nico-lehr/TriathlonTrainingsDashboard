"""Einladungen verwalten (Einstellungen -> Freunde einladen, nur Betreiber).

    GET  /api/v1/invites        {enabled, code, accounts: [{username, created}]}
    PUT  /api/v1/invites        {enabled} - Registrierung mit Code an/aus
    POST /api/v1/invites/renew  neuer Code, der alte gilt nicht mehr
"""
from flask import request

from . import get_current_athlete_id, invites
from .auth import is_admin
from .models import AthleteLogin
from .routes import api_bp, get_session, response_error, response_success


def _admin_status():
    session = get_session()
    try:
        if not is_admin(session, get_current_athlete_id()):
            return None
        accounts = [{"username": l.username, "created": l.created_at.date().isoformat() if l.created_at else None}
                    for l in session.query(AthleteLogin).order_by(AthleteLogin.id)]
        return {**invites.status(), "accounts": accounts, "max_accounts": invites.MAX_ACCOUNTS, "admin": True}
    finally:
        session.close()


def _forbidden():
    return response_error("Einladungen verwaltet nur der Betreiber des Dashboards.", "forbidden", 403)


@api_bp.route("/invites", methods=["GET"])
def get_invites():
    st = _admin_status()
    return response_success(st) if st else response_success({"admin": False})


@api_bp.route("/invites", methods=["PUT"])
def put_invites():
    if not _admin_status():
        return _forbidden()
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("enabled"), bool):
        return response_error("'enabled' (true/false) fehlt", "VALIDATION_ERROR", 400)
    invites.set_enabled(data["enabled"])
    return response_success(_admin_status())


@api_bp.route("/invites/renew", methods=["POST"])
def renew_invite():
    if not _admin_status():
        return _forbidden()
    invites.renew_code()
    return response_success(_admin_status())
