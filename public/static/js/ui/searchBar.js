import { debounce } from "../search.js";

export function setupSearchBar(inputEl, onQuery, wait = 150) {
  const debounced = debounce(onQuery, wait);
  inputEl.addEventListener("input", () => debounced(inputEl.value));
}
