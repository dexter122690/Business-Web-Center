const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js'),R=require('../payroll-v2/retained-payday.js');
let serial=0;const uid=()=>`undo-${++serial}`,clone=structuredClone;
function fixture(weekly=2000){
 let s=W.emptyWorkspace([{id:'p',name:'Test Painter',position:'Auto painter',type:'contract',rate:0},{id:'q',name:'Other Painter',position:'Auto painter',type:'contract',rate:0}],undefined,'2026-09-12');
 s=S.save(s,'p',[{unit:'Test Altis',plate:'TEST 220',invoice:'00127',agreementMode:true,agreedWorkItems:[{description:'Body repair',amount:10000},{description:'Polishing',amount:5400}],weekly:5000}],200,uid);
 const id=S.savedFor(s,'p').snapshot.rows[0].job.id;
 s=S.save(W.selectWeek(s,'2026-09-19'),'p',[{id,agreementMode:true,weekly,retentionStatus:'retained',unitReleasedOn:'2026-09-05'},{unit:'Other unit',contract:1000,weekly:100}],300,uid);
 s=S.save(s,'q',[{unit:'Other painter unit',contract:1000,weekly:200}],0,uid);
 return {s,id};
}
const undo=(s,id)=>S.undoUnitRelease(s,'p',id,S.unitReleaseUndoPlan(s,'p',id),'2026-11-27T01:00:00Z');
const paymentData=s=>s.painterTestSheets.map(sh=>({id:sh.id,employeeId:sh.employeeId,period:sh.period,basic:sh.snapshot.basic,net:sh.snapshot.net,cashAdvance:sh.snapshot.cashAdvance,rows:sh.snapshot.rows.map(r=>({id:r.job.id,contract:r.job.contract,items:r.job.agreedWorkItems,agreementItems:r.agreementItems,work:r.job.work,opening:r.opening,weekly:r.weekly,remaining:r.remaining}))}));
const context=s=>({state:s,access:'edit',esc:String,peso:String,button:()=>'',range:p=>p.start,canReceive:true,today:'2026-11-27',agreedJobPricing:true});

test('undo backdated release restores upper table in the original entry week without changing money',()=>{
 for(const weekly of [0,2000]){
  const {s,id}=fixture(weekly),before=clone(s),plan=S.unitReleaseUndoPlan(s,'p',id);
  assert.equal(plan.period.start,'2026-09-19');assert.equal(plan.unitReleasedOn,'2026-09-05');
  assert.equal(S.activeRows(S.view(s,'p').snapshot).some(r=>r.job.id===id),false);
  const next=undo(s,id),c=S.view(next,'p').snapshot,j=c.rows.find(r=>r.job.id===id).job;
  assert.equal(j.retentionStatus,'ongoing');assert.equal(j.unitReleasedOn,'');assert.equal(j.releasePayrollStart,undefined);assert.equal(S.retentionDue(j),'');
  assert.equal(S.activeRows(c).some(r=>r.job.id===id),true);assert.equal(S.balanceRows(c).some(r=>r.job.id===id),false);
  assert.deepEqual(paymentData(next),paymentData(s));assert.deepEqual(next.painterTestSheets[0],s.painterTestSheets[0]);
  assert.deepEqual(next.painterTestSheets.find(sh=>sh.employeeId==='q'),s.painterTestSheets.find(sh=>sh.employeeId==='q'));
  assert.deepEqual(next.painterTestSheets[1].snapshot.rows[1],s.painterTestSheets[1].snapshot.rows[1]);
  for(const k of ['employees','jobs','payments','releases','advances','attendance','payslips','releasedPainterSlips'])assert.deepEqual(next[k],s[k]);
  assert.deepEqual(s,before);assert.deepEqual(S.validate(next,s),[]);assert.deepEqual(W.validateTransition(s,next,'2026-11-27'),[]);
 }
});

