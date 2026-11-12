/* Rotate this cache whenever app-shell JavaScript changes.  The previous
   worker ignored query strings, so a request for a newer versioned script
   could incorrectly receive an older cached file. */
const CACHE_NAME = 'bwc-invoice-offline-v11';
const APP_SHELL = [
  '/index.html',
  '/auth.html',
  '/app-config.js',
  '/site.webmanifest',
  '/invoice-online.js?v=20261112-edit-mode-fallback8',
  '/payroll-online.js?v=20261015-money-fix',
  '/invoice-discounts.js?v=20261112-line-editor-totals',
  '/invoice-payments-online.js?v=20260921-unremitted-closure-fix',
  '/invoice-payment-print.js?v=20260924-invoice-date',
  '/invoice-pdf-actions.js?v=20260829',
  '/client-source-options.js?v=20260920-specific-sources',
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
  /* Respect each asset's version query string.  This is what allows a newly
     deployed invoice script to replace an older cached one. */
  event.respondWith(caches.match(request).then(function(cached) {
    return cached || fetch(request).then(function(response) {
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function(cache) { cache.put(request, copy); });
      return response;
    });
  }));
});
