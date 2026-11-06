"""Einladungen: Mit einem Einladungscode des Betreibers koennen sich neue
Personen auf der Login-Seite selbst ein Konto anlegen. Ohne Code (Standard)
ist die Registrierung zu - Fremde aus dem Internet koennen nichts anlegen.

Ablage: ~/.triathlon/invite.json (nur fuer den eigenen Benutzer lesbar)
mit {code, enabled}. Ein neuer Code macht den alten sofort ungueltig.
"""
import hmac
import json
import os
import secrets
import threading

KEY_DIR = os.path.expanduser("~/.triathlon")  # wie Garmin- und Claude-Schluessel
FILE = "invite.json"
# Ohne leicht verwechselbare Zeichen (0/O, 1/I/L), damit man ihn abtippen kann.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
MAX_ACCOUNTS = int(os.getenv("MAX_ACCOUNTS", "30") or 30)

_lock = threading.Lock()


def _path():
    return os.path.join(KEY_DIR, FILE)


def _read():
    try:
        with open(_path(), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(data):
    os.makedirs(KEY_DIR, exist_ok=True)
    tmp = _path() + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, _path())


def _new_code():
    raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return raw[:4] + "-" + raw[4:]


def normalize_code(code):
    return "".join(c for c in str(code or "").upper() if c.isalnum())


def status():
    data = _read()
    enabled = bool(data.get("enabled")) and bool(data.get("code"))
    return {"enabled": enabled, "code": data.get("code") if enabled else None}


def is_open():
    return status()["enabled"]


def set_enabled(enabled):
    """Einladungen an/aus. Beim Einschalten ohne Code wird einer erzeugt."""
    with _lock:
        data = _read()
        data["enabled"] = bool(enabled)
        if enabled and not data.get("code"):
            data["code"] = _new_code()
        _write(data)
    return status()


def renew_code():
    """Neuer Code - der alte gilt ab sofort nicht mehr."""
    with _lock:
        data = _read()
        data["code"] = _new_code()
        data["enabled"] = True
        _write(data)
    return status()


def check_code(code):
    st = status()
    if not st["enabled"]:
        return False
    given = normalize_code(code)
    return bool(given) and hmac.compare_digest(given, normalize_code(st["code"]))
