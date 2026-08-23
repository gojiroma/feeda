import { debounce } from "../search.js";
import { recordSearchHistory, getSearchHistory } from "../db.js";
import { syncSearchHistoryNow } from "../searchSync.js";
import { colorForWord } from "../colorPalette.js";

const FEED_URL_RE = /^https?:\/\//i;

// Wires the topbar search input to both live search (debounced, as before)
// and a persistent history bar below the topbar (see #search-history-bar in
// index.html) backed by IndexedDB (see recordSearchHistory / getSearchHistory
// in db.js) — same query searched again just bumps its existing row's
// timestamp, so it naturally sorts above the rest without a separate
// use-count. Each chip is colored the same as its word's highlight mark
// elsewhere in the app (see colorForWord and main.js's highlightQuery), so
// the bar doubles as a legend for those colors.
//
// Pressing Enter on a string starting with http(s):// is treated as
// subscribing to that URL as an RSS feed (via onSubscribe) rather than as a
// search — it's never recorded to search history either, since it isn't one.
export function setupSearchBar(inputEl, onQuery, { onSubscribe, onHistoryChange, wait = 150 } = {}) {
  const debounced = debounce(onQuery, wait);
  const barEl = document.getElementById("search-history-bar");

  async function refreshBar() {
    if (!barEl) return;
    const history = await getSearchHistory();
    renderBar(history);
  }

  function renderBar(history) {
    barEl.innerHTML = "";
    for (const item of history) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "search-history-chip";
      chip.style.setProperty("--search-highlight-color", colorForWord(item.query));
      chip.textContent = item.query;
      chip.addEventListener("click", () => selectHistoryItem(item.query));
      barEl.appendChild(chip);
    }
  }

  function recordAndSync(query) {
    recordSearchHistory(query)
      .then(() => {
        // Fires before the network sync (which can take a moment) rather
        // than after, so the "always highlight every saved search term"
        // feature (see main.js's highlightQuery) and this bar both pick the
        // change up right away instead of waiting on a round-trip that
        // isn't relevant to either.
        onHistoryChange?.();
        refreshBar().catch((err) => console.error("search history reload failed", err));
        return syncSearchHistoryNow();
      })
      .catch((err) => console.error("search history sync failed", err));
  }

  function selectHistoryItem(query) {
    inputEl.value = query;
    onQuery(query);
    recordAndSync(query);
  }

  // Clicking/tapping into the box always starts a fresh search, even if it
  // already had focus (e.g. a second click without ever leaving the box) —
  // "focus" alone only fires the first time, so a plain click-to-clear needs
  // its own listener rather than piggybacking on that.
  function clearForFreshEntry() {
    if (inputEl.value) {
      inputEl.value = "";
      onQuery("");
    }
  }

  inputEl.addEventListener("input", () => debounced(inputEl.value));
  inputEl.addEventListener("focus", clearForFreshEntry);
  inputEl.addEventListener("click", clearForFreshEntry);

  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    const trimmed = inputEl.value.trim();
    if (trimmed && FEED_URL_RE.test(trimmed) && onSubscribe) {
      inputEl.value = "";
      onQuery("");
      onSubscribe(trimmed);
      return;
    }
    if (trimmed) recordAndSync(trimmed);
  });

  refreshBar().catch((err) => console.error("search history load failed", err));
}
