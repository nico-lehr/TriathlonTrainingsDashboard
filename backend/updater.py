"""Programm-Updates: neue Versionen auf GitHub erkennen und nach Bestaetigung
installieren. Kein Flask hier - die Endpunkte stehen in update_routes.py.

Quelle ist die neueste "Release" des Repositorys (GitHub API, ohne Konto,
einmal am Tag). Eine Release wird bewusst von Hand veroeffentlicht (siehe
docs/DEPLOYMENT.md, "Neue Version veroeffentlichen") - ein einfacher Push auf
main loest kein Update aus.

Installieren:
  1. Sicherung: training.db (backup.py) und die zu ersetzenden Programmdateien
     (backups/programm-<alte Version>-<Zeitpunkt>.zip).
  2. ZIP-Installation: Release-ZIP laden, pruefen (keine Pfade ausserhalb,
     enthaelt backend/app.py und VERSION), Bibliotheken der NEUEN Version
     installieren - erst wenn das klappt, Dateien kopieren.
     git-Installation: git fetch + git merge --ff-only auf den Release-Tag.
  3. Neustart: Der Starter (backend/launcher.py, aus start.bat/start.sh)
     startet den Server neu, wenn er mit Code 3 endet.
Nie angefasst werden die Nutzerdaten (PROTECTED): .env, training.db, backups/,
fit-files/, data/ ... - sie stehen ohnehin nie im Repository.
"""
import http.client
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
REPO = os.getenv("UPDATE_REPO", "nico-lehr/TriathlonTrainingsDashboard")
API_URL = os.getenv("UPDATE_API_URL", "https://api.github.com").rstrip("/")  # nur fuer Tests anders
TIMEOUT_S = 30
CHECK_INTERVAL_S = 24 * 3600
FIRST_CHECK_DELAY_S = 60       # erst kurz nach dem Start pruefen, nicht beim Hochfahren
RESTART_EXIT_CODE = 3          # backend/launcher.py startet den Server dann neu
KEEP_PROGRAM_BACKUPS = 5
MAX_ZIP_BYTES = 50 * 1024 * 1024

# Erste Pfad-Teile, die ein Update nie ueberschreibt (Nutzerdaten, Sicherungen,
# Werkzeuge) - klein geschrieben verglichen: Windows/macOS unterscheiden
# Gross-/Kleinschreibung nicht, ".ENV" waere dort dieselbe Datei wie ".env".
PROTECTED_TOP = {".env", ".env.local", ".git", ".claude", "backups", "fit-files", "data", "__pycache__",
                 "workouts.json", "dashboard-export.json", "venv", ".venv", "node_modules"}
REQUIRED_FILES = ("VERSION", "backend/app.py", "index.html")
# Kennung dieses Server-Laufs: Der Browser erkennt daran den Neustart nach
# einem Update (die Versionsnummer liest schon der alte Lauf von der Platte).
INSTANCE = f"{os.getpid()}-{int(time.time() * 1000)}"


class UpdateError(Exception):
    """Fehler mit einem verstaendlichen deutschen Satz."""


_lock = threading.Lock()
_state = {"latest": None, "checked_at": None, "error": None,
          "install": {"running": False, "step": None, "ok": None, "message": None}}


# ------------------------------------------------------------ Versionen

def current_version():
    try:
        return (BASE / "VERSION").read_text(encoding="utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


def parse_version(text):
    """'v2.1.0' / '2.1' -> (2, 1, 0); None, wenn es keine Versionsnummer ist."""
    m = re.fullmatch(r"v?(\d+)(?:\.(\d+))?(?:\.(\d+))?", str(text or "").strip())
    return tuple(int(x or 0) for x in m.groups()) if m else None


def is_newer(remote, local):
    r, l = parse_version(remote), parse_version(local)
    return r is not None and l is not None and r > l


def install_type():
    """'git', wenn das Programm per git geholt wurde, sonst 'zip'."""
    return "git" if (BASE / ".git").exists() else "zip"


# ------------------------------------------------------------ GitHub

def _get(url, accept="application/vnd.github+json"):
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "TriathlonDashboard-Updater"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            body = resp.read(MAX_ZIP_BYTES + 1)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        if e.code in (403, 429):
            raise UpdateError("GitHub lässt gerade keine Abfrage zu (zu viele Anfragen). Später erneut prüfen.") from None
        raise UpdateError(f"GitHub antwortet mit Fehler {e.code}.") from None
    except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError):
        raise UpdateError("GitHub ist nicht erreichbar – Internetverbindung prüfen.") from None
    if len(body) > MAX_ZIP_BYTES:
        raise UpdateError("Die Antwort von GitHub ist unerwartet groß – Update abgebrochen.")
    return body


