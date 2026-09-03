import { generateSeed, isValidSeed, deriveFeedId } from "./crypto.js";
import {
  loadStoredApiBase,
  initSession,
  initEphemeralSession,
  endEphemeralSession,
  resumeStoredSession,
  getSession,
} from "./session.js";
import { consumeShareLink } from "./shareLink.js";
import { getAllFeeds, getFeed, getEntriesByFeed, getAllEntries, getAllSearchHistoryEntries, getAllLogEntries } from "./db.js";
import { syncNow, markFeedDirty } from "./sync.js";
import { syncLogNow } from "./logSync.js";
import { syncSearchHistoryNow } from "./searchSync.js";
import { syncNgWordsNow } from "./ngWordSync.js";
import { getActiveNgWords, matchesAnyNgWord } from "./ngWords.js";
import { syncUrlBlockNow } from "./urlBlockSync.js";
import { addUrlBlockPattern, getActiveUrlBlockPatterns, matchesAnyUrlBlockPattern, defaultUrlBlockPattern } from "./urlBlocks.js";
import {
  recordOpen,
  addComment,
  setLogEntryColor,
  removeLogEntry,
  getEntriesForDay,
  getDailyCounts,
  getFeedAddedCounts,
  getLatestLogEntriesByEntryId,
  searchLogEntries,
  dateStrOf,
  shiftDateStr,
} from "./logbook.js";
import { fetchFeed } from "./feedFetch.js";
import { searchEntries } from "./search.js";
import { renderColorFilter } from "./ui/commonComponents.js";
import { colorForWord } from "./colorPalette.js";
import { renderArticleList } from "./ui/articleList.js";
import { renderFeedList } from "./ui/feedList.js";
import { renderPreview } from "./ui/preview.js";
import { setupPaneResizing } from "./ui/resizer.js";
import { renderReflectTimeline, renderDayChart, openBlockUrlPopup } from "./ui/reflect.js";
import { setupSearchBar } from "./ui/searchBar.js";
import { setupSeedModal } from "./ui/seedModal.js";
import { setupNgWordModal } from "./ui/ngWordModal.js";
import { setupUrlBlockModal } from "./ui/urlBlockModal.js";
import { setupShortcutsModal } from "./ui/shortcutsModal.js";
import { setupPairingShareUI, setupPairingReceiveUI } from "./ui/pairingModal.js";
import { setupShareLinkUI } from "./ui/shareLinkModal.js";
import { setFavicon } from "./favicon.js";

const setupScreen = document.getElementById("setup-screen");
const appRoot = document.getElementById("app");
const feedColorFilterEl = document.getElementById("feed-color-filter");
const searchInputEl = document.getElementById("search-input");
const feedListEl = document.getElementById("feed-list");
const articleListEl = document.getElementById("article-list");
const previewEl = document.getElementById("preview");
const statusBarEl = document.getElementById("status-bar");
const statusBarFillEl = document.getElementById("status-bar-fill");
const statusBarTextEl = document.getElementById("status-bar-text");
const modeToggleBtn = document.getElementById("mode-toggle-btn");
const moreMenuBtn = document.getElementById("more-menu-btn");
const moreMenuEl = document.getElementById("more-menu");
// Set by setupShortcutsModal (see wireApp) — read here so wireKeyboardNav's
// "?" binding can open the same modal instance instead of each keeping its
// own. Assigned before wireKeyboardNav's listener can ever actually fire
// (both happen synchronously inside wireApp), so the placeholder default
// never really runs.
let openShortcutsModal = () => { };
// Set by setupSearchBar (see wireApp) — refreshMeta calls this after
// pulling search history from the server in the background, since that bar
// otherwise only ever refreshes itself right after a search made in this
// tab (see ui/searchBar.js).
let refreshSearchHistoryBar = () => { };
const reflectTimelineEl = document.getElementById("reflect-timeline");
const reflectDayNavEl = document.getElementById("reflect-day-nav");
const reflectDateLabelEl = document.getElementById("reflect-date-label");
const reflectDayChartEl = document.getElementById("reflect-day-chart");
const reflectFeedChartEl = document.getElementById("reflect-feed-chart");

// Width of the trend strip in the day-nav header — see renderDayChart.
const REFLECT_DAY_CHART_DAYS = 21;

