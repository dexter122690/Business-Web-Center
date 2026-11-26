const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js'),PDF=require('../payroll-v2/pdf.js');
let n=0;const uid=()=>`released-editor-${++n}`;
const seed=()=>W.emptyWorkspace([{id:'p',name:'Fictional Painter',position:'Auto painter',type:'contract',rate:0}],undefined,'2026-11-14');
const context=state=>({state,esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),peso:String,button:()=>'',range:()=>'',canReceive:true,today:'2026-11-26'});
const snapshot=s=>S.view(s,'p').snapshot;
const upper=html=>html.split('<form id="painterWorksheet"')[1].split('</tbody>')[0];
function prior(){return S.save(seed(),'p',[{unit:'Released Honda',plate:'TEST 001',invoice:'QA-001',contract:10000,weekly:5000}],0,uid)}
function release(){const old=prior(),id=snapshot(old).rows[0].job.id;return S.save(W.selectWeek(old,'2026-11-21'),'p',[
  {id,workItems:[{description:'Final repair',amount:1500},{description:'Polishing',amount:500}],retentionStatus:'retained',unitReleasedOn:'2026-11-25'},
  {unit:'Ongoing Toyota',plate:'TEST 002',contract:5000,weekly:1000}
],500,uid)}

test('saved release leaves the upper editor immediately; lower table uses balance after this week',()=>{
 const s=release(),before=structuredClone(s),c=snapshot(s),r=c.rows[0],html=S.render(context(s),'p');
 assert.deepEqual(S.activeRows(c).map(r=>r.job.unit),['Ongoing Toyota']);
 assert.equal(r.opening,5000);assert.equal(r.weekly,2000);assert.equal(r.remaining,3000);
 assert.doesNotMatch(upper(html),/Released Honda|TEST 001/);assert.match(upper(html),/Ongoing Toyota/);
 const lower=S.balances(context(s),c);assert.match(lower,/Released Honda/);assert.match(lower,/>2000<\/td><td class="num">3000<\/td>/);
 assert.match(lower,/Final repair — 1500/);assert.match(lower,/Polishing — 500/);assert.match(lower,/2026-11-25/);assert.match(lower,/2027-01-09/);
 assert.doesNotMatch(lower,/<input|<textarea|<select|<button/);
 assert.deepEqual(S.weeklyTotals(c),{ongoing:1000,released:2000});assert.equal(c.basic,3000);assert.equal(c.net,2500);
 assert.match(html,/id="painterReleasedTotal">2000</);assert.match(html,/id="painterGross">3000</);assert.deepEqual(s,before);
});

test('draft release does not enter lower table before successful save; missing date leaves data intact',()=>{
 const s=prior(),id=snapshot(s).rows[0].job.id,before=structuredClone(s);
 const inputs=[{id,weekly:5000,retentionStatus:'retained',unitReleasedOn:'2026-11-20'}];
 const draft=S.draft(s,'p',inputs,0,uid);
 assert.match(upper(S.render(context(s),'p')),/Released Honda/);
 assert.doesNotMatch(S.balances({...context(s),pendingSave:true},draft),/data-retained-job/);
 assert.deepEqual(s,before);
 assert.throws(()=>S.save(s,'p',[{...inputs[0],unitReleasedOn:''}],0,uid),/release date/);assert.deepEqual(s,before);
 const saved=S.save(s,'p',inputs,0,uid);
 assert.doesNotMatch(upper(S.render(context(saved),'p')),/Released Honda/);assert.match(S.balances(context(saved),snapshot(saved)),/Released Honda/);
});

test('resaving only visible ongoing inputs preserves hidden released payments, items and one worksheet per week',()=>{
 const s=release(),before=structuredClone(snapshot(s).rows[0]);
 const inputs=S.activeRows(snapshot(s)).map(r=>({id:r.job.id,weekly:1500}));
 const next=S.save(s,'p',inputs,500,uid),c=snapshot(next);
 assert.deepEqual(c.rows.find(r=>r.job.id===before.job.id),before);
 assert.equal(c.basic,3500);assert.equal(c.net,3000);assert.equal(next.painterTestSheets.length,s.painterTestSheets.length);
 assert.deepEqual(S.validate(next,s),[]);
 const reloaded=JSON.parse(JSON.stringify(next));assert.doesNotMatch(upper(S.render(context(reloaded),'p')),/Released Honda/);
 const future=S.save(W.selectWeek(next,'2026-11-28'),'p',[],0,uid),f=snapshot(future);
 assert.equal(f.basic,0);assert.equal(f.rows.find(r=>r.job.id===before.job.id).remaining,3000);
 assert.deepEqual(S.activeRows(f).map(r=>r.job.unit),['Ongoing Toyota']);assert.deepEqual(next.painterTestSheets[0],s.painterTestSheets[0]);
});

test('fully settled released units stay in payment history and payslip, not either editor table',()=>{
 const s=S.save(seed(),'p',[{unit:'Fully settled QA',plate:'TEST FULL',contract:1000,workItems:[{description:'Final work',amount:1000}],retentionStatus:'retained',unitReleasedOn:'2026-11-20'}],0,uid);
 const c=snapshot(s),before=structuredClone(s),html=S.render(context(s),'p');
 assert.equal(S.activeRows(c).length,0);assert.equal(S.balanceRows(c).length,0);
 assert.doesNotMatch(upper(html),/Fully settled QA/);assert.doesNotMatch(S.balances(context(s),c),/Fully settled QA/);
 assert.match(S.releasedPaymentsHistory(context(s),c),/Fully settled QA/);assert.match(S.releasedPaymentsHistory(context(s),c),/Final work — 1000/);
 assert.match(JSON.stringify(PDF.definition(S.savedFor(s,'p'))),/Fully settled QA/);assert.equal(c.net,1000);assert.deepEqual(s,before);
 const next=W.selectWeek(s,'2026-11-21');assert.equal(S.releasedPaymentsHistory(context(next),snapshot(next)),'');
 assert.match(S.render(context(next),'p'),/Fully settled QA/); // Still reachable in job history.
});

