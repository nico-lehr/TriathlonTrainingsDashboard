"""Liefert das Dashboard selbst aus (gleiche Adresse wie die API, kein CORS).

Abrufbar ist NUR, was auf der Erlaubt-Liste steht. Alles andere im
Projektordner - backend/, data/, docs/, training.db, .env, backups/,
fit-files/ - ist von aussen nicht erreichbar (404), auch nicht ueber Tricks
wie "css/../.env".
"""
from flask import Blueprint, abort, send_from_directory

from .config import config

frontend_bp = Blueprint("frontend", __name__)

# Einzelne Dateien im Projektordner, die der Browser laden darf.
PUBLIC_FILES = {"index.html", "login.html", "manifest.json"}
# Ordner, deren Inhalt komplett oeffentlich ist (reiner Programmcode/Design).
PUBLIC_DIRS = {"css", "js", "icons"}


def is_public(path):
    parts = path.split("/")
    if any(p in ("", ".", "..") or p.startswith(".") for p in parts):
        return False
    if len(parts) == 1:
        return path in PUBLIC_FILES
    return parts[0] in PUBLIC_DIRS


@frontend_bp.route("/")
def index():
    return send_from_directory(config.BASE_DIR, "index.html")


@frontend_bp.route("/<path:path>")
def public_file(path):
    if not is_public(path):
        abort(404)
    return send_from_directory(config.BASE_DIR, path)
