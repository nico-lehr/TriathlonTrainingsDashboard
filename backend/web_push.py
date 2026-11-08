"""Mitteilungen aufs Handy ueber Web Push (RFC 8030/8291/8292).

Kein fremder Dienst und kein Konto noetig: Der Browser (Safari auf dem iPhone,
Chrome, Firefox) gibt beim Erlauben eine Adresse seines Push-Dienstes heraus
(Apple, Google, Mozilla). Der Server verschluesselt die Nachricht fuer genau
dieses Geraet und schickt sie dorthin.

- Der eigene Schluessel (VAPID, P-256) entsteht beim ersten Gebrauch und liegt
  wie die Garmin- und Claude-Schluessel in ~/.triathlon (nur fuer den Besitzer
  lesbar). Der Browser bekommt nur den OEFFENTLICHEN Teil.
- Verschickt wird nur an bekannte Push-Dienste (keine beliebigen Adressen).
- Braucht das Paket "cryptography" (backend/requirements.txt). Fehlt es,
  meldet available() False und das Dashboard sagt, was zu tun ist.
"""
import base64
import json
import os
import struct
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

KEY_DIR = os.path.expanduser("~/.triathlon")  # wie Garmin- und Claude-Schluessel
KEY_FILE = "web-push-vapid.pem"
# "sub" im VAPID-Token: Kontakt fuer den Push-Dienst (Apple verlangt mailto: oder https:)
CONTACT = "https://github.com/nico-lehr/TriathlonTrainingsDashboard"
TIMEOUT_S = 15
RECORD_SIZE = 4096

# Nur diese Push-Dienste (Endungen) - sonst koennte jemand den Server an
# beliebige Adressen schicken lassen.
PUSH_HOSTS = (
    ".push.apple.com",            # Safari / iPhone (web.push.apple.com)
    "fcm.googleapis.com",         # Chrome / Android
    ".push.services.mozilla.com", # Firefox
    ".notify.windows.com",        # Edge
)


class PushGone(Exception):
    """Das Abo gibt es nicht mehr (Geraet abgemeldet, App geloescht)."""


class PushError(Exception):
    """Push-Dienst hat abgelehnt oder ist nicht erreichbar."""


def available():
    try:
        import cryptography  # noqa: F401
        return True
    except ImportError:
        return False


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text):
    text = str(text or "").strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def allowed_endpoint(endpoint):
    if not isinstance(endpoint, str) or len(endpoint) > 1000:
        return False
    parts = urlsplit(endpoint)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host or parts.port not in (None, 443):
        return False
    return any(host == h.lstrip(".") or host.endswith(h if h.startswith(".") else "." + h) for h in PUSH_HOSTS)


# ------------------------------------------------------------ Schluessel

def _key_path():
    return os.path.join(KEY_DIR, KEY_FILE)


def _private_key():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    path = _key_path()
    if os.path.exists(path):
        with open(path, "rb") as f:
            return serialization.load_pem_private_key(f.read(), password=None)
    key = ec.generate_private_key(ec.SECP256R1())
    os.makedirs(KEY_DIR, exist_ok=True)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(pem)
    return key


def _raw_public(key):
    from cryptography.hazmat.primitives import serialization
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def public_key():
    """Oeffentlicher Schluessel fuer den Browser (applicationServerKey)."""
    return b64url(_raw_public(_private_key()))


def vapid_header(endpoint, now=None):
    """Authorization-Kopfzeile (RFC 8292): signiertes Kurz-Token fuer den Push-Dienst."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    key = _private_key()
    parts = urlsplit(endpoint)
    claims = {"aud": f"{parts.scheme}://{parts.netloc}", "exp": int((now or time.time()) + 12 * 3600), "sub": CONTACT}
    head = b64url(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    body = b64url(json.dumps(claims, separators=(",", ":")).encode())
    signing_input = f"{head}.{body}".encode("ascii")
    r, s = decode_dss_signature(key.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    token = f"{head}.{body}.{b64url(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
    return f"vapid t={token}, k={b64url(_raw_public(key))}"


# ------------------------------------------------------------ Verschluesselung

def _hmac(key, data):
    import hashlib
    import hmac
    return hmac.new(key, data, hashlib.sha256).digest()


def encrypt(payload, p256dh, auth, salt=None, sender_key=None):
    """Nachricht fuer ein Geraet verschluesseln (RFC 8291, aes128gcm).
    salt/sender_key nur fuer Tests."""
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    ua_public = b64url_decode(p256dh)
    auth_secret = b64url_decode(auth)
    if len(ua_public) != 65 or ua_public[0] != 4 or len(auth_secret) < 16:
        raise PushError("Ungültiges Abo (Schlüssel des Geräts).")
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    as_key = sender_key or ec.generate_private_key(ec.SECP256R1())
    as_public = _raw_public(as_key)
    shared = as_key.exchange(ec.ECDH(), ua_key)
    # HKDF (RFC 5869) mit je einem Block - mehr Laenge wird nie gebraucht
    prk_key = _hmac(auth_secret, shared)
    ikm = _hmac(prk_key, b"WebPush: info\x00" + ua_public + as_public + b"\x01")
    salt = salt or os.urandom(16)
    prk = _hmac(salt, ikm)
    cek = _hmac(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
    nonce = _hmac(prk, b"Content-Encoding: nonce\x00\x01")[:12]
    data = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(data) > RECORD_SIZE - 17 - 86:
        raise PushError("Nachricht zu lang.")
    ciphertext = AESGCM(cek).encrypt(nonce, data + b"\x02", None)  # 0x02 = letzter Block, ohne Fuellung
    header = salt + struct.pack("!IB", RECORD_SIZE, len(as_public)) + as_public
    return header + ciphertext


# ------------------------------------------------------------ Versand

def _post(url, body, headers):
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code


def send(subscription, payload, ttl=6 * 3600, urgency="normal", post=None):
    """subscription: {endpoint, p256dh, auth}. Wirft PushGone (Abo weg) oder
    PushError. post ist austauschbar (Tests: nie echte Push-Dienste)."""
    endpoint = subscription["endpoint"]
    if not allowed_endpoint(endpoint):
        raise PushGone("Unbekannter Push-Dienst.")
    body = encrypt(payload, subscription["p256dh"], subscription["auth"])
    headers = {
        "TTL": str(int(ttl)),
        "Urgency": urgency,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Authorization": vapid_header(endpoint),
    }
    try:
        status = (post or _post)(endpoint, body, headers)
    except OSError as e:
        raise PushError(f"Push-Dienst nicht erreichbar ({type(e).__name__}).")
    if status in (404, 410):
        raise PushGone(f"Abo abgelaufen ({status}).")
    if not 200 <= status < 300:
        raise PushError(f"Push-Dienst antwortet mit {status}.")
    return status
