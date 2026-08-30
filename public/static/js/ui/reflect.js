// "振り返る" (reflect) mode's daily timeline: one row per logged article
// open, newest first, each with its own stacked comment thread. See
// logbook.js for the data shape and main.js's renderReflect for how a day's
// entries get here.

import { COLOR_BY_KEY } from "../colorPalette.js";
import { openFloatingPopup, closeFloatingPopup, closeFloatingPopupIfMissing, renderColorSwatches } from "./colorPicker.js";
import { renderEmptyHint } from "./listUtils.js";
import { createElement, createButton, setCustomProperty } from "./domUtils.js";

// Which entry's hover-revealed actions section (see buildLogActions) the
// pointer is currently over — tracked at module scope, outside any one
// render, because :hover/:focus-within alone can't survive a rebuild.
// container.innerHTML = "" (see renderReflectTimeline) destroys the hovered
// row and replaces it with a new element sitting at the same screen
// position; the browser doesn't retroactively apply :hover to that new
// element until the pointer actually moves again, so without this the
// section would flash shut the instant a color pick (or delete) triggers a
// redraw out from under a still-hovering mouse. Same trick as
// hoveredEntryId in ui/articleList.js.
let hoveredLogId = null;

// includeDate: true for search results, which can span multiple days (see
// renderReflect in main.js) — time-only would be ambiguous about which day
// an entry happened on, unlike the single-day timeline where the date is
// already shown in the day-nav header above.
function formatTime(iso, { includeDate = false } = {}) {
  if (!iso) return "";
  const d = new Date(iso);
  if (includeDate) {
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
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

// Already-added comments for one log entry — always visible (not part of
// the hover-revealed actions section below), since a comment left on a
// past entry is content worth skimming, not a rarely-used action.
function buildCommentList(logEntry) {
  const comments = logEntry.comments || [];
  if (comments.length === 0) return null;
  const commentList = createElement("ul", { className: "reflect-comment-list" });
  for (const comment of comments) commentList.appendChild(renderComment(comment));
  return commentList;
}

// Color palette + comment add-form + reap (delete) actions for one log
// entry, revealed on hover/focus instead of the old right-click popup —
// color-tagging and deleting are rarely-used per-entry actions, so they
// stay tucked away (see .reflect-log-actions in style.css); the comment
// thread itself is rendered separately, always visible (see buildCommentList).
function buildLogActions(logEntry, { onSetColor, onAddComment, onDelete, onBlockAndDelete }) {
  const section = createElement("div", { className: "reflect-log-actions" });

  const paletteRow = createElement("div", { className: "annotate-palette-row" });
  renderColorSwatches(paletteRow, { currentColor: logEntry.color, onSetColor });
  if (onDelete) {
    paletteRow.appendChild(createButton(
      { type: "button", className: "reflect-log-icon-btn", textContent: "🗑️", title: "この記録を削除" },
      onDelete
    ));
  }
  if (onBlockAndDelete) {
    paletteRow.appendChild(createButton(
      {
        type: "button",
        className: "reflect-log-icon-btn",
        textContent: "🚫",
        title: "削除して、このURLパターンを今後も追加しないようにする"
      },
      (ev) => onBlockAndDelete(logEntry, ev.clientX, ev.clientY)
    ));
  }
  section.appendChild(paletteRow);

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
    onAddComment(text);
  });
  section.appendChild(form);

  return section;
}

