/* Invoice installments. One invoice stays open until its balance reaches zero. */
(function(){
  var db=null,businessId='',userId='',selectedId='',records=[],showPaid=false,isOwner=false,writeoffMode=false;
  function money(value){return 'PHP '+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function safe(value){return String(value==null?'':value).replace(/[&<>'"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]})}
  function status(text){var box=document.getElementById('invoicePaymentOnlineStatus');if(!box){box=document.createElement('div');box.id='invoicePaymentOnlineStatus';box.className='notice';var host=document.getElementById('invoicePaymentsPanel');if(host)host.prepend(box)}if(box)box.textContent=text}
  async function identity(){
    var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;if(!user)return false;userId=user.id;
    var saved=localStorage.getItem('bwc-active-business');
    var rows=await db.from('business_memberships').select('business_id,role,businesses!inner(id,status)').eq('user_id',user.id).eq('status','active');
    var active=(rows.data||[]).filter(function(row){return row.businesses&&row.businesses.status==='active'}).find(function(row){return row.business_id===saved})||(rows.data||[]).filter(function(row){return row.businesses&&row.businesses.status==='active'})[0];
    if(active){businessId=active.business_id;isOwner=active.role==='owner';return true}
    var own=await db.from('businesses').select('id').eq('created_by',user.id).limit(1);if(own.data&&own.data[0]){businessId=own.data[0].id;isOwner=true;return true}return false;
  }
  function currentBranch(){return localStorage.getItem('bwc-active-branch')||''}
  function selected(){return records.find(function(row){return row.id===selectedId})||records[0]||null}
  function panel(){return document.getElementById('invoicePaymentsPanel')}
  function ensurePanel(){
    var root=document.getElementById('invoices');if(!root)return null;
    var old=panel();if(old)return old;
    var box=document.createElement('section');box.id='invoicePaymentsPanel';box.className='card';box.style.marginTop='18px';root.appendChild(box);return box;
  }
  function paymentTotals(row){var payments=row.invoice_payments||[],paid=payments.reduce(function(sum,p){return sum+Number(p.amount||0)},0),rawWriteoffs=row.invoice_balance_writeoffs,writeoffs=Array.isArray(rawWriteoffs)?rawWriteoffs:(rawWriteoffs?[rawWriteoffs]:[]),writtenOff=writeoffs.reduce(function(sum,item){return sum+Number(item.amount||0)},0);if(!payments.length)paid=Number(row.amount_paid||0);return {payments:payments,writeoffs:writeoffs,paid:paid,writtenOff:writtenOff,balance:Math.max(0,Number(row.total_amount||0)-paid-writtenOff)}}
  function render(){
    var host=ensurePanel();if(!host)return;
    var item=selected(),paidRecords=records.filter(function(row){return paymentTotals(row).balance<=0.001}),visibleRecords=showPaid?records:records.filter(function(row){return paymentTotals(row).balance>0.001}), list=visibleRecords.map(function(row){var totals=paymentTotals(row),actions=totals.balance>0.001?'<button class="secondary" data-invoice-payment="'+row.id+'">Record payment</button> '+(isOwner?'<button class="secondary" data-invoice-unremitted="'+row.id+'">Close as unremitted</button> ':''):'';return '<tr><td><b>INV-'+String(row.invoice_number).padStart(5,'0')+'</b></td><td>'+safe(row.client_name)+'</td><td>'+money(row.total_amount)+'</td><td>'+money(totals.paid)+'</td><td>'+money(totals.balance)+'</td><td>'+actions+'<button class="secondary" data-invoice-history="'+row.id+'">History</button></td></tr>'}).join('')||'<tr><td colspan="6" class="muted">'+(showPaid?'No invoices are recorded in this branch yet.':'No invoices have an unpaid balance in this branch.')+'</td></tr>';
    var history='';
    if(item){var totals=paymentTotals(item),payments=totals.payments,writeoffs=totals.writeoffs,paid=totals.paid,balance=totals.balance;if(!payments.length&&Number(item.amount_paid||0)>0)history='<p class="muted">This invoice has an existing received amount of '+money(item.amount_paid)+'. The first new installment will preserve it as an opening payment record.</p>';else history=payments.length?'<table><thead><tr><th>Date</th><th>Method</th><th>Reference / note</th><th>Received by</th><th>Amount</th></tr></thead><tbody>'+payments.map(function(p){return '<tr><td>'+safe(p.payment_date)+'</td><td>'+safe(p.payment_method)+'</td><td>'+safe(p.reference_number||p.notes||'—')+'</td><td>'+safe(p.received_by||'—')+'</td><td><b>'+money(p.amount)+'</b></td></tr>'}).join('')+'</tbody></table>':'<p class="muted">No payment has been recorded for this invoice yet.</p>';
      if(writeoffs.length)history+='<div class="notice" style="margin-top:12px"><b>Closed as unremitted collection: '+money(totals.writtenOff)+'</b><br>Owner-approved on '+safe(writeoffs[0].writeoff_date)+'; no payment, sales, or CIB cash was created.<br><small>'+safe(writeoffs[0].notes||'')+'</small></div>';
      history='<div class="notice" style="margin-top:14px"><b>Selected: INV-'+String(item.invoice_number).padStart(5,'0')+'</b> · '+safe(item.client_name)+' · Balance '+money(balance)+'</div>'+history;
    }
    var detail='';if(item&&balance>0.001&&writeoffMode&&isOwner)detail='<div class="card" style="margin-top:14px;padding:16px"><h3>Close as unremitted collection — INV-'+String(item.invoice_number).padStart(5,'0')+'</h3><div class="notice" style="margin:0 0 12px"><b>Balance to close: '+money(balance)+'</b><br>This does not record a client payment, sales, CIB cash-in, or remittance. It creates one owner-approved loss record under “Staff Cash Shortage / Unremitted Collection.”</div><div class="grid2"><label>Closure date<input id="unremittedDate" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label><label>Owner note <input id="unremittedNotes" required placeholder="Explain the unremitted collection"></label></div><button id="saveUnremittedCollection">Confirm closure</button> <button class="secondary" id="cancelUnremittedCollection">Cancel</button>'+history+'</div>';else if(item&&balance>0.001)detail='<div class="card" style="margin-top:14px;padding:16px"><h3>Record payment — INV-'+String(item.invoice_number).padStart(5,'0')+'</h3><div class="notice" style="margin:0 0 12px"><b>Invoice total: '+money(item.total_amount)+'</b> &nbsp; Paid so far: '+money(paid)+' &nbsp; Balance remaining: '+money(balance)+'</div><div class="grid3"><label>Payment date<input id="paymentDate" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label><label>Payment received today (PHP)<input id="paymentAmount" type="number" min="0.01" step="0.01" max="'+balance+'" placeholder="Enter today\'s payment"></label><label>Payment method<select id="paymentMethod"><option>Cash</option><option>GCash</option><option>Bank transfer</option><option>Credit card</option><option>Check</option><option>Other</option></select></label></div><div class="grid2"><label>Reference number (optional)<input id="paymentReference" placeholder="Receipt, transfer, or check no."></label><label>Notes (optional)<input id="paymentNotes" placeholder="Payment note"></label></div><button id="useRemainingInvoicePayment" class="secondary">Use full remaining balance</button> <button id="saveInvoicePayment">Save payment</button> <button class="secondary" id="closeInvoicePayment">Close</button>'+history+'</div>';else if(item)detail='<div class="card" style="margin-top:14px;padding:16px"><h3>Payment history — INV-'+String(item.invoice_number).padStart(5,'0')+'</h3><p class="notice">This invoice is fully paid or closed. Its payment history is retained, but no further payment can be recorded.</p><button class="secondary" id="closeInvoicePayment">Close</button>'+history+'</div>';
    host.innerHTML='<div class="k">Payment records</div><h2>Invoice installment history</h2><p class="muted">Use the same invoice every time a client pays. Fully paid invoices are kept in history and hidden from this list by default.</p><div id="invoicePaymentOnlineStatus" class="notice">Payments are saved separately and do not create a new invoice.</div><button id="togglePaidInvoicePayments" class="secondary" style="margin:0 0 12px">'+(showPaid?'Hide fully paid invoices':'Show fully paid invoices ('+paidRecords.length+')')+'</button><div style="overflow:auto"><table><thead><tr><th>Invoice</th><th>Client</th><th>Total</th><th>Received</th><th>Balance</th><th>Action</th></tr></thead><tbody>'+list+'</tbody></table></div>'+detail;
    var paymentMethodField=document.getElementById('paymentMethod');
    if(paymentMethodField){var prompt=document.createElement('option');prompt.value='';prompt.textContent='Select payment method';prompt.disabled=true;prompt.selected=true;paymentMethodField.prepend(prompt)}
  }
  async function load(){
    if(!businessId||!currentBranch())return;
    var result=await db.from('invoices').select('id,invoice_number,client_name,total_amount,amount_paid,status,invoice_date,payment_method,invoice_payments(*),invoice_balance_writeoffs(*)').eq('business_id',businessId).eq('branch_id',currentBranch()).order('invoice_date',{ascending:false}).order('invoice_number',{ascending:false});
    if(result.error){var host=ensurePanel();if(host)host.innerHTML='<div class="notice">Payment history is not ready yet. Run the latest database update, then refresh this page.</div>';return}
    records=result.data||[];if(selectedId&&!records.some(function(row){return row.id===selectedId}))selectedId='';render();
  }
  async function seedLegacy(row){
    var payments=row.invoice_payments||[];if(payments.length||Number(row.amount_paid||0)<=0)return payments;
    var seed={invoice_id:row.id,business_id:businessId,branch_id:currentBranch(),payment_date:row.invoice_date||new Date().toISOString().slice(0,10),amount:Number(row.amount_paid),payment_method:row.payment_method||'Cash',reference_number:'Opening recorded payment',notes:'Payment amount recorded before installment history was enabled.',received_by:null,created_by:userId};
    var added=await db.from('invoice_payments').insert(seed).select().single();if(added.error)throw new Error(added.error.message);return [added.data];
  }
  async function syncCash(row,payments){
    var branchId=currentBranch();
    /* The database sync is atomic and may remove only cash rows generated by
       this invoice.  It works for permitted branch staff without granting
       them general cash-record deletion rights. */
    var synced=await db.rpc('sync_invoice_payment_cash',{p_invoice_id:row.id,p_branch_id:branchId});if(synced.error)throw new Error(synced.error.message);
    document.dispatchEvent(new Event('bwc:cash-updated'));
  }
  async function save(){
    var row=selected(),amount=Number((document.getElementById('paymentAmount')||{}).value||0),date=(document.getElementById('paymentDate')||{}).value,method=(document.getElementById('paymentMethod')||{}).value,reference=(document.getElementById('paymentReference')||{}).value.trim(),notes=(document.getElementById('paymentNotes')||{}).value.trim();
    if(!row||!amount||amount<=0){alert('Enter a payment amount greater than zero.');return}
    if(!method){alert('Choose how the client paid before saving this payment.');return}
    var payments=await seedLegacy(row),paid=payments.reduce(function(sum,p){return sum+Number(p.amount||0)},0),balance=Math.max(0,Number(row.total_amount||0)-paid);if(amount>balance+0.001){alert('This payment is more than the remaining balance of '+money(balance)+'.');return}
    var added=await db.from('invoice_payments').insert({invoice_id:row.id,business_id:businessId,branch_id:currentBranch(),payment_date:date,amount:amount,payment_method:method,reference_number:reference||null,notes:notes||null,received_by:null,created_by:userId}).select().single();if(added.error)throw new Error(added.error.message);
    payments=payments.concat([added.data]);paid=payments.reduce(function(sum,p){return sum+Number(p.amount||0)},0);var state=paid>=Number(row.total_amount||0)?'Paid':paid>0?'Partially paid':'Pending';
    var updated=await db.from('invoices').update({amount_paid:paid,status:state,payment_method:method}).eq('id',row.id);if(updated.error)throw new Error(updated.error.message);
    await syncCash(row,payments);selectedId=row.id;document.dispatchEvent(new Event('bwc:invoice-payments-updated'));await load();alert('Payment saved. Remaining balance: '+money(Math.max(0,Number(row.total_amount||0)-paid))+'.');
  }
  async function closeAsUnremittedCollection(){
    var row=selected(),date=(document.getElementById('unremittedDate')||{}).value,notes=((document.getElementById('unremittedNotes')||{}).value||'').trim();
    if(!row||!isOwner){alert('Only the business owner can use this closure.');return}
    if(!notes){alert('Enter the owner note explaining this unremitted collection.');return}
    var totals=paymentTotals(row);if(totals.balance<=0.001){alert('This invoice has no remaining balance to close.');return}
    if(!confirm('Close '+money(totals.balance)+' on INV-'+String(row.invoice_number).padStart(5,'0')+' as an unremitted collection? This cannot be recorded as a payment, sale, CIB cash-in, or remittance.'))return;
    var result=await db.rpc('close_invoice_as_unremitted_collection',{p_invoice_id:row.id,p_branch_id:currentBranch(),p_writeoff_date:date||null,p_notes:notes});
    if(result.error)throw new Error(result.error.message);
    writeoffMode=false;selectedId=row.id;document.dispatchEvent(new Event('bwc:invoice-payments-updated'));document.dispatchEvent(new Event('bwc:expenses-loaded'));document.dispatchEvent(new Event('bwc:invoices-loaded'));await load();alert('Invoice closed as an unremitted collection. No payment, sales, CIB cash, or remittance was added.');
  }
  document.addEventListener('click',function(event){
    var pay=event.target.closest('[data-invoice-payment]'),history=event.target.closest('[data-invoice-history]'),unremitted=event.target.closest('[data-invoice-unremitted]'),shortcut=event.target.closest('[data-record-invoice-payment]');
    if(pay){selectedId=pay.dataset.invoicePayment;writeoffMode=false;render();var amount=document.getElementById('paymentAmount');if(amount)amount.focus()}
    if(history){selectedId=history.dataset.invoiceHistory;writeoffMode=false;render()}
    if(unremitted){selectedId=unremitted.dataset.invoiceUnremitted;writeoffMode=true;render();var note=document.getElementById('unremittedNotes');if(note)note.focus()}
    if(shortcut){
      selectedId=shortcut.dataset.recordInvoicePayment;writeoffMode=false;render();
      var paymentPanel=panel();if(paymentPanel)paymentPanel.scrollIntoView({behavior:'smooth',block:'start'});
      setTimeout(function(){var amount=document.getElementById('paymentAmount');if(amount)amount.focus()},350);
    }
    if(event.target.id==='closeInvoicePayment'){selectedId='';writeoffMode=false;render()}
    if(event.target.id==='cancelUnremittedCollection'){writeoffMode=false;render()}
    if(event.target.id==='togglePaidInvoicePayments'){showPaid=!showPaid;selectedId='';writeoffMode=false;render()}
    if(event.target.id==='useRemainingInvoicePayment'){var amount=document.getElementById('paymentAmount');if(amount)amount.value=Number(amount.max||0).toFixed(2)}
    if(event.target.id==='saveInvoicePayment'){save().catch(function(error){alert('Payment could not be saved: '+error.message)})}
    if(event.target.id==='saveUnremittedCollection'){closeAsUnremittedCollection().catch(function(error){alert('The invoice could not be closed: '+error.message)})}
  });
  document.addEventListener('bwc:invoices-loaded',function(){setTimeout(load,40)});
  document.addEventListener('bwc:branch-ready',function(){selectedId='';setTimeout(load,120)});
  function start(){var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};if(!window.supabase||!config.url||!config.publishableKey){setTimeout(start,300);return}db=window.getBusinessSupabaseClient&&window.getBusinessSupabaseClient();if(!db){setTimeout(start,300);return}identity().then(function(ok){if(ok)load()});}
  setTimeout(start,700);
})();
