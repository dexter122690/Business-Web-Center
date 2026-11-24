/* One working painter worksheet per employee/week; released snapshots stay fixed. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./workflow.js'));else root.SimplePainter=factory(root.PayrollWorkflow)})(typeof window!=='undefined'?window:this,function(W){
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const key=p=>p.start+':'+p.end;
  const sheetKey=s=>s.employeeId+':'+key(s.period);
  const pending=job=>job.contractPending===true;
  const balanceText=(row,peso,field='remaining')=>pending(row.job)?'Pending confirmation':peso(row[field]);
  const previousRecorded=row=>row.previousRecorded??W.money(row.job.contract-row.opening);
  // Keep the same last-in-array winner used by the original weekly calculations.
  // Retain any older source referenced by a released PDF, without displaying it.
  function compact(state){
    const next=copy(state),groups=new Map(),sources=new Set((state.releasedPainterSlips||[]).map(r=>r.sourceId));
    for(const s of state.painterTestSheets||[]){const k=sheetKey(s);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(s)}
    next.painterTestSheets=[...groups.values()].flatMap(rows=>rows.filter((s,i)=>i===rows.length-1||sources.has(s.id))).map(copy);
    return next;
  }
  function number(value,label){const n=value===''||value==null?0:Number(value);if(!Number.isFinite(n)||n<0||n>999999999)throw Error(label+' must be a valid non-negative number.');return W.money(n)}
  function latest(state,employeeId){const weeks=new Map();for(const s of state.painterTestSheets||[])if(s.employeeId===employeeId)weeks.set(key(s.period),s);return [...weeks.values()]}
  function savedFor(state,employeeId){return latest(state,employeeId).find(s=>key(s.period)===key(state.period))||null}
  function startingEditable(state,employeeId,job){
    if(!job.id)return true;
    if(job.payrollStart&&job.payrollStart!==state.period.start)return false;
    if([...state.payments,...state.releases].some(p=>p.jobId===job.id))return false;
    if((state.releasedPainterSlips||[]).some(s=>s.snapshot.rows.some(r=>r.job.id===job.id)))return false;
    return !latest(state,employeeId).some(s=>key(s.period)!==key(state.period)&&s.snapshot.rows.some(r=>r.job.id===job.id));
  }
  function jobs(state,employeeId){const items=new Map(state.jobs.filter(j=>j.employeeId===employeeId).map(j=>[j.id,copy(j)]));for(const s of latest(state,employeeId).sort((a,b)=>a.period.start.localeCompare(b.period.start)))for(const row of s.snapshot.rows)items.set(row.job.id,copy(row.job));return [...items.values()]}
  function originalAmount(state,jobId,period){return W.money(W.sum(state.payments.filter(p=>p.jobId===jobId&&W.inPeriod(p.date,period)),'gross')-W.sum(state.payments.filter(p=>p.jobId===jobId&&W.inPeriod(p.date,period)),'retention')+W.sum(state.releases.filter(p=>p.jobId===jobId&&W.inPeriod(p.date,period)),'amount'))}
  function snapshot(state,employeeId,rows,cashAdvance){
    const employee=state.employees.find(e=>e.id===employeeId&&e.type==='contract');if(!employee)throw Error('Choose a painter first.');
    const basic=W.sum(rows,'weekly');return copy({simpleTest:true,employee:W.payslipEmployee(employee),period:state.period,rules:state.rules,rows,cashAdvance,basic,net:W.money(basic-cashAdvance),late:0,held:0,retentionReleased:0,attendance:[],portions:[],releases:[],advances:[],retentionAccounts:[],warnings:[],jobs:rows.map(r=>r.job)});
  }
  function view(state,employeeId){
    const saved=savedFor(state,employeeId);if(saved)return {saved,snapshot:copy(saved.snapshot)};
    const earlier=latest(state,employeeId).filter(s=>s.period.end<state.period.start);
    const rows=jobs(state,employeeId).filter(job=>!job.payrollStart||job.payrollStart<=state.period.start).map(job=>{
      let prior=originalAmount(state,job.id,{start:'0001-01-01',end:W.addDays(state.period.start,-1)});
      for(const sheet of earlier){const row=sheet.snapshot.rows.find(r=>r.job.id===job.id);if(row)prior=W.money(prior+row.weekly-originalAmount(state,job.id,sheet.period))}
      const recorded=W.money((job.priorSettlement||0)+prior),opening=pending(job)?null:W.money(job.contract-recorded),weekly=originalAmount(state,job.id,state.period);
      return {job,opening,weekly,remaining:pending(job)?null:W.money(opening-weekly),...(pending(job)?{previousRecorded:recorded}:{})};
    });
    const cashAdvance=W.sum(state.advances.filter(a=>a.employeeId===employeeId&&W.inPeriod(a.date,state.period)),'amount');
    return {saved:null,snapshot:snapshot(state,employeeId,rows,cashAdvance)};
  }
  function draft(state,employeeId,inputs,cashAdvance,makeId){
    const base=view(state,employeeId).snapshot,seen=new Set(),rows=[];
    for(const input of inputs){
      if(!input.id&&!['unit','year','plate','invoice','color','work','contract','priorSettlement','weekly'].some(k=>String(input[k]??'').trim()))continue;
      const old=base.rows.find(r=>r.job.id===input.id);
      if(input.id&&(!old||seen.has(input.id)))throw Error('Check the selected unit.');
      const job=old?copy(old.job):{id:makeId(),employeeId,unit:'',year:'',plate:'',invoice:'',color:'',work:'',contract:0};seen.add(job.id);
      for(const [field,max] of [['unit',120],['year',10],['plate',30],['invoice',60],['color',70],['work',1000]]){
        if(input[field]===undefined)continue;const value=String(input[field]).trim();if(value.length>max)throw Error('Please shorten the '+field+' field.');job[field]=field==='plate'?value.toUpperCase():value;
      }
      if(!job.unit)throw Error('Enter a unit name in the new row, or leave that row blank.');
      const unconfirmed=input.contractPending===undefined?pending(job):input.contractPending===true;
      if(unconfirmed){job.contractPending=true;job.contract=null}
      else{
        if(pending(job)&&(input.contract===undefined||String(input.contract).trim()===''))throw Error('Enter the confirmed agreed labor, or keep Agreed price not yet confirmed selected.');
        job.contract=input.contract===undefined?job.contract:number(input.contract,'Agreed labor');delete job.contractPending;
      }
      const settled=input.priorSettlement===undefined?(job.priorSettlement||0):number(input.priorSettlement,'Settled before BWC');
      if(settled!==(job.priorSettlement||0)&&!startingEditable(state,employeeId,job))throw Error('Starting balance is locked because this unit has other payroll records. Do not enter old payments as this week’s pay.');
      if(!pending(job)&&settled>job.contract)throw Error('Settled before BWC cannot exceed the original agreed labor.');
      if(settled||job.payrollStart||(!old&&pending(job))){job.priorSettlement=settled;job.payrollStart=job.payrollStart||state.period.start}
      if(input.retentionStatus!==undefined){if(!['ongoing','retained'].includes(input.retentionStatus))throw Error('Choose Ongoing or Retained.');job.retentionStatus=input.retentionStatus}
      for(const field of ['unitReleasedOn','retentionDue'])if(input[field]!==undefined){if(input[field]&&!W.validDate(input[field]))throw Error('Choose a valid reference release date.');job[field]=input[field]}
      const weekly=number(input.weekly,'Amount this week'),recorded=W.money((old?previousRecorded(old):0)+settled-(old?.job.priorSettlement||0)),opening=pending(job)?null:W.money(job.contract-recorded);
      rows.push({job,opening,weekly,remaining:pending(job)?null:W.money(opening-weekly),...(pending(job)?{previousRecorded:recorded}:{})});
    }
    // An incomplete UI payload must never silently remove an existing unit.
    for(const old of base.rows)if(!seen.has(old.job.id))rows.push(copy(old));
    return snapshot(state,employeeId,rows,number(cashAdvance,'Cash advance'));
  }
  function save(state,employeeId,inputs,cashAdvance,makeId,savedAt=new Date().toISOString()){
    if((state.releasedPainterSlips||[]).some(r=>r.employeeId===employeeId&&key(r.period)===key(state.period)))throw Error('This week has a released payslip. It is locked except through the owner correction action.');
    const next=compact(state),record=snapshot(state,employeeId,[],0),data=draft(state,employeeId,inputs,cashAdvance,makeId),old=savedFor(state,employeeId);
    if(old&&same(old.snapshot,data))return next;
    next.painterTestSheets=next.painterTestSheets||[];
    const sheet={id:old?.id||makeId(),employeeId,period:record.period,savedAt,snapshot:data};
    const index=next.painterTestSheets.findIndex(s=>s.id===sheet.id);
    if(index<0)next.painterTestSheets.push(sheet);else next.painterTestSheets[index]=sheet;
    const errors=validate(next,state);if(errors.length)throw Error(errors[0]);return next;
  }
  // Explicitly clear only this working week; original ledgers and releases remain.
  function emptyTable(state,employeeId,makeId,savedAt=new Date().toISOString()){
    if((state.releasedPainterSlips||[]).some(r=>r.employeeId===employeeId&&key(r.period)===key(state.period)))throw Error('This week has a released payslip. It is locked except through the owner correction action.');
    const current=view(state,employeeId),next=compact(state);
    if(!current.snapshot.rows.length&&!current.snapshot.cashAdvance)return next;
    next.painterTestSheets=next.painterTestSheets||[];
    const data=snapshot({...state,period:current.snapshot.period},employeeId,[],0);
    const sheet={id:current.saved?.id||makeId(),employeeId,period:copy(data.period),savedAt,snapshot:data},index=next.painterTestSheets.findIndex(s=>s.id===sheet.id);
    if(index<0)next.painterTestSheets.push(sheet);else next.painterTestSheets[index]=sheet;
    const errors=validate(next,state);if(errors.length)throw Error(errors[0]);return next;
  }
  function validate(state,previous){
    if(state.painterTestSheets===undefined)return previous?.painterTestSheets?.length?['Saved test sheets must be preserved.']:[];
    if(!Array.isArray(state.painterTestSheets))return ['Invalid saved test sheets.'];
    const ids=new Set(),errors=[];
    for(const s of state.painterTestSheets){
      const c=s?.snapshot;
      if(!s?.id||ids.has(s.id)||!state.employees.some(e=>e.id===s.employeeId)||!W.isWeeklyPeriod(s.period)||!Number.isFinite(+new Date(s.savedAt))||!c?.simpleTest||c.employee?.id!==s.employeeId||c.employee?.type!=='contract'||!same(c.period,s.period)||!Array.isArray(c.rows)){errors.push('Invalid saved test sheet.');continue}
      ids.add(s.id);const unitIds=new Set();
      for(const r of c.rows){
        const unknown=r.job&&pending(r.job),amounts=unknown?r.job.contract===null&&r.opening===null&&r.remaining===null&&Number.isFinite(r.previousRecorded)&&r.previousRecorded>=0:[r.job?.contract,r.opening,r.remaining].every(Number.isFinite)&&r.job.contract>=0&&W.cents(r.remaining)===W.cents(r.opening-r.weekly);
        if(!r.job?.id||unitIds.has(r.job.id)||r.job.employeeId!==s.employeeId||!['unit','plate','color','work','invoice'].every(k=>typeof (r.job[k]??'')==='string')||!r.job.unit?.trim()||!amounts||!Number.isFinite(r.weekly)||r.weekly<0||(r.job.contractPending!==undefined&&typeof r.job.contractPending!=='boolean'))errors.push('Invalid saved test row.');unitIds.add(r.job?.id);
      }
      for(const r of c.rows)if((r.job.retentionStatus!==undefined&&!['ongoing','retained'].includes(r.job.retentionStatus))||['unitReleasedOn','retentionDue'].some(k=>r.job[k]&&!W.validDate(r.job[k])))errors.push('Invalid retention reference.');
      for(const {job:j} of c.rows)if(j.priorSettlement!==undefined||j.payrollStart!==undefined){
        if(!Number.isFinite(j.priorSettlement)||j.priorSettlement<0||(!pending(j)&&j.priorSettlement>j.contract)||!W.validDate(j.payrollStart)||W.weeklyPeriod(j.payrollStart).start!==j.payrollStart||j.payrollStart>s.period.start)errors.push('Invalid pre-BWC starting balance.');
      }
      if(![c.basic,c.cashAdvance,c.net].every(Number.isFinite)||c.cashAdvance<0||W.cents(c.basic)!==W.cents(W.sum(c.rows,'weekly'))||W.cents(c.net)!==W.cents(c.basic-c.cashAdvance))errors.push('Saved test totals do not match.');
    }
    for(const old of previous?.painterTestSheets||[]){
      const replacement=state.painterTestSheets.find(s=>s.id===old.id);
      if(replacement&&sheetKey(replacement)!==sheetKey(old))errors.push('A worksheet cannot be moved to another employee or week.');
      if(!state.painterTestSheets.some(s=>sheetKey(s)===sheetKey(old)))errors.push('Keep one working worksheet for every saved week.');
      const released=(previous.releasedPainterSlips||[]).some(r=>sheetKey(r)===sheetKey(old));
      if(released&&replacement&&!same(old,replacement))errors.push('Released weeks are locked. Use the owner correction action.');
      if((previous.releasedPainterSlips||[]).some(r=>r.sourceId===old.id)&&!same(old,replacement))errors.push('Released worksheet sources must be preserved.');
    }
    const oldLatest=new Map((previous?.painterTestSheets||[]).map(s=>[sheetKey(s),s])),newLatest=new Map(state.painterTestSheets.map(s=>[sheetKey(s),s]));
    for(const s of newLatest.values())for(const r of s.snapshot.rows)if(pending(r.job)){
      const paid=[...newLatest.values()].filter(p=>p.employeeId===s.employeeId&&p.period.end<s.period.start).reduce((total,p)=>total+W.sum(p.snapshot.rows.filter(x=>x.job.id===r.job.id),'weekly'),0);
      if(W.cents(r.previousRecorded)!==W.cents(paid+(r.job.priorSettlement||0)))errors.push('Pending contract previous payments do not match earlier payroll.');
      if([...state.payments,...state.releases].some(p=>p.jobId===r.job.id))errors.push('Review legacy payments before marking this contract pending.');
    }
    for(const [k,old] of oldLatest){const replacement=newLatest.get(k);if(replacement&&replacement.id!==old.id&&previous.painterTestSheets.some(s=>s.id===replacement.id))errors.push('Keep the latest working worksheet, not an older copy.')}
    // A unit has one opening settlement, never a fresh deduction every week.
    const openings=new Map();
    for(const s of newLatest.values())for(const {job:j} of s.snapshot.rows)if(j.payrollStart)openings.set(j.id,{employeeId:s.employeeId,amount:j.priorSettlement,start:j.payrollStart});
    for(const [id,o] of openings){
      let anchor=false;
      for(const s of newLatest.values())for(const {job:j} of s.snapshot.rows)if(j.id===id){
        if(s.employeeId!==o.employeeId||j.priorSettlement!==o.amount||j.payrollStart!==o.start)errors.push('Keep the same pre-BWC starting balance across payroll weeks.');
        if(s.period.start===o.start)anchor=true;
      }
      for(const s of newLatest.values())for(const r of s.snapshot.rows)if(r.job.id===id){
        const prior=[...newLatest.values()].filter(p=>p.period.end<s.period.start).reduce((total,p)=>total+W.sum(p.snapshot.rows.filter(x=>x.job.id===id),'weekly'),0);
        if(pending(r.job)?W.cents(r.previousRecorded)!==W.cents(o.amount+prior):W.cents(r.opening)!==W.cents(r.job.contract-o.amount-prior))errors.push('Starting balance does not match earlier payroll. A later worksheet may depend on the amount being changed.');
      }
      if(!anchor)errors.push('Keep the first BWC worksheet that records this starting balance.');
      if([...state.payments,...state.releases].some(p=>p.jobId===id))errors.push('Do not combine an opening settlement with legacy payment entries for the same unit.');
      if(previous){
        const priorRows=[...oldLatest.values()].flatMap(s=>s.snapshot.rows.filter(r=>r.job.id===id).map(r=>({sheet:s,job:r.job})));
        if(priorRows.some(({sheet:s,job:j})=>(j.priorSettlement||0)!==o.amount||j.payrollStart!==o.start)&&priorRows.some(({sheet:s})=>s.period.start!==o.start))errors.push('Starting balance is locked because this unit has other payroll records.');
      }
    }
    if(previous)for(const s of oldLatest.values())for(const {job:j} of s.snapshot.rows)if(j.payrollStart&&!openings.has(j.id)&&[...newLatest.values()].some(n=>n.snapshot.rows.some(r=>r.job.id===j.id)))errors.push('Keep the unit’s pre-BWC starting balance.');
    return [...new Set(errors)];
  }
  function merge(previous,incoming){const n=copy(incoming);if(previous.painterTestSheets?.length||n.painterTestSheets?.length){n.painterTestSheets=n.painterTestSheets||[];for(const old of previous.painterTestSheets||[]){const found=n.painterTestSheets.find(s=>s.id===old.id);if(found&&!same(found,old))throw Error('Backup conflicts with a saved test sheet.');if(!found)n.painterTestSheets.push(copy(old))}n.painterTestSheets.sort((a,b)=>a.savedAt.localeCompare(b.savedAt))}return n}
  function balances(x,c,editable=false){const {esc,peso}=x;return `<table class="painter-balances"><caption>Balance / retained units · dates are reference only</caption><thead><tr><th>Unit / job order</th><th class="num">Balance after this week</th><th>Status</th><th>Unit released</th><th>Retention payout date</th></tr></thead><tbody>${c.rows.map(r=>{const j=r.job,status=j.retentionStatus||(j.closed?'retained':'ongoing'),released=j.unitReleasedOn??j.releasedOn??'',due=j.retentionDue??j.retentionEligibleOn??j.due??'',label=j.unit+' '+j.plate;return `<tr data-reference-row="${esc(j.id)}"><td>${esc(j.unit)} · ${esc(j.plate)}<small>${esc(j.work)}</small></td><td class="num" data-reference-balance>${balanceText(r,peso)}</td><td>${editable?`<select form="painterWorksheet" data-ref-field="retentionStatus" aria-label="Balance status — ${esc(label)}"><option value="ongoing" ${status==='ongoing'?'selected':''}>Ongoing</option><option value="retained" ${status==='retained'?'selected':''}>Retained</option></select>`:esc(status)}</td>${[['unitReleasedOn',released,'Unit released date'],['retentionDue',due,'Retention payout date']].map(([field,value,title])=>`<td>${editable?`<input form="painterWorksheet" type="date" data-ref-field="${field}" aria-label="${title} — ${esc(label)}" value="${esc(value)}">`:esc(value||'Not set')}</td>`).join('')}</tr>`}).join('')||'<tr><td colspan="5">No units yet.</td></tr>'}</tbody></table>`}
  function render(x,employeeId){
    const {state:s,esc,peso,button,range}=x,{snapshot:c,saved}=view(s,employeeId);
    const released=(s.releasedPainterSlips||[]).find(r=>r.employeeId===employeeId&&key(r.period)===key(s.period));
    function cell(j,key,label,value,type='text'){return `<input data-field="${key}" ${released?'disabled':''} ${key==='contract'&&pending(j)?'readonly':''} aria-label="${esc(label+' — '+(j.id?j.unit+' '+j.plate:'New unit'))}" placeholder="${esc(label)}" type="${type}" ${type==='number'?'min="0" step="0.01"':''} value="${esc(value??'')}">`}
    function row(r){const j=r.job,canStart=startingEditable(s,employeeId,j),asOf=W.addDays(j.payrollStart||s.period.start,-1);return `<tr data-painter-row="${esc(j.id||'')}"><td>${cell(j,'unit','Unit',j.unit)}${cell(j,'year','Year model',j.year)}</td><td>${cell(j,'invoice','Invoice #',j.invoice)}${cell(j,'plate','Plate number',j.plate)}</td><td>${cell(j,'color','Color',j.color)}</td><td><textarea data-field="work" aria-label="${esc('Job order — '+(j.id?j.unit+' '+j.plate:'New unit'))}" placeholder="Job order" rows="2">${esc(j.work||'')}</textarea></td><td>${cell(j,'contract','Agreed labor',j.contract,'number')}<label class="pending-contract"><input type="checkbox" data-field="contractPending" aria-label="${esc('Agreed price not yet confirmed — '+(j.id?j.unit+' '+j.plate:'New unit'))}" ${pending(j)?'checked':''} ${released?'disabled':''}>Agreed price not yet confirmed</label></td><td class="sheet-opening"><input data-field="priorSettlement" aria-label="${esc('Settled before BWC — '+(j.unit||'New unit'))}" type="number" min="0" step="0.01" placeholder="0 if none" value="${esc(j.priorSettlement??'')}" ${released||!canStart?'disabled':''}><small>${j.payrollStart||canStart?'Through '+esc(asOf):'Already tracked in BWC'}${!canStart?' · locked':''}</small></td><td class="num" data-row-opening>${j.id?balanceText(r,peso,'opening'):'—'}</td><td class="sheet-pay">${cell(j,'weekly','Amount this week',j.id?r.weekly:'','number')}</td></tr>`}
    return `<section class="simple-painter"><div class="sheet-toolbar">${button('← Employees','home')}<span class="sheet-title">Weekly payroll</span><div><button type="submit" form="painterWorksheet" class="button primary" ${released?'disabled':''}>Save table</button>${button('Print','simple-print',`id="painterPrint" data-id="${esc(employeeId)}" ${saved?'':'disabled'}`)}${button('Save as PDF','simple-pdf',`id="painterPdf" data-id="${esc(employeeId)}" ${saved?'':'disabled'}`)}${button(released?'Released · locked':'Release payslip','simple-release',`id="painterRelease" data-id="${esc(employeeId)}" ${saved&&!released?'':'disabled'}`)}</div></div><p id="painterSaveMessage" class="sheet-save-message" role="status">${released?'Released copy locked. Edit/delete stay unavailable except through the owner correction action.':saved?'Saved table ready to print, save as PDF, or release.':'Enter amounts → Save table → Print / Save as PDF / Release payslip.'}</p><p id="painterError" class="form-error" role="alert"></p>
      <div class="sheet-meta"><div><b>DATE RANGE</b><div class="sheet-week">${button('‹','week-previous','aria-label="Previous week"','sheet-link')}<span>${range(s.period)}</span>${button('›','week-next','aria-label="Next week"','sheet-link')}<input id="painterWeek" type="date" aria-label="Choose payroll week" value="${s.period.start}"></div><small>Saturday–Friday · all amounts in ₱</small></div><div><b>PAYDAY</b><input id="painterPayday" form="painterWorksheet" type="date" aria-label="Payroll payday" required value="${esc(c.period.releaseDate)}" ${released?'disabled':''}><small>${saved?'Saved copy date shown. ':''}Default: following Saturday · editable for holidays${released?' · released copy locked':' · Save table to keep changes'}.</small></div><div><b>EMPLOYEE</b><strong>${esc(c.employee.name)}</strong></div><div><b>POSITION</b><span>${esc(c.employee.position)}</span></div></div>
      <p class="sheet-instruction">If the full labor price is unknown, select “Agreed price not yet confirmed”; payments are recorded while balances stay pending. Starting an old unit? Enter its original agreed labor and the amount already settled before this unit’s first BWC week. Leave 0 for a new unit. This is a starting balance, not new salary. Do not include payments already entered in BWC or deduct settled cash advances again. The starting amount locks once another week or a released payslip exists. ${button('Empty this week’s table','simple-empty',`data-id="${esc(employeeId)}" ${released||(!c.rows.length&&!c.cashAdvance)?'disabled':''}`,'sheet-link')}</p>
      <form id="painterWorksheet" data-employee="${esc(employeeId)}"><fieldset ${released?'disabled':''} class="sheet-fields"><div class="table-wrap"><table class="painter-table"><caption class="visually-hidden">Weekly painter payroll</caption><thead><tr><th>Unit / year</th><th>Invoice # / plate</th><th>Color</th><th>Job order</th><th>Agreed labor</th><th>Settled before BWC</th><th>Balance before week</th><th>Amount this week</th></tr></thead><tbody>${c.rows.map(row).join('')}${released?'':row({job:{}})}</tbody><tfoot><tr><th colspan="7">TOTAL</th><td class="num" id="painterGross">${peso(c.basic)}</td></tr><tr><th colspan="7">LESS CASH ADVANCE</th><td class="sheet-pay"><input id="painterAdvance" aria-label="Cash advance this week" type="number" min="0" step="0.01" value="${c.cashAdvance}"></td></tr><tr class="sheet-salary"><th colspan="7">TOTAL SALARY <small>Saved worksheet</small></th><td class="num" id="painterNet">${peso(c.net)}</td></tr></tfoot></table></div></fieldset><div class="sheet-status"><span id="painterEditStatus" role="status">${saved?'All changes saved':'Save this table to enable printing.'}</span><button type="button" data-action="painter-discard" class="button sheet-link" hidden>Undo unsaved changes</button></div></form>
      <div id="painterWarnings"></div><div id="painterBalances" class="table-wrap">${balances(x,c,!released)}</div><p class="sheet-footnote">Save table updates this employee’s worksheet for this week; it does not create extra copies or confirm payment. Save changes before changing the week or payday. Release payslip creates the permanent PDF. Retention dates are reference only.</p></section>`;
  }
  return {latest,savedFor,jobs,view,draft,save,emptyTable,validate,merge,compact,balances,render,startingEditable,pending,balanceText,previousRecorded};
});
