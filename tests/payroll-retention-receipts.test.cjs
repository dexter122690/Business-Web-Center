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
 x.today='2026-11-25';let html=S.balances(x,c);assert.equal((html.match(/<select/g)||[]).length,1);assert.match(html,/Confirm agreed labor first/);assert.match(html,/2027-01-09/);
 assert.doesNotMatch(S.balances({...x,canReceive:false},c),/<select/);
 s.painterRetentionReceipts=[receipt(s)];html=S.balances(x,c);assert.doesNotMatch(html,/<select/);assert.match(html,/Natanggap na/);assert.match(html,/2000 · 2026-11-25/);
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
 const def=JSON.stringify(PDF.definition(record));assert.match(def,/Received 2026-11-25/);assert.match(def,/2027-01-09/);assert.match(def,/₱2,000.00/);
 const released=A.release(next,record.id,uid(),'2026-12-05');assert.deepEqual(A.validate(released,next),[]);assert.deepEqual(S.validate(released),[]);
});
