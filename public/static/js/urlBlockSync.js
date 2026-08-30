import { encryptJson, decryptJson } from "./crypto.js";
import { getAllUrlBlocks, getUrlBlock, putUrlBlock, getMeta, setMeta } from "./db.js";
import { getSession } from "./session.js";
import { serialized } from "./syncGuard.js";

// Same push/pull-by-cursor protocol as ngWordSync.js, against a separate
// url-block-sync endpoint/table — see backend/routes/url_block_sync.py.
const CURSOR_KEY = "urlBlockSyncCursor";

function apiUrl(path) {
  const { apiBase } = getSession();
  return `${apiBase}${path}`;
}

function authHeaders() {
  const { accountId } = getSession();
  return { Authorization: `Bearer ${accountId}` };
}

function entryToPayload(entry) {
  return { pattern: entry.pattern, createdAt: entry.createdAt, deletedAt: entry.deletedAt || null };
}

export async function pushDirtyUrlBlocks() {
  const { encKey } = getSession();
  const entries = await getAllUrlBlocks();
  const dirtyEntries = entries.filter((e) => e.dirty);
  if (dirtyEntries.length === 0) return;

  const rows = await Promise.all(
    dirtyEntries.map(async (entry) => ({
      urlBlockId: entry.urlBlockId,
      ciphertext: await encryptJson(encKey, entryToPayload(entry)),
      clientUpdatedAt: entry.clientUpdatedAt,
    }))
  );

  const res = await fetch(apiUrl("/api/url-block-sync"), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`url block sync push failed: ${res.status}`);
  const result = await res.json();

  for (const entry of dirtyEntries) {
    if (result.applied.includes(entry.urlBlockId)) {
      // See sync.js's pushDirtyFeeds for why this re-reads the current row
      // instead of trusting the pre-fetch `entry` snapshot.
      const current = await getUrlBlock(entry.pattern);
      if (current && current.clientUpdatedAt === entry.clientUpdatedAt) {
        await putUrlBlock({ ...current, dirty: false });
      }
    }
    // skipped rows mean the server already had a newer version; the next
    // pull reconciles it.
  }
}

export async function pullUrlBlockUpdates() {
  const { encKey } = getSession();
  const since = await getMeta(CURSOR_KEY);
  const url = since ? `${apiUrl("/api/url-block-sync")}?since=${encodeURIComponent(since)}` : apiUrl("/api/url-block-sync");

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`url block sync pull failed: ${res.status}`);
  const { rows, serverTime } = await res.json();

  for (const row of rows) {
    const payload = await decryptJson(encKey, row.ciphertext);
    const existing = await getUrlBlock(payload.pattern);

    if (existing && existing.dirty && existing.clientUpdatedAt > row.clientUpdatedAt) {
      continue; // unpushed local change is newer; keep it, it'll be pushed later
    }

    await putUrlBlock({
      pattern: payload.pattern,
      createdAt: payload.createdAt,
      deletedAt: payload.deletedAt || null,
      urlBlockId: row.urlBlockId,
      clientUpdatedAt: row.clientUpdatedAt,
      dirty: false,
    });
  }

  await setMeta(CURSOR_KEY, serverTime);
}

// Wrapped in serialized() so overlapping callers (see syncGuard.js) never
// run two push+pull cycles at once.
export const syncUrlBlockNow = serialized(async function syncUrlBlockNow() {
  await pushDirtyUrlBlocks();
  await pullUrlBlockUpdates();
});