test('undo from a later payroll fixes zero-payment carry-forwards, navigates original cutoff, and stays fixed on reload',()=>{
 let {s,id}=fixture();s=S.save(W.selectWeek(s,'2026-09-26'),'p',[],0,uid);s=S.save(W.selectWeek(s,'2026-10-03'),'p',[],0,uid);s=W.selectWeek(s,'2026-10-10');
 const next=undo(s,id);assert.equal(next.period.start,'2026-09-19');assert.deepEqual(paymentData(next),paymentData(s));
 for(const day of ['2026-09-19','2026-09-26','2026-10-03','2026-10-10']){
  const reloaded=JSON.parse(JSON.stringify(W.selectWeek(next,day))),c=S.view(reloaded,'p').snapshot;
  assert.equal(S.activeRows(c).some(r=>r.job.id===id),true);assert.equal(S.balanceRows(c).some(r=>r.job.id===id),false);
 }
 assert.deepEqual(S.validate(next,s),[]);
});

test('after undo the unit can be released in the correct later week, without duplicating previous payments',()=>{
 const {s,id}=fixture(),reopened=undo(s,id);
 const next=S.save(W.selectWeek(reopened,'2026-09-26'),'p',[{id,agreementMode:true,weekly:1000,retentionStatus:'retained',unitReleasedOn:'2026-10-01'}],0,uid);
 const c=S.view(next,'p').snapshot,r=c.rows.find(r=>r.job.id===id);
 assert.deepEqual([r.opening,r.weekly,r.remaining],[8400,1000,7400]);assert.equal(r.job.releasePayrollStart,'2026-09-26');assert.equal(S.retentionDue(r.job),'2026-11-15');
 assert.equal(S.activeRows(c).some(r=>r.job.id===id),false);assert.equal(S.balanceRows(c).some(r=>r.job.id===id),true);assert.deepEqual(S.validate(next,reopened),[]);
});

test('received balance at any date blocks undo; no receipt or payment is changed',()=>{
 const {s,id}=fixture(),basis=S.receiptBasis(s,'p',id);
 s.painterRetentionReceipts=[{id:'receipt',employeeId:'p',jobId:id,amount:basis.amount,receivedOn:'2026-10-20',recordedAt:'2026-10-20T00:00:00Z',basis}];
 const before=clone(s);assert.throws(()=>undo(s,id),/recorded receipt/);assert.deepEqual(s,before);
 const legacy=fixture();legacy.s.releases.push({id:'legacy-receipt',jobId:legacy.id,amount:1,date:'2026-10-20'});assert.throws(()=>undo(legacy.s,legacy.id),/recorded receipt/);
});

test('released original or later payslip blocks undo; earlier ongoing released copy is preserved',()=>{
 const original=fixture();original.s=A.release(original.s,S.savedFor(original.s,'p').id,uid(),'2026-09-26');const before=clone(original.s);
 assert.throws(()=>undo(original.s,original.id),/payslip/);assert.deepEqual(original.s,before);
 let {s,id}=fixture();s=S.save(W.selectWeek(s,'2026-09-26'),'p',[],0,uid);s=A.release(s,S.savedFor(s,'p').id,uid(),'2026-10-03');assert.throws(()=>undo(s,id),/payslip/);
 const prior=fixture(),first=prior.s.painterTestSheets[0];prior.s=A.release(prior.s,first.id,uid(),'2026-09-19');
 const result=undo(prior.s,prior.id);assert.deepEqual(result.releasedPainterSlips,prior.s.releasedPainterSlips);assert.deepEqual(result.painterTestSheets[0],first);assert.deepEqual(A.validate(result,prior.s),[]);
});

test('combined payday copy blocks undo even when its receipt belongs to another unit',()=>{
 let {s,id}=fixture();s=S.save(s,'p',[{unit:'Other retained unit',contract:1000,weekly:500,retentionStatus:'retained',unitReleasedOn:'2026-07-01'}],300,uid);
 const other=S.view(s,'p').snapshot.rows.find(r=>r.job.unit==='Other retained unit'),basis=S.receiptBasis(s,'p',other.job.id);
 s=R.receive(s,{employeeId:'p',jobId:other.job.id,date:'2026-09-26',expectedAmount:basis.amount,expectedReleaseDate:basis.unitReleasedOn,expectedPeriod:R.target(s,'p','2026-09-26').period,acknowledge:true},uid,'2026-11-27T01:00:00Z','2026-11-27');
 const before=clone(s);assert.throws(()=>undo(s,id),/payslip/);assert.deepEqual(s,before);
});

