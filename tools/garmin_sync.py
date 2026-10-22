#!/usr/bin/env python3
"""
Laedt Aktivitaeten und Gesundheitsdaten aus Garmin Connect herunter - fuer
jeden Dashboard-Benutzer getrennt, direkt in die Datenbank (training.db).

Pro Benutzer (athlete_id, siehe backend/create_user.py):
  1. Aktivitaeten -> Tabelle workouts. Geladen wird die ORIGINAL-.fit-Datei und
     vom vorhandenen Parser (parse_fit.py) gelesen, damit saemtliche Details
     erhalten bleiben: Sekundenkurven, Schwimmbahnen, Laufdynamik, Leistung.
     Das komplette Parser-Ergebnis steht in workouts.fit_data. Die .fit-Datei
     bleibt als Archiv unter fit-files/athlete_<id>/ liegen.
     Doppelte Aktivitaeten verhindert UNIQUE(athlete_id, garmin_activity_id).
  2. Gesundheitsdaten -> Tabelle wellness (ein Eintrag je Tag und Benutzer).
     Die Garmin-Rohantworten liegen je Benutzer in
     fit-files/athlete_<id>/garmin-raw-cache.json (inkrementeller Sync).

Zwei Wege zu Garmin, je Benutzer:
  - Offiziell (bevorzugt): Personal-API-Schluessel, den die Person selbst in
    Garmin Connect erstellt und in den Dashboard-Einstellungen eintraegt
    (tools/garmin_personal_api.py). Nur lesen, kein Passwort. Liegt ein
    Schluessel vor, wird er benutzt.
  - Bisher: Anmeldung per --login. Das Passwort wird NIE gespeichert oder
    geloggt. Es wird einmalig abgefragt, gegen ein Token getauscht und sofort
    verworfen. Das Token liegt je Benutzer unter ~/.triathlon/garmin_<id>.token
    (ausserhalb des Projekts, nur fuer den eigenen Betriebssystem-Benutzer
    lesbar) und erneuert sich danach selbst. Wird weiter fuer "An Garmin
    senden" gebraucht (das kann die offizielle Personal API nicht).

Fehler bei einem Benutzer (Token abgelaufen, Garmin blockt) landen als EINE
Zeile mit der Benutzer-Nummer in ~/.triathlon/garmin-sync.log - die anderen
Benutzer laufen trotzdem weiter.

Aufruf:
    python3 tools/garmin_sync.py --login --athlete 2   # einmalig: Garmin-Anmeldung fuer Benutzer 2
    python3 tools/garmin_sync.py                       # alle Benutzer mit Schluessel/Token, letzte 300 Tage
    python3 tools/garmin_sync.py --athlete 2           # nur Benutzer 2
    python3 tools/garmin_sync.py --days 1095           # einmalig mehr Historie nachholen
    python3 tools/garmin_sync.py --since 2024-01-01
    python3 tools/garmin_sync.py --activities-only
    python3 tools/garmin_sync.py --wellness-only
"""
import argparse
import getpass
import glob
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
from datetime import date, datetime, timedelta

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)  # fuer "from backend import ..."

from tools import garmin_personal_api as personal_api  # noqa: E402 - braucht den Pfad oben

# Token und Log liegen ausserhalb des Projekts unter ~/.triathlon (dieselben
# Orte wie GARMIN_TOKEN_PATH/GARMIN_LOG_PATH in backend/config.py).
TOKEN_DIR = os.path.expanduser("~/.triathlon")
LOG_PATH = os.path.join(TOKEN_DIR, "garmin-sync.log")


def token_path(athlete_id):
    # Die Garmin-Bibliothek legt hier einen kleinen Ordner mit garmin_tokens.json
    # an (Rechte 0700/0600) - so schreibt sie Tokens sicher und atomar.
    return os.path.join(TOKEN_DIR, f"garmin_{athlete_id}.token")


def athlete_dir(athlete_id):
    """Archiv je Benutzer: Original-.fit-Dateien + Roh-Zwischenspeicher. Liegt
    unter fit-files/, das per .gitignore nie ins Repository gelangt."""
    return os.path.join(BASE, "fit-files", f"athlete_{athlete_id}")


# Roh-Zwischenspeicher je Benutzer: enthaelt die unveraenderten Garmin-Antworten je Tag.
# Zweck 1 - inkrementell: bereits geholte Tage werden nie erneut abgefragt.
# Zweck 2 - Formataenderungen: Garmins interne Formate aendern sich
# gelegentlich; mit den Rohdaten laesst sich die Aufbereitung spaeter
# wiederholen, ohne alles neu herunterladen zu muessen.
def cache_path(athlete_id):
    return os.path.join(athlete_dir(athlete_id), "garmin-raw-cache.json")

