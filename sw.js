// オフラインでも開けるようにするための Service Worker（ネット優先・つながらない時はキャッシュ）
const CACHE = 'kids-gallery-v11';
const ASSETS = [
  './', 'index.html', 'style.css', 'db.js', 'imaging.js', 'config.js', 'cloud.js', 'app.js', 'manifest.json', 'icon.svg',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
];
self.addEventListener('install', e => {
  // 古いキャッシュではなく、サーバーから取り直して保存する（更新直後に新旧のファイルが混ざらないように）
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).catch(() => { }));
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

// ---------- お知らせ（家族が作品を追加したとき） ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'キッズギャラリー', {
    body: d.body || '家族が新しい作品をしまいました',
    icon: 'icon-192.png', badge: 'icon-192.png',
    tag: d.tag || 'kg-new', renotify: true,
    data: { url: d.url || '#home' },
  }));
});
// お知らせを押したら、アプリを開いて、その作品を見せる
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL('./', self.registration.scope).href + (e.notification.data?.url || '#home');
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); return w.navigate(target).catch(() => w.postMessage({ go: e.notification.data?.url })); }
    }
    return clients.openWindow(target);
  })());
});
