/*
 * Service worker: guarda o app no celular para abrir e funcionar SEM internet
 * (modo "A bordo"). Para publicar uma nova versão do app, aumente o número em
 * CACHE (ex.: efc-v2) - assim os celulares descartam o cache antigo.
 */
const CACHE = 'efc-bordo-v17';
const SHELL = [
  './', 'index.html', 'engine.js', 'route_km.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Estado do trem (servidor do trem): sempre direto da rede, nunca do cache
  if (url.pathname.endsWith('/state.json')) return;

  // Banco de dados do Firebase: nunca interceptar (tempo real)
  if (url.hostname.endsWith('firebaseio.com') || url.hostname.endsWith('firebasedatabase.app')) return;

  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin || url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' || url.hostname === 'www.gstatic.com';
  if (!cacheable) return;

  // Cache primeiro, atualizando em segundo plano (abre na hora, mesmo sem internet)
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (cached) return cached;
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return cache.match('index.html');
      return new Response('', { status: 504 });
    })
  );
});
