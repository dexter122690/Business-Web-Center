/* Applies the owner-assigned module permissions to an approved admin or staff member. */
(function(){
  var db=null, current=null;
  var labels={dashboard:'Dashboard',invoices:'Invoice Making',expenses:'Expenses',payroll:'Payroll',inventory:'Inventory',schedule:'Schedule'};
  function getDb(){
    if(db)return db;
    var c=window.BUSINESS_WEB_CENTER_SUPABASE||{};
    if(!window.supabase||!c.url||!c.publishableKey)return null;
    db=window.businessSupabase||window.supabase.createClient(c.url,c.publishableKey);
    return db;
  }
  function keyForButton(button){
    var text=(button.textContent||'').trim();
    return Object.keys(labels).filter(function(key){return labels[key]===text})[0]||'';
  }
  function isRestricted(){return current&&['admin','staff'].includes(current.role)}
  function permission(key){return (current&&current.permissions&&current.permissions[key])||'none'}
  function viewFor(key){return document.getElementById(key)}
  function apply(){
    if(!isRestricted())return;
    document.querySelectorAll('#nav button').forEach(function(button){
      var key=keyForButton(button); if(!key)return;
      button.hidden=permission(key)==='none';
      button.title=permission(key)==='view'?'View-only access':'';
    });
    Object.keys(labels).forEach(function(key){
      var view=viewFor(key); if(!view)return;
      var level=permission(key);
      view.dataset.access=level;
      if(level==='view'){
        view.querySelectorAll('input,select,textarea').forEach(function(field){field.disabled=true});
        view.querySelectorAll('button').forEach(function(button){
          var text=(button.textContent||'').toLowerCase();
          if(/add|create|save|delete|remove|record|issue|approve|suspend|update|transfer|remit/.test(text))button.disabled=true;
        });
      }
    });
  }
  async function load(){
    var client=getDb(),businessId=localStorage.getItem('bwc-active-business');
    if(!client||!businessId)return;
    var session=await client.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;
    if(!user)return;
    var result=await client.from('business_memberships').select('role,permissions,status').eq('business_id',businessId).eq('user_id',user.id).maybeSingle();
    if(result.error||!result.data||result.data.status!=='active')return;
    current=result.data; apply();
  }
  var observer=new MutationObserver(function(){if(isRestricted())apply()});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('bwc:branch-ready',function(){setTimeout(load,80)});
  window.addEventListener('load',function(){setTimeout(load,350)});
})();
