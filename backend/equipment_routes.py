"""Equipment (Laufschuhe, Rad, Verschleissteile, freie Items) und die
ausdrueckliche Zuordnung einzelner Trainings dazu.

Haengt am selben Blueprint wie routes.py - require_login() schuetzt die
Endpunkte also automatisch. JEDE Abfrage filtert nach der athlete_id aus dem
Token, auch Aendern/Loeschen ueber die id: fremdes Equipment ist fuer eine
Person nicht vorhanden (404), nicht "verboten".
"""
import re

from flask import request
from sqlalchemy.exc import IntegrityError

from . import get_current_athlete_id
from .models import AthleteStore, Equipment, EquipmentWorkout
from .routes import api_bp, get_session, response_error, response_success

SPORTS = ("Laufen", "Rad", "Schwimmen")
MAX_KM = 1_000_000
MAX_ID = 2 ** 31 - 1  # groessere Zahlen passen nicht in die Datenbank (sonst Fehler 500 statt 404)
MAX_IMPORT = 500
# Gleicher Schluessel wie js/data/equipment.js (EQUIPMENT_MIGRATED_KEY): "die alte Liste ist uebernommen".
MIGRATED_KEY = "triathlon_dashboard_equipment_migrated_v1"
DAY_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
# Zusatzfelder, die das Dashboard in `details` ablegt (Namen wie im Frontend).
DETAIL_DAYS = ("activeFrom", "activeTo", "resetAt", "createdAt")


def serialize_equipment(e: Equipment) -> dict:
    return {
        "id": e.id, "name": e.name, "typ": e.typ, "sport": e.sport, "parent_id": e.parent_id,
        "start_km": e.start_km, "max_km": e.max_km, "aktiv": e.aktiv, "details": e.details or {},
    }


