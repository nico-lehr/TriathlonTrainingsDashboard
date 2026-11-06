"""Profilwerte aus Garmin (tools/garmin_profile.py): Einheiten umrechnen,
Unplausibles verwerfen, nichts raten. Garmin wird nie angesprochen.

Aufruf im Projektordner:  python -m unittest backend.test_garmin_profile -v
"""
import unittest
from unittest import mock

from tools import garmin_profile

PROFILE = {"userData": {"gender": "MALE", "weight": 74100.0, "height": 181.0, "birthDate": "1990-05-04",
                        "vo2MaxRunning": 54.0, "vo2MaxCycling": 51.0,
                        "lactateThresholdSpeed": 0.3401, "lactateThresholdHeartRate": 171}}
ZONES = [{"sport": "RUNNING", "maxHeartRateUsed": 195, "restingHeartRateUsed": 49},
         {"sport": "DEFAULT", "maxHeartRateUsed": 190, "restingHeartRateUsed": 48, "lactateThresholdHeartRateUsed": 170}]
WEIGHTS = {"dailyWeightSummaries": [
    {"summaryDate": "2026-10-01", "latestWeight": {"weight": 73500.0}},
    {"summaryDate": "2026-11-01", "latestWeight": {"weight": 72400.0}}]}


class ExtractTest(unittest.TestCase):
    def test_typische_antworten(self):
        v = garmin_profile.extract([PROFILE, None], ZONES, WEIGHTS)
        self.assertEqual(v["weightKg"], 72.4)            # juengste Waage-Messung schlaegt Profilgewicht
        self.assertEqual(v["heightCm"], 181)
        self.assertEqual((v["gender"], v["birthDate"]), ("m", "1990-05-04"))
        self.assertEqual((v["maxHr"], v["restingHr"], v["lthr"]), (190, 48, 170))  # DEFAULT-Zone zuerst
        self.assertEqual(v["runThresholdPace"], "4:54")   # 0,34 x 10 m/s
        self.assertEqual((v["vo2maxRun"], v["vo2maxBike"]), (54, 51))
        self.assertNotIn("ftpWatts", v)                   # nicht geliefert -> nicht geraten

    def test_ftp_wenn_vorhanden_und_tempo_in_metern_pro_sekunde(self):
        v = garmin_profile.extract([{"userData": {"functionalThresholdPower": 248, "lactateThresholdSpeed": 3.7}}], None, None)
        self.assertEqual(v["ftpWatts"], 248)
        self.assertEqual(v["runThresholdPace"], "4:30")

    def test_unplausibles_wird_verworfen(self):
        v = garmin_profile.extract([{"userData": {"weight": 5, "height": 20, "birthDate": "2025-01-01", "gender": "X",
                                                   "functionalThresholdPower": 3000, "lactateThresholdSpeed": 0.001}}],
                                   [{"maxHeartRateUsed": 400, "restingHeartRateUsed": 5}], {})
        self.assertEqual(v, {})

    def test_gewicht_aus_dem_profil_wenn_keine_messung(self):
        self.assertEqual(garmin_profile.extract([{"userData": {"weight": 70000}}], None, None)["weightKg"], 70.0)

    def test_fehlende_dienste_sind_kein_fehler(self):
        client = mock.Mock()
        client._get.return_value = None
        self.assertEqual(garmin_profile.fetch(client), {})
        for call in client._get.call_args_list:
            self.assertTrue(call.kwargs.get("missing_ok"))


if __name__ == "__main__":
    unittest.main()
