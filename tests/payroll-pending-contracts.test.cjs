const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js'),PDF=require('../payroll-v2/pdf.js');
const seed=()=>W.emptyWorkspace([{id:'p',name:'Fictional Painter',position:'Auto painter',type:'contract',rate:0}],undefined,'2026-11-07');
let id=0;const uid=()=>`pending-test-${++id}`;
test('unknown contracts save real payments, retain null balances and carry previous payments forward',()=>{
 let s=S.save(seed(),'p',[{unit:'Test unit',contractPending:true,weekly:7500}],0,uid),r=S.savedFor(s,'p').snapshot.rows[0];
 assert.deepEqual([r.job.contract,r.opening,r.remaining,r.previousRecorded,r.weekly],[null,null,null,0,7500]);assert.deepEqual(S.validate(s),[]);
 const old=structuredClone(s),j=r.job.id;s=S.save(W.selectWeek(s,'2026-11-14'),'p',[{id:j,weekly:1000}],0,uid);r=S.savedFor(s,'p').snapshot.rows[0];
 assert.deepEqual([r.opening,r.remaining,r.previousRecorded,r.weekly],[null,null,7500,1000]);assert.deepEqual(S.validate(s,old),[]);
 assert.throws(()=>S.save(s,'p',[{id:j,contractPending:false,contract:'',weekly:1000}],0,uid),/confirmed agreed labor/);
 s=S.save(s,'p',[{id:j,contractPending:false,contract:12000,weekly:1000}],0,uid);r=S.savedFor(s,'p').snapshot.rows[0];
 assert.deepEqual([r.job.contract,r.opening,r.remaining],[12000,4500,3500]);assert.equal(s.painterTestSheets[0].snapshot.rows[0].opening,null);
 assert.deepEqual(S.validate(s),[]);assert.equal(S.jobs(s,'p')[0].contract,12000);
 // Saving a backdated week later in the array must not undo the current contract.
 s.painterTestSheets.reverse();assert.equal(S.jobs(s,'p')[0].contract,12000);
});
test('pending is not zero, fabricated balances and paid-history amounts are rejected',()=>{
 const s=S.save(seed(),'p',[{unit:'Test unit',contractPending:true,weekly:500}],0,uid);
 for(const edit of [r=>r.opening=0,r=>r.remaining=0,r=>r.job.contract=0,r=>r.previousRecorded=1,r=>r.job.contractPending='true',r=>r.weekly=-1]){const bad=structuredClone(s);edit(bad.painterTestSheets[0].snapshot.rows[0]);assert.ok(S.validate(bad).length)}
 assert.equal(S.savedFor(S.save(seed(),'p',[{unit:'Confirmed zero',contract:0,weekly:0}],0,uid),'p').snapshot.rows[0].remaining,0);
});
test('UI and both print layouts explicitly label pending while preserving real payment amounts',()=>{
 const s=S.save(seed(),'p',[{unit:'Test unit',contractPending:true,weekly:7500}],0,uid),record=S.savedFor(s,'p'),before=structuredClone(record);
 const rendered=S.render({state:s,esc:String,peso:n=>'₱'+n,range:()=>'',button:()=>''},'p');assert.match(rendered,/Agreed price not yet confirmed/);assert.match(rendered,/Pending confirmation/);assert.match(rendered,/type="checkbox"/);
 const json=JSON.stringify(PDF.definition(record));assert.equal((json.match(/Pending confirmation/g)||[]).length,3);assert.match(json,/₱7,500.00/);
 const window={};vm.runInNewContext(fs.readFileSync(require.resolve('../payroll-v2/half-slips.js'),'utf8'),{window});
 assert.match(JSON.stringify(window.PayrollSlips.blocks(record.snapshot,true)),/Pending confirmation/);assert.deepEqual(record,before);
});
test('released historical payments use the actual received date, not the Friday cutoff',()=>{
 let s=S.save(seed(),'p',[{unit:'Test unit',contractPending:true,weekly:500}],0,uid);const first=S.savedFor(s,'p');
 s=A.release(s,first.id,uid(),'2026-11-14');s=S.save(W.selectWeek(s,'2026-11-14'),'p',[],0,uid);const next=S.savedFor(s,'p');
 s=A.release(s,next.id,uid(),'2026-11-21');const history=s.releasedPainterSlips.at(-1).snapshot.previousPayments;
 assert.equal(history[0].date,'2026-11-14');assert.deepEqual(A.validate(s),[]);assert.equal(S.savedFor(s,'p').snapshot.basic,0);
});