test('ambiguous history, conflicting later status, changed confirmation and repeat undo fail safely',()=>{
 const {s,id}=fixture(),plan=S.unitReleaseUndoPlan(s,'p',id);
 assert.throws(()=>S.undoUnitRelease(s,'p',id,{...plan,unitReleasedOn:'2026-09-06'}),/details changed/);
 assert.throws(()=>S.undoUnitRelease(s,'p',id),/details changed/);
 assert.throws(()=>S.unitReleaseUndoPlan(s,'q',id),/not released/);
 const missing=clone(s);delete S.savedFor(missing,'p').snapshot.rows[0].job.releasePayrollStart;assert.throws(()=>undo(missing,id),/identified safely/);
 const later=S.save(W.selectWeek(s,'2026-09-26'),'p',[],0,uid);S.savedFor(later,'p').snapshot.rows[0].job.unitReleasedOn='2026-09-30';assert.throws(()=>undo(later,id),/different unit release/);
 const reopened=undo(s,id);assert.throws(()=>undo(reopened,id),/not released/);
});

test('lower table offers a confirmation action to editors only and disables it while changes are pending',()=>{
 const {s,id}=fixture(),c=S.view(s,'p').snapshot,x=context(s),html=S.balances(x,c);
 assert.match(html,/data-action="unit-release-undo"/);assert.match(html,/Undo unit release/);assert.doesNotMatch(html,/data-action="unit-release-undo"[^>]*disabled/);
 assert.doesNotMatch(S.balances({...x,access:'view'},c),/Undo unit release/);
 assert.match(S.balances({...x,pendingSave:true},c),/data-action="unit-release-undo"[^>]*disabled/);
 const locked=A.release(s,S.savedFor(s,'p').id,uid(),'2026-09-26');assert.match(S.balances(context(locked),S.view(locked,'p').snapshot),/data-action="unit-release-undo"[^>]*disabled/);
 const restored=S.render(context(undo(s,id)),'p');assert.match(restored.split('id="painterBalances"')[0],/Test Altis/);assert.doesNotMatch(restored.split('id="painterBalances"')[1].split('<details')[0],/Test Altis/);
});

test('fully paid released units offer the same guarded undo in payment history without changing amounts',()=>{
 const {s,id}=fixture(10400),before=clone(s),c=S.view(s,'p').snapshot,r=c.rows.find(r=>r.job.id===id);
 assert.equal(r.remaining,0);assert.equal(S.balanceRows(c).some(r=>r.job.id===id),false);
 const html=S.releasedPaymentsHistory(context(s),c);
 assert.match(html,/data-action="unit-release-undo"/);assert.doesNotMatch(html,/data-action="unit-release-undo"[^>]*disabled/);
 assert.doesNotMatch(S.releasedPaymentsHistory({...context(s),access:'view'},c),/Undo unit release/);
 assert.match(S.releasedPaymentsHistory({...context(s),pendingSave:true},c),/data-action="unit-release-undo"[^>]*disabled/);
 const locked=A.release(s,S.savedFor(s,'p').id,uid(),'2026-09-26');
 assert.match(S.releasedPaymentsHistory(context(locked),S.view(locked,'p').snapshot),/data-action="unit-release-undo"[^>]*disabled/);
 const received=clone(s);received.releases.push({id:'receipt',jobId:id,amount:1,date:'2026-09-26'});
 assert.match(S.releasedPaymentsHistory(context(received),S.view(received,'p').snapshot),/recorded receipt/);
 const next=undo(s,id);
 assert.equal(next.period.start,s.period.start);assert.equal(S.activeRows(S.view(next,'p').snapshot).filter(r=>r.job.id===id).length,1);
 assert.deepEqual(paymentData(next),paymentData(s));assert.deepEqual(next.painterTestSheets[0],s.painterTestSheets[0]);assert.deepEqual(s,before);
 assert.deepEqual(S.validate(next,s),[]);assert.deepEqual(W.validateTransition(s,next,'2026-11-27'),[]);
});

