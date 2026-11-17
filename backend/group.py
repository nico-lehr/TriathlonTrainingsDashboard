"""Gruppe: Highlights, Emoji-Reaktionen und Challenges unter den Nutzern
dieses Dashboards (Graphit: Bereich "Gruppe").

Grundsatz: geteilt werden nur Ergebnisse - ein Abzeichen, eine Bestzeit, die
Summe in einer Challenge. Nie einzelne Trainings, Puls, Tempo-Verlauf, GPS,
Gesundheitswerte oder Notizen. Mitmachen ist freiwillig (anfangs niemand);
wer nicht mitmacht, sieht die Gruppe nicht und wird nicht gezeigt.

    GET    /api/v1/group                              Stand fuer die Seite
    PUT    /api/v1/group/me        {display_name}     beitreten / umbenennen
    DELETE /api/v1/group/me                           austreten (loescht eigene Spuren)
    POST   /api/v1/group/highlights {items: [...]}    neue Abzeichen teilen
    DELETE /api/v1/group/highlights/<id>              eigenes Highlight loeschen
    POST   /api/v1/group/highlights/<id>/reactions {emoji}   Reaktion an/aus
    POST   /api/v1/group/challenges {...}             Challenge anlegen (man ist gleich dabei)
    POST   /api/v1/group/challenges/<id>/join         mitmachen
    DELETE /api/v1/group/challenges/<id>/join         aussteigen
    DELETE /api/v1/group/challenges/<id>              loeschen (Ersteller oder Betreiber)

Den Text eines Highlights baut das Dashboard aus festen Arten und geprueften
Zahlen - es gibt keinen freien Text ausser Anzeigename und Challenge-Titel.
"""
from datetime import date, datetime, timedelta, timezone

from flask import request
from sqlalchemy import func

from . import get_current_athlete_id
from .auth import is_admin
from .models import (AthleteLogin, Challenge, ChallengeMember, GroupHighlight, GroupMember, GroupReaction,
                     Workout)
from .routes import api_bp, get_session, response_error, response_success

# Feste Emoji-Auswahl (Schluessel -> Zeichen macht das Dashboard).
REACTIONS = ("fire", "muscle", "clap", "party", "wow")

# Dieselben Stufen wie js/analytics/achievements.js - alles andere wird abgelehnt.
COUNT_STEPS = {10, 25, 50, 100, 250, 500, 1000}
STREAK_STEPS = {7, 14, 30, 60, 100, 200, 365}
PB_DISTANCES = {"Laufen": {1000, 5000, 10000}, "Rad": {10000, 20000, 40000}}

CHALLENGE_KINDS = ("group", "personal", "ranking")
CHALLENGE_SPORTS = ("Laufen", "Rad", "Schwimmen", "alle")
CHALLENGE_METRICS = ("km", "hours", "sessions")
MAX_CHALLENGE_DAYS = 366
MAX_OPEN_CHALLENGES = 12      # je Ersteller gleichzeitig laufend/geplant
MAX_TARGET = 100_000
SHOW_ENDED_DAYS = 14          # beendete Challenges bleiben so lange sichtbar
FEED_DAYS = 90
FEED_LIMIT = 60
MAX_SHARE_AGE = timedelta(days=7)  # aeltere Abzeichen werden nicht mehr nachgereicht
MAX_ID = 2 ** 31 - 1


def iso(dt):
    return dt.replace(tzinfo=None).isoformat(timespec="seconds") + "Z" if dt else None


def utc_naive(text):
    """ISO-Zeit aus dem Browser (mit Z oder Versatz) -> naive UTC-Zeit, sonst None."""
    if not isinstance(text, str) or len(text) > 40:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def valid_id(value):
    return 0 < value <= MAX_ID


def clean_name(value, field, max_len):
    if not isinstance(value, str):
        raise ValueError(f"'{field}' fehlt")
    text = " ".join(value.split())
    if not text or len(text) > max_len:
        raise ValueError(f"'{field}' muss 1 bis {max_len} Zeichen haben")
    return text


def member_of(session, athlete_id):
    return session.get(GroupMember, athlete_id)


