// アプリを更新したら CACHE の数字を上げる
const CACHE = 'bodymake-v37';
const ASSETS = ['./', './index.html', './style.css', './app.js', './foods.js', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

// cache: 'reload' … ブラウザに残った古いファイルではなく、必ず最新を取りに行く
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
