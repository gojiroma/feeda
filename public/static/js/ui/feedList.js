import { highlightText } from "../highlight.js";
import { COLOR_PALETTE, COLOR_BY_KEY } from "../colorPalette.js";
import { renderTagEditor } from "./commonComponents.js";
import { renderEmptyHint } from "./listUtils.js";
import { createElement, createButton, setCustomProperty } from "./domUtils.js";

const LONG_PRESS_MS = 550;

// The filter row above the feed list (see .feed-color-filter in style.css)
// \u2014 one swatch per color that's actually tagged on some feed (no point
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
    const swatch = createButton(
      {
        type: "button",
        className: "feed-color-filter-swatch" + (activeColors.has(key) ? " selected" : ""),
        style: { "--feed-color": rgb },
        title: activeColors.has(key) ? "\u3053\u306e\u8272\u306e\u30d5\u30a3\u30eb\u30bf\u30fc\u3092\u89e3\u9664" : "\u3053\u306e\u8272\u306e\u30d5\u30a3\u30eb\u30c9\u3060\u3051\u8868\u793a",
        dataset: { color: key }
      },
      () => onToggleColor(key)
    );
    container.appendChild(swatch);
  }

  if (activeColors.size > 0) {
    const clearBtn = createButton(
      {
        type: "button",
        className: "feed-color-filter-clear",
        textContent: "\u00d7",
        title: "\u8272\u30d5\u30a3\u30eb\u30bf\u30fc\u3092\u3059\u3079\u3066\u89e3\u9664"
      },
      () => onToggleColor(null)
    );
    container.appendChild(clearBtn);
  }
}

