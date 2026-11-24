const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js'),PDF=require('../payroll-v2/pdf.js');
const seed=()=>W.emptyWorkspace([{id:'p',name:'Fictional painter',position:'Painter',type:'contract',rate:0}],undefined,'2026-11-21');
let n=0;const uid=()=>`release-test-${++n}`;
test('release week keeps the row; later weeks show only ongoing units above and unpaid released balances below',()=>{
 let s=S.save(seed(),'p',[
  {unit:'Active unit',contract:10000,weekly:2000},
  {unit:'Released unpaid unit',contract:10000,weekly:8000,retentionStatus:'retained',unitReleasedOn:'2026-11-23'},
  {unit:'Released paid unit',contract:1000,weekly:1000,retentionStatus:'retained',unitReleasedOn:'2026-11-23'}
 ],0,uid);
 const first=S.savedFor(s,'p'),ids=first.snapshot.rows.map(r=>r.job.id);
 assert.equal(S.mainRows(first.snapshot).length,3);assert.equal(S.balanceRows(first.snapshot).length,1);
 s=W.selectWeek(s,'2026-11-28');let c=S.view(s,'p').snapshot;
 assert.deepEqual(S.mainRows(c).map(r=>r.job.id),[ids[0]]);assert.equal(S.balanceRows(c)[0].remaining,2000);assert.equal(c.net,0);
 assert.throws(()=>S.save(s,'p',[{id:ids[1],weekly:500}],0,uid),/read-only/);
 s=S.save(s,'p',[{id:ids[0],weekly:1500}],0,uid);c=S.savedFor(s,'p').snapshot;
 assert.equal(c.net,1500);assert.equal(S.balanceRows(c)[0].remaining,2000);assert.deepEqual(S.validate(s),[]);
 const main=PDF.definition(S.savedFor(s,'p')).content[2].table.body;
 assert.match(JSON.stringify(main),/Active unit/);assert.doesNotMatch(JSON.stringify(main),/Released unpaid unit|Released paid unit/);
 assert.match(JSON.stringify(PDF.definition(S.savedFor(s,'p'))),/Released unpaid unit/);
 s=W.selectWeek(s,'2026-12-05');c=S.view(s,'p').snapshot;assert.equal(S.mainRows(c)[0].opening,6500);assert.equal(S.balanceRows(c)[0].remaining,2000);
 assert.deepEqual(s.painterTestSheets[0],first);
});
test('main dropdown/date replace starting settlement; lower table never has inputs',()=>{
 const s=S.save(seed(),'p',[{unit:'Unit',contract:500,weekly:100,retentionStatus:'retained',unitReleasedOn:'2026-11-22'}],0,uid),c=S.savedFor(s,'p').snapshot;
 const x={state:s,esc:String,peso:String,button:()=>'',range:()=>''},html=S.render(x,'p');
 assert.match(html,/<th>Unit status<\/th>/);assert.match(html,/>Ongoing<\/option>/);assert.match(html,/>Released<\/option>/);assert.match(html,/data-field="unitReleasedOn"/);
 assert.doesNotMatch(html,/Settled before BWC|data-ref-field|type="checkbox"/);
 const lower=S.balances(x,c,true);assert.doesNotMatch(lower,/<input|<select|<button/);assert.match(lower,/2026-11-22/);
});
test('release requires its actual date; reopening clears release marker; no future metadata leaks back',()=>{
 assert.throws(()=>S.save(seed(),'p',[{unit:'Unit',contract:500,weekly:0,retentionStatus:'retained'}],0,uid),/release date/);
 let s=S.save(seed(),'p',[{unit:'Unit',contract:500,weekly:0,retentionStatus:'retained',unitReleasedOn:'2026-11-22'}],0,uid),j=S.savedFor(s,'p').snapshot.rows[0].job;
 assert.equal(j.releasePayrollStart,'2026-11-21');assert.equal(S.mainRows(S.view(s,'p').snapshot).length,1);
 s=S.save(s,'p',[{id:j.id,weekly:0,retentionStatus:'ongoing'}],0,uid);j=S.savedFor(s,'p').snapshot.rows[0].job;assert.equal(j.unitReleasedOn,'');assert.equal(j.releasePayrollStart,undefined);
 assert.equal(S.mainRows(S.view(W.selectWeek(s,'2026-11-28'),'p').snapshot).length,1);
 assert.equal(S.view(W.selectWeek(s,'2026-11-14'),'p').snapshot.rows.length,0);
});
test('future zero worksheets follow release status, but later paid/released weeks block a conflicting change',()=>{
 let s=S.save(seed(),'p',[{unit:'Unit',contract:1000,weekly:100}],0,uid),j=S.savedFor(s,'p').snapshot.rows[0].job;
 s=S.save(W.selectWeek(s,'2026-11-28'),'p',[],0,uid);s=W.selectWeek(s,'2026-11-21');
 s=S.save(s,'p',[{id:j.id,weekly:100,retentionStatus:'retained',unitReleasedOn:'2026-11-25'}],0,uid);
 assert.equal(S.mainRows(S.view(W.selectWeek(s,'2026-11-28'),'p').snapshot).length,0);assert.deepEqual(S.validate(s),[]);
 let paid=S.save(seed(),'p',[{unit:'Paid unit',contract:1000,weekly:100}],0,uid);j=S.savedFor(paid,'p').snapshot.rows[0].job;
 paid=S.save(W.selectWeek(paid,'2026-11-28'),'p',[{id:j.id,weekly:100}],0,uid);const before=structuredClone(paid);
 assert.throws(()=>S.save(W.selectWeek(paid,'2026-11-21'),'p',[{id:j.id,weekly:100,retentionStatus:'retained',unitReleasedOn:'2026-11-25'}],0,uid),/later payroll/);assert.deepEqual(paid,before);
});
test('blank agreed price remains unknown, not a guessed zero; released pending balances remain visible',()=>{
 let s=S.save(seed(),'p',[{unit:'Unknown price',contract:'',weekly:'',retentionStatus:'retained',unitReleasedOn:'2026-11-25'}],0,uid),r=S.savedFor(s,'p').snapshot.rows[0];
 assert.equal(r.job.contract,null);assert.equal(r.remaining,null);assert.equal(r.weekly,0);
 s=W.selectWeek(s,'2026-11-28');assert.equal(S.balanceRows(S.view(s,'p').snapshot).length,1);assert.equal(S.mainRows(S.view(s,'p').snapshot).length,0);
});

