"""Programm-Updates: Versionsvergleich, GitHub-Abfrage, Pruefen und Anwenden
des Update-Pakets, Schutz der Nutzerdaten, Betreiber-Rechte, Starter.
GitHub wird nie angesprochen (Attrappen), installiert wird in einen
Temp-Ordner - das echte Projekt bleibt unberuehrt.

Aufruf im Projektordner:  python -m unittest backend.test_updater -v
"""
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest import mock

from backend import auth, create_app, launcher, updater
from backend.config import config

config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
config.SECRET_KEY = "nur-fuer-tests"


def release_json(tag="v2.1.0", body="- Neu: Updates"):
    return json.dumps({"tag_name": tag, "name": f"Version {tag}", "body": body,
                       "html_url": "https://github.com/x/y/releases/tag/" + tag,
                       "published_at": "2026-10-22T10:00:00Z"}).encode()


def make_zip(files, top="nico-lehr-TriathlonTrainingsDashboard-abc123"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(f"{top}/{name}" if top else name, content)
    return buf.getvalue()


GOOD_FILES = {"VERSION": "2.1.0\n", "backend/app.py": "print('neu')\n", "index.html": "<html>neu</html>",
              "js/neu.js": "// neu", "backend/requirements.txt": "Flask==2.3.3\n"}


class TempInstallMixin:
    def setUp(self):
        self.base = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.base)
        (self.base / "backend").mkdir()
        (self.base / "VERSION").write_text("2.0.0\n")
        (self.base / "backend" / "app.py").write_text("print('alt')\n")
        (self.base / "index.html").write_text("<html>alt</html>")
        (self.base / ".env").write_text("SECRET_KEY=geheim\n")
        (self.base / "training.db").write_text("DATEN")
        patcher = mock.patch.object(updater, "BASE", self.base)
        patcher.start()
        self.addCleanup(patcher.stop)
        updater._state.update({"latest": None, "checked_at": None, "error": None,
                               "install": {"running": False, "step": None, "ok": None, "message": None}})


class VersionTest(TempInstallMixin, unittest.TestCase):
    def test_versionen_vergleichen(self):
        self.assertEqual(updater.parse_version("v2.10.1"), (2, 10, 1))
        self.assertEqual(updater.parse_version("2.1"), (2, 1, 0))
        self.assertIsNone(updater.parse_version("latest"))
        self.assertTrue(updater.is_newer("v2.10.0", "2.9.9"))
        self.assertFalse(updater.is_newer("v2.0.0", "2.0.0"))
        self.assertFalse(updater.is_newer("nightly", "2.0.0"))
        self.assertEqual(updater.current_version(), "2.0.0")

    def test_neueste_release_und_cache(self):
        with mock.patch.object(updater, "_get", return_value=release_json()) as get:
            st = updater.check()
            updater.check()  # innerhalb eines Tages: nicht erneut fragen
        self.assertEqual(get.call_count, 1)
        self.assertTrue(st["available"])
        self.assertEqual((st["latest"]["version"], st["latest"]["tag"]), ("2.1.0", "v2.1.0"))
        self.assertIn("/releases/latest", get.call_args[0][0])

    def test_keine_release_und_fehler(self):
        with mock.patch.object(updater, "_get", return_value=None):
            st = updater.check(force=True)
        self.assertFalse(st["available"])
        self.assertIsNone(st["latest"])
        with mock.patch.object(updater, "_get", return_value=release_json()):
            updater.check(force=True)
        with mock.patch.object(updater, "_get", side_effect=updater.UpdateError("GitHub ist nicht erreichbar")):
            st = updater.check(force=True)
        self.assertIn("nicht erreichbar", st["error"])
        self.assertTrue(st["available"])  # zuletzt bekannter Stand bleibt

    def test_github_fehler_verstaendlich(self):
        def fail(code):
            return mock.patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("u", code, "x", {}, None))
        with fail(404):
            self.assertIsNone(updater.fetch_latest_release())
        with fail(403), self.assertRaises(updater.UpdateError) as ctx:
            updater.fetch_latest_release()
        self.assertIn("zu viele Anfragen", str(ctx.exception))
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("weg")), self.assertRaises(updater.UpdateError):
            updater.fetch_latest_release()


