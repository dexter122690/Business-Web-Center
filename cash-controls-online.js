/* CIB and Petty Cash controls for the active business branch. */
(function(){
  var db=null,businessId='',userId='',online=false,rows=[];
  function peso(n){return 'PHP '+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function esc(value){return String(value||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function activeBranch(){return localStorage.getItem('bwc-active-branch')||''}
  function value(id){var el=document.getElementById(id);return el?el.value.trim():''}
  function account(payment){var text=String(payment||'').toLowerCase();return text==='cib'?'CIB':text==='petty cash'?'Petty Cash':''}
  async function resolveBusiness(){
    var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;if(!user)return '';userId=user.id;
    var memberships=await db.from('business_memberships').select('business_id,businesses!inner(id,name,status)').eq('user_id',user.id).eq('status','active');
    var saved=localStorage.getItem('bwc-active-business'),available=(memberships.data||[]).filter(function(row){return row.businesses&&row.businesses.status==='active'}),chosen=available.find(function(row){return row.business_id===saved})||available[0];
    if(chosen){localStorage.setItem('bwc-active-business',chosen.business_id);return chosen.business_id}return '';
  }
  function setPaymentOptions(){
    ['receiptPayment','exPayment'].forEach(function(id){var select=document.getElementById(id);if(!select||select.dataset.cashSources)return;var selected=select.value;select.innerHTML='<option>CIB</option><option>Petty Cash</option><option>Authorized Manager</option>';select.value=['CIB','Petty Cash','Authorized Manager'].indexOf(selected)>=0?selected:'CIB';select.dataset.cashSources='1'});
  }
  function totals(name){return rows.filter(function(row){return row.cash_account===name}).reduce(function(all,row){var amount=Number(row.amount||0);if(row.direction==='In')all.in+=amount;else all.out+=amount;all.balance=all.in-all.out;return all},{in:0,out:0,balance:0})}
  function render(){
    var root=document.getElementById('expenses');if(!root)return;setPaymentOptions();var current=document.getElementById('cashControlPanel');if(current)current.remove();var anchor=root.querySelector('.expense-scanner-tabs')||root.firstChild;if(!anchor)return;
    var cib=totals('CIB'),petty=totals('Petty Cash'),recent=rows.slice(0,8),panel=document.createElement('section');panel.id='cashControlPanel';panel.className='card';panel.style.marginTop='14px';
    panel.innerHTML='<div class="k">Cash controls</div><h2>CIB and Petty Cash</h2><p class="muted">Record money added to each cash fund. Expense payments made from CIB or Petty Cash are recorded as money out automatically.</p><div class="grid" style="margin-top:12px"><div class="mini"><b>CIB balance</b><div class="metric">'+peso(cib.balance)+'</div><small>In '+peso(cib.in)+' · Out '+peso(cib.out)+'</small></div><div class="mini"><b>Petty Cash balance</b><div class="metric">'+peso(petty.balance)+'</div><small>In '+peso(petty.in)+' · Out '+peso(petty.out)+'</small></div></div><div class="two" style="margin-top:14px"><div><h3>Add money to CIB</h3><div class="formgrid"><label>Amount (PHP)<input id="cashCibAmount" type="number" min="0" step=".01" value="0"></label><label style="grid-column:span 2">Reference / note<input id="cashCibNote" placeholder="e.g., Cash deposit or opening balance"></label></div><button class="primary" type="button" data-cash-in="CIB" style="margin-top:10px">Record CIB cash in</button></div><div><h3>Add money to Petty Cash</h3><div class="formgrid"><label>Amount (PHP)<input id="cashPettyAmount" type="number" min="0" step=".01" value="0"></label><label style="grid-column:span 2">Reference / note<input id="cashPettyNote" placeholder="e.g., Fund transfer or opening balance"></label></div><button class="primary" type="button" data-cash-in="Petty Cash" style="margin-top:10px">Record Petty Cash in</button></div></div><div style="margin-top:16px"><h3>Recent cash movement</h3>'+(recent.length?'<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Cash fund</th><th>Movement</th><th>Amount</th><th>Reference / note</th></tr></thead><tbody>'+recent.map(function(row){return '<tr><td>'+esc(row.transaction_date)+'</td><td>'+esc(row.cash_account)+'</td><td>'+esc(row.direction)+'</td><td><b>'+peso(row.amount)+'</b></td><td>'+esc(row.reference_number||row.notes||'—')+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">No CIB or Petty Cash movement recorded yet.</div>')+'</div>';
    anchor.insertAdjacentElement('afterend',panel);
  }
  /* The Expenses form is rebuilt by the receipt screen after online records
     finish loading.  Keep the cash controls mounted after that rebuild instead
     of leaving CIB and Petty Cash dependent on a particular click sequence. */
  function ensureMounted(){
    if(!online||!activeBranch())return;
    var root=document.getElementById('expenses');
    /* Some existing customer pages still use the original manual expense form,
       which has no scanner-tabs wrapper.  Cash Controls belongs to every
       Expenses view, so mount it whenever the Expenses root is available. */
    if(!root)return;
    setPaymentOptions();
    if(!document.getElementById('cashControlPanel'))render();
  }
  async function load(){
    if(!online||!activeBranch())return;var result=await db.from('cash_transactions').select('*').eq('business_id',businessId).eq('branch_id',activeBranch()).order('transaction_date',{ascending:false}).order('created_at',{ascending:false});if(result.error){return}rows=result.data||[];render();
  }
  async function addCashIn(name){
    var prefix=name==='CIB'?'cashCib':'cashPetty',amount=Number(value(prefix+'Amount'))||0,notes=value(prefix+'Note');if(!amount){alert('Enter a cash-in amount first.');return}if(!activeBranch()){alert('The current branch is still loading. Please try again in a moment.');return}
    var result=await db.from('cash_transactions').insert({business_id:businessId,branch_id:activeBranch(),cash_account:name,direction:'In',amount:amount,transaction_date:new Date().toISOString().slice(0,10),reference_number:notes||null,notes:notes||null,created_by:userId});if(result.error){alert('Cash movement could not be saved: '+result.error.message);return}await load();alert(name+' cash in was recorded.');
  }
  window.__recordExpenseCashOut=async function(payment,date,amount,sourceKey,reference,notes){
    var cashAccount=account(payment);if(!cashAccount||!online||!activeBranch())return true;var result=await db.from('cash_transactions').upsert({business_id:businessId,branch_id:activeBranch(),cash_account:cashAccount,direction:'Out',amount:Number(amount||0),transaction_date:date||new Date().toISOString().slice(0,10),source_key:sourceKey||null,reference_number:reference||null,notes:notes||null,created_by:userId},{onConflict:'branch_id,source_key',ignoreDuplicates:true});if(result.error){console.warn('Cash control update failed',result.error.message);return false}await load();return true;
  };
  document.addEventListener('click',function(event){var button=event.target.closest('[data-cash-in]');if(button&&online){event.preventDefault();addCashIn(button.dataset.cashIn);return}if(event.target.closest('[data-t="expenses"]'))setTimeout(ensureMounted,350)},true);
  document.addEventListener('bwc:expenses-loaded',function(){setTimeout(ensureMounted,180)});
  document.addEventListener('bwc:cash-updated',function(){if(online)setTimeout(load,60)});
  document.addEventListener('bwc:branch-ready',function(){if(online){rows=[];setTimeout(load,80)}});
  var mountTimer=0;
  new MutationObserver(function(){
    if(!online||mountTimer)return;
    mountTimer=setTimeout(function(){mountTimer=0;ensureMounted()},90);
  }).observe(document.documentElement,{childList:true,subtree:true});
  async function start(){var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};if(!window.supabase||!config.url||!config.publishableKey){setTimeout(start,300);return}db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);businessId=await resolveBusiness();if(!businessId)return;online=true;await load();setTimeout(ensureMounted,700)}
  setTimeout(start,850);
})();
