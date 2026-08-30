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
import { getAllFeeds, getFeed, getEntriesByFeed, getAllSearchHistoryEntries, getAllLogEntries } from "./db.js";
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
  getFeedEngagementScores,
  searchLogEntries,
  dateStrOf,
  shiftDateStr,
} from "./logbook.js";
import { fetchFeed } from "./feedFetch.js";
import { FREQUENCY_ORDER, isCheckDayForFeed } from "./frequency.js";
import { searchEntries } from "./search.js";
import { renderColorFilter } from "./ui/commonComponents.js";
import { colorForWord } from "./colorPalette.js";
import { renderArticleList } from "./ui/articleList.js";
import { renderReflectTimeline, renderDayChart, openBlockUrlPopup } from "./ui/reflect.js";
import { setupSearchBar } from "./ui/searchBar.js";
import { setupSeedModal } from "./ui/seedModal.js";
import { setupNgWordModal } from "./ui/ngWordModal.js";
import { setupUrlBlockModal } from "./ui/urlBlockModal.js";
import { setupShortcutsModal } from "./ui/shortcutsModal.js";
import { setupPairingShareUI, setupPairingReceiveUI } from "./ui/pairingModal.js";
import { setupShareLinkUI } from "./ui/shareLinkModal.js";
import { updateFavicon } from "./favicon.js";
import { extractArticlePreview } from "./sanitize.js";
import { startViewTimeTracking } from "./viewTime.js";

const setupScreen = document.getElementById("setup-screen");
const appRoot = document.getElementById("app");
const feedColorFilterEl = document.getElementById("feed-color-filter");
const searchInputEl = document.getElementById("search-input");
const articleListEl = document.getElementById("article-list");
const statusBarEl = document.getElementById("status-bar");
const statusBarFillEl = document.getElementById("status-bar-fill");
const statusBarTextEl = document.getElementById("status-bar-text");
const clockWatermarkEl = document.getElementById("clock-watermark");
const viewLimitOverlayEl = document.getElementById("view-limit-overlay");
const modeToggleBtn = document.getElementById("mode-toggle-btn");
const moreMenuBtn = document.getElementById("more-menu-btn");
const moreMenuEl = document.getElementById("more-menu");
// Set by setupShortcutsModal (see wireApp) — read here so wireKeyboardNav's
// "?" binding can open the same modal instance instead of each keeping its
// own. Assigned before wireKeyboardNav's listener can ever actually fire
// (both happen synchronously inside wireApp), so the placeholder default
// never really runs.
let openShortcutsModal = () => { };
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
  entriesByFeed: new Map(),
  // entry.id -> its latest log entry (see getLatestLogEntriesByEntryId in
  // logbook.js) — lets the article list show a color tag/comment recorded
  // from reflect (or straight from the list — see annotateEntrySetColor)
  // without a per-row IndexedDB lookup for every visible article.
  logByEntryId: new Map(),
  // feedId -> cumulative engagement score (see getFeedEngagementScores in
  // logbook.js) — clicking into, commenting on, or color-tagging a feed's
  // articles raises its score, sorting its block higher in the unread
  // timeline's grouped view (see currentArticles' own unreadFeedOrder) than
  // one that's merely posted recently but gone unengaged.
  feedScoreById: new Map(),
  searchQuery: "",
  // The most recent non-empty search query, kept around after searchQuery
  // itself goes back to "" (search cleared, or the box auto-clearing on
  // every focus — see searchBar.js). Powers highlightQuery() below so
  // article titles/body text keep showing what you were just looking for
  // even once you're back to browsing the full unread list.
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
  // Refreshed by loadAppData and (for the query just typed, without waiting
  // on the next periodic refresh) searchBar.js's onHistoryChange.
  searchHistoryWords: [],
  // "view" is the normal reading UI; "reflect" swaps in the activity-log
  // timeline (see renderReflect) — the two are different enough (date-
  // scoped instead of unread-scoped) that they get their own top-level
  // screen rather than sharing render().
  mode: "view",
  reflectDate: dateStrOf(),
  // Snapshot of the cross-feed unread timeline (the article list's only
  // view now — see currentArticles). Frozen at capture time so opening an
  // entry (which marks it, and possibly its whole feed, as read) doesn't
  // yank it out of the list the user is currently looking at. Cleared
  // whenever fresh data is loaded from IndexedDB (loadAppData).
  unreadTimelineSnapshot: null,
  // Block order (front = top) for the grouped-by-feed rendering of the
  // above timeline — see mergeIntoUnreadTimeline. Kept separate from the
  // snapshot's own (still chronological) entry order so a feed that just
  // got new unread entries can jump its whole block to the top without
  // having to re-sort — or re-render the position of — anything else.
  unreadFeedOrder: [],
};

// Used by autoPauseDuplicateFeeds's same-host feed clustering — "which site
// is this actually from" rather than the feed's own title, which two
// independent subscriptions to the same site's feed can easily disagree on
// (e.g. one renamed by the user).
function feedHost(feed) {
  if (!feed || !feed.url) return null;
  try {
    return new URL(feed.url).host;
  } catch {
    return null;
  }
}

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