const state = {
  feedsById: new Map(),
  feedTitleById: new Map(),
  // entry.id -> its latest log entry (see getLatestLogEntriesByEntryId in
  // logbook.js) — lets the article list/preview show a color tag/comment
  // recorded from reflect (or straight from here) without a per-row
  // IndexedDB lookup for every visible article.
  logByEntryId: new Map(),
  searchQuery: "",
  // The most recent non-empty search query, kept around after searchQuery
  // itself goes back to "" (search cleared, or the box auto-clearing on
  // every focus — see searchBar.js). Powers highlightQuery() below so
  // article titles/body text keep showing what you were just looking for
  // even once you're back to browsing a feed.
  lastSearchQuery: "",
  // Color-tag keys (see colorPalette.js) currently toggled on in the top
  // filter bar — see renderColorFilter in ui/commonComponents.js and
  // toggleFeedColorFilter below. A feed matches if it has any color in
  // this set; empty means no filter, show every feed.
  feedColorFilter: new Set(),
  // Lowercased NG words (see ngWords.js/setupNgWordModal) — an entry whose
  // title contains one is filtered out of the article list (see
  // filterByNgWords). Lowercased once here rather than per-entry at filter
  // time, since matching itself is case-insensitive.
  ngWords: [],
  // "刈り取り" (reap) URL block patterns (see urlBlocks.js/setupUrlBlockModal)
  // — an entry whose link matches one is filtered out of the article list
  // the same way an NG-worded title is (see filterByUrlBlocks), on top of
  // never being stored at all going forward (see feedFetch.js).
  urlBlockPatterns: [],
  // Every saved search-history query (see db.js's searchHistory store),
  // kept around so highlightQuery can mark them all as "things I've looked
  // for before" all the time, not just the one currently/last searched.
  searchHistoryWords: [],
  // "view" is the normal reading UI; "reflect" swaps in the activity-log
  // timeline (see renderReflect) — the two are different enough (date-
  // scoped instead of feed-scoped) that they get their own top-level screen
  // rather than sharing render().
  mode: "view",
  reflectDate: dateStrOf(),
  // Which feed's block is currently selected in the left pane, and that
  // feed's entries (cached IndexedDB rows, refreshed by an on-demand fetch
  // — see selectFeed). There is no background crawl any more: a feed's
  // content is only ever fetched the moment it's clicked.
  selectedFeedId: null,
  selectedFeedEntries: [],
  // Raw (unfiltered by NG words/URL blocks — see currentArticles) results
  // of the most recent cross-feed search, over whatever's already cached
  // locally from feeds that have actually been opened before.
  searchResults: null,
  // Which article (from whichever list currentArticles() is currently
  // showing) is selected for the preview pane.
  selectedEntryId: null,
};

function sortedEntriesForFeed(entries) {
  return entries.slice().sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
}

async function loadAppData() {
  const allFeeds = await getAllFeeds();
  const activeFeeds = allFeeds.filter((f) => !f.deletedAt);
  state.feedsById = new Map(activeFeeds.map((f) => [f.feedId, f]));
  state.feedTitleById = new Map(activeFeeds.map((f) => [f.feedId, f.title || f.url]));
  state.logByEntryId = await getLatestLogEntriesByEntryId();
  state.ngWords = (await getActiveNgWords()).map((w) => w.word.toLowerCase());
  state.urlBlockPatterns = (await getActiveUrlBlockPatterns()).map((p) => p.pattern);
  state.searchHistoryWords = (await getAllSearchHistoryEntries()).map((e) => e.query);
}

// Article titles and preview/body text highlight this instead of the live
// searchQuery. Two layers, both always-on regardless of whether a search is
// actually active right now: the live-or-last query (see lastSearchQuery's
// own comment) in the normal yellow .search-highlight, listed first so it
// wins wherever it overlaps a history term; and every *other* saved search-
// history keyword (state.searchHistoryWords, kept fresh by loadAppData and
// searchBar.js's onHistoryChange) in .search-highlight-history, each word
// its own stable color (see colorPalette.js's colorForWord) so it also
// matches that word's chip in the search-history bar.
function highlightQuery() {
  const current = (state.searchQuery.trim() || state.lastSearchQuery).trim();
  const terms = [];
  if (current) terms.push({ text: current, className: "search-highlight" });
  for (const word of state.searchHistoryWords) {
    if (word && word.toLowerCase() !== current.toLowerCase()) {
      terms.push({ text: word, className: "search-highlight-history", color: colorForWord(word) });
    }
  }
  return terms;
}

// An entry whose title contains a registered NG word (see ngWords.js/the
// "NGワード" topbar button) never shows up in the article list.
function filterByNgWords(entries) {
  if (state.ngWords.length === 0) return entries;
  return entries.filter((e) => !matchesAnyNgWord(e.title, state.ngWords));
}

// Sibling of filterByNgWords for the "刈り取り" (reap) URL blocklist (see
// urlBlocks.js/setupUrlBlockModal) — feedFetch.js already keeps a freshly
// fetched match from ever being stored, but this also hides any match that
// was already sitting in IndexedDB from before the pattern existed, without
// actually deleting it (removing the pattern later brings it right back).
function filterByUrlBlocks(entries) {
  if (state.urlBlockPatterns.length === 0) return entries;
  return entries.filter((e) => !matchesAnyUrlBlockPattern(e.link, state.urlBlockPatterns));
}

// The middle pane's only content: whichever feed is selected in the left
// pane, or a cross-feed search over whatever's cached locally, or (nothing
// selected yet) an empty hint. There is no cross-feed "unread timeline" any
// more — the feed list is always visible instead, so that's the way back to
// anything.
function currentArticles() {
  if (state.searchQuery.trim()) {
    return {
      entries: filterByUrlBlocks(filterByNgWords(state.searchResults || [])),
      showFeedName: true,
      emptyHint: "検索結果がありません。",
    };
  }
  if (state.selectedFeedId) {
    return {
      entries: filterByUrlBlocks(filterByNgWords(state.selectedFeedEntries)),
      showFeedName: false,
      emptyHint: "記事がありません。",
    };
  }
  return { entries: [], showFeedName: false, emptyHint: "左のフィード一覧からフィードを選択してください。" };
}

async function runSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    state.searchResults = null;
    render();
    return;
  }
  const allEntries = await getAllEntries();
  const matched = searchEntries(trimmed, allEntries, state.feedTitleById);
  matched.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
  state.searchResults = matched.slice(0, 200);
  render();
}

