/* Online worker masterlist. Payroll Step 2: secure workers per business. */
(function(){
  var config=window.BUSINESS_WEB_CENTER_SUPABASE||{};
  var online=false,db=null;
  function connect(){
    config=window.BUSINESS_WEB_CENTER_SUPABASE||{};
    if(!window.supabase||!config.url||!config.publishableKey||config.url.indexOf('YOUR_')>=0||config.publishableKey.indexOf('YOUR_')>=0)return false;
    db=window.businessSupabase||window.supabase.createClient(config.url,config.publishableKey);
    online=true;
    return true;
  }
  var payrollKey='15m-recovery-payroll',syncing=false;
  function businessId(){return localStorage.getItem('bwc-active-business')||''}
  function branchId(){return localStorage.getItem('bwc-active-branch')||''}
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
      var result=await db.from('payroll_workers').select('id,employee_code,full_name,position,pay_type,daily_rate,retention_percent,is_active').eq('business_id',businessId()).eq('branch_id',branchId()).order('full_name');
      if(result.error)throw result.error;
      var data=read(),saved=(data.workers||[]),remote=(result.data||[]).map(localWorker),byCode={};
      remote.forEach(function(worker){byCode[String(worker.code||'').toLowerCase()]=worker});
      saved.forEach(function(worker){var code=String(worker.code||'').toLowerCase();if(!worker.online&&code&&!byCode[code])remote.push(worker)});
      data.workers=remote;write(data);
      showStatus('Workers are saved securely online for this business.','info');
    }catch(error){showStatus('Online worker list could not load: '+error.message,'error')}finally{syncing=false}
  }
  function minutes(time){var bits=String(time||'').split(':');return Number(bits[0]||0)*60+Number(bits[1]||0)}
  function overlap(start,end,from,to){return Math.max(0,Math.min(end,to)-Math.max(start,from))}
  function attendanceCalculation(worker,timeIn,timeOut,multiplier){var start=minutes(timeIn),end=minutes(timeOut),hourly=Number(worker.rate||0)/8;if(end<=start)return {regularHours:0,overtimeHours:0,regularPay:0,overtimePay:0};var regularMinutes=overlap(start,end,480,720)+overlap(start,end,780,1020),overtimeMinutes=Math.max(0,end-Math.max(1050,start)),regularHours=regularMinutes/60,overtimeHours=overtimeMinutes/60;return {regularHours:regularHours,overtimeHours:overtimeHours,regularPay:regularHours*hourly,overtimePay:overtimeHours*hourly*Number(multiplier||1)}}
  function localAttendance(row){return {id:row.id,workerId:row.worker_id,date:row.work_date,timeIn:row.time_in||'',timeOut:row.time_out||'',multiplier:1.25,regularHours:Number(row.regular_hours||0),overtimeHours:Number(row.overtime_hours||0),regularPay:Number(row.regular_pay||0),overtimePay:Number(row.overtime_pay||0),attendanceApproved:row.attendance_approved!==false,overtimeApproved:!!row.overtime_approved,photo:'',online:true}}
  function attendanceStatus(text,kind){var form=document.getElementById('prAttendanceEmployeeId');if(!form)return;var note=document.getElementById('prOnlineAttendanceStatus');if(!note){note=document.createElement('div');note.id='prOnlineAttendanceStatus';note.className='notice';note.style.marginTop='12px';form.closest('.formgrid').insertAdjacentElement('afterend',note)}note.textContent=text;note.style.borderLeftColor=kind==='error'?'#b63d25':''}
  async function syncAttendance(){
    if(!online||!businessId())return;
    try{
      var result=await db.from('payroll_attendance').select('id,worker_id,work_date,time_in,time_out,regular_hours,overtime_hours,regular_pay,overtime_pay,attendance_approved,overtime_approved').eq('business_id',businessId()).eq('branch_id',branchId()).order('work_date',{ascending:false});
      if(result.error)throw result.error;
      var data=read(),saved=data.attendance||[],remote=(result.data||[]).map(localAttendance),byKey={};
      remote.forEach(function(item){byKey[item.workerId+'|'+item.date]=item});
      saved.forEach(function(item){var key=item.workerId+'|'+item.date;if(!item.online&&!byKey[key])remote.push(item)});
      data.attendance=remote;write(data);attendanceStatus('Attendance records are saved securely online. Camera photos stay on this device for now.','info');
    }catch(error){attendanceStatus('Online attendance could not load: '+error.message,'error')}
  }
  function localJob(row,payments){return {id:row.id,workerId:row.worker_id,number:row.job_order_number,vehicle:row.vehicle,plate:row.plate_number||'',work:row.service_work||'',amount:Number(row.contract_amount||0),retention:Number(row.retention_percent||0),status:row.status||'In Progress',payments:(payments||[]).map(function(payment){return {id:payment.id,date:payment.payment_date,amount:Number(payment.amount||0),notes:payment.notes||''}}),online:true}}
  function jobStatus(text,kind){var form=document.getElementById('prJobWorker');if(!form)return;var note=document.getElementById('prOnlineJobStatus');if(!note){note=document.createElement('div');note.id='prOnlineJobStatus';note.className='notice';note.style.marginTop='12px';form.closest('.formgrid').insertAdjacentElement('afterend',note)}note.textContent=text;note.style.borderLeftColor=kind==='error'?'#b63d25':''}
  async function syncJobs(){
    if(!online||!businessId())return;
    try{
      var jobsResult=await db.from('payroll_vehicle_jobs').select('id,worker_id,job_order_number,vehicle,plate_number,service_work,contract_amount,retention_percent,status').eq('business_id',businessId()).eq('branch_id',branchId()).order('created_at',{ascending:false});
      if(jobsResult.error)throw jobsResult.error;
      var paymentsResult=await db.from('payroll_job_payments').select('id,job_id,payment_date,amount,notes').eq('business_id',businessId()).eq('branch_id',branchId()).order('payment_date');
      if(paymentsResult.error)throw paymentsResult.error;
      var grouped={};(paymentsResult.data||[]).forEach(function(payment){(grouped[payment.job_id]=grouped[payment.job_id]||[]).push(payment)});
      var data=read(),saved=data.jobs||[],remote=(jobsResult.data||[]).map(function(row){return localJob(row,grouped[row.id])}),byNumber={};
      remote.forEach(function(job){byNumber[String(job.number||'').toLowerCase()]=job});saved.forEach(function(job){var number=String(job.number||'').toLowerCase();if(!job.online&&number&&!byNumber[number])remote.push(job)});
      data.jobs=remote;write(data);jobStatus('Vehicle jobs and payment balances are saved securely online.','info');
    }catch(error){jobStatus('Online vehicle jobs could not load: '+error.message,'error')}
  }
  function localObligation(row,payments){return {id:row.id,workerId:row.worker_id,reference:row.reference||'',amount:Number(row.original_amount||0),weekly:Number(row.planned_weekly_deduction||0),status:row.status||'Open',payments:(payments||[]).map(function(payment){return {id:payment.id,date:payment.payment_date,amount:Number(payment.amount||0),notes:payment.notes||''}}),online:true}}
  function obligationStatus(text,kind){var form=document.getElementById('prDebtWorker');if(!form)return;var note=document.getElementById('prOnlineObligationStatus');if(!note){note=document.createElement('div');note.id='prOnlineObligationStatus';note.className='notice';note.style.marginTop='12px';form.closest('.formgrid').insertAdjacentElement('afterend',note)}note.textContent=text;note.style.borderLeftColor=kind==='error'?'#b63d25':''}
  function obligationKey(item){return String(item.workerId||'')+'|'+String(item.reference||'').trim().toLowerCase()+'|'+Number(item.amount||0)}
  async function syncObligations(){
    if(!online||!businessId())return;
    try{
      var obligationsResult=await db.from('payroll_obligations').select('id,worker_id,obligation_type,reference,original_amount,planned_weekly_deduction,status').eq('business_id',businessId()).eq('branch_id',branchId()).order('created_at',{ascending:false});
      if(obligationsResult.error)throw obligationsResult.error;
      var paymentsResult=await db.from('payroll_obligation_payments').select('id,obligation_id,payment_date,amount,notes').eq('business_id',businessId()).eq('branch_id',branchId()).order('payment_date');
      if(paymentsResult.error)throw paymentsResult.error;
      var grouped={};(paymentsResult.data||[]).forEach(function(payment){(grouped[payment.obligation_id]=grouped[payment.obligation_id]||[]).push(payment)});
      var data=read(),remoteAdvances=[],remoteLoans=[];(obligationsResult.data||[]).forEach(function(row){var item=localObligation(row,grouped[row.id]);if(row.obligation_type==='cash_advance')remoteAdvances.push(item);else remoteLoans.push(item)});
      ['advances','loans'].forEach(function(kind){var remote=kind==='advances'?remoteAdvances:remoteLoans,keys={};remote.forEach(function(item){keys[obligationKey(item)]=true});(data[kind]||[]).forEach(function(item){if(!item.online&&!keys[obligationKey(item)])remote.push(item)});data[kind]=remote});
      write(data);obligationStatus('Cash advances and loans are saved securely online with their payment records.','info');
    }catch(error){obligationStatus('Online cash advances and loans could not load: '+error.message,'error')}
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
        result=await db.from('payroll_workers').update(payload).eq('id',editingId).eq('business_id',businessId()).eq('branch_id',branchId()).select().single();
      }else{
        payload.business_id=businessId();payload.branch_id=branchId();payload.created_by=user.id;
        result=await db.from('payroll_workers').insert(payload).select().single();
      }
      if(result.error)throw result.error;
      var data=read();data.workers=data.workers||[];var saved=localWorker(result.data),index=data.workers.findIndex(function(worker){return worker.id===saved.id||String(worker.code||'').toLowerCase()===String(saved.code).toLowerCase()});
      if(index>=0)data.workers[index]=saved;else data.workers.unshift(saved);write(data);localStorage.removeItem('15m-worker-editor');document.dispatchEvent(new Event('bwc:workers-updated'));
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
    var calc=attendanceCalculation(worker,timeIn,timeOut,multiplier),payload={business_id:businessId(),branch_id:branchId(),worker_id:worker.id,work_date:workDate,time_in:timeIn||null,time_out:timeOut||null,regular_hours:calc.regularHours,overtime_hours:calc.overtimeHours,regular_pay:calc.regularPay,overtime_pay:calc.overtimePay,attendance_approved:false,attendance_approved_by:null,attendance_approved_at:null,overtime_approved:false,recorded_by:user.id};
    button.disabled=true;var original=button.textContent;button.textContent='Saving attendance…';
    try{
      var result=await db.from('payroll_attendance').upsert(payload,{onConflict:'worker_id,work_date'}).select().single();if(result.error)throw result.error;
      var entry=localAttendance(result.data),index=(data.attendance||[]).findIndex(function(item){return item.workerId===entry.workerId&&item.date===entry.date});data.attendance=data.attendance||[];if(index>=0){entry.overtimeApproved=data.attendance[index].overtimeApproved&&Number(data.attendance[index].overtimePay)===Number(entry.overtimePay);data.attendance[index]=entry}else data.attendance.push(entry);data.weekStart=value('prAttendanceStart')||data.weekStart;data.weekEnd=value('prAttendanceEnd')||data.weekEnd;write(data);
      var tab=document.querySelector('[data-pr-tab="attendance"]');if(tab)tab.click();alert('Attendance saved securely online and is waiting for manager review. Overtime also needs approval before it is included in payroll.');
    }catch(error){alert('The attendance record could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function saveJob(button){
    var data=read(),workerId=value('prJobWorker'),worker=(data.workers||[]).find(function(item){return item.id===workerId}),number=value('prJobNumber'),vehicle=value('prJobVehicle'),plate=value('prJobPlate'),work=value('prJobWork'),amount=Math.max(0,Number(value('prJobAmount'))||0),retention=Math.min(100,Math.max(0,Number(value('prJobRetention'))||0));
    if(!workerId||!worker||!number||!vehicle){alert('Worker, job order number, and vehicle are required.');return}
    if(!worker.online){alert('This worker is not online yet. Save the worker online before creating a vehicle job.');return}
    var user=await getUser();if(!user){alert('Please sign in again before saving a vehicle job.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Saving job…';
    try{
      var result=await db.from('payroll_vehicle_jobs').insert({business_id:businessId(),branch_id:branchId(),worker_id:workerId,job_order_number:number,vehicle:vehicle,plate_number:plate||null,service_work:work||null,contract_amount:amount,retention_percent:retention,status:'In Progress',created_by:user.id}).select().single();if(result.error)throw result.error;
      var saved=localJob(result.data,[]),index=(data.jobs||[]).findIndex(function(job){return job.id===saved.id||String(job.number||'').toLowerCase()===String(saved.number).toLowerCase()});data.jobs=data.jobs||[];if(index>=0)data.jobs[index]=saved;else data.jobs.unshift(saved);write(data);var tab=document.querySelector('[data-pr-tab="jobs"]');if(tab)tab.click();alert('Vehicle job saved online. Retention is held first and payments will reduce only the remaining payable balance.');
    }catch(error){alert('The vehicle job could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function recordJobPayment(button){
    var data=read(),job=(data.jobs||[]).find(function(item){return item.id===button.dataset.id});if(!job||!job.online){alert('This job is not online yet. Save it online before recording a payment.');return}
    var retention=Number(job.amount||0)*Number(job.retention||0)/100,paid=(job.payments||[]).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0),remaining=Math.max(0,Number(job.amount||0)-retention-paid),amount=Number(prompt('Payment amount (PHP). Remaining payable: '+remaining.toFixed(2),'0')||0);if(!amount||amount<=0)return;if(amount>remaining){alert('Payment cannot be more than the remaining payable balance.');return}var date=prompt('Payment date (YYYY-MM-DD):',new Date().toISOString().slice(0,10));if(!date)return;
    var user=await getUser();if(!user){alert('Please sign in again before recording a payment.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Saving payment…';
    try{
      var result=await db.from('payroll_job_payments').insert({business_id:businessId(),branch_id:branchId(),job_id:job.id,payment_date:date,amount:amount,created_by:user.id}).select().single();if(result.error)throw result.error;
      job.payments=job.payments||[];job.payments.push({id:result.data.id,date:result.data.payment_date,amount:Number(result.data.amount||0),notes:''});write(data);var tab=document.querySelector('[data-pr-tab="jobs"]');if(tab)tab.click();alert('Vehicle-job payment saved online. The remaining payable balance has been updated.');
    }catch(error){alert('The payment could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function editJob(button){
    var data=read(),job=(data.jobs||[]).find(function(item){return item.id===button.dataset.id});if(!job||!job.online){alert('This job is not online yet. Save it online before editing it.');return}
    var number=prompt('Job order number:',job.number||'');if(number===null||!number.trim())return;var vehicle=prompt('Vehicle:',job.vehicle||'');if(vehicle===null||!vehicle.trim())return;var plate=prompt('Plate number:',job.plate||'');if(plate===null)return;var work=prompt('Service / work:',job.work||'');if(work===null)return;var amount=Number(prompt('Contract amount (PHP):',job.amount)||0),retention=Number(prompt('Retention percentage:',job.retention)||0);if(amount<0||retention<0||retention>100){alert('Enter a valid contract amount and retention percentage.');return}var paid=(job.payments||[]).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0);if(amount*(1-retention/100)<paid){alert('The contract amount after retention cannot be less than the amount already paid to the worker.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Saving changes…';
    try{
      var result=await db.from('payroll_vehicle_jobs').update({job_order_number:number.trim(),vehicle:vehicle.trim(),plate_number:plate.trim()||null,service_work:work.trim()||null,contract_amount:amount,retention_percent:retention}).eq('id',job.id).eq('business_id',businessId()).eq('branch_id',branchId()).select().single();if(result.error)throw result.error;
      var saved=localJob(result.data,job.payments);Object.assign(job,saved);write(data);var tab=document.querySelector('[data-pr-tab="jobs"]');if(tab)tab.click();alert('Vehicle job changes were saved online.');
    }catch(error){alert('The vehicle job could not be updated online. '+error.message);button.disabled=false;button.textContent=original}
  }
  function obligationList(data,kind){return kind==='advance'?data.advances:data.loans}
  function obligationType(kind){return kind==='advance'?'cash_advance':'loan'}
  function obligationTab(kind){return kind==='advance'?'advances':'loans'}
  async function saveObligation(button,kind){
    var data=read(),workerId=value('prDebtWorker'),worker=(data.workers||[]).find(function(item){return item.id===workerId}),reference=value('prDebtReference'),amount=Math.max(0,Number(value('prDebtAmount'))||0),weekly=Math.max(0,Number(value('prDebtWeekly'))||0);
    if(!workerId||!worker||amount<=0){alert('Worker and an amount greater than zero are required.');return}
    if(!worker.online){alert('This worker is not online yet. Save the worker online before adding a cash advance or loan.');return}
    var user=await getUser();if(!user){alert('Please sign in again before saving this record.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Saving securely...';
    try{
      var result=await db.from('payroll_obligations').insert({business_id:businessId(),branch_id:branchId(),worker_id:workerId,obligation_type:obligationType(kind),reference:reference||null,original_amount:amount,planned_weekly_deduction:weekly,status:'Open',created_by:user.id}).select().single();if(result.error)throw result.error;
      var saved=localObligation(result.data,[]),list=obligationList(data,kind),index=list.findIndex(function(item){return item.id===saved.id||(!item.online&&obligationKey(item)===obligationKey(saved))});if(index>=0)list[index]=saved;else list.unshift(saved);write(data);var tab=document.querySelector('[data-pr-tab="'+obligationTab(kind)+'"]');if(tab)tab.click();alert((kind==='advance'?'Cash advance':'Loan')+' saved securely online. Each payment will update the remaining balance.');
    }catch(error){alert('The record could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function recordObligationPayment(button,kind){
    var data=read(),item=obligationList(data,kind).find(function(record){return record.id===button.dataset.id});if(!item||!item.online){alert('This record is not online yet. Save it online before recording a payment.');return}
    var paid=(item.payments||[]).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0),remaining=Math.max(0,Number(item.amount||0)-paid),amount=Number(prompt('Payment amount (PHP). Remaining balance: '+remaining.toFixed(2),'0')||0);if(!amount||amount<=0)return;if(amount>remaining){alert('Payment cannot be more than the remaining balance.');return}var date=prompt('Payment date (YYYY-MM-DD):',new Date().toISOString().slice(0,10));if(!date)return;
    var user=await getUser();if(!user){alert('Please sign in again before recording a payment.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Saving payment...';
    try{
      var result=await db.from('payroll_obligation_payments').insert({business_id:businessId(),branch_id:branchId(),obligation_id:item.id,payment_date:date,amount:amount,created_by:user.id}).select().single();if(result.error)throw result.error;
      item.payments=item.payments||[];item.payments.push({id:result.data.id,date:result.data.payment_date,amount:Number(result.data.amount||0),notes:result.data.notes||''});if(Math.abs(remaining-amount)<0.005){var statusResult=await db.from('payroll_obligations').update({status:'Paid'}).eq('id',item.id).eq('business_id',businessId()).eq('branch_id',branchId()).select().single();if(statusResult.error)throw statusResult.error;item.status=statusResult.data.status}write(data);var tab=document.querySelector('[data-pr-tab="'+obligationTab(kind)+'"]');if(tab)tab.click();alert('Payment saved online. The outstanding balance has been updated.');
    }catch(error){alert('The payment could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function editObligation(button,kind){
    var data=read(),item=obligationList(data,kind).find(function(record){return record.id===button.dataset.id});if(!item||!item.online){alert('This record is not online yet. Save it online before editing it.');return}
    var reference=prompt('Reference:',item.reference||'');if(reference===null)return;var amount=Number(prompt('Original amount (PHP):',item.amount)||0),weekly=Number(prompt('Weekly deduction (PHP):',item.weekly)||0);if(amount<=0||weekly<0){alert('Enter a valid original amount and weekly deduction.');return}var paid=(item.payments||[]).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0);if(amount<paid){alert('The original amount cannot be less than the total payments already recorded.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Saving changes...';
    try{
      var result=await db.from('payroll_obligations').update({reference:reference.trim()||null,original_amount:amount,planned_weekly_deduction:weekly,status:amount===paid?'Paid':'Open'}).eq('id',item.id).eq('business_id',businessId()).eq('branch_id',branchId()).select().single();if(result.error)throw result.error;
      Object.assign(item,localObligation(result.data,item.payments));write(data);var tab=document.querySelector('[data-pr-tab="'+obligationTab(kind)+'"]');if(tab)tab.click();alert('Record changes were saved online.');
    }catch(error){alert('The record could not be updated online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function editObligationHistory(button,kind){
    var data=read(),item=obligationList(data,kind).find(function(record){return record.id===button.dataset.id});if(!item||!item.online){alert('This record is not online yet. Save it online before editing payment history.');return}var payments=item.payments||[];if(!payments.length){alert('No payment entries have been recorded yet.');return}
    var drafts=[],total=0;for(var i=0;i<payments.length;i++){var payment=payments[i],amount=Number(prompt('Payment '+(i+1)+' amount (PHP):',payment.amount)||0);if(amount<=0){alert('Each payment must be greater than zero.');return}var date=prompt('Payment '+(i+1)+' date (YYYY-MM-DD):',payment.date);if(!date)return;drafts.push({id:payment.id,amount:amount,date:date});total+=amount}if(total>Number(item.amount||0)){alert('Total payments cannot be more than the original amount.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Saving history...';
    try{
      for(var j=0;j<drafts.length;j++){var update=await db.from('payroll_obligation_payments').update({amount:drafts[j].amount,payment_date:drafts[j].date}).eq('id',drafts[j].id).eq('business_id',businessId()).eq('branch_id',branchId());if(update.error)throw update.error}
      item.payments=drafts.map(function(payment){return {id:payment.id,amount:payment.amount,date:payment.date,notes:''}});var state=total>=Number(item.amount||0)?'Paid':'Open';var stateUpdate=await db.from('payroll_obligations').update({status:state}).eq('id',item.id).eq('business_id',businessId()).eq('branch_id',branchId());if(stateUpdate.error)throw stateUpdate.error;item.status=state;write(data);var tab=document.querySelector('[data-pr-tab="'+obligationTab(kind)+'"]');if(tab)tab.click();alert('Payment history was saved online.');
    }catch(error){alert('The payment history could not be updated online. '+error.message);button.disabled=false;button.textContent=original}
  }
  function dateToday(){return new Date().toISOString().slice(0,10)}
  function inPayrollRange(date,start,end){return String(date||'')>=String(start||'')&&String(date||'')<=String(end||'')}
  function onlinePayrollStatus(text,kind){var root=document.getElementById('payroll');if(!root)return;var note=document.getElementById('prOnlinePayrollStatus');if(!note){note=document.createElement('div');note.id='prOnlinePayrollStatus';note.className='notice';note.style.marginTop='12px';var content=document.getElementById('prContent');if(content)content.insertAdjacentElement('afterbegin',note)}note.textContent=text;note.style.borderLeftColor=kind==='error'?'#b63d25':''}
  function payrollDates(data){return {start:value('prWeekStart')||data.weekStart||dateToday(),end:value('prWeekEnd')||data.weekEnd||dateToday()}}
  function localAdjustment(row){return {id:row.id,workerId:row.worker_id,date:row.adjustment_date,type:row.adjustment_type,amount:Number(row.amount||0),reason:row.reason||'',status:row.status||'pending',online:true}}
  async function syncAdjustments(){
    if(!online||!businessId()||!branchId())return;
    try{
      var result=await db.from('payroll_adjustments').select('id,worker_id,adjustment_date,adjustment_type,amount,reason,status').eq('business_id',businessId()).eq('branch_id',branchId()).order('adjustment_date',{ascending:false});
      if(result.error)throw result.error;
      var data=read();data.adjustments=(result.data||[]).map(localAdjustment);write(data);decoratePayrollAdjustments();
    }catch(error){onlinePayrollStatus('Online payroll adjustments could not load: '+error.message,'error')}
  }
  function payrollSnapshot(data,workerId,start,end){
    var worker=(data.workers||[]).find(function(item){return item.id===workerId})||{},attendance=(data.attendance||[]).filter(function(item){return item.workerId===workerId&&inPayrollRange(item.date,start,end)&&item.attendanceApproved!==false}),jobs=(data.jobs||[]).filter(function(item){return item.workerId===workerId}),debts=(data.advances||[]).concat(data.loans||[]).filter(function(item){return item.workerId===workerId}),adjustments=(data.adjustments||[]).filter(function(item){return item.workerId===workerId&&item.status==='approved'&&inPayrollRange(item.date,start,end)}),regular=attendance.reduce(function(sum,item){return sum+Number(item.regularPay||0)},0),overtime=attendance.filter(function(item){return item.overtimeApproved}).reduce(function(sum,item){return sum+Number(item.overtimePay||0)},0),jobPay=jobs.reduce(function(sum,job){return sum+(job.payments||[]).filter(function(payment){return inPayrollRange(payment.date,start,end)}).reduce(function(total,payment){return total+Number(payment.amount||0)},0)},0),debtDeductions=debts.reduce(function(sum,debt){return sum+(debt.payments||[]).filter(function(payment){return inPayrollRange(payment.date,start,end)}).reduce(function(total,payment){return total+Number(payment.amount||0)},0)},0),bonuses=adjustments.filter(function(item){return item.type==='bonus'}).reduce(function(sum,item){return sum+Number(item.amount||0)},0),otherDeductions=adjustments.filter(function(item){return item.type==='deduction'}).reduce(function(sum,item){return sum+Number(item.amount||0)},0),deductions=debtDeductions+otherDeductions,gross=regular+overtime+jobPay+bonuses;
    return {start:start,end:end,worker:{id:worker.id,name:worker.name||'Worker',code:worker.code||'',position:worker.position||'',type:worker.type||'',rate:Number(worker.rate||0)},jobs:jobs.map(function(job){var retention=Number(job.amount||0)*Number(job.retention||0)/100,paid=(job.payments||[]).filter(function(payment){return inPayrollRange(payment.date,start,end)}).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0),allPaid=(job.payments||[]).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0);return {number:job.number,vehicle:job.vehicle,plate:job.plate||'',work:job.work||'',amount:Number(job.amount||0),retention:retention,paid:paid,remaining:Math.max(0,Number(job.amount||0)-retention-allPaid)}}),debts:debts.map(function(debt){var paid=(debt.payments||[]).filter(function(payment){return inPayrollRange(payment.date,start,end)}).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0),allPaid=(debt.payments||[]).reduce(function(sum,payment){return sum+Number(payment.amount||0)},0);return {reference:debt.reference||'',amount:Number(debt.amount||0),deducted:paid,balance:Math.max(0,Number(debt.amount||0)-allPaid)}}),adjustments:adjustments.map(function(item){return {type:item.type,amount:Number(item.amount||0),reason:item.reason||''}}),daily:regular+overtime,jobWeek:jobPay,regularPay:regular,overtimePay:overtime,vehiclePay:jobPay,bonuses:bonuses,otherDeductions:otherDeductions,gross:gross,deductions:deductions,net:Math.max(0,gross-deductions),approvedAt:new Date().toISOString()}
  }
  function archive(data){return data.onlinePayrollArchive||{periods:[],payslips:[]}}
  function localArchivedPayslip(row){var snapshot=row.snapshot||{};return {id:row.id,number:row.payslip_number,created:String(row.created_at||'').slice(0,10)||dateToday(),start:snapshot.start||'',end:snapshot.end||'',worker:snapshot.worker||{},jobs:snapshot.jobs||[],debts:snapshot.debts||[],daily:Number(snapshot.daily||0),jobWeek:Number(snapshot.jobWeek||0),deductions:Number(row.deductions||snapshot.deductions||0),gross:Number(row.gross_earnings||snapshot.gross||0),net:Number(row.net_pay||snapshot.net||0),approved:row.status==='approved'||row.status==='issued',issued:row.status==='issued',online:true}}
  function mergeArchivedPayslips(data,rows){var remote=(rows||[]).map(localArchivedPayslip),ids={};remote.forEach(function(item){ids[item.id]=true});(data.payslips||[]).forEach(function(item){if(!item.online&&!ids[item.id])remote.push(item)});data.payslips=remote}
  function putArchive(data,period,payslip){var saved=archive(data),pi=(saved.periods||[]).findIndex(function(item){return item.id===period.id}),si=(saved.payslips||[]).findIndex(function(item){return item.id===payslip.id});saved.periods=saved.periods||[];saved.payslips=saved.payslips||[];if(pi>=0)saved.periods[pi]=period;else saved.periods.push(period);if(si>=0)saved.payslips[si]=payslip;else saved.payslips.push(payslip);data.onlinePayrollArchive=saved;write(data)}
  async function syncPayrollArchive(){
    if(!online||!businessId())return;
    try{
      var periods=await db.from('payroll_periods').select('id,period_start,period_end,schedule_type,status,approved_at,issued_at').eq('business_id',businessId()).eq('branch_id',branchId()).order('period_end',{ascending:false});if(periods.error)throw periods.error;
      var slips=await db.from('payslips').select('id,payroll_period_id,worker_id,payslip_number,gross_earnings,deductions,net_pay,status,approved_at,issued_at,snapshot').eq('business_id',businessId()).eq('branch_id',branchId()).order('created_at',{ascending:false});if(slips.error)throw slips.error;
      var data=read();data.onlinePayrollArchive={periods:periods.data||[],payslips:slips.data||[]};mergeArchivedPayslips(data,slips.data||[]);write(data);setTimeout(decoratePayrollActions,20);
    }catch(error){onlinePayrollStatus('Online payroll archive could not load: '+error.message,'error')}
  }
  function decoratePayrollActions(){
    var data=read(),dates=payrollDates(data),saved=archive(data);Array.prototype.forEach.call(document.querySelectorAll('[data-pr="approve-payslip"]'),function(button){var workerId=button.dataset.id,period=(saved.periods||[]).find(function(item){return item.period_start===dates.start&&item.period_end===dates.end}),slip=period&&(saved.payslips||[]).find(function(item){return item.payroll_period_id===period.id&&item.worker_id===workerId});if(!slip)return;if(slip.status==='issued'){button.textContent='Issued ✓';button.disabled=true;var old=button.parentNode.querySelector('[data-pr-issue-payslip="'+workerId+'"]');if(old)old.remove();return}if(slip.status==='approved'){button.textContent='Approved ✓';var issue=button.parentNode.querySelector('[data-pr-issue-payslip="'+workerId+'"]');if(!issue){issue=document.createElement('button');issue.type='button';issue.className='primary';issue.dataset.prIssuePayslip=workerId;issue.textContent='Issue';button.insertAdjacentText('afterend',' ');button.insertAdjacentElement('afterend',issue)}}});
  }
  function adjustmentWorkerName(data,id){var worker=(data.workers||[]).find(function(item){return item.id===id});return worker?(worker.name||'Worker'):'Unknown worker'}
  function decoratePayrollAdjustments(){
    var root=document.getElementById('payroll'),content=document.getElementById('prContent');if(!root||!content)return;
    var preview=/Weekly payroll preview|Weekly payroll summary/.test(content.textContent||'');if(!preview)return;
    var data=read(),dates=payrollDates(data),items=(data.adjustments||[]).filter(function(item){return inPayrollRange(item.date,dates.start,dates.end)}),signature=JSON.stringify(items.map(function(item){return [item.id,item.status,item.amount,item.date]}));
    var box=document.getElementById('prPayrollAdjustments');if(box&&box.dataset.signature===signature)return;if(!box){box=document.createElement('div');box.id='prPayrollAdjustments';box.className='card';box.style.marginTop='14px';content.appendChild(box)}box.dataset.signature=signature;
    var rows=items.map(function(item){var type=item.type==='bonus'?'Bonus':'Other deduction',state=item.status==='approved'?'Approved':'Waiting for approval',action=item.status==='pending'?'<button class="secondary" data-pr-approve-adjustment="'+item.id+'">Approve adjustment</button>':'<span class="badge">'+state+'</span>';return '<tr><td>'+esc(adjustmentWorkerName(data,item.workerId))+'</td><td>'+type+'</td><td>'+money(item.amount)+'</td><td>'+esc(item.reason)+'</td><td>'+item.date+'</td><td>'+action+'</td></tr>'}).join('');
    box.innerHTML='<div class="heading" style="margin-top:0"><div><div class="k">Payroll adjustments</div><h2>Bonuses and other deductions</h2><p class="muted">Every adjustment needs a reason and manager approval. Only approved entries change the payroll calculation.</p></div><button class="secondary" data-pr-add-adjustment="1">Request adjustment</button></div>'+(rows?'<div style="overflow:auto"><table><thead><tr><th>Worker</th><th>Type</th><th>Amount</th><th>Reason</th><th>Date</th><th>Review</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class="empty">No payroll adjustments for this period.</div>');
  }
  async function requestAdjustment(){
    var data=read(),dates=payrollDates(data),workers=(data.workers||[]).filter(function(item){return item.online});if(!workers.length){alert('Save at least one worker online before requesting an adjustment.');return}
    var choices=workers.map(function(item,index){return (index+1)+'. '+item.name+' ('+item.code+')'}).join('\n'),selected=Number(prompt('Choose worker number:\n'+choices,'1'));if(!selected||!workers[selected-1])return;
    var type=String(prompt('Adjustment type: bonus or deduction','bonus')||'').trim().toLowerCase();if(type!=='bonus'&&type!=='deduction'){alert('Use only bonus or deduction.');return}
    var amount=Number(prompt('Amount in PHP:','0')||0);if(!(amount>0)){alert('Enter an amount greater than zero.');return}
    var reason=String(prompt('Reason for this '+type+':','')||'').trim();if(!reason){alert('A reason is required for every payroll adjustment.');return}
    var date=String(prompt('Adjustment date (YYYY-MM-DD):',dates.end)||'').trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){alert('Enter the date as YYYY-MM-DD.');return}
    var user=await getUser();if(!user){alert('Please sign in again before requesting an adjustment.');return}
    var result=await db.from('payroll_adjustments').insert({business_id:businessId(),branch_id:branchId(),worker_id:workers[selected-1].id,adjustment_date:date,adjustment_type:type,amount:amount,reason:reason,status:'pending',requested_by:user.id}).select().single();if(result.error)throw result.error;
    data.adjustments=data.adjustments||[];data.adjustments.unshift(localAdjustment(result.data));write(data);decoratePayrollAdjustments();alert('Adjustment saved and waiting for manager approval. It is not included in payroll yet.');
  }
  async function approveAdjustment(button){
    var data=read(),item=(data.adjustments||[]).find(function(entry){return entry.id===button.dataset.prApproveAdjustment});if(!item||item.status!=='pending')return;var user=await getUser();if(!user){alert('Please sign in again before approving this adjustment.');return}if(!confirm('Approve this '+item.type+' of '+money(item.amount)+' for '+adjustmentWorkerName(data,item.workerId)+'? It will be included in payroll for '+item.date+'.'))return;
    button.disabled=true;var original=button.textContent;button.textContent='Approving...';try{var result=await db.from('payroll_adjustments').update({status:'approved',approved_by:user.id,approved_at:new Date().toISOString()}).eq('id',item.id).eq('business_id',businessId()).eq('branch_id',branchId()).select().single();if(result.error)throw result.error;Object.assign(item,localAdjustment(result.data));write(data);decoratePayrollAdjustments();alert('Adjustment approved. It will be included when this worker payroll is approved.')}catch(error){alert('The adjustment could not be approved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  function replaceLegacyIssueButtons(){Array.prototype.forEach.call(document.querySelectorAll('[data-pr-issued]'),function(button){
    var workerId=button.dataset.prIssued,wasLegacyIssued=/^Issued/.test(button.textContent.trim());
    button.dataset.prIssuePayslip=workerId;button.removeAttribute('data-pr-issued');
    if(wasLegacyIssued){
      button.textContent='Issue online';button.title='This earlier record needs online approval before it can be posted to Expenses.';
      var approve=button.parentNode&&button.parentNode.querySelector('[data-pr="approve-payslip"][data-id="'+workerId+'"]');
      if(approve){approve.disabled=false;approve.textContent='Approve online';approve.title='Save this payroll approval securely online first.'}
    }else if(button.textContent.trim()==='Issued')button.textContent='Issue';
  })}
  async function ensurePayrollPeriod(user,start,end){
    var found=await db.from('payroll_periods').select('*').eq('business_id',businessId()).eq('branch_id',branchId()).eq('period_start',start).eq('period_end',end).maybeSingle();if(found.error)throw found.error;if(found.data)return found.data;
    var created=await db.from('payroll_periods').insert({business_id:businessId(),branch_id:branchId(),schedule_type:'weekly',period_start:start,period_end:end,status:'draft',created_by:user.id}).select().single();if(created.error)throw created.error;return created.data;
  }
  async function approvePayroll(button){
    var data=read(),workerId=button.dataset.id,worker=(data.workers||[]).find(function(item){return item.id===workerId});if(!worker||!worker.online){alert('This worker is not online yet. Save the worker online before approving payroll.');return}var dates=payrollDates(data);if(dates.end<dates.start){alert('Payroll end date must be on or after the start date.');return}var user=await getUser();if(!user){alert('Please sign in again before approving payroll.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Approving...';
    try{
      var period=await ensurePayrollPeriod(user,dates.start,dates.end),existing=await db.from('payslips').select('*').eq('business_id',businessId()).eq('branch_id',branchId()).eq('payroll_period_id',period.id).eq('worker_id',workerId).maybeSingle();if(existing.error)throw existing.error;if(existing.data&&existing.data.status==='issued'){putArchive(data,period,existing.data);decoratePayrollActions();alert('This payslip was already issued and cannot be changed.');return}
      var snapshot=payrollSnapshot(data,workerId,dates.start,dates.end),number='PS-'+dates.end.replace(/-/g,'')+'-'+String(worker.code||workerId).replace(/[^A-Za-z0-9]/g,'').slice(-10),payload={gross_earnings:snapshot.gross,deductions:snapshot.deductions,net_pay:snapshot.net,status:'approved',approved_at:new Date().toISOString(),snapshot:snapshot};var slipResult;
      if(existing.data)slipResult=await db.from('payslips').update(payload).eq('id',existing.data.id).eq('business_id',businessId()).eq('branch_id',branchId()).select().single();else{payload.business_id=businessId();payload.branch_id=branchId();payload.payroll_period_id=period.id;payload.worker_id=workerId;payload.payslip_number=number;payload.created_by=user.id;slipResult=await db.from('payslips').insert(payload).select().single()}if(slipResult.error)throw slipResult.error;
      var periodResult=await db.from('payroll_periods').update({status:'approved',approved_at:new Date().toISOString()}).eq('id',period.id).eq('business_id',businessId()).eq('branch_id',branchId()).select().single();if(periodResult.error)throw periodResult.error;putArchive(data,periodResult.data,slipResult.data);mergeArchivedPayslips(data,archive(data).payslips);write(data);onlinePayrollStatus('Approved payslips are stored securely online. Issue them only when payment is released.','info');decoratePayrollActions();alert('Payroll approved online. It has not been posted to Expenses or Dashboard until you click Issue.');
    }catch(error){alert('The payroll approval could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function issuePayroll(button){
    var data=read(),workerId=button.dataset.prIssuePayslip,dates=payrollDates(data),saved=archive(data),period=(saved.periods||[]).find(function(item){return item.period_start===dates.start&&item.period_end===dates.end}),slip=period&&(saved.payslips||[]).find(function(item){return item.payroll_period_id===period.id&&item.worker_id===workerId});if(!period||!slip||slip.status!=='approved'){alert('Approve this worker payroll first, then refresh the payroll view.');return}var user=await getUser();if(!user){alert('Please sign in again before issuing payroll.');return}if(!confirm('Issue this payslip? This will post the net pay to Expenses and Dashboard reporting.'))return;
    button.disabled=true;var original=button.textContent;button.textContent='Issuing...';
    try{
      var issuedAt=new Date().toISOString(),slipResult=await db.from('payslips').update({status:'issued',issued_at:issuedAt}).eq('id',slip.id).eq('business_id',businessId()).eq('branch_id',branchId()).select().single();if(slipResult.error)throw slipResult.error;
      var reference='PAYSLIP:'+slip.id,existingExpense=await db.from('expenses').select('id').eq('business_id',businessId()).eq('branch_id',branchId()).eq('reference_number',reference).maybeSingle();if(existingExpense.error)throw existingExpense.error;if(!existingExpense.data){var worker=(data.workers||[]).find(function(item){return item.id===workerId})||{},expense=await db.from('expenses').insert({business_id:businessId(),branch_id:branchId(),expense_date:dates.end,supplier_name:null,receipt_number:null,category:'Salaries and Wages',description:'Issued payroll · '+(worker.name||'Worker')+' · '+slip.payslip_number,quantity:1,unit_amount:Number(slip.net_pay||0),payment_method:null,reference_number:reference,remarks:'Automatically posted when payslip was issued.',created_by:user.id});if(expense.error)throw expense.error}
      document.dispatchEvent(new Event('bwc:expenses-loaded'));var all=await db.from('payslips').select('status').eq('business_id',businessId()).eq('branch_id',branchId()).eq('payroll_period_id',period.id);if(all.error)throw all.error;var complete=(all.data||[]).length>0&&(all.data||[]).every(function(item){return item.status==='issued'}),periodResult=await db.from('payroll_periods').update(complete?{status:'issued',issued_at:issuedAt}:{status:'approved'}).eq('id',period.id).eq('business_id',businessId()).eq('branch_id',branchId()).select().single();if(periodResult.error)throw periodResult.error;putArchive(data,periodResult.data,slipResult.data);mergeArchivedPayslips(data,archive(data).payslips);write(data);onlinePayrollStatus('Issued payslips are now posted securely to Expenses and Dashboard reporting.','info');decoratePayrollActions();alert('Payslip issued. The net pay is now recorded in Expenses and Dashboard reporting.');
    }catch(error){alert('The payslip could not be issued online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function approveOvertime(button){
    var recordId=button.dataset.prApproveOt,data=read(),entry=(data.attendance||[]).find(function(item){return item.id===recordId});
    if(!entry||!entry.online){alert('This attendance record is not online yet. Save the time record again first.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Approving…';
    try{
      var result=await db.from('payroll_attendance').update({overtime_approved:true}).eq('id',recordId).eq('business_id',businessId()).eq('branch_id',branchId()).select().single();if(result.error)throw result.error;
      entry.overtimeApproved=!!result.data.overtime_approved;write(data);var tab=document.querySelector('[data-pr-tab="attendance"]');if(tab)tab.click();alert('Overtime approved and saved online for payroll calculation.');
    }catch(error){alert('The overtime approval could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  async function approveAttendance(button){
    var recordId=button.dataset.prApproveAttendance,data=read(),entry=(data.attendance||[]).find(function(item){return item.id===recordId});
    if(!entry||!entry.online){alert('This attendance record is not online yet. Save the time record again first.');return}
    var user=await getUser();if(!user){alert('Please sign in again before approving attendance.');return}
    button.disabled=true;var original=button.textContent;button.textContent='Approving…';
    try{
      var result=await db.from('payroll_attendance').update({attendance_approved:true,attendance_approved_by:user.id,attendance_approved_at:new Date().toISOString()}).eq('id',recordId).eq('business_id',businessId()).eq('branch_id',branchId()).select().single();if(result.error)throw result.error;
      entry.attendanceApproved=result.data.attendance_approved!==false;write(data);var tab=document.querySelector('[data-pr-tab="attendance"]');if(tab)tab.click();alert('Attendance approved. Its regular pay can now be included in the payroll calculation.');
    }catch(error){alert('The attendance approval could not be saved online. '+error.message);button.disabled=false;button.textContent=original}
  }
  function decorateAttendanceReview(){
    var root=document.getElementById('payroll'),form=document.getElementById('prAttendanceEmployeeId');if(!root||!form)return;
    var table=root.querySelector('#prContent table');if(!table||table.dataset.attendanceReview==='1')return;
    var data=read(),start=value('prAttendanceStart')||data.weekStart||'',end=value('prAttendanceEnd')||data.weekEnd||'',records=(data.attendance||[]).filter(function(item){return (!start||item.date>=start)&&(!end||item.date<=end)}),header=table.querySelector('thead tr'),rows=table.querySelectorAll('tbody tr');
    if(!header||!rows.length||records.length!==rows.length)return;
    table.dataset.attendanceReview='1';var reviewHeader=document.createElement('th');reviewHeader.textContent='Attendance review';header.insertBefore(reviewHeader,header.lastElementChild);
    Array.prototype.forEach.call(rows,function(row,index){var entry=records[index],cell=document.createElement('td');if(entry&&entry.attendanceApproved!==false){cell.innerHTML='<span class="badge">Approved</span>'}else if(entry){cell.innerHTML='<span class="badge">Waiting for review</span><br><button class="secondary" style="margin-top:5px" data-pr-approve-attendance="'+entry.id+'">Approve attendance</button>'}else cell.textContent='—';row.insertBefore(cell,row.lastElementChild)});
  }
  window.addEventListener('click',function(event){
    var button=event.target.closest('[data-pr="add-worker"], [data-worker-edit-save="1"], [data-pr="save-attendance"], [data-pr="add-job"], [data-pr="add-advances"], [data-pr="add-loans"], [data-pr="approve-payslip"], [data-pr-issue-payslip], [data-pr-payment="job"], [data-pr-payment="advance"], [data-pr-payment="loan"], [data-pr-edit="job"], [data-pr-edit="advance"], [data-pr-edit="loan"], [data-pr-history="advance"], [data-pr-history="loan"], [data-pr-approve-ot], [data-pr-approve-attendance], [data-pr-add-adjustment], [data-pr-approve-adjustment]');if(!button||!online)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!businessId()||!branchId()){alert('Choose an active branch before saving payroll records.');return}
    if(button.dataset.prAddAdjustment)requestAdjustment().catch(function(error){alert('The adjustment could not be saved online. '+error.message)});else if(button.dataset.prApproveAdjustment)approveAdjustment(button);else if(button.dataset.prApproveAttendance)approveAttendance(button);else if(button.dataset.prApproveOt)approveOvertime(button);else if(button.dataset.prIssuePayslip)issuePayroll(button);else if(button.dataset.pr==='approve-payslip')approvePayroll(button);else if(button.dataset.prHistory==='advance'||button.dataset.prHistory==='loan')editObligationHistory(button,button.dataset.prHistory);else if(button.dataset.prEdit==='advance'||button.dataset.prEdit==='loan')editObligation(button,button.dataset.prEdit);else if(button.dataset.prEdit==='job')editJob(button);else if(button.dataset.prPayment==='advance'||button.dataset.prPayment==='loan')recordObligationPayment(button,button.dataset.prPayment);else if(button.dataset.prPayment==='job')recordJobPayment(button);else if(button.dataset.pr==='add-advances')saveObligation(button,'advance');else if(button.dataset.pr==='add-loans')saveObligation(button,'loan');else if(button.dataset.pr==='add-job')saveJob(button);else if(button.dataset.pr==='save-attendance')saveAttendance(button);else saveWorker(event,button);
  },true);
  var observerStarted=false;
  function beginOnlineSync(){
    if(!connect()){setTimeout(beginOnlineSync,250);return;}
    replaceLegacyIssueButtons();syncWorkers();syncAttendance();syncJobs();syncObligations();syncAdjustments();syncPayrollArchive();
    if(!observerStarted){observerStarted=true;new MutationObserver(function(){replaceLegacyIssueButtons();decorateAttendanceReview();decoratePayrollAdjustments()}).observe(document.body,{childList:true,subtree:true});}
  }
  window.addEventListener('load',function(){setTimeout(beginOnlineSync,120)});
  document.addEventListener('bwc:business-ready',beginOnlineSync);
  document.addEventListener('bwc:branch-ready',function(){setTimeout(beginOnlineSync,40)});
  document.addEventListener('click',function(event){if(event.target.closest('[data-pr-tab="workers"]'))setTimeout(function(){syncWorkers();showStatus('Workers are saved securely online for this business.','info')},100);if(event.target.closest('[data-pr-tab="attendance"]'))setTimeout(function(){syncAttendance();decorateAttendanceReview()},140);if(event.target.closest('[data-pr-tab="jobs"]'))setTimeout(syncJobs,100);if(event.target.closest('[data-pr-tab="advances"], [data-pr-tab="loans"]'))setTimeout(syncObligations,100);if(event.target.closest('[data-pr-tab="summary"], [data-pr-tab="calculated"]'))setTimeout(function(){syncPayrollArchive();syncAdjustments();decoratePayrollActions();decoratePayrollAdjustments()},100)});
})();
