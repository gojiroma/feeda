import { putLogEntry, getLogEntry, getLogEntriesInRange, getLogEntriesByEntryId, getAllLogEntries } from "./db.js";

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
    const recent = await getLogEntriesByEntryId(entry.id);
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

export async function getEntriesForDay(dateStr) {
  const [start, end] = dayRangeIso(dateStr);
  const entries = await getLogEntriesInRange(start, end);
  // mergeDuplicates expects oldest-first (it walks adjacent pairs forward
  // in time), so the ascending sort stays internal — reverse only the
  // final, already-merged result to show the day newest-first.
  entries.sort((a, b) => (a.openedAt || "").localeCompare(b.openedAt || ""));
  return mergeDuplicates(entries).reverse();
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
  const all = await getAllLogEntries();
  all.sort((a, b) => (a.openedAt || "").localeCompare(b.openedAt || ""));
  const merged = mergeDuplicates(all);
  const matched = merged.filter((e) => matchesLogEntry(q, e));
  matched.sort((a, b) => (b.openedAt || "").localeCompare(a.openedAt || ""));
  return matched.slice(0, SEARCH_RESULT_LIMIT);
}
