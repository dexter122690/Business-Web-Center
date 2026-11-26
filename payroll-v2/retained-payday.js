/* Local-preview workflow. Enable only with an adapter that atomically saves
 * receipts, versioned payday copies and PDFs. No existing release is rewritten. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./workflow.js'),require('./simple-painter.js'),require('./payslip-archive.js'));
  else root.PayrollRetainedPayday=factory(root.PayrollWorkflow,root.SimplePainter,root.PayslipArchive);
})(typeof window==='undefined'?this:window,function(W,S,A){
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const key=r=>r.employeeId+':'+r.period.start+':'+r.period.end;
  const copies=s=>s.retainedPaydayCopies||[];
  const latestCopies=s=>[...new Map(copies(s).map(r=>[key(r),r])).values()];
  function target(s,employeeId,date){
    if(!W.validDate(date))throw Error('Choose a valid actual date received.');
    const periods=new Map(),anchor=W.weeklyPeriod(date).start;
    // Include nearby normal paydays and every saved exception (holidays, etc.).
    for(let n=-3;n<=3;n++){
      const p=W.selectWeek(s,W.addDays(anchor,n*7),employeeId).period;periods.set(p.start,p);
    }
    for(const r of S.latest(s,employeeId))periods.set(r.period.start,r.period);
    for(const r of s.releasedPainterSlips||[])if(r.employeeId===employeeId)periods.set(r.period.start,r.period);
    const sorted=[...periods.values()].sort((a,b)=>a.start.localeCompare(b.start));
    for(let n=1;n<sorted.length;n++)if(sorted[n].releaseDate<=sorted[n-1].releaseDate)
      throw Error('Payroll paydays overlap or are out of order. Review the payday dates first.');
    const p=sorted.find(p=>p.releaseDate>=date);
    if(!p)throw Error('No matching payday. Save the intended payroll table first.');
    const source=S.latest(s,employeeId).find(r=>r.period.start===p.start&&r.period.end===p.end);
    if(!source)throw Error('Save the payroll table for '+p.start+' to '+p.end+' (payday '+p.releaseDate+') before recording this payment.');
    return {period:copy(p),source};
  }
  function current(s,record){return latestCopies(s).find(r=>key(r)===key(record))||record}
  function refresh(s,uid,recordedAt){
    const next=copy(s);next.retainedPaydayCopies=next.retainedPaydayCopies||[];
    const groups=new Map();
    for(const p of next.painterRetentionReceipts||[]){
      if(!p.payrollPeriod)continue;const k=key({employeeId:p.employeeId,period:p.payrollPeriod});
      if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);
    }
    for(const payments of groups.values()){
      const p=payments[0],source=S.latest(next,p.employeeId).find(r=>r.period.start===p.payrollPeriod.start&&r.period.end===p.payrollPeriod.end);
      if(!source||!same(source.period,p.payrollPeriod))throw Error('Keep the payday linked to the retained payment.');
      const released=A.forWeek(next,p.employeeId,source.period),base=released||source;
      const frozen=copy(A.enrich(next,base));
      // Receipt metadata is supplemental; regular labor/net and original PDFs stay unchanged.
      frozen.snapshot.retentionReceipts=copy((next.painterRetentionReceipts||[]).filter(r=>r.employeeId===p.employeeId&&r.receivedOn<=source.period.releaseDate));
      frozen.snapshot.retainedPaydayPayments=copy(payments);
      frozen.snapshot.retainedPaydayTotal=W.sum(payments,'amount');
      frozen.snapshot.paydayTotal=W.money(frozen.snapshot.net+frozen.snapshot.retainedPaydayTotal);
      frozen.snapshot.paydayWeeklyReleased=Boolean(released);
      const previous=current(next,source),last=previous.retainedPaydayCopy?previous:null;
      const basis={sourceId:source.id,baseReleaseId:released?.id||'',period:source.period,snapshot:frozen.snapshot,weeklyReleased:Boolean(released)};
      if(last&&same(last.paydayBasis,basis))continue;
      next.retainedPaydayCopies.push({...frozen,id:uid(),sourceId:source.id,employeeId:p.employeeId,
        retainedPaydayCopy:true,weeklyReleased:Boolean(released),releasedCopy:Boolean(released),
        version:(last?.version||0)+1,updatedCopy:Boolean(last||released),savedAt:recordedAt,
        paydayBasis:copy(basis),supersedesId:last?.id||released?.id||''});
    }
    return next;
  }
  function prepareSave(next,previous,uid,now=new Date().toISOString()){
    // Validate the requested transition before deriving a new combined copy.
    // Contract changes deliberately forbid unrelated writes in that transition;
    // the derived payday copy is generated only after that check has passed.
    const before=[...S.validate(next,previous),...A.validate(next,previous),...validate(next,previous)];
    if(before.length)throw Error(before[0]);
    const prepared=refresh(next,uid,now);
    const after=[...S.validate(prepared),...A.validate(prepared,previous),...validate(prepared,previous)];
    if(after.length)throw Error(after[0]);
    return prepared;
  }
  function receive(s,{employeeId,jobId,date,expectedAmount,expectedReleaseDate,expectedPeriod,acknowledge,recordedBy='local-preview'},uid,now=new Date().toISOString(),today=S.manilaDay()){
    if(!acknowledge)throw Error('Confirm the employee received the full remaining balance.');
    const basis=S.receiptBasis(s,employeeId,jobId);
    if(!W.validDate(date)||date<basis.dueOn||date>today||today<basis.dueOn)throw Error('Choose a received date from the 45-day due date through today.');
    if(expectedAmount!==basis.amount||expectedReleaseDate!==basis.unitReleasedOn)throw Error('The retained balance changed. Reopen the confirmation.');
    const destination=target(s,employeeId,date);
    if(!same(destination.period,expectedPeriod))throw Error('The payday changed. Review the destination again.');
    const old=(s.painterRetentionReceipts||[]).find(p=>p.employeeId===employeeId&&p.jobId===jobId);
    if(old){
      if(old.receivedOn===date&&old.amount===basis.amount&&same(old.payrollPeriod,destination.period))return copy(s);
      throw Error('This retained balance was already received. No second payment was recorded.');
    }
    const next=copy(s);next.painterRetentionReceipts=next.painterRetentionReceipts||[];
    next.painterRetentionReceipts.push({id:uid(),employeeId,jobId,amount:basis.amount,receivedOn:date,
      recordedAt:now,recordedBy,basis, payrollPeriod:destination.period});
    const saved=refresh(next,uid,now),errors=[...S.validate(saved,s),...A.validate(saved,s),...validate(saved,s)];
    if(errors.length)throw Error(errors[0]);return saved;
  }
  function validate(s,previous){
    const errors=[],ids=new Set();
    for(const r of copies(s)){
      const refs=r.snapshot?.retainedPaydayPayments||[];
      if(!r.retainedPaydayCopy||!r.id||ids.has(r.id)||!refs.length||!Number.isFinite(+new Date(r.savedAt)))errors.push('Invalid retained-payday copy.');
      ids.add(r.id);
      if(new Set(refs.map(p=>p.id)).size!==refs.length)errors.push('A retained payment can appear only once per payslip.');
      const chain=copies(s).filter(x=>key(x)===key(r)),index=chain.indexOf(r);
      if(r.version!==index+1||(index>0&&r.supersedesId!==chain[index-1].id))errors.push('Keep the payday version history.');
      for(const p of refs)if(!same(p,(s.painterRetentionReceipts||[]).find(x=>x.id===p.id))||p.employeeId!==r.employeeId||!same(p.payrollPeriod,r.period)||p.receivedOn>r.period.releaseDate)errors.push('Invalid payday payment reference.');
      if(r.snapshot.retainedPaydayTotal!==W.sum(refs,'amount')||r.snapshot.paydayTotal!==W.money(r.snapshot.net+W.sum(refs,'amount')))errors.push('Retained amounts must be counted exactly once.');
    }
    for(const p of s.painterRetentionReceipts||[])if(p.payrollPeriod&&!latestCopies(s).some(r=>r.snapshot.retainedPaydayPayments.some(x=>x.id===p.id)))errors.push('Save the receipt and payslip together.');
    for(const old of copies(previous||{}))if(!same(old,copies(s).find(r=>r.id===old.id)))errors.push('Previous payday copies are read-only.');
    return [...new Set(errors)];
  }
  function covered(s,c){
    return new Set(latestCopies(s).filter(r=>r.employeeId===c.employee.id).flatMap(r=>r.snapshot.retainedPaydayPayments)
      .filter(p=>p.receivedOn<=c.period.releaseDate).map(p=>p.id));
  }
  function records(s,employeeId=''){
    const result=new Map(A.releasedRecords(s,employeeId).map(r=>[key(r),r]));
    for(const r of latestCopies(s).filter(r=>!employeeId||r.employeeId===employeeId)){
      const original=A.forWeek(s,r.employeeId,r.period);
      const versions=[...(original?[original]:[]),...copies(s).filter(x=>key(x)===key(r)&&x.id!==r.id)];
      result.set(key(r),{kind:'retained-payday',id:r.id,employeeId:r.employeeId,employeeName:r.snapshot.employee.name,
        period:r.period,releasedOn:r.releasedOn,record:r,versions});
    }
    return [...result.values()].sort((a,b)=>b.period.releaseDate.localeCompare(a.period.releaseDate));
  }
  return {target,receive,refresh,prepareSave,validate,current,covered,records,latestCopies};
});
