/* Rotate this cache whenever app-shell JavaScript changes.  The previous
   worker ignored query strings, so a request for a newer versioned script
   could incorrectly receive an older cached file. */
const CACHE_NAME = 'bwc-invoice-offline-v42';
const OFFLINE_TOOLS = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js','https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'];
const APP_SHELL = [
  '/index.html',
  '/executive-print.js?v=20261121-payment-date-report',
  '/reporting-online.js?v=20261122-unpaid-details',
  '/dashboard-unpaid.js?v=20261122-unpaid-details',
  '/inventory-costing.js?v=20261122-reference-prices',
  '/inventory-tracker.js?v=20261122-receipt-costing',
  '/inventory-material-history.js?v=20261122-receipt-costing',
  '/purchase-orders-online.js?v=20261125-tracker-materials',
  '/expense-categories.js?v=20261121-category-register',
  '/expense-online.js?v=20261121-complete-category-register',
  '/tab-current-periods.js?v=20261121-expense-shared-period',
  '/auth.html',
  '/app-config.js',
  '/site.webmanifest',
  '/pms-rules.js?v=20261125-pms-payment',
  '/invoice-outbox.js?v=20261125-pms-payment',
  '/global-search.js?v=20261123-single-search',
  '/invoice-offline.js?v=20261123-offline-safe',
  '/invoice-online.js?v=20261125-pms-payment',
  '/service-category-report.js?v=20261122-service-categories',
  '/payroll-v2-online.js?v=20261125-job-items',
  '/staff-permissions.js?v=20261123-payroll-v2',
  '/legacy-payroll-pause.js?v=20261123-pause',
  '/payroll-online.js?v=20261123-pause',
  '/invoice-discounts.js?v=20261112-line-editor-totals',
  '/invoice-payments-online.js?v=20261123-offline-safe',
  '/invoice-payment-print.js?v=20261123-offline-print',
  '/invoice-pdf-actions.js?v=20260829',
  '/client-source-options.js?v=20260920-specific-sources',
  '/pms-client-history.js?v=20261125-pms-payment',
  '/forms-folder-online.js?v=20261024',
  '/vertical-layout.css?v=20261117-account-footer',
  '/vertical-layout.js?v=20261124-invoice-home',
  '/icons/bwc-app-icon.png?v=2',
  '/icons/15m-autocare-logo-transparent.png?v=1'
];

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(async function(cache) {
    // Cache the actual page dependencies, including branch/branding/access
    // scripts. Installing only the invoice adapter leaves offline reload broken.
    var response=await fetch('/index.html',{cache:'reload'});
    if(!response.ok)throw new Error('App shell unavailable');
    var html=await response.text(),assets=Array.from(html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)).map(function(m){return new URL(m[1],self.location.origin).href}).filter(function(url){return new URL(url).origin===self.location.origin});
    return cache.addAll(Array.from(new Set(APP_SHELL.concat(assets,OFFLINE_TOOLS).map(function(url){return new URL(url,self.location.origin).href}))));
  }).then(function() { return self.skipWaiting(); }));
});

self.addEventListener('activate', function(event) {
  event.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(key) { return key !== CACHE_NAME; }).map(function(key) { return caches.delete(key); }));
  }).then(function() { return self.clients.claim(); }));
});

self.addEventListener('fetch', function(event) {
  var request = event.request;
  if (request.method !== 'GET' || (new URL(request.url).origin !== self.location.origin && !OFFLINE_TOOLS.includes(request.url))) return;
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
self.addEventListener('message',function(event){
 if(event.data&&event.data.type==='BWC_OFFLINE_STATUS')event.waitUntil(caches.open(CACHE_NAME).then(async function(cache){var checks=await Promise.all(APP_SHELL.concat(OFFLINE_TOOLS).map(function(url){return cache.match(url)}));if(event.source)event.source.postMessage({type:'BWC_OFFLINE_STATUS',ready:checks.every(Boolean),version:42})}));
});