# Standard-Zeitraum. 300 Tage decken ALLE Auswertungen des Dashboards ab - das
# laengste analytische Fenster ist der VO2max-Trend mit 240 Tagen (120 Tage
# aktuell + 120 Tage davor, siehe sportVo2Regression in
# js/analytics/performance.js). Form/Fitness (CTL/ATL/TSB) braucht 42, ACWR 28,
# Monotonie 7 Tage; die KI-Vergleichsgruppe nimmt ohnehin nur die 12
# aehnlichsten Einheiten.
#
# Was mit 300 Tagen NICHT mehr vollstaendig ist:
#   - Allzeit-Bestwerte im Rekorde-Tab und die Bestzeit-Erfolge. Eine
#     Bestleistung, die aelter als der Zeitraum ist, taucht nicht mehr auf.
#   - Der Filter-Chip "1J" (365 Tage) waere leicht unvollstaendig.
# Wer das braucht, holt sich die Historie einmalig nach - der Downloader
# ueberspringt bereits vorhandene Dateien, es geht also nichts verloren:
#   ./sync-garmin.command --days 1095
DEFAULT_DAYS = 300

REQUEST_PAUSE_S = 1.0   # Hoeflichkeitspause zwischen Anfragen (Rate-Limit)
RECENT_REFETCH_DAYS = 3  # letzte n Tage immer neu holen - Garmin traegt Werte nach

# Abschnitte, die je Tag abgefragt werden. Fehlt einer im Zwischenspeicher,
# wird der Tag erneut geholt (siehe unvollstaendig() in sync_wellness) - so
# werden alte Tage automatisch nachgezogen, wenn hier etwas dazukommt.
DAY_SECTIONS = ("sleep", "hrv", "rhr", "max_metrics", "training_status", "summary")


def log(msg):
    print(msg, flush=True)


