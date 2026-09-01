#!/usr/bin/env python3
"""
Liest Garmin .fit-Dateien ein und extrahiert Trainingskennzahlen
in eine zentrale, strukturierte JSON-Datei (workouts.json).
"""
import fitdecode
import glob
import json
import os
from datetime import datetime, timezone

SRC_DIR = "/mnt/user-data/uploads/Documents"
OUT_PATH = "/home/claude/triathlon-dashboard/workouts.json"

SPORT_MAP = {
    "running": "Laufen",
    "cycling": "Rad",
    "swimming": "Schwimmen",
    "hiit": "Intervalltraining",
    "training": "Krafttraining",
    "generic": "Sonstiges",
    "flexibility_training": "Flexibilität",
    "transition": "Wechsel",
}

# sport="training" ist mehrdeutig (Garmin nutzt es als Oberkategorie für Kraft-,
# Cardio- UND Beweglichkeitstraining) - erst der sub_sport unterscheidet sie.
# Empirisch verifiziert (fitdecode) über den kompletten 2026er-Datensatz:
# sub_sport 19=flexibility_training, 20=strength_training, 26=cardio_training.
TRAINING_SUBSPORT_MAP = {
    "flexibility_training": "Flexibilität",
    "strength_training": "Krafttraining",
    "cardio_training": "Cardiotraining",
    "yoga": "Yoga",
    "pilates": "Pilates",
}

SUBSPORT_MAP = {
    "generic": "",
    "open_water": "Freiwasser",
    "lap_swimming": "Bahnenschwimmen",
    "road": "Straße",
    "indoor_cycling": "Indoor",
    "treadmill": "Laufband",
    "indoor_running": "Indoor",
    "hiit": "HIIT",
}


def get_sport_de(sport_raw, sub_sport_raw):
    """Ermittelt die deutsche Sportart-Bezeichnung. sport="training" wird anhand
    des sub_sport in Kraft-/Cardio-/Beweglichkeitstraining aufgeschlüsselt."""
    if sport_raw == "training" and sub_sport_raw in TRAINING_SUBSPORT_MAP:
        return TRAINING_SUBSPORT_MAP[sub_sport_raw]
    return SPORT_MAP.get(sport_raw, sport_raw.capitalize())


def get_session_fields(path):
    with fitdecode.FitReader(path) as fit:
        for frame in fit:
            if frame.frame_type == fitdecode.FIT_FRAME_DATA and frame.name == "session":
                return {f.name: f.value for f in frame.fields}
    return None


# Beim Schwimmen im Becken zeichnet Garmin pro geschwommener Bahn eine
# "length"-Nachricht auf (Zugzahl + Zugfrequenz), woraus sich SWOLF berechnen
# lässt. Bei Freiwasser gibt es das nicht (kontinuierliches GPS-Tracking statt
# Bahnen) - das nutzen wir zur Becken/Freiwasser-Erkennung, siehe main().
# fitdecode kennt das offizielle FIT-Profil und liefert dafür bereits die
# korrekten, benannten Felder (anders als der von Hand geschriebene JS-Parser,
# der die length-Feldnummern noch nicht an einer echten Datei verifizieren
# konnte - siehe DATA_MODEL.md). Diese Python-Referenz ist deshalb die
# verlässlichere Quelle, sobald eine echte Becken-Datei vorliegt.
SWIM_STROKE_MAP = {"freestyle": "Kraul", "backstroke": "Rücken", "breaststroke": "Brust",
                    "butterfly": "Schmetterling", "drill": "Drill", "mixed": "Mixed", "im": "Lagen"}


def get_swim_lengths(path):
    lengths = []
    with fitdecode.FitReader(path) as fit:
        for frame in fit:
            if frame.frame_type == fitdecode.FIT_FRAME_DATA and frame.name == "length":
                vals = {f.name: f.value for f in frame.fields}
                if vals.get("length_type") not in (None, "active"):
                    continue  # Pausen/Wende-Rest nicht mitzählen
                lengths.append(vals)
    return lengths


def has_gps_track(path):
    """Prüft, ob die Datei echte GPS-Positionsdaten enthält (record-Nachrichten
    mit position_lat/position_long). Freiwasserschwimmen trackt zwingend per
    GPS (kein Becken-Wandanschlag) - fehlt GPS komplett, kann es sich nicht um
    echtes Freiwasserschwimmen handeln, selbst wenn Dateiname/Aktivitätsprofil
    das behaupten (siehe Becken/Freiwasser-Erkennung in main())."""
    with fitdecode.FitReader(path) as fit:
        for frame in fit:
            if frame.frame_type == fitdecode.FIT_FRAME_DATA and frame.name == "record":
                vals = {f.name: f.value for f in frame.fields}
                if vals.get("position_lat") is not None and vals.get("position_long") is not None:
                    return True
    return False


