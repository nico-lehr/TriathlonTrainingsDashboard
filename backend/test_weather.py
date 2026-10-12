"""Wetter ueber den Server: nur mit Login, Koordinaten geprueft und gerundet,
Zwischenspeicher, verstaendliche Fehler. Open-Meteo wird hier durch einen
kleinen Test-Server ersetzt - nie der echte Dienst.

Aufruf im Projektordner:  python -m unittest backend.test_weather -v
"""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from backend import auth, create_app, weather_routes
from backend.config import config

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"

FORECAST = {"daily": {
    "time": ["2026-10-12", "2026-10-13"],
    "weather_code": [3, 61],
    "temperature_2m_max": [16.4, 12.1],
    "temperature_2m_min": [7.9, 6.0],
    "precipitation_probability_max": [10, 80],
    "wind_speed_10m_max": [14.2],  # zweiter Tag fehlt absichtlich
}}
PLACES = {"results": [
    {"name": "Heidelberg", "latitude": 49.40768, "longitude": 8.69079, "admin1": "Baden-Württemberg", "country": "Deutschland"},
    {"name": "Heidelberg", "latitude": -37.75, "longitude": 145.06667, "country": "Australien"},
]}


class FakeOpenMeteo(BaseHTTPRequestHandler):
    requests = []
    status = 200

    def do_GET(self):
        url = urlparse(self.path)
        FakeOpenMeteo.requests.append((url.path, parse_qs(url.query)))
        data = PLACES if url.path == "/search" else FORECAST
        out = json.dumps(data).encode()
        self.send_response(FakeOpenMeteo.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


class WeatherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = HTTPServer(("127.0.0.1", 0), FakeOpenMeteo)
        threading.Thread(target=cls.fake.serve_forever, daemon=True).start()
        cls.app, session_factory = create_app()
        session = session_factory()
        auth.create_login(session, "wetter-test", "langes-passwort-1")
        session.close()
        client = cls.app.test_client()
        token = client.post("/api/v1/auth/login", json={"username": "wetter-test", "password": "langes-passwort-1"}).get_json()["data"]["token"]
        cls.headers = {"Authorization": f"Bearer {token}"}

    @classmethod
    def tearDownClass(cls):
        cls.fake.shutdown()
        cls.fake.server_close()

    def setUp(self):
        self.client = self.app.test_client()
        base = f"http://127.0.0.1:{self.fake.server_port}"
        config.OPEN_METEO_URL = base + "/forecast"
        config.OPEN_METEO_GEOCODING_URL = base + "/search"
        weather_routes._cache.clear()
        FakeOpenMeteo.requests.clear()
        FakeOpenMeteo.status = 200

    def get(self, url):
        return self.client.get(url, headers=self.headers)

    def test_nur_mit_login(self):
        self.assertEqual(self.client.get("/api/v1/weather?lat=49.4&lon=8.7").status_code, 401)
        self.assertEqual(self.client.get("/api/v1/weather/geocode?name=Heidelberg").status_code, 401)

    def test_vorhersage_je_tag(self):
        r = self.get("/api/v1/weather?lat=49.40768&lon=8.69079")
        self.assertEqual(r.status_code, 200)
        data = r.get_json()["data"]
        self.assertEqual((data["lat"], data["lon"]), (49.41, 8.69))
        self.assertEqual(data["days"][0], {"date": "2026-10-12", "code": 3, "temp_max": 16.4, "temp_min": 7.9,
                                           "precip_prob": 10, "wind_max": 14.2})
        self.assertIsNone(data["days"][1]["wind_max"])  # fehlt bei Open-Meteo -> None, nicht erfunden
        path, query = FakeOpenMeteo.requests[-1]
        self.assertEqual(path, "/forecast")
        self.assertEqual((query["latitude"], query["longitude"], query["forecast_days"]), (["49.41"], ["8.69"], ["7"]))

    def test_zwischenspeicher(self):
        self.get("/api/v1/weather?lat=49.40768&lon=8.69079")
        self.get("/api/v1/weather?lat=49.4099&lon=8.6901")  # rundet auf denselben Ort
        self.assertEqual(len(FakeOpenMeteo.requests), 1)
        self.get("/api/v1/weather?lat=48.1&lon=11.6")
        self.assertEqual(len(FakeOpenMeteo.requests), 2)

    def test_ungueltige_koordinaten_400(self):
        for query in ("", "lat=49&lon=", "lat=abc&lon=8", "lat=91&lon=8", "lat=49&lon=181", "lat=nan&lon=8", "lat=inf&lon=8"):
            r = self.get(f"/api/v1/weather?{query}")
            self.assertEqual(r.status_code, 400, query)
        self.assertEqual(FakeOpenMeteo.requests, [])

    def test_ortssuche(self):
        r = self.get("/api/v1/weather/geocode?name=Heidelberg")
        places = r.get_json()["data"]["places"]
        self.assertEqual(places[0], {"name": "Heidelberg", "region": "Baden-Württemberg, Deutschland", "lat": 49.41, "lon": 8.69})
        self.assertEqual(places[1]["region"], "Australien")
        self.assertEqual(FakeOpenMeteo.requests[-1][1]["name"], ["Heidelberg"])
        self.assertEqual(self.get("/api/v1/weather/geocode?name=%20").status_code, 400)
        self.assertEqual(self.get("/api/v1/weather/geocode?name=" + "x" * 101).status_code, 400)

    def test_open_meteo_aus_verstaendlicher_fehler(self):
        config.OPEN_METEO_URL = "http://127.0.0.1:9/forecast"  # dort laeuft nichts
        r = self.get("/api/v1/weather?lat=49.4&lon=8.7")
        self.assertEqual(r.status_code, 502)
        self.assertIn("nicht erreichbar", r.get_json()["error"])
        self.assertIn("ohne Wetter", r.get_json()["error"])

    def test_open_meteo_fehler_wird_nicht_gespeichert(self):
        FakeOpenMeteo.status = 500
        r = self.get("/api/v1/weather?lat=49.4&lon=8.7")
        self.assertEqual(r.status_code, 502)
        self.assertIn("Fehler 500", r.get_json()["error"])
        FakeOpenMeteo.status = 200
        self.assertEqual(self.get("/api/v1/weather?lat=49.4&lon=8.7").status_code, 200)


if __name__ == "__main__":
    unittest.main()