def log_user(athlete_id, msg):
    """Genau eine Zeile je Benutzer und Lauf in LOG_PATH (und auf dem Bildschirm)."""
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} Nutzer {athlete_id}: {msg}"
    log(line)
    try:
        os.makedirs(TOKEN_DIR, exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass  # Log nicht beschreibbar - die Zeile steht trotzdem auf dem Bildschirm


def is_rate_limited(e):
    """Garmin drosselt: eigene Fehlerklasse (beide Wege) oder garminconnects
    "API Error 429" im Text."""
    return "TooManyRequests" in type(e).__name__ or re.search(r"API Error 429\b", str(e)) is not None


def is_auth_error(e):
    return "Authentication" in type(e).__name__


def describe_error(e, athlete_id):
    """Einzeiliger Fehlertext fuers Log. Enthaelt nie Zugangsdaten - das
    Passwort existiert ohnehin nur waehrend --login im Speicher."""
    if getattr(e, "user_message", None):  # offizielle API: fertiger deutscher Satz
        return e.user_message
    name = type(e).__name__
    if "TooManyRequests" in name:
        return "Garmin blockt gerade (zu viele Anfragen). Spaeter erneut starten."
    if "Authentication" in name:
        return ("Garmin-Anmeldung fehlt oder ist abgelaufen. Neu anmelden: "
                f"python3 tools/garmin_sync.py --login --athlete {athlete_id}")
    text = " ".join(str(e).split())[:200]
    return f"{name}: {text}" if text else name


# ---------------------------------------------------------------- Anmeldung

def connect(athlete_id, fresh_login=False):
    """Meldet einen Benutzer bei Garmin an: normal mit seinem gespeicherten
    Token, mit fresh_login=True (--login) per E-Mail/Passwort."""
    try:
        from garminconnect import Garmin, GarminConnectAuthenticationError
    except ImportError:
        raise SystemExit(
            "Die Bibliothek 'garminconnect' fehlt.\n"
            "  python3 -m pip install -r requirements.txt"
        )

    tokens = token_path(athlete_id)
    if not fresh_login:
        # Normalfall - ohne jede Eingabe, damit der Sync auch unbeaufsichtigt
        # fuer alle Benutzer nacheinander laufen kann.
        if not os.path.isdir(tokens):
            raise GarminConnectAuthenticationError("kein Garmin-Token")
        client = Garmin()
        client.login(tokens)
        log("Angemeldet (gespeichertes Token).")
        return client

    # --login: Passwort wird nur im Speicher gehalten, nie gespeichert oder geloggt.
    log(f"\nGarmin-Anmeldung fuer Benutzer {athlete_id}")
    log("Das Passwort wird NICHT gespeichert - nur ein Token, das sich danach selbst erneuert.")
    email = input("Garmin-E-Mail: ").strip()
    password = getpass.getpass("Garmin-Passwort (wird beim Tippen nicht angezeigt): ")
    client = Garmin(email, password, prompt_mfa=lambda: input("Code der Zwei-Faktor-Authentifizierung: ").strip())
    del password

    # Altes Token weg, sonst wuerde login() es wiederverwenden statt neu anzumelden.
    shutil.rmtree(tokens, ignore_errors=True)
    os.makedirs(TOKEN_DIR, exist_ok=True)
    # Der Token-Pfad MUSS hier uebergeben werden - login() speichert die Tokens
    # nur dann selbst ab. Ohne ihn waere bei jedem Lauf das Passwort noetig.
    client.login(tokens)

    saved = os.path.isfile(os.path.join(tokens, "garmin_tokens.json"))
    log(f"Angemeldet. {'Token gespeichert unter ' + tokens + ' (kuenftig ohne Passwort).' if saved else 'ACHTUNG: es wurde kein Token abgelegt - beim naechsten Lauf ist --login wieder noetig.'}")
    return client


# ------------------------------------------------------------- Aktivitaeten

def safe_filename(activity):
    """Dateiname nach der im Projekt ueblichen Konvention YYYY-MM-DD-HH-MM-SS.fit.
    Wichtig, weil der Datumsfilter beim Ordner-Scan die ersten 10 Zeichen des
    Dateinamens als Datum liest (siehe js/components/data-import.js)."""
    raw = activity.get("startTimeLocal") or activity.get("startTimeGMT") or ""
    try:
        dt = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
        return dt.strftime("%Y-%m-%d-%H-%M-%S") + ".fit"
    except ValueError:
        return f"activity-{activity.get('activityId')}.fit"


def download_original(client, aid):
    """Original-Datei (ZIP mit der .fit) - offizielle API oder garminconnect."""
    if hasattr(client, "download_original"):
        return client.download_original(aid)
    from garminconnect import Garmin
    return client.download_activity(aid, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)


def sync_activities(client, start, end, athlete_id, session):
    """Neue Aktivitaeten eines Benutzers -> Tabelle workouts. Bereits
    gespeicherte (gleiche garmin_activity_id) werden gar nicht erst geladen."""
    from backend.models import Workout

    fit_dir = athlete_dir(athlete_id)
    os.makedirs(fit_dir, exist_ok=True)
    log(f"\nAktivitaeten von {start} bis {end} ...")
    activities = client.get_activities_by_date(start.isoformat(), end.isoformat())
    log(f"  {len(activities)} Aktivitaeten gefunden.")

    known = {aid for (aid,) in session.query(Workout.garmin_activity_id).filter_by(athlete_id=athlete_id)}
    stats = {"neu": 0, "vorhanden": 0, "fehler": 0, "gesamt": len(activities)}
    fetched = {}  # Dateiname -> Garmin-Aktivitaet, wird danach in die Datenbank geschrieben
    blocked = None

    for i, act in enumerate(activities, 1):
        aid = act.get("activityId")
        if aid in known:
            stats["vorhanden"] += 1
            continue
        fname = safe_filename(act)
        target = os.path.join(fit_dir, fname)
        if os.path.exists(target) and os.path.getsize(target) > 0:
            fetched[fname] = act  # liegt schon im Archiv, fehlt nur in der Datenbank
            continue
        try:
            blob = download_original(client, aid)
            # Garmin liefert hier ein ZIP, nicht die rohe .fit - entpacken.
            wrote = False
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                for name in z.namelist():
                    if name.lower().endswith(".fit"):
                        with open(target, "wb") as f:
                            f.write(z.read(name))
                        wrote = True
                        break
            if wrote:
                fetched[fname] = act
                log(f"  [{i}/{len(activities)}] {fname}")
            else:
                stats["fehler"] += 1
                log(f"  [{i}/{len(activities)}] {aid}: keine .fit im Archiv - uebersprungen")
        except zipfile.BadZipFile:
            # Manche Aktivitaeten (manuell angelegt, ohne Geraetedatei) liefern
            # kein Archiv. Kein Grund, den ganzen Lauf abzubrechen.
            stats["fehler"] += 1
            log(f"  [{i}/{len(activities)}] {aid}: keine Originaldatei vorhanden (evtl. manuell angelegt)")
        except Exception as e:
            # Rate-Limit oder abgelehnter Schluessel: abbrechen (jede weitere
            # Anfrage scheitert genauso), Bereits-Geladenes aber noch speichern.
            if is_rate_limited(e) or is_auth_error(e):
                log("  Garmin drosselt die Anfragen (Rate-Limit). Bereits geladene Aktivitaeten\n"
                    "  werden noch gespeichert, spaeter einfach erneut starten."
                    if is_rate_limited(e) else f"  {describe_error(e, athlete_id)}")
                blocked = e
                break
            stats["fehler"] += 1
            log(f"  [{i}/{len(activities)}] {aid}: {describe_error(e, athlete_id)}")
        time.sleep(REQUEST_PAUSE_S)

    store_workouts(session, athlete_id, fit_dir, fetched, stats)
    if blocked:
        raise blocked  # -> eine Fehlerzeile fuer diesen Benutzer, die anderen laufen weiter
    return stats


def store_workouts(session, athlete_id, fit_dir, fetched, stats):
    """Liest die neuen .fit-Dateien mit dem vorhandenen parse_fit.py und
    speichert sie unter der athlete_id dieses Benutzers."""
    if not fetched:
        return
    from backend.workout_store import find_same_workout, workout_from_parsed
    from sqlalchemy.exc import IntegrityError

    # parse_fit.py liest einen ganzen Ordner - deshalb nur die neuen Dateien
    # in einen Zwischenordner kopieren, statt jedes Mal das ganze Archiv zu lesen.
    with tempfile.TemporaryDirectory() as tmp:
        for fname in fetched:
            shutil.copy2(os.path.join(fit_dir, fname), tmp)
        out = os.path.join(tmp, "workouts.json")
        subprocess.run([sys.executable, os.path.join(BASE, "parse_fit.py"), tmp, "-o", out],
                       check=True, stdout=subprocess.DEVNULL)
        with open(out, encoding="utf-8") as f:
            parsed = [w for w in json.load(f)["workouts"] if w.get("file") in fetched]
    stats["fehler"] += len(fetched) - len(parsed)  # Dateien, die parse_fit.py nicht lesen konnte

    for w in parsed:
        act = fetched[w["file"]]
        day = date.fromisoformat((act.get("startTimeLocal") or w.get("date") or "")[:10])

        # Dieselbe Einheit kann schon OHNE Garmin-Nummer da sein (z.B. frueher
        # aus workouts.json importiert). Dann nur die Nummer nachtragen - sonst
        # gaebe es sie doppelt, und jeder Lauf wuerde sie erneut herunterladen.
        twin = find_same_workout(session, athlete_id, day, w, only_without_garmin_id=True)
        if twin:
            twin.garmin_activity_id = act["activityId"]
            session.commit()
            stats["vorhanden"] += 1
            continue

        # fit_data = komplettes Parser-Ergebnis inkl. Kurven - das liest das Dashboard
        session.add(workout_from_parsed(athlete_id, w, day, "garmin", garmin_activity_id=act["activityId"]))
        try:
            session.commit()
            stats["neu"] += 1
        except IntegrityError:  # UNIQUE(athlete_id, garmin_activity_id): schon gespeichert
            session.rollback()
            stats["vorhanden"] += 1


# --------------------------------------------------------- Gesundheitsdaten

def load_cache(path):
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"days": {}, "ranges": {}}