// `groups` is a two-level tree: outer entries are read-status buckets (\u672a\u8aad
// / \u65e2\u8aad / \u66f4\u65b0\u306a\u3057 / \u66f4\u65b0\u505c\u6b66, see frequency.js's groupFeedsByFrequency), each holding
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
    onAddFeedTag,
    onRemoveFeedTag,
    onCopyUrl,
    onSelectGroup,
    onShowAllUnread,
  }
) {
  container.innerHTML = "";
  // The menu lives in document.body (see openFeedContextMenu), so rebuilding
  // this list doesn't touch it \u2014 closing it unconditionally on every redraw
  // used to be the only thing that did. That made it slam shut mid-pick
  // during a feed crawl: refreshAll() calls render() after every feed it
  // fetches, so an open menu never survived past the next feed finishing.
  // Only close it when the feed it's anchored to has actually dropped out
  // of the list (e.g. filtered out by a search) \u2014 a menu whose feed is
  // still present stays open across an unrelated redraw.
  if (activeMenuFeedId !== null && !groups.some((g) => g.subgroups.some((sg) => sg.feeds.some((f) => f.feedId === activeMenuFeedId)))) {
    closeFeedContextMenu();
  }

  // The single highest-priority entry in the whole tree \u2014 go back to the
  // cross-feed unread timeline (see currentArticles in main.js), the one
  // thing every other row here is subordinate to. Pinned to the very top
  // rather than tucked in front of the \u672a\u8aad bucket further down (its
  // previous spot): that placement made it read as just one more line in
  // the tree instead of the primary way back once a feed or search has
  // taken over the article pane. Shown regardless of whether groups is
  // empty (a search with no feed matches, or a fresh install) \u2014 it's
  // still the fastest way back to "nothing selected".
  if (onShowAllUnread) {
    const allUnreadBtn = createButton(
      {
        type: "button",
        className: "feed-list-all-unread",
        html: "\ud83d\udce5 \u3059\u3079\u3066\u306e\u672a\u8aad"
      },
      () => onShowAllUnread()
    );
    container.appendChild(allUnreadBtn);
  }

  if (groups.length === 0) {
    renderEmptyHint(
      container,
      totalFeedCount > 0
        ? "\u691c\u7d22\u6761\u4ef6\u306b\u4e00\u81f4\u3059\u308b\u30d5\u30a3\u30fc\u30c9\u304c\u3042\u308a\u307e\u305b\u3093\u3002"
        : "\u307e\u3060\u30d5\u30a3\u30fc\u30c9\u304c\u767b\u9332\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002Tampermonkey\u30b9\u30af\u30ea\u30d7\u30c8\u3067\u81ea\u52d5\u767b\u9332\u3057\u3066\u304f\u3060\u3055\u3044\u3002"
    );
    return;
  }

  for (const { status, subgroups } of groups) {
    const feedCount = subgroups.reduce((n, sg) => n + sg.feeds.length, 0);

    const statusDetails = createElement("details", {
      open: !collapsedGroups.has(status.key),
      className: "feed-status-group"
    });
    // The list is fully rebuilt on every render (see container.innerHTML
    // above), so this <details> is a brand-new element each time \u2014 the
    // Set is what actually remembers the user's manual expand/collapse
    // across renders, not the DOM node itself.
    statusDetails.addEventListener("toggle", () => {
      if (statusDetails.open) collapsedGroups.delete(status.key);
      else collapsedGroups.add(status.key);
    });

    const interactions = { onSelect, onHover, onTogglePause, onTogglePin, onSetColor, onAddFeedTag, onRemoveFeedTag, onCopyUrl };

    // A status with exactly one subgroup keyed the same as the status itself
    // is a flat, single-purpose bucket (currently just \ud83d\udcca \u30d4\u30f3\u7559\u3081 \u2014 see
    // PINNED_STATUS/PINNED_GROUP in frequency.js) rather than a real
    // frequency breakdown: its feeds go straight under the status <details>,
    // skipping the nested frequency <details> so it doesn't show its own
    // group label repeating the status label right above it.
    const isFlatStatus = subgroups.length === 1 && subgroups[0].group.key === status.key;

    // "\u307e\u3068\u3081\u3066\u898b\u308b" (see onSelectGroup) is offered on a frequency subgroup
    // or the flat pinned group \u2014 a *posting-cadence or curation* grouping,
    // where "show me everything in this bucket at once" is a meaningful
    // thing to ask for. The plain status level (\u672a\u8aad/\u65e2\u8aad/\u66f4\u65b0\u306a\u3057/\u66f4\u65b0\u505c\u6b66)
    // doesn't get it: that's just this same feed list sliced by read state,
    // not a grouping worth its own combined view.
    if (isFlatStatus) {
      statusDetails.appendChild(buildGroupSummary(status.label, subgroups[0].feeds, onSelectGroup));
      statusDetails.appendChild(renderFeedItemsList(subgroups[0].feeds, { selectedFeedId, query, interactions }));
    } else {
      const plainSummary = createElement("summary", {
        textContent: `${status.label} (${feedCount})`
      });
      statusDetails.appendChild(plainSummary);

      for (const { group, feeds } of subgroups) {
        const groupKey = `${status.key}:${group.key}`;
        const details = createElement("details", {
          open: !collapsedGroups.has(groupKey),
          className: "feed-group"
        });
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

// A group <summary> with a "\u307e\u3068\u3081\u3066\u898b\u308b" button alongside its label/count \u2014
// clicking it should select the whole group's combined article list (see
// onSelectGroup in main.js), not toggle the <details> the summary itself
// belongs to, hence preventDefault (blocks the native toggle) *and*
// stopPropagation (belt and braces, since a click on a nested control
// inside <summary> still bubbles through it).
function buildGroupSummary(label, feeds, onSelectGroup) {
  const summary = createElement("summary");
  // The label/button pair is flexed via this inner wrapper rather than the
  // <summary> element itself \u2014 <summary> defaults to display:list-item,
  // which is what draws its native disclosure triangle; switching *it* to
  // flex drops that marker in Chrome/Firefox, so the flex row lives one
  // level in instead.
  const row = createElement("div", { className: "feed-group-summary-row" });
  const labelSpan = createElement("span", { textContent: `${label} (${feeds.length})` });
  row.appendChild(labelSpan);

  if (onSelectGroup && feeds.length > 0) {
    const btn = createButton(
      {
        type: "button",
        className: "feed-group-view-all",
        textContent: "\u307e\u3068\u3081\u3066\u898b\u308b",
        title: "\u3053\u306e\u30b0\u30eb\u30fc\u30d7\u306e\u8a18\u4e8b\u3092\u307e\u3068\u3081\u3066\u8868\u793a"
      },
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        onSelectGroup(feeds.map((f) => f.feedId));
      }
    );
    row.appendChild(btn);
  }

  summary.appendChild(row);
  return summary;
}

function renderFeedItemsList(feeds, { selectedFeedId, query, interactions }) {
  const ul = createElement("ul", { className: "feed-list-group" });

  for (const feed of feeds) {
    const li = createElement("li", {
      className: "feed-item" + 
        (feed.feedId === selectedFeedId ? " selected" : "") + 
        (feed.paused ? " paused" : ""),
      title: "\u53f3\u30af\u30ea\u30c3\u30af\u3001\u9577\u62bc\u3057: \u30e1\u30cb\u30e5\u30fc\u3008\u30d4\u30f3\u7559\u3081\u3001\u66f4\u65b0\u306e\u4e00\u6642\u505c\u6b66\u3001\u8272\u5206\u3051\u3009\u3000\u4e2d\u30af\u30ea\u30c3\u30af: URL\u3092\u30b3\u30d4\u30fc"
    });

    const colorRgb = feed.color && COLOR_BY_KEY.get(feed.color);
    if (colorRgb) {
      li.classList.add("feed-item--colored");
      setCustomProperty(li, "feed-color", colorRgb);
    }

    const nameSpan = createElement("span", { className: "feed-name" });
    nameSpan.appendChild(highlightText((feed.pinned ? "\ud83d\udccc " : "") + (feed.title || feed.url), query));
    li.appendChild(nameSpan);

    if (feed.hasUnread) {
      const dot = createElement("span", {
        className: "unread-dot",
        title: "\u672a\u8aad\u3042\u308a"
      });
      li.appendChild(dot);
    }

    if (feed.tags && feed.tags.length > 0) {
      const tagRow = createElement("div", { className: "tag-chip-row tag-chip-row--display" });
      for (const tag of feed.tags) {
        const chip = createElement("span", {
          className: "tag-chip tag-chip--display",
          textContent: tag
        });
        tagRow.appendChild(chip);
      }
      li.appendChild(tagRow);
    }

    attachFeedInteractions(li, feed, interactions, selectedFeedId);
    ul.appendChild(li);
  }

  return ul;
}

function attachFeedInteractions(
  li,
  feed,
  { onSelect, onHover, onTogglePause, onTogglePin, onSetColor, onAddFeedTag, onRemoveFeedTag, onCopyUrl },
  selectedFeedId
) {
  let longPressTriggered = false;

  li.addEventListener("click", () => {
    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }
    onSelect(feed.feedId);
  });

  // Hovering previews too (touch has no hover, so this is mouse/stylus
  // only \u2014 no need to gate on pointerType) but must NOT mark the feed's
  // newest article read \u2014 see onHover in main.js. Skipped when this feed
  // is already selected: onHover triggers a full re-render, which tears
  // down and rebuilds this <li>; without the guard, the pointer landing
  // on its own replacement would re-fire mouseenter and loop.
  li.addEventListener("mouseenter", () => {
    if (feed.feedId === selectedFeedId) return;
    onHover(feed.feedId);
  });

  li.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    openFeedContextMenu(feed, ev.clientX, ev.clientY, { onTogglePause, onTogglePin, onSetColor, onAddFeedTag, onRemoveFeedTag });
  });

  li.addEventListener("auxclick", (ev) => {
    if (ev.button !== 1) return;
    ev.preventDefault();
    onCopyUrl(feed, li);
  });

  // Touch has no hover, so without this there's no way to see what's in a
  // feed before committing to a tap (select) or a long-press (menu) \u2014 you'd
  // have to select it, look, then back out if it wasn't the one you meant.
  // Preview it (see onHover) the instant a finger touches down instead,
  // same as mouseenter does for a mouse. Skipped when this feed is already
  // selected, same reason as mouseenter's guard above.
  //
  // That preview's re-render replaces this <li> immediately though, so the
  // rest of the gesture (long-press-to-menu, tap-to-select) can't rely on
  // events still landing on this now-detached element \u2014 it's tracked via
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
      openFeedContextMenu(feed, clientX, clientY, { onTogglePause, onTogglePin, onSetColor, onAddFeedTag, onRemoveFeedTag });
    }, LONG_PRESS_MS);
  });
}

