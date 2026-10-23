"""Programm-Updates im Dashboard (Einstellungen -> Programm-Updates und der
Hinweis oben): Stand abfragen, neu pruefen, installieren. Logik in updater.py.

    GET  /api/v1/update          {current, admin, ...} - Details nur fuer den Betreiber
    POST /api/v1/update/check    sofort bei GitHub nachsehen (Betreiber)
    POST /api/v1/update/install  neueste Version installieren (Betreiber)

Haengt am Blueprint aus routes.py (Login-Pflicht). Installieren darf nur der
Betreiber (auth.is_admin) - Freunde sehen nur die Versionsnummer.
"""
from . import get_current_athlete_id, updater
from .auth import is_admin
from .routes import api_bp, get_session, response_error, response_success


def _admin():
    session = get_session()
    try:
        return is_admin(session, get_current_athlete_id())
    finally:
        session.close()


@api_bp.route("/update", methods=["GET"])
def get_update():
    if not _admin():
        return response_success({"current": updater.current_version(), "admin": False})
    return response_success({**updater.status(), "admin": True})


@api_bp.route("/update/check", methods=["POST"])
def check_update():
    if not _admin():
        return response_error("Updates kann nur der Betreiber des Dashboards prüfen.", "forbidden", 403)
    return response_success({**updater.check(force=True), "admin": True})


@api_bp.route("/update/install", methods=["POST"])
def install_update():
    if not _admin():
        return response_error("Updates kann nur der Betreiber des Dashboards installieren.", "forbidden", 403)
    st = updater.status()
    if st["install"]["running"]:
        return response_error("Das Update läuft bereits.", "update_running", 409)
    if not st["available"]:
        return response_error("Es ist keine neuere Version bekannt – bitte zuerst prüfen.", "no_update", 409)
    if not updater.start_install():
        return response_error("Das Update konnte nicht gestartet werden.", "update_error", 409)
    return response_success({**updater.status(), "admin": True}, status=202)
