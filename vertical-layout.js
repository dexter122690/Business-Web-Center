/* Optional vertical navigation presentation. Existing tabs and page logic remain unchanged. */
(function(){
  /* Keep the header controls hidden until the one-time sidebar mount is ready.
     This prevents a visible header-to-sidebar jump during startup. */
  if(document.body){
    document.body.classList.add('vertical-nav-pending');
    if(!document.getElementById('verticalLayoutPendingStyle')){
      var pendingStyle=document.createElement('style');
      pendingStyle.id='verticalLayoutPendingStyle';
      pendingStyle.textContent='body.vertical-nav-pending header .settings-wrap,body.vertical-nav-pending header .employee-clock-link,body.vertical-nav-pending header .logout{visibility:hidden}';
      document.head.appendChild(pendingStyle);
    }
  }
  var order=['formsFolder','dashboard','invoices','expenses','inventoryTracker','repaintMonitoring','clients','purchaseorders','feedback','quotes','payroll','schedule','clientRequests'];
  var icons={dashboard:'▦',invoices:'▤',expenses:'▣',inventoryTracker:'◇',repaintMonitoring:'▱',clients:'♧',purchaseorders:'🛒',feedback:'▢',quotes:'＄',payroll:'♙',schedule:'▣',clientRequests:'▤'};
  function buttonId(b){return b.dataset.restoreTab||b.dataset.t||({'formsFolderTab':'formsFolder','scheduleTab':'schedule','clientRequestsTab':'clientRequests'}[b.id]||'')}
  function arrange(){
    var nav=document.getElementById('nav');if(!nav)return;
    var footer=document.getElementById('navAccountFooter');
    order.forEach(function(id){var b=Array.from(nav.querySelectorAll('button')).find(function(x){return buttonId(x)===id});if(b){if(footer)footer.before(b);else nav.appendChild(b)}});
    nav.querySelectorAll('button').forEach(function(b){var id=buttonId(b);if(!id)return;var label=b.querySelector('.nav-label');if(!label){label=document.createElement('span');label.className='nav-label';while(b.firstChild)label.appendChild(b.firstChild);b.appendChild(label)}if(!b.querySelector('.nav-icon')){var icon=document.createElement('span');icon.className='nav-icon';icon.setAttribute('aria-hidden','true');icon.textContent=icons[id]||'•';b.insertBefore(icon,label)}});
  }
  function moveAccountControls(nav){
    if(!nav||document.getElementById('navAccountFooter'))return;
    var settings=document.querySelector('.settings-wrap'),logout=document.querySelector('.logout'),footer=document.createElement('div');
    footer.id='navAccountFooter';footer.className='nav-account-footer';
    if(settings)footer.appendChild(settings);
    if(logout)footer.appendChild(logout);
    nav.appendChild(footer);
  }
  var installed=false;
  function install(){
    var nav=document.getElementById('nav');
    if(!nav||installed)return;
    installed=true;
    document.body.classList.add('vertical-nav');
    if(!document.getElementById('verticalLayoutStyle')){var s=document.createElement('style');s.id='verticalLayoutStyle';s.textContent='body.vertical-nav{--sidebar-width:196px}body.vertical-nav nav#nav{position:fixed;z-index:30;left:0;top:81px;bottom:0;width:var(--sidebar-width);display:flex;flex-direction:column;align-items:stretch;gap:2px;padding:12px 9px;overflow-y:auto;overflow-x:hidden;border:0;border-right:1px solid var(--l);background:#fff}body.vertical-nav nav#nav button{display:flex;align-items:center;gap:11px;width:100%;min-height:38px;text-align:left;border:0;border-radius:7px;padding:9px 12px;background:#fff;color:#302823;font-size:12px}body.vertical-nav nav#nav button:hover,body.vertical-nav nav#nav button.active{background:var(--o);color:#fff;border-color:var(--o)}body.vertical-nav nav#nav .nav-icon{width:18px;flex:0 0 18px;text-align:center;font-size:16px;line-height:1}body.vertical-nav nav#nav .nav-account-footer{margin-top:auto;display:grid;gap:8px;padding:10px 3px 0;border-top:1px solid var(--l)}body.vertical-nav nav#nav .nav-account-footer .settings-wrap{width:100%;margin:0}body.vertical-nav nav#nav .nav-account-footer .settings-button{width:100%;margin:0;justify-content:flex-start}body.vertical-nav nav#nav .nav-account-footer .logout{width:100%;margin:0;justify-content:flex-start;background:#503021;color:#fff;border:1px solid #8f6b5d;border-radius:7px;padding:9px 12px}body.vertical-nav nav#nav .nav-account-footer .settings-menu{top:auto;right:auto;bottom:calc(100% + 8px);left:0;width:100%}body.vertical-nav nav#nav .nav-account-footer .settings-menu button{display:block;width:100%;min-height:0;padding:10px;text-align:left;background:#fff;color:#1d1d1d;border:0}body.vertical-nav nav#nav .nav-account-footer .settings-menu button:hover{background:#fff0e9;color:var(--o)}body.vertical-nav main{max-width:none;margin-left:var(--sidebar-width);padding:24px 26px 50px}body.vertical-nav nav#nav button[data-t="reports"],body.vertical-nav nav#nav button[data-t="inventory"],body.vertical-nav nav#nav button[data-restore-tab="reports"],body.vertical-nav nav#nav button[data-restore-tab="inventory"]{display:none!important}@media(max-width:760px){body.vertical-nav nav#nav{position:static;width:100%;height:auto;flex-direction:row;align-items:center;overflow-x:auto;overflow-y:hidden;padding:8px 10px;border-right:0;border-bottom:1px solid var(--l)}body.vertical-nav nav#nav button{width:auto;flex:0 0 auto;min-height:36px}body.vertical-nav nav#nav .nav-account-footer{margin-top:0;display:flex;flex:0 0 auto;gap:8px;padding:0;border-top:0}body.vertical-nav nav#nav .nav-account-footer .settings-wrap{width:auto}body.vertical-nav nav#nav .nav-account-footer .settings-button,body.vertical-nav nav#nav .nav-account-footer .logout{width:auto}body.vertical-nav main{margin-left:0;padding:18px 12px 40px}}';document.head.appendChild(s)}
    moveAccountControls(nav);
    arrange();
    document.body.classList.remove('vertical-nav-pending');
  }
  /* The nav is populated by the page's load handler. Install immediately after
     that handler so the account controls never paint in the header first. The
     branch lookup does not change the sidebar structure, so it must not trigger
     another move/reflow. */
  window.addEventListener('load',function(){install();setTimeout(arrange,0)});
}());
