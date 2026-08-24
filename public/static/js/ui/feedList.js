import { highlightText } from "../highlight.js";
import { COLOR_PALETTE, COLOR_BY_KEY } from "../colorPalette.js";

const LONG_PRESS_MS = 550;

// The filter row above the feed list (see .feed-color-filter in style.css)
// — one swatch per color that's actually tagged on some feed (no point
// offering a filter for a color nobody's used), each toggling that color's
// membership in `activeColors`. A feed shows if it matches any active
// color (see currentFeedGroups in main.js); an empty activeColors set means
// no filter, and the whole row disappears (via :empty) once nothing is
// tagged at all.
export function renderFeedColorFilter(container, { feeds, activeColors, onToggleColor }) {
  container.innerHTML = "";
  const usedColors = new Set(feeds.map((f) => f.color).filter(Boolean));
  if (usedColors.size === 0) return;

  for (const { key, rgb } of COLOR_PALETTE) {
    if (!usedColors.has(key)) continue;
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "feed-color-filter-swatch" + (activeColors.has(key) ? " selected" : "");
    swatch.style.setProperty("--feed-color", rgb);
    swatch.title = activeColors.has(key) ? "この色のフィルターを解除" : "この色のフィードだけ表示";
    swatch.setAttribute("aria-pressed", String(activeColors.has(key)));
    swatch.addEventListener("click", () => onToggleColor(key));
    container.appendChild(swatch);
  }

  if (activeColors.size > 0) {
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "feed-color-filter-clear";
    clearBtn.textContent = "×";
    clearBtn.title = "色フィルターをすべて解除";
    clearBtn.addEventListener("click", () => onToggleColor(null));
    container.appendChild(clearBtn);
  }
}

// `groups` is a two-level tree: outer entries are read-status buckets (未読
// / 既読 / 更新なし / 更新停止, see frequency.js's groupFeedsByFrequency), each holding
// its own posting-frequency breakdown as `subgroups`. Rendered as nested
// <details> so either level can be collapsed independently; collapsedGroups
// keys the status level by its own key and the frequency level by
// `${status.key}:${freqGroup.key}` (frequency keys repeat across status
// buckets, so they need the status prefix to stay distinct).
export function renderFeedList(
  container,
  {
    groups,
    totalFeedCount,
    selectedFeedId,
    query,
    collapsedGroups,
    onSelect,
    onHover,
    onTogglePause,
    onTogglePin,
    onSetColor,
    onCopyUrl,
    onSelectGroup,
    onShowAllUnread,
  }
) {
  container.innerHTML = "";
  // The menu lives in document.body (see openFeedContextMenu), so rebuilding
  // this list doesn't touch it — closing it unconditionally on every redraw
  // used to be the only thing that did. That made it slam shut mid-pick
  // during a feed crawl: refreshAll() calls render() after every feed it
  // fetches, so an open menu never survived past the next feed finishing.
  // Only close it when the feed it's anchored to has actually dropped out
  // of the list (e.g. filtered out by a search) — a menu whose feed is
  // still present stays open across an unrelated redraw.
  if (activeMenuFeedId !== null && !groups.some((g) => g.subgroups.some((sg) => sg.feeds.some((f) => f.feedId === activeMenuFeedId)))) {
    closeFeedContextMenu();
  }

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

  for (const { status, subgroups } of groups) {
    const feedCount = subgroups.reduce((n, sg) => n + sg.feeds.length, 0);

    // Sits right above the 未読 bucket so it reads as "go to the unread
    // view" rather than a generic action — the only way back to the
    // cross-feed unread timeline (see currentArticles in main.js) once a
    // feed or search has taken over the article pane, short of reloading.
    if (status.key === "unread" && onShowAllUnread) {
      const allUnreadBtn = document.createElement("button");
      allUnreadBtn.type = "button";
      allUnreadBtn.className = "feed-list-all-unread";
      allUnreadBtn.textContent = "すべての未読";
      allUnreadBtn.addEventListener("click", () => onShowAllUnread());
      container.appendChild(allUnreadBtn);
    }

    const statusDetails = document.createElement("details");
    statusDetails.open = !collapsedGroups.has(status.key);
    statusDetails.className = "feed-status-group";
    // The list is fully rebuilt on every render (see container.innerHTML
    // above), so this <details> is a brand-new element each time — the
    // Set is what actually remembers the user's manual expand/collapse
    // across renders, not the DOM node itself.
    statusDetails.addEventListener("toggle", () => {
      if (statusDetails.open) collapsedGroups.delete(status.key);
      else collapsedGroups.add(status.key);
    });

    const interactions = { onSelect, onHover, onTogglePause, onTogglePin, onSetColor, onCopyUrl };

    // A status with exactly one subgroup keyed the same as the status itself
    // is a flat, single-purpose bucket (currently just 📌 ピン留め — see
    // PINNED_STATUS/PINNED_GROUP in frequency.js) rather than a real
    // frequency breakdown: its feeds go straight under the status <details>,
    // skipping the nested frequency <details> so it doesn't show its own
    // group label repeating the status label right above it.
    const isFlatStatus = subgroups.length === 1 && subgroups[0].group.key === status.key;

    // "まとめて見る" (see onSelectGroup) is offered on a frequency subgroup
    // or the flat pinned group — a *posting-cadence or curation* grouping,
    // where "show me everything in this bucket at once" is a meaningful
    // thing to ask for. The plain status level (未読/既読/更新なし/更新停止)
    // doesn't get it: that's just this same feed list sliced by read state,
    // not a grouping worth its own combined view.
    if (isFlatStatus) {
      statusDetails.appendChild(buildGroupSummary(status.label, subgroups[0].feeds, onSelectGroup));
      statusDetails.appendChild(renderFeedItemsList(subgroups[0].feeds, { selectedFeedId, query, interactions }));
    } else {
      const plainSummary = document.createElement("summary");
      plainSummary.textContent = `${status.label} (${feedCount})`;
      statusDetails.appendChild(plainSummary);

      for (const { group, feeds } of subgroups) {
        const groupKey = `${status.key}:${group.key}`;
        const details = document.createElement("details");
        details.open = !collapsedGroups.has(groupKey);
        details.className = "feed-group";
        details.addEventListener("toggle", () => {
          if (details.open) collapsedGroups.delete(groupKey);
          else collapsedGroups.add(groupKey);
        });

        details.appendChild(buildGroupSummary(group.label, feeds, onSelectGroup));
        details.appendChild(renderFeedItemsList(feeds, { selectedFeedId, query, interactions }));
        statusDetails.appendChild(details);
      }
    }

    container.appendChild(statusDetails);
  }
}

