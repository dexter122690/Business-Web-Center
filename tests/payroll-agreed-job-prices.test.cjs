const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),K=require('../payroll-v2/contract-ledger.js'),A=require('../payroll-v2/payslip-archive.js'),PDF=require('../payroll-v2/pdf.js');
let serial=0;const uid=()=>`agreed-${++serial}`,items=()=>[{description:'Body repair',amount:8000},{description:'Polishing',amount:2000}];
const empty=()=>W.emptyWorkspace([{id:'p',name:'Sample Painter',position:'Auto painter',type:'contract',rate:0}],undefined,'2026-11-14');
const row=s=>S.view(s,'p').snapshot.rows[0];
const seed=()=>S.save(empty(),'p',[{unit:'Honda',plate:'TEST 123',invoice:'INV-1',agreementMode:true,agreedWorkItems:items(),weekly:5000}],0,uid);
const addition=(s,amount=2000,date='2026-11-23')=>K.createEvent(s,'p',row(s).job.id,{kind:'addition',amount,effectiveOn:date,description:'Additional bumper repair',reason:'Approved extra work',itemizedAgreement:true},uid);
test('job prices total the agreement; manual weekly payment alone enters salary',()=>{
 const s=seed(),r=row(s);assert.equal(r.job.contract,10000);assert.equal(r.weekly,5000);assert.equal(r.remaining,5000);assert.equal(S.savedFor(s,'p').snapshot.net,5000);assert.deepEqual(r.agreementItems,items());assert.deepEqual(S.validate(s),[]);
 const next=S.save(s,'p',[{id:r.job.id,agreementMode:true,weekly:2500}],500,uid);assert.equal(row(next).job.contract,10000);assert.equal(row(next).remaining,7500);assert.equal(S.savedFor(next,'p').snapshot.net,2000);
 const noPayment=S.save(empty(),'p',[{unit:'Unpaid',agreementMode:true,agreedWorkItems:items()}],0,uid);assert.equal(row(noPayment).weekly,0);assert.equal(row(noPayment).remaining,10000);
 const autoPrice=S.save(empty(),'p',[{unit:'Auto total',contract:'',agreementMode:true,agreedWorkItems:items(),weekly:500}],0,uid);assert.equal(row(autoPrice).job.contract,10000);assert.equal(row(autoPrice).job.contractPending,undefined);
});
test('base descriptions and prices lock on first save, even during the same week',()=>{
 const s=seed(),id=row(s).job.id,before=structuredClone(s);
 for(const changed of [[{description:'Changed',amount:10000}],[{description:'Body repair',amount:9000},{description:'Polishing',amount:1000}],[]])assert.throws(()=>S.save(s,'p',[{id,agreementMode:true,agreedWorkItems:changed,weekly:5000}],0,uid),/locked/);
 assert.throws(()=>K.apply(s,{...addition(s),kind:'correction',amount:10000}),/locked/);
 const forged=structuredClone(s);forged.painterTestSheets[0].snapshot.rows[0].job.agreedWorkItems[0].description='Forged';assert.ok(S.validate(forged,s).length);assert.deepEqual(s,before);
});
test('later payday keeps agreed line prices and resets only the manual weekly payment',()=>{
 const s=seed(),next=W.selectWeek(s,'2026-11-21'),r=row(next);assert.deepEqual(r.agreementItems,items());assert.equal(r.job.contract,10000);assert.equal(r.opening,5000);assert.equal(r.weekly,0);
 const paid=S.save(next,'p',[{id:r.job.id,agreementMode:true,weekly:1500}],0,uid);assert.equal(row(paid).remaining,3500);assert.deepEqual(paid.painterTestSheets[0],s.painterTestSheets[0]);assert.deepEqual(S.validate(paid,s),[]);
});
test('addition raises applicable agreement and balances without creating weekly pay',()=>{
 let s=seed(),id=row(s).job.id;s=S.save(W.selectWeek(s,'2026-11-21'),'p',[{id,agreementMode:true,weekly:1000}],0,uid);s=S.save(W.selectWeek(s,'2026-11-28'),'p',[{id,agreementMode:true,weekly:500}],0,uid);
 const before=structuredClone(s),next=K.apply(s,addition(s)),weeks=next.painterTestSheets;
 assert.deepEqual(weeks[0],s.painterTestSheets[0]);assert.equal(weeks[1].snapshot.rows[0].job.contract,12000);assert.equal(weeks[1].snapshot.rows[0].remaining,6000);assert.equal(weeks[2].snapshot.rows[0].remaining,5500);
 for(let i=0;i<weeks.length;i++)assert.equal(weeks[i].snapshot.net,s.painterTestSheets[i].snapshot.net);
 assert.equal(weeks[1].snapshot.rows[0].agreementItems.at(-1).amount,2000);assert.deepEqual(weeks[1].snapshot.rows[0].job.agreedWorkItems,items());assert.deepEqual(S.validate(next,s),[]);assert.deepEqual(s,before);
});
test('cross-date overpayment still blocked and valid backdated payments recalculate balances',()=>{
 let s=seed(),id=row(s).job.id;s=S.save(W.selectWeek(s,'2026-11-21'),'p',[{id,agreementMode:true,weekly:1000}],0,uid);
 assert.throws(()=>S.save(W.selectWeek(s,'2026-11-07'),'p',[{linkJobId:id,agreementMode:true,weekly:4001}],0,uid),/exceed agreed labor/);
 const next=S.save(W.selectWeek(s,'2026-11-07'),'p',[{linkJobId:id,agreementMode:true,weekly:3000}],0,uid);assert.equal(S.view(W.selectWeek(next,'2026-11-21'),'p').snapshot.rows[0].remaining,1000);assert.deepEqual(S.validate(next,s),[]);
 const raised=K.apply(s,addition(s));assert.throws(()=>S.save(W.selectWeek(raised,'2026-11-07'),'p',[{linkJobId:id,agreementMode:true,weekly:6000}],0,uid),/effective|later additional/i);
});
test('released originals remain fixed; new work may apply to a later open payroll',()=>{
 let s=seed();s=A.release(s,S.savedFor(s,'p').id,uid(),'2026-11-21');const old=structuredClone(s.releasedPainterSlips);
 assert.throws(()=>K.apply(s,addition(s,2000,'2026-11-16')),/released payslip/);
 const next=K.apply(s,addition(s));assert.deepEqual(next.releasedPainterSlips,old);assert.deepEqual(S.validate(next,s),[]);
 const future=row(W.selectWeek(next,'2026-11-21'));assert.equal(future.job.contract,12000);assert.equal(future.agreementItems.length,3);assert.equal(future.weekly,0);
});
test('legacy payment line prices are never reinterpreted as agreement components',()=>{
 const old=S.save(empty(),'p',[{unit:'Legacy',contract:10000,workItems:[{description:'Earlier paid work',amount:2500}]}],0,uid),before=structuredClone(old),id=row(old).job.id;
 const next=S.save(old,'p',[{id,agreementMode:true,weekly:1000}],0,uid),r=row(next);assert.equal(r.job.contract,10000);assert.equal(r.weekly,1000);assert.deepEqual(r.workItems,row(old).workItems);assert.equal(r.agreementItems[0].amount,10000);assert.equal(r.job.agreedWorkItems,undefined);assert.deepEqual(old,before);assert.deepEqual(S.validate(next,old),[]);
});
test('manual prices support cents, reject invalid lines and blank row does not create a unit',()=>{
 const s=S.save(empty(),'p',[{unit:'Cents',agreementMode:true,agreedWorkItems:[{description:'One',amount:0.1},{description:'Two',amount:0.2}],weekly:0.1},{unit:'',contract:'',weekly:'',agreementMode:true,agreedWorkItems:[{description:'',amount:''}]}],0,uid);assert.equal(row(s).job.contract,.3);assert.equal(row(s).remaining,.2);assert.equal(S.view(s,'p').snapshot.rows.length,1);
 for(const bad of [[],[{description:'',amount:1}],[{description:'Invalid',amount:0}],[{description:'Invalid',amount:-1}]])assert.throws(()=>S.save(empty(),'p',[{unit:'Bad',agreementMode:true,agreedWorkItems:bad}],0,uid));
});
test('new editor locks saved job prices, keeps weekly payment editable and prints contract items',()=>{
 const s=seed(),r=row(s),html=S.render({state:s,esc:String,peso:String,button:()=>'',range:()=>'',agreedJobPricing:true},'p');assert.match(html,/data-agreement-pricing="true"/);assert.doesNotMatch(html,/data-field="weekly"[^>]*readonly/);assert.match(html,/data-job-amount[^>]*disabled/);assert.match(html,/\+ Job order/);assert.doesNotMatch(html,/\+ Payment line/);
 const json=JSON.stringify(PDF.definition(S.savedFor(s,'p')));assert.match(json,/₱8,000.00/);assert.match(json,/₱2,000.00/);assert.equal(r.weekly,5000);
});

