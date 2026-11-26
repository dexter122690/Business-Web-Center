/* Cross-date checks for one employee/job. No persistence or inferred payments. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./workflow.js'),require('./contract-ledger.js'));else root.PainterLedger=factory(root.PayrollWorkflow,root.PayrollContracts)})(typeof window!=='undefined'?window:this,function(W,K){
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),cents=W.cents;
  const moneyText=n=>'₱'+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  function sheets(s){const m=new Map();for(const x of s.painterTestSheets||[])m.set(x.employeeId+':'+x.period.start+':'+x.period.end,x);return [...m.values()].sort((a,b)=>a.period.start.localeCompare(b.period.start))}
  function entries(s,e,id){return sheets(s).filter(x=>x.employeeId===e).flatMap(sheet=>sheet.snapshot.rows.filter(r=>r.job.id===id).map(row=>({sheet,row})))}
  function payments(s,e,id){
    const rows=entries(s,e,id),covered=p=>rows.some(x=>W.inPeriod(p.date,x.sheet.period));
    return [...rows.map(x=>({start:x.sheet.period.start,end:x.sheet.period.end,amount:x.row.weekly})),
      ...(s.payments||[]).filter(p=>p.jobId===id&&!covered(p)).map(p=>({start:p.date,end:p.date,amount:W.money(p.gross-p.retention)})),
      ...(s.releases||[]).filter(p=>p.jobId===id&&!covered(p)).map(p=>({start:p.date,end:p.date,amount:p.amount}))].sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
  }
  const paidBefore=(s,e,id,start)=>W.money(payments(s,e,id).filter(p=>p.end<start).reduce((sum,p)=>sum+cents(p.amount),0)/100);
  function fingerprint(s,e,id){return JSON.stringify({rows:entries(s,e,id).map(({sheet,row:r})=>[sheet.period.start,sheet.period.end,r.weekly,r.job.contract,r.job.contractPending===true,r.job.priorSettlement||0,r.job.payrollStart||'',r.opening,r.remaining,r.previousRecorded,identity(r.job)]),payments:payments(s,e,id),receipts:(s.painterRetentionReceipts||[]).filter(p=>p.employeeId===e&&p.jobId===id)})}
  function affected(s,old){const candidates=new Map();for(const x of [...sheets(s),...sheets(old||{})])for(const r of x.snapshot.rows)candidates.set(x.employeeId+':'+r.job.id,{employeeId:x.employeeId,id:r.job.id});return [...candidates.values()].filter(({employeeId:e,id})=>!old||fingerprint(s,e,id)!==fingerprint(old,e,id))}
  function safeEarlierAnchor(old,e,id,start,amount){
    const rows=entries(old,e,id);
    return amount===0&&rows.length>0&&rows.every(({sheet,row})=>(row.job.priorSettlement||0)===0&&row.job.payrollStart&&row.job.payrollStart>start&&sheet.period.start>start)
      &&!(old.releasedPainterSlips||[]).some(s=>s.employeeId===e&&s.snapshot.rows.some(r=>r.job.id===id))
      &&!(old.painterRetentionReceipts||[]).some(p=>p.employeeId===e&&p.jobId===id);
  }
  function locked(s,sheet){return (s.releasedPainterSlips||[]).some(x=>x.sourceId===sheet.id||(x.employeeId===sheet.employeeId&&x.period.start===sheet.period.start&&x.period.end===sheet.period.end))}
  function reconcile(next,old,e,ids){
    for(const id of ids){
      const rows=entries(next,e,id),first=rows[0];if(!first)continue;
      // A zero opening marker may move earlier for an explicitly linked old week.
      const start=first.row.job.payrollStart;
      for(const {sheet,row:r} of rows){
        const proposed=copy(r);
        if(start&&r.job.payrollStart!==start){
          if(!safeEarlierAnchor(old,e,id,start,first.row.job.priorSettlement))throw Error('This unit has a locked starting balance. Review its earlier settlement before backdating.');
          proposed.job.payrollStart=start;
        }
        const paid=W.money((proposed.job.priorSettlement||0)+paidBefore(next,e,id,sheet.period.start));
        if(proposed.job.contractPending===true){proposed.opening=null;proposed.remaining=null;proposed.previousRecorded=paid}
        else{proposed.opening=W.money(proposed.job.contract-paid);proposed.remaining=W.money(proposed.opening-proposed.weekly);delete proposed.previousRecorded}
        if(!same(r,proposed)){
          if(locked(old,sheet))throw Error('A later released payslip would change. Use an owner-reviewed correction; its saved copy stays locked.');
          Object.assign(r,proposed);if(proposed.previousRecorded===undefined)delete r.previousRecorded;
          sheet.snapshot.jobs=sheet.snapshot.rows.map(x=>copy(x.job));delete sheet.snapshot.previousPayments;
        }
      }
    }
  }
  const identity=j=>j.invoice?.trim()&&j.plate?.trim()?[j.invoice.trim().toUpperCase(),j.plate.trim().toUpperCase()].join('|'):'';
  function check(next,old){
    // Existing historical exceptions must not make payroll unreadable on open.
    if(!old)return [];
    const errors=[];
    for(const {employeeId:e,id} of affected(next,old)){
      const rows=entries(next,e,id);if(!rows.length)continue;
      const known=rows.filter(x=>x.row.job.contractPending!==true),j=rows.at(-1).row.job;
      const knownBefore=entries(old,e,id).filter(x=>x.row.job.contractPending!==true);
      if(!known.length&&knownBefore.length)errors.push('An already confirmed agreed labor cannot be cleared. Keep the contract or review a correction.');
      if(known.length){
        const managed=K.events(next,e,id).length>0,cap=managed?K.current(next,e,id):known.at(-1).row.job.contract;
        if(!managed&&known.some(x=>cents(x.row.job.contract)!==cents(cap)))errors.push(j.unit+': keep the same agreed labor ('+moneyText(cap)+') for this job across all dates. Use Correct agreed labor for a mistake, or Add additional job order for new work.');
        for(const {sheet,row:r} of known){
          const before=knownBefore.find(x=>x.sheet.period.start===sheet.period.start)?.row.job.contract??K.baseline(old,e,id);
          const expected=managed?K.at(next,e,id,sheet.period.end,before):before;
          if(expected!==null&&expected!==undefined&&cents(r.job.contract)!==cents(expected))errors.push(j.unit+': agreed labor for '+sheet.period.start+' to '+sheet.period.end+' is '+moneyText(expected)+'. Use the contract correction or additional-job button; do not replace it in the weekly table.');
        }
        const paid=payments(next,e,id).reduce((sum,p)=>sum+cents(p.amount),0)+cents(j.priorSettlement||0)+(next.painterRetentionReceipts||[]).filter(p=>p.employeeId===e&&p.jobId===id).reduce((sum,p)=>sum+cents(p.amount),0);
        if(paid>cents(cap)){
          const current=rows.find(x=>x.sheet.period.start===next.period.start),max=Math.max(0,cents(cap)-paid+cents(current?.row.weekly||0))/100;
          errors.push(j.unit+': payments across all dates exceed agreed labor '+moneyText(cap)+'. Maximum amount for this week: '+moneyText(max)+'. Earlier/later payments and received retention are included.');
        }
      }
      for(const {sheet,row:r} of rows){
        const prior=W.money((r.job.priorSettlement||0)+paidBefore(next,e,id,sheet.period.start));
        if(r.job.contractPending===true?cents(r.previousRecorded)!==cents(prior):cents(r.opening)!==cents(r.job.contract-prior)||cents(r.remaining)!==cents(r.opening-r.weekly))errors.push(j.unit+': balance does not match payments on other dates.');
        if(r.job.contractPending!==true&&r.remaining<0)errors.push(j.unit+': payments by '+sheet.period.end+' exceed the agreed labor effective in that week. Later additional work cannot fund an earlier payment.');
      }
      for(const released of old.releasedPainterSlips||[])if(released.employeeId===e&&released.snapshot.rows.some(r=>r.job.id===id)){
        const history=s=>payments(s,e,id).filter(p=>p.end<released.period.start&&p.amount!==0);
        if(!same(history(next),history(old)))errors.push('A later released payslip includes this payment history. Use an owner-reviewed correction; the original copy is locked.');
      }
      // Exact invoice + plate identifies an existing job, never the model name alone.
      const oldKeys=new Set(entries(old,e,id).map(x=>identity(x.row.job)));
      if(!oldKeys.has(identity(j))&&identity(j)&&!K.separateAllowed(next,e,j))for(const x of sheets(next).filter(x=>x.employeeId===e))if(x.snapshot.rows.some(r=>r.job.id!==id&&identity(r.job)===identity(j)))errors.push(j.unit+': matching invoice and plate found. Review the matching-job panel and choose “Continue this job”; for genuinely new work after release, enter a separate transaction reference and reason.');
    }
    return [...new Set(errors)];
  }
  return {sheets,entries,payments,paidBefore,affected,safeEarlierAnchor,reconcile,check,identity};
});
