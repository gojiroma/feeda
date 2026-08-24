// `terms` accepted by highlightText/highlightFragment is either a plain
// query string (the common case — wraps every match in one class) or an
// array of { text, className } for highlighting several distinct term sets
// at once in different colors (see main.js's highlightQuery, which combines
// the live/last search query with every saved search-history keyword).
function normalizeTerms(terms) {
  if (!terms) return [];
  if (typeof terms === "string") {
    const trimmed = terms.trim();
    return trimmed ? [{ text: trimmed, className: "search-highlight" }] : [];
  }
  return terms.filter((t) => t.text && t.text.trim());
}

// Wraps matches in <mark class="...">. When multiple terms match at the
// same position, the one listed earliest in `terms` wins — callers rely on
// this to give the active search query priority over the always-on history
// highlight it's layered under (see highlightQuery).
export function highlightText(text, terms) {
  const fragment = document.createDocumentFragment();
  const activeTerms = normalizeTerms(terms);
  if (activeTerms.length === 0) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  const lowerText = text.toLowerCase();
  let pos = 0;
  while (pos < text.length) {
    let bestIdx = -1;
    let bestTerm = null;
    for (const term of activeTerms) {
      const idx = lowerText.indexOf(term.text.toLowerCase(), pos);
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
        bestIdx = idx;
        bestTerm = term;
      }
    }
    if (bestIdx === -1) break;
    if (bestIdx > pos) fragment.appendChild(document.createTextNode(text.slice(pos, bestIdx)));
    const mark = document.createElement("mark");
    mark.className = bestTerm.className;
    // Per-word color (see colorPalette.js's colorForWord) for history terms
    // — read by .search-highlight-history in style.css via rgba(var(...)),
    // same convention as --feed-color/--reflect-color elsewhere in the app.
    if (bestTerm.color) mark.style.setProperty("--search-highlight-color", bestTerm.color);
    mark.textContent = text.slice(bestIdx, bestIdx + bestTerm.text.length);
    fragment.appendChild(mark);
    pos = bestIdx + bestTerm.text.length;
  }
  if (pos < text.length) fragment.appendChild(document.createTextNode(text.slice(pos)));
  return fragment;
}

// Same, but walks an already-built DOM subtree (e.g. sanitized article HTML)
// and highlights matches within its text nodes without disturbing markup.
export function highlightFragment(root, terms) {
  const activeTerms = normalizeTerms(terms);
  if (activeTerms.length === 0) return root;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  for (const textNode of textNodes) {
    const lower = textNode.textContent.toLowerCase();
    if (!activeTerms.some((t) => lower.includes(t.text.toLowerCase()))) continue;
    textNode.replaceWith(highlightText(textNode.textContent, terms));
  }
  return root;
}