function render() {
  // The reflect screen never depends on feed/article state, so it must not
  // be redrawn by the generic render() pump — reflect draws itself from its
  // own actions instead (toggleMode, changeReflectDate, jumpReflectToToday,
  // handleAddComment) — see renderReflect callers below.
  if (state.mode === "reflect") return;
  // Doubles as the registered-feed count display and a discoverable hint
  // that pasting a URL here registers it as a new subscription (see the
  // http(s):// branch in searchBar.js's onSubscribe), instead of spending a
  // dedicated line on either.
  searchInputEl.placeholder = `${state.feedsById.size}件を検索・URLを貼り付けて登録`;
  renderApp();
}

// While sitting on 振り返る, pick up log rows written from elsewhere —
// mainly the Tampermonkey auto-log script (see userscript/feeda-
// autoregister.user.js), which pushes straight to the server from whatever
// site tab you're reading in, with no way to poke this tab about it.
const REFLECT_LIVE_REFRESH_MS = 2 * 60 * 1000;
let reflectLiveRefreshTimer = null;

function startReflectLiveRefresh() {
  stopReflectLiveRefresh();
  reflectLiveRefreshTimer = setInterval(() => {
    renderReflect().catch((err) => console.error("reflect render failed", err));
  }, REFLECT_LIVE_REFRESH_MS);
}

function stopReflectLiveRefresh() {
  clearInterval(reflectLiveRefreshTimer);
  reflectLiveRefreshTimer = null;
}

// A tab that was in the background (e.g. the one actually holding the
// article you were reading) coming back to the foreground is exactly the
// moment a stale reflect screen is most likely to be looked at — catch it
// immediately instead of waiting for the interval above.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.mode === "reflect") {
    renderReflect().catch((err) => console.error("reflect render failed", err));
  }
});

// The very first time 振り返る is opened this session, "今日" can easily
// have nothing logged yet — articles are only ever logged by actually
// clicking into one (see openEntry), and a session spent just browsing
// feeds for the first time since opening the app won't have done that yet.
// Landing on a seemingly-blank "この日はまだ記録がありません。" (plus
// near-invisible zero-height trend bars) reads as "振り返るが壊れている"
// even though real history exists on an earlier day — jump to the most
// recent day that actually has something logged instead, once, the first
// time reflect is opened. Never runs again after that: once the user's
// navigated (today, a different day, back), further switches must not
// silently yank them somewhere else.
let hasCheckedForRecentActivity = false;

async function jumpToMostRecentActivityIfTodayEmpty() {
  if (hasCheckedForRecentActivity) return;
  hasCheckedForRecentActivity = true;
  try {
    const todayEntries = await getEntriesForDay(state.reflectDate);
    if (todayEntries.length > 0) return;
    const all = await getAllLogEntries();
    const latest = all
      .filter((e) => !e.deletedAt && e.openedAt)
      .sort((a, b) => (b.openedAt || "").localeCompare(a.openedAt || ""))[0];
    if (latest) state.reflectDate = dateStrOf(new Date(latest.openedAt));
  } catch (err) {
    console.error("recent activity check failed", err);
  }
}

function setMode(mode) {
  state.mode = mode;
  appRoot.classList.toggle("reflect-mode", mode === "reflect");
  // Icon-only button (see .icon-btn in style.css) — the glyph itself
  // (📖) doesn't change, .active carries which mode is current, and the
  // title covers what a click does for anyone hovering/using a screen
  // reader.
  modeToggleBtn.classList.toggle("active", mode === "reflect");
  modeToggleBtn.title = mode === "reflect" ? "見るに戻る" : "振り返る";
  if (mode === "reflect") {
    jumpToMostRecentActivityIfTodayEmpty()
      .then(() => renderReflect())
      .catch((err) => console.error("reflect render failed", err));
    startReflectLiveRefresh();
  } else {
    stopReflectLiveRefresh();
    render();
  }
}

function toggleMode() {
  setMode(state.mode === "view" ? "reflect" : "view");
}

function formatReflectDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}

// Pulls fresh log rows before reading from local IndexedDB — see the
// REFLECT_LIVE_REFRESH_MS comment above. Sync failure (offline, server
// hiccup) falls back to whatever's already local rather than blocking the
// render. Everything past that sync is wrapped in its own try/catch: an
// IndexedDB read going wrong here used to leave the screen silently blank
// (only a console.error, which nobody watching the actual screen ever
// sees) — showing the failure in the timeline itself instead means a
// broken 振り返る is at least visibly broken, not indistinguishable from
// "no records yet".
async function renderReflect() {
  await syncLogNow().catch((err) => console.error("log sync failed", err));
  // Same shared #feed-color-filter bar the main screen shows above the
  // article list (see renderApp) — now visible in reflect mode too (see
  // style.css's .app.reflect-mode rules), so it needs refreshing here the
  // same way, since render() itself no-ops in reflect mode.
  renderFeedColorFilterBar();
  const query = state.searchQuery.trim();
  // The day-nav (prev/next/today + trend charts) has nothing sensible to
  // show while a search query is narrowing the timeline instead of a single
  // day — no one day is "selected", so hide the whole thing rather than
  // leave it showing controls that don't apply right now.
  reflectDayNavEl.classList.toggle("hidden", Boolean(query));
  try {
    if (query) {
      reflectDateLabelEl.textContent = `「${query}」の検索結果`;
      const rawEntries = await searchLogEntries(query);
      renderReflectTimeline(reflectTimelineEl, {
        entries: filterLogEntriesByFeedColor(rawEntries),
        onAddComment: handleAddComment,
        onSetColor: handleSetLogColor,
        onDelete: handleDeleteLog,
        onBlockAndDelete: handleBlockAndDeleteLog,
        emptyHint: "検索結果がありません。",
        showDate: true,
      });
      return;
    }
    reflectDateLabelEl.textContent = formatReflectDateLabel(state.reflectDate);
    const [rawEntries, dailyCounts, feedCounts] = await Promise.all([
      getEntriesForDay(state.reflectDate),
      getDailyCounts(REFLECT_DAY_CHART_DAYS),
      getFeedAddedCounts(REFLECT_DAY_CHART_DAYS),
    ]);
    renderDayChart(reflectDayChartEl, {
      counts: dailyCounts,
      selectedDate: state.reflectDate,
      onSelectDate: jumpReflectToDate,
      onHoverDate: previewReflectDate,
    });
    renderDayChart(reflectFeedChartEl, {
      counts: feedCounts,
      selectedDate: state.reflectDate,
      onSelectDate: jumpReflectToDate,
      onHoverDate: previewReflectDate,
    });
    renderReflectTimeline(reflectTimelineEl, {
      entries: filterLogEntriesByFeedColor(rawEntries),
      onAddComment: handleAddComment,
      onSetColor: handleSetLogColor,
      onDelete: handleDeleteLog,
      onBlockAndDelete: handleBlockAndDeleteLog,
    });
  } catch (err) {
    console.error("reflect render failed", err);
    reflectTimelineEl.innerHTML = "";
    const hint = document.createElement("p");
    hint.className = "empty-hint";
    hint.textContent = `振り返るの表示に失敗しました: ${err.message}`;
    reflectTimelineEl.appendChild(hint);
  }
}

