/* Delete controls for manual CIB and Petty Cash cash-ins only. */
(function(){
  var db,businessId='',userId='';
  function branch(){return localStorage.getItem('bwc-active-branch')||''}
  async function setup(){
    var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};
    if(!window.supabase||!config.url||!config.publishableKey){setTimeout(setup,300);return}
    db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);
    var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;
    if(!user)return;userId=user.id;
    var memberships=await db.from('business_memberships').select('business_id,businesses!inner(status)').eq('user_id',user.id).eq('status','active');
    var saved=localStorage.getItem('bwc-active-business'),available=(memberships.data||[]).filter(function(row){return row.businesses&&row.businesses.status==='active'}),chosen=available.find(function(row){return row.business_id===saved})||available[0];
    businessId=chosen?chosen.business_id:'';
    decorate();
  }
  async function decorate(){
    if(!db||!businessId||!branch())return;
    var result=await db.from('cash_transactions').select('id,direction,source_key,transaction_date,cash_account,amount').eq('business_id',businessId).eq('branch_id',branch()).order('transaction_date',{ascending:false}).order('created_at',{ascending:false});
    if(result.error)return;
    var deletable=(result.data||[]).filter(function(row){return row.direction==='In'&&!row.source_key});
    document.querySelectorAll('#cashControlPanel table tbody tr').forEach(function(row,index){
      var cells=row.querySelectorAll('td');if(cells.length<5||cells.length>5)return;
      var date=cells[0].textContent.trim(),fund=cells[1].textContent.trim(),movement=cells[2].textContent.trim(),amount=cells[3].textContent.replace(/[^0-9.]/g,'');
      var record=deletable.find(function(item){return item.transaction_date===date&&item.cash_account===fund&&item.direction===movement&&Number(item.amount).toFixed(2)===Number(amount||0).toFixed(2)});
      var action=document.createElement('td');
      if(record){var button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Delete';button.dataset.cashDelete=record.id;action.appendChild(button)}else action.textContent='—';
      row.appendChild(action);
    });
    var header=document.querySelector('#cashControlPanel table thead tr');if(header&&header.children.length===5){var head=document.createElement('th');head.textContent='Action';header.appendChild(head)}
  }
  function addCashActions(){
    var panel=document.getElementById('cashControlPanel');if(!panel||document.getElementById('cashTransferPanel'))return;
    var actions=document.createElement('div');actions.id='cashTransferPanel';actions.className='two';actions.style.marginTop='14px';
    var categories='<option>Parts &amp; Materials</option><option>Labor</option><option>Salaries &amp; Wages</option><option>Cost of Sales</option><option>Shipping Expense</option><option>Transportation Allowance</option><option>Supplies Expense</option><option>Marketing Expense</option><option>Utilities Expense</option><option>Other</option>';
    actions.innerHTML='<div class="mini"><div class="k">CIB remittance</div><h3>Remit CIB to owner</h3><p class="muted">Records money taken from CIB and remitted to the business owner.</p><div class="formgrid"><label>Amount (PHP)<input id="cashRemitAmount" type="number" min="0" step=".01" value="0"></label><label style="grid-column:span 2">Reference / note<input id="cashRemitNote" placeholder="e.g., Remitted to owner"></label></div><button class="primary" type="button" data-cash-remit style="margin-top:10px">Remit from CIB</button></div><div class="mini"><div class="k">Fund transfer</div><h3>Move CIB to Petty Cash</h3><p class="muted">Moves the same amount out of CIB and into Petty Cash.</p><div class="formgrid"><label>Amount (PHP)<input id="cashTransferAmount" type="number" min="0" step=".01" value="0"></label><label style="grid-column:span 2">Reference / note<input id="cashTransferNote" placeholder="e.g., Weekly petty cash fund"></label></div><button class="primary" type="button" data-cash-transfer style="margin-top:10px">Transfer to Petty Cash</button></div><div class="mini"><div class="k">Petty Cash expense</div><h3>Record Petty Cash expense</h3><p class="muted">Creates an expense record and deducts the same amount from Petty Cash.</p><div class="formgrid"><label>Description<input id="pettyExpenseDescription" placeholder="e.g., Emergency supplies"></label><label>Category<select id="pettyExpenseCategory">'+categories+'</select></label><label>Amount (PHP)<input id="pettyExpenseAmount" type="number" min="0" step=".01" value="0"></label></div><button class="primary" type="button" data-petty-expense style="margin-top:10px">Record Petty Cash expense</button></div><div class="mini"><div class="k">CIB expense</div><h3>Record CIB expense</h3><p class="muted">Creates an expense record and deducts the same amount from CIB.</p><div class="formgrid"><label>Description<input id="cibExpenseDescription" placeholder="e.g., Materials purchase"></label><label>Category<select id="cibExpenseCategory">'+categories+'</select></label><label>Amount (PHP)<input id="cibExpenseAmount" type="number" min="0" step=".01" value="0"></label></div><button class="primary" type="button" data-cib-expense style="margin-top:10px">Record CIB expense</button></div>';
    var recent=Array.from(panel.children).find(function(child){return child.textContent.indexOf('Recent cash movement')>=0});
    if(recent)recent.insertAdjacentElement('beforebegin',actions);else panel.appendChild(actions);
  }
  function inputValue(id){var element=document.getElementById(id);return element?element.value.trim():''}
  function sourceId(prefix){return prefix+'-'+Date.now()+'-'+Math.random().toString(36).slice(2)}
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
    var description=inputValue(prefix+'Description'),category=inputValue(prefix+'Category')||'Other',amount=Number(inputValue(prefix+'Amount'))||0;
    if(!description||!amount){alert('Enter an expense description and amount first.');return}
    if(!confirm('Record this as an expense paid from '+cashAccount+'?'))return;
    var date=new Date().toISOString().slice(0,10),reference=cashAccount+' expense',expense=await db.from('expenses').insert({business_id:businessId,branch_id:branch(),expense_date:date,supplier_name:cashAccount,receipt_number:null,category:category,description:description,quantity:1,unit_amount:amount,payment_method:cashAccount,reference_number:reference,remarks:'Quick '+cashAccount+' expense entry',created_by:userId}).select('id').single();
    if(expense.error){alert('Expense could not be saved: '+expense.error.message);return}
    var cash=await db.from('cash_transactions').insert({business_id:businessId,branch_id:branch(),cash_account:cashAccount,direction:'Out',amount:amount,transaction_date:date,source_key:sourcePrefix+':'+expense.data.id,reference_number:reference,notes:description,created_by:userId});
    if(cash.error){alert('Expense was saved, but the '+cashAccount+' deduction could not be saved: '+cash.error.message);return}
    alert(cashAccount+' expense recorded and balance updated.');var tab=document.querySelector('[data-t="expenses"]');if(tab)tab.click();document.dispatchEvent(new CustomEvent('bwc:cash-updated'));
  }
  document.addEventListener('click',async function(event){
    var cibExpenseButton=event.target.closest('[data-cib-expense]');if(cibExpenseButton&&db){event.preventDefault();cibExpense();return}
    var pettyButton=event.target.closest('[data-petty-expense]');if(pettyButton&&db){event.preventDefault();pettyExpense();return}
    var remitButton=event.target.closest('[data-cash-remit]');if(remitButton&&db){event.preventDefault();remit();return}
    var transferButton=event.target.closest('[data-cash-transfer]');if(transferButton&&db){event.preventDefault();transfer();return}
    var button=event.target.closest('[data-cash-delete]');if(!button||!db)return;
    event.preventDefault();if(!confirm('Delete this manual cash-in? The selected cash balance will update.'))return;
    var result=await db.from('cash_transactions').delete().eq('id',button.dataset.cashDelete).eq('business_id',businessId).eq('branch_id',branch()).eq('direction','In').is('source_key',null);
    if(result.error){alert('Cash-in record could not be deleted: '+result.error.message);return}
    alert('Cash-in record deleted and balance updated.');
    document.dispatchEvent(new CustomEvent('bwc:cash-updated'));
  },true);
  new MutationObserver(function(){setTimeout(function(){decorate();addCashActions()},40)}).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('bwc:branch-ready',function(){setTimeout(decorate,100)});
  setTimeout(function(){setup();addCashActions()},1000);
})();
