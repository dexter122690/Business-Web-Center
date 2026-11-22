(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./employee-photos.js'):root.EmployeePhotos);if(typeof module==='object'&&module.exports)module.exports=api;else root.PayrollCore=api})(typeof window!=='undefined'?window:this,function(D){
  'use strict';
  const cents=n=>Math.round((Number(n)||0)*100);
  const money=n=>cents(n)/100;
  const sum=(rows,field)=>rows.reduce((n,row)=>n+cents(row[field]),0)/100;
  const inPeriod=(date,p)=>date>=p.start&&date<=p.end;
  function dates(start,end){const out=[];const d=new Date(start+'T12:00:00Z');const last=new Date(end+'T12:00:00Z');if(!Number.isFinite(+d)||!Number.isFinite(+last)||last<d)return out;while(d<=last&&out.length<32){out.push(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1)}return out}
  function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(+new Date(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value}
  const copy=value=>JSON.parse(JSON.stringify(value));
  const employeeProfileFields={assignedBranch:['Assigned branch',100],mobileNumber:['Mobile number',40],address:['Address',500],emergencyContactName:['Emergency contact name',120],emergencyContactNumber:['Emergency contact number',40],emergencyRelationship:['Relationship to employee',80],payoutAccountType:['Payout account type',20],bankName:['Bank / wallet name',100],accountName:['Account holder name',120],accountNumber:['Account / GCash number',64]};
  function readEmployeeProfile(values){const result={};for(const [key,[label,max]] of Object.entries(employeeProfileFields)){const value=values[key]??'';if(typeof value!=='string'||value.length>max)throw Error(label+' must be text, up to '+max+' characters.');result[key]=value.trim()}if(!['','gcash','bank','other'].includes(result.payoutAccountType))throw Error('Choose GCash, Bank, Other wallet, or Not set.');return result}
  // Employee contacts and payout accounts belong in the profile, not in payslip copies.
  function payslipEmployee(employee){const result=copy(employee);for(const key of Object.keys(employeeProfileFields))delete result[key];delete result.photos;return result}
  function migrate(source){
    const state=copy(source);
    if(![1,2].includes(state.version))throw Error('Unsupported backup version.');
    if(state.version===1){
      state.version=2;state.payslips=[];
      state.employees.forEach(e=>{e.archived=false});
      // Existing completion dates alone must not silently change old balances.
      state.jobs.forEach(j=>{j.closed=false;j.retentionTransfer=0});
    }
    return state;
  }
  function activeEmployees(state){return state.employees.filter(e=>!e.archived)}
  function retentionFund(state,jobId,asOf='9999-12-31'){
    const j=state.jobs.find(j=>j.id===jobId);
    return money(sum(state.payments.filter(p=>p.jobId===jobId&&p.date<=asOf),'retention')+(j?.closed&&j.completed<=asOf?j.retentionTransfer:0));
  }
  function retentionBalance(state,jobId,asOf='9999-12-31',exclude=''){
    return money(retentionFund(state,jobId,asOf)-sum(state.releases.filter(r=>r.jobId===jobId&&r.date<=asOf&&r.id!==exclude),'amount'));
  }
  function unitSummary(state,jobId,asOf='9999-12-31'){
    const j=state.jobs.find(j=>j.id===jobId),payments=state.payments.filter(p=>p.jobId===jobId&&p.date<=asOf),releases=state.releases.filter(r=>r.jobId===jobId&&r.date<=asOf);
    const gross=sum(payments,'gross'),withheld=sum(payments,'retention'),released=sum(releases,'amount');
    return {gross,withheld,released,laborNet:money(gross-withheld),allocated:money(gross-withheld+released),unallocated:money(j.contract-gross),fund:retentionFund(state,jobId,asOf),balance:retentionBalance(state,jobId,asOf)};
  }
  function completeJob(state,jobId,date,due=''){
    const next=copy(state),j=next.jobs.find(j=>j.id===jobId);
    if(!j)throw Error('Unit not found.');
    if(j.closed)throw Error('This unit is already completed.');
    if(!validDate(date)||next.payments.some(p=>p.jobId===jobId&&p.date>date))throw Error('Completion must be on or after every labor portion date.');
    j.closed=true;j.completed=date;j.due=due;j.retentionTransfer=money(j.contract-sum(next.payments.filter(p=>p.jobId===jobId),'gross'));
    const errors=validate(next);if(errors.length)throw Error(errors[0]);return next;
  }
  // Snapshot balances at the selected cutoff, never mix future payroll into a past slip.
  function unitLedger(state,employeeId,period=state.period){
    return state.jobs.filter(j=>j.employeeId===employeeId).map(job=>{
      const beforePayments=state.payments.filter(p=>p.jobId===job.id&&p.date<period.start);
      const beforeReleases=state.releases.filter(p=>p.jobId===job.id&&p.date<period.start);
      const portions=state.payments.filter(p=>p.jobId===job.id&&inPeriod(p.date,period));
      const releases=state.releases.filter(p=>p.jobId===job.id&&inPeriod(p.date,period));
      const gross=sum(portions,'gross'),held=sum(portions,'retention'),retentionPaid=sum(releases,'amount');
      const opening=money(job.contract-sum(beforePayments,'gross')+sum(beforePayments,'retention')-sum(beforeReleases,'amount'));
      const weeklyAmount=money(gross-held+retentionPaid),remaining=money(opening-weeklyAmount);
      return {job,opening,gross,held,retentionPaid,weeklyAmount,remaining,
        releasedAtCutoff:Boolean(job.releasedOn&&job.releasedOn<=period.end),
        completedAtCutoff:Boolean(job.closed&&job.completed<=period.end)};
    });
  }
  function archiveEmployee(state,id,reason,date){
    const next=copy(state),e=next.employees.find(e=>e.id===id);
    if(!e||!String(reason||'').trim()||!validDate(date))throw Error('A removal reason and valid date are required.');
    e.archived=true;e.removalReason=reason.trim();e.removedOn=date;return next;
  }
  function setOvertime(state,employeeId,date,enabled,minutes){
    if(!state.employees.some(e=>e.id===employeeId&&e.type==='daily')||!validDate(date))throw Error('Choose a daily-rate employee and a valid attendance date.');
    if(typeof enabled!=='boolean'||(minutes!==undefined&&(!Number.isInteger(minutes)||minutes<0||minutes>1440)))throw Error('Enter overtime from 0 to 24 hours, using whole hours and minutes.');
    const next=copy(state);let entry=next.attendance.find(a=>a.employeeId===employeeId&&a.date===date);
    if(!entry){entry={employeeId,date,status:'unset',lateMinutes:0};next.attendance.push(entry)}
    entry.overtimeEnabled=enabled;entry.overtimeMinutes=minutes??entry.overtimeMinutes??0;
    // Toggle off excludes the duration; keep it so accidental toggles can be reversed.
    const errors=validate(next);if(errors.length)throw Error(errors[0]);return next;
  }
  function calculate(state,employeeId,period=state.period){
    const employee=state.employees.find(e=>e.id===employeeId);if(!employee)throw Error('Employee not found.');
    const jobs=state.jobs.filter(j=>j.employeeId===employeeId),ids=new Set(jobs.map(j=>j.id));
    const portions=state.payments.filter(p=>ids.has(p.jobId)&&inPeriod(p.date,period));
    const releases=state.releases.filter(r=>ids.has(r.jobId)&&inPeriod(r.date,period));
    const advances=state.advances.filter(a=>a.employeeId===employeeId&&inPeriod(a.date,period));
    const attendance=dates(period.start,period.end).map(date=>{
      const entry=state.attendance.find(a=>a.employeeId===employeeId&&a.date===date)||{date,status:'unset',lateMinutes:0};
      const paid=['present','late'].includes(entry.status),lateMinutes=entry.status==='late'?Number(entry.lateMinutes)||0:0;
      const basic=paid?money(employee.rate):0;
      const deduction=state.rules.lateMode==='deduct'&&paid?money(basic*Math.min(lateMinutes,state.rules.hoursPerDay*60)/(state.rules.hoursPerDay*60)):0;
      const overtimeEnabled=entry.overtimeEnabled===true,overtimeMinutes=overtimeEnabled?(entry.overtimeMinutes||0):0;
      return {...entry,basic,lateMinutes,overtimeEnabled,overtimeMinutes,deduction,net:money(basic-deduction)};
    });
    const basic=employee.type==='daily'?sum(attendance,'basic'):sum(portions,'gross');
    const late=employee.type==='daily'?sum(attendance,'deduction'):0;
    const held=employee.type==='contract'?sum(portions,'retention'):0;
    const retentionReleased=employee.type==='contract'?sum(releases,'amount'):0;
    const cashAdvance=sum(advances,'amount');
    const net=money(basic-late-held+retentionReleased-cashAdvance);
    const warnings=[];
    if(employee.type==='daily'&&attendance.some(a=>a.status==='unset'))warnings.push('Attendance has unmarked days. Mark them before finalizing.');
    if(net<0)warnings.push('Deductions exceed earnings. Review before paying; the negative balance is not hidden.');
    return {employee,jobs,portions,releases,advances,attendance,basic,late,held,retentionReleased,cashAdvance,net,warnings,paidDays:attendance.filter(a=>['present','late'].includes(a.status)).length,lateMinutes:attendance.reduce((s,a)=>s+a.lateMinutes,0),overtimeMinutes:attendance.reduce((s,a)=>s+a.overtimeMinutes,0)};
  }
  function validate(state){
    const errors=[];
    if(!state||!state.period||!state.rules||!['employees','jobs','payments','releases','advances','attendance'].every(k=>Array.isArray(state[k]))||(state.version===2&&!Array.isArray(state.payslips)))return ['Invalid payroll workspace or backup structure.'];
    if(!validDate(state.period.start)||!validDate(state.period.end)||state.period.end<state.period.start||dates(state.period.start,state.period.end).length>31)errors.push('Choose a valid payroll range of up to 31 days.');
    if(!validDate(state.period.releaseDate))errors.push('Choose a valid payroll payday.');
    if(!(state.rules.hoursPerDay>=1&&state.rules.hoursPerDay<=24))errors.push('Working hours must be between 1 and 24.');
    if(!['record','deduct'].includes(state.rules.lateMode))errors.push('Choose a valid late policy.');
    const allIds=new Set();
    for(const group of ['employees','jobs','payments','releases','advances'])for(const row of state[group]){if(!row.id||allIds.has(row.id))errors.push('Duplicate or missing record ID.');allIds.add(row.id)}
    for(const e of state.employees){if(!e.name.trim()||!e.position.trim())errors.push('Employee name and position are required.');if(!['daily','contract'].includes(e.type)||!Number.isFinite(e.rate)||e.rate<0||(e.type==='daily'&&e.rate<=0))errors.push('Enter a valid employee type and daily rate.');if(e.archived&&(!e.removalReason?.trim()||!validDate(e.removedOn)))errors.push('Removed employees need a reason and removal date.');try{readEmployeeProfile(e)}catch(error){errors.push(error.message)}}
    try{D.allRefs(state)}catch(error){errors.push(error.message)}
    for(const j of state.jobs){if(!state.employees.some(e=>e.id===j.employeeId&&e.type==='contract'))errors.push('Contract unit must belong to a contract employee.');if(!j.unit.trim()||!j.plate.trim()||!j.work.trim()||!j.color.trim()||!/^\d{4}$/.test(String(j.year)))errors.push('Complete unit, year, plate, color, and work details.');if(!Number.isFinite(j.contract)||j.contract<=0)errors.push('Agreed labor contract must be greater than zero.');if(j.completed&&!validDate(j.completed))errors.push('Enter a valid completion date.');if(j.due&&!validDate(j.due))errors.push('Enter a valid expected retention release date.');if(cents(sum(state.payments.filter(p=>p.jobId===j.id),'gross'))>cents(j.contract))errors.push('Labor portions cannot exceed the agreed contract for '+j.plate+'.');}
    for(const j of state.jobs){if(j.closed){if(!validDate(j.completed)||!Number.isFinite(j.retentionTransfer)||j.retentionTransfer<0||cents(j.retentionTransfer)!==cents(j.contract-sum(state.payments.filter(p=>p.jobId===j.id),'gross')))errors.push('Completed-unit retention transfer must match the remaining unallocated labor balance.');if(state.payments.some(p=>p.jobId===j.id&&p.date>j.completed))errors.push('Completed units cannot have later labor portions. Use a retention release.');}}
    for(const p of state.payments){if(!state.jobs.some(j=>j.id===p.jobId))errors.push('Select a contract unit.');if(!validDate(p.date)||!Number.isFinite(p.gross)||p.gross<=0||!Number.isFinite(p.retention)||p.retention<0||p.retention>p.gross)errors.push('A labor portion must be positive; retention must be between zero and that portion.');if((p.periodStart||p.periodEnd)&&(!validDate(p.periodStart)||!validDate(p.periodEnd)||p.periodEnd<p.periodStart||!inPeriod(p.date,{start:p.periodStart,end:p.periodEnd})))errors.push('Labor date must fall inside its recorded payroll date range.');}
    for(const r of state.releases){if(!state.jobs.some(j=>j.id===r.jobId))errors.push('Select a unit for retention release.');if(!validDate(r.date)||!Number.isFinite(r.amount)||r.amount<=0)errors.push('Enter a valid retention release amount and date.');}
    for(const j of state.jobs){const checkpoints=[...state.payments.filter(p=>p.jobId===j.id).map(p=>p.date),...state.releases.filter(r=>r.jobId===j.id).map(r=>r.date),...(j.closed?[j.completed]:[])];if(checkpoints.some(date=>retentionBalance(state,j.id,date)<0))errors.push('Retention release exceeds the held balance on that date for '+j.plate+'.');}
    for(const a of state.advances){if(!state.employees.some(e=>e.id===a.employeeId)||!validDate(a.date)||!Number.isFinite(a.amount)||a.amount<=0)errors.push('Cash advance deductions need an employee, valid date, and positive amount.');}
    const attendanceKeys=new Set();
    for(const a of state.attendance){const key=a.employeeId+':'+a.date;if(attendanceKeys.has(key))errors.push('Duplicate attendance day.');attendanceKeys.add(key);if(!state.employees.some(e=>e.id===a.employeeId&&e.type==='daily')||!validDate(a.date)||!['unset','present','absent','late','rest'].includes(a.status)||!Number.isFinite(a.lateMinutes)||a.lateMinutes<0||a.lateMinutes>state.rules.hoursPerDay*60)errors.push('Check attendance status and late duration (it cannot exceed the workday).');if((a.overtimeEnabled!==undefined&&typeof a.overtimeEnabled!=='boolean')||(a.overtimeMinutes!==undefined&&(!Number.isInteger(a.overtimeMinutes)||a.overtimeMinutes<0||a.overtimeMinutes>1440)))errors.push('Overtime must be whole minutes between 0 and 24 hours.');}
    const slipIds=new Set(),slipPeriods=new Set();
    for(const s of state.payslips||[]){
      const key=s.employeeId+':'+s.period?.start+':'+s.period?.end;
      if(!s.id||slipIds.has(s.id)||slipPeriods.has(key)||!s.snapshot||s.snapshot.employee?.id!==s.employeeId||!validDate(s.period?.start)||!validDate(s.period?.end)||!Number.isFinite(s.snapshot.net))errors.push('Invalid or duplicate saved payslip.');
      slipIds.add(s.id);slipPeriods.add(key);
      const c=s.snapshot;
      if(!c||!c.period||!c.rules||!c.employee||!['attendance','portions','releases','advances','retentionAccounts','warnings','jobs'].every(k=>Array.isArray(c[k]))){errors.push('Saved payslip details are incomplete.');continue}
      if(typeof c.employee.name!=='string'||typeof c.employee.position!=='string'||!['daily','contract'].includes(c.employee.type)||!Number.isFinite(c.employee.rate)||!Number.isFinite(+new Date(s.savedAt))||!validDate(c.period.releaseDate)||c.period.start!==s.period.start||c.period.end!==s.period.end||c.period.releaseDate!==s.period.releaseDate)errors.push('Saved payslip identity or dates are invalid.');
      if(!['basic','late','held','retentionReleased','cashAdvance','net'].every(k=>Number.isFinite(c[k]))||cents(c.net)!==cents(c.basic-c.late-c.held+c.retentionReleased-c.cashAdvance))errors.push('Saved payslip totals are inconsistent.');
      if(c.unitBalances!==undefined){
        if(!Array.isArray(c.unitBalances)||c.employee.type!=='contract')errors.push('Invalid saved unit-balance ledger.');
        else{
          const ledgerIds=new Set();
          for(const a of c.unitBalances){
            if(!a.job||!c.jobs.some(j=>j.id===a.job.id)||ledgerIds.has(a.job?.id)||!['opening','gross','held','retentionPaid','weeklyAmount','remaining'].every(k=>Number.isFinite(a[k])&&a[k]>=0)||cents(a.weeklyAmount)!==cents(a.gross-a.held+a.retentionPaid)||cents(a.remaining)!==cents(a.opening-a.weeklyAmount))errors.push('Saved unit balances are inconsistent.');
            ledgerIds.add(a.job?.id);
          }
          if(cents(sum(c.unitBalances,'gross'))!==cents(c.basic)||cents(sum(c.unitBalances,'held'))!==cents(c.held)||cents(sum(c.unitBalances,'retentionPaid'))!==cents(c.retentionReleased))errors.push('Saved unit ledger does not match payroll totals.');
        }
      }
      if([...c.portions,...c.releases,...c.retentionAccounts].some(r=>!r.job||typeof r.job.unit!=='string'||typeof r.job.work!=='string'))errors.push('Saved payslip unit details are incomplete.');
      if((state.payslips||[]).some(other=>other!==s&&other.employeeId===s.employeeId&&other.period.start<=s.period.end&&other.period.end>=s.period.start))errors.push('Saved payroll periods overlap for an employee.');
    }
    return [...new Set(errors)];
  }
  function validateTransition(previous,next){
    const errors=validate(next);
    for(const old of previous.payslips||[])if(JSON.stringify(next.payslips?.find(s=>s.id===old.id))!==JSON.stringify(old))errors.push('Saved payslips are permanent snapshots and cannot be overwritten or deleted.');
    for(const e of previous.employees)if(!next.employees.some(n=>n.id===e.id))errors.push('Employees must be archived, never permanently deleted.');
    for(const j of previous.jobs.filter(j=>j.closed)){
      const n=next.jobs.find(n=>n.id===j.id);
      if(!n||!n.closed||n.contract!==j.contract||n.retentionTransfer!==j.retentionTransfer||n.completed!==j.completed||n.employeeId!==j.employeeId||JSON.stringify(previous.payments.filter(p=>p.jobId===j.id))!==JSON.stringify(next.payments.filter(p=>p.jobId===j.id)))errors.push('Completed-unit contract and labor history are locked. Record later payments as retention releases.');
    }
    return [...new Set(errors)];
  }
  function createPayslip(state,employeeId){
    const c=calculate(state,employeeId),jobs=new Map(c.jobs.map(j=>[j.id,j]));
    return copy({...c,employee:payslipEmployee(c.employee),period:state.period,rules:state.rules,
      ...(c.employee.type==='contract'?{unitBalances:unitLedger(state,employeeId)}:{}),
      portions:c.portions.map(p=>({...p,job:jobs.get(p.jobId)})),
      releases:c.releases.map(r=>({...r,job:jobs.get(r.jobId)})),
      retentionAccounts:c.jobs.filter(j=>retentionFund(state,j.id,state.period.end)>0).map(j=>({job:j,...unitSummary(state,j.id,state.period.end),periodReleased:sum(c.releases.filter(r=>r.jobId===j.id),'amount')}))});
  }
  function savePayslip(state,employeeId,id,savedAt){
    const next=copy(state),snapshot=createPayslip(next,employeeId),period=copy(state.period);
    const overlap=(next.payslips||[]).some(s=>s.employeeId===employeeId&&s.period.start<=period.end&&s.period.end>=period.start);
    if(overlap)throw Error('A saved payslip already covers these dates for this employee. Open Payslip history to reprint it.');
    if(snapshot.warnings.length)throw Error('Resolve payroll warnings before saving: '+snapshot.warnings.join(' '));
    if(!id||!savedAt)throw Error('Payslip ID and saved timestamp are required.');
    next.payslips=next.payslips||[];next.payslips.push({id,employeeId,period,savedAt,snapshot});
    const errors=validateTransition(state,next);if(errors.length)throw Error(errors[0]);return next;
  }
  function mergeBackup(previous,incoming){
    const next=copy(incoming);
    for(const group of ['employees','jobs','payments','releases','advances','payslips']){
      for(const old of previous[group]||[]){const existing=next[group].find(r=>r.id===old.id);if(group==='payslips'&&existing&&JSON.stringify(existing)!==JSON.stringify(old))throw Error('A saved payslip conflicts with an existing immutable copy.');if(group==='employees'&&existing&&existing.photos===undefined&&old.photos)existing.photos=copy(old.photos);if(!existing)next[group].push(copy(old))}
    }
    for(const old of previous.attendance){const found=next.attendance.find(a=>a.employeeId===old.employeeId&&a.date===old.date);if(!found)next.attendance.push(copy(old));else if(found.overtimeEnabled===undefined&&found.overtimeMinutes===undefined){if(old.overtimeEnabled!==undefined)found.overtimeEnabled=old.overtimeEnabled;if(old.overtimeMinutes!==undefined)found.overtimeMinutes=old.overtimeMinutes}}
    return next;
  }
  return {cents,money,sum,inPeriod,dates,validDate,calculate,validate,validateTransition,retentionBalance,retentionFund,unitSummary,unitLedger,completeJob,archiveEmployee,setOvertime,createPayslip,savePayslip,mergeBackup,activeEmployees,migrate,employeeProfileFields,readEmployeeProfile,payslipEmployee};
});
