#!/usr/bin/env python3
"""
Erzeugt eine EINZELNE, in sich geschlossene dashboard-demo.html.

Zweck: eine oeffentlich verlinkbare Demo fuer die Landingpage. Alles - CSS,
JavaScript und die Daten - steckt in einer Datei, damit sie sich ohne Server
und ohne weitere Dateien oeffnen laesst (auch per Doppelklick oder aus der
Dateien-App auf dem iPhone).

WICHTIG: Die Daten sind vollstaendig ERFUNDEN. Es werden niemals echte
Trainings- oder Gesundheitsdaten eingebettet - die Demo ist oeffentlich.
Der Zufallsgenerator laeuft mit festem Startwert, damit wiederholte Laeufe
dieselbe Demo erzeugen.

Aufruf:  python3 build-demo.py [-o ZIELDATEI]
"""
import argparse
import json
import math
import os
import random
import re
from datetime import date, datetime, timedelta

BASE = os.path.dirname(os.path.abspath(__file__))
SEED = 20260912
TAGE = 400          # so viel Historie, dass CTL/ATL/Form und Trends greifen


# --------------------------------------------------------- Daten erfinden

def stream(n, hr_basis, watt=None, mit_hoehe=True, tempo=3.2):
    """Sekundendaten (bereits auf ~200 Punkte verdichtet, wie der Parser sie liefert)."""
    t, hr, speed, dist, alt, power, cad = [], [], [], [], [], [], []
    grade, vo, gct, vr, sl = [], [], [], [], []
    d = 0.0
    for i in range(n):
        f = i / max(1, n - 1)
        # Puls: Einlaufen, Hauptteil mit Wellen, leichter Drift nach oben
        h = hr_basis + 18 * math.sin(f * math.pi) + 6 * math.sin(i / 5.0) + 8 * f
        v = tempo * (1 + 0.10 * math.sin(i / 7.0))
        d += v * (18)
        t.append(i * 18)
        hr.append(int(round(h)))
        speed.append(round(v, 2))
        dist.append(round(d, 1))
        alt.append(round(120 + 45 * math.sin(i / 11.0), 1) if mit_hoehe else None)
        power.append(int(round(watt + 45 * math.sin(i / 4.0))) if watt else None)
        cad.append(int(round(86 + 5 * math.sin(i / 6.0))))
        grade.append(round(2.5 * math.sin(i / 11.0), 1) if mit_hoehe else 0.0)
        vo.append(None); gct.append(None); vr.append(None); sl.append(None)
    return {"t": t, "hr": hr, "speed": speed, "dist": dist, "alt": alt, "power": power,
            "cad": cad, "grade": grade, "vo": vo, "gct": gct, "vr": vr, "sl": sl}


def pace_str(sek_pro_km):
    m, s = divmod(int(round(sek_pro_km)), 60)
    return f"{m}:{s:02d}"


