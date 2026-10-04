/* 100Hz 防晕动 — Service Worker（离线可用） */

var CACHE = "hz100-v2";
var CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];
var MEDIA = ["./audio/100hz.mp3"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(CORE).then(function () {
        // 音频较大，单独缓存且失败不影响安装
        return Promise.all(MEDIA.map(function (url) {
          return cache.add(url).catch(function () { /* 稍后再试 */ });
        }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 音频：优先缓存（离线也能播放），后台更新
  if (url.pathname.indexOf("/audio/") >= 0 || /\.mp3$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        var fetching = fetch(req).then(function (res) {
          if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
          return res;
        }).catch(function () { return hit; });
        return hit || fetching;
      })
    );
    return;
  }

  // 页面导航：网络优先，失败回落缓存
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then(function (res) {
        caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("./index.html");
        });
      })
    );
    return;
  }

  // 其它资源：先用缓存，同时在后台更新（stale-while-revalidate）
  event.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
        return res;
      }).catch(function () {
        return hit;
      });
      return hit || network;
    })
  );
});