def names_by_id(session):
    return {m.athlete_id: m.display_name for m in session.query(GroupMember).all()}


# ============================================================================
# CHALLENGES: Fortschritt aus den Trainings
# ============================================================================

def progress_values(session, challenge, athlete_ids):
    """Summe je Person im Zeitraum der Challenge: km, Stunden oder Anzahl.
    Tageszusammenfassungen (is_summary) zaehlen nicht - wie im Dashboard."""
    if not athlete_ids:
        return {}
    if challenge.metric == "km":
        value = func.coalesce(func.sum(Workout.distance_km), 0.0)
    elif challenge.metric == "hours":
        value = func.coalesce(func.sum(Workout.duration_min), 0.0) / 60.0
    else:
        value = func.count(Workout.id)
    q = (session.query(Workout.athlete_id, value)
         .filter(Workout.athlete_id.in_(athlete_ids),
                 Workout.date >= challenge.start_date, Workout.date <= challenge.end_date,
                 func.coalesce(func.json_extract(Workout.fit_data, "$.is_summary"), 0) == 0))
    if challenge.sport != "alle":
        q = q.filter(Workout.sport == challenge.sport)
    out = {aid: 0.0 for aid in athlete_ids}
    for aid, v in q.group_by(Workout.athlete_id).all():
        out[aid] = round(float(v or 0), 2)
    return out


def challenge_snapshot(challenge, value=None):
    """Was ein Challenge-Highlight ueber die Challenge festhaelt."""
    data = {"challenge_id": challenge.id, "title": challenge.title, "kind": challenge.kind,
            "sport": challenge.sport, "metric": challenge.metric, "target": challenge.target}
    if value is not None:
        data["value"] = value
    return data


def add_highlight(session, athlete_id, kind, key, data):
    """Neues Highlight, ausser es gibt den Schluessel schon."""
    if session.query(GroupHighlight.id).filter_by(athlete_id=athlete_id, key=key).first():
        return None
    row = GroupHighlight(athlete_id=athlete_id, kind=kind, key=key, data=data, created_at=datetime.utcnow())
    session.add(row)
    return row


def settle_challenges(session, challenges, values_by_challenge, today):
    """Geschafft? Persoenliches Ziel, Gruppenziel, Rangliste nach dem Ende -
    dann gibt es (einmal) ein Highlight. Commit macht der Aufrufer."""
    changed = False
    now = datetime.utcnow()
    for c in challenges:
        values = values_by_challenge.get(c.id, {})
        members = {m.athlete_id: m for m in session.query(ChallengeMember).filter_by(challenge_id=c.id).all()}
        if c.kind == "personal" and c.target and c.start_date <= today:
            for aid, v in values.items():
                m = members.get(aid)
                if m is not None and m.done_at is None and v >= c.target:
                    m.done_at = now
                    add_highlight(session, aid, "challenge_done", f"ch{c.id}_done", challenge_snapshot(c, v))
                    changed = True
        elif c.kind == "group" and c.target and c.completed_at is None and sum(values.values()) >= c.target:
            c.completed_at = now
            add_highlight(session, None, "challenge_group", f"ch{c.id}_group",
                          {**challenge_snapshot(c, round(sum(values.values()), 2)), "members": len(members)})
            changed = True
        elif c.kind == "ranking" and c.completed_at is None and c.end_date < today:
            c.completed_at = now
            best = max(values.items(), key=lambda kv: kv[1], default=None)
            if best and best[1] > 0 and len(members) > 1:
                add_highlight(session, best[0], "challenge_win", f"ch{c.id}_win", challenge_snapshot(c, best[1]))
            changed = True
    return changed


