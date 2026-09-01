import { highlightText } from "../highlight.js";
import { extractArticlePreview } from "../sanitize.js";
import { COLOR_BY_KEY } from "../colorPalette.js";
import { renderColorSwatches } from "./colorPicker.js";
import { renderColorSwatches as renderFeedColorSwatches } from "./commonComponents.js";
import { renderEmptyHint } from "./listUtils.js";
import { createElement, createButton, setCustomProperty } from "./domUtils.js";

const COMMENT_PREVIEW_MAX_LENGTH = 60;

// Which entry's hover-revealed annotate section (see buildAnnotateSection)
// the pointer is currently over — tracked here at module scope, outside any
// one render, because :hover/:focus-within alone can't survive a rebuild.
// container.innerHTML = "" (see renderArticleList) destroys the hovered
// row and replaces it with a new element sitting at the same screen
// position; the browser doesn't retroactively apply :hover to that new
// element until the pointer actually moves again, so without this the
// section would flash shut — and a .focus() into its now-hidden comment
// input would silently no-op — every time picking a color or adding a
// comment triggers a re-render out from under a still-hovering mouse.
// buildArticleItem reapplies the open state at creation time for whichever
// entry this was last set to; real mouseenter/mouseleave on the fresh
// element then keep it in sync with wherever the pointer actually is.
let hoveredEntryId = null;

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function formatCommentTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP");
}

// Color-swatch row + comment thread/add-form for one article row, revealed
// on hover/focus (see .article-annotate-inline in style.css) instead of the
// right-click popup this used to be — the color tag and a quick comment are
// the most-used per-article actions, so hovering the row straight into them
// beats a separate gesture to open a menu first.
function buildAnnotateSection(logEntry, { onSetColor, onAddComment }) {
  const section = createElement("div", { className: "article-annotate-inline" });

  const paletteRow = createElement("div", { className: "annotate-palette-row" });
  renderColorSwatches(paletteRow, { currentColor: logEntry ? logEntry.color : null, onSetColor });
  section.appendChild(paletteRow);

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
    section.appendChild(list);
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
  section.appendChild(form);

  return section;
}

