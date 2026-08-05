// BatchPort service worker.
//
// This used to be a pass-through worker whose only job was to make the app
// installable. It now does real caching, and it does it conservatively,
// because the failure mode of an over-eager service worker is worse than no
// service worker at all: a stale shell after a deploy, a swallowed server
// action, or an auth callback answered from cache are all things a user cannot
// diagnose or work around.
//
// The rules it follows, in the order they are applied:
//
//   1. Only GET is ever intercepted. Server actions are POSTs to the page URL
//      and photo uploads are POSTs to Supabase Storage; neither is touched.
//   2. /api/* and /auth/* are pure pass-through (the photo proxy is the single
//      exception, since it serves immutable images). The session refresh, the
//      PKCE exchange, geocoding, and every Supabase call go straight to the
//      network, exactly as they did before this file grew.
//   3. Navigations are NETWORK FIRST and their responses are never cached. A
//      deploy therefore cannot leave a stale page on screen: the only HTML in
//      any cache is /offline, and it is only ever served when the network
//      actually failed.
//   4. Build output under /_next/static is cache-first, which is safe because
//      those filenames contain a content hash.
//
// Cache lifetimes split on one question: is this build output, or is it the
// user's? Build output is versioned with SHELL_VERSION and wiped on activate.
// Photos and map tiles are not, because they survive deploys unchanged and
// re-downloading a traveller's cached trip because the CSS changed would be
// rude.

const SHELL_VERSION = "v1";

// Wiped whenever SHELL_VERSION changes.
const SHELL_CACHE = `batchport-shell-${SHELL_VERSION}`;
const STATIC_CACHE = `batchport-static-${SHELL_VERSION}`;

// Kept across deploys. These names are duplicated in
// src/lib/offline/constants.ts, which is the page-side writer for the photo
// cache; keep them in step.
const TILE_CACHE = "batchport-tiles-v1";
const PHOTO_CACHE = "batchport-photos-v1";

const OFFLINE_URL = "/offline";

// The offline globe has to work with no network at all, and both of these are
// local static files, so there is no third party to ask. countries.geojson is
// ~820KB and is the single largest thing here; without it the map renders no
// country fills, which is most of what the globe says.
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/data/countries.geojson",
  "/styles/dark-style.json",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

// Bounds. Cache Storage has no eviction policy of its own beyond the browser
// clearing the whole origin under pressure, so anything that grows per request
// needs a ceiling here.
//
// Tiles: 1200 at ~15KB each is roughly 18MB, about what panning around a few
// cities at street zoom actually produces. Static: 400 entries covers several
// deploys' worth of chunks, so a stale offline shell still finds its code.
const MAX_TILE_ENTRIES = 1200;
const MAX_STATIC_ENTRIES = 400;

// MapTiler's Cloud terms permit "a temporary personal cache (browser cache,
// mobile app cache, etc.) for use by a single end-user" and prohibit "batch or
// excessive bulk download of map tiles". Caching a tile the user has already
// looked at is the former. Nothing in this app walks a bounding box asking for
// tiles nobody requested, and the per-trip offline toggle says so out loud
// rather than quietly pre-downloading them.
const TILE_HOSTS = ["api.maptiler.com"];

function isTileRequest(url) {
  return TILE_HOSTS.includes(url.hostname);
}

// Public Storage objects are immutable at their path (an edited photo is a new
// upload), so they are safe to serve cache-first forever.
function isPhotoRequest(url) {
  if (url.pathname.startsWith("/storage/v1/object/public/batchport/")) {
    return true;
  }
  return url.pathname === "/api/photos/wikimedia/proxy";
}

function isStaticBuildAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isPrecachedAsset(url) {
  return (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/styles/") ||
    url.pathname.startsWith("/data/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico"
  );
}

// Trim oldest-first. Cache Storage keeps insertion order, so the first keys
// are the least recently added.
async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const excess = keys.length - maxEntries;
    for (let i = 0; i < excess; i += 1) {
      await cache.delete(keys[i]);
    }
  } catch {
    // Trimming is housekeeping; failing at it is never worth failing a request.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One at a time rather than addAll: addAll rejects the whole set if any
      // single URL fails, and an install that fails leaves the app with no
      // worker at all. A missing icon should not cost the offline page.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch {
            // Skip it; the fetch handler falls back to the network for
            // anything that did not precache.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE, TILE_CACHE, PHOTO_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("batchport-") && !keep.has(name))
          .map((name) => caches.delete(name)),
      );
      // Refresh the offline shell against the deploy that just went live, so
      // the fallback page is never a build behind the app around it.
      await refreshOfflineShell();
      await self.clients.claim();
    })(),
  );
});

async function refreshOfflineShell() {
  try {
    const response = await fetch(new Request(OFFLINE_URL, { cache: "reload" }));
    if (!response.ok) return;
    const cache = await caches.open(SHELL_CACHE);
    const body = await response.clone().text();
    await cache.put(OFFLINE_URL, response);
    await precacheShellAssets(body);
  } catch {
    // Offline at activate time: whatever was precached stays, which is the
    // point of having precached it.
  }
}

