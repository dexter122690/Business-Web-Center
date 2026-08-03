/* Delete controls for manual CIB and Petty Cash cash-ins only. */
(function(){
  var db,businessId='';
  function branch(){return localStorage.getItem('bwc-active-branch')||''}
  async function setup(){
    var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};
    if(!window.supabase||!config.url||!config.publishableKey){setTimeout(setup,300);return}
    db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);
    var session=await db.auth.getSession(),user=session.data&&session.data.session&&session.data.session.user;
    if(!user)return;
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
  document.addEventListener('click',async function(event){
    var button=event.target.closest('[data-cash-delete]');if(!button||!db)return;
    event.preventDefault();if(!confirm('Delete this manual cash-in? The selected cash balance will update.'))return;
    var result=await db.from('cash_transactions').delete().eq('id',button.dataset.cashDelete).eq('business_id',businessId).eq('branch_id',branch()).eq('direction','In').is('source_key',null);
    if(result.error){alert('Cash-in record could not be deleted: '+result.error.message);return}
    alert('Cash-in record deleted and balance updated.');
    document.dispatchEvent(new CustomEvent('bwc:cash-updated'));
  },true);
  new MutationObserver(function(){setTimeout(decorate,40)}).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('bwc:branch-ready',function(){setTimeout(decorate,100)});
  setTimeout(setup,1000);
})();
