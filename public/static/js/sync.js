import { encryptJson, decryptJson } from "./crypto.js";
import { getAllFeeds, putFeed, getMeta, setMeta } from "./db.js";
import { getSession } from "./session.js";

const CURSOR_KEY = "syncCursor";

function apiUrl(path) {
  const { apiBase } = getSession();
  return `${apiBase}${path}`;
}

function authHeaders() {
  const { accountId } = getSession();
  return { Authorization: `Bearer ${accountId}` };
}

function feedToPayload(feed) {
  return {
    url: feed.url,
    title: feed.title,
    addedAt: feed.addedAt,
    readUntil: feed.readUntil,
    contentHash: feed.contentHash || null,
    deletedAt: feed.deletedAt || null,
  };
}

export async function pushDirtyFeeds() {
  const { encKey } = getSession();
  const feeds = await getAllFeeds();
  const dirtyFeeds = feeds.filter((f) => f.dirty);
  if (dirtyFeeds.length === 0) return;

  const rows = await Promise.all(
    dirtyFeeds.map(async (feed) => ({
      feedId: feed.feedId,
      ciphertext: await encryptJson(encKey, feedToPayload(feed)),
      clientUpdatedAt: feed.clientUpdatedAt,
    }))
  );

  const res = await fetch(apiUrl("/api/sync"), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`sync push failed: ${res.status}`);
  const result = await res.json();

  for (const feed of dirtyFeeds) {
    if (result.applied.includes(feed.feedId)) {
      await putFeed({ ...feed, dirty: false });
    }
    // skipped rows mean the server already had a newer version; the next
    // pull will reconcile local state with it.
  }
}

export async function pullUpdates() {
  const { encKey } = getSession();
  const since = await getMeta(CURSOR_KEY);
  const url = since ? `${apiUrl("/api/sync")}?since=${encodeURIComponent(since)}` : apiUrl("/api/sync");

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`sync pull failed: ${res.status}`);
  const { rows, serverTime } = await res.json();

  for (const row of rows) {
    const payload = await decryptJson(encKey, row.ciphertext);
    const existing = await getExistingFeed(row.feedId);

    if (existing && existing.dirty && existing.clientUpdatedAt > row.clientUpdatedAt) {
      continue; // unpushed local change is newer; keep it, it'll be pushed later
    }

    await putFeed({
      feedId: row.feedId,
      url: payload.url,
      title: payload.title,
      addedAt: payload.addedAt,
      readUntil: payload.readUntil,
      contentHash: payload.contentHash || null,
      deletedAt: payload.deletedAt || null,
      clientUpdatedAt: row.clientUpdatedAt,
      dirty: false,
      lastFetchedAt: existing ? existing.lastFetchedAt : null,
      etag: existing ? existing.etag : null,
      lastModified: existing ? existing.lastModified : null,
      latestContentHash: existing ? existing.latestContentHash : null,
    });
  }

  await setMeta(CURSOR_KEY, serverTime);
}

async function getExistingFeed(feedId) {
  const feeds = await getAllFeeds();
  return feeds.find((f) => f.feedId === feedId) || null;
}

export async function syncNow() {
  await pushDirtyFeeds();
  await pullUpdates();
}

export async function markFeedDirty(feed) {
  await putFeed({ ...feed, clientUpdatedAt: new Date().toISOString(), dirty: true });
}