def save_cache(cache, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)


FAILED = object()  # Abfrage gescheitert -> Abschnitt NICHT speichern, beim naechsten Lauf erneut holen


def call(client, method, *args):
    """Ruft eine Client-Methode auf, falls es sie gibt. Fehlt sie (andere
    Bibliotheksversion, oder die offizielle API bietet das nicht an), ist das
    Ergebnis None - endgueltig "keine Daten". Scheitert die Abfrage, kommt
    FAILED zurueck. Rate-Limit und abgelehnte Anmeldung werden weitergereicht:
    dann scheitert jede weitere Anfrage genauso, der Lauf bricht ab."""
    fn = getattr(client, method, None)
    if fn is None:
        return None
    try:
        return fn(*args)
    except Exception as e:
        if is_rate_limited(e) or is_auth_error(e):
            raise
        log(f"    {method}: {type(e).__name__}")
        return FAILED


def sync_wellness(client, start, end, path):
    """Holt Tageswerte inkrementell: nur Tage, die noch nicht im Zwischen-
    speicher `path` liegen (plus die letzten Tage, weil Garmin Werte nachtraegt)."""
    cache = load_cache(path)
    days = cache.setdefault("days", {})

    all_days = []
    d = start
    while d <= end:
        all_days.append(d.isoformat())
        d += timedelta(days=1)

    refetch_from = (date.today() - timedelta(days=RECENT_REFETCH_DAYS)).isoformat()

    # Ein Tag wird neu geholt, wenn er (a) noch gar nicht im Zwischenspeicher
    # liegt, (b) zu den letzten Tagen gehoert (Garmin traegt Werte nach) oder
    # (c) einen Abschnitt noch nicht enthaelt. Fall (c) macht die Erweiterung um
    # neue Endpunkte selbstheilend: sonst blieben alte Tage fuer immer ohne die
    # neu hinzugekommenen Werte, weil sie ja "schon im Cache" sind.
    def unvollstaendig(ds):
        e = days.get(ds)
        return not isinstance(e, dict) or any(k not in e for k in DAY_SECTIONS)

    todo = [ds for ds in all_days if ds not in days or ds >= refetch_from or unvollstaendig(ds)]

    log(f"\nGesundheitsdaten: {len(all_days)} Tage im Zeitraum, {len(todo)} abzurufen "
        f"({len(all_days) - len(todo)} bereits vorhanden).")

    # Abschnitte je Tag (s. DAY_SECTIONS). Tageszusammenfassung "summary":
    # liefert u.a. Body Battery (Hoch/Tief) - der Zeitraum-Endpunkt
    # get_body_battery lieferte im Praxistest nichts, deshalb je Tag.
    sections = (("sleep", "get_sleep_data"), ("hrv", "get_hrv_data"), ("rhr", "get_rhr_day"),
                ("max_metrics", "get_max_metrics"), ("training_status", "get_training_status"),
                ("summary", "get_user_summary"))
    try:
        for i, ds in enumerate(todo, 1):
            entry = days.get(ds, {})
            for key, method in sections:
                result = call(client, method, ds)
                if result is not FAILED:
                    entry[key] = result
            days[ds] = entry
            if i % 10 == 0 or i == len(todo):
                log(f"  {i}/{len(todo)} Tage")
                save_cache(cache, path)   # Zwischenstand sichern - ein Abbruch verliert nichts
            time.sleep(REQUEST_PAUSE_S)

        # Zeitraum-Abfragen: ein Aufruf fuer die ganze Spanne statt Tagesschleife.
        s, e = start.isoformat(), end.isoformat()
        ranges = cache.setdefault("ranges", {})
        log("  Body Battery, Gewicht, Schritte ...")
        for key, method in (("body_battery", "get_body_battery"), ("body_composition", "get_body_composition"),
                            ("daily_steps", "get_daily_steps")):
            result = call(client, method, s, e)
            if result is not FAILED and result:  # leer/fehlgeschlagen: alten Stand behalten
                ranges[key] = result
    finally:
        save_cache(cache, path)   # auch beim Abbruch (Rate-Limit, Schluessel abgelehnt)
    return cache


