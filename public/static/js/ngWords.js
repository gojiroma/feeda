// Blocklist keywords (see ui/ngWordModal.js) — an entry whose title contains
// one of these is hidden from the article list (see filterByNgWords in
// main.js). Stored and synced the same way search history is (db.js's
// ngWords store, ngWordSync.js), just with a deletedAt tombstone since a
// word can be removed, unlike a search history entry.
import { putNgWord, getNgWord, getAllNgWords } from "./db.js";
import { getSession } from "./session.js";
import { deriveNgWordId } from "./crypto.js";

export async function addNgWord(word) {
  const trimmed = word.trim();
  if (!trimmed) return null;
  const { seed } = getSession();
  const ngWordId = await deriveNgWordId(seed, trimmed);
  const now = new Date().toISOString();
  const entry = {
    word: trimmed,
    ngWordId,
    createdAt: now,
    deletedAt: null,
    clientUpdatedAt: now,
    dirty: true,
  };
  await putNgWord(entry);
  return entry;
}

export async function removeNgWord(word) {
  const existing = await getNgWord(word);
  if (!existing) return null;
  const now = new Date().toISOString();
  const updated = { ...existing, deletedAt: now, clientUpdatedAt: now, dirty: true };
  await putNgWord(updated);
  return updated;
}

export async function getActiveNgWords() {
  const all = await getAllNgWords();
  return all.filter((w) => !w.deletedAt);
}

// Case-insensitive substring match against an entry's title — the same
// "does this text contain that word" test a person would expect from a
// blocklist, not a whole-word/regex one.
export function matchesAnyNgWord(title, lowerCaseWords) {
  if (!title || lowerCaseWords.length === 0) return false;
  const lower = title.toLowerCase();
  return lowerCaseWords.some((word) => lower.includes(word));
}
