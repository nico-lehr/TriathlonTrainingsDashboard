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
