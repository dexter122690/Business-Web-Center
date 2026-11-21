/* Released-unit material history. Reads saved records only; no stock or unit
   mutations. Legacy usage and adjustment logs deliberately remain separate. */
(function(root,factory){
  var api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.BWCInventoryMaterialHistory=api;api.install()}
}(typeof window!=='undefined'?window:null,function(root){
  'use strict';
  var dialog=null,content=null,request=0,current=null,opener=null,installed=false;
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function quantity(value){return Number(value).toLocaleString('en-PH',{maximumFractionDigits:2})}
  function hundredths(value){var n=Number(value);if(value==null||value===''||!Number.isFinite(n)||!Number.isSafeInteger(Math.round(n*100)))throw new Error('A saved material quantity is invalid. The history cannot be totalled safely.');return Math.round(n*100)}
  function dateTime(value){
    if(!value)return 'Not recorded';var date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Invalid saved date';
    return date.toLocaleString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }
  function parentUsage(line){var value=line.inventory_tracker_usage;return Array.isArray(value)?(value.length===1?value[0]:null):value}
  function model(vehicle,lines,adjustments){
    var groups=new Map(),records=[];
    function group(row){
      if(!row.material_id)throw new Error('A saved record has no material reference. Please review its history.');
      if(!groups.has(row.material_id))groups.set(row.material_id,{id:row.material_id,name:row.material_name||'Unnamed material',nameDate:'',recorded:0,added:0,reduced:0,usageCount:0,adjustmentCount:0});
      var item=groups.get(row.material_id),date=row.recorded_at||row.created_at||'';
      if(date>=item.nameDate){item.name=row.material_name||item.name;item.nameDate=date}return item;
    }
    lines.forEach(function(row){
      var n=hundredths(row.quantity);if(n<=0)throw new Error('A recorded usage quantity is invalid. Please review its history.');
      var item=group(row),parent=parentUsage(row);item.recorded+=n;item.usageCount++;
      records.push({id:'usage:'+row.id,type:'Recorded usage',name:row.material_name||item.name,quantity:n/100,date:parent&&parent.recorded_at||row.created_at||''});
    });
    adjustments.forEach(function(row){
      var n=hundredths(row.delta);if(!n)throw new Error('A saved quantity adjustment is invalid. Please review its history.');
      var item=group(row);if(n>0)item.added+=n;else item.reduced-=n;item.adjustmentCount++;
      records.push({id:'adjustment:'+row.id,type:n>0?'Quantity added':'Quantity reduced',name:row.material_name||item.name,quantity:n/100,date:row.recorded_at||''});
    });
    var summary=Array.from(groups.values()).map(function(item){return {id:item.id,name:item.name,recorded:item.recorded/100,added:item.added/100,reduced:item.reduced/100,net:(item.added-item.reduced)/100,usageCount:item.usageCount,adjustmentCount:item.adjustmentCount}}).sort(function(a,b){return a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})||a.id.localeCompare(b.id)});
    records.sort(function(a,b){return b.date.localeCompare(a.date)||a.id.localeCompare(b.id)});
    return {vehicle:vehicle,summary:summary,records:records,usageCount:lines.length,adjustmentCount:adjustments.length,mixed:!!(lines.length&&adjustments.length),negative:summary.some(function(item){return item.net<0})};
  }
  function validateScope(row,context){if(!row||row.business_id!==context.business||row.branch_id!==context.branch)throw new Error('The record does not belong to the selected business and branch. Please reopen the unit.')}
  async function readVehicle(client,context,check){
    check();var result=await client.from('inventory_tracker_vehicles').select('id,business_id,branch_id,vehicle_name,plate_number,released_at,updated_at').eq('id',context.vehicle).eq('business_id',context.business).eq('branch_id',context.branch).maybeSingle();check();
    if(result.error)throw result.error;if(!result.data)throw new Error('This unit is no longer available in the selected branch. It may have been deleted.');
    validateScope(result.data,context);if(result.data.id!==context.vehicle||!result.data.released_at)throw new Error('This unit is not in the released-unit archive. Please refresh Inventory Tracker.');return result.data;
  }
  async function readPages(client,context,kind,check){
    var isUsage=kind==='usage',table=isUsage?'inventory_tracker_usage_lines':'inventory_tracker_adjustments',rows=[],seen=new Set(),expected=null,offset=0;
    var fields=isUsage?'id,business_id,branch_id,usage_id,material_id,material_name,quantity,created_at,inventory_tracker_usage!inner(id,business_id,branch_id,vehicle_id,recorded_at)':'id,business_id,branch_id,vehicle_id,material_id,material_name,delta,recorded_at';
    for(;;){
      check();var query=client.from(table).select(fields,{count:'exact'}).eq('business_id',context.business).eq('branch_id',context.branch);
      if(isUsage)query=query.eq('inventory_tracker_usage.vehicle_id',context.vehicle).eq('inventory_tracker_usage.business_id',context.business).eq('inventory_tracker_usage.branch_id',context.branch);
      else query=query.eq('vehicle_id',context.vehicle);
      var result=await query.order(isUsage?'created_at':'recorded_at',{ascending:false}).order('id',{ascending:true}).range(offset,offset+499);check();
      if(result.error)throw result.error;
      if(!Number.isInteger(result.count)||result.count<0)throw new Error('The history could not be verified as complete. Please try again.');
      if(expected!==null&&result.count!==expected)throw new Error('The material history changed while loading. Please refresh it.');expected=result.count;
      var page=result.data||[];
      page.forEach(function(row){
        validateScope(row,context);if(!row.id||seen.has(row.id))throw new Error('The material history contains an incomplete or repeated page. Please try again.');seen.add(row.id);
        var parent=isUsage?parentUsage(row):row;validateScope(parent,context);
        if(parent.vehicle_id!==context.vehicle||(isUsage&&row.usage_id!==parent.id))throw new Error('The material history could not be matched to this unit. Please try again.');rows.push(row);
      });
      if(rows.length===expected)return rows;if(!page.length||rows.length>expected)throw new Error('The material history is incomplete. Please try again.');offset+=page.length;
    }
  }
  async function readRecords(client,context,check){
    check=check||function(){};if(!client||!context.business||!context.branch||!context.vehicle)throw new Error('Select a business and branch before opening material history.');
    var vehicle=await readVehicle(client,context,check),data=await Promise.all([readPages(client,context,'usage',check),readPages(client,context,'adjustments',check)]);
    var latest=await readVehicle(client,context,check);if(JSON.stringify(vehicle)!==JSON.stringify(latest))throw new Error('The unit changed while its history was loading. Please refresh it.');
    check();return model(vehicle,data[0],data[1]);
  }
  function html(report){
    var vehicle=report.vehicle;
    var summary=report.summary.length?'<div class="imh-table" tabindex="0" aria-label="Material quantities"><table><thead><tr><th>Material</th><th>Recorded usage</th><th>Added (+)</th><th>Reduced (−)</th><th>Net adjustments</th></tr></thead><tbody>'+report.summary.map(function(item){return '<tr data-imh-material="'+esc(item.id)+'"><th scope="row">'+esc(item.name)+'</th><td>'+ (item.usageCount?quantity(item.recorded):'—')+'</td><td>'+(item.adjustmentCount?quantity(item.added):'—')+'</td><td>'+(item.adjustmentCount?quantity(item.reduced):'—')+'</td><td><b>'+(item.adjustmentCount?quantity(item.net):'—')+'</b></td></tr>'}).join('')+'</tbody></table></div>':'<p class="imh-empty">No saved material usage or quantity adjustments were found for this unit.</p>';
    var records=report.records.length?'<h3>Dated material history</h3><div class="imh-table" tabindex="0" aria-label="Dated material history"><table><thead><tr><th>Date / time</th><th>Material</th><th>Record type</th><th>Quantity</th></tr></thead><tbody>'+report.records.map(function(row){return '<tr data-imh-record="'+esc(row.id)+'"><td>'+esc(dateTime(row.date))+'</td><td>'+esc(row.name)+'</td><td>'+row.type+'</td><td class="imh-quantity">'+(row.type==='Quantity added'?'+':'')+quantity(row.quantity)+'</td></tr>'}).join('')+'</tbody></table></div>':'';
    return '<div class="imh-unit"><div><h3>'+esc(vehicle.vehicle_name)+'</h3><b>'+esc(vehicle.plate_number)+'</b></div><div><span>Released · Philippine time</span><b>'+esc(dateTime(vehicle.released_at))+'</b></div></div>'+ 
      '<p id="imhReadOnly" class="imh-note">Read-only archive. Viewing these records does not change stock or reactivate the unit.</p><h3>Materials recorded for this unit</h3>'+summary+
      '<p class="imh-note">Recorded usage comes from saved usage entries. Net adjustments = additions minus reductions in the plus/minus log. These two sources are shown separately'+(report.mixed?' because older entries may describe the same activity; they are not added together.':'; a dash means no entries from that source.')+'</p>'+ 
      (report.negative?'<p class="imh-warning">Some adjustment totals are negative. They are shown as saved, not changed to zero; review the dated entries before treating them as actual usage.</p>':'')+
      '<p class="imh-count">'+report.usageCount+' usage '+(report.usageCount===1?'entry':'entries')+' · '+report.adjustmentCount+' quantity '+(report.adjustmentCount===1?'adjustment':'adjustments')+' · All dates shown in Philippine time</p>'+records;
  }
  function byId(id){return root.document.getElementById(id)}
  function context(vehicle){return {business:root.localStorage.getItem('bwc-active-business')||'',branch:root.localStorage.getItem('bwc-active-branch')||'',vehicle:vehicle}}
  function allowed(){var view=byId('inventoryTracker'),legacy=byId('inventory');return !!view&&view.dataset.access!=='none'&&(!legacy||legacy.dataset.access!=='none')}
  function close(){request++;current=null;if(dialog&&dialog.open)dialog.close()}
  async function loadHistory(vehicle){
    var version=++request,captured=context(vehicle);current=captured;
    content.innerHTML='<p class="imh-empty" role="status">Loading all saved material records for this unit…</p>';dialog.setAttribute('aria-busy','true');
    function check(){if(version!==request||!dialog.open||JSON.stringify(captured)!==JSON.stringify(context(vehicle)))throw new Error('The selected branch or unit changed. Reopen the material history.');if(!allowed())throw new Error('Inventory access is required to view this history.')}
    try{
      check();var client=root.getBusinessSupabaseClient&&root.getBusinessSupabaseClient(),report=await readRecords(client,captured,check);check();content.innerHTML=html(report);
    }catch(error){if(version===request&&dialog.open&&JSON.stringify(captured)===JSON.stringify(context(vehicle)))content.innerHTML='<p class="imh-warning" role="alert">'+esc(error.message||'The complete material history could not load. Please try again.')+'</p><button type="button" class="it-secondary" data-imh-retry>Try again</button>';}
    finally{if(version===request)dialog.setAttribute('aria-busy','false')}
  }
  function ensureDialog(){
    if(dialog)return;dialog=root.document.createElement('dialog');dialog.id='inventoryMaterialHistory';dialog.setAttribute('aria-labelledby','imhTitle');
    dialog.innerHTML='<header class="imh-header"><div><span class="imh-eyebrow">Released unit · Inventory Tracker</span><h2 id="imhTitle">Material history</h2></div><div class="imh-actions"><button type="button" class="it-secondary" data-imh-refresh>Refresh</button><button type="button" class="it-secondary" data-imh-close>Close</button></div></header><div class="imh-content"></div>';
    root.document.body.appendChild(dialog);content=dialog.querySelector('.imh-content');
    dialog.addEventListener('close',function(){request++;current=null;if(opener&&opener.isConnected)opener.focus();else if(byId('inventoryTrackerTab'))byId('inventoryTrackerTab').focus()});
    dialog.addEventListener('click',function(event){
      if(event.target.closest('[data-imh-close]')){close();return}
      if(event.target.closest('[data-imh-refresh],[data-imh-retry]')){if(current)loadHistory(current.vehicle);return}
      if(event.target===dialog){var box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close()}
    });
  }
  function install(){
    if(!root||installed)return;installed=true;var style=root.document.createElement('style');style.id='inventoryMaterialHistoryStyle';
    style.textContent='#inventoryMaterialHistory{width:min(1050px,calc(100vw - 32px));max-width:none;max-height:88vh;border:1px solid #dfd0c9;border-radius:16px;padding:0;background:#fff;color:#28201c;font:16px/1.5 Arial,sans-serif;box-shadow:0 18px 70px #0004}#inventoryMaterialHistory[open]{display:flex;flex-direction:column}#inventoryMaterialHistory::backdrop{background:#21171099}#inventoryMaterialHistory .imh-header{height:auto;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:22px 26px;background:#fff;color:inherit;border-bottom:1px solid #eaded8}.imh-eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:#9f3b17}#inventoryMaterialHistory h2{font-size:23px;margin:4px 0 0}#inventoryMaterialHistory h3{font-size:17px;margin:20px 0 12px}.imh-actions{display:flex;gap:8px}#inventoryMaterialHistory button{font-size:14px;cursor:pointer}.imh-content{overflow:auto;min-height:0;padding:22px 26px}.imh-unit{display:flex;justify-content:space-between;gap:20px;border:1px solid #efd4c5;border-radius:12px;background:#fff5ef;padding:18px 20px}.imh-unit h3{margin:0 0 4px!important}.imh-unit span,.imh-unit b{display:block}.imh-unit span,.imh-note,.imh-count{font-size:14px;color:#6d594e}.imh-table{overflow:auto;border:1px solid #eaded8;border-radius:10px;margin:14px 0}.imh-table table{min-width:650px;width:100%;border-collapse:collapse}.imh-table th,.imh-table td{font-size:14px;text-align:left;padding:12px 14px;border-bottom:1px solid #eaded8;vertical-align:top;overflow-wrap:anywhere}.imh-table thead th{background:#faf6f4;color:#6d594e;font-weight:600}.imh-table tbody tr:last-child>*{border-bottom:0}.imh-table td:last-child{font-variant-numeric:tabular-nums;white-space:nowrap}.imh-empty{padding:20px 0;color:#6d594e}.imh-warning{padding:14px;border-radius:9px;border:1px solid #e1b28c;background:#fff6e9;color:#874112;font-size:14px}@media(max-width:600px){#inventoryMaterialHistory{width:calc(100vw - 16px);max-height:94vh}#inventoryMaterialHistory .imh-header,.imh-content{padding:16px}.imh-unit{flex-direction:column;gap:10px;padding:14px}.imh-actions{flex-direction:column}}';
    root.document.head.appendChild(style);
    root.document.addEventListener('click',function(event){
      var button=event.target.closest('#inventoryTracker [data-it-view-materials]');if(!button)return;
      // Do not let this click toggle the archive or reach any stock handlers.
      event.preventDefault();event.stopPropagation();opener=button;ensureDialog();if(!dialog.open)dialog.showModal();loadHistory(button.dataset.itViewMaterials);
    },true);
    ['bwc:branch-ready','bwc:business-ready'].forEach(function(name){root.document.addEventListener(name,close)});
    root.addEventListener('storage',function(event){if(event.key==='bwc-active-branch'||event.key==='bwc-active-business')close()});
    root.document.addEventListener('visibilitychange',function(){if(!root.document.hidden&&current&&JSON.stringify(current)!==JSON.stringify(context(current.vehicle)))close()});
  }
  return {install:install,readRecords:readRecords,model:model,html:html,dateTime:dateTime};
}));
