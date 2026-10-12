import os
from pathlib import Path

from dotenv import load_dotenv

# Geheime Werte (SECRET_KEY, ...) stehen in .env im Projektordner, nie im Code.
load_dotenv(Path(__file__).parent.parent / ".env")

# Phase 1: Local development, SQLite
class Config:
    """Base configuration for Phase 1 (local development)."""

    # Database
    BASE_DIR = Path(__file__).parent.parent
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{BASE_DIR}/training.db"
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Flask - DEBUG aus: der Server ist ueber das Netz erreichbar (keine Fehlerdetails nach aussen)
    DEBUG = False
    TESTING = False
    # Signiert die Login-Token. Pflicht: create_app() verweigert ohne ihn den Start.
    SECRET_KEY = os.getenv("SECRET_KEY")

    # API
    API_VERSION = "v1"

    # KI: der Server leitet Anfragen an Ollama auf diesem PC weiter (ai_routes.py)
    OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")

    # Wetter im Kalender: der Server fragt Open-Meteo (kostenlos, kein API-Key),
    # siehe weather_routes.py. Nur fuer Tests oder einen eigenen Spiegel aendern.
    OPEN_METEO_URL = os.getenv("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast")
    OPEN_METEO_GEOCODING_URL = os.getenv("OPEN_METEO_GEOCODING_URL", "https://geocoding-api.open-meteo.com/v1/search")

    # Garmin
    GARMIN_TOKEN_PATH = Path.home() / ".triathlon" / "garmin.token"
    GARMIN_LOG_PATH = Path.home() / ".triathlon" / "garmin-sync.log"


class TestConfig(Config):
    """Configuration for testing."""
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"


# Load environment-specific config
env = os.getenv("FLASK_ENV", "development")
if env == "testing":
    config = TestConfig()
else:
    config = Config()
