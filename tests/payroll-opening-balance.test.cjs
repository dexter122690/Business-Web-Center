const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js');
let serial=0;const uid=()=>`opening-${++serial}`;
function fixture(){
 let s=W.emptyWorkspace([{id:'p',name:'Test Painter',position:'Auto painter',type:'contract',rate:0}],undefined,'2026-09-12');
 s=S.save(s,'p',[{unit:'Toyota Altis',invoice:'00127',plate:'TEST 220',agreementMode:true,agreedWorkItems:[{description:'Exterior washover',amount:10000},{description:'Undercoat',amount:900},{description:'Strip',amount:1000},{description:'Mags',amount:2000},{description:'Dismantling and reassemble',amount:1500}],weekly:5000}],0,uid);
 const id=S.view(s,'p').snapshot.rows[0].job.id;
 s=S.save(W.selectWeek(s,'2026-09-19'),'p',[{id,agreementMode:true,weekly:2000}],0,uid);
 return {s,id};
}
function staleFixture(){const {s,id}=fixture(),r=S.savedFor(s,'p').snapshot.rows[0];r.opening=15400;r.remaining=13400;return {s,id};}
const render=s=>S.render({state:s,esc:String,peso:String,range:p=>p.start,agreedJobPricing:true,button:(label,action,attrs='')=>`<button data-action="${action}" ${attrs}>${label}</button>`},'p');

test('saved open week derives opening from earlier saved payments, without changing stored data',()=>{
 const {s}=staleFixture(),before=structuredClone(s),v=S.view(s,'p');
 assert.equal(v.snapshot.rows[0].opening,10400);
 assert.equal(v.snapshot.rows[0].remaining,8400);
 assert.equal(v.snapshot.rows[0].weekly,2000);
 assert.equal(v.snapshot.net,2000);
 assert.equal(v.balancesRefreshed,true);
 assert.deepEqual(s,before);
 assert.equal(v.saved.snapshot.rows[0].opening,15400);
});

test('Save table persists recalculated balances but preserves every payment and agreement',()=>{
 const {s,id}=staleFixture(),prior=structuredClone(s.painterTestSheets[0]);
 const next=S.save(s,'p',[{id,agreementMode:true,weekly:2000}],0,uid);
 assert.deepEqual(next.painterTestSheets[0],prior);
 const r=S.savedFor(next,'p').snapshot.rows[0];
 assert.deepEqual([r.job.contract,r.opening,r.weekly,r.remaining],[15400,10400,2000,8400]);
 assert.deepEqual(r.job,S.savedFor(s,'p').snapshot.rows[0].job);
 assert.deepEqual(S.validate(next,s),[]);
 assert.equal(S.view(next,'p').balancesRefreshed,false);
});

test('opening excludes this week and future payments; remaining subtracts only this week',()=>{
 let {s,id}=fixture();s=S.save(W.selectWeek(s,'2026-09-26'),'p',[{id,agreementMode:true,weekly:1000}],0,uid);
 s=W.selectWeek(s,'2026-09-19');
 const r=S.view(s,'p').snapshot.rows[0];assert.deepEqual([r.opening,r.weekly,r.remaining],[10400,2000,8400]);
 const draft=S.draft(s,'p',[{id,agreementMode:true,weekly:3000}],0,uid).rows[0];
 assert.deepEqual([draft.opening,draft.weekly,draft.remaining],[10400,3000,7400]);
 assert.equal(S.view(W.selectWeek(s,'2026-10-03'),'p').snapshot.rows[0].opening,7400);
});

test('released payslip and its source stay unchanged, even if history contains stale balances',()=>{
 let {s}=fixture();s=A.release(s,S.savedFor(s,'p').id,uid(),'2026-09-26');
 const r=S.savedFor(s,'p').snapshot.rows[0];r.opening=15400;r.remaining=13400;
 const before=structuredClone(s),v=S.view(s,'p');
 assert.equal(v.snapshot.rows[0].opening,15400);assert.equal(v.balancesRefreshed,false);assert.deepEqual(s,before);
});

test('refreshed balances require Save table before print/PDF/release; normal saved tables remain printable',()=>{
 const html=render(staleFixture().s);
 for(const id of ['painterPrint','painterPdf','painterRelease'])assert.match(html,new RegExp(`id="${id}"[^>]*disabled`));
 assert.match(html,/Balances refreshed from earlier saved payments/);
 assert.match(html,/data-row-opening>10400/);
 const normal=render(fixture().s);assert.doesNotMatch(normal,/id="painterPrint"[^>]*disabled/);
});

test('no prior saved payment means the full agreement remains the opening balance',()=>{
 const {s}=fixture(),first=W.selectWeek(s,'2026-09-12'),r=S.view(first,'p').snapshot.rows[0];
 assert.deepEqual([r.opening,r.weekly,r.remaining],[15400,5000,10400]);
 const noPayment=S.draft(first,'p',[{id:r.job.id,agreementMode:true,weekly:''}],0,uid).rows[0];
 assert.deepEqual([noPayment.opening,noPayment.weekly,noPayment.remaining],[15400,0,15400]);
});

test('same invoice and plate for another employee do not reduce this employee balance',()=>{
 const {s}=staleFixture();s.employees.push({id:'other',name:'Other Painter',position:'Auto painter',type:'contract',rate:0});
 const other=S.save(W.selectWeek(s,'2026-09-12'),'other',[{unit:'Toyota Altis',invoice:'00127',plate:'TEST 220',agreementMode:true,agreedWorkItems:[{description:'Other work',amount:8000}],weekly:7000}],0,uid);
 assert.equal(S.view(W.selectWeek(other,'2026-09-19'),'p').snapshot.rows[0].opening,10400);
 assert.equal(S.view(W.selectWeek(other,'2026-09-19'),'other').snapshot.rows[0].opening,1000);
});

test('stale pending balance refreshes its recorded payments without inventing an agreed price',()=>{
 let s=W.emptyWorkspace([{id:'p',name:'Test Painter',position:'Auto painter',type:'contract',rate:0}],undefined,'2026-09-12');
 s=S.save(s,'p',[{unit:'Unpriced legacy job',contract:'',weekly:2500.25}],0,uid);
 const id=S.view(s,'p').snapshot.rows[0].job.id;
 s=S.save(W.selectWeek(s,'2026-09-19'),'p',[{id,weekly:500.25}],0,uid);
 S.savedFor(s,'p').snapshot.rows[0].previousRecorded=0;
 const before=structuredClone(s),v=S.view(s,'p'),r=v.snapshot.rows[0];
 assert.deepEqual([r.job.contract,r.opening,r.remaining,r.previousRecorded],[null,null,null,2500.25]);
 assert.equal(v.balancesRefreshed,true);assert.deepEqual(s,before);
 const next=S.save(s,'p',[{id,weekly:500.25}],0,uid);
 assert.equal(S.savedFor(next,'p').snapshot.rows[0].previousRecorded,2500.25);assert.deepEqual(S.validate(next,s),[]);
});
