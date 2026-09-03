import { highlightText } from "../highlight.js";
import { COLOR_BY_KEY } from "../colorPalette.js";
import { FREQUENCY_ORDER, FREQUENCY_LABELS } from "../frequency.js";
import { renderColorSwatches } from "./commonComponents.js";
import { renderEmptyHint } from "./listUtils.js";
import { createElement, createButton, setCustomProperty } from "./domUtils.js";

// Which feed's hover-revealed actions row (see buildFeedActions) the pointer
// is currently over — same rebuild-loses-hover problem as articleList.js's
// own hoveredEntryId: renderFeedList tears the whole list down and rebuilds
// it on every pin/pause/color change, and the browser won't retroactively
// apply :hover to the replacement sitting under an unmoved pointer.
let hoveredFeedId = null;

function createFeedIconButton({ icon, title, active, onClick }) {
  return createButton(
    {
      type: "button",
      className: "feed-header-icon-btn" + (active ? " active" : ""),
      textContent: icon,
      title
    },
    (ev) => {
      ev.stopPropagation();
      onClick();
    }
  );
}

function buildFeedActions(feed, { onTogglePause, onTogglePin, onSetColor, onCopyUrl }) {
  const row = createElement("div", { className: "feed-item-actions" });

  if (onSetColor) {
    const swatchRow = createElement("div", { className: "feed-color-swatch-row" });
    renderColorSwatches(swatchRow, {
      currentColor: feed.color,
      onSetColor: (color) => onSetColor(feed.feedId, color),
    });
    row.appendChild(swatchRow);
  }

  if (onTogglePin) {
    row.appendChild(createFeedIconButton({
      icon: "📌",
      title: feed.pinned ? "ピン留めを解除" : "上部にピン留め",
      active: feed.pinned,
      onClick: () => onTogglePin(feed.feedId),
    }));
  }

  if (onTogglePause) {
    row.appendChild(createFeedIconButton({
      icon: feed.paused ? "▶️" : "⏸️",
      title: feed.paused ? "更新を再開" : "更新を停止",
      active: feed.paused,
      onClick: () => onTogglePause(feed.feedId),
    }));
  }

  if (onCopyUrl) {
    row.appendChild(createFeedIconButton({
      icon: "🔗",
      title: "URLをコピー",
      onClick: () => onCopyUrl(feed),
    }));
  }

  return row;
}

function buildFeedItem(feed, { selectedFeedId, query, interactions }) {
  const { onSelect, onTogglePause, onTogglePin, onSetColor, onCopyUrl } = interactions;
  const actionsOpen = feed.feedId === hoveredFeedId;

  const li = createElement("li", {
    className:
      "feed-item" +
      (feed.feedId === selectedFeedId ? " selected" : "") +
      (feed.paused ? " paused" : "") +
      (actionsOpen ? " feed-item--actions-open" : "")
  });

  const colorRgb = feed.color && COLOR_BY_KEY.get(feed.color);
  if (colorRgb) {
    li.classList.add("feed-item--colored");
    setCustomProperty(li, "feed-color", colorRgb);
  }

  const nameSpan = createElement("span", { className: "feed-name" });
  nameSpan.appendChild(highlightText((feed.pinned ? "📌 " : "") + (feed.title || feed.url), query));
  li.appendChild(nameSpan);

  const actions = buildFeedActions(feed, { onTogglePause, onTogglePin, onSetColor, onCopyUrl });
  li.appendChild(actions);

  li.addEventListener("click", () => onSelect(feed.feedId));
  li.addEventListener("mouseenter", () => {
    hoveredFeedId = feed.feedId;
    li.classList.add("feed-item--actions-open");
  });
  li.addEventListener("mouseleave", () => {
    if (hoveredFeedId === feed.feedId) hoveredFeedId = null;
    li.classList.remove("feed-item--actions-open");
  });

  return li;
}

// The feed list is always fully shown (no crawling/unread state to gate
// visibility on — see main.js) — pinned feeds up top, then the rest of the
// active subscriptions broken into their posting-frequency groups (see
// frequency.js — computed from a feed's own cached entries once it's
// actually been fetched at least once, most-frequent-first), and paused
// ("更新停止") feeds sunk to their own section at the bottom so they're out
// of the way without disappearing.
export function renderFeedList(container, { feeds, selectedFeedId, query, onSelect, onTogglePause, onTogglePin, onSetColor, onCopyUrl }) {
  container.innerHTML = "";

  if (feeds.length === 0) {
    renderEmptyHint(container, "まだフィードが登録されていません。Tampermonkeyスクリプトで自動登録してください。");
    return;
  }

  const interactions = { onSelect, onTogglePause, onTogglePin, onSetColor, onCopyUrl };
  const byTitle = (a, b) => (a.title || a.url).localeCompare(b.title || b.url, "ja");

  const pinned = feeds.filter((f) => f.pinned && !f.paused).sort(byTitle);
  const active = feeds.filter((f) => !f.pinned && !f.paused).sort(byTitle);
  const paused = feeds.filter((f) => f.paused).sort(byTitle);

  function appendSection(label, sectionFeeds) {
    if (sectionFeeds.length === 0) return;
    if (label) {
      container.appendChild(createElement("div", { className: "feed-list-section-label", textContent: label }));
    }
    const ul = createElement("ul", { className: "feed-list-group" });
    for (const feed of sectionFeeds) {
      ul.appendChild(buildFeedItem(feed, { selectedFeedId, query, interactions }));
    }
    container.appendChild(ul);
  }

  appendSection(pinned.length > 0 ? "📌 ピン留め" : null, pinned);

  const activeByGroup = new Map();
  for (const feed of active) {
    const key = feed.frequencyGroup || "unknown";
    if (!activeByGroup.has(key)) activeByGroup.set(key, []);
    activeByGroup.get(key).push(feed);
  }
  for (const key of FREQUENCY_ORDER) {
    appendSection(FREQUENCY_LABELS.get(key), activeByGroup.get(key) || []);
  }

  appendSection(paused.length > 0 ? "更新停止" : null, paused);
}