// The feedColorFilter the main screen's #feed-color-filter bar drives (see
// toggleFeedColorFilter), now shown in reflect mode too (see renderReflect).
// Narrows to entries whose *feed* carries one of the active colors — a log
// entry's own color tag (see .reflect-log-item--colored) is a purely visual
// per-entry marker now, with no separate filter of its own (the top bar
// already covers "narrow by color" for this screen).
function filterLogEntriesByFeedColor(entries) {
  if (state.feedColorFilter.size === 0) return entries;
  return entries.filter((e) => {
    const feed = state.feedsById.get(e.feedId);
    return Boolean(feed && feed.color && state.feedColorFilter.has(feed.color));
  });
}

async function handleAddComment(logId, text) {
  await addComment(logId, text);
  await renderReflect();
}

async function handleSetLogColor(logId, color) {
  await setLogEntryColor(logId, color);
  await renderReflect();
}

function changeReflectDate(deltaDays) {
  state.reflectDate = shiftDateStr(state.reflectDate, deltaDays);
  renderReflect().catch((err) => console.error("reflect render failed", err));
}

function jumpReflectToToday() {
  state.reflectDate = dateStrOf();
  renderReflect().catch((err) => console.error("reflect render failed", err));
}

// Shared by exportReflectJson/exportOpml — an object URL only needs to
// survive long enough for the click to start the save, so it's revoked
// right after rather than left to leak for the rest of the session.
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportReflectJson() {
  const entries = await getAllLogEntries();
  entries.sort((a, b) => (a.openedAt || "").localeCompare(b.openedAt || ""));
  const payload = {
    exportedAt: new Date().toISOString(),
    count: entries.length,
    entries,
  };
  downloadFile(`feeda-reflect-${dateStrOf()}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function exportOpml() {
  const escapeXml = (str) =>
    String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const outlines = [...state.feedsById.values()]
    .map((feed) => {
      const title = escapeXml(feed.title || feed.url);
      return `    <outline text="${title}" title="${title}" type="rss" xmlUrl="${escapeXml(feed.url)}" />`;
    })
    .join("\n");
  const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>feeda subscriptions</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>
`;
  downloadFile(`feeda-subscriptions-${dateStrOf()}.opml`, opml, "text/x-opml");
}

function jumpReflectToDate(dateStr) {
  state.reflectDate = dateStr;
  renderReflect().catch((err) => console.error("reflect render failed", err));
}

function previewReflectDate(dateStr) {
  if (dateStr === state.reflectDate) return;
  state.reflectDate = dateStr;
  reflectDateLabelEl.textContent = formatReflectDateLabel(dateStr);
  for (const bar of document.querySelectorAll(".reflect-day-chart-bar")) {
    bar.classList.toggle("selected", bar.dataset.date === dateStr);
  }
  getEntriesForDay(dateStr)
    .then((rawEntries) => {
      renderReflectTimeline(reflectTimelineEl, {
        entries: filterLogEntriesByFeedColor(rawEntries),
        onAddComment: handleAddComment,
        onSetColor: handleSetLogColor,
        onDelete: handleDeleteLog,
        onBlockAndDelete: handleBlockAndDeleteLog,
      });
    })
    .catch((err) => console.error("reflect preview failed", err));
}

async function handleDeleteLog(logId) {
  await removeLogEntry(logId);
  await renderReflect();
}

function handleBlockAndDeleteLog(logEntry, x, y) {
  openBlockUrlPopup(logEntry, x, y, {
    defaultPattern: defaultUrlBlockPattern(logEntry.url),
    onConfirm: async (pattern) => {
      await addUrlBlockPattern(pattern);
      await removeLogEntry(logEntry.id);
      syncUrlBlockNow().catch((err) => console.error("url block sync failed", err));
      await refreshUrlBlockState();
    },
  });
}

async function refreshUrlBlockState() {
  state.urlBlockPatterns = (await getActiveUrlBlockPatterns()).map((p) => p.pattern);
  if (state.mode === "reflect") {
    await renderReflect();
  } else {
    render();
  }
}

let logSyncDebounceTimer = null;
function scheduleLogSync() {
  clearTimeout(logSyncDebounceTimer);
  logSyncDebounceTimer = setTimeout(() => {
    syncLogNow().catch((err) => console.error("log sync failed", err));
  }, 1000);
}

// Shared by renderApp and renderReflect — the top filter bar (see
// .filter-row in style.css). Uses every registered feed, not just what's
// currently shown, so the swatch row itself doesn't shrink away once a
// filter (or a search query) narrows the article list down to one color.
function renderFeedColorFilterBar() {
  renderColorFilter(feedColorFilterEl, {
    feeds: [...state.feedsById.values()],
    activeColors: state.feedColorFilter,
    onToggleColor: toggleFeedColorFilter,
  });
}

// The three panes: an always-visible feed list on the left, the selected
// feed's (or a search's) article list in the middle, and a preview of
// whichever article is selected on the right.
function renderApp() {
  renderFeedColorFilterBar();
  renderFeedListPane();

  const { entries, showFeedName, emptyHint } = currentArticles();

  renderArticleList(articleListEl, {
    entries,
    feedTitleById: state.feedTitleById,
    selectedEntryId: state.selectedEntryId,
    query: highlightQuery(),
    onOpen: openEntry,
    onSetColor: annotateEntrySetColor,
    onAddComment: annotateEntryAddComment,
    logByEntryId: state.logByEntryId,
    showFeedName,
    emptyHint,
  });

  const selectedEntry = state.selectedEntryId ? entries.find((e) => e.id === state.selectedEntryId) || null : null;
  renderPreview(previewEl, selectedEntry, highlightQuery());
}

function renderFeedListPane() {
  renderFeedList(feedListEl, {
    feeds: [...state.feedsById.values()],
    selectedFeedId: state.selectedFeedId,
    onSelect: (feedId) => {
      selectFeed(feedId).catch((err) => console.error("feed select failed", err));
    },
    onTogglePause: togglePauseFeed,
    onTogglePin: togglePinFeed,
    onSetColor: setFeedColor,
    onCopyUrl: copyFeedUrl,
  });
}

// The feed list's only way to show articles — there is no background
// crawl. Clicking a feed shows whatever's already cached for it right
// away, then kicks off a fresh fetch in the background and re-renders once
// it lands.
async function selectFeed(feedId) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  state.selectedFeedId = feedId;
  state.selectedEntryId = null;
  state.searchResults = null;
  state.selectedFeedEntries = sortedEntriesForFeed(await getEntriesByFeed(feedId));
  render();

  showStatus(`フィードを取得中… ${feed.title || feed.url}`, 0);
  try {
    await fetchFeed(feed);
  } catch (err) {
    console.error(`fetch failed for ${feed.url}`, err);
  } finally {
    hideStatus();
  }
  const freshFeed = await getFeed(feedId);
  if (freshFeed) state.feedsById.set(feedId, freshFeed);
  if (state.selectedFeedId === feedId) {
    state.selectedFeedEntries = sortedEntriesForFeed(await getEntriesByFeed(feedId));
    render();
  }
}

