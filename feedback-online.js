/* Shares Client Feedback and the Owner Feedback inbox for the active business. */
(function(){
  var config=window.BUSINESS_WEB_CENTER_SUPABASE||{}, db=null, key='15m-replica-client-feedback';
  function read(){try{return JSON.parse(localStorage.getItem(key)||'[]')}catch(e){return []}}
  function write(items){localStorage.setItem(key,JSON.stringify(items))}
  function esc(value){return String(value||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function ready(){if(db)return Promise.resolve(true);if(!window.supabase||!config.url||!config.publishableKey)return Promise.resolve(false);db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);return Promise.resolve(true)}
  async function context(){if(!await ready())return null;var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user,businessId=localStorage.getItem('bwc-active-business');return user&&businessId?{user:user,businessId:businessId}:null}
  function mapped(rows){return (rows||[]).map(function(row){return {id:row.id,client:row.client_name||'Anonymous client',rating:row.rating||'',text:row.feedback_text,created:row.created_at}})}
  function renderOwner(){var root=document.getElementById('owner');if(!root)return;var items=read();root.innerHTML='<div class="heading"><div><div class="k">Private inbox</div><h1>Owner feedback inbox</h1><p class="muted">Every shared client comment appears here for your management team.</p></div></div>'+(items.length?'<div class="card">'+items.map(function(item){return '<div class="notice" style="margin-top:8px"><b>'+esc(item.text)+'</b><br><small>'+esc(item.client||'Anonymous client')+(item.rating?' · '+esc(item.rating)+'/5':'')+' · Submitted '+esc(item.created?new Date(item.created).toLocaleString():'')+'</small></div>'}).join('')+'</div>':'<div class="card empty">No client feedback has been received yet.</div>')}
  async function hydrate(){var c=await context();if(!c)return;var result=await db.from('business_feedback').select('*').eq('business_id',c.businessId).order('created_at',{ascending:false});if(result.error)return;write(mapped(result.data));if(document.getElementById('owner')&&document.getElementById('owner').classList.contains('active'))renderOwner()}
  async function persist(text){var c=await context();if(!c||!text)return;var result=await db.from('business_feedback').insert({business_id:c.businessId,client_name:'Anonymous client',feedback_text:text,source:'client',created_by:c.user.id});if(result.error){alert('Feedback could not be saved online. Please try again.');return}await hydrate();var message=document.getElementById('cfMessage');if(message)message.textContent='Thank you. Your feedback was shared with the business owner.'}
  document.addEventListener('click',function(event){
    if(event.target.closest('[data-t="feedback"], [data-t="owner"]'))setTimeout(hydrate,60);
    if(event.target.closest('[data-cf-submit]')){var input=document.getElementById('cfText'),text=input&&input.value.trim();setTimeout(function(){persist(text)},80)}
  },true);
  window.addEventListener('load',function(){setTimeout(hydrate,900)});
})();