def serialize_challenge(c, values, members, names, me, admin, today):
    rows = sorted(({"uid": aid, "name": names.get(aid, "?"), "value": values.get(aid, 0.0),
                    "done": members[aid].done_at is not None} for aid in members if aid in names),
                  key=lambda r: (-r["value"], r["name"].lower()))
    total = round(sum(r["value"] for r in rows), 2)
    status = "upcoming" if c.start_date > today else "ended" if c.end_date < today else "running"
    return {
        "id": c.id, "title": c.title, "kind": c.kind, "sport": c.sport, "metric": c.metric,
        "start": c.start_date.isoformat(), "end": c.end_date.isoformat(), "target": c.target,
        "status": status, "completed": iso(c.completed_at),
        "creator": names.get(c.creator_id), "mine": c.creator_id == me,
        "can_delete": c.creator_id == me or admin,
        "joined": me in members, "members": rows, "total": total,
    }


def visible_challenges(session, today):
    since = today - timedelta(days=SHOW_ENDED_DAYS)
    return (session.query(Challenge).filter(Challenge.end_date >= since)
            .order_by(Challenge.end_date.asc(), Challenge.id.asc()).all())


# ============================================================================
# HIGHLIGHTS: Feed
# ============================================================================

def serialize_feed(session, names, me, admin):
    since = datetime.utcnow() - timedelta(days=FEED_DAYS)
    rows = (session.query(GroupHighlight).filter(GroupHighlight.created_at >= since)
            .order_by(GroupHighlight.created_at.desc(), GroupHighlight.id.desc()).limit(FEED_LIMIT * 2).all())
    # Nur Highlights von Personen, die (noch) mitmachen - und die der Gruppe.
    rows = [h for h in rows if h.athlete_id is None or h.athlete_id in names][:FEED_LIMIT]
    reactions = {}
    if rows:
        for r in session.query(GroupReaction).filter(GroupReaction.highlight_id.in_([h.id for h in rows])).order_by(GroupReaction.id).all():
            if r.athlete_id in names:
                reactions.setdefault(r.highlight_id, []).append(r)
    out = []
    for h in rows:
        by_emoji = {}
        for r in reactions.get(h.id, []):
            by_emoji.setdefault(r.emoji, []).append(r.athlete_id)
        out.append({
            "id": h.id, "kind": h.kind, "data": h.data or {}, "at": iso(h.created_at),
            "uid": h.athlete_id, "name": names.get(h.athlete_id) if h.athlete_id else None,
            "mine": h.athlete_id == me, "can_delete": h.athlete_id == me or (admin and h.athlete_id is not None),
            "reactions": [{"emoji": e, "count": len(ids), "mine": me in ids, "names": [names[i] for i in ids]}
                          for e, ids in sorted(by_emoji.items(), key=lambda kv: REACTIONS.index(kv[0]) if kv[0] in REACTIONS else 99)],
        })
    return out


def reaction_summary(session, highlight_id, names, me):
    by_emoji = {}
    for r in session.query(GroupReaction).filter_by(highlight_id=highlight_id).order_by(GroupReaction.id).all():
        if r.athlete_id in names:
            by_emoji.setdefault(r.emoji, []).append(r.athlete_id)
    return [{"emoji": e, "count": len(ids), "mine": me in ids, "names": [names[i] for i in ids]}
            for e, ids in sorted(by_emoji.items(), key=lambda kv: REACTIONS.index(kv[0]) if kv[0] in REACTIONS else 99)]


def achievement_highlight(item):
    """(kind, key, data) aus einem geteilten Abzeichen - nur bekannte Arten und
    Stufen, sonst ValueError."""
    if not isinstance(item, dict):
        raise ValueError("Eintrag muss ein Objekt sein")
    kind = item.get("type")
    value = item.get("value")
    if kind in ("count", "streak"):
        steps = COUNT_STEPS if kind == "count" else STREAK_STEPS
        if isinstance(value, bool) or not isinstance(value, int) or value not in steps:
            raise ValueError("unbekannte Stufe")
        return kind, f"{kind}_{value}", {"value": value}
    if kind == "pb":
        sport, meters = item.get("sport"), item.get("meters")
        if sport not in PB_DISTANCES or meters not in PB_DISTANCES[sport]:
            raise ValueError("unbekannte Distanz")
        if isinstance(value, bool) or not isinstance(value, int) or not 60 <= value <= 86_400:
            raise ValueError("Zeit muss in Sekunden angegeben sein")
        return "pb", f"pb_{sport}_{meters}_{value}", {"sport": sport, "meters": meters, "value": value}
    raise ValueError("unbekannte Art")


