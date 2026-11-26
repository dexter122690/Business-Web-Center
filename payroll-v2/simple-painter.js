/* One working painter worksheet per employee/week; released snapshots stay fixed. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./workflow.js'),require('./painter-ledger.js'),require('./contract-ledger.js'));else root.SimplePainter=factory(root.PayrollWorkflow,root.PainterLedger,root.PayrollContracts)})(typeof window!=='undefined'?window:this,function(W,L,K){
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
  const key=p=>p.start+':'+p.end;
  const sheetKey=s=>s.employeeId+':'+key(s.period);
  const pending=job=>job.contractPending===true;
  const setupPending=job=>Boolean(job.pricingSetup)&&!job.agreedWorkItems;
  const setupHere=(job,period)=>setupPending(job)&&job.pricingSetup.firstWeek===period.start;
  const balanceText=(row,peso,field='remaining')=>setupPending(row.job)?'₱0.00 · For re-encoding':pending(row.job)?'Pending confirmation':peso(row[field]);
  const previousRecorded=row=>row.previousRecorded??W.money(row.job.contract-row.opening);
  const isReleased=job=>job.retentionStatus==='retained'||Boolean(job.closed);
  // Visibility follows the actual unit release, not the week it was entered/reset.
  // Keep the saved marker only as a fallback for legacy records without a date.
  const releaseWeek=job=>{const date=job.unitReleasedOn||job.releasedOn;return W.validDate(date)?W.weeklyPeriod(date).start:(job.releasePayrollStart||'')};
  // Keep reference rows in the snapshot for balances/history, never as new pay.
  // Existing non-zero weekly payments must remain itemized, not silently hidden.
  const mainRows=c=>c.rows.filter(r=>!isReleased(r.job)||!releaseWeek(r.job)||releaseWeek(r.job)>=c.period.start||r.weekly!==0);
  // The editor shows ongoing work only. Keep mainRows unchanged for historical
  // payslips and validation: released-unit payments still belong to their week.
  const activeRows=c=>c.rows.filter(r=>!isReleased(r.job)||setupHere(r.job,c.period));
  const weeklyTotals=c=>({ongoing:W.sum(c.rows.filter(r=>!isReleased(r.job)),'weekly'),released:W.sum(c.rows.filter(r=>isReleased(r.job)),'weekly')});
  const receiptFor=(row,receipts)=>receipts.find(p=>p.employeeId===row.job.employeeId&&p.jobId===row.job.id);
  // A receipt remains visible on its payday; only later payrolls omit the row.
  // Filter presentation only: underlying rows/amounts and receipt history stay intact.
  function balanceRows(c,receipts=c.retentionReceipts||[],previousPayday=c.period.start){
    const paid=new Set((c.retainedPaydayPayments||[]).map(p=>p.id));
    return c.rows.filter(r=>{const p=receiptFor(r,receipts);return !setupHere(r.job,c.period)&&isReleased(r.job)&&(pending(r.job)||r.remaining>0)&&!paid.has(p?.id)&&!(p&&p.receivedOn<=previousPayday&&p.receivedOn<=c.period.releaseDate)});
  }
  function previousPayrollDate(state,c){
    const start=W.addDays(c.period.start,-7),saved=state&&latest(state,c.employee.id).find(s=>s.period.start===start);
    return saved?.period.releaseDate||state?.payrollPaydays?.[start]||c.period.start;
  }
  const retentionDue=job=>{const date=job.unitReleasedOn||job.releasedOn;return isReleased(job)&&W.validDate(date)?W.addDays(date,45):''};
  const manilaDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function retentionInfo(row,receipts=[],today=manilaDay(),payday='9999-12-31'){
    const recorded=receiptFor(row,receipts),receipt=recorded&&recorded.receivedOn<=payday?recorded:undefined,due=retentionDue(row.job);
    return {due,receipt,receivedLater:Boolean(recorded&&!receipt),remaining:receipt?0:row.remaining,eligible:!recorded&&!pending(row.job)&&row.remaining>0&&Boolean(due)&&today>=due};
  }
  // A receipt confirms money already received, separately from weekly earnings.
  // No inferred payment and no second addition to a payslip's net salary.
  function receiptBasis(state,employeeId,jobId){
    const sheets=latest(state,employeeId).sort((a,b)=>a.period.start.localeCompare(b.period.start)),rows=sheets.flatMap(s=>s.snapshot.rows.filter(r=>r.job.id===jobId).map(r=>({s,r}))),row=rows.at(-1)?.r;
    if(!row||!isReleased(row.job)||pending(row.job)||!retentionDue(row.job))throw Error('Confirm the agreed labor and unit release date first.');
    if([...state.payments,...state.releases].some(p=>p.jobId===jobId))throw Error('Review earlier legacy payments before confirming receipt.');
    const j=row.job,payments=rows.filter(({r})=>r.weekly!==0).map(({s,r})=>({start:s.period.start,end:s.period.end,amount:r.weekly}));
    if(K.events(state,employeeId,jobId).length&&j.contract!==K.current(state,employeeId,jobId))throw Error('Save the current payroll table after the contract change before confirming the retained balance.');
    const amount=W.money(j.contract-(j.priorSettlement||0)-W.sum(payments,'amount'));
    if(amount<=0||W.cents(amount)!==W.cents(row.remaining))throw Error('Review the saved unit balance before confirming receipt.');
    return {employeeId,jobId,unit:j.unit,plate:j.plate||'',contract:j.contract,priorSettlement:j.priorSettlement||0,unitReleasedOn:j.unitReleasedOn||j.releasedOn,dueOn:retentionDue(j),amount,payments};
  }
  function validateReceipts(state,previous){
    const receipts=state.painterRetentionReceipts||[],errors=[],ids=new Set();
    if(!Array.isArray(receipts))return ['Invalid retained-balance receipts.'];
    for(const p of receipts){
      try{
        const k=p.employeeId+':'+p.jobId,basis=receiptBasis(state,p.employeeId,p.jobId);
        if(ids.has(k)||!p.id||!W.validDate(p.receivedOn)||p.receivedOn<basis.dueOn||!Number.isFinite(+new Date(p.recordedAt))||!same(ordered(p.basis),ordered(basis))||p.amount!==basis.amount)throw Error('Invalid retained-balance receipt.');
        ids.add(k);
      }catch(e){errors.push(e.message)}
    }
    for(const p of previous?.painterRetentionReceipts||[])if(!same(p,receipts.find(n=>n.id===p.id)))errors.push('Received balances are locked. Keep the original receipt history.');
    return errors;
  }
  // Keep the same last-in-array winner used by the original weekly calculations.
  // Retain any older source referenced by a released PDF, without displaying it.
  function compact(state){
    const next=copy(state),groups=new Map(),sources=new Set((state.releasedPainterSlips||[]).map(r=>r.sourceId));
    for(const s of state.painterTestSheets||[]){const k=sheetKey(s);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(s)}
    next.painterTestSheets=[...groups.values()].flatMap(rows=>rows.filter((s,i)=>i===rows.length-1||sources.has(s.id))).map(copy);
    return next;
  }
  function number(value,label){const n=value===''||value==null?0:Number(value);if(!Number.isFinite(n)||n<0||n>999999999)throw Error(label+' must be a valid non-negative number.');return W.money(n)}
  function normalizeWorkItems(items){
    if(!Array.isArray(items)||items.length>30)throw Error('Use up to 30 job lines per unit.');
    return items.flatMap(item=>{
      if(!item||typeof item.description!=='string')throw Error('Enter a description for each job line.');
      const description=item.description.trim(),amount=number(item.amount,'Job amount');
      if(!description&&amount===0)return [];
      if(!description)throw Error('Enter a job description beside each amount.');
      if(description.length>1000)throw Error('Please shorten the job description (maximum 1,000 characters per line).');
      return [{description,amount}];
    });
  }
  const itemWork=items=>items.map(i=>i.description).join('\n');
  // Old free text and its saved total remain one unitemized line until staff edits it.
  function workItems(row){return copy(row.workItems??[{description:row.job.work||(row.weekly?'Previously recorded labor (not itemized)':''),amount:row.weekly||0}])}
  function workTemplate(state,employeeId,jobId,through){
    const row=latest(state,employeeId).filter(s=>!through||s.period.start<=through).sort((a,b)=>b.period.start.localeCompare(a.period.start)).flatMap(s=>s.snapshot.rows.filter(r=>r.job.id===jobId))[0];
    return row?.workItems?.map(i=>({description:i.description,amount:0}));
  }
  const itemizedWorkText=(row,peso)=>row.agreementItems?row.agreementItems.map((i,n)=>(n+1)+'. '+i.description+' — '+(i.amount===null?'Price pending':peso(i.amount))).join('\n'):row.workItems?row.workItems.map((i,n)=>(n+1)+'. '+i.description+' — '+peso(i.amount)).join('\n'):row.job.work||'';
  function validateWorkItems(state,previous){
    const errors=[];
    for(const s of state.painterTestSheets||[])for(const r of s.snapshot?.rows||[])if(r.workItems!==undefined){
      try{const items=normalizeWorkItems(r.workItems);if(!same(ordered(items),ordered(r.workItems))||(!r.weeklyManual&&(W.cents(W.sum(items,'amount'))!==W.cents(r.weekly)||r.job.work!==itemWork(items))))throw Error('Itemized job amounts must add up to Amount this week.');}catch(e){errors.push(e.message)}
    }
    for(const s of previous?.painterTestSheets||[])for(const r of s.snapshot.rows)if(r.workItems!==undefined){
      const next=(state.painterTestSheets||[]).filter(n=>n.employeeId===s.employeeId&&key(n.period)===key(s.period)).at(-1)?.snapshot.rows.find(n=>n.job.id===r.job.id);
      if(next&&next.workItems===undefined)errors.push('Keep the itemized job lines. Reload the updated payroll before saving.');
      if(next?.weeklyManual&&!same(ordered(next.workItems),ordered(r.workItems)))errors.push('Keep legacy payment line details unchanged; enter the new payment in Amount this week.');
    }
    return errors;
  }
  function validateAgreements(state,previous){
    const errors=[],baseline=new Map();
    for(const sheet of state.painterTestSheets||[])for(const row of sheet.snapshot.rows){
      const j=row.job,k=sheet.employeeId+':'+j.id;
      try{
        if(j.pricingSetup){
          const setup=j.pricingSetup;
          if(!setup.batch||!W.validDate(setup.firstWeek)||W.weeklyPeriod(setup.firstWeek).start!==setup.firstWeek||setup.firstWeek>sheet.period.start||!Array.isArray(setup.items)||!same(normalizeWorkItems(setup.items),setup.items)||setup.items.some(i=>i.amount!==0))throw Error('Invalid initial pricing setup.');
          if(setupPending(j)&&(!pending(j)||row.weekly!==0||(j.priorSettlement||0)!==0||K.events(state,sheet.employeeId,j.id).length))throw Error('Set job prices before recording payments for this reset unit.');
        }
        if(j.agreedWorkItems!==undefined){
          const items=normalizeWorkItems(j.agreedWorkItems);
          if(!items.length||items.some(i=>i.amount<=0)||!same(ordered(items),ordered(j.agreedWorkItems)))throw Error('Enter a positive agreed price for every job-order line.');
          if(baseline.has(k)&&!same(ordered(baseline.get(k)),ordered(items)))throw Error('Saved job-order prices must stay the same across payroll dates.');
          baseline.set(k,items);
          const expected=K.at(state,sheet.employeeId,j.id,sheet.period.end,W.sum(items,'amount'));
          if(j.contractPending||j.contract!==expected)throw Error('Agreed labor must equal the saved job prices plus applicable additional work.');
          if(!row.weeklyManual)throw Error('Enter this week’s payment separately from agreed job prices.');
        }
        if(row.weeklyManual&&(!same(ordered(row.agreementItems),ordered(K.agreementItems(state,sheet.employeeId,j,sheet.period.end)))||(!pending(j)&&W.sum(row.agreementItems,'amount')!==j.contract)))throw Error('Job-order prices do not match the agreement effective for this week.');
      }catch(e){errors.push(e.message)}
    }
    for(const sheet of previous?.painterTestSheets||[])for(const row of sheet.snapshot.rows){
      const entries=latest(state,sheet.employeeId).flatMap(s=>s.snapshot.rows.filter(r=>r.job.id===row.job.id));
      const initializing=setupPending(row.job)&&state.period.start===row.job.pricingSetup.firstWeek&&!latest(previous,sheet.employeeId).some(s=>K.locked(previous,s)&&s.snapshot.rows.some(r=>r.job.id===row.job.id));
      if(entries.some(r=>!same(ordered(r.job.pricingSetup),ordered(row.job.pricingSetup))))errors.push('Keep the original reset setup reference.');
      if(!initializing&&entries.some(r=>!same(ordered(r.job.agreedWorkItems),ordered(row.job.agreedWorkItems))))errors.push('Existing job-order prices are locked after the first save. Use Additional job order for new work.');
      if(initializing&&entries.some(r=>r.job.agreedWorkItems)&&entries.some(r=>setupPending(r.job)))errors.push('Initial job prices must update every saved date together.');
      if(row.weeklyManual&&entries.some(r=>!r.weeklyManual&&r.job.agreedWorkItems))errors.push('Weekly payments must remain separate from agreed job prices.');
    }
    return errors;
  }
  // Only explicitly reset, never-priced jobs may receive their first agreement.
  // This updates all open reference sheets together, not a series of payments.
  function initializePricing(state,employeeId,inputs){
    const next=copy(state);
    for(const input of inputs){
      const id=input.id||input.linkJobId,history=K.rows(next,employeeId,id),job=history.at(-1)?.row.job;
      if(!job||!setupPending(job)||input.agreedWorkItems===undefined)continue;
      const items=normalizeWorkItems(input.agreedWorkItems);
      if(!items.some(i=>i.amount>0)){
        if(!same(ordered(items),ordered(job.pricingSetup.items)))throw Error('Enter prices for the edited job descriptions before saving this unit. Unchanged units may stay at zero for re-encoding.');
        continue;
      }
      if(state.period.start!==job.pricingSetup.firstWeek)throw Error('Enter the first job prices in payroll week '+job.pricingSetup.firstWeek+'.');
      if(!items.length||items.some(i=>i.amount<=0))throw Error('Enter a positive agreed price for every job line before saving this unit.');
      if(history.some(({sheet,row})=>K.locked(state,sheet)||!setupPending(row.job)||row.weekly!==0)||(state.painterRetentionReceipts||[]).some(r=>r.employeeId===employeeId&&r.jobId===id))throw Error('Initial pricing is locked because this unit already has payment or released payroll records.');
      const total=number(W.sum(items,'amount'),'Agreed labor');
      for(const {sheet,row} of history){
        row.job.agreedWorkItems=copy(items);row.job.contract=total;row.job.work=itemWork(items);delete row.job.contractPending;
        row.weeklyManual=true;row.agreementItems=copy(items);row.opening=total;row.remaining=total;delete row.previousRecorded;
        sheet.snapshot.jobs=sheet.snapshot.rows.map(r=>copy(r.job));
      }
    }
    return next;
  }
  function latest(state,employeeId){const weeks=new Map();for(const s of state.painterTestSheets||[])if(s.employeeId===employeeId)weeks.set(key(s.period),s);return [...weeks.values()]}
  function savedFor(state,employeeId){return latest(state,employeeId).find(s=>key(s.period)===key(state.period))||null}
  function startingEditable(state,employeeId,job){
    if(!job.id)return true;
    if(job.payrollStart&&job.payrollStart!==state.period.start)return false;
    if([...state.payments,...state.releases].some(p=>p.jobId===job.id))return false;
    if((state.releasedPainterSlips||[]).some(s=>s.snapshot.rows.some(r=>r.job.id===job.id)))return false;
    return !latest(state,employeeId).some(s=>key(s.period)!==key(state.period)&&s.snapshot.rows.some(r=>r.job.id===job.id));
  }
  function jobs(state,employeeId,through){const items=new Map(state.jobs.filter(j=>j.employeeId===employeeId).map(j=>[j.id,copy(j)]));for(const s of latest(state,employeeId).filter(s=>!through||s.period.start<=through).sort((a,b)=>a.period.start.localeCompare(b.period.start)))for(const row of s.snapshot.rows)items.set(row.job.id,copy(row.job));return [...items.values()]}
  function originalAmount(state,jobId,period){return W.money(W.sum(state.payments.filter(p=>p.jobId===jobId&&W.inPeriod(p.date,period)),'gross')-W.sum(state.payments.filter(p=>p.jobId===jobId&&W.inPeriod(p.date,period)),'retention')+W.sum(state.releases.filter(p=>p.jobId===jobId&&W.inPeriod(p.date,period)),'amount'))}
  function snapshot(state,employeeId,rows,cashAdvance){
    const employee=state.employees.find(e=>e.id===employeeId&&e.type==='contract');if(!employee)throw Error('Choose a painter first.');
    const basic=W.sum(rows,'weekly');return copy({simpleTest:true,employee:W.payslipEmployee(employee),period:state.period,rules:state.rules,rows,cashAdvance,basic,net:W.money(basic-cashAdvance),late:0,held:0,retentionReleased:0,attendance:[],portions:[],releases:[],advances:[],retentionAccounts:[],warnings:[],jobs:rows.map(r=>r.job)});
  }
  function view(state,employeeId){
    const saved=savedFor(state,employeeId);if(saved)return {saved,snapshot:copy(saved.snapshot)};
    const earlier=latest(state,employeeId).filter(s=>s.period.end<state.period.start);
    const rows=jobs(state,employeeId,state.period.start).filter(job=>!job.payrollStart||job.payrollStart<=state.period.start).map(job=>{
      if(K.events(state,employeeId,job.id).length){job.contract=K.at(state,employeeId,job.id,state.period.end,job.contract);if(job.contract!==null)delete job.contractPending}
      let prior=originalAmount(state,job.id,{start:'0001-01-01',end:W.addDays(state.period.start,-1)});
      for(const sheet of earlier){const row=sheet.snapshot.rows.find(r=>r.job.id===job.id);if(row)prior=W.money(prior+row.weekly-originalAmount(state,job.id,sheet.period))}
      const recorded=W.money((job.priorSettlement||0)+prior),opening=pending(job)?null:W.money(job.contract-recorded),weekly=originalAmount(state,job.id,state.period);
      const template=workTemplate(state,employeeId,job.id,state.period.start);
      // Do not assign a legacy payment to a task automatically.
      const items=template&&weekly===0?{workItems:template}:{};
      const manual=Boolean(job.agreedWorkItems)||latest(state,employeeId).some(s=>s.snapshot.rows.some(r=>r.job.id===job.id&&r.weeklyManual));
      return {job,opening,weekly,remaining:pending(job)?null:W.money(opening-weekly),...(pending(job)?{previousRecorded:recorded}:{}),...items,...(manual?{weeklyManual:true,agreementItems:K.agreementItems(state,employeeId,job,state.period.end)}:{})};
    });
    const cashAdvance=W.sum(state.advances.filter(a=>a.employeeId===employeeId&&W.inPeriod(a.date,state.period)),'amount');
    return {saved:null,snapshot:snapshot(state,employeeId,rows,cashAdvance)};
  }
  function draft(state,employeeId,inputs,cashAdvance,makeId){
    return draftPrepared(initializePricing(state,employeeId,inputs),employeeId,inputs,cashAdvance,makeId);
  }
  function draftPrepared(state,employeeId,inputs,cashAdvance,makeId){
    const base=view(state,employeeId).snapshot,seen=new Set(),rows=[];
    for(const input of inputs){
      if(!input.id&&!input.linkJobId&&!['unit','year','plate','invoice','color','work','contract','priorSettlement','weekly'].some(k=>(k==='contract'||k==='weekly')&&Number(input[k])===0?false:k==='weekly'&&input.workItems!==undefined?false:String(input[k]??'').trim())&&!input.workItems?.some(i=>String(i.description??'').trim()||Number(i.amount))&&!input.agreedWorkItems?.some(i=>String(i.description??'').trim()||Number(i.amount)))continue;
      const old=input.linkJobId?linkedRow(state,employeeId,input.linkJobId):base.rows.find(r=>r.job.id===input.id);
      if((input.id&&(!old||input.id!==old.job.id))||(old&&seen.has(old.job.id)))throw Error('Check the selected unit.');
      const job=old?copy(old.job):{id:makeId(),employeeId,unit:'',year:'',plate:'',invoice:'',color:'',work:'',contract:0};seen.add(job.id);
      for(const [field,max] of [['unit',120],['year',10],['plate',30],['invoice',60],['color',70],['work',1000],['transactionRef',80],['separateJobReason',1000]]){
        if(input[field]===undefined)continue;const value=String(input[field]).trim();if(value.length>max)throw Error('Please shorten the '+field+' field.');job[field]=field==='plate'?value.toUpperCase():value;
      }
      if(!job.unit)throw Error('Enter a unit name in the new row, or leave that row blank.');
      const manual=input.agreementMode===true||Boolean(job.agreedWorkItems)||old?.weeklyManual===true;
      if(manual&&!old){
        const items=normalizeWorkItems(input.agreedWorkItems||[]);
        if(!items.length||items.some(i=>i.amount<=0))throw Error('Enter each job order and its positive agreed price before saving.');
        job.agreedWorkItems=items;job.contract=number(W.sum(items,'amount'),'Agreed labor');job.work=itemWork(items);
      }else if(old&&!setupPending(job)&&input.agreedWorkItems!==undefined&&!same(ordered(normalizeWorkItems(input.agreedWorkItems)),ordered(old.job.agreedWorkItems)))throw Error('Saved job-order prices are locked. Use Additional job order for new work.');
      const unconfirmed=setupPending(job)|| (manual&&!old?false:input.contractPending===undefined?(input.contract===undefined?pending(job):String(input.contract).trim()===''):input.contractPending===true);
      if(unconfirmed){job.contractPending=true;job.contract=null}
      else{
        if(pending(job)&&(input.contract===undefined||String(input.contract).trim()===''))throw Error('Enter the confirmed agreed labor, or keep Agreed price not yet confirmed selected.');
        job.contract=manual&&!old?job.contract:input.contract===undefined?job.contract:number(input.contract,'Agreed labor');delete job.contractPending;
      }
      const settled=input.priorSettlement===undefined?(job.priorSettlement||0):number(input.priorSettlement,'Settled before BWC');
      if(settled!==(job.priorSettlement||0)&&!startingEditable(state,employeeId,job))throw Error('Starting balance is locked because this unit has other payroll records. Do not enter old payments as this week’s pay.');
      if(!pending(job)&&settled>job.contract)throw Error('Settled before BWC cannot exceed the original agreed labor.');
      if(settled||job.payrollStart||(!old&&pending(job))){job.priorSettlement=settled;job.payrollStart=job.payrollStart||state.period.start}
      if(input.retentionStatus!==undefined){
        if(!['ongoing','retained'].includes(input.retentionStatus))throw Error('Choose Ongoing or Released.');
        if(input.retentionStatus==='retained'&&(!isReleased(job)||!job.releasePayrollStart))job.releasePayrollStart=state.period.start;
        job.retentionStatus=input.retentionStatus;
        if(input.retentionStatus==='ongoing'){job.closed=false;job.unitReleasedOn='';delete job.releasePayrollStart}
      }
      for(const field of ['unitReleasedOn','retentionDue'])if(input[field]!==undefined){if(input[field]&&!W.validDate(input[field]))throw Error('Choose a valid reference release date.');job[field]=input[field]}
      if(input.retentionStatus==='ongoing')job.unitReleasedOn='';
      if(job.releasePayrollStart&&!W.validDate(job.unitReleasedOn))throw Error('Choose the unit release date for '+job.unit+'.');
      if(old&&!input.linkJobId&&!mainRows(base).some(r=>r.job.id===job.id)&&job.pricingSetup?.firstWeek!==state.period.start)throw Error('Released balances are read-only. Open the week when the unit was released to correct its status.');
      const items=manual?old?.workItems:input.workItems===undefined?old?.workItems:normalizeWorkItems(input.workItems);
      if(!manual&&items&&input.workItems===undefined&&((input.weekly!==undefined&&W.cents(number(input.weekly,'Amount this week'))!==W.cents(W.sum(items,'amount')))||(input.work!==undefined&&input.work!==itemWork(items))))throw Error('Amount this week is automatic. Edit the individual job lines and amounts.');
      if(items&&!manual)job.work=itemWork(items);
      const weekly=manual?number(input.weekly??old?.weekly,'Amount this week'):items?number(W.sum(items,'amount'),'Amount this week'):number(input.weekly,'Amount this week'),recorded=W.money((old?previousRecorded(old):0)+settled-(old?.job.priorSettlement||0)),opening=pending(job)?null:W.money(job.contract-recorded);
      if(setupPending(job)&&weekly!==0)throw Error('Set the job prices first, then enter Amount this week. Zero here means for re-encoding, not fully paid.');
      rows.push({job,opening,weekly,remaining:pending(job)?null:W.money(opening-weekly),...(pending(job)?{previousRecorded:recorded}:{}),...(items?{workItems:copy(items)}:{}),...(manual?{weeklyManual:true,agreementItems:K.agreementItems(state,employeeId,job,state.period.end)}:{})});
    }
    // An incomplete UI payload must never silently remove an existing unit.
    for(const old of base.rows)if(!seen.has(old.job.id))rows.push(copy(old));
    const data=snapshot(state,employeeId,rows,number(cashAdvance,'Cash advance')),preview=copy(state),old=savedFor(state,employeeId);
    preview.painterTestSheets=(preview.painterTestSheets||[]).filter(s=>s.id!==old?.id);
    preview.painterTestSheets.push({id:old?.id||'cross-date-preview',employeeId,period:copy(data.period),snapshot:data});
    L.reconcile(preview,state,employeeId,L.affected(preview,state).filter(j=>j.employeeId===employeeId).map(j=>j.id));
    const errors=L.check(preview,state);if(errors.length)throw Error(errors[0]);
    if(data.rows.some(r=>pending(r.job)))data.warnings.push('Agreed labor not confirmed: payments are linked across dates, but the contract limit cannot be verified until a price is entered.');
    return data;
  }
  function linkableJobs(state,employeeId){const ids=new Set(view(state,employeeId).snapshot.rows.map(r=>r.job.id));return jobs(state,employeeId).filter(j=>!ids.has(j.id))}
  function linkedRow(state,employeeId,id){
    const found=linkableJobs(state,employeeId).find(j=>j.id===id);if(!found)throw Error('Choose an existing job for this employee.');
    const job=copy(found);
    if(K.events(state,employeeId,id).length){job.contract=K.at(state,employeeId,id,state.period.end,K.baseline(state,employeeId,id));if(job.contract===null)job.contractPending=true;else delete job.contractPending}
    if(job.payrollStart&&job.payrollStart>state.period.start){
      if(!L.safeEarlierAnchor(state,employeeId,id,state.period.start,job.priorSettlement))throw Error('This unit has a locked starting balance. Review its earlier settlement before backdating.');
      job.payrollStart=state.period.start;
    }
    if(isReleased(job)){
      if((job.unitReleasedOn||job.releasedOn)>state.period.end){job.retentionStatus='ongoing';job.closed=false;job.unitReleasedOn='';delete job.releasedOn;delete job.releasePayrollStart}
      else job.releasePayrollStart=state.period.start;
    }
    const recorded=W.money((job.priorSettlement||0)+L.paidBefore(state,employeeId,id,state.period.start)),opening=pending(job)?null:W.money(job.contract-recorded);
    const template=workTemplate(state,employeeId,id);
    const manual=Boolean(job.agreedWorkItems)||latest(state,employeeId).some(s=>s.snapshot.rows.some(r=>r.job.id===id&&r.weeklyManual));
    return {job,opening,weekly:0,remaining:opening,...(pending(job)?{previousRecorded:recorded}:{}),...(template?{workItems:template}:{}),...(manual?{weeklyManual:true,agreementItems:K.agreementItems(state,employeeId,job,state.period.end)}:{})};
  }
  function syncFutureStatus(next,state,employeeId,data){
    const old=view(state,employeeId).snapshot,fields=['retentionStatus','unitReleasedOn','releasePayrollStart','closed'];
    const signature=j=>[isReleased(j),isReleased(j)?(j.unitReleasedOn||j.releasedOn||''):'',isReleased(j)?releaseWeek(j):''];
    for(const row of data.rows){
      const before=old.rows.find(r=>r.job.id===row.job.id);if(!before&&L.entries(state,employeeId,row.job.id).length)continue;if(before&&same(signature(before.job),signature(row.job)))continue;
      for(const sheet of next.painterTestSheets.filter(s=>s.employeeId===employeeId&&s.period.start>data.period.start)){
        const later=sheet.snapshot.rows.find(r=>r.job.id===row.job.id);if(!later)continue;
        if((next.releasedPainterSlips||[]).some(s=>s.sourceId===sheet.id)||later.weekly!==0)throw Error('This unit has later payroll payments or a released payslip. Review that later week before changing its release status.');
        for(const field of fields){if(row.job[field]===undefined)delete later.job[field];else later.job[field]=copy(row.job[field])}
        sheet.snapshot.jobs=sheet.snapshot.rows.map(r=>copy(r.job));
      }
    }
  }
  function save(state,employeeId,inputs,cashAdvance,makeId,savedAt=new Date().toISOString()){
    if((state.releasedPainterSlips||[]).some(r=>r.employeeId===employeeId&&key(r.period)===key(state.period)))throw Error('This week has a released payslip. It is locked except through the owner correction action.');
    const prepared=initializePricing(state,employeeId,inputs),next=compact(prepared),record=snapshot(state,employeeId,[],0),data=draftPrepared(prepared,employeeId,inputs,cashAdvance,makeId),old=savedFor(state,employeeId);
    if(old&&same(old.snapshot,data)&&same(prepared,state))return next;
    next.painterTestSheets=next.painterTestSheets||[];
    const sheet={id:old?.id||makeId(),employeeId,period:record.period,savedAt,snapshot:data};
    const index=next.painterTestSheets.findIndex(s=>s.id===sheet.id);
    if(index<0)next.painterTestSheets.push(sheet);else next.painterTestSheets[index]=sheet;
    syncFutureStatus(next,state,employeeId,data);
    L.reconcile(next,state,employeeId,L.affected(next,state).filter(j=>j.employeeId===employeeId).map(j=>j.id));
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
      for(const r of c.rows)if(r.job.releasePayrollStart&&(!isReleased(r.job)||!W.validDate(r.job.unitReleasedOn)||!W.validDate(r.job.releasePayrollStart)||W.weeklyPeriod(r.job.releasePayrollStart).start!==r.job.releasePayrollStart||r.job.releasePayrollStart>s.period.start||(r.job.releasePayrollStart<s.period.start&&r.weekly!==0)))errors.push('Invalid released-unit carry-forward.');
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
        if(priorRows.some(({sheet:s,job:j})=>(j.priorSettlement||0)!==o.amount||j.payrollStart!==o.start)&&priorRows.some(({sheet:s})=>s.period.start!==o.start)&&!L.safeEarlierAnchor(previous,o.employeeId,id,o.start,o.amount))errors.push('Starting balance is locked because this unit has other payroll records.');
      }
    }
    if(previous)for(const s of oldLatest.values())for(const {job:j} of s.snapshot.rows)if(j.payrollStart&&!openings.has(j.id)&&[...newLatest.values()].some(n=>n.snapshot.rows.some(r=>r.job.id===j.id)))errors.push('Keep the unit’s pre-BWC starting balance.');
    return [...new Set([...errors,...validateReceipts(state,previous),...validateWorkItems(state,previous),...validateAgreements(state,previous),...K.validate(state,previous),...L.check(state,previous)])];
  }
  function merge(previous,incoming){const n=copy(incoming);if(previous.painterTestSheets?.length||n.painterTestSheets?.length){n.painterTestSheets=n.painterTestSheets||[];for(const old of previous.painterTestSheets||[]){const found=n.painterTestSheets.find(s=>s.id===old.id);if(found&&!same(found,old))throw Error('Backup conflicts with a saved test sheet.');if(!found)n.painterTestSheets.push(copy(old))}n.painterTestSheets.sort((a,b)=>a.savedAt.localeCompare(b.savedAt))}return n}
  function balances(x,c){
    const {esc,peso}=x,receipts=x.state?.painterRetentionReceipts||c.retentionReceipts||[];
    // Do not move a newly released row into the lower table before online save.
    const confirmed=x.pendingSave?new Set(view(x.state,c.employee.id).snapshot.rows.filter(r=>isReleased(r.job)&&!setupPending(r.job)).map(r=>r.job.id)):null;
    const rows=balanceRows(c,receipts,previousPayrollDate(x.state,c)).filter(r=>(!confirmed||confirmed.has(r.job.id))&&!x.coveredReceipts?.has(receiptFor(r,receipts)?.id));
    return `<table class="painter-balances"><caption>Balance and retained units · details are read-only</caption><thead><tr><th>Unit / job order</th><th class="num">Amount this week <small>Included in salary</small></th><th class="num">Remaining balance <small>After this week's amount</small></th><th>Unit release date</th><th>Available after 45 days</th><th>Payment status</th></tr></thead><tbody>${rows.map(r=>{
      const j=r.job,info=retentionInfo(r,receipts,x.today||manilaDay(),c.period.releaseDate);
      return `<tr data-retained-job="${esc(j.id)}"><td><b>${esc(j.unit)} · ${esc(j.plate)}</b><small>${esc(j.invoice?'Invoice '+j.invoice:'')}</small><small class="retained-work">${esc(r.agreementItems||r.weekly?itemizedWorkText(r,peso):j.work)}</small></td><td class="num">${peso(r.weekly)}</td><td class="num">${info.receipt?peso(0):balanceText(r,peso)}</td><td>${esc(j.unitReleasedOn||j.releasedOn||'Not set')}</td><td>${esc(info.due||'Awaiting release date')}</td><td>${info.receipt?`<b>Received</b><small>${peso(info.receipt.amount)} · ${esc(info.receipt.receivedOn)}</small>`:info.eligible&&x.canReceive&&!x.pendingSave?`<select data-retention-receive="${esc(j.id)}" aria-label="${esc('Remaining balance received — '+j.unit+' '+(j.plate||''))}"><option value="">Not yet received</option><option value="received">Received</option></select>`:setupPending(j)?`For re-encoding <button type="button" data-action="setup-week" data-id="${esc(j.pricingSetup.firstWeek)}">Open first entry · ${esc(j.pricingSetup.firstWeek)}</button>`:pending(j)?'Confirm agreed labor first':info.receivedLater?'Received in a later payroll':info.eligible?'Ready for confirmation':'Not yet due'}</td></tr>`;
    }).join('')||'<tr><td colspan="6">No outstanding or newly received retained balances for this payroll.</td></tr>'}</tbody></table>`;
  }
  function releasedPaymentsHistory(x,c){
    const rows=c.rows.filter(r=>isReleased(r.job)&&r.weekly>0);
    if(!rows.length)return '';
    return `<section class="released-payment-history"><h3>Released units — payments in this payroll</h3><p>Already included in Total salary, not extra pay. Fully settled units remain here and on the payslip, not in the retained-balance table.</p><ul>${rows.map(r=>`<li><b>${x.esc(r.job.unit)} · ${x.esc(r.job.plate)}</b> — ${x.peso(r.weekly)}<small>${x.esc(itemizedWorkText(r,x.peso))}</small></li>`).join('')}</ul></section>`;
  }
  function jobItemsEditor(items,label,esc,disabled=false,pricing=false){
    return (items.length?items:[{description:'',amount:0}]).map((item,index)=>`<div class="job-item" data-job-item><textarea data-job-description aria-label="${esc('Job '+(index+1)+' — '+label)}" placeholder="Job description" rows="2" maxlength="1000" ${disabled?'disabled':''}>${esc(item.description)}</textarea><label><span>${pricing?'Agreed price':'Amount'} ₱</span><input data-job-amount type="number" min="0" step="0.01" aria-label="${esc('Job amount '+(index+1)+' — '+label)}" placeholder="0.00" value="${esc(item.amount||'')}" ${disabled?'disabled':''}></label>${disabled?'':`<button type="button" class="job-remove" data-job-remove aria-label="${esc('Remove job '+(index+1)+' — '+label)}">×</button>`}</div>`).join('');
  }
  function render(x,employeeId){
    const {state:s,esc,peso,button,range}=x,{snapshot:c,saved}=view(s,employeeId),totals=weeklyTotals(c);
    const released=(s.releasedPainterSlips||[]).find(r=>r.employeeId===employeeId&&key(r.period)===key(s.period)),pricing=Boolean(x.agreedJobPricing);
    function cell(j,key,label,value,type='text'){return `<input data-field="${key}" ${released?'disabled':''} ${key==='weekly'&&!pricing?'readonly title="Automatic total of the job amounts for this week"':key==='contract'&&pricing?'readonly title="Automatic total of agreed job-order prices"':''} aria-label="${esc(label+' — '+(j.id?j.unit+' '+j.plate:'New unit'))}" placeholder="${esc(label)}" type="${type}" ${type==='number'?'min="0" step="0.01"':''} value="${esc(value??'')}">`}
    function row(r){const j=r.job,label=j.id?j.unit+' '+j.plate:'New unit',done=isReleased(j),savedJob=j.id&&K.rows(s,employeeId,j.id).length>0,setup=setupHere(j,c.period),lockedJob=savedJob&&!setup,contract=cell(j,'contract','Agreed labor',setupPending(j)?0:j.contract,'number');return `<tr data-painter-row="${esc(j.id||'')}" data-initial-pricing="${setup}"><td>${cell(j,'unit','Unit',j.unit)}${cell(j,'year','Year model',j.year)}</td><td>${cell(j,'invoice','Invoice #',j.invoice)}${cell(j,'plate','Plate number',j.plate)}${j.transactionRef?`<small>Transaction: ${esc(j.transactionRef)}</small>`:''}${j.id?'':'<div data-job-matches class="job-matches" aria-live="polite"></div><div data-separate-fields hidden><label>New transaction reference<input data-field="transactionRef" maxlength="80" placeholder="New job order / transaction #"></label><label>Why separate from the released job?<textarea data-field="separateJobReason" minlength="5" maxlength="1000"></textarea></label></div>'}</td><td>${cell(j,'color','Color',j.color)}</td><td class="sheet-jobs"><div data-job-items>${jobItemsEditor(pricing?(savedJob?K.agreementItems(s,employeeId,j,c.period.end):[]):workItems(r),label,esc,released||(pricing&&lockedJob),pricing)}</div>${released||(pricing&&lockedJob)?'':`<button type="button" class="job-add" data-job-add>${pricing?'+ Job order':'+ Payment line'}</button>`}<small>${setup?'Initial entry: add job prices and this week’s payment, then Save table. Prices will lock; the recorded release date is preserved.':pricing?(savedJob?'Saved job-order prices are locked. Additional work increases agreed labor, not salary.':'Job prices add up to Agreed labor. Enter this week’s payment in the last column.'):'Amounts here are this week’s payments, not new contract prices.'}</small>${pricing&&savedJob&&!j.agreedWorkItems&&!setupPending(j)?'<small>Existing agreement shown as one total; old payment lines were not converted to contract prices.</small>':''}</td><td>${savedJob?contract.replace('<input ','<input readonly title="Saved agreement — use the contract actions below" '):contract}${savedJob?`<small>${setupPending(j)?'For re-encoding':pending(j)?'Pending confirmation':'Fixed for this payroll week'}</small>${typeof window!=='undefined'&&window.PayrollContractUI?(setupPending(j)?(setup?'':`<button type="button" data-action="setup-week" data-id="${esc(j.pricingSetup.firstWeek)}">Open first entry · ${esc(j.pricingSetup.firstWeek)}</button>`):window.PayrollContractUI.actions(s,employeeId,j,x.access,pricing)):''}`:''}</td><td class="sheet-unit-status"><select data-field="retentionStatus" aria-label="${esc('Unit status — '+label)}" ${released||(setup&&done)?'disabled':''}><option value="ongoing" ${done?'':'selected'}>Ongoing</option><option value="retained" ${done?'selected':''}>Released</option></select><label class="unit-release-date" ${done?'':'hidden'}>Release date<input type="date" data-field="unitReleasedOn" aria-label="${esc('Unit release date — '+label)}" value="${esc(j.unitReleasedOn||j.releasedOn||'')}" ${done?'required':''} ${released||(setup&&done)?'disabled':''}></label></td><td class="num" data-row-opening>${j.id?balanceText(r,peso,'opening'):'—'}</td><td class="sheet-pay">${cell(j,'weekly','Amount this week',j.id&&r.weekly?r.weekly:'','number')}${pricing?`<small>Remaining after payment: <b data-row-remaining>${j.id?balanceText(r,peso):'—'}</b></small>`:''}</td></tr>`}
    return `<section class="simple-painter"><div class="sheet-toolbar">${button('← Employees','home')}<span class="sheet-title">Weekly payroll</span><div><button type="submit" form="painterWorksheet" class="button primary" ${released?'disabled':''}>Save table</button>${button('Print','simple-print',`id="painterPrint" data-id="${esc(employeeId)}" ${saved?'':'disabled'}`)}${button('Save as PDF','simple-pdf',`id="painterPdf" data-id="${esc(employeeId)}" ${saved?'':'disabled'}`)}${button(released?'Released · locked':'Release payslip','simple-release',`id="painterRelease" data-id="${esc(employeeId)}" ${saved&&!released&&!c.rows.some(r=>setupPending(r.job))?'':'disabled'}`)}</div></div><p id="painterSaveMessage" class="sheet-save-message" role="status">${released?'Released copy locked. Edit/delete stay unavailable except through the owner correction action.':c.rows.some(r=>setupPending(r.job))?'For re-encoding: enter first job prices and Amount this week, then Save table. Finish the pending units before Release payslip.':saved?'Saved table ready to print, save as PDF, or release.':'Enter amounts → Save table → Print / Save as PDF / Release payslip.'}</p><p id="painterError" class="form-error" role="alert"></p>
      <div class="sheet-meta"><div><b>DATE RANGE</b><div class="sheet-week">${button('‹','week-previous','aria-label="Previous week"','sheet-link')}<span>${range(s.period)}</span>${button('›','week-next','aria-label="Next week"','sheet-link')}<input id="painterWeek" type="date" aria-label="Choose payroll week" value="${s.period.start}"></div><small>Saturday–Friday · all amounts in ₱</small></div><div><b>PAYDAY</b><input id="painterPayday" form="painterWorksheet" type="date" aria-label="Payroll payday" required value="${esc(c.period.releaseDate)}" ${released?'disabled':''}><small>${saved?'Saved copy date shown. ':''}Default: following Saturday · editable for holidays${released?' · released copy locked':' · Save table to keep changes'}.</small></div><div><b>EMPLOYEE</b><strong>${esc(c.employee.name)}</strong></div><div><b>POSITION</b><span>${esc(c.employee.position)}</span></div></div>
      <p class="sheet-instruction">${pricing?'Enter each job order and its agreed price once. Agreed labor is their automatic total. Enter Amount this week separately; only this payment is deducted from the unit balance and included in salary. After Save table, existing job prices are locked for all paydays. Use Additional job order for new work; its price increases agreed labor from the selected effective week.':'Type the unit, invoice and plate in the blank row; matching jobs will be shown for review. Enter this week’s payment beside each job; Amount this week adds them automatically. Saved agreed labor is read-only. Use Additional job order for new contract work, not a payment line.'} All payroll dates count toward the balance. Choose Released and its actual date, then Save table to move the unit out of this editor.</p>
      <form id="painterWorksheet" data-agreement-pricing="${pricing}" data-employee="${esc(employeeId)}"><fieldset ${released?'disabled':''} class="sheet-fields"><div class="table-wrap"><table class="painter-table"><caption class="visually-hidden">Weekly painter payroll</caption><thead><tr><th>Unit / year</th><th>Invoice # / plate</th><th>Color</th><th>Job order</th><th>Agreed labor</th><th>Unit status</th><th>Balance before week</th><th>Amount this week</th></tr></thead><tbody>${activeRows(c).map(row).join('')}${released?'':row({job:{}})}</tbody><tfoot><tr id="painterOngoingTotalRow" ${totals.released?'':'hidden'}><th colspan="7">ONGOING UNITS — THIS WEEK</th><td class="num" id="painterOngoingTotal">${peso(totals.ongoing)}</td></tr><tr id="painterReleasedTotalRow" ${totals.released?'':'hidden'}><th colspan="7">RELEASED UNITS — THIS WEEK <small>Included in total · details below / in Job history</small></th><td class="num" id="painterReleasedTotal">${peso(totals.released)}</td></tr><tr><th colspan="7">TOTAL — ALL UNITS</th><td class="num" id="painterGross">${peso(c.basic)}</td></tr><tr><th colspan="7">LESS CASH ADVANCE</th><td class="sheet-pay"><input id="painterAdvance" aria-label="Cash advance this week" type="number" min="0" step="0.01" value="${c.cashAdvance||''}"></td></tr><tr class="sheet-salary"><th colspan="7">TOTAL SALARY <small>Saved worksheet</small></th><td class="num" id="painterNet">${peso(c.net)}</td></tr></tfoot></table></div></fieldset><div class="sheet-status"><span id="painterEditStatus" role="status">${saved?'All changes saved':'Save this table to enable printing.'}</span><button type="button" data-action="painter-discard" class="button sheet-link" hidden>Undo unsaved changes</button></div></form>
      <div id="painterWarnings"></div><div id="painterBalances" class="table-wrap">${balances(x,c)}</div><details class="painter-histories"><summary>Job agreements & payment history</summary>${releasedPaymentsHistory(x,c)}${jobs(s,employeeId).map(j=>`<p>${esc(j.unit)} · ${esc(j.plate)} · Invoice ${esc(j.invoice)} <button type="button" data-contract-action="history" data-contract-job="${esc(j.id)}">View job history</button></p>`).join('')||'<p>No saved jobs yet.</p>'}</details><p class="sheet-footnote">Save table before changing the week, payday, or printing. After a successful Save table, released units leave the upper editor. Outstanding balances stay below; fully settled units stay in Job history. This week’s released-unit payments remain included in Total salary and the payslip. Available date = actual unit release + 45 calendar days. ${x.retainedPaydayPreview?'After confirming Received and the actual payment date, the paid unit leaves this table only when its payment and payday payslip are saved together. Open Past Payslips for the combined copy: weekly salary plus retained balance released, counted once. Earlier versions remain available.':'Paid balances stay on the payment payroll and disappear from the next payroll table, not from history. Confirm “Received” only after payment. This records a separate receipt, not extra weekly salary. Original released PDFs stay unchanged.'}</p></section>`;
  }
  return {setupPending,setupHere,initializePricing,workItems,normalizeWorkItems,validateWorkItems,itemizedWorkText,jobItemsEditor,linkableJobs,linkedRow,latest,savedFor,jobs,view,draft,save,emptyTable,validate,merge,compact,balances,render,startingEditable,pending,balanceText,previousRecorded,isReleased,releaseWeek,mainRows,activeRows,weeklyTotals,releasedPaymentsHistory,balanceRows,previousPayrollDate,retentionDue,retentionInfo,receiptBasis,validateReceipts,manilaDay};
});
