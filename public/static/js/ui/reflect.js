// "振り返る" (reflect) mode's daily timeline: one row per logged article
// open, newest first, each with its own stacked comment thread. See
// logbook.js for the data shape and main.js's renderReflect for how a day's
// entries get here.

import { COLOR_PALETTE, COLOR_BY_KEY } from "../colorPalette.js";
import {
  openFloatingPopup,
  closeFloatingPopup,
  closeFloatingPopupIfMissing,
  renderColorSwatches,
  attachContextTrigger,
} from "./colorPicker.js";
import { renderEmptyHint } from "./listUtils.js";
import { createElement, createButton, setCustomProperty } from "./domUtils.js";

// Right-click (desktop) or long-press (touch) an entry to tag it with one
// of COLOR_PALETTE's colors, shown as a left border + low-alpha background
// tint via --reflect-color (see .reflect-log-item--colored /
// .reflect-color-swatch in style.css).

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

function openColorPicker(logEntry, x, y, onSetColor) {
  openFloatingPopup({
    id: logEntry.id,
    x,
    y,
    className: "reflect-color-picker",
    build: (picker) => {
      renderColorSwatches(picker, {
        currentColor: logEntry.color,
        onSetColor: (color) => {
          onSetColor(logEntry.id, color);
          closeFloatingPopup();
        },
      });
    },
  });
}

// Mirrors the article list's own long-press-as-touch-equivalent-of-right-
// click pattern. Skips the comment form/input specifically so right-clicking
// (to paste, say) or a long press while selecting text there doesn't get
// hijacked into opening the color picker instead.
function attachColorPicker(li, logEntry, onSetColor) {
  if (!onSetColor) return;
  attachContextTrigger(li, {
    onOpenRequest: (x, y) => openColorPicker(logEntry, x, y, onSetColor),
    isExcluded: (ev) => Boolean(ev.target.closest(".reflect-comment-form")),
  });
}

function renderLogItem(logEntry, onAddComment, onSetColor) {
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
    textContent: logEntry.title || "(タイトルなし)"
  });
  body.appendChild(titleLink);

  if (logEntry.feedTitle) {
    const meta = createElement("div", {
      className: "reflect-log-meta",
      textContent: logEntry.feedTitle
    });
    body.appendChild(meta);
  }

  const comments = logEntry.comments || [];
  if (comments.length > 0) {
    const commentList = createElement("ul", { className: "reflect-comment-list" });
    for (const comment of comments) commentList.appendChild(renderComment(comment));
    body.appendChild(commentList);
  }

  // The add-comment form is hidden by default (see .reflect-comment-form in
  // style.css) — an input on every single entry was too much visual noise
  // for a timeline meant to be skimmed. It shows on mouse hover/focus.
  const form = createElement("form", { className: "reflect-comment-form" });
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
    onAddComment(logEntry.id, text);
  });
  body.appendChild(form);

  li.appendChild(body);
  attachColorPicker(li, logEntry, onSetColor);
  return li;
}

// Filter row above the timeline (see .reflect-color-filter in style.css) —
// mirrors renderColorFilter in ui/commonComponents.js: one swatch per color
// actually tagged on some entry *currently loaded* (the day's entries, or
// the current search results — see main.js's renderReflect), each toggling
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
        title: activeColors.has(key) ? "この色のフィルターを解除" : "この色の記録だけ表示",
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
        textContent: "×",
        title: "色フィルターをすべて解除"
      },
      () => onToggleColor(null)
    );
    container.appendChild(clearBtn);
  }
}

export function renderReflectTimeline(container, { entries, onAddComment, onSetColor, emptyHint }) {
  // Same rebuild-wipes-live-state problem the picker comment below already
  // works around, but for a comment mid-typed into one entry's (normally
  // hover/focus-revealed — see .reflect-comment-form in style.css) comment
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
  // this list doesn't touch it — closing it unconditionally on every redraw
  // used to be the only thing that did. That made it slam shut mid-pick
  // whenever a background sync (new unread items logged elsewhere, the
  // REFLECT_LIVE_REFRESH_MS timer, ...) redrew the timeline underneath the
  // user. Only close it when the entry it's anchored to has actually
  // dropped out of view (date changed, search cleared it, etc.) — a picker
  // whose entry is still on screen stays open across an unrelated redraw.
  closeFloatingPopupIfMissing(new Set(entries.map((e) => e.id)));

  if (entries.length === 0) {
    renderEmptyHint(container, emptyHint || "この日はまだ記録がありません。");
    return;
  }

  const ul = createElement("ul", { className: "reflect-timeline-list" });
  for (const logEntry of entries) ul.appendChild(renderLogItem(logEntry, onAddComment, onSetColor));
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
// and .reflect-day-chart in style.css) — one bar per day of counts (from
// logbook.js's getDailyCounts), bar height scaled to the busiest day in the
// window so a quiet stretch doesn't read as visually identical to a heavy
// one. Bars double as date navigation: clicking one jumps straight there,
// same as picking a day off a calendar, which is the "一体化" (merged into
// the date display rather than a separate section) the chart was asked for.
// Hovering one (onHoverDate) does the same jump instantly — see
// previewReflectDate in main.js for why that path stays cheap instead of
// just calling onSelectDate.
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
        title: `${date}: ${count}件`,
        ariaLabel: `${date}: ${count}件`
      },
      () => onSelectDate(date)
    );
    // Touch has no hover — those devices still get the jump via the click
    // listener above, this is purely an added shortcut for a mouse/trackpad.
    if (onHoverDate) bar.addEventListener("mouseenter", () => onHoverDate(date));
    container.appendChild(bar);
  }
}