# ============================================================================
# ENDPUNKTE
# ============================================================================

@api_bp.route("/group", methods=["GET"])
def group_state():
    """GET /api/v1/group - eigener Stand; Feed und Challenges nur fuer Mitglieder."""
    me = get_current_athlete_id()
    session = get_session()
    try:
        member = member_of(session, me)
        login = session.query(AthleteLogin).filter_by(athlete_id=me).first()
        count = session.query(func.count(GroupMember.athlete_id)).scalar() or 0
        state = {
            "me": {"uid": me, "joined": member is not None, "display_name": member.display_name if member else None,
                   "joined_at": iso(member.joined_at) if member else None,
                   "username": login.username if login else None},
            "member_count": count,
            "reactions": list(REACTIONS),
        }
        if member is None:
            return response_success(state)
        admin = is_admin(session, me)
        names = names_by_id(session)
        today = date.today()
        challenges = visible_challenges(session, today)
        members_by = {}
        for m in session.query(ChallengeMember).filter(ChallengeMember.challenge_id.in_([c.id for c in challenges] or [0])).all():
            members_by.setdefault(m.challenge_id, {})[m.athlete_id] = m
        values = {c.id: progress_values(session, c, sorted(a for a in members_by.get(c.id, {}) if a in names)) for c in challenges}
        if settle_challenges(session, challenges, values, today):
            session.commit()
        state["me"]["admin"] = admin
        state["members"] = sorted(({"uid": aid, "name": n} for aid, n in names.items()), key=lambda r: r["name"].lower())
        state["challenges"] = [serialize_challenge(c, values[c.id], members_by.get(c.id, {}), names, me, admin, today) for c in challenges]
        state["highlights"] = serialize_feed(session, names, me, admin)
        return response_success(state)
    finally:
        session.close()


@api_bp.route("/group/me", methods=["PUT"])
def group_join():
    """PUT /api/v1/group/me {display_name} - beitreten oder Namen aendern."""
    data = request.get_json(silent=True) or {}
    try:
        name = clean_name(data.get("display_name"), "display_name", 30)
    except ValueError as e:
        return response_error(str(e), "invalid_input", 400)
    me = get_current_athlete_id()
    session = get_session()
    try:
        member = member_of(session, me)
        if member is None:
            member = GroupMember(athlete_id=me, display_name=name, joined_at=datetime.utcnow())
            session.add(member)
        else:
            member.display_name = name
        session.commit()
        return response_success({"display_name": member.display_name, "joined_at": iso(member.joined_at)})
    finally:
        session.close()


@api_bp.route("/group/me", methods=["DELETE"])
def group_leave():
    """DELETE /api/v1/group/me - austreten: eigene Highlights (samt Reaktionen
    darauf), eigene Reaktionen und Challenge-Teilnahmen werden geloescht.
    Selbst angelegte Challenges bleiben fuer die anderen bestehen."""
    me = get_current_athlete_id()
    session = get_session()
    try:
        own = [h.id for h in session.query(GroupHighlight.id).filter_by(athlete_id=me).all()]
        if own:
            session.query(GroupReaction).filter(GroupReaction.highlight_id.in_(own)).delete(synchronize_session=False)
            session.query(GroupHighlight).filter(GroupHighlight.id.in_(own)).delete(synchronize_session=False)
        session.query(GroupReaction).filter_by(athlete_id=me).delete(synchronize_session=False)
        session.query(ChallengeMember).filter_by(athlete_id=me).delete(synchronize_session=False)
        session.query(GroupMember).filter_by(athlete_id=me).delete(synchronize_session=False)
        session.commit()
        return response_success({"joined": False})
    finally:
        session.close()


