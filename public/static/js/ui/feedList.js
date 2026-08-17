export function renderFeedList(container, { groups, selectedFeedId, onSelect, onMarkAllRead, onDeleteFeed }) {
  container.innerHTML = "";

  if (groups.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = "まだフィードが登録されていません。上のフォームから追加するか、Tampermonkeyスクリプトで自動登録してください。";
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
      nameSpan.textContent = feed.title || feed.url;
      li.appendChild(nameSpan);

      if (feed.unreadCount > 0) {
        const badge = document.createElement("span");
        badge.className = "unread-badge";
        badge.textContent = String(feed.unreadCount);
        li.appendChild(badge);
      }

      const actions = document.createElement("span");
      actions.className = "feed-actions";

      const readBtn = document.createElement("button");
      readBtn.type = "button";
      readBtn.textContent = "既読";
      readBtn.title = "すべて既読にする";
      readBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onMarkAllRead(feed.feedId);
      });
      actions.appendChild(readBtn);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "×";
      delBtn.title = "購読解除";
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onDeleteFeed(feed.feedId);
      });
      actions.appendChild(delBtn);

      li.appendChild(actions);
      ul.appendChild(li);
    }

    details.appendChild(ul);
    container.appendChild(details);
  }
}
