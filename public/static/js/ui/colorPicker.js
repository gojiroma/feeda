// Shared floating-popup mechanics, currently used for reflect's "delete and
// block this URL pattern" prompt (see reflect.js/main.js). One popup open at
// a time, tracked here at module scope so opening a second one — or a
// completely different kind of popup from another screen — always closes
// whatever's currently showing.
import { COLOR_PALETTE } from "../colorPalette.js";

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

// className picks the popup's look (e.g. "url-block-popup" for the reap
// screen's block-pattern prompt); build(popup) fills in its content — called
// once, with the popup already positioned near (x, y) and about to be
// measured/clamped to the viewport.
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
// clear ("×") button — shared by reflect's own hover-revealed palette row and
// the article list's. onSetColor(key | null) fires on click; callers decide
// whether that closes the popup or just redraws it in place.
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
