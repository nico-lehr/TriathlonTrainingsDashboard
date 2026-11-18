"""Login fuer eine Handvoll Freunde: Passwort-Hash, signierter Token, Bremse
gegen Passwort-Raten. Neue Konten: backend/create_user.py oder - nur mit
Einladungscode des Betreibers - selbst auf der Login-Seite (invites.py).

Der Token ist kein Datenbank-Eintrag, sondern die mit SECRET_KEY signierte
athlete_id (itsdangerous). Wer SECRET_KEY nicht kennt, kann keinen gueltigen
Token bauen.

"Angemeldet bleiben": Ein solcher Token gilt REMEMBER_MAX_AGE_S (90 Tage)
und wird bei Benutzung taeglich durch einen frischen ersetzt (Kopfzeile
X-Renewed-Token, siehe routes.py) - wer mindestens alle 90 Tage einmal
vorbeischaut, bleibt also angemeldet. Ohne Haken gilt er hoechstens einen
Tag, und der Browser vergisst ihn beim Schliessen (sessionStorage).

Abmelden auf allen Geraeten: Jeder Token traegt den Stand der Anmeldungen
(Tabelle login_versions). "Ueberall abmelden" (POST /auth/logout-all) und ein
neues Passwort zaehlen ihn hoch - alle aelteren Token gelten dann nicht mehr.
"""
import math
import os
import re
import threading
import time
from collections import defaultdict, deque

from flask import current_app
from itsdangerous import BadSignature, URLSafeSerializer, URLSafeTimedSerializer
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash

from .models import Athlete, AthleteLogin, AthleteStore, LoginVersion, Workout

REMEMBER_MAX_AGE_S = 90 * 24 * 3600  # "Angemeldet bleiben": 90 Tage ohne Besuch
SESSION_MAX_AGE_S = 24 * 3600        # ohne Haken: hoechstens ein Tag
RENEW_AFTER_S = 24 * 3600            # aelter als ein Tag -> bei Benutzung erneuern
TOKEN_MAX_AGE_S = REMEMBER_MAX_AGE_S  # Obergrenze fuer jeden Token
MIN_PASSWORD_LENGTH = 10
LOGIN_MAX_FAILS = 5   # Fehlversuche ...
LOGIN_WINDOW_S = 60   # ... pro Minute und IP
# Zusaetzlich je Benutzername (gegen Raten von vielen Adressen aus, wichtig
# bei oeffentlicher Adresse): nach 10 Fehlversuchen 15 Minuten Pause fuer
# dieses Konto. Der richtige Besitzer wartet hoechstens 15 Minuten.
USER_MAX_FAILS = 10
USER_WINDOW_S = 15 * 60
# Nur diese Absender duerfen die echte Besucher-Adresse im Kopf
# X-Forwarded-For mitschicken: Tailscale serve/funnel laeuft auf dem
# Dashboard-Rechner selbst. Von allen anderen wird der Kopf ignoriert -
# sonst koennte jeder ihn faelschen und die Sperre umgehen.
TRUSTED_PROXIES = {"127.0.0.1", "::1"}


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="login-token")


def make_token(athlete_id, remember=True, version=0):
    """version: Stand der Anmeldungen (login_version) - steht im Token, damit
    "Ueberall abmelden" alle aelteren Token ungueltig machen kann."""
    return _serializer().dumps({"athlete_id": athlete_id, "remember": bool(remember), "v": int(version or 0)})


def token_info(token):
    """(athlete_id, remember, alter_in_sekunden, version) aus einem gueltigen Token, sonst None.
    Aeltere Token ohne "remember" gelten als "angemeldet bleiben", ohne "v" als Version 0.
    Ob die Version noch aktuell ist, prueft routes.require_login (Datenbank)."""
    try:
        payload, issued = _serializer().loads(token, max_age=TOKEN_MAX_AGE_S, return_timestamp=True)
        athlete_id = payload["athlete_id"]
        version = int(payload.get("v", 0))
    except (BadSignature, KeyError, TypeError, ValueError, AttributeError):  # BadSignature deckt auch "abgelaufen" ab
        return None
    remember = payload.get("remember", True) is not False
    age = max(0, time.time() - issued.timestamp())
    if not remember and age > SESSION_MAX_AGE_S:
        return None
    return athlete_id, remember, age, version


def login_version(session, athlete_id):
    row = session.get(LoginVersion, athlete_id)
    return row.version if row else 0


def end_all_logins(session, athlete_id):
    """Alle Anmeldungen dieser Person beenden (alle Geraete). Commit macht der Aufrufer."""
    row = session.get(LoginVersion, athlete_id)
    if row is None:
        row = LoginVersion(athlete_id=athlete_id, version=0)
        session.add(row)
    row.version = (row.version or 0) + 1
    return row.version


def athlete_id_from_token(token):
    """athlete_id aus einem gueltigen, nicht abgelaufenen Token, sonst None."""
    info = token_info(token)
    return info[0] if info else None


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


