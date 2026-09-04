/* Keep a branch switch from showing another branch's cached dashboard totals. */
(function(){
  var waiting=true,coreReady=false,invoicesReady=false,expensesReady=false,timeout=0;
  var style=document.createElement('style');style.textContent='#dashboard.bwc-dashboard-loading{position:relative;min-height:480px}#dashboard.bwc-dashboard-loading>*{visibility:hidden}#dashboard.bwc-dashboard-loading:after{content:"Loading selected branch dashboard…";position:absolute;top:90px;left:0;right:0;text-align:center;color:#75645d;font-weight:bold;visibility:visible}';document.head.appendChild(style);
  function dashboard(){return document.getElementById('dashboard')}
  function finish(){waiting=false;clearTimeout(timeout);var view=dashboard();if(view)view.classList.remove('bwc-dashboard-loading')}
  function tryFinish(){if(waiting&&coreReady&&invoicesReady&&expensesReady)finish()}
  function begin(){waiting=true;coreReady=false;invoicesReady=false;expensesReady=false;clearTimeout(timeout);var view=dashboard();if(view)view.classList.add('bwc-dashboard-loading');timeout=setTimeout(finish,4500)}
  document.addEventListener('bwc:branch-ready',begin);
  document.addEventListener('bwc:dashboard-data-ready',function(event){if(!waiting)return;var branchId=event.detail&&event.detail.branchId;if(!branchId||branchId===localStorage.getItem('bwc-active-branch')){coreReady=true;tryFinish()}});
  document.addEventListener('bwc:invoices-loaded',function(){if(waiting){invoicesReady=true;tryFinish()}});
  document.addEventListener('bwc:expenses-loaded',function(){if(waiting){expensesReady=true;tryFinish()}});
  begin();
})();
