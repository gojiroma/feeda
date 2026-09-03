// Only used as a fallback when offline (see the fetch handler below) — the
// app shell is otherwise always fetched fresh from the network, so unlike
// a cache-first design this name doesn't need to be bumped by hand on every
// deploy just to make new code reach already-installed users.
const CACHE_NAME = "feeda-shell-v4";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./static/css/style.css",
  "./static/js/main.js",
  "./static/js/crypto.js",
  "./static/js/db.js",
  "./static/js/highlight.js",
  "./static/js/favicon.js",
  "./static/js/feedFetch.js",
  "./static/js/search.js",
  "./static/js/sanitize.js",
  "./static/js/sync.js",
  "./static/js/logSync.js",
  "./static/js/logbook.js",
  "./static/js/session.js",
  "./static/js/pairing.js",
  "./static/js/qr.js",
  "./static/js/ui/articleList.js",
  "./static/js/ui/feedList.js",
  "./static/js/ui/preview.js",
  "./static/js/ui/resizer.js",
  "./static/js/ui/reflect.js",
  "./static/js/ui/searchBar.js",
  "./static/js/ui/seedModal.js",
  "./static/js/ui/pairingModal.js",
  "./static/js/vendor/qrcode-generator.js",
  "./static/js/vendor/jsQR.js",
  "./static/icons/icon-192.png",
  "./static/icons/icon-512.png",
  "./static/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the static app shell. A cache-first strategy here meant
// every deploy was invisible to anyone with the PWA already installed
// unless this file's own bytes happened to change too (the only thing that
// makes a browser notice a new service worker exists) — in effect, the app
// kept "reverting" to whatever version was cached on first install. Now the
// network is always tried first when online, so fixes and feature changes
// reach installed users immediately; the cache is only a fallback for when
// there's no network at all. Anything under /api/ (sync, fetch-feed) is
// per-account and must always hit the network — never intercepted here —
// and cross-origin requests (e.g. a separately-hosted API base) are left
// alone too.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    // no-store bypasses the browser's own HTTP cache layer too, not just
    // this file's Cache Storage bucket — without it, a fetch() here can
    // still be quietly served from the browser's disk cache instead of
    // actually hitting the network, defeating the whole point of trying
    // the network first.
    fetch(event.request, { cache: "no-store" })
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});
