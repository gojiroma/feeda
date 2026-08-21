import { debounce } from "../search.js";
import { recordSearchHistory, getSearchHistory } from "../db.js";
import { syncSearchHistoryNow } from "../searchSync.js";

const MAX_VISIBLE_HISTORY = 8;

// Wires the topbar search input to both live search (debounced, as before)
// and a history dropdown backed by IndexedDB (see recordSearchHistory /
// getSearchHistory in db.js) — same query searched again just bumps its
// existing row's timestamp, so it naturally sorts above the rest without a
// separate use-count.
export function setupSearchBar(inputEl, onQuery, wait = 150) {
  const debounced = debounce(onQuery, wait);
  const dropdownEl = document.getElementById("search-history");

  let currentItems = [];

  async function refreshDropdown() {
    const history = await getSearchHistory();
    const typed = inputEl.value.trim().toLowerCase();
    currentItems = (
      typed ? history.filter((h) => h.query.toLowerCase().includes(typed) && h.query.toLowerCase() !== typed) : history
    ).slice(0, MAX_VISIBLE_HISTORY);
    renderDropdown();
  }

  function renderDropdown() {
    if (!dropdownEl) return;
    dropdownEl.innerHTML = "";
    if (currentItems.length === 0) {
      dropdownEl.classList.add("hidden");
      return;
    }
    for (const item of currentItems) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-history-item";
      btn.textContent = item.query;
      // mousedown with preventDefault (not click) so selecting an item
      // doesn't first blur the input — a plain click would fire blur
      // before this handler runs, hiding the dropdown out from under it.
      btn.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        selectHistoryItem(item.query);
      });
      li.appendChild(btn);
      dropdownEl.appendChild(li);
    }
    dropdownEl.classList.remove("hidden");
  }

  function recordAndSync(query) {
    recordSearchHistory(query)
      .then(() => syncSearchHistoryNow())
      .catch((err) => console.error("search history sync failed", err));
  }

  function hideDropdown() {
    if (dropdownEl) dropdownEl.classList.add("hidden");
  }

  function selectHistoryItem(query) {
    inputEl.value = query;
    onQuery(query);
    recordAndSync(query);
    hideDropdown();
  }

  inputEl.addEventListener("input", () => {
    debounced(inputEl.value);
    refreshDropdown().catch((err) => console.error("search history load failed", err));
  });

  // Clearing on every focus (rather than leaving the last query sitting
  // there) means clicking back into the box is always a fresh start —
  // pick something off the history dropdown (still populated below) rather
  // than having to manually select-all/delete the old query first.
  inputEl.addEventListener("focus", () => {
    if (inputEl.value) {
      inputEl.value = "";
      onQuery("");
    }
    refreshDropdown().catch((err) => console.error("search history load failed", err));
  });

  inputEl.addEventListener("blur", hideDropdown);

  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const trimmed = inputEl.value.trim();
      if (trimmed) recordAndSync(trimmed);
      hideDropdown();
    } else if (ev.key === "Escape") {
      hideDropdown();
    }
  });
}
