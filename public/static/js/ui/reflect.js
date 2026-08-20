// "振り返る" (reflect) mode's daily timeline: one row per logged article
// open, newest first, each with its own stacked comment thread. See
// logbook.js for the data shape and main.js's renderReflect for how a day's
// entries get here.

// Right-click (desktop) or long-press (touch) an entry to tag it with one
// of these — muted on purpose, meant to sit quietly behind the text rather
// than compete with it. Values are the RGB triplet fed into --reflect-color
// (see .reflect-log-item--colored / .reflect-color-swatch in style.css) —
// the single source of truth for the palette, so nothing needs to be kept
// in sync in CSS separately.
const COLOR_PALETTE = [
  { key: "1", rgb: "184,110,110" }, // dusty rose
  { key: "2", rgb: "196,145,90" }, // clay
  { key: "3", rgb: "190,165,90" }, // ochre
  { key: "4", rgb: "120,150,100" }, // sage
  { key: "5", rgb: "95,150,140" }, // teal
  { key: "6", rgb: "100,130,170" }, // slate blue
  { key: "7", rgb: "120,115,175" }, // indigo
  { key: "8", rgb: "150,110,165" }, // mauve
  { key: "9", rgb: "180,120,150" }, // dusty pink
  { key: "10", rgb: "130,130,130" }, // gray
];
const COLOR_BY_KEY = new Map(COLOR_PALETTE.map((c) => [c.key, c.rgb]));
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
// than each row having to know about siblings.
let activePicker = null;
let removeOutsideListeners = null;

function closeColorPicker() {
  if (removeOutsideListeners) removeOutsideListeners();
  removeOutsideListeners = null;
  if (activePicker) activePicker.remove();
  activePicker = null;
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
  closeColorPicker();

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
