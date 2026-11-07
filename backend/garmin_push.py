"""Trainings auf die Uhr: geplante Einheiten automatisch in Garmin Connect.

Die naechsten 7 Tage des Plans werden mit Garmin abgeglichen:
  - neue Einheit        -> Workout hochladen und in den Garmin-Kalender legen
  - geaenderte Einheit  -> dasselbe Garmin-Workout aktualisieren (keine Doppelten)
  - verschobene Einheit -> altes Workout weg, am neuen Tag neu
  - geloeschte/uebersprungene Einheit -> Workout in Garmin loeschen
Erledigte und vergangene Einheiten bleiben in Garmin unangetastet.
Von Hand gesendete Einheiten ("pinned") bleiben auch ausserhalb der 7 Tage.

Welche Einheit welches Garmin-Workout ist, steht in garmin_workout_links
(backend/models.py). Ohne Aenderung wird Garmin gar nicht erst gefragt.

Ausgeloest wird der Abgleich vom Browser (nach jeder Plan-Aenderung und beim
Oeffnen, POST /garmin/workouts/sync) und morgens vom Garmin-Timer
(tools/garmin_sync.py -> run_scheduled_pushes).

Anmeldung: E-Mail + Passwort einmal im Dashboard (POST /garmin/workouts/login,
ggf. mit Zwei-Faktor-Code). Das Passwort wird NIE gespeichert oder geloggt -
es wird gegen ein Token getauscht (~/.triathlon/garmin_<id>.token, nur fuer
den eigenen Betriebssystem-Benutzer lesbar) und sofort verworfen.

Sobald Garmin die offizielle Training API freischaltet, laeuft derselbe
Abgleich ueber backend/garmin_official.py (open_client waehlt den Weg).
"""
import hashlib
import importlib.util
import json
import os
import re
import shutil
import threading
import time
from datetime import date, datetime, timedelta

from flask import request

from tools import garmin_sync

from . import garmin_official, get_current_athlete_id
from .garmin_workouts import EXERCISE_SPORTS, PLANNED_WORKOUTS_KEY, SPORTS, workout_variants
from .models import AthleteStore, GarminPushState, GarminWorkoutLink
from .routes import api_bp, get_session, response_error, response_success

WINDOW_DAYS = 7
MAX_OPS = 30          # hoechstens so viele Garmin-Aenderungen je Lauf (Garmin drosselt)
MAX_DETAILS = 120     # so viele Einheiten merkt sich der Server mit Schritten
MFA_TTL_S = 300
PUSH_SPORTS = set(SPORTS) | set(EXERCISE_SPORTS)

_locks = {}
_locks_guard = threading.Lock()
_pending_mfa = {}     # athlete_id -> (Garmin-Client mitten in der Anmeldung, Ablaufzeit) - nur im Speicher


class PushStopped(Exception):
    """Weitere Anfragen an Garmin wuerden genauso scheitern (Anmeldung, Drosselung)."""

    def __init__(self, code, message, status):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


# ------------------------------------------------------------ Hilfsfunktionen

def http_status(e):
    m = re.search(r"API Error (\d{3})", str(e))
    if m:
        return int(m.group(1))
    resp = getattr(e, "response", None)
    return getattr(resp, "status_code", None)


def stop_for(e, athlete_id):
    """Fehler, der den ganzen Lauf beendet -> PushStopped, sonst None."""
    status = http_status(e)
    name = type(e).__name__
    if "TooManyRequests" in name or status in (403, 429):
        return PushStopped("garmin_rate_limited", "Garmin blockt gerade (zu viele Anfragen). In ein paar Stunden "
                           "klappt es wieder - bis dahin bleibt alles, wie es ist.", 429)
    if "Authentication" in name or status == 401:
        return PushStopped("garmin_reconnect", "Die Garmin-Anmeldung ist abgelaufen. Bitte in den Einstellungen "
                           "unter Garmin → „Trainings auf die Uhr“ neu anmelden.", 409)
    if "Unreachable" in name or str(e).startswith("Connection error") or isinstance(e, OSError):
        return PushStopped("garmin_unreachable", "Garmin ist gerade nicht erreichbar. Später klappt es wieder.", 502)
    return None


