import { generateSeed, isValidSeed, deriveFeedId } from "./crypto.js";
import { loadStoredSeed, loadStoredApiBase, initSession, getSession } from "./session.js";
import { getAllFeeds, getEntriesByFeed, putFeed, getFeed } from "./db.js";
import { syncNow, markFeedDirty } from "./sync.js";
import { fetchFeed } from "./feedFetch.js";
import { groupFeedsByFrequency } from "./frequency.js";
import { searchEntries, searchFeeds } from "./search.js";
import { renderFeedList } from "./ui/feedList.js";
import { renderArticleList } from "./ui/articleList.js";
import { renderPreview } from "./ui/preview.js";
import { setupSearchBar } from "./ui/searchBar.js";

const setupScreen = document.getElementById("setup-screen");
const appRoot = document.getElementById("app");
const feedListEl = document.getElementById("feed-list");
const articleListEl = document.getElementById("article-list");
const previewEl = document.getElementById("preview");

const state = {
  feedsById: new Map(),
  feedTitleById: new Map(),
  entriesByFeed: new Map(),
  selectedFeedId: null,
  selectedEntry: null,
  searchQuery: "",
};

function isUnread(entry, feed) {
  if (!feed) return true;
  if (!entry || !entry.pubDate) {
    // No date to compare against the readUntil watermark — fall back to
    // the feed's content-hash signal: everything in a date-less feed reads
    // as unread as a block until the feed itself is marked caught-up (see
    // hashEntryList in feedFetch.js and the catch-up logic in selectFeed).
    return Boolean(feed.latestContentHash) && feed.latestContentHash !== feed.contentHash;
  }
  const pub = new Date(entry.pubDate).getTime();
  const now = Date.now();
  if (pub > now) return false; // future-dated entries are always treated as read
  const readUntil = feed.readUntil ? new Date(feed.readUntil).getTime() : 0;
  return pub > readUntil;
}

function hasUnread(feed) {
  const entries = state.entriesByFeed.get(feed.feedId) || [];
  return entries.some((e) => isUnread(e, feed));
}

async function loadAppData() {
  const allFeeds = await getAllFeeds();
  const activeFeeds = allFeeds.filter((f) => !f.deletedAt);
  state.feedsById = new Map(activeFeeds.map((f) => [f.feedId, f]));
  state.feedTitleById = new Map(activeFeeds.map((f) => [f.feedId, f.title || f.url]));
  state.entriesByFeed = new Map();
  for (const feed of activeFeeds) {
    state.entriesByFeed.set(feed.feedId, await getEntriesByFeed(feed.feedId));
  }
  if (state.selectedFeedId && !state.feedsById.has(state.selectedFeedId)) {
    state.selectedFeedId = null;
  }
}

function currentFeedGroups() {
  let feeds = [...state.feedsById.values()];
  const query = state.searchQuery;
  if (query) {
    const matchingFeedIds = new Set(searchFeeds(query, feeds).map((f) => f.feedId));
    for (const [feedId, entries] of state.entriesByFeed) {
      if (searchEntries(query, entries, state.feedTitleById).length > 0) matchingFeedIds.add(feedId);
    }
    feeds = feeds.filter((f) => matchingFeedIds.has(f.feedId));
  }
  const feedsWithEntries = feeds.map((feed) => ({
    feed: { ...feed, hasUnread: hasUnread(feed) },
    entries: state.entriesByFeed.get(feed.feedId) || [],
  }));
  return groupFeedsByFrequency(feedsWithEntries);
}

function currentArticles() {
  const query = state.searchQuery;
  if (query) {
    const allEntries = [...state.entriesByFeed.values()].flat();
    const matched = searchEntries(query, allEntries, state.feedTitleById);
    matched.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
    return { entries: matched.slice(0, 200), showFeedName: true };
  }
  if (!state.selectedFeedId) return { entries: [], showFeedName: false };
  const entries = (state.entriesByFeed.get(state.selectedFeedId) || [])
    .slice()
    .sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
  return { entries, showFeedName: false };
}

function render() {
  renderFeedList(feedListEl, {
    groups: currentFeedGroups(),
    selectedFeedId: state.selectedFeedId,
    onSelect: selectFeed,
    onMarkAllRead: markAllRead,
    onDeleteFeed: deleteFeedHandler,
  });

  const { entries, showFeedName } = currentArticles();
  renderArticleList(articleListEl, {
    entries,
    feedTitleById: state.feedTitleById,
    selectedEntryId: state.selectedEntry ? state.selectedEntry.id : null,
    isUnread: (entry) => isUnread(entry, state.feedsById.get(entry.feedId)),
    onSelect: openEntry,
    showFeedName,
  });

  renderPreview(previewEl, state.selectedEntry);
}