def summarize_swim_lengths(lengths):
    """SWOLF (Zeit in Sekunden + Zugzahl je Bahn) + Ø-Zugfrequenz + häufigster
    Schwimmstil, aus den aktiven (nicht-idle) Bahnen."""
    if not lengths:
        return None, None, None, None, None, None
    swolf_vals, stroke_rates, stroke_counts = [], [], {}
    lengths_out = []
    for i, l in enumerate(lengths):
        t = l.get("total_timer_time") or l.get("total_elapsed_time")
        strokes = l.get("total_strokes")
        swolf = round(t + strokes) if (t is not None and strokes is not None) else None
        if swolf is not None:
            swolf_vals.append(swolf)
        rate = l.get("avg_swimming_cadence")
        if rate is not None:
            stroke_rates.append(rate)
        stroke = l.get("swim_stroke")
        if stroke is not None:
            stroke_counts[str(stroke)] = stroke_counts.get(str(stroke), 0) + 1
        lengths_out.append({
            "length_no": i + 1,
            "duration_s": round(t, 1) if t is not None else None,
            "strokes": strokes,
            "stroke_rate": rate,
            "swolf": swolf,
            "speed_mps": l.get("avg_speed"),
            "stroke_type": SWIM_STROKE_MAP.get(str(stroke), str(stroke) if stroke is not None else None),
        })
    avg_swolf = round(sum(swolf_vals) / len(swolf_vals), 1) if swolf_vals else None
    best_swolf = min(swolf_vals) if swolf_vals else None
    avg_stroke_rate = round(sum(stroke_rates) / len(stroke_rates), 1) if stroke_rates else None
    dominant_key = max(stroke_counts, key=stroke_counts.get) if stroke_counts else None
    dominant_stroke = SWIM_STROKE_MAP.get(dominant_key, dominant_key)
    return avg_swolf, best_swolf, len(lengths), avg_stroke_rate, dominant_stroke, lengths_out


STREAM_TARGET_POINTS = 200  # Downsampling-Ziel je Workout (für Detail-Charts)


def combine_cadence(cadence, fractional, sport_raw):
    """Kombiniert das rohe FIT-'cadence'-Feld (pro Bein, wie beim Rad) mit dem
    Nachkommaanteil; bei Laufen verdoppelt Garmin es zur 'Schrittfrequenz'
    (beide Füße). Muss exakt zur JS-Portierung (combineCadence) passen."""
    if cadence is None:
        return None
    v = cadence + (fractional or 0)
    if sport_raw == "running":
        v *= 2
    return round(v, 1)