// A group <summary> with a "まとめて見る" button alongside its label/count —
// clicking it should select the whole group's combined article list (see
// onSelectGroup in main.js), not toggle the <details> the summary itself
// belongs to, hence preventDefault (blocks the native toggle) *and*
// stopPropagation (belt and braces, since a click on a nested control
// inside <summary> still bubbles through it).
function buildGroupSummary(label, feeds, onSelectGroup) {
  const summary = document.createElement("summary");
  // The label/button pair is flexed via this inner wrapper rather than the
  // <summary> element itself — <summary> defaults to display:list-item,
  // which is what draws its native disclosure triangle; switching *it* to
  // flex drops that marker in Chrome/Firefox, so the flex row lives one
  // level in instead.
  const row = document.createElement("div");
  row.className = "feed-group-summary-row";
  const labelSpan = document.createElement("span");
  labelSpan.textContent = `${label} (${feeds.length})`;
  row.appendChild(labelSpan);

  if (onSelectGroup && feeds.length > 0) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "feed-group-view-all";
    btn.textContent = "まとめて見る";
    btn.title = "このグループの記事をまとめて表示";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onSelectGroup(feeds.map((f) => f.feedId));
    });
    row.appendChild(btn);
  }

  summary.appendChild(row);
  return summary;
}

function renderFeedItemsList(feeds, { selectedFeedId, query, interactions }) {
  const ul = document.createElement("ul");
  ul.className = "feed-list-group";

  for (const feed of feeds) {
    const li = document.createElement("li");
    li.className =
      "feed-item" + (feed.feedId === selectedFeedId ? " selected" : "") + (feed.paused ? " paused" : "");
    li.title = "右クリック／長押し: メニュー（ピン留め・更新の一時停止・色分け）　中クリック: URLをコピー";

    const colorRgb = feed.color && COLOR_BY_KEY.get(feed.color);
    if (colorRgb) {
      li.classList.add("feed-item--colored");
      li.style.setProperty("--feed-color", colorRgb);
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "feed-name";
    nameSpan.appendChild(highlightText((feed.pinned ? "📌 " : "") + (feed.title || feed.url), query));
    li.appendChild(nameSpan);

    if (feed.hasUnread) {
      const dot = document.createElement("span");
      dot.className = "unread-dot";
      dot.title = "未読あり";
      li.appendChild(dot);
    }

    attachFeedInteractions(li, feed, interactions, selectedFeedId);
    ul.appendChild(li);
  }

  return ul;
}

function attachFeedInteractions(li, feed, { onSelect, onHover, onTogglePause, onTogglePin, onSetColor, onCopyUrl }, selectedFeedId) {
  let longPressTriggered = false;

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
    openFeedContextMenu(feed, ev.clientX, ev.clientY, { onTogglePause, onTogglePin, onSetColor });
  });

  li.addEventListener("auxclick", (ev) => {
    if (ev.button !== 1) return;
    ev.preventDefault();
    onCopyUrl(feed, li);
  });

  // Touch has no hover, so without this there's no way to see what's in a
  // feed before committing to a tap (select) or a long-press (menu) — you'd
  // have to select it, look, then back out if it wasn't the one you meant.
  // Preview it (see onHover) the instant a finger touches down instead,
  // same as mouseenter does for a mouse. Skipped when this feed is already
  // selected, same reason as mouseenter's guard above.
  //
  // That preview's re-render replaces this <li> immediately though, so the
  // rest of the gesture (long-press-to-menu, tap-to-select) can't rely on
  // events still landing on this now-detached element — it's tracked via
  // document-level listeners keyed by this touch's pointerId instead, torn
  // down the moment the pointer lifts, cancels, or moves at all (same
  // threshold-free "any movement isn't a tap" rule the old per-element
  // cancel used).
  li.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "touch") return;
    longPressTriggered = false;
    const { pointerId, clientX, clientY } = ev;
    if (feed.feedId !== selectedFeedId) onHover(feed.feedId);

    let longPressTimer;
    const finish = () => {
      clearTimeout(longPressTimer);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
      document.removeEventListener("pointermove", onMove, true);
    };
    const onUp = (upEv) => {
      if (upEv.pointerId !== pointerId) return;
      finish();
      onSelect(feed.feedId);
    };
    const onCancel = (cancelEv) => {
      if (cancelEv.pointerId !== pointerId) return;
      finish();
    };
    const onMove = (moveEv) => {
      if (moveEv.pointerId !== pointerId) return;
      finish();
    };
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
    document.addEventListener("pointermove", onMove, true);

    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      finish();
      openFeedContextMenu(feed, clientX, clientY, { onTogglePause, onTogglePin, onSetColor });
    }, LONG_PRESS_MS);
  });
}

