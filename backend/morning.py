"""Morgenbericht: Mitteilung aufs Handy, sobald die Daten der Nacht da sind.

Ablauf (laeuft im Server, alle paar Minuten zwischen 5:30 und 12 Uhr):
- Der Pi holt um 5:45 Uhr wie immer die Garmin-Daten (tools/garmin_sync.py).
- Ist die Nacht (Schlaf) fuer heute in der Datenbank, geht EINE Mitteilung an
  alle Geraete der Person: Schlaf, HRV, Ruhepuls und das heutige Training.
- Fehlt die Nacht noch, startet der Server um 8 Uhr einmal einen zweiten
  Garmin-Abruf (fuer Langschlaefer). Mehr Abrufe gibt es nicht.
- Hat die Person den Bericht im Dashboard schon gesehen, kommt keine
  Mitteilung mehr. Die KI-Zeilen entstehen erst beim Oeffnen im Dashboard
  (js/components/morning-report.js) - die Mitteilung kostet keine KI.

Endpunkte (alle mit Login):
    GET  /api/v1/push/status?endpoint=...   Schluessel + ob dieses Geraet angemeldet ist
    POST /api/v1/push/subscribe             {endpoint, keys: {p256dh, auth}, label}
    POST /api/v1/push/unsubscribe           {endpoint}
    POST /api/v1/push/test                  Probe-Mitteilung an alle eigenen Geraete
    PUT  /api/v1/morning/settings           {enabled}
    POST /api/v1/morning/seen               Bericht wurde heute angesehen
"""
import threading
import time
from datetime import date, datetime, time as dtime, timedelta

from . import get_current_athlete_id, web_push
from .models import AthleteStore, MorningState, PushSubscription, Wellness
from .routes import api_bp, get_session, response_error, response_success

PLANNED_KEY = "triathlon_dashboard_planned_workouts_v1"
WINDOW_START, WINDOW_END = dtime(5, 30), dtime(12, 0)
LATE_SYNC_AT = dtime(8, 0)
LOOP_SLEEP_S = 5 * 60
MAX_DEVICES = 10
# Dieselben Schwellen wie js/analytics/plan-rules.js (planWellnessSigns)
HRV_DROP_PCT, RHR_RISE_BPM, SKIN_TEMP_RISE_C, READINESS_LOW = 10, 5, 0.8, 25

SPORT_WORD = {"Laufen": "Laufen", "Rad": "Rad", "Schwimmen": "Schwimmen", "Kraft": "Kraft", "Mobility": "Mobility"}


# ------------------------------------------------------------ Daten der Nacht

def _values(row):
    data = row.garmin_wellness_data if isinstance(row.garmin_wellness_data, dict) else {}
    return {"sleep_min": row.sleep_min, "hrv_ms": row.hrv_ms, "resting_hr": row.resting_hr, **{k: v for k, v in data.items() if v is not None}}


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def night(session, athlete_id, day):
    """Werte von heute + 30-Tage-Mittel; None, solange der Schlaf fehlt."""
    rows = (session.query(Wellness).filter(Wellness.athlete_id == athlete_id, Wellness.date > day - timedelta(days=30),
                                           Wellness.date <= day).all())
    by_day = {r.date: _values(r) for r in rows}
    today = by_day.get(day)
    if not today or not (_num(today.get("sleep_min")) or 0) > 0:
        return None

    def base(field):
        vals = [_num(v.get(field)) for v in by_day.values()]
        vals = [x for x in vals if x is not None]
        return sum(vals) / len(vals) if len(vals) >= 3 else None

    return {"today": today, "base": {f: base(f) for f in ("hrv_ms", "resting_hr", "sleep_min")}}


def _hm(minutes):
    minutes = int(round(minutes))
    return f"{minutes // 60}:{minutes % 60:02d}"


def today_plan(session, athlete_id, day):
    row = session.query(AthleteStore).filter_by(athlete_id=athlete_id, key=PLANNED_KEY).first()
    items = row.value if row and isinstance(row.value, list) else []
    items = [p for p in items if isinstance(p, dict) and p.get("date") == day.isoformat()
             and (p.get("status") or "geplant") == "geplant"]
    items.sort(key=lambda p: p.get("sport") == "Mobility")  # Training vor Mobility
    return items


