"""Einmal-Import der bisherigen Daten in die Datenbank, fuer einen waehlbaren Benutzer.

1. workouts.json (von parse_fit.py) -> Tabelle workouts.
2. Optional die Export-Datei des alten Doppelklick-Dashboards
   (tools/export-browser-data.html -> dashboard-export.json): Profil, Ziele,
   Plan, Erholung, Gewicht, Material, Notizen, Erfolge -> Ablage pro Person,
   dazu die nur im Browser importierten Workouts.

Doppelte Workouts (gleicher Tag + Startzeit + Sportart) werden uebersprungen,
der Import kann also gefahrlos mehrfach laufen.

Aufruf im Projektordner:
    python backend/import_workouts_json.py --user nico
    python backend/import_workouts_json.py --user nico --browser-export dashboard-export.json
    python backend/import_workouts_json.py --user nico pfad/zu/workouts.json
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend import create_app
from backend.auth import normalize_username
from backend.models import AthleteLogin, AthleteStore
from backend.workout_store import find_same_workout, local_day, workout_from_parsed

BASE = Path(__file__).parent.parent

# Nur diese Schluessel liest das Dashboard aus der Ablage pro Person (js/data/*).
# Verbindungs-Einstellungen (Ollama, Claude-API-Key) bleiben bewusst draussen.
STORE_KEYS = {
    "triathlon_dashboard_athlete_profile_v1", "triathlon_dashboard_goals_v1",
    "triathlon_dashboard_planned_workouts_v1", "triathlon_dashboard_recovery_v1",
    "triathlon_dashboard_recovery_log_v1", "triathlon_dashboard_weight_log_v1",
    "triathlon_dashboard_equipment_items_v1", "triathlon_dashboard_workout_notes_v1",
    "triathlon_dashboard_achievements_v1", "triathlon_dashboard_workout_analysis_v1",
}


def import_workouts(session, athlete_id, workouts, source):
    added = skipped = 0
    for w in workouts:
        day = local_day(w) if isinstance(w, dict) else None
        if day is None or find_same_workout(session, athlete_id, day, w):
            skipped += 1
            continue
        session.add(workout_from_parsed(athlete_id, w, day, source))
        session.flush()  # damit Doppelte innerhalb derselben Datei auch erkannt werden
        added += 1
    session.commit()
    return added, skipped


def import_store(session, athlete_id, local_storage, overwrite):
    """Werte aus dem alten Browser-localStorage (Texte mit JSON) in die Ablage."""
    taken, kept = [], []
    for key, raw in local_storage.items():
        if key not in STORE_KEYS:
            continue
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            continue
        row = session.query(AthleteStore).filter_by(athlete_id=athlete_id, key=key).first()
        if row and not overwrite:
            kept.append(key)
            continue
        if row is None:
            row = AthleteStore(athlete_id=athlete_id, key=key)
            session.add(row)
        row.value = value
        taken.append(key)
    session.commit()
    return taken, kept


def main():
    ap = argparse.ArgumentParser(description="Bisherige Daten in die Datenbank laden")
    ap.add_argument("workouts_json", nargs="?", default=str(BASE / "workouts.json"),
                    help="workouts.json von parse_fit.py (Standard: im Projektordner)")
    ap.add_argument("--user", required=True, help="Benutzername (angelegt mit backend/create_user.py)")
    ap.add_argument("--browser-export", help="dashboard-export.json aus tools/export-browser-data.html")
    ap.add_argument("--overwrite", action="store_true",
                    help="vorhandene Profil-/Ziel-/Plan-Daten auf dem Server durch den Export ersetzen")
    args = ap.parse_args()

    _, session_factory = create_app()
    session = session_factory()
    try:
        login = session.query(AthleteLogin).filter_by(username=normalize_username(args.user)).first()
        if not login:
            sys.exit(f"Benutzer '{args.user}' gibt es nicht (anlegen mit: python backend/create_user.py).")
        athlete_id = login.athlete_id

        path = Path(args.workouts_json)
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            added, skipped = import_workouts(session, athlete_id, data.get("workouts", []), "import")
            print(f"{path.name}: {added} Workouts neu, {skipped} schon vorhanden/unlesbar.")
        elif not args.browser_export:
            sys.exit(f"{path} nicht gefunden.")

        if args.browser_export:
            export = json.loads(Path(args.browser_export).read_text(encoding="utf-8"))
            added, skipped = import_workouts(session, athlete_id, export.get("workouts", []), "browser-import")
            print(f"Browser-Export: {added} Workouts neu, {skipped} schon vorhanden/unlesbar.")
            taken, kept = import_store(session, athlete_id, export.get("localStorage", {}), args.overwrite)
            print(f"Browser-Export: {len(taken)} Bereiche uebernommen (Profil, Ziele, Plan ...).")
            if kept:
                print(f"  {len(kept)} Bereiche gab es auf dem Server schon - nicht ersetzt "
                      "(mit --overwrite ersetzen): " + ", ".join(k.replace("triathlon_dashboard_", "") for k in kept))
    finally:
        session.close()


if __name__ == "__main__":
    main()
