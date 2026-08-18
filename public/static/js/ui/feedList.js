import { highlightText } from "../highlight.js";

const LONG_PRESS_MS = 550;

export function renderFeedList(container, { groups, totalFeedCount, selectedFeedId, query, collapsedGroups, onSelect, onHover, onTogglePause, onCopyUrl }) {
  container.innerHTML = "";

  if (typeof totalFeedCount === "number") {
    const summary = document.createElement("p");
    summary.className = "feed-list-total";
    summary.textContent = `${totalFeedCount}件のフィードを登録`;
    container.appendChild(summary);
  }

  if (groups.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent =
      totalFeedCount > 0
        ? "検索条件に一致するフィードがありません。"
        : "まだフィードが登録されていません。Tampermonkeyスクリプトで自動登録してください。";
    container.appendChild(hint);
    return;
  }

  for (const { group, feeds } of groups) {
    const details = document.createElement("details");
    details.open = !collapsedGroups.has(group.key);
    details.className = "feed-group";
    // The list is fully rebuilt on every render (see container.innerHTML
    // above), so this <details> is a brand-new element each time — the
    // Set is what actually remembers the user's manual expand/collapse
    // across renders, not the DOM node itself.
    details.addEventListener("toggle", () => {
      if (details.open) collapsedGroups.delete(group.key);
      else collapsedGroups.add(group.key);
    });

    const summary = document.createElement("summary");
    summary.textContent = `${group.label} (${feeds.length})`;
    details.appendChild(summary);

    const ul = document.createElement("ul");
    ul.className = "feed-list-group";

    for (const feed of feeds) {
      const li = document.createElement("li");
      li.className =
        "feed-item" + (feed.feedId === selectedFeedId ? " selected" : "") + (feed.paused ? " paused" : "");
      li.title = "右クリック／長押し: 取得の一時停止切替　中クリック: URLをコピー";

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

      attachFeedInteractions(li, feed, { onSelect, onHover, onTogglePause, onCopyUrl }, selectedFeedId);
      ul.appendChild(li);
    }

    details.appendChild(ul);
    container.appendChild(details);
  }
}

function attachFeedInteractions(li, feed, { onSelect, onHover, onTogglePause, onCopyUrl }, selectedFeedId) {
  let longPressTimer = null;
  let longPressTriggered = false;
  const cancelLongPress = () => clearTimeout(longPressTimer);

  li.addEventListener("click", () => {
    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }
    onSelect(feed.feedId);
  });

  // Hovering previews too (touch has no hover, so this is mouse/stylus
  // only — no need to gate on pointerType) but must NOT mark the feed's
  // newest article read — see onHover in main.js. Skipped when this feed
  // is already selected: onHover triggers a full re-render, which tears
  // down and rebuilds this <li>; without the guard, the pointer landing
  // on its own replacement would re-fire mouseenter and loop.
  li.addEventListener("mouseenter", () => {
    if (feed.feedId === selectedFeedId) return;
    onHover(feed.feedId);
  });

  li.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    onTogglePause(feed.feedId);
  });

  li.addEventListener("auxclick", (ev) => {
    if (ev.button !== 1) return;
    ev.preventDefault();
    onCopyUrl(feed, li);
  });

  // Long-press is the touch equivalent of right-click, since touchscreens
  // have no contextmenu event of their own for a custom action like this.
  li.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "touch") return;
    longPressTriggered = false;
    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      onTogglePause(feed.feedId);
    }, LONG_PRESS_MS);
  });
  li.addEventListener("pointerup", cancelLongPress);
  li.addEventListener("pointercancel", cancelLongPress);
  li.addEventListener("pointermove", cancelLongPress);
}
