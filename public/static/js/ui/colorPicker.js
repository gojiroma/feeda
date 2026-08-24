// Shared floating-popup mechanics for right-click/long-press UI (reflect's
// color picker, and the article list's combined annotate popup — see
// reflect.js and articleList.js). One popup open at a time, tracked here at
// module scope so opening a second one — or a completely different kind of
// popup from another screen — always closes whatever's currently showing.
import { COLOR_PALETTE } from "../colorPalette.js";

const LONG_PRESS_MS = 550;

let activePopup = null;
let activePopupId = null;
let removeOutsideListeners = null;

export function closeFloatingPopup() {
  if (removeOutsideListeners) removeOutsideListeners();
  removeOutsideListeners = null;
  if (activePopup) activePopup.remove();
  activePopup = null;
  activePopupId = null;
}

// Lets a redraw tell an open popup that it's still anchored to something on
// screen (an entry still in the current list/day) apart from one left
// dangling by navigating away — see reflect.js's renderReflectTimeline for
// why that distinction matters (a picker mid-pick shouldn't slam shut just
// because an unrelated background refresh redrew the list underneath it).
export function closeFloatingPopupIfMissing(validIds) {
  if (activePopupId !== null && !validIds.has(activePopupId)) closeFloatingPopup();
}

// className picks the popup's look (e.g. "reflect-color-picker" for a plain
// swatch grid, "article-annotate-popup" for the combined color+comment one);
// build(popup) fills in its content — called once, with the popup already
// positioned near (x, y) and about to be measured/clamped to the viewport.
export function openFloatingPopup({ id, x, y, className, build }) {
  closeFloatingPopup();

  const popup = document.createElement("div");
  popup.className = className;
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  build(popup);

  document.body.appendChild(popup);
  activePopup = popup;
  activePopupId = id;

  // Clamp inside the viewport now that the popup's own size is known —
  // right-clicking/long-pressing near an edge shouldn't push part of it
  // off-screen.
  const rect = popup.getBoundingClientRect();
  const maxLeft = window.innerWidth - rect.width - 8;
  const maxTop = window.innerHeight - rect.height - 8;
  popup.style.left = `${Math.max(8, Math.min(x, maxLeft))}px`;
  popup.style.top = `${Math.max(8, Math.min(y, maxTop))}px`;

  // Deferred a tick so the very pointerdown/contextmenu that opened this
  // popup doesn't immediately bubble into the outside-click listener and
  // close it again before the user sees it.
  setTimeout(() => {
    const onPointerDown = (ev) => {
      if (!popup.contains(ev.target)) closeFloatingPopup();
    };
    const onKeydown = (ev) => {
      if (ev.key === "Escape") closeFloatingPopup();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeydown, true);
    removeOutsideListeners = () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeydown, true);
    };
  }, 0);
}

// Fills `container` with one swatch button per COLOR_PALETTE entry plus a
// clear ("×") button — shared by reflect's own color-only picker and the
// article list's combined popup. onSetColor(key | null) fires on click;
// callers decide whether that closes the popup or just redraws it in place.
export function renderColorSwatches(container, { currentColor, onSetColor }) {
  for (const { key, rgb } of COLOR_PALETTE) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "reflect-color-swatch" + (currentColor === key ? " selected" : "");
    swatch.style.setProperty("--reflect-color", rgb);
    swatch.title = `色${key}`;
    swatch.addEventListener("click", () => onSetColor(key));
    container.appendChild(swatch);
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "reflect-color-swatch reflect-color-swatch--clear" + (!currentColor ? " selected" : "");
  clearBtn.title = "色をクリア";
  clearBtn.textContent = "×";
  clearBtn.addEventListener("click", () => onSetColor(null));
  container.appendChild(clearBtn);
}

// Row of removable tag chips plus an "add a tag" input — shared by the feed
// context menu (feedList.js) and the article-list/reflect annotate popups.
// Free-text and unbounded, unlike color's fixed palette: typing a tag and
// hitting Enter (or "追加") adds it via onAddTag; a chip's own "×" removes
// it via onRemoveTag. Appends into `container` rather than clearing it
// first, same convention as renderColorSwatches, so callers control what
// else shares the popup.
export function renderTagEditor(container, { tags, onAddTag, onRemoveTag }) {
  if (tags.length > 0) {
    const chipRow = document.createElement("div");
    chipRow.className = "tag-chip-row";
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      const label = document.createElement("span");
      label.textContent = tag;
      chip.appendChild(label);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.title = "タグを削除";
      removeBtn.addEventListener("click", () => onRemoveTag(tag));
      chip.appendChild(removeBtn);
      chipRow.appendChild(chip);
    }
    container.appendChild(chipRow);
  }

  const form = document.createElement("form");
  form.className = "tag-add-form";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "タグを追加…";
  input.className = "tag-add-input";
  form.appendChild(input);
  const addBtn = document.createElement("button");
  addBtn.type = "submit";
  addBtn.textContent = "追加";
  form.appendChild(addBtn);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    onAddTag(text.trim());
  });
  container.appendChild(form);
}

// Wires an element's right-click (desktop) and long-press (touch) to
// onOpenRequest(clientX, clientY) — mirrors feedList.js's own
// long-press-as-touch-equivalent-of-right-click pattern. isExcluded lets a
// caller skip elements where right-click/long-press should behave normally
// (e.g. an already-open comment form's input, so pasting into it isn't
// hijacked into reopening the popup).
export function attachContextTrigger(el, { onOpenRequest, isExcluded }) {
  if (!onOpenRequest) return;
  let longPressTimer = null;
  const cancelLongPress = () => clearTimeout(longPressTimer);

  el.addEventListener("contextmenu", (ev) => {
    if (isExcluded && isExcluded(ev)) return;
    ev.preventDefault();
    onOpenRequest(ev.clientX, ev.clientY);
  });

  el.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "touch" || (isExcluded && isExcluded(ev))) return;
    const { clientX, clientY } = ev;
    longPressTimer = setTimeout(() => onOpenRequest(clientX, clientY), LONG_PRESS_MS);
  });
  el.addEventListener("pointerup", cancelLongPress);
  el.addEventListener("pointercancel", cancelLongPress);
  el.addEventListener("pointermove", cancelLongPress);
}
