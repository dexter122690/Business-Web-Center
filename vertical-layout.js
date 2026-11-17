/* Presentation only: account controls are static siblings of #nav in index.html.
   Feature modules may rebuild/reorder #nav; they must never own the account footer. */
(function(){
  'use strict';
  var order=['formsFolder','dashboard','invoices','expenses','inventoryTracker','repaintMonitoring','clients','purchaseorders','feedback','quotes','payroll','schedule','clientRequests'];
  var icons={formsFolder:'•',dashboard:'▦',invoices:'▤',expenses:'▣',inventoryTracker:'◇',repaintMonitoring:'▱',clients:'♧',purchaseorders:'🛒',feedback:'▢',quotes:'＄',payroll:'♙',schedule:'▣',clientRequests:'▤'};
  function buttonId(button){
    return button.dataset.restoreTab||button.dataset.t||({
      formsFolderTab:'formsFolder',scheduleTab:'schedule',clientRequestsTab:'clientRequests'
    }[button.id]||'');
  }
  var nav=document.getElementById('nav');
  var sidebar=document.getElementById('bwcSidebar');
  if(!nav||!sidebar)return;
  var observer=null;

  function arrange(){
    if(observer)observer.disconnect();
    try{
      var children=Array.from(nav.children);
      var sorted=children.slice().sort(function(a,b){
        var ai=order.indexOf(buttonId(a)),bi=order.indexOf(buttonId(b));
        return (ai<0?order.length:ai)-(bi<0?order.length:bi);
      });
      // Only move out-of-order nodes. Keep each existing button and its handlers.
      sorted.forEach(function(child,index){
        if(nav.children[index]!==child)nav.insertBefore(child,nav.children[index]||null);
      });
      nav.querySelectorAll('button').forEach(function(button){
        var id=buttonId(button);
        if(!id)return;
        var label=button.querySelector('.nav-label');
        if(!label){
          label=document.createElement('span');
          label.className='nav-label';
          while(button.firstChild)label.appendChild(button.firstChild);
          button.appendChild(label);
        }
        if(!button.querySelector('.nav-icon')){
          var icon=document.createElement('span');
          icon.className='nav-icon';
          icon.setAttribute('aria-hidden','true');
          icon.textContent=icons[id]||'•';
          button.insertBefore(icon,label);
        }
      });
    }finally{
      if(observer)observer.observe(nav,{childList:true});
    }
  }

  // Observe only the tab list, not the footer or the entire application.
  // Mutation callbacks run before paint, so late feature tabs do not cause a jump.
  if(window.MutationObserver)observer=new MutationObserver(arrange);
  arrange();

  var header=document.querySelector('header'),frame=null;
  function updateTop(){
    frame=null;
    var top=header?Math.max(0,Math.round(header.getBoundingClientRect().bottom)):0;
    var value=top+'px';
    if(sidebar.style.getPropertyValue('--sidebar-top')!==value){
      sidebar.style.setProperty('--sidebar-top',value);
    }
  }
  function scheduleTop(){
    if(frame===null)frame=window.requestAnimationFrame(updateTop);
  }
  if(header&&window.ResizeObserver)new ResizeObserver(scheduleTop).observe(header);
  window.addEventListener('resize',scheduleTop);
  window.addEventListener('scroll',scheduleTop,{passive:true});
  window.addEventListener('load',function(){arrange();updateTop()});
  updateTop();
}());
