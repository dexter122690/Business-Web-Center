/* Keep a staff display name accurate without changing their sign-in email,
   permissions, role, or assigned branches. */
(function(){
  function db(){var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};return window.businessSupabase||(window.supabase&&config.url&&config.publishableKey?window.supabase.createClient(config.url,config.publishableKey):null)}
  function refresh(){var modal=document.getElementById('teamAccessModal');if(modal)modal.remove();setTimeout(function(){var button=document.getElementById('teamAccessMenuButton');if(button)button.click()},180)}
  function addNameButtons(){
    document.querySelectorAll('[data-team-edit]').forEach(function(edit){
      if(edit.parentNode.querySelector('[data-team-rename="'+edit.dataset.teamEdit+'"]'))return;
      var button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Change name';button.dataset.teamRename=edit.dataset.teamEdit;
      edit.parentNode.insertBefore(button,edit);
    });
  }
  document.addEventListener('click',async function(event){
    var button=event.target.closest('[data-team-rename]');if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    var client=db(),businessId=localStorage.getItem('bwc-active-business')||'';
    if(!client||!businessId){alert('Team Access is still loading. Please try again in a moment.');return}
    var invite=await client.from('business_team_invites').select('email,full_name').eq('id',button.dataset.teamRename).eq('business_id',businessId).maybeSingle();
    if(invite.error||!invite.data){alert('This team member could not be found. Refresh and try again.');return}
    var name=prompt('Team member name:',invite.data.full_name||'');
    if(name===null)return;name=name.trim();
    if(!name){alert('Enter a name to save.');return}
    button.disabled=true;button.textContent='Saving...';
    var updated=await client.from('business_team_invites').update({full_name:name}).eq('business_id',businessId).eq('email',invite.data.email);
    if(updated.error){button.disabled=false;button.textContent='Change name';alert('The name could not be updated. '+updated.error.message);return}
    alert('Team member name updated. Their email, role, permissions, and branch access were not changed.');refresh();
  },true);
  new MutationObserver(addNameButtons).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('load',addNameButtons);addNameButtons();
})();
