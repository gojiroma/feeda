import { highlightText } from "../highlight.js";
import { extractArticlePreview } from "../sanitize.js";
import { COLOR_BY_KEY } from "../colorPalette.js";
import {
  attachContextTrigger,
  renderColorSwatches,
  closeFloatingPopupIfMissing,
  openFloatingPopup,
} from "./colorPicker.js";
import { renderColorSwatches as renderFeedColorSwatches } from "./commonComponents.js";
import { renderEmptyHint } from "./listUtils.js";
import { createElement, createButton, setCustomProperty } from "./domUtils.js";

const COMMENT_PREVIEW_MAX_LENGTH = 60;

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function formatCommentTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP");
}

// Content of the annotate popup opened from an article row (see onAnnotate
// below and main.js's showAnnotatePopup) — a color-swatch row plus the same
// comment thread/add-form reflect's timeline shows per entry.
export function renderAnnotatePopup(container, { logEntry, onSetColor, onAddComment, autoFocus = true }) {
  container.innerHTML = "";

  const paletteRow = createElement("div", { className: "annotate-palette-row" });
  renderColorSwatches(paletteRow, { currentColor: logEntry ? logEntry.color : null, onSetColor });
  container.appendChild(paletteRow);

  const comments = logEntry ? logEntry.comments || [] : [];
  if (comments.length > 0) {
    const list = createElement("ul", { className: "reflect-comment-list" });
    for (const comment of comments) {
      const li = createElement("li", { className: "reflect-comment-item" });
      const time = createElement("span", {
        className: "reflect-comment-time",
        textContent: formatCommentTime(comment.createdAt)
      });
      li.appendChild(time);
      const text = createElement("span", {
        className: "reflect-comment-text",
        textContent: comment.text
      });
      li.appendChild(text);
      list.appendChild(li);
    }
    container.appendChild(list);
  }

  const form = createElement("form", { className: "article-annotate-form" });
  const input = createElement("input", {
    type: "text",
    className: "reflect-comment-input",
    placeholder: "コメントを追加…"
  });
  form.appendChild(input);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    onAddComment(text);
  });
  container.appendChild(form);
  if (autoFocus) input.focus();
}

// One article row — always a real link to its origin site (there's no
// in-app preview pane to read it in instead; see main.js's onOpen/openEntry)
// with a thumbnail/snippet card, same look regardless of viewport.
function buildArticleItem(entry, { feedTitleById, query, isUnread, onOpen, onAnnotate, onRowMounted, logByEntryId, showFeedName }) {
  const logEntry = logByEntryId ? logByEntryId.get(entry.id) : null;
  const comments = logEntry ? logEntry.comments || [] : [];
  const rgb = logEntry && logEntry.color && COLOR_BY_KEY.get(logEntry.color);

  const li = createElement("li", {
    dataset: { entryId: entry.id },
    className: (
      "mobile-article-item" +
      (isUnread(entry) ? " unread" : "") +
      (rgb || comments.length > 0 ? " article-item--annotated" : "") +
      (rgb ? " article-item--colored" : "")
    )
  });
  if (rgb) setCustomProperty(li, "reflect-color", rgb);

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
  title.appendChild(highlightText(entry.title || "(タイトルなし)", query));
  main.appendChild(title);

  const meta = createElement("div", { className: "article-meta" });
  const parts = [];
  if (showFeedName) parts.push(feedTitleById.get(entry.feedId) || "");
  if (entry.pubDate) parts.push(new Date(entry.pubDate).toLocaleString("ja-JP"));
  meta.textContent = parts.join(" ・ ");
  main.appendChild(meta);

  if (comments.length > 0) {
    const preview = createElement("div", {
      className: "article-comment-preview",
      textContent: `💬 ${truncate(comments[comments.length - 1].text, COMMENT_PREVIEW_MAX_LENGTH)}`
    });
    main.appendChild(preview);
  }

  if (snippet) {
    const snippetEl = createElement("div", { className: "article-snippet" });
    snippetEl.appendChild(highlightText(snippet, query));
    main.appendChild(snippetEl);
  }

  row.appendChild(main);
  li.appendChild(row);

  // Right-click (desktop) or long-press (touch) opens a combined
  // color-tag + comment popup, same as reflect's own timeline (see
  // reflect.js). Excludes the link navigation itself — attachContextTrigger
  // only fires on contextmenu/long-press, never on a plain click.
  if (onAnnotate) {
    attachContextTrigger(row, {
      onOpenRequest: (x, y) => onAnnotate(entry, x, y),
    });
  }

  onRowMounted?.(li, entry);

  return li;
}

