/* Shared branch directory and selector. The picker is mounted immediately so it
   never falls back to the old "Your Branch" text while online records load. */
(function(){
  var config=window.BUSINESS_WEB_CENTER_SUPABASE||{},db=null,activeKey='bwc-active-branch';
  if(new URLSearchParams(location.search).has('branch'))history.replaceState(null,'',location.pathname+location.hash);

  function ready(){
    if(db)return Promise.resolve(true);
    if(!window.supabase||!config.url||!config.publishableKey)return Promise.resolve(false);
    db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);
    return Promise.resolve(true);
  }
  async function context(){
    if(!await ready())return null;
    var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user,businessId=localStorage.getItem('bwc-active-business');
    return user&&businessId?{user:user,businessId:businessId}:null;
  }
  function displayName(name){return name==='Main workspace'?'MAIN':name;}
  function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,function(character){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];});}
  function holder(){
    var current=document.querySelector('header .branch');
    if(current)return current;
    var header=document.querySelector('header'),settings=header&&header.querySelector('.settings-wrap');
    if(!header)return null;
    current=document.createElement('div');current.className='branch';
    if(settings)header.insertBefore(current,settings);else header.appendChild(current);
    return current;
  }
  function mount(){
    var target=holder();
    if(!target)return null;
    if(!target.querySelector('#onlineBranchPicker')){
      target.innerHTML='<b>BRANCH</b><select id="onlineBranchPicker" aria-label="Choose branch"><option value="">MAIN</option></select>';
    }
    return target.querySelector('#onlineBranchPicker');
  }
  function installStyle(){
    if(document.getElementById('onlineBranchPickerStyle'))return;
    var style=document.createElement('style');style.id='onlineBranchPickerStyle';
    style.textContent='header .branch{margin-left:auto!important;display:flex!important;align-items:center;gap:8px;font-size:11px;white-space:nowrap}header .branch select{display:inline-block!important;width:auto!important;min-width:106px;max-width:180px;background:#201b19!important;color:#fff!important;border:1px solid #8f6b5d!important;border-radius:6px!important;padding:6px 26px 6px 9px!important;font-weight:bold!important;cursor:pointer}@media(max-width:720px){header .branch{display:flex!important;order:3;margin-left:auto!important}header .branch b{display:none}header .branch select{min-width:82px;max-width:118px;font-size:10px;padding:6px 20px 6px 7px!important}}';
    document.head.appendChild(style);
  }
  async function list(){
    var c=await context();if(!c)return [];
    var result=await db.from('branches').select('id,name,address,contact_number,email').eq('business_id',c.businessId).eq('is_active',true).order('created_at');
    return result.error?[]:(result.data||[]);
  }
  async function ensureMain(){
    var c=await context(),rows=await list();
    if(!c||rows.length)return rows;
    var inserted=await db.from('branches').insert({business_id:c.businessId,name:'MAIN'});
    if(inserted.error)return rows;
    return list();
  }
  function render(rows){
    var picker=mount();if(!picker)return;
    var active=localStorage.getItem(activeKey)||'',chosen=rows.find(function(row){return row.id===active;})||rows[0];
    if(chosen)localStorage.setItem(activeKey,chosen.id);
    picker.innerHTML=rows.length?rows.map(function(row){return '<option value="'+escapeHtml(row.id)+'" '+(chosen&&row.id===chosen.id?'selected':'')+'>'+escapeHtml(displayName(row.name))+'</option>';}).join(''):'<option value="">MAIN</option>';
    picker.disabled=!rows.length;
    picker.onchange=function(){localStorage.setItem(activeKey,picker.value);location.reload();};
    if(chosen)document.dispatchEvent(new CustomEvent('bwc:branch-ready',{detail:{branchId:chosen.id}}));
  }
  async function refresh(){
    mount();
    var rows=await ensureMain();
    render(rows);
  }
  async function requestUpgrade(c,rows,limit){
    var request=await db.from('branch_upgrade_requests').insert({business_id:c.businessId,requested_by:c.user.id,current_branch_limit:limit,requested_branch_total:rows.length+1});
    if(request.error&&request.error.code!=='23505'){alert('The branch upgrade request could not be sent. '+request.error.message);return;}
    alert('Your plan includes '+limit+' branch. A request for branch '+(rows.length+1)+' was sent to the account owner. After payment is confirmed, the owner will approve your upgrade.');
  }
  async function create(){
    var c=await context();if(!c){alert('Please sign in again before creating a branch.');return;}
    if(!confirm('Each additional branch is a separate paid add-on. A branch upgrade request will be sent to the account owner for payment confirmation. Continue?'))return;
    var rows=await list(),management=await db.from('business_management').select('branch_limit').eq('business_id',c.businessId).maybeSingle(),limit=Number(management.data&&management.data.branch_limit||1);
    if(rows.length>=limit){await requestUpgrade(c,rows,limit);return;}
    var name=prompt('New branch name (for example: Sta. Rosa Branch):');if(name===null)return;name=name.trim();if(!name){alert('Enter a branch name first.');return;}
    var address=prompt('Branch address (optional):','');if(address===null)return;
    var result=await db.from('branches').insert({business_id:c.businessId,name:name,address:address.trim()||null});
    if(result.error){alert('The branch could not be created. '+result.error.message);return;}
    rows=await list();var created=rows.find(function(row){return row.name===name;});
    if(created)localStorage.setItem(activeKey,created.id);
    location.reload();
  }
  function bindCreate(){var button=document.getElementById('createBranchMenuButton');if(button)button.onclick=create;}
  function start(){refresh();bindCreate();}
  installStyle();mount();
  window.addEventListener('load',function(){setTimeout(start,80);setInterval(bindCreate,1000);setInterval(refresh,10000);});
  document.addEventListener('bwc:business-ready',start);
})();
