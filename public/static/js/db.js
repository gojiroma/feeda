import { deriveSearchId } from "./crypto.js";
import { getSession } from "./session.js";

const DB_NAME = "feeda";
const DB_VERSION = 6;

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("feeds")) {
        db.createObjectStore("feeds", { keyPath: "feedId" });
      }
      if (!db.objectStoreNames.contains("entries")) {
        const entries = db.createObjectStore("entries", { keyPath: "id" });
        entries.createIndex("feedId", "feedId", { unique: false });
        entries.createIndex("pubDate", "pubDate", { unique: false });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
      // Reading-activity log: one row per article open, with its comment
      // thread nested inside (see logbook.js). Separate from "entries"
      // (the feed-content cache, which gets pruned/refetched) since this is
      // a permanent history the user builds up deliberately.
      if (!db.objectStoreNames.contains("logEntries")) {
        const logEntries = db.createObjectStore("logEntries", { keyPath: "id" });
        logEntries.createIndex("openedAt", "openedAt", { unique: false });
        logEntries.createIndex("feedId", "feedId", { unique: false });
        logEntries.createIndex("entryId", "entryId", { unique: false });
      }
      // v2 -> v3: entryId index added after logEntries already existed for
      // some users — createObjectStore only runs above for a brand-new
      // store, so upgrading installs need it added separately.
      const logStore = req.transaction.objectStore("logEntries");
      if (!logStore.indexNames.contains("entryId")) {
        logStore.createIndex("entryId", "entryId", { unique: false });
      }
      // Main-screen search history (see searchBar.js) — keyed by the
      // search text itself rather than a random id, so recording the same
      // query again is a plain put() that overwrites lastUsedAt in place
      // instead of piling up duplicate rows. Synced across devices (see
      // searchSync.js) the same way feeds/log entries are, via a
      // content-derived searchId (deriveSearchId in crypto.js) rather than
      // the query text itself, since the query is what gets encrypted.
      if (!db.objectStoreNames.contains("searchHistory")) {
        const searchHistory = db.createObjectStore("searchHistory", { keyPath: "query" });
        searchHistory.createIndex("lastUsedAt", "lastUsedAt", { unique: false });
      }
      // Blocklist keywords (see ngWords.js) — an article whose title contains
      // one hides from the article list. Keyed by the word text itself, same
      // as searchHistory, and synced the same way (ngWordSync.js) via a
      // content-derived ngWordId (deriveNgWordId in crypto.js) rather than
      // the word itself. deletedAt is a soft-delete tombstone (like feeds'
      // own — see sync.js) since the sync protocol only ever upserts.
      if (!db.objectStoreNames.contains("ngWords")) {
        db.createObjectStore("ngWords", { keyPath: "word" });
      }
      // "刈り取り" (reap) URL blocklist (see urlBlocks.js) — a feed entry
      // whose link matches one of these wildcard patterns is dropped before
      // it's ever stored (see feedFetch.js), and any already-stored match is
      // hidden the same way an NG-worded title is (see filterByUrlBlocks in
      // main.js). Keyed by the pattern text itself and synced the same way
      // ngWords is (urlBlockSync.js), via a content-derived urlBlockId
      // (deriveUrlBlockId in crypto.js).
      if (!db.objectStoreNames.contains("urlBlocks")) {
        db.createObjectStore("urlBlocks", { keyPath: "pattern" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, storeNames, mode) {
  return db.transaction(storeNames, mode);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putFeed(feed) {
  const db = await openDb();
  const t = tx(db, "feeds", "readwrite");
  t.objectStore("feeds").put(feed);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getFeed(feedId) {
  const db = await openDb();
  return reqToPromise(tx(db, "feeds", "readonly").objectStore("feeds").get(feedId));
}

export async function getAllFeeds() {
  const db = await openDb();
  return reqToPromise(tx(db, "feeds", "readonly").objectStore("feeds").getAll());
}

export async function deleteFeed(feedId) {
  const db = await openDb();
  const t = tx(db, ["feeds", "entries"], "readwrite");
  t.objectStore("feeds").delete(feedId);
  const entryIndex = t.objectStore("entries").index("feedId");
  const range = IDBKeyRange.only(feedId);
  entryIndex.openCursor(range).onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function putEntries(entries) {
  if (entries.length === 0) return;
  const db = await openDb();
  const t = tx(db, "entries", "readwrite");
  const store = t.objectStore("entries");
  for (const entry of entries) store.put(entry);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getEntriesByFeed(feedId) {
  const db = await openDb();
  const index = tx(db, "entries", "readonly").objectStore("entries").index("feedId");
  return reqToPromise(index.getAll(IDBKeyRange.only(feedId)));
}

export async function getAllEntries() {
  const db = await openDb();
  return reqToPromise(tx(db, "entries", "readonly").objectStore("entries").getAll());
}

export async function putLogEntry(logEntry) {
  const db = await openDb();
  const t = tx(db, "logEntries", "readwrite");
  t.objectStore("logEntries").put(logEntry);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getLogEntry(id) {
  const db = await openDb();
  return reqToPromise(tx(db, "logEntries", "readonly").objectStore("logEntries").get(id));
}

export async function getAllLogEntries() {
  const db = await openDb();
  return reqToPromise(tx(db, "logEntries", "readonly").objectStore("logEntries").getAll());
}

// [startIso, endIso) — half-open, so callers pass a day boundary pair
// without worrying about an entry landing exactly on midnight twice.
export async function getLogEntriesInRange(startIso, endIso) {
  const db = await openDb();
  const index = tx(db, "logEntries", "readonly").objectStore("logEntries").index("openedAt");
  return reqToPromise(index.getAll(IDBKeyRange.bound(startIso, endIso, false, true)));
}

export async function getLogEntriesByEntryId(entryId) {
  const db = await openDb();
  const index = tx(db, "logEntries", "readonly").objectStore("logEntries").index("entryId");
  return reqToPromise(index.getAll(IDBKeyRange.only(entryId)));
}

export async function getMeta(key) {
  const db = await openDb();
  const result = await reqToPromise(tx(db, "meta", "readonly").objectStore("meta").get(key));
  return result ? result.value : undefined;
}

export async function setMeta(key, value) {
  const db = await openDb();
  const t = tx(db, "meta", "readwrite");
  t.objectStore("meta").put({ key, value });
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

const SEARCH_HISTORY_LIMIT = 100;

// put() with the query text itself as the key means searching the same
// thing again overwrites the existing row's lastUsedAt in place rather than
// adding a second one — that's the entire "same word ranks higher" rule
// from getSearchHistory's sort, no separate use-count needed. dirty +
// clientUpdatedAt mark it for searchSync.js to push, same as feeds/logs.
export async function recordSearchHistory(query) {
  const trimmed = query.trim();
  if (!trimmed) return;
  const { seed } = getSession();
  const searchId = await deriveSearchId(seed, trimmed);
  await putSearchHistoryEntry({
    query: trimmed,
    lastUsedAt: new Date().toISOString(),
    searchId,
    clientUpdatedAt: new Date().toISOString(),
    dirty: true,
  });
}

export async function putSearchHistoryEntry(entry) {
  const db = await openDb();
  const t = tx(db, "searchHistory", "readwrite");
  t.objectStore("searchHistory").put(entry);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getSearchHistoryEntry(query) {
  const db = await openDb();
  return reqToPromise(tx(db, "searchHistory", "readonly").objectStore("searchHistory").get(query));
}

export async function getAllSearchHistoryEntries() {
  const db = await openDb();
  return reqToPromise(tx(db, "searchHistory", "readonly").objectStore("searchHistory").getAll());
}

// Most-recently-used first — a query moved to "now" by being searched again
// naturally sorts above ones that haven't, satisfying both halves of the
// ranking rule (repeat search bumps it up; everything else stays in the
// order it was last used) without tracking frequency separately.
export async function getSearchHistory(limit = SEARCH_HISTORY_LIMIT) {
  const all = await getAllSearchHistoryEntries();
  all.sort((a, b) => (b.lastUsedAt || "").localeCompare(a.lastUsedAt || ""));
  return all.slice(0, limit);
}

export async function putNgWord(entry) {
  const db = await openDb();
  const t = tx(db, "ngWords", "readwrite");
  t.objectStore("ngWords").put(entry);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getNgWord(word) {
  const db = await openDb();
  return reqToPromise(tx(db, "ngWords", "readonly").objectStore("ngWords").get(word));
}

export async function getAllNgWords() {
  const db = await openDb();
  return reqToPromise(tx(db, "ngWords", "readonly").objectStore("ngWords").getAll());
}

export async function putUrlBlock(entry) {
  const db = await openDb();
  const t = tx(db, "urlBlocks", "readwrite");
  t.objectStore("urlBlocks").put(entry);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getUrlBlock(pattern) {
  const db = await openDb();
  return reqToPromise(tx(db, "urlBlocks", "readonly").objectStore("urlBlocks").get(pattern));
}

export async function getAllUrlBlocks() {
  const db = await openDb();
  return reqToPromise(tx(db, "urlBlocks", "readonly").objectStore("urlBlocks").getAll());
}
