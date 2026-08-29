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
    readUntil: feed.readUntil,
    contentHash: feed.contentHash || null,
    frequencyGroup: feed.frequencyGroup || null,
    paused: feed.paused || false,
    // Set once the user has ever manually toggled pause on this feed (via
    // right-click/long-press) — synced so the auto-dedupe-by-host cleanup
    // (see main.js) never fights a deliberate un-pause on another device.
    userManagedPause: feed.userManagedPause || false,
    // Context-menu color tag (see colorPalette.js) — a palette key or null.
    color: feed.color || null,
    // Pulled to the top of the article list's unread timeline regardless of
    // read state, staleness, or pause (see main.js's togglePinFeed).
    pinned: feed.pinned || false,
    // Free-text tags — no UI writes these any more (removed along with the
    // sidebar's tag editor), but the field stays synced so a device that
    // still has some from before keeps seeing them round-trip correctly.
    tags: feed.tags || [],
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
      // row overall, so the rest of it is skipped and will win on the next
      // push — but readUntil is monotonic (see laterIso in db.js), so still
      // pull it forward if the remote side has read further than we have.
      // Otherwise this device's own next push would carry its stale
      // readUntil back over another device's more-advanced one.
      if (payload.readUntil && payload.readUntil !== existing.readUntil) {
        await putFeed({ ...existing, readUntil: payload.readUntil });
      }
      continue;
    }

    await putFeed({
      feedId: row.feedId,
      url: payload.url,
      title: payload.title,
      addedAt: payload.addedAt,
      readUntil: payload.readUntil,
      contentHash: payload.contentHash || null,
      frequencyGroup: payload.frequencyGroup || null,
      paused: payload.paused || false,
      userManagedPause: payload.userManagedPause || false,
      color: payload.color || null,
      pinned: payload.pinned || false,
      tags: payload.tags || [],
      deletedAt: payload.deletedAt || null,
      clientUpdatedAt: row.clientUpdatedAt,
      dirty: false,
      lastFetchedAt: existing ? existing.lastFetchedAt : null,
      etag: existing ? existing.etag : null,
      lastModified: existing ? existing.lastModified : null,
      latestContentHash: existing ? existing.latestContentHash : null,
      nextCheckAt: existing ? existing.nextCheckAt : null,
    });
  }

  await setMeta(CURSOR_KEY, serverTime);
}

async function getExistingFeed(feedId) {
  const feeds = await getAllFeeds();
  return feeds.find((f) => f.feedId === feedId) || null;
}

// Pull before push (unlike log/search sync, which push first) — this way a
// feed touched locally for an unrelated reason (color/pause) picks up any
// more-advanced readUntil another device already pushed *before* this
// device's own dirty row goes out, instead of overwriting it. See
// pullUpdates' readUntil merge above for the other half of this.
// Wrapped in serialized() so overlapping callers (see syncGuard.js) never
// run two pull+push cycles at once.
export const syncNow = serialized(async function syncNow() {
  await pullUpdates();
  await pushDirtyFeeds();
});

export async function markFeedDirty(feed) {
  await putFeed({ ...feed, clientUpdatedAt: new Date().toISOString(), dirty: true });
}