// One menu open at a time, tracked at module scope so opening a second one
// (or clicking away) always closes whatever's currently showing — mirrors
// reflect.js's color-picker singleton for the same reason. activeMenuFeedId
// lets renderFeedList (above) tell a menu that's still relevant apart from
// one left dangling by the feed it's anchored to disappearing.
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

// Right-click or long-press a feed for this menu: pin/unpin it to its own
// group at the top of the sidebar (see PINNED_STATUS in frequency.js),
// toggle whether it gets fetched at all (paused feeds sort into their own
// "更新停止" group and are skipped entirely by refreshAll), plus a row of
// color swatches to tag the feed for at-a-glance grouping in the sidebar
// (see .feed-item--colored in style.css).
function openFeedContextMenu(feed, x, y, { onTogglePause, onTogglePin, onSetColor }) {
  closeFeedContextMenu();

  const menu = document.createElement("div");
  menu.className = "feed-context-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  if (onTogglePin) {
    const pinItem = document.createElement("button");
    pinItem.type = "button";
    pinItem.className = "feed-context-menu-item";
    pinItem.textContent = feed.pinned ? "ピン留めを解除" : "上部にピン留め";
    pinItem.addEventListener("click", () => {
      onTogglePin(feed.feedId);
      closeFeedContextMenu();
    });
    menu.appendChild(pinItem);
  }

  const pauseItem = document.createElement("button");
  pauseItem.type = "button";
  pauseItem.className = "feed-context-menu-item";
  pauseItem.textContent = feed.paused ? "更新を再開" : "更新を停止";
  pauseItem.addEventListener("click", () => {
    onTogglePause(feed.feedId);
    closeFeedContextMenu();
  });
  menu.appendChild(pauseItem);

  if (onSetColor) {
    const swatchRow = document.createElement("div");
    swatchRow.className = "feed-color-swatch-row";

    for (const { key, rgb } of COLOR_PALETTE) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "feed-color-swatch" + (feed.color === key ? " selected" : "");
      swatch.style.setProperty("--feed-color", rgb);
      swatch.title = `色${key}`;
      swatch.addEventListener("click", () => {
        onSetColor(feed.feedId, key);
        closeFeedContextMenu();
      });
      swatchRow.appendChild(swatch);
    }

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "feed-color-swatch feed-color-swatch--clear" + (!feed.color ? " selected" : "");
    clearBtn.title = "色をクリア";
    clearBtn.textContent = "×";
    clearBtn.addEventListener("click", () => {
      onSetColor(feed.feedId, null);
      closeFeedContextMenu();
    });
    swatchRow.appendChild(clearBtn);

    menu.appendChild(swatchRow);
  }

  document.body.appendChild(menu);
  activeMenu = menu;
  activeMenuFeedId = feed.feedId;

  // Clamp inside the viewport now that the menu's own size is known —
  // right-clicking/long-pressing near an edge shouldn't push part of it
  // off-screen.
  const rect = menu.getBoundingClientRect();
  const maxLeft = window.innerWidth - rect.width - 8;
  const maxTop = window.innerHeight - rect.height - 8;
  menu.style.left = `${Math.max(8, Math.min(x, maxLeft))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, maxTop))}px`;

  // Deferred a tick so the very pointerdown/contextmenu that opened this
  // menu doesn't immediately bubble into the outside-click listener and
  // close it again before the user sees it.
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
