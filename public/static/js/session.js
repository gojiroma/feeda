import { deriveAccountId, deriveEncKey } from "./crypto.js";

const SEED_STORAGE_KEY = "feeda:seed";
const API_BASE_STORAGE_KEY = "feeda:apiBase";
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

export async function initSession(seed, apiBase) {
  const trimmedSeed = seed.trim();
  const [accountId, encKey] = await Promise.all([
    deriveAccountId(trimmedSeed),
    deriveEncKey(trimmedSeed),
  ]);
  localStorage.setItem(SEED_STORAGE_KEY, trimmedSeed);
  storeApiBase(apiBase);
  current = { seed: trimmedSeed, accountId, encKey, apiBase };
  return current;
}

export function getSession() {
  if (!current) throw new Error("session not initialized");
  return current;
}

export function hasSession() {
  return current !== null;
}
