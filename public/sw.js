import { VERSION, FILES } from './release.js';

const scope = self.registration.scope;
const prefix = 'flow2-control:' + scope + ':';
const cacheName = prefix + VERSION;
const assets = new Set(FILES.map((name) => new URL(name, scope).href));
const entry = new URL('index.html', scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll([...assets])));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isEntry = request.mode === 'navigate' && (url.origin + url.pathname === scope || url.origin + url.pathname === entry);
  if (!isEntry && !assets.has(url.href)) return;
  event.respondWith((async () => (await (await caches.open(cacheName)).match(isEntry ? entry : request)) || fetch(request))());
});
