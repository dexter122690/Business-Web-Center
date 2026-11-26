const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),K=require('../payroll-v2/contract-ledger.js'),U=require('../payroll-v2/contract-ui.js'),A=require('../payroll-v2/payslip-archive.js');
let n=0;const uid=()=>`contract-test-${++n}`,clone=structuredClone;
const seed=()=>W.emptyWorkspace([{id:'p',name:'Fictional Painter',position:'Auto painter',type:'contract',rate:0}],undefined,'2026-09-12');
const first=s=>s.painterTestSheets[0].snapshot.rows[0],fixture=()=>S.save(seed(),'p',[{unit:'Test Honda',invoice:'TEST-1',plate:'TEST 123',contract:10000,workItems:[{description:'Bumper',amount:5000}]}],0,uid);
const event=(s,kind,amount,date='2026-09-21')=>K.createEvent(s,'p',first(s).job.id,{kind,amount,effectiveOn:date,description:'Additional bumper repair',reason:'Approved and reviewed'},uid);
test('dated additional price changes agreement but not salary; future view has correct balance',()=>{
 const s=fixture(),before=clone(s),next=K.apply(s,event(s,'addition',2000)),id=first(s).job.id;
 assert.deepEqual(s,before);assert.equal(K.current(next,'p',id),12000);assert.equal(first(next).job.contract,10000);assert.deepEqual(S.validate(next,s),[]);
 const future=S.view(W.selectWeek(next,'2026-09-26'),'p').snapshot;assert.equal(future.rows[0].job.contract,12000);assert.equal(future.rows[0].opening,7000);assert.equal(future.net,0);
 const saved=S.save(W.selectWeek(next,'2026-09-26'),'p',[{id,workItems:[{description:'Next portion',amount:1000}]}],0,uid);assert.deepEqual(S.validate(saved,next),[]);assert.equal(S.savedFor(saved,'p').snapshot.rows[0].remaining,6000);
});
test('change updates existing open future rows, not payments or original history',()=>{
 let s=fixture(),id=first(s).job.id;s=S.save(W.selectWeek(s,'2026-09-26'),'p',[{id,workItems:[{description:'Next portion',amount:1000}]}],0,uid);
 const next=K.apply(s,event(s,'addition',2000));assert.equal(next.painterTestSheets[1].snapshot.rows[0].job.contract,12000);assert.equal(next.painterTestSheets[1].snapshot.rows[0].remaining,6000);
 assert.equal(next.painterTestSheets[1].snapshot.net,1000);assert.deepEqual(next.painterTestSheets[0],s.painterTestSheets[0]);assert.deepEqual(S.validate(next,s),[]);
});
test('backdated payment cannot spend a later additional agreement',()=>{
 let s=fixture(),id=first(s).job.id;s=K.apply(s,event(s,'addition',2000));
 assert.throws(()=>S.save(W.selectWeek(s,'2026-09-05'),'p',[{linkJobId:id,workItems:[{description:'Earlier portion',amount:6000}]}],0,uid),/exceed.*effective|later additional/i);
 const next=S.save(W.selectWeek(s,'2026-09-05'),'p',[{linkJobId:id,workItems:[{description:'Earlier portion',amount:5000}]}],0,uid);assert.equal(first(next).remaining,0);assert.deepEqual(S.validate(next,s),[]);
});
test('agreement cannot be silently edited even on only one saved week; explicit correction is audited',()=>{
 const s=fixture(),id=first(s).job.id;assert.throws(()=>S.save(s,'p',[{id,contract:11000}],0,uid),/contract correction|agreed labor for/);
 assert.throws(()=>K.apply(s,event(s,'correction',4999,'2026-09-14')),/below.*already recorded/);
 const next=K.apply(s,event(s,'correction',9000,'2026-09-14'));assert.equal(first(next).remaining,4000);assert.equal(first(next).weekly,5000);assert.deepEqual(S.validate(next,s),[]);
});
test('append-only events reject history deletion, mixed payment edits, bad reason and duplicate ids',()=>{
 const s=fixture(),ev=event(s,'addition',2000),next=K.apply(s,ev),bad=clone(next);delete bad.painterContractEvents;
 assert.match(K.validate(bad,next).join(),/permanent/);assert.throws(()=>K.apply(next,ev),/already recorded/);
 const mixed=clone(next);mixed.advances.push({amount:1});assert.match(K.validate(mixed,s).join(),/separately/);
 assert.throws(()=>K.apply(s,{...ev,reason:''}),/reason/);assert.throws(()=>K.apply(next,event(next,'addition',100,'2026-09-19')),/latest contract change/);
});
test('released source stays frozen; future correction allowed but never rewrites that slip',()=>{
 let s=fixture();s=A.release(s,S.savedFor(s,'p').id,uid(),'2026-09-19');
 assert.throws(()=>K.apply(s,event(s,'correction',12000,'2026-09-14')),/released payslip/);
 const next=K.apply(s,event(s,'correction',12000));assert.deepEqual(next.releasedPainterSlips,s.releasedPainterSlips);assert.deepEqual(next.painterTestSheets,s.painterTestSheets);assert.deepEqual(S.validate(next,s),[]);
});
test('unknown contract can be confirmed without guessing or turning confirmation into payment',()=>{
 const s=S.save(seed(),'p',[{unit:'Unknown price',contract:'',weekly:7500}],0,uid),next=K.apply(s,event(s,'confirmation',10000,'2026-09-14'));
 assert.equal(first(next).job.contract,10000);assert.equal(first(next).weekly,7500);assert.equal(first(next).remaining,2500);assert.deepEqual(S.validate(next,s),[]);
 assert.throws(()=>K.apply(s,event(s,'addition',100)),/Confirm agreed labor first/);
});
test('released unit requires explicit separate reference for new work; ongoing duplicates remain blocked',()=>{
 let s=fixture(),id=first(s).job.id,entry={unit:'Test Honda',invoice:'TEST-1',plate:'TEST 123',contract:2000,weekly:1000,transactionRef:'NEW-ORDER-2',separateJobReason:'New work on a later visit'};
 assert.throws(()=>S.save(s,'p',[entry],0,uid),/matching invoice/);
 s=S.save(s,'p',[{id,retentionStatus:'retained',unitReleasedOn:'2026-09-15'}],0,uid);
 const next=S.save(W.selectWeek(s,'2026-09-26'),'p',[entry],0,uid);assert.equal(S.view(next,'p').snapshot.rows.length,2);assert.deepEqual(S.validate(next,s),[]);
 assert.throws(()=>K.apply(s,event(s,'addition',2000)),/separate new transaction/);
});
test('read-only prices and matching replace dropdown; UI escapes and role-limits controls',()=>{
 const s=fixture(),id=first(s).job.id,html=S.render({state:s,esc:String,peso:String,button:()=>'',range:()=>''},'p');
 assert.doesNotMatch(html,/painterExistingJob|Use existing job/);assert.match(html,/<input readonly[^>]*data-field="contract"/);assert.match(html,/data-job-matches/);
 assert.match(U.actions(s,'p',first(s).job,'owner'),/Correct agreed labor/);assert.doesNotMatch(U.actions(s,'p',first(s).job,'edit'),/Correct agreed labor/);assert.doesNotMatch(U.actions(s,'p',first(s).job,'view'),/Additional|Confirm|Correct/);
 s.painterTestSheets[0].snapshot.rows[0].job.unit='<script>bad</script>';assert.doesNotMatch(U.history(s,'p',id,'view'),/<script>/);assert.match(U.matches(s,'p',{invoice:'test-1',plate:'test 123'}),/Continue this job/);
});
