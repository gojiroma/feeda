import { putLogEntry, getLogEntry, getLogEntriesInRange, getLogEntriesByEntryId, getAllLogEntries, getAllFeeds } from "./db.js";

export function dateStrOf(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shiftDateStr(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return dateStrOf(d);
}

// Local calendar-day boundaries, converted to UTC ISO for the openedAt
// index range query — openedAt is stored as toISOString() (UTC), but the
// user thinks in terms of their local day.
function dayRangeIso(dateStr) {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return [start.toISOString(), end.toISOString()];
}

// How close together two opens of the *same* article have to be to count as
// one chattering burst (rapid re-clicks, arrow-key skimming back over it,
// hover/selection quirks) rather than a deliberate separate re-read later.
const CHATTER_WINDOW_MS = 5 * 60 * 1000;

// Called from openEntry (main.js) — the single choke point every layout
// (desktop click, tablet/phone tap, keyboard nav) already funnels article
// opens through for read-state tracking, so hooking the log here keeps its
// granularity consistent with what "read" already means in this app.
// Returns null (and logs nothing new) when this same article was already
// logged within CHATTER_WINDOW_MS — the source-side half of the duplicate
// fix; see mergeDuplicates below for cleaning up rows logged before this
// guard existed.
export async function recordOpen(entry, feed) {
  const now = new Date();
  if (entry.id) {
    const nowMs = now.getTime();
    // Excludes a reaped (deletedAt) row — the whole point of reaping one is
    // that opening this article again should log it afresh, not get
    // silently swallowed by the chatter guard because a just-deleted row
    // happens to still be within CHATTER_WINDOW_MS.
    const recent = (await getLogEntriesByEntryId(entry.id)).filter((e) => !e.deletedAt);
    if (recent.some((e) => nowMs - new Date(e.openedAt).getTime() <= CHATTER_WINDOW_MS)) {
      return null;
    }
  }
  const nowIso = now.toISOString();
  const logEntry = {
    id: crypto.randomUUID(),
    feedId: feed ? feed.feedId : entry.feedId || null,
    feedTitle: feed ? feed.title || feed.url : "",
    entryId: entry.id,
    title: entry.title || "(タイトルなし)",
    url: entry.link || "",
    openedAt: nowIso,
    comments: [],
    clientUpdatedAt: nowIso,
    dirty: true,
  };
  await putLogEntry(logEntry);
  return logEntry;
}

export async function addComment(logId, text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const logEntry = await getLogEntry(logId);
  if (!logEntry) return null;
  const comment = { id: crypto.randomUUID(), text: trimmed, createdAt: new Date().toISOString() };
  const updated = {
    ...logEntry,
    comments: [...(logEntry.comments || []), comment],
    clientUpdatedAt: new Date().toISOString(),
    dirty: true,
  };
  await putLogEntry(updated);
  return updated;
}

// color is one of reflect.js's COLOR_PALETTE keys, or null/undefined to
// clear it. Synced like everything else on a log entry (see logSync.js).
export async function setLogEntryColor(logId, color) {
  const logEntry = await getLogEntry(logId);
  if (!logEntry) return null;
  const updated = {
    ...logEntry,
    color: color || null,
    clientUpdatedAt: new Date().toISOString(),
    dirty: true,
  };
  await putLogEntry(updated);
  return updated;
}

// "刈り取り" (reap) — the reflect screen's own per-entry delete (see
// reflect.js's 🗑️/🚫 buttons). A tombstone (like feeds'/ngWords' own
// deletedAt) rather than an actual IndexedDB delete, since the sync
// protocol only ever upserts a row, never removes one — every reader below
// (getEntriesForDay, searchLogEntries, ...) filters deletedAt rows out.
export async function removeLogEntry(logId) {
  const logEntry = await getLogEntry(logId);
  if (!logEntry) return null;
  const now = new Date().toISOString();
  const updated = { ...logEntry, deletedAt: now, clientUpdatedAt: now, dirty: true };
  await putLogEntry(updated);
  return updated;
}

// Display-time merge for duplicate rows logged before the chatter guard
// above existed (or from any other source of near-simultaneous re-opens):
// collapses runs of same-article rows within CHATTER_WINDOW_MS of each
// other into one, combining their comments. Non-destructive — it only
// merges the list handed back to callers, never touches IndexedDB or the
// sync'd rows, so there's no risk of losing a comment that lives on a
// duplicate row. Expects entries already sorted oldest-first.
//
// "Same article" is entryId equality OR url equality (checked separately
// since a row can have one without the other): the Tampermonkey userscript's
// auto-log feature (see userscript/feeda-autoregister.user.js) logs pages
// you read directly, with no feed entryId to key off of, so a page opened
// from within feeda (logged immediately via recordOpen, entryId set) and
// then auto-logged again seconds later by the script once its own tab
// finishes loading (entryId null, same url) would otherwise show as two
// separate rows despite being the same read.
function mergeDuplicates(entriesAscending) {
  const result = [];
  for (const entry of entriesAscending) {
    const prev = result[result.length - 1];
    const sameArticle =
      prev && ((entry.entryId && prev.entryId === entry.entryId) || (entry.url && prev.url === entry.url));
    if (sameArticle && new Date(entry.openedAt).getTime() - new Date(prev.openedAt).getTime() <= CHATTER_WINDOW_MS) {
      const mergedComments = [...(prev.comments || []), ...(entry.comments || [])].sort((a, b) =>
        (a.createdAt || "").localeCompare(b.createdAt || "")
      );
      result[result.length - 1] = { ...prev, comments: mergedComments };
      continue;
    }
    result.push(entry);
  }
  return result;
}

// removeLogEntry above tombstones rather than deletes, so every reader here
// filters deletedAt rows back out itself.
function excludeDeleted(entries) {
  return entries.filter((e) => !e.deletedAt);
}

export async function getEntriesForDay(dateStr) {
  const [start, end] = dayRangeIso(dateStr);
  const entries = excludeDeleted(await getLogEntriesInRange(start, end));
  // mergeDuplicates expects oldest-first (it walks adjacent pairs forward
  // in time), so the ascending sort stays internal — reverse only the
  // final, already-merged result to show the day newest-first.
  entries.sort((a, b) => (a.openedAt || "").localeCompare(b.openedAt || ""));
  return mergeDuplicates(entries).reverse();
}

// Per-day record counts for the `days` calendar days ending today (local),
// oldest first — feeds the day-nav's trend bar chart (see renderDayChart in
// ui/reflect.js). Runs the same chatter-merge as getEntriesForDay so the
// bar heights agree with what the timeline itself would show for that day,
// rather than counting duplicate near-simultaneous opens as separate reads.
export async function getDailyCounts(days) {
  const today = dateStrOf();
  const startDate = shiftDateStr(today, -(days - 1));
  const [start] = dayRangeIso(startDate);
  const [, end] = dayRangeIso(today);
  const entries = excludeDeleted(await getLogEntriesInRange(start, end));
  entries.sort((a, b) => (a.openedAt || "").localeCompare(b.openedAt || ""));
  const merged = mergeDuplicates(entries);

  const counts = new Map();
  for (let i = 0; i < days; i++) counts.set(shiftDateStr(startDate, i), 0);
  for (const entry of merged) {
    if (!entry.openedAt) continue;
    const d = dateStrOf(new Date(entry.openedAt));
    if (counts.has(d)) counts.set(d, counts.get(d) + 1);
  }
  return [...counts.entries()].map(([date, count]) => ({ date, count }));
}

// Sibling of getDailyCounts, feeding the day-nav's second trend strip: how
// many feeds got newly subscribed each day (feed.addedAt, set once at
// registration — see userscript/feeda-autoregister.user.js). Unlike reading
// counts there's no retroactive gap to worry about: every feed already
// carries its real addedAt from whenever it was actually added, not just
// from whenever this chart was introduced. Deleted feeds are excluded so a
// since-unsubscribed feed doesn't keep inflating a past day's bar forever.
export async function getFeedAddedCounts(days) {
  const feeds = await getAllFeeds();
  const today = dateStrOf();
  const startDate = shiftDateStr(today, -(days - 1));

  const counts = new Map();
  for (let i = 0; i < days; i++) counts.set(shiftDateStr(startDate, i), 0);
  for (const feed of feeds) {
    if (!feed.addedAt || feed.deletedAt) continue;
    const d = dateStrOf(new Date(feed.addedAt));
    if (counts.has(d)) counts.set(d, counts.get(d) + 1);
  }
  return [...counts.entries()].map(([date, count]) => ({ date, count }));
}

// One log entry per entryId — the most recently opened one — for every
// article ever logged. Used by the article list (see main.js) to show a
// read entry's color tag/comments and to check whether one already exists
// before annotating it, without a per-row IndexedDB lookup for each of
// potentially hundreds of visible articles.
export async function getLatestLogEntriesByEntryId() {
  const all = excludeDeleted(await getAllLogEntries());
  const map = new Map();
  for (const row of all) {
    if (!row.entryId) continue;
    const existing = map.get(row.entryId);
    if (!existing || (row.openedAt || "") > (existing.openedAt || "")) {
      map.set(row.entryId, row);
    }
  }
  return map;
}

// Weights for a feed's engagement score (see getFeedEngagementScores) —
// deliberately increasing with how deliberate the interaction was: just
// having opened an article is the weakest signal, leaving a comment is a
// clear "this mattered enough to say something," and color-tagging (a
// dedicated right-click/long-press, see reflect.js/articleList.js) is the
// most deliberate curation action there is.
const ENGAGEMENT_WEIGHT = { open: 1, comment: 4, color: 6 };

// Cumulative engagement score per feedId, from every log entry ever
// recorded for it — used to sort a feed you've actually read into,
// commented on, or color-tagged ahead of one that's merely posted recently
// (see main.js's currentArticles/unreadFeedOrder).
export async function getFeedEngagementScores() {
  const all = excludeDeleted(await getAllLogEntries());
  const scores = new Map();
  for (const row of all) {
    if (!row.feedId) continue;
    let score = ENGAGEMENT_WEIGHT.open;
    score += (row.comments || []).length * ENGAGEMENT_WEIGHT.comment;
    if (row.color) score += ENGAGEMENT_WEIGHT.color;
    scores.set(row.feedId, (scores.get(row.feedId) || 0) + score);
  }
  return scores;
}

const SEARCH_RESULT_LIMIT = 200;

function normalizeQuery(query) {
  return query.trim().toLowerCase();
}

function matchesLogEntry(query, logEntry) {
  const commentsText = (logEntry.comments || []).map((c) => c.text).join("\n");
  const haystack = `${logEntry.feedTitle || ""}\n${logEntry.title || ""}\n${commentsText}`.toLowerCase();
  return haystack.includes(query);
}

// Searches the whole log (every day), not just the currently-viewed one —
// same reasoning as the "view" screen's search spanning every feed
// regardless of which one is selected: the point of search is to find
// something regardless of where you currently are. Newest-first, since
// unlike the day timeline this isn't meant to read as one day's story.
export async function searchLogEntries(query) {
  const q = normalizeQuery(query);
  if (!q) return [];
  const all = excludeDeleted(await getAllLogEntries());
  all.sort((a, b) => (a.openedAt || "").localeCompare(b.openedAt || ""));
  const merged = mergeDuplicates(all);
  const matched = merged.filter((e) => matchesLogEntry(q, e));
  matched.sort((a, b) => (b.openedAt || "").localeCompare(a.openedAt || ""));
  return matched.slice(0, SEARCH_RESULT_LIMIT);
}
