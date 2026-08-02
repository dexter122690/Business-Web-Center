/* Blocks workspace access after the administrator-approved access period ends. */
(function(){
  var checked=false;
  async function check(){
    if(checked||!window.businessSupabase)return;
    var businessId=localStorage.getItem('bwc-active-business');
    if(!businessId)return;
    checked=true;
    var db=window.businessSupabase;
    var result=await db.from('business_management').select('access_ends_at').eq('business_id',businessId).maybeSingle();
    if(result.error){checked=false;return}
    var ends=result.data&&result.data.access_ends_at;
    if(ends&&new Date(ends).getTime()<=Date.now()){
      await db.auth.signOut();
      localStorage.removeItem('bwc-active-business');
      localStorage.removeItem('bwc-active-business-name');
      location.replace('auth.html?access=on-hold');
    }
  }
  document.addEventListener('bwc:business-ready',check);
  var tries=0,timer=setInterval(function(){check();if(++tries>25)clearInterval(timer)},200);
})();
