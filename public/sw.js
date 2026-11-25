const CACHE = 'doc-a-pod-shell-v1';
const SHELL = ['/', '/style.css', '/app.js', '/icon.svg', '/manifest.webmanifest', '/icon-180.png', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('doc-a-pod-shell-') && key !== CACHE).map(key => caches.delete(key))))); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache private papers, library metadata, scripts, or audio.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
