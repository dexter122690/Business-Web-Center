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
 let s=S.save(seed(),'p',[{unit:'Unit',contract:500,weekly:0,retentionStatus:'retained',unitReleasedOn:'2026-11-10'}],0,uid),j=S.savedFor(s,'p').snapshot.rows[0].job;
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