# ------------------------------------------------------------ Aufbereitung

def num(*candidates):
    """Erster nicht-leerer Zahlenwert - Garmin liefert je nach Endpunkt
    unterschiedliche Feldnamen fuer dieselbe Groesse."""
    for v in candidates:
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return v
    return None


def find_key(obj, key, depth=3):
    """Wert eines Feldes - oben oder bis zu `depth` Ebenen tiefer."""
    if not isinstance(obj, dict) or depth < 0:
        return None
    if key in obj:
        return obj[key]
    for value in obj.values():
        found = find_key(value, key, depth - 1)
        if found is not None:
            return found
    return None


def dig(obj, *path):
    for key in path:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


# Bekannte Garmin-Trainingszustaende. Unbekannte Phrasen werden unveraendert
# durchgereicht - lieber ein englischer Rohwert als eine erfundene Uebersetzung.
TRAINING_STATUS_DE = {
    "MAINTAINING": "Erhaltend", "PRODUCTIVE": "Produktiv", "PEAKING": "Formhoch",
    "RECOVERY": "Erholung", "UNPRODUCTIVE": "Unproduktiv", "OVERREACHING": "Ueberlastet",
    "DETRAINING": "Formverlust", "STRAINED": "Angestrengt", "NO_STATUS": None,
}


