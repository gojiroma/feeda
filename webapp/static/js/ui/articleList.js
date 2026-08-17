export function renderArticleList(container, { entries, feedTitleById, selectedEntryId, isUnread, onSelect, showFeedName }) {
  container.innerHTML = "";

  if (entries.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "記事がありません。";
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
    title.textContent = entry.title || "(タイトルなし)";
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
