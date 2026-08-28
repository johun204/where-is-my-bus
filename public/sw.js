// ponytail: 앱 셸만 캐시하는 최소 SW. 오프라인 타일 캐싱이 필요하면 확장.
const CACHE = 'busmap-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))),
);

self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  ),
);

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 지도/API는 항상 네트워크
  if (url.pathname.startsWith('/api/') || url.host.includes('kakao')) return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