// Groups entries by feedId, ordered by `feedOrder` (front = first) — falling
// back to first-appearance order in `entries` for any feed feedOrder doesn't
// mention. Never drops an entry: every feedId present in `entries` gets a
// group even if feedOrder is empty/missing.
function groupEntriesByFeed(entries, feedOrder) {
  const byFeed = new Map();
  for (const entry of entries) {
    if (!byFeed.has(entry.feedId)) byFeed.set(entry.feedId, []);
    byFeed.get(entry.feedId).push(entry);
  }
  const order = [...(feedOrder || [])].filter((id) => byFeed.has(id));
  for (const feedId of byFeed.keys()) {
    if (!order.includes(feedId)) order.push(feedId);
  }
  return order.map((feedId) => ({ feedId, entries: byFeed.get(feedId) }));
}

// Feed name headlining one feed's block in the grouped-by-feed rendering
// (see renderArticleList) — a plain click opens the one combined context
// menu for every per-feed action (see openFeedContextMenu below) instead of
// a scatter of always-visible buttons. Used to be right-click/long-press
// only, but the header isn't a link or anything else a click could collide
// with, so requiring the right-click gesture just made the menu harder to
// find for no benefit.
function buildFeedHeader(feedId, { feedTitleById, feedsById, feedActions }) {
  const header = createElement("div", { className: "article-feed-header" });

  const feed = feedsById ? feedsById.get(feedId) : null;
  const colorRgb = feed && feed.color && COLOR_BY_KEY.get(feed.color);
  if (colorRgb) {
    header.classList.add("article-feed-header--colored");
    setCustomProperty(header, "feed-color", colorRgb);
  }

  const title = createElement("span", {
    className: "article-feed-header-title",
    textContent: feedTitleById.get(feedId) || ""
  });
  header.appendChild(title);

  if (feed && feed.pinned) {
    const pin = createElement("span", { className: "article-feed-header-pin", html: "📌", title: "ピン留め済み" });
    header.appendChild(pin);
  }

  if (feedActions) {
    header.addEventListener("click", (ev) => openFeedContextMenu(feed || { feedId }, ev.clientX, ev.clientY, feedActions, header));
  }

  return header;
}

// One consolidated right-click/long-press menu for every per-feed action
// reachable from the article list — pin, pause/resume, opting a feed out of
// autoPauseInactiveFeeds, color, marking the whole feed read/unread, and
// copying its URL. Ported from the old sidebar's own feed context menu (see
// git history for ui/feedList.js) now that there's no sidebar to host it.
let activeMenu = null;
let activeMenuFeedId = null;
let removeOutsideListeners = null;

function closeFeedContextMenu() {
  if (removeOutsideListeners) removeOutsideListeners();
  removeOutsideListeners = null;
  if (activeMenu) activeMenu.remove();
  activeMenu = null;
  activeMenuFeedId = null;
}

function openFeedContextMenu(feed, x, y, { onTogglePause, onToggleKeep, onTogglePin, onSetColor, onMarkRead, onMarkUnread, onCopyUrl }, headerEl) {
  closeFeedContextMenu();

  const menu = createElement("div", {
    className: "feed-context-menu",
    style: { left: `${x}px`, top: `${y}px` }
  });

  if (onTogglePin) {
    menu.appendChild(createButton(
      { type: "button", className: "feed-context-menu-item", textContent: feed.pinned ? "ピン留めを解除" : "上部にピン留め" },
      () => { onTogglePin(feed.feedId); closeFeedContextMenu(); }
    ));
  }

  if (onTogglePause) {
    menu.appendChild(createButton(
      { type: "button", className: "feed-context-menu-item", textContent: feed.paused ? "更新を再開" : "更新を停止" },
      () => { onTogglePause(feed.feedId); closeFeedContextMenu(); }
    ));
  }

  if (onToggleKeep && !feed.paused) {
    menu.appendChild(createButton(
      {
        type: "button",
        className: "feed-context-menu-item",
        textContent: feed.keep ? "自動停止の対象から外している ✓" : "自動停止の対象から外す（残す）",
        title: "自動停止の対象から外します"
      },
      () => { onToggleKeep(feed.feedId); closeFeedContextMenu(); }
    ));
  }

  if (onSetColor) {
    const swatchRow = createElement("div", { className: "feed-color-swatch-row" });
    renderFeedColorSwatches(swatchRow, {
      currentColor: feed.color,
      onSetColor: (color) => { onSetColor(feed.feedId, color); closeFeedContextMenu(); },
    });
    menu.appendChild(swatchRow);
  }

  if (onMarkRead) {
    menu.appendChild(createButton(
      { type: "button", className: "feed-context-menu-item", textContent: "既読", title: "このフィードをすべて既読にします" },
      () => { onMarkRead(feed.feedId); closeFeedContextMenu(); }
    ));
  }

  if (onMarkUnread) {
    menu.appendChild(createButton(
      { type: "button", className: "feed-context-menu-item", textContent: "解除", title: "既読状態を解除し、未読に戻します" },
      () => { onMarkUnread(feed.feedId); closeFeedContextMenu(); }
    ));
  }

  if (onCopyUrl) {
    menu.appendChild(createButton(
      { type: "button", className: "feed-context-menu-item", textContent: "URLをコピー" },
      () => { onCopyUrl(feed, headerEl); closeFeedContextMenu(); }
    ));
  }

  document.body.appendChild(menu);
  activeMenu = menu;
  activeMenuFeedId = feed.feedId;

  const rect = menu.getBoundingClientRect();
  const maxLeft = window.innerWidth - rect.width - 8;
  const maxTop = window.innerHeight - rect.height - 8;
  menu.style.left = `${Math.max(8, Math.min(x, maxLeft))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, maxTop))}px`;

  setTimeout(() => {
    const onPointerDown = (ev) => {
      if (!menu.contains(ev.target)) closeFeedContextMenu();
    };
    const onKeydown = (ev) => {
      if (ev.key === "Escape") closeFeedContextMenu();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeydown, true);
    removeOutsideListeners = () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeydown, true);
    };
  }, 0);
}

