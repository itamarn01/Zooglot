// Deliberately minimal service worker: it exists ONLY so the app can appear in
// the phone's share sheet (Web Share Target needs an installed PWA with a SW).
//
// It caches nothing. Offline caching in a CRM whose data is always live buys
// little and risks serving a stale build after every deploy — a class of bug
// that is miserable to diagnose. Every request except the share POST is left to
// the network untouched.

const SHARE_CACHE = 'zooglot-shared-audio';
const SHARE_KEY = '/__shared-audio';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-voice') return;

  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const file = form.get('audio');
      if (!file || !file.size) return Response.redirect('/index.html#shared-voice=empty', 303);

      // Hand the blob over through the Cache API — a redirect cannot carry it,
      // and the page that picks it up is a fresh navigation.
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(SHARE_KEY, new Response(file, {
        headers: {
          'Content-Type': file.type || 'audio/ogg',
          'X-Shared-Name': encodeURIComponent(file.name || 'shared.ogg'),
        },
      }));
      return Response.redirect('/index.html#shared-voice=1', 303);
    } catch {
      return Response.redirect('/index.html#shared-voice=error', 303);
    }
  })());
});
