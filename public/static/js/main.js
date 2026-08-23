import { generateSeed, isValidSeed, deriveFeedId } from "./crypto.js";
import { loadStoredSeed, loadStoredApiBase, initSession, getSession } from "./session.js";
import { getAllFeeds, getFeed, getEntriesByFeed, getAllSearchHistoryEntries } from "./db.js";
import { syncNow, markFeedDirty } from "./sync.js";
import { syncLogNow } from "./logSync.js";
import { syncSearchHistoryNow } from "./searchSync.js";
import { syncNgWordsNow } from "./ngWordSync.js";
import { getActiveNgWords, matchesAnyNgWord } from "./ngWords.js";
import {
  recordOpen,
  addComment,
  setLogEntryColor,
  getEntriesForDay,
  getDailyCounts,
  getFeedAddedCounts,
  getLatestLogEntriesByEntryId,
  getFeedEngagementScores,
  getFeedLogCounts,
  searchLogEntries,
  dateStrOf,
  shiftDateStr,
} from "./logbook.js";
import { fetchFeed } from "./feedFetch.js";
import { groupFeedsByFrequency, computeFrequencyGroup, FREQUENCY_ORDER } from "./frequency.js";
import { searchEntries, searchFeeds } from "./search.js";
import { renderFeedList, renderFeedColorFilter } from "./ui/feedList.js";
import { colorForWord } from "./colorPalette.js";
import { renderArticleList, renderAnnotatePopup } from "./ui/articleList.js";
import { renderPreview } from "./ui/preview.js";
import { renderMobileList } from "./ui/mobile.js";
import { renderReflectTimeline, renderDayChart, renderLogColorFilter } from "./ui/reflect.js";
import { openFloatingPopup } from "./ui/colorPicker.js";
import { setupSearchBar } from "./ui/searchBar.js";
import { setupPaneResizing, setupWideGridRowResizing } from "./ui/resizer.js";
import { setupSeedModal } from "./ui/seedModal.js";
import { setupNgWordModal } from "./ui/ngWordModal.js";
import { setupPairingShareUI, setupPairingReceiveUI } from "./ui/pairingModal.js";
import { updateFavicon } from "./favicon.js";

const setupScreen = document.getElementById("setup-screen");
const appRoot = document.getElementById("app");
const feedListEl = document.getElementById("feed-list");
const feedColorFilterEl = document.getElementById("feed-color-filter");
const searchInputEl = document.getElementById("search-input");
const articleListEl = document.getElementById("article-list");
const showReadToggleWrapEl = document.getElementById("show-read-toggle-wrap");
const showReadToggleInputEl = document.getElementById("show-read-toggle");
const previewEl = document.getElementById("preview");
const statusBarEl = document.getElementById("status-bar");
const statusBarFillEl = document.getElementById("status-bar-fill");
const statusBarTextEl = document.getElementById("status-bar-text");
const mobileListEl = document.getElementById("mobile-article-list");
const clockWatermarkEl = document.getElementById("clock-watermark");
const modeToggleBtn = document.getElementById("mode-toggle-btn");
const wideGridToggleBtn = document.getElementById("wide-grid-toggle-btn");
const reflectTimelineEl = document.getElementById("reflect-timeline");
const reflectDateLabelEl = document.getElementById("reflect-date-label");
const reflectDayChartEl = document.getElementById("reflect-day-chart");
const reflectFeedChartEl = document.getElementById("reflect-feed-chart");
const reflectColorFilterEl = document.getElementById("reflect-color-filter");
const reflectFeedListEl = document.getElementById("reflect-feed-list");

// Width of the trend strip in the day-nav header — see renderDayChart.
const REFLECT_DAY_CHART_DAYS = 21;

// Kept in sync with the max-width:600px breakpoint in style.css that
// switches to the single-column phone layout.
const mobileQuery = window.matchMedia("(max-width: 600px)");
function isMobileLayout() {
  return mobileQuery.matches;
}

// Kept in sync with the "orientation: portrait, min-width: 601px" breakpoint
// in style.css — narrow-but-not-phone screens get feed+article side by side
// with no preview pane at all; tapping an article opens its link directly,
// same as the phone layout.
const tabletQuery = window.matchMedia("(orientation: portrait) and (min-width: 601px)");
function isTabletTwoPaneLayout() {
  return tabletQuery.matches;
}

// Opt-in via the "マルチカラム" button (see toggleWideGridMode), only ever
// offered once there's enough width to make it worthwhile — kept in sync
// with the min-width:1920px breakpoint in style.css that shows that button
// and lays this mode out. Below that width the toggle button itself is
// hidden, but state.wideGridMode is left alone rather than reset, so
// resizing back up resumes it without the user having to turn it on again.
const wideGridQuery = window.matchMedia("(min-width: 1920px)");
function isWideGridLayout() {
  return state.wideGridMode && wideGridQuery.matches;
}

const PANE_ORDER = ["feed", "article", "preview"];

// Reverse of FREQUENCY_ORDER (which is most-frequent-first, used to decide
// fetch order) — least-frequent-first, used to decide mobile's unread
// reading order instead. "paused" is pinned to the end either way: a
// feed the user stopped fetching shouldn't jump to the front just because
// reversing put "infrequent" first — its backlog is the least urgent thing
// to surface, not the most.
const MOBILE_FREQUENCY_ORDER = [...FREQUENCY_ORDER.filter((key) => key !== "paused")].reverse().concat("paused");

const state = {
  feedsById: new Map(),
  feedTitleById: new Map(),
  entriesByFeed: new Map(),
  // entry.id -> its latest log entry (see getLatestLogEntriesByEntryId in
  // logbook.js) — lets the article list show a color tag/comment recorded
  // from reflect (or straight from the list — see openAnnotateForEntry)
  // without a per-row IndexedDB lookup for every visible article.
  logByEntryId: new Map(),
  // feedId -> cumulative engagement score (see getFeedEngagementScores in
  // logbook.js) — clicking into, commenting on, or color-tagging a feed's
  // articles raises its score, sorting it higher within its sidebar group
  // (see currentFeedGroups/groupFeedsByFrequency) than one that's merely
  // posted recently but gone unengaged.
  feedScoreById: new Map(),
  selectedFeedId: null,
  selectedEntry: null,
  searchQuery: "",
  // The most recent non-empty search query, kept around after searchQuery
  // itself goes back to "" (search cleared, or the box auto-clearing on
  // every focus — see searchBar.js). Powers highlightQuery() below so
  // article titles/body text keep showing what you were just looking for
  // even once you're back to browsing the full unread list.
  lastSearchQuery: "",
  // Color-tag keys (see colorPalette.js) currently toggled on in the feed
  // list's filter row — see renderFeedColorFilter in ui/feedList.js and
  // toggleFeedColorFilter below. A feed matches if it has any color in
  // this set; empty means no filter, show every feed.
  feedColorFilter: new Set(),
  // "既読も表示" toggle above the article list (see wireApp) — folds
  // already-read entries into the no-feed-selected home timeline instead of
  // hiding them, so there's somewhere to color-tag/comment an entry after
  // it's been read. Purely a local view preference, not synced.
  showReadInTimeline: false,
  // "マルチカラム" button (see toggleWideGridMode/isWideGridLayout) — only
  // takes effect at wideGridQuery's width, but the flag itself persists
  // below it too so crossing back over the breakpoint resumes it. Purely a
  // local view preference, not synced.
  wideGridMode: false,
  // Lowercased NG words (see ngWords.js/setupNgWordModal) — an entry whose
  // title contains one is filtered out of the article list (see
  // filterByNgWords). Lowercased once here rather than per-entry at filter
  // time, since matching itself is case-insensitive.
  ngWords: [],
  // Every saved search-history query (see db.js's searchHistory store),
  // kept around so highlightQuery can mark them all as "things I've looked
  // for before" all the time, not just the one currently/last searched.
  // Refreshed by loadAppData and (for the query just typed, without waiting
  // on the next periodic refresh) searchBar.js's onHistoryChange.
  searchHistoryWords: [],
  // Same idea as feedColorFilter, for the reflect screen's own color tags
  // (see renderLogColorFilter in ui/reflect.js and toggleLogColorFilter
  // below) — a log entry matches if it has any color in this set.
  logColorFilter: new Set(),
  focusedPane: "article",
  keyboardNavActive: false,
  // "view" is the normal reading UI; "reflect" swaps in the activity-log
  // timeline (see renderReflect) — the two are different enough (no feed
  // selection, date-scoped instead of unread-scoped) that they get their
  // own top-level screen rather than sharing render().
  mode: "view",
  reflectDate: dateStrOf(),
  // feedId selected in reflect's own feed tree (see renderReflectFeedList),
  // or null for no filter. Unlike the main view's selectedFeedId this never
  // changes what's fetched or previewed — it only narrows which of the
  // day's (or search's) log entries renderReflect shows.
  reflectFeedFilter: null,
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
  state.logByEntryId = await getLatestLogEntriesByEntryId();
  state.feedScoreById = await getFeedEngagementScores();
  state.ngWords = (await getActiveNgWords()).map((w) => w.word.toLowerCase());
  state.searchHistoryWords = (await getAllSearchHistoryEntries()).map((e) => e.query);
  if (state.selectedFeedId && !state.feedsById.has(state.selectedFeedId)) {
    state.selectedFeedId = null;
  }
  state.unreadTimelineSnapshot = null;
}

