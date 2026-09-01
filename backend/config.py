import os
from pathlib import Path

# Phase 1: Local development, SQLite
class Config:
    """Base configuration for Phase 1 (local development)."""

    # Database
    BASE_DIR = Path(__file__).parent.parent
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{BASE_DIR}/training.db"
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Flask
    DEBUG = True
    TESTING = False
    SECRET_KEY = os.getenv("SECRET_KEY", "phase-1-local-dev-key")

    # API
    API_VERSION = "v1"

    # Garmin
    GARMIN_TOKEN_PATH = Path.home() / ".triathlon" / "garmin.token"
    GARMIN_LOG_PATH = Path.home() / ".triathlon" / "garmin-sync.log"

    # Phase 1: single athlete (hardcoded)
    CURRENT_ATHLETE_ID = 1


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
