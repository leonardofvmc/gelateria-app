/* Service worker â€” cache offline do app shell (network-first: atualiza quando online) */
const CACHE = 'lamaddalena-t178';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/config.js',
  './js/cloud.js',
  './js/porteiro.js',
  './app.bin',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './fonts/fraunces-600.woff2',
  './fonts/fraunces-700.woff2',
  './fonts/inter-400.woff2',
  './fonts/inter-500.woff2',
  './fonts/inter-600.woff2',
  './fonts/inter-700.woff2',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // deixa o Firebase (gstatic/googleapis) e outros domÃ­nios passarem direto
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // network-first: pega a versÃ£o nova quando hÃ¡ internet; cai no cache offline
  // cache:'no-store' garante que essa busca NUNCA volte do cache HTTP do
  // navegador/CDN â€” sem isso, "network-first" podia devolver um index.html
  // velho (com os <script src=...?v=N> antigos) mesmo com internet normal.
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() =>
      caches.match(e.request).then(hit => hit || caches.match('./index.html'))
    )
  );
});