def payload_hash(payload, date_str):
    raw = json.dumps({"p": payload, "d": date_str}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def valid_date(value):
    return isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is not None


def push_lock(athlete_id):
    with _locks_guard:
        return _locks.setdefault(athlete_id, threading.Lock())


class FileLock:
    """Sperre ueber Prozesse hinweg (Webserver + Garmin-Timer), wo es geht."""

    def __init__(self, athlete_id):
        self.path = os.path.join(garmin_sync.TOKEN_DIR, f"garmin_push_{athlete_id}.lock")
        self.fh = None

    def __enter__(self):
        try:
            import fcntl
            os.makedirs(garmin_sync.TOKEN_DIR, mode=0o700, exist_ok=True)
            self.fh = open(self.path, "a")
            fcntl.flock(self.fh, fcntl.LOCK_EX)
        except (ImportError, OSError):
            self.fh = None  # Windows / nicht beschreibbar: nur die Sperre im Prozess
        return self

    def __exit__(self, *exc):
        if self.fh:
            self.fh.close()


def library_available():
    return importlib.util.find_spec("garminconnect") is not None


def connected(athlete_id):
    return os.path.isdir(garmin_sync.token_path(athlete_id)) or garmin_official.connected(athlete_id)


def open_client(athlete_id):
    """Der Weg zu Garmin: offizielle Training API, sobald freigeschaltet und
    verbunden, sonst die bisherige Anmeldung (garminconnect-Token)."""
    if garmin_official.connected(athlete_id):
        return garmin_official.TrainingApiClient(athlete_id), "official"
    if not library_available():
        raise PushStopped("garmin_library_missing", "Auf dem Dashboard-PC fehlt die Garmin-Bibliothek: "
                          "python -m pip install -r requirements.txt", 503)
    if not os.path.isdir(garmin_sync.token_path(athlete_id)):
        raise PushStopped("garmin_not_connected", "Garmin ist für Trainings noch nicht verbunden. In den "
                          "Einstellungen unter Garmin → „Trainings auf die Uhr“ einmal anmelden.", 409)
    try:
        return garmin_sync.connect(athlete_id), "connect"
    except Exception as e:
        stop = stop_for(e, athlete_id) or PushStopped("garmin_error", "Anmeldung bei Garmin hat nicht geklappt. "
                                                      "Später erneut versuchen.", 502)
        print(f"Garmin-Workouts Nutzer {athlete_id}: {garmin_sync.describe_error(e, athlete_id)}", flush=True)
        raise stop


def load_entries(session, athlete_id):
    row = session.query(AthleteStore).filter_by(athlete_id=athlete_id, key=PLANNED_WORKOUTS_KEY).first()
    value = row.value if row is not None and isinstance(row.value, list) else []
    return [p for p in value if isinstance(p, dict) and isinstance(p.get("id"), str)]


def get_state(session, athlete_id):
    state = session.get(GarminPushState, athlete_id)
    if state is None:
        state = GarminPushState(athlete_id=athlete_id, auto=True, details={})
        session.add(state)
        session.flush()
    return state


def clean_details(items):
    """Vom Browser: [{id, steps, exercises}] -> {id: {steps, exercises}} (nur Listen, gekappt)."""
    out = {}
    if not isinstance(items, list):
        return out
    for item in items[:MAX_DETAILS]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or len(item["id"]) > 64:
            continue
        d = {}
        if isinstance(item.get("steps"), list):
            d["steps"] = item["steps"][:60]
        if isinstance(item.get("exercises"), list):
            d["exercises"] = item["exercises"][:30]
        out[item["id"]] = d
    return out


def merge_details(state, items, entries):
    """Neue Schritte uebernehmen; Eintraege, die es nicht mehr gibt, vergessen."""
    details = dict(state.details or {})
    details.update(clean_details(items))
    alive = {p["id"] for p in entries}
    state.details = {k: v for k, v in details.items() if k in alive}


def link_info(link):
    gid = link.garmin_workout_id
    return {"garmin_workout_id": int(gid) if gid and gid.isdigit() else gid, "date": link.date, "pinned": bool(link.pinned),
            "sent_at": link.sent_at.isoformat() + "Z" if link.sent_at else None}


# ------------------------------------------------------------------ Abgleich

def plan_operations(entries, links, details, today, only=None):
    """Was in Garmin passieren muss - ohne Garmin zu fragen.
    Ergebnis: (ops, failed, unchanged). op = dict(kind, entry, link, variants, hash)."""
    by_id = {p["id"]: p for p in entries}
    end = (today + timedelta(days=WINDOW_DAYS - 1)).isoformat()
    today_s = today.isoformat()
    active = {l.planned_id: l for l in links if l.state == "active"}
    ops, failed, unchanged = [], [], 0

    if only is not None:
        wanted = [by_id[i] for i in only if i in by_id]
    else:
        wanted = []
        for p in entries:
            if p.get("sport") not in PUSH_SPORTS or not valid_date(p.get("date")) or p.get("garminOff"):
                continue
            if (p.get("status") or "geplant") != "geplant" or p["date"] < today_s:
                continue
            link = active.get(p["id"])
            if p["date"] <= end or (link is not None and link.pinned):
                wanted.append(p)

    wanted_ids = set()
    for p in wanted:
        wanted_ids.add(p["id"])
        d = details.get(p["id"]) or {}
        try:
            variants = workout_variants(p, d.get("steps"), d.get("exercises"))
        except (ValueError, KeyError, TypeError) as e:
            failed.append({"id": p["id"], "title": p.get("title"), "code": "invalid",
                           "message": f"Einheit unvollständig ({e}) – bitte im Plan prüfen."})
            continue
        when = p["date"] if valid_date(p.get("date")) else None
        h = payload_hash(variants[0], when)
        link = active.get(p["id"])
        legacy = p.get("garminWorkoutId") if link is None else None
        if link is None:
            ops.append({"kind": "recreate" if legacy else "create", "entry": p, "link": None, "variants": variants,
                        "hash": h, "old_id": str(legacy) if legacy else None})
        elif link.date != when:
            ops.append({"kind": "move", "entry": p, "link": link, "variants": variants, "hash": h,
                        "old_id": link.garmin_workout_id})
        elif link.payload_hash != h:
            ops.append({"kind": "update", "entry": p, "link": link, "variants": variants, "hash": h})
        else:
            unchanged += 1

    if only is None:
        for planned_id, link in active.items():
            if planned_id in wanted_ids:
                continue
            p = by_id.get(planned_id)
            if p is not None:
                status = p.get("status") or "geplant"
                if status == "erledigt":
                    continue  # gemacht - bleibt in Garmin
                if (link.date or "") < today_s and (p.get("date") or "") < today_s:
                    continue  # Vergangenheit nicht anfassen
            ops.append({"kind": "remove", "entry": p, "link": link})
    return ops, failed, unchanged


def upload_with_fallback(client, variants, start=0):
    """Hochladen; lehnt Garmin eine Variante ab (400/422), die naechste. -> (id, Variante)."""
    last = None
    for i in range(start, len(variants)):
        try:
            result = client.upload_workout(variants[i])
        except Exception as e:
            if http_status(e) in (400, 422) and i < len(variants) - 1:
                last = e
                continue
            raise
        garmin_id = result.get("workoutId") if isinstance(result, dict) else None
        if not garmin_id:
            raise RuntimeError("Garmin hat das Workout ohne Nummer bestätigt")
        return str(garmin_id), i
    raise last or RuntimeError("keine Variante")


def delete_quietly(client, garmin_id, athlete_id):
    """Loeschen; "gibt es schon nicht mehr" ist kein Fehler. Abbruch-Fehler gehen durch."""
    if not garmin_id:
        return
    try:
        client.delete_workout(garmin_id)
    except Exception as e:
        stop = stop_for(e, athlete_id)
        if stop:
            raise stop
        if http_status(e) not in (404, 410):
            print(f"Garmin-Workouts Nutzer {athlete_id}: Löschen {garmin_id}: "
                  f"{garmin_sync.describe_error(e, athlete_id)}", flush=True)


def create_on_garmin(client, session, athlete_id, op, via, pin):
    p = op["entry"]
    garmin_id, variant = upload_with_fallback(client, op["variants"])
    when = p["date"] if valid_date(p.get("date")) else None
    scheduled = None
    if when:
        try:
            client.schedule_workout(garmin_id, when)
            scheduled = when
        except Exception as e:
            stop = stop_for(e, athlete_id)
            if stop:
                raise stop
            print(f"Garmin-Kalender Nutzer {athlete_id}: {garmin_sync.describe_error(e, athlete_id)}", flush=True)
    link = op["link"] or session.query(GarminWorkoutLink).filter_by(athlete_id=athlete_id, planned_id=p["id"]).first()
    if link is None:
        link = GarminWorkoutLink(athlete_id=athlete_id, planned_id=p["id"])
        session.add(link)
    link.garmin_workout_id = garmin_id
    link.date = scheduled  # None = Kalender hat nicht geklappt -> naechster Lauf versucht es erneut
    link.payload_hash = op["hash"] if scheduled == when else None
    link.variant = variant
    link.title = str(p.get("title") or p.get("sport"))[:120]
    link.sport = p.get("sport")
    link.state = "active"
    link.pinned = bool(pin or link.pinned)
    link.via = via
    link.sent_at = datetime.utcnow()
    return link


def apply_operation(client, session, athlete_id, op, via, pin):
    kind, link = op["kind"], op["link"]
    if kind == "remove":
        delete_quietly(client, link.garmin_workout_id, athlete_id)
        link.state = "removed"
        link.pinned = False
        return link
    if kind == "update":
        variant = link.variant if link.variant is not None and link.variant < len(op["variants"]) else 0
        try:
            client.update_workout(link.garmin_workout_id, {**op["variants"][variant], "workoutId": int(link.garmin_workout_id)})
        except Exception as e:
            stop = stop_for(e, athlete_id)
            if stop:
                raise stop
            # Z. B. in Garmin von Hand geloescht oder alte Bibliothek ohne update_workout: neu anlegen.
            delete_quietly(client, link.garmin_workout_id, athlete_id)
            return create_on_garmin(client, session, athlete_id, op, via, pin)
        link.payload_hash = op["hash"]
        link.title = str(op["entry"].get("title") or op["entry"].get("sport"))[:120]
        link.pinned = bool(pin or link.pinned)
        link.sent_at = datetime.utcnow()
        return link
    if kind in ("move", "recreate"):
        delete_quietly(client, op.get("old_id"), athlete_id)
    return create_on_garmin(client, session, athlete_id, op, via, pin)


def run_push(athlete_id, session_factory, items=None, only=None, pin=False, today=None, client_factory=None):
    """Ein Abgleich fuer EINE Person. Ergebnis-dict (siehe unten); wirft nie
    wegen Garmin - Abbruchgruende stehen in result["stopped"]."""
    today = today or date.today()
    client_factory = client_factory or open_client
    with push_lock(athlete_id), FileLock(athlete_id):
        session = session_factory()
        try:
            entries = load_entries(session, athlete_id)
            state = get_state(session, athlete_id)
            if items is not None:
                merge_details(state, items, entries)
            links = session.query(GarminWorkoutLink).filter_by(athlete_id=athlete_id).all()
            ops, failed, unchanged = plan_operations(entries, links, state.details or {}, today, only)
            result = {"created": 0, "updated": 0, "moved": 0, "removed": 0, "unchanged": unchanged,
                      "failed": failed, "stopped": None, "pending": 0, "ran_at": datetime.utcnow().isoformat() + "Z"}
            if ops:
                try:
                    client, via = client_factory(athlete_id)
                except PushStopped as stop:
                    result["stopped"] = {"code": stop.code, "message": stop.message, "status": stop.status}
                    result["pending"] = len(ops)
                    ops = []
                for n, op in enumerate(ops):
                    if n >= MAX_OPS:
                        result["pending"] = len(ops) - n
                        break
                    try:
                        apply_operation(client, session, athlete_id, op, via, pin)
                        session.commit()
                        key = {"create": "created", "recreate": "created", "update": "updated",
                               "move": "moved", "remove": "removed"}[op["kind"]]
                        result[key] += 1
                    except PushStopped as stop:
                        session.rollback()
                        result["stopped"] = {"code": stop.code, "message": stop.message, "status": stop.status}
                        result["pending"] = len(ops) - n
                        break
                    except Exception as e:
                        session.rollback()
                        stop = stop_for(e, athlete_id)
                        if stop:
                            result["stopped"] = {"code": stop.code, "message": stop.message, "status": stop.status}
                            result["pending"] = len(ops) - n
                            break
                        entry = op.get("entry") or {}
                        print(f"Garmin-Workouts Nutzer {athlete_id}: {garmin_sync.describe_error(e, athlete_id)}", flush=True)
                        failed.append({"id": entry.get("id") or op["link"].planned_id,
                                       "title": entry.get("title") or (op["link"].title if op["link"] else None),
                                       "code": "garmin_error",
                                       "message": "Garmin hat das Workout nicht angenommen. Später erneut versuchen."})
            state = get_state(session, athlete_id)
            state.last_run_at = datetime.utcnow()
            state.last_result = {k: v for k, v in result.items()}
            session.commit()
            links = session.query(GarminWorkoutLink).filter_by(athlete_id=athlete_id, state="active").all()
            result["links"] = {l.planned_id: link_info(l) for l in links}
            return result
        finally:
            session.close()


def run_scheduled_pushes(session_factory, log=print):
    """Fuer den Garmin-Timer am Morgen: alle Personen mit Anmeldung und
    eingeschaltetem Automatik-Abgleich. Eine Person stoppt nie die anderen."""
    ids = set()
    if os.path.isdir(garmin_sync.TOKEN_DIR):
        for name in os.listdir(garmin_sync.TOKEN_DIR):
            m = re.fullmatch(r"garmin_(\d+)\.token", name)
            if m:
                ids.add(int(m.group(1)))
    ids |= set(garmin_official.connected_athletes())
    session = session_factory()
    try:
        off = {s.athlete_id for s in session.query(GarminPushState).filter_by(auto=False).all()}
    finally:
        session.close()
    for athlete_id in sorted(ids - off):
        try:
            r = run_push(athlete_id, session_factory)
            stop = r["stopped"]["message"] if r["stopped"] else ""
            log(f"Trainings auf die Uhr, Nutzer {athlete_id}: {r['created']} neu, {r['updated']} geändert, "
                f"{r['moved']} verschoben, {r['removed']} gelöscht, {len(r['failed'])} Fehler {stop}".rstrip())
        except Exception as e:  # nie den ganzen Timer stoppen
            log(f"Trainings auf die Uhr, Nutzer {athlete_id}: FEHLER {type(e).__name__}")


# ----------------------------------------------------------------- Endpunkte

def status_payload(athlete_id):
    session = get_session()
    try:
        state = session.get(GarminPushState, athlete_id)
        links = session.query(GarminWorkoutLink).filter_by(athlete_id=athlete_id, state="active").all()
        pending = _pending_mfa.get(athlete_id)
        return {
            "connected": connected(athlete_id),
            "via": "official" if garmin_official.connected(athlete_id) else "connect",
            "library": library_available(),
            "mfa_pending": bool(pending and pending[1] > time.time()),
            "auto": True if state is None else bool(state.auto),
            "last_run_at": state.last_run_at.isoformat() + "Z" if state and state.last_run_at else None,
            "last_result": state.last_result if state else None,
            "links": {l.planned_id: link_info(l) for l in links},
            "window_days": WINDOW_DAYS,
            "official": garmin_official.status(athlete_id),
        }
    finally:
        session.close()


@api_bp.route("/garmin/workouts/status", methods=["GET"])
def garmin_workouts_status():
    return response_success(status_payload(get_current_athlete_id()))


def finish_login(athlete_id, client):
    """Token ablegen - danach ist das Passwort ueberall vergessen."""
    client.username = client.password = None
    path = garmin_sync.token_path(athlete_id)
    shutil.rmtree(path, ignore_errors=True)
    os.makedirs(garmin_sync.TOKEN_DIR, mode=0o700, exist_ok=True)
    client.client.dump(path)


def login_error(e, athlete_id):
    print(f"Garmin-Anmeldung Nutzer {athlete_id}: {type(e).__name__}", flush=True)  # nie Text/Zugangsdaten
    name = type(e).__name__
    if "TooManyRequests" in name or http_status(e) == 429:
        return response_error("Garmin blockt gerade zu viele Anmeldeversuche. Bitte in ein paar Stunden erneut.",
                              "garmin_rate_limited", 429)
    if "Authentication" in name or http_status(e) == 401:
        return response_error("Garmin hat die Anmeldung abgelehnt. E-Mail, Passwort oder Code prüfen.",
                              "garmin_login_failed", 401)
    return response_error("Garmin ist gerade nicht erreichbar. Später erneut versuchen.", "garmin_error", 502)


@api_bp.route("/garmin/workouts/login", methods=["POST"])
def garmin_workouts_login():
    """{email, password} -> {connected} oder {mfa_required}. Passwort nur im Speicher dieser Anfrage."""
    athlete_id = get_current_athlete_id()
    body = request.get_json(silent=True)
    body = body if isinstance(body, dict) else {}
    email, password = body.get("email"), body.get("password")
    if not (isinstance(email, str) and "@" in email and 3 < len(email) <= 200
            and isinstance(password, str) and 0 < len(password) <= 200):
        return response_error("Bitte Garmin-E-Mail und Passwort eingeben.", "VALIDATION_ERROR", 400)
    if not library_available():
        return response_error("Auf dem Dashboard-PC fehlt die Garmin-Bibliothek: "
                              "python -m pip install -r requirements.txt", "garmin_library_missing", 503)
    from garminconnect import Garmin
    _pending_mfa.pop(athlete_id, None)
    try:
        client = Garmin(email.strip(), password, return_on_mfa=True)
        del password
        body.clear()
        status, _ = client.login()
        if status == "needs_mfa":
            client.password = None
            _pending_mfa[athlete_id] = (client, time.time() + MFA_TTL_S)
            return response_success({"connected": False, "mfa_required": True})
        finish_login(athlete_id, client)
    except Exception as e:
        return login_error(e, athlete_id)
    return response_success({"connected": True, "mfa_required": False})


@api_bp.route("/garmin/workouts/login/mfa", methods=["POST"])
def garmin_workouts_login_mfa():
    athlete_id = get_current_athlete_id()
    body = request.get_json(silent=True)
    code = body.get("code") if isinstance(body, dict) else None
    if not (isinstance(code, str) and re.fullmatch(r"\s*\d{4,8}\s*", code)):
        return response_error("Bitte den Code aus der E-Mail oder App eingeben (nur Ziffern).", "VALIDATION_ERROR", 400)
    pending = _pending_mfa.get(athlete_id)
    if not pending or pending[1] < time.time():
        _pending_mfa.pop(athlete_id, None)
        return response_error("Die Anmeldung ist abgelaufen. Bitte noch einmal mit E-Mail und Passwort starten.",
                              "garmin_mfa_expired", 409)
    client = pending[0]
    try:
        client.resume_login(None, code.strip())
        finish_login(athlete_id, client)
    except Exception as e:
        if "Authentication" in type(e).__name__:
            return response_error("Der Code stimmt nicht. Bitte noch einmal eingeben.", "garmin_mfa_wrong", 401)
        _pending_mfa.pop(athlete_id, None)
        return login_error(e, athlete_id)
    _pending_mfa.pop(athlete_id, None)
    return response_success({"connected": True})


@api_bp.route("/garmin/workouts/disconnect", methods=["POST"])
def garmin_workouts_disconnect():
    """Anmeldung entfernen. Workouts in Garmin bleiben, wie sie sind."""
    athlete_id = get_current_athlete_id()
    _pending_mfa.pop(athlete_id, None)
    shutil.rmtree(garmin_sync.token_path(athlete_id), ignore_errors=True)
    return response_success(status_payload(athlete_id))


@api_bp.route("/garmin/workouts/settings", methods=["PUT"])
def garmin_workouts_settings():
    athlete_id = get_current_athlete_id()
    body = request.get_json(silent=True)
    auto = body.get("auto") if isinstance(body, dict) else None
    if not isinstance(auto, bool):
        return response_error("auto muss true oder false sein.", "VALIDATION_ERROR", 400)
    session = get_session()
    try:
        get_state(session, athlete_id).auto = auto
        session.commit()
    finally:
        session.close()
    return response_success(status_payload(athlete_id))


def session_factory_for_request():
    from . import Session
    return Session


@api_bp.route("/garmin/workouts/sync", methods=["POST"])
def garmin_workouts_sync():
    """{items: [{id, steps, exercises}], only?: [id]} -> Ergebnis des Abgleichs.
    Ohne only: die naechsten 7 Tage (nur bei eingeschalteter Automatik)."""
    athlete_id = get_current_athlete_id()
    body = request.get_json(silent=True)
    body = body if isinstance(body, dict) else {}
    only = body.get("only")
    if only is not None and not (isinstance(only, list) and all(isinstance(i, str) for i in only) and len(only) <= 20):
        return response_error("only muss eine Liste von Einheiten sein.", "VALIDATION_ERROR", 400)
    if only is None:
        session = get_session()
        try:
            state = session.get(GarminPushState, athlete_id)
            auto = True if state is None else bool(state.auto)
        finally:
            session.close()
        if not auto:
            return response_success({"skipped": "auto_off", **status_payload(athlete_id)})
        if not connected(athlete_id):
            return response_success({"skipped": "not_connected", **status_payload(athlete_id)})
    result = run_push(athlete_id, session_factory_for_request(), items=body.get("items"), only=only, pin=only is not None)
    return response_success(result)
