#!/usr/bin/env python3
"""
Laedt Aktivitaeten und Gesundheitsdaten aus Garmin Connect herunter.

Zwei Ausgaben:
  1. fit-files/*.fit      - die ORIGINAL-.fit-Dateien je Aktivitaet. Sie laufen
                            anschliessend durch den vorhandenen Parser
                            (parse_fit.py bzw. den JS-Parser im Browser), womit
                            saemtliche Details erhalten bleiben: Sekundenkurven,
                            Schwimmbahnen, Laufdynamik, Leistung. Genau deshalb
                            wird bewusst NICHT die Aktivitaets-Zusammenfassung
                            aus der JSON-Antwort uebernommen - die waere flach.
  2. data/wellness-data.js - Gesundheitsdaten als "const GARMIN_WELLNESS = {...}".
                            Kein JSON, weil der Browser beim Doppelklick-Aufruf
                            (file://) kein fetch() auf lokale Dateien erlaubt,
                            ein <script src> aber problemlos laedt. Dasselbe
                            Muster wie data/workouts-data.js (siehe
                            build_dashboard.py).

Anmeldung: Das Passwort wird NICHT gespeichert. Es wird einmalig abgefragt,
gegen ein Token getauscht und sofort verworfen. Das Token liegt unter
~/.garminconnect (lokale Platte, NICHT iCloud - es soll nicht durch die Cloud
synchronisiert werden) und erneuert sich danach selbst.

Aufruf:
    python3 tools/garmin_sync.py                # letzte 300 Tage (Standard)
    python3 tools/garmin_sync.py --days 1095    # einmalig mehr Historie nachholen
    python3 tools/garmin_sync.py --since 2024-01-01
    python3 tools/garmin_sync.py --activities-only
    python3 tools/garmin_sync.py --wellness-only
"""
import argparse
import getpass
import io
import json
import os
import sys
import time
import zipfile
from datetime import date, datetime, timedelta

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIT_DIR = os.path.join(BASE, "fit-files")
DATA_DIR = os.path.join(BASE, "data")
WELLNESS_JS = os.path.join(DATA_DIR, "wellness-data.js")
# Roh-Zwischenspeicher: enthaelt die unveraenderten Garmin-Antworten je Tag.
# Zweck 1 - inkrementell: bereits geholte Tage werden nie erneut abgefragt.
# Zweck 2 - Formataenderungen: Garmins interne Formate aendern sich
# gelegentlich; mit den Rohdaten laesst sich die Aufbereitung spaeter
# wiederholen, ohne alles neu herunterladen zu muessen.
CACHE_PATH = os.path.join(DATA_DIR, "garmin-raw-cache.json")
TOKEN_DIR = os.path.expanduser("~/.garminconnect")

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


# ---------------------------------------------------------------- Anmeldung

def connect():
    """Meldet sich an - bevorzugt mit gespeichertem Token, sonst per Passwort."""
    try:
        from garminconnect import Garmin
    except ImportError:
        raise SystemExit(
            "Die Bibliothek 'garminconnect' fehlt.\n"
            "  python3 -m pip install -r requirements.txt"
        )

    # Versuch 1: vorhandenes Token. Das ist der Normalfall - ohne jede Eingabe.
    if os.path.isdir(TOKEN_DIR):
        try:
            client = Garmin()
            client.login(TOKEN_DIR)
            log("Angemeldet (gespeichertes Token).")
            return client
        except Exception as e:
            log(f"Gespeichertes Token nicht mehr gueltig ({type(e).__name__}) - neue Anmeldung noetig.")

    # Versuch 2: Passwort-Anmeldung. Passwort wird nur im Speicher gehalten.
    log("\nAnmeldung bei Garmin Connect")
    log("Das Passwort wird NICHT gespeichert - nur ein Token, das sich danach selbst erneuert.")
    email = os.environ.get("GARMIN_EMAIL") or input("E-Mail: ").strip()
    password = os.environ.get("GARMIN_PASSWORD") or getpass.getpass("Passwort: ")

    client = Garmin(email, password, prompt_mfa=lambda: input("Code der Zwei-Faktor-Authentifizierung: ").strip())

    # Das Token-Verzeichnis MUSS hier uebergeben werden - login() speichert die
    # Tokens nur dann selbst ab ("Persist tokens so next run restores without
    # re-login/MFA"). Ohne das Argument waere bei jedem Lauf das Passwort noetig.
    os.makedirs(TOKEN_DIR, exist_ok=True)
    os.chmod(TOKEN_DIR, 0o700)
    try:
        client.login(TOKEN_DIR)
    except Exception as e:
        raise SystemExit(f"\nAnmeldung fehlgeschlagen: {e}\n"
                         "Bei wiederholten Fehlern hilft meist ein Update:\n"
                         "  python3 -m pip install -U garminconnect curl_cffi")
    del password

    saved = os.path.isdir(TOKEN_DIR) and any(os.scandir(TOKEN_DIR))
    log(f"Angemeldet. {'Token gespeichert unter ' + TOKEN_DIR + ' (kuenftig ohne Passwort).' if saved else 'ACHTUNG: es wurde kein Token abgelegt - beim naechsten Lauf ist das Passwort wieder noetig.'}")
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


