#!/usr/bin/env python3
"""
Vergleicht den hand-geschriebenen JS-.fit-Parser (im Browser via Playwright)
Feld für Feld gegen die Python/fitdecode-Referenz (parse_fit.py-Logik),
fuer den gesamten 2026er-Datensatz.
"""
import json
import os
import sys
from playwright.sync_api import sync_playwright

# Projekt-relative Pfade (frueher Sandbox-Pfade, die lokal nicht existierten).
# Ueberschreibbar per Argument: verify_parser.py [fit-ordner]
BASE = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "fit-files")
DASHBOARD = os.path.join(BASE, "index.html")
REF_JSON = os.path.join(BASE, "workouts.json")

if not os.path.exists(REF_JSON):
    raise SystemExit(f"{REF_JSON} fehlt - zuerst parse_fit.py laufen lassen.")

with open(REF_JSON, encoding="utf-8") as f:
    ref = {w["file"]: w for w in json.load(f)["workouts"]}

with sync_playwright() as p:
    # Ohne executable_path nutzt Playwright die lokal installierte Browser-
    # Version (frueher stand hier ein fester Sandbox-Pfad).
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto(f"file://{DASHBOARD}")

    # Isoliertes Input-Element bauen (nicht an die App-Logik gekoppelt, die
    # fileInput.value nach jedem change sofort zuruecksetzt).
    page.evaluate("""() => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.id = 'probe-input';
        inp.webkitdirectory = true; inp.directory = true; inp.multiple = true;
        inp.style.display = 'none';
        document.body.appendChild(inp);
    }""")
    page.set_input_files("#probe-input", DOCS_DIR)

    result = page.evaluate("""async () => {
        const inp = document.getElementById('probe-input');
        const files = Array.from(inp.files || []).filter(f => /\\.fit$/i.test(f.name));
        const parsedWorkouts = [];
        const out = {};
        for (const f of files) {
            try {
                const buf = await f.arrayBuffer();
                const parsed = parseFitArrayBuffer(buf);
                const w = buildWorkoutFromParsed(f.name, parsed);
                if (w) parsedWorkouts.push(w);
                out[f.name] = w;
            } catch (e) {
                out[f.name] = { error: String(e) };
            }
        }
        // Wie im echten "Aktualisieren"-Flow: Multisport-/Wechsel-Erkennung
        // laeuft erst NACH dem Einlesen aller Dateien ueber den ganzen Batch.
        postProcessWorkouts(parsedWorkouts);
        return out;
    }""")
    browser.close()

print(f"JS parsed {len(result)} files, Python reference has {len(ref)} files")

FIELDS = ["sport", "sport_raw", "sub_sport", "duration_min", "distance_km",
          "avg_hr", "max_hr", "min_hr", "pace_min_per_km", "pace_min_per_100m",
          "speed_kmh", "max_speed_kmh", "elevation_gain_m", "elevation_loss_m",
          "calories", "training_load",
          "avg_power_w", "max_power_w", "normalized_power_w", "avg_cadence",
          "max_cadence", "avg_grade_pct", "avg_vertical_oscillation_mm",
          "avg_stance_time_ms", "avg_stance_time_pct", "avg_vertical_ratio_pct",
          "avg_step_length_mm",
          # Fundament für zukünftige Garmin-Connect-/Strava-Daten (siehe
          # DATA_MODEL.md) - mit den aktuellen HealthFit-Dateien immer None
          # auf beiden Seiten (kein Mismatch), aber sobald mal eine echte
          # Becken-Schwimmdatei auftaucht, deckt dieser Vergleich sofort auf,
          # falls die (unverifizierten) length-Feldnummern im JS-Parser nicht
          # zur fitdecode-Referenz passen.
          "avg_swolf", "best_swolf", "num_active_lengths", "avg_stroke_rate",
          "dominant_stroke", "is_indoor", "has_gps"]

STREAM_FIELDS = ["hr", "speed", "dist", "alt", "power", "cad", "grade", "vo", "gct", "vr", "sl"]

mismatches = 0
errors = 0
missing = 0
stream_mismatches = 0

for fname, ref_w in ref.items():
    js_w = result.get(fname)
    if js_w is None:
        print(f"MISSING in JS output: {fname}")
        missing += 1
        continue
    if js_w.get("error"):
        print(f"JS ERROR on {fname}: {js_w['error']}")
        errors += 1
        continue
    for field in FIELDS:
        rv, jv = ref_w.get(field), js_w.get(field)
        # Toleranz fuer Rundungsdifferenzen bei floats
        if isinstance(rv, float) and isinstance(jv, (int, float)):
            if abs(rv - jv) > 0.05:
                print(f"MISMATCH {fname} field={field}: py={rv!r} js={jv!r}")
                mismatches += 1
        elif rv != jv:
            print(f"MISMATCH {fname} field={field}: py={rv!r} js={jv!r}")
            mismatches += 1
    # Stream-Laenge grob vergleichen (Bucket-Downsampling kann +-1 Punkt variieren)
    rs, js_s = ref_w.get("stream"), js_w.get("stream")
    if (rs is None) != (js_s is None):
        print(f"STREAM PRESENCE MISMATCH {fname}: py={rs is not None} js={js_s is not None}")
        stream_mismatches += 1
    elif rs is not None:
        if abs(len(rs["t"]) - len(js_s["t"])) > 2:
            print(f"STREAM LENGTH MISMATCH {fname}: py={len(rs['t'])} js={len(js_s['t'])}")
            stream_mismatches += 1
        else:
            # Grober Abdeckungs-Check je neuem Stream-Feld (exakter Punkt-fuer-
            # Punkt-Vergleich ist wegen leicht unterschiedlicher Bucket-Grenzen
            # nicht sinnvoll): Anzahl nicht-null-Werte sollte sich kaum unterscheiden.
            for sf in STREAM_FIELDS:
                rc = sum(1 for v in (rs.get(sf) or []) if v is not None)
                jc = sum(1 for v in (js_s.get(sf) or []) if v is not None)
                if abs(rc - jc) > max(2, 0.05 * max(rc, jc, 1)):
                    print(f"STREAM FIELD COVERAGE MISMATCH {fname} field={sf}: py_nonnull={rc} js_nonnull={jc}")
                    stream_mismatches += 1

print()
print(f"Done. {len(ref)} files compared.")
print(f"Missing: {missing}, Errors: {errors}, Field mismatches: {mismatches}, Stream mismatches: {stream_mismatches}")
sys.exit(1 if (missing or errors or mismatches or stream_mismatches) else 0)