def build_message(n, plan):
    """-> {title, body}. Kurz, damit es auf dem Sperrbildschirm ganz zu lesen ist."""
    t, b = n["today"], n["base"]
    bits, warn = [f"Schlaf {_hm(t['sleep_min'])}"], []
    hrv = _num(t.get("hrv_ms"))
    if hrv:
        label = ""
        if b["hrv_ms"]:
            pct = (hrv - b["hrv_ms"]) / b["hrv_ms"] * 100
            label = " (niedriger als sonst)" if pct <= -HRV_DROP_PCT else " (gut)" if pct >= 5 else " (normal)"
            if pct <= -HRV_DROP_PCT:
                warn.append("hrv")
        bits.append(f"HRV {round(hrv)} ms{label}")
    rhr = _num(t.get("resting_hr"))
    if rhr:
        up = b["resting_hr"] and rhr - b["resting_hr"] >= RHR_RISE_BPM
        bits.append(f"Ruhepuls {round(rhr)}{' (erhöht)' if up else ''}")
        if up:
            warn.append("rhr")
    temp, ready = _num(t.get("skin_temp_dev_c")), _num(t.get("readiness_score"))
    if temp is not None and temp >= SKIN_TEMP_RISE_C:
        warn.append("temp")
    if ready is not None and ready < READINESS_LOW:
        warn.append("ready")

    main = plan[0] if plan else None
    if main:
        what = main.get("title") or SPORT_WORD.get(main.get("sport"), "Training")
        dur = _num(main.get("duration_min"))
        what += f" · {round(dur)} min" if dur else ""
        # Den Plan passt erst das Dashboard beim Oeffnen an (Plan-Check) - nichts versprechen
        hard = str(main.get("intensity") or "").lower() in ("hart", "mittel")
        plan_text = f"Geplant: {what} – dein Coach prüft, ob das heute passt." if warn and hard else f"Heute: {what}."
    else:
        plan_text = "Heute ist nichts geplant."
    lead = "Deine Uhr meldet wenig Erholung. " if warn else ""
    body = f"{lead}{' · '.join(bits)}. {plan_text}"
    return {"title": "Guten Morgen – dein Morgenbericht", "body": body[:230]}


# ------------------------------------------------------------ Versand

def subscriptions(session, athlete_id):
    return session.query(PushSubscription).filter_by(athlete_id=athlete_id).order_by(PushSubscription.id).all()


def send_to_athlete(session, athlete_id, payload, post=None):
    """An alle Geraete der Person. -> {sent, failed, gone, error}"""
    out = {"sent": 0, "failed": 0, "gone": 0, "error": None}
    for sub in subscriptions(session, athlete_id):
        try:
            web_push.send({"endpoint": sub.endpoint, "p256dh": sub.p256dh, "auth": sub.auth}, payload, post=post)
            sub.last_ok_at, sub.fail_count = datetime.utcnow(), 0
            out["sent"] += 1
        except web_push.PushGone:
            session.delete(sub)
            out["gone"] += 1
        except web_push.PushError as e:
            sub.fail_count = (sub.fail_count or 0) + 1
            out["failed"] += 1
            out["error"] = str(e)
    session.commit()
    return out


def _state(session, athlete_id):
    st = session.get(MorningState, athlete_id)
    if not st:
        st = MorningState(athlete_id=athlete_id, enabled=True)
        session.add(st)
    return st


def run_once(session, now=None, start_sync=None, post=None):
    """Ein Durchgang fuer alle Personen mit Geraet. -> Liste (athlete_id, was)."""
    now = now or datetime.now()
    if not (WINDOW_START <= now.time() < WINDOW_END) or not web_push.available():
        return []
    day, key = now.date(), now.date().isoformat()
    done = []
    ids = sorted({a for (a,) in session.query(PushSubscription.athlete_id).distinct()})
    for athlete_id in ids:
        st = _state(session, athlete_id)
        if not st.enabled or key in (st.sent_day, st.seen_day):
            continue
        n = night(session, athlete_id, day)
        if n:
            msg = build_message(n, today_plan(session, athlete_id, day))
            res = send_to_athlete(session, athlete_id, {**msg, "url": "./?morgen=1", "tag": f"morgen-{key}"}, post=post)
            st = _state(session, athlete_id)
            if res["sent"]:
                st.sent_day = key
            st.last_result = {"at": now.isoformat(timespec="seconds"), **res}
            done.append((athlete_id, "sent" if res["sent"] else "failed"))
        elif now.time() >= LATE_SYNC_AT and st.late_sync_day != key:
            st.late_sync_day = key
            if start_sync:
                try:
                    start_sync(athlete_id)  # Ergebnis kommt beim naechsten Durchgang
                except Exception as e:  # ein Abruf darf den Bericht nie stoppen
                    print(f"Morgenbericht: Abruf {type(e).__name__}", flush=True)
            done.append((athlete_id, "sync"))
        session.commit()
    return done


def start_background_loop():
    def loop():
        from . import Session
        from .garmin_api_routes import _start_sync
        time.sleep(60)
        while True:
            session = Session()
            try:
                run_once(session, start_sync=_start_sync)
            except Exception as e:  # der Thread darf nie enden
                session.rollback()
                print(f"Morgenbericht: {type(e).__name__}", flush=True)
            finally:
                session.close()
                Session.remove()
            time.sleep(LOOP_SLEEP_S)
    threading.Thread(target=loop, daemon=True, name="morning-report").start()


# ------------------------------------------------------------ Endpunkte

