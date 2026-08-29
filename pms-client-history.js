/* PMS service history. Every record belongs to the signed-in business and
   selected branch, so client maintenance information never mixes branches. */
(function(){
  var db=null,businessId='',userId='';
  function el(id){return document.getElementById(id)}
  function value(id){var node=el(id);return node?String(node.value||'').trim():''}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function branch(){return localStorage.getItem('bwc-active-branch')||''}
  function isPms(){
    return /\bpms\b/i.test(value('service'));
  }
  function pmsForm(){
    if(el('pmsServiceDetails'))return;
    var service=el('service');if(!service)return;
    var card=document.createElement('div');
    card.id='pmsServiceDetails';card.className='notice';card.style.marginTop='12px';
    card.innerHTML='<b>PMS service details</b><br><span class="muted">Save these once with the invoice so the client\'s next PMS visit is easy to review.</span><div class="three" style="margin-top:9px"><label>Odometer reading (km)<input id="pmsOdometer" type="number" min="0" step="1" placeholder="e.g., 45000"></label><label>Assigned technician<select id="pmsTechnician"><option value="">Select technician</option></select></label><label>Next PMS date<input id="pmsNextDate" type="date"></label></div><div class="two"><label>Next PMS at odometer (km)<input id="pmsNextOdometer" type="number" min="0" step="1" placeholder="e.g., 50000"></label><label>PMS notes<textarea id="pmsNotes" rows="2" placeholder="Oil used, filters changed, recommendations, or reminders"></textarea></label></div>';
    service.closest('.two').insertAdjacentElement('afterend',card);
    function toggle(){card.hidden=!isPms()} service.addEventListener('change',toggle);toggle();
  }
  async function loadTechnicians(){
    var select=el('pmsTechnician'),activeBranch=branch();if(!select||!db||!businessId||!activeBranch)return;
    var selected=select.value,result=await db.from('payroll_workers').select('id,full_name,position').eq('business_id',businessId).eq('branch_id',activeBranch).eq('is_active',true).order('full_name');
    if(result.error)return;
    select.innerHTML='<option value="">Select technician</option>'+(result.data||[]).map(function(row){return '<option value="'+esc(row.id)+'" data-name="'+esc(row.full_name)+'">'+esc(row.full_name)+(row.position?' - '+esc(row.position):'')+'</option>'}).join('');
    if(selected)select.value=selected;
  }
  function blank(v){return v===undefined||v===null||String(v).trim()===''}
  async function syncPms(invoiceId,invoice){
    if(!db||!businessId||!branch()||!invoiceId)return;
    var current=await db.from('pms_service_records').select('*').eq('invoice_id',invoiceId).maybeSingle();
    if(!isPms()&&!((invoice.services||[]).some(function(row){return /\bpms\b/i.test(String(row.n||row.service_name||'').trim())}))){
      if(current.data)await db.from('pms_service_records').delete().eq('invoice_id',invoiceId);return;
    }
    if(current.error)throw new Error(current.error.message);
    var old=current.data||{},tech=el('pmsTechnician'),option=tech&&tech.options[tech.selectedIndex],technicianId=value('pmsTechnician');
    function retained(formId,column){var v=value(formId);return blank(v)?(old[column]||null):v}
    var payload={
      business_id:businessId,branch_id:branch(),invoice_id:invoiceId,
      client_name:invoice.client||old.client_name||'Client',contact_number:invoice.contact||null,client_email:invoice.email||null,
      vehicle_make:invoice.make||null,vehicle_year_model:invoice.yearModel||null,vehicle_color:invoice.color||null,plate_number:invoice.plate||null,
      service_date:invoice.date||old.service_date||new Date().toISOString().slice(0,10),
      odometer_km:retained('pmsOdometer','odometer_km'),
      technician_worker_id:technicianId||old.technician_worker_id||null,
      technician_name:technicianId?(option&&option.dataset.name||option&&option.textContent||null):(old.technician_name||null),
      next_pms_date:retained('pmsNextDate','next_pms_date'),next_pms_odometer_km:retained('pmsNextOdometer','next_pms_odometer_km'),
      notes:retained('pmsNotes','notes'),created_by:userId
    };
    var saved=await db.from('pms_service_records').upsert(payload,{onConflict:'invoice_id'});if(saved.error)throw new Error(saved.error.message);
    document.dispatchEvent(new Event('bwc:pms-updated'));
  }
  function formatDate(date){if(!date)return '—';var d=new Date(date+'T00:00:00');return isNaN(d)?esc(date):d.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'})}
  async function renderHistory(){
    var clients=el('clients'),activeBranch=branch();if(!clients||!db||!businessId||!activeBranch)return;
    var box=el('pmsClientHistory');if(!box){box=document.createElement('div');box.id='pmsClientHistory';box.className='card';box.style.marginTop='14px';clients.appendChild(box)}
    var result=await db.from('pms_service_records').select('*').eq('business_id',businessId).eq('branch_id',activeBranch).order('service_date',{ascending:false});
    if(result.error){box.innerHTML='<div class="k">PMS history</div><h2>PMS client records</h2><div class="empty">PMS records are not available yet.</div>';return}
    var rows=result.data||[];
    box.innerHTML='<div class="k">PMS history</div><h2>PMS client records</h2><p class="muted">Completed PMS services for this branch, including odometer and next-visit details.</p>'+(rows.length?'<div style="overflow:auto"><table><thead><tr><th>CLIENT / VEHICLE</th><th>SERVICE DATE</th><th>ODOMETER</th><th>TECHNICIAN</th><th>NEXT PMS</th><th>NOTES</th></tr></thead><tbody>'+rows.map(function(row){var vehicle=[row.vehicle_make,row.vehicle_year_model,row.plate_number].filter(Boolean).join(' · ');var next=[formatDate(row.next_pms_date),row.next_pms_odometer_km?'at '+Number(row.next_pms_odometer_km).toLocaleString('en-PH')+' km':''].filter(function(x){return x&&x!=='—'}).join(' · ')||'—';return '<tr><td><b>'+esc(row.client_name)+'</b><br><small>'+esc(vehicle||'Vehicle not recorded')+'</small></td><td>'+formatDate(row.service_date)+'</td><td>'+(row.odometer_km?Number(row.odometer_km).toLocaleString('en-PH')+' km':'—')+'</td><td>'+esc(row.technician_name||'—')+'</td><td>'+esc(next)+'</td><td>'+esc(row.notes||'—')+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">No PMS client records have been saved for this branch yet.</div>');
  }
  function clearPms(){['pmsOdometer','pmsTechnician','pmsNextDate','pmsNextOdometer','pmsNotes'].forEach(function(id){var node=el(id);if(node)node.value=''})}
  async function start(){
    pmsForm();
    var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};
    if(!window.supabase||!config.url||!config.publishableKey){setTimeout(start,450);return}
    db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);
    var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;if(!user){setTimeout(start,700);return}
    userId=user.id;businessId=localStorage.getItem('bwc-active-business')||'';
    if(!businessId||!branch()){setTimeout(start,500);return}
    await loadTechnicians();await renderHistory();
    if(!window.__bwcPmsResetWrapped&&window.resetInvoice){var original=window.resetInvoice;window.resetInvoice=function(){original();clearPms();var panel=el('pmsServiceDetails');if(panel)panel.hidden=true};window.__bwcPmsResetWrapped=true}
  }
  window.bwcSyncPmsRecord=syncPms;
  document.addEventListener('bwc:branch-ready',function(){setTimeout(start,250)});
  document.addEventListener('bwc:workers-updated',function(){loadTechnicians()});
  document.addEventListener('bwc:invoices-loaded',function(){renderHistory()});
  document.addEventListener('bwc:pms-updated',function(){renderHistory()});
  setTimeout(start,700);
})();
