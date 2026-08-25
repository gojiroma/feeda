import { highlightText } from "../highlight.js";
import { COLOR_BY_KEY } from "../colorPalette.js";
import {
  attachContextTrigger,
  renderColorSwatches,
  renderTagEditor,
  closeFloatingPopupIfMissing,
  openFloatingPopup,
} from "./colorPicker.js";

const COMMENT_PREVIEW_MAX_LENGTH = 60;

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function formatCommentTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP");
}

// Content of the annotate popup opened from an article row (see onAnnotate
// above and main.js's showAnnotatePopup) — a color-swatch row plus the same
// comment thread/add-form reflect's timeline shows per entry. Also reused
// as-is for the always-visible copy under the preview pane's body (see
// preview.js's renderPreview) — the only difference there is autoFocus:
// false, since that copy redraws on every app render (a hovered article,
// a background refetch, ...) and stealing focus back into its comment
// input each time would make it unusable while the popup's one-shot open
// wants exactly that. logEntry may be null there too (previewing/hovering
// an entry doesn't log it until the user actually acts on it — see
// ensureLogEntryForEntry in main.js), so this renders an empty/uncolored
// state rather than assuming one already exists.
export function renderAnnotatePopup(container, { logEntry, onSetColor, onAddComment, onAddTag, onRemoveTag, autoFocus = true }) {
  container.innerHTML = "";

  // Color swatches, existing tag chips, and the "add a tag" input all flow
  // into one wrapping row instead of stacking as separate sections — a
  // color and a tag are both just "a quick mark on this article", so
  // they read as one compact palette rather than a multi-step form.
  const paletteRow = document.createElement("div");
  paletteRow.className = "annotate-palette-row";
  renderColorSwatches(paletteRow, { currentColor: logEntry ? logEntry.color : null, onSetColor });
  if (onAddTag && onRemoveTag) {
    renderTagEditor(paletteRow, { tags: logEntry ? logEntry.tags || [] : [], onAddTag, onRemoveTag });
  }
  container.appendChild(paletteRow);

  const comments = logEntry ? logEntry.comments || [] : [];
  if (comments.length > 0) {
    const list = document.createElement("ul");
    list.className = "reflect-comment-list";
    for (const comment of comments) {
      const li = document.createElement("li");
      li.className = "reflect-comment-item";
      const time = document.createElement("span");
      time.className = "reflect-comment-time";
      time.textContent = formatCommentTime(comment.createdAt);
      li.appendChild(time);
      const text = document.createElement("span");
      text.className = "reflect-comment-text";
      text.textContent = comment.text;
      li.appendChild(text);
      list.appendChild(li);
    }
    container.appendChild(list);
  }

  const form = document.createElement("form");
  form.className = "article-annotate-form";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "reflect-comment-input";
  input.placeholder = "コメントを追加…";
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

function buildArticleItem(entry, { feedTitleById, selectedEntryId, query, isUnread, onSelect, onHover, onAnnotate, logByEntryId, showFeedName }) {
  const logEntry = logByEntryId ? logByEntryId.get(entry.id) : null;
  const comments = logEntry ? logEntry.comments || [] : [];
  const tags = logEntry ? logEntry.tags || [] : [];
  const rgb = logEntry && logEntry.color && COLOR_BY_KEY.get(logEntry.color);

  const li = document.createElement("li");
  li.className =
    "article-item" +
    (entry.id === selectedEntryId ? " selected" : "") +
    (isUnread(entry) ? " unread" : "") +
    // Colored and/or commented from reflect (or right here — see
    // onAnnotate below) stand out from the rest of the list: a left
    // border/background tint for the color, both alone if there's no
    // color but a comment exists.
    (rgb || comments.length > 0 || tags.length > 0 ? " article-item--annotated" : "") +
    (rgb ? " article-item--colored" : "");
  if (rgb) li.style.setProperty("--reflect-color", rgb);
  li.addEventListener("click", () => onSelect(entry));
  // Hovering previews too (touch has no hover, so this is mouse/stylus
  // only) but must NOT mark the entry read — see onHover in main.js.
  // Skipped when this entry is already selected: onHover triggers a full
  // re-render, which tears down and rebuilds this <li>; without the
  // guard, the pointer landing on its own replacement would re-fire
  // mouseenter and loop.
  li.addEventListener("mouseenter", () => {
    if (entry.id === selectedEntryId) return;
    onHover(entry);
  });

  // No thumbnail, snippet, or timestamp here (unlike ui/mobile.js's own row
  // renderer) — this list always sits next to a preview pane (3-pane and
  // wide-grid both keep one; see renderDesktop/renderWideGrid), so the
  // title alone is enough to scan and everything past it is one hover/click
  // away. feedTitleById still shows when showFeedName is set (search
  // results mixing several feeds, where there's no per-block header to
  // supply that context another way — see groupByFeed above).
  const main = document.createElement("div");
  main.className = "article-main";

  const title = document.createElement("div");
  title.className = "article-title";
  title.appendChild(highlightText(entry.title || "(タイトルなし)", query));
  main.appendChild(title);

  if (showFeedName) {
    const meta = document.createElement("div");
    meta.className = "article-meta";
    meta.textContent = feedTitleById.get(entry.feedId) || "";
    main.appendChild(meta);
  }

  if (comments.length > 0) {
    const preview = document.createElement("div");
    preview.className = "article-comment-preview";
    preview.textContent = `💬 ${truncate(comments[comments.length - 1].text, COMMENT_PREVIEW_MAX_LENGTH)}`;
    main.appendChild(preview);
  }

  if (tags.length > 0) {
    const tagRow = document.createElement("div");
    tagRow.className = "tag-chip-row tag-chip-row--display";
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "tag-chip tag-chip--display";
      chip.textContent = tag;
      tagRow.appendChild(chip);
    }
    main.appendChild(tagRow);
  }

  li.appendChild(main);

  // Right-click (desktop) or long-press (touch) opens a combined
  // color-tag + comment popup — same interaction reflect's own timeline
  // uses (see reflect.js), but reachable straight from the news list. Not
  // a hover-revealed inline form: unlike reflect's timeline, this list
  // marks read on hover-triggered re-renders (see onHover above), and a
  // form whose visibility (and thus this row's height) changed on hover
  // would reflow the rows below it under a still-stationary cursor,
  // cascading into their mouseenter firing too — see .article-item's own
  // comment in style.css. A floating, position-fixed popup never touches
  // this row's layout, so it sidesteps that entirely.
  if (onAnnotate) {
    attachContextTrigger(li, {
      onOpenRequest: (x, y) => onAnnotate(entry, x, y),
    });
  }

  return li;
}

