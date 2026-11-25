/* Paid-only, branch-scoped carwash register and shared reporting helpers. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.BWCCarwash=api;api.mount(root)}})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function money(v){return '₱'+Number(v||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}
 function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
 function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Enter a valid date.');var d=new Date(value+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==value)throw Error('Enter a valid date.');return d}
 function add(value,days){var d=date(value);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
 function week(value){var d=date(value),from=add(value,-((d.getUTCDay()+1)%7));return {from:from,to:add(from,6)}}
 function monthRange(year,month){year=Number(year);month=Number(month);if(!Number.isInteger(year)||year<1900||year>2100||!Number.isInteger(month)||month<1||month>12)throw Error('Choose a valid month and year.');var from=year+'-'+String(month).padStart(2,'0')+'-01',to=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);return {from:from,to:to,readFrom:week(from).from,readTo:week(to).to}}
 function active(rows){return rows.filter(r=>!r.voided_at)}
 function sum(rows){return rows.reduce((n,r)=>n+Math.round(Number(r.price)*100),0)/100}
 function summarize(rows,year,month){
  var range=monthRange(year,month),valid=active(rows),monthly=valid.filter(r=>r.service_date>=range.from&&r.service_date<=range.to),days={};
  monthly.forEach(r=>{if(!days[r.service_date])days[r.service_date]=[];days[r.service_date].push(r)});
  var weeks=[];for(var start=range.readFrom;start<=range.to;start=add(start,7)){var end=add(start,6),items=valid.filter(r=>r.service_date>=start&&r.service_date<=end);weeks.push({from:start,to:end,count:items.length,total:sum(items)})}
  return {range:range,rows:monthly,total:sum(monthly),count:monthly.length,days:Object.keys(days).sort().map(d=>({date:d,count:days[d].length,total:sum(days[d])})),weeks:weeks};
 }
 function payload(values,latest){
  var d=String(values.service_date||''),unit=String(values.unit||'').trim(),plate=String(values.plate_number||'').trim().toUpperCase(),price=String(values.price||'').trim();date(d);
  if(d>(latest||today()))throw Error('Future paid carwash records are not allowed.');
  if(!unit||unit.length>160||!plate||plate.length>40)throw Error('Enter the unit and plate number. Use N/A if there is no plate.');
  if(!/^\d+(\.\d{1,2})?$/.test(price)||Number(price)<=0||Number(price)>9999999999.99)throw Error('Enter a price greater than zero, with at most two decimal places.');
  return {action:'save',id:values.id,revision:Number(values.revision||0),service_date:d,unit:unit,plate_number:plate,price:price};
 }
 function missing(error){return error&&['42P01','PGRST205','PGRST202'].includes(error.code)}
 async function read(db,scope,from,to){
  if(!scope.businessId)throw Error('Select a business first.');var rows=[],seen=new Set(),expected=null;
  for(var offset=0;;){
   var q=db.from('carwash_records').select('id,business_id,branch_id,service_date,unit,plate_number,price,revision,voided_at',{count:'exact'}).eq('business_id',scope.businessId).is('voided_at',null);
   if(scope.branchId)q=q.eq('branch_id',scope.branchId);if(from)q=q.gte('service_date',from);if(to)q=q.lte('service_date',to);
   var result=await q.order('service_date',{ascending:true}).order('id',{ascending:true}).range(offset,offset+499);
   if(result.error)throw result.error;
   if(!Number.isInteger(result.count)||(expected!==null&&expected!==result.count))throw Error('Carwash records changed while loading. Please refresh.');expected=result.count;
   var page=result.data||[];page.forEach(r=>{if(!r.id||seen.has(r.id)||r.business_id!==scope.businessId||(scope.branchId&&r.branch_id!==scope.branchId)||r.voided_at||!Number.isFinite(Number(r.price))||Number(r.price)<=0)throw Error('Carwash records could not be verified for this branch.');date(r.service_date);seen.add(r.id);rows.push(r)});
   if(rows.length===expected)return rows;if(!page.length||rows.length>expected)throw Error('Incomplete carwash records. Please refresh.');offset+=page.length;
  }
 }
 async function reportRows(db,scope){try{return {rows:await read(db,scope),available:true}}catch(error){if(missing(error))return {rows:[],available:false};throw error}}
 function mount(root){
  var doc=root.document,box,tab,rows=[],access={},currentScope='',version=0,busy=false,activeSave=null,editing=null,pending=null,dirty=false,cancelConfirm=null;
  var now=today(),year=Number(now.slice(0,4)),month=Number(now.slice(5,7)),mode='records',notice='';
  function db(){return root.getBusinessSupabaseClient&&root.getBusinessSupabaseClient()||root.businessSupabase}
  function scope(){return {businessId:root.localStorage.getItem('bwc-active-business')||'',branchId:root.localStorage.getItem('bwc-active-branch')||''}}
  function key(){return JSON.stringify(scope())}
  function message(text){notice=text;var el=doc.getElementById('carwashNotice');if(el)el.textContent=text}
  function lockForm(locked){var form=doc.getElementById('cwForm');if(form)Array.from(form.elements).forEach(e=>e.disabled=locked);['cwMonth','cwYear'].forEach(id=>{var el=doc.getElementById(id);if(el)el.disabled=locked})}
  function contextChanged(){return currentScope!==key()}
  function canEdit(){return !!access.can_edit&&!contextChanged()&&!busy}
  function render(){
   if(!box)return;var s=summarize(rows,year,month),name=new Date(Date.UTC(year,month-1,1)).toLocaleDateString('en-PH',{month:'long',year:'numeric',timeZone:'UTC'}),edit=editing||{service_date:today()>=s.range.from&&today()<=s.range.to?today():s.range.from,unit:'',plate_number:'',price:''};
   box.innerHTML='<div class="cw-heading"><h1>CARWASH</h1><div class="cw-filters"><label>Month<select id="cwMonth">'+Array.from({length:12},(_,i)=>'<option value="'+(i+1)+'"'+(month===i+1?' selected':'')+'>'+new Date(Date.UTC(2026,i,1)).toLocaleDateString('en-PH',{month:'long',timeZone:'UTC'})+'</option>').join('')+'</select></label><label>Year<input id="cwYear" type="number" min="1900" max="2100" step="1" value="'+year+'"></label><button type="button" data-cw="refresh" class="secondary">Refresh</button></div></div><p id="carwashNotice" role="status">'+esc(notice)+'</p><div class="card"><h2>Carwash record · '+esc(name)+'</h2><p class="muted">Paid carwash only. Date is the payment-received date. Do not enter the same service again in Invoice Making.</p>'+(access.can_edit?'<form id="cwForm"><div class="cw-entry"><label>Date<input name="service_date" type="date" required max="'+today()+'" value="'+esc(edit.service_date)+'"></label><label>Unit<input name="unit" required maxlength="160" placeholder="e.g. Honda City" value="'+esc(edit.unit)+'"></label><label>Plate #<input name="plate_number" required maxlength="40" placeholder="Plate number or N/A" value="'+esc(edit.plate_number)+'"></label><label>Price / received (₱)<input name="price" type="number" required min="0.01" max="9999999999.99" step="0.01" placeholder="0.00" value="'+esc(edit.price)+'"></label></div><div class="cw-actions"><button type="submit">'+(editing?'Save changes':'Save record')+'</button>'+(editing?'<button type="button" class="secondary" data-cw="cancel">Cancel edit</button>':'')+'</div></form>':'')+'<div class="cw-table"><table><thead><tr><th>Date</th><th>Unit</th><th>Plate #</th><th>Price</th>'+(access.can_edit?'<th>Action</th>':'')+'</tr></thead><tbody>'+s.rows.map(r=>'<tr><td>'+esc(r.service_date)+'</td><td>'+esc(r.unit)+'</td><td>'+esc(r.plate_number)+'</td><td>'+money(r.price)+'</td>'+(access.can_edit?'<td><button type="button" class="secondary" data-cw="edit" data-id="'+esc(r.id)+'">Edit</button>'+(access.can_void?' <button type="button" class="secondary" data-cw="void" data-id="'+esc(r.id)+'">Void</button>':'')+'</td>':'')+'</tr>').join('')+(s.rows.length?'':'<tr><td colspan="5">No carwash records for this month.</td></tr>')+'</tbody><tfoot><tr><th colspan="3">Monthly income · '+s.count+' carwash'+(s.count===1?'':'es')+'</th><th>'+money(s.total)+'</th>'+(access.can_edit?'<td></td>':'')+'</tr></tfoot></table></div></div><div class="cw-summary"><button type="button" class="secondary" data-cw="daily">Daily income</button><button type="button" class="secondary" data-cw="weekly">Weekly income · Sat–Fri</button><button type="button" class="secondary" data-cw="monthly">Monthly income · '+money(s.total)+'</button></div><div id="cwBreakdown"></div>';
   doc.getElementById('cwMonth').disabled=busy;doc.getElementById('cwYear').disabled=busy;
   var form=doc.getElementById('cwForm');if(form)Array.from(form.elements).forEach(e=>e.disabled=!canEdit());breakdown();
  }
  function breakdown(){var target=doc.getElementById('cwBreakdown');if(!target)return;var s=summarize(rows,year,month);if(mode==='records'){target.innerHTML='';return}
   var items=mode==='daily'?s.days.map(d=>[d.date,d.count,d.total]):mode==='weekly'?s.weeks.map(w=>[w.from+' – '+w.to,w.count,w.total]):[[s.range.from+' – '+s.range.to,s.count,s.total]];
   target.innerHTML='<div class="card"><h2>'+({daily:'Daily income',weekly:'Weekly income',monthly:'Monthly income'}[mode])+'</h2>'+(mode==='weekly'?'<p class="muted">Saturday to Friday; Friday cutoff. Full weeks include dates from the neighboring month where needed. Monthly income includes only the selected month.</p>':'')+'<div class="cw-table"><table><thead><tr><th>Date / period</th><th>Carwashes</th><th>Income</th></tr></thead><tbody>'+items.map(r=>'<tr><td>'+esc(r[0])+'</td><td>'+r[1]+'</td><td>'+money(r[2])+'</td></tr>').join('')+(items.length?'':'<tr><td colspan="3">No records.</td></tr>')+'</tbody></table></div></div>';
  }
  async function load(){
   var ticket=++version,requested=key(),s=scope();currentScope=requested;rows=[];access={};notice='Loading carwash records…';render();
   if(!s.businessId||!s.branchId||!db()){notice='Select a branch to use CARWASH.';render();return}
   try{
    if(root.navigator.onLine===false)throw Error('Carwash requires an internet connection. Nothing is saved offline.');
    var allowed=await db().rpc('carwash_access',{p_business_id:s.businessId,p_branch_id:s.branchId});if(allowed.error)throw allowed.error;
    if(ticket!==version||requested!==key())return;access=allowed.data||{};tab.hidden=!access.can_view;
    if(!access.can_view)throw Error('Carwash uses your Invoice Making branch access. Ask the owner for access.');
    var range=monthRange(year,month),result=await read(db(),s,range.readFrom,range.readTo);
    if(ticket!==version||requested!==key())return;rows=result;notice=access.can_edit?'':'View-only access.';render();
   }catch(error){if(ticket!==version||requested!==key())return;access={};notice=missing(error)?'Carwash setup is not installed yet. No records have been saved.':error.message||'Carwash could not load. Please refresh.';render()}
  }
  function ask(text,buttonText){return new Promise(resolve=>{if(cancelConfirm)cancelConfirm();var dialog=doc.createElement('dialog');dialog.setAttribute('aria-label','Confirm carwash change');dialog.style.cssText='max-width:460px;width:90vw;border:1px solid #d8c5b9;border-radius:12px;padding:24px;background:white;color:#211b18';var p=doc.createElement('p');p.textContent=text;dialog.appendChild(p);var yes=doc.createElement('button'),no=doc.createElement('button');yes.textContent=buttonText;no.textContent='Cancel';yes.type=no.type='button';yes.className=no.className='secondary';yes.style.marginRight='12px';dialog.append(yes,no);doc.body.appendChild(dialog);function finish(value){cancelConfirm=null;dialog.close();dialog.remove();resolve(value)}yes.onclick=()=>finish(true);no.onclick=()=>finish(false);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false)});cancelConfirm=()=>finish(false);dialog.showModal();no.focus()})}
  async function discard(){var before=key();if(dirty&&!await ask('Discard the unsaved carwash entry?','Discard entry'))return false;if(before!==key())return false;dirty=false;editing=null;pending=null;return true}
  async function save(event){
   event.preventDefault();if(!canEdit())return;var form=event.target,values=Object.fromEntries(new root.FormData(form)),p;
   try{if(root.navigator.onLine===false)throw Error('Connect to the internet before saving.');p=payload(Object.assign(values,{id:editing?editing.id:(pending&&pending.payload.id)||root.crypto.randomUUID(),revision:editing?editing.revision:0}));}catch(e){message(e.message);return}
   if(pending&&JSON.stringify(pending.payload)!==JSON.stringify(p)){message('A previous save needs confirmation. Retry its unchanged values, or refresh before making another entry.');return}
   await send(p);
  }
  async function send(p){
   var s=scope(),requested=key();if(contextChanged())return;busy=true;
   pending=pending||{id:root.crypto.randomUUID(),payload:p};var request=pending;activeSave=request;
   lockForm(true);message('Saving…');
   try{
    var result=await db().rpc('save_carwash_record',{p_business_id:s.businessId,p_branch_id:s.branchId,p_request_id:request.id,p_payload:request.payload});if(result.error)throw result.error;
    if(requested!==key()||activeSave!==request)return;if(!result.data||result.data.id!==p.id||result.data.business_id!==s.businessId||result.data.branch_id!==s.branchId)throw Error('Saved record could not be verified. Retry the same save.');
    pending=null;editing=null;dirty=false;busy=false;await load();message(p.action==='void'?'Record voided. Income totals updated.':'Saved. Carwash income is included in Dashboard receipts.');
    doc.dispatchEvent(new Event('bwc:carwash-updated'));root.localStorage.setItem('bwc-carwash-refresh',JSON.stringify({scope:s,at:Date.now()}));
   }catch(error){if(requested!==key()||activeSave!==request)return;if(error.code&&/^([0-9A-Z]{5})$/.test(error.code))pending=null;message((error.message||'Save could not be confirmed.')+(pending?' Retry the same save; do not add a duplicate.':' No change was saved. Refresh if another person edited this record.'));if(pending){var retry=doc.createElement('button');retry.type='button';retry.className='secondary';retry.dataset.cw='retry';retry.textContent='Retry save';doc.getElementById('carwashNotice').appendChild(retry)}}
   finally{if(activeSave===request){activeSave=null;busy=false;if(requested===key())lockForm(!canEdit())}}
  }
  function install(){
   var nav=doc.getElementById('nav'),main=doc.querySelector('main');if(!nav||!main)return;
   tab=doc.createElement('button');tab.type='button';tab.dataset.t='carwash';tab.id='carwashTab';tab.textContent='CARWASH';nav.appendChild(tab);
   box=doc.createElement('section');box.id='carwash';box.className='view';main.appendChild(box);
   var style=doc.createElement('style');style.textContent='#carwash .cw-heading,#carwash .cw-filters,#carwash .cw-actions,#carwash .cw-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap}#carwash .cw-heading{justify-content:space-between}#carwash .cw-filters label{min-width:110px}#carwash .cw-filters input{max-width:110px}#carwash .cw-entry{display:grid;grid-template-columns:1fr 2fr 1.5fr 1fr;gap:12px}#carwash .cw-actions{margin:12px 0 20px}#carwash .cw-table{overflow-x:auto}#carwash table{width:100%;border-collapse:collapse}#carwash th,#carwash td{padding:12px;border-bottom:1px solid #e7d7d0;text-align:left}#carwash td:nth-child(4),#carwash th:nth-child(4){text-align:right;white-space:nowrap}#carwash tfoot{background:#fff1e9}#carwash tfoot th{font-size:14px}#carwash tfoot th:last-of-type{text-align:right}#carwash button[type="submit"]{background:#ff5219;color:white;border:0;border-radius:8px;padding:12px 22px;font-size:14px;font-weight:700}#carwash .cw-summary{margin:20px 0}#carwash #carwashNotice{min-height:20px}#carwash button:disabled{opacity:.5;cursor:wait}@media(max-width:650px){#carwash .cw-entry{grid-template-columns:1fr 1fr}}';doc.head.appendChild(style);
   tab.addEventListener('click',function(){if(typeof root.show==='function')root.show('carwash');else{doc.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v===box));doc.querySelectorAll('#nav [data-t]').forEach(t=>t.classList.toggle('active',t===tab))}if(!dirty&&!busy)load()});
   box.addEventListener('input',e=>{if(e.target.closest('#cwForm'))dirty=true});box.addEventListener('submit',save);
   box.addEventListener('change',async function(e){if(!['cwMonth','cwYear'].includes(e.target.id))return;if(busy||!await discard()){doc.getElementById('cwMonth').value=String(month);doc.getElementById('cwYear').value=String(year);return}try{monthRange(doc.getElementById('cwYear').value,doc.getElementById('cwMonth').value);year=Number(doc.getElementById('cwYear').value);month=Number(doc.getElementById('cwMonth').value);load()}catch(error){message(error.message)}});
   box.addEventListener('click',async function(e){var b=e.target.closest('[data-cw]');if(!b||busy)return;var act=b.dataset.cw;
    if(['daily','weekly','monthly'].includes(act)){mode=act;breakdown();return}
    if(act==='retry'&&pending){send(pending.payload);return}
    if(act==='refresh'){if(await discard())load();return}if(act==='cancel'){if(await discard())render();return}
    var row=rows.find(r=>r.id===b.dataset.id);if(!row||!canEdit())return;
    if(act==='edit'&&await discard()){editing=row;render();doc.querySelector('#cwForm [name="unit"]').focus()}
    if(act==='void'&&access.can_void&&await discard()){var before=key();if(await ask('Void '+row.unit+' / '+row.plate_number+' ('+money(row.price)+')? It will be excluded from income; its audit record is kept.','Void record')){if(before===key()&&canEdit())send({action:'void',id:row.id,revision:row.revision})}}
   });
   ['bwc:branch-ready','bwc:business-ready'].forEach(n=>doc.addEventListener(n,function(){if(cancelConfirm)cancelConfirm();++version;editing=null;pending=null;activeSave=null;dirty=false;busy=false;load()}));
   root.addEventListener('storage',function(e){if(['bwc-active-branch','bwc-active-business'].includes(e.key)){if(cancelConfirm)cancelConfirm();++version;editing=null;pending=null;activeSave=null;dirty=false;busy=false;load()}else if(e.key==='bwc-carwash-refresh'){doc.dispatchEvent(new Event('bwc:carwash-updated'));if(!dirty&&!busy)load()}});
   root.addEventListener('beforeunload',e=>{if(dirty||busy||pending){e.preventDefault();e.returnValue=''}});
   render();setTimeout(load,1500);
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',install,{once:true});else install();
 }
 return {today:today,week:week,monthRange:monthRange,summarize:summarize,sum:sum,payload:payload,read:read,reportRows:reportRows,mount:mount};
});