// One article row — always a real link to its origin site (there's no
// in-app preview pane to read it in instead; see main.js's onOpen/openEntry)
// with a thumbnail/snippet card, same look regardless of viewport.
function buildArticleItem(entry, { feedTitleById, query, isUnread, onOpen, onSetColor, onAddComment, onRowMounted, logByEntryId, showFeedName, forceOpenEntryId }) {
  const logEntry = logByEntryId ? logByEntryId.get(entry.id) : null;
  const comments = logEntry ? logEntry.comments || [] : [];
  const rgb = logEntry && logEntry.color && COLOR_BY_KEY.get(logEntry.color);
  // See hoveredEntryId above — also forced open for whichever entry had its
  // comment input focused right before this render (a comment mid-typed
  // when a re-render lands must not silently drop out of view).
  const annotateOpen = entry.id === hoveredEntryId || entry.id === forceOpenEntryId;

  const li = createElement("li", {
    dataset: { entryId: entry.id },
    className: (
      "mobile-article-item" +
      (isUnread(entry) ? " unread" : "") +
      (rgb || comments.length > 0 ? " article-item--annotated" : "") +
      (rgb ? " article-item--colored" : "") +
      (annotateOpen ? " article-item--annotate-open" : "")
    )
  });
  if (rgb) setCustomProperty(li, "reflect-color", rgb);
  if (onSetColor || onAddComment) {
    li.addEventListener("mouseenter", () => {
      hoveredEntryId = entry.id;
      li.classList.add("article-item--annotate-open");
    });
    li.addEventListener("mouseleave", () => {
      if (hoveredEntryId === entry.id) hoveredEntryId = null;
      li.classList.remove("article-item--annotate-open");
    });
  }

  const row = createElement("a", {
    className: "mobile-article-row",
    href: entry.link || "#",
    target: "_blank",
    rel: "noopener noreferrer"
  });
  row.addEventListener("click", (ev) => {
    onOpen(entry);
    // Safari can silently swallow the anchor's own target="_blank" default
    // action here: onOpen (main.js's openEntry) awaits an IndexedDB write
    // then re-renders the list (container.innerHTML = "" in
    // renderArticleList), tearing out this very <a> — and on Safari that
    // happening within the same click's processing window sometimes cancels
    // the pending new-tab navigation instead of letting it survive (Chrome/
    // Firefox don't have this problem). Opening explicitly, synchronously,
    // right here — still inside the click's own trusted user gesture —
    // sidesteps that. A modified click (cmd/ctrl/shift/alt, or a
    // middle-click) is left to the browser's native handling so
    // open-in-background-tab/open-in-new-window still work as expected.
    if (entry.link && ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      window.open(entry.link, "_blank", "noopener,noreferrer");
    }
  });

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

  // Color palette + comment form, revealed on hover/focus (see
  // .article-annotate-inline in style.css) rather than requiring a
  // right-click/long-press to open a separate popup — a sibling of `row`,
  // not nested inside it, so its buttons/input don't fight the row's own
  // whole-card link.
  if (onSetColor || onAddComment) {
    li.appendChild(
      buildAnnotateSection(logEntry, {
        onSetColor: (color) => onSetColor(entry, color),
        onAddComment: (text) => onAddComment(entry, text),
      })
    );
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

// Which feed's hover-revealed actions row (see buildFeedHeaderActions) the
// pointer is currently over — same rebuild-loses-hover problem and same fix
// as hoveredEntryId above: renderArticleList tears the whole list down and
// rebuilds it on every pin/pause/keep/color change (see refreshAfterFeedChange
// in main.js), and the browser won't retroactively apply :hover to the
// replacement header sitting under an unmoved pointer.
let hoveredFeedId = null;

// One hover-revealed icon button for a per-feed toggle (pin, pause/resume,
// keep) — active is whether the toggle is currently "on", styled to stand
// out from an "off" button sitting right next to it.
function createFeedIconButton({ icon, title, active, onClick }) {
  return createButton(
    {
      type: "button",
      className: "feed-header-icon-btn" + (active ? " active" : ""),
      textContent: icon,
      title
    },
    onClick
  );
}

// Hover-revealed row of per-feed actions living inside the feed header (see
// buildFeedHeader) — color, pin, pause/resume, keep, and copy-URL. Replaces
// the old click-to-open combined context menu: these are common enough
// actions that surfacing them straight on hover (same as the article row's
// own annotate section) beats requiring a click to open a menu first.
// Marking the whole feed read/unread deliberately isn't here — main.js
// already tracks read state per-article, via scroll (see
// handleArticleScrollIntersections), so a whole-feed shortcut for it isn't
// needed on top of that.
function buildFeedHeaderActions(feed, { onTogglePause, onToggleKeep, onTogglePin, onSetColor, onCopyUrl }, headerEl) {
  const row = createElement("div", { className: "article-feed-header-actions" });

  if (onSetColor) {
    const swatchRow = createElement("div", { className: "feed-color-swatch-row" });
    renderFeedColorSwatches(swatchRow, {
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

  if (onToggleKeep && !feed.paused) {
    row.appendChild(createFeedIconButton({
      icon: "🛡️",
      title: feed.keep ? "自動停止の対象から外している（クリックで戻す）" : "自動停止の対象から外す（残す）",
      active: feed.keep,
      onClick: () => onToggleKeep(feed.feedId),
    }));
  }

  if (onCopyUrl) {
    row.appendChild(createFeedIconButton({
      icon: "🔗",
      title: "URLをコピー",
      onClick: () => onCopyUrl(feed, headerEl),
    }));
  }

  return row;
}

// Feed name headlining one feed's block in the grouped-by-feed rendering
// (see renderArticleList) — hovering it reveals the per-feed actions row
// (see buildFeedHeaderActions) instead of requiring a click to open a
// separate context menu.
function buildFeedHeader(feedId, { feedTitleById, feedsById, feedActions }) {
  const feed = feedsById ? feedsById.get(feedId) : null;
  const actionsOpen = feedActions && (feedId === hoveredFeedId);

  const header = createElement("div", {
    className: "article-feed-header" + (actionsOpen ? " article-feed-header--actions-open" : "")
  });

  const colorRgb = feed && feed.color && COLOR_BY_KEY.get(feed.color);
  if (colorRgb) {
    header.classList.add("article-feed-header--colored");
    setCustomProperty(header, "feed-color", colorRgb);
  }

  const row = createElement("div", { className: "article-feed-header-row" });

  const title = createElement("span", {
    className: "article-feed-header-title",
    textContent: feedTitleById.get(feedId) || ""
  });
  row.appendChild(title);

  if (feed && feed.pinned) {
    const pin = createElement("span", { className: "article-feed-header-pin", html: "📌", title: "ピン留め済み" });
    row.appendChild(pin);
  }

  header.appendChild(row);

  if (feedActions) {
    header.appendChild(buildFeedHeaderActions(feed || { feedId }, feedActions, header));
    header.addEventListener("mouseenter", () => {
      hoveredFeedId = feedId;
      header.classList.add("article-feed-header--actions-open");
    });
    header.addEventListener("mouseleave", () => {
      if (hoveredFeedId === feedId) hoveredFeedId = null;
      header.classList.remove("article-feed-header--actions-open");
    });
  }

  return header;
}

// Only worth offering when the whole list already fits on screen without
// scrolling — once there's more to scroll through, reaching the bottom (see
// main.js's handleArticleListScrollBottom) already marks everything read for
// free, so a duplicate button would just be clutter competing with the
// actual articles for space.
function appendMarkAllReadButtonIfFits(container, { onMarkAllRead, hasUnreadEntries }) {
  if (!onMarkAllRead || !hasUnreadEntries) return;
  if (container.scrollHeight > container.clientHeight + 1) return;
  container.appendChild(createButton(
    { type: "button", className: "mark-all-read-btn primary", textContent: "全て既読" },
    onMarkAllRead
  ));
}

export function renderArticleList(
  container,
  {
    entries,
    feedTitleById,
    query,
    isUnread,
    onOpen,
    onSetColor,
    onAddComment,
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
    onCopyFeedUrl,
    onMarkAllRead,
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

  // Same rebuild-wipes-live-state problem reflect's own timeline redraw
  // works around (see renderReflectTimeline in reflect.js) — a comment
  // mid-typed into one row's hover-revealed form would otherwise vanish on
  // every unrelated re-render (a background feed fetch, a color/comment
  // change elsewhere in the list, ...). Only restore it onto the same
  // entry's box and only when that input still has focus.
  const focusedCommentLi = document.activeElement?.closest?.(".mobile-article-item");
  const focusedCommentInput = focusedCommentLi?.querySelector(".reflect-comment-input");
  const preservedComment =
    focusedCommentInput && document.activeElement === focusedCommentInput
      ? {
          entryId: focusedCommentLi.dataset.entryId,
          value: focusedCommentInput.value,
          selectionStart: focusedCommentInput.selectionStart,
          selectionEnd: focusedCommentInput.selectionEnd,
        }
      : null;

  container.innerHTML = "";

  if (entries.length === 0) {
    renderEmptyHint(container, emptyHint || "記事がありません。");
    return;
  }

  const itemProps = {
    feedTitleById,
    query,
    isUnread,
    onOpen,
    onSetColor,
    onAddComment,
    onRowMounted,
    logByEntryId,
    forceOpenEntryId: preservedComment?.entryId,
  };
  const feedActions = (onTogglePauseFeed || onToggleKeepFeed || onTogglePinFeed || onSetFeedColor || onCopyFeedUrl)
    ? {
        onTogglePause: onTogglePauseFeed,
        onToggleKeep: onToggleKeepFeed,
        onTogglePin: onTogglePinFeed,
        onSetColor: onSetFeedColor,
        onCopyUrl: onCopyFeedUrl,
      }
    : null;
  const hasUnreadEntries = entries.some((entry) => isUnread(entry));

  if (groupByFeed) {
    // Each feed gets its own header (name + hover-revealed actions row) and
    // its own <ul>, stacked via CSS — a feed's block never straddles another's,
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
    appendMarkAllReadButtonIfFits(container, { onMarkAllRead, hasUnreadEntries });
    restorePreservedComment(container, preservedComment);
    return;
  }

  const ul = createElement("ul", { className: "mobile-article-list-inner" });
  for (const entry of entries) {
    ul.appendChild(buildArticleItem(entry, { ...itemProps, showFeedName }));
  }
  container.appendChild(ul);
  appendMarkAllReadButtonIfFits(container, { onMarkAllRead, hasUnreadEntries });
  restorePreservedComment(container, preservedComment);
}

function restorePreservedComment(container, preservedComment) {
  if (!preservedComment) return;
  const restoredLi = container.querySelector(`.mobile-article-item[data-entry-id="${CSS.escape(preservedComment.entryId)}"]`);
  const restoredInput = restoredLi?.querySelector(".reflect-comment-input");
  if (!restoredInput) return;
  restoredInput.value = preservedComment.value;
  restoredInput.focus();
  restoredInput.setSelectionRange(preservedComment.selectionStart, preservedComment.selectionEnd);
}