def sync_activities(client, start, end):
    os.makedirs(FIT_DIR, exist_ok=True)
    log(f"\nAktivitaeten von {start} bis {end} ...")
    try:
        activities = client.get_activities_by_date(start.isoformat(), end.isoformat())
    except Exception as e:
        log(f"  Aktivitaetsliste konnte nicht geladen werden: {e}")
        return {"neu": 0, "vorhanden": 0, "fehler": 1, "gesamt": 0}

    log(f"  {len(activities)} Aktivitaeten gefunden.")
    stats = {"neu": 0, "vorhanden": 0, "fehler": 0, "gesamt": len(activities)}

    from garminconnect import Garmin, GarminConnectTooManyRequestsError

    for i, act in enumerate(activities, 1):
        aid = act.get("activityId")
        fname = safe_filename(act)
        target = os.path.join(FIT_DIR, fname)
        if os.path.exists(target) and os.path.getsize(target) > 0:
            stats["vorhanden"] += 1
            continue
        try:
            blob = client.download_activity(aid, dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL)
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
                stats["neu"] += 1
                log(f"  [{i}/{len(activities)}] {fname}")
            else:
                stats["fehler"] += 1
                log(f"  [{i}/{len(activities)}] {aid}: keine .fit im Archiv - uebersprungen")
        except GarminConnectTooManyRequestsError:
            log("  Garmin drosselt die Anfragen (Rate-Limit). Abbruch der Aktivitaeten -\n"
                "  bereits geladene Dateien bleiben erhalten, spaeter einfach erneut starten.")
            stats["fehler"] += 1
            break
        except zipfile.BadZipFile:
            # Manche Aktivitaeten (manuell angelegt, ohne Geraetedatei) liefern
            # kein Archiv. Kein Grund, den ganzen Lauf abzubrechen.
            stats["fehler"] += 1
            log(f"  [{i}/{len(activities)}] {aid}: keine Originaldatei vorhanden (evtl. manuell angelegt)")
        except Exception as e:
            stats["fehler"] += 1
            log(f"  [{i}/{len(activities)}] {aid}: {type(e).__name__}: {e}")
        time.sleep(REQUEST_PAUSE_S)

    return stats


# --------------------------------------------------------- Gesundheitsdaten

def load_cache():
    if os.path.exists(CACHE_PATH):
        try:
            with open(CACHE_PATH, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"days": {}, "ranges": {}}


def save_cache(cache):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)


def call(client, method, *args):
    """Ruft eine Client-Methode auf, falls sie in der installierten Version
    existiert. Die Bibliothek benennt Methoden zwischen Versionen um - ein
    fehlender Endpunkt darf nie den ganzen Sync stoppen."""
    fn = getattr(client, method, None)
    if fn is None:
        return None
    try:
        return fn(*args)
    except Exception as e:
        log(f"    {method}: {type(e).__name__}")
        return None


def sync_wellness(client, start, end):
    """Holt Tageswerte inkrementell: nur Tage, die noch nicht im Zwischen-
    speicher liegen (plus die letzten Tage, weil Garmin Werte nachtraegt)."""
    cache = load_cache()
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

    for i, ds in enumerate(todo, 1):
        entry = days.get(ds, {})
        entry["sleep"] = call(client, "get_sleep_data", ds)  # Abschnitte s. DAY_SECTIONS
        entry["hrv"] = call(client, "get_hrv_data", ds)
        entry["rhr"] = call(client, "get_rhr_day", ds)
        entry["max_metrics"] = call(client, "get_max_metrics", ds)
        entry["training_status"] = call(client, "get_training_status", ds)
        # Tageszusammenfassung: liefert u.a. Body Battery (Hoch/Tief). Der
        # Zeitraum-Endpunkt get_body_battery lieferte im Praxistest nichts,
        # deshalb wird der Wert hier je Tag mitgenommen.
        entry["summary"] = call(client, "get_user_summary", ds)
        days[ds] = entry
        if i % 10 == 0 or i == len(todo):
            log(f"  {i}/{len(todo)} Tage")
            save_cache(cache)   # Zwischenstand sichern - ein Abbruch verliert nichts
        time.sleep(REQUEST_PAUSE_S)

    # Zeitraum-Abfragen: ein Aufruf fuer die ganze Spanne statt Tagesschleife.
    s, e = start.isoformat(), end.isoformat()
    ranges = cache.setdefault("ranges", {})
    log("  Body Battery, Gewicht, Schritte ...")
    ranges["body_battery"] = call(client, "get_body_battery", s, e) or ranges.get("body_battery")
    ranges["body_composition"] = call(client, "get_body_composition", s, e) or ranges.get("body_composition")
    ranges["daily_steps"] = call(client, "get_daily_steps", s, e) or ranges.get("daily_steps")

    save_cache(cache)
    return cache


