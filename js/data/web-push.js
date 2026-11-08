// Mitteilungen aufs Handy (Web Push) - Einstellungen → Mitteilungen.
// Der Server (backend/morning.py) schickt morgens den Morgenbericht, sobald
// die Daten der Nacht da sind. sw.js zeigt die Mitteilung an.
//
// iPhone: klappt nur, wenn das Dashboard über Safari → Teilen → „Zum
// Home-Bildschirm“ abgelegt und von dort geöffnet wurde (ab iOS 16.4).

let webPush = { loaded: false, available: false, publicKey: null, devices: 0, thisDevice: false, morning: { enabled: true }, error: null };

function webPushEnv() {
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = !!(navigator.standalone || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches));
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
  return { ios, standalone, supported, permission: "Notification" in window ? Notification.permission : "unsupported" };
}

function webPushLabel() {
  const ua = navigator.userAgent || "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  return "Computer";
}

function webPushKeyBytes(b64) {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

async function webPushSubscription() {
  if (!webPushEnv().supported) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function webPushPost(sub) {
  const json = sub.toJSON();
  return (await apiCall("push/subscribe", "POST", { endpoint: json.endpoint, keys: json.keys, label: webPushLabel() })).data;
}

async function refreshWebPush() {
  try {
    const sub = await webPushSubscription().catch(() => null);
    let data = (await apiCall("push/status" + (sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ""))).data;
    // Erlaubt, aber dem Server unbekannt (z. B. neue Datenbank): still neu anmelden
    if (sub && !data.thisDevice && data.available && Notification.permission === "granted") data = await webPushPost(sub);
    webPush = { ...data, loaded: true, error: null };
  } catch (e) {
    webPush = { ...webPush, loaded: true, error: e.message || String(e) };
  }
  renderWebPushSettings();
}

// Muss direkt aus einem Tipp heraus laufen (iPhone verlangt das)
async function enableWebPush() {
  const env = webPushEnv();
  if (!env.supported) throw new Error(env.ios && !env.standalone
    ? "Auf dem iPhone geht das nur aus der App auf dem Home-Bildschirm (siehe Anleitung oben)."
    : "Dieser Browser kann keine Mitteilungen empfangen.");
  if (!webPush.publicKey) throw new Error(webPush.error || "Der Server kann gerade keine Mitteilungen schicken.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Mitteilungen sind nicht erlaubt. Du kannst sie in den Einstellungen des Handys für TriDashboard einschalten.");
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: webPushKeyBytes(webPush.publicKey) });
  webPush = { ...(await webPushPost(sub)), loaded: true, error: null };
  renderWebPushSettings();
}

async function disableWebPush() {
  const sub = await webPushSubscription().catch(() => null);
  if (sub) {
    await apiCall("push/unsubscribe", "POST", { endpoint: sub.endpoint }).catch(() => null);
    await sub.unsubscribe().catch(() => null);
  }
  await refreshWebPush();
}

async function setMorningPushEnabled(enabled) {
  webPush = { ...webPush, ...(await apiCall("morning/settings", "PUT", { enabled })).data };
  renderWebPushSettings();
}

function webPushStatusText() {
  const env = webPushEnv();
  if (!webPush.loaded) return ["Lade …", ""];
  if (webPush.error) return [webPush.error, "err"];
  if (!webPush.available) return ["Auf dem Dashboard-PC fehlt noch eine Bibliothek. Einmalig dort ausführen: python -m pip install -r backend/requirements.txt", "warn"];
  if (webPush.thisDevice) {
    const other = webPush.devices - 1;
    return [`An auf diesem Gerät${other > 0 ? ` und ${other === 1 ? "einem weiteren" : `${other} weiteren`}` : ""}. ${webPush.morning.enabled ? "Der Morgenbericht kommt, sobald die Daten deiner Nacht da sind." : "Der Morgenbericht ist ausgeschaltet."}`, "ok"];
  }
  if (env.ios && !env.standalone) return ["Auf dem iPhone geht das nur aus der App auf dem Home-Bildschirm – so geht’s:", "warn"];
  if (!env.supported) return ["Dieser Browser kann keine Mitteilungen empfangen.", "warn"];
  if (env.permission === "denied") return ["Mitteilungen sind für das Dashboard blockiert. Erlaube sie in den Einstellungen des Geräts.", "warn"];
  return [webPush.devices ? `Auf ${webPush.devices === 1 ? "einem anderen Gerät" : `${webPush.devices} anderen Geräten`} an – auf diesem noch nicht.` : "Noch aus.", ""];
}

function renderWebPushSettings() {
  const el = document.getElementById("push-status");
  if (!el) return;
  const env = webPushEnv();
  const [text, kind] = webPushStatusText();
  el.textContent = text;
  el.classList.remove("ok", "warn", "err");
  if (kind) el.classList.add(kind);
  const show = (id, on) => { const b = document.getElementById(id); if (b) b.hidden = !on; };
  show("push-ios-hint", env.ios && !env.standalone && !webPush.thisDevice);
  show("push-enable-btn", webPush.available && !webPush.thisDevice && env.supported && env.permission !== "denied");
  show("push-test-btn", webPush.thisDevice);
  show("push-disable-btn", webPush.thisDevice);
  show("push-morning-row", webPush.available && webPush.devices > 0);
  const cb = document.getElementById("push-morning-enabled");
  if (cb) cb.checked = !!webPush.morning.enabled;
  if (typeof renderSettingsHub === "function" && typeof shPanel !== "undefined" && !shPanel) renderSettingsHub();
}

function initWebPush() {
  const status = document.getElementById("push-status");
  const setMsg = (t, k) => { if (status) { status.textContent = t; status.classList.remove("ok", "warn", "err"); if (k) status.classList.add(k); } };
  const click = (id, fn) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await fn(); } catch (e) { setMsg(e.message || String(e), "err"); } finally { b.disabled = false; }
    });
  };
  click("push-enable-btn", enableWebPush);
  click("push-disable-btn", disableWebPush);
  click("push-test-btn", async () => {
    setMsg("Schicke eine Probe …", "");
    await apiCall("push/test", "POST");
    setMsg("Probe verschickt – sie sollte gleich auf deinem Gerät erscheinen.", "ok");
  });
  const cb = document.getElementById("push-morning-enabled");
  if (cb) cb.addEventListener("change", () => setMorningPushEnabled(cb.checked).catch(e => setMsg(e.message, "err")));
  refreshWebPush();
}