def baue_workouts(rng):
    """Ein Trainingsjahr mit wachsender Form, Ruhewochen und Variation."""
    heute = date.today()
    start = heute - timedelta(days=TAGE)
    out = []
    # Wochenplan: Wochentag -> Sportart (0=Mo). Ein Ruhetag, ein langer Tag.
    plan = {0: "Schwimmen", 1: "Laufen", 2: "Rad", 3: "Schwimmen",
            4: "Laufen", 5: "Rad", 6: None}

    for i in range(TAGE + 1):
        tag = start + timedelta(days=i)
        sport = plan.get(tag.weekday())
        if not sport:
            continue
        woche = i // 7
        if woche % 4 == 3 and rng.random() < 0.6:
            continue                      # Ruhewoche: weniger Einheiten
        if rng.random() < 0.12:
            continue                      # mal ausgefallen (Krankheit/Reise)

        form = min(1.0, i / TAGE)         # 0 -> 1 ueber das Jahr
        lang = tag.weekday() == 5         # Samstag ist der lange Tag
        stunde = 18 if not lang else 9
        beginn = datetime(tag.year, tag.month, tag.day, stunde,
                          rng.choice([0, 5, 12, 17, 23, 34, 45]), rng.randint(0, 59))
        dateiname = beginn.strftime("%Y-%m-%d-%H-%M-%S") + ".fit"

        if sport == "Laufen":
            dauer = (85 if lang else rng.choice([38, 45, 52, 60])) * (0.9 + 0.2 * form)
            sek_km = 345 - 30 * form + rng.uniform(-12, 12)
            km = (dauer * 60) / sek_km
            hr = int(round(146 + rng.uniform(-6, 8) - 4 * form))
            w = dict(sport="Laufen", sport_raw="running", sub_sport="Straße",
                     distance_km=round(km, 2), pace_min_per_km=pace_str(sek_km),
                     pace_min_per_100m=None, speed_kmh=None, max_speed_kmh=None,
                     elevation_gain_m=int(km * rng.uniform(6, 14)),
                     avg_cadence=round(168 + rng.uniform(-4, 6), 1),
                     total_steps=int(km * 1000 / rng.uniform(1.05, 1.18)),
                     avg_power_w=None, max_power_w=None, normalized_power_w=None,
                     has_gps=True, stream=stream(200, hr, None, True, 1000 / sek_km))
        elif sport == "Rad":
            indoor = (tag.month in (11, 12, 1, 2)) or rng.random() < 0.35
            dauer = (150 if lang and not indoor else rng.choice([50, 60, 75, 90])) * (0.9 + 0.2 * form)
            watt = int(round(168 + 32 * form + rng.uniform(-14, 14)))
            tempo = (7.6 if indoor else 8.3 + 0.9 * form) + rng.uniform(-0.4, 0.4)
            km = tempo * dauer * 60 / 1000
            hr = int(round(138 + rng.uniform(-6, 8) - 3 * form))
            w = dict(sport="Rad", sport_raw="cycling",
                     sub_sport="Virtuell" if indoor else "Straße",
                     distance_km=round(km, 2), pace_min_per_km=None, pace_min_per_100m=None,
                     speed_kmh=round(tempo * 3.6, 1),
                     max_speed_kmh=round(tempo * 3.6 * rng.uniform(1.35, 1.7), 1),
                     elevation_gain_m=0 if indoor else int(km * rng.uniform(8, 16)),
                     avg_cadence=round(87 + rng.uniform(-5, 5), 1), total_steps=None,
                     avg_power_w=watt, max_power_w=watt + rng.randint(180, 320),
                     normalized_power_w=watt + rng.randint(8, 26),
                     has_gps=not indoor,
                     stream=stream(200, hr, watt, not indoor, tempo))
        else:
            dauer = rng.choice([35, 42, 50])
            sek_100 = 128 - 9 * form + rng.uniform(-5, 5)
            km = (dauer * 60) / sek_100 * 100 / 1000
            hr = int(round(132 + rng.uniform(-5, 7)))
            w = dict(sport="Schwimmen", sport_raw="swimming", sub_sport="Becken",
                     distance_km=round(km, 2), pace_min_per_km=None,
                     pace_min_per_100m=pace_str(sek_100), speed_kmh=None, max_speed_kmh=None,
                     elevation_gain_m=None, avg_cadence=None, total_steps=None,
                     avg_power_w=None, max_power_w=None, normalized_power_w=None,
                     has_gps=False, stream=stream(200, hr, None, False, 100 / sek_100))

        dauer = round(dauer, 1)
        last = round(dauer * (hr - 95) / 42.0, 1)     # grobe, plausible Trainingsbelastung
        w.update(file=dateiname, date=beginn.isoformat(),
                 duration_min=dauer, duration_s=round(dauer * 60, 1),
                 avg_hr=hr, max_hr=hr + rng.randint(14, 30), min_hr=rng.randint(58, 76),
                 elevation_loss_m=w.get("elevation_gain_m"),
                 calories=int(dauer * rng.uniform(9.5, 13.5)),
                 training_load=last, max_cadence=(round(w["avg_cadence"] + 12, 1)
                                                  if w.get("avg_cadence") else None),
                 avg_grade_pct=None, avg_vertical_oscillation_mm=None,
                 avg_stance_time_ms=None, avg_stance_time_pct=None,
                 avg_vertical_ratio_pct=None, avg_step_length_mm=None,
                 avg_swolf=None, best_swolf=None, num_active_lengths=None,
                 avg_stroke_rate=None, lengths=None, is_indoor=None,
                 rpe_estimated=None, avg_mets=None, dev_raw=None, is_summary=False)
        out.append(w)
    return out