# ------------------------------------------------------------ Aufbereitung

def num(*candidates):
    """Erster nicht-leerer Zahlenwert - Garmin liefert je nach Endpunkt
    unterschiedliche Feldnamen fuer dieselbe Groesse."""
    for v in candidates:
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return v
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
        sleep_dto = dig(raw, "sleep", "dailySleepDTO") or {}
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

    # Body Battery aus der Tageszusammenfassung (get_user_summary).
    for ds, raw in (cache.get("days") or {}).items():
        summ = raw.get("summary") or {}
        if not isinstance(summ, dict):
            continue
        hi = num(summ.get("bodyBatteryHighestValue"), summ.get("bodyBatteryMostRecentValue"))
        lo = num(summ.get("bodyBatteryLowestValue"))
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

    # Gewicht/Koerperzusammensetzung
    bc = dig(cache, "ranges", "body_composition") or {}
    for item in (bc.get("dateWeightList") or []):
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


def write_wellness_js(daily, sync_info):
    os.makedirs(DATA_DIR, exist_ok=True)
    payload = {"generated_at": datetime.now().astimezone().isoformat(),
               "sync": sync_info, "daily": daily}
    body = json.dumps(payload, ensure_ascii=False)
    with open(WELLNESS_JS, "w", encoding="utf-8") as f:
        f.write(
            "// Automatisch erzeugt von tools/garmin_sync.py - nicht von Hand bearbeiten.\n"
            "// Enthaelt persoenliche Gesundheitsdaten und ist deshalb ueber .gitignore\n"
            "// vom Repository ausgeschlossen. Als .js (nicht .json), weil der Browser\n"
            "// beim Doppelklick-Aufruf (file://) kein fetch() auf lokale Dateien\n"
            "// erlaubt - ein <script src> laedt aber normal (wie workouts-data.js).\n"
            f"const GARMIN_WELLNESS = {body};\n"
        )
    log(f"\ndata/wellness-data.js geschrieben ({len(daily)} Tage mit Werten).")


# --------------------------------------------------------------------- CLI

def main():
    ap = argparse.ArgumentParser(description="Synchronisiert Garmin Connect mit dem Dashboard")
    ap.add_argument("--days", type=int, default=DEFAULT_DAYS,
                    help=f"Zeitraum in Tagen rueckwaerts (Standard: {DEFAULT_DAYS})")
    ap.add_argument("--since", help="Startdatum YYYY-MM-DD (hat Vorrang vor --days)")
    ap.add_argument("--activities-only", action="store_true", help="nur .fit-Dateien laden")
    ap.add_argument("--wellness-only", action="store_true", help="nur Gesundheitsdaten laden")
    args = ap.parse_args()

    end = date.today()
    if args.since:
        try:
            start = datetime.strptime(args.since, "%Y-%m-%d").date()
        except ValueError:
            raise SystemExit("--since braucht das Format YYYY-MM-DD")
    else:
        start = end - timedelta(days=args.days)

    client = connect()

    act_stats, daily = None, {}
    if not args.wellness_only:
        act_stats = sync_activities(client, start, end)

    if not args.activities_only:
        cache = sync_wellness(client, start, end)
        daily = normalize(cache)
    else:
        daily = normalize(load_cache())

    sync_info = {
        "at": datetime.now().astimezone().isoformat(),
        "von": start.isoformat(), "bis": end.isoformat(),
        "aktivitaeten": act_stats,
    }
    write_wellness_js(daily, sync_info)

    log("\nFertig.")
    if act_stats:
        log(f"  Aktivitaeten: {act_stats['neu']} neu, {act_stats['vorhanden']} bereits vorhanden, "
            f"{act_stats['fehler']} Fehler (von {act_stats['gesamt']}).")
    if not args.activities_only:
        log(f"  Gesundheitsdaten: {len(daily)} Tage.")
    if act_stats and act_stats["neu"]:
        log("\nNaechster Schritt (macht sync-garmin.command automatisch):")
        log("  python3 parse_fit.py && python3 build_dashboard.py")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("\nAbgebrochen.")
        sys.exit(130)
