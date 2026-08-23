import { highlightText } from "../highlight.js";
import { extractArticlePreview } from "../sanitize.js";

// Small-phone layout: a single flat, cross-feed unread list — no per-feed
// navigation at all. Articles are read on their origin site: each row is a
// real link that opens in a new tab; there's no in-app preview to keep in
// sync with a separate pane.

export function renderMobileList(container, { entries, feedTitleById, query, isUnread, onOpen, onRowMounted, showFeedName, emptyHint }) {
  container.innerHTML = "";

  if (entries.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = emptyHint || "記事がありません。";
    container.appendChild(hint);
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "mobile-article-list-inner";

  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "mobile-article-item" + (isUnread(entry) ? " unread" : "");

    const row = document.createElement("a");
    row.className = "mobile-article-row";
    row.href = entry.link || "#";
    row.target = "_blank";
    row.rel = "noopener noreferrer";
    row.addEventListener("click", () => onOpen(entry));

    const { imageSrc, snippet } = extractArticlePreview(entry.content || entry.summary || "");

    if (imageSrc) {
      const thumb = document.createElement("img");
      thumb.className = "article-thumb";
      thumb.src = imageSrc;
      thumb.alt = "";
      thumb.loading = "lazy";
      row.appendChild(thumb);
    }

    const main = document.createElement("div");
    main.className = "article-main";

    const title = document.createElement("div");
    title.className = "article-title";
    title.appendChild(highlightText(entry.title || "(タイトルなし)", query));
    main.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "article-meta";
    const parts = [];
    if (showFeedName) parts.push(feedTitleById.get(entry.feedId) || "");
    if (entry.pubDate) parts.push(new Date(entry.pubDate).toLocaleString("ja-JP"));
    meta.textContent = parts.join(" ・ ");
    main.appendChild(meta);

    if (snippet) {
      const snippetEl = document.createElement("div");
      snippetEl.className = "article-snippet";
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