// Lighter-weight sibling of loadAppData for refreshAll's fetch loop: pulls
// just the one feed that was just fetched back out of IndexedDB, instead of
// re-reading every feed and every feed's entries on every iteration (which
// would make a full re-scan of an N-feed subscription list do O(N^2) reads).
async function refreshFeedInState(feedId) {
  const [freshFeed, entries] = await Promise.all([getFeed(feedId), getEntriesByFeed(feedId)]);
  if (!freshFeed) return;
  state.feedsById.set(feedId, freshFeed);
  state.feedTitleById.set(feedId, freshFeed.title || freshFeed.url);
  state.entriesByFeed.set(feedId, entries);
  mergeIntoUnreadTimeline(freshFeed, entries);
}

// Used to fold one just-fetched feed's entries into the frozen cross-feed
// timeline (see currentArticles) instead of invalidating the whole snapshot
// outright — invalidating used to mean the next render re-filtered *every*
// feed by its current read state, which drops any entry the user has read
// since the snapshot froze (including moments ago, e.g. by hovering it in
// wide-grid mode or right-clicking it open to annotate) the same way it
// drops genuinely stale ones. That was the bug behind an annotate popup
// closing itself right after opening: a background refetch landing mid-
// popup would rebuild the timeline, the just-annotated entry (now read)
// would no longer qualify, and renderArticleList's closeFloatingPopupIfMissing
// would treat it as gone and close the popup out from under the user. Only
// ever adds entries that aren't in the snapshot yet, so anything already
// surfaced — read or not — stays exactly where it was.
function mergeIntoUnreadTimeline(feed, entries) {
  if (!state.unreadTimelineSnapshot) return;
  const existingIds = new Set(state.unreadTimelineSnapshot.map((e) => e.id));
  const fresh = entries.filter((e) => !existingIds.has(e.id) && (state.showReadInTimeline || isUnread(e, feed)));
  if (fresh.length === 0) return;
  state.unreadTimelineSnapshot = [...state.unreadTimelineSnapshot, ...fresh].sort((a, b) =>
    (b.pubDate || "").localeCompare(a.pubDate || "")
  );
}

// Article titles and preview/body text highlight this instead of the live
// searchQuery. Two layers, both always-on regardless of whether a search is
// actually active right now: the live-or-last query (see lastSearchQuery's
// own comment) in the normal yellow .search-highlight, listed first so it
// wins wherever it overlaps a history term; and every *other* saved search-
// history keyword (state.searchHistoryWords, kept fresh by loadAppData and
// searchBar.js's onHistoryChange) in .search-highlight-history, each word
// its own stable color (see colorPalette.js's colorForWord) so it also
// matches that word's chip in the search-history bar — a standing "things
// I've looked for before" marker that doesn't depend on the search box
// having anything in it. Feed names deliberately keep using the live
// searchQuery directly (see renderDesktop/renderTabletTwoPane) instead of
// this, so they only highlight while a search is actually active.
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
  if (state.feedColorFilter.size > 0) {
    feeds = feeds.filter((f) => f.color && state.feedColorFilter.has(f.color));
  }
  const feedsWithEntries = feeds.map((feed) => ({
    feed: { ...feed, hasUnread: hasUnread(feed), engagementScore: state.feedScoreById.get(feed.feedId) || 0 },
    entries: state.entriesByFeed.get(feed.feedId) || [],
  }));
  return groupFeedsByFrequency(feedsWithEntries);
}

// Which sidebar groups (status-level and frequency-level, see feedList.js's
// nested keys) render collapsed. Computed once, lazily, the first time the
// sidebar renders after load: groups with no unread feed start collapsed,
// groups with at least one unread feed start open. From then on this only
// changes via the user's own expand/collapse clicks (see feedList.js's
// toggle listener, which mutates this Set directly) — later re-renders
// (e.g. triggered by hovering an article) must not snap a group the user
// opened back shut, so this is never recomputed after its first use.
let collapsedGroups = null;

// Reflect's own feed tree (see renderReflectFeedList) is always a single
// flat group, so there's nothing meaningful to start collapsed the way
// collapsedGroupsFor's unread-based heuristic does for the main tree — a
// plain persistent Set is enough to remember the one status-level toggle
// across redraws.
const reflectCollapsedGroups = new Set();

function collapsedGroupsFor(tree) {
  // While a color filter or search query is active, `tree` already only
  // contains matching feeds (see currentFeedGroups) — force every group open
  // so they're all visible at a glance instead of making the user click into
  // each frequency group to go check. A fresh Set each call rather than
  // mutating/returning the persisted one below, so this is purely a
  // rendering override: manual collapse-state from before the filter was
  // applied comes back untouched once it's cleared.
  if (state.feedColorFilter.size > 0 || state.searchQuery.trim()) return new Set();

  if (collapsedGroups === null) {
    collapsedGroups = new Set();
    for (const { status, subgroups } of tree) {
      if (!subgroups.some((sg) => sg.feeds.some((f) => f.hasUnread))) collapsedGroups.add(status.key);
      for (const sg of subgroups) {
        if (!sg.feeds.some((f) => f.hasUnread)) collapsedGroups.add(`${status.key}:${sg.group.key}`);
      }
    }
  }
  return collapsedGroups;
}

function flatFeedList() {
  return currentFeedGroups().flatMap(({ subgroups }) => subgroups.flatMap((sg) => sg.feeds));
}

