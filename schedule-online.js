/* Secure business appointment calendar. */
(function(){
  var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};
  var online=!!(config.url&&config.publishableKey&&config.url.indexOf('YOUR_')<0&&config.publishableKey.indexOf('YOUR_')<0);
  var db=null,starting=null;
  /* This flag prevents the older local handler from racing the secured save. */
  window.__bwcScheduleOnlineReady=online;
  var key='15m-unit-schedule',editingId='',syncing=false,appointmentLinkRender=0;
  function businessId(){return localStorage.getItem('bwc-active-business')||''}
  function read(){try{var rows=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(rows)?rows:[]}catch(error){return []}}
  function write(rows){localStorage.setItem(key,JSON.stringify(rows))}
  function value(id){var input=document.getElementById(id);return input?input.value.trim():''}
  function uuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''))}
  /* Public appointment links create records without a staff creator.  Keep
     that source in the browser cache so Schedule can present client requests
     separately from appointments encoded by the team. */
  function localAppointment(row){return {id:row.id,branchId:row.branch_id||'',date:row.scheduled_date,time:row.scheduled_time?String(row.scheduled_time).slice(0,5):'',client:row.client_name,contact:row.contact_number,unit:row.vehicle,year:row.year_model||'',color:row.color||'',vehicle:row.vehicle+(row.year_model?' '+row.year_model:''),procedure:row.procedure||'',service:row.procedure||'',reference:row.reference_number||'',notes:row.notes||'',clientResponse:row.client_response||'confirmed',status:row.status||'Scheduled',createdBy:row.created_by||'',createdAt:row.created_at||'',appointmentSource:row.created_by?'staff':'client',online:true}}
  function status(message,kind){var root=document.getElementById('schedule');if(!root)return;var note=document.getElementById('scheduleOnlineStatus');if(!note){note=document.createElement('div');note.id='scheduleOnlineStatus';note.className='notice';var heading=root.querySelector('.heading');if(heading)heading.insertAdjacentElement('afterend',note)}note.textContent=message;note.style.borderLeftColor=kind==='error'?'#b63d25':''}
  function appointmentUrl(token){return new URL('appointment.html',location.href).href+'?token='+encodeURIComponent(token)}
  function escapeHtml(text){return String(text||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  async function publicAppointmentToken(){
    await start();var branchId=localStorage.getItem('bwc-active-branch');
    if(!businessId()||!branchId)return null;
    var found=await db.from('branch_appointment_links').select('public_token').eq('business_id',businessId()).eq('branch_id',branchId).maybeSingle();
    if(found.error)throw found.error;
    if(found.data)return found.data.public_token;
    var created=await db.from('branch_appointment_links').insert({business_id:businessId(),branch_id:branchId}).select('public_token').single();
    if(created.error)throw created.error;
    return created.data&&created.data.public_token;
  }
  async function renderAppointmentLink(){
    var schedule=document.getElementById('schedule');if(!schedule||!schedule.classList.contains('active')||!online)return;
    /* Several refresh events can arrive together.  Only the last request may
       draw the card, otherwise each completed request adds a duplicate. */
    var renderId=++appointmentLinkRender;
    var existing=document.getElementById('appointmentLinkCard');if(existing)existing.remove();
    try{
      var branchAtStart=localStorage.getItem('bwc-active-branch'),token=await publicAppointmentToken();
      if(renderId!==appointmentLinkRender||!token||branchAtStart!==localStorage.getItem('bwc-active-branch'))return;
      /* A card created by a previous refresh might have appeared while this
         request was loading.  Remove it before adding the one current card. */
      existing=document.getElementById('appointmentLinkCard');if(existing)existing.remove();
      var link=appointmentUrl(token),card=document.createElement('div');card.id='appointmentLinkCard';card.className='card';
      card.innerHTML='<div class="k">CLIENT APPOINTMENT LINK</div><h2>Let clients request an appointment</h2><p class="muted">Share this link for the selected branch. Client requests appear directly in this branch’s Schedule tab.</p><input id="appointmentPublicLink" readonly value="'+escapeHtml(link)+'" style="width:100%;box-sizing:border-box"><div class="actions" style="margin-top:10px"><button class="secondary" data-appointment-copy>Copy appointment link</button><button class="primary" data-appointment-print>Print appointment notice</button></div>';
      var calendar=schedule.querySelector('.schedule-layout');if(calendar)calendar.insertAdjacentElement('afterend',card);else schedule.appendChild(card);
    }catch(error){status('Appointment link could not load: '+error.message,'error')}
  }
  async function copyAppointmentLink(button){
    var link=document.getElementById('appointmentPublicLink');if(!link)return;
    var copied=false;
    try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(link.value);copied=true}}catch(error){}
    if(!copied){
      link.focus();link.select();link.setSelectionRange(0,link.value.length);
      try{copied=document.execCommand('copy')}catch(error){}
    }
    if(copied){var label=button.textContent;button.textContent='Copied';setTimeout(function(){if(button.isConnected)button.textContent=label},1600);return}
    /* Some iPhone browsers do not allow programmatic clipboard access.  The
       selected link and this prompt still let the owner copy it manually. */
    window.prompt('Copy this appointment link:',link.value);
  }
  function printAppointmentNotice(){var input=document.getElementById('appointmentPublicLink');if(!input)return;var w=window.open('','_blank');if(!w)return;w.document.write('<!doctype html><title>Book an appointment</title><style>@page{margin:.65in}body{font-family:Arial,sans-serif;text-align:center;color:#211815}h1{font-size:28px}p{font-size:16px;line-height:1.5}.link{border:1px solid #ddd;padding:12px;word-break:break-all}</style><h1>Book an appointment</h1><p>Use this link to request an appointment with this branch.</p><div class="link">'+escapeHtml(input.value)+'</div><script>window.onload=function(){window.print()}<\/script>');w.document.close()}
  async function start(){
    if(!online)return null;
    if(db)return db;
    if(starting)return starting;
    starting=(async function(){
      for(var attempts=0;attempts<30&&!window.supabase;attempts++)await new Promise(function(resolve){setTimeout(resolve,100)});
      if(!window.supabase)throw new Error('Secure scheduling is still loading. Please try again in a moment.');
      db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);
      return db;
    })();
    try{return await starting}finally{starting=null}
  }
  async function user(){var result=await db.auth.getUser();return result.data&&result.data.user}
  function timed(promise,ms){return Promise.race([promise,new Promise(function(resolve,reject){setTimeout(function(){reject(new Error('The secure connection timed out. Check your internet connection, then try saving again.'));},ms)})])}
  async function sync(repaint){
    if(!online||!businessId()||syncing)return;syncing=true;
    try{
      await start();
      var query=db.from('scheduled_appointments').select('*').eq('business_id',businessId()),branchId=localStorage.getItem('bwc-active-branch');if(branchId)query=query.eq('branch_id',branchId);var result=await query.order('scheduled_date').order('scheduled_time');if(result.error)throw result.error;
      /* Ignore a response for a branch that was changed while it was loading. */
      if(branchId!==localStorage.getItem('bwc-active-branch'))return;
      /* Online scheduling is the source of truth.  Do not merge the old
         browser cache here: doing so can make a prior branch appear again. */
      var remote=(result.data||[]).map(localAppointment);write(remote);
      status('Appointments are saved securely online for this business.','info');
      /* A background refresh must never click a navigation tab. */
      if(repaint&&document.getElementById('schedule')&&document.getElementById('schedule').classList.contains('active'))document.dispatchEvent(new Event('bwc:schedule-loaded'));
      setTimeout(renderAppointmentLink,0);
    }catch(error){status('Online appointments could not load: '+error.message,'error')}finally{syncing=false}
  }
  async function save(button){
    button.disabled=true;var label=button.textContent;button.textContent='Saving securely...';
    try{
      await start();
      var date=value('scheduleDate'),client=value('scheduleClient'),unit=value('scheduleVehicle'),contact=value('scheduleContact');
      if(!date||!client||!unit||!contact)throw new Error('Enter the appointment date, client name, unit / vehicle, and contact number.');
      if(!businessId())throw new Error('Choose an active business before saving an appointment.');
      var branchId=localStorage.getItem('bwc-active-branch');
      if(!branchId)throw new Error('Your branch is still loading. Wait two seconds, then try again.');
      var account=await timed(user(),10000);if(!account)throw new Error('Please sign in again before saving this appointment.');
      var payload={branch_id:branchId,scheduled_date:date,scheduled_time:value('scheduleTime')||null,client_name:client,contact_number:contact,vehicle:unit,year_model:value('scheduleYear')||null,color:value('scheduleColor')||null,procedure:value('scheduleService')||null,reference_number:value('scheduleReference')||null,notes:value('scheduleNotes')||null};
      var previousId=editingId,result;if(uuid(editingId))result=await timed(db.from('scheduled_appointments').update(payload).eq('id',editingId).eq('business_id',businessId()).select().single(),15000);else{payload.business_id=businessId();payload.created_by=account.id;result=await timed(db.from('scheduled_appointments').insert(payload).select().single(),15000)}if(result.error)throw result.error;
      var rows=read(),item=localAppointment(result.data),index=rows.findIndex(function(row){return row.id===previousId||row.id===item.id});if(index>=0)rows[index]=item;else rows.unshift(item);write(rows);
      editingId='';await sync(true);setTimeout(function(){var cancel=document.querySelector('#schedule [data-schedule-cancel]');if(cancel)cancel.click()},30);alert('Appointment saved securely online.');
    }catch(error){alert('The appointment could not be saved online. '+error.message);button.disabled=false;button.textContent=label}
  }
  document.addEventListener('click',function(event){
    var copy=event.target.closest('[data-appointment-copy]');if(copy){event.preventDefault();copyAppointmentLink(copy);return}
    if(event.target.closest('[data-appointment-print]')){printAppointmentNotice();return}
    var edit=event.target.closest('[data-schedule-edit]');if(edit){editingId=edit.dataset.scheduleEdit;return}
    var cancel=event.target.closest('[data-schedule-cancel]');if(cancel){editingId='';return}
    var saveButton=event.target.closest('[data-schedule-save]');if(!saveButton||!online)return;
    event.preventDefault();event.stopImmediatePropagation();save(saveButton);
  },true);
  document.addEventListener('click',function(event){if(event.target.closest('#scheduleTab'))setTimeout(function(){sync(true);renderAppointmentLink()},120)});
  document.addEventListener('bwc:branch-ready',function(){if(online)setTimeout(function(){sync(true)},40)});
  window.addEventListener('load',function(){setTimeout(function(){if(document.getElementById('schedule')&&document.getElementById('schedule').classList.contains('active'))sync(true)},350)});
})();
