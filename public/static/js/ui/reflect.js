// "\u632f\u308a\u8fd4\u308b" (reflect) mode's daily timeline: one row per logged article
// open, newest first, each with its own stacked comment thread. See
// logbook.js for the data shape and main.js's renderReflect for how a day's
// entries get here.

import { COLOR_PALETTE, COLOR_BY_KEY } from "../colorPalette.js";
import {
  openFloatingPopup,
  closeFloatingPopup,
  closeFloatingPopupIfMissing,
  renderColorSwatches,
  renderTagEditor,
  attachContextTrigger,
} from "./colorPicker.js";
import { renderEmptyHint } from "./listUtils.js";
import { createElement, createButton, setCustomProperty } from "./domUtils.js";

// Right-click (desktop) or long-press (touch) an entry to tag it with one
// of COLOR_PALETTE's colors, shown as a left border + low-alpha background
// tint via --reflect-color (see .reflect-log-item--colored /
// .reflect-color-swatch in style.css), plus free-text tags (see
// renderTagEditor) shown as chips on the row itself.

function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatCommentTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP");
}

function renderComment(comment) {
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

  return li;
}

function openColorPicker(logEntry, x, y, onSetColor, onAddTag, onRemoveTag) {
  let current = logEntry;
  openFloatingPopup({
    id: logEntry.id,
    x,
    y,
    className: "reflect-color-picker",
    build: (picker) => {
      const draw = () => {
        picker.innerHTML = "";

        // Same combined swatches+tags row as the article list's own
        // annotate popup (see .annotate-palette-row/renderAnnotatePopup in
        // articleList.js) \u2014 one compact palette instead of two stacked
        // sections.
        const paletteRow = createElement("div", { className: "annotate-palette-row" });
        renderColorSwatches(paletteRow, {
          currentColor: current.color,
          onSetColor: (color) => {
            onSetColor(logEntry.id, color);
            closeFloatingPopup();
          },
        });
        if (onAddTag && onRemoveTag) {
          renderTagEditor(paletteRow, {
            tags: current.tags || [],
            onAddTag: (tag) => {
              Promise.resolve(onAddTag(logEntry.id, tag)).then((updated) => {
                if (updated) {
                  current = updated;
                  draw();
                }
              });
            },
            onRemoveTag: (tag) => {
              Promise.resolve(onRemoveTag(logEntry.id, tag)).then((updated) => {
                if (updated) {
                  current = updated;
                  draw();
                }
              });
            },
          });
        }
        picker.appendChild(paletteRow);
      };
      draw();
    },
  });
}

// Mirrors feedList.js's own long-press-as-touch-equivalent-of-right-click
// pattern. Skips the comment form/input specifically so right-clicking (to
// paste, say) or a long press while selecting text there doesn't get
// hijacked into opening the color picker instead.
function attachColorPicker(li, logEntry, onSetColor, onAddTag, onRemoveTag) {
  if (!onSetColor) return;
  attachContextTrigger(li, {
    onOpenRequest: (x, y) => openColorPicker(logEntry, x, y, onSetColor, onAddTag, onRemoveTag),
    isExcluded: (ev) => Boolean(ev.target.closest(".reflect-comment-form")),
  });
}

