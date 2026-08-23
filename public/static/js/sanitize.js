// Minimal allowlist HTML sanitizer for rendering feed article bodies, which
// come from untrusted third-party sites. Tags/attributes are allowlisted
// (not blocklisted) so anything unknown — including event-handler
// attributes and <script>/<style>/<iframe> — is stripped by default.

const ALLOWED_TAGS = new Set([
  "A", "B", "STRONG", "I", "EM", "P", "BR", "UL", "OL", "LI", "BLOCKQUOTE",
  "CODE", "PRE", "H1", "H2", "H3", "H4", "IMG", "SPAN", "DIV", "TABLE",
  "THEAD", "TBODY", "TR", "TD", "TH", "HR",
]);
const ALLOWED_ATTRS = { A: ["href"], IMG: ["src", "alt"] };
const DROP_ENTIRELY = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "FORM"]);
const UNSAFE_URI_RE = /^\s*(javascript|data|vbscript):/i;

export function sanitizeHtmlToFragment(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeContainer(template.content);
  return template.content;
}

const SNIPPET_MAX_LENGTH = 80;

// For the article list's thumbnail + lead-in snippet (see ui/articleList.js
// and ui/mobile.js) — pulled from the same allowlisted fragment
// renderPreview builds, so the <img src> and text it surfaces can't smuggle
// in anything sanitizeHtmlToFragment wouldn't already let through.
export function extractArticlePreview(html) {
  if (!html) return { imageSrc: null, snippet: "" };
  const fragment = sanitizeHtmlToFragment(html);
  const img = fragment.querySelector("img");
  const imageSrc = img ? img.getAttribute("src") : null;
  const text = fragment.textContent.replace(/\s+/g, " ").trim();
  const snippet = text.length > SNIPPET_MAX_LENGTH ? `${text.slice(0, SNIPPET_MAX_LENGTH)}…` : text;
  return { imageSrc, snippet };
}

function sanitizeContainer(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      if (DROP_ENTIRELY.has(child.tagName)) {
        child.remove();
        continue;
      }

      if (!ALLOWED_TAGS.has(child.tagName)) {
        const parent = child.parentNode;
        while (child.firstChild) parent.insertBefore(child.firstChild, child);
        parent.removeChild(child);
        stack.push(parent);
        continue;
      }

      const allowedAttrs = ALLOWED_ATTRS[child.tagName] || [];
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!allowedAttrs.includes(name)) {
          child.removeAttribute(attr.name);
        } else if ((name === "href" || name === "src") && UNSAFE_URI_RE.test(attr.value)) {
          child.removeAttribute(attr.name);
        }
      }
      if (child.tagName === "A") {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
      stack.push(child);
    }
  }
}
