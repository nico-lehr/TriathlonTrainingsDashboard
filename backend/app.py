"""Flask application entry point for Phase 1 backend.

Run with: python backend/app.py
Default: http://localhost:5000
"""
import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend import create_app, Session
from backend.models import Athlete, Base
from backend.config import config
from sqlalchemy import create_engine

# Initialize app
app, session_factory = create_app()


@app.shell_context_processor
def make_shell_context():
    """Make shell context for flask shell."""
    return {"db": Session(), "Athlete": Athlete}


def init_db():
    """Initialize database with default athlete."""
    from backend.models import Athlete

    session = session_factory()
    try:
        # Check if athlete already exists
        athlete = session.query(Athlete).filter_by(athlete_id=1).first()
        if not athlete:
            # Create default athlete
            athlete = Athlete(
                athlete_id=1,
                name="Local Athlete",
                email="local@triathlon.local",
                training_experience="intermediate",
                training_days="mo,tu,we,th,fr,sa",
            )
            session.add(athlete)
            session.commit()
            print("✓ Created default athlete (athlete_id=1)")
        else:
            print("✓ Athlete already exists")
    finally:
        session.close()


if __name__ == "__main__":
    # Initialize database
    print("Initializing database...")
    init_db()

    # Run Flask server
    print("\n" + "="*60)
    print("Triathlon Dashboard Backend - Phase 1")
    print("="*60)
    print(f"API running at: http://localhost:5000/api/v1")
    print(f"Database: {config.SQLALCHEMY_DATABASE_URI}")
    print("="*60 + "\n")

    app.run(
        host="localhost",
        port=5000,
        debug=True,
        use_reloader=True,
    )