test('unpaid released units keep a single undo button in the retained table',()=>{
 const {s}=fixture(),c=S.view(s,'p').snapshot;
 assert.match(S.balances(context(s),c),/Undo unit release/);
 assert.doesNotMatch(S.releasedPaymentsHistory(context(s),c),/Undo unit release/);
});

function editorHarness({ack=true,access='edit',saveError=''}={}){
 const fs=require('node:fs'),vm=require('node:vm'),{s,id}=fixture();
 const nodes={form:{elements:[{disabled:false}]},error:{textContent:''},submit:{disabled:false},dialog:{open:true,close(){this.open=false}}};
 const c={S,state:s,editing:{kind:'unit-release-undo',id,basis:S.unitReleaseUndoPlan(s,'p',id)},editorSaving:false,employeePhotos:null,ui:{employeeId:'p'},painterDirty:false,painterCellsDirty:false,
  O:{busy:false,access},copy:clone,FormData:class{get(k){return k==='acknowledge'&&ack?'on':null}},discardPainter:()=>true,range:p=>p.start,window:{scrollTo(){}},D:{discardUnreferenced:async()=>{}},render:()=>{c.renders++},notify:message=>c.messages.push(message),messages:[],renders:0,commits:0,
  $:selector=>({'#editorForm':nodes.form,'#formError':nodes.error,'#editorDialog':nodes.dialog,'#editorForm button[type=submit]':nodes.submit}[selector])};
 c.commit=async next=>{c.commits++;if(saveError)return [saveError];c.state=next;return []};
 const src=fs.readFileSync(require.resolve('../payroll-v2/app-v2.js'),'utf8');
 vm.runInNewContext(src.slice(src.indexOf('  async function saveEditor('),src.indexOf('  async function showPreview(')),c);
 return {c,nodes,event:{preventDefault(){},currentTarget:{}}};
}

test('confirmation action waits for successful online save before moving the unit; failure leaves it retained',async()=>{
 for(const saveError of ['', 'Another user saved this payroll. Reload first.']){
  const {c,nodes,event}=editorHarness({saveError}),before=clone(c.state);await c.saveEditor(event);
  assert.equal(c.commits,1);assert.equal(c.editorSaving,false);assert.equal(nodes.form.elements[0].disabled,false);
  if(saveError){assert.deepEqual(c.state,before);assert.equal(nodes.dialog.open,true);assert.equal(c.renders,0);assert.match(nodes.error.textContent,/Another user/)}
  else{assert.equal(nodes.dialog.open,false);assert.equal(c.renders,1);assert.equal(c.ui.view,'weekly');assert.equal(S.activeRows(S.view(c.state,'p').snapshot).length,2);assert.deepEqual(paymentData(c.state),paymentData(before))}
 }
});

test('missing confirmation and view-only access never save; double-click submits only once',async()=>{
 for(const options of [{ack:false},{access:'view'}]){const {c,event}=editorHarness(options),before=clone(c.state);await c.saveEditor(event);assert.equal(c.commits,0);assert.deepEqual(c.state,before)}
 const {c,nodes,event}=editorHarness();let finish;
 c.commit=next=>{c.commits++;return new Promise(resolve=>{finish=()=>{c.state=next;resolve([])}})};
 const pending=c.saveEditor(event);assert.equal(c.editorSaving,true);assert.equal(nodes.form.elements[0].disabled,true);
 await c.saveEditor(event);assert.equal(c.commits,1);finish();await pending;assert.equal(c.editorSaving,false);assert.equal(nodes.dialog.open,false);
});