/**
 * Cache the build assets the offline page references.
 *
 * Precaching the HTML alone is not enough and the failure is silent: the page
 * is a client component, so without its chunks it renders an empty body, and
 * the user only finds out at the exact moment they have no connection to fix
 * it with. Nothing else fetches those chunks either, because a user who never
 * visited /offline while online never loaded them.
 *
 * Scraping the markup for /_next/static URLs is crude but it is derived from
 * the real document rather than a build manifest this file would have to be
 * generated from, and it re-runs on every deploy.
 */
async function precacheShellAssets(html) {
  const matches = html.match(/\/_next\/static\/[^"'\\)\s]+/g);
  if (!matches) return;
  const urls = Array.from(new Set(matches));
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    urls.map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch {
        // One missing chunk should not fail the rest.
      }
    }),
  );
}

// The page asks for this once per online load, so a deploy that lands while a
// tab is open still updates the fallback.
self.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object") return;
  if (event.data.type === "REFRESH_OFFLINE_SHELL") {
    event.waitUntil(refreshOfflineShell());
  }
  if (event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

// --- Strategies -----------------------------------------------------------

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Opaque responses (no-cors cross-origin) have status 0 and are cached
  // deliberately: a MapTiler tile or a Storage object fetched without CORS is
  // still perfectly renderable, and refusing to store it would mean no offline
  // tiles at all.
  if (response && (response.ok || response.type === "opaque")) {
    await cache.put(request, response.clone());
    if (maxEntries) void trimCache(cacheName, maxEntries);
  }
  return response;
}

// Photos requested in cors mode, which is what an <img crossOrigin="anonymous">
// sends. The poster and share card exports use that, because a canvas cannot
// be read back once an image drawn onto it tainted it.
//
// An opaque cached entry cannot answer a cors request: the spec turns that
// into a network error, so serving one would fail an export on exactly the
// photos the user had already looked at. So a cors request takes a non-opaque
// hit and otherwise goes to the network, and the cors response it gets back
// REPLACES whatever was cached. That upgrade is strictly an improvement: a
// cors response serves a no-cors request perfectly well, and the reverse is
// what this exists to avoid.
async function corsPhoto(request) {
  const cache = await caches.open(PHOTO_CACHE);
  const hit = await cache.match(request);
  if (hit && hit.type !== "opaque") return hit;

  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function navigationResponse(request, url) {
  try {
    return await fetch(request);
  } catch {
    // Redirect rather than serving the cached body under the requested URL.
    //
    // Serving /offline's HTML in answer to /trips/xyz looks like it works and
    // then reloads forever: the document carries the App Router's state for
    // the /offline route while location.pathname says /trips/xyz, so the
    // router tries to reconcile the two, fails to reach the network, and
    // navigates again. Redirecting makes the document's route and the address
    // bar agree, which is the only version of this that is stable.
    if (url.pathname !== OFFLINE_URL) {
      return Response.redirect(new URL(OFFLINE_URL, self.location.origin), 302);
    }
    const cache = await caches.open(SHELL_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response(
      "You are offline and the offline page has not been saved yet.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Rule 1: only GET. Server actions, uploads, and sign-out are all POSTs and
  // must never see a cache.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // Rule 2: auth and the API are pass-through, with the photo proxy exempted
  // because it serves immutable image bytes.
  if (sameOrigin && url.pathname.startsWith("/auth/")) return;
  if (sameOrigin && url.pathname.startsWith("/api/") && !isPhotoRequest(url)) {
    return;
  }

  // React Server Component payloads are per-deploy and per-route-state, so
  // there is nothing useful to cache and a stale one is actively harmful. Let
  // them fail offline: the router falls back to a full navigation, which the
  // navigation branch below answers with the offline shell.
  if (url.searchParams.has("_rsc")) return;

  if (isPhotoRequest(url)) {
    event.respondWith(
      (request.mode === "cors"
        ? corsPhoto(request)
        : cacheFirst(request, PHOTO_CACHE)
      ).catch(() => new Response("", { status: 504 })),
    );
    return;
  }

  if (isTileRequest(url)) {
    event.respondWith(
      cacheFirst(request, TILE_CACHE, MAX_TILE_ENTRIES).catch(
        () => new Response("", { status: 504 }),
      ),
    );
    return;
  }

  // Everything else cross-origin (Supabase REST and auth, Open-Meteo, Photon,
  // Nominatim) goes straight to the network.
  if (!sameOrigin) return;

  // Rule 3: navigations are network first and are never cached.
  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request, url));
    return;
  }

  // Rule 4: hashed build output is cache-first.
  if (isStaticBuildAsset(url)) {
    event.respondWith(
      cacheFirst(request, STATIC_CACHE, MAX_STATIC_ENTRIES).catch(
        () => new Response("", { status: 504 }),
      ),
    );
    return;
  }

  // Precached statics: serve from cache, refresh in the background. The
  // countries GeoJSON and the dark style change rarely and matter offline, so
  // the stale copy is always the right answer to render right now.
  if (isPrecachedAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) void cache.put(request, response.clone());
            return response;
          })
          .catch(() => null);
        if (hit) {
          void network;
          return hit;
        }
        const response = await network;
        return response ?? new Response("", { status: 504 });
      })(),
    );
  }
});