def baue_wellness(rng, workouts):
    """Erholungswerte mit eigener Basislinie, Wochenrhythmus und Luecken."""
    heute = date.today()
    daily = {}
    for i in range(TAGE + 1):
        tag = heute - timedelta(days=i)
        if rng.random() < 0.07:
            continue                                   # Uhr nicht getragen
        f = 1 - i / TAGE
        schlaf = int(round(430 + 45 * math.sin(i / 6.0) + rng.uniform(-35, 35)))
        hrv = round(58 + 10 * f + 7 * math.sin(i / 9.0) + rng.uniform(-4, 4), 0)
        rhr = int(round(52 - 4 * f + 2 * math.sin(i / 7.0) + rng.uniform(-2, 2)))
        eintrag = {
            "sleep_min": schlaf,
            "sleep_deep_min": int(schlaf * rng.uniform(0.16, 0.24)),
            "sleep_rem_min": int(schlaf * rng.uniform(0.18, 0.26)),
            "sleep_score": int(round(72 + 12 * (schlaf - 430) / 90 + rng.uniform(-5, 5))),
            "hrv_ms": hrv,
            "hrv_status": "BALANCED" if hrv > 56 else "UNBALANCED",
            "hrv_baseline_low": 54.0, "hrv_baseline_high": 78.0,
            "resting_hr": rhr,
            "body_battery_high": int(round(78 + 12 * math.sin(i / 5.0) + rng.uniform(-6, 6))),
            "body_battery_low": int(round(22 + 8 * math.sin(i / 5.0) + rng.uniform(-5, 5))),
            "steps": int(round(9200 + 3500 * math.sin(i / 3.0) + rng.uniform(-1500, 1500))),
            "vo2max": round(48.5 + 4.5 * f, 1),
            "vo2max_cycling": round(46.0 + 4.0 * f, 1),
            "training_status": rng.choice(["Produktiv", "Erhaltend", "Erholung"]),
        }
        if i % 4 == 0:
            eintrag["weight_kg"] = round(71.8 - 1.6 * f + rng.uniform(-0.3, 0.3), 1)
        daily[tag.isoformat()] = eintrag
    return {"generated_at": datetime.now().astimezone().isoformat(),
            "sync": {"at": datetime.now().astimezone().isoformat(),
                     "von": (heute - timedelta(days=TAGE)).isoformat(),
                     "bis": heute.isoformat(),
                     "aktivitaeten": {"neu": 0, "vorhanden": len(workouts),
                                      "fehler": 0, "gesamt": len(workouts)}},
            "daily": daily}


# ------------------------------------------------------ Einzeldatei bauen

DEMO_BANNER = """
<div id="demo-banner" style="position:sticky;top:0;z-index:9999;padding:10px 16px;
  background:linear-gradient(90deg,#2563eb,#7c3aed);color:#fff;font:600 14px/1.4
  -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center;
  box-shadow:0 2px 12px rgba(0,0,0,.25)">
  Das hier ist eine <strong>Demo mit erfundenen Beispieldaten</strong> &mdash; zum Ausprobieren, ohne etwas zu installieren.
  <br>
  <a href="https://github.com/nico-lehr/TriathlonTrainingsDashboard#einrichtung--schritt-f%C3%BCr-schritt"
     style="color:#fff;text-decoration:underline;font-weight:800">Gefällt dir? So installierst du es kostenlos &rarr;</a>
  &nbsp;·&nbsp;
  <a href="index.html" style="color:#fff;text-decoration:underline;font-weight:500">zurück zur Startseite</a>
</div>
"""