def get_record_stream(path, start_time, sport_raw):
    """Liest alle 'record'-Nachrichten (Sekundenwerte) und downsampled sie auf
    max. STREAM_TARGET_POINTS Punkte, damit die Detail-Charts schnell bleiben.
    Deckt neben Puls/Pace/Distanz auch Höhe, Leistung, Kadenz, Steigung und
    Lauf-Dynamik (vertikale Oszillation, Bodenkontaktzeit, vertikales
    Verhältnis, Schrittlänge) ab, soweit das Gerät/Zubehör sie aufzeichnet."""
    records = []
    with fitdecode.FitReader(path) as fit:
        for frame in fit:
            if frame.frame_type == fitdecode.FIT_FRAME_DATA and frame.name == "record":
                vals = {f.name: f.value for f in frame.fields}
                ts = vals.get("timestamp")
                if not isinstance(ts, datetime) or not start_time:
                    continue
                t_s = (ts - start_time).total_seconds()
                records.append({
                    "t": round(t_s, 1),
                    "hr": vals.get("heart_rate"),
                    "speed": vals.get("enhanced_speed") or vals.get("speed"),
                    "dist": vals.get("distance"),
                    "alt": vals.get("enhanced_altitude") if vals.get("enhanced_altitude") is not None else vals.get("altitude"),
                    "power": vals.get("power"),
                    "cad": combine_cadence(vals.get("cadence"), vals.get("fractional_cadence"), sport_raw),
                    "grade": vals.get("grade"),
                    "vo": vals.get("vertical_oscillation"),
                    "gct": vals.get("stance_time"),
                    "vr": vals.get("vertical_ratio"),
                    "sl": vals.get("step_length"),
                })

    if not records:
        return None

    # Bucket-Downsampling (nicht simples "jeden n-ten Punkt nehmen"): so gehen
    # vereinzelte HF-Messpunkte (z.B. bei Sensor-Aussetzern) nicht einfach
    # unter, weil sie zwischen zwei genommenen Punkten liegen.
    n = len(records)
    bucket_size = max(1, -(-n // STREAM_TARGET_POINTS))  # ceil division

    def avg_key(bucket, key, decimals):
        vals = [r[key] for r in bucket if r[key] is not None]
        if not vals:
            return None
        return round(sum(vals) / len(vals), decimals)

    out = {"t": [], "hr": [], "speed": [], "dist": [], "alt": [], "power": [],
           "cad": [], "grade": [], "vo": [], "gct": [], "vr": [], "sl": []}
    for i in range(0, n, bucket_size):
        bucket = records[i:i + bucket_size]
        dist_vals = [r["dist"] for r in bucket if r["dist"] is not None]
        out["t"].append(bucket[0]["t"])
        out["hr"].append(round(avg_key(bucket, "hr", 6)) if avg_key(bucket, "hr", 6) is not None else None)
        out["speed"].append(avg_key(bucket, "speed", 3))
        out["dist"].append(round(dist_vals[-1], 1) if dist_vals else None)
        out["alt"].append(avg_key(bucket, "alt", 1))
        out["power"].append(round(avg_key(bucket, "power", 6)) if avg_key(bucket, "power", 6) is not None else None)
        out["cad"].append(avg_key(bucket, "cad", 0))
        out["grade"].append(avg_key(bucket, "grade", 1))
        out["vo"].append(avg_key(bucket, "vo", 1))
        out["gct"].append(round(avg_key(bucket, "gct", 6)) if avg_key(bucket, "gct", 6) is not None else None)
        out["vr"].append(avg_key(bucket, "vr", 1))
        out["sl"].append(round(avg_key(bucket, "sl", 6)) if avg_key(bucket, "sl", 6) is not None else None)

    return out


def fmt_pace_per_km(avg_speed_ms):
    """m/s -> min:sec pro km, als String"""
    if not avg_speed_ms or avg_speed_ms <= 0:
        return None
    sec_per_km = 1000.0 / avg_speed_ms
    m = int(sec_per_km // 60)
    s = int(round(sec_per_km % 60))
    if s == 60:
        m += 1
        s = 0
    return f"{m}:{s:02d}"


def fmt_pace_per_100m(avg_speed_ms):
    if not avg_speed_ms or avg_speed_ms <= 0:
        return None
    sec_per_100m = 100.0 / avg_speed_ms
    m = int(sec_per_100m // 60)
    s = int(round(sec_per_100m % 60))
    if s == 60:
        m += 1
        s = 0
    return f"{m}:{s:02d}"


def main():
    files = sorted(glob.glob(os.path.join(SRC_DIR, "*.fit")))
    workouts = []
    skipped = []

    for path in files:
        fname = os.path.basename(path)
        try:
            fields = get_session_fields(path)
        except Exception as e:
            skipped.append({"file": fname, "reason": str(e)})
            continue

        if not fields:
            skipped.append({"file": fname, "reason": "keine session-Nachricht gefunden"})
            continue

        sport_raw = str(fields.get("sport", "generic"))
        sub_sport_raw = str(fields.get("sub_sport", "generic"))
        sport_de = get_sport_de(sport_raw, sub_sport_raw)
        sub_sport_de = SUBSPORT_MAP.get(sub_sport_raw, sub_sport_raw)

        # Schwimm-Bahnen (nur bei nativen Becken-Aufzeichnungen vorhanden,
        # siehe get_swim_lengths) -> SWOLF/Zugfrequenz + robustere
        # Becken/Freiwasser-Erkennung als das (bei HealthFit unzuverlässige)
        # sub_sport-Feld UND als der Dateiname (spiegelt nur das auf der Uhr
        # gewählte Aktivitätsprofil, nicht wo tatsächlich geschwommen wurde -
        # bei falsch gewähltem Profil "Freiwasserschwimmen" im Becken landen
        # sonst fälschlich als Freiwasser markierte Becken-Einheiten).
        #
        # Reihenfolge nach Verlässlichkeit:
        #   1. Bahnen-Nachrichten vorhanden -> zwingend Becken (SWOLF möglich)
        #   2. Kein Bahnen, aber echter GPS-Track -> zwingend Freiwasser
        #      (Freiwasser trackt immer per GPS, ein Becken nie)
        #   3. Weder Bahnen noch GPS -> Becken (am wahrscheinlichsten: Becken
        #      ohne Bahnenerkennung, z.B. falsches Aktivitätsprofil gewählt).
        #      Dateiname bewusst NICHT mehr als Signal genutzt.
        avg_swolf = best_swolf = num_active_lengths = avg_stroke_rate = dominant_stroke = swim_lengths_out = None
        if sport_raw == "swimming":
            try:
                raw_lengths = get_swim_lengths(path)
            except Exception:
                raw_lengths = []
            avg_swolf, best_swolf, num_active_lengths, avg_stroke_rate, dominant_stroke, swim_lengths_out = summarize_swim_lengths(raw_lengths)
            if num_active_lengths:
                sub_sport_de = "Becken"
            else:
                try:
                    gps = has_gps_track(path)
                except Exception:
                    gps = False
                sub_sport_de = "Freiwasser" if gps else "Becken"

        # Developer-Felder (z.B. von HealthFit geschrieben, siehe DATA_MODEL.md)
        # - bekannte Felder werden befördert, alles andere landet ungefiltert
        # in dev_raw fürs Zukunfts-proofing.
        is_indoor = bool(fields["SESSION INDOOR"]) if fields.get("SESSION INDOOR") is not None else None
        rpe_estimated = fields.get("WORKOUT RPE ESTIMATED")
        avg_mets = fields.get("AVG METs")
        promoted_dev_keys = {"SESSION INDOOR", "WORKOUT RPE ESTIMATED", "AVG METs", "SESSION UUID"}
        dev_raw = {k: (v if isinstance(v, (int, float, str, bool)) else str(v))
                   for k, v in fields.items() if " " in k and k.isupper() and k not in promoted_dev_keys}

        start_time = fields.get("start_time")
        if isinstance(start_time, datetime):
            if start_time.tzinfo is None:
                start_time = start_time.replace(tzinfo=timezone.utc)
            iso_date = start_time.isoformat()
        else:
            iso_date = None

        duration_s = fields.get("total_timer_time") or fields.get("total_elapsed_time")
        distance_m = fields.get("total_distance")
        avg_speed = fields.get("enhanced_avg_speed") or fields.get("avg_speed")
        max_speed = fields.get("enhanced_max_speed") or fields.get("max_speed")

        pace_str = None
        speed_kmh = None
        if avg_speed:
            if sport_raw == "running":
                pace_str = fmt_pace_per_km(avg_speed)
            elif sport_raw == "swimming":
                pace_str = fmt_pace_per_100m(avg_speed)
            elif sport_raw == "cycling":
                speed_kmh = round(avg_speed * 3.6, 1)

        # Kadenz: dasselbe Rohfeld wie beim Rad (pro Bein bei Laufen), siehe
        # combine_cadence() für den Stream. Auf Session-Ebene liefert FIT
        # keinen separaten Nachkommaanteil, daher nur *2 bei Laufen.
        raw_avg_cadence = fields.get("avg_running_cadence") or fields.get("avg_cadence")
        raw_max_cadence = fields.get("max_running_cadence") or fields.get("max_cadence")
        avg_cadence = raw_avg_cadence * 2 if (raw_avg_cadence is not None and sport_raw == "running") else raw_avg_cadence
        max_cadence = raw_max_cadence * 2 if (raw_max_cadence is not None and sport_raw == "running") else raw_max_cadence
        # "Total Strides" (Laufen): total_cycles ist die Zahl voller
        # Schrittzyklen; Garmin Connect zeigt diesen Rohwert bereits als
        # "Gesamtschritte" (kein *2 nötig, das ist Konvention bei Garmin selbst).
        total_steps = fields.get("total_strides")
        if total_steps is None and sport_raw == "running":
            total_steps = fields.get("total_cycles")

        workout = {
            "file": fname,
            "date": iso_date,
            "sport": sport_de,
            "sport_raw": sport_raw,
            "sub_sport": sub_sport_de,
            "duration_min": round(duration_s / 60, 1) if duration_s else None,
            "duration_s": round(duration_s, 1) if duration_s else None,
            "distance_km": round(distance_m / 1000, 2) if distance_m else None,
            "avg_hr": fields.get("avg_heart_rate"),
            "max_hr": fields.get("max_heart_rate"),
            "min_hr": fields.get("min_heart_rate"),
            "pace_min_per_km": pace_str if sport_raw == "running" else None,
            "pace_min_per_100m": pace_str if sport_raw == "swimming" else None,
            "speed_kmh": speed_kmh,
            "max_speed_kmh": round(max_speed * 3.6, 1) if max_speed and sport_raw == "cycling" else None,
            "elevation_gain_m": fields.get("total_ascent"),
            "elevation_loss_m": fields.get("total_descent"),
            "calories": fields.get("total_calories"),
            "avg_power_w": fields.get("avg_power"),
            "max_power_w": fields.get("max_power"),
            "normalized_power_w": fields.get("normalized_power"),
            "training_load": round(fields.get("training_load_peak"), 1) if fields.get("training_load_peak") else None,
            "avg_cadence": avg_cadence,
            "max_cadence": max_cadence,
            "total_steps": total_steps if sport_raw == "running" else None,
            "avg_grade_pct": fields.get("avg_grade"),
            "avg_vertical_oscillation_mm": fields.get("avg_vertical_oscillation"),
            "avg_stance_time_ms": fields.get("avg_stance_time"),
            "avg_stance_time_pct": fields.get("avg_stance_time_percent"),
            "avg_vertical_ratio_pct": fields.get("avg_vertical_ratio"),
            "avg_step_length_mm": fields.get("avg_step_length"),
            "avg_swolf": avg_swolf,
            "best_swolf": best_swolf,
            "num_active_lengths": num_active_lengths,
            "avg_stroke_rate": avg_stroke_rate,
            "dominant_stroke": dominant_stroke,
            "lengths": swim_lengths_out,
            "is_indoor": is_indoor,
            "rpe_estimated": rpe_estimated,
            "avg_mets": avg_mets,
            "dev_raw": dev_raw or None,
        }

        try:
            start_dt = fields.get("start_time")
            if isinstance(start_dt, datetime) and start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            workout["stream"] = get_record_stream(path, start_dt, sport_raw)
        except Exception:
            workout["stream"] = None

        workouts.append(workout)

    workouts.sort(key=lambda w: w["date"] or "")

    # --- Multisport-Erkennung -------------------------------------------------
    # Garmin/HealthFit exportiert bei Triathlon/Multisport-Aktivitäten zusätzlich
    # zu den einzelnen Disziplinen eine "generic"-Session, die den GESAMTEN
    # Zeitraum (Schwimmen+Wechsel+Rad+Wechsel+Laufen) umfasst. Diese würde bei
    # Wochenumfang/Load doppelt zählen, wenn wir sie einfach mitsummieren.
    # -> Wir erkennen sie daran, dass ihr Zeitfenster alle anderen Sessions des
    #    gleichen Tages vollständig einschließt, und markieren sie als
    #    is_summary=True (wird in Diagrammen/Summen ausgeschlossen, taucht aber
    #    in der Tabelle als "Triathlon (Gesamt)" auf).
    # Kurze "generic"-Sessions (<15 min) am selben Tag wie andere Disziplinen
    # sind vermutlich Wechselzeiten (T1/T2) und werden entsprechend benannt.
    def parse_iso(s):
        return datetime.fromisoformat(s) if s else None

    for w in workouts:
        w["_start"] = parse_iso(w["date"])
        w["_end"] = (w["_start"] + __import__("datetime").timedelta(seconds=w["duration_s"])) if (w["_start"] and w["duration_s"]) else None
        w["is_summary"] = False

    by_day = {}
    for w in workouts:
        if not w["_start"]:
            continue
        by_day.setdefault(w["_start"].date(), []).append(w)

    for day, group in by_day.items():
        if len(group) < 2:
            continue
        for w in group:
            if w["sport_raw"] != "generic" or not w["_start"] or not w["_end"]:
                continue
            others = [o for o in group if o is not w]
            if not others:
                continue
            tolerance = __import__("datetime").timedelta(seconds=180)
            encloses_all = all(
                o["_start"] and o["_end"]
                and w["_start"] <= o["_start"] + tolerance
                and w["_end"] + tolerance >= o["_end"]
                for o in others
            )
            if encloses_all and w["duration_min"] and w["duration_min"] > 15:
                w["is_summary"] = True
                w["sport"] = "Triathlon (Gesamt)"
            elif w["duration_min"] and w["duration_min"] <= 15 and any(o["sport_raw"] in ("swimming", "cycling", "running") for o in others):
                w["sport"] = "Wechsel (T1/T2)"

    for w in workouts:
        del w["_start"]
        del w["_end"]

    data = {
        "generated_at": None,  # wird beim Speichern gesetzt (Python-Zeit, nicht Workflow)
        "source_folder": SRC_DIR,
        "count": len(workouts),
        "skipped": skipped,
        "workouts": workouts,
    }

    from datetime import datetime as dt
    data["generated_at"] = dt.now(timezone.utc).isoformat()

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"{len(workouts)} Workouts verarbeitet, {len(skipped)} übersprungen.")
    print(f"Gespeichert unter {OUT_PATH}")


if __name__ == "__main__":
    main()
