/*
  Public browser configuration.
  This uses the Supabase publishable key only. Never add a service_role key.
*/
window.BUSINESS_WEB_CENTER_SUPABASE = {
  url: 'https://bcgrzfrxuccvmznafake.supabase.co',
  publishableKey: 'sb_publishable_jNlv1zVj4lBbbBBgVMYTug_zBLiCfOK'
};

/* Phone shortcut / installed-app identity. Kept here so all app pages that
   load the shared configuration receive the same BWC icon automatically. */
(function () {
  var head = document.head;
  if (!head) return;
  function add(tag, attributes) {
    var identity = attributes.rel || attributes.name || attributes.href;
    if (head.querySelector(tag + '[data-bwc-app-icon="' + identity + '"]')) return;
    var element = document.createElement(tag);
    element.setAttribute('data-bwc-app-icon', identity);
    Object.keys(attributes).forEach(function (key) { element.setAttribute(key, attributes[key]); });
    head.appendChild(element);
  }
  add('link', { rel: 'manifest', href: '/site.webmanifest' });
  add('link', { rel: 'icon', href: '/icons/bwc-app-icon.png?v=2', type: 'image/png' });
  add('link', { rel: 'apple-touch-icon', href: '/icons/bwc-app-icon.png?v=2' });
  add('meta', { name: 'theme-color', content: '#080808' });
  add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' });
  add('meta', { name: 'apple-mobile-web-app-title', content: 'BWC' });
}());