def training_status_label(ts_first):
    if not isinstance(ts_first, dict):
        return None
    phrase = ts_first.get("trainingStatusFeedbackPhrase")
    if not phrase:
        return None
    key = str(phrase).split("_")[0].upper()
    return TRAINING_STATUS_DE.get(key, str(phrase))


def normalize(cache):
    """Baut aus den Rohantworten flache Tageswerte. Fehlende Werte bleiben
    None und werden NIE als 0 gezaehlt - ein Tag ohne Uhr am Handgelenk ist
    eine Luecke, kein Nullwert."""
    out = {}

    for ds, raw in (cache.get("days") or {}).items():
        # Schlaf: garminconnect liefert {"dailySleepDTO": {...}}; bei der
        # offiziellen API stehen die Werte evtl. direkt oben - beides lesen.
        sleep_raw = raw.get("sleep") if isinstance(raw.get("sleep"), dict) else {}
        sleep_dto = sleep_raw.get("dailySleepDTO") or (sleep_raw if "sleepTimeSeconds" in sleep_raw else {})
        hrv_sum = dig(raw, "hrv", "hrvSummary") or {}
        rhr_raw = raw.get("rhr") or {}
        rhr_metrics = (dig(rhr_raw, "allMetrics", "metricsMap", "WELLNESS_RESTING_HEART_RATE") or [])
        # VO2max steht in der Praxis NICHT in max_metrics (das kam leer zurueck),
        # sondern im training_status unter mostRecentVO2Max - an echten Daten geprueft.
        vo2_generic = (dig(raw, "training_status", "mostRecentVO2Max", "generic")
                       or dig(raw, "max_metrics", "generic") or {})
        vo2_cycling = (dig(raw, "training_status", "mostRecentVO2Max", "cycling")
                       or dig(raw, "max_metrics", "cycling") or {})
        ts = dig(raw, "training_status", "mostRecentTrainingStatus", "latestTrainingStatusData") or {}
        ts_first = next(iter(ts.values()), {}) if isinstance(ts, dict) else {}

        sleep_s = num(sleep_dto.get("sleepTimeSeconds"))
        entry = {
            "sleep_min": round(sleep_s / 60) if sleep_s else None,
            "sleep_deep_min": (lambda v: round(v / 60) if v else None)(num(sleep_dto.get("deepSleepSeconds"))),
            "sleep_rem_min": (lambda v: round(v / 60) if v else None)(num(sleep_dto.get("remSleepSeconds"))),
            "sleep_score": num(dig(sleep_dto, "sleepScores", "overall", "value")),
            "hrv_ms": num(hrv_sum.get("lastNightAvg")),
            "hrv_status": hrv_sum.get("status"),
            "hrv_baseline_low": num(dig(hrv_sum, "baseline", "lowUpper")),
            "hrv_baseline_high": num(dig(hrv_sum, "baseline", "balancedUpper")),
            "resting_hr": num(rhr_raw.get("restingHeartRate"),
                              (rhr_metrics[0] or {}).get("value") if rhr_metrics else None),
            "vo2max": num(vo2_generic.get("vo2MaxPreciseValue"), vo2_generic.get("vo2MaxValue")),
            "vo2max_cycling": num(vo2_cycling.get("vo2MaxPreciseValue"), vo2_cycling.get("vo2MaxValue")),
            # trainingStatus ist ein Zahlencode, dessen Bedeutung Garmin nicht
            # dokumentiert - er waere fuer die KI wertlos. Die Feedback-Phrase
            # ("MAINTAINING_1") ist dagegen sprechend; davon wird der Teil vor
            # dem Unterstrich genutzt und - soweit bekannt - uebersetzt.
            # Unbekannte Phrasen werden unveraendert durchgereicht statt geraten.
            "training_status": training_status_label(ts_first),
            "training_load_week": num(ts_first.get("weeklyTrainingLoad")) if isinstance(ts_first, dict) else None,
        }
        if any(v is not None for v in entry.values()):
            out[ds] = entry

    def day_entry(ds):
        return out.setdefault(ds, {})

    # Body Battery aus der Tageszusammenfassung (get_user_summary). Bei der
    # offiziellen API ist die Antwort verschachtelt - dieselben Feldnamen
    # werden deshalb auch eine Ebene tiefer gesucht.
    for ds, raw in (cache.get("days") or {}).items():
        summ = raw.get("summary") or {}
        if not isinstance(summ, dict):
            continue
        hi = num(find_key(summ, "bodyBatteryHighestValue"), find_key(summ, "bodyBatteryMostRecentValue"))
        lo = num(find_key(summ, "bodyBatteryLowestValue"))
        if hi is not None or lo is not None:
            e = day_entry(ds)
            if hi is not None:
                e["body_battery_high"] = hi
            if lo is not None:
                e["body_battery_low"] = lo
        # Schritte hier als Reserve, falls der Zeitraum-Endpunkt nichts liefert
        st = num(summ.get("totalSteps"))
        if st is not None:
            day_entry(ds).setdefault("steps", st)

    # Body Battery: hoechster/niedrigster Wert des Tages
    for item in (dig(cache, "ranges", "body_battery") or []):
        ds = item.get("date") or item.get("calendarDate")
        if not ds:
            continue
        # Garmin liefert je Messpunkt [Zeitstempel, Status, Wert, ...] - der
        # Ladestand steht an Position 2. Fallback: der letzte Zahlenwert im
        # gueltigen Bereich 0-100, falls Garmin das Format aendert.
        levels = []
        for p in (item.get("bodyBatteryValuesArray") or []):
            if not isinstance(p, list):
                continue
            lvl = num(p[2]) if len(p) > 2 else None
            if lvl is None or not (0 <= lvl <= 100):
                lvl = next((v for v in reversed([num(x) for x in p])
                            if v is not None and 0 <= v <= 100), None)
            if lvl is not None:
                levels.append(lvl)
        if levels:
            e = day_entry(ds)
            e["body_battery_high"] = max(levels)
            e["body_battery_low"] = min(levels)

    # Gewicht/Koerperzusammensetzung. garminconnect (dateRange): dateWeightList;
    # offizielle API (weight/range): dailyWeightSummaries[].latestWeight.
    bc = dig(cache, "ranges", "body_composition") or {}
    weights = list(bc.get("dateWeightList") or [])
    for summ in (bc.get("dailyWeightSummaries") or []):
        latest = summ.get("latestWeight") if isinstance(summ, dict) else None
        if isinstance(latest, dict):
            weights.append({**latest, "calendarDate": latest.get("calendarDate") or summ.get("summaryDate")})
    for item in weights:
        ds = item.get("calendarDate")
        grams = num(item.get("weight"))
        if ds and grams:
            e = day_entry(ds)
            e["weight_kg"] = round(grams / 1000.0, 2)
            e["body_fat_pct"] = num(item.get("bodyFat"))
            e["muscle_mass_kg"] = (lambda v: round(v / 1000.0, 2) if v else None)(num(item.get("muscleMass")))

    # Schritte
    for item in (dig(cache, "ranges", "daily_steps") or []):
        ds = item.get("calendarDate")
        steps = num(item.get("totalSteps"))
        if ds and steps is not None:
            day_entry(ds)["steps"] = steps

    return {ds: v for ds, v in sorted(out.items()) if any(x is not None for x in v.values())}