class PaketTest(TempInstallMixin, unittest.TestCase):
    def test_unzulaessige_pakete_werden_abgelehnt(self):
        cases = {
            "Pfad nach draussen": make_zip({"../../boese.py": "x", **GOOD_FILES}, top=None),
            "zwei Ordner": make_zip({"a/VERSION": "1", "b/VERSION": "1"}, top=None),
            "Kerndatei fehlt": make_zip({"VERSION": "2.1.0"}),
            "kein ZIP": b"kein zip",
        }
        for label, blob in cases.items():
            with self.subTest(label), tempfile.TemporaryDirectory() as tmp, self.assertRaises(updater.UpdateError):
                updater.extract_release(blob, tmp)

    def test_nutzerdaten_sind_geschuetzt(self):
        blob = make_zip({**GOOD_FILES, ".env": "SECRET_KEY=ueberschrieben", "training.db": "LEER",
                         "training.db-wal": "x", "backups/x.db": "x", "data/wellness-data.js": "x",
                         "fit-files/a.fit": "x", "backend/__pycache__/x.pyc": "x"})
        with tempfile.TemporaryDirectory() as tmp:
            root = updater.extract_release(blob, tmp)
            files = {p.as_posix() for p in updater.program_files(root)}
        self.assertEqual(files, set(GOOD_FILES))


class InstallierenTest(TempInstallMixin, unittest.TestCase):
    def install(self, blob, pip_ok=True):
        updater._state["latest"] = {"version": "2.1.0", "tag": "v2.1.0", "name": "v2.1.0", "notes": "", "url": None,
                                    "published_at": None}
        pip = mock.Mock(side_effect=None if pip_ok else updater.UpdateError("Bibliotheken konnten nicht installiert werden"))
        with mock.patch.object(updater, "_get", return_value=blob), mock.patch.object(updater, "pip_install", pip), \
                mock.patch("backup.backup_db") as backup_db, mock.patch.object(updater, "schedule_restart", return_value=True) as restart, \
                mock.patch("threading.Thread") as thread:
            self.assertTrue(updater.start_install())
            self.assertFalse(updater.start_install())  # laeuft schon
            thread.call_args.kwargs["target"](*thread.call_args.kwargs["args"])
        return pip, backup_db, restart

    def test_zip_installation_ersetzt_programm_und_schont_daten(self):
        pip, backup_db, restart = self.install(make_zip({**GOOD_FILES, ".env": "SECRET_KEY=ueberschrieben"}))
        self.assertEqual((self.base / "VERSION").read_text().strip(), "2.1.0")
        self.assertEqual((self.base / "index.html").read_text(), "<html>neu</html>")
        self.assertTrue((self.base / "js" / "neu.js").is_file())
        self.assertEqual((self.base / ".env").read_text(), "SECRET_KEY=geheim\n")
        self.assertEqual((self.base / "training.db").read_text(), "DATEN")
        backup_db.assert_called_once()
        restart.assert_called_once()
        # Bibliotheken der NEUEN Version, aus dem entpackten Paket
        self.assertTrue(str(pip.call_args[0][0]).endswith("TriathlonTrainingsDashboard-abc123"))
        # Programm-Sicherung mit den alten Dateien und einer Anleitung
        backup = next((self.base / "backups").glob("programm-2.0.0-*.zip"))
        with zipfile.ZipFile(backup) as z:
            self.assertEqual(z.read("index.html").decode(), "<html>alt</html>")
            self.assertIn("WIEDERHERSTELLEN.txt", z.namelist())
        st = updater.status()
        self.assertEqual((st["install"]["running"], st["install"]["ok"]), (False, True))
        self.assertFalse(st["available"])

    def test_scheitern_der_bibliotheken_aendert_nichts(self):
        self.install(make_zip(GOOD_FILES), pip_ok=False)
        self.assertEqual((self.base / "VERSION").read_text().strip(), "2.0.0")
        self.assertEqual((self.base / "index.html").read_text(), "<html>alt</html>")
        st = updater.status()["install"]
        self.assertEqual((st["running"], st["ok"]), (False, False))
        self.assertIn("Bibliotheken", st["message"])

    def test_paket_mit_falscher_versionsnummer_wird_abgelehnt(self):
        _, _, restart = self.install(make_zip({**GOOD_FILES, "VERSION": "2.0.5"}))
        self.assertEqual((self.base / "VERSION").read_text().strip(), "2.0.0")
        restart.assert_not_called()
        self.assertIn("passt nicht", updater.status()["install"]["message"])

    def test_ohne_neuere_version_kein_start(self):
        self.assertFalse(updater.start_install())

    def test_git_installation(self):
        (self.base / ".git").mkdir()
        self.assertEqual(updater.install_type(), "git")
        calls = []

        def fake_git(*args):
            calls.append(args[0])
            out = "Flask==2.3.3\n" if args[0] == "show" else ("abc123\n" if args[0] == "rev-parse" else "")
            return subprocess.CompletedProcess(args, 0, stdout=out, stderr="")

        release = {"version": "2.1.0", "tag": "v2.1.0"}
        with mock.patch.object(updater, "_git", side_effect=fake_git), mock.patch.object(updater, "pip_install") as pip:
            updater.install_git(release)
        self.assertEqual(calls[:3], ["status", "fetch", "merge-base"])
        self.assertLess(calls.index("show"), calls.index("merge"))  # Bibliotheken vor dem Umschalten
        pip.assert_called_once()
        # eigene Aenderungen -> nichts anfassen
        dirty = lambda *a: subprocess.CompletedProcess(a, 0, stdout=" M index.html\n" if a[0] == "status" else "", stderr="")
        with mock.patch.object(updater, "_git", side_effect=dirty) as git, self.assertRaises(updater.UpdateError):
            updater.install_git(release)
        self.assertEqual([c.args[0] for c in git.call_args_list], ["status"])

    def test_neustart_nur_ueber_den_starter(self):
        with mock.patch.dict(os.environ, {"DASHBOARD_SUPERVISED": ""}), mock.patch("threading.Timer") as timer:
            self.assertFalse(updater.schedule_restart())
        timer.assert_not_called()
        with mock.patch.dict(os.environ, {"DASHBOARD_SUPERVISED": "1"}), mock.patch("threading.Timer") as timer:
            self.assertTrue(updater.schedule_restart())
        self.assertEqual(timer.call_args[1]["args"], (updater.RESTART_EXIT_CODE,))


