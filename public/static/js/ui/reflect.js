// "振り返る" (reflect) mode's daily timeline: one row per logged article
// open, newest first, each with its own stacked comment thread. See
// logbook.js for the data shape and main.js's renderReflect for how a day's
// entries get here.

import { COLOR_PALETTE, COLOR_BY_KEY } from "../colorPalette.js";

// Right-click (desktop) or long-press (touch) an entry to tag it with one
// of COLOR_PALETTE's colors, shown as a left border + low-alpha background
// tint via --reflect-color (see .reflect-log-item--colored /
// .reflect-color-swatch in style.css).
const LONG_PRESS_MS = 550;

function formatTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatCommentTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP");
}

function renderComment(comment) {
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

  return li;
}

// One picker open at a time, tracked at module scope so opening a second
// one (or clicking away) always closes whatever's currently showing rather
// than each row having to know about siblings. activePickerLogId lets
// renderReflectTimeline (below) tell a picker that's still relevant apart
// from one left dangling by navigating away — see the comment there.
let activePicker = null;
let activePickerLogId = null;
let removeOutsideListeners = null;

function closeColorPicker() {
  if (removeOutsideListeners) removeOutsideListeners();
  removeOutsideListeners = null;
  if (activePicker) activePicker.remove();
  activePicker = null;
  activePickerLogId = null;
}

function openColorPicker(logEntry, x, y, onSetColor) {
  closeColorPicker();

  const picker = document.createElement("div");
  picker.className = "reflect-color-picker";
  picker.style.left = `${x}px`;
  picker.style.top = `${y}px`;

  for (const { key, rgb } of COLOR_PALETTE) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "reflect-color-swatch" + (logEntry.color === key ? " selected" : "");
    swatch.style.setProperty("--reflect-color", rgb);
    swatch.title = `色${key}`;
    swatch.addEventListener("click", () => {
      onSetColor(logEntry.id, key);
      closeColorPicker();
    });
    picker.appendChild(swatch);
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "reflect-color-swatch reflect-color-swatch--clear" + (!logEntry.color ? " selected" : "");
  clearBtn.title = "色をクリア";
  clearBtn.textContent = "×";
  clearBtn.addEventListener("click", () => {
    onSetColor(logEntry.id, null);
    closeColorPicker();
  });
  picker.appendChild(clearBtn);

  document.body.appendChild(picker);
  activePicker = picker;
  activePickerLogId = logEntry.id;

  // Clamp inside the viewport now that the picker's own size is known —
  // right-clicking/long-pressing near an edge shouldn't push part of it
  // off-screen.
  const rect = picker.getBoundingClientRect();
  const maxLeft = window.innerWidth - rect.width - 8;
  const maxTop = window.innerHeight - rect.height - 8;
  picker.style.left = `${Math.max(8, Math.min(x, maxLeft))}px`;
  picker.style.top = `${Math.max(8, Math.min(y, maxTop))}px`;

  // Deferred a tick so the very pointerdown/contextmenu that opened this
  // picker doesn't immediately bubble into the outside-click listener and
  // close it again before the user sees it.
  setTimeout(() => {
    const onPointerDown = (ev) => {
      if (!picker.contains(ev.target)) closeColorPicker();
    };
    const onKeydown = (ev) => {
      if (ev.key === "Escape") closeColorPicker();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeydown, true);
    removeOutsideListeners = () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeydown, true);
    };
  }, 0);
}

// Mirrors feedList.js's own long-press-as-touch-equivalent-of-right-click
// pattern. Skips the comment form/input specifically so right-clicking (to
// paste, say) or a long press while selecting text there doesn't get
// hijacked into opening the color picker instead.
function attachColorPicker(li, logEntry, onSetColor) {
  if (!onSetColor) return;
  const isInCommentForm = (ev) => Boolean(ev.target.closest(".reflect-comment-form"));
  let longPressTimer = null;
  const cancelLongPress = () => clearTimeout(longPressTimer);

  li.addEventListener("contextmenu", (ev) => {
    if (isInCommentForm(ev)) return;
    ev.preventDefault();
    openColorPicker(logEntry, ev.clientX, ev.clientY, onSetColor);
  });

  li.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "touch" || isInCommentForm(ev)) return;
    const { clientX, clientY } = ev;
    longPressTimer = setTimeout(() => openColorPicker(logEntry, clientX, clientY, onSetColor), LONG_PRESS_MS);
  });
  li.addEventListener("pointerup", cancelLongPress);
  li.addEventListener("pointercancel", cancelLongPress);
  li.addEventListener("pointermove", cancelLongPress);
}

