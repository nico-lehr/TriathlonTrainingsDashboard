"""Nur ueber Tailscale erreichbar (Schalter des Betreibers unter Einstellungen
-> Sicherheit).

Ohne den Schalter antwortet der Server jedem im Heimnetz unter
http://<rechner>:5000 - dort gehen Passwort und Anmeldung UNVERSCHLUESSELT
durchs WLAN. Mit dem Schalter beantwortet er nur noch:
- den Rechner selbst (localhost),
- Geraete im eigenen Tailscale-Netz (Adressen 100.64.0.0/10 bzw. fd7a:115c:a1e0::/48,
  von Tailscale verschluesselt),
- Anfragen ueber "tailscale serve"/"tailscale funnel" (https-Adresse ...ts.net).
  Die kommen ueber den Rechner selbst und tragen X-Forwarded-For. waitress
  (backend/app.py) entfernt diese Kopfzeile bei allen anderen Absendern - ein
  Geraet im WLAN kann sich also nicht als Tailscale ausgeben.
Alle anderen bekommen 403 mit einem Hinweis.

    GET /api/v1/admin/access  {tailscale_only, forced, this_device_ok} - nur Betreiber
    PUT /api/v1/admin/access  {tailscale_only} - nur Betreiber; Einschalten nur,
                              wenn das eigene Geraet danach noch hineinkommt

Notausgang: In .env NUR_TAILSCALE=0 (aus) oder =1 (an) setzen und neu
starten - das gilt dann statt des Schalters.
"""
import ipaddress
import json
import os
import threading

from flask import jsonify, request

from . import get_current_athlete_id
from .auth import is_admin
from .routes import api_bp, get_session, response_error, response_success

KEY_DIR = os.path.expanduser("~/.triathlon")
KEY_FILE = "zugriff.json"
TAILSCALE_NETS = (ipaddress.ip_network("100.64.0.0/10"), ipaddress.ip_network("fd7a:115c:a1e0::/48"))
BLOCKED_TEXT = ("Dieses Dashboard ist nur über Tailscale erreichbar. Bitte Tailscale einschalten "
                "und die Tailscale-Adresse benutzen (z. B. https://<name>.<netz>.ts.net oder http://<name>:5000).")

_lock = threading.Lock()
_cache = None  # zuletzt gelesene Einstellung


def _path():
    return os.path.join(KEY_DIR, KEY_FILE)


def _env_override():
    v = os.getenv("NUR_TAILSCALE", "").strip()
    return True if v == "1" else False if v == "0" else None


def _stored():
    global _cache
    if _cache is None:
        try:
            with open(_path(), encoding="utf-8") as f:
                data = json.load(f)
            _cache = data.get("tailscale_only") is True if isinstance(data, dict) else False
        except (OSError, ValueError):
            _cache = False
    return _cache


def tailscale_only():
    forced = _env_override()
    return forced if forced is not None else _stored()


def save(value):
    global _cache
    with _lock:
        os.makedirs(KEY_DIR, mode=0o700, exist_ok=True)
        tmp = _path() + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"tailscale_only": bool(value)}, f)
        os.replace(tmp, _path())
        _cache = bool(value)


def address_ok(remote_addr, via_local_proxy):
    """Darf diese Anfrage auch im Modus "nur Tailscale" durch?"""
    if via_local_proxy:
        return True
    try:
        ip = ipaddress.ip_address((remote_addr or "").split("%")[0])
    except ValueError:
        return False
    if getattr(ip, "ipv4_mapped", None):
        ip = ip.ipv4_mapped
    return ip.is_loopback or any(ip in net for net in TAILSCALE_NETS)


def _this_request_ok():
    proxied = bool(request.headers.get("X-Forwarded-For") or request.headers.get("X-Forwarded-Proto"))
    return address_ok(request.remote_addr, proxied)


def guard():
    """before_request fuer die ganze App (create_app)."""
    if not tailscale_only() or _this_request_ok():
        return None
    if request.path.startswith("/api/"):
        return jsonify({"error": BLOCKED_TEXT, "code": "tailscale_only", "status": 403}), 403
    return BLOCKED_TEXT, 403, {"Content-Type": "text/plain; charset=utf-8"}


def _admin():
    session = get_session()
    try:
        return is_admin(session, get_current_athlete_id())
    finally:
        session.close()


def _status():
    return {"tailscale_only": tailscale_only(), "forced": _env_override() is not None,
            "this_device_ok": _this_request_ok()}


@api_bp.route("/admin/access", methods=["GET"])
def get_access():
    if not _admin():
        return response_error("Nur für den Betreiber des Dashboards.", "forbidden", 403)
    return response_success(_status())


@api_bp.route("/admin/access", methods=["PUT"])
def put_access():
    if not _admin():
        return response_error("Nur für den Betreiber des Dashboards.", "forbidden", 403)
    data = request.get_json(silent=True)
    value = data.get("tailscale_only") if isinstance(data, dict) else None
    if not isinstance(value, bool):
        return response_error("'tailscale_only' (true/false) fehlt", "VALIDATION_ERROR", 400)
    if _env_override() is not None:
        return response_error("Das ist fest in der Datei .env eingestellt (NUR_TAILSCALE) und lässt sich hier nicht ändern.",
                              "forced_by_env", 409)
    if value and not _this_request_ok():
        return response_error("Du bist gerade selbst nicht über Tailscale verbunden – mit dem Schalter würdest du dich "
                              "aussperren. Bitte erst über die Tailscale-Adresse öffnen.", "would_lock_out", 409)
    save(value)
    return response_success(_status())
