"""Garmin-Datencheck: fragt jede Datenquelle der offiziellen Garmin-Schnittstelle
("Personal API") genau einmal ab und meldet, was davon wirklich ankommt.

Nur lesen - es wird nichts gespeichert, nichts im Dashboard geaendert. Ergebnis
je Quelle:
  ok       geliefert (mit kurzer Angabe, was drin ist)
  empty    Garmin antwortet, hat dafuer aber (an dem Tag) keine Daten
  blocked  Garmin gibt diesen Dienst fuer den Schluessel nicht frei (z. B. 403)
  error    anderer Fehler (Text dabei)
  skipped  nicht geprueft (Abbruch: Rate-Limit, Schluessel abgelehnt, offline)

Neben den Quellen, die der Abruf schon nutzt, prueft der Check auch einige,
die (noch) nicht abgerufen werden ("used": False) - so zeigt sich, ob es
sich lohnt, sie einzubauen.
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import date, timedelta

from tools import garmin_personal_api as personal_api

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAUSE_S = 0.3  # kurze Pause zwischen den Anfragen (Garmin-Rate-Limit)


def _size(value):
    """Wie viel steckt in einer Antwort? -> Anzahl Eintraege/Werte (0 = leer)."""
    if value is None:
        return 0
    if isinstance(value, dict):
        if isinstance(value.get("data"), list):
            return len(value["data"])
        return sum(1 for v in value.values() if v not in (None, "", [], {}))
    if isinstance(value, list):
        return len(value)
    return 1


def _fmt(v):
    """7.0 -> "7", 6.5 -> "6,5" (deutsche Schreibweise)."""
    v = round(float(v), 1)
    return str(int(v)) if v == int(v) else str(v).replace(".", ",")


def _count_label(n, one, many):
    return f"{n} {one if n == 1 else many}"


def probes(today):
    """Alle Pruefungen: (Gruppe, Schluessel, Name, used, Abruf). Abruf ist
    ("method", Name, Argumente) fuer Client-Methoden oder ("path", Pfad, Parameter)."""
    d = today.isoformat()
    y = (today - timedelta(days=1)).isoformat()
    w = (today - timedelta(days=6)).isoformat()
    m = (today - timedelta(days=29)).isoformat()
    return [
        ("Gesundheit", "sleep", "Schlaf (letzte Nacht)", True, ("method", "get_sleep_data", (d,))),
        ("Gesundheit", "hrv", "HRV (letzte Nacht)", True, ("method", "get_hrv_data", (d,))),
        ("Gesundheit", "rhr", "Ruhepuls (gestern)", True, ("method", "get_rhr_day", (y,))),
        ("Gesundheit", "readiness", "Trainingsbereitschaft (heute)", True, ("method", "get_training_readiness", (d,))),
        ("Gesundheit", "summaries", "Tageszusammenfassung / Body Battery (7 Tage)", True, ("method", "get_daily_summaries", (w, d))),
        ("Gesundheit", "body_battery", "Body Battery (eigener Dienst, 7 Tage)", True, ("method", "get_body_battery", (w, d))),
        ("Gesundheit", "steps", "Schritte (7 Tage)", True, ("method", "get_daily_steps", (w, d))),
        ("Gesundheit", "weight", "Gewicht (30 Tage)", True, ("method", "get_body_composition", (m, d))),
        ("Gesundheit", "lifestyle", "Besondere Tage / Lifestyle-Protokoll (gestern)", True, ("method", "get_lifestyle_log", (y,))),
        ("Gesundheit", "cycle", "Zyklus (heute)", True, ("method", "get_menstrual_day", (d,))),
        ("Belastung", "training_status", "Trainingszustand & Belastung 7 Tage / 4 Wochen", False,
         ("path", f"/metrics-service/metrics/trainingstatus/aggregated/{d}", None)),
        ("Belastung", "max_metrics", "VO2max von der Uhr", False,
         ("path", f"/metrics-service/metrics/maxmet/daily/{w}/{d}", None)),
        ("Profil", "profile", "Profil (Gewicht, Größe, Geburtsdatum)", True,
         ("path", "/userprofile-service/userprofile/user-settings", None)),
        ("Profil", "zones", "Pulszonen & Schwellen", True, ("path", "/biometric-service/heartRateZones/v2", None)),
        ("Kennwerte", "race", "Wettkampf-Prognosen", True, ("path", "/metrics-service/metrics/racepredictions", None)),
        ("Kennwerte", "endurance", "Ausdauer-Score", True,
         ("path", "/metrics-service/metrics/endurancescore", {"calendarDate": d})),
        ("Kennwerte", "hill", "Hill-Score", True, ("path", "/metrics-service/metrics/hillscore", {"calendarDate": d})),
        ("Kennwerte", "heat", "Hitze-/Höhengewöhnung", True,
         ("path", f"/metrics-service/metrics/heataltitudeacclimation/latest/{d}", None)),
        ("Kennwerte", "css", "Schwimm-Schwelle (CSS)", True, ("path", f"/biometric-service/criticalSwimSpeed/latest/{d}", None)),
    ]


def _status_of_error(e):
    """Fehler -> (Status, Text). 403/400: Dienst fuer den Schluessel nicht frei."""
    msg = getattr(e, "user_message", None) or str(e)
    code = re.search(r"Fehler (\d{3})", msg)
    if code and code.group(1) in ("400", "403", "405", "501"):
        return "blocked", f"Garmin gibt das für deinen Schlüssel nicht frei (Fehler {code.group(1)})."
    return "error", msg


def _stops(e):
    return isinstance(e, (personal_api.GarminApiTooManyRequestsError, personal_api.GarminApiAuthenticationError,
                          personal_api.GarminApiUnreachableError))


def _fit_fields(blob):
    """Original-Download (ZIP mit .fit) -> was parse_fit.py daraus liest, oder None."""
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            name = next((n for n in z.namelist() if n.lower().endswith(".fit")), None)
            data = z.read(name) if name else None
    except zipfile.BadZipFile:
        return None
    if not data:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        with open(os.path.join(tmp, "check.fit"), "wb") as f:
            f.write(data)
        out = os.path.join(tmp, "out.json")
        subprocess.run([sys.executable, os.path.join(BASE, "parse_fit.py"), tmp, "-o", out],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with open(out, encoding="utf-8") as f:
            workouts = json.load(f).get("workouts") or []
    return workouts[0] if workouts else {}


def _activity_items(client, today, pause):
    """Trainings: Liste der letzten 30 Tage und die Datei des neuesten -
    darin stecken Anstrengung (RPE), Temperatur und Runden."""
    items = []
    acts = client.get_activities_by_date((today - timedelta(days=29)).isoformat(), today.isoformat())
    n = len(acts or [])
    items.append({"group": "Trainings", "key": "activities", "label": "Trainingsliste (30 Tage)", "used": True,
                  "status": "ok" if n else "empty",
                  "detail": _count_label(n, "Training", "Trainings") if n else "Keine Trainings in den letzten 30 Tagen."})
    if not n:
        return items
    newest = max(acts, key=lambda a: str(a.get("startTimeLocal") or a.get("startTimeGMT") or ""))
    raw = str(newest.get("startTimeLocal") or "")[:10]
    when = ".".join(reversed(raw.split("-"))) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw) else raw
    pause()
    blob = client.download_original(newest.get("activityId"))
    fit = _fit_fields(blob)
    if fit is None:
        items.append({"group": "Trainings", "key": "fit", "label": "Trainingsdatei (.fit) des letzten Trainings",
                      "used": True, "status": "empty", "detail": f"Zum Training vom {when} gibt es keine Originaldatei."})
        return items
    items.append({"group": "Trainings", "key": "fit", "label": "Trainingsdatei (.fit) des letzten Trainings", "used": True,
                  "status": "ok", "detail": f"Training vom {when}: Datei kommt an."})
    laps = fit.get("laps") or []
    for key, label, ok, detail_ok, detail_empty in (
        ("rpe", "Gefühlte Anstrengung (RPE)", fit.get("rpe") is not None,
         f"{_fmt(fit.get('rpe'))}/10 eingetragen" if fit.get("rpe") is not None else "",
         "Nicht eingetragen – kommt nur, wenn du nach dem Training auf der Uhr die Anstrengung angibst."),
        ("temp", "Temperatur", fit.get("avg_temp_c") is not None,
         f"Ø {_fmt(fit.get('avg_temp_c'))} °C" if fit.get("avg_temp_c") is not None else "",
         "Die Datei enthält keine Temperatur."),
        ("laps", "Runden / Intervalle", bool(laps), _count_label(len(laps), "Runde", "Runden"),
         "Die Datei enthält keine Runden."),
    ):
        items.append({"group": "Trainings", "key": key, "label": label, "used": True,
                      "status": "ok" if ok else "empty", "detail": detail_ok if ok else detail_empty})
    return items


def run_check(client, today=None, pause_s=PAUSE_S):
    """-> {"checked_at", "items": [...], "counts": {status: n}}. Bricht bei
    Rate-Limit, abgelehntem Schluessel oder fehlender Verbindung ab; der Rest
    steht dann auf "skipped"."""
    today = today or date.today()
    items = []
    stopped = None

    def pause():
        if pause_s:
            time.sleep(pause_s)

    try:
        items.extend(_activity_items(client, today, pause))
    except Exception as e:  # noqa: BLE001 - jede Antwort soll im Bericht landen
        if _stops(e):
            stopped = getattr(e, "user_message", str(e))
        else:
            status, text = _status_of_error(e)
            items.append({"group": "Trainings", "key": "activities", "label": "Trainings", "used": True,
                          "status": status, "detail": text})

    for group, key, label, used, (kind, target, args) in probes(today):
        item = {"group": group, "key": key, "label": label, "used": used}
        if stopped:
            items.append({**item, "status": "skipped", "detail": "Nicht geprüft."})
            continue
        pause()
        try:
            if kind == "method":
                fn = getattr(client, target, None)
                if fn is None:
                    items.append({**item, "status": "blocked", "detail": "Diese Schnittstelle bietet das nicht an."})
                    continue
                value = fn(*args)
            else:
                value = client._get(target, args, missing_ok=True)
        except Exception as e:  # noqa: BLE001
            if _stops(e):
                stopped = getattr(e, "user_message", str(e))
                items.append({**item, "status": "skipped", "detail": "Nicht geprüft."})
            else:
                status, text = _status_of_error(e)
                items.append({**item, "status": status, "detail": text})
            continue
        n = _size(value)
        items.append({**item, "status": "ok" if n else "empty",
                      "detail": _count_label(n, "Wert", "Werte") + " geliefert" if n else "Garmin hat dafür gerade keine Daten."})

    counts = {}
    for it in items:
        counts[it["status"]] = counts.get(it["status"], 0) + 1
    return {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "items": items, "counts": counts, "stopped": stopped}
