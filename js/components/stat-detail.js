// Insights-Seite: Antippen einer Kachel oben öffnet ein Fenster mit Verlauf,
// Bewertung und Erklärung (Daten: statDetail() in
// js/analytics/insight-ratings.js). Außerdem die kurzen Bewertungen unter
// Fitness & Form, ACWR, Monotonie und Erholung (renderInsightRatings).
// Die Einordnungs-Liste zeichnet metricInsightsHtml() aus
// js/components/workout-card.js - dieselbe Optik wie in der Trainings-Detailansicht.

const statDetailOverlay = document.getElementById("stat-detail-overlay");
let statDetailOpener = null;

function closeStatDetail() {
  if (!statDetailOverlay || !statDetailOverlay.classList.contains("open")) return;
  statDetailOverlay.classList.remove("open");
  document.body.classList.remove("stat-detail-open");
  if (statDetailOpener && statDetailOpener.focus) statDetailOpener.focus();
  statDetailOpener = null;
}

function openStatDetail(key, opener) {
  const d = typeof statDetail === "function" ? statDetail(key) : null;
  if (!d || !statDetailOverlay) return;
  const esc = escapeHtml;
  const body = document.getElementById("stat-detail-body");
  const hist = d.history && d.history.points && d.history.points.length ? d.history : null;
  body.innerHTML = `
    <p class="sd-kicker">Insights</p>
    <h3 id="stat-detail-title" class="sd-title">${esc(d.title)}</h3>
    <div class="sd-value">${esc(d.value)}</div>
    ${d.lead ? `<p class="sd-lead">${esc(d.lead)}</p>` : ""}
    ${d.empty ? `<p class="sd-empty">${esc(d.empty)}</p>` : ""}
    ${d.items && d.items.length ? `<h4 class="sd-h">Bewertung</h4>${metricInsightsHtml(d.items)}` : ""}
    ${hist ? `<h4 class="sd-h">${esc(hist.title)}</h4><div class="chart-wrap sd-chart" id="stat-detail-chart"></div>`
      : (d.history ? `<h4 class="sd-h">${esc(d.history.title)}</h4><p class="sd-empty">Noch kein Verlauf vorhanden.</p>` : "")}
    ${d.source ? `<p class="sd-source">${esc(d.source)}</p>` : ""}`;
  statDetailOpener = opener || null;
  statDetailOverlay.classList.add("open");
  document.body.classList.add("stat-detail-open");
  if (hist) {
    const unit = hist.unit ? " " + hist.unit : "";
    drawMiniLine(document.getElementById("stat-detail-chart"), hist.points.map(p => ({
      y: p.value, raw: fmtNum(p.value, hist.dec), xLabel: p.date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }),
      tooltip: `<b>${esc(p.label)}</b><br>${fmtNum(p.value, hist.dec)}${esc(unit)}`,
    })), { color: "var(--accent)", unit: hist.unit, invert: false, width: 520, height: 190, fmtAxis: v => fmtNum(v, hist.dec) });
  }
  const close = document.getElementById("stat-detail-close");
  if (close) close.focus();
}

if (statDetailOverlay) {
  document.getElementById("stat-detail-close").addEventListener("click", closeStatDetail);
  statDetailOverlay.addEventListener("click", e => { if (e.target === statDetailOverlay) closeStatDetail(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeStatDetail(); });
}

// Kacheln oben: per Klick, Enter oder Leertaste öffnen.
(function wireStatTiles() {
  const row = document.getElementById("stat-row");
  if (!row) return;
  const tileOf = e => (e.target && e.target.closest ? e.target.closest(".stat-tile[data-stat-detail]") : null);
  row.addEventListener("click", e => { const t = tileOf(e); if (t) openStatDetail(t.dataset.statDetail, t); });
  row.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = tileOf(e);
    if (t) { e.preventDefault(); openStatDetail(t.dataset.statDetail, t); }
  });
})();

// Kurze Bewertungen unter den Diagrammen.
function renderInsightRatings() {
  const put = (id, items, title = "Bewertung") => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = items && items.length ? `<h4 class="sd-h">${title}</h4>${metricInsightsHtml(items)}` : "";
  };
  put("pmc-rating", pmcRatingItems());
  put("acwr-rating", acwrRatingItems());
  put("monotony-rating", monotonyRatingItems());
  put("recovery-rating", recoveryRatingItems(), "Bewertung deiner Erholung");
}
