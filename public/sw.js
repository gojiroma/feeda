// Bump this whenever any cached file below changes — a new value changes
// this script's bytes, which is what makes the browser notice an update,
// install the new worker, and (via activate below) drop the old cache.
const CACHE_NAME = "feeda-shell-v1";

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
  "./static/js/frequency.js",
  "./static/js/feedFetch.js",
  "./static/js/search.js",
  "./static/js/sanitize.js",
  "./static/js/sync.js",
  "./static/js/session.js",
  "./static/js/ui/articleList.js",
  "./static/js/ui/mobile.js",
  "./static/js/ui/resizer.js",
  "./static/js/ui/feedList.js",
  "./static/js/ui/preview.js",
  "./static/js/ui/searchBar.js",
  "./static/js/ui/seedModal.js",
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

// Cache-first for the static app shell only. Anything under /api/ (sync,
// fetch-feed) is per-account and must always hit the network — never
// intercepted here — and cross-origin requests (e.g. a separately-hosted
// API base) are left alone too.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
