import { generateSeed, isValidSeed } from "./crypto.js";
import { loadStoredSeed, loadStoredApiBase, initSession } from "./session.js";
import { getAllFeeds, getEntriesByFeed } from "./db.js";
import { syncNow, markFeedDirty } from "./sync.js";
import { fetchFeed } from "./feedFetch.js";
import { groupFeedsByFrequency, FREQUENCY_ORDER } from "./frequency.js";
import { searchEntries, searchFeeds } from "./search.js";
import { renderFeedList } from "./ui/feedList.js";
import { renderArticleList } from "./ui/articleList.js";
import { renderPreview } from "./ui/preview.js";
import { setupSearchBar } from "./ui/searchBar.js";
import { setupPaneResizing } from "./ui/resizer.js";
import { updateFavicon } from "./favicon.js";

const setupScreen = document.getElementById("setup-screen");
const appRoot = document.getElementById("app");
const feedListEl = document.getElementById("feed-list");
const articleListEl = document.getElementById("article-list");
const previewEl = document.getElementById("preview");
const statusBarEl = document.getElementById("status-bar");
const statusBarFillEl = document.getElementById("status-bar-fill");
const statusBarTextEl = document.getElementById("status-bar-text");

const PANE_ORDER = ["feed", "article", "preview"];

const state = {
  feedsById: new Map(),
  feedTitleById: new Map(),
  entriesByFeed: new Map(),
  selectedFeedId: null,
  selectedEntry: null,
  searchQuery: "",
  focusedPane: "article",
  keyboardNavActive: false,
  // Snapshot of the cross-feed "unread timeline" shown when no feed is
  // selected. Frozen at capture time so opening an entry (which marks it,
  // and possibly its whole feed, as read) doesn't yank it out of the list
  // the user is currently looking at — see currentArticles(). Cleared
  // whenever fresh data is loaded from IndexedDB (loadAppData).
  unreadTimelineSnapshot: null,
};

