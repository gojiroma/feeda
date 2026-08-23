import { encryptJson, decryptJson } from "./crypto.js";
import { getAllNgWords, getNgWord, putNgWord, getMeta, setMeta } from "./db.js";
import { getSession } from "./session.js";

// Same push/pull-by-cursor protocol as sync.js/searchSync.js, against a
// separate ng-word-sync endpoint/table — see backend/routes/ng_word_sync.py.
const CURSOR_KEY = "ngWordSyncCursor";

function apiUrl(path) {
  const { apiBase } = getSession();
  return `${apiBase}${path}`;
}

function authHeaders() {
  const { accountId } = getSession();
  return { Authorization: `Bearer ${accountId}` };
}

function entryToPayload(entry) {
  return { word: entry.word, createdAt: entry.createdAt, deletedAt: entry.deletedAt || null };
}

export async function pushDirtyNgWords() {
  const { encKey } = getSession();
  const entries = await getAllNgWords();
  const dirtyEntries = entries.filter((e) => e.dirty);
  if (dirtyEntries.length === 0) return;

  const rows = await Promise.all(
    dirtyEntries.map(async (entry) => ({
      ngWordId: entry.ngWordId,
      ciphertext: await encryptJson(encKey, entryToPayload(entry)),
      clientUpdatedAt: entry.clientUpdatedAt,
    }))
  );

  const res = await fetch(apiUrl("/api/ng-word-sync"), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`ng word sync push failed: ${res.status}`);
  const result = await res.json();

  for (const entry of dirtyEntries) {
    if (result.applied.includes(entry.ngWordId)) {
      await putNgWord({ ...entry, dirty: false });
    }
    // skipped rows mean the server already had a newer version; the next
    // pull reconciles it.
  }
}

export async function pullNgWordUpdates() {
  const { encKey } = getSession();
  const since = await getMeta(CURSOR_KEY);
  const url = since ? `${apiUrl("/api/ng-word-sync")}?since=${encodeURIComponent(since)}` : apiUrl("/api/ng-word-sync");

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`ng word sync pull failed: ${res.status}`);
  const { rows, serverTime } = await res.json();

  for (const row of rows) {
    const payload = await decryptJson(encKey, row.ciphertext);
    const existing = await getNgWord(payload.word);

    if (existing && existing.dirty && existing.clientUpdatedAt > row.clientUpdatedAt) {
      continue; // unpushed local change is newer; keep it, it'll be pushed later
    }

    await putNgWord({
      word: payload.word,
      createdAt: payload.createdAt,
      deletedAt: payload.deletedAt || null,
      ngWordId: row.ngWordId,
      clientUpdatedAt: row.clientUpdatedAt,
      dirty: false,
    });
  }

  await setMeta(CURSOR_KEY, serverTime);
}

export async function syncNgWordsNow() {
  await pushDirtyNgWords();
  await pullNgWordUpdates();
}