test('pending agreed labor stays pending and received retention follows the existing payday rule',()=>{
 const s=S.save(seed(),'p',[{unit:'Pending released QA',contract:'',weekly:100,retentionStatus:'retained',unitReleasedOn:'2026-11-20'}],0,uid),c=snapshot(s);
 assert.equal(S.activeRows(c).length,0);assert.equal(c.rows[0].remaining,null);assert.match(S.balances(context(s),c),/Pending confirmation/);assert.equal(c.net,100);
 const early=S.save(seed(),'p',[{unit:'Receipt QA',contract:1000,weekly:800,retentionStatus:'retained',unitReleasedOn:'2026-09-30'}],0,uid);
 const job=snapshot(early).rows[0].job,basis=S.receiptBasis(early,'p',job.id);
 early.painterRetentionReceipts=[{id:uid(),employeeId:'p',jobId:job.id,amount:200,receivedOn:'2026-11-21',recordedAt:'2026-11-21T04:00:00Z',recordedBy:'qa',basis}];
 assert.match(S.balances(context(early),snapshot(early)),/<b>Received<\/b>/);assert.equal(snapshot(early).net,800);
 const next=W.selectWeek(early,'2026-11-21');assert.doesNotMatch(S.balances(context(next),snapshot(next)),/Receipt QA/);assert.equal(snapshot(next).net,0);
});

test('editor visibility never changes printed itemization, frozen snapshots, or earlier ongoing weeks',()=>{
 let s=release();s=A.release(s,S.savedFor(s,'p').id,uid(),'2026-11-28');
 const frozen=structuredClone(s.releasedPainterSlips[0]),definition=JSON.stringify(PDF.definition(frozen));
 const window={SimplePainter:S};vm.runInNewContext(fs.readFileSync(require.resolve('../payroll-v2/half-slips.js'),'utf8'),{window});
 const blocks=window.PayrollSlips.blocks(frozen.snapshot);
 assert.ok(blocks.some(b=>b.kind==='labor-grid'&&b.text.includes('Released Honda')&&b.text.includes('2,000.00')));
 assert.match(definition,/Final repair/);assert.match(definition,/Polishing/);
 S.render(context(s),'p');S.balances(context(s),snapshot(s));
 assert.equal(JSON.stringify(PDF.definition(frozen)),definition);assert.deepEqual(s.releasedPainterSlips[0],frozen);
 const historical=W.selectWeek(s,'2026-11-14');assert.match(upper(S.render(context(historical),'p')),/Released Honda/);
 assert.throws(()=>S.save(s,'p',[],0,uid),/released payslip/);assert.deepEqual(A.validate(s),[]);
});

test('read-only released descriptions are escaped and include every item without modifying records',()=>{
 const s=S.save(seed(),'p',[{unit:'<script>QA</script>',plate:'TEST',contract:1000,workItems:[{description:'<img src=x>',amount:100}],retentionStatus:'retained',unitReleasedOn:'2026-11-20'}],0,uid);
 for(const html of [S.balances(context(s),snapshot(s)),S.releasedPaymentsHistory(context(s),snapshot(s))]){
  assert.doesNotMatch(html,/<script>|<img src=x>/);assert.match(html,/&lt;script>/);assert.match(html,/&lt;img src=x>/);
 }
 const app=fs.readFileSync(require.resolve('../payroll-v2/app-v2.js'),'utf8');
 assert.match(app,/S\.balances\(\{esc,peso,state,pendingSave:true,coveredReceipts:RP\?\.covered\(state,c\)\},c\)/);
});

test('blank-row preview never borrows the opening balance of an invisible released unit',()=>{
 const state=release(),base=snapshot(state),active=S.activeRows(base)[0],inputs=[{id:active.job.id,weekly:1200}];
 const c=S.draft(state,'p',inputs,500,uid),cell=()=>({textContent:'stale'});
 const rows=[{dataset:{painterRow:active.job.id},opening:cell()},{dataset:{painterRow:''},opening:cell()}];
 for(const row of rows)row.querySelector=selector=>selector==='[data-row-opening]'?row.opening:null;
 const app=fs.readFileSync(require.resolve('../payroll-v2/app-v2.js'),'utf8');
 const block=app.match(/      const tableRows=Array\.from\(document\.querySelectorAll\('\[data-painter-row\]'\)\)[\s\S]*?\n    }catch/)[0].replace(/\n    }catch$/,'');
 const env={document:{querySelectorAll:()=>rows},S,state,ui:{employeeId:'p'},c,peso:String};vm.runInNewContext(block,env);
 assert.equal(rows[0].opening.textContent,'5000');assert.equal(rows[1].opening.textContent,'—');
 const linked={job:{id:'historical-job',contract:9000},opening:7000,weekly:0,remaining:7000};
 rows[1].dataset.linkJobId=linked.job.id;c.rows.push(linked);vm.runInNewContext('{'+block+'}',env);assert.equal(rows[1].opening.textContent,'7000');
});
