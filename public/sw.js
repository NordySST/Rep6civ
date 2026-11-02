/* Service worker do Rep6civ: funciona offline após a primeira visita.
 * - Na instalação, baixa index.html e pré-armazena todos os assets referenciados nele.
 * - Navegação: rede primeiro (para pegar atualizações), cache como reserva.
 * - Demais GET do mesmo domínio: cache primeiro, com atualização em segundo plano.
 * Incremente CACHE_VERSION para forçar limpeza de caches antigos. */
const CACHE_VERSION = 'v1';
const CACHE = `rep6civ-${CACHE_VERSION}`;
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CORE);
      try {
        const res = await fetch('./index.html', { cache: 'no-store' });
        const html = await res.text();
        const urls = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
        await cache.addAll(urls);
      } catch (e) {
        /* offline durante a instalação: assets serão armazenados sob demanda */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('rep6civ-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put('./index.html', res.clone());
          return res;
        } catch {
          return (await caches.match('./index.html', { ignoreVary: true })) || (await caches.match('./', { ignoreVary: true })) || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreVary: true, ignoreSearch: false });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => undefined);
      return cached || (await network) || Response.error();
    })(),
  );
});
