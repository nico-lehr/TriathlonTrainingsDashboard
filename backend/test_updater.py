"""Programm-Updates: Versionsvergleich, GitHub-Abfrage, Pruefen und Anwenden
des Update-Pakets, Schutz der Nutzerdaten, Betreiber-Rechte, Starter.
GitHub wird nie angesprochen (Attrappen), installiert wird in einen
Temp-Ordner - das echte Projekt bleibt unberuehrt.

Aufruf im Projektordner:  python -m unittest backend.test_updater -v
"""
import http.client
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

    def test_kaputte_antwort_beendet_die_pruefung_nicht(self):
        for err in (http.client.IncompleteRead(b"abc"), http.client.BadStatusLine("x")):
            with self.subTest(err=type(err).__name__), mock.patch("urllib.request.urlopen", side_effect=err):
                st = updater.check(force=True)
            self.assertIn("nicht erreichbar", st["error"])
        with mock.patch.object(updater, "fetch_latest_release", side_effect=RuntimeError("unerwartet")):
            st = updater.check(force=True)
        self.assertIn("RuntimeError", st["error"])

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
            "Pfad nach draussen": make_zip({"../../boese.py": "x", **GOOD_FILES}),  # ein Hauptordner, Ausbruch darin
            "absoluter Pfad": make_zip({"/tmp/boese.py": "x", **GOOD_FILES}, top=None),
            "zwei Ordner": make_zip({"a/VERSION": "1", "b/VERSION": "1"}, top=None),
            "Kerndatei fehlt": make_zip({"VERSION": "2.1.0"}),
            "kein ZIP": b"kein zip",
        }
        for label, blob in cases.items():
            with self.subTest(label), tempfile.TemporaryDirectory() as tmp, self.assertRaises(updater.UpdateError):
                updater.extract_release(blob, tmp)

    def test_verknuepfung_und_riesenpaket_werden_abgelehnt(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for name, content in GOOD_FILES.items():
                z.writestr(f"top/{name}", content)
            link = zipfile.ZipInfo("top/link")
            link.external_attr = (0o120777 << 16)
            z.writestr(link, "/etc/passwd")
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(updater.UpdateError) as ctx:
            updater.extract_release(buf.getvalue(), tmp)
        self.assertIn("Verknüpfungen", str(ctx.exception))
        with mock.patch.object(updater, "MAX_ZIP_BYTES", 10), tempfile.TemporaryDirectory() as tmp, \
                self.assertRaises(updater.UpdateError) as ctx:
            updater.extract_release(make_zip(GOOD_FILES), tmp)
        self.assertIn("groß", str(ctx.exception))

    def test_schutz_auch_bei_anderer_schreibweise(self):
        for rel in (".ENV", "Training.db", "TRAINING.DB-journal", "BACKUPS/x.db", "Data/wellness-data.js",
                    "Fit-Files/a.fit", ".env.local", "irgendwo/garmin_1.token", "garmin_tokens.json",
                    "oauth1_token.json"):
            with self.subTest(rel=rel):
                self.assertTrue(updater.is_protected(rel))
        for rel in (".env.example", "backend/app.py", "docs/DATA_MODEL.md", "js/data/workouts.js"):
            with self.subTest(rel=rel):
                self.assertFalse(updater.is_protected(rel))

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
                mock.patch.object(updater, "backup_db_before_update") as backup_db, \
                mock.patch.object(updater, "schedule_restart", return_value=True) as restart, \
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

    def test_gesperrte_datei_stellt_den_alten_stand_wieder_her(self):
        real_copy = shutil.copy2

        def copy(src, dst, *a, **k):
            if Path(dst).name == "index.html":
                raise PermissionError(13, "Zugriff verweigert")
            return real_copy(src, dst, *a, **k)

        with mock.patch("shutil.copy2", side_effect=copy):
            _, _, restart = self.install(make_zip(GOOD_FILES))
        restart.assert_not_called()
        self.assertEqual((self.base / "VERSION").read_text().strip(), "2.0.0")
        self.assertEqual((self.base / "backend" / "app.py").read_text(), "print('alt')\n")
        self.assertFalse((self.base / "js" / "neu.js").exists())
        st = updater.status()
        self.assertIn("wiederhergestellt", st["install"]["message"])
        self.assertTrue(st["available"])  # erneut versuchen moeglich

    def test_sicherungen_nach_alter_aufraeumen(self):
        backups = self.base / "backups"
        backups.mkdir()
        for i, v in enumerate(("2.5.0", "2.6.0", "2.7.0", "2.8.0", "2.9.0")):
            old = backups / f"programm-{v}-2026-01-0{i + 1}-000000.zip"
            old.write_bytes(b"x")
            os.utime(old, (1_700_000_000 + i, 1_700_000_000 + i))
        new = updater.backup_program([], "2.10.0")
        self.assertTrue(new.exists())  # "2.10" sortiert nach Namen vor "2.5" - darf trotzdem nicht weg
        self.assertFalse((backups / "programm-2.5.0-2026-01-01-000000.zip").exists())
        self.assertEqual(len(list(backups.glob("programm-*.zip"))), updater.KEEP_PROGRAM_BACKUPS)

    def test_eigene_datenbank_sicherung_vor_dem_update(self):
        import sqlite3
        (self.base / "training.db").unlink()
        con = sqlite3.connect(self.base / "training.db")
        con.execute("create table t (x)")
        con.execute("insert into t values (42)")
        con.commit()
        con.close()
        target = updater.backup_db_before_update("2.0.0")
        self.assertTrue(target.name.startswith("vor-update-2.0.0-"))
        con = sqlite3.connect(target)
        self.assertEqual(con.execute("select x from t").fetchone(), (42,))
        con.close()

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

    def fake_git(self, calls, ancestor=0, tag_version="2.1.0\n"):
        def run(*args):
            calls.append(args[0])
            if args[0] == "show":
                out = tag_version if args[1].endswith(":VERSION") else "Flask==2.3.3\n"
            else:
                out = "abc123\n" if args[0] == "rev-parse" else ""
            code = ancestor if args[0] == "merge-base" else (0 if out is not None else 128)
            return subprocess.CompletedProcess(args, code, stdout=out or "", stderr="")
        return run

    def test_git_installation(self):
        (self.base / ".git").mkdir()
        self.assertEqual(updater.install_type(), "git")
        calls = []
        release = {"version": "2.1.0", "tag": "v2.1.0"}
        with mock.patch.object(updater, "_git", side_effect=self.fake_git(calls)), \
                mock.patch.object(updater, "pip_install", side_effect=lambda root: calls.append("pip")):
            updater.install_git(release)
        self.assertEqual(calls[:3], ["status", "fetch", "merge-base"])
        self.assertLess(calls.index("pip"), calls.index("merge"))  # Bibliotheken vor dem Umschalten
        # Zweig passt nicht (is-ancestor != 0) -> kein pip, kein merge
        calls = []
        with mock.patch.object(updater, "_git", side_effect=self.fake_git(calls, ancestor=1)), \
                mock.patch.object(updater, "pip_install") as pip, self.assertRaises(updater.UpdateError):
            updater.install_git(release)
        pip.assert_not_called()
        self.assertNotIn("merge", calls)
        # VERSION im Tag passt nicht -> abgelehnt, bevor etwas passiert
        calls = []
        with mock.patch.object(updater, "_git", side_effect=self.fake_git(calls, tag_version="2.0.0\n")), \
                mock.patch.object(updater, "pip_install") as pip, self.assertRaises(updater.UpdateError) as ctx:
            updater.install_git(release)
        self.assertIn("passt nicht", str(ctx.exception))
        pip.assert_not_called()
        self.assertNotIn("merge", calls)
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