def is_admin(session, athlete_id):
    """Betreiber des Dashboards (darf Programm-Updates installieren): die
    Benutzernamen in ADMIN_USERS (.env, durch Komma getrennt) - ohne Eintrag
    der zuerst angelegte Benutzer."""
    login = session.query(AthleteLogin).filter_by(athlete_id=athlete_id).first()
    if login is None:
        return False
    configured = [normalize_username(u) for u in os.getenv("ADMIN_USERS", "").split(",") if u.strip()]
    if configured:
        return login.username in configured
    first = session.query(AthleteLogin).order_by(AthleteLogin.id).first()
    return first is not None and first.id == login.id


USERNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")


def check_new_username(username):
    """Regeln fuer selbst gewaehlte Benutzernamen (Registrierung)."""
    username = normalize_username(username)
    if not USERNAME_PATTERN.match(username):
        raise ValueError("Benutzername: 3–32 Zeichen, nur Buchstaben a–z, Ziffern, Punkt, Minus oder Unterstrich.")
    return username


def create_login(session, username, password, claim_unclaimed=True):
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

    # Selbst registrierte Konten bekommen NIE den alten Einzelplatz-Athleten
    # (claim_unclaimed=False) - sonst saehe ein Fremder dessen Daten.
    athlete = unclaimed_athlete(session) if claim_unclaimed else None
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
    Beendet alle bisherigen Anmeldungen dieser Person. Wirft ValueError."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Das Passwort muss mindestens {MIN_PASSWORD_LENGTH} Zeichen lang sein.")
    login = session.query(AthleteLogin).filter_by(username=normalize_username(username)).first()
    if not login:
        raise ValueError(f"Den Benutzernamen '{normalize_username(username)}' gibt es nicht.")
    login.password_hash = generate_password_hash(password)
    end_all_logins(session, login.athlete_id)  # wer das alte Passwort kannte, fliegt raus
    session.commit()
    return login.athlete_id


# Fehlversuche je IP und je Benutzername, nur im Arbeitsspeicher (nach
# einem Neustart wieder leer).
_failed_logins = defaultdict(deque)
_failed_users = defaultdict(deque)
_failed_logins_lock = threading.Lock()


def client_ip(remote_addr, forwarded_for):
    """Adresse des Besuchers. Kommt die Anfrage ueber Tailscale (lokaler
    Proxy), steht die echte Adresse im letzten X-Forwarded-For-Eintrag."""
    if remote_addr in TRUSTED_PROXIES and forwarded_for:
        last = forwarded_for.split(",")[-1].strip()
        if last:
            return last
    return remote_addr or "unknown"


def _count(store, key, window):
    now = time.monotonic()
    attempts = store[key]
    while attempts and now - attempts[0] > window:
        attempts.popleft()
    return len(attempts)


def too_many_failed_logins(ip, username=None):
    with _failed_logins_lock:
        if _count(_failed_logins, ip, LOGIN_WINDOW_S) >= LOGIN_MAX_FAILS:
            return True
        user = normalize_username(username) if isinstance(username, str) else ""
        return bool(user) and _count(_failed_users, user, USER_WINDOW_S) >= USER_MAX_FAILS


def note_failed_login(ip, username=None):
    with _failed_logins_lock:
        _failed_logins[ip].append(time.monotonic())
        user = normalize_username(username) if isinstance(username, str) else ""
        if user:
            _failed_users[user].append(time.monotonic())


# Neue Konten je Adresse begrenzen (Registrierung mit Einladungscode):
# hoechstens 5 pro Stunde - gegen Massen-Anlegen, falls ein Code durchsickert.
REGISTER_MAX_PER_IP = 5
REGISTER_WINDOW_S = 3600
_registrations = defaultdict(deque)


def too_many_registrations(ip):
    with _failed_logins_lock:
        return _count(_registrations, ip, REGISTER_WINDOW_S) >= REGISTER_MAX_PER_IP


def note_registration(ip):
    with _failed_logins_lock:
        _registrations[ip].append(time.monotonic())


# Bremse fuer die ganze API je angemeldeter Person (Fenster: eine Minute).
# Die Zaehler liegen am App-Objekt (create_app legt sie neu an) und nur im
# Arbeitsspeicher. Der Browser wartet bei 429 die Zeit aus Retry-After ab
# und versucht es dann noch einmal (js/data/api-client.js).
API_WINDOW_S = 60


def api_rate_wait(store, athlete_id, max_per_window):
    """0, wenn die Anfrage durchgeht (sie ist dann gezaehlt), sonst die
    Sekunden, bis wieder eine frei ist. max_per_window 0 = ohne Bremse."""
    if not max_per_window:
        return 0
    with _failed_logins_lock:
        now = time.monotonic()
        hits = store[athlete_id]
        while hits and now - hits[0] >= API_WINDOW_S:
            hits.popleft()
        if len(hits) >= max_per_window:
            return max(1, math.ceil(API_WINDOW_S - (now - hits[0])))
        hits.append(now)
        return 0
