/* Permanent customer workspace deletion for the platform administrator only. */
(function(){
  var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};
  var db=config.url&&config.publishableKey&&window.supabase?window.supabase.createClient(config.url,config.publishableKey):null;
  function addDeleteButtons(){
    document.querySelectorAll('#businessTable tr').forEach(function(row){
      var action=row.querySelector('[data-set]');
      if(!action||row.querySelector('[data-delete-subscriber]'))return;
      var cells=row.querySelectorAll('td'),businessId=action.dataset.id;
      if(!businessId||!cells.length)return;
      var ownerCell=cells[2],email='';
      if(ownerCell){var small=ownerCell.querySelector('small');email=small?small.textContent.trim():''}
      var button=document.createElement('button');
      button.type='button';button.className='danger';button.textContent='Delete';
      button.dataset.deleteSubscriber=businessId;
      button.dataset.businessName=cells[0].querySelector('b')?cells[0].querySelector('b').textContent.trim():'this subscriber';
      button.dataset.ownerEmail=email;
      action.closest('.actions').appendChild(button);
    });
  }
  async function remove(button){
    if(!db){alert('Supabase is not configured.');return}
    var name=button.dataset.businessName||'this subscriber',email=button.dataset.ownerEmail||'',label=name+(email?' ('+email+')':'');
    if(!confirm('Permanently delete '+label+'? This removes its workspace, branches, invoices, expenses, payroll, and other records.'))return;
    if(!confirm('FINAL CONFIRMATION: Delete '+label+' forever? This cannot be undone.'))return;
    button.disabled=true;button.textContent='Deleting...';
    var result=await db.rpc('delete_subscriber_business',{p_business_id:button.dataset.deleteSubscriber});
    if(result.error){button.disabled=false;button.textContent='Delete';alert('Could not delete this subscriber: '+result.error.message);return}
    var details=result.data||{};
    alert('Subscriber deleted. '+(details.account_deleted?'The owner email can no longer sign in.':'The workspace was deleted. The owner email remains because it is also used by another workspace.'));
    var refresh=document.getElementById('refresh');if(refresh)refresh.click();
  }
  document.addEventListener('click',function(event){var button=event.target.closest('[data-delete-subscriber]');if(button)remove(button)});
  new MutationObserver(addDeleteButtons).observe(document.getElementById('businessTable'),{childList:true,subtree:true});
  addDeleteButtons();
})();
