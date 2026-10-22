"""Garmin-Verbindung je Person (Einstellungen -> Garmin): den eigenen
Personal-API-Schluessel hinterlegen und Garmin-Daten auf Knopfdruck holen.

    GET    /api/v1/garmin/personal-api   Stand: Schluessel da? gueltig bis? laeuft ein Abruf?
    PUT    /api/v1/garmin/personal-api   {key, expires?} - prueft den Schluessel bei Garmin, dann speichern
    DELETE /api/v1/garmin/personal-api   Schluessel entfernen
    POST   /api/v1/garmin/sync           Abruf fuer die angemeldete Person im Hintergrund starten

Der Schluessel liegt nur in ~/.triathlon/garmin_api_<id>.json
(tools/garmin_personal_api.py) und wird nie zurueckgegeben oder geloggt.
Haengt am Blueprint aus routes.py: require_login() schuetzt alles, jede
Person sieht und aendert nur ihren eigenen Schluessel.
"""
import argparse
import importlib.util
import os
import threading
from datetime import date, datetime, timedelta

from flask import request

from tools import garmin_personal_api as personal_api
from tools import garmin_sync

from . import get_current_athlete_id
from .routes import api_bp, response_error, response_success

_sync_lock = threading.Lock()
_sync_state = {}  # athlete_id -> {"running": bool, "at": iso, "ok": bool, "message": str}


def _status(athlete_id):
    state = _sync_state.get(athlete_id) or {}
    return {
        **personal_api.key_status(athlete_id),
        "old_login": os.path.isdir(garmin_sync.token_path(athlete_id)),
        "sync": {k: state.get(k) for k in ("running", "at", "ok", "message")},
    }


@api_bp.route("/garmin/personal-api", methods=["GET"])
def get_garmin_personal_api():
    return response_success(_status(get_current_athlete_id()))


@api_bp.route("/garmin/personal-api", methods=["PUT"])
def put_garmin_personal_api():
    athlete_id = get_current_athlete_id()
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}
    try:
        key = personal_api.clean_key(data.get("key"))
    except ValueError as e:
        return response_error(str(e), "VALIDATION_ERROR", 400)

    expires = data.get("expires") or None
    if expires is not None:
        try:
            if date.fromisoformat(str(expires)) < date.today():
                return response_error("Das Ablaufdatum liegt in der Vergangenheit.", "VALIDATION_ERROR", 400)
        except ValueError:
            return response_error("Ablaufdatum bitte als Datum angeben.", "VALIDATION_ERROR", 400)

    # Erst bei Garmin pruefen, dann speichern - ein Tippfehler faellt sofort auf.
    try:
        token, expires_at = personal_api.exchange_key(key)
    except personal_api.GarminApiAuthenticationError:
        return response_error("Garmin hat diesen Schlüssel abgelehnt. Bitte in Garmin Connect prüfen "
                              "(abgelaufen oder gelöscht?) und neu kopieren.", "garmin_key_rejected", 400)
    except personal_api.GarminApiError as e:
        return response_error(e.user_message, "garmin_unreachable", 502)
    personal_api.save_key(athlete_id, key, expires)
    personal_api.cache_token(athlete_id, key, token, expires_at)
    return response_success(_status(athlete_id))


@api_bp.route("/garmin/personal-api", methods=["DELETE"])
def delete_garmin_personal_api():
    athlete_id = get_current_athlete_id()
    personal_api.delete_key(athlete_id)
    return response_success(_status(athlete_id))


def _run_sync(athlete_id):
    """Laeuft in einem eigenen Thread: derselbe Sync wie tools/garmin_sync.py."""
    from . import Session
    args = argparse.Namespace(login=False, activities_only=False, wellness_only=False)
    end = date.today()
    try:
        summary = garmin_sync.sync_user(athlete_id, Session, end - timedelta(days=garmin_sync.DEFAULT_DAYS), end, args)
        result = {"ok": True, "message": summary or "Fertig."}
    except Exception as e:  # jede Panne als verstaendliche Zeile, nie ein Absturz des Servers
        message = garmin_sync.describe_error(e, athlete_id)
        garmin_sync.log_user(athlete_id, f"FEHLER - {message}")
        result = {"ok": False, "message": message}
    finally:
        Session.remove()
    with _sync_lock:
        _sync_state[athlete_id] = {"running": False, "at": datetime.now().isoformat(timespec="seconds"), **result}


@api_bp.route("/garmin/sync", methods=["POST"])
def start_garmin_sync():
    athlete_id = get_current_athlete_id()
    if not personal_api.has_key(athlete_id) and not os.path.isdir(garmin_sync.token_path(athlete_id)):
        return response_error("Garmin ist für dich noch nicht verbunden – zuerst den Schlüssel eintragen.",
                              "garmin_not_connected", 409)
    if importlib.util.find_spec("fitdecode") is None:  # liest die .fit-Dateien (parse_fit.py)
        return response_error("Auf dem Dashboard-PC fehlt noch eine Bibliothek. Einmalig dort ausführen: "
                              "python -m pip install -r requirements.txt", "library_missing", 503)
    with _sync_lock:
        if (_sync_state.get(athlete_id) or {}).get("running"):
            return response_error("Der Abruf läuft schon.", "sync_running", 409)
        _sync_state[athlete_id] = {**(_sync_state.get(athlete_id) or {}), "running": True}
    threading.Thread(target=_run_sync, args=(athlete_id,), daemon=True, name=f"garmin-sync-{athlete_id}").start()
    return response_success(_status(athlete_id), status=202)
