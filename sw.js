const CACHE_NAME = "harambeeflow-v1";

const urlsToCache = [
  "/",
  "/index.html",
  "/donate.html",
  "/dashboard-production.html",
  "/login.html",
  "/manifest.json"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
