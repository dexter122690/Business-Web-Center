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
    var saved=localStorage.getItem('bwc-active-business');if(saved)return saved;
    var memberships=await db.from('business_memberships').select('business_id,businesses!inner(id,name,status)').eq('user_id',user.id).eq('status','active');
    var active=(memberships.data||[]).find(function(row){return row.businesses&&row.businesses.status==='active'});if(active){localStorage.setItem('bwc-active-business',active.business_id);localStorage.setItem('bwc-active-business-name',active.businesses.name);return active.business_id}
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
  function invoicePayload(x){return {business_id:businessId,branch_id:localStorage.getItem('bwc-active-branch'),client_name:x.client,contact_number:x.contact,client_address:x.address,client_email:x.email||null,vehicle_make:x.make,vehicle_year_model:x.yearModel,vehicle_color:x.color,plate_number:x.plate,invoice_date:x.date,release_date:x.release||null,assigned_admin:x.admin,payment_method:x.method,client_source:x.source,total_amount:x.total,amount_paid:x.paid,status:x.status,created_by:userId}}
  async function writeLines(remoteId,x){
    var servicesRows=x.services.map(function(s){return {invoice_id:remoteId,service_name:s.n,service_detail:s.d||null,amount:Number(s.a||0)}}),partsRows=x.parts.map(function(p){return {invoice_id:remoteId,part_name:p.n,quantity:Number(p.q||0),unit_price:Number(p.p||0)}});
    if(servicesRows.length){var s=await db.from('invoice_services').insert(servicesRows);if(s.error)throw new Error(s.error.message)}
    if(partsRows.length){var p=await db.from('invoice_parts').insert(partsRows);if(p.error)throw new Error(p.error.message)}
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
      await writeLines(saved.id,x);await loadRemote();resetInvoice();show('invoices');message('Invoice '+('INV-'+String(saved.invoice_number).padStart(5,'0'))+' saved securely online.');
    }catch(error){message('Invoice was not saved online: '+error.message);alert('The invoice could not be saved online. Please try again.')}};
  window.deleteInvoice=async function(id){
    var item=inv.find(function(x){return x.id===id});if(!item||!confirm('Delete this invoice?'))return;
    if(online&&item.remoteId){var result=await db.from('invoices').delete().eq('id',item.remoteId);if(result.error){message('Invoice was not deleted: '+result.error.message);return}}
    inv=inv.filter(function(x){return x.id!==id});cache();render();if(online)message('Invoice deleted from the secure online records.');
  };
  async function start(){
    var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};if(!window.supabase||!config.url||!config.publishableKey){setTimeout(start,300);return}
    db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);businessId=await resolveBusiness();if(!businessId){message('Online invoices are ready, but this account has no selected active business yet. Approve or select the business first.');return}online=true;loadRemote();
  }
  setTimeout(start,500);
})();