// Buckets entries by their feed's (live-computed, same as the feed list's
// own grouping) frequency, least-frequent group first, newest-first within
// each bucket.
function sortMobileUnreadByFrequency(entries) {
  const priorityByFeedId = new Map();
  for (const feed of state.feedsById.values()) {
    const groupKey = feed.paused ? "paused" : computeFrequencyGroup(state.entriesByFeed.get(feed.feedId) || []).key;
    priorityByFeedId.set(feed.feedId, MOBILE_FREQUENCY_ORDER.indexOf(groupKey));
  }
  return entries.slice().sort((a, b) => {
    const pa = priorityByFeedId.get(a.feedId) ?? MOBILE_FREQUENCY_ORDER.length;
    const pb = priorityByFeedId.get(b.feedId) ?? MOBILE_FREQUENCY_ORDER.length;
    if (pa !== pb) return pa - pb;
    return (b.pubDate || "").localeCompare(a.pubDate || "");
  });
}

// An entry whose title contains a registered NG word (see ngWords.js/the
// "NGワード" topbar button) never shows up in the article list — applied
// once here, the one place currentArticles() actually returns entries,
// rather than in each of its three branches separately.
function filterByNgWords(entries) {
  if (state.ngWords.length === 0) return entries;
  return entries.filter((e) => !matchesAnyNgWord(e.title, state.ngWords));
}

function currentArticles() {
  const query = state.searchQuery;
  if (query) {
    const allEntries = [...state.entriesByFeed.values()].flat();
    const matched = searchEntries(query, allEntries, state.feedTitleById);
    matched.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
    return { entries: filterByNgWords(matched.slice(0, 200)), showFeedName: true, emptyHint: "検索結果がありません。" };
  }
  if (state.selectedFeedId) {
    return {
      entries: filterByNgWords(sortedEntriesForFeed(state.selectedFeedId)),
      showFeedName: false,
      emptyHint: "記事がありません。",
    };
  }
  // Nothing selected: show unread entries across all feeds, newest first
  // (date-less unread entries have no position to sort by, so they sink to
  // the end — see the pubDate-less comparator behavior below). The set of
  // entries is frozen in state.unreadTimelineSnapshot the first time it's
  // needed and reused after that — opening an entry marks it (and possibly
  // its whole feed) as read, and isUnread is re-evaluated live for styling,
  // but the entry stays in place instead of vanishing out of the list.
  if (!state.unreadTimelineSnapshot) {
    // showReadInTimeline (see the "既読も表示" toggle in wireApp) folds
    // already-read entries into this same timeline instead of hiding them —
    // otherwise a read entry with nothing further to say about it has no
    // page it shows up on at all (short of opening its specific feed), so
    // there'd be nowhere left to color-tag/comment it after the fact.
    const timeline = [];
    for (const feed of state.feedsById.values()) {
      for (const entry of state.entriesByFeed.get(feed.feedId) || []) {
        if (state.showReadInTimeline || isUnread(entry, feed)) timeline.push(entry);
      }
    }
    timeline.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
    state.unreadTimelineSnapshot = timeline;
  }
  return {
    entries: filterByNgWords(state.unreadTimelineSnapshot),
    showFeedName: true,
    emptyHint: state.showReadInTimeline ? "記事がありません。" : "未読の記事はありません。",
  };
}

function render() {
  // The reflect screen never depends on feed/article state, so it must not
  // be redrawn by the generic render() pump — refreshAll() calls render()
  // once per feed as fetch progress advances, and rebuilding the timeline
  // each time would tear down and recreate the comment <input>s mid-typing,
  // stealing focus out from under the user. Reflect draws itself instead,
  // from its own actions (toggleMode, changeReflectDate, jumpReflectToToday,
  // handleAddComment) — see renderReflect callers below.
  if (state.mode === "reflect") return;
  appRoot.classList.toggle("wide-grid-mode", isWideGridLayout());
  if (isMobileLayout()) {
    renderMobile();
  } else if (isTabletTwoPaneLayout()) {
    renderTabletTwoPane();
  } else if (isWideGridLayout()) {
    renderWideGrid();
  } else {
    renderDesktop();
  }
  updateFavicon(countUnreadSources());
  updateNextFetchIndicator();
}

// While sitting on 振り返る, pick up log rows written from elsewhere —
// mainly the Tampermonkey auto-log script (see userscript/feeda-
// autoregister.user.js), which pushes straight to the server from whatever
// site tab you're reading in, with no way to poke this tab about it.
// refreshAll's own syncLogNow only runs once at load, before its feed-fetch
// loop even starts, so without this a page freshly auto-logged mid-crawl
// (or after the crawl, while this tab just sits open) wouldn't show up
// until the next full reload. Covered two ways: a pull on every render
// (see renderReflect) so switching to/around the screen is always fresh,
// plus this interval so a tab left open on 振り返る updates on its own.
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

function toggleMode() {
  state.mode = state.mode === "view" ? "reflect" : "view";
  appRoot.classList.toggle("reflect-mode", state.mode === "reflect");
  modeToggleBtn.textContent = state.mode === "reflect" ? "見るに戻る" : "振り返る";
  if (state.mode === "reflect") {
    renderReflect().catch((err) => console.error("reflect render failed", err));
    startReflectLiveRefresh();
  } else {
    stopReflectLiveRefresh();
    render();
  }
}

// "マルチカラム" button — only ever visible/relevant at wideGridQuery's
// width (see style.css), but the toggle click still just flips the flag and
// re-renders regardless of current width: nothing stops it being clicked
// right as the window crosses the breakpoint, and render() re-checks
// isWideGridLayout() itself on every call anyway.
function toggleWideGridMode() {
  state.wideGridMode = !state.wideGridMode;
  wideGridToggleBtn.textContent = state.wideGridMode ? "3ペインに戻る" : "マルチカラム";
  wideGridToggleBtn.classList.toggle("active", state.wideGridMode);
  render();
}

function formatReflectDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}

