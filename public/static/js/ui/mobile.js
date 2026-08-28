import { highlightText } from "../highlight.js";
import { extractArticlePreview } from "../sanitize.js";
import { createElement } from "./domUtils.js";
import { renderEmptyHint } from "./listUtils.js";

// Small-phone layout: a single flat, cross-feed unread list \u2014 no per-feed
// navigation at all. Articles are read on their origin site: each row is a
// real link that opens in a new tab; there's no in-app preview to keep in
// sync with a separate pane.

export function renderMobileList(container, { entries, feedTitleById, query, isUnread, onOpen, onRowMounted, showFeedName, emptyHint }) {
  container.innerHTML = "";

  if (entries.length === 0) {
    renderEmptyHint(container, emptyHint || "\u8a18\u4e8b\u304c\u3042\u308a\u307e\u305b\u3093\u3002");
    return;
  }

  const ul = createElement("ul", { className: "mobile-article-list-inner" });

  for (const entry of entries) {
    const li = createElement("li", {
      className: "mobile-article-item" + (isUnread(entry) ? " unread" : "")
    });

    const row = createElement("a", {
      className: "mobile-article-row",
      href: entry.link || "#",
      target: "_blank",
      rel: "noopener noreferrer"
    });
    row.addEventListener("click", () => onOpen(entry));

    const { imageSrc, snippet } = extractArticlePreview(entry.content || entry.summary || "");

    if (imageSrc) {
      const thumb = createElement("img", {
        className: "article-thumb",
        src: imageSrc,
        alt: "",
        loading: "lazy"
      });
      row.appendChild(thumb);
    }

    const main = createElement("div", { className: "article-main" });

    const title = createElement("div", { className: "article-title" });
    title.appendChild(highlightText(entry.title || "(\u30bf\u30a4\u30c8\u30eb\u306a\u3057)", query));
    main.appendChild(title);

    const meta = createElement("div", { className: "article-meta" });
    const parts = [];
    if (showFeedName) parts.push(feedTitleById.get(entry.feedId) || "");
    if (entry.pubDate) parts.push(new Date(entry.pubDate).toLocaleString("ja-JP"));
    meta.textContent = parts.join(" \u30fb ");
    main.appendChild(meta);

    if (snippet) {
      const snippetEl = createElement("div", { className: "article-snippet" });
      snippetEl.appendChild(highlightText(snippet, query));
      main.appendChild(snippetEl);
    }

    row.appendChild(main);
    li.appendChild(row);
    ul.appendChild(li);
    onRowMounted?.(li, entry);
  }

  container.appendChild(ul);
}
