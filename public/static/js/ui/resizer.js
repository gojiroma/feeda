const STORAGE_KEY = "feeda:paneWidths";
const MIN_WIDTH = 160;
const MAX_WIDTH = 640;

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
    resizer.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      const targetPane = resizer.dataset.resizer === "0" ? feedPane : articlePane;
      const startX = ev.clientX;
      const startWidth = targetPane.getBoundingClientRect().width;
      resizer.classList.add("dragging");
      document.body.style.userSelect = "none";

      function onMouseMove(moveEv) {
        const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (moveEv.clientX - startX)));
        targetPane.style.width = `${width}px`;
      }
      function onMouseUp() {
        resizer.classList.remove("dragging");
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        saveWidths({
          feed: feedPane.getBoundingClientRect().width,
          article: articlePane.getBoundingClientRect().width,
        });
      }
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }
}
