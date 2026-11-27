/* Read-only cash planning. Never creates payments, receipts or payslip releases. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./workflow.js'),require('./simple-painter.js'),require('./payslip-archive.js'));
  else root.PayrollCashSummary=factory(root.PayrollWorkflow,root.SimplePainter,root.PayslipArchive);
})(typeof window==='undefined'?this:window,function(W,S,A){
  'use strict';
  const sameWeek=(a,b)=>a.start===b.start&&a.end===b.end;
  // On Saturday, show the payday TODAY, not the following Saturday.
  function currentPeriod(today=S.manilaDay()){
    const p=W.weeklyPeriod(today);
    return today===p.start?W.weeklyPeriod(W.addDays(today,-1)):p;
  }
  const positive=n=>Math.max(0,W.money(n));
  function calculate(state,reference=currentPeriod().start,{includeDue=true}={}){
    const period=W.selectWeek(state,reference).period,rows=[];
    for(const e of state.employees){
      const selected=W.selectWeek(state,period.start,e.id);
      const sheet=S.latest(state,e.id).find(r=>sameWeek(r.period,period));
      const legacy=state.payslips.find(r=>r.employeeId===e.id&&sameWeek(r.period,period));
      const release=e.type==='contract'?A.forWeek(state,e.id,period):null;
      const saved=e.type==='contract'?(release||sheet||legacy):legacy;
      const snapshot=saved?.snapshot||(e.type==='contract'?S.view(selected,e.id).snapshot:W.calculate(selected,e.id));
      const payday=saved?.period.releaseDate||selected.period.releaseDate;
      const weeklyReleased=Boolean(release||(legacy&&state.slipReleases.some(r=>r.slipId===legacy.id)));
      const weeklyNet=W.money(snapshot.net),weeklyCash=positive(weeklyNet),warnings=[];
      const receipts=[...new Map((state.painterRetentionReceipts||[]).filter(p=>p.employeeId===e.id&&
        (p.payrollPeriod?sameWeek(p.payrollPeriod,period):p.receivedOn<=payday&&p.receivedOn>S.previousPayrollDate(state,{employee:e,period:{...period,releaseDate:payday}}))).map(p=>[p.id,p])).values()];
      const receivedRetained=W.sum(receipts,'amount'),dueUnits=[];
      if(e.type==='contract')for(const j of S.jobs(state,e.id)){
        if(!S.isReleased(j)||(state.painterRetentionReceipts||[]).some(p=>p.employeeId===e.id&&p.jobId===j.id))continue;
        const due=S.retentionDue(j);if(!due||due>payday)continue;
        const last=S.latest(state,e.id).sort((a,b)=>b.period.start.localeCompare(a.period.start)).flatMap(s=>s.snapshot.rows.filter(r=>r.job.id===j.id))[0];
        if(last&&!S.pending(last.job)&&last.remaining<=0)continue;
        try{const basis=S.receiptBasis(state,e.id,j.id);dueUnits.push({id:j.id,unit:j.unit,plate:j.plate||'',due,amount:basis.amount})}
        catch(error){warnings.push((j.unit||'Retained unit')+': balance needs review before cash can be included.')}
      }
      const dueRetained=W.sum(dueUnits,'amount');
      const hasEntries=Boolean(saved||weeklyNet||receivedRetained||dueRetained||
        (e.type==='daily'&&state.attendance.some(r=>r.employeeId===e.id&&W.inPeriod(r.date,period))));
      if(e.archived&&!hasEntries&&!warnings.length)continue;
      if(!saved&&e.type==='contract')warnings.push('No saved weekly table yet.');
      if(!saved&&e.type==='daily'&&snapshot.attendance.some(r=>r.status==='unset'))warnings.push('Attendance is incomplete.');
      if(weeklyNet<0)warnings.push('Deductions exceed earnings. This does not reduce another employee’s cash.');
      const remainingWeekly=weeklyReleased?0:weeklyCash;
      rows.push({id:e.id,name:e.name,type:e.type,archived:Boolean(e.archived),payday,weeklyNet,weeklyCash,weeklyReleased,
        receivedRetained,dueRetained,dueUnits,remainingWeekly,cashToPrepare:W.money(remainingWeekly+(includeDue?dueRetained:0)),warnings,
        status:weeklyReleased?'Release recorded':saved?'Saved payroll':e.type==='daily'?'From saved attendance':'Not saved'});
    }
    const total=field=>W.sum(rows,field),weekly=total('weeklyCash'),receivedRetained=total('receivedRetained');
    const releasedWeekly=W.money(weekly-total('remainingWeekly'));
    return {period,rows,includeDue,totalPayroll:W.money(weekly+receivedRetained+(includeDue?total('dueRetained'):0)),weekly,receivedRetained,releasedWeekly,
      recorded:W.money(releasedWeekly+receivedRetained),dueRetained:total('dueRetained'),cashToPrepare:total('cashToPrepare'),
      incomplete:rows.filter(r=>r.warnings.length).length};
  }
  function render(x){
    const {state,ui,esc,peso,dateText,range}=x,data=calculate(state,ui.cashWeek||currentPeriod().start,{includeDue:ui.cashIncludeDue!==false});
    const paydays=[...new Set(data.rows.map(r=>r.payday))].sort(),payday=paydays.length===1?paydays[0]:data.period.releaseDate;
    return `<section class="payroll-cash-summary" aria-labelledby="cashSummaryTitle"><div class="cash-summary-heading"><div><span class="eyebrow">SELECTED BRANCH · SATURDAY PAYROLL</span><h2 id="cashSummaryTitle">Cash to prepare</h2><p class="cash-cutoff">${esc(range(data.period))}</p><p>Payday: <strong>${esc(dateText(payday,{weekday:'long',month:'short',day:'numeric',year:'numeric'}))}</strong>${paydays.length>1?' · Some employees have a different saved payday; see breakdown.':''}</p></div><div class="cash-summary-total"><strong>${peso(data.cashToPrepare)}</strong><span>Still to prepare${data.includeDue?' · includes due retained balances':''}</span></div></div><div class="cash-week-controls"><button class="button secondary" type="button" data-action="cash-previous" aria-label="Previous payroll cutoff">← Previous</button><button class="button secondary" type="button" data-action="cash-current">Current payday</button><button class="button secondary" type="button" data-action="cash-next" aria-label="Next payroll cutoff">Next →</button><label>Choose cutoff<input id="cashSummaryWeek" type="date" value="${data.period.start}" aria-label="Choose payroll cutoff"></label></div><div class="cash-summary-metrics"><div><span>Total payroll</span><b>${peso(data.totalPayroll)}</b><small>Net weekly pay + retained payments (received${data.includeDue?' and due':''})</small></div><div><span>Release / receipt recorded</span><b>${peso(data.recorded)}</b><small>Excluded from cash still to prepare</small></div><div><span>Retained balances due by payday</span><b>${peso(data.dueRetained)}</b><small>Outstanding now · not yet marked Received</small></div></div><label class="cash-due-option"><input id="cashIncludeDue" type="checkbox" ${data.includeDue?'checked':''}> Include due retained balances in cash to prepare</label><p class="cash-summary-note">Based on saved entries only. Cash advances and late deductions are already deducted. This summary does not record a payment, release a payslip, or unlock retention before 45 days.</p>${data.incomplete?`<p class="cash-summary-warning" role="status">${data.incomplete} employee${data.incomplete===1?'':'s'} need review / completion. The amount may increase as you finish encoding.</p>`:''}<details class="cash-summary-details"><summary>View employee breakdown (${data.rows.length})</summary><div class="table-wrap"><table><thead><tr><th>Employee / payday</th><th>Net weekly pay</th><th>Retained received</th><th>Retained due</th><th>Cash to prepare</th><th>Status</th></tr></thead><tbody>${data.rows.map(r=>`<tr><td><button class="link-btn" data-action="employee-payroll" data-id="${esc(r.id)}">${esc(r.name)}</button><small>${esc(dateText(r.payday))}${r.archived?' · Former employee':''}</small></td><td>${peso(r.weeklyNet)}</td><td>${peso(r.receivedRetained)}</td><td>${peso(r.dueRetained)}</td><td><b>${peso(r.cashToPrepare)}</b></td><td>${esc(r.status)}${r.warnings.map(w=>`<small class="cash-row-warning">${esc(w)}</small>`).join('')}</td></tr>`).join('')||'<tr><td colspan="6">No employees or payroll entries for this cutoff.</td></tr>'}</tbody></table></div></details></section>`;
  }
  return {currentPeriod,calculate,render};
});
