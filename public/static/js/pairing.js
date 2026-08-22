// Seed hand-off via a short-lived, single-use 6-digit code (see the QR
// hand-off in qr.js for the other transfer method). Unlike the seed's own
// encryption key (crypto.js's deriveEncKey, HKDF over the full seed), a
// 6-digit code only has ~20 bits of entropy, so PBKDF2 with a large
// iteration count is used here instead — it can't make brute-forcing the
// code impossible, but it raises the cost of each guess. The server-side
// rate limit and short TTL (see backend/routes/pair.py) are doing most of
// the real work; this is defense in depth on top of that.
//
// The exact same derivation (salt, iteration count, algorithm) is
// duplicated inline in the Tampermonkey userscript, which also supports
// receiving a seed by code — the two must stay in sync or they simply
// won't decrypt each other's payloads.
import { encryptJson, decryptJson } from "./crypto.js";

const PAIR_KEY_SALT = "feeda:pair-code-key";
const PAIR_KEY_ITERATIONS = 200000;
const CODE_RE = /^[0-9]{6}$/;

function toBytes(str) {
  return new TextEncoder().encode(str);
}

function randomCode() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1000000).padStart(6, "0");
}

async function deriveKeyFromCode(code) {
  const baseKey = await crypto.subtle.importKey("raw", toBytes(code), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toBytes(PAIR_KEY_SALT), iterations: PAIR_KEY_ITERATIONS },
    baseKey,
    256
  );
  return crypto.subtle.importKey("raw", new Uint8Array(bits), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function apiUrl(apiBase, path) {
  return `${(apiBase || "").trim().replace(/\/+$/, "")}${path}`;
}

// Creates a fresh pairing code, encrypts `payload` (the {seed, apiBase} to
// hand off) under a key derived from that code, and uploads the ciphertext.
// Retries with a new random code a few times on a 409 (an extremely
// unlikely collision with someone else's still-active code) before giving
// up.
export async function createPairingCode(apiBase, payload) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const key = await deriveKeyFromCode(code);
    const ciphertext = await encryptJson(key, payload);
    const res = await fetch(apiUrl(apiBase, `/api/pair/${code}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ciphertext }),
    });
    if (res.status === 409) continue;
    if (!res.ok) throw new Error(`コードの発行に失敗しました (HTTP ${res.status})`);
    const body = await res.json();
    return { code, expiresAt: body.expiresAt };
  }
  throw new Error("コードの発行に失敗しました（他のコードと衝突し続けました。もう一度お試しください）");
}

// Polled by the sharing device only — never consumes the code, just reports
// whether it's still waiting, was picked up, or is gone (expired/unknown).
export async function pollPairingStatus(apiBase, code) {
  const res = await fetch(apiUrl(apiBase, `/api/pair/${code}/status`));
  if (!res.ok) return { found: false };
  const body = await res.json();
  return { found: true, consumed: Boolean(body.consumedAt), expiresAt: body.expiresAt };
}

// Fetches and decrypts the payload for `code` — this is the single "use" of
// a single-use code; the server marks it consumed as soon as this succeeds,
// so calling this twice with the same code always fails the second time.
export async function consumePairingCode(apiBase, code) {
  if (!CODE_RE.test(code)) throw new Error("コードは6桁の数字で入力してください。");
  const key = await deriveKeyFromCode(code);
  const res = await fetch(apiUrl(apiBase, `/api/pair/${code}`));
  if (res.status === 404) throw new Error("コードが無効か、期限切れです。");
  if (res.status === 410) throw new Error("このコードは既に使用済みです。");
  if (!res.ok) throw new Error(`受け取りに失敗しました (HTTP ${res.status})`);
  const body = await res.json();
  try {
    return await decryptJson(key, body.ciphertext);
  } catch {
    throw new Error("コードが正しくないか、データの復号に失敗しました。");
  }
}
