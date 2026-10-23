"""Legt einen Benutzer fuer das Dashboard an (es gibt bewusst keine
Registrierungsseite - nur wer Zugriff auf diesen PC hat, kann Benutzer anlegen).

Aufruf im Projektordner:  python backend/create_user.py
Passwort vergessen:       python backend/create_user.py --reset
"""
import sys
from getpass import getpass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend import create_app
from backend.auth import MIN_PASSWORD_LENGTH, create_login, reset_password, unclaimed_data_count


def main():
    _, session_factory = create_app()
    reset = "--reset" in sys.argv[1:]

    if not reset:
        session = session_factory()
        try:
            existing = unclaimed_data_count(session)
        finally:
            session.close()
        if existing:
            print(f"Achtung: Es gibt schon {existing} Eintraege (Trainings, Plan, Ziele ...) ohne Benutzer,")
            print("z. B. aus der frueheren Einzelplatz-Version. Der Benutzer, den du jetzt anlegst,")
            print("bekommt SIE ALLE zu sehen. Lege zuerst dich selbst an, dann deine Freunde.")
            if input("Ist das dein eigenes Konto? (j/n): ").strip().lower() not in ("j", "ja"):
                sys.exit("Nichts angelegt.")
    username = input("Benutzername: ")
    password = getpass(f"Passwort (mind. {MIN_PASSWORD_LENGTH} Zeichen, wird beim Tippen nicht angezeigt): ")
    if password != getpass("Passwort wiederholen: "):
        sys.exit("Die beiden Passwoerter sind verschieden - nichts angelegt.")

    session = session_factory()
    try:
        athlete_id = (reset_password if reset else create_login)(session, username, password)
    except ValueError as e:
        sys.exit(f"Nichts geaendert: {e}")
    finally:
        session.close()
    done = "hat ein neues Passwort" if reset else "angelegt"
    print(f"Benutzer '{username.strip().lower()}' {done} (athlete_id={athlete_id}).")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        sys.exit("\nAbgebrochen - nichts angelegt oder geaendert.")
