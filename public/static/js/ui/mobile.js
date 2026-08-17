import { highlightText, highlightFragment } from "../highlight.js";
import { sanitizeHtmlToFragment } from "../sanitize.js";

// Small-phone layout: no separate feed pane — feeds are a horizontally
// scrollable strip of chips so switching feeds never means navigating up
// and back down a hierarchy. Tapping an article expands it in place
// (accordion-style) instead of opening a separate preview pane, so the
// list and the preview are the same surface.

export function renderMobileChips(container, { feeds, selectedFeedId, onSelectFeed, onSelectAll }) {
  container.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "feed-chip" + (selectedFeedId ? "" : " active");
  allChip.textContent = "すべて";
  allChip.addEventListener("click", onSelectAll);
  container.appendChild(allChip);

  for (const feed of feeds) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className =
      "feed-chip" + (feed.feedId === selectedFeedId ? " active" : "") + (feed.hasUnread ? " has-unread" : "");
    chip.textContent = feed.title || feed.url;
    chip.addEventListener("click", () => onSelectFeed(feed.feedId));
    container.appendChild(chip);
  }
}

export function renderMobileList(container, { entries, feedTitleById, expandedEntryId, query, isUnread, onToggle, showFeedName, emptyHint }) {
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
    const expanded = entry.id === expandedEntryId;

    const li = document.createElement("li");
    li.className = "mobile-article-item" + (expanded ? " expanded" : "") + (isUnread(entry) ? " unread" : "");

    const row = document.createElement("div");
    row.className = "mobile-article-row";
    row.addEventListener("click", () => onToggle(entry));

    const title = document.createElement("div");
    title.className = "article-title";
    title.appendChild(highlightText(entry.title || "(タイトルなし)", query));
    row.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "article-meta";
    const parts = [];
    if (showFeedName) parts.push(feedTitleById.get(entry.feedId) || "");
    if (entry.pubDate) parts.push(new Date(entry.pubDate).toLocaleString("ja-JP"));
    meta.textContent = parts.join(" ・ ");
    row.appendChild(meta);

    li.appendChild(row);

    if (expanded) {
      li.appendChild(renderExpandedBody(entry, query));
    }

    ul.appendChild(li);
  }

  container.appendChild(ul);
}

function renderExpandedBody(entry, query) {
  const body = document.createElement("div");
  body.className = "mobile-article-body";

  if (entry.author || entry.pubDate) {
    const meta = document.createElement("div");
    meta.className = "preview-meta";
    meta.textContent = [entry.author, entry.pubDate ? new Date(entry.pubDate).toLocaleString("ja-JP") : ""]
      .filter(Boolean)
      .join(" ・ ");
    body.appendChild(meta);
  }

  if (entry.link) {
    const link = document.createElement("a");
    link.href = entry.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "preview-link";
    link.textContent = entry.link;
    body.appendChild(link);
  }

  const content = document.createElement("div");
  content.className = "preview-body";
  const fragment = sanitizeHtmlToFragment(entry.content || entry.summary || "");
  highlightFragment(fragment, query);
  content.appendChild(fragment);
  body.appendChild(content);

  return body;
}
