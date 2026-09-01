"""SQLAlchemy ORM models for triathlon dashboard.

Phase 1: SQLite backend. All tables include athlete_id for Phase 2 multi-user compatibility.
"""
from datetime import datetime, date
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Date, Text, Boolean, JSON,
    ForeignKey, UniqueConstraint, Index, create_engine
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class Athlete(Base):
    """Athlete profile and settings."""
    __tablename__ = "athletes"

    id = Column(Integer, primary_key=True)
    athlete_id = Column(Integer, nullable=False, unique=True)  # Phase 2: multiple athletes
    name = Column(String(255), nullable=False)
    email = Column(String(255))
    weight_kg = Column(Float)  # Current weight for macro calculation
    height_cm = Column(Float)
    ftp_watts = Column(Float)  # Functional threshold power (cycling)
    lthr_bpm = Column(Integer)  # Lactate threshold heart rate (running)

    # Training preferences (JSON: ["mo", "tu", "we", "th", "fr", "sa", "su"])
    training_days = Column(Text, default="mo,tu,we,th,fr,sa")

    # Training experience level: "beginner", "intermediate", "advanced"
    training_experience = Column(String(50), default="intermediate")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    workouts = relationship("Workout", back_populates="athlete", cascade="all, delete-orphan")
    wellness = relationship("Wellness", back_populates="athlete", cascade="all, delete-orphan")
    recovery_checks = relationship("RecoveryCheck", back_populates="athlete", cascade="all, delete-orphan")
    planned_workouts = relationship("PlannedWorkout", back_populates="athlete", cascade="all, delete-orphan")
    goals = relationship("Goal", back_populates="athlete", cascade="all, delete-orphan")


class Workout(Base):
    """Completed workout/activity."""
    __tablename__ = "workouts"
    __table_args__ = (
        UniqueConstraint("athlete_id", "garmin_activity_id", name="uq_athlete_garmin_activity"),
        Index("idx_workout_athlete_date", "athlete_id", "date"),
        Index("idx_workout_athlete_sport", "athlete_id", "sport"),
    )

    id = Column(Integer, primary_key=True)
    athlete_id = Column(Integer, ForeignKey("athletes.athlete_id"), nullable=False)

    # Activity metadata
    garmin_activity_id = Column(Integer, unique=False)  # Unique per athlete (see UniqueConstraint above)
    date = Column(Date, nullable=False)
    sport = Column(String(50), nullable=False)  # "running", "cycling", "swimming"
    sub_sport = Column(String(50))  # e.g., "generic running", "road cycling", "pool swimming"

    # Duration and distance
    duration_min = Column(Float, nullable=False)
    distance_km = Column(Float)
    elevation_m = Column(Float)
    calories = Column(Integer)

    # Heart rate metrics
    avg_hr = Column(Integer)
    max_hr = Column(Integer)

    # Sport-specific
    avg_pace_sec_per_km = Column(Float)  # Running
    avg_power_watts = Column(Float)  # Cycling
    avg_cadence = Column(Float)  # RPM for cycling, steps/min for running

    # Training load (TRIMP, TSS, etc.)
    training_load_score = Column(Float)  # Generic training stress

    # Data source
    source = Column(String(50), default="garmin")  # "garmin", "manual", "strava"

    # Raw FIT data (JSON)
    fit_data = Column(JSON)  # Stream data: hr, pace, power, elevation, etc.

    notes = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    athlete = relationship("Athlete", back_populates="workouts")


class Wellness(Base):
    """Daily wellness data (sleep, HRV, stress, etc.)."""
    __tablename__ = "wellness"
    __table_args__ = (
        UniqueConstraint("athlete_id", "date", name="uq_athlete_date_wellness"),
        Index("idx_athlete_date", "athlete_id", "date"),
    )

    id = Column(Integer, primary_key=True)
    athlete_id = Column(Integer, ForeignKey("athletes.athlete_id"), nullable=False)
    date = Column(Date, nullable=False)

    # Sleep
    sleep_min = Column(Integer)
    sleep_quality = Column(Integer)  # 1-5 rating

    # HRV (Heart Rate Variability)
    hrv_ms = Column(Float)  # Milliseconds

    # Resting heart rate
    resting_hr = Column(Integer)

    # Body battery (Garmin metric, 0-100)
    body_battery_start = Column(Integer)
    body_battery_end = Column(Integer)

    # Stress level
    stress_level = Column(Integer)  # 1-5 or 0-100

    # Training readiness (Garmin, 1-5)
    training_readiness = Column(Integer)

    # Steps
    steps = Column(Integer)

    # Garmin wellness summary fields
    garmin_wellness_data = Column(JSON)  # Raw Garmin API response

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    athlete = relationship("Athlete", back_populates="wellness")


