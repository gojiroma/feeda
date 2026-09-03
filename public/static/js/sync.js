import { encryptJson, decryptJson } from "./crypto.js";
import { getAllFeeds, getFeed, putFeed, getMeta, setMeta } from "./db.js";
import { getSession } from "./session.js";
import { serialized } from "./syncGuard.js";

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
    paused: feed.paused || false,
    // Context-menu color tag (see colorPalette.js) — a palette key or null.
    color: feed.color || null,
    // Pulled to the top of the feed list regardless of staleness or pause
    // (see main.js's togglePinFeed).
    pinned: feed.pinned || false,
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
      // Re-read the current row rather than trusting the pre-fetch `feed`
      // snapshot: if the user edited this feed again while the push was in
      // flight, that edit has a newer clientUpdatedAt and dirty:true, and
      // blindly writing back the stale snapshot with dirty:false would
      // silently discard it (it would look already-synced and never get
      // pushed). Only clear dirty if nothing changed since this row's
      // snapshot was taken.
      const current = await getFeed(feed.feedId);
      if (current && current.clientUpdatedAt === feed.clientUpdatedAt) {
        await putFeed({ ...current, dirty: false });
      }
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
      // unpushed local change (e.g. a color/pause edit) is newer than this
      // row overall, so it's skipped and will win on the next push.
      continue;
    }

    await putFeed({
      feedId: row.feedId,
      url: payload.url,
      title: payload.title,
      addedAt: payload.addedAt,
      paused: payload.paused || false,
      color: payload.color || null,
      pinned: payload.pinned || false,
      deletedAt: payload.deletedAt || null,
      clientUpdatedAt: row.clientUpdatedAt,
      dirty: false,
      lastFetchedAt: existing ? existing.lastFetchedAt : null,
      etag: existing ? existing.etag : null,
      lastModified: existing ? existing.lastModified : null,
    });
  }

  await setMeta(CURSOR_KEY, serverTime);
}

async function getExistingFeed(feedId) {
  const feeds = await getAllFeeds();
  return feeds.find((f) => f.feedId === feedId) || null;
}

// Wrapped in serialized() so overlapping callers (see syncGuard.js) never
// run two pull+push cycles at once.
export const syncNow = serialized(async function syncNow() {
  await pullUpdates();
  await pushDirtyFeeds();
});

export async function markFeedDirty(feed) {
  await putFeed({ ...feed, clientUpdatedAt: new Date().toISOString(), dirty: true });
}