// Pulls fresh log rows before reading from local IndexedDB — see the
// REFLECT_LIVE_REFRESH_MS comment above for why this can't just rely on
// refreshAll's own startup sync. Sync failure (offline, server hiccup)
// falls back to whatever's already local rather than blocking the render.
async function renderReflect() {
  await syncLogNow().catch((err) => console.error("log sync failed", err));
  await renderReflectFeedList();
  const query = state.searchQuery.trim();
  if (query) {
    reflectDateLabelEl.textContent = `「${query}」の検索結果`;
    reflectDayChartEl.innerHTML = ""; // no single day selected during search — nothing sensible to highlight
    reflectFeedChartEl.innerHTML = "";
    const rawEntries = await searchLogEntries(query);
    renderLogColorFilter(reflectColorFilterEl, {
      entries: rawEntries,
      activeColors: state.logColorFilter,
      onToggleColor: toggleLogColorFilter,
    });
    renderReflectTimeline(reflectTimelineEl, {
      entries: filterLogEntriesByColor(filterLogEntriesByFeed(rawEntries)),
      onAddComment: handleAddComment,
      onSetColor: handleSetLogColor,
      emptyHint: "検索結果がありません。",
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
  renderLogColorFilter(reflectColorFilterEl, {
    entries: rawEntries,
    activeColors: state.logColorFilter,
    onToggleColor: toggleLogColorFilter,
  });
  renderReflectTimeline(reflectTimelineEl, {
    entries: filterLogEntriesByColor(filterLogEntriesByFeed(rawEntries)),
    onAddComment: handleAddComment,
    onSetColor: handleSetLogColor,
  });
}

// A log entry matches if it has any color in state.logColorFilter — same
// "any" semantics as the feed list's own color filter (see currentFeedGroups
// above). Empty filter means no filtering at all.
function filterLogEntriesByColor(entries) {
  if (state.logColorFilter.size === 0) return entries;
  return entries.filter((e) => e.color && state.logColorFilter.has(e.color));
}

// Companion to filterLogEntriesByColor for reflect's own feed tree (see
// renderReflectFeedList/toggleReflectFeedFilter) — narrows to one feed
// instead of a set of colors, and composes with the color filter rather
// than replacing it: both can be active on the same view.
function filterLogEntriesByFeed(entries) {
  if (!state.reflectFeedFilter) return entries;
  return entries.filter((e) => e.feedId === state.reflectFeedFilter);
}

// Reflect's own feed tree — same renderFeedList component as the main
// sidebar (feed-item styling, color tags, the pause/pin/color context menu),
// but a single flat group (see the isFlatStatus check in ui/feedList.js)
// ranked by getFeedLogCounts instead of the status/frequency breakdown: a
// day's-worth-of-reading timeline isn't "catch up on what's unread", it's
// "which of my feeds turn up here most". Selecting a feed filters the
// timeline to it via reflectFeedFilter/filterLogEntriesByFeed rather than
// navigating anywhere — reflect has no per-feed screen of its own.
async function renderReflectFeedList() {
  const counts = await getFeedLogCounts();
  const feeds = [...state.feedsById.values()]
    .map((feed) => ({ feed, count: counts.get(feed.feedId) || 0 }))
    .sort((a, b) => b.count - a.count || (a.feed.title || a.feed.url).localeCompare(b.feed.title || b.feed.url))
    .map(({ feed }) => feed);

  renderFeedList(reflectFeedListEl, {
    groups: [
      {
        status: { key: "reflect-feeds", label: "フィード" },
        subgroups: [{ group: { key: "reflect-feeds", label: "フィード" }, feeds }],
      },
    ],
    totalFeedCount: state.feedsById.size,
    selectedFeedId: state.reflectFeedFilter,
    query: "",
    collapsedGroups: reflectCollapsedGroups,
    onSelect: toggleReflectFeedFilter,
    onHover: () => {},
    onTogglePause: togglePauseFeed,
    onTogglePin: togglePinFeed,
    onSetColor: setFeedColor,
    onCopyUrl: copyFeedUrl,
  });
}

// Clicking a feed already selected in reflect's tree clears the filter
// (toggle, same as clicking an active color swatch elsewhere) rather than
// being a no-op — otherwise there'd be no way back to "every feed" short of
// reloading.
function toggleReflectFeedFilter(feedId) {
  state.reflectFeedFilter = state.reflectFeedFilter === feedId ? null : feedId;
  renderReflect().catch((err) => console.error("reflect render failed", err));
}

async function handleAddComment(logId, text) {
  await addComment(logId, text);
  // No separate scheduleLogSync() call needed here — renderReflect() below
  // now syncs (push+pull) immediately before it redraws, which already
  // covers pushing this comment.
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

// Used by the day-chart bars (see renderDayChart) to jump straight to the
// clicked date, same as changeReflectDate but to an absolute day instead of
// a relative offset.
function jumpReflectToDate(dateStr) {
  state.reflectDate = dateStr;
  renderReflect().catch((err) => console.error("reflect render failed", err));
}

// Hover equivalent of jumpReflectToDate (see renderDayChart's onHoverDate) —
// deliberately lighter than a full renderReflect: skips syncLogNow's network
// round-trip and leaves both chart strips' bars alone (just re-toggling
// which one carries .selected), touching only the date label and the day's
// own timeline. Sweeping the cursor across 21 bars firing a full sync +
// rebuild on every single one would make "instant" the opposite of what
// this is for; the periodic/visibilitychange refreshes elsewhere in
// renderReflect's orbit keep the data itself fresh regardless.
function previewReflectDate(dateStr) {
  if (dateStr === state.reflectDate) return;
  state.reflectDate = dateStr;
  reflectDateLabelEl.textContent = formatReflectDateLabel(dateStr);
  for (const bar of document.querySelectorAll(".reflect-day-chart-bar")) {
    bar.classList.toggle("selected", bar.dataset.date === dateStr);
  }
  getEntriesForDay(dateStr)
    .then((rawEntries) => {
      renderLogColorFilter(reflectColorFilterEl, {
        entries: rawEntries,
        activeColors: state.logColorFilter,
        onToggleColor: toggleLogColorFilter,
      });
      renderReflectTimeline(reflectTimelineEl, {
        entries: filterLogEntriesByColor(filterLogEntriesByFeed(rawEntries)),
        onAddComment: handleAddComment,
        onSetColor: handleSetLogColor,
      });
    })
    .catch((err) => console.error("reflect preview failed", err));
}

// The reflect screen's color-filter row (see renderLogColorFilter in
// ui/reflect.js) — same toggle-membership shape as toggleFeedColorFilter,
// scoped to logColorFilter instead. A full renderReflect (not the cheap
// previewReflectDate path) is warranted here since this changes what's
// filtered, not just which day is in view.
function toggleLogColorFilter(colorKey) {
  if (colorKey === null) {
    state.logColorFilter.clear();
  } else if (state.logColorFilter.has(colorKey)) {
    state.logColorFilter.delete(colorKey);
  } else {
    state.logColorFilter.add(colorKey);
  }
  renderReflect().catch((err) => console.error("reflect render failed", err));
}

let logSyncDebounceTimer = null;
function scheduleLogSync() {
  clearTimeout(logSyncDebounceTimer);
  logSyncDebounceTimer = setTimeout(() => {
    syncLogNow().catch((err) => console.error("log sync failed", err));
  }, 1000);
}

// Shared by renderDesktop and renderTabletTwoPane — the only two layouts
// with a feed pane at all (mobile's renderMobile is article-list-only).
// Uses every registered feed, not currentFeedGroups()'s already-filtered
// result, so the swatch row itself doesn't shrink away once a filter (or a
// search query) narrows the list down to feeds of just one color.
function renderFeedColorFilterBar() {
  renderFeedColorFilter(feedColorFilterEl, {
    feeds: [...state.feedsById.values()],
    activeColors: state.feedColorFilter,
    onToggleColor: toggleFeedColorFilter,
  });
}

function renderDesktop() {
  const query = state.searchQuery;
  const feedGroups = currentFeedGroups();
  renderFeedColorFilterBar();

  renderFeedList(feedListEl, {
    groups: feedGroups,
    totalFeedCount: state.feedsById.size,
    selectedFeedId: state.selectedFeedId,
    query,
    collapsedGroups: collapsedGroupsFor(feedGroups),
    onSelect: selectFeed,
    onHover: previewFeed,
    onTogglePause: togglePauseFeed,
    onTogglePin: togglePinFeed,
    onSetColor: setFeedColor,
    onCopyUrl: copyFeedUrl,
    onShowAllUnread: showAllUnread,
  });

  // Only meaningful on the cross-feed home timeline (see currentArticles) —
  // a specific feed's own list, and search results, already include read
  // entries regardless, so the toggle would be a no-op there.
  showReadToggleWrapEl.classList.toggle("hidden", Boolean(state.selectedFeedId) || Boolean(query.trim()));

  const { entries, showFeedName, emptyHint } = currentArticles();
  // The cross-feed unread timeline (nothing selected, no search) is the one
  // place in the 3-pane layout that also marks read on hover, same as
  // wide-grid mode always does (see previewEntryAndMarkRead) — a specific
  // feed's own list keeps plain hover-to-preview, since that's still a
  // dense single-column list where a passing cursor sweep would read
  // articles it never meant to (the "だるま落とし" bug).
  const isAllUnreadView = !state.selectedFeedId && !query.trim();
  renderArticleList(articleListEl, {
    entries,
    feedTitleById: state.feedTitleById,
    selectedEntryId: state.selectedEntry ? state.selectedEntry.id : null,
    query: highlightQuery(),
    isUnread: (entry) => isUnread(entry, state.feedsById.get(entry.feedId)),
    onSelect: openEntry,
    onHover: isAllUnreadView ? previewEntryAndMarkRead : previewEntry,
    onAnnotate: openAnnotateForEntry,
    logByEntryId: state.logByEntryId,
    showFeedName,
    emptyHint,
  });

  renderPreview(previewEl, state.selectedEntry, highlightQuery(), { onLinkClick: logOpen });
}

// Narrow-portrait layout (see the isTabletTwoPaneLayout breakpoint): same
// feed pane as desktop so a feed can still be picked, but the article pane
// renders as real links via renderMobileList instead of renderArticleList +
// preview — there's no room for a third preview column, so reading happens
// on the origin site same as the phone layout.
function renderTabletTwoPane() {
  const query = state.searchQuery;
  const feedGroups = currentFeedGroups();
  renderFeedColorFilterBar();

  renderFeedList(feedListEl, {
    groups: feedGroups,
    totalFeedCount: state.feedsById.size,
    selectedFeedId: state.selectedFeedId,
    query,
    collapsedGroups: collapsedGroupsFor(feedGroups),
    onSelect: selectFeed,
    onHover: previewFeed,
    onTogglePause: togglePauseFeed,
    onTogglePin: togglePinFeed,
    onSetColor: setFeedColor,
    onCopyUrl: copyFeedUrl,
    onShowAllUnread: showAllUnread,
  });

  const { entries, showFeedName, emptyHint } = currentArticles();
  renderMobileList(articleListEl, {
    entries,
    feedTitleById: state.feedTitleById,
    query: highlightQuery(),
    isUnread: (entry) => isUnread(entry, state.feedsById.get(entry.feedId)),
    onOpen: openEntry,
    showFeedName,
    emptyHint,
  });
}

// Opt-in ultra-wide layout (see the "マルチカラム" button/isWideGridLayout,
// only offered at wideGridQuery's width) — same feed pane, article list, and
// preview pane components as desktop (so annotate, keyboard nav, and the
// .selected/.unread styling all keep working unchanged), just laid out
// differently: the article list becomes a multi-column card grid (CSS
// `columns`, see .app.wide-grid-mode in style.css) with the preview pane
// moved below it instead of beside it, so more of the unread queue is
// visible at a glance. The one real behavioral difference is onHover —
// see previewEntryAndMarkRead.
function renderWideGrid() {
  const query = state.searchQuery;
  const feedGroups = currentFeedGroups();
  renderFeedColorFilterBar();

  renderFeedList(feedListEl, {
    groups: feedGroups,
    totalFeedCount: state.feedsById.size,
    selectedFeedId: state.selectedFeedId,
    query,
    collapsedGroups: collapsedGroupsFor(feedGroups),
    onSelect: selectFeed,
    onHover: previewFeed,
    onTogglePause: togglePauseFeed,
    onTogglePin: togglePinFeed,
    onSetColor: setFeedColor,
    onCopyUrl: copyFeedUrl,
    onShowAllUnread: showAllUnread,
  });

  showReadToggleWrapEl.classList.toggle("hidden", Boolean(state.selectedFeedId) || Boolean(query.trim()));

  const { entries, showFeedName, emptyHint } = currentArticles();
  renderArticleList(articleListEl, {
    entries,
    feedTitleById: state.feedTitleById,
    selectedEntryId: state.selectedEntry ? state.selectedEntry.id : null,
    query: highlightQuery(),
    isUnread: (entry) => isUnread(entry, state.feedsById.get(entry.feedId)),
    onSelect: openEntry,
    onHover: previewEntryAndMarkRead,
    onAnnotate: openAnnotateForEntry,
    logByEntryId: state.logByEntryId,
    showFeedName,
    emptyHint,
  });

  renderPreview(previewEl, state.selectedEntry, highlightQuery(), { onLinkClick: logOpen });
}

// render() no-ops entirely in reflect mode (see its own comment) — but the
// feed context menu (pause/pin/color) is now reachable from reflect's own
// feed tree too (see renderReflectFeedList), so a change made there still
// needs *something* redrawn. Only the tree itself can have changed — the
// timeline doesn't depend on a feed's pause/pin/color — so that's all this
// redraws in reflect mode, instead of the fuller renderReflect().
function refreshAfterFeedChange() {
  if (state.mode === "reflect") {
    renderReflectFeedList();
  } else {
    render();
  }
}

// "更新を停止/再開" in the feed context menu (see ui/feedList.js) — toggles
// whether the feed gets fetched at all. Paused feeds sort into their own
// "更新停止" group (see frequency.js) and are skipped entirely by
// refreshAll, even when forced. Marks the feed userManagedPause so
// autoPauseDuplicateFeeds (below) never overrides a deliberate choice the
// user made either way.
async function togglePauseFeed(feedId) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  let updated = { ...feed, paused: !feed.paused, userManagedPause: true };
  // Pausing means "I'm done with this feed for now" — catch it up to read
  // at the same moment, the same way advanceReadState does for an entry
  // actually viewed, so it doesn't keep sitting there with an unread dot
  // under 更新停止 for something you've deliberately stopped following.
  if (updated.paused) {
    updated = { ...updated, readUntil: new Date().toISOString() };
    if (updated.latestContentHash) updated = { ...updated, contentHash: updated.latestContentHash };
  }
  await markFeedDirty(updated);
  state.feedsById.set(feedId, updated);
  refreshAfterFeedChange();
  syncNow().catch((err) => console.error("sync failed", err));
}

// "上部にピン留め/ピン留めを解除" in the feed context menu (see ui/feedList.js)
// — pulls the feed out of the normal status/frequency tree into its own
// "📌 ピン留め" group at the very top of the sidebar (see frequency.js's
// groupFeedsByFrequency), independent of pause/color/read state.
async function togglePinFeed(feedId) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  const updated = { ...feed, pinned: !feed.pinned };
  await markFeedDirty(updated);
  state.feedsById.set(feedId, updated);
  refreshAfterFeedChange();
  syncNow().catch((err) => console.error("sync failed", err));
}

// Right-click/long-press context menu's color row — tags a feed with one of
// COLOR_PALETTE's colors (see colorPalette.js) for at-a-glance grouping in
// the sidebar (.feed-item--colored in style.css), same mechanism as reflect
// entry color-tagging. colorKey null clears the tag.
async function setFeedColor(feedId, colorKey) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  const updated = { ...feed, color: colorKey || null };
  await markFeedDirty(updated);
  state.feedsById.set(feedId, updated);
  refreshAfterFeedChange();
  syncNow().catch((err) => console.error("sync failed", err));
}

// The feed-list color swatch row (see renderFeedColorFilter in
// ui/feedList.js) — colorKey null means "clear filter" (its own button,
// distinct from any color swatch), otherwise toggles that one color's
// membership in the filter set. Multiple colors can be active at once: a
// feed shows if it matches any of them (see currentFeedGroups).
function toggleFeedColorFilter(colorKey) {
  if (colorKey === null) {
    state.feedColorFilter.clear();
  } else if (state.feedColorFilter.has(colorKey)) {
    state.feedColorFilter.delete(colorKey);
  } else {
    state.feedColorFilter.add(colorKey);
  }
  render();
}

// Duplicate-feed cleanup — DISABLED FOR NOW, not called from refreshAll
// (see restorePreviouslyAutoPausedFeeds above). It was pausing feeds the
// user didn't consider duplicates too often. Left in place in case the
// overlap heuristic gets revisited later.
//
// Rather than grouping by URL/host (which falsely lumps together completely
// unrelated feeds on platform sites where many different users/channels
// share one domain, e.g. hatena/note/YouTube), it compared feeds by how
// much their *article lists* actually overlap — the real-world case this
// caught was a site that publishes the same content as both an RSS2 feed
// and an Atom feed at different URLs. Two feeds counted as duplicates when
// a large fraction of one's article links also appeared in the other's.
const DUPLICATE_OVERLAP_THRESHOLD = 0.8;
const DUPLICATE_MIN_ENTRIES = 3;

function entryLinkSet(feedId) {
  const entries = state.entriesByFeed.get(feedId) || [];
  return new Set(entries.map((e) => e.link).filter(Boolean));
}

function overlapRatio(setA, setB) {
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  if (smaller.size === 0) return 0;
  let shared = 0;
  for (const link of smaller) {
    if (larger.has(link)) shared++;
  }
  return shared / smaller.size;
}

async function autoPauseDuplicateFeeds() {
  const activeFeeds = [...state.feedsById.values()].filter((f) => !f.paused);
  const linkSets = new Map(activeFeeds.map((f) => [f.feedId, entryLinkSet(f.feedId)]));

  // Union-find over "enough article overlap" pairs, so A/B/C all matching
  // pairwise end up in one cluster even if not every pair was compared.
  const parent = new Map(activeFeeds.map((f) => [f.feedId, f.feedId]));
  const find = (id) => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (let i = 0; i < activeFeeds.length; i++) {
    const setA = linkSets.get(activeFeeds[i].feedId);
    if (setA.size < DUPLICATE_MIN_ENTRIES) continue;
    for (let j = i + 1; j < activeFeeds.length; j++) {
      const setB = linkSets.get(activeFeeds[j].feedId);
      if (setB.size < DUPLICATE_MIN_ENTRIES) continue;
      if (overlapRatio(setA, setB) >= DUPLICATE_OVERLAP_THRESHOLD) {
        union(activeFeeds[i].feedId, activeFeeds[j].feedId);
      }
    }
  }

  const clusters = new Map();
  for (const feed of activeFeeds) {
    const root = find(feed.feedId);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(feed);
  }

  // Never touch a feed the user has manually paused/unpaused before
  // (userManagedPause) — that's an explicit choice to keep it, even
  // alongside others with near-identical content. It still counts as "the
  // keeper" for its cluster, so other untouched duplicates get paused
  // around it.
  const toPause = [];
  for (const feeds of clusters.values()) {
    if (feeds.length < 2) continue;
    const userManagedKeeper = feeds.find((f) => f.userManagedPause);
    const candidates = feeds.filter((f) => !f.userManagedPause);
    if (candidates.length === 0) continue;

    const keeper = userManagedKeeper || candidates.slice().sort((a, b) => (a.addedAt || "").localeCompare(b.addedAt || ""))[0];
    for (const candidate of candidates) {
      if (candidate !== keeper) toPause.push(candidate);
    }
  }

  for (const feed of toPause) {
    const updated = { ...feed, paused: true };
    await markFeedDirty(updated);
    state.feedsById.set(feed.feedId, updated);
  }
  if (toPause.length > 0) {
    syncNow().catch((err) => console.error("sync failed", err));
  }
}

async function copyFeedUrl(feed, li) {
  try {
    await navigator.clipboard.writeText(feed.url);
    li.classList.add("copy-flash");
    setTimeout(() => li.classList.remove("copy-flash"), 800);
  } catch (err) {
    console.error("clipboard copy failed", err);
  }
}

// Small-phone layout: no per-feed navigation at all, just the same
// cross-feed unread timeline as desktop's "nothing selected" view — see
// ui/mobile.js. Rows are real links to the article's origin site; reading
// happens there, not in-app. Scrolling an unread row out of view (past the
// top) marks it read too, same as tapping it, via the IntersectionObserver
// wired up below.
function renderMobile() {
  const query = state.searchQuery;
  const { entries: baseEntries, showFeedName, emptyHint } = currentArticles();
  // Unread browsing (no search query) prioritizes low-frequency feeds: a
  // rare post from a feed that hardly ever posts is easy to lose in a flood
  // of daily-feed articles if everything's just sorted by date. Search
  // results keep the plain newest-first order from currentArticles().
  const entries = query ? baseEntries : sortMobileUnreadByFrequency(baseEntries);

  mobileReadObserver?.disconnect();
  mobileReadObserver = new IntersectionObserver(handleMobileScrollIntersections, {
    root: mobileListEl,
    threshold: 0,
  });
  mobileScrollEntries = new Map(entries.map((e) => [e.id, e]));

  renderMobileList(mobileListEl, {
    entries,
    feedTitleById: state.feedTitleById,
    query: highlightQuery(),
    isUnread: (entry) => isUnread(entry, state.feedsById.get(entry.feedId)),
    onOpen: openEntry,
    onRowMounted: (li, entry) => {
      li.dataset.entryId = entry.id;
      mobileReadObserver.observe(li);
    },
    showFeedName,
    emptyHint,
  });
}

let mobileReadObserver = null;
let mobileScrollEntries = new Map();
let mobileSyncDebounceTimer = null;

function handleMobileScrollIntersections(observerEntries) {
  for (const oe of observerEntries) {
    // Only care about rows that scrolled *past* (exited above the visible
    // area) — not ones below the fold that haven't been seen yet, and not
    // the initial "not intersecting yet" report some browsers fire on
    // observe() for elements already off-screen below.
    if (oe.isIntersecting || !oe.rootBounds) continue;
    if (oe.boundingClientRect.bottom > oe.rootBounds.top) continue;

    const entry = mobileScrollEntries.get(oe.target.dataset.entryId);
    if (entry) markReadOnScroll(entry, oe.target);
  }
}

async function markReadOnScroll(entry, liEl) {
  const updated = await advanceReadState(entry);
  if (!updated) return;
  liEl.classList.remove("unread");
  // Debounce the actual network sync: flicking past a long run of unread
  // items would otherwise fire one push+pull per item in quick succession.
  clearTimeout(mobileSyncDebounceTimer);
  mobileSyncDebounceTimer = setTimeout(() => {
    syncNow().catch((err) => console.error("sync failed", err));
  }, 1000);
}

// Advances a feed's read state (readUntil watermark and/or content-hash
// catch-up) based on the entry being viewed, persists it, and returns the
// updated feed — or null if nothing changed. Doesn't render or sync itself;
// callers decide whether that should happen immediately (advanceProgress)
// or be batched (markReadOnScroll, for rapid scrolling).
async function advanceReadState(entry) {
  const feed = state.feedsById.get(entry.feedId);
  if (!feed) return null;

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

  if (!changed) return null;
  await markFeedDirty(updated);
  state.feedsById.set(feed.feedId, updated);
  return updated;
}

// Used when the user directly acts on an entry (tap/click, keyboard nav,
// selecting a feed) — advances read state and re-renders/syncs right away.
async function advanceProgress(entry) {
  const updated = await advanceReadState(entry);
  if (updated) {
    render();
    syncNow().catch((err) => console.error("sync failed", err));
  }
}

// Hover-only preview: just moves the selection/preview pane, without
// advancing anything's read state. Used for mouseenter, where the pointer
// merely passing over an item on its way elsewhere must never mark it (or
// a feed's newest article) read — that was the "だるま落とし" bug, where
// sweeping the cursor down the list read everything it crossed.
function previewFeed(feedId) {
  state.selectedFeedId = feedId;
  state.selectedEntry = sortedEntriesForFeed(feedId)[0] || null;
  setFocusedPane("feed");
  render();
}

function previewEntry(entry) {
  state.selectedEntry = entry;
  setFocusedPane("article");
  render();
}

// Previews *and* marks read on hover, unlike previewEntry above. Used by
// wide-grid mode's article grid (see renderWideGrid) and by the 3-pane
// layout's cross-feed unread timeline (see renderDesktop's isAllUnreadView)
// — deliberately not used for a specific feed's own article list, which
// stays a dense single-column list where a passing cursor sweep would read
// everything it crosses (the "だるま落とし" bug, see previewFeed's
// comment).
async function previewEntryAndMarkRead(entry) {
  state.selectedEntry = entry;
  setFocusedPane("article");
  const updated = await advanceReadState(entry);
  render();
  if (updated) syncNow().catch((err) => console.error("sync failed", err));
}

// Deliberate action (click, keyboard nav) — previews AND advances read
// state right away.
async function selectFeed(feedId) {
  previewFeed(feedId);
  const topEntry = state.selectedEntry;
  if (topEntry) await advanceProgress(topEntry);
}

// "すべての未読" link above the feed list's 未読 group (see
// renderFeedList in ui/feedList.js) — the only way back to the cross-feed
// unread timeline (see currentArticles) once a feed or search has taken
// over the article pane. Without this, getting back meant reloading the
// page, since neither selecting a feed nor searching ever clears back to
// nothing selected on their own.
function showAllUnread() {
  state.selectedFeedId = null;
  state.searchQuery = "";
  searchInputEl.value = "";
  render();
}

// Shared by openEntry (selecting an article) and the preview pane's outbound
// link (see renderDesktop's onLinkClick) — recordOpen's own chatter guard
// means clicking through moments after selecting the same article won't
// double-log it, but clicking through later (or on an article that was only
// ever glanced at in the preview, not actually followed) still will.
function logOpen(entry) {
  recordOpen(entry, state.feedsById.get(entry.feedId))
    .then(() => scheduleLogSync())
    .catch((err) => console.error("log record failed", err));
}

async function openEntry(entry) {
  previewEntry(entry);
  logOpen(entry);
  await advanceProgress(entry);
}

// Right-click/long-press on an article-list row (see articleList.js's
// onAnnotate) opens a floating color+comment popup for that entry. Tagging
// or commenting something is itself an act of having read it, so this marks
// the entry read the same way actually opening it would — reusing its
// existing log entry if reflect (or an earlier annotation) already created
// one, rather than logging a second "open" just for this.
async function openAnnotateForEntry(entry, x, y) {
  let logEntry = state.logByEntryId.get(entry.id) || null;
  if (!logEntry) {
    logEntry = await recordOpen(entry, state.feedsById.get(entry.feedId));
    if (logEntry) {
      state.logByEntryId.set(entry.id, logEntry);
      state.feedScoreById = await getFeedEngagementScores();
    }
  }
  await advanceProgress(entry);
  if (!logEntry) return;
  scheduleLogSync();
  showAnnotatePopup(entry, logEntry, x, y);
}

async function setEntryLogColor(entry, logId, color) {
  const updated = await setLogEntryColor(logId, color);
  if (updated) {
    state.logByEntryId.set(entry.id, updated);
    state.feedScoreById = await getFeedEngagementScores();
    render();
    scheduleLogSync();
  }
  return updated;
}

async function addEntryLogComment(entry, logId, text) {
  const updated = await addComment(logId, text);
  if (updated) {
    state.logByEntryId.set(entry.id, updated);
    state.feedScoreById = await getFeedEngagementScores();
    render();
    scheduleLogSync();
  }
  return updated;
}

function showAnnotatePopup(entry, initialLogEntry, x, y) {
  let logEntry = initialLogEntry;
  openFloatingPopup({
    id: entry.id,
    x,
    y,
    className: "article-annotate-popup",
    build: (popup) => {
      const draw = () => {
        renderAnnotatePopup(popup, {
          logEntry,
          onSetColor: (color) => {
            setEntryLogColor(entry, logEntry.id, color)
              .then((updated) => {
                if (updated) {
                  logEntry = updated;
                  draw();
                }
              })
              .catch((err) => console.error("set color failed", err));
          },
          onAddComment: (text) => {
            addEntryLogComment(entry, logEntry.id, text)
              .then((updated) => {
                if (updated) {
                  logEntry = updated;
                  draw();
                }
              })
              .catch((err) => console.error("add comment failed", err));
          },
        });
      };
      draw();
    },
  });
}

// force:true bypasses the due-schedule filter (used by tapping the
// next-fetch indicator) — a paused feed is skipped either way, since
// pausing is an explicit "don't fetch this at all" rather than a schedule.
async function refreshAll({ force = false } = {}) {
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
  } catch (err) {
    console.error("search history sync failed", err);
  }
  try {
    await syncNgWordsNow();
  } catch (err) {
    console.error("ng word sync failed", err);
  }
  await loadAppData();
  render();

  // Only fetch feeds that are actually due, per their own posting-frequency
  // schedule (see computeSchedule in feedFetch.js) — with a large
  // subscription list, re-fetching everything on every visit doesn't scale.
  // That schedule is the "don't bother patrolling this" half of the
  // decision; this sort is the "what to patrol first" half, run *after*
  // syncNow/syncLogNow above so it already reflects any reading done on
  // other devices. Feeds with something left unread (which, now that
  // readUntil is synced, includes ones only read-up-to-here elsewhere) go
  // first — already-caught-up feeds are the least urgent thing to spend
  // fetch time on, so they sink to the back of this round instead of
  // competing evenly with ones actually worth checking. frequencyGroup
  // (synced — see sync.js — so even a fresh device with no local fetch
  // history yet can use it) breaks ties within each of those two groups,
  // most-frequent-first, same as before this split existed.
  const now = Date.now();
  const dueFeeds = [...state.feedsById.values()]
    .filter((feed) => !feed.paused)
    .filter((feed) => force || !feed.nextCheckAt || new Date(feed.nextCheckAt).getTime() <= now)
    .sort((a, b) => {
      const unreadDiff = Number(hasUnread(b)) - Number(hasUnread(a));
      if (unreadDiff !== 0) return unreadDiff;
      const ai = FREQUENCY_ORDER.indexOf(a.frequencyGroup || "unknown");
      const bi = FREQUENCY_ORDER.indexOf(b.frequencyGroup || "unknown");
      return ai - bi;
    });

  for (let i = 0; i < dueFeeds.length; i++) {
    const feed = dueFeeds[i];
    showStatus(`フィードを取得中… (${i + 1}/${dueFeeds.length}) ${feed.title || feed.url}`, i / dueFeeds.length);
    try {
      await fetchFeed(feed);
      // Reflect this one feed's new entries right away instead of waiting
      // for every other due feed to finish fetching too — with a large
      // subscription list, that wait could be a while, and there's no
      // reason to sit on unread content we already know about.
      await refreshFeedInState(feed.feedId);
      render();
    } catch (err) {
      console.error(`fetch failed for ${feed.url}`, err);
    }
  }
  hideStatus();
  await loadAppData();
  // autoPauseDuplicateFeeds is disabled for now — its overlap heuristic was
  // pausing feeds the user didn't consider duplicates. Restore anything it
  // paused in the past instead (feeds paused without userManagedPause could
  // only have come from it, never from the user directly toggling pause).
  await restorePreviouslyAutoPausedFeeds();
  render();
}

