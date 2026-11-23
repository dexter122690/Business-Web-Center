/* Offline invoices are new, immutable requests. Edits/payments/deletes require
   the server. No pending record is ever assigned to today's selected branch. */
(function(){
 'use strict';
 var outbox=BwcInvoiceOutbox.create(localStorage),adapter=null,running=false,errors={},storageError='',appCached=false;
 var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
 function scope(){return adapter?adapter.scope():{}}
 function timeout(promise){return new Promise(function(resolve,reject){var timer=setTimeout(function(){reject(Error('Connection timed out. The local copy is kept; retrying will not duplicate it.'))},15000);Promise.resolve(promise).then(function(v){clearTimeout(timer);resolve(v)},function(e){clearTimeout(timer);reject(e)})})}
 function grantKey(s){return 'bwc-invoice-offline-ready:'+s.userId+':'+s.businessId+':'+s.branchId}
 function hasGrant(s){try{var verified=Number(localStorage.getItem(grantKey(s)));return !!verified&&Date.now()-verified<86400000}catch(e){return false}}
 async function identity(){
  var s=scope();if(!adapter||!adapter.db()||!s.userId||!s.businessId||!s.branchId)throw Error('Open BWC and sign in online to this branch before using offline invoices.');
  var session=await timeout(adapter.db().auth.getSession()),user=session.data&&session.data.session&&session.data.session.user;
  if(session.error||!user||user.id!==s.userId)throw Error('Sign in to the original account before saving or syncing invoices.');
  return s;
 }
 async function verify(){
  try{var s=await identity();if(navigator.onLine===false)return;var result=await timeout(adapter.db().rpc('can_manage_invoice_branch',{target_business_id:s.businessId,target_branch_id:s.branchId}));if(!result.error){if(result.data===true)localStorage.setItem(grantKey(s),String(Date.now()));else localStorage.removeItem(grantKey(s))}}catch(e){}finally{render()}
 }
 function pending(){var s=scope();return outbox.owned(s)}
 function find(id){var s=scope(),r=pending().find(function(r){return r.scope.branchId===s.branchId&&String(r.invoice.id)===String(id)});return r?r.invoice:null}
 async function saveNew(invoice){
  var s=await identity();
  if(navigator.onLine!==false){var permitted;try{permitted=await timeout(adapter.db().rpc('can_manage_invoice_branch',{target_business_id:s.businessId,target_branch_id:s.branchId}))}catch(e){}
   if(permitted&&!permitted.error){if(permitted.data!==true){localStorage.removeItem(grantKey(s));throw Error('This account cannot create invoices in this branch.')}localStorage.setItem(grantKey(s),String(Date.now()))}
  }
  if(!hasGrant(s))throw Error('Offline entry is not ready for this account and branch. Connect online to verify invoice-edit access first (verification lasts 24 hours).');
  var current=scope();if(current.userId!==s.userId||current.businessId!==s.businessId||current.branchId!==s.branchId)throw Error('Your account or branch changed while saving. Review the form before trying again.');
  var record=BwcInvoiceOutbox.request(s,invoice,window.crypto);
  try{outbox.put(record);storageError=''}catch(e){storageError='NOT SAVED: browser storage is unavailable or full. Keep this form open and copy its details. '+e.message;render();throw Error(storageError)}
  if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(function(){});
  render();return record;
 }
 async function sync(){
  if(running||!adapter||navigator.onLine===false){render();return}running=true;render();var changed=false;
  try{
   var actor=await identity(),records=outbox.owned(actor);storageError='';
   for(var i=0;i<records.length;i++){
    var record=records[i],current=await identity();
    if(current.userId!==record.scope.userId||current.businessId!==record.scope.businessId)break;
    try{
     var result=await timeout(adapter.db().rpc('create_invoice_from_outbox',BwcInvoiceOutbox.args(record)));
     if(result.error)throw Error(result.error.message);
     outbox.acknowledge(record,result.data);delete errors[record.requestId];changed=true;
     adapter.saved(result.data);
    }catch(e){errors[record.requestId]=e.message||'Upload could not finish. Local copy kept.'}
   }
  }catch(e){storageError=e.message||'Upload unavailable. Local copies kept.'}finally{running=false;if(changed){try{await adapter.refresh()}catch(e){storageError='Uploaded successfully, but the invoice list could not refresh. Reconnect and refresh the list; do not enter the invoice again.'}}render()}
 }
 function backup(){var s=scope(),blob=new Blob([outbox.backup(s)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='BWC-pending-invoices-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(url)},1000)}
 function render(){
  var view=document.getElementById('invoices');if(!view)return;
  var box=document.getElementById('invoiceOfflinePanel');if(!box){box=document.createElement('section');box.id='invoiceOfflinePanel';box.className='notice';box.setAttribute('aria-label','Offline invoice safety');view.insertBefore(box,view.firstChild)}
  var s=scope(),rows=[],damaged=0,legacy=0;try{rows=pending();damaged=outbox.list().damaged;legacy=outbox.legacyCount()}catch(e){storageError='Browser storage cannot be read. Do not clear browser data. '+e.message}
  var visible=rows.filter(function(r){return r.scope.branchId===s.branchId});
  box.innerHTML='<b>'+(running?'Uploading saved invoices…':rows.length?rows.length+' invoice(s) waiting to upload':navigator.onLine===false?'Offline · new invoices only':'Offline invoice protection')+'</b><p style="margin:6px 0">'+(hasGrant(s)?'New invoices can be saved on this device for '+esc(s.branchName||'this branch')+'.':'Connect online to verify this account and branch before offline entry.')+' Existing invoices, payments and deletions require internet. Pending invoices keep their original branch.</p>'+(rows.length?'<p><b>Do not clear browser data or use private/incognito mode.</b> Until uploaded, these copies exist only on this device. Download a recovery backup before closing or changing devices.</p>':'')+(storageError?'<p role="alert">'+esc(storageError)+'</p>':'')+(legacy||damaged?'<p role="alert"><b>Owner review needed:</b> '+(legacy+damaged)+' older or unreadable offline record(s) have been preserved but will not upload automatically. Their original branch/account cannot be safely assumed. Do not clear browser data.</p>':'')+'<div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" data-outbox-sync '+(running||navigator.onLine===false?'disabled':'')+'>Retry upload</button><button type="button" data-outbox-backup '+(!rows.length?'disabled':'')+'>Download recovery backup</button><label>Restore backup <input data-outbox-restore type="file" accept="application/json,.json"></label></div>'+visible.map(function(r){return '<div style="margin-top:12px;padding-top:10px;border-top:1px solid #decfc6"><b>'+esc(r.invoice.number)+' · '+esc(r.invoice.client)+'</b><br>'+esc(r.scope.branchName||r.scope.branchId)+' · '+esc(r.invoice.plate)+' · ₱'+Number(r.invoice.total).toLocaleString('en-PH',{minimumFractionDigits:2})+'<br><small>Saved on this device; not yet confirmed online.</small>'+(errors[r.requestId]?'<p role="status">'+esc(errors[r.requestId])+'</p>':'')+' <button type="button" data-outbox-print="'+r.invoice.id+'">Print temporary copy</button> <button type="button" data-outbox-pdf="'+r.invoice.id+'">Save temporary PDF</button></div>'}).join('')+(rows.length>visible.length?'<p>'+String(rows.length-visible.length)+' waiting invoice(s) belong to another branch and will upload to that original branch.</p>':'');
  var readiness=document.createElement('p');readiness.textContent=appCached?'App files are cached for offline reopening. A valid signed-in session is still required.':'Offline reopening is not confirmed yet. Keep this tab open until the app files are cached.';box.appendChild(readiness);
  box.querySelector('[data-outbox-sync]').onclick=sync;box.querySelector('[data-outbox-backup]').onclick=backup;
  box.querySelector('[data-outbox-restore]').onchange=async function(event){try{await identity();var file=event.target.files[0];if(!file)return;if(file.size>10000000)throw Error('This backup is too large.');var count=outbox.restore(await file.text(),scope());storageError='';render();alert(count+' pending invoice(s) restored. Retrying keeps the original upload references.');sync()}catch(e){alert(e.message)}};
  box.querySelectorAll('[data-outbox-print],[data-outbox-pdf]').forEach(function(button){button.onclick=function(){var id=button.dataset.outboxPrint||button.dataset.outboxPdf;if(find(id)){if(button.dataset.outboxPdf)window.downloadInvoicePdf(id);else window.printInvoice(id)}}});
 }
 window.BwcInvoiceOffline={configure:function(value){adapter=value;render()},saveNew:saveNew,sync:sync,verify:verify,render:render,find:find,branchFor:function(id){var r=pending().find(function(r){return String(r.invoice.id)===String(id)});return r&&r.scope.branchName||''},hasPending:function(){try{return outbox.list().rows.length>0||outbox.legacyCount()>0||outbox.list().damaged>0}catch(e){return true}}};
 if(navigator.serviceWorker){function checkCache(){navigator.serviceWorker.ready.then(function(reg){if(reg.active)reg.active.postMessage({type:'BWC_OFFLINE_STATUS'})}).catch(function(){})}navigator.serviceWorker.addEventListener('message',function(event){if(event.data&&event.data.type==='BWC_OFFLINE_STATUS'&&event.data.version>=26){appCached=event.data.ready===true;render()}});navigator.serviceWorker.addEventListener('controllerchange',checkCache);checkCache()}
 window.addEventListener('beforeunload',function(event){if(window.BwcInvoiceOffline.hasPending()){event.preventDefault();event.returnValue='Pending invoices are saved only on this device. Download a recovery backup; do not clear browser data.'}});
 window.addEventListener('storage',function(event){if(!event.key||event.key.indexOf(BwcInvoiceOutbox.PREFIX)===0)render()});
 window.addEventListener('online',function(){verify();sync()});window.addEventListener('offline',render);window.addEventListener('focus',sync);
 setInterval(function(){if(pending().length)sync()},30000);
 document.addEventListener('click',function(event){if(event.target.closest('.logout,#logoutButton')&&window.BwcInvoiceOffline.hasPending()&&!confirm('Invoices are still waiting on this device. Download a recovery backup first. Sign out anyway?')){event.preventDefault();event.stopImmediatePropagation()}},true);
})();
