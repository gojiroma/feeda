import { putLogEntry, getLogEntry, getLogEntriesInRange } from "./db.js";

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

// Called from openEntry (main.js) — the single choke point every layout
// (desktop click, tablet/phone tap, keyboard nav) already funnels article
// opens through for read-state tracking, so hooking the log here keeps its
// granularity consistent with what "read" already means in this app.
export async function recordOpen(entry, feed) {
  const now = new Date().toISOString();
  const logEntry = {
    id: crypto.randomUUID(),
    feedId: feed ? feed.feedId : entry.feedId || null,
    feedTitle: feed ? feed.title || feed.url : "",
    entryId: entry.id,
    title: entry.title || "(タイトルなし)",
    url: entry.link || "",
    openedAt: now,
    comments: [],
    clientUpdatedAt: now,
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

export async function getEntriesForDay(dateStr) {
  const [start, end] = dayRangeIso(dateStr);
  const entries = await getLogEntriesInRange(start, end);
  entries.sort((a, b) => (a.openedAt || "").localeCompare(b.openedAt || ""));
  return entries;
}
