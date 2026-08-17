// Seed-derived crypto for feeda. Same logic is duplicated (inlined) in the
// Tampermonkey userscript, since a userscript must ship as a single file.

const ACCOUNT_ID_INFO = "feeda:account-id";
const ENC_KEY_INFO = "feeda:enc-key";
const FEED_ID_INFO = "feeda:feed-id";

function toBytes(str) {
  return new TextEncoder().encode(str);
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

export function generateSeed() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isValidSeed(seed) {
  return typeof seed === "string" && /^[A-Za-z0-9_-]{20,}$/.test(seed.trim());
}

async function hkdf(seedBytes, info, byteLength) {
  const baseKey = await crypto.subtle.importKey("raw", seedBytes, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: toBytes(info),
    },
    baseKey,
    byteLength * 8
  );
  return new Uint8Array(bits);
}

export async function deriveAccountId(seed) {
  const seedBytes = toBytes(seed.trim());
  const infoBytes = toBytes(ACCOUNT_ID_INFO);
  const combined = new Uint8Array(seedBytes.length + infoBytes.length);
  combined.set(seedBytes, 0);
  combined.set(infoBytes, seedBytes.length);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return bytesToHex(digest);
}

export async function deriveEncKey(seed) {
  const seedBytes = toBytes(seed.trim());
  const keyBytes = await hkdf(seedBytes, ENC_KEY_INFO, 32);
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function normalizeFeedUrl(url) {
  return url.trim();
}

export async function deriveFeedId(seed, feedUrl) {
  const seedBytes = toBytes(seed.trim());
  const infoBytes = toBytes(FEED_ID_INFO);
  const urlBytes = toBytes(normalizeFeedUrl(feedUrl));
  const combined = new Uint8Array(seedBytes.length + infoBytes.length + urlBytes.length);
  combined.set(seedBytes, 0);
  combined.set(infoBytes, seedBytes.length);
  combined.set(urlBytes, seedBytes.length + infoBytes.length);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return bytesToHex(digest);
}

export async function encryptJson(encKey, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = toBytes(JSON.stringify(obj));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encKey, plaintext);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

export async function decryptJson(encKey, blob) {
  const combined = base64ToBytes(blob);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, encKey, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}
