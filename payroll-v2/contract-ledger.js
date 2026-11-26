/* Dated contract changes are not payments. Released source sheets never change. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./workflow.js'));else root.PayrollContracts=factory(root.PayrollWorkflow)})(typeof window!=='undefined'?window:this,function(W){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x)),ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
  const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
  const money=n=>'₱'+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  function sheets(s){const m=new Map();for(const x of s.painterTestSheets||[])m.set(x.employeeId+':'+x.period.start+':'+x.period.end,x);return [...m.values()].sort((a,b)=>a.period.start.localeCompare(b.period.start))}
  function rows(s,e,id){return sheets(s).filter(x=>x.employeeId===e).flatMap(sheet=>sheet.snapshot.rows.filter(r=>r.job.id===id).map(row=>({sheet,row})))}
  const events=(s,e,id)=>(s.painterContractEvents||[]).filter(x=>x.employeeId===e&&x.jobId===id);
  const known=s=>s.filter(x=>x.row.job.contractPending!==true);
  function baseline(s,e,id){const ev=events(s,e,id);if(ev.length)return ev[0].baselineAmount;return known(rows(s,e,id)).at(-1)?.row.job.contract??null}
  function at(s,e,id,through,fallback){
    const history=events(s,e,id);if(!history.length)return fallback;
    // Historical snapshots before the first change retain their actual old terms.
    if(through<W.weeklyPeriod(history[0].effectiveOn).start&&fallback!==undefined)return fallback;
    let amount=history[0].baselineAmount;
    for(const x of history)if(W.weeklyPeriod(x.effectiveOn).start<=through)amount=x.kind==='addition'?W.money(amount+x.amount):x.amount;
    return amount;
  }
  function current(s,e,id){return at(s,e,id,'9999-12-31',baseline(s,e,id))}
  // Base job prices are permanent. Dated additions are separate contract events.
  function agreementItems(s,e,job,through){
    const original=job.agreedWorkItems;
    let items=original?copy(original):job.pricingSetup?copy(job.pricingSetup.items):[{description:job.work||'Existing labor agreement (not itemized)',amount:baseline(s,e,job.id)??job.contract??null}];
    for(const event of events(s,e,job.id).filter(x=>W.weeklyPeriod(x.effectiveOn).start<=through)){
      if(event.kind==='addition')items.push({description:event.description,amount:event.amount});
      else items=[{description:event.description,amount:event.amount}];
    }
    return items;
  }
  const locked=(s,sh)=>(s.releasedPainterSlips||[]).some(x=>x.sourceId===sh.id||(x.employeeId===sh.employeeId&&x.period.start===sh.period.start&&x.period.end===sh.period.end));
  function payments(s,e,id){const rr=rows(s,e,id),covered=p=>rr.some(x=>W.inPeriod(p.date,x.sheet.period));return [...rr.map(x=>({start:x.sheet.period.start,end:x.sheet.period.end,amount:x.row.weekly})),...(s.payments||[]).filter(p=>p.jobId===id&&!covered(p)).map(p=>({start:p.date,end:p.date,amount:W.money(p.gross-p.retention)})),...(s.releases||[]).filter(p=>p.jobId===id&&!covered(p)).map(p=>({start:p.date,end:p.date,amount:p.amount}))]}
  function createEvent(s,e,id,input,makeId,recordedAt=new Date().toISOString()){
    const event={id:makeId(),employeeId:e,jobId:id,kind:input.kind,amount:W.money(Number(input.amount)),effectiveOn:input.effectiveOn,description:String(input.description||'').trim(),reason:String(input.reason||'').trim(),baselineAmount:baseline(s,e,id),recordedAt,...(input.itemizedAgreement===true?{itemizedAgreement:true}:{})};
    return event;
  }
  function apply(s,event){
    const next=copy(s),e=event.employeeId,id=event.jobId,rr=rows(s,e,id),history=events(s,e,id),start=W.weeklyPeriod(event.effectiveOn).start;
    if(!rr.length)throw Error('Save the unit first, then record its contract change.');
    if(rr.some(x=>x.row.job.agreedWorkItems)&&event.kind!=='addition')throw Error('Saved job-order prices are locked. Add an additional job order for new work; existing lines cannot be replaced.');
    if(!['addition','correction','confirmation'].includes(event.kind)||!event.id||!Number.isFinite(event.amount)||event.amount<0||event.amount>999999999||W.money(event.amount)!==event.amount||!W.validDate(event.effectiveOn)||!Number.isFinite(+new Date(event.recordedAt)))throw Error('Enter a valid contract change, amount and date.');
    if(event.description.length<3||event.description.length>1000||event.reason.length<3||event.reason.length>1000)throw Error('Enter the work description and reason (3–1,000 characters each).');
    if(!same(event.baselineAmount,baseline(s,e,id)))throw Error('The agreed labor changed. Reload payroll and review the latest amount.');
    if((s.painterContractEvents||[]).some(x=>x.id===event.id))throw Error('This contract change was already recorded.');
    if(start<rr[0].sheet.period.start)throw Error('Use a date on or after this job’s first saved payroll week.');
    if(history.length&&event.effectiveOn<history.at(-1).effectiveOn)throw Error('Use a date on or after the latest contract change: '+history.at(-1).effectiveOn+'.');
    const before=current(s,e,id);
    if(event.kind==='addition'&&(before===null||event.amount<=0))throw Error('Confirm agreed labor first, then enter a positive additional job price.');
    if(event.kind==='confirmation'&&before!==null)throw Error('Agreed labor is already confirmed. Use Correct agreed labor.');
    if(event.kind==='correction'&&before===null)throw Error('Use Confirm agreed labor for an unpriced job.');
    if((s.painterRetentionReceipts||[]).some(p=>p.employeeId===e&&p.jobId===id))throw Error('The remaining balance was already received. Its contract and receipt history are locked; use a separate new transaction for new work.');
    const releasedOn=rr.at(-1).row.job.unitReleasedOn||rr.at(-1).row.job.releasedOn;
    if(event.kind==='addition'&&releasedOn&&event.effectiveOn>releasedOn)throw Error('This unit was released on '+releasedOn+'. Create a separate new transaction for later work.');
    next.painterContractEvents=[...(next.painterContractEvents||[]),copy(event)];
    const after=current(next,e,id);if(after>999999999)throw Error('Total agreed labor is too large.');
    const allPaid=W.money(W.sum(payments(s,e,id),'amount')+(rr.at(-1).row.job.priorSettlement||0));
    if(after<allPaid)throw Error('Total agreed labor cannot be below '+money(allPaid)+' already recorded across all payroll dates. No payment was changed.');
    for(const {sheet,row} of rows(next,e,id))if(sheet.period.start>=start){
      if(locked(s,sheet))throw Error('Payroll '+sheet.period.start+' to '+sheet.period.end+' has a released payslip. Use a later open effective week; the original cannot be rewritten.');
      const price=at(next,e,id,sheet.period.end,row.job.contractPending?null:row.job.contract);
      const paid=W.money((row.job.priorSettlement||0)+W.sum(payments(next,e,id).filter(p=>p.end<sheet.period.start),'amount'));
      if(price<paid+row.weekly)throw Error('The corrected amount is below payments already recorded by '+sheet.period.end+'.');
      row.job.contract=price;delete row.job.contractPending;delete row.previousRecorded;
      row.opening=W.money(price-paid);row.remaining=W.money(row.opening-row.weekly);
      if(row.weeklyManual||row.job.agreedWorkItems||event.itemizedAgreement){row.weeklyManual=true;row.agreementItems=agreementItems(next,e,row.job,sheet.period.end)}
      sheet.snapshot.jobs=sheet.snapshot.rows.map(r=>copy(r.job));
    }
    return next;
  }
  function validate(next,old){
    const errors=[],list=next.painterContractEvents||[];
    if(!Array.isArray(list))return ['Invalid contract history.'];
    const ids=new Set();for(const x of list){if(!x||!x.id||ids.has(x.id)||!['addition','correction','confirmation'].includes(x.kind)||!Number.isFinite(x.amount)||x.amount<0||x.amount>999999999||W.money(x.amount)!==x.amount||!W.validDate(x.effectiveOn)||!Number.isFinite(+new Date(x.recordedAt))||!rows(next,x.employeeId,x.jobId).length)errors.push('Invalid contract history entry.');ids.add(x?.id)}
    if(!old)return errors;
    for(const sheet of sheets(next))for(const r of sheet.snapshot.rows){const previous=rows(old,sheet.employeeId,r.job.id).at(-1)?.row.job;if(previous&&((previous.transactionRef||'')!==(r.job.transactionRef||'')||(previous.separateJobReason||'')!==(r.job.separateJobReason||'')))errors.push('Keep the saved transaction reference and reason. A new visit needs a separate job.');}
    const prior=old.painterContractEvents||[];
    if(!same(list.slice(0,prior.length),prior))errors.push('Contract history is permanent. Record a new correction instead of removing or changing an old entry.');
    const added=list.slice(prior.length);
    if(added.length>1)errors.push('Save one contract change at a time.');
    if(added.length===1){try{const expected=apply(old,added[0]),a=copy(expected),b=copy(next);delete a.period;delete b.period;if(!same(a,b))errors.push('Save table changes separately from the contract change. Payments and released copies must remain unchanged.')}catch(e){errors.push(e.message)}}
    return errors;
  }
  const identity=j=>j.invoice?.trim()&&j.plate?.trim()?[j.invoice.trim().toUpperCase(),j.plate.trim().toUpperCase()].join('|'):'';
  function jobs(s,e){const m=new Map();for(const {snapshot} of sheets(s).filter(x=>x.employeeId===e))for(const r of snapshot.rows)m.set(r.job.id,r.job);return [...m.values()]}
  const matches=(s,e,j)=>identity(j)?jobs(s,e).filter(x=>identity(x)===identity(j)):[];
  function separateAllowed(s,e,j){
    if(!j.transactionRef?.trim()||j.transactionRef.length>80||!j.separateJobReason?.trim()||j.separateJobReason.trim().length<5||j.separateJobReason.length>1000)return false;
    const others=matches(s,e,j).filter(x=>x.id!==j.id);
    return others.length>0&&others.every(x=>x.transactionRef?.trim().toUpperCase()!==j.transactionRef.trim().toUpperCase()&&(x.closed||x.retentionStatus==='retained')&&Boolean(x.unitReleasedOn||x.releasedOn)&&(x.unitReleasedOn||x.releasedOn)<=s.period.end);
  }
  function summary(s,e,id){const rr=rows(s,e,id),j=rr.at(-1)?.row.job;if(!j)return null;const paid=W.money(W.sum(payments(s,e,id),'amount')+(j.priorSettlement||0)+W.sum((s.painterRetentionReceipts||[]).filter(p=>p.employeeId===e&&p.jobId===id),'amount'));return {job:j,baseline:baseline(s,e,id),total:current(s,e,id),paid,remaining:current(s,e,id)===null?null:W.money(current(s,e,id)-paid),events:events(s,e,id),payments:payments(s,e,id),rows:rr}}
  return {rows,events,baseline,at,current,agreementItems,locked,payments,createEvent,apply,validate,identity,matches,separateAllowed,summary,money,same};
});
