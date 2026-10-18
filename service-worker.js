/* MapNav service worker
   - App shell (page, manifest, icons) and the MapLibre / three.js builds are cached so the app opens offline.
   - Pages are network-first, so a new deploy shows up on the next launch; the cache is the offline fallback.
   - Map styles, glyphs, sprites and tiles are stale-while-revalidate, so areas you've seen still draw offline.
   - Routing, search and speed-limit APIs always go to the network (live data). */
const VERSION = 'mapnav-v1';
const SHELL = `${VERSION}-shell`;
const MAP = `${VERSION}-map`;
const MAP_MAX_ENTRIES = 1500;

const SHELL_URLS = [
  './', 'index.html', 'manifest.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://unpkg.com/three@0.149.0/build/three.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(request, { ignoreSearch: true })) || (await cache.match('./')) || Response.error();
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
  return res;
}

async function trimMapCache() {
  const cache = await caches.open(MAP);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAP_MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(MAP);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request).then((res) => {
    if (res.ok) event.waitUntil(cache.put(event.request, res.clone()).then(trimMapCache));
    return res;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => {}));
    return hit;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') return event.respondWith(networkFirst(request));
  if (url.origin === self.location.origin) return event.respondWith(cacheFirst(request));
  if (url.hostname === 'unpkg.com') return event.respondWith(cacheFirst(request));
  if (url.hostname === 'tiles.openfreemap.org') return event.respondWith(staleWhileRevalidate(event));
  // Everything else (OSRM, Nominatim, Overpass, …) goes straight to the network.
});
