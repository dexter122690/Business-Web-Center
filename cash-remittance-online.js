/* Shows client cash remittance alongside the CIB and Petty Cash expense funding it supports. */
(function(){
  var config=window.BUSINESS_WEB_CENTER_SUPABASE||{},db=null,businessId='',userId='',rows=[],cashRows=[];
  function peso(value){return 'PHP '+Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]})}
  function activeBranch(){return localStorage.getItem('bwc-active-branch')||''}
  function period(row){var month=(document.getElementById('dm')||{}).value||'',year=(document.getElementById('dy')||{}).value||'',date=new Date(row.received_date+'T00:00:00');return (!month||date.getMonth()===Number(month))&&(!year||String(date.getFullYear())===String(year))}
  function cashPeriod(row){return period({received_date:row.transaction_date})}
  function isExpenseCashOut(row){return row.direction==='Out'&&/^(expense:|receipt:|cib-expense:|petty-expense:)/.test(String(row.source_key||''))}
  async function load(){
    if(!db||!businessId||!activeBranch())return;
    var results=await Promise.all([
      db.from('cash_collections').select('id,received_date,amount,received_by,status,remitted_at,invoice_id,invoices!inner(invoice_number,client_name)').eq('business_id',businessId).eq('branch_id',activeBranch()).order('received_date',{ascending:false}),
      db.from('cash_transactions').select('id,transaction_date,cash_account,direction,amount,source_key').eq('business_id',businessId).eq('branch_id',activeBranch()).order('transaction_date',{ascending:false})
    ]);
    if(results[0].error)return;
    rows=results[0].data||[];
    cashRows=results[1].error?[]:(results[1].data||[]);
    draw()
  }
  function balanceFor(account){return cashRows.filter(function(row){return row.cash_account===account}).reduce(function(total,row){var amount=Number(row.amount||0);return total+(row.direction==='In'?amount:-amount)},0)}
  function updateLiveCashCards(dashboard){
    var liveCard=Array.from(dashboard.querySelectorAll('.card')).find(function(card){var heading=card.querySelector('h2');return heading&&heading.textContent.trim()==='Cash controls'});
    if(!liveCard)return;
    var boxes=liveCard.querySelectorAll('.mini'),cib=balanceFor('CIB'),petty=balanceFor('Petty Cash');
    if(boxes[0]){var cibMetric=boxes[0].querySelector('.metric');if(cibMetric)cibMetric.textContent=peso(cib)}
    if(boxes[1]){var pettyMetric=boxes[1].querySelector('.metric');if(pettyMetric)pettyMetric.textContent=peso(petty)}
  }
  function draw(){
    var dashboard=document.getElementById('dashboard');if(!dashboard)return;
    var current=rows.filter(period),pending=current.filter(function(row){return row.status==='Pending remittance'}),remitted=current.filter(function(row){return row.status==='Remitted'}),pendingTotal=pending.reduce(function(sum,row){return sum+Number(row.amount||0)},0),remittedTotal=remitted.reduce(function(sum,row){return sum+Number(row.amount||0)},0),expenseCash=cashRows.filter(function(row){return cashPeriod(row)&&isExpenseCashOut(row)}),cibExpense=expenseCash.filter(function(row){return row.cash_account==='CIB'}).reduce(function(sum,row){return sum+Number(row.amount||0)},0),pettyExpense=expenseCash.filter(function(row){return row.cash_account==='Petty Cash'}).reduce(function(sum,row){return sum+Number(row.amount||0)},0),box=document.getElementById('cashRemittanceCard');
    updateLiveCashCards(dashboard);
    if(!box){box=document.createElement('div');box.id='cashRemittanceCard';box.className='card';box.style.marginTop='14px';var after=dashboard.querySelector('.split');if(after&&after.parentNode)after.parentNode.insertBefore(box,after.nextSibling);else dashboard.appendChild(box)}
    box.innerHTML='<div class="k">Cash remittance</div><h2>Cash received from clients</h2><p class="muted">CIB and Petty Cash expense totals below come from the same cash movements recorded in Expenses.</p><div class="grid"><div class="mini"><div class="muted">Waiting for owner remittance</div><div class="metric">'+peso(pendingTotal)+'</div><small>'+pending.length+' cash payment'+(pending.length===1?'':'s')+'</small></div><div class="mini"><div class="muted">Already remitted</div><div class="metric">'+peso(remittedTotal)+'</div><small>'+remitted.length+' payment'+(remitted.length===1?'':'s')+'</small></div><div class="mini"><div class="muted">CIB used for expenses</div><div class="metric">'+peso(cibExpense)+'</div><small>From Expenses in this period</small></div><div class="mini"><div class="muted">Petty Cash used for expenses</div><div class="metric">'+peso(pettyExpense)+'</div><small>From Expenses in this period</small></div></div>'+(current.length?'<div style="overflow:auto;margin-top:14px"><table><thead><tr><th>Received</th><th>Invoice / client</th><th>Received by</th><th>Cash amount</th><th>Status</th><th>Action</th></tr></thead><tbody>'+current.map(function(row){var invoice=row.invoices||{},pending=row.status==='Pending remittance';return '<tr><td>'+esc(row.received_date)+'</td><td><b>INV-'+String(invoice.invoice_number||'').padStart(5,'0')+'</b><br><small>'+esc(invoice.client_name||'Client')+'</small></td><td>'+esc(row.received_by||'—')+'</td><td><b>'+peso(row.amount)+'</b></td><td><span class="badge">'+esc(row.status)+'</span></td><td>'+ (pending?'<button class="primary" data-cash-remit="'+row.id+'">Mark remitted</button>':'<small>'+esc(row.remitted_at?new Date(row.remitted_at).toLocaleString():'Recorded')+'</small>')+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty" style="margin-top:14px">No cash payments were received in this selected period.</div>')
  }
  async function remit(id){var row=rows.find(function(item){return item.id===id});if(!row||!confirm('Mark '+peso(row.amount)+' as remitted to the business owner?'))return;var result=await db.from('cash_collections').update({status:'Remitted',remitted_at:new Date().toISOString(),remitted_by:userId}).eq('id',id).eq('business_id',businessId);if(result.error){alert('The remittance could not be updated. '+result.error.message);return}await load();alert('Cash remittance recorded. The dashboard has been updated.')}
  async function start(){
    if(!window.supabase||!config.url||!config.publishableKey){setTimeout(start,300);return}
    db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);
    var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;if(!user)return;
    userId=user.id;businessId=localStorage.getItem('bwc-active-business')||'';await load();
    ['bwc:invoices-loaded','bwc:expenses-loaded','bwc:cash-updated','bwc:branch-ready'].forEach(function(name){document.addEventListener(name,function(){setTimeout(load,120)})});
    document.addEventListener('click',function(event){var button=event.target.closest('[data-cash-remit]');if(button){event.preventDefault();remit(button.dataset.cashRemit);return}if(event.target.closest('[data-t="dashboard"]'))setTimeout(draw,100)});
    document.addEventListener('change',function(event){if(['dm','dy'].includes(event.target.id))draw()})
  }
  setTimeout(start,900);
})();
