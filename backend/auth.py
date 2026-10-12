"""Login fuer eine Handvoll Freunde: Passwort-Hash, signierter Token, Bremse
gegen Passwort-Raten. Keine oeffentliche Registrierung - Benutzer legt nur
backend/create_user.py an.

Der Token ist kein Datenbank-Eintrag, sondern die mit SECRET_KEY signierte
athlete_id (itsdangerous). Wer SECRET_KEY nicht kennt, kann keinen gueltigen
Token bauen; nach TOKEN_MAX_AGE_S ist er abgelaufen und es braucht einen
neuen Login.
"""
import threading
import time
from collections import defaultdict, deque

from flask import current_app
from itsdangerous import BadSignature, URLSafeSerializer, URLSafeTimedSerializer
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash

from .models import Athlete, AthleteLogin, AthleteStore, Workout

TOKEN_MAX_AGE_S = 30 * 24 * 3600  # 30 Tage
MIN_PASSWORD_LENGTH = 10
LOGIN_MAX_FAILS = 5   # Fehlversuche ...
LOGIN_WINDOW_S = 60   # ... pro Minute und IP


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="login-token")


def make_token(athlete_id):
    return _serializer().dumps({"athlete_id": athlete_id})


def athlete_id_from_token(token):
    """athlete_id aus einem gueltigen, nicht abgelaufenen Token, sonst None."""
    try:
        return _serializer().loads(token, max_age=TOKEN_MAX_AGE_S)["athlete_id"]
    except (BadSignature, KeyError, TypeError):  # BadSignature deckt auch "abgelaufen" ab
        return None


def make_ical_key(athlete_id):
    """Geheimer Schluessel fuer das Kalender-Abo (Kalender-Apps koennen sich
    nicht anmelden). Bewusst OHNE Ablaufdatum, damit das Abo dauerhaft laeuft;
    ungueltig wird er nur, wenn SECRET_KEY geaendert wird."""
    return URLSafeSerializer(current_app.config["SECRET_KEY"], salt="ical-feed").dumps(athlete_id)


def athlete_id_from_ical_key(key):
    try:
        return URLSafeSerializer(current_app.config["SECRET_KEY"], salt="ical-feed").loads(key or "")
    except BadSignature:
        return None


def normalize_username(username):
    # Klein geschrieben, weil Handy-Tastaturen den ersten Buchstaben gern gross machen.
    return username.strip().lower() if isinstance(username, str) else ""


_dummy_hash = None


def check_login(session, username, password):
    """athlete_id bei richtigem Benutzernamen + Passwort, sonst None."""
    global _dummy_hash
    if not isinstance(password, str):
        return None
    login = session.query(AthleteLogin).filter_by(username=normalize_username(username)).first()
    if login is None:
        # Genauso lange rechnen wie bei einem echten Benutzer, sonst verraet die
        # Antwortzeit (ca. 115 ms gegen 2 ms), welche Benutzernamen es gibt.
        if _dummy_hash is None:
            _dummy_hash = generate_password_hash("kein-echtes-passwort")
        check_password_hash(_dummy_hash, password)
        return None
    if check_password_hash(login.password_hash, password):
        return login.athlete_id
    return None


def unclaimed_athlete(session):
    """Der Athlet ohne Login, den der naechste create_login() uebernimmt (oder None)."""
    taken = {row.athlete_id for row in session.query(AthleteLogin.athlete_id)}
    return next((a for a in session.query(Athlete).order_by(Athlete.athlete_id) if a.athlete_id not in taken), None)


def unclaimed_data_count(session):
    """Wie viele Trainings und Ablage-Eintraege schon am Athleten ohne Login haengen.
    Der naechste neue Benutzer sieht sie alle - create_user.py fragt deshalb vorher nach."""
    athlete = unclaimed_athlete(session)
    if athlete is None:
        return 0
    return (session.query(Workout).filter_by(athlete_id=athlete.athlete_id).count()
            + session.query(AthleteStore).filter_by(athlete_id=athlete.athlete_id).count())


def create_login(session, username, password):
    """Legt einen Benutzer an und gibt seine athlete_id zurueck.

    Gibt es noch einen Athleten ohne Login (den bisherigen Einzelplatz-Athleten
    aus backend/app.py: init_db), bekommt der erste Benutzer diesen - so bleiben
    dessen Daten erhalten. Wirft ValueError bei ungueltiger Eingabe.
    """
    username = normalize_username(username)
    if not username:
        raise ValueError("Der Benutzername darf nicht leer sein.")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Das Passwort muss mindestens {MIN_PASSWORD_LENGTH} Zeichen lang sein.")
    if session.query(AthleteLogin).filter_by(username=username).first():
        raise ValueError(f"Den Benutzernamen '{username}' gibt es schon.")

    athlete = unclaimed_athlete(session)
    if athlete is None:
        next_id = (session.query(func.max(Athlete.athlete_id)).scalar() or 0) + 1
        athlete = Athlete(athlete_id=next_id, name=username)
        session.add(athlete)

    session.add(AthleteLogin(
        athlete_id=athlete.athlete_id,
        username=username,
        password_hash=generate_password_hash(password),
    ))
    session.commit()
    return athlete.athlete_id


def reset_password(session, username, password):
    """Neues Passwort fuer einen vorhandenen Benutzer (backend/create_user.py --reset).
    Alte Token bleiben bis zu ihrem Ablauf gueltig. Wirft ValueError."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Das Passwort muss mindestens {MIN_PASSWORD_LENGTH} Zeichen lang sein.")
    login = session.query(AthleteLogin).filter_by(username=normalize_username(username)).first()
    if not login:
        raise ValueError(f"Den Benutzernamen '{normalize_username(username)}' gibt es nicht.")
    login.password_hash = generate_password_hash(password)
    session.commit()
    return login.athlete_id


# Fehlversuche je IP, nur im Arbeitsspeicher (nach einem Neustart wieder leer).
_failed_logins = defaultdict(deque)
_failed_logins_lock = threading.Lock()


def too_many_failed_logins(ip):
    now = time.monotonic()
    with _failed_logins_lock:
        attempts = _failed_logins[ip]
        while attempts and now - attempts[0] > LOGIN_WINDOW_S:
            attempts.popleft()
        return len(attempts) >= LOGIN_MAX_FAILS


def note_failed_login(ip):
    with _failed_logins_lock:
        _failed_logins[ip].append(time.monotonic())
