import { deriveAccountId, deriveEncKey } from "./crypto.js";

const SEED_STORAGE_KEY = "feeda:seed";
const API_BASE_STORAGE_KEY = "feeda:apiBase";
// Ephemeral (share-link) session storage — sessionStorage instead of
// localStorage, so it's scoped to this one tab and disappears the instant
// the tab closes. See initEphemeralSession/shareLink.js.
const EPHEMERAL_SEED_STORAGE_KEY = "feeda:ephemeral:seed";
const EPHEMERAL_API_BASE_STORAGE_KEY = "feeda:ephemeral:apiBase";
const DEFAULT_API_BASE = "";

let current = null;

export function loadStoredSeed() {
  return localStorage.getItem(SEED_STORAGE_KEY);
}

export function loadStoredApiBase() {
  return localStorage.getItem(API_BASE_STORAGE_KEY) || DEFAULT_API_BASE;
}

export function storeApiBase(apiBase) {
  localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);
}

async function buildSession(seed, apiBase, ephemeral) {
  const trimmedSeed = seed.trim();
  const [accountId, encKey] = await Promise.all([
    deriveAccountId(trimmedSeed),
    deriveEncKey(trimmedSeed),
  ]);
  current = { seed: trimmedSeed, accountId, encKey, apiBase, ephemeral };
  return current;
}

export async function initSession(seed, apiBase) {
  const trimmedSeed = seed.trim();
  localStorage.setItem(SEED_STORAGE_KEY, trimmedSeed);
  storeApiBase(apiBase);
  return buildSession(trimmedSeed, apiBase, false);
}

// Share-link recipient's session (see shareLink.js's consumeShareLink and
// main.js's boot()). Same key derivation as initSession, but kept in
// sessionStorage instead of localStorage: closing this tab drops access
// outright, nothing here ever touches localStorage, and the normal シード
// UI stays hidden for it (see wireApp's ephemeral guard) so the seed itself
// is never shown to whoever is using this tab.
export async function initEphemeralSession(seed, apiBase) {
  const trimmedSeed = seed.trim();
  sessionStorage.setItem(EPHEMERAL_SEED_STORAGE_KEY, trimmedSeed);
  sessionStorage.setItem(EPHEMERAL_API_BASE_STORAGE_KEY, apiBase || "");
  return buildSession(trimmedSeed, apiBase, true);
}

// "共有を終了" — drops the ephemeral session immediately instead of waiting
// for the tab to close. Doesn't reload; callers own what happens next.
export function endEphemeralSession() {
  sessionStorage.removeItem(EPHEMERAL_SEED_STORAGE_KEY);
  sessionStorage.removeItem(EPHEMERAL_API_BASE_STORAGE_KEY);
  current = null;
}

// Resumes whichever session this tab already has, if any, for boot() to use
// on load/reload. An ephemeral (share-link) session in sessionStorage takes
// priority over a normal one in localStorage — sessionStorage only ever has
// something here because *this exact tab* consumed a share link earlier, so
// reloading it must stay ephemeral rather than falling through to (or
// silently upgrading into) this browser's permanent seed.
export async function resumeStoredSession() {
  const ephemeralSeed = sessionStorage.getItem(EPHEMERAL_SEED_STORAGE_KEY);
  if (ephemeralSeed) {
    return buildSession(ephemeralSeed, sessionStorage.getItem(EPHEMERAL_API_BASE_STORAGE_KEY) || DEFAULT_API_BASE, true);
  }
  const seed = loadStoredSeed();
  if (!seed) return null;
  return buildSession(seed, loadStoredApiBase(), false);
}

export function getSession() {
  if (!current) throw new Error("session not initialized");
  return current;
}

export function hasSession() {
  return current !== null;
}