async function selectFeed(feedId) {
  state.selectedFeedId = feedId;
  state.selectedEntry = null;
  render();

  // Date-less feeds have no per-article signal to advance (see isUnread),
  // so viewing the feed is what catches it up instead of clicking an entry.
  const feed = state.feedsById.get(feedId);
  if (feed && feed.latestContentHash && feed.latestContentHash !== feed.contentHash) {
    const updated = { ...feed, contentHash: feed.latestContentHash };
    await markFeedDirty(updated);
    state.feedsById.set(feedId, updated);
    render();
    syncNow().catch((err) => console.error("sync failed", err));
  }
}

async function openEntry(entry) {
  state.selectedEntry = entry;
  render();

  const feed = state.feedsById.get(entry.feedId);
  if (!feed || !entry.pubDate) return;
  const pubTime = new Date(entry.pubDate).getTime();
  const currentReadUntil = feed.readUntil ? new Date(feed.readUntil).getTime() : 0;
  if (pubTime > currentReadUntil && pubTime <= Date.now()) {
    const updated = { ...feed, readUntil: entry.pubDate };
    await markFeedDirty(updated);
    state.feedsById.set(feed.feedId, updated);
    render();
    syncNow().catch((err) => console.error("sync failed", err));
  }
}

async function markAllRead(feedId) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  const updated = {
    ...feed,
    readUntil: new Date().toISOString(),
    contentHash: feed.latestContentHash || feed.contentHash,
  };
  await markFeedDirty(updated);
  state.feedsById.set(feedId, updated);
  render();
  syncNow().catch((err) => console.error("sync failed", err));
}

async function deleteFeedHandler(feedId) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  if (!confirm(`「${feed.title || feed.url}」の購読を解除しますか？`)) return;
  const tombstoned = { ...feed, deletedAt: new Date().toISOString() };
  await markFeedDirty(tombstoned);
  if (state.selectedFeedId === feedId) state.selectedFeedId = null;
  if (state.selectedEntry && state.selectedEntry.feedId === feedId) state.selectedEntry = null;
  await loadAppData();
  render();
  syncNow().catch((err) => console.error("sync failed", err));
}

async function addFeedByUrl(rawUrl) {
  const url = rawUrl.trim();
  if (!url) return;
  const { seed } = getSession();
  const feedId = await deriveFeedId(seed, url);
  const existing = await getFeed(feedId);
  if (existing && !existing.deletedAt) {
    state.selectedFeedId = feedId;
    render();
    return;
  }

  const now = new Date().toISOString();
  const feed = {
    feedId,
    url,
    title: "",
    addedAt: now,
    readUntil: null,
    contentHash: null,
    deletedAt: null,
    clientUpdatedAt: now,
    dirty: true,
    lastFetchedAt: null,
    etag: null,
    lastModified: null,
    latestContentHash: null,
  };
  await putFeed(feed);
  await loadAppData();
  render();

  try {
    await fetchFeed(feed);
  } catch (err) {
    console.error("initial feed fetch failed", err);
  }
  await loadAppData();
  render();
  syncNow().catch((err) => console.error("sync failed", err));
}

async function refreshAll() {
  try {
    await syncNow();
  } catch (err) {
    console.error("sync failed", err);
  }
  await loadAppData();
  render();

  for (const feed of state.feedsById.values()) {
    try {
      await fetchFeed(feed);
    } catch (err) {
      console.error(`fetch failed for ${feed.url}`, err);
    }
  }
  await loadAppData();
  render();
}

function wireApp() {
  setupSearchBar(document.getElementById("search-input"), (query) => {
    state.searchQuery = query;
    render();
  });
  document.getElementById("refresh-btn").addEventListener("click", () => refreshAll());
  document.getElementById("add-feed-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = document.getElementById("add-feed-url");
    const url = input.value;
    input.value = "";
    await addFeedByUrl(url);
  });
}

async function startApp() {
  appRoot.classList.remove("hidden");
  wireApp();
  await loadAppData();
  render();
  refreshAll();
}

function wireSetupScreen() {
  document.getElementById("api-base-input").value = loadStoredApiBase();
  document.getElementById("generate-seed-btn").addEventListener("click", () => {
    document.getElementById("seed-input").value = generateSeed();
  });
  document.getElementById("start-btn").addEventListener("click", async () => {
    const seedInput = document.getElementById("seed-input");
    const apiBaseInput = document.getElementById("api-base-input");
    const errorEl = document.getElementById("setup-error");
    errorEl.textContent = "";

    const seed = seedInput.value.trim();
    const apiBase = apiBaseInput.value.trim().replace(/\/+$/, "");

    if (!isValidSeed(seed)) {
      errorEl.textContent = "シードの形式が正しくありません（20文字以上の英数字）。";
      return;
    }
    try {
      await initSession(seed, apiBase);
    } catch (err) {
      errorEl.textContent = "セットアップに失敗しました: " + err.message;
      return;
    }
    setupScreen.classList.add("hidden");
    await startApp();
  });
}

async function boot() {
  const storedSeed = loadStoredSeed();
  if (storedSeed) {
    await initSession(storedSeed, loadStoredApiBase());
    setupScreen.classList.add("hidden");
    await startApp();
  } else {
    wireSetupScreen();
  }
}

boot();
