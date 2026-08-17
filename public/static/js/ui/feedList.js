import { highlightText } from "../highlight.js";

export function renderFeedList(container, { groups, selectedFeedId, query, onSelect }) {
  container.innerHTML = "";

  if (groups.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "まだフィードが登録されていません。Tampermonkeyスクリプトで自動登録してください。";
    container.appendChild(hint);
    return;
  }

  for (const { group, feeds } of groups) {
    const details = document.createElement("details");
    details.open = true;
    details.className = "feed-group";

    const summary = document.createElement("summary");
    summary.textContent = `${group.label} (${feeds.length})`;
    details.appendChild(summary);

    const ul = document.createElement("ul");
    ul.className = "feed-list-group";

    for (const feed of feeds) {
      const li = document.createElement("li");
      li.className = "feed-item" + (feed.feedId === selectedFeedId ? " selected" : "");
      li.addEventListener("click", () => onSelect(feed.feedId));

      const nameSpan = document.createElement("span");
      nameSpan.className = "feed-name";
      nameSpan.appendChild(highlightText(feed.title || feed.url, query));
      li.appendChild(nameSpan);

      if (feed.hasUnread) {
        const dot = document.createElement("span");
        dot.className = "unread-dot";
        dot.title = "未読あり";
        li.appendChild(dot);
      }

      ul.appendChild(li);
    }

    details.appendChild(ul);
    container.appendChild(details);
  }
}
