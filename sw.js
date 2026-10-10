// オフラインでも開けるようにするための Service Worker（ネット優先・つながらない時はキャッシュ）
const CACHE = 'kids-gallery-v9';
const ASSETS = [
  './', 'index.html', 'style.css', 'db.js', 'imaging.js', 'config.js', 'cloud.js', 'app.js', 'manifest.json', 'icon.svg',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => { }));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 家族共有のAPI（別のサーバー）の通信は、キャッシュせずそのまま通す（写真などの個人データを残さないため）
  const u = new URL(e.request.url);
  if (u.origin !== location.origin && u.origin !== 'https://cdnjs.cloudflare.com') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
