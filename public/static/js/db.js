const DB_NAME = "feeda";
const DB_VERSION = 1;

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