# In der Demo nicht sinnvoll: Import/Sync brauchen lokale Dateien bzw. Python.
DEMO_CSS = """
<style>
  #update-menu-wrap, #reset-btn, #menu-item-garmin, #menu-item-folder,
  #menu-item-dnd, #dnd-overlay, #garmin-settings-card, #app-update-card, #app-update-banner { display: none !important; }
</style>
"""


# Die echte App holt alles vom Server (js/data/api-client.js). Die Demo laeuft
# ohne Server per Doppelklick: kein Login, Daten aus den eingebetteten
# Demodaten, Aenderungen bleiben nur bis zum Neuladen erhalten.
DEMO_API = """
function requireLogin() { return true; }
async function loadUserStore() { userStore = {}; }
function storeSet(key, value) { userStore[key] = value; }
let demoEquipmentId = 0;
async function apiCall(endpoint, method, body) {
  if (endpoint.startsWith("workouts/full")) return { data: EMBEDDED_DATA.workouts };
  // Equipment: nur die Ids vergeben, gemerkt wird nichts (Demo, bis zum Neuladen)
  if (endpoint === "equipment" && method === "POST") return { data: { ...body, id: ++demoEquipmentId } };
  if (endpoint.startsWith("equipment")) return { data: endpoint === "equipment" || endpoint === "equipment/assignments" ? [] : {} };
  if (endpoint === "wellness/daily") return { data: GARMIN_WELLNESS };
  if (endpoint === "auth/me") return { data: { username: "demo" } };
  throw new Error("In der Demo nicht verfügbar");
}
"""


def inline(html):
    """Ersetzt <link>/<script src> durch den tatsaechlichen Dateiinhalt."""
    def css_ersetzen(m):
        pfad = os.path.join(BASE, m.group(1))
        if not os.path.exists(pfad):
            return ""
        with open(pfad, encoding="utf-8") as f:
            return "<style>\n" + f.read() + "\n</style>"

    def js_ersetzen(m):
        rel = m.group(1)
        # Die generierten Datendateien werden durch die Demodaten ersetzt
        if rel.startswith("data/"):
            return ""
        pfad = os.path.join(BASE, rel)
        if not os.path.exists(pfad):
            return ""
        with open(pfad, encoding="utf-8") as f:
            inhalt = f.read()
        if rel == "js/data/api-client.js":
            inhalt += DEMO_API
        return "<script>\n" + inhalt + "\n</script>"

    html = re.sub(r'<link[^>]*href="(css/[^"]+)"[^>]*>', css_ersetzen, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js_ersetzen, html)
    return html


def main():
    ap = argparse.ArgumentParser(description="Baut eine Einzeldatei-Demo mit erfundenen Daten")
    ap.add_argument("-o", "--out", default=os.path.join(BASE, "dashboard-demo.html"))
    args = ap.parse_args()

    rng = random.Random(SEED)
    workouts = baue_workouts(rng)
    wellness = baue_wellness(rng, workouts)

    with open(os.path.join(BASE, "index.html"), encoding="utf-8") as f:
        html = f.read()

    daten = (
        "<script>\n"
        "// ERFUNDENE Demodaten - erzeugt von build-demo.py. Keine echten Personendaten.\n"
        f"const EMBEDDED_DATA = {json.dumps({'generated_at': datetime.now().astimezone().isoformat(), 'source_folder': 'Demo', 'count': len(workouts), 'skipped': [], 'workouts': workouts}, ensure_ascii=False)};\n"
        f"const GARMIN_WELLNESS = {json.dumps(wellness, ensure_ascii=False)};\n"
        "</script>\n"
    )

    html = inline(html)
    html = html.replace("</head>", DEMO_CSS + daten + "</head>")
    html = re.sub(r"(<body[^>]*>)", r"\1" + DEMO_BANNER, html, count=1)
    html = html.replace("<title>", "<title>Demo · ", 1)

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)

    kb = os.path.getsize(args.out) / 1024
    print(f"{args.out} geschrieben ({kb:.0f} KB)")
    print(f"  {len(workouts)} erfundene Einheiten, {len(wellness['daily'])} Tage Gesundheitsdaten")


if __name__ == "__main__":
    main()
