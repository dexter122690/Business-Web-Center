const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),K=require('../payroll-v2/contract-ledger.js'),A=require('../payroll-v2/payslip-archive.js');
let serial=0;const uid=()=>`initial-${++serial}`,items=()=>[{description:'Body repair',amount:0},{description:'Repainting',amount:0}];
function seed(){
 let s=W.emptyWorkspace([{id:'p',name:'Sample painter',position:'Painter',type:'contract',rate:0}],undefined,'2026-09-12');
 s=S.save(s,'p',[{unit:'Sample unit',invoice:'DEMO-1',plate:'SAMPLE',contractPending:true,workItems:items(),retentionStatus:'retained',unitReleasedOn:'2026-09-15'}],0,uid);
 s=S.save(W.selectWeek(s,'2026-09-19'),'p',[],0,uid);
 for(const sheet of s.painterTestSheets){for(const r of sheet.snapshot.rows){r.job.pricingSetup={batch:'test-reset',firstWeek:'2026-09-12',items:items()};r.weeklyManual=true;r.agreementItems=items();delete r.workItems;}sheet.snapshot.jobs=sheet.snapshot.rows.map(r=>structuredClone(r.job));}
 s=W.selectWeek(s,'2026-09-12');assert.deepEqual(S.validate(s),[]);return s;
}
const first=s=>S.view(s,'p').snapshot.rows[0];
const input=s=>({id:first(s).job.id,agreementMode:true,agreedWorkItems:[{description:'Body repair',amount:1000},{description:'Repainting',amount:1500}],weekly:500});
test('reset initial agreement updates all open references and locks only when positive prices are saved',()=>{
 const s=seed(),before=structuredClone(s),n=S.save(s,'p',[input(s)],0,uid);
 for(const {row} of K.rows(n,'p',first(s).job.id)){assert.equal(row.job.contract,2500);assert.equal(row.remaining,2000);assert.equal(row.job.unitReleasedOn,'2026-09-15');}
 assert.equal(first(n).weekly,500);assert.equal(S.activeRows(S.view(n,'p').snapshot).length,0);assert.deepEqual(S.validate(n,s),[]);assert.deepEqual(s,before);
 assert.throws(()=>S.save(n,'p',[{...input(n),agreedWorkItems:[{description:'Replacement',amount:2500}]}],0,uid),/locked/);
});
test('unpriced reset units cannot be paid, confirmed paid or released as payroll; edited wording cannot silently disappear',()=>{
 const s=seed();assert.equal(S.activeRows(S.view(s,'p').snapshot).length,1);assert.equal(S.balanceRows(S.view(s,'p').snapshot).length,0);
 assert.throws(()=>S.save(s,'p',[{id:first(s).job.id,agreementMode:true,weekly:1}],0,uid),/prices first/);
 assert.throws(()=>S.save(s,'p',[{id:first(s).job.id,agreementMode:true,agreedWorkItems:[{description:'Edited',amount:0}]}],0,uid),/edited job descriptions/);
 assert.throws(()=>S.receiptBasis(s,'p',first(s).job.id),/Confirm/);
 assert.throws(()=>A.release(s,S.savedFor(s,'p').id,uid(),'2026-09-19'),/re-encoding/);
 assert.match(S.balanceText(first(s),String),/For re-encoding/);
});
test('first-entry scope is immutable; neither a later week nor a locked source can reinitialize prices',()=>{
 const s=seed(),later=W.selectWeek(s,'2026-09-19');assert.throws(()=>S.save(later,'p',[input(s)],0,uid),/first job prices/);
 const bad=structuredClone(s);bad.painterTestSheets[0].snapshot.rows[0].job.pricingSetup.firstWeek='2026-09-05';assert.ok(S.validate(bad,s).length);
 const n=S.save(s,'p',[input(s)],0,uid),forged=structuredClone(n);forged.painterTestSheets[0].snapshot.rows[0].job.agreedWorkItems[0].amount=1001;assert.ok(S.validate(forged,n).length);
});
test('initial editor exposes zero price lines once, preserves released date, and draft balances wait for save',()=>{
 const s=seed(),html=S.render({state:s,esc:String,peso:String,button:()=>'',range:()=>'',agreedJobPricing:true},'p');
 assert.match(html,/data-initial-pricing="true"/);assert.doesNotMatch(html,/data-job-amount[^>]*disabled/);assert.match(html,/For re-encoding/);assert.match(html,/Unit status[^>]*disabled/);
 const draft=S.draft(s,'p',[input(s)],0,uid),balance=S.balances({state:s,esc:String,peso:String,pendingSave:true},draft);assert.doesNotMatch(balance,/data-retained-job=/);
 const later=W.selectWeek(s,'2026-09-19'),laterHtml=S.render({state:later,esc:String,peso:String,button:()=>'',range:()=>'',agreedJobPricing:true},'p');assert.match(laterHtml,/Open first entry · 2026-09-12/);
});