// Groups entries by feedId, ordered by `feedOrder` (front = first) — falling
// back to first-appearance order in `entries` for any feed feedOrder doesn't
// mention (a feed that gained entries between feedOrder being computed and
// this render, or no feedOrder at all). Never drops an entry: every feedId
// present in `entries` gets a group even if feedOrder is empty/missing.
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

// Feed name + one action button headlining one feed's block in the
// grouped-by-feed rendering (see renderArticleList's groupByFeed) — reached
// straight from the cross-feed unread view/wide-grid columns while reading,
// without a trip to the sidebar's context menu. Which action depends on the
// feed's current state (see main.js's autoPauseInactiveFeeds/toggleKeepFeed):
// an already-paused feed only offers "再開" (resume), since stopping itself
// is handled automatically now rather than by hand; an active feed offers
// "残す" (keep) instead of a stop button — vouching for a feed is the rarer,
// deliberate action worth a click, letting the rule-driven default quietly
// handle the far more common case of a high-frequency feed nobody's
// actually reading.
function buildFeedHeader(feedId, { feedTitleById, feedsById, onTogglePauseFeed, onToggleKeepFeed, onTogglePinFeed, onSetFeedColor }) {
  const header = document.createElement("div");
  header.className = "article-feed-header";

  const feed = feedsById ? feedsById.get(feedId) : null;
  const colorRgb = feed && feed.color && COLOR_BY_KEY.get(feed.color);
  if (colorRgb) {
    header.classList.add("article-feed-header--colored");
    header.style.setProperty("--feed-color", colorRgb);
  }

  const title = document.createElement("span");
  title.className = "article-feed-header-title";
  title.textContent = feedTitleById.get(feedId) || "";
  header.appendChild(title);

  // Right-click/long-press the feed name to tag its color right from the
  // unread view — same swatch popup as reflect's own picker/the article
  // annotate popup (see .annotate-palette-row), just for a whole feed
  // instead of one entry, and reachable without a trip to the sidebar's
  // context menu (see openFeedContextMenu in ui/feedList.js).
  if (onSetFeedColor) {
    attachContextTrigger(title, {
      onOpenRequest: (x, y) => {
        openFloatingPopup({
          id: `feed-color:${feedId}`,
          x,
          y,
          className: "annotate-palette-row annotate-palette-popup",
          build: (popup) => {
            renderColorSwatches(popup, {
              currentColor: feed ? feed.color : null,
              onSetColor: (color) => onSetFeedColor(feedId, color),
            });
          },
        });
      },
    });
  }

  // Independent of paused/keep (see togglePinFeed in main.js) — pins the
  // feed to its own group at the top of the sidebar, so it's offered
  // alongside whichever of 再開/残す applies rather than replacing either.
  if (onTogglePinFeed) {
    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "article-feed-header-pin-btn" + (feed && feed.pinned ? " article-feed-header-pin-btn--active" : "");
    pinBtn.textContent = "📌";
    pinBtn.title = feed && feed.pinned ? "ピン留めを解除" : "上部にピン留め";
    pinBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onTogglePinFeed(feedId);
    });
    header.appendChild(pinBtn);
  }

  if (feed && feed.paused && onTogglePauseFeed) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "article-feed-header-pause-btn";
    btn.textContent = "再開";
    btn.title = "このフィードの取得を再開します";
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onTogglePauseFeed(feedId);
    });
    header.appendChild(btn);
  } else if (onToggleKeepFeed) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "article-feed-header-pause-btn" + (feed && feed.keep ? " article-feed-header-pause-btn--active" : "");
    btn.textContent = feed && feed.keep ? "残す ✓" : "残す";
    btn.title = "自動停止の対象から外します";
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onToggleKeepFeed(feedId);
    });
    header.appendChild(btn);
  }

  return header;
}

