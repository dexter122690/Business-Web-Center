/* Online invoice adapter. The original page keeps its familiar interface while
   invoices are stored per business in Supabase. */
(function(){
  var db=null,businessId='',userId='',online=false;
  function localKey(){return '15m-replica-invoices'}
  function cache(){try{localStorage.setItem(localKey(),JSON.stringify(inv))}catch(e){}}
  function message(text){var box=document.getElementById('invoiceOnlineStatus');if(!box){box=document.createElement('div');box.id='invoiceOnlineStatus';box.className='notice';var view=document.getElementById('invoices');if(view)view.insertBefore(box,view.firstChild)}if(box)box.textContent=text}
  function normalize(row){var services=(row.invoice_services||[]).map(function(s){return {n:s.service_name,d:s.service_detail||'',a:Number(s.amount||0)}}),parts=(row.invoice_parts||[]).map(function(p){var q=Number(p.quantity||0),price=Number(p.unit_price||0);return {n:p.part_name,q:q,p:price,a:q*price}});return {id:row.invoice_number,remoteId:row.id,number:'INV-'+String(row.invoice_number).padStart(5,'0'),client:row.client_name,contact:row.contact_number,address:row.client_address,email:row.client_email||'',make:row.vehicle_make,yearModel:row.vehicle_year_model,color:row.vehicle_color,plate:row.plate_number,date:row.invoice_date,release:row.release_date||'',admin:row.assigned_admin,method:row.payment_method,source:row.client_source,services:services,parts:parts,total:Number(row.total_amount||0),paid:Number(row.amount_paid||0),balance:Math.max(0,Number(row.total_amount||0)-Number(row.amount_paid||0)),status:row.status}}
  async function resolveBusiness(){
    var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;if(!user)return null;userId=user.id;
    var memberships=await db.from('business_memberships').select('business_id,businesses!inner(id,name,status)').eq('user_id',user.id).eq('status','active');
    var saved=localStorage.getItem('bwc-active-business'),activeRows=(memberships.data||[]).filter(function(row){return row.businesses&&row.businesses.status==='active'}),active=activeRows.find(function(row){return row.business_id===saved})||activeRows[0];if(active){localStorage.setItem('bwc-active-business',active.business_id);localStorage.setItem('bwc-active-business-name',active.businesses.name);return active.business_id}
    var own=await db.from('businesses').select('id,name').eq('created_by',user.id).order('created_at',{ascending:true}).limit(2);
    if(own.data&&own.data.length===1){localStorage.setItem('bwc-active-business',own.data[0].id);localStorage.setItem('bwc-active-business-name',own.data[0].name);return own.data[0].id}
    return null;
  }
  async function loadRemote(){
    var query=db.from('invoices').select('*,invoice_services(*),invoice_parts(*)').eq('business_id',businessId),branchId=localStorage.getItem('bwc-active-branch');if(branchId)query=query.eq('branch_id',branchId);
    var result=await query.order('invoice_date',{ascending:false}).order('invoice_number',{ascending:false});
    if(result.error){message('Online invoices could not load: '+result.error.message);return}
    inv=(result.data||[]).map(normalize);cache();render();renderLists();document.dispatchEvent(new Event('bwc:invoices-loaded'));message('Online invoice records are active for '+(localStorage.getItem('bwc-active-business-name')||'this business')+'.');
  }
  function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,function(character){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]})}
  function isAdmin(worker){return /\badmin(istrator)?\b/i.test(String(worker.position||''))}
  function renderAdmins(rows){
    var field=document.getElementById('admin');if(!field)return;
    var selected=field.value,admins=(rows||[]).filter(function(worker){return worker.is_active!==false&&isAdmin(worker)});
    field.dataset.onlineAdmins='1';
    field.innerHTML='<option value="">Select admin</option>'+admins.map(function(worker){return '<option value="'+escapeHtml(worker.full_name)+'">'+escapeHtml(worker.full_name)+'</option>'}).join('');
    if(admins.some(function(worker){return worker.full_name===selected}))field.value=selected;
  }
  async function loadAdmins(){
    var branchId=localStorage.getItem('bwc-active-branch');if(!businessId||!branchId){renderAdmins([]);return}
    var result=await db.from('payroll_workers').select('full_name,position,is_active').eq('business_id',businessId).eq('branch_id',branchId).eq('is_active',true).order('full_name');
    if(result.error){renderAdmins([]);message('Admin list could not load: '+result.error.message);return}
    renderAdmins(result.data||[]);
  }
  function invoicePayload(x){return {business_id:businessId,branch_id:localStorage.getItem('bwc-active-branch'),client_name:x.client,contact_number:x.contact,client_address:x.address,client_email:x.email||null,vehicle_make:x.make,vehicle_year_model:x.yearModel,vehicle_color:x.color,plate_number:x.plate,invoice_date:x.date,release_date:x.release||null,assigned_admin:x.admin,payment_method:x.method,client_source:x.source,total_amount:x.total,amount_paid:x.paid,status:x.status,created_by:userId}}
  async function writeLines(remoteId,x){
    var servicesRows=x.services.map(function(s){return {invoice_id:remoteId,service_name:s.n,service_detail:s.d||null,amount:Number(s.a||0)}}),partsRows=x.parts.map(function(p){return {invoice_id:remoteId,part_name:p.n,quantity:Number(p.q||0),unit_price:Number(p.p||0)}});
    if(servicesRows.length){var s=await db.from('invoice_services').insert(servicesRows);if(s.error)throw new Error(s.error.message)}
    if(partsRows.length){var p=await db.from('invoice_parts').insert(partsRows);if(p.error)throw new Error(p.error.message)}
  }
  /* Cash received from an invoice belongs in CIB.  The record uses the
     invoice id as its source key, so editing a payment replaces the old
     cash-in instead of adding it again.  Non-cash methods never touch CIB. */
  async function syncInvoiceCashIn(remoteId,invoiceNumber,x){
    var branchId=localStorage.getItem('bwc-active-branch'),sourceKey='invoice-cash:'+remoteId;
    if(!branchId)return;
    /* Once installment history is enabled, CIB must follow only the cash
       installments, not the invoice's combined received total. */
    var paidAmount=Number(x.paid||0),cashPayments=null;
    var history=await db.from('invoice_payments').select('amount,payment_method').eq('invoice_id',remoteId);
    if(!history.error&&history.data&&history.data.length){
      cashPayments=history.data.filter(function(payment){return String(payment.payment_method||'').trim().toLowerCase()==='cash'}).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0);
    }
    var removed=await db.from('cash_transactions').delete().eq('business_id',businessId).eq('branch_id',branchId).eq('source_key',sourceKey);
    if(removed.error)throw new Error('CIB update failed: '+removed.error.message);
    var cashAmount=cashPayments===null?(String(x.method||'').trim().toLowerCase()==='cash'?paidAmount:0):cashPayments;
    if(cashAmount<=0){document.dispatchEvent(new Event('bwc:cash-updated'));return}
    var added=await db.from('cash_transactions').insert({
      business_id:businessId,
      branch_id:branchId,
      cash_account:'CIB',
      direction:'In',
      amount:cashAmount,
      transaction_date:x.date||new Date().toISOString().slice(0,10),
      source_key:sourceKey,
      reference_number:'INV-'+String(invoiceNumber).padStart(5,'0'),
      notes:'Cash received from invoice · '+String(x.client||'Client'),
      created_by:userId
    });
    if(added.error)throw new Error('CIB update failed: '+added.error.message);
    document.dispatchEvent(new Event('bwc:cash-updated'));
  }
  window.createInvoice=async function(){
    var req=['client','contact','address','make','yearModel','color','plate','invoiceDate','admin'];if(req.some(function(x){return !formValue(x)})){alert('Please complete every required field.');return}
    if(!services.length&&!parts.length){alert('Add at least one service or auto part.');return}
    var x={id:edit||Date.now(),remoteId:edit&&(inv.find(function(i){return i.id===edit})||{}).remoteId,number:'',client:formValue('client'),contact:formValue('contact'),address:formValue('address'),email:formValue('email'),make:formValue('make'),yearModel:formValue('yearModel'),color:formValue('color'),plate:formValue('plate'),date:invoiceDate.value,release:releaseDate.value,admin:admin.value,method:method.value,source:source.value,services:services.slice(),parts:parts.slice(),total:total(),paid:+paid.value||0};
    x.balance=Math.max(0,x.total-x.paid);x.status=x.paid>=x.total?'Paid':x.paid?'Partially paid':'Pending';
    if(!online){var position=inv.findIndex(function(i){return i.id===x.id});x.number=edit?(inv[position]||{}).number:'INV-'+String(inv.length+1).padStart(5,'0');position<0?inv.unshift(x):inv[position]=x;cache();resetInvoice();render();show('invoices');return}
    message('Saving invoice securely…');try{
      var saved;
      if(x.remoteId){var updated=await db.from('invoices').update(invoicePayload(x)).eq('id',x.remoteId).select('id,invoice_number').single();if(updated.error)throw new Error(updated.error.message);saved=updated.data;var removeServices=await db.from('invoice_services').delete().eq('invoice_id',x.remoteId);if(removeServices.error)throw new Error(removeServices.error.message);var removeParts=await db.from('invoice_parts').delete().eq('invoice_id',x.remoteId);if(removeParts.error)throw new Error(removeParts.error.message)}else{var inserted=await db.from('invoices').insert(invoicePayload(x)).select('id,invoice_number').single();if(inserted.error)throw new Error(inserted.error.message);saved=inserted.data}
      await writeLines(saved.id,x);await syncInvoiceCashIn(saved.id,saved.invoice_number,x);await loadRemote();resetInvoice();show('invoices');message('Invoice '+('INV-'+String(saved.invoice_number).padStart(5,'0'))+' saved securely online.');
    }catch(error){message('Invoice was not saved online: '+error.message);alert('The invoice could not be saved online. Please try again.')}};
  window.deleteInvoice=async function(id){
    var item=inv.find(function(x){return x.id===id});if(!item||!confirm('Delete this invoice?'))return;
    if(online&&item.remoteId){
      var branchId=localStorage.getItem('bwc-active-branch');
      if(branchId){var cash=await db.from('cash_transactions').delete().eq('business_id',businessId).eq('branch_id',branchId).eq('source_key','invoice-cash:'+item.remoteId);if(cash.error){message('Invoice cash record was not removed: '+cash.error.message);return}}
      var result=await db.from('invoices').delete().eq('id',item.remoteId);if(result.error){message('Invoice was not deleted: '+result.error.message);return}
      document.dispatchEvent(new Event('bwc:cash-updated'));
    }
    inv=inv.filter(function(x){return x.id!==id});cache();render();if(online)message('Invoice deleted from the secure online records.');
  };
  async function start(){
    var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};if(!window.supabase||!config.url||!config.publishableKey){setTimeout(start,300);return}
    db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);businessId=await resolveBusiness();if(!businessId){message('Online invoices are ready, but this account has no selected active business yet. Approve or select the business first.');return}inv=[];cache();render();renderLists();online=true;await loadAdmins();loadRemote();
  }
  document.addEventListener('click',function(event){if(online&&event.target.closest('[data-t="invoices"]'))setTimeout(loadAdmins,80)});
  document.addEventListener('bwc:branch-ready',function(){if(online){loadAdmins();loadRemote()}});
  document.addEventListener('bwc:workers-updated',function(){if(online)loadAdmins()});
  document.addEventListener('bwc:invoice-deleted',function(){if(online)loadRemote()});
  document.addEventListener('bwc:invoice-payments-updated',function(){if(online)loadRemote()});
  function safe(value){return String(value||'').replace(/[&<>'"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]})}
  function money(value){return 'PHP '+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function preview(){var panel=document.querySelector('#invoices aside.card');if(!panel)return;var header={company:'Your Business Name'},contact={address:'',phone:'',email:''},theme={accent:'#ff5219',text:'#16100d',soft:'#fff0e9'};try{header=Object.assign(header,JSON.parse(localStorage.getItem('15m-custom-header')||'{}'));contact=Object.assign(contact,JSON.parse(localStorage.getItem('15m-business-contact')||'{}'));theme=Object.assign(theme,JSON.parse(localStorage.getItem('15m-brand-theme')||'{}'))}catch(error){}var logo=localStorage.getItem('15m-custom-logo')||'',client=formValue('client')||'Client name',vehicle=[formValue('make'),formValue('yearModel'),formValue('plate')].filter(Boolean).join(' · ')||'Vehicle details',serviceRows=(window.services||[]).slice(0,3).map(function(row){return '<div class="bwc-preview-row"><span>'+safe(row.n)+(row.d?' - '+safe(row.d):'')+'</span><b>'+money(row.a)+'</b></div>'}).join('')||'<div class="bwc-preview-row"><span>Service details</span><b>PHP 0.00</b></div>',partRows=(window.parts||[]).slice(0,2).map(function(row){return '<div class="bwc-preview-row"><span>'+safe(row.n)+' × '+Number(row.q||0)+'</span><b>'+money(row.a||Number(row.q||0)*Number(row.p||0))+'</b></div>'}).join(''),total=typeof window.total==='function'?window.total():0;panel.innerHTML='<style>.bwc-print-preview{font:10px Arial;color:'+theme.text+';background:#fff;border:1px solid #dcd2cd;border-radius:8px;padding:13px}.bwc-preview-head{display:flex;gap:8px;align-items:center;border-bottom:2px solid '+theme.accent+';padding-bottom:8px}.bwc-preview-head img{max-width:34px;max-height:34px;object-fit:contain}.bwc-preview-logo{display:grid;place-items:center;width:31px;height:31px;border:1px solid '+theme.accent+';color:'+theme.accent+';font-size:8px}.bwc-preview-doc{margin-left:auto;color:'+theme.accent+';font-weight:bold;letter-spacing:.8px}.bwc-preview-row{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid #eee}.bwc-preview-section{font-weight:bold;color:'+theme.accent+';margin-top:9px}.bwc-preview-total{text-align:right;color:'+theme.accent+';font-size:13px;font-weight:bold;margin-top:9px}</style><div class="k">Invoice preview</div><h2>Printed copy preview</h2><div class="bwc-print-preview"><div class="bwc-preview-head">'+(logo?'<img src="'+safe(logo)+'" alt="Logo">':'<div class="bwc-preview-logo">logo</div>')+'<div><b>'+safe(header.company)+'</b><br><small>'+safe(contact.address)+'<br>'+safe(contact.phone)+'<br>'+safe(contact.email)+'</small></div><div class="bwc-preview-doc">INVOICE<br><small>INV-NEW</small></div></div><p><b>'+safe(client)+'</b><br>'+safe(formValue('contact'))+'<br>'+safe(formValue('address'))+'<br>'+safe(vehicle)+'</p><div class="bwc-preview-section">SERVICES</div>'+serviceRows+(partRows?'<div class="bwc-preview-section">PARTS</div>'+partRows:'')+'<div class="bwc-preview-total">TOTAL '+money(total)+'</div></div><p class="muted" style="margin-bottom:0">This is a live preview. The final printable invoice also includes the assigned admin and signature lines.</p>'}
  document.addEventListener('input',function(event){if(event.target.closest('#invoices input,#invoices select'))preview()});
  document.addEventListener('change',function(event){if(event.target.closest('#invoices input,#invoices select'))preview()});
  document.addEventListener('click',function(event){if(event.target.closest('[data-t="invoices"],#invoices [onclick*="addService"],#invoices [onclick*="addPart"],#invoices [onclick*="Remove"]'))setTimeout(preview,60)});
  /* Branding loads independently from the invoice page. Redraw the preview
     as soon as the current business and branch identity are available. */
  document.addEventListener('bwc:brand-ready',function(){
    var page=document.getElementById('invoices');
    if(page&&page.classList.contains('active'))preview();
  });
  document.addEventListener('bwc:branch-ready',function(){setTimeout(preview,180)});
  window.addEventListener('load',function(){setTimeout(preview,850)});
  setTimeout(start,500);
})();
