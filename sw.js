// 電波がない所でもアプリを開けるよう、アプリのファイルを端末に保存しておく。
// 通信できるときは最新のファイルを取りに行き、できないときは保存しておいたものを使う。
const CACHE = 'line-rehearsal-v13';
const FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'parser.js',
  'db.js',
  'speech.js',
  'manifest.json',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'lib/pdf.min.js',
  'lib/pdf.worker.min.js',
  'lib/mammoth.browser.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 自分のサイトのファイルは、ブラウザの一時保存を使わず毎回新しい版か確認する
  const sameOrigin = new URL(req.url).origin === location.origin;
  e.respondWith(
    (sameOrigin ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req))
      .then(res => {
        if (res.ok && sameOrigin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
