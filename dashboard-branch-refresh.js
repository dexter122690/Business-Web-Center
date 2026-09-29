/* Do not reveal the dashboard until one complete, branch-matched report is ready. */
(function(){
  var waiting=true,timeout=0;
  var style=document.createElement('style');style.textContent='#dashboard.bwc-dashboard-loading{position:relative;min-height:480px}#dashboard.bwc-dashboard-loading>*{visibility:hidden}#dashboard.bwc-dashboard-loading:after{content:"Loading complete dashboard totals…";position:absolute;top:90px;left:0;right:0;text-align:center;color:#75645d;font-weight:bold;visibility:visible}#dashboard.bwc-dashboard-loading.bwc-dashboard-delayed:after{content:"Still loading complete sales and expense totals…"}';document.head.appendChild(style);
  function dashboard(){return document.getElementById('dashboard')}
  function finish(){waiting=false;clearTimeout(timeout);var view=dashboard();if(view)view.classList.remove('bwc-dashboard-loading','bwc-dashboard-delayed')}
  function begin(){waiting=true;clearTimeout(timeout);var view=dashboard();if(view){view.classList.remove('bwc-dashboard-delayed');view.classList.add('bwc-dashboard-loading')}timeout=setTimeout(function(){var current=dashboard();if(waiting&&current)current.classList.add('bwc-dashboard-delayed')},8000)}
  function complete(event){if(!waiting)return;var branchId=event.detail&&event.detail.branchId;if(!branchId||branchId===localStorage.getItem('bwc-active-branch'))finish()}
  document.addEventListener('bwc:branch-ready',begin);
  document.addEventListener('bwc:dashboard-period-changed',begin);
  document.addEventListener('bwc:dashboard-data-ready',complete);
  document.addEventListener('click',function(event){if(event.target&&event.target.closest('[data-t="dashboard"]'))begin()});
  begin();
})();
