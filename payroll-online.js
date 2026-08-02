/* Online worker masterlist. Payroll Step 2: secure workers per business. */
(function(){
  var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};
  var online=!!(window.supabase&&config.url&&config.publishableKey&&config.url.indexOf('YOUR_')<0&&config.publishableKey.indexOf('YOUR_')<0);
  var db=online?window.supabase.createClient(config.url,config.publishableKey):null;
  var payrollKey='15m-recovery-payroll',syncing=false;
  function businessId(){return localStorage.getItem('bwc-active-business')||''}
  function read(){try{var data=JSON.parse(localStorage.getItem(payrollKey)||'{}');return data&&typeof data==='object'?data:{}}catch(e){return {}}}
  function write(data){localStorage.setItem(payrollKey,JSON.stringify(data))}
  function value(id){var input=document.getElementById(id);return input?input.value.trim():''}
  function localWorker(row){return {id:row.id,code:row.employee_code,name:row.full_name,position:row.position||'',type:row.pay_type==='per_vehicle'?'Per Vehicle':'Daily Rate',rate:Number(row.daily_rate||0),retention:Number(row.retention_percent||0),online:true}}
  function showStatus(text,kind){var section=document.getElementById('payroll');if(!section)return;var form=document.getElementById('prWorkerCode');if(!form)return;var note=document.getElementById('prOnlineWorkerStatus');if(!note){note=document.createElement('div');note.id='prOnlineWorkerStatus';note.className='notice';note.style.marginTop='12px';form.closest('.formgrid').insertAdjacentElement('afterend',note)}note.textContent=text;note.style.borderLeftColor=kind==='error'?'#b63d25':''}
  async function getUser(){var result=await db.auth.getUser();return result.data&&result.data.user}
  async function syncWorkers(){
    if(!online||!businessId()||syncing)return;
    syncing=true;
    try{
      var result=await db.from('payroll_workers').select('id,employee_code,full_name,position,pay_type,daily_rate,retention_percent,is_active').eq('business_id',businessId()).order('full_name');
      if(result.error)throw result.error;
      var data=read(),saved=(data.workers||[]),remote=(result.data||[]).map(localWorker),byCode={};
      remote.forEach(function(worker){byCode[String(worker.code||'').toLowerCase()]=worker});
      saved.forEach(function(worker){var code=String(worker.code||'').toLowerCase();if(code&&!byCode[code])remote.push(worker)});
      data.workers=remote;write(data);
      showStatus('Workers are saved securely online for this business.','info');
    }catch(error){showStatus('Online worker list could not load: '+error.message,'error')}finally{syncing=false}
  }
  async function saveWorker(event,button){
    var code=value('prWorkerCode'),name=value('prWorkerName'),position=value('prWorkerPosition'),type=value('prWorkerType'),rate=Math.max(0,Number(value('prWorkerRate'))||0),retention=Math.min(100,Math.max(0,Number(value('prWorkerRetention'))||0));
    if(!code||!name){alert('Employee ID and complete name are required.');return}
    var user=await getUser();if(!user){alert('Please sign in again before saving a worker.');return}
    var editingId=localStorage.getItem('15m-worker-editor')||'';
    button.disabled=true;var original=button.textContent;button.textContent=editingId?'Saving securely…':'Saving worker…';
    try{
      var payload={employee_code:code,full_name:name,position:position||null,pay_type:type==='Per Vehicle'?'per_vehicle':'daily_rate',daily_rate:rate,retention_percent:retention};
      var result;
      if(editingId&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(editingId)){
        result=await db.from('payroll_workers').update(payload).eq('id',editingId).eq('business_id',businessId()).select().single();
      }else{
        payload.business_id=businessId();payload.created_by=user.id;
        result=await db.from('payroll_workers').insert(payload).select().single();
      }
      if(result.error)throw result.error;
      var data=read();data.workers=data.workers||[];var saved=localWorker(result.data),index=data.workers.findIndex(function(worker){return worker.id===saved.id||String(worker.code||'').toLowerCase()===String(saved.code).toLowerCase()});
      if(index>=0)data.workers[index]=saved;else data.workers.unshift(saved);write(data);localStorage.removeItem('15m-worker-editor');
      var tab=document.querySelector('[data-pr-tab="workers"]');if(tab)tab.click();
      alert(editingId?'Worker details saved securely online.':'Worker added securely to this business.');
    }catch(error){alert('The worker could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  window.addEventListener('click',function(event){
    var button=event.target.closest('[data-pr="add-worker"], [data-worker-edit-save="1"]');if(!button||!online)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!businessId()){alert('Choose an active business before saving workers.');return}
    saveWorker(event,button);
  },true);
  window.addEventListener('load',function(){setTimeout(syncWorkers,120)});
  document.addEventListener('click',function(event){if(event.target.closest('[data-pr-tab="workers"]'))setTimeout(function(){syncWorkers();showStatus('Workers are saved securely online for this business.','info')},100)});
})();
