// "刈り取り" (reap) blocklist — a wildcard URL pattern (see reflect.js's 🚫
// button on a log entry and ui/urlBlockModal.js) that keeps a matching feed
// entry from ever being stored locally again (see feedFetch.js), and hides
// any already-stored match the same way an NG-worded title is (see
// filterByUrlBlocks in main.js). Stored and synced the same way NG words are
// (db.js's urlBlocks store, urlBlockSync.js), just keyed by pattern instead
// of by keyword, with a deletedAt tombstone since a pattern can be removed.
import { putUrlBlock, getUrlBlock, getAllUrlBlocks } from "./db.js";
import { getSession } from "./session.js";
import { deriveUrlBlockId } from "./crypto.js";

export async function addUrlBlockPattern(pattern) {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  const { seed } = getSession();
  const urlBlockId = await deriveUrlBlockId(seed, trimmed);
  const now = new Date().toISOString();
  const entry = {
    pattern: trimmed,
    urlBlockId,
    createdAt: now,
    deletedAt: null,
    clientUpdatedAt: now,
    dirty: true,
  };
  await putUrlBlock(entry);
  return entry;
}

export async function removeUrlBlockPattern(pattern) {
  const existing = await getUrlBlock(pattern);
  if (!existing) return null;
  const now = new Date().toISOString();
  const updated = { ...existing, deletedAt: now, clientUpdatedAt: now, dirty: true };
  await putUrlBlock(updated);
  return updated;
}

export async function getActiveUrlBlockPatterns() {
  const all = await getAllUrlBlocks();
  return all.filter((p) => !p.deletedAt);
}

// pattern's only wildcard is "*" (any run of characters, including none) —
// every other regex-special character is escaped so a literal "?" or "."
// already in a URL (query strings are full of both) doesn't accidentally
// behave like a regex metacharacter.
function patternToRegExp(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? ".*" : `\\${ch}`));
  return new RegExp(`^${escaped}$`);
}

// Case-sensitive whole-URL match against a log/feed entry's link — see
// deriveUrlBlockId's own comment for why case isn't folded here the way
// matchesAnyNgWord folds a title's.
export function matchesAnyUrlBlockPattern(url, patterns) {
  if (!url || patterns.length === 0) return false;
  return patterns.some((pattern) => patternToRegExp(pattern).test(url));
}

// Best-effort starting point for the "delete and block" prompt (see
// reflect.js's openBlockUrlPopup) — replaces the URL's last path segment
// with a wildcard, so the default blocks "this whole section" rather than
// just the one already-read article, while staying fully editable before
// it's actually confirmed.
export function defaultUrlBlockPattern(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (segments.length === 0) return `${parsed.origin}/*`;
    segments[segments.length - 1] = "*";
    return `${parsed.origin}/${segments.join("/")}`;
  } catch {
    return url ? `${url}*` : "*";
  }
}
