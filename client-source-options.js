/* Keep client sources specific for useful reporting. Legacy invoices that
   already use “Social media” remain unchanged; new invoices cannot select it. */
(function(){
  function removeGenericSocialMedia(){
    var source=document.getElementById('source');
    if(!source)return;
    Array.prototype.slice.call(source.options).forEach(function(option){
      if(String(option.value||option.textContent||'').trim().toLowerCase()==='social media')option.remove();
    });
  }
  new MutationObserver(removeGenericSocialMedia).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',removeGenericSocialMedia);
  window.addEventListener('load',function(){setTimeout(removeGenericSocialMedia,0)});
  document.addEventListener('bwc:branch-ready',function(){setTimeout(removeGenericSocialMedia,0)});
}());
