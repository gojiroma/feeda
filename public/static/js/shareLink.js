// One-time URL hand-off: lets someone else temporarily use this account from
// their own browser tab, without ever showing them the raw seed and without
// leaving anything behind once they close that tab (see session.js's
// initEphemeralSession, which stores the seed in sessionStorage instead of
// localStorage).
//
// The link splits its secret material in two: a random `id` (sent to the
// server as the lookup key on both PUT and GET) and a separate random
// `token` that only ever lives in the URL's fragment (the part after `#`).
// Browsers never include the fragment in the request they send for a URL —
// see MDN on URL fragments — so the server-side row never carries anything
// that could decrypt itself; only whoever holds the full link (id + token)
// can. Consuming the link (the GET) is single-use, same as the 6-digit
// pairing code in pairing.js, so a link only ever grants access once.
import { deriveShareLinkKey, encryptJson, decryptJson } from "./crypto.js";

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

function randomUrlSafeString(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function apiUrl(apiBase, path) {
  return `${(apiBase || "").trim().replace(/\/+$/, "")}${path}`;
}

// Creates a fresh one-time share link for `seed`. `apiBase` is the API this
// device is configured to sync with — reused as-is for the link (embedded
// as a plain, non-secret query param) so the recipient's tab talks to the
// same backend without needing its own configuration step.
export async function createShareLink(apiBase, seed) {
  const id = randomUrlSafeString(16);
  const token = randomUrlSafeString(16);
  const key = await deriveShareLinkKey(token);
  const ciphertext = await encryptJson(key, { seed });
  const res = await fetch(apiUrl(apiBase, `/api/share-link/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ciphertext }),
  });
  if (!res.ok) throw new Error(`共有リンクの発行に失敗しました (HTTP ${res.status})`);
  const body = await res.json();

  const url = new URL(location.origin + location.pathname);
  url.searchParams.set("share", id);
  if (apiBase) url.searchParams.set("api", apiBase);
  url.hash = `k=${token}`;
  return { url: url.toString(), expiresAt: body.expiresAt };
}

// Fetches and decrypts the seed for (id, token) — this is the single "use"
// of a single-use link; the server marks it consumed as soon as this
// succeeds, so opening the same link a second time (including reloading
// after a successful first open) always fails.
export async function consumeShareLink(apiBase, id, token) {
  if (!ID_RE.test(id)) throw new Error("共有リンクの形式が正しくありません。");
  if (!token) throw new Error("共有リンクの形式が正しくありません。");
  const key = await deriveShareLinkKey(token);
  const res = await fetch(apiUrl(apiBase, `/api/share-link/${id}`));
  if (res.status === 404) throw new Error("リンクが無効か、期限切れです。");
  if (res.status === 410) throw new Error("このリンクは既に使用されています。");
  if (!res.ok) throw new Error(`受け取りに失敗しました (HTTP ${res.status})`);
  const body = await res.json();
  try {
    return await decryptJson(key, body.ciphertext);
  } catch {
    throw new Error("リンクが正しくないか、データの復号に失敗しました。");
  }
}
