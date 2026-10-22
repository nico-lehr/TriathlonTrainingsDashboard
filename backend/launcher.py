"""Starter fuer das Dashboard (aufgerufen von start.bat / start.sh).

Startet backend/app.py und startet ihn neu, wenn er mit Code 3 endet - so
beendet sich der Server nach einem installierten Update selbst
(backend/updater.py) und laeuft gleich darauf mit der neuen Version weiter.
Jeder andere Code beendet auch den Starter (z. B. Strg+C). Wird der Starter
selbst beendet, nimmt er den Server mit (sonst bliebe Port 5000 belegt).
"""
import os
import signal
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
RESTART_EXIT_CODE = 3  # wie updater.RESTART_EXIT_CODE


def _stop(signum, frame):
    raise SystemExit(0)


def main():
    env = {**os.environ, "DASHBOARD_SUPERVISED": "1"}
    signal.signal(signal.SIGTERM, _stop)
    while True:
        proc = subprocess.Popen([sys.executable, str(BASE / "backend" / "app.py")], cwd=BASE, env=env)
        try:
            code = proc.wait()
        except (KeyboardInterrupt, SystemExit):
            code = 0
        finally:
            if proc.poll() is None:  # Starter wird beendet, Server laeuft noch
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
        if code != RESTART_EXIT_CODE:
            return code
        print("\nUpdate installiert - das Dashboard startet neu ...\n", flush=True)


if __name__ == "__main__":
    sys.exit(main())
