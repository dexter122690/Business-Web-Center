/* Append-only released copies. Owner corrections use the audited server action. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./workflow.js'),require('./simple-painter.js'));else root.PayslipArchive=factory(root.PayrollWorkflow,root.SimplePainter)})(typeof window!=='undefined'?window:this,function(W,S){
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function previousPayments(state,c){
    const earlier=S.latest(state,c.employee.id).filter(s=>s.period.end<c.period.start),ids=new Set(c.rows.map(r=>r.job.id));
    const replaced=p=>earlier.some(s=>W.inPeriod(p.date,s.period)&&s.snapshot.rows.some(r=>r.job.id===p.jobId));
    const out=state.payments.filter(p=>ids.has(p.jobId)&&p.date<c.period.start&&!replaced(p)).map(p=>({jobId:p.jobId,date:p.date,periodStart:p.periodStart||p.date,periodEnd:p.periodEnd||p.date,amount:W.money(p.gross-p.retention),note:'Recorded labor, less held'}));
    out.push(...state.releases.filter(p=>ids.has(p.jobId)&&p.date<c.period.start&&!replaced(p)).map(p=>({jobId:p.jobId,date:p.date,periodStart:p.date,periodEnd:p.date,amount:p.amount,note:'Recorded retention payment'})));
    for(const sheet of earlier)for(const r of sheet.snapshot.rows)if(ids.has(r.job.id)&&r.weekly)out.push({jobId:r.job.id,date:forWeek(state,sheet.employeeId,sheet.period)?.releasedOn||sheet.period.end,periodStart:sheet.period.start,periodEnd:sheet.period.end,amount:r.weekly,note:'Previous payroll entry'});
    return out.sort((a,b)=>a.date.localeCompare(b.date));
  }
  function enrich(state,record){
    const n=copy(record);
    if(n.snapshot.simpleTest&&!n.snapshot.previousPayments)n.snapshot.previousPayments=previousPayments(state,n.snapshot);
    if(n.snapshot.simpleTest&&!n.releasedCopy){
      const refs=(state.painterRetentionReceipts||[]).filter(p=>p.employeeId===n.employeeId&&p.receivedOn<=n.period.releaseDate&&n.snapshot.rows.some(r=>r.job.id===p.jobId));
      if(refs.length)n.snapshot.retentionReceipts=copy(refs);else delete n.snapshot.retentionReceipts;
      // Freeze the prior payday for printed/released copies, including holiday changes.
      n.retentionPreviousPayday=S.previousPayrollDate(state,n.snapshot);
    }
    return n;
  }
  function forWeek(state,employeeId,period){return (state.releasedPainterSlips||[]).find(r=>r.employeeId===employeeId&&r.period.start===period.start&&r.period.end===period.end)||null}
  function release(state,sourceId,id,date,savedAt=new Date().toISOString()){
    const source=(state.painterTestSheets||[]).find(s=>s.id===sourceId);if(!source)throw Error('Save the painter table first.');
    date=date??source.period.releaseDate;
    const old=forWeek(state,source.employeeId,source.period);if(old){if(old.sourceId!==sourceId)throw Error('This week already has a released copy. It stays locked except through the owner correction action.');return copy(state)}
    const latest=S.latest(state,source.employeeId).find(s=>s.period.start===source.period.start&&s.period.end===source.period.end);if(latest?.id!==sourceId)throw Error('This is an older saved copy. Open the latest saved table before releasing.');
    if(!W.validDate(date))throw Error('Choose a valid release date.');
    const n=copy(state),frozen=enrich(state,source);n.releasedPainterSlips=n.releasedPainterSlips||[];
    n.releasedPainterSlips.push({...frozen,id,sourceId,archivedAt:savedAt,releasedOn:date,releasedCopy:true});
    const errors=validate(n,state);if(errors.length)throw Error(errors[0]);return n;
  }
  function validate(state,previous){
    const rows=state.releasedPainterSlips;if(rows===undefined)return previous?.releasedPainterSlips?.length?['Released payslips must be preserved.']:[];
    if(!Array.isArray(rows))return ['Invalid released payslip archive.'];
    const ids=new Set(),weeks=new Set(),errors=[];
    for(const r of rows){const source=(state.painterTestSheets||[]).find(s=>s.id===r?.sourceId),k=r?.employeeId+':'+r?.period?.start+':'+r?.period?.end;
      if(!r?.id||ids.has(r.id)||weeks.has(k)||!r.releasedCopy||!W.validDate(r.releasedOn)||!Number.isFinite(+new Date(r.archivedAt))||!source||r.employeeId!==source.employeeId||!same(r.period,source.period)||!Array.isArray(r.snapshot?.previousPayments)){errors.push('Invalid released payslip.');continue}
      ids.add(r.id);weeks.add(k);const expected=copy(source.snapshot),actual=copy(r.snapshot);delete expected.previousPayments;delete actual.previousPayments;
      delete expected.retentionReceipts;delete actual.retentionReceipts;
      if(r.retentionPreviousPayday!==undefined&&!W.validDate(r.retentionPreviousPayday))errors.push('Invalid previous payroll date.');
      if(r.retentionPreviousPayday!==undefined&&previous&&!previous.releasedPainterSlips?.some(old=>old.id===r.id)&&r.retentionPreviousPayday!==S.previousPayrollDate(state,r.snapshot))errors.push('Keep the saved previous payroll date.');
      if(!same(expected,actual))errors.push('Released payslip must match its saved table.');
      for(const p of r.snapshot.retentionReceipts||[])if(!same(p,(state.painterRetentionReceipts||[]).find(x=>x.id===p.id))||p.employeeId!==r.employeeId||p.receivedOn>r.period.releaseDate||!r.snapshot.rows.some(x=>x.job.id===p.jobId))errors.push('Invalid retained-balance receipt reference.');
      for(const p of r.snapshot.previousPayments)if(!r.snapshot.rows.some(row=>row.job.id===p.jobId)||!W.validDate(p.date)||(p.periodEnd>=r.period.start||p.date>r.releasedOn)||!W.validDate(p.periodStart)||!W.validDate(p.periodEnd)||p.periodStart>p.periodEnd||!Number.isFinite(p.amount)||typeof p.note!=='string')errors.push('Invalid previous-payment reference.');
    }
    for(const old of previous?.releasedPainterSlips||[])if(!same(old,rows.find(r=>r.id===old.id)))errors.push('Released copies are read-only. Real owner accounts are required before edit/delete can be enabled.');
    return [...new Set(errors)];
  }
  function merge(previous,incoming){const n=copy(incoming);if(previous.releasedPainterSlips?.length||n.releasedPainterSlips?.length){n.releasedPainterSlips=n.releasedPainterSlips||[];for(const old of previous.releasedPainterSlips||[]){const found=n.releasedPainterSlips.find(r=>r.id===old.id);if(found&&!same(found,old))throw Error('Backup conflicts with a released payslip.');if(!found)n.releasedPainterSlips.push(copy(old))}}const errors=validate(n,previous);if(errors.length)throw Error(errors[0]);return n}
  function releasedRecords(state,employeeId=''){
    const confirmations=new Map((state.slipReleases||[]).map(r=>[r.slipId,r]));
    const rows=(state.payslips||[]).filter(r=>confirmations.has(r.id)).map(record=>({kind:'legacy',id:record.id,employeeId:record.employeeId,employeeName:record.snapshot.employee.name,period:record.period,releasedOn:confirmations.get(record.id).date,record}));
    rows.push(...(state.releasedPainterSlips||[]).filter(r=>r.releasedCopy).map(record=>({kind:'painter',id:record.id,employeeId:record.employeeId,employeeName:record.snapshot.employee.name,period:record.period,releasedOn:record.releasedOn,record})));
    return rows.filter(r=>!employeeId||r.employeeId===employeeId).sort((a,b)=>b.period.end.localeCompare(a.period.end)||b.releasedOn.localeCompare(a.releasedOn)||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
  }
  function archiveEmployees(state){
    const released=releasedRecords(state),releasedEmployeeIds=new Set(released.map(r=>r.employeeId));
    const people=new Map((state.employees||[]).filter(e=>!e.archived||releasedEmployeeIds.has(e.id)).map(e=>[e.id,{id:e.id,name:e.name}]));
    for(const r of released)if(!people.has(r.employeeId))people.set(r.employeeId,{id:r.employeeId,name:r.employeeName});
    return Array.from(people.values()).sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'})||a.id.localeCompare(b.id));
  }
  function folder(x){
    const {state,ui,esc,range,dateText}=x,people=archiveEmployees(state),person=people.find(e=>e.id===ui.historyEmployee);
    if(!person)return `<section class="released-browser"><h1>Released Payslips</h1><div class="released-name-list">${people.map(e=>`<button type="button" class="released-name" data-action="employee-history" data-id="${esc(e.id)}"><span>${esc(e.name)}</span><span aria-hidden="true">›</span></button>`).join('')||'<p class="empty">No employees yet.</p>'}</div></section>`;
    const rows=releasedRecords(state,person.id);
    return `<section class="released-browser"><button type="button" class="button secondary released-back" data-action="archive-home">← Employee names</button><h1>${esc(person.name)}</h1><div class="released-slip-list">${rows.map(r=>`<button type="button" class="released-slip-file" data-action="archive-open" data-kind="${r.kind}" data-id="${esc(r.id)}" aria-label="Open released payslip, ${esc(range(r.period))}, released ${esc(dateText(r.releasedOn))}"><span class="payslip-file-icon" aria-hidden="true">▤</span><span class="payslip-file-title"><strong>${esc(range(r.period))}</strong><small>Released ${esc(dateText(r.releasedOn))}</small></span><span class="payslip-file-action">Open / PDF</span></button>`).join('')||'<p class="empty">No released payslips yet.</p>'}</div></section>`;
  }
  return {previousPayments,enrich,forWeek,release,validate,merge,releasedRecords,archiveEmployees,folder};
});