async function setFeedPaused(feedId, paused) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  const updated = { ...feed, paused };
  await markFeedDirty(updated);
  state.feedsById.set(feedId, updated);
}

async function togglePauseFeed(feedId) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  await setFeedPaused(feedId, !feed.paused);
  render();
  syncNow().catch((err) => console.error("sync failed", err));
}

async function togglePinFeed(feedId) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  const updated = { ...feed, pinned: !feed.pinned };
  await markFeedDirty(updated);
  state.feedsById.set(feedId, updated);
  render();
  syncNow().catch((err) => console.error("sync failed", err));
}

async function setFeedColor(feedId, colorKey) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  const updated = { ...feed, color: colorKey || null };
  await markFeedDirty(updated);
  state.feedsById.set(feedId, updated);
  render();
  syncNow().catch((err) => console.error("sync failed", err));
}

function toggleFeedColorFilter(colorKey) {
  if (colorKey === null) {
    state.feedColorFilter.clear();
  } else if (state.feedColorFilter.has(colorKey)) {
    state.feedColorFilter.delete(colorKey);
  } else {
    state.feedColorFilter.add(colorKey);
  }
  if (state.mode === "reflect") {
    renderReflect().catch((err) => console.error("reflect render failed", err));
  } else {
    render();
  }
}

async function copyFeedUrl(feed) {
  try {
    await navigator.clipboard.writeText(feed.url);
  } catch (err) {
    console.error("clipboard copy failed", err);
  }
}

// Logs the article as opened — recordOpen's own chatter guard means
// clicking through moments after this won't double-log it.
function logOpen(entry) {
  recordOpen(entry, state.feedsById.get(entry.feedId))
    .then((logEntry) => {
      if (logEntry) state.logByEntryId.set(entry.id, logEntry);
      scheduleLogSync();
    })
    .catch((err) => console.error("log record failed", err));
}

// Selecting an article shows it in the preview pane — there's no read
// state to advance any more, just the reflect-history log.
function openEntry(entry) {
  state.selectedEntryId = entry.id;
  logOpen(entry);
  render();
}

// Backs the article list/preview pane's color palette and comment form —
// needs a log entry to attach a color or comment to, reusing one already
// created (by opening the article) rather than logging a second "open" just
// for this.
async function ensureLogEntryForEntry(entry) {
  let logEntry = state.logByEntryId.get(entry.id) || null;
  if (!logEntry) {
    logEntry = await recordOpen(entry, state.feedsById.get(entry.feedId));
    if (logEntry) state.logByEntryId.set(entry.id, logEntry);
  }
  return logEntry;
}

