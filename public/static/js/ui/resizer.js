const STORAGE_KEY = "feeda:paneWidths";
const MIN_WIDTH = 160;
const MAX_WIDTH = 960;

const ROW_STORAGE_KEY = "feeda:wideGridArticleHeight";
const MIN_ROW_HEIGHT = 120;

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

function loadRowHeight() {
  const raw = localStorage.getItem(ROW_STORAGE_KEY);
  const height = raw ? Number(raw) : null;
  return height && Number.isFinite(height) ? height : null;
}

function saveRowHeight(height) {
  localStorage.setItem(ROW_STORAGE_KEY, String(height));
}

export function setupPaneResizing() {
  const feedPane = document.getElementById("feed-pane");
  const articlePane = document.getElementById("article-pane");

  const stored = loadWidths();
  if (stored) {
    if (stored.feed) feedPane.style.width = `${stored.feed}px`;
    if (stored.article) articlePane.style.width = `${stored.article}px`;
  }

  function paneForResizer(resizer) {
    if (resizer.dataset.resizer === "0") return feedPane;
    if (resizer.dataset.resizer === "1") return articlePane;
    return null;
  }

  for (const resizer of document.querySelectorAll(".pane-resizer")) {
    const targetPane = paneForResizer(resizer);
    if (!targetPane) continue;
    // Pointer Events cover mouse, touch, and pen with one code path — using
    // setPointerCapture means move/up events keep reaching this element
    // even once the finger/cursor leaves it, so no document-level listeners
    // are needed.
    resizer.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
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

// Wide-grid mode stacks the article grid over the preview pane instead of
// setting them side by side (see .app.wide-grid-mode .panes in style.css),
// so the split between them is a row height, not a column width — this
// drags the boundary the same way setupPaneResizing does for the vertical
// splitters, just writing a --wg-article-height custom property (read by
// the first grid-template-rows track) instead of a pane's own width.
export function setupWideGridRowResizing() {
  const panes = document.querySelector(".panes");
  const resizer = document.getElementById("wide-grid-row-resizer");
  const articlePane = document.getElementById("article-pane");
  const previewPane = document.getElementById("preview-pane");
  if (!panes || !resizer || !articlePane || !previewPane) return;

  const storedHeight = loadRowHeight();
  if (storedHeight) panes.style.setProperty("--wg-article-height", `${storedHeight}px`);

  resizer.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const startY = ev.clientY;
    const startHeight = articlePane.getBoundingClientRect().height;
    // Total row space available to article+preview right now, so the drag
    // can never squeeze the preview pane down to nothing — same clamping
    // idea as MIN_WIDTH/MAX_WIDTH above, just against a moving ceiling
    // instead of a fixed one (the two rows' combined height depends on the
    // current window size).
    const maxHeight = startHeight + previewPane.getBoundingClientRect().height - MIN_ROW_HEIGHT;
    resizer.classList.add("dragging");
    resizer.setPointerCapture(ev.pointerId);
    document.body.style.userSelect = "none";

    function onPointerMove(moveEv) {
      const height = Math.min(maxHeight, Math.max(MIN_ROW_HEIGHT, startHeight + (moveEv.clientY - startY)));
      panes.style.setProperty("--wg-article-height", `${height}px`);
    }
    function onPointerUp() {
      resizer.classList.remove("dragging");
      document.body.style.userSelect = "";
      resizer.releasePointerCapture(ev.pointerId);
      resizer.removeEventListener("pointermove", onPointerMove);
      resizer.removeEventListener("pointerup", onPointerUp);
      resizer.removeEventListener("pointercancel", onPointerUp);
      saveRowHeight(articlePane.getBoundingClientRect().height);
    }
    resizer.addEventListener("pointermove", onPointerMove);
    resizer.addEventListener("pointerup", onPointerUp);
    resizer.addEventListener("pointercancel", onPointerUp);
  });
}
