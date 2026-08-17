export function debounce(fn, wait = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function normalizeQuery(query) {
  return query.trim().toLowerCase();
}

function matchesEntry(query, entry, feedTitle) {
  const haystack = `${feedTitle}\n${entry.title}\n${entry.summary || ""}\n${entry.content || ""}`.toLowerCase();
  return haystack.includes(query);
}

// Searches feed name, article title, and article body in one pass. An entry
// matches either directly (title/summary/content) or via its parent feed's
// name, since the requirement is a single query box spanning all three.
export function searchEntries(query, entries, feedTitleById) {
  const q = normalizeQuery(query);
  if (!q) return entries;
  return entries.filter((entry) => matchesEntry(q, entry, feedTitleById.get(entry.feedId) || ""));
}

export function searchFeeds(query, feeds) {
  const q = normalizeQuery(query);
  if (!q) return feeds;
  return feeds.filter((feed) => feed.title.toLowerCase().includes(q));
}