function isUnread(entry, feed) {
  if (!feed) return true;
  if (!entry || !entry.pubDate) {
    // No date to compare against the readUntil watermark — fall back to
    // the feed's content-hash signal: everything in a date-less feed reads
    // as unread as a block until the feed itself is marked caught-up.
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

function countUnreadSources() {
  let count = 0;
  for (const feed of state.feedsById.values()) {
    if (hasUnread(feed)) count++;
  }
  return count;
}

function sortedEntriesForFeed(feedId) {
  return (state.entriesByFeed.get(feedId) || [])
    .slice()
    .sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
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
  state.unreadTimelineSnapshot = null;
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

function flatFeedList() {
  return currentFeedGroups().flatMap((g) => g.feeds);
}

function currentArticles() {
  const query = state.searchQuery;
  if (query) {
    const allEntries = [...state.entriesByFeed.values()].flat();
    const matched = searchEntries(query, allEntries, state.feedTitleById);
    matched.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
    return { entries: matched.slice(0, 200), showFeedName: true, emptyHint: "検索結果がありません。" };
  }
  if (state.selectedFeedId) {
    return { entries: sortedEntriesForFeed(state.selectedFeedId), showFeedName: false, emptyHint: "記事がありません。" };
  }
  // Nothing selected: show unread entries across all feeds, newest first
  // (date-less unread entries have no position to sort by, so they sink to
  // the end — see the pubDate-less comparator behavior below). The set of
  // entries is frozen in state.unreadTimelineSnapshot the first time it's
  // needed and reused after that — opening an entry marks it (and possibly
  // its whole feed) as read, and isUnread is re-evaluated live for styling,
  // but the entry stays in place instead of vanishing out of the list.
  if (!state.unreadTimelineSnapshot) {
    const unread = [];
    for (const feed of state.feedsById.values()) {
      for (const entry of state.entriesByFeed.get(feed.feedId) || []) {
        if (isUnread(entry, feed)) unread.push(entry);
      }
    }
    unread.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
    state.unreadTimelineSnapshot = unread;
  }
  return { entries: state.unreadTimelineSnapshot, showFeedName: true, emptyHint: "未読の記事はありません。" };
}

function render() {
  const query = state.searchQuery;

  renderFeedList(feedListEl, {
    groups: currentFeedGroups(),
    selectedFeedId: state.selectedFeedId,
    query,
    onSelect: selectFeed,
  });

  const { entries, showFeedName, emptyHint } = currentArticles();
  renderArticleList(articleListEl, {
    entries,
    feedTitleById: state.feedTitleById,
    selectedEntryId: state.selectedEntry ? state.selectedEntry.id : null,
    query,
    isUnread: (entry) => isUnread(entry, state.feedsById.get(entry.feedId)),
    onSelect: openEntry,
    showFeedName,
    emptyHint,
  });

  renderPreview(previewEl, state.selectedEntry, query);
  updateFavicon(countUnreadSources());
}

// Advances a feed's read state (readUntil watermark and/or content-hash
// catch-up) based on the entry being viewed. Used both when clicking an
// article directly and when selecting a feed (which opens its top entry).
async function advanceProgress(entry) {
  const feed = state.feedsById.get(entry.feedId);
  if (!feed) return;

  let updated = feed;
  let changed = false;

  if (entry.pubDate) {
    const pubTime = new Date(entry.pubDate).getTime();
    const currentReadUntil = updated.readUntil ? new Date(updated.readUntil).getTime() : 0;
    if (pubTime > currentReadUntil && pubTime <= Date.now()) {
      updated = { ...updated, readUntil: entry.pubDate };
      changed = true;
    }
  }
  if (updated.latestContentHash && updated.latestContentHash !== updated.contentHash) {
    updated = { ...updated, contentHash: updated.latestContentHash };
    changed = true;
  }

  if (changed) {
    await markFeedDirty(updated);
    state.feedsById.set(feed.feedId, updated);
    render();
    syncNow().catch((err) => console.error("sync failed", err));
  }
}

async function selectFeed(feedId) {
  state.selectedFeedId = feedId;
  const topEntry = sortedEntriesForFeed(feedId)[0] || null;
  state.selectedEntry = topEntry;
  setFocusedPane("feed");
  render();
  if (topEntry) await advanceProgress(topEntry);
}

async function openEntry(entry) {
  state.selectedEntry = entry;
  setFocusedPane("article");
  render();
  await advanceProgress(entry);
}

async function refreshAll() {
  try {
    await syncNow();
  } catch (err) {
    console.error("sync failed", err);
  }
  await loadAppData();
  render();

  // Only fetch feeds that are actually due, per their own posting-frequency
  // schedule (see computeSchedule in feedFetch.js) — with a large
  // subscription list, re-fetching everything on every visit doesn't scale.
  // Due feeds are fetched most-frequent-first (using frequencyGroup, which
  // is synced — see sync.js — so even a fresh device with no local fetch
  // history yet can prioritize by it) so daily feeds' fresh content shows
  // up before time is spent on rarely-updated ones.
  const now = Date.now();
  const dueFeeds = [...state.feedsById.values()]
    .filter((feed) => !feed.nextCheckAt || new Date(feed.nextCheckAt).getTime() <= now)
    .sort((a, b) => {
      const ai = FREQUENCY_ORDER.indexOf(a.frequencyGroup || "unknown");
      const bi = FREQUENCY_ORDER.indexOf(b.frequencyGroup || "unknown");
      return ai - bi;
    });

  for (let i = 0; i < dueFeeds.length; i++) {
    const feed = dueFeeds[i];
    showStatus(`フィードを取得中… (${i + 1}/${dueFeeds.length}) ${feed.title || feed.url}`, i / dueFeeds.length);
    try {
      await fetchFeed(feed);
    } catch (err) {
      console.error(`fetch failed for ${feed.url}`, err);
    }
  }
  hideStatus();
  await loadAppData();
  render();
}

function showStatus(text, fraction) {
  statusBarTextEl.textContent = text;
  statusBarFillEl.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  statusBarEl.classList.remove("hidden");
}

function hideStatus() {
  statusBarEl.classList.add("hidden");
  statusBarFillEl.style.width = "0%";
}

// --- pane focus + keyboard navigation ---------------------------------

function setFocusedPane(pane) {
  state.focusedPane = pane;
  // The outline exists to orient keyboard navigation; don't show it until a
  // real key press has actually happened, so touch devices (which click
  // panes but never fire keydown) never see it.
  if (!state.keyboardNavActive) return;
  for (const el of document.querySelectorAll(".pane")) el.classList.remove("focused");
  const el = document.getElementById(`${pane}-pane`);
  if (el) el.classList.add("focused");
}

// Only reserve the arrow keys an editable field actually uses natively.
// A single-line <input> (our search box) only uses Left/Right to move the
// text cursor — Up/Down do nothing in it natively, so leaving focus there
// (e.g. after typing a search query without clicking elsewhere) shouldn't
// also block pane navigation via Up/Down. Multi-line/contentEditable
// fields use all four, so those still block everything.
function shouldIgnoreArrowKey(key) {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
  if (el.tagName === "INPUT") return key === "ArrowLeft" || key === "ArrowRight";
  return false;
}

// render() runs synchronously (before the first await) inside both
// selectFeed and openEntry, so the newly-selected .selected element already
// exists in the DOM by the time the call below returns — safe to scroll to
// it immediately without awaiting the async read-state work that follows.
function scrollSelectedIntoView(containerEl, selector) {
  containerEl.querySelector(selector)?.scrollIntoView({ block: "nearest" });
}

function moveFeedSelection(delta) {
  const feeds = flatFeedList();
  if (feeds.length === 0) return;
  const idx = feeds.findIndex((f) => f.feedId === state.selectedFeedId);
  const targetIdx = idx === -1 ? (delta > 0 ? 0 : feeds.length - 1) : Math.min(Math.max(idx + delta, 0), feeds.length - 1);
  selectFeed(feeds[targetIdx].feedId);
  scrollSelectedIntoView(feedListEl, ".feed-item.selected");
}

function moveArticleSelection(delta) {
  const entries = currentArticles().entries;
  if (entries.length === 0) return;
  const idx = entries.findIndex((e) => state.selectedEntry && e.id === state.selectedEntry.id);
  const targetIdx = idx === -1 ? (delta > 0 ? 0 : entries.length - 1) : Math.min(Math.max(idx + delta, 0), entries.length - 1);
  openEntry(entries[targetIdx]);
  scrollSelectedIntoView(articleListEl, ".article-item.selected");
}

function scrollPreview(delta) {
  document.getElementById("preview-pane").scrollBy({ top: delta, behavior: "smooth" });
}

function wireKeyboardNav() {
  document.addEventListener("keydown", (ev) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
    if (shouldIgnoreArrowKey(ev.key)) return;
    ev.preventDefault();

    if (!state.keyboardNavActive) {
      state.keyboardNavActive = true;
      setFocusedPane(state.focusedPane); // show the outline now that a real key press confirmed a keyboard is in use
    }

    if (ev.key === "ArrowLeft") {
      const idx = PANE_ORDER.indexOf(state.focusedPane);
      setFocusedPane(PANE_ORDER[Math.max(idx - 1, 0)]);
      return;
    }
    if (ev.key === "ArrowRight") {
      const idx = PANE_ORDER.indexOf(state.focusedPane);
      setFocusedPane(PANE_ORDER[Math.min(idx + 1, PANE_ORDER.length - 1)]);
      return;
    }
    if (ev.key === "ArrowUp") {
      if (state.focusedPane === "feed") moveFeedSelection(-1);
      else if (state.focusedPane === "article") moveArticleSelection(-1);
      else scrollPreview(-80);
      return;
    }
    if (ev.key === "ArrowDown") {
      if (state.focusedPane === "feed") moveFeedSelection(1);
      else if (state.focusedPane === "article") moveArticleSelection(1);
      else scrollPreview(80);
    }
  });

  document.getElementById("preview-pane").addEventListener("click", () => setFocusedPane("preview"));
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch((err) => console.error("exit fullscreen failed", err));
  } else {
    document.documentElement.requestFullscreen().catch((err) => console.error("fullscreen request failed", err));
  }
}

function wireApp() {
  setupSearchBar(document.getElementById("search-input"), (query) => {
    state.searchQuery = query;
    render();
  });
  setupPaneResizing();
  wireKeyboardNav();
  document.getElementById("brand-btn").addEventListener("click", toggleFullscreen);
}

async function startApp() {
  appRoot.classList.remove("hidden");
  wireApp();
  setFocusedPane("article");
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
