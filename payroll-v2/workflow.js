/* 15M Payroll calculations and weekly workflow, independent of storage. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'));else root.PayrollWorkflow=factory(root.PayrollCore)})(typeof window!=='undefined'?window:this,function(C){
  'use strict';
  const clone=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const localDay=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
  function addDays(date,n){if(!C.validDate(date))throw Error('Choose a valid date.');const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
  function weeklyPeriod(reference=localDay()){
    if(!C.validDate(reference))throw Error('Choose a valid date in the payroll week.');
    const day=new Date(reference+'T12:00:00Z').getUTCDay(),start=addDays(reference,-((day+1)%7)),end=addDays(start,6);
    return {start,end,releaseDate:addDays(end,1)};
  }
  // Only the working selection changes. Never move dated entries or saved snapshots.
  function selectWeek(state,reference=localDay()){const period=weeklyPeriod(reference),chosen=state.payrollPaydays?.[period.start];if(chosen!==undefined){if(!C.validDate(chosen))throw Error('Choose a valid payroll payday.');period.releaseDate=chosen}return {...state,period}}
  function setPayday(state,date){
    if(!C.validDate(date))throw Error('Choose a valid payroll payday.');
    if(!isWeeklyPeriod(state.period))throw Error('Choose a Saturday–Friday payroll week first.');
    return {...state,period:{...state.period,releaseDate:date},payrollPaydays:{...(state.payrollPaydays||{}),[state.period.start]:date}};
  }
  function isWeeklyPeriod(period){return Boolean(period&&C.validDate(period.start)&&C.validDate(period.end)&&C.validDate(period.releaseDate)&&weeklyPeriod(period.end).start===period.start&&weeklyPeriod(period.end).end===period.end)}
  function retentionSchedule(j){
    if(!j.releasedOn)return {eligibleOn:'',firstFriday:''};
    const eligibleOn=addDays(j.releasedOn,45);
    return {eligibleOn,firstFriday:weeklyPeriod(eligibleOn).end};
  }
  function migrate(source){
    if(source.version===3)return clone(source);
    const n=C.migrate(source);n.version=3;n.plans=[];n.slipReleases=[];
    // Preserve existing payouts exactly. They are historical, not new exceptions.
    n.legacyReleases=clone(n.releases);return n;
  }
  function emptyWorkspace(employees=[],rules={lateMode:'deduct',hoursPerDay:8},reference=localDay()){
    const state={version:3,period:weeklyPeriod(reference),rules:clone(rules),employees:clone(employees),payrollPaydays:{},jobs:[],payments:[],releases:[],advances:[],attendance:[],payslips:[],plans:[],slipReleases:[],legacyReleases:[],painterTestSheets:[],releasedPainterSlips:[]};
    const errors=validate(state);if(errors.length)throw Error(errors[0]);return state;
  }
  function retentionStatus(state,j,asOf=localDay()){
    const due=j.releasedOn?addDays(j.releasedOn,45):'',balance=C.retentionBalance(state,j.id,asOf);
    const days=due?Math.max(0,Math.ceil((new Date(due+'T12:00:00Z')-new Date(asOf+'T12:00:00Z'))/86400000)):null;
    return {due,days,balance,status:!j.releasedOn?'unconfirmed':balance<=0?'settled':asOf<due?'waiting':'eligible',eligible:Boolean(j.releasedOn&&asOf>=due&&balance>0)};
  }
  function validate(state,asOf=localDay()){
    let errors=C.validate(state);
    if(state.version!==3||!['plans','slipReleases','legacyReleases','payslips'].every(k=>Array.isArray(state[k])))return [...errors,'Invalid 15M Payroll workspace structure.'];
    if(state.payrollPaydays!==undefined){
      if(!state.payrollPaydays||typeof state.payrollPaydays!=='object'||Array.isArray(state.payrollPaydays))errors.push('Invalid payroll payday settings.');
      else for(const [start,date] of Object.entries(state.payrollPaydays))if(!C.validDate(start)||weeklyPeriod(start).start!==start||!C.validDate(date))errors.push('Payroll payday settings need a Saturday cutoff start and a valid payday.');
    }
    for(const j of state.jobs){
      if(j.releasedOn&&(!j.closed||!C.validDate(j.releasedOn)||j.releasedOn>asOf||j.releasedOn<j.completed||j.retentionEligibleOn!==addDays(j.releasedOn,45)))errors.push('Unit release date and 45-day eligibility must be valid; future release is not allowed.');
      if(j.releasedOn&&state.payments.some(p=>p.jobId===j.id&&p.date>j.releasedOn))errors.push('Unit release must be on or after all labor portions.');
      const pending=state.plans.filter(p=>p.jobId===j.id&&!p.paymentId);
      if(pending.length&&j.closed)errors.push('Record or remove pending payment plans before releasing the unit.');
      if(C.cents(C.sum(pending,'amount'))>C.cents(C.unitSummary(state,j.id).unallocated))errors.push('Planned portions exceed the remaining labor balance for '+j.plate+'.');
    }
    const planIds=new Set();
    for(const p of state.plans){
      if(!p.id||planIds.has(p.id)||!state.jobs.some(j=>j.id===p.jobId)||!C.validDate(p.date)||!Number.isFinite(p.amount)||p.amount<=0)errors.push('Payment plans need a unique ID, unit, valid date, and positive amount.');planIds.add(p.id);
      if(p.paymentId&&!state.payments.some(row=>row.id===p.paymentId&&row.jobId===p.jobId&&row.gross===p.amount))errors.push('Converted payment plan does not match its labor entry.');
    }
    for(const r of state.releases){
      if(state.legacyReleases.some(old=>same(old,r)))continue;
      const j=state.jobs.find(j=>j.id===r.jobId);
      if(!j?.releasedOn)errors.push('Mark the unit Released before adding a retention payment.');
      else if(r.date<addDays(j.releasedOn,45)||asOf<addDays(j.releasedOn,45))errors.push('Retention is locked for 45 calendar days after unit release.');
      if(r.date>asOf)errors.push('A future date cannot be used to bypass the retention waiting period.');
    }
    const confirmed=new Set();
    for(const r of state.slipReleases){
      const s=state.payslips.find(s=>s.id===r.slipId);
      if(!s||confirmed.has(r.slipId)||!C.validDate(r.date)||r.date>asOf||r.date<s.period.releaseDate||!Number.isFinite(+new Date(r.confirmedAt)))errors.push('Payslip release must reference one saved copy and a valid actual release date.');confirmed.add(r.slipId);
    }
    return [...new Set(errors)];
  }
  function validateTransition(previous,next,asOf=localDay(),options={}){
    const errors=[...C.validateTransition(previous,next),...validate(next,asOf)];
    if(previous.version===3&&!same(previous.legacyReleases,next.legacyReleases)){
      const safeImport=options.importing&&previous.legacyReleases.every(old=>next.legacyReleases.some(r=>same(old,r)))&&next.legacyReleases.every(r=>previous.legacyReleases.some(old=>same(old,r))||(!previous.releases.some(old=>old.id===r.id)&&next.releases.some(row=>same(row,r))));
      if(!safeImport)errors.push('Historical retention entries cannot be changed or expanded.');
    }
    for(const old of previous.legacyReleases||[])if(!same(old,next.releases.find(r=>r.id===old.id)))errors.push('Historical retention payouts are read-only.');
    for(const j of previous.jobs.filter(j=>j.releasedOn)){const n=next.jobs.find(n=>n.id===j.id);if(!n||n.releasedOn!==j.releasedOn||n.retentionEligibleOn!==j.retentionEligibleOn)errors.push('Confirmed unit release dates are locked.');}
    for(const r of previous.slipReleases||[])if(!same(r,next.slipReleases.find(n=>n.slipId===r.slipId)))errors.push('Confirmed payslip releases are permanent history.');
    for(const s of previous.payslips||[]){
      if(!(previous.slipReleases||[]).some(r=>r.slipId===s.id))continue;
      for(const [snapshotKey,collection] of [['portions','payments'],['releases','releases'],['advances','advances']])for(const row of s.snapshot[snapshotKey]){
        const old=previous[collection].find(n=>n.id===row.id),n=next[collection].find(n=>n.id===row.id);
        if(old&&!same(old,n))errors.push('Entries included in a released payslip are locked.');
      }
      for(const [collection,owner] of [['payments',r=>next.jobs.find(j=>j.id===r.jobId)?.employeeId],['releases',r=>next.jobs.find(j=>j.id===r.jobId)?.employeeId],['advances',r=>r.employeeId]]){
        if(next[collection].some(r=>!same(previous[collection].find(o=>o.id===r.id),r)&&owner(r)===s.employeeId&&C.inPeriod(r.date,s.period)))errors.push('This payroll period has already been released. Use a new open period.');
      }
    }
    return [...new Set(errors)];
  }
  function releaseUnit(state,id,date,asOf=localDay()){
    const j=state.jobs.find(j=>j.id===id);if(!j)throw Error('Unit not found.');if(j.releasedOn)throw Error('Unit is already Released.');
    if(!C.validDate(date)||date>asOf)throw Error('Choose the actual unit release date, not a future date.');
    const n=j.closed?clone(state):C.completeJob(state,id,date,addDays(date,45));
    Object.assign(n.jobs.find(j=>j.id===id),{releasedOn:date,retentionEligibleOn:addDays(date,45)});
    const errors=validateTransition(state,n,asOf);if(errors.length)throw Error(errors[0]);return n;
  }
  function confirmPayslip(state,id,date,confirmedAt,asOf=localDay()){
    const n=clone(state);if(n.slipReleases.some(r=>r.slipId===id))throw Error('This payslip is already confirmed released.');
    n.slipReleases.push({slipId:id,date,confirmedAt});const errors=validateTransition(state,n,asOf);if(errors.length)throw Error(errors[0]);return n;
  }
  function saveReleasedPayslip(state,id,slipId,savedAt,asOf=localDay()){
    if(state.period.releaseDate>asOf)throw Error('A future payslip cannot be marked released. Use Preview draft until the actual release date.');
    return confirmPayslip(C.savePayslip(state,id,slipId,savedAt),slipId,state.period.releaseDate,savedAt,asOf);
  }
  function entryStatus(state,row,kind='portions'){
    const fields=kind==='portions'?['id','jobId','date','gross','retention','periodStart','periodEnd']:['id','jobId','date','amount','note'];
    const s=state.payslips.find(s=>s.snapshot[kind]?.some(p=>p.id===row.id&&fields.every(k=>same(row[k],p[k]))));
    return s?(state.slipReleases.some(r=>r.slipId===s.id)?'Released':'Saved · unconfirmed'):'Draft';
  }
  function mergeBackup(previous,incoming){const n=C.mergeBackup(previous,incoming);for(const key of ['plans','slipReleases','legacyReleases'])for(const old of previous[key]){const idKey=key==='slipReleases'?'slipId':'id',found=n[key].find(r=>r[idKey]===old[idKey]);if(found&&key!=='plans'&&!same(found,old))throw Error('Backup conflicts with existing confirmed history.');if(!found)n[key].push(clone(old))}if(previous.payrollPaydays||n.payrollPaydays)n.payrollPaydays={...previous.payrollPaydays,...n.payrollPaydays};return n}
  return {...C,migrate,validate,validateTransition,releaseUnit,retentionStatus,retentionSchedule,weeklyPeriod,selectWeek,setPayday,isWeeklyPeriod,addDays,localDay,entryStatus,confirmPayslip,saveReleasedPayslip,mergeBackup,emptyWorkspace};
});
