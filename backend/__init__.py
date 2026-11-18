"""Triathlon Dashboard Backend - Phase 1 (Local)."""
from collections import defaultdict, deque

from flask import Flask, request
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from .config import config

db = None
Session = None

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; "
       "frame-ancestors 'none'; form-action 'self'; worker-src 'self'; manifest-src 'self'")


def create_app():
    """Create and configure Flask application."""
    # static_folder=None: Dateien liefert nur frontend.py aus (Erlaubt-Liste).
    app = Flask(__name__, static_folder=None)
    app.config.from_object(config)
    if not app.config.get("SECRET_KEY"):
        raise RuntimeError(
            "SECRET_KEY fehlt. Lege im Projektordner eine Datei .env an "
            "(Vorlage: .env.example) und trage dort einen langen Zufallswert ein."
        )

    # Initialize database
    global db, Session
    from .models import Base

    engine = create_engine(
        app.config["SQLALCHEMY_DATABASE_URI"],
        connect_args={"check_same_thread": False} if "sqlite" in app.config["SQLALCHEMY_DATABASE_URI"] else {},
    )
    Base.metadata.create_all(engine)
    Session = scoped_session(sessionmaker(bind=engine))
    # Anfragen je Person der letzten Minute (auth.api_rate_wait)
    app.extensions["api_hits"] = defaultdict(deque)

    # Register blueprints
    from .routes import api_bp
    from . import dashboard_routes, ai_routes, equipment_routes, garmin_workouts, weather_routes, garmin_api_routes, update_routes, invite_routes, usage, garmin_official, garmin_push, garmin_events, morning, group, access_guard  # noqa: F401 - haengen weitere Endpunkte an api_bp
    from .frontend import frontend_bp
    # "Nur ueber Tailscale" (Schalter des Betreibers): vor jeder Anfrage, auch vor der Webseite
    app.before_request(access_guard.guard)
    app.register_blueprint(api_bp, url_prefix="/api/v1")
    # Dashboard unter derselben Adresse wie die API - deshalb kein CORS noetig.
    app.register_blueprint(frontend_bp)

    @app.after_request
    def security_headers(response):
        """Schutz-Kopfzeilen fuer jede Antwort - wichtig, sobald das Dashboard
        ueber eine oeffentliche Adresse (Tailscale Funnel) erreichbar ist:
        nicht in fremde Seiten einbetten, Dateityp nicht raten, keine
        Adressen an fremde Seiten weitergeben, nur noch HTTPS nach dem
        ersten HTTPS-Besuch."""
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        # Nur Skripte, Daten und Verbindungen von dieser Adresse - sollte je
        # fremder Text als Code in eine Seite rutschen, fuehrt der Browser ihn
        # nicht aus und schickt nichts an fremde Server. Inline-Styles bleiben
        # erlaubt (die Oberflaeche setzt viele style="...").
        response.headers.setdefault("Content-Security-Policy", CSP)
        via_proxy_https = request.remote_addr in ("127.0.0.1", "::1") and request.headers.get("X-Forwarded-Proto") == "https"
        if request.scheme == "https" or via_proxy_https:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        return response

    return app, Session


def get_current_athlete_id():
    """athlete_id aus dem Bearer-Token der laufenden Anfrage, None ohne gueltigen Token.

    Ohne Token blockt routes.require_login() jede Anfrage ausser /health und
    /auth/login mit 401 - die Endpunkte bekommen hier also immer eine echte id.
    """
    from flask import g
    if "athlete_id" in g:  # schon von routes.require_login geprueft
        return g.athlete_id
    from .auth import login_version, token_info
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    info = token_info(header[len("Bearer "):].strip())
    if info is None:
        return None
    # Oeffentliche Endpunkte (z. B. Kalender-Feed): auch hier gilt
    # "Ueberall abmelden" - ein alter Token zaehlt nicht mehr.
    session = Session()
    try:
        return info[0] if info[3] == login_version(session, info[0]) else None
    finally:
        session.close()
