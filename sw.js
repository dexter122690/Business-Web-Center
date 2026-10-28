const CACHE_NAME = 'bwc-invoice-offline-v6';
const APP_SHELL = [
  '/index.html',
  '/auth.html',
  '/app-config.js',
  '/site.webmanifest',
  '/invoice-online.js',
  '/payroll-online.js?v=20261015-money-fix',
  '/invoice-discounts.js',
  '/invoice-payments-online.js',
  '/invoice-payment-print.js',
  '/invoice-pdf-actions.js',
  '/client-source-options.js',
  '/pms-client-history.js',
  '/forms-folder-online.js?v=20261024',
  '/vertical-layout.js',
  '/icons/bwc-app-icon.png?v=2'
];

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache) {
    return cache.addAll(APP_SHELL);
  }).then(function() { return self.skipWaiting(); }));
});

self.addEventListener('activate', function(event) {
  event.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(key) { return key !== CACHE_NAME; }).map(function(key) { return caches.delete(key); }));
  }).then(function() { return self.clients.claim(); }));
});

self.addEventListener('fetch', function(event) {
  var request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(function(response) {
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function(cache) { cache.put(request, copy); });
      return response;
    }).catch(function() { return caches.match(request).then(function(cached) { return cached || caches.match('/index.html'); }); }));
    return;
  }
  event.respondWith(caches.match(request, {ignoreSearch: true}).then(function(cached) {
    return cached || fetch(request).then(function(response) {
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function(cache) { cache.put(request, copy); });
      return response;
    });
  }));
});
