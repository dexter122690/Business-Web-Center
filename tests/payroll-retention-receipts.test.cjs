const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js'),PDF=require('../payroll-v2/pdf.js');
let n=0;const uid=()=>`receipt-${++n}`;
const seed=()=>S.save(W.emptyWorkspace([{id:'p',name:'Fictional painter',position:'Painter',type:'contract',rate:0}],undefined,'2026-11-21'),'p',[
 {unit:'Released unit',plate:'TEST',contract:10000,weekly:8000,retentionStatus:'retained',unitReleasedOn:'2026-10-11'},
 {unit:'Unknown contract',contract:'',weekly:'',retentionStatus:'retained',unitReleasedOn:'2026-10-01'},
 {unit:'Not due unit',contract:1000,weekly:500,retentionStatus:'retained',unitReleasedOn:'2026-11-25'}],0,uid);
function receipt(s){const row=S.savedFor(s,'p').snapshot.rows[0],basis=S.receiptBasis(s,'p',row.job.id);return {id:uid(),employeeId:'p',jobId:row.job.id,amount:basis.amount,receivedOn:'2026-11-25',recordedAt:'2026-11-25T05:00:00Z',recordedBy:'qa',basis}}
test('45 calendar days crosses months, leap day and year; old manual due date is ignored',()=>{
 for(const [start,end] of [['2026-10-11','2026-11-25'],['2026-11-25','2027-01-09'],['2028-01-31','2028-03-16']])assert.equal(S.retentionDue({retentionStatus:'retained',unitReleasedOn:start,retentionDue:'2099-01-01'}),end);
 assert.equal(S.retentionDue({retentionStatus:'ongoing',unitReleasedOn:'2026-11-25'}),'');
 assert.equal(S.retentionDue({retentionStatus:'retained'}),'');
});
test('dropdown is due-today only, never for unknown amounts, viewers, dirty previews, or paid balances',()=>{
 const s=seed(),c=S.savedFor(s,'p').snapshot,x={state:s,esc:String,peso:String,canReceive:true,today:'2026-11-24'};
 assert.doesNotMatch(S.balances(x,c),/<select/);
 x.today='2026-11-25';const before=structuredClone(s);let html=S.balances(x,c);assert.equal((html.match(/<select/g)||[]).length,1);assert.match(html,/Confirm agreed labor first/);assert.match(html,/2027-01-09/);
 assert.match(html,/<option value="">Not yet received<\/option><option value="received">Received<\/option>/);
 assert.doesNotMatch(html,/Hindi pa natatanggap|Natanggap na/);assert.deepEqual(s,before);
 assert.doesNotMatch(S.balances({...x,canReceive:false},c),/<select/);
 s.painterRetentionReceipts=[receipt(s)];html=S.balances(x,c);assert.doesNotMatch(html,/<select/);assert.match(html,/<b>Received<\/b>/);assert.match(html,/2000 · 2026-11-25/);
 assert.equal(S.retentionInfo(c.rows[0],s.painterRetentionReceipts).remaining,0);assert.equal(c.rows[0].remaining,2000);assert.equal(c.net,8500);
});
test('received history remains locked, no automatic salary or future main-row payment, and carries across weeks',()=>{
 let s=seed(),before=structuredClone(s);s.painterRetentionReceipts=[receipt(s)];assert.deepEqual(S.validate(s),[]);
 for(const k of Object.keys(before))assert.deepEqual(s[k],before[k]);
 let next=S.save(W.selectWeek(s,'2026-11-28'),'p',[],0,uid);assert.deepEqual(S.validate(next,s),[]);assert.equal(S.savedFor(next,'p').snapshot.net,0);assert.equal(S.mainRows(S.savedFor(next,'p').snapshot).length,0);
 const bad=structuredClone(next);bad.painterRetentionReceipts=[];assert.match(S.validate(bad,next).join(' '),/locked/);
 const duplicate=structuredClone(next);duplicate.painterRetentionReceipts.push(structuredClone(duplicate.painterRetentionReceipts[0]));assert.match(S.validate(duplicate).join(' '),/Invalid retained/);
 const changed=structuredClone(next);changed.painterTestSheets.at(-1).snapshot.rows[0].job.contract+=100;assert.ok(S.validate(changed,next).length);
 assert.throws(()=>S.receiptBasis(s,'p',S.savedFor(s,'p').snapshot.rows[1].job.id),/Confirm/);
});
test('PDF/print receipts are reference-only; previously released snapshots never acquire newer receipts',()=>{
 let s=seed(),source=S.savedFor(s,'p');s=A.release(s,source.id,uid(),'2026-11-28');const frozen=structuredClone(s.releasedPainterSlips[0]);
 s.painterRetentionReceipts=[receipt(s)];assert.deepEqual(A.enrich(s,frozen),frozen);
 const next=S.save(W.selectWeek(s,'2026-11-28'),'p',[],0,uid),record=A.enrich(next,S.savedFor(next,'p'));
 assert.equal(record.snapshot.retentionReceipts.length,1);assert.equal(record.snapshot.net,0);
 const paidCopy=A.enrich(s,source);assert.match(JSON.stringify(PDF.definition(paidCopy)),/Received 2026-11-25/);
 const def=JSON.stringify(PDF.definition(record));assert.doesNotMatch(def,/Received 2026-11-25/);assert.match(def,/2027-01-09/);assert.doesNotMatch(def,/₱2,000.00/);
 const released=A.release(next,record.id,uid(),'2026-12-05');assert.deepEqual(A.validate(released,next),[]);assert.deepEqual(S.validate(released),[]);
});