// NG-word/URL-block filtered the same way the article list itself is (see
// filterByNgWords/filterByUrlBlocks) — otherwise a feed whose only unread
// entries are all filtered still shows an unread dot/badge and gets fetch
// priority even though opening it renders an empty "未読の記事はありません"
// list.
function hasUnread(feed) {
  const entries = state.entriesByFeed.get(feed.feedId) || [];
  return entries.some((e) =>
    isUnread(e, feed) &&
    !matchesAnyNgWord(e.title, state.ngWords) &&
    !matchesAnyUrlBlockPattern(e.link, state.urlBlockPatterns)
  );
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
  state.urlBlockPatterns = (await getActiveUrlBlockPatterns()).map((p) => p.pattern);
  state.searchHistoryWords = (await getAllSearchHistoryEntries()).map((e) => e.query);
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
// since the snapshot froze (including moments ago, e.g. by right-clicking
// it open to annotate) the same way it drops genuinely stale ones. That was
// the bug behind an annotate popup
// closing itself right after opening: a background refetch landing mid-
// popup would rebuild the timeline, the just-annotated entry (now read)
// would no longer qualify, and renderArticleList's closeFloatingPopupIfMissing
// would treat it as gone and close the popup out from under the user. Only
// ever adds entries that aren't in the snapshot yet, so anything already
// surfaced — read or not — stays exactly where it was.
function mergeIntoUnreadTimeline(feed, entries) {
  if (!state.unreadTimelineSnapshot) return;
  const existingIds = new Set(state.unreadTimelineSnapshot.map((e) => e.id));
  const fresh = entries.filter((e) => !existingIds.has(e.id) && isUnread(e, feed));
  if (fresh.length === 0) return;
  const merged = [...state.unreadTimelineSnapshot, ...fresh].sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
  state.unreadTimelineSnapshot = dedupeByContent(merged);
  // Move this feed's block to the *back* of the grouped view (see
  // unreadFeedOrder's own comment) instead of leaving the new entries to
  // land wherever their pubDate happens to sort them in the flat snapshot
  // above — that's what used to make a background refetch splice new rows
  // into the middle of the list mid-read ("ミルフィーユ" — a different
  // feed's new stuff shouldn't shove itself between rows already on
  // screen). The back, not the front: appearing at the bottom keeps it out
  // of the way of whatever's already in view up top, rather than bumping
  // it down by pushing a new block in ahead of it.
  state.unreadFeedOrder = [...state.unreadFeedOrder.filter((id) => id !== feed.feedId), feed.feedId];
}

// Same title + same first 10 characters of body text — a press release
// picked up by multiple outlets, a blog post cross-posted elsewhere, or
// (see dedupeByContent below) the exact same article surfacing through two
// different feeds of the same platform. Runs once when the cross-feed
// timeline is built or merged (see currentArticles/mergeIntoUnreadTimeline),
// not per render, since extractArticlePreview does real HTML parsing per
// entry.
function dedupContentKey(entry) {
  const title = (entry.title || "").trim();
  if (!title) return null;
  const { snippet } = extractArticlePreview(entry.content || entry.summary || "");
  return `${title} ${snippet.slice(0, 10)}`;
}

// Used to also require the two entries' *feeds* to be on different hosts —
// meant to only catch "same story, different outlet" while leaving
// same-host repeats alone (on the assumption that was just a near-duplicate
// feed pair, already handled by autoPauseDuplicateFeeds). That broke down
// for platform aggregator feeds like Hatena Bookmark's own ranking feeds:
// two different category feeds (e.g. 総合 and 世の中) are both hosted at
// b.hatena.ne.jp, so a viral story bookmarked into both categories kept
// showing up twice in the unread timeline — identical title, identical
// snippet, "same host" only because both feeds happen to be Hatena's own,
// not because it was actually the same feed. A title+snippet match this
// exact is never a coincidence worth keeping both copies of, regardless of
// which feed(s) surfaced it, so this now drops every repeat outright.
function dedupeByContent(entries) {
  const seenKeys = new Set();
  const result = [];
  for (const entry of entries) {
    const key = dedupContentKey(entry);
    if (key) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }
    result.push(entry);
  }
  return result;
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
// having anything in it.
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
// "NGワード" topbar button) never shows up in the article list — applied
// once here, the one place currentArticles() actually returns entries,
// rather than in each of its three branches separately.
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

function currentArticles() {
  const query = state.searchQuery;
  if (query) {
    const allEntries = [...state.entriesByFeed.values()].flat();
    const matched = searchEntries(query, allEntries, state.feedTitleById);
    matched.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
    return { entries: filterByUrlBlocks(filterByNgWords(matched.slice(0, 200))), showFeedName: true, emptyHint: "検索結果がありません。" };
  }
  // The article list's only other view: unread entries across all feeds,
  // newest first (date-less unread entries have no position to sort by, so
  // they sink to the end — see the pubDate-less comparator behavior below).
  // The set of entries is frozen in state.unreadTimelineSnapshot the first
  // time it's needed and reused after that — opening an entry marks it (and
  // possibly its whole feed) as read, and isUnread is re-evaluated live for
  // styling, but the entry stays in place instead of vanishing out of the
  // list.
  if (!state.unreadTimelineSnapshot) {
    const timeline = [];
    const newestByFeed = new Map();
    for (const feed of state.feedsById.values()) {
      for (const entry of state.entriesByFeed.get(feed.feedId) || []) {
        if (isUnread(entry, feed)) {
          timeline.push(entry);
          if (!newestByFeed.has(feed.feedId) || (entry.pubDate || "") > newestByFeed.get(feed.feedId)) {
            newestByFeed.set(feed.feedId, entry.pubDate || "");
          }
        }
      }
    }
    timeline.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
    state.unreadTimelineSnapshot = dedupeByContent(timeline);
    // Initial block order for the grouped view (see unreadFeedOrder's own
    // comment): pinned first, then engagement score — a feed you've
    // actually opened, commented on, or color-tagged outranks one that's
    // merely posted recently but gone unengaged (see getFeedEngagementScores
    // in logbook.js), same "満足度優先" priority the sidebar's own
    // compareFeeds already uses (frequency.js) — falling back to newest-
    // entry recency only to break ties between equally (un)engaged feeds.
    const feedIdsPresent = new Set(timeline.map((e) => e.feedId));
    state.unreadFeedOrder = [...feedIdsPresent].sort((a, b) => {
      const feedA = state.feedsById.get(a);
      const feedB = state.feedsById.get(b);
      const pinnedDiff = Number(Boolean(feedB && feedB.pinned)) - Number(Boolean(feedA && feedA.pinned));
      if (pinnedDiff !== 0) return pinnedDiff;
      const scoreDiff = (state.feedScoreById.get(b) || 0) - (state.feedScoreById.get(a) || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (newestByFeed.get(b) || "").localeCompare(newestByFeed.get(a) || "");
    });
  }
  return {
    entries: filterByUrlBlocks(filterByNgWords(state.unreadTimelineSnapshot)),
    feedOrder: state.unreadFeedOrder,
    showFeedName: true,
    emptyHint: "未読の記事はありません。",
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
  // Doubles as the registered-feed count display and a discoverable hint
  // that pasting a URL here registers it as a new subscription (see the
  // http(s):// branch in searchBar.js's onSubscribe), instead of spending a
  // dedicated line on either.
  searchInputEl.placeholder = `${state.feedsById.size}件を検索・URLを貼り付けて登録`;
  renderApp();
  updateFavicon(countUnreadSources());
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
  // Icon-only button (see .icon-btn in style.css) — the glyph itself
  // (📖) doesn't change, .active carries which mode is current, and the
  // title covers what a click does for anyone hovering/using a screen
  // reader.
  modeToggleBtn.classList.toggle("active", state.mode === "reflect");
  modeToggleBtn.title = state.mode === "reflect" ? "見るに戻る" : "振り返る";
  if (state.mode === "reflect") {
    renderReflect().catch((err) => console.error("reflect render failed", err));
    startReflectLiveRefresh();
  } else {
    stopReflectLiveRefresh();
    render();
  }
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
  // Same shared #feed-color-filter bar + #search-history-bar row the main
  // screen's .filter-row shows above the article list (see renderApp) —
  // now visible in reflect mode too (see style.css's .app.reflect-mode
  // rules), so it needs refreshing here the same way, since render() itself
  // no-ops in reflect mode.
  renderFeedColorFilterBar();
  const query = state.searchQuery.trim();
  // The day-nav (prev/next/today + trend charts) has nothing sensible to
  // show while a search query is narrowing the timeline instead of a single
  // day — no one day is "selected", so hide the whole thing rather than
  // leave it showing controls that don't apply right now.
  reflectDayNavEl.classList.toggle("hidden", Boolean(query));
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

// 振り返る画面のエクスポートボタン — 開いた・コメントした・色/タグを付けた
// という記録(logEntries)全件を、日付で絞らずまるごとJSONに書き出す。他の
// フィールドと違って同期用のdirty/clientUpdatedAtも含めて書き出す(単なる
// バックアップ/自分用データなので、そのまま読み直せる形を優先し、あえて
// 削らない)。
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

// "⋯" メニューのOPMLエクスポート — state.feedsById（loadAppDataで
// deletedAt済みは既に除外されている、今まさに購読中のフィード一覧）を
// そのままOPML 2.0として書き出す。一時停止中のフィードも含める(購読を
// やめたわけではないため)。
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

// "刈り取り" (reap) — the plain delete path (see reflect.js's 🗑️ button).
// Tombstones the entry (see logbook.js's removeLogEntry) and redraws;
// renderReflect() below syncs (push+pull) immediately before it redraws,
// which already covers pushing this tombstone, same as handleAddComment.
async function handleDeleteLog(logId) {
  await removeLogEntry(logId);
  await renderReflect();
}

// "刈り取り" (reap) — the delete-and-block path (see reflect.js's 🚫
// button). Opens the pattern-editing popup right next to the button that
// was clicked; only on confirm does it actually add the pattern, delete the
// entry, and push the new pattern out so it applies on every device (and to
// every future fetch — see feedFetch.js) as soon as possible.
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

// Shared by setupUrlBlockModal's onChange and handleBlockAndDeleteLog —
// reloads the active pattern list into state and redraws whichever screen
// is actually showing (render() itself no-ops in reflect mode, same as
// everywhere else that flips on state.mode).
async function refreshUrlBlockState() {
  state.urlBlockPatterns = (await getActiveUrlBlockPatterns()).map((p) => p.pattern);
  state.unreadTimelineSnapshot = null; // re-derive the home timeline under the new filter
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

// The only reading screen — a single scrolling column of article cards,
// same at every viewport width. Grouped by feed (each with its own header
// whose per-feed actions row reveals on hover — see ui/articleList.js) while
// browsing the plain unread timeline; a flat list showing each entry's feed
// name inline while searching, since search results are ranked by
// relevance, not by feed.
function renderApp() {
  const query = state.searchQuery;
  renderFeedColorFilterBar();

  const { entries, showFeedName, emptyHint, feedOrder } = currentArticles();

  articleReadObserver?.disconnect();
  articleReadObserver = new IntersectionObserver(handleArticleScrollIntersections, {
    root: null,
    threshold: 0,
  });
  articleScrollEntries = new Map(entries.map((e) => [e.id, e]));

  renderArticleList(articleListEl, {
    entries,
    feedTitleById: state.feedTitleById,
    query: highlightQuery(),
    isUnread: (entry) => isUnread(entry, state.feedsById.get(entry.feedId)),
    onOpen: openEntry,
    onSetColor: annotateEntrySetColor,
    onAddComment: annotateEntryAddComment,
    onRowMounted: (li) => articleReadObserver.observe(li),
    logByEntryId: state.logByEntryId,
    showFeedName,
    emptyHint,
    groupByFeed: !query.trim(),
    feedOrder,
    feedsById: state.feedsById,
    onTogglePauseFeed: togglePauseFeed,
    onToggleKeepFeed: toggleKeepFeed,
    onTogglePinFeed: togglePinFeed,
    onSetFeedColor: setFeedColor,
    onCopyFeedUrl: copyFeedUrl,
    onMarkAllRead: handleMarkAllReadClick,
  });
}

// Feed pause/pin/color changes only ever come from the article list's own
// per-feed hover actions row — so this is just render(), which itself no-ops
// in reflect mode.
function refreshAfterFeedChange() {
  render();
}

// Shared by togglePauseFeed (the article list's own per-feed hover actions
// row's pause/resume icon) — persists a feed's
// paused state without rendering or syncing itself, so a group of feeds
// can be paused one at a time and still only trigger one render/sync at
// the end. Marks the feed userManagedPause so autoPauseDuplicateFeeds
// (below) never overrides a deliberate choice the user made either way.
async function setFeedPaused(feedId, paused) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  let updated = { ...feed, paused, userManagedPause: true };
  // Pausing means "I'm done with this feed for now" — catch it up to read
  // at the same moment, the same way advanceReadState does for an entry
  // actually viewed, so it doesn't keep sitting there with an unread dot
  // under 更新停止 for something you've deliberately stopped following.
  if (paused) {
    updated = { ...updated, readUntil: new Date().toISOString() };
    if (updated.latestContentHash) updated = { ...updated, contentHash: updated.latestContentHash };
  }
  await markFeedDirty(updated);
  state.feedsById.set(feedId, updated);
}

// "更新を停止/再開" in the article list's per-feed hover actions row (see
// buildFeedHeaderActions in ui/articleList.js) — toggles whether the feed
// gets fetched at all. Paused feeds sort into their own "更新停止" group
// (see frequency.js) and are skipped entirely by refreshAll, even when
// forced.
async function togglePauseFeed(feedId) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  await setFeedPaused(feedId, !feed.paused);
  refreshAfterFeedChange();
  syncNow().catch((err) => console.error("sync failed", err));
}

// "上部にピン留め/ピン留めを解除" in the feed's hover actions row (see
// ui/articleList.js) — pulls the feed out of the normal status/frequency
// tree into its own "📌 ピン留め" group at the very top of the sidebar (see
// frequency.js's groupFeedsByFrequency), independent of pause/color/read
// state.
async function togglePinFeed(feedId) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  const updated = { ...feed, pinned: !feed.pinned };
  await markFeedDirty(updated);
  state.feedsById.set(feedId, updated);
  refreshAfterFeedChange();
  syncNow().catch((err) => console.error("sync failed", err));
}

// The article list's per-feed hover actions row (see buildFeedHeaderActions
// in ui/articleList.js) offers this alongside 更新停止 — stopping is the
// automatic, rule-driven default for a high-frequency feed nobody's
// engaging with (see autoPauseInactiveFeeds), so this is the deliberate
// opt-out: explicitly vouching for a feed so that rule never touches it,
// even if it's noisy and you go a while between things it posts that are
// actually worth reading. Independent of pinned (which is about being
// pulled to the top of the timeline, not fetch eligibility) and of
// paused/userManagedPause (an already-paused feed still needs a manual
// resume — see togglePauseFeed — keep alone won't fetch it).
async function toggleKeepFeed(feedId) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  const updated = { ...feed, keep: !feed.keep };
  await markFeedDirty(updated);
  state.feedsById.set(feedId, updated);
  refreshAfterFeedChange();
  syncNow().catch((err) => console.error("sync failed", err));
}

// The hover actions row's color swatches (see ui/articleList.js) — tags a
// feed with one of COLOR_PALETTE's colors (see colorPalette.js) for
// at-a-glance grouping in the sidebar (.feed-item--colored in style.css),
// same mechanism as reflect entry color-tagging. colorKey null clears the
// tag.
async function setFeedColor(feedId, colorKey) {
  const feed = state.feedsById.get(feedId);
  if (!feed) return;
  const updated = { ...feed, color: colorKey || null };
  await markFeedDirty(updated);
  state.feedsById.set(feedId, updated);
  refreshAfterFeedChange();
  syncNow().catch((err) => console.error("sync failed", err));
}

// The top filter bar's color swatch row (see renderColorFilter in
// ui/commonComponents.js) — colorKey null means "clear filter" (its own
// button, distinct from any color swatch), otherwise toggles that one
// color's membership in the filter set. Multiple colors can be active at
// once: a feed shows if it matches any of them. The bar itself is shared
// between view and reflect mode (see renderReflect), so this dispatches to
// whichever screen is actually showing — render() alone would no-op while
// in reflect mode (see its own comment).
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

// Duplicate-feed cleanup, called from refreshAll after every crawl. Two
// active feeds count as duplicates when they're on the *same host* (so
// platform sites where many different users/channels share one domain,
// e.g. hatena/note/YouTube, are never lumped together just for that) AND
// their article titles substantially overlap — the real-world case this
// catches is a site that publishes the same content as both an RSS2 feed
// and an Atom feed at different URLs. Titles rather than links: two feeds
// for the same underlying content don't always link to identical URLs
// (tracking params, AMP vs. canonical, ...) but do publish the same
// headlines.
const DUPLICATE_OVERLAP_THRESHOLD = 0.8;
const DUPLICATE_MIN_ENTRIES = 3;

function entryTitleSet(feedId) {
  const entries = state.entriesByFeed.get(feedId) || [];
  return new Set(entries.map((e) => (e.title || "").trim()).filter(Boolean));
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
  const titleSets = new Map(activeFeeds.map((f) => [f.feedId, entryTitleSet(f.feedId)]));
  const hosts = new Map(activeFeeds.map((f) => [f.feedId, feedHost(f)]));

  // Union-find over "same host, enough title overlap" pairs, so A/B/C all
  // matching pairwise end up in one cluster even if not every pair was
  // compared.
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
    const hostA = hosts.get(activeFeeds[i].feedId);
    if (!hostA) continue;
    const setA = titleSets.get(activeFeeds[i].feedId);
    if (setA.size < DUPLICATE_MIN_ENTRIES) continue;
    for (let j = i + 1; j < activeFeeds.length; j++) {
      if (hosts.get(activeFeeds[j].feedId) !== hostA) continue;
      const setB = titleSets.get(activeFeeds[j].feedId);
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

// A feed posting this often that nobody has opened/tagged/commented on in
// its entire history (see getFeedEngagementScores) is exactly the kind that
// buries the rest of the unread timeline in volume without paying for the
// clutter — see main.js's currentArticles/unreadFeedOrder. Only the highest
// tiers (daily/several-per-week — see frequency.js's GROUPS) qualify; a
// feed that already posts rarely doesn't need this, it never crowded
// anything out to begin with.
const HIGH_FREQUENCY_GROUPS = new Set(["daily-20", "daily-10", "daily-5", "daily-3", "daily-1", "several-per-week"]);
// Below this many cached entries, there isn't enough history yet to call a
// feed "unengaged" — a feed added five minutes ago with two articles hasn't
// had a fair chance.
const AUTO_PAUSE_MIN_ENTRIES = 5;

// Runs every refreshAll round (see autoPauseDuplicateFeeds's own call site)
// so a feed's fetch history growing past AUTO_PAUSE_MIN_ENTRIES, or its
// frequencyGroup changing, gets picked up without waiting on anything else.
// pinned/keep/userManagedPause are all distinct "leave this alone" signals
// (sidebar position, an explicit vouch — see toggleKeepFeed — and a
// deliberate manual pause/resume respectively) and any one of them is
// enough to exempt a feed here, same as autoPauseDuplicateFeeds's own
// userManagedPause carve-out just above.
async function autoPauseInactiveFeeds() {
  const toPause = [];
  for (const feed of state.feedsById.values()) {
    if (feed.paused || feed.pinned || feed.keep || feed.userManagedPause) continue;
    if (!HIGH_FREQUENCY_GROUPS.has(feed.frequencyGroup)) continue;
    const entries = state.entriesByFeed.get(feed.feedId) || [];
    if (entries.length < AUTO_PAUSE_MIN_ENTRIES) continue;
    if ((state.feedScoreById.get(feed.feedId) || 0) > 0) continue;
    toPause.push(feed);
  }
  // Deliberately doesn't catch the feed up to read (unlike setFeedPaused) —
  // this is the system's guess that nobody's looking, not the user saying
  // "I'm done with this," so the existing unread backlog stays exactly as
  // unread as it was in case anyone ever does open the feed directly.
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

// Marks a row read once it scrolls out of view (past the top) — same
// IntersectionObserver-per-row technique regardless of pointer type, rooted
// at the viewport since the article list is now the only scrolling surface
// on the page. Rebuilt fresh in renderApp() on every render, since the rows
// themselves are torn down and rebuilt too (renderArticleList replaces
// #article-list's innerHTML).
let articleReadObserver = null;
let articleScrollEntries = new Map();
function handleArticleScrollIntersections(observerEntries) {
  for (const oe of observerEntries) {
    // Only care about rows that scrolled *past* (exited above the visible
    // area) — not ones below the fold that haven't been seen yet, and not
    // the initial "not intersecting yet" report some browsers fire on
    // observe() for elements already off-screen below. rootBounds.height
    // being 0 is a *different* spurious initial report some browsers fire
    // for a row observed before the very first layout pass has actually
    // run: every field on it (including boundingClientRect) is still zeroed
    // out, so 0 > 0 is false and would otherwise slip straight past the
    // check above it and get treated as "already scrolled past the top" —
    // instantly marking the entire freshly-loaded list read on mount.
    if (oe.isIntersecting || !oe.rootBounds || oe.rootBounds.height === 0) continue;
    if (oe.boundingClientRect.bottom > oe.rootBounds.top) continue;

    const entry = articleScrollEntries.get(oe.target.dataset.entryId);
    if (entry) markReadOnScroll(entry, oe.target);
  }
}

async function markReadOnScroll(entry, liEl) {
  const updated = await advanceReadState(entry);
  if (!updated) return;
  liEl.classList.remove("unread");
  scheduleScrollSync();
}

// Shared by markReadOnScroll (per-row scroll marking) and
// markAllVisibleEntriesRead (the reached-the-bottom batch) below —
// debounces the actual network sync so flicking past a long run of unread
// items fires one push+pull once things settle, not one per item/batch in
// quick succession.
let scrollSyncDebounceTimer = null;
function scheduleScrollSync() {
  clearTimeout(scrollSyncDebounceTimer);
  scrollSyncDebounceTimer = setTimeout(() => {
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

// The IntersectionObserver in handleArticleScrollIntersections only ever
// catches a row once it's fully scrolled past the *top* of #article-list
// (the actual scrolling element — see .article-list-view in style.css; the
// page itself never scrolls) — the last handful of rows at the very end of
// a list can sit at rest against the bottom of that scroll area forever
// without ever doing that, even once there's nothing left to scroll to.
// This covers that case: once #article-list's own scroll position bottoms
// out, whatever's still marked unread and currently in the list is right
// there on screen and has been seen, so it all catches up at once, same as
// the per-row path just does it in a single batch instead of one row at a
// time.
function handleArticleListScrollBottom() {
  if (articleScrollEntries.size === 0) return;
  // A pane that hasn't actually been laid out yet reads 0 for clientHeight,
  // which would trivially satisfy "at bottom" below — same class of
  // pre-layout false positive as the IntersectionObserver's own
  // rootBounds.height guard above.
  if (articleListEl.clientHeight === 0) return;
  const atBottom = articleListEl.scrollTop + articleListEl.clientHeight >= articleListEl.scrollHeight - 4;
  if (!atBottom) return;
  markAllVisibleEntriesRead(articleScrollEntries.values(), articleListEl);
}

async function markAllVisibleEntriesRead(entries, containerEl) {
  let changedAny = false;
  for (const entry of entries) {
    const updated = await advanceReadState(entry);
    if (updated) changedAny = true;
  }
  if (!changedAny) return;
  for (const li of containerEl.querySelectorAll(".mobile-article-item.unread")) {
    li.classList.remove("unread");
  }
  scheduleScrollSync();
}

// The "全て既読" button renderArticleList adds at the bottom of the list
// when it's short enough to fit on screen without scrolling (see
// ui/articleList.js's appendMarkAllReadButtonIfFits) — those rows never
// scroll past the top, so the per-row (handleArticleScrollIntersections) and
// reached-the-bottom (handleArticleListScrollBottom) auto-read paths never
// fire for them on their own. Same batch mark as reaching the bottom does;
// only the button itself needs manually dropping afterward since nothing
// else here re-renders the list.
async function handleMarkAllReadClick() {
  await markAllVisibleEntriesRead(articleScrollEntries.values(), articleListEl);
  articleListEl.querySelector(".mark-all-read-btn")?.remove();
}

// "u" (see wireKeyboardNav) — clears an active search back to the plain
// unread timeline. The only other way back once you've typed a query, since
// there's no feed selection to fall back to any more.
function clearSearch() {
  state.searchQuery = "";
  searchInputEl.value = "";
  render();
}

// Logs the article as opened — recordOpen's own chatter guard means
// clicking through moments after this won't double-log it.
//
// Caches whatever recordOpen actually wrote into state.logByEntryId —
// without this, right-clicking the same entry moments later (e.g. to
// color/comment it right after opening it — common in the frozen unread
// timeline, where a read entry stays put instead of disappearing) found
// nothing in the cache, called recordOpen a second time, and got back null
// from its chatter guard instead of the entry this call just created —
// silently failing to open the annotate popup at all.
function logOpen(entry) {
  recordOpen(entry, state.feedsById.get(entry.feedId))
    .then((logEntry) => {
      if (logEntry) state.logByEntryId.set(entry.id, logEntry);
      scheduleLogSync();
    })
    .catch((err) => console.error("log record failed", err));
}

async function openEntry(entry) {
  logOpen(entry);
  await advanceProgress(entry);
}

// Backs the article list's hover-revealed color palette/comment form (see
// annotateEntrySetColor/annotateEntryAddComment below) — needs a log entry
// to attach a color or comment to, reusing one reflect (or an earlier
// annotation) already created rather than logging a second "open" just for
// this. Commenting or color-tagging something is itself an act of having
// read it, so this marks the entry read the same way actually opening it
// would.
async function ensureLogEntryForEntry(entry) {
  let logEntry = state.logByEntryId.get(entry.id) || null;
  if (!logEntry) {
    logEntry = await recordOpen(entry, state.feedsById.get(entry.feedId));
    if (logEntry) {
      state.logByEntryId.set(entry.id, logEntry);
      state.feedScoreById = await getFeedEngagementScores();
    }
  }
  await advanceProgress(entry);
  return logEntry;
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

// Wired to the article list's hover-revealed color palette (see
// ui/articleList.js's buildAnnotateSection) — ensures a log entry exists
// before tagging it, same as the comment form below.
async function annotateEntrySetColor(entry, color) {
  const logEntry = await ensureLogEntryForEntry(entry);
  if (!logEntry) return;
  scheduleLogSync();
  await setEntryLogColor(entry, logEntry.id, color);
}

async function annotateEntryAddComment(entry, text) {
  const logEntry = await ensureLogEntryForEntry(entry);
  if (!logEntry) return;
  scheduleLogSync();
  await addEntryLogComment(entry, logEntry.id, text);
}

// Upper bound on how many feeds a single refreshAll() round will actually
// fetch (when not forced). Without this, a device that's new or has sat
// idle long enough for most nextCheckAt values to lapse — e.g. a second
// device opened right after clearing everything unread on a first one —
// treats its entire subscription list as "due" at once and fires off a
// fetch for every single one on that one visit. The excess simply stays
// due and rolls into the next visit/scheduled run instead, spreading a
// large backlog across several sessions rather than bursting it into one.
const MAX_FETCHES_PER_SESSION = 10;

// Chance, per refreshAll round, of reviving one auto-paused feed for a
// single extra fetch (see the dueFeeds "先祖返り" step below) — occasional
// on purpose, not every visit, so it reads as a quiet occasional bonus
// rather than undermining autoPauseInactiveFeeds by constantly re-surfacing
// the same silenced feeds.
const REVIVE_CHANCE = 0.3;

async function refreshAll() {
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
  try {
    await syncUrlBlockNow();
  } catch (err) {
    console.error("url block sync failed", err);
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
  // A share-link recipient's ephemeral tab (see session.js) shares the same
  // IndexedDB as the owner's own device, so most feeds already have a fresh
  // nextCheckAt from the owner's regular visits and would otherwise look
  // "not due" here — leaving the person being shown around staring at
  // whatever was already cached instead of a live crawl. Ephemeral sessions
  // are short-lived and single-tab by construction, so skipping the
  // due-schedule gate for the one round on open doesn't create the
  // every-visit-refetches-everything problem MAX_FETCHES_PER_SESSION and the
  // schedule normally guard against.
  const isEphemeral = Boolean(getSession().ephemeral);
  let dueFeeds = [...state.feedsById.values()]
    .filter((feed) => !feed.paused)
    .filter((feed) => isEphemeral || !feed.nextCheckAt || new Date(feed.nextCheckAt).getTime() <= now)
    // Low-frequency feeds only get checked on their own assigned weekday
    // (see isCheckDayForFeed) — a large tail of monthly/rare/unknown feeds
    // shouldn't compete for fetch time every single day just because their
    // own nextCheckAt has lapsed.
    .filter((feed) => isEphemeral || isCheckDayForFeed(feed))
    .sort((a, b) => {
      const unreadDiff = Number(hasUnread(b)) - Number(hasUnread(a));
      if (unreadDiff !== 0) return unreadDiff;
      const ai = FREQUENCY_ORDER.indexOf(a.frequencyGroup || "unknown");
      const bi = FREQUENCY_ORDER.indexOf(b.frequencyGroup || "unknown");
      return ai - bi;
    });
  dueFeeds = dueFeeds.slice(0, MAX_FETCHES_PER_SESSION);

  // "先祖返り" — every so often, give one feed autoPauseInactiveFeeds
  // stopped a single extra fetch anyway, on top of the normal due-schedule
  // selection above. Doesn't touch feed.paused itself (it stays sorted into
  // 更新停止 either way — see setFeedPaused), so if nothing comes of it
  // there's nothing to undo; if the fresh content turns out engaging, the
  // score that lands in feedScoreById from that will naturally keep
  // autoPauseInactiveFeeds from re-silencing it on a later round. A feed the
  // user paused by hand (userManagedPause) is excluded — that "I don't want
  // this" is never the system's to second-guess.
  if (Math.random() < REVIVE_CHANCE) {
    const dueIds = new Set(dueFeeds.map((f) => f.feedId));
    const reviveCandidates = [...state.feedsById.values()].filter(
      (f) => f.paused && !f.userManagedPause && !dueIds.has(f.feedId)
    );
    if (reviveCandidates.length > 0) {
      dueFeeds = [...dueFeeds, reviveCandidates[Math.floor(Math.random() * reviveCandidates.length)]];
    }
  }

  // Fetched with a handful of workers in flight at once rather than one
  // feed at a time — with up to MAX_FETCHES_PER_SESSION due feeds, a strictly
  // serial loop means the whole round trip (proxy + origin fetch + parse) of
  // every single one stacks up end to end, which is most of why opening the
  // app after a while away used to sit on "取得中" for so long. Each feed's
  // own put/read calls are keyed by its feedId, so nothing here contends
  // across workers; only the shared `nextIndex` needs to stay race-free,
  // which a plain synchronous pre-increment (no await before it) guarantees
  // in JS regardless of how many workers are mid-flight.
  const FETCH_CONCURRENCY = 5;
  let nextIndex = 0;
  let completed = 0;
  async function fetchWorker() {
    while (nextIndex < dueFeeds.length) {
      const feed = dueFeeds[nextIndex++];
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
      completed++;
      showStatus(`フィードを取得中… (${completed}/${dueFeeds.length})`, completed / dueFeeds.length);
    }
  }
  if (dueFeeds.length > 0) {
    showStatus(`フィードを取得中… (0/${dueFeeds.length})`, 0);
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, dueFeeds.length) }, fetchWorker));
  }
  hideStatus();
  await loadAppData();
  // Restore anything auto-paused last run before re-deriving both rules
  // fresh (feeds paused without userManagedPause could only have come from
  // autoPauseDuplicateFeeds or autoPauseInactiveFeeds below, never from the
  // user directly toggling pause) — otherwise a feed whose content has
  // since diverged from its old duplicate cluster, or picked up some
  // engagement, would stay paused forever instead of picking back up.
  await restorePreviouslyAutoPausedFeeds();
  await autoPauseDuplicateFeeds();
  await autoPauseInactiveFeeds();
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

// Guards the single-letter shortcuts below (j/k/o/u, and Enter as an alias
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
// rows in document order — works the same whether the list is flat
// (search) or grouped into per-feed blocks (browsing), since a block is
// just a nested <ul> and querySelectorAll still walks it in the order it
// appears on screen.
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

// "o"/Enter — opens whichever row j/k (or Up/Down) last landed on, the
// same way actually clicking it does (a real <a target="_blank">, already
// wired to log the open and advance read state — see articleList.js's
// buildArticleItem).
function openFocusedArticleLink() {
  articleListEl.querySelector(".mobile-article-row.keyboard-focused")?.click();
}

function focusSearchInput() {
  searchInputEl.focus();
  searchInputEl.select();
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
    // ArrowLeft/ArrowRight have no meaning in the view screen — there's no
    // second pane to move focus to any more.
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
  wireKeyboardNav();
  articleListEl.addEventListener("scroll", handleArticleListScrollBottom, { passive: true });
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
          state.unreadTimelineSnapshot = null; // re-derive the home timeline under the new filter
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
  // NGワード/シード — closes itself once either item inside is actually
  // clicked (each opens its own modal via setupNgWordModal/setupSeedModal
  // above, unaffected by this) or on any click elsewhere on the page.
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

async function startApp() {
  appRoot.classList.remove("hidden");
  wireApp();
  startClockWatermark();
  startViewTimeTracking({
    onLocked: () => viewLimitOverlayEl.classList.remove("hidden"),
    onUnlocked: () => viewLimitOverlayEl.classList.add("hidden"),
  });
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
