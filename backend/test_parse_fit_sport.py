"""Sportart-Erkennung in parse_fit.py: neuere Garmin-Sportarten, die fitdecode
noch nicht kennt, kommen als Zahl an (z.B. 86 = Mobility)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import parse_fit  # noqa: E402


class SportNameTest(unittest.TestCase):
    def test_mobility_als_zahl(self):
        self.assertEqual(parse_fit.sport_name(86), "mobility")
        self.assertEqual(parse_fit.sport_name("86"), "mobility")
        self.assertEqual(parse_fit.get_sport_de(parse_fit.sport_name(86), "generic"), "Mobility")

    def test_unbekannte_zahl_wird_sonstiges(self):
        self.assertEqual(parse_fit.get_sport_de(parse_fit.sport_name(199), "generic"), "Sonstiges")

    def test_bekannte_namen_bleiben(self):
        self.assertEqual(parse_fit.sport_name("cycling"), "cycling")
        self.assertEqual(parse_fit.sport_name(None), "generic")


if __name__ == "__main__":
    unittest.main()
