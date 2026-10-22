// Allgemeine Text-/Zahlen-Formatierung.

const fmtH = min => (min / 60).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const fmtNum = (n, dec = 1) => n == null ? "–" : n.toLocaleString("de-DE", { maximumFractionDigits: dec, minimumFractionDigits: 0 });

// Liefert "YYYY-MM-DD" für den LOKALEN Kalendertag eines Date-Objekts - NICHT
// date.toISOString().slice(0,10) verwenden, das serialisiert nach UTC und
// verschiebt in Deutschland (UTC+1/+2) den Kalendertag um einen Tag, sobald
// ein Date auf lokale Mitternacht gesetzt ist (z.B. Kalenderzellen) oder ein
// Workout kurz nach lokaler Mitternacht stattfand. War die Ursache für
// mehrere "falscher Tag"-Bugs (Kalenderzuordnung, geplante Trainings) -
// AB JETZT IMMER localDateStr()/todayStr() für "an welchem Kalendertag ist
// das" verwenden. toISOString() bleibt nur für echte Zeitstempel (createdAt
// etc., wo es um den exakten UTC-Moment geht) korrekt.
function localDateStr(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function todayStr() {
  return localDateStr(new Date());
}


// Auch Anführungszeichen werden ersetzt: der Text steht oft in einem
// Attribut (value="..."), und ein " darin würde das Attribut vorzeitig beenden.
// Reine Textersetzung (ohne DOM), damit sie sich ohne Browser testen lässt.
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
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