def km_value(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= MAX_KM:
        raise ValueError(f"'{name}' muss eine Zahl zwischen 0 und {MAX_KM} sein")
    return float(value)


def clean_details(details):
    """Nur die bekannten Zusatzfelder, mit geprueften Typen."""
    if not isinstance(details, dict):
        raise ValueError("'details' muss ein Objekt sein")
    out = {}
    for key in DETAIL_DAYS:
        value = details.get(key)
        if value is not None and not (isinstance(value, str) and DAY_RE.fullmatch(value)):
            raise ValueError(f"'details.{key}' muss ein Datum JJJJ-MM-TT sein")
        out[key] = value
    out["manualKm"] = None if details.get("manualKm") is None else km_value(details["manualKm"], "details.manualKm")
    note = details.get("note") or ""
    if not isinstance(note, str) or len(note) > 300:
        raise ValueError("'details.note' darf hoechstens 300 Zeichen haben")
    out["note"] = note
    return out


def parse_fields(data, partial):
    """Gepruefte Spaltenwerte aus dem Anfragekoerper. partial=True (PUT): nur
    die mitgeschickten Felder. Wirft ValueError mit deutscher Meldung."""
    fields = {}
    if "name" in data or not partial:
        name = data.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 255:
            raise ValueError("'name' fehlt oder ist laenger als 255 Zeichen")
        fields["name"] = name.strip()
    if "typ" in data:
        if not isinstance(data["typ"], str) or not data["typ"].strip() or len(data["typ"]) > 50:
            raise ValueError("'typ' muss ein Text mit hoechstens 50 Zeichen sein")
        fields["typ"] = data["typ"].strip()
    if "sport" in data:
        if data["sport"] is not None and data["sport"] not in SPORTS:
            raise ValueError("'sport' muss Laufen, Rad, Schwimmen oder leer sein")
        fields["sport"] = data["sport"]
    if "parent_id" in data:
        if data["parent_id"] is not None and (isinstance(data["parent_id"], bool) or not isinstance(data["parent_id"], int)):
            raise ValueError("'parent_id' muss eine Zahl oder leer sein")
        fields["parent_id"] = data["parent_id"]
    if "start_km" in data:
        fields["start_km"] = km_value(data["start_km"], "start_km")
    if "max_km" in data:
        fields["max_km"] = None if data["max_km"] is None else km_value(data["max_km"], "max_km")
    if "aktiv" in data:
        if not isinstance(data["aktiv"], bool):
            raise ValueError("'aktiv' muss wahr oder falsch sein")
        fields["aktiv"] = data["aktiv"]
    if "details" in data:
        fields["details"] = clean_details(data["details"])
    return fields


def new_item(athlete_id, fields, **extra):
    return Equipment(athlete_id=athlete_id, **{"typ": "Sonstiges", "start_km": 0.0, "aktiv": True, **fields, **extra})


def own_item(session, athlete_id, equipment_id):
    if not 0 < equipment_id <= MAX_ID:
        return None
    return session.query(Equipment).filter_by(id=equipment_id, athlete_id=athlete_id).first()


def check_parent(session, athlete_id, parent_id, own_id=None):
    """Ein Verschleissteil gehoert zu einem eigenen Rad/Schuh (Hauptausruestung)."""
    if parent_id is None:
        return
    parent = own_item(session, athlete_id, parent_id)
    if parent is None or parent.parent_id is not None or parent.id == own_id:
        raise ValueError("'parent_id' ist kein eigenes Hauptequipment")


def list_equipment(session, athlete_id):
    return session.query(Equipment).filter_by(athlete_id=athlete_id).order_by(Equipment.id).all()


def list_response(session, athlete_id, **meta):
    rows = list_equipment(session, athlete_id)
    return response_success([serialize_equipment(e) for e in rows], {"count": len(rows), **meta})


# ============================================================================
# EQUIPMENT
# ============================================================================

@api_bp.route("/equipment", methods=["GET"])
def get_equipment():
    """GET /api/v1/equipment - alle Items der Person."""
    session = get_session()
    try:
        return list_response(session, get_current_athlete_id())
    finally:
        session.close()


@api_bp.route("/equipment", methods=["POST"])
def create_equipment():
    """POST /api/v1/equipment - {name, typ, sport, parent_id, start_km, max_km, aktiv, details}."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return response_error("Ungueltiger Anfragekoerper", "VALIDATION_ERROR", 400)
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        fields = parse_fields(data, partial=False)
        check_parent(session, athlete_id, fields.get("parent_id"))
        row = new_item(athlete_id, fields)
        session.add(row)
        session.commit()
        return response_success(serialize_equipment(row), status=201)
    except ValueError as e:
        session.rollback()
        return response_error(str(e), "VALIDATION_ERROR", 400)
    finally:
        session.close()


@api_bp.route("/equipment/<int:equipment_id>", methods=["PUT"])
def update_equipment(equipment_id):
    """PUT /api/v1/equipment/<id> - ersetzt die mitgeschickten Felder."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return response_error("Ungueltiger Anfragekoerper", "VALIDATION_ERROR", 400)
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        row = own_item(session, athlete_id, equipment_id)
        if row is None:
            return response_error("Equipment nicht gefunden", "not_found", 404)
        fields = parse_fields(data, partial=True)
        if "parent_id" in fields and fields["parent_id"] != row.parent_id:
            check_parent(session, athlete_id, fields["parent_id"], own_id=row.id)
            if session.query(Equipment).filter_by(athlete_id=athlete_id, parent_id=row.id).count() \
                    or session.query(EquipmentWorkout).filter_by(athlete_id=athlete_id, equipment_id=row.id).count():
                raise ValueError("'parent_id' laesst sich nicht aendern, solange der Eintrag eigene Teile oder zugeordnete Trainings hat")
        for key, value in fields.items():
            setattr(row, key, value)
        session.commit()
        return response_success(serialize_equipment(row))
    except ValueError as e:
        session.rollback()
        return response_error(str(e), "VALIDATION_ERROR", 400)
    finally:
        session.close()


@api_bp.route("/equipment/<int:equipment_id>", methods=["DELETE"])
def delete_equipment(equipment_id):
    """DELETE /api/v1/equipment/<id> - loescht das Item samt seinen
    Verschleissteilen und Trainings-Zuordnungen."""
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        row = own_item(session, athlete_id, equipment_id)
        if row is None:
            return response_error("Equipment nicht gefunden", "not_found", 404)
        ids = [equipment_id] + [e.id for e in session.query(Equipment).filter_by(athlete_id=athlete_id, parent_id=equipment_id)]
        session.query(EquipmentWorkout).filter(EquipmentWorkout.athlete_id == athlete_id, EquipmentWorkout.equipment_id.in_(ids)).delete(synchronize_session=False)
        session.query(Equipment).filter(Equipment.athlete_id == athlete_id, Equipment.id.in_(ids)).delete(synchronize_session=False)
        session.commit()
        return response_success({"id": equipment_id})
    finally:
        session.close()


@api_bp.route("/equipment/import", methods=["POST"])
def import_equipment():
    """POST /api/v1/equipment/import - einmalige Uebernahme der frueheren Liste
    aus der Ablage pro Person. {items: [{ref, parent_ref, ...Felder wie bei POST}]};
    ref ist die alte Kennung, parent_ref die alte Kennung des zugehoerigen Rads.
    Nur wenn die Person noch gar kein Equipment hat und noch nie uebernommen
    hat - sonst passiert nichts. Zwei gleichzeitige Aufrufe (zwei Browser-Tabs)
    legen trotzdem nur einmal an: der Marker MIGRATED_KEY wird als ERSTES in
    derselben Transaktion eingefuegt, die eindeutige (athlete_id, key)-Regel
    von athlete_store laesst den zweiten Aufruf scheitern - auch ueber
    mehrere Prozesse hinweg.
    Antwort: die komplette Liste, meta.imported sagt, ob uebernommen wurde."""
    data = request.get_json(silent=True)
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list) or len(items) > MAX_IMPORT:
        return response_error(f"'items' muss eine Liste mit hoechstens {MAX_IMPORT} Eintraegen sein", "VALIDATION_ERROR", 400)
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        if not items or session.query(Equipment).filter_by(athlete_id=athlete_id).count():
            return list_response(session, athlete_id, imported=False)

        parsed = []
        for raw in items:
            if not isinstance(raw, dict) or not isinstance(raw.get("ref"), str) or not (raw.get("parent_ref") is None or isinstance(raw["parent_ref"], str)):
                raise ValueError("Jeder Eintrag braucht ein 'ref' (und hoechstens ein 'parent_ref') als Text")
            if any(raw["ref"] == ref for ref, _, _ in parsed):
                raise ValueError("'ref' kommt doppelt vor")
            body = {k: v for k, v in raw.items() if k not in ("ref", "parent_ref", "parent_id")}
            parsed.append((raw["ref"], raw.get("parent_ref"), parse_fields(body, partial=False)))

        session.add(AthleteStore(athlete_id=athlete_id, key=MIGRATED_KEY, value=True))
        try:
            session.flush()
        except IntegrityError:  # schon uebernommen (oder gerade von einem anderen Aufruf)
            session.rollback()
            return list_response(session, athlete_id, imported=False)

        new_ids, skipped = {}, 0
        for ref, parent_ref, fields in parsed:  # erst die Hauptausruestung, dann deren Teile
            if parent_ref is None:
                row = new_item(athlete_id, fields)
                session.add(row)
                session.flush()
                new_ids[ref] = row.id
        for ref, parent_ref, fields in parsed:
            if parent_ref is None:
                continue
            if parent_ref not in new_ids:  # Teil ohne Rad: war schon im alten Dashboard unsichtbar
                skipped += 1
                continue
            session.add(new_item(athlete_id, fields, parent_id=new_ids[parent_ref]))
        session.commit()
        return list_response(session, athlete_id, imported=True, skipped=skipped)
    except ValueError as e:
        session.rollback()
        return response_error(str(e), "VALIDATION_ERROR", 400)
    finally:
        session.close()