export function renderArticleList(
  container,
  {
    entries,
    feedTitleById,
    selectedEntryId,
    query,
    isUnread,
    onSelect,
    onHover,
    onAnnotate,
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
  }
) {
  // Wide-grid mode's columns (and, in principle, the vertical grouped view
  // too) scroll independently of the rest of the page — but every render
  // wipes and rebuilds the whole container (innerHTML = "" below), and
  // render() runs on every hover (see previewEntryAndMarkRead in main.js),
  // not just on an actual click. Without capturing and restoring these, just
  // moving the mouse across a column snapped its horizontal scroll (and
  // every column's own vertical scroll) back to zero on every single row.
  const prevWrap = container.querySelector(".article-list-grouped");
  const prevScrollLeft = prevWrap ? prevWrap.scrollLeft : 0;
  const prevScrollTopByFeed = new Map();
  if (prevWrap) {
    for (const block of prevWrap.querySelectorAll(".article-feed-block")) {
      const list = block.querySelector(".article-list");
      if (list) prevScrollTopByFeed.set(block.dataset.feedId, list.scrollTop);
    }
  }

  container.innerHTML = "";
  // Same "don't slam shut on an unrelated redraw" rule as reflect's own
  // color picker (see reflect.js's renderReflectTimeline) — only close the
  // annotate popup once the entry it's anchored to has actually dropped out
  // of the list (feed switched away, search cleared it, ...).
  closeFloatingPopupIfMissing(new Set(entries.map((e) => e.id)));

  if (entries.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = emptyHint || "記事がありません。";
    container.appendChild(hint);
    return;
  }

  const itemProps = { feedTitleById, selectedEntryId, query, isUnread, onSelect, onHover, onAnnotate, logByEntryId };

  if (groupByFeed) {
    // Each feed gets its own header (name + pause button) and its own <ul>,
    // stacked or laid out side by side purely via CSS (see .article-list-
    // grouped and its wide-grid-mode override in style.css) — a feed's block
    // never straddles another's, so a background refetch can move a whole
    // block to the top of the pile without disturbing anything else on
    // screen (see main.js's mergeIntoUnreadTimeline).
    const wrap = document.createElement("div");
    wrap.className = "article-list-grouped";
    for (const { feedId, entries: feedEntries } of groupEntriesByFeed(entries, feedOrder)) {
      const block = document.createElement("div");
      block.className = "article-feed-block";
      block.dataset.feedId = feedId;
      block.appendChild(
        buildFeedHeader(feedId, { feedTitleById, feedsById, onTogglePauseFeed, onToggleKeepFeed, onTogglePinFeed, onSetFeedColor })
      );

      const ul = document.createElement("ul");
      ul.className = "article-list";
      for (const entry of feedEntries) {
        ul.appendChild(buildArticleItem(entry, { ...itemProps, showFeedName: false }));
      }
      block.appendChild(ul);
      wrap.appendChild(block);
    }
    container.appendChild(wrap);
    // Only meaningful once the new elements are actually laid out in the
    // document — an unattached node's scrollHeight is always 0, which would
    // clamp any restore attempted before this back down to nothing.
    wrap.scrollLeft = prevScrollLeft;
    for (const block of wrap.querySelectorAll(".article-feed-block")) {
      if (!prevScrollTopByFeed.has(block.dataset.feedId)) continue;
      block.querySelector(".article-list").scrollTop = prevScrollTopByFeed.get(block.dataset.feedId);
    }
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "article-list";
  for (const entry of entries) {
    ul.appendChild(buildArticleItem(entry, { ...itemProps, showFeedName }));
  }
  container.appendChild(ul);
}
