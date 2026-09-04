const CACHE = 'opket-v120-google-auth-v2';
const ASSETS = [
  './',
  './index.html',
  './privacy.html',
  './manifest.json',
  './.well-known/assetlinks.json',
  './logo.png',
  './vendor/firebase-app-compat.js',
  './vendor/firebase-auth-compat.js',
  './vendor/firebase-firestore-compat.js',
  './vendor/firebase-storage-compat.js',
  './vendor/lucide.js',
  './vendor/mqtt.min.js',
  './vendor/confetti.browser.min.js',
  './assets/fonts/outfit.css',
  './assets/fonts/outfit-200.ttf',
  './assets/fonts/outfit-300.ttf',
  './assets/fonts/outfit-400.ttf',
  './assets/fonts/outfit-500.ttf',
  './assets/fonts/outfit-600.ttf',
  './assets/fonts/outfit-700.ttf'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if(event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification?.close();
  const targetUrl = event.notification?.data?.url || './index.html?source=notification';
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if ('focus' in client) {
        try {
          await client.navigate(targetUrl);
        } catch (e) {}
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = { title: 'Opket', body: event.data ? event.data.text() : 'Yeni bildirim' };
  }
  const title = data.title || 'Opket';
  const options = {
    body: data.body || 'Sunucunuzda yeni bir hareketlilik var.',
    icon: './logo.png',
    badge: './logo.png',
    data: { url: data.url || './index.html?source=push' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('fetch', e => {
  const requestUrl = new URL(e.request.url);
  if (requestUrl.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  if (e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(response => {
      if (!response || response.status !== 200 || response.type === 'opaque') return response;
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(e.request, copy)).catch(() => {});
      return response;
    }))
  );
});
