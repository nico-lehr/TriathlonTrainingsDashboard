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
from backend.auth import MIN_PASSWORD_LENGTH, create_login, reset_password


def main():
    _, session_factory = create_app()
    reset = "--reset" in sys.argv[1:]

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
    main()