def fetch_latest_release():
    """Neueste veroeffentlichte Release -> dict, oder None, wenn es keine gibt."""
    body = _get(f"{API_URL}/repos/{REPO}/releases/latest")
    if body is None:
        return None
    try:
        data = json.loads(body)
        tag = data["tag_name"]
    except (ValueError, KeyError, TypeError):
        raise UpdateError("GitHub hat eine unerwartete Antwort geliefert.") from None
    if parse_version(tag) is None:
        raise UpdateError(f"Die neueste Release hat keine Versionsnummer als Tag ({tag}).")
    return {
        "version": tag.lstrip("v"), "tag": tag,
        "name": data.get("name") or tag,
        "notes": (data.get("body") or "").strip()[:5000],
        "url": data.get("html_url"),
        "published_at": data.get("published_at"),
    }


def check(force=False):
    """Prueft hoechstens einmal je CHECK_INTERVAL_S (force: sofort). -> status()."""
    with _lock:
        fresh = _state["checked_at"] and time.time() - _state["checked_at"] < CHECK_INTERVAL_S
    if fresh and not force:
        return status()
    try:
        latest, error = fetch_latest_release(), None
    except UpdateError as e:
        latest, error = None, str(e)
    except Exception as e:  # nie den Pruef-Thread oder eine Anfrage abstuerzen lassen
        latest, error = None, f"Prüfung fehlgeschlagen ({type(e).__name__})."
    with _lock:
        if error is None:  # bei einem Fehler den zuletzt bekannten Stand behalten
            _state["latest"] = latest
        _state["error"] = error
        _state["checked_at"] = time.time()
    return status()


def status():
    with _lock:
        latest = _state["latest"]
        return {
            "current": current_version(),
            "latest": latest,
            "available": bool(latest and is_newer(latest["version"], current_version())),
            "checked_at": datetime.fromtimestamp(_state["checked_at"]).isoformat(timespec="seconds") if _state["checked_at"] else None,
            "error": _state["error"],
            "install_type": install_type(),
            "supervised": os.getenv("DASHBOARD_SUPERVISED") == "1",
            "instance": INSTANCE,
            "auto_check": os.getenv("UPDATE_CHECK", "1") != "0",
            "install": dict(_state["install"]),
        }


def start_background_check():
    """Prueft im Hintergrund kurz nach dem Start und dann einmal am Tag."""
    def loop():
        time.sleep(FIRST_CHECK_DELAY_S)
        while True:
            try:
                check(force=True)  # faengt selbst alles ab - der Thread darf nie enden
            except Exception as e:
                print(f"Update-Pruefung: {type(e).__name__}", flush=True)
            time.sleep(CHECK_INTERVAL_S)
    threading.Thread(target=loop, daemon=True, name="update-check").start()


# ------------------------------------------------------------ ZIP pruefen und anwenden

def is_protected(rel):
    parts = [p.casefold() for p in Path(rel).parts]
    if not parts:
        return True
    name = parts[-1]
    return (parts[0] in PROTECTED_TOP or parts[0].startswith("training.db") or "__pycache__" in parts
            or name.endswith(".token") or name == "garmin_tokens.json"
            or (name.startswith("oauth") and name.endswith("_token.json")))