def _status(session, athlete_id, endpoint=None):
    subs = subscriptions(session, athlete_id)
    st = session.get(MorningState, athlete_id)
    ok = web_push.available()
    return {
        "available": ok,
        "publicKey": web_push.public_key() if ok else None,
        "devices": len(subs),
        "thisDevice": bool(endpoint) and any(s.endpoint == endpoint for s in subs),
        "morning": {"enabled": st.enabled if st else True, "sentDay": st.sent_day if st else None,
                    "seenDay": st.seen_day if st else None},
    }


def _missing_library():
    return response_error("Auf dem Dashboard-PC fehlt noch eine Bibliothek für Mitteilungen. Einmalig dort ausführen: "
                          "python -m pip install -r backend/requirements.txt", "push_unavailable", 503)


@api_bp.route("/push/status", methods=["GET"])
def push_status():
    from flask import request
    session = get_session()
    try:
        return response_success(_status(session, get_current_athlete_id(), request.args.get("endpoint")))
    finally:
        session.close()


@api_bp.route("/push/subscribe", methods=["POST"])
def push_subscribe():
    from flask import request
    if not web_push.available():
        return _missing_library()
    data = request.get_json(silent=True) or {}
    endpoint = data.get("endpoint")
    keys = data.get("keys") if isinstance(data.get("keys"), dict) else {}
    p256dh, auth = str(keys.get("p256dh") or ""), str(keys.get("auth") or "")
    if not web_push.allowed_endpoint(endpoint):
        return response_error("Dieser Browser nutzt einen unbekannten Mitteilungsdienst.", "push_endpoint", 400)
    try:
        ok = len(web_push.b64url_decode(p256dh)) == 65 and len(web_push.b64url_decode(auth)) == 16
    except ValueError:
        ok = False
    if not ok or len(p256dh) > 200 or len(auth) > 64:
        return response_error("Ungültige Anmeldung für Mitteilungen.", "push_keys", 400)
    athlete_id = get_current_athlete_id()
    session = get_session()
    try:
        sub = session.query(PushSubscription).filter_by(endpoint=endpoint).first() or PushSubscription(endpoint=endpoint)
        sub.athlete_id, sub.p256dh, sub.auth = athlete_id, p256dh, auth
        sub.label = str(data.get("label") or "")[:80] or None
        sub.fail_count = 0
        session.add(sub)
        session.flush()
        subs = subscriptions(session, athlete_id)
        for old in subs[:-MAX_DEVICES]:  # aelteste Geraete zuerst
            session.delete(old)
        _state(session, athlete_id)
        session.commit()
        return response_success(_status(session, athlete_id, endpoint))
    finally:
        session.close()


@api_bp.route("/push/unsubscribe", methods=["POST"])
def push_unsubscribe():
    from flask import request
    endpoint = (request.get_json(silent=True) or {}).get("endpoint")
    athlete_id = get_current_athlete_id()
    session = get_session()
    try:
        session.query(PushSubscription).filter_by(athlete_id=athlete_id, endpoint=endpoint).delete()
        session.commit()
        return response_success(_status(session, athlete_id))
    finally:
        session.close()


@api_bp.route("/push/test", methods=["POST"])
def push_test():
    if not web_push.available():
        return _missing_library()
    athlete_id = get_current_athlete_id()
    session = get_session()
    try:
        if not subscriptions(session, athlete_id):
            return response_error("Auf diesem Konto ist noch kein Gerät für Mitteilungen angemeldet.", "push_no_device", 409)
        n = night(session, athlete_id, date.today())
        msg = build_message(n, today_plan(session, athlete_id, date.today())) if n else {
            "title": "Mitteilungen sind an", "body": "So kommt dein Morgenbericht, sobald die Daten der Nacht da sind."}
        res = send_to_athlete(session, athlete_id, {**msg, "url": "./?morgen=1", "tag": "probe"})
        if not res["sent"]:
            return response_error(res["error"] or "Das Gerät ist nicht mehr angemeldet. Bitte Mitteilungen neu erlauben.",
                                  "push_failed", 502)
        return response_success({**res, **_status(session, athlete_id)})
    finally:
        session.close()


@api_bp.route("/morning/settings", methods=["PUT"])
def morning_settings():
    from flask import request
    data = request.get_json(silent=True) or {}
    athlete_id = get_current_athlete_id()
    session = get_session()
    try:
        st = _state(session, athlete_id)
        if isinstance(data.get("enabled"), bool):
            st.enabled = data["enabled"]
        session.commit()
        return response_success(_status(session, athlete_id))
    finally:
        session.close()


@api_bp.route("/morning/seen", methods=["POST"])
def morning_seen():
    athlete_id = get_current_athlete_id()
    session = get_session()
    try:
        _state(session, athlete_id).seen_day = date.today().isoformat()
        session.commit()
        return response_success({"ok": True})
    finally:
        session.close()