function renderLogItem(logEntry, onAddComment, onSetColor, onAddTag, onRemoveTag) {
  const li = createElement("li", {
    className: "reflect-log-item",
    dataset: { logId: logEntry.id }
  });
  const rgb = logEntry.color && COLOR_BY_KEY.get(logEntry.color);
  if (rgb) {
    li.classList.add("reflect-log-item--colored");
    setCustomProperty(li, "reflect-color", rgb);
  }

  const time = createElement("div", {
    className: "reflect-log-time",
    textContent: formatTime(logEntry.openedAt)
  });
  li.appendChild(time);

  const body = createElement("div", { className: "reflect-log-body" });

  const titleLink = createElement("a", {
    className: "reflect-log-title",
    href: logEntry.url || "#",
    target: "_blank",
    rel: "noopener noreferrer",
    textContent: logEntry.title || "(\u30bf\u30a4\u30c8\u30eb\u306a\u3057)"
  });
  body.appendChild(titleLink);

  if (logEntry.feedTitle) {
    const meta = createElement("div", {
      className: "reflect-log-meta",
      textContent: logEntry.feedTitle
    });
    body.appendChild(meta);
  }

  const tags = logEntry.tags || [];
  if (tags.length > 0) {
    const tagRow = createElement("div", { className: "tag-chip-row tag-chip-row--display" });
    for (const tag of tags) {
      const chip = createElement("span", {
        className: "tag-chip tag-chip--display",
        textContent: tag
      });
      tagRow.appendChild(chip);
    }
    body.appendChild(tagRow);
  }

  const comments = logEntry.comments || [];
  if (comments.length > 0) {
    const commentList = createElement("ul", { className: "reflect-comment-list" });
    for (const comment of comments) commentList.appendChild(renderComment(comment));
    body.appendChild(commentList);
  }

  // The add-comment form is hidden by default (see .reflect-comment-form in
  // style.css) \u2014 an input on every single entry was too much visual noise
  // for a timeline meant to be skimmed. It shows on mouse hover/focus.
  const form = createElement("form", { className: "reflect-comment-form" });
  const input = createElement("input", {
    type: "text",
    className: "reflect-comment-input",
    placeholder: "\u30b3\u30e1\u30f3\u30c8\u3092\u8ffd\u52a0\u2026"
  });
  form.appendChild(input);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    onAddComment(logEntry.id, text);
  });
  body.appendChild(form);

  li.appendChild(body);
  attachColorPicker(li, logEntry, onSetColor, onAddTag, onRemoveTag);
  return li;
}

// Filter row above the timeline (see .reflect-color-filter in style.css) \u2014
// mirrors renderFeedColorFilter in ui/feedList.js: one swatch per color
// actually tagged on some entry *currently loaded* (the day's entries, or
// the current search results \u2014 see main.js's renderReflect), each toggling
// that color's membership in `activeColors`. An entry shows if it matches
// any active color (see filterLogEntriesByColor in main.js); an empty
// activeColors set means no filter, and the whole row disappears (via
// :empty) once nothing in view is tagged at all.
export function renderLogColorFilter(container, { entries, activeColors, onToggleColor }) {
  container.innerHTML = "";
  const usedColors = new Set(entries.map((e) => e.color).filter(Boolean));
  if (usedColors.size === 0) return;

  for (const { key, rgb } of COLOR_PALETTE) {
    if (!usedColors.has(key)) continue;
    const swatch = createButton(
      {
        type: "button",
        className: "reflect-color-filter-swatch" + (activeColors.has(key) ? " selected" : ""),
        style: { "--reflect-color": rgb },
        title: activeColors.has(key) ? "\u3053\u306e\u8272\u306e\u30d5\u30a3\u30eb\u30bf\u30fc\u3092\u89e3\u9664" : "\u3053\u306e\u8272\u306e\u8a18\u9332\u3060\u3051\u8868\u793a",
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
        className: "reflect-color-filter-clear",
        textContent: "\u00d7",
        title: "\u8272\u30d5\u30a3\u30eb\u30bf\u30fc\u3092\u3059\u3079\u3066\u89e3\u9664"
      },
      () => onToggleColor(null)
    );
    container.appendChild(clearBtn);
  }
}

