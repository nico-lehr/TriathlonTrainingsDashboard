"""Garmin-Datencheck (tools/garmin_datacheck.py): jede Quelle einmal abfragen,
Ergebnis je Quelle geliefert / leer / gesperrt / Fehler, Abbruch bei Rate-Limit.
Garmin wird nie angesprochen (Test-Client).

Die .fit-Testdatei baut tests/js/fit-builder.js (Node); ohne Node oder
fitdecode wird der Datei-Teil uebersprungen.

Aufruf im Projektordner:  python -m unittest backend.test_garmin_datacheck -v
"""
import importlib.util
import io
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from datetime import date

from tools import garmin_datacheck
from tools import garmin_personal_api as api

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HAVE_FIT = shutil.which("node") is not None and importlib.util.find_spec("fitdecode") is not None
TODAY = date(2026, 11, 25)


def sample_zip():
    with tempfile.TemporaryDirectory() as tmp:
        target = os.path.join(tmp, "lauf.fit")
        script = ("const fs=require('fs');const {sampleRunFit}=require(process.argv[1]);"
                  "fs.writeFileSync(process.argv[2], sampleRunFit());")
        subprocess.run(["node", "-e", script, os.path.join(ROOT, "tests", "js", "fit-builder.js"), target], check=True)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            with open(target, "rb") as f:
                z.writestr("1_ACTIVITY.fit", f.read())
        return buf.getvalue()


class FakeClient:
    """Wie PersonalApiClient: Methoden + _get(path, params, missing_ok)."""

    def __init__(self, blob=b"kein zip", paths=None, fail=None):
        self.blob, self.paths, self.fail, self.calls = blob, paths or {}, fail or {}, []

    def _maybe_fail(self, name):
        self.calls.append(name)
        if name in self.fail:
            raise self.fail[name]

    def get_activities_by_date(self, s, e):
        self._maybe_fail("activities")
        return [{"activityId": 1, "startTimeLocal": "2026-11-20 07:00:00"},
                {"activityId": 2, "startTimeLocal": "2026-11-24 18:00:00"}]

    def download_original(self, aid):
        self._maybe_fail("download")
        self.downloaded = aid
        return self.blob

    def get_sleep_data(self, d):
        self._maybe_fail("sleep")
        return {"dailySleepDTO": {"sleepTimeSeconds": 27000}, "remSleepData": True}

    def get_hrv_data(self, d):
        self._maybe_fail("hrv")
        return None  # 404 -> keine Daten

    def get_rhr_day(self, d):
        return {"restingHeartRate": 48}

    def get_training_readiness(self, d):
        return [{"score": 71}]

    def get_daily_summaries(self, s, e):
        return {"data": [{"calendarDate": s}, {"calendarDate": e}]}

    def get_body_battery(self, s, e):
        return []

    def get_daily_steps(self, s, e):
        return [{"calendarDate": s, "totalSteps": 9000}]

    def get_body_composition(self, s, e):
        return {"dateWeightList": []}

    def get_lifestyle_log(self, d):
        raise api.GarminApiError("Garmin antwortet mit Fehler 403 (/lifestylelogging-service/dailyLog/x).")

    # get_menstrual_day fehlt absichtlich (Schnittstelle bietet es nicht)

    def _get(self, path, params=None, missing_ok=False):
        self._maybe_fail(path)
        for prefix, value in self.paths.items():
            if path.startswith(prefix):
                if isinstance(value, Exception):
                    raise value
                return value
        return None


def by_key(result):
    return {it["key"]: it for it in result["items"]}


class DatacheckTest(unittest.TestCase):
    def test_status_je_quelle(self):
        client = FakeClient(paths={
            "/metrics-service/metrics/racepredictions": {"time5K": 1260, "time10K": 2640},
            "/metrics-service/metrics/trainingstatus": api.GarminApiError("Garmin antwortet mit Fehler 403 (/x)."),
            "/biometric-service/heartRateZones": api.GarminApiError("Garmin antwortet mit Fehler 500 (/y)."),
        })
        r = garmin_datacheck.run_check(client, TODAY, pause_s=0)
        k = by_key(r)
        self.assertEqual(k["sleep"]["status"], "ok")
        self.assertEqual(k["hrv"]["status"], "empty")
        self.assertEqual(k["body_battery"]["status"], "empty")      # leere Liste
        self.assertEqual(k["summaries"]["status"], "ok")
        self.assertIn("2 Werte", k["summaries"]["detail"])
        self.assertEqual(k["lifestyle"]["status"], "blocked")       # 403
        self.assertEqual(k["cycle"]["status"], "blocked")           # Methode fehlt
        self.assertEqual(k["training_status"]["status"], "blocked")
        self.assertFalse(k["training_status"]["used"])               # noch nicht im Abruf
        self.assertEqual(k["zones"]["status"], "error")              # 500: echter Fehler, Text dabei
        self.assertIn("500", k["zones"]["detail"])
        self.assertEqual(k["race"]["status"], "ok")
        self.assertEqual(k["fit"]["status"], "empty")                # Download ohne ZIP
        self.assertEqual(client.downloaded, 2)                       # das neueste Training
        self.assertIsNone(r["stopped"])
        self.assertEqual(sum(r["counts"].values()), len(r["items"]))
        # Jede Quelle genau einmal
        self.assertEqual(client.calls.count("sleep"), 1)

    def test_rate_limit_bricht_ab(self):
        client = FakeClient(fail={"sleep": api.GarminApiTooManyRequestsError("Garmin blockt gerade (zu viele Anfragen).")})
        r = garmin_datacheck.run_check(client, TODAY, pause_s=0)
        k = by_key(r)
        self.assertIn("zu viele", r["stopped"])
        self.assertEqual(k["sleep"]["status"], "skipped")
        self.assertEqual(k["race"]["status"], "skipped")
        self.assertNotIn("hrv", client.calls)  # danach nichts mehr abgefragt

    def test_schluessel_abgelehnt_schon_bei_den_trainings(self):
        client = FakeClient(fail={"activities": api.GarminApiAuthenticationError("Schlüssel abgelehnt.")})
        r = garmin_datacheck.run_check(client, TODAY, pause_s=0)
        self.assertEqual(r["stopped"], "Schlüssel abgelehnt.")
        self.assertTrue(all(it["status"] == "skipped" for it in r["items"]))

    @unittest.skipUnless(HAVE_FIT, "node oder fitdecode fehlt")
    def test_trainingsdatei_mit_rpe_temperatur_runden(self):
        r = garmin_datacheck.run_check(FakeClient(blob=sample_zip()), TODAY, pause_s=0)
        k = by_key(r)
        self.assertEqual(k["fit"]["status"], "ok")
        self.assertIn("24.11.2026", k["fit"]["detail"])
        self.assertEqual((k["rpe"]["status"], k["rpe"]["detail"]), ("ok", "7/10 eingetragen"))
        self.assertEqual(k["temp"]["status"], "ok")
        self.assertEqual((k["laps"]["status"], k["laps"]["detail"]), ("ok", "2 Runden"))


if __name__ == "__main__":
    unittest.main()
