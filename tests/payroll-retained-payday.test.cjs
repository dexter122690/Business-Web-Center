const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js'),R=require('../payroll-v2/retained-payday.js'),PDF=require('../payroll-v2/pdf.js');
let serial=0;const uid=()=>`payday-${++serial}`,now='2026-11-26T05:00:00Z',today='2026-11-26';
function seed(){
 let s=S.save(W.emptyWorkspace([{id:'p',name:'Test Painter',type:'contract',position:'Painter',rate:0},{id:'other',name:'Other',type:'contract',position:'Painter',rate:0}],undefined,'2026-11-14'),'p',[
  {unit:'Nissan',plate:'TEST 1',contract:10000,weekly:5000,retentionStatus:'retained',unitReleasedOn:'2026-10-01'},
  {unit:'Suzuki',plate:'TEST 2',contract:3000,weekly:2000,retentionStatus:'retained',unitReleasedOn:'2026-10-01'}],0,uid);
 s=S.save(W.selectWeek(s,'2026-11-21'),'p',[{unit:'Ongoing',contract:10000,weekly:4000}],500,uid);return s;
}
function args(s,index=0,date=today){const j=S.view(s,'p').snapshot.rows.find(r=>r.job.unit===['Nissan','Suzuki'][index]).job,b=S.receiptBasis(s,'p',j.id);return {employeeId:'p',jobId:j.id,date,expectedAmount:b.amount,expectedReleaseDate:b.unitReleasedOn,expectedPeriod:R.target(s,'p',date).period,acknowledge:true}}
const receive=(s,index=0,date=today)=>R.receive(s,args(s,index,date),uid,now,today);
const record=s=>R.latestCopies(s)[0];
function balance(s){const c=S.view(s,'p').snapshot;return S.balances({state:s,esc:String,peso:String,canReceive:true,today,coveredReceipts:R.covered(s,c)},c)}
function slips(){const context={window:{SimplePainter:S,PayrollWorkflow:W}};vm.runInNewContext(fs.readFileSync(require.resolve('../payroll-v2/half-slips.js'),'utf8'),context);return context.window.PayrollSlips}