def store_wellness(session, athlete_id, daily):
    """Tageswerte eines Benutzers -> Tabelle wellness. Vorhandene Tage werden
    aktualisiert, weil Garmin Werte nachtraegt. Alle Felder stehen in
    garmin_wellness_data (wie bisher je Tag in data/wellness-data.js); die
    passenden Einzelspalten werden zusaetzlich gefuellt."""
    from backend.models import Wellness
    existing = {r.date: r for r in session.query(Wellness).filter_by(athlete_id=athlete_id)}
    for ds, values in daily.items():
        day = date.fromisoformat(ds)
        row = existing.get(day) or Wellness(athlete_id=athlete_id, date=day)
        row.sleep_min = values.get("sleep_min")
        row.hrv_ms = values.get("hrv_ms")
        row.resting_hr = values.get("resting_hr")
        row.steps = values.get("steps")
        row.garmin_wellness_data = values
        session.add(row)
    session.commit()


# --------------------------------------------------------------------- CLI

def open_db():
    """Datenbank ueber das vorhandene Backend oeffnen - dieselbe training.db
    und dieselben Tabellen wie der Server."""
    try:
        from backend import create_app
    except ImportError as e:
        raise SystemExit(f"Es fehlt die Bibliothek '{e.name}'.\n"
                         "  python3 -m pip install -r backend/requirements.txt")
    try:
        _, session_factory = create_app()
    except RuntimeError as e:  # z.B. SECRET_KEY fehlt in .env
        raise SystemExit(str(e))
    return session_factory