async function annotateEntrySetColor(entry, color) {
  const logEntry = await ensureLogEntryForEntry(entry);
  if (!logEntry) return;
  const updated = await setLogEntryColor(logEntry.id, color);
  if (updated) {
    state.logByEntryId.set(entry.id, updated);
    render();
  }
  scheduleLogSync();
}

async function annotateEntryAddComment(entry, text) {
  const logEntry = await ensureLogEntryForEntry(entry);
  if (!logEntry) return;
  const updated = await addComment(logEntry.id, text);
  if (updated) {
    state.logByEntryId.set(entry.id, updated);
    render();
  }
  scheduleLogSync();
}

// Enter on an http(s):// URL in the search box (see searchBar.js's
// onSubscribe) registers it as a new feed subscription instead of
// searching. feedId is derived the same way the userscript derives it when
// it discovers a feed link on a page, so a feed added either way converges
// on the same row once synced.
async function subscribeFeedFromUrl(rawUrl) {
  const url = rawUrl.trim();
  const { seed } = getSession();
  const feedId = await deriveFeedId(seed, url);

  const existing = state.feedsById.get(feedId);
  if (existing) {
    showStatus(`既に購読しています: ${existing.title || url}`, 1);
    setTimeout(hideStatus, 2000);
    await selectFeed(feedId);
    return;
  }

  showStatus(`フィードを購読中… ${url}`, 0);
  const now = new Date().toISOString();
  const newFeed = {
    feedId,
    url,
    title: url,
    addedAt: now,
    paused: false,
    color: null,
    pinned: false,
    deletedAt: null,
    lastFetchedAt: null,
    etag: null,
    lastModified: null,
    dirty: true,
    clientUpdatedAt: now,
  };

  let dbEntries = [];
  try {
    dbEntries = await fetchFeed(newFeed);
  } catch (err) {
    console.error(`subscribe failed for ${url}`, err);
    showStatus(`購読に失敗しました: ${url}`, 1);
    setTimeout(hideStatus, 3000);
    return;
  }

  await loadAppData();
  state.selectedFeedId = feedId;
  state.selectedEntryId = null;
  state.selectedFeedEntries = sortedEntriesForFeed(dbEntries);
  render();
  syncNow().catch((err) => console.error("sync failed", err));

  showStatus(`購読しました: ${state.feedsById.get(feedId)?.title || url}`, 1);
  setTimeout(hideStatus, 2000);
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

// --- keyboard navigation ---------------------------------

// Only reserve the arrow keys an editable field actually uses natively.
// A single-line <input> (our search box) only uses Left/Right to move the
// text cursor — Up/Down do nothing in it natively, so leaving focus there
// (e.g. after typing a search query without clicking elsewhere) shouldn't
// also block article navigation via Up/Down. Multi-line/contentEditable
// fields use all four, so those still block everything.
function shouldIgnoreArrowKey(key) {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
  if (el.tagName === "INPUT") return key === "ArrowLeft" || key === "ArrowRight";
  return false;
}

// Guards the single-letter shortcuts below (j/k/o, and Enter as an alias
// for o) — unlike the arrow keys (see shouldIgnoreArrowKey), these have no
// legitimate native meaning inside any field, so any focused
// input/textarea/contentEditable blocks all of them, not just some. Also
// blocks a focused button/link/select so Enter still activates *that*
// instead of being hijacked into "open article" — pressing Enter on a
// modal's close button, say, should do what it looks like it does.
function isInteractiveFocus() {
  const el = document.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "BUTTON", "SELECT", "A"].includes(el.tagName);
}

// j/k (and ArrowUp/ArrowDown) move a keyboard-only "focused" outline (see
// .mobile-article-row.keyboard-focused in style.css) across the article
// rows in document order.
function moveArticleFocus(delta) {
  const rows = [...articleListEl.querySelectorAll(".mobile-article-row")];
  if (rows.length === 0) return;
  const idx = rows.findIndex((r) => r.classList.contains("keyboard-focused"));
  const targetIdx = idx === -1 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(Math.max(idx + delta, 0), rows.length - 1);
  for (const r of rows) r.classList.remove("keyboard-focused");
  const target = rows[targetIdx];
  target.classList.add("keyboard-focused");
  target.scrollIntoView({ block: "nearest" });
}

// "o"/Enter — selects whichever row j/k (or Up/Down) last landed on, the
// same way actually clicking it does.
function openFocusedArticleLink() {
  articleListEl.querySelector(".mobile-article-row.keyboard-focused")?.click();
}

function focusSearchInput() {
  searchInputEl.focus();
  searchInputEl.select();
}

// "u" — clears an active search back to the currently selected feed (or
// the empty "select a feed" hint if none is selected).
function clearSearch() {
  state.searchQuery = "";
  state.searchResults = null;
  searchInputEl.value = "";
  render();
}

