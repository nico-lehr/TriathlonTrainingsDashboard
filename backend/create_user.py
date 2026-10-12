"""Legt einen Benutzer fuer das Dashboard an (es gibt bewusst keine
Registrierungsseite - nur wer Zugriff auf diesen PC hat, kann Benutzer anlegen).

Aufruf im Projektordner:  python backend/create_user.py
"""
import sys
from getpass import getpass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend import create_app
from backend.auth import MIN_PASSWORD_LENGTH, create_login


def main():
    _, session_factory = create_app()

    username = input("Benutzername: ")
    password = getpass(f"Passwort (mind. {MIN_PASSWORD_LENGTH} Zeichen, wird beim Tippen nicht angezeigt): ")
    if password != getpass("Passwort wiederholen: "):
        sys.exit("Die beiden Passwoerter sind verschieden - nichts angelegt.")

    session = session_factory()
    try:
        athlete_id = create_login(session, username, password)
    except ValueError as e:
        sys.exit(f"Nicht angelegt: {e}")
    finally:
        session.close()
    print(f"Benutzer '{username.strip().lower()}' angelegt (athlete_id={athlete_id}).")


if __name__ == "__main__":
    main()
