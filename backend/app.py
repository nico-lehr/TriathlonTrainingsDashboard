"""Startet das Dashboard (Webseite + API) mit waitress - laeuft auf Windows und Mac.

Aufruf im Projektordner: python backend/app.py   (bequemer: start.bat / start.sh)
Erreichbar unter http://localhost:5000 und - fuer Freunde ueber Tailscale -
unter http://<PC-Name>:5000. Host/Port aenderbar in .env (DASHBOARD_HOST/_PORT).
"""
import os
import socket
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backup import backup_db
from backend import create_app, Session
from backend.models import Athlete, AthleteLogin
from backend.config import config

# Vor dem Start sichern: create_app() legt bei neuen Versionen evtl. neue Tabellen an.
# Klappt die Sicherung nicht, wird NICHT gestartet (kein Datenbank-Eingriff ohne Backup).
try:
    backup_db()
except Exception as e:
    sys.exit(f"Die Datensicherung hat nicht geklappt ({e}).\n"
             "Der Server startet deshalb nicht. Ist training.db oder der Ordner backups/ "
             "in einem anderen Programm geoeffnet? Danach erneut starten.")
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
    from waitress import serve

    init_db()
    host = os.getenv("DASHBOARD_HOST", "0.0.0.0")
    port = int(os.getenv("DASHBOARD_PORT", "5000"))

    from backend import updater
    if os.getenv("UPDATE_CHECK", "1") != "0":
        updater.start_background_check()  # einmal am Tag bei GitHub nach einer neuen Version fragen

    print("\n" + "=" * 60)
    print(f"Triathlon-Dashboard laeuft (Version {updater.current_version()})")
    print("=" * 60)
    print(f"Auf diesem PC:           http://localhost:{port}")
    print(f"Fuer Freunde (Tailscale): http://{socket.gethostname().lower()}:{port}")
    session = session_factory()
    if not session.query(AthleteLogin).count():
        print("\nNoch kein Benutzer angelegt. In einem zweiten Fenster:  python backend/create_user.py")
    session.close()
    print("\nBeenden: dieses Fenster schliessen oder Strg+C.")
    print("=" * 60 + "\n")

    # 16 Threads: eine KI-Anfrage blockiert bis zu 10 Minuten einen davon.
    # Anfragen ueber 64 MB lehnt der Server ab (auch ohne Login), sonst koennte
    # jemand im WLAN die Platte fuellen.
    serve(app, host=host, port=port, threads=16, max_request_body_size=config.MAX_CONTENT_LENGTH)
