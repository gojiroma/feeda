// ==UserScript==
// @name         feeda RSS Auto-Register
// @namespace    https://github.com/feeda
// @version      1.1.3
// @description  Detects RSS/Atom feed links on pages you visit and registers new ones to your feeda subscription list. Does nothing for feeds you already subscribe to. Also supports bulk-importing an OPML subscription list.
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
  GM_registerMenuCommand("feeda: OPMLをインポート", showOpmlImportPrompt);

  // A click coming from GM_registerMenuCommand originates in the browser's
  // extension UI, not the page, so it doesn't count as user activation
  // there — calling input.click() directly from the menu handler gets
  // silently blocked ("File chooser dialog can only be shown with a user
  // activation"). Show a real on-page button instead; a click on *that*
  // is a genuine DOM gesture, so the file picker opens from its handler.
  function showOpmlImportPrompt() {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.45);" +
      "display:flex;align-items:center;justify-content:center;font-family:sans-serif;";

    const box = document.createElement("div");
    box.style.cssText =
      "background:#fff;color:#111;padding:20px 24px;border-radius:8px;max-width:320px;" +
      "text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.35);";
    box.innerHTML = '<p style="margin:0 0 14px;font-size:14px;line-height:1.5;">feedaにOPMLファイルをインポートします。</p>';

    const btn = document.createElement("button");
    btn.textContent = "OPMLファイルを選択";
    btn.style.cssText =
      "padding:8px 16px;font-size:14px;cursor:pointer;border:1px solid #2563eb;" +
      "background:#2563eb;color:#fff;border-radius:6px;";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "キャンセル";
    cancelBtn.style.cssText =
      "padding:8px 16px;font-size:14px;cursor:pointer;border:1px solid #ccc;" +
      "background:#fff;color:#111;border-radius:6px;margin-left:8px;";

    box.appendChild(btn);
    box.appendChild(cancelBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    cancelBtn.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) overlay.remove();
    });

    btn.addEventListener("click", () => {
      overlay.remove();
      importOpml().catch((err) => {
        console.error("[feeda]", err);
        alert(`feeda: OPMLインポートに失敗しました: ${err.message}`);
      });
    });
  }

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

  // --- OPML import ---------------------------------------------------------

  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.style.display = "none";
      input.addEventListener(
        "change",
        () => {
          resolve(input.files[0] || null);
          input.remove();
        },
        { once: true }
      );
      document.body.appendChild(input);
      input.click();
    });
  }

  function extractFeedsFromOpml(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("OPMLの解析に失敗しました");

    const seen = new Set();
    const feeds = [];
    for (const outline of Array.from(doc.querySelectorAll("outline[xmlUrl]"))) {
      const url = (outline.getAttribute("xmlUrl") || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const title = outline.getAttribute("title") || outline.getAttribute("text") || "";
      feeds.push({ url, title });
    }
    return feeds;
  }

  async function importFeedsBatch(accountId, encKey, apiBase, feedsToAdd) {
    const CHUNK_SIZE = 400; // stay under the server's per-request row cap
    let appliedCount = 0;

    for (let i = 0; i < feedsToAdd.length; i += CHUNK_SIZE) {
      const chunk = feedsToAdd.slice(i, i + CHUNK_SIZE);
      const rows = await Promise.all(
        chunk.map(async ({ feedId, url, title }) => {
          const payload = {
            url,
            title,
            addedAt: new Date().toISOString(),
            readUntil: null,
            contentHash: null,
            deletedAt: null,
          };
          return {
            feedId,
            ciphertext: await encryptJson(encKey, payload),
            clientUpdatedAt: payload.addedAt,
          };
        })
      );

      const res = await gmRequest({
        method: "PUT",
        url: `${apiBase}/api/sync`,
        headers: { Authorization: `Bearer ${accountId}`, "Content-Type": "application/json" },
        data: JSON.stringify(rows),
      });
      if (res.status < 200 || res.status >= 300) {
        // Surface the failure instead of silently leaving appliedCount at 0 —
        // otherwise a broken API base URL or server error looks identical to
        // "everything was already registered".
        throw new Error(`サーバーエラー (HTTP ${res.status}): ${res.responseText.slice(0, 300)}`);
      }
      appliedCount += JSON.parse(res.responseText).applied.length;
    }

    return appliedCount;
  }

  async function importOpml() {
    const seed = GM_getValue(SEED_KEY, "");
    const apiBase = GM_getValue(API_BASE_KEY, "");
    if (!seed || !apiBase) {
      alert("feeda: 先に「feeda: シードとAPIを設定」からセットアップしてください。");
      return;
    }

    const file = await pickFile(".opml,.xml,text/x-opml,text/xml");
    if (!file) return;

    const feeds = extractFeedsFromOpml(await file.text());
    if (feeds.length === 0) {
      alert("feeda: OPML内にフィードが見つかりませんでした。");
      return;
    }

    const [accountId, encKey] = await Promise.all([deriveAccountId(seed), deriveEncKey(seed)]);
    // Force a fresh check against the server rather than the 6h-cached set,
    // since a bulk import is a deliberate one-off action worth the extra request.
    const knownFeedIds = await getKnownFeedIds(accountId, apiBase, { force: true });

    const withIds = await Promise.all(
      feeds.map(async (feed) => ({ ...feed, feedId: await deriveFeedId(seed, feed.url) }))
    );
    const newFeeds = withIds.filter((feed) => !knownFeedIds.has(feed.feedId));

    if (newFeeds.length === 0) {
      alert(`feeda: OPML内の${feeds.length}件はすべて登録済みでした。`);
      return;
    }

    const appliedCount = await importFeedsBatch(accountId, encKey, apiBase, newFeeds);
    for (const feed of newFeeds) knownFeedIds.add(feed.feedId);
    GM_setValue(KNOWN_FEED_IDS_KEY, Array.from(knownFeedIds));
    GM_setValue(KNOWN_FEED_IDS_TS_KEY, Date.now());

    const skipped = feeds.length - newFeeds.length;
    alert(
      `feeda: OPMLインポート完了\n${feeds.length}件中 ${appliedCount}件を新規登録しました` +
        (skipped > 0 ? `（${skipped}件は登録済みのためスキップ）` : "")
    );
  }

  // --- main ---------------------------------------------------------------

  async function getKnownFeedIds(accountId, apiBase, { force = false } = {}) {
    const lastRefresh = GM_getValue(KNOWN_FEED_IDS_TS_KEY, 0);
    if (!force && Date.now() - lastRefresh < KNOWN_CACHE_TTL_MS) {
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
      contentHash: null,
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
    const knownFeedIds = await getKnownFeedIds(accountId, apiBase);

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
