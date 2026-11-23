// Manuellen Theme-Wunsch (falls gespeichert) VOR dem ersten Rendern setzen,
// damit die Seite nicht kurz im falschen Theme aufblitzt. Eigene Datei statt
// <script> in index.html/login.html: Die Sicherheitsregel des Servers
// (Content-Security-Policy, backend/__init__.py) erlaubt nur Skripte aus
// Dateien dieses Dashboards.
(function () {
  try {
    var t = localStorage.getItem("triathlon_dashboard_theme_v1");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) { /* localStorage evtl. nicht verfügbar */ }
})();

// Ladeschirm (nur im Dashboard, nicht auf der Anmeldeseite): Die Seite
// enthält noch die bisherigen Ansichten fest im HTML; die Graphit-Ansicht
// (js/components/m-app.js) entsteht erst, wenn alle Daten geladen sind.
// Bis dahin nur ein dunkler Hintergrund mit Ladekreis (css/m-graphit.css,
// html.m-boot) - so blitzt das alte Design nie auf. renderMApp() nimmt die
// Klasse weg, eine Fehlermeldung (showApiError) ebenfalls; als
// Sicherheitsnetz spätestens nach 20 Sekunden.
(function () {
  if (/login\.html$/.test(location.pathname)) return;
  var root = document.documentElement;
  root.classList.add("m-boot");
  setTimeout(function () { root.classList.remove("m-boot"); }, 20000);
})();
