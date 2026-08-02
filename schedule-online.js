/* Secure business appointment calendar. */
(function(){
  var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};
  var online=!!(window.supabase&&config.url&&config.publishableKey&&config.url.indexOf('YOUR_')<0&&config.publishableKey.indexOf('YOUR_')<0);
  var db=online?window.supabase.createClient(config.url,config.publishableKey):null;
  var key='15m-unit-schedule',editingId='',syncing=false;
  function businessId(){return localStorage.getItem('bwc-active-business')||''}
  function read(){try{var rows=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(rows)?rows:[]}catch(error){return []}}
  function write(rows){localStorage.setItem(key,JSON.stringify(rows))}
  function value(id){var input=document.getElementById(id);return input?input.value.trim():''}
  function uuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''))}
  function localAppointment(row){return {id:row.id,date:row.scheduled_date,time:row.scheduled_time?String(row.scheduled_time).slice(0,5):'',client:row.client_name,contact:row.contact_number,unit:row.vehicle,year:row.year_model||'',color:row.color||'',vehicle:row.vehicle+(row.year_model?' '+row.year_model:''),procedure:row.procedure||'',service:row.procedure||'',reference:row.reference_number||'',notes:row.notes||'',status:row.status||'Scheduled',online:true}}
  function status(message,kind){var root=document.getElementById('schedule');if(!root)return;var note=document.getElementById('scheduleOnlineStatus');if(!note){note=document.createElement('div');note.id='scheduleOnlineStatus';note.className='notice';var heading=root.querySelector('.heading');if(heading)heading.insertAdjacentElement('afterend',note)}note.textContent=message;note.style.borderLeftColor=kind==='error'?'#b63d25':''}
  async function user(){var result=await db.auth.getUser();return result.data&&result.data.user}
  async function sync(repaint){
    if(!online||!businessId()||syncing)return;syncing=true;
    try{
      var result=await db.from('scheduled_appointments').select('*').eq('business_id',businessId()).order('scheduled_date').order('scheduled_time');if(result.error)throw result.error;
      var remote=(result.data||[]).map(localAppointment),ids={};remote.forEach(function(item){ids[item.id]=true});read().forEach(function(item){if(!item.online&&!ids[item.id])remote.push(item)});write(remote);
      status('Appointments are saved securely online for this business.','info');
      if(repaint){var tab=document.getElementById('scheduleTab');if(tab&&typeof tab.onclick==='function')tab.onclick()}
    }catch(error){status('Online appointments could not load: '+error.message,'error')}finally{syncing=false}
  }
  async function save(button){
    var date=value('scheduleDate'),client=value('scheduleClient'),unit=value('scheduleVehicle'),contact=value('scheduleContact');
    if(!date||!client||!unit||!contact){alert('Enter the appointment date, client name, unit / vehicle, and contact number.');return}
    if(!businessId()){alert('Choose an active business before saving an appointment.');return}
    var account=await user();if(!account){alert('Please sign in again before saving this appointment.');return}
    var payload={scheduled_date:date,scheduled_time:value('scheduleTime')||null,client_name:client,contact_number:contact,vehicle:unit,year_model:value('scheduleYear')||null,color:value('scheduleColor')||null,procedure:value('scheduleService')||null,reference_number:value('scheduleReference')||null,notes:value('scheduleNotes')||null};
    button.disabled=true;var label=button.textContent;button.textContent='Saving securely...';
    try{
      var previousId=editingId,result;if(uuid(editingId))result=await db.from('scheduled_appointments').update(payload).eq('id',editingId).eq('business_id',businessId()).select().single();else{payload.business_id=businessId();payload.created_by=account.id;result=await db.from('scheduled_appointments').insert(payload).select().single()}if(result.error)throw result.error;
      var rows=read(),item=localAppointment(result.data),index=rows.findIndex(function(row){return row.id===previousId||row.id===item.id});if(index>=0)rows[index]=item;else rows.unshift(item);write(rows);
      editingId='';await sync(true);setTimeout(function(){var cancel=document.querySelector('#schedule [data-schedule-cancel]');if(cancel)cancel.click()},30);alert('Appointment saved securely online.');
    }catch(error){alert('The appointment could not be saved online. '+error.message);button.disabled=false;button.textContent=label}
  }
  window.addEventListener('click',function(event){
    var edit=event.target.closest('[data-schedule-edit]');if(edit){editingId=edit.dataset.scheduleEdit;return}
    var cancel=event.target.closest('[data-schedule-cancel]');if(cancel){editingId='';return}
    var saveButton=event.target.closest('[data-schedule-save]');if(!saveButton||!online)return;
    event.preventDefault();event.stopImmediatePropagation();save(saveButton);
  },true);
  document.addEventListener('click',function(event){if(event.target.closest('#scheduleTab'))setTimeout(function(){sync(true)},120)});
  window.addEventListener('load',function(){setTimeout(function(){if(document.getElementById('schedule')&&document.getElementById('schedule').classList.contains('active'))sync(true)},350)});
})();