# ============================================================================
# ZUORDNUNG EINZELNER TRAININGS
# ============================================================================

@api_bp.route("/equipment/assignments", methods=["GET"])
def get_assignments():
    """GET /api/v1/equipment/assignments - alle ausdruecklichen Zuordnungen
    [{equipment_id, workout_file}] der Person."""
    session = get_session()
    try:
        rows = session.query(EquipmentWorkout).filter_by(athlete_id=get_current_athlete_id()).order_by(EquipmentWorkout.id).all()
        return response_success([{"equipment_id": r.equipment_id, "workout_file": r.workout_file} for r in rows], {"count": len(rows)})
    finally:
        session.close()


@api_bp.route("/equipment/<int:equipment_id>/workouts", methods=["POST"])
def assign_workout(equipment_id):
    """POST /api/v1/equipment/<id>/workouts - {workout_file}: dieses Training
    zaehlt ab jetzt nur fuer dieses Item (war es einem anderen zugeordnet,
    wird es umgehaengt)."""
    data = request.get_json(silent=True)
    workout_file = data.get("workout_file") if isinstance(data, dict) else None
    if not isinstance(workout_file, str) or not 0 < len(workout_file) <= 255:
        return response_error("'workout_file' fehlt", "VALIDATION_ERROR", 400)
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        item = own_item(session, athlete_id, equipment_id)
        if item is None:
            return response_error("Equipment nicht gefunden", "not_found", 404)
        if item.parent_id is not None or not item.sport:
            return response_error("Trainings lassen sich nur Schuhen/Rad (Equipment mit Sportart) zuordnen", "VALIDATION_ERROR", 400)
        row = session.query(EquipmentWorkout).filter_by(athlete_id=athlete_id, workout_file=workout_file).first()
        if row is None:
            row = EquipmentWorkout(athlete_id=athlete_id, workout_file=workout_file)
            session.add(row)
        row.equipment_id = equipment_id
        session.commit()
        return response_success({"equipment_id": equipment_id, "workout_file": workout_file})
    except IntegrityError:  # zwei gleichzeitige Erst-Zuordnungen desselben Trainings
        session.rollback()
        return response_error("Bitte erneut speichern", "conflict", 409)
    finally:
        session.close()


@api_bp.route("/equipment/<int:equipment_id>/workouts", methods=["DELETE"])
def unassign_workout(equipment_id):
    """DELETE /api/v1/equipment/<id>/workouts?workout_file=... - Zuordnung
    aufheben, das Training zaehlt wieder automatisch."""
    workout_file = request.args.get("workout_file", "")
    session = get_session()
    try:
        athlete_id = get_current_athlete_id()
        if not 0 < equipment_id <= MAX_ID:
            return response_error("Zuordnung nicht gefunden", "not_found", 404)
        row = session.query(EquipmentWorkout).filter_by(athlete_id=athlete_id, equipment_id=equipment_id, workout_file=workout_file).first()
        if row is None:
            return response_error("Zuordnung nicht gefunden", "not_found", 404)
        session.delete(row)
        session.commit()
        return response_success({"equipment_id": equipment_id, "workout_file": workout_file})
    finally:
        session.close()
