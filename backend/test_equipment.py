"""Equipment: Anlegen/Aendern/Loeschen, Zuordnung einzelner Trainings,
einmalige Uebernahme der alten Liste - und dass keine Person das Equipment
einer anderen sieht oder veraendert.

Aufruf im Projektordner:  python -m unittest backend.test_equipment -v
Laeuft gegen eine Datenbank im Arbeitsspeicher - training.db bleibt unberuehrt.
"""
import unittest

from backend import auth, create_app
from backend.config import config
from backend.models import Equipment, EquipmentWorkout

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"

PASSWORD = "richtig-langes-passwort"
SCHUH = {"name": "Adizero", "typ": "Laufschuhe", "sport": "Laufen", "start_km": 12.5, "max_km": 700,
         "details": {"activeFrom": "2026-01-05", "note": "Kaufdatum Januar"}}


class EquipmentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, cls.session_factory = create_app()
        session = cls.session_factory()
        for name in ("eq-a", "eq-b"):
            auth.create_login(session, name, PASSWORD)
        session.close()

    def setUp(self):
        auth._failed_logins.clear()
        self.client = self.app.test_client()
        self.a, self.b = self.headers("eq-a"), self.headers("eq-b")

    def tearDown(self):
        session = self.session_factory()
        session.query(EquipmentWorkout).delete()
        session.query(Equipment).delete()
        session.commit()
        session.close()

    def headers(self, username):
        token = self.client.post("/api/v1/auth/login", json={"username": username, "password": PASSWORD}).get_json()["data"]["token"]
        return {"Authorization": f"Bearer {token}"}

    def create(self, body, headers=None):
        r = self.client.post("/api/v1/equipment", json=body, headers=headers or self.a)
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()["data"]

    def items(self, headers=None):
        return self.client.get("/api/v1/equipment", headers=headers or self.a).get_json()["data"]

    def assignments(self, headers=None):
        return self.client.get("/api/v1/equipment/assignments", headers=headers or self.a).get_json()["data"]

    def test_ohne_login_401(self):
        for method, url in [("get", "/api/v1/equipment"), ("post", "/api/v1/equipment"), ("put", "/api/v1/equipment/1"),
                            ("delete", "/api/v1/equipment/1"), ("post", "/api/v1/equipment/import"),
                            ("get", "/api/v1/equipment/assignments"), ("post", "/api/v1/equipment/1/workouts"),
                            ("delete", "/api/v1/equipment/1/workouts")]:
            with self.subTest(url=url, method=method):
                self.assertEqual(getattr(self.client, method)(url, json={}).status_code, 401)

    def test_anlegen_lesen_aendern_loeschen(self):
        item = self.create(SCHUH)
        self.assertEqual({k: item[k] for k in ("name", "typ", "sport", "parent_id", "start_km", "max_km", "aktiv")},
                         {"name": "Adizero", "typ": "Laufschuhe", "sport": "Laufen", "parent_id": None,
                          "start_km": 12.5, "max_km": 700, "aktiv": True})
        # Zusatzfelder bleiben erhalten, fehlende werden aufgefuellt.
        self.assertEqual(item["details"]["note"], "Kaufdatum Januar")
        self.assertEqual(item["details"]["activeFrom"], "2026-01-05")
        self.assertIsNone(item["details"]["activeTo"])
        self.assertEqual(self.items(), [item])

        # Nur das mitgeschickte Feld aendert sich.
        r = self.client.put(f"/api/v1/equipment/{item['id']}", json={"aktiv": False}, headers=self.a)
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.get_json()["data"]["aktiv"])
        self.assertEqual(r.get_json()["data"]["name"], "Adizero")
        self.assertEqual(r.get_json()["data"]["details"]["note"], "Kaufdatum Januar")
        r = self.client.put(f"/api/v1/equipment/{item['id']}", headers=self.a,
                            json={"max_km": None, "details": {"activeFrom": "2026-01-05", "activeTo": "2026-09-30", "manualKm": 3}})
        self.assertIsNone(r.get_json()["data"]["max_km"])
        self.assertEqual(r.get_json()["data"]["details"]["activeTo"], "2026-09-30")
        self.assertEqual(r.get_json()["data"]["details"]["manualKm"], 3)

        self.assertEqual(self.client.delete(f"/api/v1/equipment/{item['id']}", headers=self.a).status_code, 200)
        self.assertEqual(self.items(), [])
        self.assertEqual(self.client.delete(f"/api/v1/equipment/{item['id']}", headers=self.a).status_code, 404)
        self.assertEqual(self.client.put(f"/api/v1/equipment/{item['id']}", json={"aktiv": True}, headers=self.a).status_code, 404)

    def test_standardwerte_und_pruefung(self):
        item = self.create({"name": "  Neoprenanzug "})
        self.assertEqual((item["name"], item["typ"], item["start_km"], item["max_km"], item["aktiv"]), ("Neoprenanzug", "Sonstiges", 0, None, True))
        bad = [{}, {"name": "  "}, {"name": "x" * 256}, {"name": "x", "sport": "Yoga"}, {"name": "x", "start_km": -1},
               {"name": "x", "max_km": "700"}, {"name": "x", "aktiv": "ja"}, {"name": "x", "typ": 5},
               {"name": "x", "details": {"activeFrom": "gestern"}}, {"name": "x", "details": []},
               {"name": "x", "details": {"note": "n" * 301}}, {"name": "x", "parent_id": 99999}, {"name": "x", "parent_id": "1"}]
        for body in bad:
            with self.subTest(body=body):
                self.assertEqual(self.client.post("/api/v1/equipment", json=body, headers=self.a).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/equipment", data="kein json", headers=self.a).status_code, 400)
        self.assertEqual(len(self.items()), 1)

    def test_verschleissteil_gehoert_zu_hauptequipment(self):
        rad = self.create({"name": "Rennrad", "typ": "Rad", "sport": "Rad"})
        kette = self.create({"name": "Kette", "typ": "Verschleißteil", "parent_id": rad["id"], "max_km": 3000})
        self.assertEqual(kette["parent_id"], rad["id"])
        # Teil am Teil und ein Teil als eigener Vater sind nicht erlaubt.
        self.assertEqual(self.client.post("/api/v1/equipment", json={"name": "Glied", "parent_id": kette["id"]}, headers=self.a).status_code, 400)
        self.assertEqual(self.client.put(f"/api/v1/equipment/{rad['id']}", json={"parent_id": rad["id"]}, headers=self.a).status_code, 400)

        # Loeschen des Rads nimmt Teile und Zuordnungen mit.
        self.client.post(f"/api/v1/equipment/{rad['id']}/workouts", json={"workout_file": "fahrt.fit"}, headers=self.a)
        self.assertEqual(self.client.delete(f"/api/v1/equipment/{rad['id']}", headers=self.a).status_code, 200)
        self.assertEqual(self.items(), [])
        self.assertEqual(self.assignments(), [])

    def test_trainings_zuordnen(self):
        alt, neu = self.create(SCHUH), self.create({**SCHUH, "name": "Neue"})
        kette = self.create({"name": "Kette", "parent_id": alt["id"]})
        frei = self.create({"name": "Brille"})

        r = self.client.post(f"/api/v1/equipment/{alt['id']}/workouts", json={"workout_file": "lauf-1.fit"}, headers=self.a)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.assignments(), [{"equipment_id": alt["id"], "workout_file": "lauf-1.fit"}])
        # Dasselbe Training noch einmal bei einem anderen Item: wird umgehaengt, nicht doppelt.
        self.client.post(f"/api/v1/equipment/{neu['id']}/workouts", json={"workout_file": "lauf-1.fit"}, headers=self.a)
        self.assertEqual(self.assignments(), [{"equipment_id": neu["id"], "workout_file": "lauf-1.fit"}])

        for target, body in [(kette["id"], {"workout_file": "x.fit"}), (frei["id"], {"workout_file": "x.fit"}),
                             (neu["id"], {}), (neu["id"], {"workout_file": ""}), (neu["id"], {"workout_file": "n" * 256})]:
            with self.subTest(target=target, body=body):
                self.assertEqual(self.client.post(f"/api/v1/equipment/{target}/workouts", json=body, headers=self.a).status_code, 400)
        self.assertEqual(self.client.post("/api/v1/equipment/99999/workouts", json={"workout_file": "x"}, headers=self.a).status_code, 404)
        riesig = "9" * 30  # kein Absturz, nur "nicht gefunden"
        for method, url in [("put", f"/api/v1/equipment/{riesig}"), ("delete", f"/api/v1/equipment/{riesig}"),
                            ("post", f"/api/v1/equipment/{riesig}/workouts"), ("delete", f"/api/v1/equipment/{riesig}/workouts?workout_file=x")]:
            with self.subTest(url=url, method=method):
                self.assertEqual(getattr(self.client, method)(url, json={"workout_file": "x", "aktiv": True}, headers=self.a).status_code, 404)
        self.assertEqual(self.client.post("/api/v1/equipment", json={"name": "x", "parent_id": int(riesig)}, headers=self.a).status_code, 400)

        # Aufheben: nur beim richtigen Item, danach zaehlt das Training wieder automatisch.
        self.assertEqual(self.client.delete(f"/api/v1/equipment/{alt['id']}/workouts?workout_file=lauf-1.fit", headers=self.a).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/v1/equipment/{neu['id']}/workouts?workout_file=lauf-1.fit", headers=self.a).status_code, 200)
        self.assertEqual(self.assignments(), [])

    def test_person_b_sieht_und_aendert_nichts_von_a(self):
        schuh = self.create(SCHUH)
        rad = self.create({"name": "Rennrad", "typ": "Rad", "sport": "Rad"})
        self.client.post(f"/api/v1/equipment/{schuh['id']}/workouts", json={"workout_file": "lauf-1.fit"}, headers=self.a)

        self.assertEqual(self.items(self.b), [])
        self.assertEqual(self.assignments(self.b), [])
        url = f"/api/v1/equipment/{schuh['id']}"
        self.assertEqual(self.client.put(url, json={"name": "Gehackt", "aktiv": False}, headers=self.b).status_code, 404)
        self.assertEqual(self.client.delete(url, headers=self.b).status_code, 404)
        self.assertEqual(self.client.post(f"{url}/workouts", json={"workout_file": "lauf-2.fit"}, headers=self.b).status_code, 404)
        self.assertEqual(self.client.delete(f"{url}/workouts?workout_file=lauf-1.fit", headers=self.b).status_code, 404)
        # B kann sein Equipment auch nicht an ein fremdes Rad haengen.
        self.assertEqual(self.client.post("/api/v1/equipment", json={"name": "Kette", "parent_id": rad["id"]}, headers=self.b).status_code, 400)
        own = self.create({"name": "Eigenes", "sport": "Rad"}, self.b)
        self.assertEqual(self.client.put(f"/api/v1/equipment/{own['id']}", json={"parent_id": rad["id"]}, headers=self.b).status_code, 400)

        # Alles von A ist unveraendert, B hat nur das Eigene.
        self.assertEqual([i["name"] for i in self.items()], ["Adizero", "Rennrad"])
        self.assertTrue(self.items()[0]["aktiv"])
        self.assertEqual(self.assignments(), [{"equipment_id": schuh["id"], "workout_file": "lauf-1.fit"}])
        self.assertEqual([i["name"] for i in self.items(self.b)], ["Eigenes"])
        # Dasselbe Training darf bei B eine eigene Zuordnung haben.
        self.client.post(f"/api/v1/equipment/{own['id']}/workouts", json={"workout_file": "lauf-1.fit"}, headers=self.b)
        self.assertEqual(self.assignments(self.b), [{"equipment_id": own["id"], "workout_file": "lauf-1.fit"}])
        self.assertEqual(self.assignments(), [{"equipment_id": schuh["id"], "workout_file": "lauf-1.fit"}])

    def test_uebernahme_der_alten_liste(self):
        alt = [
            {"ref": "u-rad", "parent_ref": None, **{k: SCHUH[k] for k in ("name", "typ", "sport", "start_km", "max_km", "details")}},
            {"ref": "u-kette", "parent_ref": "u-rad", "name": "Kette", "typ": "Verschleißteil", "max_km": 3000,
             "details": {"resetAt": "2026-03-01", "createdAt": "2026-02-01"}},
            {"ref": "u-brille", "parent_ref": None, "name": "Brille", "details": {"manualKm": 42.5}},
            {"ref": "u-waise", "parent_ref": "u-gibtsnicht", "name": "Waise"},
        ]
        r = self.client.post("/api/v1/equipment/import", json={"items": alt}, headers=self.a)
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.get_json()["meta"]["imported"], r.get_json()["meta"]["skipped"]), (True, 1))
        rad, brille, kette = r.get_json()["data"]  # erst die Hauptausruestung, dann die Teile
        self.assertEqual((rad["name"], rad["details"]["note"], rad["details"]["activeFrom"]), ("Adizero", "Kaufdatum Januar", "2026-01-05"))
        self.assertEqual((kette["parent_id"], kette["details"]["resetAt"]), (rad["id"], "2026-03-01"))
        self.assertEqual((brille["typ"], brille["details"]["manualKm"]), ("Sonstiges", 42.5))
        self.assertEqual(self.items(), [rad, brille, kette])

        # Zweiter Aufruf (z.B. zweiter Browser-Tab): nichts wird doppelt angelegt.
        r = self.client.post("/api/v1/equipment/import", json={"items": alt}, headers=self.a)
        self.assertFalse(r.get_json()["meta"]["imported"])
        self.assertEqual(len(self.items()), 3)
        # Eine andere Person ohne Equipment wird davon nicht beruehrt und kann selbst uebernehmen.
        self.assertEqual(self.items(self.b), [])
        r = self.client.post("/api/v1/equipment/import", json={"items": alt[2:3]}, headers=self.b)
        self.assertTrue(r.get_json()["meta"]["imported"])
        self.assertEqual([i["name"] for i in self.items(self.b)], ["Brille"])
        self.assertEqual(len(self.items()), 3)

    def test_uebernahme_ungueltig_legt_nichts_an(self):
        gut = {"ref": "a", "name": "Gut"}
        for items in ["keine Liste", [gut, {"ref": "b", "name": ""}], [gut, {"name": "Ohne ref"}], [gut, {**gut}], [gut, 5],
                      [{"ref": "c", "name": "x", "parent_ref": 7}], [{"ref": str(i), "name": "x"} for i in range(501)]]:
            with self.subTest(items=str(items)[:60]):
                self.assertEqual(self.client.post("/api/v1/equipment/import", json={"items": items}, headers=self.a).status_code, 400)
        self.assertEqual(self.items(), [])


if __name__ == "__main__":
    unittest.main()
