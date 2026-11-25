/* Read-only payment history from the invoice register. No payment writes. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BwcInvoicePaymentHistory=api.mount(root);
})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(value){return '₱'+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function same(a,b){return !!a&&!!b&&a.businessId===b.businessId&&a.branchId===b.branchId}
  function numberFromAction(source){var match=String(source||'').match(/^\s*editInvoice\(\s*(\d+)\s*\)\s*;?\s*$/);return match&&Number(match[1])>0?Number(match[1]):null}
  function model(row){
    var payments=(row.invoice_payments||[]).slice().sort(function(a,b){return String(a.payment_date||'').localeCompare(String(b.payment_date||''))||String(a.created_at||'').localeCompare(String(b.created_at||''))});
    var listed=payments.reduce(function(sum,p){return sum+Number(p.amount||0)},0),paid=Math.max(Number(row.amount_paid||0),listed);
    var raw=row.invoice_balance_writeoffs,writeoffs=Array.isArray(raw)?raw:(raw?[raw]:[]),writtenOff=writeoffs.reduce(function(sum,p){return sum+Number(p.amount||0)},0);
    return {number:'INV-'+String(row.invoice_number).padStart(5,'0'),client:row.client_name||'',vehicle:[row.vehicle_make,row.plate_number].filter(Boolean).join(' · '),total:Number(row.total_amount||0),paid:paid,balance:Math.max(0,Number(row.total_amount||0)-paid-writtenOff),writtenOff:writtenOff,legacy:Math.max(0,paid-listed),payments:payments};
  }
  function details(row){
    var m=model(row),summary='<dl class="iph-totals"><div><dt>Invoice total</dt><dd>'+money(m.total)+'</dd></div><div><dt>Total paid</dt><dd>'+money(m.paid)+'</dd></div><div><dt>Balance</dt><dd>'+money(m.balance)+'</dd></div></dl>';
    var table=m.payments.length?'<div class="iph-table-wrap"><table><thead><tr><th scope="col">Payment date</th><th scope="col">Method</th><th scope="col">Reference / note</th><th scope="col">Amount received</th></tr></thead><tbody>'+m.payments.map(function(p){return '<tr><td>'+esc(p.payment_date||'Not recorded')+'</td><td>'+esc(p.payment_method||'Not recorded')+'</td><td>'+esc([p.reference_number,p.notes].filter(Boolean).join(' · ')||'—')+'</td><td>'+money(p.amount)+'</td></tr>'}).join('')+'</tbody></table></div>':'<p>No individual payment entries recorded.</p>';
    // Do not guess a date or method for older amounts without a ledger entry.
    var legacy=m.legacy>0.009?'<p class="iph-note"><b>Earlier recorded payment: '+money(m.legacy)+'</b><br>Included in total paid. Its payment date and method were not recorded in the payment history.</p>':'';
    var writeoff=m.writtenOff>0?'<p class="iph-note">Closed as unremitted collection: <b>'+money(m.writtenOff)+'</b>. This reduces the balance but is not a client payment.</p>':'';
    return '<p class="iph-client"><b>'+esc(m.client)+'</b>'+(m.vehicle?'<br>'+esc(m.vehicle):'')+'</p>'+summary+table+legacy+writeoff;
  }
  async function read(db,scope,number){
    if(!db||!scope||!scope.businessId||!scope.branchId||!Number.isSafeInteger(number)||number<=0)throw Error('Invoice history is unavailable.');
    var result=await db.from('invoices').select('id,business_id,branch_id,invoice_number,client_name,vehicle_make,plate_number,total_amount,amount_paid,invoice_payments(payment_date,payment_method,reference_number,notes,amount,created_at),invoice_balance_writeoffs(amount)').eq('business_id',scope.businessId).eq('branch_id',scope.branchId).eq('invoice_number',number).maybeSingle();
    if(result.error)throw Error('Payment history could not load. Please retry.');
    var row=result.data;
    if(!row||row.business_id!==scope.businessId||row.branch_id!==scope.branchId||Number(row.invoice_number)!==number)throw Error('This invoice is unavailable in the current branch, or you do not have access.');
    return row;
  }
  function create(adapter){
    var state=null,version=0;
    function view(){return state&&same(state.scope,adapter.scope())?state:null}
    function close(){++version;state=null;adapter.changed(null)}
    async function open(number){
      var scope=adapter.scope();if(!scope||!scope.businessId||!scope.branchId||!Number.isSafeInteger(number)||number<=0){close();return}
      var ticket=++version;state={scope:Object.assign({},scope),number:number,phase:'loading',row:null};adapter.changed(view());
      try{
        if(adapter.offline())throw Error('Connect to the internet to view the latest payment history.');
        var row=await adapter.read(scope,number);
        if(ticket!==version)return;if(!view()){close();return}
        state.phase='ready';state.row=row;
      }catch(error){
        if(ticket!==version)return;if(!view()){close();return}
        state.phase='error';state.message=error.message||'Payment history could not load. Please retry.';
      }
      adapter.changed(view());
    }
    function refresh(){var current=view();if(current)return open(current.number);close()}
    return {open:open,close:close,view:view,refresh:refresh};
  }
  function mount(root){
    var doc=root.document,dialog,body,title,lastFocus,observer;
    var api=create({scope:function(){return {businessId:root.localStorage.getItem('bwc-active-business')||'',branchId:root.localStorage.getItem('bwc-active-branch')||''}},offline:function(){return root.navigator.onLine===false},read:function(scope,number){return read(root.getBusinessSupabaseClient&&root.getBusinessSupabaseClient()||root.businessSupabase,scope,number)},changed:render});
    function ensureDialog(){
      if(dialog)return;
      var style=doc.createElement('style');style.textContent='#invoiceHistoryDialog{box-sizing:border-box;width:min(820px,calc(100vw - 24px));max-height:85vh;overflow:auto;padding:24px;border:1px solid #e7d7d0;border-radius:14px;background:#fff;color:#211b18;box-shadow:0 20px 80px #0003}#invoiceHistoryDialog::backdrop{background:#0007}#invoiceHistoryDialog .iph-head{display:flex;justify-content:space-between;align-items:center;gap:18px}#invoiceHistoryDialog h2{font-size:21px;margin:0}#invoiceHistoryDialog button{cursor:pointer;padding:9px 14px;border:1px solid #d8c3ba;border-radius:8px;background:#fff;color:#211b18}#invoiceHistoryDialog .iph-client{line-height:1.5}#invoiceHistoryDialog .iph-totals{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:20px 0;padding:15px;background:#fff3eb;border-radius:8px}#invoiceHistoryDialog dt{font-size:13px;color:#65574f}#invoiceHistoryDialog dd{font-size:18px;font-weight:700;margin:6px 0 0}#invoiceHistoryDialog .iph-table-wrap{overflow-x:auto}#invoiceHistoryDialog table{width:100%;border-collapse:collapse;font-size:14px}#invoiceHistoryDialog th,#invoiceHistoryDialog td{text-align:left;padding:12px 10px;border-bottom:1px solid #e7d7d0;vertical-align:top}#invoiceHistoryDialog th{background:#f7f4f2}#invoiceHistoryDialog td:first-child{white-space:nowrap}#invoiceHistoryDialog th:last-child,#invoiceHistoryDialog td:last-child{text-align:right;white-space:nowrap}#invoiceHistoryDialog td:nth-child(3){overflow-wrap:anywhere;min-width:150px}#invoiceHistoryDialog .iph-note{font-size:13px;line-height:1.5;padding:12px;background:#f7f4f2}#invoiceHistoryDialog .iph-foot{color:#76675e;font-size:12px;margin:18px 0 0}@media(max-width:520px){#invoiceHistoryDialog{padding:16px}#invoiceHistoryDialog .iph-totals{gap:8px;padding:10px}#invoiceHistoryDialog dd{font-size:15px}}';doc.head.appendChild(style);
      dialog=doc.createElement('dialog');dialog.id='invoiceHistoryDialog';dialog.setAttribute('aria-labelledby','invoiceHistoryTitle');
      dialog.innerHTML='<div class="iph-head"><h2 id="invoiceHistoryTitle">Payment history</h2><button type="button" data-close-payment-history>Close</button></div><div id="invoiceHistoryBody" aria-live="polite"></div><p class="iph-foot">View only · No payment records are changed here.</p>';
      doc.body.appendChild(dialog);body=doc.getElementById('invoiceHistoryBody');title=doc.getElementById('invoiceHistoryTitle');
      dialog.querySelector('[data-close-payment-history]').addEventListener('click',api.close);
      dialog.addEventListener('cancel',function(event){event.preventDefault();api.close()});
      dialog.addEventListener('close',function(){if(!dialog.open&&api.view())api.close()});
      body.addEventListener('click',function(event){if(event.target.closest('[data-retry-payment-history]'))api.refresh()});
    }
    function render(state){
      if(!state){if(dialog&&dialog.open){dialog.close();if(lastFocus&&lastFocus.isConnected)lastFocus.focus()}return}
      ensureDialog();title.textContent='Payment history · INV-'+String(state.number).padStart(5,'0');body.setAttribute('aria-busy',String(state.phase==='loading'));
      body.innerHTML=state.phase==='ready'?details(state.row):state.phase==='loading'?'<p>Loading payment history…</p>':'<p role="alert">'+esc(state.message)+'</p><button type="button" data-retry-payment-history>Retry</button>';
      if(!dialog.open){lastFocus=doc.activeElement;dialog.showModal()}
    }
    function prepare(){
      doc.querySelectorAll('#invoiceTable button[onclick*="editInvoice"]').forEach(function(edit){
        var actions=edit.closest('.actions'),number=numberFromAction(edit.getAttribute('onclick'));
        if(!actions||!number||actions.querySelector('[data-view-payment-history]'))return;
        var button=doc.createElement('button');button.type='button';button.className='secondary';button.textContent='Payment history';button.dataset.viewPaymentHistory=String(number);button.setAttribute('aria-label','Payment history for INV-'+String(number).padStart(5,'0'));button.setAttribute('aria-haspopup','dialog');
        edit.insertAdjacentElement('afterend',button);
      });
    }
    doc.addEventListener('click',function(event){var button=event.target.closest('#invoiceTable [data-view-payment-history]');if(button){event.preventDefault();api.open(Number(button.dataset.viewPaymentHistory))}});
    ['bwc:branch-ready','bwc:business-ready','bwc:invoice-deleted'].forEach(function(name){doc.addEventListener(name,api.close)});
    ['bwc:invoice-payments-updated','bwc:invoices-loaded'].forEach(function(name){doc.addEventListener(name,function(){if(api.view())api.refresh();prepare()})});
    doc.addEventListener('change',function(event){if(event.target.matches('#onlineBranchPicker,#onlineBusinessPicker'))api.close()});
    root.addEventListener('storage',function(event){if(!event.key||event.key==='bwc-active-business'||event.key==='bwc-active-branch')api.close()});
    var client=root.getBusinessSupabaseClient&&root.getBusinessSupabaseClient()||root.businessSupabase;
    if(client&&client.auth&&client.auth.onAuthStateChange)client.auth.onAuthStateChange(function(event){if(event==='SIGNED_OUT'||event==='SIGNED_IN')api.close()});
    function start(){var table=doc.getElementById('invoiceTable');if(!table)return;prepare();observer=new root.MutationObserver(prepare);observer.observe(table,{childList:true,subtree:true})}
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
    return api;
  }
  return {model:model,details:details,numberFromAction:numberFromAction,read:read,create:create,mount:mount};
});