def extract_release(blob, dest):
    """Entpackt das Release-ZIP nach dest und gibt den Programmordner darin
    zurueck. Bricht ab bei Pfaden ausserhalb, Links oder fehlenden Kerndateien."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        raise UpdateError("Die heruntergeladene Datei ist kein gültiges ZIP – Update abgebrochen.") from None
    dest = Path(dest).resolve()
    with zf:
        names = zf.namelist()
        tops = {n.split("/", 1)[0] for n in names if n}
        if len(tops) != 1:
            raise UpdateError("Unerwarteter Aufbau des Update-Pakets – Update abgebrochen.")
        total = 0
        for info in zf.infolist():
            target = (dest / info.filename).resolve()
            if dest not in target.parents and target != dest:
                raise UpdateError("Das Update-Paket enthält unzulässige Pfade – Update abgebrochen.")
            if (info.external_attr >> 16) & 0o170000 == 0o120000:  # symbolischer Link
                raise UpdateError("Das Update-Paket enthält unzulässige Verknüpfungen – Update abgebrochen.")
            total += info.file_size
            if total > 4 * MAX_ZIP_BYTES:
                raise UpdateError("Das Update-Paket ist unerwartet groß – Update abgebrochen.")
        zf.extractall(dest)
    root = dest / tops.pop()
    missing = [f for f in REQUIRED_FILES if not (root / f).is_file()]
    if missing:
        raise UpdateError(f"Im Update-Paket fehlt {missing[0]} – Update abgebrochen.")
    return root


def program_files(root):
    """Alle Dateien des neuen Programms (relativ), ohne geschuetzte Pfade."""
    out = []
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if path.is_file() and not is_protected(rel):
            out.append(rel)
    return out


ZIP_RESTORE_NOTE = ("Zurueck zur vorherigen Version:\n"
                    "1. Dashboard beenden (Fenster schliessen).\n"
                    "2. Diese ZIP-Datei entpacken - Ziel ist DER PROJEKTORDNER selbst (dort, wo start.bat liegt),\n"
                    "   NICHT der vom Entpacken vorgeschlagene Unterordner. Vorhandene Dateien ersetzen.\n"
                    "3. Dashboard neu starten. Deine Daten (training.db, .env) sind davon nicht betroffen.\n")


def backup_program(files, version, note=ZIP_RESTORE_NOTE):
    """Sichert die Dateien, die ueberschrieben werden, nach backups/ - mit
    einer Anleitung zum Zurueckkehren (WIEDERHERSTELLEN.txt)."""
    backups = BASE / "backups"
    backups.mkdir(exist_ok=True)
    target = backups / f"programm-{version}-{datetime.now():%Y-%m-%d-%H%M%S}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("WIEDERHERSTELLEN.txt", note)
        for rel in list(files) + [Path("VERSION")]:
            src = BASE / rel
            if src.is_file() and Path(rel).as_posix() not in z.namelist():
                z.write(src, Path(rel).as_posix())
    # Nach Alter, nicht nach Namen: "programm-2.10.0" sortiert sonst vor "2.5.0".
    for old in sorted(backups.glob("programm-*.zip"), key=lambda p: p.stat().st_mtime)[:-KEEP_PROGRAM_BACKUPS]:
        if old != target:
            old.unlink()
    return target


def backup_db_before_update(version):
    """Eigene Datenbank-Sicherung vor dem Update (die taegliche Sicherung
    training-<Tag>.db wird beim naechsten Start am selben Tag ueberschrieben)."""
    import sqlite3
    db = BASE / "training.db"
    if not db.exists():
        return None
    backups = BASE / "backups"
    backups.mkdir(exist_ok=True)
    target = backups / f"vor-update-{version}-{datetime.now():%Y-%m-%d-%H%M%S}.db"
    src, dst = sqlite3.connect(db), sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    for old in sorted(backups.glob("vor-update-*.db"), key=lambda p: p.stat().st_mtime)[:-KEEP_PROGRAM_BACKUPS]:
        if old != target:
            old.unlink()
    return target


def pip_install(root):
    """Bibliotheken der neuen Version installieren (vor dem Kopieren). Die
    Garmin-/FIT-Bibliotheken nur, wenn sie hier schon installiert sind."""
    import importlib.util
    files = [root / "backend" / "requirements.txt"]
    if importlib.util.find_spec("fitdecode") or importlib.util.find_spec("garminconnect"):
        files.append(root / "requirements.txt")
    for req in files:
        if not req.is_file():
            continue
        proc = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", str(req)],
                              capture_output=True, text=True, timeout=900)
        if proc.returncode != 0:
            last = " ".join((proc.stderr or proc.stdout or "").strip().splitlines()[-2:])[:300]
            raise UpdateError(f"Bibliotheken konnten nicht installiert werden ({last}). Es wurde nichts geändert.")


def apply_files(root, files, backup_zip):
    """Kopiert die neuen Dateien - VERSION zuletzt, erst dann gilt die neue
    Version als installiert. Scheitert eine Datei (z. B. von einem anderen
    Programm gesperrt), wird das schon Kopierte aus der Sicherung
    zurueckgeschrieben: kein halb altes, halb neues Programm."""
    done = []
    rel = None
    try:
        for rel in sorted(files, key=lambda r: Path(r).as_posix() == "VERSION"):
            dst = BASE / rel
            existed = dst.exists()
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / rel, dst)
            done.append((Path(rel), existed))
    except OSError as e:
        restored = _restore(done, backup_zip)
        reason = f"{Path(rel).as_posix()}: {e.strerror or type(e).__name__}"
        if restored:
            raise UpdateError(f"Eine Datei konnte nicht ersetzt werden ({reason}) – ist sie in einem anderen "
                              "Programm geöffnet? Der alte Stand ist wiederhergestellt, bitte erneut versuchen.") from None
        raise UpdateError(f"Eine Datei konnte nicht ersetzt werden ({reason}), und der alte Stand ließ sich nicht "
                          f"vollständig zurückschreiben. Sicherung: {backup_zip} (siehe WIEDERHERSTELLEN.txt darin).") from None


def _restore(done, backup_zip):
    """Schon kopierte Dateien zuruecksetzen: aus der Sicherung, bzw. neu
    hinzugekommene loeschen. True, wenn alles geklappt hat."""
    ok = True
    with zipfile.ZipFile(backup_zip) as z:
        saved = set(z.namelist())
        for rel, existed in reversed(done):
            dst = BASE / rel
            try:
                if rel.as_posix() in saved:
                    dst.write_bytes(z.read(rel.as_posix()))
                elif not existed:
                    dst.unlink(missing_ok=True)
            except OSError:
                ok = False
    return ok


def _tempdir():
    """Temp-Ordner; Aufraeumfehler (Windows: Datei noch offen) brechen nichts ab."""
    return tempfile.mkdtemp(prefix="dashboard-update-")


def install_zip(release):
    tmp = _tempdir()
    try:
        _step("Neue Version wird heruntergeladen …")
        blob = _get(f"{API_URL}/repos/{REPO}/zipball/{release['tag']}", accept="application/zip")
        if blob is None:
            raise UpdateError("Das Update-Paket wurde auf GitHub nicht gefunden.")
        root = extract_release(blob, tmp)
        new_version = (root / "VERSION").read_text(encoding="utf-8").strip()
        if parse_version(new_version) != parse_version(release["version"]):
            raise UpdateError(f"Versionsnummer im Paket ({new_version}) passt nicht zur Release ({release['version']}).")
        files = program_files(root)
        _step("Bibliotheken werden installiert …")
        pip_install(root)
        _step("Programm wird gesichert …")
        backup_zip = backup_program(files, current_version())
        _step("Dateien werden ersetzt …")
        apply_files(root, files, backup_zip)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _git(*args):
    try:
        return subprocess.run(["git", *args], cwd=BASE, capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired):
        raise UpdateError("git ist nicht verfügbar. Bitte im Projektordner selbst aktualisieren: git pull") from None


def install_git(release):
    _step("Prüfe den git-Stand …")
    changed = _git("status", "--porcelain", "--untracked-files=no")
    if changed.returncode != 0:
        raise UpdateError("git-Stand konnte nicht gelesen werden. Bitte selbst aktualisieren: git pull")
    if changed.stdout.strip():
        raise UpdateError("Im Projektordner gibt es eigene Änderungen an Programmdateien. "
                          "Bitte selbst aktualisieren (git stash, git pull). Es wurde nichts geändert.")
    tag = release["tag"]
    _step("Neue Version wird heruntergeladen …")
    if _git("fetch", "--quiet", "--no-tags", "origin", f"refs/tags/{tag}:refs/tags/{tag}").returncode != 0:
        raise UpdateError("Die neue Version konnte nicht geladen werden (git fetch). Es wurde nichts geändert.")
    if _git("merge-base", "--is-ancestor", "HEAD", tag).returncode != 0:
        raise UpdateError("Die neue Version passt nicht ohne Weiteres zum aktuellen git-Zweig. "
                          f"Bitte selbst aktualisieren (git merge {tag}). Es wurde nichts geändert.")
    shown = _git("show", f"{tag}:VERSION")
    tag_version = shown.stdout.strip() if shown.returncode == 0 else "(fehlt)"
    if parse_version(tag_version) != parse_version(release["version"]):
        raise UpdateError(f"Versionsnummer im Paket ({tag_version}) passt nicht zur Release ({release['version']}). "
                          "Es wurde nichts geändert.")
    # Bibliotheken der NEUEN Version vor dem Umschalten installieren.
    _step("Bibliotheken werden installiert …")
    tmp = _tempdir()
    try:
        for rel in ("backend/requirements.txt", "requirements.txt"):
            shown = _git("show", f"{tag}:{rel}")
            if shown.returncode == 0:
                (Path(tmp) / rel).parent.mkdir(parents=True, exist_ok=True)
                (Path(tmp) / rel).write_text(shown.stdout, encoding="utf-8")
        pip_install(Path(tmp))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    _step("Programm wird gesichert …")
    head = _git("rev-parse", "HEAD").stdout.strip()
    backup_program([], current_version(), note=f"Zurueck zur vorherigen Version (im Projektordner): git reset --keep {head}\n")
    _step("Dateien werden ersetzt …")
    if _git("merge", "--ff-only", "--quiet", tag).returncode != 0:
        raise UpdateError(f"git merge {tag} ist fehlgeschlagen. Bitte selbst prüfen (git status).")


def _step(text):
    with _lock:
        _state["install"]["step"] = text


def start_install():
    """Startet die Installation im Hintergrund. False, wenn schon eine laeuft
    oder keine neuere Version bekannt ist."""
    with _lock:
        latest = _state["latest"]
        if _state["install"]["running"] or not (latest and is_newer(latest["version"], current_version())):
            return False
        _state["install"] = {"running": True, "step": "Wird vorbereitet …", "ok": None, "message": None}
    threading.Thread(target=_run_install, args=(dict(latest),), daemon=True, name="update-install").start()
    return True


def _run_install(release):
    result = {"ok": False, "message": "Update abgebrochen."}
    try:
        _step("Datenbank wird gesichert …")
        backup_db_before_update(current_version())
        (install_git if install_type() == "git" else install_zip)(release)
        if schedule_restart():
            result = {"ok": True, "message": f"Version {release['version']} installiert – der Server startet neu."}
        else:
            result = {"ok": True, "message": f"Version {release['version']} installiert. Bitte das Dashboard-Fenster "
                                             "schließen und neu starten (start.bat / start.sh)."}
    except UpdateError as e:
        result = {"ok": False, "message": str(e)}
    except Exception as e:  # nie ein Absturz des Servers
        result = {"ok": False, "message": f"Update fehlgeschlagen ({type(e).__name__}). Details im Server-Fenster."}
        print(f"Update fehlgeschlagen: {type(e).__name__}: {e}", flush=True)
    finally:
        with _lock:
            _state["install"] = {"running": False, "step": None, **result}


def schedule_restart():
    """Neustart ueber den Starter (Code 3) - nur, wenn der Server von ihm
    gestartet wurde. Kurze Pause, damit die Antwort noch beim Browser ankommt."""
    if os.getenv("DASHBOARD_SUPERVISED") != "1":
        return False
    threading.Timer(2.0, os._exit, args=(RESTART_EXIT_CODE,)).start()
    return True
