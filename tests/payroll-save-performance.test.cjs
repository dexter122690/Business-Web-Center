const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../payroll-v2/online.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const empty=()=>({employees:[],releasedPainterSlips:[],retainedPaydayCopies:[],payslips:[],slipReleases:[],retentionReceipts:[]});
async function setup(options={}){
 const calls=[],renders=[],printed=[],downloads=[],classes=new Set(),state=options.state||empty(),scope={branch:options.branch||'test-sta-rosa'};
 let loaded={revision:7,access:options.access||'owner',branchName:'Test branch',payrollWorkflowVersion:2,payrollDocumentMode:options.documentMode,state},serial=0;
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'test-user'}}}})},rpc:async(name,args)=>{
  calls.push({name,args:copy(args)});
  if(name==='payroll_v2_apply_reviewed_history')return {data:{status:'none'}};
  if(name==='payroll_v2_load'){if(options.loadError&&calls.some(c=>c.name==='payroll_v2_save'))throw Error('network error');return {data:copy(loaded)}};
  if(name==='payroll_v2_get_files')return {data:options.existing||[]};
  if(name==='payroll_v2_save'){
   if(options.wait)await options.wait;
   if(options.commit!==false){loaded={...loaded,revision:args.expected_revision+(options.revisionDelta||1),state:options.transform?options.transform(copy(args.payload)):copy(args.payload)}}
   if(options.error) return {error:options.error,status:options.status};
   if(options.throwError)throw Error(options.throwError);
   return {data:copy(loaded)};
  }
  throw Error('Unexpected RPC '+name);
 }};
 const window={open:()=>options.popupBlocked?null:{document:{body:{}},close(){}},PayrollPrint:{write:(win,record)=>printed.push(copy(record))}},parent={location:{origin:'https://test.invalid'},getBusinessSupabaseClient:()=>client,localStorage:{getItem:key=>key==='bwc-active-business'?'test-business':scope.branch}};
 const document={body:{classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}},createElement:()=>({click(){downloads.push({href:this.href,download:this.download})}})};
 const PayrollPDF={dataUrl:async slip=>{renders.push(copy(slip));if(options.pdfError)throw Error('PDF failed');return 'data:application/pdf;base64,JVBERi0x'}};
 const PayrollRetainedPayday={prepareSave:next=>next,receive:(old,input)=>({...copy(old),retentionReceipts:[{id:'receipt',...input}],retainedPaydayCopies:[{id:'copy'}]})};
 vm.runInNewContext(source,{window,parent,document,location:parent.location,PayrollPDF,PayrollRetainedPayday,crypto:{randomUUID:()=>`test-${++serial}`}});
 await window.PayrollOnline.ready;
 return {api:window.PayrollOnline,calls,renders,printed,downloads,classes,state,scope};
}
const pdfFile=id=>({id,kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0x'});
test('both branches batch new PDF checks and save all files and state in one transaction',async()=>{
 for(const branch of ['test-sta-rosa','test-sto-tomas']){
  const x=await setup({branch}),next=empty(),progress=[];
  next.retainedPaydayCopies=[{id:'copy-1'},{id:'copy-2'}];next.releasedPainterSlips=[{id:'released'}];next.payslips=[{id:'daily'}];next.slipReleases=[{slipId:'daily',date:'2026-11-28'}];
  const saved=await x.api.save(next,message=>progress.push(message));
  const reads=x.calls.filter(c=>c.name==='payroll_v2_get_files'),writes=x.calls.filter(c=>c.name==='payroll_v2_save');
  assert.equal(reads.length,1);assert.deepEqual(reads[0].args.ids,['released','copy-1','copy-2','daily']);assert.equal(writes.length,1);assert.equal(writes[0].args.files.length,4);assert.deepEqual(copy(saved),next);
  assert.ok(x.calls.every(c=>c.args.r===branch));assert.equal(x.renders.at(-1).releaseConfirmation.date,'2026-11-28');
  assert.ok(progress.includes('Preparing payslip PDF 4 of 4…'));assert.equal(x.classes.size,0);
  await x.api.save(saved);assert.equal(x.renders.length,4);assert.equal(x.calls.filter(c=>c.name==='payroll_v2_get_files').length,1);
 }
});
test('existing immutable PDF is reused, not generated or overwritten',async()=>{
 const x=await setup({existing:[pdfFile('already-stored')]}),next=empty();next.retainedPaydayCopies=[{id:'already-stored'},{id:'new-copy'}];
 await x.api.save(next);assert.deepEqual(x.renders.map(s=>s.id),['new-copy']);
 assert.deepEqual(x.calls.find(c=>c.name==='payroll_v2_save').args.files,[pdfFile('new-copy')]);
});
test('timeout after commit verifies exact snapshot, accepts reordered JSONB keys and never retries write',async()=>{
 const x=await setup({error:{message:'upstream request timeout'},status:504,transform:s=>Object.fromEntries(Object.entries(s).reverse())}),next=empty(),progress=[];
 next.retainedPaydayCopies=[{id:'saved-copy'}];
 assert.deepEqual(copy(await x.api.save(next,s=>progress.push(s))),next);
 assert.equal(x.calls.filter(c=>c.name==='payroll_v2_save').length,1);assert.equal(x.calls.filter(c=>c.name==='payroll_v2_load').length,2);assert.match(progress.at(-1),/Checking whether/);assert.equal(x.api.busy,false);
});
test('network failure after commit is also checked read-only',async()=>{
 const x=await setup({throwError:'Failed to fetch'});assert.deepEqual(copy(await x.api.save(empty())),empty());
 assert.equal(x.calls.filter(c=>c.name==='payroll_v2_save').length,1);
});
test('uncertain or concurrent saves never report success, replace local state or retry write',async()=>{
 for(const option of [{commit:false},{transform:s=>({...s,retentionReceipts:[{id:'someone-else'}]})},{revisionDelta:2},{loadError:true}]){
  const x=await setup({...option,error:{message:'upstream request timeout'},status:504}),next=empty();next.retainedPaydayCopies=[{id:'copy'}];const before=copy(next);
  await assert.rejects(x.api.save(next),/could not be confirmed.*inputs are still here.*do not record the payment twice/);
  assert.deepEqual(next,before);assert.equal(x.calls.filter(c=>c.name==='payroll_v2_save').length,1);assert.equal(x.api.busy,false);assert.equal(x.classes.size,0);
  assert.deepEqual(copy(await x.api.getFiles(['copy'])),[pdfFile('copy')]);
 }
});
test('validation and stale-revision errors do not trigger timeout recovery',async()=>{
 for(const [status,code,message] of [[400,'40001','Another user saved first'],[403,'42501','Not permitted'],[400,'P0001','Invalid received date']]){
  const x=await setup({error:{message,code},status,commit:false});await assert.rejects(x.api.save(empty()),new RegExp(message));
  assert.equal(x.calls.filter(c=>c.name==='payroll_v2_load').length,1);assert.equal(x.calls.filter(c=>c.name==='payroll_v2_save').length,1);
 }
});
test('PDF failure prevents all database writes; view-only and changed branch fail closed',async()=>{
 const x=await setup({pdfError:true}),next=empty();next.retainedPaydayCopies=[{id:'copy'}];await assert.rejects(x.api.save(next),/PDF failed/);assert.equal(x.calls.filter(c=>c.name==='payroll_v2_save').length,0);assert.equal(x.api.busy,false);
 const view=await setup({access:'view'});await assert.rejects(view.api.save(empty()),/view-only/);
 const moved=await setup();moved.scope.branch='different-branch';await assert.rejects(moved.api.save(empty()),/branch changed/);assert.equal(moved.calls.filter(c=>c.name==='payroll_v2_save').length,0);
});
test('double submit is blocked and retained save forwards progress without duplicating payment',async()=>{
 let release;const wait=new Promise(resolve=>{release=resolve}),x=await setup({wait}),progress=[];
 const saving=x.api.save(empty());await assert.rejects(x.api.save(empty()),/still running/);release();await saving;
 const y=await setup();const saved=await y.api.receiveRetention('employee','job','2026-10-30',3200,'2026-09-01',{start:'2026-10-24',end:'2026-10-30'},s=>progress.push(s));
 assert.equal(saved.retentionReceipts.length,1);assert.equal(saved.retentionReceipts[0].expectedAmount,3200);assert.ok(progress.some(s=>s.includes('Preparing payslip')));assert.equal(y.calls.filter(c=>c.name==='payroll_v2_save').length,1);
});

test('record mode saves painter, retained and daily records without PDF generation or file lookup in either branch',async()=>{
 for(const branch of ['test-sta-rosa','test-sto-tomas']){
  const x=await setup({branch,documentMode:'record',pdfError:true}),next=empty(),progress=[];
  next.retainedPaydayCopies=[{id:'retained'}];next.releasedPainterSlips=[{id:'painter'}];next.payslips=[{id:'daily'}];next.slipReleases=[{slipId:'daily',date:'2026-11-28'}];
  const before=copy(next);assert.deepEqual(copy(await x.api.save(next,s=>progress.push(s))),before);assert.deepEqual(next,before);
  assert.equal(x.renders.length,0);assert.equal(x.calls.filter(c=>c.name==='payroll_v2_get_files').length,0);
  const writes=x.calls.filter(c=>c.name==='payroll_v2_save');assert.equal(writes.length,1);assert.deepEqual(writes[0].args.files,[]);assert.equal(writes[0].args.r,branch);
  assert.ok(progress.includes('Saving payroll records—no PDF processing…'));
 }
});
test('record-only retained receipt saves once and uncertain results keep the existing read-only reconciliation',async()=>{
 const x=await setup({documentMode:'record',pdfError:true});
 const saved=await x.api.receiveRetention('employee','job','2026-11-09',2250,'2026-09-01',{start:'2026-11-07',end:'2026-11-13'});
 assert.equal(saved.retentionReceipts.length,1);assert.equal(x.renders.length,0);assert.equal(x.calls.filter(c=>c.name==='payroll_v2_save').length,1);
 for(const commit of [true,false]){
  const y=await setup({documentMode:'record',commit,error:{message:'upstream request timeout'},status:504}),next=empty();next.retainedPaydayCopies=[{id:'new'}];
  if(commit)assert.deepEqual(copy(await y.api.save(next)),next);else await assert.rejects(y.api.save(next),/could not be confirmed/);
  assert.equal(y.calls.filter(c=>c.name==='payroll_v2_save').length,1);assert.equal(y.renders.length,0);
 }
});
test('record mode still uploads employee photos and respects view-only and branch restrictions',async()=>{
 const x=await setup({documentMode:'record'}),next=empty();next.employees=[{id:'staff',photos:[{id:'photo'}]}];
 x.api.stagePhotos([{id:'photo',dataUrl:'data:image/png;base64,dGVzdA=='}]);await x.api.save(next);
 assert.equal(x.calls.find(c=>c.name==='payroll_v2_save').args.files[0].kind,'photo');
 const view=await setup({documentMode:'record',access:'view'});await assert.rejects(view.api.save(empty()),/view-only/);
 const moved=await setup({documentMode:'record'});moved.scope.branch='changed';await assert.rejects(moved.api.save(empty()),/branch changed/);
});
test('printing uses only the saved snapshot without PDF generation, file fetch or save',async()=>{
 const x=await setup({documentMode:'record',pdfError:true}),record={id:'saved',snapshot:{employee:{name:'Fictional'},period:{start:'2026-11-07'},net:2250},releaseConfirmation:{date:'2026-11-14'}};
 const before=copy(record),calls=x.calls.length;await x.api.output(record,'print');
 assert.deepEqual(x.printed,[before]);assert.deepEqual(record,before);assert.equal(x.calls.length,calls);assert.equal(x.renders.length,0);
 const blocked=await setup({popupBlocked:true});await assert.rejects(blocked.api.output(record,'print'),/Allow the payslip window/);
});
test('optional PDF download reuses original files; new PDFs are generated only on demand and never uploaded',async()=>{
 const record={id:'original',snapshot:{employee:{name:'Fictional'},period:{start:'2026-11-07'}}};
 const x=await setup({documentMode:'record',existing:[pdfFile('original')],pdfError:true});await x.api.output(record,'pdf');
 assert.equal(x.renders.length,0);assert.equal(x.downloads[0].href,pdfFile('original').dataUrl);assert.equal(x.calls.filter(c=>c.name==='payroll_v2_save').length,0);
 const y=await setup({documentMode:'record'});await y.api.output(record,'pdf');assert.equal(y.renders.length,1);assert.equal(y.downloads.length,1);assert.equal(y.calls.filter(c=>c.name==='payroll_v2_save').length,0);
});
