/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { assetPaths, buildId } from 'virtual:pwa-runtime-assets';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
};

const runtimeCachePrefix = `it-tools-assets-${encodeURIComponent(self.registration.scope)}-`;
const runtimeCacheName = `${runtimeCachePrefix}${buildId}`;
const runtimeAssets = new Set(assetPaths.map(path => new URL(path, self.registration.scope).href));

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), {
  // Missing static resources must retain their actual network failure, never the app HTML.
  denylist: [/\/assets\//, /\/(?:sw\.js|manifest\.webmanifest|bundle-report\.json)$/, /\/\.vite\//],
}));

registerRoute(
  ({ url, sameOrigin }) => sameOrigin && !url.search && runtimeAssets.has(url.href),
  new CacheFirst({
    cacheName: runtimeCacheName,
    plugins: [
      new ExpirationPlugin({ maxEntries: 160, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
      {
        // In particular, reject an HTML response from a hosting SPA fallback for a missing chunk.
        cacheWillUpdate: async ({ response }) => response.status === 200 && !response.headers.get('content-type')?.includes('text/html') ? response : null,
      },
    ],
  }),
);

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith(runtimeCachePrefix) && name !== runtimeCacheName).map(name => caches.delete(name)),
  )));
});
clientsClaim();
