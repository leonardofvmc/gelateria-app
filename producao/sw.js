/* Service worker da página de produção (escopo: esta pasta).
   - arquivos estáticos desta pasta + css/fontes/ícones compartilhados: rede primeiro, cache offline
   - dados.bin: SEMPRE rede primeiro (só cai no cache se estiver sem internet)
   - nada fora desta pasta é guardado, exceto ../css/style.css, ../fonts/ e ../icons/ */
const CACHE = 'producao-v8';
const BASE = new URL('./', self.location).pathname;      // .../producao/
const PAI = new URL('../', self.location).pathname;      // pasta do app (um nível acima)
const FILES = [
  './', './index.html', './app.js', './producao.css', './manifest.webmanifest',
  '../css/style.css',
  'icon-192.png', 'icon-512.png',
  '../fonts/inter-400.woff2', '../fonts/inter-500.woff2', '../fonts/inter-600.woff2',
  '../fonts/inter-700.woff2', '../fonts/fraunces-600.woff2', '../fonts/fraunces-700.woff2',
];

function permitido(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  if (p.startsWith(BASE)) return !/\/sw\.js$/.test(p);
  return p === PAI + 'css/style.css' || p.startsWith(PAI + 'fonts/') || p.startsWith(PAI + 'icons/');
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('producao-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!permitido(url)) return;                 // fora do escopo permitido: passa direto, sem cache
  e.respondWith(
    fetch(req, { cache: 'no-store' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: true }).then((hit) =>
        hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    )
  );
});
