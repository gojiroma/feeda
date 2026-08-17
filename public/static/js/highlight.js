// Wraps query matches in <mark class="search-highlight"> for plain text.
export function highlightText(text, query) {
  const fragment = document.createDocumentFragment();
  if (!query) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let start = 0;
  let idx;
  while ((idx = lowerText.indexOf(lowerQuery, start)) !== -1) {
    if (idx > start) fragment.appendChild(document.createTextNode(text.slice(start, idx)));
    const mark = document.createElement("mark");
    mark.className = "search-highlight";
    mark.textContent = text.slice(idx, idx + query.length);
    fragment.appendChild(mark);
    start = idx + query.length;
  }
  fragment.appendChild(document.createTextNode(text.slice(start)));
  return fragment;
}

// Same, but walks an already-built DOM subtree (e.g. sanitized article HTML)
// and highlights matches within its text nodes without disturbing markup.
export function highlightFragment(root, query) {
  if (!query) return root;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  const lowerQuery = query.toLowerCase();
  for (const textNode of textNodes) {
    if (!textNode.textContent.toLowerCase().includes(lowerQuery)) continue;
    textNode.replaceWith(highlightText(textNode.textContent, query));
  }
  return root;
}