function renderLogItem(logEntry, { onAddComment, onSetColor, onDelete, onBlockAndDelete, forceOpenLogId, showDate }) {
  const annotateOpen = logEntry.id === hoveredLogId || logEntry.id === forceOpenLogId;

  const li = createElement("li", {
    className: "reflect-log-item" + (annotateOpen ? " reflect-log-item--open" : ""),
    dataset: { logId: logEntry.id }
  });
  const rgb = logEntry.color && COLOR_BY_KEY.get(logEntry.color);
  if (rgb) {
    li.classList.add("reflect-log-item--colored");
    setCustomProperty(li, "reflect-color", rgb);
  }

  li.addEventListener("mouseenter", () => {
    hoveredLogId = logEntry.id;
    li.classList.add("reflect-log-item--open");
  });
  li.addEventListener("mouseleave", () => {
    if (hoveredLogId === logEntry.id) hoveredLogId = null;
    li.classList.remove("reflect-log-item--open");
  });

  const time = createElement("div", {
    className: "reflect-log-time" + (showDate ? " reflect-log-time--with-date" : ""),
    textContent: formatTime(logEntry.openedAt, { includeDate: showDate })
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

  const commentList = buildCommentList(logEntry);
  if (commentList) body.appendChild(commentList);

  body.appendChild(
    buildLogActions(logEntry, {
      onSetColor: (color) => onSetColor(logEntry.id, color),
      onAddComment: (text) => onAddComment(logEntry.id, text),
      onDelete: onDelete ? () => onDelete(logEntry.id) : null,
      onBlockAndDelete,
    })
  );

  li.appendChild(body);
  return li;
}

export function renderReflectTimeline(container, { entries, onAddComment, onSetColor, onDelete, onBlockAndDelete, emptyHint, showDate }) {
  // A comment mid-typed into one entry's (normally hover/focus-revealed —
  // see .reflect-log-actions in style.css) comment box would otherwise
  // vanish on every redraw this whole timeline goes through — the
  // REFLECT_LIVE_REFRESH_MS timer, regaining tab focus (see main.js) — none
  // of which reflects the user actually doing anything. Only restore it
  // onto the same log entry's box (never leak a draft onto a different
  // entry after the list reorders) and only when that input still has
  // focus.
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
  // The block-pattern popup (see openBlockUrlPopup) lives in document.body,
  // so rebuilding this list doesn't touch it directly — but if the entry it
  // was opened from has actually dropped out of view (date changed, search
  // cleared it, ...) by the time an unrelated redraw lands, there's nothing
  // left for "confirm" to act on, so close it.
  closeFloatingPopupIfMissing(new Set(entries.map((e) => e.id)));

  if (entries.length === 0) {
    renderEmptyHint(container, emptyHint || "この日はまだ記録がありません。");
    return;
  }

  const ul = createElement("ul", { className: "reflect-timeline-list" });
  for (const logEntry of entries) {
    ul.appendChild(renderLogItem(logEntry, {
      onAddComment,
      onSetColor,
      onDelete,
      onBlockAndDelete,
      forceOpenLogId: preservedComment?.logId,
      showDate,
    }));
  }
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

// Opens next to the 🚫 button in a log entry's hover actions row (see
// buildLogActions) — lets the user tweak the wildcard URL pattern (see
// urlBlocks.js) before confirming "delete this entry, and reject anything
// matching this pattern from now on" (see main.js's handleBlockAndDeleteLog).
// defaultPattern is only a starting point; onConfirm(pattern) fires with
// whatever's actually in the input at confirm time.
export function openBlockUrlPopup(logEntry, x, y, { defaultPattern, onConfirm }) {
  openFloatingPopup({
    id: logEntry.id,
    x,
    y,
    className: "url-block-popup",
    build: (popup) => {
      const hint = createElement("div", {
        className: "url-block-popup-hint",
        textContent: "このパターンに一致するURLは今後追加しません（* はワイルドカード）"
      });
      popup.appendChild(hint);

      const input = createElement("input", {
        type: "text",
        className: "url-block-popup-input",
        value: defaultPattern
      });
      popup.appendChild(input);

      const row = createElement("div", { className: "url-block-popup-row" });
      row.appendChild(createButton(
        { type: "button", className: "primary", textContent: "削除してブロック" },
        () => {
          const pattern = input.value.trim();
          if (!pattern) return;
          closeFloatingPopup();
          onConfirm(pattern);
        }
      ));
      row.appendChild(createButton(
        { type: "button", textContent: "キャンセル" },
        () => closeFloatingPopup()
      ));
      popup.appendChild(row);

      input.focus();
      input.select();
    },
  });
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
