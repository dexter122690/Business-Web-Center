/* Rotate this cache whenever app-shell JavaScript changes.  The previous
   worker ignored query strings, so a request for a newer versioned script
   could incorrectly receive an older cached file. */
const CACHE_NAME = 'bwc-invoice-offline-v25';
const APP_SHELL = [
  '/index.html',
  '/executive-print.js?v=20261121-payment-date-report',
  '/reporting-online.js?v=20261122-unpaid-details',
  '/dashboard-unpaid.js?v=20261122-unpaid-details',
  '/inventory-costing.js?v=20261122-reference-prices',
  '/inventory-tracker.js?v=20261122-receipt-costing',
  '/inventory-material-history.js?v=20261122-receipt-costing',
  '/expense-categories.js?v=20261121-category-register',
  '/expense-online.js?v=20261121-complete-category-register',
  '/tab-current-periods.js?v=20261121-expense-shared-period',
  '/auth.html',
  '/app-config.js',
  '/site.webmanifest',
  '/invoice-online.js?v=20261123-payroll-directory',
  '/service-category-report.js?v=20261122-service-categories',
  '/payroll-v2-online.js?v=20261123-online',
  '/staff-permissions.js?v=20261123-payroll-v2',
  '/legacy-payroll-pause.js?v=20261123-pause',
  '/payroll-online.js?v=20261123-pause',
  '/invoice-discounts.js?v=20261112-line-editor-totals',
  '/invoice-payments-online.js?v=20261113-payment-correction',
  '/invoice-payment-print.js?v=20260924-invoice-date',
  '/invoice-pdf-actions.js?v=20260829',
  '/client-source-options.js?v=20260920-specific-sources',
  '/pms-client-history.js?v=20261123-payroll-directory',
  '/forms-folder-online.js?v=20261024',
  '/vertical-layout.css?v=20261117-account-footer',
  '/vertical-layout.js?v=20261123-payroll-v2',
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
  // Payroll always needs the signed-in online context. Do not substitute the BWC shell.
  if (new URL(request.url).pathname.startsWith('/payroll-v2/')) {
    event.respondWith(fetch(request).catch(function(){return new Response('Payroll needs an internet connection. Reopen it when online.',{status:503,headers:{'Content-Type':'text/plain'}});}));return;
  }
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