export function renderArticleList(
  container,
  {
    entries,
    feedTitleById,
    query,
    isUnread,
    onOpen,
    onAnnotate,
    onRowMounted,
    logByEntryId,
    showFeedName,
    emptyHint,
    groupByFeed,
    feedOrder,
    feedsById,
    onTogglePauseFeed,
    onToggleKeepFeed,
    onTogglePinFeed,
    onSetFeedColor,
    onMarkFeedRead,
    onMarkFeedUnread,
    onCopyFeedUrl,
  }
) {
  const prevWrap = container.querySelector(".article-list-grouped");
  const prevScrollTopByFeed = new Map();
  if (prevWrap) {
    for (const block of prevWrap.querySelectorAll(".article-feed-block")) {
      const list = block.querySelector(".mobile-article-list-inner");
      if (list) prevScrollTopByFeed.set(block.dataset.feedId, list.scrollTop);
    }
  }

  container.innerHTML = "";
  // Same "don't slam shut on an unrelated redraw" rule as reflect's own
  // color picker (see reflect.js's renderReflectTimeline) — only close the
  // annotate popup once the entry it's anchored to has actually dropped out
  // of the list (feed switched away, search cleared it, ...).
  closeFloatingPopupIfMissing(new Set(entries.map((e) => e.id)));
  // Same idea as above, but for the feed context menu — only close it once
  // the feed it's anchored to has actually dropped out of the list.
  if (activeMenuFeedId !== null && !entries.some((e) => e.feedId === activeMenuFeedId)) {
    closeFeedContextMenu();
  }

  if (entries.length === 0) {
    renderEmptyHint(container, emptyHint || "記事がありません。");
    return;
  }

  const itemProps = { feedTitleById, query, isUnread, onOpen, onAnnotate, onRowMounted, logByEntryId };
  const feedActions = (onTogglePauseFeed || onToggleKeepFeed || onTogglePinFeed || onSetFeedColor || onMarkFeedRead || onMarkFeedUnread || onCopyFeedUrl)
    ? {
        onTogglePause: onTogglePauseFeed,
        onToggleKeep: onToggleKeepFeed,
        onTogglePin: onTogglePinFeed,
        onSetColor: onSetFeedColor,
        onMarkRead: onMarkFeedRead,
        onMarkUnread: onMarkFeedUnread,
        onCopyUrl: onCopyFeedUrl,
      }
    : null;

  if (groupByFeed) {
    // Each feed gets its own header (name + context menu trigger) and its
    // own <ul>, stacked via CSS — a feed's block never straddles another's,
    // so a background refetch can move a whole block to the top of the pile
    // without disturbing anything else on screen (see main.js's
    // mergeIntoUnreadTimeline).
    const wrap = createElement("div", { className: "article-list-grouped" });
    for (const { feedId, entries: feedEntries } of groupEntriesByFeed(entries, feedOrder)) {
      const block = createElement("div", {
        className: "article-feed-block",
        dataset: { feedId }
      });
      block.appendChild(buildFeedHeader(feedId, { feedTitleById, feedsById, feedActions }));

      const ul = createElement("ul", { className: "mobile-article-list-inner" });
      for (const entry of feedEntries) {
        ul.appendChild(buildArticleItem(entry, { ...itemProps, showFeedName: false }));
      }
      block.appendChild(ul);
      wrap.appendChild(block);
    }
    container.appendChild(wrap);
    for (const block of wrap.querySelectorAll(".article-feed-block")) {
      if (!prevScrollTopByFeed.has(block.dataset.feedId)) continue;
      block.querySelector(".mobile-article-list-inner").scrollTop = prevScrollTopByFeed.get(block.dataset.feedId);
    }
    return;
  }

  const ul = createElement("ul", { className: "mobile-article-list-inner" });
  for (const entry of entries) {
    ul.appendChild(buildArticleItem(entry, { ...itemProps, showFeedName }));
  }
  container.appendChild(ul);
}