test('backdated release uses the actual date even in an existing saved/reset week; data stays intact',()=>{
 let s=S.save(seed(),'p',[
  {unit:'QA backdated unit',plate:'TEST 010',contract:'',weekly:'',retentionStatus:'retained',unitReleasedOn:'2026-11-10'},
  {unit:'QA ongoing unit',contract:1000,weekly:100}
 ],0,uid);
 const original=structuredClone(s),source=S.savedFor(s,'p'),job=source.snapshot.rows[0].job;
 assert.equal(job.releasePayrollStart,'2026-11-21');assert.equal(job.payrollStart,'2026-11-21');
 assert.equal(S.releaseWeek(job),'2026-11-07');assert.equal(S.retentionDue(job),'2026-12-25');
 for(const payday of ['2026-11-27','2026-11-28','2026-12-01']){
  const c=structuredClone(S.view(s,'p').snapshot);c.period.releaseDate=payday;
  assert.deepEqual(S.mainRows(c).map(r=>r.job.unit),['QA ongoing unit']);
  assert.equal(S.balanceRows(c)[0].job.id,job.id);assert.equal(S.balanceRows(c)[0].remaining,null);
 }
 const x={state:s,esc:String,peso:String,button:()=>'',range:()=>''},html=S.render(x,'p');
 assert.doesNotMatch(html.split('id="painterBalances"')[0],/QA backdated unit/);
 assert.match(html.split('id="painterBalances"')[1],/QA backdated unit/);
 assert.match(S.balances(x,source.snapshot),/Pending confirmation/);
 assert.match(S.balances(x,source.snapshot),/2026-11-10/);assert.match(S.balances(x,source.snapshot),/2026-12-25/);
 const definition=PDF.definition(source);
 assert.doesNotMatch(JSON.stringify(definition.content[2]),/QA backdated unit/);
 assert.match(JSON.stringify(definition),/QA backdated unit/);assert.match(JSON.stringify(definition),/2026-12-25/);
 const fs=require('node:fs'),vm=require('node:vm'),context={window:{SimplePainter:S}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../payroll-v2/half-slips.js'),'utf8'),context);
 const blocks=context.window.PayrollSlips.blocks(source.snapshot);
 assert.ok(!blocks.some(b=>b.kind==='labor-grid'&&b.text.includes('QA backdated unit')));
 assert.ok(blocks.some(b=>b.kind==='balance-grid'&&b.text.includes('QA backdated unit')));
 assert.deepEqual(s,original);
 // Saving only visible inputs preserves the hidden unit and all its metadata.
 s=S.save(s,'p',[{id:source.snapshot.rows[1].job.id,weekly:100}],0,uid);
 assert.deepEqual(S.savedFor(s,'p').snapshot.rows.find(r=>r.job.id===job.id),source.snapshot.rows[0]);
 const resaved=structuredClone(S.savedFor(s,'p'));
 for(const week of ['2026-11-28','2026-12-05']){
  s=W.selectWeek(s,week);s=S.save(s,'p',[],0,uid);
  assert.ok(!S.mainRows(S.view(s,'p').snapshot).some(r=>r.job.id===job.id));
  assert.equal(S.balanceRows(S.view(s,'p').snapshot)[0].job.id,job.id);
 }
 assert.deepEqual(S.validate(s),[]);assert.deepEqual(s.painterTestSheets[0],resaved);
});

test('late-entered historical payments remain itemized only in their recorded week',()=>{
 let s=S.save(seed(),'p',[{unit:'QA historical payment',contract:1000,weekly:300,retentionStatus:'retained',unitReleasedOn:'2026-11-10'}],0,uid);
 const source=structuredClone(S.savedFor(s,'p'));
 assert.equal(S.mainRows(source.snapshot).length,1);assert.equal(source.snapshot.net,300);
 assert.match(JSON.stringify(PDF.definition(source).content[2]),/QA historical payment/);
 s=A.release(s,source.id,uid(),'2026-11-28');const frozen=structuredClone(s.releasedPainterSlips[0]);
 s=S.save(W.selectWeek(s,'2026-11-28'),'p',[],0,uid);const c=S.view(s,'p').snapshot;
 assert.equal(S.mainRows(c).length,0);assert.equal(c.net,0);assert.equal(S.balanceRows(c)[0].remaining,700);
 assert.deepEqual(s.painterTestSheets[0],source);assert.deepEqual(s.releasedPainterSlips[0],frozen);
 assert.deepEqual(A.validate(s),[]);assert.deepEqual(S.validate(s),[]);
});

test('legacy release dates take priority over entry markers; missing dates keep a safe fallback',()=>{
 assert.equal(S.releaseWeek({releasedOn:'2026-11-10',releasePayrollStart:'2026-11-21'}),'2026-11-07');
 assert.equal(S.releaseWeek({unitReleasedOn:'2026-11-10',releasedOn:'2026-12-01',releasePayrollStart:'2026-11-21'}),'2026-11-07');
 assert.equal(S.releaseWeek({releasePayrollStart:'2026-11-21'}),'2026-11-21');
 assert.equal(S.releaseWeek({}),'');
});