async function restorePreviouslyAutoPausedFeeds() {
  const autoPaused = [...state.feedsById.values()].filter((f) => f.paused && !f.userManagedPause);
  for (const feed of autoPaused) {
    const updated = { ...feed, paused: false };
    await markFeedDirty(updated);
    state.feedsById.set(feed.feedId, updated);
  }
  if (autoPaused.length > 0) {
    syncNow().catch((err) => console.error("sync failed", err));
  }
}

// Enter on an http(s):// URL in the search box (see searchBar.js's
// onSubscribe) registers it as a new feed subscription instead of searching.
// feedId is derived the same way the userscript derives it when it discovers
// a feed link on a page, so a feed added either way converges on the same
// row once synced.
async function subscribeFeedFromUrl(rawUrl) {
  const url = rawUrl.trim();
  const { seed } = getSession();
  const feedId = await deriveFeedId(seed, url);

  const existing = state.feedsById.get(feedId);
  if (existing) {
    await selectFeed(feedId);
    showStatus(`既に購読しています: ${existing.title || url}`, 1);
    setTimeout(hideStatus, 2000);
    return;
  }

  showStatus(`フィードを購読中… ${url}`, 0);
  const now = new Date().toISOString();
  const newFeed = {
    feedId,
    url,
    title: url,
    addedAt: now,
    readUntil: null,
    contentHash: null,
    frequencyGroup: null,
    paused: false,
    userManagedPause: false,
    color: null,
    deletedAt: null,
    lastFetchedAt: null,
    etag: null,
    lastModified: null,
    latestContentHash: null,
    nextCheckAt: null,
    dirty: true,
    clientUpdatedAt: now,
  };

  try {
    await fetchFeed(newFeed);
  } catch (err) {
    console.error(`subscribe failed for ${url}`, err);
    showStatus(`購読に失敗しました: ${url}`, 1);
    setTimeout(hideStatus, 3000);
    return;
  }

  await loadAppData();
  render();
  await selectFeed(feedId);
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

// --- clock watermark -------------------------------------------------------
// Faint fixed HH:MM overlay (see .clock-watermark in style.css) shown
// across every screen — started once at boot in startApp and left running
// for the life of the tab, unlike the next-fetch indicator below (which is
// only ever shown for its first 30s) this is meant to be a permanent
// fixture.
function updateClockWatermark() {
  clockWatermarkEl.textContent = new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function startClockWatermark() {
  updateClockWatermark();
  // Only the minute digits are shown, so a 1s tick is more often than the
  // display can even change — one cheap textContent write a second isn't
  // worth trading for the complexity of scheduling around the exact next
  // minute boundary instead.
  setInterval(updateClockWatermark, 1000);
}

// --- next-fetch indicator ------------------------------------------------
// Shown for the first 30s after load only (see wireApp), on both mobile and
// desktop — a quick orientation of "when will feeda next check anything",
// with a tap-to-force-fetch escape hatch, without being a permanent fixture
// once the user has settled in.

const nextFetchBarEl = document.getElementById("next-fetch-bar");
const nextFetchTimeEl = document.getElementById("next-fetch-time");
let nextFetchIndicatorExpired = false;

function updateNextFetchIndicator() {
  if (nextFetchIndicatorExpired) return;

  const feeds = [...state.feedsById.values()];
  if (feeds.length === 0) {
    nextFetchBarEl.classList.add("hidden");
    return;
  }

  const now = Date.now();
  const soonest = Math.min(...feeds.map((f) => (f.nextCheckAt ? new Date(f.nextCheckAt).getTime() : now)));
  nextFetchTimeEl.textContent =
    soonest <= now ? "まもなく" : new Date(soonest).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  nextFetchBarEl.classList.remove("hidden");
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

    // 振り返る has its own left/right day navigation instead of pane focus
    // — there are no panes to focus there (see .app.reflect-mode's
    // display:none rules). Up/down are left alone so the timeline still
    // scrolls normally.
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
  setupSearchBar(
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
      } else {
        render();
      }
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
  showReadToggleInputEl.addEventListener("change", () => {
    state.showReadInTimeline = showReadToggleInputEl.checked;
    // Forces currentArticles() to rebuild the cached home timeline (see its
    // own comment) under the new filter instead of reusing whichever set of
    // entries it happened to freeze before the toggle changed.
    state.unreadTimelineSnapshot = null;
    render();
  });
  setupPaneResizing();
  setupWideGridRowResizing();
  wireKeyboardNav();
  document.getElementById("brand-btn").addEventListener("click", toggleFullscreen);
  setupSeedModal(document.getElementById("seed-btn"), document.getElementById("seed-modal"), {
    getSeed: () => getSession().seed,
    getApiBase: () => getSession().apiBase,
  });
  setupNgWordModal(document.getElementById("ng-word-btn"), document.getElementById("ng-word-modal"), {
    onChange: () => {
      syncNgWordsNow().catch((err) => console.error("ng word sync failed", err));
      getActiveNgWords()
        .then((words) => {
          state.ngWords = words.map((w) => w.word.toLowerCase());
          state.unreadTimelineSnapshot = null; // re-derive the home timeline under the new filter
          if (state.mode === "reflect") return;
          render();
        })
        .catch((err) => console.error("ng word reload failed", err));
    },
  });
  setupPairingShareUI({
    getSeed: () => getSession().seed,
    getApiBase: () => getSession().apiBase,
  });
  modeToggleBtn.addEventListener("click", toggleMode);
  wideGridToggleBtn.addEventListener("click", toggleWideGridMode);
  document.getElementById("reflect-prev-day").addEventListener("click", () => changeReflectDate(-1));
  document.getElementById("reflect-next-day").addEventListener("click", () => changeReflectDate(1));
  document.getElementById("reflect-today-btn").addEventListener("click", jumpReflectToToday);
  // Re-render across the mobile/tablet/desktop/wide-grid breakpoints (window
  // resize, or a foldable/rotation crossing one) so the right layout's
  // markup is kept up to date even if it wasn't the active one a moment ago.
  mobileQuery.addEventListener("change", () => render());
  tabletQuery.addEventListener("change", () => render());
  wideGridQuery.addEventListener("change", () => render());

  nextFetchBarEl.addEventListener("click", () => {
    refreshAll({ force: true }).catch((err) => console.error("forced refresh failed", err));
  });
  // Only worth showing right after load, as a quick orientation — not a
  // permanent fixture once the user has settled into reading.
  setTimeout(() => {
    nextFetchIndicatorExpired = true;
    nextFetchBarEl.classList.add("hidden");
  }, 30000);
}

async function startApp() {
  appRoot.classList.remove("hidden");
  wireApp();
  startClockWatermark();
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
      .then((reg) => reg.update().catch(() => {}))
      .catch((err) => console.error("service worker registration failed", err));
  });
}

boot();
