const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),L=require('../payroll-v2/painter-ledger.js'),A=require('../payroll-v2/payslip-archive.js');
let n=0;const uid=()=>`cross-date-${++n}`,clone=structuredClone;
const seed=()=>W.emptyWorkspace([{id:'p',name:'Fictional Painter',position:'Auto painter',type:'contract',rate:0},{id:'q',name:'Other Painter',position:'Auto painter',type:'contract',rate:0}],undefined,'2026-11-25');
const row=s=>S.view(s,'p').snapshot.rows[0];
const fixture=()=>S.save(seed(),'p',[{unit:'Honda City',invoice:'TEST-1',plate:'TEST 245',contract:10000,weekly:5000}],0,uid);
function backdate(s,weekly){const id=row(s).job.id;return S.save(W.selectWeek(s,'2026-11-10'),'p',[{linkJobId:id,weekly}],0,uid)}
test('Nov25 5000 already paid limits Nov10 to 5000, including centavos; no mutation on failure',()=>{
 const s=fixture(),before=clone(s);assert.equal(S.view(W.selectWeek(s,'2026-11-10'),'p').snapshot.rows.length,0);
 for(const amount of [5000.01,6000])assert.throws(()=>backdate(s,amount),/Maximum amount for this week: ₱5,000.00/);
 const next=backdate(s,5000);assert.equal(row(next).remaining,5000);
 const later=S.view(W.selectWeek(next,'2026-11-25'),'p').snapshot;assert.deepEqual([later.rows[0].opening,later.rows[0].weekly,later.rows[0].remaining,later.net],[5000,5000,0,5000]);
 assert.deepEqual(s,before);assert.deepEqual(S.validate(next,s),[]);
});
test('valid historical 3000 updates later opening to 7000, remaining 2000; weekly salary unchanged',()=>{
 const s=fixture(),next=backdate(s,3000),later=S.view(W.selectWeek(next,'2026-11-25'),'p').snapshot;
 assert.deepEqual([later.rows[0].opening,later.rows[0].weekly,later.rows[0].remaining,later.net],[7000,5000,2000,5000]);
 const again=S.save(next,'p',[{id:row(next).job.id,weekly:3000}],0,uid);assert.deepEqual(again,next);
 for(const k of ['employees','jobs','payments','releases','advances','attendance','payslips','releasedPainterSlips'])assert.deepEqual(next[k],s[k]);
});
test('past corrections recalculate every later worksheet without changing other employees/jobs',()=>{
 let s=backdate(fixture(),3000),id=row(s).job.id;s=S.save(W.selectWeek(s,'2026-12-05'),'p',[{id,weekly:1000},{unit:'Other unit',contract:5000,weekly:100}],0,uid);
 s=S.save(s,'q',[{unit:'Other employee unit',contract:2000,weekly:1000}],0,uid);const other=clone(S.savedFor(s,'q'));
 const next=S.save(W.selectWeek(s,'2026-11-10'),'p',[{id,weekly:2000}],0,uid);
 const nov=S.view(W.selectWeek(next,'2026-11-25'),'p').snapshot.rows[0],dec=S.view(W.selectWeek(next,'2026-12-05'),'p').snapshot;
 assert.deepEqual([nov.opening,nov.remaining,dec.rows[0].opening,dec.rows[0].remaining],[8000,3000,3000,2000]);assert.equal(dec.net,1100);assert.deepEqual(S.savedFor(next,'q'),null);
 assert.deepEqual(next.painterTestSheets.find(x=>x.id===other.id),other);
});
test('unknown amounts stay pending but a known contract in any week caps every payment',()=>{
 let s=S.save(seed(),'p',[{unit:'Unknown job',contract:'',weekly:5000}],0,uid),id=row(s).job.id;
 s=backdate(s,3000);assert.equal(row(s).job.payrollStart,'2026-11-07');assert.deepEqual(S.validate(s),[]);
 const later=S.view(W.selectWeek(s,'2026-11-25'),'p').snapshot.rows[0];assert.deepEqual([later.previousRecorded,later.opening,later.job.payrollStart],[3000,null,'2026-11-07']);
 assert.throws(()=>S.save(W.selectWeek(s,'2026-11-25'),'p',[{id,contract:7000,weekly:5000}],0,uid),/exceed agreed labor/);
 s=S.save(W.selectWeek(s,'2026-11-25'),'p',[{id,contract:10000,weekly:5000}],0,uid);assert.equal(row(s).remaining,2000);
 assert.equal(S.view(W.selectWeek(s,'2026-11-10'),'p').snapshot.rows[0].opening,null);
 assert.throws(()=>S.save(W.selectWeek(s,'2026-11-10'),'p',[{id,weekly:6000}],0,uid),/exceed agreed labor/);
 assert.throws(()=>S.save(s,'p',[{id,contract:'',weekly:5000}],0,uid),/confirmed agreed labor/);
});
test('released payslip blocks an earlier payment that would alter its balances or printed history',()=>{
 let s=fixture();s=A.release(s,S.savedFor(s,'p').id,uid(),'2026-11-28');const before=clone(s);
 assert.throws(()=>backdate(s,3000),/released payslip|locked/);assert.deepEqual(s,before);
 const next=S.save(W.selectWeek(s,'2026-09-05'),'p',[{unit:'Unrelated historical unit',contract:1000,weekly:500}],0,uid);
 assert.deepEqual(next.releasedPainterSlips,s.releasedPainterSlips);
});
test('same invoice/plate uses existing stable job id; model name alone never merges jobs',()=>{
 const s=fixture(),earlier=W.selectWeek(s,'2026-11-10');
 assert.throws(()=>S.save(earlier,'p',[{unit:'Different description',invoice:' test-1 ',plate:'test 245',contract:10000,weekly:100}],0,uid),/Use existing job/);
 const next=S.save(earlier,'p',[{unit:'Honda City',invoice:'TEST-2',plate:'TEST 245',contract:5000,weekly:500}],0,uid);assert.notEqual(row(next).job.id,row(s).job.id);
 assert.throws(()=>S.draft(earlier,'p',[{linkJobId:row(s).job.id,weekly:1},{linkJobId:row(s).job.id,weekly:1}],0,uid),/selected unit/);
 assert.throws(()=>S.linkedRow(earlier,'q',row(s).job.id),/existing job/);
});
test('nonzero pre-BWC settlement is counted once and cannot be moved to an earlier anchor',()=>{
 const s=S.save(seed(),'p',[{unit:'Old settled unit',contract:10000,priorSettlement:2000,weekly:5000}],0,uid),id=row(s).job.id;
 assert.throws(()=>backdate(s,1000),/locked starting balance/);
 assert.throws(()=>S.save(W.selectWeek(s,'2026-12-05'),'p',[{id,weekly:3000.01}],0,uid),/Maximum amount for this week: ₱3,000.00/);
 assert.equal(row(S.save(W.selectWeek(s,'2026-12-05'),'p',[{id,weekly:3000}],0,uid)).remaining,0);
});
test('historic linking preserves future actual release status and reference date',()=>{
 let s=S.save(seed(),'p',[{unit:'Released later',contract:10000,weekly:5000,retentionStatus:'retained',unitReleasedOn:'2026-11-25'}],0,uid),id=row(s).job.id;
 const linked=S.linkedRow(W.selectWeek(s,'2026-11-10'),'p',id);assert.equal(linked.job.retentionStatus,'ongoing');
 s=backdate(s,3000);const later=S.view(W.selectWeek(s,'2026-11-25'),'p').snapshot.rows[0];
 assert.equal(later.job.retentionStatus,'retained');assert.equal(later.job.unitReleasedOn,'2026-11-25');assert.equal(later.remaining,2000);
});
test('forged stale future balances and contract mismatches fail transition checks',()=>{
 const s=fixture(),next=backdate(s,3000),bad=clone(next),r=bad.painterTestSheets.find(s=>s.period.start==='2026-11-21').snapshot.rows[0];r.opening=10000;r.remaining=5000;
 assert.match(L.check(bad,s).join(),/other dates/);
 assert.throws(()=>S.save(next,'p',[{id:row(next).job.id,contract:11000,weekly:3000}],0,uid),/same agreed labor/);
});
test('legacy payments are included exactly once when a weekly worksheet replaces them',()=>{
 const s=seed();s.jobs=[{id:'legacy-job',employeeId:'p',unit:'Legacy',plate:'',color:'',work:'',contract:10000}];s.payments=[{id:'old-pay',jobId:'legacy-job',employeeId:'p',date:'2026-11-25',gross:5000,retention:0}];
 let next=S.save(s,'p',[{id:'legacy-job',weekly:5000}],0,uid);assert.equal(L.payments(next,'p','legacy-job').reduce((n,p)=>n+p.amount,0),5000);
 next=W.selectWeek(next,'2026-11-10');assert.throws(()=>S.save(next,'p',[{id:'legacy-job',weekly:6000}],0,uid),/exceed agreed labor/);
});
test('received retained amount is included in the global cap and receipt history stays locked',()=>{
 let s=S.save(seed(),'p',[{unit:'Received balance',contract:10000,weekly:5000,retentionStatus:'retained',unitReleasedOn:'2026-09-01'}],0,uid),id=row(s).job.id;
 const basis=S.receiptBasis(s,'p',id);s.painterRetentionReceipts=[{id:'receipt',employeeId:'p',jobId:id,amount:5000,receivedOn:'2026-11-25',recordedAt:'2026-11-25T01:00:00Z',basis}];
 assert.throws(()=>backdate(s,100),/Maximum amount for this week: ₱0.00/);assert.deepEqual(S.validate(s),[]);
});