test('September back-entry uses Saturday-Friday ranges and leaves November profiles and saved records unchanged',()=>{
 let s=seed();const original=structuredClone(s);
 s=W.selectWeek(s,'2026-09-01');assert.deepEqual(s.period,{start:'2026-08-29',end:'2026-09-04',releaseDate:'2026-09-05'});
 assert.equal(S.view(s,'p').snapshot.rows.length,0);
 s=S.save(s,'p',[{unit:'September QA unit',contract:10000,weekly:2000}],0,uid);
 const first=S.savedFor(s,'p'),job=first.snapshot.rows[0].job;
 s=S.save(W.selectWeek(s,'2026-09-05'),'p',[{id:job.id,weekly:1000}],0,uid);
 assert.equal(S.savedFor(s,'p').period.releaseDate,'2026-09-12');assert.equal(S.savedFor(s,'p').snapshot.rows[0].opening,8000);assert.equal(S.savedFor(s,'p').snapshot.rows[0].remaining,7000);
 assert.deepEqual(s.employees,original.employees);assert.deepEqual(s.painterTestSheets[0],original.painterTestSheets[0]);
 assert.deepEqual(s.releasedPainterSlips,original.releasedPainterSlips);assert.deepEqual(S.validate(s),[]);
});

function september(receivedOn='2026-09-05'){
 let s=S.save(W.emptyWorkspace([{id:'p',name:'Fictional painter',position:'Painter',type:'contract',rate:0}],undefined,'2026-08-29'),'p',[
  {unit:'September retained QA',contract:10000,weekly:8000,retentionStatus:'retained',unitReleasedOn:'2026-07-22'},
  {unit:'September ongoing QA',contract:1000,weekly:100}
 ],0,uid);
 const job=S.savedFor(s,'p').snapshot.rows[0].job,basis=S.receiptBasis(s,'p',job.id);
 s.painterRetentionReceipts=[{id:uid(),employeeId:'p',jobId:job.id,amount:2000,receivedOn,recordedAt:'2026-11-25T05:00:00Z',recordedBy:'qa',basis}];
 return s;
}
const balanceHtml=s=>S.balances({state:s,esc:String,peso:String,canReceive:true,today:'2026-11-25'},S.view(s,'p').snapshot);
const printBlocks=record=>{
 const fs=require('node:fs'),vm=require('node:vm'),context={window:{SimplePainter:S}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../payroll-v2/half-slips.js'),'utf8'),context);
 return context.window.PayrollSlips.blocks(record.snapshot,true,record.retentionPreviousPayday??(record.releasedCopy?'':record.period.start));
};

test('Saturday receipt stays on that payday, disappears next payday, and returns when viewing its history',()=>{
 let s=september(),before=structuredClone(s),record=A.enrich(s,S.savedFor(s,'p'));
 assert.match(balanceHtml(s),/September retained QA/);assert.match(balanceHtml(s),/<b>Received<\/b>/);assert.match(balanceHtml(s),/2000 · 2026-09-05/);
 assert.match(JSON.stringify(PDF.definition(record)),/Received 2026-09-05/);
 assert.ok(printBlocks(record).some(b=>b.kind==='balance-grid'&&b.text.includes('September retained QA')));
 s=A.release(s,record.id,uid(),'2026-09-05');const frozen=structuredClone(s.releasedPainterSlips[0]);
 s=S.save(W.selectWeek(s,'2026-09-05'),'p',[],0,uid);record=A.enrich(s,S.savedFor(s,'p'));
 assert.doesNotMatch(balanceHtml(s),/September retained QA|<b>Received<\/b>/);
 assert.equal(S.mainRows(record.snapshot).length,1);assert.equal(record.snapshot.net,0);
 assert.equal(record.snapshot.rows.find(r=>r.job.id===before.painterRetentionReceipts[0].jobId).remaining,2000);
 assert.ok(!printBlocks(record).some(b=>b.kind==='balance-grid'&&b.text.includes('September retained QA')));
 assert.doesNotMatch(JSON.stringify(PDF.definition(record)),/Received 2026-09-05/);
 assert.deepEqual(s.painterRetentionReceipts,before.painterRetentionReceipts);assert.deepEqual(s.releasedPainterSlips[0],frozen);
 const historical=W.selectWeek(s,'2026-08-29');assert.match(balanceHtml(historical),/<b>Received<\/b>/);
 assert.deepEqual(A.enrich(s,frozen),frozen);assert.match(JSON.stringify(PDF.definition(frozen)),/Received 2026-09-05/);
 assert.deepEqual(S.validate(s),[]);assert.deepEqual(A.validate(s),[]);
});

test('future receipt never marks a past payroll paid or enables a second receipt',()=>{
 const s=september('2026-09-12'),c=S.view(s,'p').snapshot;
 let info=S.retentionInfo(c.rows[0],s.painterRetentionReceipts,'2026-11-25',c.period.releaseDate);
 assert.equal(info.receipt,undefined);assert.equal(info.remaining,2000);assert.equal(info.receivedLater,true);assert.equal(info.eligible,false);
 assert.match(balanceHtml(s),/Received in a later payroll/);assert.doesNotMatch(balanceHtml(s),/<b>Received<\/b>|<select/);
 const current=A.enrich(s,S.savedFor(s,'p'));assert.equal(current.snapshot.retentionReceipts,undefined);
 const next=S.save(W.selectWeek(s,'2026-09-05'),'p',[],0,uid);
 assert.match(balanceHtml(next),/<b>Received<\/b>/);assert.match(balanceHtml(next),/2026-09-12/);
 assert.doesNotMatch(balanceHtml(W.selectWeek(next,'2026-09-12')),/September retained QA/);
});

test('holiday-adjusted previous payday is used in UI and frozen print copies',()=>{
 for(const [payday,receivedOn,visibleNext] of [['2026-09-06','2026-09-06',false],['2026-09-04','2026-09-05',true]]){
  let s=september(receivedOn);s=W.setPayday(s,payday);
  const rows=S.mainRows(S.view(s,'p').snapshot).map(r=>({id:r.job.id,weekly:r.weekly}));s=S.save(s,'p',rows,0,uid);
  const old=S.savedFor(s,'p');assert.equal(old.period.releaseDate,payday);
  const first=A.enrich(s,old);assert.equal(/<b>Received<\/b>/.test(balanceHtml(s)),receivedOn<=payday);
  s=S.save(W.selectWeek(s,'2026-09-05'),'p',[],0,uid);const record=A.enrich(s,S.savedFor(s,'p'));
  assert.equal(record.retentionPreviousPayday,payday);
  assert.equal(/September retained QA/.test(balanceHtml(s)),visibleNext);
  assert.equal(printBlocks(record).some(b=>b.kind==='balance-grid'&&b.text.includes('September retained QA')),visibleNext);
  assert.equal(/Received 2026-09-0[56]/.test(JSON.stringify(PDF.definition(record))),visibleNext);
  const released=A.release(s,record.id,uid(),'2026-09-12'),frozen=structuredClone(released.releasedPainterSlips[0]);
  const changedCalendar={...released,payrollPaydays:{...released.payrollPaydays,'2026-08-29':'2026-09-03'}};
  assert.deepEqual(A.enrich(changedCalendar,frozen),frozen);assert.deepEqual(A.validate(released,s),[]);
  assert.equal(S.previousPayrollDate({...s,painterTestSheets:[]},record.snapshot),payday);
 }
});
