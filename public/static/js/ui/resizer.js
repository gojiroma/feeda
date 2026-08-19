const STORAGE_KEY = "feeda:paneWidths";
const MIN_WIDTH = 160;
const MAX_WIDTH = 960;

function loadWidths() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveWidths(widths) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
}

export function setupPaneResizing() {
  const feedPane = document.getElementById("feed-pane");
  const articlePane = document.getElementById("article-pane");

  const stored = loadWidths();
  if (stored) {
    if (stored.feed) feedPane.style.width = `${stored.feed}px`;
    if (stored.article) articlePane.style.width = `${stored.article}px`;
  }

  for (const resizer of document.querySelectorAll(".pane-resizer")) {
    // Pointer Events cover mouse, touch, and pen with one code path — using
    // setPointerCapture means move/up events keep reaching this element
    // even once the finger/cursor leaves it, so no document-level listeners
    // are needed.
    resizer.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      const targetPane = resizer.dataset.resizer === "0" ? feedPane : articlePane;
      const startX = ev.clientX;
      const startWidth = targetPane.getBoundingClientRect().width;
      resizer.classList.add("dragging");
      resizer.setPointerCapture(ev.pointerId);
      document.body.style.userSelect = "none";

      function onPointerMove(moveEv) {
        const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (moveEv.clientX - startX)));
        targetPane.style.width = `${width}px`;
      }
      function onPointerUp() {
        resizer.classList.remove("dragging");
        document.body.style.userSelect = "";
        resizer.releasePointerCapture(ev.pointerId);
        resizer.removeEventListener("pointermove", onPointerMove);
        resizer.removeEventListener("pointerup", onPointerUp);
        resizer.removeEventListener("pointercancel", onPointerUp);
        saveWidths({
          feed: feedPane.getBoundingClientRect().width,
          article: articlePane.getBoundingClientRect().width,
        });
      }
      resizer.addEventListener("pointermove", onPointerMove);
      resizer.addEventListener("pointerup", onPointerUp);
      resizer.addEventListener("pointercancel", onPointerUp);
    });
  }
}