export function renderReflectTimeline(container, { entries, onAddComment, onSetColor, onAddTag, onRemoveTag, emptyHint }) {
  // Same rebuild-wipes-live-state problem the picker comment below already
  // works around, but for a comment mid-typed into one entry's (normally
  // hover/focus-revealed \u2014 see .reflect-comment-form in style.css) comment
  // box: this whole timeline redraws on the REFLECT_LIVE_REFRESH_MS timer
  // and on regaining tab focus (see main.js), neither of which reflects the
  // user actually doing anything. Only restore it onto the same log entry's
  // box (never leak a draft onto a different entry after the list reorders)
  // and only when that input still has focus.
  const focusedCommentLi = document.activeElement?.closest?.(".reflect-log-item");
  const focusedCommentInput = focusedCommentLi?.querySelector(".reflect-comment-input");
  const preservedComment =
    focusedCommentInput && document.activeElement === focusedCommentInput
      ? {
          logId: focusedCommentLi.dataset.logId,
          value: focusedCommentInput.value,
          selectionStart: focusedCommentInput.selectionStart,
          selectionEnd: focusedCommentInput.selectionEnd,
        }
      : null;

  container.innerHTML = "";
  // The picker lives in document.body (see openColorPicker), so rebuilding
  // this list doesn't touch it \u2014 closing it unconditionally on every redraw
  // used to be the only thing that did. That made it slam shut mid-pick
  // whenever a background sync (new unread items logged elsewhere, the
  // REFLECT_LIVE_REFRESH_MS timer, ...) redrew the timeline underneath the
  // user. Only close it when the entry it's anchored to has actually
  // dropped out of view (date changed, search cleared it, etc.) \u2014 a picker
  // whose entry is still on screen stays open across an unrelated redraw.
  closeFloatingPopupIfMissing(new Set(entries.map((e) => e.id)));

  if (entries.length === 0) {
    renderEmptyHint(container, emptyHint || "\u3053\u306e\u65e5\u306f\u307e\u3060\u8a18\u9332\u304c\u3042\u308a\u307e\u305b\u3093\u3002");
    return;
  }

  const ul = createElement("ul", { className: "reflect-timeline-list" });
  for (const logEntry of entries) ul.appendChild(renderLogItem(logEntry, onAddComment, onSetColor, onAddTag, onRemoveTag));
  container.appendChild(ul);

  if (preservedComment) {
    const restoredLi = ul.querySelector(`.reflect-log-item[data-log-id="${CSS.escape(preservedComment.logId)}"]`);
    const restoredInput = restoredLi?.querySelector(".reflect-comment-input");
    if (restoredInput) {
      restoredInput.value = preservedComment.value;
      restoredInput.focus();
      restoredInput.setSelectionRange(preservedComment.selectionStart, preservedComment.selectionEnd);
    }
  }
}

// The trend strip inside the day-nav header (see main.js's renderReflect
// and .reflect-day-chart in style.css) \u2014 one bar per day of counts (from
// logbook.js's getDailyCounts), bar height scaled to the busiest day in the
// window so a quiet stretch doesn't read as visually identical to a heavy
// one. Bars double as date navigation: clicking one jumps straight there,
// same as picking a day off a calendar, which is the "\u4e00\u4f53\u5316" (merged into
// the date display rather than a separate section) the chart was asked for.
// Hovering one (onHoverDate) does the same jump instantly, mirroring
// feedList's preview-on-hover/commit-on-click split \u2014 see previewReflectDate
// in main.js for why that path stays cheap instead of just calling
// onSelectDate.
export function renderDayChart(container, { counts, selectedDate, onSelectDate, onHoverDate }) {
  container.innerHTML = "";
  const max = Math.max(1, ...counts.map((c) => c.count));

  for (const { date, count } of counts) {
    const bar = createButton(
      {
        type: "button",
        className: (
          "reflect-day-chart-bar" +
          (date === selectedDate ? " selected" : "") +
          (count === 0 ? " reflect-day-chart-bar--empty" : "")
        ),
        dataset: { date },
        style: { "--bar-fill": `${Math.round((count / max) * 100)}%` },
        title: `${date}: ${count}\u4ef6`,
        ariaLabel: `${date}: ${count}\u4ef6`
      },
      () => onSelectDate(date)
    );
    // Touch has no hover \u2014 those devices still get the jump via the click
    // listener above, this is purely an added shortcut for a mouse/trackpad.
    if (onHoverDate) bar.addEventListener("mouseenter", () => onHoverDate(date));
    container.appendChild(bar);
  }
}
