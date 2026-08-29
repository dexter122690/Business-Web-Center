/* Delete controls for manual CIB and Petty Cash cash-ins only. */
(function(){
  var db,businessId='',userId='',activeRole='';
  function branch(){return localStorage.getItem('bwc-active-branch')||''}
  async function setup(){
    var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};
    if(!window.supabase||!config.url||!config.publishableKey){setTimeout(setup,300);return}
    db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);
    var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;
    if(!user)return;userId=user.id;
    var memberships=await db.from('business_memberships').select('business_id,role,businesses!inner(status)').eq('user_id',user.id).eq('status','active');
    var saved=localStorage.getItem('bwc-active-business'),available=(memberships.data||[]).filter(function(row){return row.businesses&&row.businesses.status==='active'}),chosen=available.find(function(row){return row.business_id===saved})||available[0];
    businessId=chosen?chosen.business_id:'';activeRole=chosen?String(chosen.role||''):'';
    decorate();
  }
  async function decorate(){
    if(!db||!businessId||!branch())return;
    var result=await db.from('cash_transactions').select('id,direction,source_key,transaction_date,cash_account,amount').eq('business_id',businessId).eq('branch_id',branch()).order('transaction_date',{ascending:false}).order('created_at',{ascending:false});
    if(result.error)return;
    var records=result.data||[];
    /* Put the correction control where the owner sees the actual CIB/Petty
       Cash entry.  Staff never receive an erase control.  Entries generated
       by invoices and Expenses remain protected and must be corrected from
       their source screen, which keeps all balances in agreement. */
    document.querySelectorAll('[data-cash-ledger-id]').forEach(function(row){
      var action=row.querySelector('.cash-movement-action'),id=row.dataset.cashLedgerId,source=row.dataset.cashLedgerSource||'';
      if(!action||action.dataset.cashActionReady)return;
      action.dataset.cashActionReady='1';
      if(activeRole!=='owner')return;
      if(/^(invoice-cash:|invoice-payment-cash:)/.test(source)){
        action.textContent='Edit invoice';
        return;
      }
      if(/^receipt:/.test(source)){
        var receiptButton=document.createElement('button');receiptButton.type='button';receiptButton.className='secondary';receiptButton.textContent='Erase';receiptButton.dataset.cashReceiptDelete=source;action.appendChild(receiptButton);return;
      }
      if(/^(expense:|petty-expense:|cib-expense:)/.test(source)){
        var expenseId=linkedExpenseId(source);if(expenseId){var expenseButton=document.createElement('button');expenseButton.type='button';expenseButton.className='secondary';expenseButton.textContent='Erase';expenseButton.dataset.cashExpenseDelete=expenseId;action.appendChild(expenseButton)}return;
      }
      var erase=document.createElement('button');erase.type='button';erase.className='secondary';erase.textContent='Erase';erase.dataset.cashDelete=id;action.appendChild(erase);
    });
    document.querySelectorAll('#cashControlPanel table tbody tr').forEach(function(row,index){
      var cells=row.querySelectorAll('td');if(cells.length<5||cells.length>5)return;
      var record=records[index];
      var action=document.createElement('td');
      var source=String(record&&record.source_key||''),protectedRecord=/^(invoice-cash:|expense:|receipt:|petty-expense:|cib-expense:)/.test(source);
      if(protectedRecord){
        if(source.indexOf('invoice-cash:')===0&&activeRole==='owner'){
          var invoiceButton=document.createElement('button');invoiceButton.type='button';invoiceButton.className='secondary';invoiceButton.textContent='Delete cash payment';invoiceButton.dataset.cashInvoiceDelete=source.slice('invoice-cash:'.length);action.appendChild(invoiceButton);
        }else if(source.indexOf('invoice-cash:')===0) action.textContent='Owner only';
        else if(!addExpenseActions(action,source)) action.textContent='Protected';
        row.appendChild(action);return
      }
      if(record){var button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Delete';button.dataset.cashDelete=record.id;action.appendChild(button)}else action.textContent='—';
      row.appendChild(action);
    });
    var header=document.querySelector('#cashControlPanel table thead tr');if(header&&header.children.length===5){var head=document.createElement('th');head.textContent='Action';header.appendChild(head)}
  }
  function addCashActions(){
    var panel=document.getElementById('cashControlPanel');if(!panel||document.getElementById('cashTransferPanel'))return;
    var actions=document.createElement('div');actions.id='cashTransferPanel';actions.className='two';actions.style.marginTop='14px';
    var categories='<option>Parts &amp; Materials</option><option>Labor</option><option>Salaries &amp; Wages</option><option>Cost of Sales</option><option>Shipping Expense</option><option>Transportation Allowance</option><option>Supplies Expense</option><option>Marketing Expense</option><option>Utilities Expense</option><option>Staff Cash Shortage / Unremitted Collection</option><option>Other</option>',today=new Date().toISOString().slice(0,10);
    function receiptExpenseForm(prefix,title,account){return '<div class="mini"><div class="k">'+account+' purchase</div><h3>'+title+'</h3><p class="muted">Save this purchase once. It creates the expense record and the matching '+account+' Out automatically.</p><div class="formgrid"><label>Date<input id="'+prefix+'Date" type="date" value="'+today+'"></label><label>Supplier name<input id="'+prefix+'Supplier" placeholder="e.g., ABC Auto Supply"></label><label>Receipt number<input id="'+prefix+'Receipt" placeholder="e.g., OR-000123"></label><label style="grid-column:span 2">Item / description<input id="'+prefix+'Description" placeholder="e.g., Emergency supplies"></label><label>Category<select id="'+prefix+'Category">'+categories+'</select></label><label>Amount (PHP)<input id="'+prefix+'Amount" type="number" min="0.01" step=".01" value="0"></label></div><button class="primary" type="button" data-'+(account==='CIB'?'cib':'petty')+'-expense style="margin-top:10px">'+title+'</button></div>'}
    actions.innerHTML='<div class="mini"><div class="k">CIB remittance</div><h3>Remit CIB to owner</h3><p class="muted">Records money taken from CIB and remitted to the business owner.</p><div class="formgrid"><label>Amount (PHP)<input id="cashRemitAmount" type="number" min="0" step=".01" value="0"></label><label style="grid-column:span 2">Reference / note<input id="cashRemitNote" placeholder="e.g., Remitted to owner"></label></div><button class="primary" type="button" data-cash-remit style="margin-top:10px">Remit from CIB</button></div><div class="mini"><div class="k">Fund transfer</div><h3>Move CIB to Petty Cash</h3><p class="muted">Moves the same amount out of CIB and into Petty Cash.</p><div class="formgrid"><label>Amount (PHP)<input id="cashTransferAmount" type="number" min="0" step=".01" value="0"></label><label style="grid-column:span 2">Reference / note<input id="cashTransferNote" placeholder="e.g., Weekly petty cash fund"></label></div><button class="primary" type="button" data-cash-transfer style="margin-top:10px">Transfer to Petty Cash</button></div>'+receiptExpenseForm('pettyExpense','Record Petty Cash Expense with Receipt','Petty Cash')+receiptExpenseForm('cibExpense','Record CIB Expense with Receipt','CIB');
    var recent=Array.from(panel.children).find(function(child){return child.textContent.indexOf('Recent cash movement')>=0});
    if(recent)recent.insertAdjacentElement('beforebegin',actions);else panel.appendChild(actions);
  }
  function inputValue(id){var element=document.getElementById(id);return element?element.value.trim():''}
  function sourceId(prefix){return prefix+'-'+Date.now()+'-'+Math.random().toString(36).slice(2)}
  function linkedExpenseId(source){var match=String(source||'').match(/^(?:expense|petty-expense|cib-expense):(.+)$/);return match?match[1]:''}
  function receiptInfo(source){var parts=String(source||'').slice('receipt:'.length).split('|');return parts.length>=3?{supplier:parts[0],receipt:parts[1],date:parts.slice(2).join('|')}:null}
  function addExpenseActions(action,source){
    var expenseId=linkedExpenseId(source);
    if(expenseId){
      var edit=document.createElement('button');edit.type='button';edit.className='secondary';edit.textContent='Edit';edit.dataset.cashExpenseEdit=expenseId;action.appendChild(edit);
      var remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='Delete';remove.style.marginLeft='6px';remove.dataset.cashExpenseDelete=expenseId;action.appendChild(remove);return true
    }
    var receipt=source.indexOf('receipt:')===0?receiptInfo(source):null;
    if(receipt){
      var editReceipt=document.createElement('button');editReceipt.type='button';editReceipt.className='secondary';editReceipt.textContent='Edit items';editReceipt.dataset.cashReceiptEdit=source;action.appendChild(editReceipt);
      var deleteReceipt=document.createElement('button');deleteReceipt.type='button';deleteReceipt.className='secondary';deleteReceipt.textContent='Delete receipt';deleteReceipt.style.marginLeft='6px';deleteReceipt.dataset.cashReceiptDelete=source;action.appendChild(deleteReceipt);return true
    }
    return false
  }
  async function remit(){
    var amount=Number(inputValue('cashRemitAmount'))||0,note=inputValue('cashRemitNote');if(!amount){alert('Enter a remittance amount first.');return}
    if(!confirm('Record this CIB amount as remitted to the owner?'))return;
    var result=await db.from('cash_transactions').insert({business_id:businessId,branch_id:branch(),cash_account:'CIB',direction:'Out',amount:amount,transaction_date:new Date().toISOString().slice(0,10),source_key:sourceId('cib-remit'),reference_number:note||'CIB remittance',notes:note||'Remitted to owner',created_by:userId});
    if(result.error){alert('Remittance could not be saved: '+result.error.message);return}alert('CIB remittance recorded.');document.dispatchEvent(new CustomEvent('bwc:cash-updated'));
  }
  async function transfer(){
    var amount=Number(inputValue('cashTransferAmount'))||0,note=inputValue('cashTransferNote');if(!amount){alert('Enter a transfer amount first.');return}
    if(!confirm('Transfer this amount from CIB to Petty Cash?'))return;
    var key=sourceId('cib-to-petty'),date=new Date().toISOString().slice(0,10),records=[{business_id:businessId,branch_id:branch(),cash_account:'CIB',direction:'Out',amount:amount,transaction_date:date,source_key:key+'-out',reference_number:note||'CIB to Petty Cash',notes:note||'CIB to Petty Cash transfer',created_by:userId},{business_id:businessId,branch_id:branch(),cash_account:'Petty Cash',direction:'In',amount:amount,transaction_date:date,source_key:key+'-in',reference_number:note||'CIB to Petty Cash',notes:note||'CIB to Petty Cash transfer',created_by:userId}];
    var result=await db.from('cash_transactions').insert(records);if(result.error){alert('Fund transfer could not be saved: '+result.error.message);return}alert('CIB was transferred to Petty Cash.');document.dispatchEvent(new CustomEvent('bwc:cash-updated'));
  }
  async function pettyExpense(){
    return recordCashExpense('Petty Cash','pettyExpense','petty-expense');
  }
  async function cibExpense(){
    return recordCashExpense('CIB','cibExpense','cib-expense');
  }
  async function recordCashExpense(cashAccount,prefix,sourcePrefix){
    var description=inputValue(prefix+'Description'),category=inputValue(prefix+'Category')||'Other',amount=Number(inputValue(prefix+'Amount'))||0,date=inputValue(prefix+'Date'),supplier=inputValue(prefix+'Supplier'),receipt=inputValue(prefix+'Receipt');
    if(!date||!supplier||!receipt||!description||!amount){alert('Enter the date, supplier, receipt number, item / description, and amount first.');return}
    if(!confirm('Record this as an expense paid from '+cashAccount+'?'))return;
    var reference=receipt,expense=await db.from('expenses').insert({business_id:businessId,branch_id:branch(),expense_date:date,supplier_name:supplier,receipt_number:receipt,category:category,description:description,quantity:1,unit_amount:amount,payment_method:cashAccount,reference_number:reference,remarks:cashAccount+' expense with receipt',created_by:userId}).select('id').single();
    if(expense.error){alert('Expense could not be saved: '+expense.error.message);return}
    var cash=await db.from('cash_transactions').insert({business_id:businessId,branch_id:branch(),cash_account:cashAccount,direction:'Out',amount:amount,transaction_date:date,source_key:sourcePrefix+':'+expense.data.id,reference_number:reference,notes:description,created_by:userId});
    if(cash.error){alert('Expense was saved, but the '+cashAccount+' deduction could not be saved: '+cash.error.message);return}
    alert(cashAccount+' expense and cash out were recorded.');var tab=document.querySelector('[data-t="expenses"]');if(tab)tab.click();document.dispatchEvent(new CustomEvent('bwc:cash-updated'));
  }
  document.addEventListener('click',async function(event){
    var cibExpenseButton=event.target.closest('[data-cib-expense]');if(cibExpenseButton&&db){event.preventDefault();cibExpense();return}
    var pettyButton=event.target.closest('[data-petty-expense]');if(pettyButton&&db){event.preventDefault();pettyExpense();return}
    var editExpense=event.target.closest('[data-cash-expense-edit]');if(editExpense){
      event.preventDefault();var editTab=document.querySelector('[data-t="expenses"]');if(editTab)editTab.click();
      setTimeout(function(){if(window.__expenseOnlineActions)window.__expenseOnlineActions.edit(editExpense.dataset.cashExpenseEdit);else alert('Expenses are still loading. Please try again in a moment.');},500);return
    }
    var deleteExpenseButton=event.target.closest('[data-cash-expense-delete]');if(deleteExpenseButton){
      event.preventDefault();if(window.__expenseOnlineActions)window.__expenseOnlineActions.remove(deleteExpenseButton.dataset.cashExpenseDelete);else alert('Expenses are still loading. Please try again in a moment.');return
    }
    var editReceipt=event.target.closest('[data-cash-receipt-edit]');if(editReceipt){
      event.preventDefault();var receiptTab=document.querySelector('[data-t="expenses"]');if(receiptTab)receiptTab.click();
      setTimeout(function(){if(window.__expenseOnlineActions&&window.__expenseOnlineActions.editReceipt)window.__expenseOnlineActions.editReceipt(editReceipt.dataset.cashReceiptEdit);else alert('Expenses are still loading. Please try again in a moment.');},500);return
    }
    var deleteReceipt=event.target.closest('[data-cash-receipt-delete]');if(deleteReceipt&&db){
      event.preventDefault();var receipt=receiptInfo(deleteReceipt.dataset.cashReceiptDelete);if(!receipt)return;
      if(!confirm('Delete this entire receipt? All of its expense item lines and the matching cash deduction will be removed.'))return;
      var removedExpenses=await db.from('expenses').delete().eq('business_id',businessId).eq('branch_id',branch()).eq('supplier_name',receipt.supplier).eq('receipt_number',receipt.receipt).eq('expense_date',receipt.date);
      if(removedExpenses.error){alert('The receipt could not be deleted: '+removedExpenses.error.message);return}
      var removedCash=await db.from('cash_transactions').delete().eq('business_id',businessId).eq('branch_id',branch()).eq('source_key',deleteReceipt.dataset.cashReceiptDelete);
      if(removedCash.error){alert('The receipt items were removed, but its cash record could not be removed: '+removedCash.error.message);return}
      alert('Receipt and matching cash movement deleted.');document.dispatchEvent(new CustomEvent('bwc:cash-updated'));return
    }
    var openExpenses=event.target.closest('[data-open-expenses]');if(openExpenses){event.preventDefault();var expenseTab=document.querySelector('[data-t="expenses"]');if(expenseTab)expenseTab.click();return}
    var remitButton=event.target.closest('[data-cash-remit]');if(remitButton&&db){event.preventDefault();remit();return}
    var transferButton=event.target.closest('[data-cash-transfer]');if(transferButton&&db){event.preventDefault();transfer();return}
    var invoiceCashButton=event.target.closest('[data-cash-invoice-delete]');if(invoiceCashButton&&db){
      event.preventDefault();
      if(activeRole!=='owner'){alert('Only the business owner can delete an invoice cash payment.');return}
      if(!confirm('Delete the cash payment(s) for this invoice? This reverses the related CIB cash entry and updates the invoice balance. This cannot be used after the cash has been remitted.'))return;
      var reversed=await db.rpc('owner_delete_invoice_cash_payments',{p_invoice_id:invoiceCashButton.dataset.cashInvoiceDelete,p_branch_id:branch()});
      if(reversed.error){alert('Cash payment could not be deleted: '+reversed.error.message);return}
      alert('Invoice cash payment deleted. CIB and the invoice balance were updated.');
      document.dispatchEvent(new CustomEvent('bwc:cash-updated'));document.dispatchEvent(new Event('bwc:invoice-payments-updated'));setTimeout(decorate,150);return;
    }
    var button=event.target.closest('[data-cash-delete]');if(!button||!db)return;
    event.preventDefault();if(!confirm('Delete this cash record? Any linked transfer or quick expense will also be reversed.'))return;
    var found=await db.from('cash_transactions').select('source_key').eq('id',button.dataset.cashDelete).eq('business_id',businessId).eq('branch_id',branch()).single();
    if(found.error){alert('Cash record could not be found: '+found.error.message);return}
    var source=found.data.source_key||'',query=db.from('cash_transactions').delete().eq('business_id',businessId).eq('branch_id',branch());
    if(source.indexOf('cib-to-petty-')===0){query=query.like('source_key',source.replace(/-(in|out)$/,'')+'%')}else query=query.eq('id',button.dataset.cashDelete);
    var result=await query;if(result.error){alert('Cash record could not be deleted: '+result.error.message);return}
    if(source.indexOf('cib-expense:')===0||source.indexOf('petty-expense:')===0){var expenseId=source.split(':')[1],expense=await db.from('expenses').delete().eq('id',expenseId).eq('business_id',businessId).eq('branch_id',branch());if(expense.error){alert('Cash record was deleted, but the linked expense could not be removed: '+expense.error.message);return}}
    alert('Cash record deleted and balances updated.');
    document.dispatchEvent(new CustomEvent('bwc:cash-updated'));
  },true);
  new MutationObserver(function(){setTimeout(function(){decorate();addCashActions()},40)}).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('bwc:branch-ready',function(){setTimeout(decorate,100)});
  setTimeout(function(){setup();addCashActions()},1000);
})();
