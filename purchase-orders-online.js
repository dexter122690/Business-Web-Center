/* Purchase Orders: branch-based supplier orders that become Expenses on confirmed receipt. */
(function(){
  var db=null,businessId='',userId='',online=false,orders=[],lines=[],draft={},editingId='',catalog=[],catalogMessage='',catalogVersion=0,loadVersion=0;
  var receivingOrders=new Set();
  function esc(v){return String(v||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function peso(v){return 'PHP '+Number(v||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function branch(){return localStorage.getItem('bwc-active-branch')||''}
  function today(){return new Date().toISOString().slice(0,10)}
  function value(id){var el=document.getElementById(id);return el?el.value.trim():''}
  function number(v){return Number(v)||0}
  function root(){return document.getElementById('purchaseorders')}
  function notice(text){var el=document.getElementById('poStatus');if(el)el.textContent=text}
  function statusClass(status){return status==='Received'?'badge good':status==='Approved'?'badge warn':'badge'}
  function makeNumber(){
    var highest=orders.reduce(function(max,order){
      var match=String(order.po_number||'').trim().match(/^(\d+)/);
      return match?Math.max(max,Number(match[1])||0):max;
    },0);
    return String(highest+1);
  }
  function freshDraft(){return {po_number:makeNumber(),order_date:today(),supplier_name:'',expected_date:'',payment_method:'Authorized Manager',notes:''}}
  function getDraft(){return Object.assign(freshDraft(),draft)}
  function rememberForm(){
    if(!root())return;
    draft={po_number:value('poNumber')||makeNumber(),order_date:value('poDate')||today(),supplier_name:value('poSupplier'),expected_date:value('poExpected'),payment_method:value('poPayment')||'Authorized Manager',notes:value('poNotes')};
  }
  function resetForm(){editingId='';lines=[];draft=freshDraft()}
  function orderTotal(order){return (order.purchase_order_items||[]).reduce(function(sum,line){return sum+number(line.quantity)*number(line.unit_cost)},0)}
  function render(){
    var host=root();if(!host)return;var f=getDraft(),draftCount=orders.filter(function(o){return o.status==='Draft'}).length,approved=orders.filter(function(o){return o.status==='Approved'}).length,received=orders.filter(function(o){return o.status==='Received'}).length,total=lines.reduce(function(sum,line){return sum+number(line.quantity)*number(line.unit_cost)},0);
    var html='<div class="heading"><div><div class="k">Purchase orders</div><h1>Order parts before purchasing</h1><p class="muted">Save a draft, approve it, then click Receive items when the delivery arrives. A supplier receipt number is required. Expenses are created only after you confirm receipt.</p></div><button class="secondary" type="button" data-po-refresh>Refresh</button></div>';
    html+='<div id="poStatus" class="notice">Purchase Orders are connected to this branch only.</div>';
    html+='<div class="grid" style="margin-top:14px"><div class="card"><div class="muted">Draft orders</div><div class="metric">'+draftCount+'</div></div><div class="card"><div class="muted">Approved / waiting delivery</div><div class="metric">'+approved+'</div></div><div class="card"><div class="muted">Received orders</div><div class="metric">'+received+'</div></div></div>';
    html+='<div class="split" style="margin-top:14px"><div class="card"><div class="k">'+(editingId?'Editing purchase order':'New purchase order')+'</div><h2>Supplier order details</h2><form id="poForm" class="formgrid"><label>PO number<input id="poNumber" value="'+esc(f.po_number)+'"></label><label>Order date<input id="poDate" type="date" value="'+esc(f.order_date)+'"></label><label style="grid-column:span 2">Supplier name *<input id="poSupplier" required value="'+esc(f.supplier_name)+'" placeholder="e.g., ABC Auto Supply"></label><label>Expected delivery<input id="poExpected" type="date" value="'+esc(f.expected_date)+'"></label><label>Payment source<select id="poPayment"><option'+(f.payment_method==='Authorized Manager'?' selected':'')+'>Authorized Manager</option><option'+(f.payment_method==='CIB'?' selected':'')+'>CIB</option><option'+(f.payment_method==='Petty Cash'?' selected':'')+'>Petty Cash</option></select></label><label style="grid-column:1/-1">Notes (optional)<input id="poNotes" value="'+esc(f.notes)+'" placeholder="e.g., Quoted price valid for seven days"></label></form></div>';
    html+='<div class="card"><div class="k">Order items</div><h2>Add items to this order</h2><div class="formgrid"><label style="grid-column:span 2">Item / material *<input id="poItem" placeholder="e.g., Paint thinner"></label><label>Category<select id="poCategory"><option>Parts & Materials</option><option>Cost of Sales</option><option>Supplies Expense</option><option>Other</option></select></label><label>Quantity<input id="poQty" type="number" min="0.01" step="0.01" value="1"></label><label>Unit cost (PHP)<input id="poCost" type="number" min="0" step="0.01" value="0"></label><div class="actions" style="grid-column:1/-1"><button type="button" class="primary" data-po-add-line>Add item</button></div></div><div style="overflow:auto;margin-top:10px"><table><thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Unit cost</th><th>Total</th><th></th></tr></thead><tbody>'+(lines.length?lines.map(function(line,index){return '<tr><td>'+esc(line.description)+'</td><td>'+esc(line.category)+'</td><td>'+line.quantity+'</td><td>'+peso(line.unit_cost)+'</td><td><b>'+peso(number(line.quantity)*number(line.unit_cost))+'</b></td><td><button class="secondary" type="button" data-po-remove-line="'+index+'">Remove</button></td></tr>'}).join(''):'<tr><td colspan="6" class="empty">No items added yet.</td></tr>')+'</tbody></table></div><div class="actions" style="margin-top:14px"><b>Order total: '+peso(total)+'</b><button type="button" class="primary" data-po-save>'+ (editingId?'Save changes':'Save draft order')+'</button>'+(editingId?'<button type="button" class="secondary" data-po-cancel-edit>Cancel edit</button>':'')+'</div></div></div>';
    html+='<div class="card" style="margin-top:14px"><div class="k">Purchase order register</div><h2>Supplier orders by branch</h2><div style="overflow:auto"><table><thead><tr><th>PO number</th><th>Supplier</th><th>Order date</th><th>Expected</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>'+(orders.length?orders.map(function(order){var buttons='<button class="secondary" type="button" data-po-print="'+order.id+'">Print</button> ';if(order.status==='Draft'){buttons+='<button class="secondary" type="button" data-po-edit="'+order.id+'">Edit</button> <button class="primary" type="button" data-po-approve="'+order.id+'">Approve</button> <button class="secondary" type="button" data-po-delete="'+order.id+'">Delete</button>'}else if(order.status==='Approved'){buttons+='<button class="secondary" type="button" data-po-edit="'+order.id+'">Edit</button> <button class="primary" type="button" data-po-receive="'+order.id+'">Receive items</button> <button class="secondary" type="button" data-po-delete="'+order.id+'">Delete</button>'}else{buttons+='<span class="muted">Received '+esc(String(order.received_at||'').slice(0,10))+'</span>'}return '<tr><td><b>'+esc(order.po_number)+'</b></td><td>'+esc(order.supplier_name)+'</td><td>'+esc(order.order_date)+'</td><td>'+esc(order.expected_date||'—')+'</td><td><b>'+peso(orderTotal(order))+'</b></td><td><span class="'+statusClass(order.status)+'">'+esc(order.status)+'</span></td><td>'+buttons+'</td></tr>'}).join(''):'<tr><td colspan="7" class="empty">No purchase orders in this branch yet.</td></tr>')+'</tbody></table></div></div>';
    host.innerHTML=html;bind();setupMaterialPicker();notice(editingId?'Editing this purchase order. Save changes when ready.':'Purchase Orders are connected to this branch only.');
  }
  // Suggestions only: no SKU mapping, stock writes or automatic supplier prices.
  function materialOrder(a,b){var an=/^liha\s+(\d+)/i.exec(a.item_name||''),bn=/^liha\s+(\d+)/i.exec(b.item_name||'');if(an&&bn)return Number(an[1])-Number(bn[1]);if(an)return -1;if(bn)return 1;return String(a.item_name||'').localeCompare(String(b.item_name||''),undefined,{numeric:true,sensitivity:'base'})}
  function setupMaterialPicker(){
    var input=document.getElementById('poItem');if(!input)return;
    var list=document.getElementById('poMaterialOptions');if(!list){list=document.createElement('datalist');list.id='poMaterialOptions';document.body.appendChild(list)}
    list.innerHTML='';catalog.forEach(function(item){var option=document.createElement('option');option.value=item.item_name;list.appendChild(option)});
    input.setAttribute('list',list.id);input.setAttribute('autocomplete','off');input.setAttribute('placeholder','Choose a material or type another item');
    var hint=document.getElementById('poMaterialHint');if(!hint){hint=document.createElement('small');hint.id='poMaterialHint';hint.className='muted';input.insertAdjacentElement('afterend',hint)}
    hint.textContent=catalogMessage||'Suggestions from this branch\'s Inventory Tracker. Other items can be typed too.';input.setAttribute('aria-describedby',hint.id);
  }
  async function loadMaterials(){
    var context={business:businessId,branch:branch()},version=++catalogVersion;
    function current(){return version===catalogVersion&&context.business===businessId&&context.business===(localStorage.getItem('bwc-active-business')||'')&&context.branch===branch()}
    catalog=[];catalogMessage='Loading Inventory Tracker materials. You can still type an item.';setupMaterialPicker();
    try{
      var rows=[],seen=new Set(),expected=null;
      for(;;){
        var r=await db.from('inventory_tracker_materials').select('id,business_id,branch_id,item_name',{count:'exact'}).eq('business_id',context.business).eq('branch_id',context.branch).order('item_name').order('id').range(rows.length,rows.length+499);
        if(!current())return;if(r.error)throw r.error;
        if(!Number.isInteger(r.count)||r.count<0||(expected!==null&&expected!==r.count))throw Error('Material list changed while loading.');expected=r.count;
        var page=r.data||[];page.forEach(function(row){if(!row.id||seen.has(row.id)||row.business_id!==context.business||row.branch_id!==context.branch||!String(row.item_name||'').trim())throw Error('Incomplete material list.');seen.add(row.id);rows.push(row)});
        if(rows.length===expected)break;if(!page.length||rows.length>expected)throw Error('Incomplete material list.');
      }
      catalog=rows.sort(materialOrder);catalogMessage=catalog.length?'':'No Inventory Tracker materials in this branch yet. Type any item to continue.';
    }catch(e){if(!current())return;catalog=[];catalogMessage='Material suggestions could not load. You can type any item, or press Refresh to retry.'}
    if(current())setupMaterialPicker();
  }
  function bind(){var host=root();host.querySelector('[data-po-refresh]').onclick=load;host.querySelector('[data-po-add-line]').onclick=addLine;host.querySelector('[data-po-save]').onclick=save;var cancel=host.querySelector('[data-po-cancel-edit]');if(cancel)cancel.onclick=function(){resetForm();render()};host.querySelectorAll('[data-po-remove-line]').forEach(function(b){b.onclick=function(){rememberForm();lines.splice(Number(b.dataset.poRemoveLine),1);render()}});host.querySelectorAll('[data-po-print]').forEach(function(b){b.onclick=function(){printOrder(b.dataset.poPrint)}});host.querySelectorAll('[data-po-edit]').forEach(function(b){b.onclick=function(){edit(b.dataset.poEdit)}});host.querySelectorAll('[data-po-approve]').forEach(function(b){b.onclick=function(){approve(b.dataset.poApprove)}});host.querySelectorAll('[data-po-receive]').forEach(function(b){b.onclick=function(){receive(b.dataset.poReceive)}});host.querySelectorAll('[data-po-delete]').forEach(function(b){b.onclick=function(){remove(b.dataset.poDelete)}})}
  function printOrder(id){var order=orders.find(function(row){return row.id===id});if(!order)return;var rows=(order.purchase_order_items||[]).map(function(line){var total=number(line.quantity)*number(line.unit_cost);return '<tr><td>'+esc(line.description)+'</td><td>'+esc(line.category)+'</td><td class="num">'+esc(line.quantity)+'</td><td class="num">'+peso(line.unit_cost)+'</td><td class="num">'+peso(total)+'</td></tr>'}).join('');var page='<!doctype html><html><head><meta charset="utf-8"><title>'+esc(order.po_number)+'</title><style>body{font-family:Arial,sans-serif;color:#1d1d1d;padding:32px;max-width:820px;margin:auto}h1{margin:0;color:#e64b1a;font-size:25px}.k{font-size:11px;letter-spacing:1.5px;color:#e64b1a;font-weight:bold;text-transform:uppercase}.top{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #e64b1a;padding-bottom:16px;margin-bottom:22px}.muted{color:#666}table{width:100%;border-collapse:collapse;margin-top:22px}th{background:#fff0ea;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px}th,td{padding:10px;border-bottom:1px solid #ddd}.num{text-align:right}.total{margin-top:16px;text-align:right;font-size:19px;font-weight:bold;color:#e64b1a}.foot{margin-top:42px;display:flex;justify-content:space-between;gap:50px}.sign{border-top:1px solid #222;text-align:center;padding-top:6px;flex:1;font-size:12px}@media print{body{padding:0}}</style></head><body><div class="top"><div><div class="k">Purchase order</div><h1>'+esc(order.po_number)+'</h1><p class="muted">Supplier order for this branch</p></div><div><b>Status:</b> '+esc(order.status)+'<br><b>Order date:</b> '+esc(order.order_date||'')+'<br><b>Expected:</b> '+esc(order.expected_date||'Not set')+'</div></div><h3>Supplier: '+esc(order.supplier_name)+'</h3>'+(order.notes?'<p><b>Notes:</b> '+esc(order.notes)+'</p>':'')+'<table><thead><tr><th>Item</th><th>Category</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Total</th></tr></thead><tbody>'+rows+'</tbody></table><div class="total">Order total: '+peso(orderTotal(order))+'</div><div class="foot"><div class="sign">Prepared by</div><div class="sign">Approved by</div></div><script>window.onload=function(){window.print()}<\/script></body></html>';var win=window.open('','_blank','width=900,height=760');if(!win){alert('Allow pop-ups to print this purchase order.');return}win.document.open();win.document.write(page);win.document.close()}
  function addLine(){var description=value('poItem'),quantity=number(value('poQty')),unitCost=number(value('poCost'));if(!description||quantity<=0||unitCost<0){alert('Enter the item, quantity, and unit cost.');return}rememberForm();lines.push({description:description,category:value('poCategory')||'Parts & Materials',quantity:quantity,unit_cost:unitCost});render()}
  function edit(id){var order=orders.find(function(row){return row.id===id});if(!order||order.status==='Received')return;editingId=id;draft={po_number:order.po_number,order_date:order.order_date||today(),supplier_name:order.supplier_name,expected_date:order.expected_date||'',payment_method:order.payment_method||'Authorized Manager',notes:order.notes||''};lines=(order.purchase_order_items||[]).map(function(line){return {description:line.description,category:line.category,quantity:number(line.quantity),unit_cost:number(line.unit_cost)}});render();root().scrollIntoView({behavior:'smooth',block:'start'})}
  function headerData(){rememberForm();return {business_id:businessId,branch_id:branch(),po_number:draft.po_number||makeNumber(),supplier_name:draft.supplier_name,order_date:draft.order_date||today(),expected_date:draft.expected_date||null,payment_method:draft.payment_method||'Authorized Manager',notes:draft.notes||null,created_by:userId}}
  async function save(){var header=headerData();if(!header.business_id||!header.branch_id){alert('Your workspace is still loading. Please wait a moment and try again.');return}if(!header.supplier_name||!lines.length){alert('Enter the supplier and add at least one item.');return}notice('Saving purchase order securely...');var id=editingId,wasEditing=Boolean(editingId),result;if(id){result=await db.from('purchase_orders').update(header).eq('id',id).eq('business_id',businessId).eq('branch_id',branch());if(result.error){alert('The purchase order could not be updated: '+result.error.message);notice('Purchase order was not updated.');return}var oldItems=await db.from('purchase_order_items').delete().eq('purchase_order_id',id);if(oldItems.error){alert('The purchase order header was updated, but its items could not be replaced: '+oldItems.error.message);return}}else{result=await db.from('purchase_orders').insert(header).select('id').single();if(result.error){alert('The purchase order could not be saved: '+result.error.message);notice('Purchase order was not saved.');return}id=result.data.id}var items=lines.map(function(line,index){return {purchase_order_id:id,category:line.category,description:line.description,quantity:line.quantity,unit_cost:line.unit_cost,sort_order:index}}),saved=await db.from('purchase_order_items').insert(items);if(saved.error){alert('The order items could not be saved: '+saved.error.message);notice('The order was not completed. Please contact support before trying again.');return}resetForm();await load();alert(wasEditing?'Purchase order updated.':'Purchase order saved as Draft. Approve it when the supplier order is confirmed.')}
  async function approve(id){if(!confirm('Approve this purchase order? It will be ready to receive when the items arrive.'))return;var r=await db.from('purchase_orders').update({status:'Approved'}).eq('id',id).eq('business_id',businessId).eq('branch_id',branch());if(r.error){alert('The purchase order could not be approved: '+r.error.message);return}await load()}
  function requestReceipt(order){
    return new Promise(function(resolve){
      var dialog=document.createElement('dialog'),opener=document.activeElement,finished=false;
      dialog.setAttribute('aria-labelledby','poReceiptTitle');
      dialog.style.cssText='width:min(520px,calc(100vw - 40px));max-height:90vh;overflow:auto;box-sizing:border-box;border:1px solid #d8c9bf;border-radius:14px;padding:24px;color:#202630;background:#fff;box-shadow:0 20px 80px #0004';
      dialog.innerHTML='<form><h2 id="poReceiptTitle" style="margin-top:0">Receive purchase order</h2><p><b>PO '+esc(order.po_number)+'</b> · '+esc(order.supplier_name)+'</p><p>'+esc((order.purchase_order_items||[]).length)+' item(s) · '+peso(orderTotal(order))+'</p><label style="display:block;font-weight:600">Receipt number <span aria-hidden="true">*</span><input name="receipt_number" type="text" required maxlength="120" autocomplete="off" placeholder="Enter supplier receipt / OR number" style="display:block;box-sizing:border-box;width:100%;margin-top:8px;padding:12px;font:inherit;border:1px solid #c8b9af;border-radius:7px"></label><p style="font-size:13px;color:#566477">Enter the receipt number from the supplier for the items you received.</p><p style="padding:12px;background:#fff1e8;border-left:3px solid #ff501b">Confirming will create the Expenses for this PO. If this purchase is already encoded in Expenses, cancel to avoid a duplicate.</p><p data-po-receipt-error role="alert" style="color:#a52d13"></p><div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px"><button type="button" class="secondary" data-po-receipt-cancel>Cancel</button><button type="submit" class="primary">Confirm receive</button></div></form>';
      function finish(value){if(finished)return;finished=true;dialog.close();dialog.remove();if(opener&&opener.isConnected)opener.focus();resolve(value)}
      var input=dialog.querySelector('input'),form=dialog.querySelector('form');
      dialog.querySelector('[data-po-receipt-cancel]').onclick=function(){finish(null)};
      dialog.addEventListener('cancel',function(e){e.preventDefault();finish(null)});
      dialog.addEventListener('close',function(){finish(null)});
      input.addEventListener('input',function(){input.setCustomValidity('');dialog.querySelector('[data-po-receipt-error]').textContent=''});
      form.addEventListener('submit',function(e){
        e.preventDefault();var receipt=input.value.trim();
        if(!receipt||receipt.length>120){var message='Enter the supplier receipt number (1–120 characters).';input.setCustomValidity(message);dialog.querySelector('[data-po-receipt-error]').textContent=message;input.reportValidity();return}
        finish(receipt);
      });
      document.body.appendChild(dialog);dialog.showModal();input.focus();
    });
  }
  async function receive(id){
    var listed=orders.find(function(row){return row.id===id});
    if(!listed||listed.status!=='Approved')return;
    var context={business:businessId,branch:branch(),user:userId},key=context.business+':'+context.branch+':'+id;
    if(!context.business||!context.branch||receivingOrders.has(key))return;
    function current(){return context.business===businessId&&context.business===(localStorage.getItem('bwc-active-business')||'')&&context.branch===branch()}
    receivingOrders.add(key);
    var expensesSaved=false,order=listed;
    try{
      // Recheck the saved order; an already-received/stale screen must not post again.
      var fresh=await db.from('purchase_orders').select('*,purchase_order_items(*)').eq('id',id).eq('business_id',context.business).eq('branch_id',context.branch).single();
      if(!current())return;
      if(fresh.error||!fresh.data){alert('This purchase order could not be checked. Nothing was received. Refresh and try again.');return}
      order=fresh.data;
      if(order.status!=='Approved'){alert('This order is no longer waiting to be received. Refresh the purchase order list.');await load();return}
      var orderLines=order.purchase_order_items||[];
      if(!orderLines.length){alert('This purchase order has no items to receive.');return}
      var receipt=await requestReceipt(order);
      if(receipt===null)return;
      receipt=String(receipt).trim();
      if(!receipt){alert('Receipt number is required. Nothing was received or added to Expenses.');return}
      if(receipt.length>120){alert('Receipt number must be 120 characters or fewer. Nothing was received.');return}
      if(!current())return;
      // Detect a previous successful expense insert whose PO-status update failed.
      var existing=await db.from('expenses').select('id').eq('business_id',context.business).eq('branch_id',context.branch).eq('reference_number',order.po_number).eq('remarks','Received purchase order').limit(1);
      if(!current())return;
      if(existing.error){alert('Existing Expenses could not be checked. Nothing was received. Try again when the connection is stable.');return}
      if((existing.data||[]).length){alert('Expenses already exist for PO '+order.po_number+'. Do not receive it again. Please contact support to check its status.');return}
      notice('Receiving PO '+order.po_number+' with receipt '+receipt+'...');
      var entries=orderLines.map(function(line){return {business_id:context.business,branch_id:context.branch,expense_date:today(),supplier_name:order.supplier_name,receipt_number:receipt,category:line.category,description:line.description,quantity:line.quantity,unit_amount:line.unit_cost,payment_method:order.payment_method,reference_number:order.po_number,remarks:'Received purchase order',created_by:context.user}});
      var saved=await db.from('expenses').insert(entries);
      if(saved.error){alert('Receipt could not be confirmed: '+saved.error.message+'. Check Expenses before trying again.');return}
      expensesSaved=true;
      var updated=await db.from('purchase_orders').update({status:'Received',received_at:new Date().toISOString()}).eq('id',id).eq('business_id',context.business).eq('branch_id',context.branch).eq('status','Approved').select('id').maybeSingle();
      if(updated.error||!updated.data){alert('Expenses were created using receipt '+receipt+', but the PO status could not be confirmed. Do not receive it again. Please contact support with PO '+order.po_number+'.');return}
      document.dispatchEvent(new Event('bwc:expenses-loaded'));
      document.dispatchEvent(new Event('bwc:inventory-loaded'));
      await load();
      alert('PO '+order.po_number+' received. '+orderLines.length+' expense record(s) were created using supplier receipt '+receipt+'.');
    }catch(error){
      alert(expensesSaved?'Expenses were created, but receipt confirmation was interrupted. Do not receive PO '+order.po_number+' again. Please contact support.':'Receipt could not be confirmed. Check Expenses and refresh the purchase order list before trying again.');
    }finally{receivingOrders.delete(key)}
  }
  async function remove(id){var order=orders.find(function(row){return row.id===id});if(!order||order.status==='Received'){alert('Received purchase orders are kept as a record because they are already connected to Expenses and Inventory.');return}if(!confirm('Delete purchase order '+order.po_number+'?'))return;var r=await db.from('purchase_orders').delete().eq('id',id).eq('business_id',businessId).eq('branch_id',branch());if(r.error){alert('The purchase order could not be deleted: '+r.error.message);return}if(editingId===id)resetForm();await load()}
  async function load(){if(!online||!businessId||!branch())return;var context={business:businessId,branch:branch()},version=++loadVersion;notice('Loading purchase orders...');var results=await Promise.all([db.from('purchase_orders').select('*,purchase_order_items(*)').eq('business_id',context.business).eq('branch_id',context.branch).order('created_at',{ascending:false}),loadMaterials()]);if(version!==loadVersion||context.business!==businessId||context.business!==(localStorage.getItem('bwc-active-business')||'')||context.branch!==branch())return;var r=results[0];if(r.error){var host=root();if(host)host.innerHTML='<div class="card"><div class="k">Purchase Orders</div><h2>Database setup needed</h2><div class="notice">'+esc(r.error.message)+'. Run the Purchase Orders database update, then refresh this page.</div></div>';return}orders=r.data||[];if(!editingId&&!draft.supplier_name&&!lines.length)draft=freshDraft();render()}
  async function start(){var c=window.BUSINESS_WEB_CENTER_SUPABASE||{};if(!window.supabase||!c.url||!c.publishableKey){setTimeout(start,350);return}db=window.getBusinessSupabaseClient&&window.getBusinessSupabaseClient();if(!db){setTimeout(start,350);return}var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;if(!user){setTimeout(start,350);return}userId=user.id;businessId=localStorage.getItem('bwc-active-business')||'';if(!businessId||!branch()){setTimeout(start,350);return}online=true;draft=freshDraft();load()}
  document.addEventListener('bwc:branch-ready',function(){if(online){businessId=localStorage.getItem('bwc-active-business')||'';++loadVersion;++catalogVersion;catalog=[];catalogMessage='Choose a material or type another item.';setupMaterialPicker();resetForm();load()}});
  document.addEventListener('bwc:inventory-cost-changed',function(e){var context=e.detail||{};if(online&&context.business===businessId&&context.branch===branch())loadMaterials()});
  document.addEventListener('click',function(e){if(e.target.closest('[data-t="purchaseorders"]'))setTimeout(load,80)});setTimeout(start,700);
})();
