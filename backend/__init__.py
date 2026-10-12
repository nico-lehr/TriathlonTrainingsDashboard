"""Triathlon Dashboard Backend - Phase 1 (Local)."""
from flask import Flask, request
from flask_cors import CORS
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from .config import config

db = None
Session = None


def create_app():
    """Create and configure Flask application."""
    app = Flask(__name__)
    app.config.from_object(config)
    if not app.config.get("SECRET_KEY"):
        raise RuntimeError(
            "SECRET_KEY fehlt. Lege im Projektordner eine Datei .env an "
            "(Vorlage: .env.example) und trage dort einen langen Zufallswert ein."
        )

    # Enable CORS for localhost frontend
    CORS(app, origins=["http://localhost:3000", "http://localhost:8000", "file://"])

    # Initialize database
    global db, Session
    from .models import Base

    engine = create_engine(
        app.config["SQLALCHEMY_DATABASE_URI"],
        connect_args={"check_same_thread": False} if "sqlite" in app.config["SQLALCHEMY_DATABASE_URI"] else {},
    )
    Base.metadata.create_all(engine)
    Session = scoped_session(sessionmaker(bind=engine))

    # Register blueprints
    from .routes import api_bp
    app.register_blueprint(api_bp, url_prefix="/api/v1")

    return app, Session


def get_current_athlete_id():
    """athlete_id aus dem Bearer-Token der laufenden Anfrage, None ohne gueltigen Token.

    Ohne Token blockt routes.require_login() jede Anfrage ausser /health und
    /auth/login mit 401 - die Endpunkte bekommen hier also immer eine echte id.
    """
    from .auth import athlete_id_from_token
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    return athlete_id_from_token(header[len("Bearer "):].strip())
