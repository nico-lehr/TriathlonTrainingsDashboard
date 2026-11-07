"""Prueft Schritt fuer Schritt, ob dieser Rechner (z. B. der Raspberry Pi)
die offizielle Garmin-Schnittstelle erreicht - fuer die Fehlersuche, wenn im
Dashboard "Garmin ist nicht erreichbar" steht.

Aufruf im Projektordner:
    .venv/bin/python tools/garmin_check.py                 (Raspberry Pi)
    python3 tools/garmin_check.py --athlete 1              (zusaetzlich den gespeicherten Schluessel von Person 1 pruefen)

Gibt nie einen Schluessel oder Token aus. Sendet ohne --athlete nur einen
absichtlich ungueltigen Test-Schluessel an Garmin.
"""
import argparse
import os
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools import garmin_personal_api as api  # noqa: E402

OK, FAIL, INFO = "✓", "✗", "·"


def say(mark, text):
    print(f"  {mark} {text}", flush=True)


def main():
    ap = argparse.ArgumentParser(description="Garmin-Verbindung pruefen")
    ap.add_argument("--athlete", type=int, help="gespeicherten Schluessel dieser Person (athlete_id) pruefen")
    args = ap.parse_args()
    host = urllib.parse.urlparse(api.BASE_URL).hostname
    problems = 0
    print(f"\nGarmin-Verbindung pruefen ({host})\n")

    # 1. Uhrzeit (falsche Uhrzeit -> Zertifikat ungueltig)
    now = datetime.now(timezone.utc)
    say(INFO, f"Uhrzeit dieses Rechners (UTC): {now:%Y-%m-%d %H:%M:%S}")

    # 2. Namensaufloesung
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
        addrs = sorted({i[4][0] for i in infos})
        say(OK, f"Name aufgeloest: {', '.join(addrs)}")
    except socket.gaierror as e:
        say(FAIL, f"Name nicht aufloesbar ({e}). Hat der Rechner Internet? DNS im Router pruefen.")
        return 1

    # 3. Verbindung je Adresse (IPv6 kann haengen, IPv4 klappt trotzdem)
    reachable = False
    for fam, _, _, _, sockaddr in infos:
        kind = "IPv6" if fam == socket.AF_INET6 else "IPv4"
        start = time.monotonic()
        try:
            with socket.create_connection(sockaddr[:2], timeout=8):
                say(OK, f"{kind} {sockaddr[0]}: Verbindung in {int((time.monotonic() - start) * 1000)} ms")
                reachable = True
        except OSError as e:
            say(FAIL if kind == "IPv4" else INFO, f"{kind} {sockaddr[0]}: keine Verbindung ({type(e).__name__})")
    if not reachable:
        say(FAIL, "Garmin ist ueber keine Adresse erreichbar (Firewall, Netz oder Garmin gestoert).")
        return 1

    # 4. Verschluesselung + 5. Antwort der Schnittstelle (ungueltiger Test-Schluessel -> 401 erwartet)
    req = urllib.request.Request(api.BASE_URL + api.TOKEN_PATH, method="POST", headers={
        "Accept": "*/*", "Authorization": "ApiKey ungueltiger-pruef-schluessel", "Content-Length": "0",
        "User-Agent": "TriathlonDashboard"})
    try:
        with urllib.request.urlopen(req, timeout=api.TIMEOUT_S) as resp:
            status, date_hdr = resp.status, resp.headers.get("Date")
    except urllib.error.HTTPError as e:
        status, date_hdr = e.code, e.headers.get("Date") if e.headers else None
    except (urllib.error.URLError, OSError) as e:
        say(FAIL, api.describe_connection_error(e))
        return 1
    say(OK, "Sichere Verbindung (https) in Ordnung")
    if date_hdr:
        try:
            diff = abs((parsedate_to_datetime(date_hdr) - now).total_seconds())
            if diff > 120:
                problems += 1
                say(FAIL, f"Uhrzeit weicht um {int(diff)} s von Garmin ab - Uhrzeit des Rechners stellen (z. B. sudo timedatectl set-ntp true).")
            else:
                say(OK, "Uhrzeit stimmt mit Garmin ueberein")
        except (TypeError, ValueError):
            pass
    if status in (400, 401, 403):
        say(OK, f"Garmin-Schnittstelle antwortet (Test-Schluessel abgelehnt mit {status} - so soll es sein)")
    else:
        problems += 1
        say(FAIL, f"Unerwartete Antwort {status} - eventuell Stoerung bei Garmin.")

    # 6. Optional: echter gespeicherter Schluessel
    if args.athlete is not None:
        key = api.load_key(args.athlete)
        if not key:
            say(FAIL, f"Fuer Person {args.athlete} ist kein Schluessel gespeichert.")
            problems += 1
        else:
            try:
                api.exchange_key(key)
                say(OK, f"Gespeicherter Schluessel von Person {args.athlete} gilt - Garmin gibt einen Zugang.")
            except api.GarminApiAuthenticationError:
                problems += 1
                say(FAIL, "Garmin lehnt den gespeicherten Schluessel ab (abgelaufen, geloescht oder falsch kopiert).")
            except api.GarminApiError as e:
                problems += 1
                say(FAIL, e.user_message)

    print("\nErgebnis: " + ("alles in Ordnung." if not problems else f"{problems} Problem(e) - siehe ✗ oben.") + "\n")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
