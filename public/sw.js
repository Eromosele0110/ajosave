/**
 * Ajosave Service Worker
 *
 * Cache strategies:
 *   - Static assets (_next/static, icons)  → Cache-first (long-lived, immutable)
 *   - API GET routes                        → Network-first with cache fallback
 *                                             (returns stale JSON when offline)
 *   - App shell pages                       → Stale-while-revalidate
 *   - POST / mutating requests              → Network-only (never cached)
 */

const CACHE_VERSION = "ajosave-v2";
const API_CACHE = "ajosave-api-v2";
const STATIC_CACHE = "ajosave-static-v2";
const ALL_CACHES = [CACHE_VERSION, API_CACHE, STATIC_CACHE];

/** Pages pre-cached on install so the app shell is always available offline. */
const PRECACHE_URLS = [
  "/",
  "/circles",
  "/dashboard",
  "/offline",
  "/favicon.svg",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

/**
 * API routes whose GET responses are safe to cache for offline fallback.
 * Sensitive or write endpoints are intentionally excluded.
 */
const CACHEABLE_API_PREFIXES = [
  "/api/circles",
  "/api/fx-rate",
];

/** Maximum age (ms) for a cached API response before it is considered stale. */
const API_CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Install – pre-cache app shell
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate – clean up old caches
// ---------------------------------------------------------------------------

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !ALL_CACHES.includes(k))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

// ---------------------------------------------------------------------------
// Fetch – route-based cache strategies
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only intercept same-origin requests.
  if (url.origin !== self.location.origin) return;

  // Never cache non-GET requests – let them go straight to the network.
  if (request.method !== "GET") return;

  // ── Static assets: Cache-first ──────────────────────────────────────────
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".woff2")
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── Cacheable API routes: Network-first with stale fallback ─────────────
  if (CACHEABLE_API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(networkFirstApiWithFallback(request));
    return;
  }

  // ── Other API routes: Network-only with offline JSON response ────────────
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            JSON.stringify({ success: false, error: "You are offline" }),
            {
              status: 503,
              headers: {
                "Content-Type": "application/json",
                "X-Served-By": "service-worker-offline",
              },
            },
          ),
      ),
    );
    return;
  }

  // ── Pages: Stale-while-revalidate ────────────────────────────────────────
  event.respondWith(staleWhileRevalidate(request, CACHE_VERSION));
});

// ---------------------------------------------------------------------------
// Strategy helpers
// ---------------------------------------------------------------------------

/**
 * Cache-first: return from cache; fetch + cache on miss.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Network-first for API responses, falling back to cached JSON when offline.
 * Attaches an `X-Cache-Date` header so the client can detect staleness.
 */
async function networkFirstApiWithFallback(request) {
  const cache = await caches.open(API_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Clone and add a cache timestamp header before storing.
      const stamped = addCacheDateHeader(response.clone());
      cache.put(request, stamped);
    }
    return response;
  } catch {
    // Network failed – return cached version if available.
    const cached = await cache.match(request);
    if (cached) {
      // Return with a header so the client knows this is a cached response.
      return addOfflineHeader(cached);
    }
    // No cache either.
    return new Response(
      JSON.stringify({ success: false, error: "Offline – no cached data available" }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "X-Served-By": "service-worker-offline",
        },
      },
    );
  }
}

/**
 * Stale-while-revalidate: return cache immediately, refresh in background.
 * Falls back to /offline page if neither cache nor network is available.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached ?? (await networkPromise) ?? (await caches.match("/offline"));
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

function addCacheDateHeader(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Cache-Date", new Date().toISOString());
  return new Response(response.body, { status: response.status, headers });
}

function addOfflineHeader(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Served-By", "service-worker-cache");
  return new Response(response.body, { status: response.status, headers });
}
