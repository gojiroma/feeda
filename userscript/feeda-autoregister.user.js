// ==UserScript==
// @name         feeda RSS Auto-Register
// @namespace    https://github.com/feeda
// @version      1.5.0
// @description  Detects RSS/Atom feed links on pages you visit and registers new ones to your feeda subscription list. Also auto-logs whitelisted sites' article pages (or pages matching a user-registered URL pattern) to your feeda reading log. Does nothing for feeds/pages already registered/logged. Also supports bulk-importing an OPML subscription list.
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

  // The maintainer's own production deployment — offered as the default
  // suggestion wherever this script needs an API base URL and doesn't
  // already have a better guess (see setup() and receiveSeedByCode()
  // below). A self-hosted deployment just needs to type over it once.
  const PRODUCTION_API_BASE = "https://feeda-two.vercel.app";

  // Auto-log (reading-activity log, not the feed subscription list) config
  // — see the "--- auto-log ---" section below for the matching/detection
  // design this backs.
  const AUTO_LOG_WHITELIST_KEY = "feeda_autoLogWhitelist"; // string[] of hostnames, user-managed only
  const AUTO_LOG_BLACKLIST_KEY = "feeda_autoLogBlacklist"; // string[] of hostnames, user additions on top of BUILTIN_BLACKLIST_HOSTS
  const AUTO_LOG_URL_PATTERNS_KEY = "feeda_autoLogUrlPatterns"; // string[] of wildcard URL patterns, user-managed — see wildcardToRegExp
  const AUTO_LOGGED_URLS_KEY = "feeda_autoLoggedUrls"; // { [url]: loggedAtMs } — dedupe cache, see markAutoLogged
  const AUTO_LOG_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000; // don't re-log the same URL again within a day

  GM_registerMenuCommand("feeda: シードとAPIを設定", setup);
  GM_registerMenuCommand("feeda: 6桁コードでシードを取得", receiveSeedByCode);
  GM_registerMenuCommand("feeda: OPMLをインポート", showOpmlImportPrompt);
  GM_registerMenuCommand("feeda: このサイトの自動記録設定", manageCurrentSiteAutoLog);

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
    const apiBase = prompt(
      "feeda APIのベースURLを入力してください（例: https://your-app.vercel.app）",
      currentApiBase || PRODUCTION_API_BASE
    );
    if (apiBase === null) return;

    GM_setValue(SEED_KEY, seed.trim());
    GM_setValue(API_BASE_KEY, apiBase.trim().replace(/\/+$/, ""));
    GM_setValue(KNOWN_FEED_IDS_KEY, []);
    GM_setValue(KNOWN_FEED_IDS_TS_KEY, 0);
    alert("feeda: 設定を保存しました。");
  }

  function looksLikeValidSeed(s) {
    return typeof s === "string" && /^[A-Za-z0-9_-]{20,}$/.test(s.trim());
  }

  // If this browser hasn't been set up yet (no GM-stored seed) but the page
  // currently loaded happens to be feeda's own webapp — which keeps its
  // seed in this origin's localStorage under "feeda:seed" (see webapp/
  // static/js/session.js) — pick it up automatically instead of making the
  // user copy/paste it through a second setup() prompt. This only ever
  // fires on the webapp's own pages (any other site's localStorage simply
  // won't have that key), and only ever reads; it never overwrites a GM
  // value that's already configured.
  function tryImportSeedFromPage() {
    if (GM_getValue(SEED_KEY, "")) return;

    let pageSeed, pageApiBase;
    try {
      pageSeed = localStorage.getItem("feeda:seed");
      pageApiBase = localStorage.getItem("feeda:apiBase");
    } catch {
      return; // storage access can throw in some sandboxed/third-party-blocked contexts
    }
    if (!looksLikeValidSeed(pageSeed)) return;

    // The webapp itself stores "" for a same-origin API base (see
    // session.js's DEFAULT_API_BASE) since it just fetches relative to
    // whatever origin it's loaded from — but this script talks to that API
    // from arbitrary other pages, so it needs an absolute URL. The origin
    // this seed was found on is exactly that URL.
    const apiBase = (pageApiBase && pageApiBase.trim()) || location.origin;

    GM_setValue(SEED_KEY, pageSeed.trim());
    GM_setValue(API_BASE_KEY, apiBase.replace(/\/+$/, ""));
    GM_setValue(KNOWN_FEED_IDS_KEY, []);
    GM_setValue(KNOWN_FEED_IDS_TS_KEY, 0);
    console.info("[feeda] seed imported automatically from this browser's feeda webapp session.");
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

  function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
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

  async function decryptJson(encKey, blob) {
    const combined = base64ToBytes(blob);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, encKey, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  // Seed hand-off by 6-digit code (mirrors webapp/static/js/pairing.js —
  // the salt and iteration count must stay identical between the two, or
  // neither side can decrypt what the other encrypted). See that file's
  // own comment for why PBKDF2 is used here instead of the HKDF the rest of
  // this script uses: a 6-digit code has far less entropy than a seed, so
  // this is only ever meant to slow down guessing, not make it impossible —
  // the server's short expiry, single-use consumption, and rate limit (see
  // backend/routes/pair.py) carry the rest of that weight.
  const PAIR_KEY_SALT = "feeda:pair-code-key";
  const PAIR_KEY_ITERATIONS = 200000;

  async function derivePairingKeyFromCode(code) {
    const baseKey = await crypto.subtle.importKey("raw", toBytes(code), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: toBytes(PAIR_KEY_SALT), iterations: PAIR_KEY_ITERATIONS },
      baseKey,
      256
    );
    return crypto.subtle.importKey("raw", new Uint8Array(bits), { name: "AES-GCM" }, false, ["decrypt"]);
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

  // Returns {url, title} pairs. `document.title` is deliberately NOT used
  // as a title guess here: a page can declare several feeds at once (posts
  // feed, comments feed, per-category feeds, ...), and the page itself may
  // be a single article's permalink rather than the site's front page — in
  // either case the current page's title describes neither feed correctly.
  // The <link>'s own `title` attribute (when a site bothers to set one) is
  // the closest a page can honestly get to naming the feed it's pointing
  // at without fetching it. Leaving it blank when absent is safer than
  // guessing wrong: the UI falls back to the feed's URL until the first
  // real fetch fills in the feed's own <title>.
  function discoverFeedLinks() {
    const feedTypeRe = /(rss|atom)\+xml/i;
    return Array.from(document.querySelectorAll('link[rel~="alternate"]'))
      .filter((el) => feedTypeRe.test(el.getAttribute("type") || ""))
      .map((el) => ({ url: el.href, title: el.getAttribute("title") || "" }))
      .filter((feed) => Boolean(feed.url));
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
            frequencyGroup: null,
            paused: false,
            userManagedPause: false,
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

  // --- seed hand-off (6-digit code) ----------------------------------------
  //
  // Companion to the webapp's QR-code and 6-digit-code hand-off UI (see
  // ui/pairingModal.js there). A userscript's menu prompt() can't reasonably
  // show a camera view, so only the 6-digit code side is offered here — show
  // the code on the webapp (シード → 6桁コードで共有) and type it in here
  // instead of copy-pasting the full seed string into a prompt().

  async function receiveSeedByCode() {
    const code = prompt("feedaで表示されている6桁コードを入力してください（有効期限内に）");
    if (code === null) return;
    const trimmedCode = code.trim();
    if (!/^[0-9]{6}$/.test(trimmedCode)) {
      alert("feeda: コードは6桁の数字で入力してください。");
      return;
    }

    let apiBase = GM_getValue(API_BASE_KEY, "");
    if (!apiBase) {
      const input = prompt("feeda APIのベースURLを入力してください", PRODUCTION_API_BASE);
      if (input === null) return;
      apiBase = input.trim().replace(/\/+$/, "");
    }

    try {
      const key = await derivePairingKeyFromCode(trimmedCode);
      const res = await gmRequest({ method: "GET", url: `${apiBase}/api/pair/${trimmedCode}` });
      if (res.status === 404) throw new Error("コードが無効か、期限切れです。");
      if (res.status === 410) throw new Error("このコードは既に使用済みです。");
      if (res.status < 200 || res.status >= 300) throw new Error(`サーバーエラー (HTTP ${res.status})`);

      const body = JSON.parse(res.responseText);
      let data;
      try {
        data = await decryptJson(key, body.ciphertext);
      } catch {
        throw new Error("コードが正しくないか、データの復号に失敗しました。");
      }
      if (!data || typeof data.seed !== "string") throw new Error("データの形式が不正です。");

      GM_setValue(SEED_KEY, data.seed.trim());
      GM_setValue(API_BASE_KEY, (data.apiBase || apiBase).replace(/\/+$/, ""));
      GM_setValue(KNOWN_FEED_IDS_KEY, []);
      GM_setValue(KNOWN_FEED_IDS_TS_KEY, 0);
      alert("feeda: シードを受け取り、設定を保存しました。");
    } catch (err) {
      alert(`feeda: シードの受け取りに失敗しました: ${err.message}`);
    }
  }

  // --- auto-log (reading-activity log) -------------------------------------
  //
  // Registers feed.js-style "I read this" entries for pages you visit
  // directly (not opened from within the feeda webapp), so the reading log
  // isn't limited to what feeda already knew to fetch. Data structure, in
  // order of precedence:
  //
  //   1. BUILTIN_BLACKLIST_HOSTS (below, in code) ∪ AUTO_LOG_BLACKLIST_KEY
  //      (GM storage, user-added) — hostnames that are NEVER auto-logged
  //      regardless of what the page looks like. Small and hand-curated:
  //      SSO/auth and checkout hosts that can briefly become the top-level
  //      page (an OAuth redirect, a payment popup) but were never "read" in
  //      the sense this feature means to capture. Deliberately NOT sourced
  //      from an adblock-style list (EasyList/EasyPrivacy etc.) — those
  //      target third-party *resources* a page loads, not the top-level
  //      page itself, and auth hosts like accounts.google.com generally
  //      aren't in them anyway since they're not ad/tracker domains.
  //   2. AUTO_LOG_URL_PATTERNS_KEY (GM storage, user-added only) — wildcard
  //      URL patterns (see wildcardToRegExp) that, when matched, log the
  //      page directly and skip both #3 and #4 below. This is the escape
  //      hatch for pages that will never carry OGP/schema.org article
  //      markup — a broadcaster's program-detail page, a wiki entry, a
  //      forum thread — where the user knows the URL shape they want
  //      logged (e.g. registering .../program/detail/*/* after visiting
  //      .../program/detail/202608/26355_202608162200.html) better than any
  //      generic heuristic could guess it.
  //   3. AUTO_LOG_WHITELIST_KEY (GM storage, user-added only — no built-ins:
  //      there's no universal "safe to auto-log" list, it's whatever sites
  //      you actually read) — the gate for even bothering to check #4.
  //   4. looksLikeArticle() — the page's own OGP/schema.org markup, checked
  //      only once a hostname clears 1 and 3 (and no pattern from #2
  //      matched). This is what makes a *host* whitelist workable even for
  //      large multi-author platforms (note.com, zenn.dev, qiita.com, ...):
  //      individual article pages there declare og:type=article / a
  //      schema.org Article-family type, but listing, profile, and search
  //      pages don't, so whitelisting the whole host doesn't mean logging
  //      everything under it.
  //
  //   Hostnames in the block/whitelist match exact-or-subdomain (see
  //   hostMatches): whitelisting "example.com" also covers
  //   "blog.example.com", which handles subdomain-per-author platforms
  //   (hatenablog.com etc.) without extra syntax, while still allowing a
  //   single specific subdomain to be whitelisted/blacklisted on its own.
  //
  //   No `<article>`-tag fallback when OGP/schema.org markup is absent —
  //   deliberately conservative, since that tag gets misused for layout
  //   often enough to produce false positives. A page that's missed and
  //   doesn't fit a reusable URL pattern can still be added by hand from
  //   within the feeda webapp itself.
  //
  //   Removing a BUILTIN_BLACKLIST_HOSTS entry isn't supported yet (there's
  //   no "un-blacklist a built-in" override list) — not expected to matter
  //   much given how narrowly that list is scoped, but worth revisiting if
  //   it ever blocks a real site.

  const BUILTIN_BLACKLIST_HOSTS = [
    "accounts.google.com",
    "login.microsoftonline.com",
    "login.live.com",
    "appleid.apple.com",
    "login.yahoo.co.jp",
    "id.twitter.com",
    "api.twitter.com",
    "checkout.stripe.com",
    "js.stripe.com",
    "www.paypal.com",
  ];

  const ARTICLE_SCHEMA_TYPES = new Set([
    "Article",
    "NewsArticle",
    "BlogPosting",
    "TechArticle",
    "ScholarlyArticle",
    "Report",
    "OpinionNewsArticle",
    "AnalysisNewsArticle",
    "ReportageNewsArticle",
    "ReviewNewsArticle",
  ]);

  function hostMatches(entryHost, hostname) {
    const h = hostname.toLowerCase();
    const e = entryHost.toLowerCase();
    return h === e || h.endsWith(`.${e}`);
  }

  function matchesAnyHost(list, hostname) {
    return list.some((entry) => hostMatches(entry, hostname));
  }

  function escapeRegExpLiteral(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // "*" matches any run of characters (including none); everything else in
  // the pattern is matched literally. Anchored on both ends so a pattern
  // like ".../detail/*/" only matches URLs shaped like the one it was
  // written from, not "contains this substring anywhere".
  function wildcardToRegExp(pattern) {
    const parts = pattern.split("*").map(escapeRegExpLiteral);
    return new RegExp(`^${parts.join(".*")}$`);
  }

  function matchesAnyUrlPattern(patterns, url) {
    return patterns.some((pattern) => {
      try {
        return wildcardToRegExp(pattern).test(url);
      } catch {
        return false; // malformed pattern shouldn't crash the whole check
      }
    });
  }

  // Walks parsed JSON-LD looking for @type, including the @graph wrapper
  // some sites nest their Article node inside alongside unrelated nodes
  // (BreadcrumbList, Organization, ...).
  function collectLdTypes(node, out) {
    if (Array.isArray(node)) {
      for (const item of node) collectLdTypes(item, out);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (node["@type"]) {
      const t = node["@type"];
      if (Array.isArray(t)) out.push(...t);
      else out.push(t);
    }
    if (node["@graph"]) collectLdTypes(node["@graph"], out);
  }

  function ldJsonTypes() {
    const types = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue;
      }
      collectLdTypes(data, types);
    }
    return types;
  }

  function looksLikeArticle() {
    const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute("content");
    if (ogType && ogType.toLowerCase() === "article") return true;
    return ldJsonTypes().some((t) => ARTICLE_SCHEMA_TYPES.has(t));
  }

  function guessArticleTitle() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
    if (ogTitle && ogTitle.trim()) return ogTitle.trim();
    return document.title || "(タイトルなし)";
  }

  function pruneAutoLoggedUrls(map, now) {
    const pruned = {};
    for (const [url, loggedAt] of Object.entries(map)) {
      if (now - loggedAt < AUTO_LOG_DEDUPE_TTL_MS) pruned[url] = loggedAt;
    }
    return pruned;
  }

  function alreadyAutoLogged(url) {
    const loggedAt = GM_getValue(AUTO_LOGGED_URLS_KEY, {})[url];
    return typeof loggedAt === "number" && Date.now() - loggedAt < AUTO_LOG_DEDUPE_TTL_MS;
  }

  function markAutoLogged(url) {
    const now = Date.now();
    const map = pruneAutoLoggedUrls(GM_getValue(AUTO_LOGGED_URLS_KEY, {}), now);
    map[url] = now;
    GM_setValue(AUTO_LOGGED_URLS_KEY, map);
  }

  // Mirrors recordOpen in webapp/static/js/logbook.js's payload shape, just
  // with feedId/entryId left null since this page wasn't opened from a
  // subscribed feed.
  async function pushLogEntry(accountId, encKey, apiBase, { title, url, siteHost }) {
    const nowIso = new Date().toISOString();
    const payload = {
      feedId: null,
      feedTitle: siteHost,
      entryId: null,
      title,
      url,
      openedAt: nowIso,
      comments: [],
    };
    const row = {
      logId: crypto.randomUUID(),
      ciphertext: await encryptJson(encKey, payload),
      clientUpdatedAt: nowIso,
    };
    const res = await gmRequest({
      method: "PUT",
      url: `${apiBase}/api/log-sync`,
      headers: { Authorization: `Bearer ${accountId}`, "Content-Type": "application/json" },
      data: JSON.stringify([row]),
    });
    return res.status >= 200 && res.status < 300;
  }

  // Returns whether a log entry was actually pushed — the widget's
  // "許可リストに追加" and "URLパターンを登録" buttons re-run this right
  // after saving their respective entry (see below) so the page being read
  // right now gets logged immediately instead of only from the next page
  // load onward, and use the return value to tell the user whether that
  // happened.
  //
  // A URL-pattern match (see AUTO_LOG_URL_PATTERNS_KEY design note above)
  // skips both the host whitelist and looksLikeArticle(): the user already
  // pinned down the exact URL shape they want logged, which is a more
  // specific signal than either of those two checks is trying to
  // approximate — including for pages that will never carry OGP/schema.org
  // article markup at all.
  async function autoLogPage() {
    const seed = GM_getValue(SEED_KEY, "");
    const apiBase = GM_getValue(API_BASE_KEY, "");
    if (!seed || !apiBase) return false;

    const hostname = location.hostname;
    const url = location.href.split("#")[0];
    const blacklist = BUILTIN_BLACKLIST_HOSTS.concat(GM_getValue(AUTO_LOG_BLACKLIST_KEY, []));
    if (matchesAnyHost(blacklist, hostname)) return false;

    const patternMatched = matchesAnyUrlPattern(GM_getValue(AUTO_LOG_URL_PATTERNS_KEY, []), url);
    if (!patternMatched) {
      if (!matchesAnyHost(GM_getValue(AUTO_LOG_WHITELIST_KEY, []), hostname)) return false;
      if (!looksLikeArticle()) return false;
    }

    if (alreadyAutoLogged(url)) return false;

    const [accountId, encKey] = await Promise.all([deriveAccountId(seed), deriveEncKey(seed)]);
    const ok = await pushLogEntry(accountId, encKey, apiBase, {
      title: guessArticleTitle(),
      url,
      siteHost: hostname,
    });
    if (ok) markAutoLogged(url);
    return ok;
  }

  // A page's top frame only — an iframe (ad slot, embedded widget, ...)
  // showing its own badge would just be visual noise stacked on top of the
  // real one, and would also make autoLogPage() a candidate to fire once
  // per embedded frame instead of once for the page actually being read.
  const isTopFrame = window.top === window.self;

  // Persistent corner badge for the current page's auto-log status, so
  // adding/removing a site doesn't mean digging through the Tampermonkey
  // menu (see manageCurrentSiteAutoLog below, now just an opener for this)
  // or typing into a prompt() — real buttons, click to toggle, done. Built
  // in a shadow root so neither the host page's CSS nor ours can bleed
  // across the boundary in either direction.
  let widgetApi = null;

  function injectAutoLogWidget(hostname) {
    const hostEl = document.createElement("div");
    hostEl.id = "feeda-autolog-widget-host";
    hostEl.style.cssText =
      "all: initial !important; position: fixed !important; z-index: 2147483647 !important; " +
      "bottom: 16px !important; right: 16px !important;";
    document.documentElement.appendChild(hostEl);
    const shadow = hostEl.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif; }
        .badge {
          width: 34px; height: 34px; border-radius: 50%; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 15px; line-height: 1; box-shadow: 0 2px 10px rgba(0,0,0,.3);
          background: #6b7280; color: #fff; padding: 0;
        }
        .badge.whitelisted { background: #16a34a; }
        .badge.blacklisted { background: #dc2626; }
        .panel {
          position: absolute; bottom: 42px; right: 0; width: 240px;
          background: #fff; color: #111; border-radius: 10px; padding: 12px;
          box-shadow: 0 4px 24px rgba(0,0,0,.3); font-size: 13px; display: none;
        }
        .panel.open { display: block; }
        .panel h3 { margin: 0 0 6px; font-size: 12.5px; word-break: break-all; font-weight: 600; }
        .panel .status { color: #666; margin: 0 0 10px; line-height: 1.5; }
        .panel button {
          display: block; width: 100%; margin-top: 6px; padding: 6px 8px; font-size: 12px;
          border-radius: 6px; border: 1px solid #ccc; background: #f9f9f9; cursor: pointer;
        }
        .panel button.primary { border-color: #16a34a; background: #16a34a; color: #fff; }
        .panel button.danger { border-color: #dc2626; color: #dc2626; background: #fff; }
        .panel .patterns { margin-top: 10px; padding-top: 8px; border-top: 1px solid #eee; }
        .panel .patterns-label { margin: 0 0 6px; font-size: 11px; color: #666; font-weight: 600; }
        .panel .pattern-row {
          display: flex; align-items: center; gap: 6px; margin-bottom: 4px; padding: 4px 6px;
          background: #f5f5f5; border-radius: 4px; font-size: 11px;
        }
        .panel .pattern-row span { flex: 1; word-break: break-all; font-family: monospace; }
        .panel .pattern-row button.pattern-del {
          all: unset; cursor: pointer; color: #dc2626; font-weight: 700; padding: 0 4px;
        }
      </style>
      <button class="badge" type="button" title="feeda 自動記録"></button>
      <div class="panel">
        <h3></h3>
        <p class="status"></p>
        <div class="actions"></div>
        <div class="patterns"></div>
      </div>
    `;

    const badgeEl = shadow.querySelector(".badge");
    const panelEl = shadow.querySelector(".panel");
    const titleEl = shadow.querySelector(".panel h3");
    const statusEl = shadow.querySelector(".panel .status");
    const actionsEl = shadow.querySelector(".panel .actions");
    const patternsEl = shadow.querySelector(".panel .patterns");

    // onClick may return a string (shown in place of the usual computed
    // status line, e.g. to report what autoLogPage() just did) or nothing
    // (falls back to the computed status). It may also be async — the
    // 許可リストに追加 and URLパターンを登録 handlers below await
    // autoLogPage() before their message is shown. `container` defaults to
    // the whitelist/blacklist actions area; pass a different element (e.g. a
    // single pattern row) to place the button elsewhere in the panel.
    function addActionButton(label, cls, onClick, container = actionsEl) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      if (cls) btn.className = cls;
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const message = await onClick();
        render(message);
      });
      container.appendChild(btn);
    }

    function render(statusOverride) {
      const whitelist = GM_getValue(AUTO_LOG_WHITELIST_KEY, []);
      const blacklist = GM_getValue(AUTO_LOG_BLACKLIST_KEY, []);
      const patterns = GM_getValue(AUTO_LOG_URL_PATTERNS_KEY, []);
      const currentUrl = location.href.split("#")[0];
      const isBuiltinBlacklisted = matchesAnyHost(BUILTIN_BLACKLIST_HOSTS, hostname);
      const whitelisted = matchesAnyHost(whitelist, hostname);
      const blacklisted = matchesAnyHost(blacklist, hostname) || isBuiltinBlacklisted;
      const patternMatched = !blacklisted && matchesAnyUrlPattern(patterns, currentUrl);

      badgeEl.textContent = whitelisted || patternMatched ? "✓" : blacklisted ? "×" : "…";
      badgeEl.className =
        "badge" + (whitelisted || patternMatched ? " whitelisted" : "") + (blacklisted ? " blacklisted" : "");

      titleEl.textContent = hostname;
      statusEl.textContent =
        statusOverride ||
        (whitelisted
          ? "許可リストに登録済み。記事ページを自動で記録します。"
          : blacklisted
            ? "除外リストに登録済み。常に対象外です。"
            : patternMatched
              ? "このURLは登録済みのURLパターンに一致しています。自動で記録します。"
              : "未登録。自動記録の対象外です。");

      actionsEl.innerHTML = "";
      if (whitelisted) {
        addActionButton("許可リストから削除", "", () => {
          const list = GM_getValue(AUTO_LOG_WHITELIST_KEY, []);
          GM_setValue(AUTO_LOG_WHITELIST_KEY, list.filter((h) => h !== hostname));
        });
      } else {
        // Whitelisting a site means "I want to read here", so the page open
        // right now — the one that prompted adding it — should count too,
        // not just page loads from here on. autoLogPage() re-checks
        // everything (blacklist, looksLikeArticle, dedupe) using the
        // whitelist entry just written above, so it only actually logs when
        // this specific page qualifies.
        addActionButton("許可リストに追加", "primary", async () => {
          const list = GM_getValue(AUTO_LOG_WHITELIST_KEY, []);
          if (!list.includes(hostname)) GM_setValue(AUTO_LOG_WHITELIST_KEY, [...list, hostname]);
          const logged = await autoLogPage();
          if (logged) return "許可リストに追加し、このページも記録しました。";
          if (!looksLikeArticle()) {
            return "許可リストに追加しました。このページは記事として認識されなかったため自動記録の対象外ですが、下の「URLパターンを登録」で個別に対象にできます。";
          }
          return "許可リストに追加しました。（このページは記録済みか、記録に失敗しました）";
        });
      }

      if (blacklisted) {
        // BUILTIN_BLACKLIST_HOSTS entries can't be removed yet (see the
        // design note above) — only offer removal for a user-added one.
        if (!isBuiltinBlacklisted) {
          addActionButton("除外リストから削除", "", () => {
            const list = GM_getValue(AUTO_LOG_BLACKLIST_KEY, []);
            GM_setValue(AUTO_LOG_BLACKLIST_KEY, list.filter((h) => h !== hostname));
          });
        }
      } else {
        addActionButton("除外リストに追加", "danger", () => {
          const list = GM_getValue(AUTO_LOG_BLACKLIST_KEY, []);
          if (!list.includes(hostname)) GM_setValue(AUTO_LOG_BLACKLIST_KEY, [...list, hostname]);
        });
      }

      renderPatterns(patterns, currentUrl, blacklisted);
    }

    // URL patterns work independently of the host whitelist: a page can be
    // logged because its URL matches a registered pattern even on a host
    // that was never whitelisted, and won't be logged via a pattern on a
    // blacklisted host regardless (autoLogPage() checks the blacklist
    // first). See the AUTO_LOG_URL_PATTERNS_KEY design note above.
    function renderPatterns(patterns, currentUrl, blacklisted) {
      patternsEl.innerHTML = "";
      if (blacklisted) return;

      if (patterns.length > 0) {
        const label = document.createElement("p");
        label.className = "patterns-label";
        label.textContent = "登録済みURLパターン:";
        patternsEl.appendChild(label);

        for (const pattern of patterns) {
          const row = document.createElement("div");
          row.className = "pattern-row";
          const span = document.createElement("span");
          span.textContent = pattern;
          span.title = pattern;
          row.appendChild(span);
          patternsEl.appendChild(row);
          addActionButton(
            "×",
            "pattern-del",
            () => {
              const list = GM_getValue(AUTO_LOG_URL_PATTERNS_KEY, []);
              GM_setValue(AUTO_LOG_URL_PATTERNS_KEY, list.filter((p) => p !== pattern));
            },
            row
          );
        }
      }

      addActionButton(
        "URLパターンを登録...",
        "",
        async () => {
          const input = prompt(
            "このパターンに一致するURLを、記事形式でなくても自動記録します。\n" +
              "「*」はワイルドカードです。日付やIDの部分を * に置き換えてください。\n" +
              "例: https://example.com/articles/2026/08/12345 → https://example.com/articles/*",
            currentUrl
          );
          if (input === null || !input.trim()) return;
          const pattern = input.trim();
          const list = GM_getValue(AUTO_LOG_URL_PATTERNS_KEY, []);
          if (!list.includes(pattern)) GM_setValue(AUTO_LOG_URL_PATTERNS_KEY, [...list, pattern]);
          const logged = await autoLogPage();
          return logged
            ? `パターンを登録し、このページも記録しました。\n${pattern}`
            : `パターンを登録しました。\n${pattern}`;
        },
        patternsEl
      );
    }

    badgeEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      panelEl.classList.toggle("open");
    });
    // Outside-click closes the panel. Node.contains() doesn't cross shadow
    // boundaries (hostEl.contains(nodeInsideItsOwnShadowRoot) is false, since
    // that node lives in a different tree), so a plain containment check
    // here would treat every click inside the panel — including on its own
    // buttons — as "outside" and close it mid-click. composedPath() is the
    // shadow-including path instead, so checking whether hostEl appears in
    // it covers both shadow-internal and host-page clicks correctly.
    document.addEventListener("click", (ev) => {
      if (!ev.composedPath().includes(hostEl)) panelEl.classList.remove("open");
    });

    render();
    widgetApi = { open: () => panelEl.classList.add("open") };
  }

  function initAutoLogWidget() {
    if (!isTopFrame) return;
    const seed = GM_getValue(SEED_KEY, "");
    const apiBase = GM_getValue(API_BASE_KEY, "");
    if (!seed || !apiBase) return; // nothing to manage until setup() has run
    injectAutoLogWidget(location.hostname);
  }

  // Kept as a menu entry point too, for anyone who'd rather use the
  // Tampermonkey menu than hunt for the corner badge — just opens the same
  // panel instead of the old prompt()-based flow.
  function manageCurrentSiteAutoLog() {
    if (widgetApi) {
      widgetApi.open();
      return;
    }
    alert("feeda: 先に「feeda: シードとAPIを設定」からセットアップしてください。");
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

  async function registerFeed(accountId, encKey, apiBase, feedId, feedUrl, feedTitle) {
    const payload = {
      url: feedUrl,
      title: feedTitle || "",
      addedAt: new Date().toISOString(),
      readUntil: null,
      contentHash: null,
      frequencyGroup: null,
      paused: false,
      userManagedPause: false,
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

    const discoveredFeeds = discoverFeedLinks();
    if (discoveredFeeds.length === 0) return;

    const [accountId, encKey] = await Promise.all([deriveAccountId(seed), deriveEncKey(seed)]);
    const knownFeedIds = await getKnownFeedIds(accountId, apiBase);

    for (const { url: feedUrl, title: feedTitle } of discoveredFeeds) {
      const feedId = await deriveFeedId(seed, feedUrl);
      if (knownFeedIds.has(feedId)) continue;

      const ok = await registerFeed(accountId, encKey, apiBase, feedId, feedUrl, feedTitle);
      if (ok) {
        knownFeedIds.add(feedId);
        GM_setValue(KNOWN_FEED_IDS_KEY, Array.from(knownFeedIds));
      }
    }
  }

  tryImportSeedFromPage();

  main().catch((err) => console.error("[feeda]", err));
  if (isTopFrame) {
    autoLogPage().catch((err) => console.error("[feeda]", err));
    initAutoLogWidget();
  }
})();
