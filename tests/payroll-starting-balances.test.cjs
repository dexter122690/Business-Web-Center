const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js'),PDF=require('../payroll-v2/pdf.js');
const seed=()=>W.emptyWorkspace([{id:'p',name:'Fictional Painter',position:'Painter',type:'contract',rate:0},{id:'other',name:'Other staff',position:'Admin',type:'daily',rate:650}],undefined,'2026-11-28');
let n=0;const uid=()=>`opening-test-${++n}`,copy=structuredClone;
const first=()=>S.save(seed(),'p',[{unit:'Honda City',plate:'TEST 001',contract:15000,priorSettlement:8000,weekly:2000}],0,uid);
const row=s=>S.view(s,'p').snapshot.rows[0];
const html=s=>S.render({state:s,esc:String,peso:String,range:p=>p.start,button:(label,action,attrs='')=>`<button data-action="${action}" ${attrs}>${label}</button>`},'p');

test('pre-BWC settlement reduces the opening only; original contract and weekly pay stay separate',()=>{
 const before=seed(),s=S.save(before,'p',[{unit:'Honda City',contract:15000,priorSettlement:8000,weekly:2000}],300,uid),c=S.savedFor(s,'p').snapshot;
 assert.deepEqual([c.rows[0].job.contract,c.rows[0].job.priorSettlement,c.rows[0].opening,c.rows[0].remaining,c.basic,c.net],[15000,8000,7000,5000,2000,1700]);
 assert.equal(c.rows[0].job.payrollStart,'2026-11-28');assert.deepEqual(before,seed());
 for(const k of ['employees','jobs','payments','releases','advances','attendance','payslips','releasedPainterSlips'])assert.deepEqual(s[k],before[k]);
 assert.deepEqual(S.validate(s),[]);assert.match(html(s),/Settled before BWC/);assert.match(html(s),/Through 2026-11-27/);
});
test('save/reload is idempotent and each future week deducts the opening settlement just once',()=>{
 let s=first(),j=row(s).job,initial=copy(S.savedFor(s,'p'));
 s=S.save(s,'p',[{...j,weekly:2000}],0,uid);assert.deepEqual(S.savedFor(s,'p'),initial);
 s=W.selectWeek(s,'2026-12-05');assert.equal(row(s).opening,5000);assert.equal(row(s).weekly,0);
 s=S.save(s,'p',[{id:j.id,weekly:1000}],0,uid);assert.equal(row(s).remaining,4000);
 s=W.selectWeek(s,'2026-12-12');assert.equal(row(s).opening,4000);assert.deepEqual(S.validate(s),[]);
 assert.deepEqual(s.painterTestSheets.find(x=>x.id===initial.id),initial);
 assert.deepEqual(A.previousPayments(s,S.view(s,'p').snapshot).map(p=>p.amount),[2000,1000]);
});
test('opening units do not appear in weeks before their first BWC cutoff',()=>{
 const s=first();assert.equal(S.view(W.selectWeek(s,'2026-11-21'),'p').snapshot.rows.length,0);
 assert.equal(S.view(W.selectWeek(s,'2026-12-05'),'p').snapshot.rows.length,1);
});
test('opening can be corrected in its first working week but locks once another worksheet exists',()=>{
 let s=first(),j=row(s).job;s=S.save(s,'p',[{id:j.id,priorSettlement:7000,weekly:2000}],0,uid);assert.equal(row(s).opening,8000);
 s=W.selectWeek(s,'2026-12-05');assert.equal(S.startingEditable(s,'p',row(s).job),false);
 assert.throws(()=>S.save(s,'p',[{id:j.id,priorSettlement:6000,weekly:1000}],0,uid),/locked/);
 s=S.save(s,'p',[{id:j.id,weekly:1000}],0,uid);s=W.selectWeek(s,'2026-11-28');
 assert.equal(S.startingEditable(s,'p',row(s).job),false);assert.throws(()=>S.save(s,'p',[{id:j.id,priorSettlement:6000,weekly:2000}],0,uid),/locked/);
 assert.throws(()=>S.save(s,'p',[{id:j.id,weekly:2500}],0,uid),/later worksheet/);
 assert.throws(()=>S.emptyTable(s,'p',uid),/first BWC worksheet|later worksheet/);
});
test('released source and PDF snapshot retain their opening information and remain locked',()=>{
 let s=first(),record=S.savedFor(s,'p');s=A.release(s,record.id,uid(),'2026-12-05');const released=copy(s.releasedPainterSlips[0]);
 assert.equal(S.startingEditable(s,'p',row(s).job),false);assert.throws(()=>S.save(s,'p',[{id:row(s).job.id,priorSettlement:1}],0,uid),/released/);
 s=W.selectWeek(s,'2026-12-05');s=S.save(s,'p',[{id:row(s).job.id,weekly:1000}],0,uid);
 assert.deepEqual(s.releasedPainterSlips[0],released);assert.deepEqual(A.validate(s),[]);
});
test('invalid or duplicate opening amounts fail without changing prior data',()=>{
 for(const amount of [-1,15001,Infinity,NaN,'bad'])assert.throws(()=>S.save(seed(),'p',[{unit:'Test',contract:15000,priorSettlement:amount,weekly:0}],0,uid),/Settled before BWC/);
 let legacy=S.save(seed(),'p',[{unit:'Existing BWC unit',contract:15000,weekly:2000}],0,uid);const j=row(legacy).job;
 legacy=W.selectWeek(legacy,'2026-12-05');assert.throws(()=>S.save(legacy,'p',[{id:j.id,priorSettlement:2000,weekly:0}],0,uid),/locked/);
 const s=first(),bad=copy(s);delete row(bad).job; // view returns a copy, never modifies saved records.
 assert.deepEqual(s,bad);
 for(const corrupt of [x=>x.job.priorSettlement=-1,x=>x.job.payrollStart='2026-11-27',x=>{x.opening+=1;x.remaining+=1},x=>delete x.job.priorSettlement]){
  const invalid=copy(s);corrupt(invalid.painterTestSheets[0].snapshot.rows[0]);assert.ok(S.validate(invalid,s).length);
 }
 const stripped=copy(s);delete stripped.painterTestSheets[0].snapshot.rows[0].job.priorSettlement;delete stripped.painterTestSheets[0].snapshot.rows[0].job.payrollStart;
 assert.match(S.validate(stripped,s).join(),/Keep the unit/);
});
test('fully settled, zero and centavo amounts behave correctly without extra payroll',()=>{
 for(const [contract,settled,opening] of [[15000,15000,0],[15000,0,15000],[1000.55,333.33,667.22]]){
  const s=S.save(seed(),'p',[{unit:'Test',contract,priorSettlement:settled,weekly:0}],0,uid);assert.equal(row(s).opening,opening);assert.equal(S.savedFor(s,'p').snapshot.net,0);
 }
});
test('retained balances and dates carry forward without creating a retention payout',()=>{
 let s=S.save(seed(),'p',[{unit:'Released test unit',contract:15000,priorSettlement:12000,weekly:0,retentionStatus:'retained',unitReleasedOn:'2026-11-20',retentionDue:'2027-01-04'}],0,uid);
 s=W.selectWeek(s,'2026-12-05');const r=row(s);assert.equal(r.remaining,3000);assert.equal(r.job.retentionDue,'2027-01-04');assert.equal(S.view(s,'p').snapshot.net,0);assert.deepEqual(s.releases,[]);
});
test('PDF and half-sheet preview identify pre-BWC settlements as references, not new salary',()=>{
 const record=S.savedFor(first(),'p'),before=copy(record),definition=PDF.definition(record),json=JSON.stringify(definition);
 assert.deepEqual(definition.pageSize,{width:612,height:396});assert.match(json,/PRE-BWC SETTLEMENTS/);assert.match(json,/₱8,000.00/);assert.match(json,/₱7,000.00/);assert.match(json,/₱2,000.00/);assert.match(json,/2026-11-28/);
 const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../payroll-v2/half-slips.js'),'utf8'),{window});
 const preview=JSON.stringify(window.PayrollSlips.blocks(record.snapshot));assert.match(preview,/PRE-BWC SETTLEMENTS/);assert.match(preview,/NOT THIS WEEK/);assert.deepEqual(record,before);
});
