/* Invoice-linked PMS details. Payment dates, not the service date, set the visit. */
(function(){
 var db=null,businessId='',R=window.BwcPmsRules,editId='',loadVersion=0,loading=false,loadError='',historyVersion=0;
 function el(id){return document.getElementById(id)}
 function value(id){return String(el(id)&&el(id).value||'').trim()}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
 function branch(){return localStorage.getItem('bwc-active-branch')||''}
 var formScope=(localStorage.getItem('bwc-active-business')||'')+':'+branch();
 function lines(){return typeof services==='undefined'?[]:services}
 function current(){return typeof edit!=='undefined'&&edit&&typeof inv!=='undefined'?inv.find(function(x){return x.id===edit}):null}
 function refresh(){
  var card=el('pmsServiceDetails');if(!card)return;
  var active=R.hasPms(lines()),selected=/\bpms\b/i.test(value('service'));card.hidden=!active&&!selected;
  ['pmsOdometer','pmsNextOdometer'].forEach(function(id){el(id).required=active||selected});
  ['pmsOdometer','pmsTechnician','pmsNextOdometer','pmsNotes'].forEach(function(id){el(id).readOnly=loading});
  var x=current(),payments=x?x.payments:[{date:value('paymentDate'),amount:value('paid')}],amount=typeof total==='function'?total():0,date=R.schedule(amount,payments);
  el('pmsNextDate').value=date;
  el('pmsDateHint').textContent=loading?'Loading saved PMS details…':loadError|| (date?'Automatic: 6 calendar months after full payment.':'Pending full payment with a recorded payment date.');
 }
 function clear(){++loadVersion;editId='';loading=false;loadError='';['pmsOdometer','pmsTechnician','pmsNextDate','pmsNextOdometer','pmsNotes'].forEach(function(id){if(el(id))el(id).value=''});refresh()}
 async function open(item){
  clear();if(!item||!item.remoteId)return;
  editId=item.remoteId;var id=editId,version=loadVersion,requestedBranch=branch();loading=true;refresh();
  try{if(!db)throw Error('PMS details are not connected yet. Reopen this invoice once connected.');var result=await db.from('pms_service_records').select('*').eq('invoice_id',id).eq('business_id',businessId).eq('branch_id',requestedBranch).maybeSingle();
   if(version!==loadVersion||id!==editId||requestedBranch!==branch())return;if(result.error)throw result.error;
   var p=result.data||{};[['pmsOdometer','odometer_km'],['pmsTechnician','technician_name'],['pmsNextOdometer','next_pms_odometer_km'],['pmsNotes','notes']].forEach(function(pair){el(pair[0]).value=p[pair[1]]==null?'':p[pair[1]]});
  }catch(e){if(version===loadVersion)loadError='PMS details could not load. Reopen this invoice before saving. '+e.message}finally{if(version===loadVersion){loading=false;refresh()}}
 }
 function collect(invoice){
  if(!R.hasPms(invoice.services))return {};
  if(loading||loadError)throw Error(loading?'Wait for the saved PMS details to load.':loadError);
  if(invoice.remoteId&&editId!==invoice.remoteId)throw Error('Reopen this invoice so its saved PMS details can load.');
  return R.details({odometer_km:value('pmsOdometer'),next_pms_odometer_km:value('pmsNextOdometer'),technician_name:value('pmsTechnician'),notes:value('pmsNotes')});
 }
 function mount(){
  if(el('pmsServiceDetails'))return;var service=el('service');if(!service||!R)return;
  var card=document.createElement('div');card.id='pmsServiceDetails';card.className='notice';card.style.marginTop='12px';
  card.innerHTML='<b>PMS service details</b><br><span class="muted">Both odometer readings are required for PMS invoices.</span><div class="three" style="margin-top:9px"><label>Odometer reading (km) *<input id="pmsOdometer" type="number" min="0" step="0.01" placeholder="e.g., 45000"></label><label>Assigned technician<input id="pmsTechnician" type="text" maxlength="200" placeholder="Type technician name"></label><label>Next PMS date (automatic)<input id="pmsNextDate" type="date" readonly aria-readonly="true"><small id="pmsDateHint"></small></label></div><div class="two"><label>Next PMS at odometer (km) *<input id="pmsNextOdometer" type="number" min="0" step="0.01" placeholder="e.g., 50000"></label><label>PMS notes<textarea id="pmsNotes" rows="2" placeholder="Oil used, filters changed, recommendations, or reminders"></textarea></label></div>';
  service.closest('.two').insertAdjacentElement('afterend',card);
  var oldEdit=window.editInvoice,oldReset=window.resetInvoice,oldLists=window.renderLists;
  if(oldEdit)window.editInvoice=function(id){oldEdit(id);open(current())};
  if(oldReset)window.resetInvoice=function(){oldReset();clear()};
  if(oldLists)window.renderLists=function(){oldLists();refresh()};
  new MutationObserver(refresh).observe(el('serviceList'),{childList:true,subtree:true});refresh();
 }
 function formatDate(date){return date?new Date(date+'T12:00:00').toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}):'Pending full payment'}
 async function renderHistory(){
  var clients=el('clients'),requestedBranch=branch(),version=++historyVersion;if(!clients||!db||!businessId||!requestedBranch)return;
  var box=el('pmsClientHistory');if(!box){box=document.createElement('div');box.id='pmsClientHistory';box.className='card';box.style.marginTop='14px';clients.appendChild(box)}
  var result=await db.from('pms_service_records').select('*').eq('business_id',businessId).eq('branch_id',requestedBranch).order('service_date',{ascending:false});
  if(version!==historyVersion||requestedBranch!==branch())return;
  if(result.error){box.innerHTML='<h2>PMS client records</h2><div class="empty">PMS records are not available yet.</div>';return}
  var rows=result.data||[];function km(n){return n==null?'—':Number(n).toLocaleString('en-PH')+' km'}
  box.innerHTML='<div class="k">PMS history</div><h2>PMS client records</h2><p class="muted">Next PMS date is 6 calendar months after full payment. Missing dated payment history stays pending.</p>'+(rows.length?'<div style="overflow:auto"><table><thead><tr><th>CLIENT / VEHICLE</th><th>SERVICE DATE</th><th>ODOMETER</th><th>TECHNICIAN</th><th>NEXT PMS</th><th>NOTES</th></tr></thead><tbody>'+rows.map(function(row){return '<tr><td><b>'+esc(row.client_name)+'</b><br><small>'+esc([row.vehicle_make,row.vehicle_year_model,row.plate_number].filter(Boolean).join(' · '))+'</small></td><td>'+esc(row.service_date)+'</td><td>'+km(row.odometer_km)+'</td><td>'+esc(row.technician_name||'—')+'</td><td>'+formatDate(row.next_pms_date)+' · '+km(row.next_pms_odometer_km)+'</td><td>'+esc(row.notes||'—')+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">No PMS client records have been saved for this branch yet.</div>');
 }
 async function start(){mount();db=window.getBusinessSupabaseClient&&window.getBusinessSupabaseClient();businessId=localStorage.getItem('bwc-active-business')||'';if(!db||!businessId||!branch()){setTimeout(start,700);return}await renderHistory()}
 window.BwcPmsForm={collect:collect,open:open,clear:clear,refresh:refresh};
 document.addEventListener('input',function(e){if(e.target.closest('#invoices'))refresh()});
 document.addEventListener('change',function(e){if(e.target.closest('#invoices'))refresh()});
 document.addEventListener('bwc:branch-ready',function(){var scope=(localStorage.getItem('bwc-active-business')||'')+':'+branch();if(scope!==formScope){formScope=scope;clear()}setTimeout(start,150)});
 ['bwc:invoices-loaded','bwc:pms-updated','bwc:invoice-payments-updated'].forEach(function(name){document.addEventListener(name,function(){refresh();renderHistory()})});
 mount();setTimeout(start,700);
})();