function renderLogItem(logEntry, onAddComment, onSetColor) {
  const li = document.createElement("li");
  li.className = "reflect-log-item";
  const rgb = logEntry.color && COLOR_BY_KEY.get(logEntry.color);
  if (rgb) {
    li.classList.add("reflect-log-item--colored");
    li.style.setProperty("--reflect-color", rgb);
  }

  const time = document.createElement("div");
  time.className = "reflect-log-time";
  time.textContent = formatTime(logEntry.openedAt);
  li.appendChild(time);

  const body = document.createElement("div");
  body.className = "reflect-log-body";

  const titleLink = document.createElement("a");
  titleLink.className = "reflect-log-title";
  titleLink.href = logEntry.url || "#";
  titleLink.target = "_blank";
  titleLink.rel = "noopener noreferrer";
  titleLink.textContent = logEntry.title || "(タイトルなし)";
  body.appendChild(titleLink);

  if (logEntry.feedTitle) {
    const meta = document.createElement("div");
    meta.className = "reflect-log-meta";
    meta.textContent = logEntry.feedTitle;
    body.appendChild(meta);
  }

  const comments = logEntry.comments || [];
  if (comments.length > 0) {
    const commentList = document.createElement("ul");
    commentList.className = "reflect-comment-list";
    for (const comment of comments) commentList.appendChild(renderComment(comment));
    body.appendChild(commentList);
  }

  // The add-comment form is hidden by default (see .reflect-comment-form in
  // style.css) — an input on every single entry was too much visual noise
  // for a timeline meant to be skimmed. It shows on mouse hover/focus.
  const form = document.createElement("form");
  form.className = "reflect-comment-form";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "reflect-comment-input";
  input.placeholder = "コメントを追加…";
  form.appendChild(input);
  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.textContent = "追加";
  form.appendChild(submitBtn);
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

export function renderReflectTimeline(container, { entries, onAddComment, onSetColor, emptyHint }) {
  container.innerHTML = "";
  // The picker lives in document.body (see openColorPicker), so rebuilding
  // this list doesn't touch it — closing it unconditionally on every redraw
  // used to be the only thing that did. That made it slam shut mid-pick
  // whenever a background sync (new unread items logged elsewhere, the
  // REFLECT_LIVE_REFRESH_MS timer, ...) redrew the timeline underneath the
  // user. Only close it when the entry it's anchored to has actually
  // dropped out of view (date changed, search cleared it, etc.) — a picker
  // whose entry is still on screen stays open across an unrelated redraw.
  if (activePickerLogId !== null && !entries.some((e) => e.id === activePickerLogId)) {
    closeColorPicker();
  }

  if (entries.length === 0) {
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = emptyHint || "この日はまだ記録がありません。";
    container.appendChild(hint);
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "reflect-timeline-list";
  for (const logEntry of entries) ul.appendChild(renderLogItem(logEntry, onAddComment, onSetColor));
  container.appendChild(ul);
}

// The trend strip inside the day-nav header (see main.js's renderReflect
// and .reflect-day-chart in style.css) — one bar per day of counts (from
// logbook.js's getDailyCounts), bar height scaled to the busiest day in the
// window so a quiet stretch doesn't read as visually identical to a heavy
// one. Bars double as date navigation: clicking one jumps straight there,
// same as picking a day off a calendar, which is the "一体化" (merged into
// the date display rather than a separate section) the chart was asked for.
// Hovering one (onHoverDate) does the same jump instantly, mirroring
// feedList's preview-on-hover/commit-on-click split — see previewReflectDate
// in main.js for why that path stays cheap instead of just calling
// onSelectDate.
export function renderDayChart(container, { counts, selectedDate, onSelectDate, onHoverDate }) {
  container.innerHTML = "";
  const max = Math.max(1, ...counts.map((c) => c.count));

  for (const { date, count } of counts) {
    const bar = document.createElement("button");
    bar.type = "button";
    bar.className =
      "reflect-day-chart-bar" +
      (date === selectedDate ? " selected" : "") +
      (count === 0 ? " reflect-day-chart-bar--empty" : "");
    bar.dataset.date = date;
    bar.style.setProperty("--bar-fill", `${Math.round((count / max) * 100)}%`);
    bar.title = `${date}: ${count}件`;
    bar.setAttribute("aria-label", `${date}: ${count}件`);
    bar.addEventListener("click", () => onSelectDate(date));
    // Touch has no hover — those devices still get the jump via the click
    // listener above, this is purely an added shortcut for a mouse/trackpad.
    if (onHoverDate) bar.addEventListener("mouseenter", () => onHoverDate(date));
    container.appendChild(bar);
  }
}
