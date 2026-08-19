import { sanitizeHtmlToFragment } from "../sanitize.js";
import { highlightText, highlightFragment } from "../highlight.js";

export function renderPreview(container, entry, query, { onLinkClick } = {}) {
  container.innerHTML = "";

  if (!entry) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "記事を選択してください。";
    container.appendChild(hint);
    return;
  }

  const h2 = document.createElement("h2");
  h2.className = "preview-title";
  h2.appendChild(highlightText(entry.title || "(タイトルなし)", query));
  container.appendChild(h2);

  const meta = document.createElement("div");
  meta.className = "preview-meta";
  const parts = [];
  if (entry.author) parts.push(entry.author);
  if (entry.pubDate) parts.push(new Date(entry.pubDate).toLocaleString("ja-JP"));
  meta.textContent = parts.join(" ・ ");
  container.appendChild(meta);

  if (entry.link) {
    const link = document.createElement("a");
    link.href = entry.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "preview-link";
    link.textContent = entry.link;
    if (onLinkClick) link.addEventListener("click", () => onLinkClick(entry));
    container.appendChild(link);
  }

  const body = document.createElement("div");
  body.className = "preview-body";
  const bodyFragment = sanitizeHtmlToFragment(entry.content || entry.summary || "");
  highlightFragment(bodyFragment, query);
  body.appendChild(bodyFragment);
  container.appendChild(body);
}
