const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js'),PDF=require('../payroll-v2/pdf.js');
let n=0;const uid=()=>`job-item-${++n}`,seed=()=>W.emptyWorkspace([{id:'p',name:'Fictional Painter',position:'Auto painter',type:'contract',rate:0}],undefined,'2026-11-21');
const items=()=>[{description:'Remove/replace rear bumper',amount:1125},{description:'Repaint spare tire cover base',amount:700},{description:'Repaint tailgate',amount:1000},{description:'Repair/repaint luggage compartment and tailgate',amount:1800}];
const first=()=>S.save(seed(),'p',[{unit:'Test Jetour',plate:'QA 123',contract:10000,workItems:items()}],0,uid);
const row=s=>S.view(s,'p').snapshot.rows[0];
test('job amounts sum automatically to 4625, not the agreed labor; cents and cash advance remain correct',()=>{
 const s=first(),r=row(s);assert.equal(r.weekly,4625);assert.equal(r.remaining,5375);assert.equal(r.job.contract,10000);assert.equal(S.savedFor(s,'p').snapshot.net,4625);assert.deepEqual(S.validate(s),[]);
 const next=S.save(s,'p',[{id:r.job.id,weekly:999999,workItems:[{description:'A',amount:0.1},{description:'B',amount:0.2}]}],0.1,uid);
 assert.equal(row(next).weekly,0.3);assert.equal(S.savedFor(next,'p').snapshot.net,0.2);assert.equal(row(next).job.work,'A\nB');
 const blank=S.save(seed(),'p',[{unit:'Unpriced work',contract:'',workItems:[{description:'Pending task',amount:''},{description:'',amount:''}]}],0,uid);assert.equal(row(blank).weekly,0);assert.equal(row(blank).remaining,null);
 const uiRows=[{unit:'Test Jetour',contract:10000,workItems:items()},{unit:'',weekly:'0',workItems:[{description:'',amount:''}]}];
 const uiSaved=S.save(seed(),'p',uiRows,0,uid);assert.equal(S.savedFor(uiSaved,'p').snapshot.rows.length,1);assert.equal(row(uiSaved).weekly,4625);
 assert.throws(()=>S.save(seed(),'p',[{unit:'',weekly:'1',workItems:[{description:'Task',amount:'1'}]}],0,uid),/Enter a unit name/);
});
test('save/reload preserves every item; JSONB key order is accepted; repeat Save uses one record',()=>{
 const s=first(),id=row(s).job.id,next=S.save(s,'p',[{id,workItems:items()}],0,uid);assert.deepEqual(next,s);
 const loaded=structuredClone(s);loaded.painterTestSheets[0].snapshot.rows[0].workItems=items().map(i=>({amount:i.amount,description:i.description}));assert.deepEqual(S.validate(loaded),[]);
 assert.throws(()=>S.save(s,'p',[{id,weekly:5000}],0,uid),/automatic/);
});
test('next-week descriptions carry but amounts reset to zero; editing that week never changes prior items',()=>{
 const old=first(),next=W.selectWeek(old,'2026-11-28'),r=row(next);assert.equal(r.weekly,0);assert.deepEqual(r.workItems,items().map(i=>({...i,amount:0})));
 const saved=S.save(next,'p',[{id:r.job.id,workItems:r.workItems.map((i,n)=>({...i,amount:n===0?1000:0}))}],0,uid);
 assert.equal(row(saved).weekly,1000);assert.equal(row(saved).opening,5375);assert.equal(row(saved).remaining,4375);assert.deepEqual(saved.painterTestSheets[0],old.painterTestSheets[0]);assert.deepEqual(S.validate(saved),[]);
});
test('legacy descriptions and weekly total are preserved without parsing prices from free text',()=>{
 const s=S.save(seed(),'p',[{unit:'Old unit',work:'Repair 1,125; paint 700; reference 2026',contract:10000,weekly:2500}],0,uid),before=structuredClone(s),r=row(s);
 const displayed=S.workItems(r);assert.deepEqual(displayed,[{description:r.job.work,amount:2500}]);assert.equal(r.workItems,undefined);assert.deepEqual(s,before);
 const next=S.save(s,'p',[{id:r.job.id,workItems:displayed}],0,uid);assert.equal(row(next).weekly,2500);assert.equal(row(next).job.work,r.job.work);
});
test('invalid lines, negative amounts, missing descriptions, oversized totals and forged sums fail',()=>{
 for(const bad of [null,{},[{description:'',amount:1}],[{description:'A',amount:-1}],[{description:'A',amount:'bad'}],[{description:'x'.repeat(1001),amount:1}],Array.from({length:31},()=>({description:'A',amount:1}))])assert.throws(()=>S.save(seed(),'p',[{unit:'Bad',contract:10000,workItems:bad}],0,uid));
 assert.throws(()=>S.save(seed(),'p',[{unit:'Bad',contract:'',workItems:[{description:'A',amount:999999999},{description:'B',amount:1}]}],0,uid),/Amount this week/);
 const s=first();for(const edit of [r=>r.workItems[0].amount++,r=>r.workItems[0].description='changed',r=>r.workItems=null,r=>r.workItems[0].extra='bad']){const bad=structuredClone(s);edit(bad.painterTestSheets[0].snapshot.rows[0]);assert.ok(S.validate(bad,s).length)}
 const stripped=structuredClone(s);delete stripped.painterTestSheets[0].snapshot.rows[0].workItems;assert.match(S.validate(stripped,s).join(),/Keep the itemized/);
});
test('cross-date cap and recalculation still apply to itemized payments; historical linking resets item amounts',()=>{
 const s=first(),id=row(s).job.id,past=W.selectWeek(s,'2026-11-07'),linked=S.linkedRow(past,'p',id);assert.deepEqual(linked.workItems,items().map(i=>({...i,amount:0})));
 assert.throws(()=>S.save(past,'p',[{linkJobId:id,workItems:[{description:'Earlier work',amount:6000}]}],0,uid),/exceed agreed labor/);
 const next=S.save(past,'p',[{linkJobId:id,workItems:[{description:'Earlier work',amount:3000}]}],0,uid),later=S.view(W.selectWeek(next,'2026-11-21'),'p').snapshot.rows[0];
 assert.equal(later.opening,7000);assert.equal(later.weekly,4625);assert.equal(later.remaining,2375);assert.deepEqual(later.workItems,items());
});
test('released worksheets and their line item data remain immutable',()=>{
 let s=first();s=A.release(s,S.savedFor(s,'p').id,uid(),'2026-11-28');const before=structuredClone(s);
 assert.throws(()=>S.save(s,'p',[{id:row(s).job.id,workItems:[{description:'Changed',amount:1}]}],0,uid),/released/);assert.deepEqual(s,before);
});
test('table and both print layouts include all job descriptions and item amounts; weekly total is readonly',()=>{
 const s=first(),record=S.savedFor(s,'p'),html=S.render({state:s,esc:x=>String(x).replaceAll('<','&lt;'),peso:String,range:()=>'',button:()=>''},'p');
 assert.match(html,/data-job-add/);assert.match(html,/data-job-remove/);assert.match(html,/data-field="weekly"[^>]*readonly/);assert.doesNotMatch(html,/data-field="work"/);
 const window={SimplePainter:S};vm.runInNewContext(fs.readFileSync(require.resolve('../payroll-v2/half-slips.js'),'utf8'),{window});
 for(const output of [JSON.stringify(PDF.definition(record)),JSON.stringify(window.PayrollSlips.blocks(record.snapshot))])for(const item of items()){assert.ok(output.includes(item.description));assert.ok(output.includes('₱'+item.amount.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})))}
});