class PlannedWorkout(Base):
    """AI-generated or manually created workout plan."""
    __tablename__ = "planned_workouts"
    __table_args__ = (
        Index("idx_planned_athlete_date", "athlete_id", "date"),
        Index("idx_planned_goal_id", "goal_id"),
    )

    id = Column(Integer, primary_key=True)
    athlete_id = Column(Integer, ForeignKey("athletes.athlete_id"), nullable=False)
    goal_id = Column(Integer, ForeignKey("goals.id"))  # Associated goal

    date = Column(Date, nullable=False)
    sport = Column(String(50), nullable=False)  # "running", "cycling", "swimming"

    # Plan details
    name = Column(String(255))
    description = Column(Text)
    duration_min = Column(Float)
    distance_km = Column(Float)
    intensity = Column(String(50))  # "easy", "moderate", "hard", "vo2max", "threshold"
    training_phase = Column(String(50))  # "base", "build", "peak", "recovery"

    # Status
    status = Column(String(50), default="geplant")  # "geplant", "erledigt", "übersprungen"
    actual_workout_id = Column(Integer, ForeignKey("workouts.id"))  # Links to completed workout

    # Source
    source = Column(String(50), default="manual")  # "ai", "manual", "template"

    # Workout file for Garmin export
    fit_file_content = Column(Text)  # Binary FIT as base64

    notes = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    athlete = relationship("Athlete", back_populates="planned_workouts")
    goal = relationship("Goal", back_populates="planned_workouts")


class RecoveryCheck(Base):
    """Daily recovery check-in."""
    __tablename__ = "recovery_checks"
    __table_args__ = (
        Index("idx_recovery_athlete_date", "athlete_id", "date"),
    )

    id = Column(Integer, primary_key=True)
    athlete_id = Column(Integer, ForeignKey("athletes.athlete_id"), nullable=False)
    date = Column(Date, nullable=False)

    # Subjective ratings (1-5)
    energy_level = Column(Integer)  # 1 = exhausted, 5 = full energy
    muscle_soreness = Column(Integer)  # 1 = severe, 5 = none
    motivation = Column(Integer)  # 1 = unmotivated, 5 = highly motivated

    # Reason flags (if athlete marks "skip training today")
    skip_reasons = Column(JSON)  # ["injury", "fatigue", "illness", "life_stress", "other"]

    notes = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    athlete = relationship("Athlete", back_populates="recovery_checks")


class Goal(Base):
    """Training goal (event, milestone)."""
    __tablename__ = "goals"
    __table_args__ = (
        Index("idx_goal_athlete_id", "athlete_id"),
    )

    id = Column(Integer, primary_key=True)
    athlete_id = Column(Integer, ForeignKey("athletes.athlete_id"), nullable=False)

    name = Column(String(255), nullable=False)
    description = Column(Text)

    # Goal type
    goal_type = Column(String(50))  # "race", "fitness", "milestone", "other"

    # Disciplines (JSON: ["running", "cycling", "swimming"])
    disciplines = Column(Text, default="running,cycling,swimming")

    # Event date (if applicable)
    event_date = Column(Date)

    # Training plan
    start_date = Column(Date, nullable=False)
    end_date = Column(Date)

    # Primary goal flag (for AI planning)
    is_primary = Column(Boolean, default=False)

    # Goal-specific settings (JSON)
    goal_config = Column(JSON)  # e.g., target_distance, target_time, etc.

    status = Column(String(50), default="active")  # "active", "completed", "archived"

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    athlete = relationship("Athlete", back_populates="goals")
    planned_workouts = relationship("PlannedWorkout", back_populates="goal")


class IcalPlannedWorkout(Base):
    """Spiegel-Tabelle NUR für den iCal-Kalender-Export/Abo (CHANGE_REQUESTS.md).

    Bewusst eine EIGENE, kleine Tabelle statt PlannedWorkout wiederzuverwenden
    oder dessen Schema zu ändern: der Frontend-Trainingsplan lebt aktuell
    komplett im Browser-localStorage (js/data/planned-workouts.js), nicht in
    dieser Datenbank - PlannedWorkout hier ist bisher unbenutzt/leer. Statt
    also nachträglich eine bestehende Tabelle zu migrieren (riskant ohne
    Migrations-Framework, siehe BACKEND_RULES.md Punkt 3 "Migrations
    (Phase 2)"), bekommt der iCal-Export eine neue, unabhängige Tabelle, die
    bei jeder Änderung im Frontend komplett neu befüllt wird (siehe
    POST /api/v1/ical-sync in routes.py) - id ist bewusst die
    Frontend-UUID (String), kein eigener Auto-Increment-Key, damit ein Sync
    einfach "alles für athlete_id löschen, neu einfügen" machen kann, ohne
    IDs abgleichen zu müssen.
    """
    __tablename__ = "ical_planned_workouts"
    __table_args__ = (
        Index("idx_ical_athlete_date", "athlete_id", "date"),
    )

    id = Column(String(64), primary_key=True)  # Frontend-UUID (plannedWorkouts[].id)
    athlete_id = Column(Integer, ForeignKey("athletes.athlete_id"), nullable=False)

    date = Column(String(10), nullable=False)  # "YYYY-MM-DD", wie im Frontend
    sport = Column(String(50))
    title = Column(String(255))
    duration_min = Column(Float)
    intensity = Column(String(50))
    description = Column(Text)
    status = Column(String(50), default="geplant")

    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
