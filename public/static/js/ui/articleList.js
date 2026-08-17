import { highlightText } from "../highlight.js";

export function renderArticleList(container, { entries, feedTitleById, selectedEntryId, query, isUnread, onSelect, showFeedName, emptyHint }) {
  container.innerHTML = "";

  if (entries.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = emptyHint || "記事がありません。";
    container.appendChild(hint);
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "article-list";

  for (const entry of entries) {
    const li = document.createElement("li");
    li.className =
      "article-item" +
      (entry.id === selectedEntryId ? " selected" : "") +
      (isUnread(entry) ? " unread" : "");
    li.addEventListener("click", () => onSelect(entry));

    const title = document.createElement("div");
    title.className = "article-title";
    title.appendChild(highlightText(entry.title || "(タイトルなし)", query));
    li.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "article-meta";
    const parts = [];
    if (showFeedName) parts.push(feedTitleById.get(entry.feedId) || "");
    if (entry.pubDate) parts.push(new Date(entry.pubDate).toLocaleString("ja-JP"));
    meta.textContent = parts.join(" ・ ");
    li.appendChild(meta);

    ul.appendChild(li);
  }

  container.appendChild(ul);
}