function wireKeyboardNav() {
  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    // "?" (help), "/" (search), and "r" (switch between 見る/振り返る) are
    // useful from anywhere, reflect included — everything else below acts
    // on the article list, which reflect doesn't have.
    if (ev.key === "?" && !isInteractiveFocus()) {
      ev.preventDefault();
      openShortcutsModal();
      return;
    }
    if (ev.key === "/" && !isInteractiveFocus()) {
      ev.preventDefault();
      focusSearchInput();
      return;
    }
    if (ev.key === "r" && !isInteractiveFocus()) {
      ev.preventDefault();
      toggleMode();
      return;
    }

    if (state.mode !== "reflect" && !isInteractiveFocus()) {
      if (ev.key === "j") {
        ev.preventDefault();
        moveArticleFocus(1);
        return;
      }
      if (ev.key === "k") {
        ev.preventDefault();
        moveArticleFocus(-1);
        return;
      }
      if (ev.key === "o" || ev.key === "Enter") {
        ev.preventDefault();
        openFocusedArticleLink();
        return;
      }
      if (ev.key === "u") {
        ev.preventDefault();
        clearSearch();
        return;
      }
    }

    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
    if (shouldIgnoreArrowKey(ev.key)) return;

    // 振り返る has its own left/right day navigation instead of article
    // focus — up/down are left alone so the timeline still scrolls
    // normally.
    if (state.mode === "reflect") {
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        changeReflectDate(-1);
      } else if (ev.key === "ArrowRight") {
        ev.preventDefault();
        changeReflectDate(1);
      }
      return;
    }

    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      moveArticleFocus(-1);
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      moveArticleFocus(1);
    }
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch((err) => console.error("exit fullscreen failed", err));
  } else {
    document.documentElement.requestFullscreen().catch((err) => console.error("fullscreen request failed", err));
  }
}

