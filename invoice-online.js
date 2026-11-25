/* Online invoice adapter. The original page keeps its familiar interface while
   invoices are stored per business in Supabase. */
(function(){
  var db=null,businessId='',userId='',online=false,refreshChannel=null,refreshUsesBroadcast=false,refreshListenersReady=false,refreshSource='tab-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),refreshKey='bwc-invoice-refresh';
  /* Temporary diagnostic trail for fresh-browser workspace loading. Remove
     after the Jomari Incognito test has captured its console output. */
  function workspaceLog(stage,details){
    try{console.info('[BWC workspace]',stage,Object.assign({workspaceId:businessId||null,cachedWorkspaceId:localStorage.getItem('bwc-active-business')||null,branchId:localStorage.getItem('bwc-active-branch')||null,online:online},details||{}))}catch(logError){}
  }
  function localKey(){return '15m-replica-invoices'}
  function scopedCacheKey(){return 'bwc-invoice-cache:'+userId+':'+(businessId||localStorage.getItem('bwc-active-business')||'')+':'+(localStorage.getItem('bwc-active-branch')||'')}
  function cache(){try{var text=JSON.stringify(inv);localStorage.setItem(localKey(),text);if(userId&&businessId)localStorage.setItem(scopedCacheKey(),text)}catch(e){}}
  function restoreScopedCache(){try{var rows=JSON.parse(localStorage.getItem(scopedCacheKey())||'[]');inv=Array.isArray(rows)?rows:[]}catch(e){inv=[]}refreshInvoiceRegister();render()}
  /* The live dashboard reporter wraps the legacy window.render function once
     it has loaded.  That wrapper intentionally skips the legacy dashboard
     renderer, but the Invoice Register is still owned by the legacy page.
     Refresh the register directly after remote data arrives so the initial
     month selection cannot remain stuck on the pre-load empty array. */
  function refreshInvoiceRegister(){
    try{
      if(typeof window.renderRegister==='function'){window.renderRegister();return}
      if(typeof renderRegister==='function')renderRegister();
    }catch(error){console.warn('Invoice Register refresh failed:',error)}
  }
  function refreshScope(){return String(businessId||localStorage.getItem('bwc-active-business')||'')+'|'+String(localStorage.getItem('bwc-active-branch')||'')}
  function handleCrossTabRefresh(payload){
    if(!payload||payload.source===refreshSource||payload.scope!==refreshScope()||!online)return;
    loadRemote().then(function(){
      document.dispatchEvent(new Event('bwc:cash-updated'));
      if(payload.type==='invoice-saved')document.dispatchEvent(new CustomEvent('bwc:invoice-saved',{detail:Object.assign({},payload.detail||{},{remote:true,sourceTab:payload.source})}));
    });
  }
  function setupCrossTabRefresh(){
    if(refreshListenersReady)return;refreshListenersReady=true;
    if('BroadcastChannel' in window){try{refreshChannel=new BroadcastChannel('bwc-invoice-refresh');refreshChannel.addEventListener('message',function(event){handleCrossTabRefresh(event.data)});refreshUsesBroadcast=true}catch(error){refreshChannel=null}}
    /* Storage events cover browsers without BroadcastChannel.  They fire only
       in other tabs, so the source tab cannot refresh itself twice. */
    window.addEventListener('storage',function(event){if(!refreshUsesBroadcast&&event.key===refreshKey&&event.newValue){try{handleCrossTabRefresh(JSON.parse(event.newValue))}catch(error){}}});
  }
  function publishCrossTabRefresh(type,detail){
    var payload={type:type,detail:detail||{},scope:refreshScope(),source:refreshSource,at:Date.now()};
    if(refreshChannel){try{refreshChannel.postMessage(payload);return}catch(error){refreshChannel=null;refreshUsesBroadcast=false}}
    try{localStorage.setItem(refreshKey,JSON.stringify(payload))}catch(error){}
  }
  window.bwcPublishInvoiceRefresh=function(type,detail){if(online)publishCrossTabRefresh(type,detail)};
  var invoiceSaving=false,remoteLoadVersion=0;
  function invoiceScope(){return {businessId:businessId||localStorage.getItem('bwc-active-business')||'',branchId:localStorage.getItem('bwc-active-branch')||'',userId:userId,branchName:(document.querySelector('#onlineBranchPicker option:checked')||{}).textContent||''}}
  function configureOffline(){
    if(window.BwcInvoiceSaveActions)window.BwcInvoiceSaveActions.configure({scope:function(){var scope=invoiceScope();return scope.businessId===(localStorage.getItem('bwc-active-business')||'')?scope:null},read:function(scope,id){return readInvoiceForOpen(db,scope.businessId,scope.branchId,id)}});
    if(window.BwcInvoiceOffline)window.BwcInvoiceOffline.configure({db:function(){return db},scope:invoiceScope,refresh:loadRemote,saved:function(receipt){if(window.BwcInvoiceSaveActions)window.BwcInvoiceSaveActions.confirmed(receipt);document.dispatchEvent(new Event('bwc:cash-updated'));document.dispatchEvent(new Event('bwc:pms-updated'));var detail={remoteId:receipt.invoice_id,invoiceNumber:receipt.invoice_number,edited:false};document.dispatchEvent(new CustomEvent('bwc:invoice-saved',{detail:detail}));publishCrossTabRefresh('invoice-saved',detail)}});
  }
  function message(text){var box=document.getElementById('invoiceOnlineStatus');if(!box){box=document.createElement('div');box.id='invoiceOnlineStatus';box.className='notice';var view=document.getElementById('invoices');if(view)view.insertBefore(box,view.firstChild)}if(box)box.textContent=text}
  function normalize(row){var services=(row.invoice_services||[]).map(function(s){return {n:s.service_name,d:s.service_detail||'',a:Number(s.amount||0)}}),parts=(row.invoice_parts||[]).map(function(p){var q=Number(p.quantity||0),price=Number(p.unit_price||0);return {n:p.part_name,q:q,p:price,a:q*price}}),payments=(row.invoice_payments||[]).map(function(p){return {date:p.payment_date,amount:Number(p.amount||0),method:p.payment_method||'',reference:p.reference_number||'',notes:p.notes||'',createdAt:p.created_at||''}}),rawWriteoffs=row.invoice_balance_writeoffs,writeoffs=Array.isArray(rawWriteoffs)?rawWriteoffs:(rawWriteoffs?[rawWriteoffs]:[]),writtenOff=writeoffs.reduce(function(sum,item){return sum+Number(item.amount||0)},0);return {id:row.invoice_number,remoteId:row.id,number:'INV-'+String(row.invoice_number).padStart(5,'0'),client:row.client_name,contact:row.contact_number,address:row.client_address,email:row.client_email||'',make:row.vehicle_make,yearModel:row.vehicle_year_model,color:row.vehicle_color,plate:row.plate_number,date:row.invoice_date,release:row.release_date||'',admin:row.assigned_admin,method:row.payment_method,source:row.client_source,services:services,parts:parts,payments:payments,total:Number(row.total_amount||0),paid:Number(row.amount_paid||0),writtenOff:writtenOff,balance:Math.max(0,Number(row.total_amount||0)-Number(row.amount_paid||0)-writtenOff),status:row.status}}
  async function resolveBusiness(){
    workspaceLog('resolveBusiness:start');
    var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;
    if(session.error){workspaceLog('resolveBusiness:session-error',{supabaseError:session.error});return null}
    if(!user){workspaceLog('resolveBusiness:no-authenticated-user');return null}userId=user.id;
    workspaceLog('resolveBusiness:authenticated-user',{userId:user.id,email:user.email||null});
    var memberships=await db.rpc('my_active_business_workspaces');
    workspaceLog('resolveBusiness:membership-result',{membershipCount:(memberships.data||[]).length,memberships:(memberships.data||[]).map(function(row){return {businessId:row.business_id,businessStatus:row.business_status,role:row.member_role}}),supabaseError:memberships.error||null});
    if(memberships.error)return null;
    var saved=localStorage.getItem('bwc-active-business'),activeRows=memberships.data||[],active=activeRows.find(function(row){return row.business_id===saved})||activeRows[0];if(active){localStorage.setItem('bwc-active-business',active.business_id);localStorage.setItem('bwc-active-business-name',active.business_name);workspaceLog('resolveBusiness:active-workspace',{workspaceId:active.business_id,workspaceName:active.business_name});return active.business_id}
    var own=await db.from('businesses').select('id,name').eq('created_by',user.id).order('created_at',{ascending:true}).limit(2);
    workspaceLog('resolveBusiness:owner-workspace-result',{workspaceCount:(own.data||[]).length,supabaseError:own.error||null});
    if(own.data&&own.data.length===1){localStorage.setItem('bwc-active-business',own.data[0].id);localStorage.setItem('bwc-active-business-name',own.data[0].name);workspaceLog('resolveBusiness:owner-workspace',{workspaceId:own.data[0].id});return own.data[0].id}
    workspaceLog('resolveBusiness:no-active-workspace');
    return null;
  }
  async function loadRemote(){
    if(!db||!businessId||navigator.onLine===false)return;
    var version=++remoteLoadVersion,requestedScope=refreshScope();
    var query=db.from('invoices').select('*,invoice_services(*),invoice_parts(*),invoice_payments(*),invoice_balance_writeoffs(*)').eq('business_id',businessId),branchId=localStorage.getItem('bwc-active-branch');if(branchId)query=query.eq('branch_id',branchId);
    var result=await query.order('invoice_date',{ascending:false}).order('invoice_number',{ascending:false});
    if(version!==remoteLoadVersion||requestedScope!==refreshScope())return;
    if(result.error){message('Online invoices could not load: '+result.error.message);return}
    inv=(result.data||[]).map(function(row){var item=normalize(row);item.discount=Number(row.discount_amount||0);return item});cache();refreshInvoiceRegister();render();renderLists();if(edit)paymentEditShortcut();document.dispatchEvent(new Event('bwc:invoices-loaded'));message('Online invoice records are active for '+(localStorage.getItem('bwc-active-business-name')||'this business')+'.');
  }
  function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,function(character){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]})}
  function isAdmin(worker){return /\badmin(istrator)?\b/i.test(String(worker.position||''))}
  var adminLoadVersion=0,adminMemory={};
  function adminCacheKey(s){return s.userId&&s.businessId&&s.branchId?'bwc-invoice-admins:'+s.userId+':'+s.businessId+':'+s.branchId:''}
  function adminRows(rows){
    var seen=Object.create(null);
    return (Array.isArray(rows)?rows:[]).filter(function(worker){return worker&&worker.is_active!==false&&isAdmin(worker)}).map(function(worker){return {full_name:String(worker.full_name||'').trim(),position:'Admin',is_active:true}}).filter(function(worker){var key=worker.full_name.toLowerCase();if(!key||seen[key])return false;seen[key]=true;return true});
  }
  function cachedAdmins(s){
    var key=adminCacheKey(s);if(!key)return [];
    if(adminMemory[key])return adminMemory[key];
    try{return adminRows(JSON.parse(localStorage.getItem(key)||'[]'))}catch(error){return []}
  }
  function rememberAdmins(s,rows){
    var key=adminCacheKey(s);if(!key)return;
    adminMemory[key]=adminRows(rows);
    try{localStorage.setItem(key,JSON.stringify(adminMemory[key]))}catch(error){/* Keep the current tab usable if browser storage is full. */}
  }
  function renderAdmins(rows){
    var field=document.getElementById('admin');if(!field)return;
    var key=adminCacheKey(invoiceScope()),selected=field.dataset.adminScope===key?field.value:'',admins=adminRows(rows);
    field.dataset.onlineAdmins='1';
    field.dataset.adminScope=key;field.title='';
    field.innerHTML=admins.length?'<option value="">Select admin</option>'+admins.map(function(worker){return '<option value="'+escapeHtml(worker.full_name)+'">'+escapeHtml(worker.full_name)+'</option>'}).join(''):'<option value="">No Admin employee in this branch</option>';
    if(admins.some(function(worker){return worker.full_name===selected}))field.value=selected;
  }
  function renderOfflineAdmins(){
    var field=document.getElementById('admin');if(!field)return;
    var rows=cachedAdmins(invoiceScope());renderAdmins(rows);
    field.title=rows.length?'Admin names last loaded online for this account and branch.':'Connect online once to load this branch’s admin names on this device.';
    if(!rows.length)field.innerHTML='<option value="">Connect online to load admin names</option>';
  }
  async function loadAdmins(){
    var requested=invoiceScope(),key=adminCacheKey(requested),version=++adminLoadVersion,branchId=requested.branchId;
    if(navigator.onLine===false||!db||!businessId){renderOfflineAdmins();return}if(!key){renderAdmins([]);return}
    try{
    var result;
    if(requested.businessId==='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875')result=await db.rpc('payroll_v2_employee_options',{b:requested.businessId,r:branchId});
    if(!result||result.error)result=await db.from('payroll_workers').select('full_name,position,is_active').eq('business_id',requested.businessId).eq('branch_id',branchId).eq('is_active',true).order('full_name');
    if(result.error)throw result.error;
    /* Team Access administrators are valid invoice assignees even when they
       are not paid through the Payroll employee roster. Read the approved
       assignment itself so a newly accepted account is not missed while its
       separate profile/membership record finishes synchronizing. */
    var teamAdmins=[],teamLoaded=false;
    try{
      var invitations=await db.from('business_team_invites').select('full_name').eq('business_id',requested.businessId).eq('branch_id',branchId).eq('role','admin').in('status',['approved','accepted']);
      if(!invitations.error){teamLoaded=true;teamAdmins=(invitations.data||[]).filter(function(invite){return invite.full_name&&invite.full_name.trim()}).map(function(invite){return {full_name:invite.full_name.trim(),position:'Admin',is_active:true}})}
    }catch(teamError){console.warn('Team admin names were not available:',teamError)}
    if(version!==adminLoadVersion||key!==adminCacheKey(invoiceScope()))return;
    if(!teamLoaded&&cachedAdmins(requested).length){renderOfflineAdmins();return}
    var admins=adminRows((result.data||[]).concat(teamAdmins));
    // A first-time device can still retain successfully loaded employee names
    // if the optional Team Access lookup is temporarily unavailable.
    if(teamLoaded||admins.length)rememberAdmins(requested,admins);
    renderAdmins(admins);
    if(!admins.length){var branchName=(document.querySelector('#onlineBranchPicker option:checked')||{}).textContent||'this branch';message('No active employee with the designation Admin is saved online for '+branchName+'. Open Payroll > Manage employees, set the employee designation to Admin, and save the employee.');}
    }catch(error){if(version===adminLoadVersion&&key===adminCacheKey(invoiceScope()))renderOfflineAdmins()}
  }
  function paidFromHistory(item){return Math.max(Number(item&&item.paid||0),(item&&item.payments||[]).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0))}
  function invoicePayload(x){var openingPayment=!!(x.isNewInvoice&&Number(x.paid||0)>0);return {business_id:businessId,branch_id:localStorage.getItem('bwc-active-branch'),client_name:x.client,contact_number:x.contact,client_address:x.address,client_email:x.email||null,vehicle_make:x.make,vehicle_year_model:x.yearModel,vehicle_color:x.color,plate_number:x.plate,invoice_date:x.date,release_date:x.release||null,assigned_admin:x.admin,payment_method:x.method,client_source:x.source,discount_amount:x.discount||0,total_amount:x.total,amount_paid:openingPayment?0:x.paid,status:openingPayment?'Pending':x.status,created_by:userId}}
  async function confirmInvoiceBranchAccess(){
    workspaceLog('saveInvoice:workspace-check-start',{saveInvoiceWorkspaceId:businessId||null,userId:userId||null});
    try{var refreshed=await db.rpc('refresh_my_team_access');workspaceLog('saveInvoice:team-access-refresh',{refreshResult:refreshed.data||null,supabaseError:refreshed.error||null})}catch(refreshError){workspaceLog('saveInvoice:team-access-refresh-error',{supabaseError:refreshError})}
    /* The saved business can be stale immediately after a hard refresh. Resolve
       it again at save time, then use the database permission function as the
       authority. This avoids rejecting a valid Team Access member locally. */
    var currentBusinessId=await resolveBusiness();
    if(!currentBusinessId){workspaceLog('saveInvoice:no-workspace',{saveInvoiceWorkspaceId:businessId||null});return {error:'Your business workspace is still loading. Please wait a moment and try again.'};}
    businessId=currentBusinessId;
    workspaceLog('saveInvoice:workspace-ready',{saveInvoiceWorkspaceId:businessId});
    var branchId=localStorage.getItem('bwc-active-branch');if(!branchId)return {error:'Your assigned branch is still loading. Please wait a moment and try again.'};
    var permitted=await db.rpc('can_manage_invoice_branch',{target_business_id:businessId,target_branch_id:branchId});
    if(!permitted.error&&permitted.data===true)return {ok:true};
    /* Owners have access to every active branch. Staff and admins must use an
       explicitly assigned branch, so correct an old browser branch before a
       save can reach the invoice security rule. */
    var membership=await db.from('business_memberships').select('role,status').eq('business_id',businessId).eq('user_id',userId).eq('status','active').maybeSingle();
    if(membership.error||!membership.data)return {error:'This signed-in account does not have an active Team Access membership for this business.'};
    if(['admin','staff'].includes(membership.data.role)){
      var access=await db.from('business_member_branch_access').select('branch_id').eq('business_id',businessId).eq('user_id',userId);
      if(access.error||!(access.data||[]).length)return {error:'This signed-in account has no active branch assignment yet. The owner should open Team Access and save the assigned branch, then ask the staff member to sign in again.'};
      var allowed=(access.data||[]).map(function(row){return row.branch_id});
      if(!allowed.includes(branchId)){localStorage.setItem('bwc-active-branch',allowed[0]);return {corrected:true};}
    }
    if(permitted.error)return {error:'Invoice access could not be verified online. Please refresh once and try again. Reason: '+permitted.error.message};
    return {error:'This account is not allowed to create invoices for the currently selected branch. The branch was not changed.'};
  }
  /* A payment must be added to the original invoice as a dated installment.
     Do not let an editor overwrite the accumulated received amount by hand. */
  function paymentEditShortcut(){
    var old=document.getElementById('invoicePaymentEditShortcut');if(old)old.remove();
    var paidField=document.getElementById('paid'),summary=document.querySelector('#invoices .summary');
    if(!paidField)return;
    var item=edit&&inv.find(function(row){return row.id===edit});
    if(!online||!item||!item.remoteId){paidField.readOnly=false;paidField.removeAttribute('aria-readonly');return}
    paidField.readOnly=true;paidField.setAttribute('aria-readonly','true');
    var balance=Math.max(0,Number(item.total||0)-Number(item.paid||0)),box=document.createElement('div');
    box.id='invoicePaymentEditShortcut';box.className='notice';box.style.marginTop='12px';
     box.innerHTML='<b>Payment update for '+escapeHtml(item.number)+'</b><br>This invoice has '+escapeHtml('PHP '+Number(item.paid||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}))+' received and '+escapeHtml('PHP '+balance.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}))+' remaining. Add the next payment as a dated record so the balance, CIB cash, dashboard, and payment history stay correct.<br><button type="button" class="primary" style="margin-top:9px" data-record-invoice-payment="'+escapeHtml(item.remoteId)+'">Record another payment</button> <button type="button" class="secondary" style="margin-top:9px" data-correct-invoice-payment="'+escapeHtml(item.remoteId)+'">Correct amount paid</button>';
    if(summary)summary.insertAdjacentElement('afterend',box);
  }
  function invoiceEditPayload(x){
    var payload=invoicePayload(x);
    /* The edit RPC ignores client totals, payment totals, status, and creator;
       it derives those values from the locked invoice and submitted lines. */
    delete payload.total_amount;delete payload.amount_paid;delete payload.status;delete payload.created_by;
    payload.pms=x.pms;
    return payload;
  }
  async function syncOfflineQueue(){
    if(window.BwcInvoiceOffline)return window.BwcInvoiceOffline.sync();
  }
  window.createInvoice=async function(){
    if(invoiceSaving)return;invoiceSaving=true;
    var printTicket=window.BwcInvoiceSaveActions&&window.BwcInvoiceSaveActions.begin();
    try{
    var req=['client','contact','address','make','yearModel','color','plate','invoiceDate','admin','source'];if(req.some(function(x){return !formValue(x)})){alert('Please complete every required field.');return}
    if(!services.length&&!parts.length){alert('Add at least one service or auto part.');return}
    function cents(value){return Math.round((Number(value)+Number.EPSILON)*100)/100}
    var rawSubtotal=services.reduce(function(sum,row){return sum+cents(row.a)},0)+parts.reduce(function(sum,row){return sum+cents(Number(row.q)*Number(row.p))},0),discount=Math.max(0,cents((document.getElementById('discountAmount')||{}).value||0));if(discount>rawSubtotal){alert('Discount cannot be higher than the services and parts total.');return}
    var existing=edit&&inv.find(function(i){return i.id===edit}),x={id:edit||Date.now(),remoteId:existing&&existing.remoteId,isNewInvoice:!edit,number:'',client:formValue('client'),contact:formValue('contact'),address:formValue('address'),email:formValue('email'),make:formValue('make'),yearModel:formValue('yearModel'),color:formValue('color'),plate:formValue('plate'),date:invoiceDate.value,release:releaseDate.value,paymentDate:formValue('paymentDate'),admin:admin.value,method:method.value,source:source.value,services:services.slice(),parts:parts.slice(),discount:discount,total:total(),paid:+paid.value||0};
    /* An older invoice opened from a report may fall outside the register's
       next refresh. Never turn that interrupted edit into a new invoice. */
    if(edit&&(!existing||(online&&!existing.remoteId&&!existing.offlinePending))){alert('This saved invoice is no longer loaded. Reopen it from the report or register before saving changes.');return}
    if(edit&&(!online||navigator.onLine===false||existing.offlinePending)){alert('Existing and pending invoices cannot be edited offline. Reconnect and open the saved online invoice.');return}
    x.total=Math.round((rawSubtotal-discount)*100)/100;
    if(!Number.isFinite(x.total)||!Number.isFinite(x.paid)||x.paid<0||x.services.some(function(s){return !s.n||!Number.isFinite(Number(s.a))||Number(s.a)<0})||x.parts.some(function(p){return !p.n||!Number.isFinite(Number(p.q))||!Number.isFinite(Number(p.p))||Number(p.q)<=0||Number(p.p)<0})){alert('Enter valid nonnegative prices and payment amounts, and positive part quantities.');return}
    if(x.total<=0){alert('Enter at least one service or auto part amount greater than ₱0 before creating the invoice.');return}
    if(x.paid>x.total){alert('Amount paid cannot be higher than the invoice total.');return}
    if(x.isNewInvoice&&x.paid>0&&!x.paymentDate){alert('Enter the actual payment received date before saving an initial payment.');return}
    /* Editing invoice details must never silently change the amount collected.
       New money is recorded only through the installment history. */
    if(existing){x.paid=paidFromHistory(existing);x.status=existing.writtenOff>0?existing.status:(x.paid>=x.total?'Paid':x.paid?'Partially paid':'Pending')}
    x.balance=Math.max(0,x.total-x.paid);x.status=x.paid>=x.total?'Paid':x.paid?'Partially paid':x.status||'Pending';
    x.pms={};
    if(x.services.some(function(row){return /\bpms\b/i.test(row.n||'')})){
      if(!window.BwcPmsForm){alert('PMS details are not ready. Reload BWC while online; your form has not been cleared.');return}
      try{x.pms=window.BwcPmsForm.collect(x)}catch(error){alert(error.message);return}
    }
    if(x.isNewInvoice){
      if(!window.BwcInvoiceOffline){alert('Safe invoice saving is not ready. Reload BWC while online; your form has not been cleared.');return}
      try{var queued=await window.BwcInvoiceOffline.saveNew(x);resetInvoice();setInvoiceFormMode(false);show('invoices');message(queued.invoice.number+' saved on this device. See the upload status above; its permanent invoice number is assigned after upload.');if(window.BwcInvoiceSaveActions)window.BwcInvoiceSaveActions.queued(printTicket,queued);syncOfflineQueue()}catch(error){message(error.message);alert(error.message)}return;
    }
    if(!businessId||!localStorage.getItem('bwc-active-branch')){alert('The selected branch is still loading. Please wait a few seconds, then create the invoice again.');return}
    var branchAccess=await confirmInvoiceBranchAccess();if(branchAccess.corrected){alert('Your saved branch was corrected to your assigned branch. The page will now refresh; create the invoice again after it reloads.');location.reload();return}if(branchAccess.error){alert(branchAccess.error);return}
message('Saving invoice securely…');var savedInvoiceNumber=null;try{
      var saveStep='the invoice record';
      var saved;
      if(x.remoteId){
        saveStep='the invoice and line items transaction';
        var updated=await db.rpc('update_invoice_with_lines',{p_invoice_id:x.remoteId,p_branch_id:localStorage.getItem('bwc-active-branch'),p_payload:invoiceEditPayload(x),p_services:x.services.map(function(s){return {service_name:s.n,service_detail:s.d||null,amount:Number(s.a||0)}}),p_parts:x.parts.map(function(p){return {part_name:p.n,quantity:Number(p.q||0),unit_price:Number(p.p||0)}})});
        if(updated.error)throw new Error(updated.error.message);
        var result=updated.data||{};saved={id:x.remoteId,invoice_number:result.invoice_number};
      }else{throw new Error('Reopen the existing online invoice before saving changes.')}
      savedInvoiceNumber=saved.invoice_number;
      /* PMS and line items are now saved in the same database transaction. */
      saveStep='refreshing the saved invoice screen';await loadRemote();
      /* loadRemote refreshes the invoice register and emits
         bwc:invoices-loaded.  These follow-up signals fan the completed save
         out to cash/reporting cards and client/PDF views.  They are refresh-
         only events; editing an invoice never rewrites payment or CIB history. */
      document.dispatchEvent(new Event('bwc:cash-updated'));
      document.dispatchEvent(new CustomEvent('bwc:invoice-saved',{detail:{remoteId:saved.id,invoiceNumber:saved.invoice_number,edited:!x.isNewInvoice}}));
      publishCrossTabRefresh('invoice-saved',{remoteId:saved.id,invoiceNumber:saved.invoice_number,edited:!x.isNewInvoice});
      resetInvoice();setInvoiceFormMode(false);show('invoices');message('Invoice '+('INV-'+String(saved.invoice_number).padStart(5,'0'))+' saved securely online.');
    }catch(error){var detail=String((error&&error.message)||'Unknown database error');if(savedInvoiceNumber!==null){console.error('Invoice was saved but the page could not finish updating:',error);message('Invoice INV-'+String(savedInvoiceNumber).padStart(5,'0')+' was saved, but the page could not finish refreshing.');alert('Invoice INV-'+String(savedInvoiceNumber).padStart(5,'0')+' was saved. Please reload the page before creating another invoice. Reason: '+detail);return}message('Invoice was not saved during '+saveStep+': '+detail);alert('The invoice could not be saved during '+saveStep+'. Reason: '+detail)}
    }finally{invoiceSaving=false}
  };
  window.deleteInvoice=async function(id){
    var item=inv.find(function(x){return x.id===id});
    if(!item)return;
    if(!online||navigator.onLine===false||!item.remoteId){alert('Connect online before deleting a saved invoice. Pending or older local records are kept for review.');return}
    if(!confirm('Delete '+String(item.number||'this invoice')+'? This also removes its services, parts, payment history, cash collection, linked CIB cash records, and any linked repair order in the current branch. Invoices with remitted cash cannot be deleted.'))return;
    if(online&&item.remoteId){
      var branchId=localStorage.getItem('bwc-active-branch');
      if(!businessId||!branchId){alert('The current branch is still loading. Please try again in a moment.');return}
      message('Deleting invoice securely…');
      try{
        /* One database transaction removes the invoice, its linked repair
           order, and both legacy and installment CIB records. It refuses to
           delete an invoice whose cash was already remitted. */
        var removed=await db.rpc('delete_invoice_with_linked_cash',{p_invoice_id:item.remoteId,p_branch_id:branchId});
        if(removed.error)throw new Error(removed.error.message);
        document.dispatchEvent(new Event('bwc:cash-updated'));
        document.dispatchEvent(new Event('bwc:invoice-deleted'));
        await loadRemote();
        publishCrossTabRefresh('invoice-deleted',{remoteId:item.remoteId,invoiceNumber:item.number});
        message(String(item.number||'Invoice')+' was deleted from this branch only.');
        alert('Invoice deleted successfully from the current branch.');
      }catch(error){
        message('Invoice was not deleted: '+error.message);
        alert('Invoice was not deleted. '+error.message);
      }
      return;
    }
    inv=inv.filter(function(x){return x.id!==id});cache();render();
  };
  /* The original page owns editInvoice/resetInvoice.  Wrap them rather than
     changing the familiar editor so the payment workflow appears only when an
     existing online invoice is being edited. */
  function setInvoiceFormMode(editing){
    var form=document.querySelector('#invoices .invoice-grid > .card');
    if(!form)return;
    var mode=form.querySelector('.k'),title=form.querySelector('h2'),save=form.querySelector('button[onclick*="createInvoice"]');
    if(mode)mode.textContent=editing?'Edit invoice':'New invoice';
    if(title)title.textContent=editing?'Update client, vehicle & service details':'Client, vehicle & service details';
    if(save){save.textContent=editing?'Save changes':'Create invoice';save.setAttribute('aria-label',editing?'Save invoice changes':'Create a new invoice');}
  }
  window.setInvoiceFormMode=setInvoiceFormMode;
  var originalEditInvoice=window.editInvoice,originalResetInvoice=window.resetInvoice;
  if(originalEditInvoice)window.editInvoice=function(id){if(!online||navigator.onLine===false){alert('Connect online before editing an existing invoice.');return}originalEditInvoice(id);setInvoiceFormMode(true);setTimeout(function(){var amount=document.getElementById('paid'),amountLabel=amount&&amount.closest('label');if(amount){amount.disabled=true;amount.title='Use Payment records to add or correct money received.'}if(amountLabel){amountLabel.firstChild.nodeValue='Amount received to date (managed in Payment records)'}paymentEditShortcut()},0)};
  if(originalResetInvoice)window.resetInvoice=function(){originalResetInvoice();setInvoiceFormMode(false);setTimeout(function(){var paymentDate=document.getElementById('paymentDate'),amount=document.getElementById('paid'),amountLabel=amount&&amount.closest('label');if(paymentDate)paymentDate.value='';if(amount){amount.disabled=false;amount.title=''}if(amountLabel)amountLabel.firstChild.nodeValue='Initial payment received (PHP)';paymentEditShortcut()},0)};
  /* The legacy page keeps editInvoice/resetInvoice as global lexical
     functions, so they are not always available on window for wrapping.
     Catch their existing buttons as a fallback and update the mode after
     the inline handler has populated or cleared the form. */
  document.addEventListener('click',function(event){
    if(event.target.closest('#invoices [onclick*="editInvoice"]')){if(!online||navigator.onLine===false){event.preventDefault();event.stopImmediatePropagation();alert('Connect online before editing an existing invoice.');return}setInvoiceFormMode(true)}
    if(event.target.closest('#invoices [onclick*="resetInvoice"]'))setInvoiceFormMode(false);
  },true);
  async function start(){
    var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};if(!window.supabase||!config.url||!config.publishableKey){setTimeout(start,300);return}
    db=window.getBusinessSupabaseClient&&window.getBusinessSupabaseClient();if(!db){setTimeout(start,300);return}
    configureOffline();
    try{businessId=await resolveBusiness()}catch(error){businessId=''}
    if(!businessId){online=false;restoreScopedCache();message('Online access could not be checked. Offline entry requires a previously verified account and branch. Existing invoices cannot be edited.');if(window.BwcInvoiceOffline)window.BwcInvoiceOffline.render();renderOfflineAdmins();return}
    restoreScopedCache();
    online=true;setupCrossTabRefresh();await loadAdmins();await loadRemote();if(window.BwcInvoiceOffline)await window.BwcInvoiceOffline.verify();syncOfflineQueue();
  }
  document.addEventListener('click',function(event){if(event.target.closest('[data-t="invoices"]'))setTimeout(loadAdmins,80)});
  document.addEventListener('bwc:branch-ready',function(){restoreScopedCache();loadAdmins();if(online)loadRemote();if(window.BwcInvoiceOffline){window.BwcInvoiceOffline.verify();window.BwcInvoiceOffline.render()}});
  var openInvoiceVersion=0;
  async function readInvoiceForOpen(client,business,branch,remoteId){
    if(!business||!branch||!remoteId)throw new Error('Select a business and branch before opening an invoice.');
    var result=await client.from('invoices').select('*,invoice_services(*),invoice_parts(*),invoice_payments(*),invoice_balance_writeoffs(*)').eq('id',remoteId).eq('business_id',business).eq('branch_id',branch).maybeSingle();
    if(result.error)throw result.error;
    if(!result.data)throw new Error('This invoice is no longer available in the selected branch. Refresh the report.');
    if(result.data.id!==remoteId||result.data.business_id!==business||result.data.branch_id!==branch)throw new Error('Invoice scope could not be verified.');
    var item=normalize(result.data);item.discount=Number(result.data.discount_amount||0);return item;
  }
  document.addEventListener('bwc:open-invoice',async function(event){
    var remoteId=event.detail&&event.detail.remoteId;
    if(!remoteId)return;
    var version=++openInvoiceVersion,requestedBusiness=localStorage.getItem('bwc-active-business'),requestedBranch=localStorage.getItem('bwc-active-branch');
    try{
      if(!online)throw new Error('Go online before opening this saved invoice.');
      // Fetch the requested ID directly, including older invoices outside the
      // legacy register's first response page. Opening never saves the record.
      var item=await readInvoiceForOpen(db,requestedBusiness,requestedBranch,remoteId);
      if(version!==openInvoiceVersion||requestedBusiness!==localStorage.getItem('bwc-active-business')||requestedBranch!==localStorage.getItem('bwc-active-branch'))return;
      var index=inv.findIndex(function(row){return row.remoteId===remoteId});if(index<0)inv.push(item);else inv[index]=item;
      if(typeof window.editInvoice!=='function')throw new Error('The invoice editor is not ready. Reload the page.');
      window.editInvoice(item.id);setInvoiceFormMode(true);window.scrollTo({top:0,behavior:'smooth'});
    }catch(error){if(version!==openInvoiceVersion||requestedBusiness!==localStorage.getItem('bwc-active-business')||requestedBranch!==localStorage.getItem('bwc-active-branch'))return;message('Invoice could not open: '+(error.message||'Please try again.'));alert(error.message||'Invoice could not open. Please try again.');}
  });
  document.addEventListener('bwc:workers-updated',function(){if(online)loadAdmins()});
  document.addEventListener('bwc:workers-loaded',function(){if(online)loadAdmins()});
  document.addEventListener('bwc:invoice-deleted',function(){if(online)loadRemote()});
  document.addEventListener('bwc:invoice-payments-updated',function(){if(online)loadRemote()});
  window.addEventListener('offline',function(){++adminLoadVersion;renderOfflineAdmins();message('Offline: new invoices only. Check the protected upload queue; existing invoices cannot be edited.')});
  window.addEventListener('online',function(){if(online){loadAdmins();syncOfflineQueue()}else start()});
  function safe(value){return String(value||'').replace(/[&<>'"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]})}
  function money(value){return 'PHP '+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function preview(){var panel=document.querySelector('#invoices aside.card');if(!panel)return;var header={company:'Your Business Name'},contact={address:'',phone:'',email:''},theme={accent:'#ff5219',text:'#16100d',soft:'#fff0e9'};try{header=Object.assign(header,JSON.parse(localStorage.getItem('15m-custom-header')||'{}'));contact=Object.assign(contact,JSON.parse(localStorage.getItem('15m-business-contact')||'{}'));theme=Object.assign(theme,JSON.parse(localStorage.getItem('15m-brand-theme')||'{}'))}catch(error){}var logo=localStorage.getItem('15m-custom-logo')||'',client=formValue('client')||'Client name',vehicle=[formValue('make'),formValue('yearModel'),formValue('plate')].filter(Boolean).join(' · ')||'Vehicle details',serviceRows=(window.services||[]).slice(0,3).map(function(row){return '<div class="bwc-preview-row"><span>'+safe(row.n)+(row.d?' - '+safe(row.d):'')+'</span><b>'+money(row.a)+'</b></div>'}).join('')||'<div class="bwc-preview-row"><span>Service details</span><b>PHP 0.00</b></div>',partRows=(window.parts||[]).slice(0,2).map(function(row){return '<div class="bwc-preview-row"><span>'+safe(row.n)+' × '+Number(row.q||0)+'</span><b>'+money(row.a||Number(row.q||0)*Number(row.p||0))+'</b></div>'}).join(''),total=typeof window.total==='function'?window.total():0,discount=Math.max(0,Number((document.getElementById('discountAmount')||{}).value)||0),subtotal=total+discount,discountRows=discount>0?'<div class="bwc-preview-row"><span>Subtotal</span><b>'+money(subtotal)+'</b></div><div class="bwc-preview-row bwc-preview-discount"><span>Discount</span><b>- '+money(discount)+'</b></div>':'';panel.innerHTML='<style>.bwc-print-preview{font:10px Arial;color:'+theme.text+';background:#fff;border:1px solid #dcd2cd;border-radius:8px;padding:13px}.bwc-preview-head{display:flex;gap:8px;align-items:center;border-bottom:2px solid '+theme.accent+';padding-bottom:8px}.bwc-preview-head img{max-width:34px;max-height:34px;object-fit:contain}.bwc-preview-logo{display:grid;place-items:center;width:31px;height:31px;border:1px solid '+theme.accent+';color:'+theme.accent+';font-size:8px}.bwc-preview-doc{margin-left:auto;color:'+theme.accent+';font-weight:bold;letter-spacing:.8px}.bwc-preview-row{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid #eee}.bwc-preview-discount{color:#9a3819}.bwc-preview-section{font-weight:bold;color:'+theme.accent+';margin-top:9px}.bwc-preview-total{text-align:right;color:'+theme.accent+';font-size:13px;font-weight:bold;margin-top:9px}</style><div class="k">Invoice preview</div><h2>Printed copy preview</h2><div class="bwc-print-preview"><div class="bwc-preview-head">'+(logo?'<img src="'+safe(logo)+'" alt="Logo">':'<div class="bwc-preview-logo">logo</div>')+'<div><b>'+safe(header.company)+'</b><br><small>'+safe(contact.address)+'<br>'+safe(contact.phone)+'<br>'+safe(contact.email)+'</small></div><div class="bwc-preview-doc">INVOICE<br><small>INV-NEW</small></div></div><p><b>'+safe(client)+'</b><br>'+safe(formValue('contact'))+'<br>'+safe(formValue('address'))+'<br>'+safe(vehicle)+'</p><div class="bwc-preview-section">SERVICES</div>'+serviceRows+(partRows?'<div class="bwc-preview-section">PARTS</div>'+partRows:'')+discountRows+'<div class="bwc-preview-total">TOTAL '+money(total)+'</div></div><p class="muted" style="margin-bottom:0">This is a live preview. The final printable invoice also includes the assigned admin and signature lines.</p>'}
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
