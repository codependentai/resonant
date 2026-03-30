/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';

const CACHE_NAME = `pulse-cache-${version}`;

// Immutable assets: hashed JS/CSS bundles from the build
const IMMUTABLE_ASSETS = new Set(build);
// Static files: icons, manifest, fonts
const STATIC_ASSETS = new Set(files);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...build, ...files]))
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET, API calls, WebSocket upgrades, and external requests
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws') ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Navigation requests (HTML pages): network-first so updates show immediately
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache the fresh page for offline fallback
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          return response;
        })
        .catch(() => {
          // Offline: serve cached page or fall back to /chat shell
          return caches.match(event.request)
            .then((cached) => cached || caches.match('/chat'))
            .then((cached) => cached || new Response('Offline', { status: 503 }));
        })
    );
    return;
  }

  // Immutable assets (hashed JS/CSS): cache-first, they never change
  if (IMMUTABLE_ASSETS.has(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          return response;
        });
      })
    );
    return;
  }

  // Static files (icons, manifest): stale-while-revalidate
  if (STATIC_ASSETS.has(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response));
          }
          return response.clone();
        }).catch(() => undefined);

        return cached || fetchPromise || new Response('Offline', { status: 503 });
      })
    );
    return;
  }

  // Everything else: network-first
  event.respondWith(
    fetch(event.request)
      .then((response) => response)
      .catch(() => caches.match(event.request).then((c) => c || new Response('Offline', { status: 503 })))
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Simon', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { threadId: data.threadId, url: data.url || '/chat' },
      tag: data.tag || 'simon-message',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/chat';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if one is open to /chat
      for (const client of windowClients) {
        if (client.url.includes('/chat') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(url);
    })
  );
});