test('additional work refreshes an existing combined payday copy without changing salary or receipts',()=>{
 const R=require('../payroll-v2/retained-payday.js');
 let s=seed(),id=row(s).job.id;s=S.save(W.selectWeek(s,'2026-11-21'),'p',[{id,agreementMode:true,weekly:1000},{unit:'Retained',agreementMode:true,agreedWorkItems:[{description:'Paint',amount:3000}],weekly:2000,retentionStatus:'retained',unitReleasedOn:'2026-10-01'}],0,uid);
 const retained=S.view(s,'p').snapshot.rows.find(r=>r.job.unit==='Retained').job,b=S.receiptBasis(s,'p',retained.id);
 s=R.receive(s,{employeeId:'p',jobId:retained.id,date:'2026-11-26',expectedAmount:b.amount,expectedReleaseDate:b.unitReleasedOn,expectedPeriod:R.target(s,'p','2026-11-26').period,acknowledge:true},uid,'2026-11-26T05:00:00Z','2026-11-26');
 const old=structuredClone(s),changed=K.apply(s,addition(s)),next=R.prepareSave(changed,s,uid,'2026-11-26T06:00:00Z'),copy=R.latestCopies(next)[0];
 assert.deepEqual(s,old);assert.deepEqual(next.painterRetentionReceipts,s.painterRetentionReceipts);assert.deepEqual(next.retainedPaydayCopies[0],s.retainedPaydayCopies[0]);assert.equal(copy.version,2);assert.equal(copy.snapshot.net,3000);assert.equal(copy.snapshot.paydayTotal,4000);assert.equal(copy.snapshot.rows.find(r=>r.job.id===id).job.contract,12000);assert.deepEqual(R.validate(next,s),[]);
 const forged=structuredClone(changed);forged.painterTestSheets.at(-1).snapshot.net++;
 assert.throws(()=>R.prepareSave(forged,s,uid),/total|separately|salary/i);
 const alteredReceipt=structuredClone(changed);alteredReceipt.painterRetentionReceipts[0].amount++;
 assert.throws(()=>R.prepareSave(alteredReceipt,s,uid));
});
