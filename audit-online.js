/* Owner/admin-only activity history. The database trigger is the source of truth. */
(function(){
  var config=window.BUSINESS_WEB_CENTER_SUPABASE||{},db=null;
  function ready(){
    if(db)return Promise.resolve(db);
    if(!window.supabase||!config.url||!config.publishableKey)return Promise.resolve(null);
    db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);
    return Promise.resolve(db);
  }
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function label(value){return String(value||'record').replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase()})}
  function open(){
    var menu=document.getElementById('settingsMenu');if(menu)menu.classList.remove('open');
    document.querySelectorAll('.view').forEach(function(view){view.classList.remove('active')});
    var page=document.getElementById('auditPage');if(page)page.classList.add('active');
    load();
  }
  async function load(){
    var page=document.getElementById('auditPage'),business=localStorage.getItem('bwc-active-business');if(!page||!business)return;
    page.innerHTML='<div class="heading"><div><div class="k">Activity history</div><h1>Business audit record</h1><p class="muted">A protected record of important changes made in this business.</p></div><div class="actions"><button class="secondary" type="button" id="auditRefresh">Refresh</button><button class="secondary" type="button" onclick="document.querySelector(\'[data-t=dashboard]\').click()">Back to dashboard</button></div></div><div class="card"><div id="auditStatus" class="empty">Loading activity history…</div><div id="auditTable"></div></div>';
    document.getElementById('auditRefresh').onclick=load;
    var client=await ready();if(!client){document.getElementById('auditStatus').textContent='Secure activity history is still loading. Refresh in a moment.';return}
    var query=client.from('audit_logs').select('id,branch_id,actor_id,actor_name,action,entity_type,entity_id,details,created_at').eq('business_id',business).order('created_at',{ascending:false}).limit(150);
    var branch=localStorage.getItem('bwc-active-branch');if(branch)query=query.eq('branch_id',branch);
    var result=await query,notice=document.getElementById('auditStatus'),table=document.getElementById('auditTable');
    if(result.error){notice.textContent=result.error.code==='42501'?'Only the business owner or an admin can view activity history.':'Activity history could not load: '+result.error.message;return}
    var rows=result.data||[];notice.textContent=rows.length?rows.length+' latest action'+(rows.length===1?'':'s')+' for this branch.':'No activity has been recorded for this branch yet.';
    if(!rows.length)return;
    table.innerHTML='<div style="overflow:auto"><table><thead><tr><th>Date and time</th><th>Action</th><th>Record</th><th>Performed by</th></tr></thead><tbody>'+rows.map(function(row){return '<tr><td>'+esc(new Date(row.created_at).toLocaleString())+'</td><td>'+esc(label(row.action))+'</td><td>'+esc(label(row.entity_type))+'</td><td>'+esc(row.actor_name||'System')+'</td></tr>'}).join('')+'</tbody></table></div>';
  }
  function mount(){
    var main=document.querySelector('main'),menu=document.getElementById('settingsMenu');if(!main||!menu)return;
    if(!document.getElementById('auditPage')){var page=document.createElement('section');page.id='auditPage';page.className='view';main.appendChild(page)}
    if(!document.getElementById('auditHistoryMenuButton')){var button=document.createElement('button');button.id='auditHistoryMenuButton';button.type='button';button.textContent='Activity history';button.onclick=open;menu.appendChild(button)}
  }
  window.openAuditHistory=open;
  window.addEventListener('load',function(){setTimeout(mount,250)});
  document.addEventListener('bwc:business-ready',function(){setTimeout(mount,100)});
})();