@api_bp.route("/group/highlights", methods=["POST"])
def group_share():
    """POST /api/v1/group/highlights {items: [{type, value, sport?, meters?, achieved_at}]}

    Nur fuer Mitglieder und nur Abzeichen, die nach dem Beitritt und in den
    letzten 7 Tagen erreicht wurden. Doppelte werden still uebergangen.
    Antwort: {added, skipped}."""
    data = request.get_json(silent=True) or {}
    items = data.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= 20:
        return response_error("'items' muss 1 bis 20 Eintraege haben", "invalid_input", 400)
    me = get_current_athlete_id()
    session = get_session()
    try:
        member = member_of(session, me)
        if member is None:
            return response_error("Du machst in der Gruppe nicht mit", "not_member", 403)
        now = datetime.utcnow()
        added = skipped = 0
        for item in items:
            try:
                kind, key, payload = achievement_highlight(item)
            except ValueError:
                skipped += 1
                continue
            at = utc_naive(item.get("achieved_at"))
            if at is None or at < member.joined_at - timedelta(minutes=1) or at < now - MAX_SHARE_AGE or at > now + timedelta(minutes=5):
                skipped += 1
                continue
            if add_highlight(session, me, kind, key, payload) is None:
                skipped += 1
            else:
                added += 1
        session.commit()
        return response_success({"added": added, "skipped": skipped})
    finally:
        session.close()


def find_highlight(session, highlight_id):
    if not valid_id(highlight_id):
        return None
    return session.get(GroupHighlight, highlight_id)


@api_bp.route("/group/highlights/<int:highlight_id>", methods=["DELETE"])
def group_delete_highlight(highlight_id):
    me = get_current_athlete_id()
    session = get_session()
    try:
        if member_of(session, me) is None:
            return response_error("Du machst in der Gruppe nicht mit", "not_member", 403)
        h = find_highlight(session, highlight_id)
        if h is None or h.athlete_id is None or (h.athlete_id != me and not is_admin(session, me)):
            return response_error("Highlight nicht gefunden", "not_found", 404)
        session.query(GroupReaction).filter_by(highlight_id=h.id).delete(synchronize_session=False)
        session.delete(h)
        session.commit()
        return response_success({"deleted": highlight_id})
    finally:
        session.close()


@api_bp.route("/group/highlights/<int:highlight_id>/reactions", methods=["POST"])
def group_react(highlight_id):
    """POST {emoji} - Reaktion setzen bzw. wieder wegnehmen (nicht beim eigenen Highlight)."""
    emoji = (request.get_json(silent=True) or {}).get("emoji")
    if emoji not in REACTIONS:
        return response_error("Unbekannte Reaktion", "invalid_input", 400)
    me = get_current_athlete_id()
    session = get_session()
    try:
        if member_of(session, me) is None:
            return response_error("Du machst in der Gruppe nicht mit", "not_member", 403)
        names = names_by_id(session)
        h = find_highlight(session, highlight_id)
        if h is None or (h.athlete_id is not None and h.athlete_id not in names):
            return response_error("Highlight nicht gefunden", "not_found", 404)
        if h.athlete_id == me:
            return response_error("Auf eigene Highlights kann man nicht reagieren", "own_highlight", 400)
        row = session.query(GroupReaction).filter_by(highlight_id=h.id, athlete_id=me, emoji=emoji).first()
        if row is None:
            session.add(GroupReaction(highlight_id=h.id, athlete_id=me, emoji=emoji))
        else:
            session.delete(row)
        session.commit()
        return response_success({"id": h.id, "reactions": reaction_summary(session, h.id, names, me)})
    finally:
        session.close()


