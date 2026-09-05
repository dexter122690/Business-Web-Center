/* Invoice installments. One invoice stays open until its balance reaches zero. */
(function(){
  var db=null,businessId='',userId='',selectedId='',records=[];
  function money(value){return 'PHP '+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function safe(value){return String(value==null?'':value).replace(/[&<>'"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]})}
  function status(text){var box=document.getElementById('invoicePaymentOnlineStatus');if(!box){box=document.createElement('div');box.id='invoicePaymentOnlineStatus';box.className='notice';var host=document.getElementById('invoicePaymentsPanel');if(host)host.prepend(box)}if(box)box.textContent=text}
  async function identity(){
    /* Use the same authenticated workspace context as Invoice Making. This
       prevents a fresh browser from querying payments before its branch is known. */
    if(!window.BWCContext)return false;
    var context=await window.BWCContext.whenReady();
    if(!context||context.platformAdmin||!context.business||!context.branch)return false;
    userId=context.user.id;businessId=context.business.id;return true;
  }
  function currentBranch(){var context=window.BWCContext&&window.BWCContext.get();return context&&context.branch?context.branch.id:''}
  function selected(){return records.find(function(row){return row.id===selectedId})||records[0]||null}
  function panel(){return document.getElementById('invoicePaymentsPanel')}
  function ensurePanel(){
    var root=document.getElementById('invoices');if(!root)return null;
    var old=panel();if(old)return old;
    var box=document.createElement('section');box.id='invoicePaymentsPanel';box.className='card';box.style.marginTop='18px';root.appendChild(box);return box;
  }
  function render(){
    var host=ensurePanel();if(!host)return;
    var item=selected(), list=records.map(function(row){var paid=(row.invoice_payments||[]).reduce(function(sum,p){return sum+Number(p.amount||0)},0);if(!row.invoice_payments||!row.invoice_payments.length)paid=Number(row.amount_paid||0);var balance=Math.max(0,Number(row.total_amount||0)-paid);return '<tr><td><b>INV-'+String(row.invoice_number).padStart(5,'0')+'</b></td><td>'+safe(row.client_name)+'</td><td>'+money(row.total_amount)+'</td><td>'+money(paid)+'</td><td>'+money(balance)+'</td><td><button class="secondary" data-invoice-payment="'+row.id+'">Record payment</button> <button class="secondary" data-invoice-history="'+row.id+'">History</button></td></tr>'}).join('')||'<tr><td colspan="6" class="muted">No invoices are recorded in this branch yet.</td></tr>';
    var history='';
    if(item){var payments=item.invoice_payments||[],paid=payments.reduce(function(sum,p){return sum+Number(p.amount||0)},0);if(!payments.length&&Number(item.amount_paid||0)>0)history='<p class="muted">This invoice has an existing received amount of '+money(item.amount_paid)+'. The first new installment will preserve it as an opening payment record.</p>';else history=payments.length?'<table><thead><tr><th>Date</th><th>Method</th><th>Reference / note</th><th>Received by</th><th>Amount</th></tr></thead><tbody>'+payments.map(function(p){return '<tr><td>'+safe(p.payment_date)+'</td><td>'+safe(p.payment_method)+'</td><td>'+safe(p.reference_number||p.notes||'—')+'</td><td>'+safe(p.received_by||'—')+'</td><td><b>'+money(p.amount)+'</b></td></tr>'}).join('')+'</tbody></table>':'<p class="muted">No payment has been recorded for this invoice yet.</p>';
      var balance=Math.max(0,Number(item.total_amount||0)-(payments.length?paid:Number(item.amount_paid||0)));
      history='<div class="notice" style="margin-top:14px"><b>Selected: INV-'+String(item.invoice_number).padStart(5,'0')+'</b> · '+safe(item.client_name)+' · Balance '+money(balance)+'</div>'+history;
    }
    host.innerHTML='<div class="k">Payment records</div><h2>Invoice installment history</h2><p class="muted">Use the same invoice every time a client pays. Each payment keeps its own date, method, reference, and remaining balance.</p><div id="invoicePaymentOnlineStatus" class="notice">Payments are saved separately and do not create a new invoice.</div><div style="overflow:auto"><table><thead><tr><th>Invoice</th><th>Client</th><th>Total</th><th>Received</th><th>Balance</th><th>Action</th></tr></thead><tbody>'+list+'</tbody></table></div>'+(item?'<div class="card" style="margin-top:14px;padding:16px"><h3>Record payment — INV-'+String(item.invoice_number).padStart(5,'0')+'</h3><div class="notice" style="margin:0 0 12px"><b>Invoice total: '+money(item.total_amount)+'</b> &nbsp; Paid so far: '+money(paid)+' &nbsp; Balance remaining: '+money(balance)+'</div><div class="grid3"><label>Payment date<input id="paymentDate" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label><label>Payment received today (PHP)<input id="paymentAmount" type="number" min="0.01" step="0.01" max="'+balance+'" placeholder="Enter today\'s payment"></label><label>Payment method<select id="paymentMethod"><option>Cash</option><option>GCash</option><option>Bank transfer</option><option>Credit card</option><option>Check</option><option>Other</option></select></label></div><div class="grid2"><label>Reference number (optional)<input id="paymentReference" placeholder="Receipt, transfer, or check no."></label><label>Notes (optional)<input id="paymentNotes" placeholder="Payment note"></label></div><button id="useRemainingInvoicePayment" class="secondary">Use full remaining balance</button> <button id="saveInvoicePayment">Save payment</button> <button class="secondary" id="closeInvoicePayment">Close</button>'+history+'</div>':'');
    var paymentMethodField=document.getElementById('paymentMethod');
    if(paymentMethodField){var prompt=document.createElement('option');prompt.value='';prompt.textContent='Select payment method';prompt.disabled=true;prompt.selected=true;paymentMethodField.prepend(prompt)}
  }
  async function load(){
    if(!businessId||!currentBranch())return;
    /* Load payment rows separately. Some browsers keep an old PostgREST
       relationship cache after a new table is installed, while direct table
       reads are reliable immediately. */
    var result=await db.from('invoices').select('id,invoice_number,client_name,total_amount,amount_paid,status,invoice_date,payment_method').eq('business_id',businessId).eq('branch_id',currentBranch()).order('invoice_date',{ascending:false}).order('invoice_number',{ascending:false});
    if(result.error){var host=ensurePanel();if(host)host.innerHTML='<div class="notice">Invoice records could not be loaded. Please refresh once and try again.</div>';return}
    records=result.data||[];
    var ids=records.map(function(row){return row.id}),paymentRows=[];
    if(ids.length){var payments=await db.from('invoice_payments').select('*').eq('business_id',businessId).eq('branch_id',currentBranch()).in('invoice_id',ids).order('payment_date',{ascending:false}).order('created_at',{ascending:false});if(payments.error){var panel=ensurePanel();if(panel)panel.innerHTML='<div class="notice">Payment history could not be loaded for this account. Please sign out and sign in again.</div>';return}paymentRows=payments.data||[]}
    var byInvoice={};paymentRows.forEach(function(payment){(byInvoice[payment.invoice_id]||(byInvoice[payment.invoice_id]=[])).push(payment)});records.forEach(function(row){row.invoice_payments=byInvoice[row.id]||[]});
    if(selectedId&&!records.some(function(row){return row.id===selectedId}))selectedId='';render();
  }
  async function seedLegacy(row){
    var payments=row.invoice_payments||[];if(payments.length||Number(row.amount_paid||0)<=0)return payments;
    var seed={invoice_id:row.id,business_id:businessId,branch_id:currentBranch(),payment_date:row.invoice_date||new Date().toISOString().slice(0,10),amount:Number(row.amount_paid),payment_method:row.payment_method||'Cash',reference_number:'Opening recorded payment',notes:'Payment amount recorded before installment history was enabled.',received_by:null,created_by:userId};
    var added=await db.from('invoice_payments').insert(seed).select().single();if(added.error)throw new Error(added.error.message);return [added.data];
  }
  async function syncCash(row,payments){
    var branchId=currentBranch(),legacySource='invoice-cash:'+row.id,paymentPrefix='invoice-payment-cash:'+row.id+':';
    /* One CIB transaction per actual cash payment keeps installment dates and amounts visible. */
    var removedLegacy=await db.from('cash_transactions').delete().eq('business_id',businessId).eq('branch_id',branchId).eq('source_key',legacySource);if(removedLegacy.error)throw new Error(removedLegacy.error.message);
    var removedPayments=await db.from('cash_transactions').delete().eq('business_id',businessId).eq('branch_id',branchId).like('source_key',paymentPrefix+'%');if(removedPayments.error)throw new Error(removedPayments.error.message);
    var cashPayments=payments.filter(function(payment){return String(payment.payment_method||'').toLowerCase()==='cash'});
    for(var index=0;index<cashPayments.length;index++){
      var payment=cashPayments[index];if(!payment.id)continue;
      var addedPayment=await db.from('cash_transactions').insert({business_id:businessId,branch_id:branchId,cash_account:'CIB',direction:'In',amount:Number(payment.amount||0),transaction_date:payment.payment_date||row.invoice_date||new Date().toISOString().slice(0,10),source_key:paymentPrefix+payment.id,reference_number:'INV-'+String(row.invoice_number).padStart(5,'0'),notes:'Cash payment for invoice - '+row.client_name,created_by:userId});if(addedPayment.error)throw new Error(addedPayment.error.message);
    }
    document.dispatchEvent(new Event('bwc:cash-updated'));
    if(false){
    var source='invoice-cash:'+row.id,cash=payments.filter(function(p){return String(p.payment_method||'').toLowerCase()==='cash'}).reduce(function(sum,p){return sum+Number(p.amount||0)},0);
    var removed=await db.from('cash_transactions').delete().eq('business_id',businessId).eq('branch_id',currentBranch()).eq('source_key',source);if(removed.error)throw new Error(removed.error.message);
    if(cash>0){var added=await db.from('cash_transactions').insert({business_id:businessId,branch_id:currentBranch(),cash_account:'CIB',direction:'In',amount:cash,transaction_date:row.invoice_date||new Date().toISOString().slice(0,10),source_key:source,reference_number:'INV-'+String(row.invoice_number).padStart(5,'0'),notes:'Cash received from invoice · '+row.client_name,created_by:userId});if(added.error)throw new Error(added.error.message)}
    document.dispatchEvent(new Event('bwc:cash-updated'));
    }
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
  document.addEventListener('click',function(event){
    var pay=event.target.closest('[data-invoice-payment]'),history=event.target.closest('[data-invoice-history]'),shortcut=event.target.closest('[data-record-invoice-payment]');
    if(pay){selectedId=pay.dataset.invoicePayment;render();var amount=document.getElementById('paymentAmount');if(amount)amount.focus()}
    if(history){selectedId=history.dataset.invoiceHistory;render()}
    if(shortcut){
      selectedId=shortcut.dataset.recordInvoicePayment;render();
      var paymentPanel=panel();if(paymentPanel)paymentPanel.scrollIntoView({behavior:'smooth',block:'start'});
      setTimeout(function(){var amount=document.getElementById('paymentAmount');if(amount)amount.focus()},350);
    }
    if(event.target.id==='closeInvoicePayment'){selectedId='';render()}
    if(event.target.id==='useRemainingInvoicePayment'){var amount=document.getElementById('paymentAmount');if(amount)amount.value=Number(amount.max||0).toFixed(2)}
    if(event.target.id==='saveInvoicePayment'){save().catch(function(error){alert('Payment could not be saved: '+error.message)})}
  });
  document.addEventListener('bwc:invoices-loaded',function(){setTimeout(load,40)});
  document.addEventListener('bwc:branch-ready',function(){selectedId='';setTimeout(load,120)});
  function start(){var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};if(!window.supabase||!config.url||!config.publishableKey||!window.BWCContext){setTimeout(start,150);return}db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);identity().then(function(ok){if(ok)load()}).catch(function(){var host=ensurePanel();if(host)host.innerHTML='<div class="notice">Payment history is waiting for secure workspace access. Please refresh once.</div>'});}
  setTimeout(start,700);
})();
