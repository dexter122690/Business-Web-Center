/* Receipt-based inventory costing. Quantities, average valuation and usage cost
   are saved together by the checked server transaction in migration 073. */
(function(root,factory){
  var api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.BWCInventoryCosting=api;api.install()}
}(typeof window!=='undefined'?window:null,function(root){
  'use strict';
  var epoch=0,formEpoch=0,current=null,dialog=null,formState=null,saving=false,opener=null,channel=null;
  var quickPending=null,quickMessage=null,costExpanded=false,pricingExpanded=false;
  var quickStorageKey='bwc-inventory-quick-pending-v1';
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function num(v){var n=Number(v);if(v==null||v===''||!Number.isFinite(n)||Math.abs(n)>9000000000)throw new Error('A cost or quantity is missing or outside the supported range. Please review the saved record.');return n}
  function qty(v){return num(v).toLocaleString('en-PH',{maximumFractionDigits:2})}
  function money(v,digits){return '₱'+num(v).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:digits||2})}
  function date(v){return v?new Date(v).toLocaleString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Not recorded'}
  function scope(vehicle){return {business:root.localStorage.getItem('bwc-active-business')||'',branch:root.localStorage.getItem('bwc-active-branch')||'',vehicle:vehicle||null}}
  function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}
  function client(){return root.getBusinessSupabaseClient&&root.getBusinessSupabaseClient()}
  function model(data){
    if(!data||data.version!==1||!Array.isArray(data.materials)||!Array.isArray(data.history))throw new Error('The complete costing snapshot is unavailable. Run database update 073, then refresh BWC.');
    var seen=new Set(),unknown=0,totalCents=0,units={};
    var rows=data.materials.map(function(m){
      if(!m.id||seen.has(m.id))throw new Error('The material snapshot contains duplicate or missing references.');seen.add(m.id);
      var legacy=num(m.old_adjustment_count)+num(m.old_usage_count)>0,unpriced=legacy&&!m.baseline;
      var q=num(m.new_qty)+(m.baseline?num(m.baseline.quantity):0),cost=num(m.new_cost)+(m.baseline?num(m.baseline.amount):0);
      if(q<0||cost<0)throw new Error('A saved material balance is negative. Review the usage history before costing it.');
      var used=legacy||q>0||data.history.some(function(h){return h.material_id===m.id});
      if(unpriced)unknown++;if(used){totalCents+=Math.floor((Math.round(cost*1000000)+5000)/10000);if(!Number.isSafeInteger(totalCents))throw new Error('The cost total exceeds the supported precision.');}
      var u=(m.baseline&&m.baseline.measure_unit)||m.measure_unit||'unit (not specified)';
      if(q>0)units[u]=(units[u]||0)+Math.round(q*100);
      return {material:m,id:m.id,name:m.item_name,quantity:q,cost:cost,rate:q>0?cost/q:null,unit:u,legacy:legacy,unpriced:unpriced,used:used};
    });
    rows.sort(function(a,b){return a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})});
    return {data:data,rows:rows,used:rows.filter(function(r){return r.used}),unknown:unknown,total:totalCents/100,
      quantities:Object.keys(units).map(function(u){return qty(units[u]/100)+' '+u}).join(' · ')};
  }
  async function read(context){
    if(!context.business||!context.branch)throw new Error('Select a business and branch first.');
    var c=client();if(!c)throw new Error('The online connection is unavailable.');
    var r=await c.rpc('inventory_tracker_cost_snapshot',{p_business_id:context.business,p_branch_id:context.branch,p_vehicle_id:context.vehicle});
    if(r.error)throw new Error(/PGRST202|42883/.test(r.error.code||'')?'Costing setup is required: run Supabase migration 073, then refresh BWC.':r.error.message);
    if(!r.data||r.data.business_id!==context.business||r.data.branch_id!==context.branch||((r.data.vehicle&&r.data.vehicle.id)||null)!==context.vehicle)throw new Error('The costing response does not match the selected branch and unit.');
    return model(r.data);
  }
  function button(action,label,material,extra){return '<button type="button" class="ic-button" data-ic-action="'+action+'"'+(material?' data-ic-material="'+esc(material)+'"':'')+(extra||'')+'>'+esc(label)+'</button>'}
  function reportHTML(report,archive){
    var can=report.data.can_edit,active=!archive&&report.data.vehicle&&!report.data.vehicle.released_at;
    var summary='<div class="ic-summary"><div><span>'+(report.unknown?'Known materials cost · incomplete':'Direct materials cost')+'</span><strong>'+money(report.total)+'</strong><small>Materials only · excludes labor</small></div><div><span>Materials recorded</span><strong>'+report.used.length+'</strong><small>'+esc(report.quantities||'No priced usage yet')+(report.unknown?' · plus unverified past usage':'')+'</small></div></div>';
    var rows=report.used.map(function(r){var m=r.material;
      var old=r.unpriced?'<small class="ic-warning-text">Past records: '+qty(m.old_adjustment_qty)+' net adjustments / '+qty(m.old_usage_qty)+' recorded usage. Not added together.</small>':'';
      var actions=can?(active?button('use','Add usage',r.id)+button('return','Return / correct',r.id):'')+(r.unpriced?button('baseline','Verify past usage',r.id):''):'';
      return '<tr><th scope="row">'+esc(r.name)+old+(m.baseline?'<small>Past usage verified: '+qty(m.baseline.quantity)+' '+esc(m.baseline.measure_unit)+' × '+money(m.baseline.unit_cost,4)+'<br>'+esc(m.baseline.note)+' · '+esc(date(m.baseline.recorded_at))+'</small>':'')+'</th><td>'+(r.unpriced?'<b>Past qty unverified</b><small>'+qty(r.quantity)+' '+esc(r.unit)+' priced since costing began</small>':qty(r.quantity)+' '+esc(r.unit))+'</td><td>'+(r.rate===null?'—':money(r.rate,4))+'</td><td><b>'+money(r.cost)+'</b>'+(r.unpriced?'<small class="ic-warning-text">+ past cost not recorded</small>':'')+'</td><td class="ic-row-actions">'+actions+'</td></tr>';
    }).join('');
    return '<div class="ic-heading"><div><span class="ic-kicker">UNIT COST RECORD</span><h3>Materials &amp; direct cost</h3></div>'+(active&&can?button('use','Record material usage'):button('refresh','Refresh'))+'</div>'+summary+
      (report.unknown?'<p class="ic-notice">'+report.unknown+' material(s) have unpriced or unverified past usage. The amount above is a known subtotal, not the full unit cost. Use Verify past usage with supporting records; current stock will not be deducted again.</p>':'')+
      '<div class="ic-scroll"><table class="ic-table"><thead><tr><th>Material</th><th>Quantity used</th><th>Recorded cost / unit</th><th>Material total</th><th>Actions</th></tr></thead><tbody>'+ (rows||'<tr><td colspan="5">No material usage recorded for this unit yet.</td></tr>')+'</tbody></table></div>'+
      '<p class="ic-help">Cost per unit is blended from saved usage prices, not today’s supplier price. Different measurement units are not added into one quantity. The total adds the displayed material totals, rounded to centavos.</p>'+historyHTML(report);
  }
  function historyHTML(report){
    var rows=report.data.history||[];
    if(!rows.length)return '';
    return '<details class="ic-history"><summary>Costed usage history ('+rows.length+')</summary><div class="ic-scroll"><table class="ic-table"><thead><tr><th>Date · Philippine time</th><th>Material / reason</th><th>Quantity</th><th>Saved unit cost</th><th>Cost</th></tr></thead><tbody>'+rows.map(function(h){return '<tr><td>'+esc(date(h.recorded_at))+'</td><td>'+esc(h.material_name)+'<small>'+esc(h.cost_note)+'</small></td><td>'+qty(h.delta)+' '+esc(h.measure_unit)+'</td><td>'+money(h.unit_cost,4)+'</td><td>'+money(h.cost_amount)+'</td></tr>'}).join('')+'</tbody></table></div></details>';
  }
  function stockHTML(report){
    var can=report.data.can_edit;
    return '<div class="ic-heading"><div><span class="ic-kicker">RECEIPT-BASED PRICING</span><h3>Stock &amp; purchase costs</h3></div>'+(can?button('purchase','Record purchase')+button('create','Add material'):'')+'</div><p class="ic-help">A purchase increases stock and updates its weighted-average cost. Opening valuation prices existing stock without adding it again. These actions do not create an expense entry in Expenses.</p><div class="ic-scroll"><table class="ic-table"><thead><tr><th>Material</th><th>Available</th><th>Current average cost</th><th>Stock value</th><th>Actions</th></tr></thead><tbody>'+report.rows.map(function(r){var m=r.material;return '<tr><th scope="row">'+esc(r.name)+'</th><td>'+qty(m.quantity)+' '+esc(m.measure_unit||'unit unspecified')+'</td><td>'+(m.cost_initialized?(m.stock_unit_cost==null?'No stock':money(m.stock_unit_cost,4)):'Cost not recorded')+'</td><td>'+(m.cost_initialized?money(m.cost_value):'Unknown')+'</td><td class="ic-row-actions">'+(can?(!m.cost_initialized?button('opening','Set opening cost',m.id):'')+button('purchase','Purchase',m.id)+(m.cost_initialized?button('count','Correct count',m.id):''):'')+'</td></tr>'}).join('')+'</tbody></table></div><details class="ic-history"><summary>Latest stock transactions (up to 100)</summary><div class="ic-scroll"><table class="ic-table"><thead><tr><th>Recorded / purchase date</th><th>Material / action</th><th>Qty change*</th><th>Value</th><th>Supplier / receipt / reason</th></tr></thead><tbody>'+(report.data.purchases||[]).map(function(e){var m=report.rows.find(function(r){return r.id===e.material_id});return '<tr><td>'+esc(date(e.recorded_at))+'<small>'+esc(e.purchase_date||'')+'</small></td><td>'+esc(m?m.name:'Material')+'<small>'+esc(e.action)+'</small></td><td>'+qty(e.quantity)+'</td><td>'+money(e.amount)+'</td><td>'+esc([e.supplier,e.receipt,e.note].filter(Boolean).join(' · '))+'</td></tr>'}).join('')+'</tbody></table></div><p class="ic-help">*Opening valuation shows the existing quantity valued, not an increase. Purchase dates are receipt references; costing is applied in the order transactions are recorded, without rewriting earlier usage.</p></details>';
  }
  function selectedContext(){return root.BWCInventoryTracker?root.BWCInventoryTracker.context():scope(null)}
  function quickPayload(report,context,materialId,delta){
    if(!report.data.can_edit)throw new Error('Inventory edit access is required for this branch.');
    if(!report.data.vehicle||report.data.vehicle.id!==context.vehicle||report.data.vehicle.released_at)throw new Error('Choose an active unit before recording materials.');
    var row=report.rows.find(function(r){return r.id===materialId});if(!row)throw new Error('This material is unavailable in the selected branch.');
    var m=row.material,values={material_id:materialId,quantity:1,note:delta===1?'Quick +: materials used on unit':'Quick −: reverse latest material usage'},action;
    if(delta===1){
      if(!m.cost_initialized)throw new Error('Set the opening cost for '+row.name+' in Material pricing & purchases first. This is a one-time setup for existing stock.');
      if(num(m.quantity)<1)throw new Error('Not enough stock for +1 '+(m.measure_unit||'unit')+'. Record a purchase, or use a fractional quantity in the cost section.');
      action='use';
    }else if(delta===-1){
      var entries=report.data.history.filter(function(h){return h.material_id===materialId&&num(h.delta)>0}).map(function(h){
        var returned=report.data.history.filter(function(x){return x.return_of===h.id}).reduce(function(s,x){return s+num(x.delta)},0);
        return {entry:h,remaining:Math.round((num(h.delta)+returned)*100)/100};
      }).filter(function(x){return x.remaining>0}).sort(function(a,b){return String(b.entry.recorded_at).localeCompare(String(a.entry.recorded_at))||String(b.entry.id).localeCompare(String(a.entry.id))});
      if(!entries.length)throw new Error('There is no new costed usage to reverse. Older usage records are preserved; they cannot be changed with this minus button.');
      action='return';values.quantity=Math.min(1,entries[0].remaining);values.return_of=entries[0].entry.id;
    }else throw new Error('Unsupported quick quantity change.');
    return payloadFrom({action:action,context:context,report:report},values);
  }
  function quickStatus(){
    var page=root.document.getElementById('inventoryTracker'),box=page&&page.querySelector('[data-ic-quick-status]');if(!box)return;
    var context=selectedContext(),pending=quickPending&&same(quickPending.context,context),message=quickMessage&&same(quickMessage.context,context)?quickMessage.text:'';
    if(quickPending&&!pending)message='A material save in another unit is awaiting confirmation. Return to that branch and unit to retry the same save safely.';
    box.innerHTML=(message?'<span>'+esc(message)+'</span>':'')+(pending&&!saving?button('retry-quick','Retry same save'):'');box.hidden=!message&&!pending;
    page.querySelectorAll('[data-it-unit-plus],[data-it-unit-minus]').forEach(function(b){b.disabled=saving||!!quickPending||!current||!current.report.data.can_edit||!!(current.report.data.vehicle&&current.report.data.vehicle.released_at)});
  }
  function persistQuick(state){
    // Keep the exact request across a reload after a lost response. Never replay automatically.
    if(state)root.sessionStorage.setItem(quickStorageKey,JSON.stringify(state));else root.sessionStorage.removeItem(quickStorageKey);
    quickPending=state;
  }
  async function runQuick(state){
    if(!same(state.context,selectedContext()))throw new Error('Return to the original branch and unit before retrying this save.');
    var r=await client().rpc('inventory_tracker_cost_action',{p_business_id:state.context.business,p_branch_id:state.context.branch,p_request_id:state.requestId,p_payload:state.payload});
    if(r.error){if(r.error.code)persistQuick(null);throw new Error(r.error.message);}
    if(!r.data||!r.data.ok)throw new Error('The save result could not be confirmed.');
    persistQuick(null);
    quickMessage={context:state.context,text:'Saved '+(state.payload.action==='use'?'+':'−')+qty(state.payload.quantity)+' '+state.unit+' · '+state.name+'. Quantity and cost were saved together.'};
    changed(state.context);
  }
  async function quickStep(materialId,delta,retry){
    if(saving)return;
    var context=selectedContext();if(quickPending&&!retry){quickStatus();return;}
    saving=true;quickMessage={context:context,text:retry?'Checking the same saved request…':'Saving material usage…'};quickStatus();
    try{
      var state=quickPending;
      if(!retry){
        var report=await read(context);if(!same(context,selectedContext()))throw new Error('The selected unit changed. No material was recorded.');
        var payload=quickPayload(report,context,materialId,delta),row=report.rows.find(function(r){return r.id===materialId});
        state={context:context,requestId:root.crypto.randomUUID(),payload:payload,name:row.name,unit:row.material.measure_unit||'unit'};
        persistQuick(state);
      }
      if(!state)throw new Error('There is no pending save to retry.');
      await runQuick(state);
    }catch(e){quickMessage={context:context,text:(e.message||'The material could not be saved.')+(quickPending?' Do not add it again. Use Retry same save to confirm this exact request without duplicating it.':'')};}
    finally{saving=false;quickStatus();}
  }
  function showPricing(){
    var box=root.document.getElementById('inventoryMaterialPricing');if(!box)return;box.open=true;pricingExpanded=true;box.scrollIntoView({behavior:'smooth',block:'start'});box.querySelector('summary').focus();
  }
  async function render(context){
    var page=root.document.getElementById('inventoryTracker');if(!page)return;
    var version=++epoch;current=null;
    var old=page.querySelector('.it-unit-materials'),mount;
    var legacy=page.querySelector('.it-history');if(legacy){var audit=root.document.createElement('details');audit.className='ic-history';audit.innerHTML='<summary>Quantity audit trail (separate source records)</summary>';legacy.replaceWith(audit);audit.appendChild(legacy);}
    if(old){
      // Keep the original material rows, ordering, hide/add-row controls and +/- look.
      old.querySelectorAll('[data-it-unit-plus],[data-it-unit-minus]').forEach(function(b){b.disabled=true});
      var toolbar=root.document.createElement('div');toolbar.className='ic-quick-help';toolbar.innerHTML='<span>+ uses 1 item · − reverses the latest use (up to 1). Prices are saved in the background.</span>'+button('pricing','Material prices');old.before(toolbar);
      var status=root.document.createElement('p');status.className='ic-quick-status';status.dataset.icQuickStatus='';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;old.before(status);
      mount=root.document.createElement('details');mount.className='ic-unit ic-cost-panel';mount.open=costExpanded;old.after(mount);
      mount.addEventListener('toggle',function(){costExpanded=mount.open});
    }
    var stock=root.document.createElement('details');stock.id='inventoryMaterialPricing';stock.className='ic-stock ic-pricing';stock.open=pricingExpanded;page.appendChild(stock);
    stock.addEventListener('toggle',function(){pricingExpanded=stock.open});
    if(mount)mount.innerHTML='<summary>Unit material cost details</summary><p role="status">Loading complete material costs…</p>';
    stock.innerHTML='<summary>Material pricing &amp; purchases</summary><p role="status">Loading stock valuation…</p>';quickStatus();
    try{
      var report=await read(context);if(version!==epoch||!same(context,scope(context.vehicle)))return;
      current={context:context,report:report};if(mount)mount.innerHTML='<summary>Unit material cost details <span>'+(report.unknown?'Known cost ':'')+money(report.total)+(report.unknown?' · incomplete':'')+'</span></summary>'+reportHTML(report,false);
      stock.innerHTML='<summary>Material pricing &amp; purchases <span>Set prices · record receipts</span></summary>'+stockHTML(report);
      page.querySelectorAll('[data-it-plus],[data-it-minus],[data-it-edit-stock],[data-it-toggle-manage]').forEach(function(b){b.disabled=!report.data.can_edit});quickStatus();
    }catch(error){if(version!==epoch)return;var msg='<p class="ic-notice" role="alert">'+esc(error.message||'Costs could not load. No totals are shown.')+'</p>'+button('refresh','Try again');if(mount)mount.innerHTML='<summary>Unit material cost details — unavailable</summary>'+msg;stock.innerHTML='<summary>Material pricing &amp; purchases — unavailable</summary>'+msg;quickMessage={context:context,text:'Material buttons are paused because current stock and costs could not be verified. Refresh to try again.'};quickStatus();}
  }
  async function renderArchive(container,context){
    var mount=root.document.createElement('section');mount.className='ic-unit';container.prepend(mount);mount.innerHTML='<p role="status">Loading material costs…</p>';
    try{var report=await read(context);if(!mount.isConnected||!same(context,scope(context.vehicle)))return;mount.innerHTML=reportHTML(report,true);mount._costReport={context:context,report:report};}
    catch(e){if(mount.isConnected)mount.innerHTML='<p class="ic-notice">'+esc(e.message||'Material costs could not load.')+'</p>';}
  }
  function field(name,label,type,value,attrs){return '<label>'+esc(label)+'<input name="'+name+'" type="'+(type||'text')+'" value="'+esc(value==null?'':value)+'" '+(attrs||'')+' required></label>'}
  function ensureDialog(){
    if(dialog)return;dialog=root.document.createElement('dialog');dialog.id='inventoryCostForm';dialog.setAttribute('aria-labelledby','icFormTitle');root.document.body.appendChild(dialog);
    dialog.addEventListener('cancel',function(e){if(saving)e.preventDefault()});
    dialog.addEventListener('close',function(){formEpoch++;if(!saving)formState=null;if(opener&&opener.isConnected)opener.focus()});
    dialog.addEventListener('click',function(e){if(e.target.closest('[data-ic-cancel]')&&!saving)dialog.close()});
    dialog.addEventListener('change',function(e){if(e.target.name==='material_id'&&formState&&!saving){formState.material=e.target.value;formState.requestId=null;formState.retryPayload=null;fillForm()}});
    dialog.addEventListener('submit',submit);
    dialog.addEventListener('input',function(){if(formState&&!saving){formState.requestId=null;formState.retryPayload=null}preview()});
  }
  async function open(action,material,record,trigger){
    if(saving)return;if(quickPending){quickStatus();return;}var version=++formEpoch;opener=trigger;ensureDialog();dialog.innerHTML='<p role="status">Checking current stock and prices…</p>';dialog.showModal();
    var captured=record?record.context:scope(root.BWCInventoryTracker&&root.BWCInventoryTracker.context().vehicle);
    try{
      var report=await read(captured);if(version!==formEpoch||!dialog.open||!same(captured,scope(captured.vehicle)))return;
      if(!report.data.can_edit)throw new Error('Inventory edit access is required to change costs.');
      formState={context:captured,report:report,action:action,material:material||'',requestId:null,retryPayload:null};fillForm();
    }catch(e){if(version===formEpoch&&dialog.open)dialog.innerHTML='<p class="ic-notice" role="alert">'+esc(e.message)+'</p><button type="button" data-ic-cancel>Close</button>';}
  }
  function fillForm(){
    var state=formState,a=state.action,r=state.report,m=r.rows.find(function(x){return x.id===state.material}),data=m&&m.material;
    var titles={purchase:'Record material purchase',opening:'Value existing stock',count:'Correct stock count',use:'Record material usage',return:'Return unused material / correct usage',baseline:'Verify past usage cost',create:'Add a material'};
    var description={purchase:'Enter the actual receipt cost per measurement unit. This adds stock, not another expense entry.',opening:'Enter a supported average cost for the stock already on hand. Quantity does not increase.',count:'For a verified count discrepancy only—not a purchase or vehicle usage. Stock value changes at the current average cost.',use:'Stock and this unit’s material cost will be saved together at the current average cost.',return:'Select the original usage. The quantity and its original saved cost are reversed together; today’s price is not substituted.',baseline:'Review older records for overlap. Enter the verified TOTAL quantity and average historical cost for this material on this unit. This is a one-time historical valuation, does not move stock, and cannot be overwritten here.',create:'Create a separate material for each brand, grade and package/measurement size. It starts with zero stock; record a purchase next.'};
    var selector=a==='create'?'': '<label>Material<select name="material_id" required><option value="">Choose a material</option>'+r.rows.map(function(x){return '<option value="'+esc(x.id)+'"'+(x.id===state.material?' selected':'')+'>'+esc(x.name)+'</option>'}).join('')+'</select></label>';
    var body=selector;
    if(a==='create')body+=field('name','Material name / brand / grade','text','','maxlength="150"')+field('note','Reason','text','New material','maxlength="1000"');
    else if(data){
      body+='<div class="ic-form-stock">Available: <b>'+qty(data.quantity)+' '+esc(data.measure_unit||'unit unspecified')+'</b> · Average cost: <b>'+(data.stock_unit_cost==null?'Not available':money(data.stock_unit_cost,4))+'</b></div>';
      if(['purchase','opening','baseline'].includes(a))body+=field('unit','Measurement unit (e.g. sheet, piece, liter, gallon)','text',data.measure_unit||'',data.measure_unit?'readonly':'maxlength="30"');
      if(a==='baseline')body+='<p class="ic-notice">Old net adjustments: '+qty(data.old_adjustment_qty)+' · Old recorded usage: '+qty(data.old_usage_qty)+'. These may refer to the same activity. Do not simply add them together.</p>';
      if(a==='return'){
        var entries=r.data.history.filter(function(h){return h.material_id===data.id&&Number(h.delta)>0}).map(function(h){var remaining=Number(h.delta)+r.data.history.filter(function(x){return x.return_of===h.id}).reduce(function(s,x){return s+Number(x.delta)},0);return {row:h,remaining:Math.round(remaining*100)/100}}).filter(function(x){return x.remaining>0});
        body+='<label>Original usage entry<select name="return_of" required><option value="">Select the entry being returned/corrected</option>'+entries.map(function(x){return '<option value="'+esc(x.row.id)+'">'+esc(date(x.row.recorded_at))+' · '+qty(x.remaining)+' remaining · '+money(x.row.unit_cost,4)+'</option>'}).join('')+'</select></label>';
        if(!entries.length)body+='<p class="ic-notice">No costed usage is available to reverse. Historical records must be reviewed separately.</p>';
      }
      body+=field('quantity',a==='opening'?'Existing quantity to value':a==='count'?'Verified stock count':a==='baseline'?'Verified past quantity used':'Quantity','number',a==='opening'||a==='count'?data.quantity:a==='baseline'?'':1,'min="'+(['use','purchase','return'].includes(a)?'0.01':'0')+'" step="0.01" max="999999999"'+(a==='opening'?' readonly':''));
      if(['purchase','opening','baseline'].includes(a))body+=field('unit_cost','Actual / verified purchase cost per measurement unit (PHP)','number','','min="0" step="0.0001" max="999999999"');
      if(a==='purchase')body+=field('supplier','Supplier','text','','maxlength="200"')+field('receipt','Receipt / reference number','text','','maxlength="200"')+field('purchase_date','Actual purchase date','date',new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
      body+=field('note',a==='use'?'Job / usage note':'Reason / supporting record reference','text',a==='use'?'Materials used on unit':'','minlength="3" maxlength="1000"');
      if(a==='baseline')body+='<label class="ic-check"><input type="checkbox" name="confirmed" required>I verified the historical quantity, checked for duplicate records and have support for this cost.</label>';
    }
    dialog.innerHTML='<form><div class="ic-heading"><h2 id="icFormTitle">'+titles[a]+'</h2><button type="button" class="ic-button" data-ic-cancel>Close</button></div><p class="ic-help">'+description[a]+'</p>'+(state.context.vehicle&&r.data.vehicle&&['use','return','baseline'].includes(a)?'<p><b>'+esc(r.data.vehicle.vehicle_name)+' · '+esc(r.data.vehicle.plate_number)+'</b></p>':'')+'<div class="ic-fields">'+body+'</div><p data-ic-preview class="ic-form-stock"></p><p data-ic-error role="alert"></p><div class="ic-form-footer"><button type="button" class="ic-button" data-ic-cancel>Cancel</button><button class="ic-button ic-primary" type="submit" '+(!data&&a!=='create'?'disabled':'')+'>Save '+(a==='use'?'usage':a==='purchase'?'purchase':a==='baseline'?'verified history':'record')+'</button></div></form>';
    preview();
  }
  function preview(){
    if(!dialog||!formState)return;var f=dialog.querySelector('form'),el=dialog.querySelector('[data-ic-preview]');if(!f||!el)return;
    var d=new root.FormData(f),q=Number(d.get('quantity')),price=d.get('unit_cost'),m=formState.report.rows.find(function(r){return r.id===d.get('material_id')});
    if(price!==null&&price!==''&&Number.isFinite(q*Number(price)))el.textContent='Recorded value: '+money(q*Number(price));
    else if(formState.action==='use'&&m&&m.material.stock_unit_cost!=null)el.textContent='Estimated usage cost: '+money(q*Number(m.material.stock_unit_cost))+' · confirmed by the server when saved';
    else el.textContent='';
  }
  function payloadFrom(state,values){
    var a=state.action,m=state.report.rows.find(function(r){return r.id===values.material_id});
    var p={action:a,note:String(values.note||'').trim()};
    if(p.note.length<3)throw new Error('Enter a reason or supporting reference.');
    if(a==='create'){p.name=String(values.name||'').trim();if(!p.name)throw new Error('Enter the material name.');return p;}
    if(!m)throw new Error('Choose a material from this branch.');
    p.material_id=m.id;p.quantity=num(values.quantity);p.expected_updated_at=m.material.updated_at;
    if(p.quantity<0||Math.abs(p.quantity*100-Math.round(p.quantity*100))>0.00001||(['use','purchase','return'].includes(a)&&p.quantity===0))throw new Error('Enter a valid quantity with at most two decimal places.');
    if(['use','return','baseline'].includes(a)){if(!state.context.vehicle)throw new Error('Choose a unit first.');p.vehicle_id=state.context.vehicle;}
    if(['purchase','opening','baseline'].includes(a)){p.unit_cost=num(values.unit_cost);if(p.unit_cost<0)throw new Error('The purchase cost cannot be negative.');p.unit=String(values.unit||'').trim();if(!p.unit)throw new Error('Enter the measurement unit.');}
    if(a==='purchase'){p.supplier=String(values.supplier||'').trim();p.receipt=String(values.receipt||'').trim();p.purchase_date=values.purchase_date;if(!p.supplier||!p.receipt||!p.purchase_date)throw new Error('Supplier, receipt reference and purchase date are required.');}
    if(a==='baseline'){p.confirmed=values.confirmed==='on';if(!p.confirmed)throw new Error('Confirm that the historical records were reviewed for duplicates.');}
    if(a==='return'){p.return_of=values.return_of;if(!p.return_of)throw new Error('Select the original usage entry.');}
    return p;
  }
  async function submit(event){
    event.preventDefault();if(saving||!formState)return;var errorBox=dialog.querySelector('[data-ic-error]'),state=formState;
    try{
      if(!same(state.context,scope(state.context.vehicle)))throw new Error('The branch changed. Close this form and reopen it in the correct branch.');
      var payload=state.retryPayload||payloadFrom(state,Object.fromEntries(new root.FormData(event.target)));
      if(!state.requestId)state.requestId=root.crypto.randomUUID();state.retryPayload=payload;saving=true;
      dialog.querySelectorAll('button,input,select').forEach(function(el){el.disabled=true});errorBox.textContent='Saving quantity and cost together…';
      state.uncertain=true;
      var r=await client().rpc('inventory_tracker_cost_action',{p_business_id:state.context.business,p_branch_id:state.context.branch,p_request_id:state.requestId,p_payload:payload});
      if(r.error){state.uncertain=!r.error.code;throw new Error(r.error.message);}if(!r.data||!r.data.ok)throw new Error('The save result is uncertain. Retry this unchanged form to check the same request safely.');
      saving=false;quickMessage=null;dialog.close();changed(state.context);var archived=root.document.getElementById('inventoryMaterialHistory');if(archived&&archived.open){var refresh=archived.querySelector('[data-imh-refresh]');if(refresh)refresh.click();}
    }catch(e){errorBox.textContent=(e.message||'The save could not be confirmed.')+' No automatic retry was made. Retry the unchanged form to safely reuse the same request; close and reopen if the stock changed.';}
    finally{saving=false;if(dialog.open)dialog.querySelectorAll('button,input,select').forEach(function(el){el.disabled=!!state.uncertain&&el.tagName!=='BUTTON'});}
  }
  function refresh(){if(root.BWCInventoryTracker)root.BWCInventoryTracker.refresh();}
  function changed(context){refresh();var message={business:context.business,branch:context.branch,nonce:Date.now()};if(channel)channel.postMessage(message);try{root.localStorage.setItem('bwc-inventory-cost-changed',JSON.stringify(message))}catch(e){}root.document.dispatchEvent(new CustomEvent('bwc:inventory-cost-changed',{detail:message}));}
  function install(){
    if(!root)return;
    try{var pending=JSON.parse(root.sessionStorage.getItem(quickStorageKey)||'null');if(pending&&pending.context&&pending.requestId&&pending.payload){quickPending=pending;quickMessage={context:pending.context,text:'A previous material save needs confirmation. Retry the same save before recording another item.'};}}catch(e){}
    var s=root.document.createElement('style');s.id='inventoryCostStyle';s.textContent=
      '.ic-unit,.ic-stock{font:16px/1.5 Arial,sans-serif;color:#252222}.ic-stock{margin-top:22px;padding:22px;border:1px solid #e9dcd5;border-radius:14px;background:#fff}.ic-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:12px 0}.ic-heading h3,.ic-heading h2{margin:2px 0!important;font-size:20px!important}.ic-kicker{font-size:12px;letter-spacing:1.4px;color:#a33a13}.ic-summary{display:grid;grid-template-columns:1.1fr 1fr;gap:12px;margin:18px 0}.ic-summary>div{border:1px solid #eed9cb;background:#fff6ef;border-radius:12px;padding:18px}.ic-summary span,.ic-summary small{display:block;font-size:14px;color:#685449}.ic-summary strong{display:block;font-size:29px;color:#bd410c;margin:5px 0;font-variant-numeric:tabular-nums}.ic-scroll{overflow:auto;border:1px solid #e8ddd7;border-radius:10px}.ic-table{width:100%;min-width:720px;border-collapse:collapse}.ic-table th,.ic-table td{font-size:14px;padding:12px;text-align:left;vertical-align:top;border-bottom:1px solid #eaded8}.ic-table thead th{background:#f7f4f2;color:#685449}.ic-table td{font-variant-numeric:tabular-nums}.ic-table small{display:block;font-size:12px;font-weight:400;margin-top:5px;max-width:330px}.ic-table tbody tr:last-child>*{border-bottom:0}.ic-row-actions{min-width:130px}.ic-button{border:1px solid #cbb8ad!important;background:#fff!important;border-radius:8px!important;color:#65351d!important;font:600 14px Arial!important;padding:9px 12px!important;cursor:pointer}.ic-row-actions .ic-button{display:block;margin:0 0 7px}.ic-primary{background:#d84b12!important;color:white!important;border-color:#d84b12!important}.ic-button:disabled{opacity:.5;cursor:not-allowed}.ic-button:focus-visible{outline:3px solid #205ec8;outline-offset:2px}.ic-help{font-size:14px;color:#685449}.ic-notice{background:#fff8e8;border:1px solid #e1b966;border-radius:9px;padding:13px;font-size:14px;color:#754400}.ic-warning-text{color:#875200}.ic-history{margin:18px 0}.ic-history summary{cursor:pointer;font-weight:bold;margin:10px 0}.ic-history .ic-table{min-width:680px}#inventoryCostForm{width:min(680px,calc(100vw - 24px));max-width:none;max-height:90vh;border:1px solid #d6c4b9;border-radius:14px;padding:24px;color:#252222;font:16px/1.5 Arial;background:#fff}#inventoryCostForm::backdrop{background:#20181099}.ic-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}.ic-fields label{display:flex;flex-direction:column;gap:5px;font-size:14px;font-weight:600}.ic-fields input,.ic-fields select{width:100%;box-sizing:border-box;font:16px Arial;padding:10px;border:1px solid #cdbfb6;border-radius:7px;background:#fff;color:#252222}.ic-fields input[readonly]{background:#f2eeeb}.ic-form-stock,.ic-fields .ic-notice{grid-column:1/-1;font-size:14px;background:#f7f3ef;padding:12px;border-radius:8px}.ic-fields .ic-check{grid-column:1/-1;flex-direction:row;align-items:start}.ic-check input{width:auto;margin:4px 8px 0 0}.ic-form-footer{display:flex;justify-content:flex-end;gap:10px;padding-top:16px;border-top:1px solid #e8ddd7}[data-ic-error]{font-size:14px;color:#a32412;white-space:pre-wrap}@media(max-width:650px){.ic-summary,.ic-fields{grid-template-columns:1fr}.ic-stock{padding:14px}.ic-summary strong{font-size:25px}.ic-heading{align-items:flex-start}}';root.document.head.appendChild(s);
    s.textContent+='.ic-table tbody th{text-transform:none!important;background:#fff;font-weight:600}.ic-table tbody th small{text-transform:none!important}.ic-table td{background:#fff}.ic-unit,.ic-stock,.inventory-tracker .it-panel{min-width:0}';
    s.textContent+='.ic-quick-help{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 12px;font-size:12px;color:#75645d}.ic-quick-help .ic-button{font-size:12px!important;padding:7px 10px!important;white-space:nowrap}.ic-quick-status{padding:10px 12px;background:#fff7ed;border:1px solid #f0d1b4;border-radius:8px;font-size:13px;color:#713e17}.ic-quick-status .ic-button{margin:6px}.ic-cost-panel{margin:16px 0;border:1px solid #eaded8;border-radius:10px;padding:12px}.ic-cost-panel>summary,.ic-pricing>summary{cursor:pointer;font-size:14px;font-weight:700}.ic-cost-panel>summary span,.ic-pricing>summary span{font-weight:400;color:#75645d;margin-left:10px;font-size:12px}.ic-pricing{font-size:14px}.it-material-actions button:disabled{opacity:.45;cursor:not-allowed}@media(max-width:520px){.ic-quick-help{align-items:flex-start;flex-wrap:wrap}.ic-cost-panel>summary span{display:block;margin:4px 0}}';
    root.document.addEventListener('click',function(e){
      var b=e.target.closest('[data-ic-action]');if(b){e.preventDefault();e.stopImmediatePropagation();var a=b.dataset.icAction;if(a==='pricing'){showPricing();return;}if(a==='retry-quick'){quickStep(null,0,true);return;}if(a==='refresh'){var history=b.closest('#inventoryMaterialHistory');if(history)history.querySelector('[data-imh-refresh]').click();else refresh();return;}var archive=b.closest('.ic-unit');open(a,b.dataset.icMaterial,archive&&archive._costReport||current,b);return;}
      var step=e.target.closest('#inventoryTracker [data-it-unit-plus],#inventoryTracker [data-it-unit-minus]');
      if(step){e.preventDefault();e.stopImmediatePropagation();quickStep(step.dataset.itUnitPlus||step.dataset.itUnitMinus,step.hasAttribute('data-it-unit-plus')?1:-1,false);return;}
      var stockButton=e.target.closest('#inventoryTracker [data-it-plus],#inventoryTracker [data-it-minus],#inventoryTracker [data-it-edit-stock],#inventoryTracker [data-it-toggle-manage]');
      if(stockButton){e.preventDefault();e.stopImmediatePropagation();var id=stockButton.dataset.itPlus||stockButton.dataset.itMinus||stockButton.dataset.itEditStock,r=current&&current.report.rows.find(function(x){return x.id===id});open(stockButton.hasAttribute('data-it-toggle-manage')?'create':stockButton.hasAttribute('data-it-plus')?'purchase':r&&!r.material.cost_initialized?'opening':'count',id,current,stockButton);return;}
      // Suppress cached/legacy stock buttons: new transactions must own all writes.
      var old=e.target.closest('#inventoryTracker [data-it-unit-plus],#inventoryTracker [data-it-unit-minus],#inventoryTracker [data-it-plus],#inventoryTracker [data-it-minus],#inventoryTracker [data-it-save-material],#inventoryTracker [data-it-record],#inventoryTracker [data-it-stepper]');
      if(old){e.preventDefault();e.stopImmediatePropagation();refresh();}
    },true);
    function invalidate(){epoch++;formEpoch++;current=null;if(dialog&&dialog.open&&!saving)dialog.close();var page=root.document.getElementById('inventoryTracker');if(page)page.innerHTML='<p role="status">Loading the selected branch…</p>';}
    ['bwc:branch-ready','bwc:business-ready'].forEach(function(n){root.document.addEventListener(n,invalidate)});
    function receive(m){if(m&&same({business:m.business,branch:m.branch},{business:scope().business,branch:scope().branch})){refresh();var h=root.document.getElementById('inventoryMaterialHistory');if(h&&h.open)h.querySelector('[data-imh-refresh]').click();}}
    if(root.BroadcastChannel){channel=new root.BroadcastChannel('bwc-inventory-costing');channel.onmessage=function(e){receive(e.data)}}
    root.addEventListener('storage',function(e){if(e.key==='bwc-active-business'||e.key==='bwc-active-branch'){invalidate();refresh();}if(e.key==='bwc-inventory-cost-changed'){try{receive(JSON.parse(e.newValue))}catch(err){}}});
    root.document.addEventListener('visibilitychange',function(){if(!root.document.hidden){var p=root.document.getElementById('inventoryTracker');if(p&&p.classList.contains('active'))refresh();}});
  }
  return {install:install,render:render,renderArchive:renderArchive,model:model,reportHTML:reportHTML,stockHTML:stockHTML,payloadFrom:payloadFrom,quickPayload:quickPayload};
}));
