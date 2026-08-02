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
  function localJob(row,payments){return {id:row.id,workerId:row.worker_id,number:row.job_order_number,vehicle:row.vehicle,plate:row.plate_number||'',work:row.service_work||'',amount:Number(row.contract_amount||0),retention:Number(row.retention_percent||0),status:row.status||'In Progress',payments:(payments||[]).map(function(payment){return {id:payment.id,date:payment.payment_date,amount:Number(payment.amount||0),notes:payment.notes||''}}),online:true}}
  function jobStatus(text,kind){var form=document.getElementById('prJobWorker');if(!form)return;var note=document.getElementById('prOnlineJobStatus');if(!note){note=document.createElement('div');note.id='prOnlineJobStatus';note.className='notice';note.style.marginTop='12px';form.closest('.formgrid').insertAdjacentElement('afterend',note)}note.textContent=text;note.style.borderLeftColor=kind==='error'?'#b63d25':''}
  async function syncJobs(){
    if(!online||!businessId())return;
    try{
      var jobsResult=await db.from('payroll_vehicle_jobs').select('id,worker_id,job_order_number,vehicle,plate_number,service_work,contract_amount,retention_percent,status').eq('business_id',businessId()).order('created_at',{ascending:false});
      if(jobsResult.error)throw jobsResult.error;
      var paymentsResult=await db.from('payroll_job_payments').select('id,job_id,payment_date,amount,notes').eq('business_id',businessId()).order('payment_date');
      if(paymentsResult.error)throw paymentsResult.error;
      var grouped={};(paymentsResult.data||[]).forEach(function(payment){(grouped[payment.job_id]=grouped[payment.job_id]||[]).push(payment)});
      var data=read(),saved=data.jobs||[],remote=(jobsResult.data||[]).map(function(row){return localJob(row,grouped[row.id])}),byNumber={};
      remote.forEach(function(job){byNumber[String(job.number||'').toLowerCase()]=job});saved.forEach(function(job){var number=String(job.number||'').toLowerCase();if(number&&!byNumber[number])remote.push(job)});
      data.jobs=remote;write(data);jobStatus('Vehicle jobs and payment balances are saved securely online.','info');
    }catch(error){jobStatus('Online vehicle jobs could not load: '+error.message,'error')}
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
  async function saveJob(button){
    var data=read(),workerId=value('prJobWorker'),worker=(data.workers||[]).find(function(item){return item.id===workerId}),number=value('prJobNumber'),vehicle=value('prJobVehicle'),plate=value('prJobPlate'),work=value('prJobWork'),amount=Math.max(0,Number(value('prJobAmount'))||0),retention=Math.min(100,Math.max(0,Number(value('prJobRetention'))||0));
    if(!workerId||!worker||!number||!vehicle){alert('Worker, job order number, and vehicle are required.');return}
    if(!worker.online){alert('This worker is not online yet. Save the worker online before creating a vehicle job.');return}
    var user=await getUser();if(!user){alert('Please sign in again before saving a vehicle job.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Saving job…';
    try{
      var result=await db.from('payroll_vehicle_jobs').insert({business_id:businessId(),worker_id:workerId,job_order_number:number,vehicle:vehicle,plate_number:plate||null,service_work:work||null,contract_amount:amount,retention_percent:retention,status:'In Progress',created_by:user.id}).select().single();if(result.error)throw result.error;
      var saved=localJob(result.data,[]),index=(data.jobs||[]).findIndex(function(job){return job.id===saved.id||String(job.number||'').toLowerCase()===String(saved.number).toLowerCase()});data.jobs=data.jobs||[];if(index>=0)data.jobs[index]=saved;else data.jobs.unshift(saved);write(data);var tab=document.querySelector('[data-pr-tab="jobs"]');if(tab)tab.click();alert('Vehicle job saved online. Retention is held first and payments will reduce only the remaining payable balance.');
    }catch(error){alert('The vehicle job could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function recordJobPayment(button){
    var data=read(),job=(data.jobs||[]).find(function(item){return item.id===button.dataset.id});if(!job||!job.online){alert('This job is not online yet. Save it online before recording a payment.');return}
    var retention=Number(job.amount||0)*Number(job.retention||0)/100,paid=(job.payments||[]).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0),remaining=Math.max(0,Number(job.amount||0)-retention-paid),amount=Number(prompt('Payment amount (PHP). Remaining payable: '+remaining.toFixed(2),'0')||0);if(!amount||amount<=0)return;if(amount>remaining){alert('Payment cannot be more than the remaining payable balance.');return}var date=prompt('Payment date (YYYY-MM-DD):',new Date().toISOString().slice(0,10));if(!date)return;
    var user=await getUser();if(!user){alert('Please sign in again before recording a payment.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Saving payment…';
    try{
      var result=await db.from('payroll_job_payments').insert({business_id:businessId(),job_id:job.id,payment_date:date,amount:amount,created_by:user.id}).select().single();if(result.error)throw result.error;
      job.payments=job.payments||[];job.payments.push({id:result.data.id,date:result.data.payment_date,amount:Number(result.data.amount||0),notes:''});write(data);var tab=document.querySelector('[data-pr-tab="jobs"]');if(tab)tab.click();alert('Vehicle-job payment saved online. The remaining payable balance has been updated.');
    }catch(error){alert('The payment could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function editJob(button){
    var data=read(),job=(data.jobs||[]).find(function(item){return item.id===button.dataset.id});if(!job||!job.online){alert('This job is not online yet. Save it online before editing it.');return}
    var number=prompt('Job order number:',job.number||'');if(number===null||!number.trim())return;var vehicle=prompt('Vehicle:',job.vehicle||'');if(vehicle===null||!vehicle.trim())return;var plate=prompt('Plate number:',job.plate||'');if(plate===null)return;var work=prompt('Service / work:',job.work||'');if(work===null)return;var amount=Number(prompt('Contract amount (PHP):',job.amount)||0),retention=Number(prompt('Retention percentage:',job.retention)||0);if(amount<0||retention<0||retention>100){alert('Enter a valid contract amount and retention percentage.');return}var paid=(job.payments||[]).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0);if(amount*(1-retention/100)<paid){alert('The contract amount after retention cannot be less than the amount already paid to the worker.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Saving changes…';
    try{
      var result=await db.from('payroll_vehicle_jobs').update({job_order_number:number.trim(),vehicle:vehicle.trim(),plate_number:plate.trim()||null,service_work:work.trim()||null,contract_amount:amount,retention_percent:retention}).eq('id',job.id).eq('business_id',businessId()).select().single();if(result.error)throw result.error;
      var saved=localJob(result.data,job.payments);Object.assign(job,saved);write(data);var tab=document.querySelector('[data-pr-tab="jobs"]');if(tab)tab.click();alert('Vehicle job changes were saved online.');
    }catch(error){alert('The vehicle job could not be updated online. '+error.message);button.disabled=false;button.textContent=original}
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
    var button=event.target.closest('[data-pr="add-worker"], [data-worker-edit-save="1"], [data-pr="save-attendance"], [data-pr="add-job"], [data-pr-payment="job"], [data-pr-edit="job"], [data-pr-approve-ot]');if(!button||!online)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!businessId()){alert('Choose an active business before saving workers.');return}
    if(button.dataset.prApproveOt)approveOvertime(button);else if(button.dataset.prEdit==='job')editJob(button);else if(button.dataset.prPayment==='job')recordJobPayment(button);else if(button.dataset.pr==='add-job')saveJob(button);else if(button.dataset.pr==='save-attendance')saveAttendance(button);else saveWorker(event,button);
  },true);
  window.addEventListener('load',function(){setTimeout(function(){syncWorkers();syncAttendance();syncJobs()},120)});
  document.addEventListener('click',function(event){if(event.target.closest('[data-pr-tab="workers"]'))setTimeout(function(){syncWorkers();showStatus('Workers are saved securely online for this business.','info')},100);if(event.target.closest('[data-pr-tab="attendance"]'))setTimeout(syncAttendance,100);if(event.target.closest('[data-pr-tab="jobs"]'))setTimeout(syncJobs,100)});
})();
