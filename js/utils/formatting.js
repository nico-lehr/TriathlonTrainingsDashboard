// Allgemeine Text-/Zahlen-Formatierung.

const fmtH = min => (min / 60).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const fmtNum = (n, dec = 1) => n == null ? "–" : n.toLocaleString("de-DE", { maximumFractionDigits: dec, minimumFractionDigits: 0 });


function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

// Baut den fachlichen Kontext (Form, Historie, Bestzeiten, Athletenprofil,
// Ziel) als kompakten Text-Block statt eingerücktem JSON - spart bei einem
// lokalen Modell mit begrenztem Kontextfenster/Tempo spürbar Tokens
// (~40-50% kürzer als pretty-printed JSON) ohne Informationsverlust: reine
// Label:Wert-Zeilen, fehlende Werte werden komplett weggelassen statt "null"
// mitzuschleppen. Wird 1:1 in den Prompt eingebettet.

// Wandelt die Fließtext-Antwort der KI in einfaches HTML um. Die Prompts
// (js/ai/prompts.js) weisen die KI zwar an, KEIN Markdown zu verwenden -
// Ollama-Modelle halten sich daran meist von selbst, externe APIs wie
// Claude liefern aber gelegentlich trotzdem noch **fett**/#-Überschriften/
// Aufzählungszeichen. Statt die rohen Sonderzeichen anzuzeigen (siehe
// CHANGE_REQUESTS.md), werden sie hier defensiv als einfaches HTML
// interpretiert - kein vollständiger Markdown-Parser, nur die paar Fälle,
// die in der Praxis vorkommen.
function renderRecommendationInline(line) {
  return escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function formatRecommendation(text) {
  return text.split(/\n{2,}/).map(block => {
    const html = block.split(/\n/).map(line => {
      const heading = line.match(/^#{1,6}\s+(.*)$/);
      if (heading) return `<strong>${renderRecommendationInline(heading[1])}</strong>`;
      const bullet = line.match(/^[-*]\s+(.*)$/);
      if (bullet) return `· ${renderRecommendationInline(bullet[1])}`;
      return renderRecommendationInline(line);
    }).join("<br>");
    return `<p>${html}</p>`;
  }).join("");
}

