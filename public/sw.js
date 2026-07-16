const CACHE = "santuario-route-v10";
const CORE = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

async function cacheResponse(request, response) {
  if (!response || (!response.ok && response.type !== "opaque")) return response;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  return response;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return cacheResponse(request, await fetch(request));
}

async function networkFirst(request) {
  try {
    return await cacheResponse(request, await fetch(request));
  } catch {
    return (await caches.match(request)) || (await caches.match("/"));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_URLS" || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter((url) => typeof url === "string").slice(0, 220);
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const url of urls) {
        try {
          const request = new Request(url, { mode: "no-cors" });
          if (!(await cache.match(request))) await cache.add(request);
        } catch {}
      }
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname.endsWith("tile.openstreetmap.org") || url.hostname === "server.arcgisonline.com") {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.hostname === "router.project-osrm.org") {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request).catch(() => networkFirst(request)));
});
