/* 離線快取：App 本體先存起來，沒網路也能打開並看到上次載入的地點（地點快取在 localStorage） */
const VERSION = "v4";
const SHELL = [
  "./", "index.html", "css/app.css",
  "js/config.js", "js/native.js", "js/icons.js", "js/categories.js", "js/sources.js", "js/app.js",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
  "vendor/leaflet/leaflet.markercluster.js", "vendor/leaflet/MarkerCluster.css",
  "vendor/fonts/barlow-condensed/index.css",
  "data/chain-discounts.json", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open("shell-" + VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // 外部請求（圖磚、Overpass、廣告）不攔
  // 本站檔案：先用網路（拿到最新版），失敗再用快取
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open("shell-" + VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
