// ==UserScript==
// @name         feeda RSS Auto-Register
// @namespace    https://github.com/feeda
// @version      1.0.0
// @description  Detects RSS/Atom feed links on pages you visit and registers new ones to your feeda subscription list. Does nothing for feeds you already subscribe to.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // --- config ---------------------------------------------------------
  const SEED_KEY = "feeda_seed";
  const API_BASE_KEY = "feeda_apiBase";
  const KNOWN_FEED_IDS_KEY = "feeda_knownFeedIds";
  const KNOWN_FEED_IDS_TS_KEY = "feeda_knownFeedIds_ts";
  const KNOWN_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // refresh the "already known" cache at most every 6h

  GM_registerMenuCommand("feeda: シードとAPIを設定", setup);

  function setup() {
    const currentSeed = GM_getValue(SEED_KEY, "");
    const seed = prompt("feedaのシードを貼り付けてください（Webアプリのセットアップ画面で確認できます）", currentSeed);
    if (seed === null) return;
    const currentApiBase = GM_getValue(API_BASE_KEY, "");
    const apiBase = prompt("feeda APIのベースURLを入力してください（例: https://your-app.vercel.app）", currentApiBase);
    if (apiBase === null) return;

    GM_setValue(SEED_KEY, seed.trim());
    GM_setValue(API_BASE_KEY, apiBase.trim().replace(/\/+$/, ""));
    GM_setValue(KNOWN_FEED_IDS_KEY, []);
    GM_setValue(KNOWN_FEED_IDS_TS_KEY, 0);
    alert("feeda: 設定を保存しました。");
  }

  // --- crypto (mirrors webapp/static/js/crypto.js; kept inline because a
  // userscript ships as a single file) ---------------------------------

  function toBytes(str) {
    return new TextEncoder().encode(str);
  }

  function bytesToHex(bytes) {
    return Array.from(new Uint8Array(bytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
    return btoa(binary);
  }

  function concatBytes(...parts) {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  async function deriveAccountId(seed) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      concatBytes(toBytes(seed.trim()), toBytes("feeda:account-id"))
    );
    return bytesToHex(digest);
  }

  async function deriveFeedId(seed, feedUrl) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      concatBytes(toBytes(seed.trim()), toBytes("feeda:feed-id"), toBytes(feedUrl.trim()))
    );
    return bytesToHex(digest);
  }

  async function deriveEncKey(seed) {
    const baseKey = await crypto.subtle.importKey("raw", toBytes(seed.trim()), "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: toBytes("feeda:enc-key") },
      baseKey,
      256
    );
    return crypto.subtle.importKey("raw", new Uint8Array(bits), { name: "AES-GCM" }, false, ["encrypt"]);
  }

  async function encryptJson(encKey, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encKey, toBytes(JSON.stringify(obj)));
    return bytesToBase64(concatBytes(iv, new Uint8Array(ciphertext)));
  }

  // --- network ----------------------------------------------------------

  function gmRequest(details) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        ...details,
        onload: resolve,
        onerror: () => reject(new Error("request failed")),
        ontimeout: () => reject(new Error("request timed out")),
        timeout: 15000,
      });
    });
  }

  // --- feed discovery -----------------------------------------------------

  function discoverFeedLinks() {
    const feedTypeRe = /(rss|atom)\+xml/i;
    return Array.from(document.querySelectorAll('link[rel~="alternate"]'))
      .filter((el) => feedTypeRe.test(el.getAttribute("type") || ""))
      .map((el) => el.href)
      .filter(Boolean);
  }

  // --- main ---------------------------------------------------------------

  async function refreshKnownFeedIdsIfStale(accountId, apiBase) {
    const lastRefresh = GM_getValue(KNOWN_FEED_IDS_TS_KEY, 0);
    if (Date.now() - lastRefresh < KNOWN_CACHE_TTL_MS) {
      return new Set(GM_getValue(KNOWN_FEED_IDS_KEY, []));
    }
    const res = await gmRequest({
      method: "GET",
      url: `${apiBase}/api/sync`,
      headers: { Authorization: `Bearer ${accountId}` },
    });
    if (res.status < 200 || res.status >= 300) {
      return new Set(GM_getValue(KNOWN_FEED_IDS_KEY, []));
    }
    const body = JSON.parse(res.responseText);
    const ids = body.rows.map((row) => row.feedId);
    GM_setValue(KNOWN_FEED_IDS_KEY, ids);
    GM_setValue(KNOWN_FEED_IDS_TS_KEY, Date.now());
    return new Set(ids);
  }

  async function registerFeed(accountId, encKey, apiBase, feedId, feedUrl) {
    const payload = {
      url: feedUrl,
      title: document.title || "",
      addedAt: new Date().toISOString(),
      readUntil: null,
      deletedAt: null,
    };
    const row = {
      feedId,
      ciphertext: await encryptJson(encKey, payload),
      clientUpdatedAt: payload.addedAt,
    };
    const res = await gmRequest({
      method: "PUT",
      url: `${apiBase}/api/sync`,
      headers: { Authorization: `Bearer ${accountId}`, "Content-Type": "application/json" },
      data: JSON.stringify([row]),
    });
    return res.status >= 200 && res.status < 300;
  }

  async function main() {
    const seed = GM_getValue(SEED_KEY, "");
    const apiBase = GM_getValue(API_BASE_KEY, "");
    if (!seed || !apiBase) return; // not configured yet

    const feedUrls = discoverFeedLinks();
    if (feedUrls.length === 0) return;

    const [accountId, encKey] = await Promise.all([deriveAccountId(seed), deriveEncKey(seed)]);
    const knownFeedIds = await refreshKnownFeedIdsIfStale(accountId, apiBase);

    for (const feedUrl of feedUrls) {
      const feedId = await deriveFeedId(seed, feedUrl);
      if (knownFeedIds.has(feedId)) continue;

      const ok = await registerFeed(accountId, encKey, apiBase, feedId, feedUrl);
      if (ok) {
        knownFeedIds.add(feedId);
        GM_setValue(KNOWN_FEED_IDS_KEY, Array.from(knownFeedIds));
      }
    }
  }

  main().catch((err) => console.error("[feeda]", err));
})();