test('receipt and combined payday copy are created together, without mutating weekly salary or source',()=>{
 const s=seed(),before=structuredClone(s),n=receive(s),r=record(n);
 assert.deepEqual(s,before);assert.deepEqual(n.painterTestSheets,s.painterTestSheets);assert.equal(r.snapshot.net,3500);
 assert.equal(r.snapshot.retainedPaydayTotal,5000);assert.equal(r.snapshot.paydayTotal,8500);assert.equal(r.period.releaseDate,'2026-11-28');
 assert.equal(r.weeklyReleased,false);assert.equal(n.releasedPainterSlips.length,0);assert.deepEqual(R.validate(n,s),[]);
 assert.match(balance(s),/Nissan/);assert.doesNotMatch(balance(n),/Nissan/);assert.match(balance(n),/Suzuki/);
 assert.equal(R.records(n,'p').length,1);assert.equal(R.records(n,'other').length,0);
});
test('same receipt retry is idempotent; another date cannot create a second payment',()=>{
 const s=seed(),a=args(s),n=R.receive(s,a,uid,now,today);
 assert.deepEqual(R.receive(n,a,uid,now,today),n);
 assert.throws(()=>R.receive(n,{...a,date:'2026-11-25'},uid,now,today),/already received/);
});
test('multiple units share one payday entry, append a version and sum each receipt once',()=>{
 const s=receive(seed()),old=structuredClone(record(s)),n=receive(s,1),rows=R.records(n,'p'),r=rows[0].record;
 assert.equal(rows.length,1);assert.equal(rows[0].versions.length,1);assert.equal(r.version,2);assert.equal(r.updatedCopy,true);
 assert.equal(r.snapshot.retainedPaydayTotal,6000);assert.equal(r.snapshot.paydayTotal,9500);assert.deepEqual(n.retainedPaydayCopies[0],old);
 assert.deepEqual(R.refresh(n,uid,now),n);assert.deepEqual(R.validate(n,s),[]);
});
test('payment against an existing released payslip preserves original and exposes one updated copy',()=>{
 let s=seed();s=A.release(s,S.savedFor(s,'p').id,uid(),'2026-11-26',now);const original=structuredClone(s.releasedPainterSlips[0]);
 const n=receive(s),rows=R.records(n,'p');assert.equal(rows.length,1);assert.equal(rows[0].record.updatedCopy,true);assert.equal(rows[0].record.weeklyReleased,true);
 assert.deepEqual(n.releasedPainterSlips[0],original);assert.deepEqual(rows[0].versions,[original]);assert.equal(rows[0].record.snapshot.paydayTotal,8500);
 assert.deepEqual(A.validate(n,s),[]);
});
test('confirming weekly salary after receipt updates combined copy, not the prior version',()=>{
 const s=receive(seed()),old=structuredClone(record(s));let n=A.release(s,S.savedFor(s,'p').id,uid(),'2026-11-26',now);n=R.refresh(n,uid,now);
 assert.equal(record(n).weeklyReleased,true);assert.equal(record(n).version,2);assert.equal(record(n).snapshot.paydayTotal,8500);assert.deepEqual(n.retainedPaydayCopies[0],old);
 assert.deepEqual(R.validate(n,s),[]);
});
test('Saturday payment belongs to that payday, not the next Saturday',()=>{
 const s=seed(),n=receive(s,0,'2026-11-21');assert.equal(record(n).period.start,'2026-11-14');assert.equal(record(n).period.releaseDate,'2026-11-21');
 assert.equal(R.target(s,'p','2026-11-22').period.releaseDate,'2026-11-28');
});
test('holiday payday is honored; conflicting dates and missing saved cutoff are blocked',()=>{
 let s=seed();s=S.save(W.setPayday(s,'2026-11-27'),'p',[],500,uid);assert.equal(R.target(s,'p','2026-11-26').period.releaseDate,'2026-11-27');
 assert.throws(()=>R.target(s,'p','2026-11-28'),/Save the payroll table/);
 s.payrollPaydays['2026-11-07']='2026-11-30';assert.throws(()=>R.target(s,'p','2026-11-26'),/out of order/);
});
test('45-day date, future date, acknowledgement and stale balance checks leave state unchanged',()=>{
 const s=seed(),before=structuredClone(s),a=args(s);
 for(const change of [{date:'2026-11-14'},{date:'2026-11-27'},{acknowledge:false},{expectedAmount:999},{expectedReleaseDate:'2026-10-02'},{expectedPeriod:{...a.expectedPeriod,releaseDate:'2026-11-29'}}])assert.throws(()=>R.receive(s,{...a,...change},uid,now,today));
 assert.deepEqual(s,before);
});
test('receipt cannot disappear without a stored payday copy; older versions cannot change',()=>{
 const s=receive(seed()),bad=structuredClone(s);bad.retainedPaydayCopies=[];assert.match(R.validate(bad,s).join(' '),/together|read-only/);
 const changed=structuredClone(s);changed.retainedPaydayCopies[0].snapshot.net++;assert.match(R.validate(changed,s).join(' '),/read-only|exactly once/);
 const doubled=structuredClone(s),r=doubled.retainedPaydayCopies[0];r.snapshot.retainedPaydayPayments.push(structuredClone(r.snapshot.retainedPaydayPayments[0]));r.snapshot.retainedPaydayTotal*=2;r.snapshot.paydayTotal=r.snapshot.net+r.snapshot.retainedPaydayTotal;assert.match(R.validate(doubled).join(' '),/only once/);
});
test('next payroll never repeats retained payment; earlier payroll does not claim future payment',()=>{
 const s=receive(seed()),n=R.refresh(S.save(W.selectWeek(s,'2026-11-28'),'p',[],0,uid),uid,now);
 assert.equal(R.latestCopies(n).length,1);assert.equal(S.savedFor(n,'p').snapshot.net,0);assert.doesNotMatch(balance(n),/Nissan/);
 const before=W.selectWeek(n,'2026-11-14');assert.match(balance(before),/Nissan/);assert.match(balance(before),/Received in a later payroll/);
});
test('PDF and print preview itemize payments at bottom with matching totals and status',()=>{
 const s=receive(seed()),r=record(s),pdf=JSON.stringify(PDF.definition(r)),html=slips().cardHtml(r,slips().blocks(r.snapshot,true),1,1,true);
 assert.match(pdf,/RETAINED BALANCE RELEASED — THIS PAYDAY/);assert.match(pdf,/2026-11-26/);assert.match(pdf,/₱8,500.00/);assert.match(pdf,/WEEKLY SALARY UNCONFIRMED/);
 assert.match(html,/RETAINED BALANCE RELEASED — THIS PAYDAY/);assert.match(html,/₱8,500.00/);assert.match(html,/WEEKLY SALARY UNCONFIRMED/);
 assert.equal(slips().blocks(r.snapshot,true).filter(b=>b.kind==='retained-paid-grid').length,1);
 assert.ok(!slips().blocks(r.snapshot,true).some(b=>b.kind==='balance-grid'&&b.text.includes('Nissan')));
});
test('paid salary copy says total received and never changes original PDF definition',()=>{
 let s=seed();s=A.release(s,S.savedFor(s,'p').id,uid(),'2026-11-26',now);const original=s.releasedPainterSlips[0],pdf=PDF.definition(original);
 const n=receive(s),r=record(n);assert.match(JSON.stringify(PDF.definition(r)),/TOTAL RECEIVED FOR THIS PAYDAY/);assert.equal(JSON.stringify(PDF.definition(n.releasedPainterSlips[0])),JSON.stringify(pdf));
});
test('live application enables combined payments only after server capability confirmation',()=>{
 const app=fs.readFileSync(require.resolve('../payroll-v2/app-v2.js'),'utf8'),online=fs.readFileSync(require.resolve('../payroll-v2/online.js'),'utf8');
 assert.match(app,/O.retainedPaydayPreview===true/);assert.match(online,/get retainedPaydayPreview\(\)\{return workflowVersion===2\}/);assert.match(online,/PayrollRetainedPayday.prepareSave/);
});