// One menu open at a time, tracked at module scope so opening a second one
// (or clicking away) always closes whatever's currently showing \u2014 mirrors
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
// "\u66f4\u65b0\u505c\u6b66" group and are skipped entirely by refreshAll), plus a row of
// color swatches to tag the feed for at-a-glance grouping in the sidebar
// (see .feed-item--colored in style.css).
function openFeedContextMenu(feed, x, y, { onTogglePause, onTogglePin, onSetColor, onAddFeedTag, onRemoveFeedTag }) {
  closeFeedContextMenu();

  const menu = createElement("div", {
    className: "feed-context-menu",
    style: { left: `${x}px`, top: `${y}px` }
  });
  
  // Tags (unlike pin/pause/color) don't close the menu on every action \u2014
  // adding several in a row is the common case, so the tag section below
  // redraws itself in place instead, mirroring main.js's showAnnotatePopup.
  let currentFeed = feed;
  const draw = () => {
    menu.innerHTML = "";

    if (onTogglePin) {
      const pinItem = createButton(
        {
          type: "button",
          className: "feed-context-menu-item",
          textContent: currentFeed.pinned ? "\u30d4\u30f3\u7559\u3081\u3092\u89e3\u9664" : "\u4e0a\u90e8\u306b\u30d4\u30f3\u7559\u3081"
        },
        () => {
          onTogglePin(currentFeed.feedId);
          closeFeedContextMenu();
        }
      );
      menu.appendChild(pinItem);
    }

    const pauseItem = createButton(
      {
        type: "button",
        className: "feed-context-menu-item",
        textContent: currentFeed.paused ? "\u66f4\u65b0\u3092\u518d\u958b" : "\u66f4\u65b0\u3092\u505c\u6b66"
      },
      () => {
        onTogglePause(currentFeed.feedId);
        closeFeedContextMenu();
      }
    );
    menu.appendChild(pauseItem);

    if (onSetColor) {
      const swatchRow = createElement("div", { className: "feed-color-swatch-row" });

      for (const { key, rgb } of COLOR_PALETTE) {
        const swatch = createButton(
          {
            type: "button",
            className: "feed-color-swatch" + (currentFeed.color === key ? " selected" : ""),
            style: { "--feed-color": rgb },
            title: `\u8272${key}`
          },
          () => {
            onSetColor(currentFeed.feedId, key);
            closeFeedContextMenu();
          }
        );
        swatchRow.appendChild(swatch);
      }

      const clearBtn = createButton(
        {
          type: "button",
          className: "feed-color-swatch feed-color-swatch--clear" + (!currentFeed.color ? " selected" : ""),
          title: "\u8272\u3092\u30af\u30ea\u30a2",
          textContent: "\u00d7"
        },
        () => {
          onSetColor(currentFeed.feedId, null);
          closeFeedContextMenu();
        }
      );
      swatchRow.appendChild(clearBtn);

      menu.appendChild(swatchRow);
    }

    if (onAddFeedTag && onRemoveFeedTag) {
      const tagWrap = createElement("div", { className: "feed-context-menu-tags" });
      renderTagEditor(tagWrap, {
        tags: currentFeed.tags || [],
        onAddTag: (tag) => {
          Promise.resolve(onAddFeedTag(currentFeed.feedId, tag)).then((updated) => {
            if (updated) {
              currentFeed = updated;
              draw();
            }
          });
        },
        onRemoveTag: (tag) => {
          Promise.resolve(onRemoveFeedTag(currentFeed.feedId, tag)).then((updated) => {
            if (updated) {
              currentFeed = updated;
              draw();
            }
          });
        },
      });
      menu.appendChild(tagWrap);
    }
  };
  draw();

  document.body.appendChild(menu);
  activeMenu = menu;
  activeMenuFeedId = feed.feedId;

  // Clamp inside the viewport now that the menu's own size is known \u2014
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
