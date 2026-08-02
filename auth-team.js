/* Lets an invited person create an account without creating a second business. */
(function(){
  var timer=setInterval(function(){
    var form=document.getElementById('signup'),business=document.getElementById('businessName');
    if(!form||!business||!window.supabase)return;
    clearInterval(timer);
    var label=business.closest('label'),choice=document.createElement('label');
    choice.style.cssText='display:flex;grid-template-columns:none;align-items:center;gap:9px;padding:3px 0;color:#eee;font-size:13px;cursor:pointer';
    choice.innerHTML='<input id="joiningTeam" type="checkbox" style="width:16px;height:16px;accent-color:#ff5a19"> Joining an existing team (I received an invitation)';
    label.parentNode.insertBefore(choice,label);
    function change(){var joining=choice.querySelector('input').checked;label.style.display=joining?'none':'';business.required=!joining;if(joining)business.value=''}
    choice.querySelector('input').onchange=change;
    form.onsubmit=async function(e){
      e.preventDefault();
      var c=window.BUSINESS_WEB_CENTER_SUPABASE||{},db=window.supabase.createClient(c.url,c.publishableKey),join=choice.querySelector('input').checked,btn=e.submitter,name=(firstName.value.trim()+' '+lastName.value.trim()).trim(),message=document.getElementById('message');
      function say(t,k){message.textContent=t;message.className='message show '+(k||'info')}
      btn.disabled=true;btn.textContent='Submitting…';
      var result=await db.auth.signUp({email:signEmail.value.trim(),password:signPassword.value,options:{data:{full_name:name,business_name:join?'':business.value.trim(),mobile_number:mobile.value.trim(),joining_existing_team:join}}});
      btn.disabled=false;btn.textContent='Submit account request';
      if(result.error)return say(result.error.message,'error');
      form.reset();change();document.getElementById('inTab').click();
      say(join?'Account created. Verify your email, then sign in to join the shared business.':'Account request submitted. Check your email for verification, then wait for administrator approval.','info');
    };
  },120);
})();
