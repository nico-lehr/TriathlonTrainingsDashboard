#!/usr/bin/env python3
"""Garmin sync daemon for Phase 1 (local).

Usage:
    python garmin_sync.py --login           # One-time login, save token to ~/.triathlon/garmin.token
    python garmin_sync.py --days 7          # Sync last 7 days
    python garmin_sync.py --days 7 --dry-run   # Dry run (show what would be synced)

Phase 1: Single athlete (athlete_id=1), SQLite database.
Phase 2+: Will read athlete_id from JWT token.
"""
import os
import sys
import json
import logging
import argparse
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Dict, List

# Setup logging
log_dir = Path.home() / ".triathlon"
log_dir.mkdir(exist_ok=True)
log_file = log_dir / "garmin-sync.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler(),
    ]
)
logger = logging.getLogger(__name__)

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend import Session, get_current_athlete_id
from backend.models import Workout, Wellness
from backend.config import config


class GarminSyncError(Exception):
    """Garmin sync error."""
    pass


class GarminSyncer:
    """Sync workouts and wellness data from Garmin."""

    def __init__(self, dry_run=False):
        self.dry_run = dry_run
        self.token_path = config.GARMIN_TOKEN_PATH
        self.session = Session()
        self.athlete_id = get_current_athlete_id()

    def __del__(self):
        self.session.close()

    def login(self):
        """One-time login flow: save token to ~/.triathlon/garmin.token"""
        try:
            from garminconnect import Garmin
            import getpass
        except ImportError:
            logger.error("garminconnect not installed. Run: pip install garminconnect")
            raise

        logger.info("Starting Garmin login...")

        # Prompt for credentials
        email = input("Garmin email: ")
        password = getpass.getpass("Garmin password (not shown): ")

        try:
            # Authenticate
            client = Garmin(email, password)
            client.login()

            # Save token
            self.token_path.parent.mkdir(parents=True, exist_ok=True)
            token_data = {
                "email": email,
                "cookie": client.session.cookies.get_dict(),
                "saved_at": datetime.utcnow().isoformat(),
            }
            with open(self.token_path, "w") as f:
                json.dump(token_data, f, indent=2)
            self.token_path.chmod(0o600)  # Restrict permissions

            logger.info(f"✓ Login successful. Token saved to {self.token_path}")
            return True
        except Exception as e:
            logger.error(f"Login failed: {e}")
            raise GarminSyncError(f"Garmin login failed: {e}")

    def get_client(self) -> Optional["Garmin"]:
        """Load Garmin client from saved token."""
        try:
            from garminconnect import Garmin
        except ImportError:
            logger.error("garminconnect not installed")
            return None

        if not self.token_path.exists():
            logger.error(f"Token not found: {self.token_path}")
            logger.error("Run: python garmin_sync.py --login")
            return None

        try:
            with open(self.token_path, "r") as f:
                token_data = json.load(f)

            # Restore session from cookie
            client = Garmin(token_data["email"], "")
            for key, value in token_data.get("cookie", {}).items():
                client.session.cookies.set(key, value)

            # Test connection
            client.get_user_summary(client.session.cookies.get("SESSIONID") or "test")
            logger.info("✓ Garmin client restored from token")
            return client
        except Exception as e:
            logger.error(f"Failed to restore Garmin client: {e}")
            logger.error("Run: python garmin_sync.py --login")
            return None

    def sync_activities(self, days: int = 7) -> List[Dict]:
        """Fetch and sync activities from last N days."""
        client = self.get_client()
        if not client:
            return []

        activities = []
        try:
            logger.info(f"Fetching activities from last {days} days...")
            start_date = (datetime.utcnow() - timedelta(days=days)).date()

            # Garmin API returns activities
            garmin_activities = client.get_activities(0, 500)  # Fetch up to 500
            logger.info(f"Found {len(garmin_activities)} total activities")

            for activity in garmin_activities:
                activity_date = datetime.fromisoformat(
                    activity.get("startTimeInSeconds", 0) / 1000
                    if isinstance(activity.get("startTimeInSeconds"), (int, float))
                    else activity.get("startTimeLocal", "")[:10]
                ).date()

                if activity_date < start_date:
                    continue  # Skip old activities

                # Map Garmin activity to Workout
                sport = self._map_sport(activity.get("activityType", ""))
                garmin_activity_id = activity.get("activityId")

                if not garmin_activity_id:
                    continue

                # Check UNIQUE constraint
                existing = self.session.query(Workout).filter_by(
                    athlete_id=self.athlete_id,
                    garmin_activity_id=garmin_activity_id
                ).first()

                if existing:
                    logger.info(f"Activity {garmin_activity_id} already synced, skipping")
                    continue

                # Build workout
                workout_data = {
                    "athlete_id": self.athlete_id,
                    "garmin_activity_id": garmin_activity_id,
                    "date": activity_date,
                    "sport": sport,
                    "sub_sport": activity.get("activitySubType"),
                    "duration_min": activity.get("duration", 0) / 60,  # Garmin in seconds
                    "distance_km": (activity.get("distance", 0) or 0) / 1000,  # Garmin in meters
                    "elevation_m": activity.get("elevationGain"),
                    "calories": activity.get("calories"),
                    "avg_hr": activity.get("avgHeartRate"),
                    "max_hr": activity.get("maxHeartRate"),
                    "avg_power_watts": activity.get("avgPower"),
                    "training_load_score": activity.get("trainingStressScore"),
                    "source": "garmin",
                }

                activities.append(workout_data)
                logger.info(f"  ✓ {activity_date} {sport} - {workout_data['duration_min']:.1f} min")

            return activities
        except Exception as e:
            logger.error(f"Error fetching activities: {e}")
            return activities

    def sync_wellness(self, days: int = 7) -> List[Dict]:
        """Fetch and sync wellness data from last N days."""
        client = self.get_client()
        if not client:
            return []

        wellness_data = []
        try:
            logger.info(f"Fetching wellness data from last {days} days...")
            start_date = (datetime.utcnow() - timedelta(days=days)).date()

            # Get daily summaries
            for i in range(days):
                check_date = (datetime.utcnow() - timedelta(days=i)).date()

                if check_date < start_date:
                    continue

                try:
                    # Garmin API for daily summary
                    summary = client.get_body_composition(
                        start_date_ts=(check_date.strftime("%Y-%m-%d")),
                        period="today"
                    )

                    # Check UNIQUE constraint
                    existing = self.session.query(Wellness).filter_by(
                        athlete_id=self.athlete_id,
                        date=check_date
                    ).first()

                    if existing:
                        logger.info(f"Wellness {check_date} already synced, skipping")
                        continue

                    # Map Garmin wellness to Wellness model
                    wellness_entry = {
                        "athlete_id": self.athlete_id,
                        "date": check_date,
                        "sleep_min": summary.get("sleepData", {}).get("sleepDuration"),
                        "resting_hr": summary.get("restingHeartRate"),
                        "body_battery_start": summary.get("bodyBattery", {}).get("bodyBatteryStart"),
                        "body_battery_end": summary.get("bodyBattery", {}).get("bodyBatteryEnd"),
                        "stress_level": summary.get("stressLevel"),
                        "garmin_wellness_data": summary,
                    }
                    wellness_data.append(wellness_entry)
                    logger.info(f"  ✓ {check_date} wellness")

                except Exception as e:
                    logger.warning(f"Could not fetch wellness for {check_date}: {e}")
                    continue

            return wellness_data
        except Exception as e:
            logger.error(f"Error fetching wellness: {e}")
            return wellness_data

    def save_to_db(self, activities: List[Dict], wellness: List[Dict]):
        """Save activities and wellness to database."""
        if self.dry_run:
            logger.info("DRY RUN: Would save the following data:")
            logger.info(f"  Activities: {len(activities)}")
            logger.info(f"  Wellness: {len(wellness)}")
            return

        try:
            # Save activities
            for activity_data in activities:
                workout = Workout(**activity_data)
                self.session.add(workout)

            # Save wellness
            for wellness_entry in wellness:
                wellness_obj = Wellness(**wellness_entry)
                self.session.add(wellness_obj)

            self.session.commit()
            logger.info(f"✓ Saved {len(activities)} activities and {len(wellness)} wellness entries")

        except Exception as e:
            self.session.rollback()
            logger.error(f"Error saving to database: {e}")
            raise GarminSyncError(f"Database error: {e}")

    def _map_sport(self, garmin_sport: str) -> str:
        """Map Garmin sport type to our sport categories."""
        sport_map = {
            "running": "running",
            "cycling": "cycling",
            "swimming": "swimming",
            "triathlon": "triathlon",
            "strength_training": "strength",
            "pilates": "mobility",
            "yoga": "mobility",
        }
        return sport_map.get(garmin_sport.lower(), "other")

    def run(self, days: int = 7):
        """Run full sync cycle."""
        logger.info("="*60)
        logger.info("Starting Garmin Sync")
        logger.info("="*60)

        try:
            activities = self.sync_activities(days=days)
            wellness = self.sync_wellness(days=days)

            self.save_to_db(activities, wellness)

            logger.info("✓ Sync complete")
            logger.info("="*60 + "\n")

        except Exception as e:
            logger.error(f"Sync failed: {e}")
            sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Garmin sync daemon")
    parser.add_argument("--login", action="store_true", help="One-time login (save token)")
    parser.add_argument("--days", type=int, default=7, help="Sync last N days (default: 7)")
    parser.add_argument("--dry-run", action="store_true", help="Dry run (don't write to DB)")

    args = parser.parse_args()

    try:
        syncer = GarminSyncer(dry_run=args.dry_run)

        if args.login:
            syncer.login()
        else:
            syncer.run(days=args.days)

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