def parse_challenge(data, today):
    """Gepruefte Felder einer neuen Challenge; ValueError mit deutscher Meldung."""
    title = clean_name(data.get("title"), "title", 60)
    kind, sport, metric = data.get("kind"), data.get("sport"), data.get("metric")
    if kind not in CHALLENGE_KINDS:
        raise ValueError("Unbekannte Art der Challenge")
    if sport not in CHALLENGE_SPORTS:
        raise ValueError("Unbekannte Sportart")
    if metric not in CHALLENGE_METRICS:
        raise ValueError("Unbekannte Messgroesse")
    if metric == "km" and sport == "alle":
        raise ValueError("Kilometer gibt es nur fuer eine Sportart - fuer alle Sportarten Stunden oder Einheiten waehlen")
    try:
        start = date.fromisoformat(str(data.get("start")))
        end = date.fromisoformat(str(data.get("end")))
    except ValueError:
        raise ValueError("Start und Ende muessen ein Datum JJJJ-MM-TT sein") from None
    if end < start:
        raise ValueError("Das Ende liegt vor dem Start")
    if end < today:
        raise ValueError("Die Challenge waere schon vorbei")
    if start < today - timedelta(days=31):
        raise ValueError("Der Start darf hoechstens 31 Tage zurueckliegen")
    if (end - start).days + 1 > MAX_CHALLENGE_DAYS:
        raise ValueError("Eine Challenge dauert hoechstens ein Jahr")
    target = data.get("target")
    if kind == "ranking":
        target = None
    elif isinstance(target, bool) or not isinstance(target, (int, float)) or not 0 < target <= MAX_TARGET:
        raise ValueError("Bitte ein Ziel groesser als 0 angeben")
    else:
        target = round(float(target), 1) if metric != "sessions" else float(int(target))
        if target <= 0:
            raise ValueError("Bitte ein Ziel groesser als 0 angeben")
    return {"title": title, "kind": kind, "sport": sport, "metric": metric,
            "start_date": start, "end_date": end, "target": target}


@api_bp.route("/group/challenges", methods=["POST"])
def group_create_challenge():
    data = request.get_json(silent=True) or {}
    me = get_current_athlete_id()
    session = get_session()
    try:
        if member_of(session, me) is None:
            return response_error("Du machst in der Gruppe nicht mit", "not_member", 403)
        today = date.today()
        try:
            fields = parse_challenge(data, today)
        except ValueError as e:
            return response_error(str(e), "invalid_input", 400)
        open_count = session.query(func.count(Challenge.id)).filter(Challenge.creator_id == me, Challenge.end_date >= today).scalar() or 0
        if open_count >= MAX_OPEN_CHALLENGES:
            return response_error(f"Du hast schon {MAX_OPEN_CHALLENGES} laufende Challenges", "too_many", 400)
        c = Challenge(creator_id=me, **fields)
        session.add(c)
        session.flush()
        session.add(ChallengeMember(challenge_id=c.id, athlete_id=me))
        session.commit()
        return response_success({"id": c.id}, status=201)
    finally:
        session.close()


def find_challenge(session, challenge_id):
    if not valid_id(challenge_id):
        return None
    return session.get(Challenge, challenge_id)


@api_bp.route("/group/challenges/<int:challenge_id>/join", methods=["POST", "DELETE"])
def group_challenge_join(challenge_id):
    me = get_current_athlete_id()
    session = get_session()
    try:
        if member_of(session, me) is None:
            return response_error("Du machst in der Gruppe nicht mit", "not_member", 403)
        c = find_challenge(session, challenge_id)
        if c is None:
            return response_error("Challenge nicht gefunden", "not_found", 404)
        row = session.query(ChallengeMember).filter_by(challenge_id=c.id, athlete_id=me).first()
        if request.method == "POST":
            if c.end_date < date.today():
                return response_error("Die Challenge ist schon vorbei", "ended", 400)
            if row is None:
                session.add(ChallengeMember(challenge_id=c.id, athlete_id=me))
        elif row is not None:
            session.delete(row)
        session.commit()
        return response_success({"id": c.id, "joined": request.method == "POST"})
    finally:
        session.close()


@api_bp.route("/group/challenges/<int:challenge_id>", methods=["DELETE"])
def group_delete_challenge(challenge_id):
    me = get_current_athlete_id()
    session = get_session()
    try:
        c = find_challenge(session, challenge_id)
        if c is None or member_of(session, me) is None or (c.creator_id != me and not is_admin(session, me)):
            return response_error("Challenge nicht gefunden", "not_found", 404)
        session.query(ChallengeMember).filter_by(challenge_id=c.id).delete(synchronize_session=False)
        session.delete(c)
        session.commit()
        return response_success({"deleted": challenge_id})
    finally:
        session.close()
