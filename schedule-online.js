/* Secure business appointment calendar. */
(function(){
  var config={},online=false;
  /* app-config.js loads asynchronously on the main dashboard. Always read it
     when Schedule is used, rather than keeping the empty configuration that
     existed during the first page milliseconds. */
  function refreshConfiguration(){
    config=window.BUSINESS_WEB_CENTER_SUPABASE||{};
    online=!!(config.url&&config.publishableKey&&config.url.indexOf('YOUR_')<0&&config.publishableKey.indexOf('YOUR_')<0);
    window.__bwcScheduleOnlineReady=online;
    return online;
  }
  refreshConfiguration();
  var db=null,starting=null;
  /* This flag prevents the older local handler from racing the secured save. */
  var key='15m-unit-schedule',editingId='',syncing=false;
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
  async function publicAppointmentToken(){
    var client=await start();var branchId=localStorage.getItem('bwc-active-branch');
    if(!businessId()||!branchId)return null;
    if(!client)throw new Error('Secure scheduling is still loading. Please try again in a moment.');
    var found=await client.from('branch_appointment_links').select('public_token').eq('business_id',businessId()).eq('branch_id',branchId).maybeSingle();
    if(found.error)throw found.error;
    if(found.data)return found.data.public_token;
    var created=await client.from('branch_appointment_links').insert({business_id:businessId(),branch_id:branchId}).select('public_token').single();
    if(created.error)throw created.error;
    return created.data&&created.data.public_token;
  }
  async function publicAppointmentShareUrl(){
    var client=await start(),token=await publicAppointmentToken();if(!token)return '';
    if(!client)throw new Error('Secure scheduling is still loading. Please try again in a moment.');
    var branchId=localStorage.getItem('bwc-active-branch');
    var result=await client.from('branch_appointment_links').select('short_code').eq('business_id',businessId()).eq('branch_id',branchId).maybeSingle();
    if(result.error)throw result.error;
    var code=String(result.data&&result.data.short_code||'').trim();
    /* Fall back to the existing link until the one-time short-link update is
       applied. This keeps booking available during deployment. */
    return code?new URL('book.html?c='+encodeURIComponent(code),location.origin).href:appointmentUrl(token);
  }
  /* The one permanent Copy client booking link button lives in the Client
     Appointment Requests card. Remove any old duplicate link card left by a
     cached page version. */
  function renderAppointmentLink(){var oldCard=document.getElementById('appointmentLinkCard');if(oldCard)oldCard.remove()}
  async function copyAppointmentText(text,button){
    if(!text)return;
    var copied=false;
    try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);copied=true}}catch(error){}
    if(!copied){
      var helper=document.createElement('textarea');helper.value=text;helper.setAttribute('readonly','');helper.style.cssText='position:fixed;opacity:0;pointer-events:none';document.body.appendChild(helper);helper.select();
      try{copied=document.execCommand('copy')}catch(error){}finally{helper.remove()}
    }
    if(copied){var label=button.textContent;button.textContent='Copied';setTimeout(function(){if(button.isConnected)button.textContent=label},1600);return}
    /* Some iPhone browsers do not allow programmatic clipboard access.  The
       prompt still lets the owner copy it manually. */
    window.prompt('Copy this appointment link:',text);
  }
  /* The permanent button in Client Appointment Requests calls this directly,
     so copying does not depend on a separate card rendering successfully. */
  window.bwcCopyClientAppointmentLink=async function(button){
    try{var link=await publicAppointmentShareUrl();if(!link)throw new Error('Choose a branch first.');await copyAppointmentText(link,button)}
    catch(error){alert('The appointment link could not be copied. '+(error.message||'Please try again.'))}
  };
  async function start(){
    if(!refreshConfiguration())return null;
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
    if(!refreshConfiguration()||!businessId()||syncing)return;syncing=true;
    try{
      await start();
      var query=db.from('scheduled_appointments').select('*').eq('business_id',businessId()),branchId=localStorage.getItem('bwc-active-branch');if(branchId)query=query.eq('branch_id',branchId);var result=await query.order('scheduled_date').order('scheduled_time');if(result.error)throw result.error;
      /* Ignore a response for a branch that was changed while it was loading. */
      if(branchId!==localStorage.getItem('bwc-active-branch'))return;
      /* Online scheduling is the source of truth.  Do not merge the old
         browser cache here: doing so can make a prior branch appear again. */
      var remote=(result.data||[]).map(localAppointment);write(remote);
      status('Appointments are saved securely online for this business.','info');
      /* A background refresh must never click a navigation tab. Both the
         staff calendar and the separate Client Requests tab listen for this. */
      if(repaint)document.dispatchEvent(new Event('bwc:schedule-loaded'));
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
    var edit=event.target.closest('[data-schedule-edit]');if(edit){editingId=edit.dataset.scheduleEdit;return}
    var cancel=event.target.closest('[data-schedule-cancel]');if(cancel){editingId='';return}
    var saveButton=event.target.closest('[data-schedule-save]');if(!saveButton||!online)return;
    event.preventDefault();event.stopImmediatePropagation();save(saveButton);
  },true);
  window.bwcRefreshSchedule=function(){return sync(true)};
  document.addEventListener('click',function(event){if(event.target.closest('#scheduleTab,#clientRequestsTab'))setTimeout(function(){sync(true);renderAppointmentLink()},120)});
  document.addEventListener('bwc:client-requests-rendered',function(){setTimeout(renderAppointmentLink,0)});
  document.addEventListener('bwc:branch-ready',function(){if(online)setTimeout(function(){sync(true)},40)});
  window.addEventListener('load',function(){setTimeout(function(){if(document.getElementById('schedule')&&document.getElementById('schedule').classList.contains('active'))sync(true)},350)});
})();