function wireApp() {
  setupPaneResizing();
  const searchBarHandle = setupSearchBar(
    searchInputEl,
    (query) => {
      state.searchQuery = query;
      // Sticky across the box clearing (see lastSearchQuery's own comment and
      // highlightQuery above) — only overwritten by an actual new non-empty
      // query, never cleared out just because this one is empty.
      if (query.trim()) state.lastSearchQuery = query.trim();
      // render() is a no-op in reflect mode (see its own comment) — reflect
      // draws itself directly so a search keystroke actually reaches it.
      if (state.mode === "reflect") {
        renderReflect().catch((err) => console.error("reflect render failed", err));
        return;
      }
      runSearch(query).catch((err) => console.error("search failed", err));
    },
    {
      onSubscribe: (url) => {
        subscribeFeedFromUrl(url).catch((err) => console.error("subscribe failed", err));
      },
      onHistoryChange: () => {
        getAllSearchHistoryEntries()
          .then((entries) => {
            state.searchHistoryWords = entries.map((e) => e.query);
            if (state.mode === "reflect") return;
            render();
          })
          .catch((err) => console.error("search history reload failed", err));
      },
    }
  );
  refreshSearchHistoryBar = searchBarHandle.refreshHistoryBar;
  wireKeyboardNav();
  document.getElementById("brand-btn").addEventListener("click", toggleFullscreen);
  // A share-link session (see session.js's initEphemeralSession) never gets
  // the シード button or its own re-sharing options wired up at all: the
  // whole point of that access is that whoever's using this tab is never
  // shown the raw seed, and a temporary session re-sharing itself would
  // undermine "closing the tab ends access". The ephemeral badge (with its
  // own "今すぐ終了" button) stands in for it instead.
  if (getSession().ephemeral) {
    document.getElementById("seed-btn").classList.add("hidden");
    const badgeEl = document.getElementById("ephemeral-badge");
    badgeEl.classList.remove("hidden");
    document.getElementById("ephemeral-end-btn").addEventListener("click", () => {
      endEphemeralSession();
      location.href = location.pathname;
    });
  } else {
    setupSeedModal(document.getElementById("seed-btn"), document.getElementById("seed-modal"), {
      getSeed: () => getSession().seed,
      getApiBase: () => getSession().apiBase,
    });
    setupPairingShareUI({
      getSeed: () => getSession().seed,
      getApiBase: () => getSession().apiBase,
    });
    setupShareLinkUI({
      getSeed: () => getSession().seed,
      getApiBase: () => getSession().apiBase,
    });
  }
  setupNgWordModal(document.getElementById("ng-word-btn"), document.getElementById("ng-word-modal"), {
    onChange: () => {
      syncNgWordsNow().catch((err) => console.error("ng word sync failed", err));
      getActiveNgWords()
        .then((words) => {
          state.ngWords = words.map((w) => w.word.toLowerCase());
          if (state.mode === "reflect") return;
          render();
        })
        .catch((err) => console.error("ng word reload failed", err));
    },
  });
  setupUrlBlockModal(document.getElementById("url-block-btn"), document.getElementById("url-block-modal"), {
    onChange: () => {
      syncUrlBlockNow().catch((err) => console.error("url block sync failed", err));
      refreshUrlBlockState().catch((err) => console.error("url block reload failed", err));
    },
  });
  openShortcutsModal = setupShortcutsModal(
    document.getElementById("shortcuts-btn"),
    document.getElementById("shortcuts-modal")
  ).open;
  modeToggleBtn.addEventListener("click", toggleMode);
  // "⋯" overflow menu (see .menu-wrap/.more-menu in style.css) holding
  // NGワード/URLブロック/シード/... — closes itself once either item inside
  // is actually clicked (each opens its own modal, unaffected by this) or
  // on any click elsewhere on the page.
  moreMenuBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const nowHidden = moreMenuEl.classList.toggle("hidden");
    moreMenuBtn.setAttribute("aria-expanded", String(!nowHidden));
  });
  moreMenuEl.addEventListener("click", (ev) => {
    if (ev.target.closest("button")) {
      moreMenuEl.classList.add("hidden");
      moreMenuBtn.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("click", (ev) => {
    if (moreMenuEl.classList.contains("hidden") || ev.target.closest(".menu-wrap")) return;
    moreMenuEl.classList.add("hidden");
    moreMenuBtn.setAttribute("aria-expanded", "false");
  });
  document.getElementById("reflect-prev-day").addEventListener("click", () => changeReflectDate(-1));
  document.getElementById("reflect-next-day").addEventListener("click", () => changeReflectDate(1));
  document.getElementById("reflect-today-btn").addEventListener("click", jumpReflectToToday);
  document.getElementById("reflect-export-btn").addEventListener("click", () => {
    exportReflectJson().catch((err) => console.error("reflect export failed", err));
  });
  document.getElementById("opml-export-btn").addEventListener("click", exportOpml);
}

// Pulls the subscription list, reading log, search history, NG words, and
// URL blocklist from the server once at startup — there is no feed-content
// crawl here at all any more (see selectFeed): a feed's articles are only
// ever fetched the moment its row in the sidebar is clicked.
async function refreshMeta() {
  try {
    await syncNow();
  } catch (err) {
    console.error("sync failed", err);
  }
  try {
    await syncLogNow();
  } catch (err) {
    console.error("log sync failed", err);
  }
  try {
    await syncSearchHistoryNow();
    // The search-history chip bar (see ui/searchBar.js) only ever redraws
    // itself right after a search made in *this* tab — a history row pulled
    // from another device just now would otherwise sit in IndexedDB
    // unseen until something else happens to trigger a search here.
    refreshSearchHistoryBar();
  } catch (err) {
    console.error("search history sync failed", err);
  }
  try {
    await syncNgWordsNow();
  } catch (err) {
    console.error("ng word sync failed", err);
  }
  try {
    await syncUrlBlockNow();
  } catch (err) {
    console.error("url block sync failed", err);
  }
  await loadAppData();
  // render() no-ops while sitting on 振り返る (see its own comment) — reflect
  // has to be told directly, or a background pull landing while that screen
  // is already open (log entries, most notably) would never actually reach
  // it.
  if (state.mode === "reflect") {
    renderReflect().catch((err) => console.error("reflect render failed", err));
  } else {
    render();
  }
}

async function startApp() {
  appRoot.classList.remove("hidden");
  wireApp();
  setFavicon();
  await loadAppData();
  render();
  if (state.mode === "reflect") {
    renderReflect().catch((err) => console.error("reflect render failed", err));
  }
  refreshMeta();
}

function wireSetupScreen() {
  document.getElementById("api-base-input").value = loadStoredApiBase();
  document.getElementById("generate-seed-btn").addEventListener("click", () => {
    document.getElementById("seed-input").value = generateSeed();
  });
  setupPairingReceiveUI({
    getApiBase: () => document.getElementById("api-base-input").value.trim().replace(/\/+$/, ""),
    onReceived: (seed, apiBase) => {
      document.getElementById("seed-input").value = seed;
      document.getElementById("api-base-input").value = apiBase;
      document.getElementById("setup-error").textContent = "";
      document.getElementById("setup-info").textContent =
        "シードを受け取りました。内容を確認して「開始」を押してください。";
    },
  });
  document.getElementById("start-btn").addEventListener("click", async () => {
    const seedInput = document.getElementById("seed-input");
    const apiBaseInput = document.getElementById("api-base-input");
    const errorEl = document.getElementById("setup-error");
    errorEl.textContent = "";
    document.getElementById("setup-info").textContent = "";

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

// Handles a `?share=<id>#k=<token>` URL (see shareLink.js) — consumes the
// one-time link (this is the link's single "use", regardless of whether
// decryption below succeeds) and starts an ephemeral session from it. The
// query/fragment are stripped immediately via replaceState so a later
// reload of this tab never re-attempts consuming an already-dead link, and
// so the (now-spent) secret doesn't linger in the visible URL or history.
async function tryConsumeShareLink() {
  const url = new URL(location.href);
  const shareId = url.searchParams.get("share");
  if (!shareId) return false;
  const apiBase = url.searchParams.get("api") || "";
  const token = new URLSearchParams(url.hash.replace(/^#/, "")).get("k") || "";
  history.replaceState(null, "", url.pathname);

  try {
    const { seed } = await consumeShareLink(apiBase, shareId, token);
    await initEphemeralSession(seed, apiBase);
  } catch (err) {
    console.error("[feeda] share link consumption failed", err);
    wireSetupScreen();
    setupScreen.classList.remove("hidden");
    document.getElementById("setup-error").textContent = `共有リンクを開けませんでした: ${err.message}`;
    return true;
  }
  setupScreen.classList.add("hidden");
  await startApp();
  return true;
}

async function boot() {
  if (await tryConsumeShareLink()) return;
  const session = await resumeStoredSession();
  if (session) {
    setupScreen.classList.add("hidden");
    await startApp();
  } else {
    wireSetupScreen();
  }
}

// Registered unconditionally (not gated on a seed being set up yet) so the
// app is installable as soon as it's visited at all. updateViaCache:"none"
// makes the browser always fetch sw.js itself fresh (bypassing HTTP cache)
// when checking for updates, instead of potentially reusing a stale copy
// for up to 24h — sw.js's own network-first fetch handler already keeps
// everything *it* serves current, but that only helps once the worker
// itself has actually been updated.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      // Belt-and-suspenders on top of the browser's own automatic
      // navigation-triggered update check: explicitly ask right away too,
      // so an already-installed (pre-network-first) worker gets replaced
      // as promptly as possible rather than waiting on that check's normal
      // timing.
      .then((reg) => reg.update().catch(() => { }))
      .catch((err) => console.error("service worker registration failed", err));
  });
}

boot();
