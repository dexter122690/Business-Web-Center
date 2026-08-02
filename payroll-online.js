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
  function minutes(time){var bits=String(time||'').split(':');return Number(bits[0]||0)*60+Number(bits[1]||0)}
  function overlap(start,end,from,to){return Math.max(0,Math.min(end,to)-Math.max(start,from))}
  function attendanceCalculation(worker,timeIn,timeOut,multiplier){var start=minutes(timeIn),end=minutes(timeOut),hourly=Number(worker.rate||0)/8;if(end<=start)return {regularHours:0,overtimeHours:0,regularPay:0,overtimePay:0};var regularMinutes=overlap(start,end,480,720)+overlap(start,end,780,1020),overtimeMinutes=Math.max(0,end-Math.max(1050,start)),regularHours=regularMinutes/60,overtimeHours=overtimeMinutes/60;return {regularHours:regularHours,overtimeHours:overtimeHours,regularPay:regularHours*hourly,overtimePay:overtimeHours*hourly*Number(multiplier||1)}}
  function localAttendance(row){return {id:row.id,workerId:row.worker_id,date:row.work_date,timeIn:row.time_in||'',timeOut:row.time_out||'',multiplier:1.25,regularHours:Number(row.regular_hours||0),overtimeHours:Number(row.overtime_hours||0),regularPay:Number(row.regular_pay||0),overtimePay:Number(row.overtime_pay||0),overtimeApproved:!!row.overtime_approved,photo:'',online:true}}
  function attendanceStatus(text,kind){var form=document.getElementById('prAttendanceEmployeeId');if(!form)return;var note=document.getElementById('prOnlineAttendanceStatus');if(!note){note=document.createElement('div');note.id='prOnlineAttendanceStatus';note.className='notice';note.style.marginTop='12px';form.closest('.formgrid').insertAdjacentElement('afterend',note)}note.textContent=text;note.style.borderLeftColor=kind==='error'?'#b63d25':''}
  async function syncAttendance(){
    if(!online||!businessId())return;
    try{
      var result=await db.from('payroll_attendance').select('id,worker_id,work_date,time_in,time_out,regular_hours,overtime_hours,regular_pay,overtime_pay,overtime_approved').eq('business_id',businessId()).order('work_date',{ascending:false});
      if(result.error)throw result.error;
      var data=read(),saved=data.attendance||[],remote=(result.data||[]).map(localAttendance),byKey={};
      remote.forEach(function(item){byKey[item.workerId+'|'+item.date]=item});
      saved.forEach(function(item){var key=item.workerId+'|'+item.date;if(!byKey[key])remote.push(item)});
      data.attendance=remote;write(data);attendanceStatus('Attendance records are saved securely online. Camera photos stay on this device for now.','info');
    }catch(error){attendanceStatus('Online attendance could not load: '+error.message,'error')}
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
  async function saveAttendance(button){
    var code=value('prAttendanceEmployeeId').toLowerCase(),data=read(),worker=(data.workers||[]).find(function(item){return String(item.code||'').trim().toLowerCase()===code}),workDate=value('prAttendanceDate'),timeIn=value('prAttendanceIn'),timeOut=value('prAttendanceOut'),multiplier=Math.max(1,Number(value('prAttendanceMultiplier'))||1);
    if(!code){alert('Enter the employee ID before recording attendance.');return}
    if(!worker){alert('Employee ID not found. Add or refresh the worker first.');return}
    if(!worker.online||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(worker.id)){alert('This worker is still stored only on this device. Open Workers and save the worker online first.');return}
    var user=await getUser();if(!user){alert('Please sign in again before saving attendance.');return}
    var calc=attendanceCalculation(worker,timeIn,timeOut,multiplier),payload={business_id:businessId(),worker_id:worker.id,work_date:workDate,time_in:timeIn||null,time_out:timeOut||null,regular_hours:calc.regularHours,overtime_hours:calc.overtimeHours,regular_pay:calc.regularPay,overtime_pay:calc.overtimePay,overtime_approved:false,recorded_by:user.id};
    button.disabled=true;var original=button.textContent;button.textContent='Saving attendance…';
    try{
      var result=await db.from('payroll_attendance').upsert(payload,{onConflict:'worker_id,work_date'}).select().single();if(result.error)throw result.error;
      var entry=localAttendance(result.data),index=(data.attendance||[]).findIndex(function(item){return item.workerId===entry.workerId&&item.date===entry.date});data.attendance=data.attendance||[];if(index>=0){entry.overtimeApproved=data.attendance[index].overtimeApproved&&Number(data.attendance[index].overtimePay)===Number(entry.overtimePay);data.attendance[index]=entry}else data.attendance.push(entry);data.weekStart=value('prAttendanceStart')||data.weekStart;data.weekEnd=value('prAttendanceEnd')||data.weekEnd;write(data);
      var tab=document.querySelector('[data-pr-tab="attendance"]');if(tab)tab.click();alert('Attendance saved securely online. Overtime still needs approval before it is included in payroll.');
    }catch(error){alert('The attendance record could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function approveOvertime(button){
    var recordId=button.dataset.prApproveOt,data=read(),entry=(data.attendance||[]).find(function(item){return item.id===recordId});
    if(!entry||!entry.online){alert('This attendance record is not online yet. Save the time record again first.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Approving…';
    try{
      var result=await db.from('payroll_attendance').update({overtime_approved:true}).eq('id',recordId).eq('business_id',businessId()).select().single();if(result.error)throw result.error;
      entry.overtimeApproved=!!result.data.overtime_approved;write(data);var tab=document.querySelector('[data-pr-tab="attendance"]');if(tab)tab.click();alert('Overtime approved and saved online for payroll calculation.');
    }catch(error){alert('The overtime approval could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  window.addEventListener('click',function(event){
    var button=event.target.closest('[data-pr="add-worker"], [data-worker-edit-save="1"], [data-pr="save-attendance"], [data-pr-approve-ot]');if(!button||!online)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!businessId()){alert('Choose an active business before saving workers.');return}
    if(button.dataset.prApproveOt)approveOvertime(button);else if(button.dataset.pr==='save-attendance')saveAttendance(button);else saveWorker(event,button);
  },true);
  window.addEventListener('load',function(){setTimeout(function(){syncWorkers();syncAttendance()},120)});
  document.addEventListener('click',function(event){if(event.target.closest('[data-pr-tab="workers"]'))setTimeout(function(){syncWorkers();showStatus('Workers are saved securely online for this business.','info')},100);if(event.target.closest('[data-pr-tab="attendance"]'))setTimeout(syncAttendance,100)});
})();
