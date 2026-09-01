"""Triathlon Dashboard Backend - Phase 1 (Local)."""
from flask import Flask
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
    """Phase 1: Always return athlete_id=1 (single user)."""
    return config.CURRENT_ATHLETE_ID
