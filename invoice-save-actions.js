/* Print the confirmed saved record, never the cleared or unfinished form. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BwcInvoiceSaveActions=api.mount(root)})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 function same(a,b){return !!a&&!!b&&a.userId===b.userId&&a.businessId===b.businessId&&a.branchId===b.branchId}
 function create(adapter){
  var state=null,version=0;
  function current(){return state&&same(state.scope,adapter.scope())}
  function changed(){adapter.changed&&adapter.changed()}
  function clear(){++version;state=null;changed()}
  function begin(){clear();return version}
  function queued(ticket,record){
   if(ticket!==version||!record||!same(record.scope,adapter.scope()))return;
   state={scope:Object.assign({},record.scope),requestId:record.requestId,localId:record.invoice.id,number:record.invoice.number,client:record.invoice.client,phase:'pending',snapshot:null};changed();
  }
  async function read(){
   if(!current()||!state.remoteId)return;var target=state,attempt=++version;target.phase='loading';changed();
   try{var item=await adapter.read(target.scope,target.remoteId);if(attempt!==version||state!==target||!current())return;
    if(!item||item.remoteId!==target.remoteId||String(item.id)!==String(target.invoiceNumber))throw Error('Saved invoice identity could not be verified.');
    target.snapshot=JSON.parse(JSON.stringify(item));target.number=item.number;target.client=item.client;target.phase='ready';
   }catch(e){if(attempt!==version||state!==target||!current())return;target.snapshot=null;target.phase='error'}
   changed();
  }
  function confirmed(receipt){
   if(!current()||!receipt||receipt.request_id!==state.requestId||receipt.created_by!==state.scope.userId||receipt.business_id!==state.scope.businessId||receipt.branch_id!==state.scope.branchId||!receipt.invoice_id||!receipt.invoice_number)return Promise.resolve();
   state.remoteId=receipt.invoice_id;state.invoiceNumber=receipt.invoice_number;state.number='INV-'+String(receipt.invoice_number).padStart(5,'0');return read();
  }
  function view(){
   if(!current())return null;
   var temporary=state.phase==='pending'&&adapter.offline()&&!!adapter.pending(state.localId);
   return {phase:state.phase,number:state.number,client:state.client,temporary:temporary,enabled:state.phase==='ready'||temporary};
  }
  function find(id){return current()&&state.phase==='ready'&&String(id)===String(state.remoteId)?JSON.parse(JSON.stringify(state.snapshot)):null}
  function print(){var v=view();if(!v||!v.enabled)return;return adapter.print(v.temporary?state.localId:state.remoteId)}
  return {begin:begin,queued:queued,confirmed:confirmed,clear:clear,view:view,find:find,print:print,retry:read,refresh:changed};
 }
 function mount(root){
  var config=null,controller=create({scope:function(){return config?config.scope():null},read:function(scope,id){return config.read(scope,id)},pending:function(id){return root.BwcInvoiceOffline&&root.BwcInvoiceOffline.find(id)},offline:function(){return root.navigator.onLine===false},print:function(id){return root.printInvoice(id)},changed:render});
  function render(){
   var doc=root.document,box=doc.getElementById('invoiceSaveActions'),state=controller.view();if(!state){if(box)box.remove();return}
   var save=doc.querySelector('#invoices button[onclick*="createInvoice"]');if(!save)return;
   if(!box){box=doc.createElement('div');box.id='invoiceSaveActions';box.className='notice';box.style.cssText='margin-top:12px;display:flex;flex-wrap:wrap;align-items:center;gap:12px';box.setAttribute('role','status');box.setAttribute('aria-live','polite');(save.closest('.actions')||save).insertAdjacentElement('afterend',box)}
   box.replaceChildren();var text=doc.createElement('span'),title=doc.createElement('b'),hint=doc.createElement('small');text.style.flex='1';title.textContent=state.number+(state.client?' · '+state.client:'');
   hint.style.display='block';hint.textContent=state.phase==='ready'?'Saved online. Ready to print.':state.phase==='loading'?'Saved online. Loading the printable invoice…':state.phase==='error'?'Saved online, but the printable copy could not load. Retry below; do not create it again.':state.temporary?'Saved on this device only. Online invoice number will be assigned after upload.':'Saved on this device. Waiting for online confirmation before printing.';
   text.appendChild(title);text.appendChild(hint);box.appendChild(text);
   var button=doc.createElement('button');button.type='button';button.className='primary';button.textContent=state.temporary?'Print temporary copy':'Print invoice';button.disabled=!state.enabled;button.onclick=controller.print;box.appendChild(button);
   if(state.phase==='error'){var retry=doc.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='Reload saved invoice';retry.onclick=controller.retry;box.appendChild(retry)}
  }
  root.document.addEventListener('input',function(e){if(e.target.closest('#invoices .invoice-grid > .card'))controller.clear()});
  root.document.addEventListener('change',function(e){if(e.target.closest('#invoices .invoice-grid > .card'))controller.clear()});
  root.document.addEventListener('click',function(e){if(e.target.closest('#invoices [onclick*="resetInvoice"],#invoices [onclick*="editInvoice"],#invoices [onclick*="addService"],#invoices [onclick*="addPart"]'))controller.clear()});
  ['bwc:branch-ready','bwc:business-ready'].forEach(function(name){root.document.addEventListener(name,function(){if(!controller.view())controller.clear();else render()})});
  root.document.addEventListener('bwc:invoice-deleted',controller.clear);
  root.document.addEventListener('bwc:open-invoice',controller.clear);
  root.addEventListener('storage',function(e){if(!e.key||['bwc-active-business','bwc-active-branch'].includes(e.key))controller.clear()});
  root.addEventListener('online',render);root.addEventListener('offline',render);
  return Object.assign(controller,{configure:function(value){config=value;render()}});
 }
 return {create:create,mount:mount};
});
