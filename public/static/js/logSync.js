import { encryptJson, decryptJson } from "./crypto.js";
import { getAllLogEntries, putLogEntry, getMeta, setMeta } from "./db.js";
import { getSession } from "./session.js";

// Same push/pull-by-cursor protocol as sync.js, against a separate
// log-sync endpoint/table — see backend/routes/log_sync.py for why a log
// entry isn't just another feed_rows row.
const CURSOR_KEY = "logSyncCursor";

function apiUrl(path) {
  const { apiBase } = getSession();
  return `${apiBase}${path}`;
}

function authHeaders() {
  const { accountId } = getSession();
  return { Authorization: `Bearer ${accountId}` };
}

function logEntryToPayload(logEntry) {
  return {
    feedId: logEntry.feedId,
    feedTitle: logEntry.feedTitle,
    entryId: logEntry.entryId,
    title: logEntry.title,
    url: logEntry.url,
    openedAt: logEntry.openedAt,
    comments: logEntry.comments || [],
  };
}

export async function pushDirtyLogEntries() {
  const { encKey } = getSession();
  const logEntries = await getAllLogEntries();
  const dirtyEntries = logEntries.filter((e) => e.dirty);
  if (dirtyEntries.length === 0) return;

  const rows = await Promise.all(
    dirtyEntries.map(async (entry) => ({
      logId: entry.id,
      ciphertext: await encryptJson(encKey, logEntryToPayload(entry)),
      clientUpdatedAt: entry.clientUpdatedAt,
    }))
  );

  const res = await fetch(apiUrl("/api/log-sync"), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`log sync push failed: ${res.status}`);
  const result = await res.json();

  for (const entry of dirtyEntries) {
    if (result.applied.includes(entry.id)) {
      await putLogEntry({ ...entry, dirty: false });
    }
    // skipped rows mean the server already had a newer version (e.g. a
    // comment added on another device); the next pull reconciles it.
  }
}

export async function pullLogUpdates() {
  const { encKey } = getSession();
  const since = await getMeta(CURSOR_KEY);
  const url = since ? `${apiUrl("/api/log-sync")}?since=${encodeURIComponent(since)}` : apiUrl("/api/log-sync");

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`log sync pull failed: ${res.status}`);
  const { rows, serverTime } = await res.json();

  for (const row of rows) {
    const payload = await decryptJson(encKey, row.ciphertext);
    const existing = await getExistingLogEntry(row.logId);

    if (existing && existing.dirty && existing.clientUpdatedAt > row.clientUpdatedAt) {
      continue; // unpushed local change is newer; keep it, it'll be pushed later
    }

    await putLogEntry({
      id: row.logId,
      feedId: payload.feedId,
      feedTitle: payload.feedTitle,
      entryId: payload.entryId,
      title: payload.title,
      url: payload.url,
      openedAt: payload.openedAt,
      comments: payload.comments || [],
      clientUpdatedAt: row.clientUpdatedAt,
      dirty: false,
    });
  }

  await setMeta(CURSOR_KEY, serverTime);
}

async function getExistingLogEntry(logId) {
  const entries = await getAllLogEntries();
  return entries.find((e) => e.id === logId) || null;
}

export async function syncLogNow() {
  await pushDirtyLogEntries();
  await pullLogUpdates();
}
