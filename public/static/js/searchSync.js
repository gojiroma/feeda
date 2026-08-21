import { encryptJson, decryptJson } from "./crypto.js";
import { getAllSearchHistoryEntries, getSearchHistoryEntry, putSearchHistoryEntry, getMeta, setMeta } from "./db.js";
import { getSession } from "./session.js";

// Same push/pull-by-cursor protocol as sync.js/logSync.js, against a
// separate search-sync endpoint/table — see backend/routes/search_sync.py.
const CURSOR_KEY = "searchSyncCursor";

function apiUrl(path) {
  const { apiBase } = getSession();
  return `${apiBase}${path}`;
}

function authHeaders() {
  const { accountId } = getSession();
  return { Authorization: `Bearer ${accountId}` };
}

function entryToPayload(entry) {
  return { query: entry.query, lastUsedAt: entry.lastUsedAt };
}

export async function pushDirtySearchHistory() {
  const { encKey } = getSession();
  const entries = await getAllSearchHistoryEntries();
  const dirtyEntries = entries.filter((e) => e.dirty);
  if (dirtyEntries.length === 0) return;

  const rows = await Promise.all(
    dirtyEntries.map(async (entry) => ({
      searchId: entry.searchId,
      ciphertext: await encryptJson(encKey, entryToPayload(entry)),
      clientUpdatedAt: entry.clientUpdatedAt,
    }))
  );

  const res = await fetch(apiUrl("/api/search-sync"), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`search sync push failed: ${res.status}`);
  const result = await res.json();

  for (const entry of dirtyEntries) {
    if (result.applied.includes(entry.searchId)) {
      await putSearchHistoryEntry({ ...entry, dirty: false });
    }
    // skipped rows mean the server already had a newer version (e.g. the
    // same query searched again on another device); the next pull
    // reconciles it.
  }
}

export async function pullSearchHistoryUpdates() {
  const { encKey } = getSession();
  const since = await getMeta(CURSOR_KEY);
  const url = since ? `${apiUrl("/api/search-sync")}?since=${encodeURIComponent(since)}` : apiUrl("/api/search-sync");

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`search sync pull failed: ${res.status}`);
  const { rows, serverTime } = await res.json();

  for (const row of rows) {
    const payload = await decryptJson(encKey, row.ciphertext);
    const existing = await getSearchHistoryEntry(payload.query);

    if (existing && existing.dirty && existing.clientUpdatedAt > row.clientUpdatedAt) {
      continue; // unpushed local change is newer; keep it, it'll be pushed later
    }

    await putSearchHistoryEntry({
      query: payload.query,
      lastUsedAt: payload.lastUsedAt,
      searchId: row.searchId,
      clientUpdatedAt: row.clientUpdatedAt,
      dirty: false,
    });
  }

  await setMeta(CURSOR_KEY, serverTime);
}

export async function syncSearchHistoryNow() {
  await pushDirtySearchHistory();
  await pullSearchHistoryUpdates();
}