def athletes_with_token():
    """Alle Benutzer mit Garmin-Zugang: altes Token ODER offizieller Schluessel."""
    ids = set()
    for path in glob.glob(os.path.join(TOKEN_DIR, "garmin_*.token")):
        m = re.fullmatch(r"garmin_(\d+)\.token", os.path.basename(path))
        if m:
            ids.add(int(m.group(1)))
    for path in glob.glob(os.path.join(personal_api.KEY_DIR, "garmin_api_*.json")):
        m = re.fullmatch(r"garmin_api_(\d+)\.json", os.path.basename(path))
        if m:
            ids.add(int(m.group(1)))
    return sorted(ids)


def client_for(athlete_id, fresh_login=False):
    """Offizielle API, wenn die Person einen Schluessel hinterlegt hat - sonst
    der bisherige Weg (gespeichertes Token bzw. --login)."""
    if not fresh_login and personal_api.has_key(athlete_id):
        log("Offizielle Garmin-Schnittstelle (Personal-API-Schluessel).")
        return personal_api.PersonalApiClient(athlete_id)
    return connect(athlete_id, fresh_login=fresh_login)


def sync_user(athlete_id, session_factory, start, end, args):
    """Kompletter Sync EINES Benutzers. Jeder Schreibzugriff nutzt seine athlete_id."""
    from backend.models import Athlete
    session = session_factory()
    try:
        if not session.query(Athlete).filter_by(athlete_id=athlete_id).first():
            raise LookupError(f"Benutzer {athlete_id} gibt es nicht (anlegen mit: python3 backend/create_user.py)")
        log(f"\n=== Benutzer {athlete_id} ===")
        client = client_for(athlete_id, fresh_login=args.login)

        parts = []
        if not args.wellness_only:
            st = sync_activities(client, start, end, athlete_id, session)
            parts.append(f"Aktivitäten {st['neu']} neu, {st['vorhanden']} vorhanden, {st['fehler']} Fehler")
        if not args.activities_only:
            daily = normalize(sync_wellness(client, start, end, cache_path(athlete_id)))
            store_wellness(session, athlete_id, daily)
            parts.append(f"Gesundheitsdaten {len(daily)} Tage")
        summary = ", ".join(parts)
        log_user(athlete_id, "OK - " + summary)
        return summary
    finally:
        session.close()


def main():
    ap = argparse.ArgumentParser(description="Synchronisiert Garmin Connect mit dem Dashboard (je Benutzer)")
    ap.add_argument("--athlete", type=int, metavar="ID",
                    help="nur dieser Benutzer (athlete_id); ohne Angabe alle mit Garmin-Schluessel oder -Token")
    ap.add_argument("--login", action="store_true",
                    help="Garmin-Anmeldung fuer --athlete einrichten (fragt E-Mail, Passwort und ggf. 2FA-Code)")
    ap.add_argument("--days", type=int, default=DEFAULT_DAYS,
                    help=f"Zeitraum in Tagen rueckwaerts (Standard: {DEFAULT_DAYS})")
    ap.add_argument("--since", help="Startdatum YYYY-MM-DD (hat Vorrang vor --days)")
    ap.add_argument("--activities-only", action="store_true", help="nur Aktivitaeten laden")
    ap.add_argument("--wellness-only", action="store_true", help="nur Gesundheitsdaten laden")
    args = ap.parse_args()
    if args.login and args.athlete is None:
        raise SystemExit("--login braucht --athlete, z.B.:  python3 tools/garmin_sync.py --login --athlete 2")

    end = date.today()
    if args.since:
        try:
            start = datetime.strptime(args.since, "%Y-%m-%d").date()
        except ValueError:
            raise SystemExit("--since braucht das Format YYYY-MM-DD")
    else:
        start = end - timedelta(days=args.days)

    session_factory = open_db()
    athlete_ids = [args.athlete] if args.athlete is not None else athletes_with_token()
    if not athlete_ids:
        raise SystemExit("Noch kein Benutzer mit Garmin-Zugang. Einrichten: Garmin-Schluessel in den\n"
                         "Dashboard-Einstellungen eintragen (empfohlen) oder\n"
                         "  python3 tools/garmin_sync.py --login --athlete <id>")

    failed = []
    for athlete_id in athlete_ids:
        try:
            sync_user(athlete_id, session_factory, start, end, args)
        except Exception as e:  # ein Benutzer darf die anderen nie stoppen
            failed.append(athlete_id)
            log_user(athlete_id, f"FEHLER - {describe_error(e, athlete_id)}")

    log(f"\nFertig: {len(athlete_ids) - len(failed)} von {len(athlete_ids)} Benutzern ohne Fehler. Log: {LOG_PATH}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("\nAbgebrochen.")
        sys.exit(130)