class StarterTest(unittest.TestCase):
    def popen(self, *codes):
        procs = [mock.Mock(**{"wait.return_value": c, "poll.return_value": c}) for c in codes]
        return mock.patch("subprocess.Popen", side_effect=procs), procs

    def test_startet_nach_update_neu_und_endet_sonst(self):
        patcher, procs = self.popen(launcher.RESTART_EXIT_CODE, 0)
        with patcher as popen, mock.patch("signal.signal"):
            self.assertEqual(launcher.main(), 0)
        self.assertEqual(popen.call_count, 2)
        self.assertEqual(popen.call_args.kwargs["env"]["DASHBOARD_SUPERVISED"], "1")
        self.assertEqual(launcher.RESTART_EXIT_CODE, updater.RESTART_EXIT_CODE)
        patcher, _ = self.popen(1)
        with patcher, mock.patch("signal.signal"):
            self.assertEqual(launcher.main(), 1)

    def test_beendeter_starter_nimmt_den_server_mit(self):
        proc = mock.Mock(**{"wait.side_effect": [KeyboardInterrupt, 0], "poll.return_value": None})
        with mock.patch("subprocess.Popen", return_value=proc), mock.patch("signal.signal"):
            self.assertEqual(launcher.main(), 0)
        proc.terminate.assert_called_once()


class BetreiberTest(TempInstallMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app, session_factory = create_app()
        session = session_factory()
        cls.ids = {n: auth.create_login(session, n, "langes-passwort-1") for n in ("betreiber", "freund")}
        session.close()
        client = cls.app.test_client()
        cls.h = {n: {"Authorization": "Bearer " + client.post("/api/v1/auth/login", json={
            "username": n, "password": "langes-passwort-1"}).get_json()["data"]["token"]} for n in cls.ids}

    def setUp(self):
        super().setUp()
        self.client = self.app.test_client()
        patcher = mock.patch.dict(os.environ, {"ADMIN_USERS": ""})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_freund_sieht_nur_die_version_und_darf_nichts(self):
        r = self.client.get("/api/v1/update", headers=self.h["freund"]).get_json()["data"]
        self.assertEqual(r, {"current": "2.0.0", "admin": False})
        for path in ("/api/v1/update/check", "/api/v1/update/install"):
            self.assertEqual(self.client.post(path, headers=self.h["freund"]).status_code, 403)

    def test_betreiber_prueft_und_installiert(self):
        r = self.client.get("/api/v1/update", headers=self.h["betreiber"]).get_json()["data"]
        self.assertTrue(r["admin"])
        self.assertEqual(self.client.post("/api/v1/update/install", headers=self.h["betreiber"]).status_code, 409)  # nichts Neues
        with mock.patch.object(updater, "_get", return_value=release_json()):
            r = self.client.post("/api/v1/update/check", headers=self.h["betreiber"]).get_json()["data"]
        self.assertTrue(r["available"])
        with mock.patch.object(updater, "start_install", return_value=True) as start:
            self.assertEqual(self.client.post("/api/v1/update/install", headers=self.h["betreiber"]).status_code, 202)
        start.assert_called_once()

    def test_admin_users_aus_der_env(self):
        with mock.patch.dict(os.environ, {"ADMIN_USERS": "Freund, jemand"}):
            self.assertTrue(self.client.get("/api/v1/update", headers=self.h["freund"]).get_json()["data"]["admin"])
            self.assertFalse(self.client.get("/api/v1/update", headers=self.h["betreiber"]).get_json()["data"]["admin"])


if __name__ == "__main__":
    unittest.main()
