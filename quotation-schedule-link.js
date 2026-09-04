/* Link a saved quotation to one scheduled unit in the active branch. */
(function(){
  var db=null,schedules=[];
  function client(){var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};if(db)return db;if(!window.supabase||!config.url||!config.publishableKey)return null;db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);return db}
  function esc(value){return String(value||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function business(){return localStorage.getItem('bwc-active-business')||''}
  function branch(){return localStorage.getItem('bwc-active-branch')||''}
  function quoteKey(){return {client:(document.getElementById('qtClient')||{}).value||'',date:(document.getElementById('qtDate')||{}).value||'',vehicle:(document.getElementById('qtVehicle')||{}).value||'',plate:(document.getElementById('qtPlate')||{}).value||''}}
  function localQuote(){var key=quoteKey(),all=[];try{all=JSON.parse(localStorage.getItem('15m-replica-quotes')||'[]')}catch(error){}return all.find(function(q){return q.client===key.client&&q.date===key.date&&q.vehicle===key.vehicle&&q.plate===key.plate})||all[0]||null}
  function optionLabel(row){return [row.scheduled_date||'',row.scheduled_time?String(row.scheduled_time).slice(0,5):'',row.client_name||'',row.vehicle||'',row.year_model||'',row.color||''].filter(Boolean).join(' · ')}
  async function loadSchedules(){
    var api=client(),businessId=business(),branchId=branch();if(!api||!businessId||!branchId)return [];
    var result=await api.from('scheduled_appointments').select('id,scheduled_date,scheduled_time,client_name,contact_number,vehicle,year_model,color,reference_number,notes,status').eq('business_id',businessId).eq('branch_id',branchId).neq('status','Cancelled').order('scheduled_date').order('scheduled_time');
    schedules=result.error?[]:(result.data||[]);return schedules;
  }
  function fillScheduleChoices(){
    var select=document.getElementById('qtScheduledUnit');if(!select)return;
    var chosen=select.value;select.innerHTML='<option value="">Choose scheduled unit (optional)</option>'+schedules.map(function(row){return '<option value="'+esc(row.id)+'">'+esc(optionLabel(row))+'</option>'}).join('');
    if(schedules.some(function(row){return row.id===chosen}))select.value=chosen;
    var note=document.getElementById('qtScheduleLinkNote');if(note)note.textContent=schedules.length?'Choose the scheduled unit that this quotation is for.':'No scheduled units are available in this branch yet.';
  }
  function mount(){
    var root=document.getElementById('quotes'),save=document.querySelector('#quotes [data-qt="save-ready"]');if(!root||!save)return;
    if(!document.getElementById('qtScheduledUnit')){
      var form=document.querySelector('#quotes .split .card .formgrid');if(!form)return;
      var label=document.createElement('label');label.className='full';label.innerHTML='Link to scheduled unit<select id="qtScheduledUnit"><option value="">Loading scheduled units…</option></select><small id="qtScheduleLinkNote" class="muted">Choose the scheduled unit that this quotation is for.</small>';
      form.appendChild(label);
      label.querySelector('select').addEventListener('change',function(){var selected=schedules.find(function(row){return row.id===this.value});if(!selected)return;var client=document.getElementById('qtClient'),contact=document.getElementById('qtContact'),vehicle=document.getElementById('qtVehicle');if(client&&!client.value)client.value=selected.client_name||'';if(contact&&!contact.value)contact.value=selected.contact_number||'';if(vehicle&&!vehicle.value)vehicle.value=[selected.vehicle,selected.year_model].filter(Boolean).join(' ');});
      loadSchedules().then(fillScheduleChoices);
    }
    if(!document.querySelector('#quotes [data-qt-link-schedule]')){var button=document.createElement('button');button.type='button';button.className='primary';button.dataset.qtLinkSchedule='1';button.textContent='Save & link to scheduled unit';save.insertAdjacentElement('afterend',button)}
  }
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms)})}
  async function remoteQuote(number){
    var api=client(),businessId=business(),branchId=branch();if(!api||!number||!businessId||!branchId)return null;
    for(var attempt=0;attempt<5;attempt++){var result=await api.from('quotations').select('id,quotation_number,details').eq('business_id',businessId).eq('branch_id',branchId).eq('quotation_number',number).maybeSingle();if(!result.error&&result.data)return result.data;await wait(350)}
    return null;
  }
  function linkedReference(previous,number){var cleaned=String(previous||'').replace(/(?:\s*\|\s*)?QT-[A-Z0-9-]+/gi,'').trim();return cleaned?cleaned+' | '+number:number}
  async function link(){
    var select=document.getElementById('qtScheduledUnit'),scheduleId=select&&select.value;if(!scheduleId){alert('Choose the scheduled unit first.');return}
    var normalSave=document.querySelector('#quotes [data-qt="save-ready"]');if(!normalSave)return;
    normalSave.click();
    await wait(500);
    var quote=localQuote();if(!quote){alert('Save the quotation first, then link it to the scheduled unit.');return}
    var remote=await remoteQuote(quote.number);if(!remote){alert('The quotation was saved, but its scheduled-unit link is still loading. Please try the link button again in a moment.');return}
    var api=client(),schedule=schedules.find(function(row){return row.id===scheduleId});if(!api||!schedule){await loadSchedules();schedule=schedules.find(function(row){return row.id===scheduleId})}if(!schedule){alert('That scheduled unit is no longer available. Refresh and try again.');return}
    var quoteUpdate=await api.from('quotations').update({details:Object.assign({},remote.details||{},{scheduled_appointment_id:scheduleId})}).eq('id',remote.id).eq('business_id',business()).eq('branch_id',branch());
    if(quoteUpdate.error){alert('The quotation was saved, but it could not be linked. '+quoteUpdate.error.message);return}
    var scheduleUpdate=await api.from('scheduled_appointments').update({reference_number:linkedReference(schedule.reference_number,remote.quotation_number),notes:(String(schedule.notes||'').indexOf('Linked quotation: '+remote.quotation_number)>=0?String(schedule.notes||''):String(schedule.notes||'').trim()+(schedule.notes?'\n':'')+'Linked quotation: '+remote.quotation_number)}).eq('id',scheduleId).eq('business_id',business()).eq('branch_id',branch());
    if(scheduleUpdate.error){alert('The quotation was saved, but the scheduled unit could not be updated. '+scheduleUpdate.error.message);return}
    await loadSchedules();fillScheduleChoices();if(window.bwcRefreshSchedule)window.bwcRefreshSchedule();
    alert('Quotation '+remote.quotation_number+' was saved and linked to the selected scheduled unit.');
  }
  document.addEventListener('click',function(event){var button=event.target.closest('[data-qt-link-schedule]');if(!button)return;event.preventDefault();link()},true);
  new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('bwc:schedule-loaded',function(){loadSchedules().then(fillScheduleChoices)});
  document.addEventListener('bwc:branch-ready',function(){setTimeout(function(){loadSchedules().then(fillScheduleChoices)},120)});
  window.addEventListener('load',function(){setTimeout(mount,180)});
})();
