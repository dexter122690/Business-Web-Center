const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js');
const b='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875',r='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',owner='10000000-0000-4000-8000-000000000003',staff='10000000-0000-4000-8000-000000000004';
const migration=fs.readFileSync(path.join(ROOT,'supabase/077_payroll_v2.sql'),'utf8');
const teamNamesMigration=fs.readFileSync(path.join(ROOT,'supabase/078_payroll_team_display_names.sql'),'utf8');
const worksheetMigration=fs.readFileSync(path.join(ROOT,'supabase/080_payroll_working_worksheets.sql'),'utf8');
const seed=()=>W.emptyWorkspace([{id:'painter',name:'Fictional Painter',position:'Auto painter',type:'contract',rate:0,accountNumber:'PRIVATE-TEST',photos:[]},{id:'daily',name:'Fictional Admin',position:'Admin',type:'daily',rate:550}],undefined,'2026-11-14');
test('new app has no offline payroll write path and old pause stays enabled',()=>{
 const app=fs.readFileSync(path.join(ROOT,'payroll-v2/app-v2.js'),'utf8'),online=fs.readFileSync(path.join(ROOT,'payroll-v2/online.js'),'utf8');
 assert.doesNotMatch(app,/localStorage\.(setItem|getItem)|openCleanWorkspace/);assert.match(app,/await O.save\(next\)/);assert.match(online,/expected_revision:revision/);assert.doesNotMatch(online,/from\(['"](?:expenses|invoices|payroll_workers)/);
 assert.match(fs.readFileSync(path.join(ROOT,'payroll-v2-online.js'),'utf8'),/section.id='payrollV2'/);
});
test('retired branch-assignment panel stays absent without changing employee records',async()=>{
 const vm=require('node:vm'),calls=[],label={textContent:''};
 const loaded={revision:4,access:'owner',branchName:'STA. ROSA',state:seed(),pendingEmployees:[{id:'old-draft',name:'Former test employee',archived:true}]};
 const before=structuredClone(loaded),client={auth:{getSession:async()=>({data:{session:{user:{id:owner}}}})},rpc:async(name,args)=>{calls.push({name,args});return {data:loaded,error:null}}};
 const window={},parent={location:{origin:'https://example.invalid'},getBusinessSupabaseClient:()=>client,localStorage:{getItem:key=>key==='bwc-active-business'?b:r}};
 const document={body:{dataset:{}},querySelectorAll:()=>[],getElementById:id=>{assert.equal(id,'payrollBranchLabel');return label},querySelector:()=>({after(){assert.fail('Assignment panel must not be inserted')}}),createElement(){assert.fail('No assignment box or action should be created')}};
 const source=fs.readFileSync(path.join(ROOT,'payroll-v2/online.js'),'utf8');
 vm.runInNewContext(source,{window,parent,document,location:{origin:parent.location.origin},console});
 const state=await window.PayrollOnline.ready;window.PayrollOnline.permissions();window.PayrollOnline.permissions();
 assert.strictEqual(state,loaded.state);assert.deepEqual(loaded,before);assert.equal(label.textContent,'STA. ROSA · Owner');assert.deepEqual(calls.map(c=>c.name),['payroll_v2_apply_reviewed_history','payroll_v2_load']);
 assert.doesNotMatch(source,/Employee profiles awaiting branch assignment|data-assign-employee|payroll_v2_assign_employee/);
 assert.match(fs.readFileSync(path.join(ROOT,'payroll-v2/index.html'),'utf8'),/online\.js\?v=20261128-record-print/);
});
test('PDF uses half short bond, peso glyph, all unit rows and prior balance',()=>{
 const PDF=require('../payroll-v2/pdf.js');let n=0,s=S.save(seed(),'painter',[{unit:'Test unit',contract:15000,weekly:3000,work:'Panel repaint'}],500,()=>`test-${++n}`),record=S.savedFor(s,'painter');
 const def=PDF.definition(record),json=JSON.stringify(def);assert.deepEqual(def.pageSize,{width:612,height:396});assert.match(json,/₱3,000.00/);assert.match(json,/₱2,500.00/);assert.doesNotMatch(json,/PREV. RECORDED/);assert.match(json,/BALANCE BEFORE/);assert.doesNotMatch(json,/BALANCE \/ RETAINED/);assert.match(json,/Test unit/);
});
test('both payslip layouts reserve handwriting space without changing saved data',()=>{
 const vm=require('node:vm'),PDF=require('../payroll-v2/pdf.js');let n=0;
 const state=S.save(seed(),'painter',[{unit:'Signature layout test',contract:15000,weekly:3000}],500,()=>`sign-${++n}`),record=S.savedFor(state,'painter'),before=structuredClone(record);
 const def=PDF.definition(record),footer=def.content.at(-1),signing=footer.stack.at(-1);
 assert.equal(footer.unbreakable,true);assert.match(JSON.stringify(footer.stack[0]),/TOTAL SALARY/);
 assert.equal(signing.unbreakable,true);assert.equal(signing.columnGap,36);assert.equal(signing.columns.length,2);
 for(const column of signing.columns){
  assert.equal(column.width,270);assert.deepEqual(column.stack.filter(n=>n.canvas).map(n=>n.canvas[0].y1),[22,14]);
  assert.match(JSON.stringify(column),/Signature/);assert.match(JSON.stringify(column),/Printed name/);assert.match(JSON.stringify(column),/Date:/);
 }
 const window={};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'payroll-v2/half-slips.js'),'utf8'),{window});
 const final=window.PayrollSlips.cardHtml(record,[],1,1,true),continued=window.PayrollSlips.cardHtml(record,[],1,2,false);
 assert.equal((final.match(/class="signature-space"/g)||[]).length,2);assert.equal((final.match(/class="printed-name-space"/g)||[]).length,2);
 assert.match(final,/Prepared by/);assert.match(final,/Received by/);assert.doesNotMatch(continued,/class="slip-signatures"/);
 assert.deepEqual(record,before);
 const css=fs.readFileSync(path.join(ROOT,'payroll-v2/half-payslip.css'),'utf8'),index=fs.readFileSync(path.join(ROOT,'payroll-v2/index.html'),'utf8');
 assert.match(css,/\.signature-space\{height:22pt/);assert.match(css,/\.printed-name-space\{height:14pt/);
 assert.ok(index.includes('half-payslip.css?v=20261126-compact-payslip'));
 assert.ok(index.includes('half-slips.js?v=20261126-compact-payslip'));assert.ok(index.includes('pdf.js?v=20261128-save-speed'));
});
test('compact PDF summary retains every nonzero adjustment and the original net pay',()=>{
 const PDF=require('../payroll-v2/pdf.js'),snapshot=W.createPayslip(seed(),'daily');
 Object.assign(snapshot,{basic:3300,late:68.75,held:125,retentionReleased:250,cashAdvance:300,net:3056.25});
 const record={id:'summary-test',snapshot},before=structuredClone(record);
 const rows=PDF.definition(record).content.at(-1).stack[0].table.body.map(row=>row.map(cell=>cell.text));
 assert.deepEqual(rows,[['GROSS EARNINGS','₱3,300.00'],['LATE DEDUCTION','₱-68.75'],['RETENTION HELD','₱-125.00'],['RETENTION PAID','₱250.00'],['LESS CASH ADVANCE','₱-300.00'],['TOTAL SALARY','₱3,056.25']]);
 assert.deepEqual(record,before);
});
test('new navigation opens only its own frame and clears it on branch/access changes',async()=>{
 const vm=require('node:vm'),events={},timers=[],nodes={};let access='owner',requests=0;
 const data={'bwc-active-business':b,'bwc-active-branch':r};
 function element(tag){const classes=new Set(),children=[],handlers={};return {tag,children,dataset:{},style:{},hidden:false,
  classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle(k,on){on?classes.add(k):classes.delete(k)}},
  append(child){children.push(child)},contains:child=>children.includes(child),replaceChildren(){children.length=0},
  querySelector:s=>s==='iframe'?children.find(c=>c.tag==='iframe'):null,addEventListener:(event,fn)=>handlers[event]=fn,
  click(){handlers.click?.({preventDefault(){},stopImmediatePropagation(){}})},after(child){nodes[child.id]=child}}}
 nodes.nav=element('nav');nodes.dashboard=element('section');nodes.dashboard.classList.add('active');nodes.payroll=element('section');nodes.payroll.inert=true;
 const dash=element('button');dash.dataset.t='dashboard';nodes.nav.append(dash);
 const listen=(event,fn)=>(events[event]||=[]).push(fn);
 const document={createElement:element,getElementById:id=>nodes[id],querySelector:()=>dash,querySelectorAll:s=>s==='.view'?[nodes.dashboard,nodes.payroll,nodes.payrollV2].filter(Boolean):nodes.nav.children,addEventListener:listen};
 const window={addEventListener:listen,scrollTo(){},getBusinessSupabaseClient:()=>({rpc:async name=>{assert.equal(name,'payroll_v2_role');requests++;return {data:access,error:null}}})};
 vm.runInNewContext(fs.readFileSync(path.join(ROOT,'payroll-v2-online.js'),'utf8'),{window,document,localStorage:{getItem:k=>data[k]},setTimeout:fn=>timers.push(fn),MutationObserver:class{observe(){}},console});
 await timers.shift()();let button=nodes.nav.children.find(n=>n.dataset.t==='payrollV2');assert.ok(button);button.click();assert.equal(nodes.payroll.inert,true);assert.ok(nodes.payrollV2.classList.contains('active'));assert.equal(nodes.payrollV2.children[0].src,'payroll-v2/index.html?v=20261126-payroll-launch');assert.ok(!nodes.dashboard.classList.contains('active'));
 data['bwc-active-branch']=other;access='none';await events['bwc:branch-ready'][0]();assert.equal(button.hidden,true);assert.equal(nodes.payrollV2.children.length,0);assert.ok(nodes.dashboard.classList.contains('active'));
 access='owner';await events.focus[0]();assert.equal(button.hidden,false);button.click();assert.equal(nodes.payrollV2.children.length,1);
 data['bwc-active-business']='another-business';const previous=requests;await events.storage[0]({key:'bwc-active-business'});assert.equal(requests,previous);assert.equal(button.hidden,true);assert.equal(nodes.payrollV2.children.length,0);
});
test('online PostgreSQL permissions, immutable PDFs and safe correction',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
 const {PGlite}=require(process.env.BWC_PGLITE_PATH),db=new PGlite();
 await db.exec(`create role authenticated;create role anon;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select current_setting('test.actor')::uuid$$;
 create table businesses(id uuid primary key,status text);create table branches(id uuid primary key,business_id uuid,name text,is_active boolean);create table profiles(id uuid primary key,full_name text,email text);
 create table business_memberships(business_id uuid,user_id uuid,role text,status text);create table business_member_branch_access(business_id uuid,user_id uuid,branch_id uuid);
 create table business_team_invites(id uuid primary key default gen_random_uuid(),business_id uuid,email text,full_name text,branch_id uuid,status text,created_at timestamptz default now());
 create table payroll_workers(id uuid primary key default gen_random_uuid(),business_id uuid,branch_id uuid,full_name text,position text,is_active boolean);create table pms_service_records(id uuid primary key default gen_random_uuid(),business_id uuid,branch_id uuid,technician_worker_id uuid);
 create function can_view_invoice_branch(b uuid,r uuid) returns boolean language sql stable security definer as $$select exists(select 1 from business_memberships m where m.business_id=b and m.user_id=auth.uid() and m.status='active')$$;
 insert into auth.users values('${owner}'),('${staff}');insert into businesses values('${b}','active');insert into branches values('${r}','${b}','TEST BRANCH',true),('${other}','${b}','OTHER BRANCH',true);
 insert into profiles values('${owner}','Test owner','test@example.invalid'),('${staff}','Test staff','staff@example.invalid');insert into business_memberships values('${b}','${owner}','owner','active'),('${b}','${staff}','staff','active');insert into business_member_branch_access values('${b}','${staff}','${r}');
 insert into payroll_workers(business_id,branch_id,full_name,position,is_active) values('${b}','${r}','Legacy Employee','Admin',true);grant usage on schema public,auth to authenticated,anon;set test.actor='${owner}';`);
 await db.exec(migration);await db.exec(migration);await db.exec(teamNamesMigration);await db.exec(teamNamesMigration);await db.exec(worksheetMigration);await db.exec(worksheetMigration);
 const call=async(name,args)=>{const q=`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`;return (await db.query(q,args)).rows[0].value};
 const auth=async(id,fn)=>{await db.exec(`set test.actor='${id}';set role authenticated`);try{return await fn()}finally{await db.exec('reset role')}};
 const save=(state,rev,files=[])=>call('payroll_v2_save',[b,r,rev,JSON.stringify(state),JSON.stringify(files)]);
 const original=await db.query('select * from payroll_workers');
 await t.test('team names follow the selected branch and current Team Access without changing identity or grants',async()=>{
  const team=()=>auth(owner,()=>call('payroll_v2_team',[b,r]));
  assert.deepEqual(await team(),[{id:staff,name:'Test staff',email:'staff@example.invalid',level:'none'}]);
  const insert=(business,branch,name,status='accepted')=>db.query('insert into business_team_invites(business_id,branch_id,email,full_name,status) values($1,$2,$3,$4,$5)',[business,branch,'STAFF@example.invalid',name,status]);
  await insert(other,r,'Wrong business');await insert(b,other,'Wrong branch');await insert(b,r,'Unapproved name','pending');
  assert.equal((await team())[0].name,'Test staff');
  await insert(b,null,'Unassigned team name');assert.equal((await team())[0].name,'Unassigned team name');
  await insert(b,r,'  Current branch name  ','approved');
  assert.deepEqual(await team(),[{id:staff,name:'Current branch name',email:'staff@example.invalid',level:'none'}]);
  await db.query("update business_team_invites set full_name='Renamed team member' where business_id=$1 and branch_id=$2 and status='approved'",[b,r]);
  assert.equal((await team())[0].name,'Renamed team member');
  await db.query("update business_team_invites set full_name='   ' where business_id=$1 and (branch_id=$2 or branch_id is null) and status in ('approved','accepted')",[b,r]);
  assert.equal((await team())[0].name,'Test staff');
  await db.query("update profiles set full_name='' where id=$1",[staff]);assert.equal((await team())[0].name,'staff@example.invalid');
  await db.query("update profiles set full_name='Test staff' where id=$1",[staff]);
  assert.equal((await db.query('select count(*)::int n from payroll_v2_access')).rows[0].n,0);
  await assert.rejects(auth(staff,()=>call('payroll_v2_team',[b,r])),/Owner access required/);
  assert.deepEqual(await auth(owner,()=>call('payroll_v2_team',[b,other])),[]);
 });
 await t.test('owner can save and read; staff and raw table reads denied',async()=>{
  const loaded=await auth(owner,()=>save(seed(),0));assert.equal(loaded.revision,1);assert.equal(loaded.state.employees[0].accountNumber,'PRIVATE-TEST');
  await assert.rejects(auth(staff,()=>call('payroll_v2_load',[b,r])),/access/);await assert.rejects(auth(owner,()=>db.query('select * from payroll_v2_workspaces')),/permission denied/);
 });
 await t.test('explicit staff grants are branch-scoped and private profiles are redacted',async()=>{
  await auth(owner,()=>call('payroll_v2_grant',[b,r,staff,'view']));const loaded=await auth(staff,()=>call('payroll_v2_load',[b,r]));assert.equal(loaded.state.employees[0].accountNumber,undefined);await assert.rejects(auth(staff,()=>save(loaded.state,1)),/cannot save/);await assert.rejects(auth(staff,()=>call('payroll_v2_load',[b,other])),/access/);
  await auth(owner,()=>call('payroll_v2_grant',[b,r,staff,'edit']));loaded.state.employees[0].name='Not allowed';await assert.rejects(auth(staff,()=>save(loaded.state,1)),/Only the owner/);
 });
 let current,record;
 await t.test('saved worksheet totals validated; stale revisions rejected',async()=>{
  let id=0;current=S.save(seed(),'painter',[{unit:'Test car',contract:15000,weekly:3000,work:'Panel repaint'}],500,()=>`s-${++id}`);record=S.savedFor(current,'painter');
  const bad=structuredClone(current);bad.painterTestSheets[0].snapshot.net=99;await assert.rejects(auth(owner,()=>save(bad,1)),/totals/);
  const result=await auth(owner,()=>save(current,1));assert.equal(result.revision,2);await assert.rejects(auth(owner,()=>save(current,1)),/Another user/);
 });
 await t.test('working worksheet is overwritten in place; old-client copies are compacted',async()=>{
  const changed=S.save(current,'painter',[{id:record.snapshot.rows[0].job.id,weekly:3500}],500,()=>assert.fail('No new worksheet ID should be needed'));
  let result=await auth(owner,()=>save(changed,2));assert.equal(result.state.painterTestSheets.length,1);assert.equal(result.state.painterTestSheets[0].id,record.id);
  const oldClient=structuredClone(result.state);oldClient.painterTestSheets.push({...structuredClone(oldClient.painterTestSheets[0]),id:'old-client-new-copy'});
  result=await auth(owner,()=>save(oldClient,result.revision));assert.equal(result.state.painterTestSheets.length,1);assert.equal(result.state.painterTestSheets[0].id,'old-client-new-copy');
  const bad=structuredClone(result.state);bad.painterTestSheets=[];await assert.rejects(auth(owner,()=>save(bad,result.revision)),/Keep one working worksheet/);
  const moved=structuredClone(result.state);moved.painterTestSheets[0].period.start='2026-11-21';await assert.rejects(auth(owner,()=>save(moved,result.revision)),/Keep one working worksheet|cannot be moved/);
  // Restore the fixture revision only inside this isolated test database so the
  // release-security cases below can retain their known revision assertions.
  current=result.state;record=current.painterTestSheets[0];await db.query('update payroll_v2_workspaces set revision=2 where business_id=$1 and branch_id=$2',[b,r]);
 });
 await t.test('release must atomically save original PDF; duplicate/history mutation denied',async()=>{
  current=A.release(current,record.id,'released-1','2026-11-21');await assert.rejects(auth(owner,()=>save(current,2)),/Generate the PDF/);
  const pdf={id:'released-1',kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0xLjQK'};assert.equal((await auth(owner,()=>save(current,2,[pdf]))).revision,3);
  const bad=structuredClone(current);bad.releasedPainterSlips=[];await assert.rejects(auth(owner,()=>save(bad,3)),/read-only/);await assert.rejects(auth(staff,()=>call('payroll_v2_void',[b,r,'released-1','Correction needed'])),/owner/);
  const changed=structuredClone(current);changed.painterTestSheets[0].savedAt='2026-11-23T12:00:00Z';await assert.rejects(auth(owner,()=>save(changed,3)),/read-only/);
  const competing=structuredClone(current);competing.painterTestSheets.push({...structuredClone(record),id:'competing-sheet'});await assert.rejects(auth(owner,()=>save(competing,3)),/Void the released/);
  const fixed=await auth(owner,()=>call('payroll_v2_void',[b,r,'released-1','Wrong amount entered']));assert.equal(fixed.state.releasedPainterSlips.length,0);assert.equal((await db.query("select count(*)::int n from payroll_v2_events where action='void'")).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from payroll_v2_files')).rows[0].n,1);
 });
 await t.test('unassigned employee can be assigned only once by owner',async()=>{
  await db.query('insert into payroll_v2_pending values($1,$2,$3)',[b,'pending',JSON.stringify({id:'pending',name:'Unassigned test',position:'Painter',type:'contract',rate:0})]);
  await assert.rejects(auth(staff,()=>call('payroll_v2_assign_employee',[b,r,'pending'])),/Owner/);const assigned=await auth(owner,()=>call('payroll_v2_assign_employee',[b,r,'pending']));assert.equal(assigned.pendingEmployees.length,0);assert.equal(assigned.state.employees.at(-1).assignedBranch,'TEST BRANCH');await assert.rejects(auth(owner,()=>call('payroll_v2_assign_employee',[b,r,'pending'])),/already been assigned/);
 });
 await t.test('only names flow to invoice pickers; all legacy worker records unchanged',async()=>{
  const options=await auth(staff,()=>call('payroll_v2_employee_options',[b,r]));assert.ok(options.some(e=>e.source==='legacy'));assert.ok(options.some(e=>e.source==='new'));assert.doesNotMatch(JSON.stringify(options),/PRIVATE-TEST|rate|accountNumber/);assert.deepEqual((await db.query('select * from payroll_workers')).rows,original.rows);
 });
 await t.test('private photos stay owner-only, including direct file calls',async()=>{
  const loaded=await auth(owner,()=>call('payroll_v2_load',[b,r]));loaded.state.employees[0].photos=[{id:'photo-private-12345678',name:'Test.png',type:'image/png',size:8,addedAt:'2026-11-23T00:00:00Z'}];
  await auth(owner,()=>save(loaded.state,loaded.revision,[{id:'photo-private-12345678',kind:'photo',dataUrl:'data:image/png;base64,iVBORw0KGgo='}]));
  assert.equal((await auth(staff,()=>call('payroll_v2_get_files',[b,r,['photo-private-12345678']]))).length,0);
  assert.equal((await auth(owner,()=>call('payroll_v2_get_files',[b,r,['photo-private-12345678']]))).length,1);
 });
 await t.test('daily release locks attendance and retains its original PDF',async()=>{
  let loaded=await auth(owner,()=>call('payroll_v2_load',[b,r])),s=loaded.state;s.period=W.weeklyPeriod('2026-11-07');s.attendance=W.dates(s.period.start,s.period.end).map(date=>({employeeId:'daily',date,status:'present',lateMinutes:0}));
  s=W.saveReleasedPayslip(s,'daily','daily-release','2026-11-14T10:00:00Z','2026-11-23');
  const result=await auth(owner,()=>save(s,loaded.revision,[{id:'daily-release',kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0xLjQK'}]));
  const tamper=structuredClone(result.state);tamper.attendance[0].status='absent';await assert.rejects(auth(owner,()=>save(tamper,result.revision)),/Void the released/);
  const duplicate=structuredClone(result.state);duplicate.payslips.push({...structuredClone(duplicate.payslips[0]),id:'daily-duplicate'});await assert.rejects(auth(owner,()=>save(duplicate,result.revision)),/Overlapping/);
 });
 await t.test('anonymous RPCs are denied and null revisions fail closed',async()=>{
  await db.exec('set role anon');try{await assert.rejects(call('payroll_v2_load',[b,r]),/permission denied/);await assert.rejects(call('payroll_v2_team',[b,r]),/permission denied/)}finally{await db.exec('reset role')}
  const loaded=await auth(owner,()=>call('payroll_v2_load',[b,r]));await assert.rejects(auth(owner,()=>save(loaded.state,null)),/revision is required/);
 });
 await t.test('display migration preserves populated payroll, profiles, names and permissions',async()=>{
  const tables=['profiles','business_team_invites','business_memberships','business_member_branch_access','payroll_v2_access','payroll_v2_workspaces','payroll_v2_files','payroll_v2_directory','payroll_v2_events','payroll_workers'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query('select * from '+table)).rows])));
  const before=await snapshot();await db.exec(teamNamesMigration);assert.deepEqual(await snapshot(),before);
  const member=(await auth(owner,()=>call('payroll_v2_team',[b,r]))).find(p=>p.id===staff);assert.equal(member.level,'edit');
  await assert.rejects(auth(staff,()=>call('payroll_v2_team',[b,r])),/Owner access required/);
 });
 await t.test('worksheet migration removes only old duplicates, keeps live data and is idempotent',async()=>{
  const loaded=await auth(owner,()=>call('payroll_v2_load',[b,r])),state=loaded.state,latest=state.painterTestSheets[0];
  // Simulate saved revisions from the previous app, including a source attached
  // to an archived release. Cleanup must not delete that source or its PDF.
  const source=structuredClone(latest);source.id='protected-old-source';
  state.painterTestSheets.unshift({...structuredClone(latest),id:'obsolete-copy-1'},source,{...structuredClone(latest),id:'obsolete-copy-2'});
  state.releasedPainterSlips.push({...structuredClone(source),id:'protected-release',sourceId:source.id,archivedAt:'2026-11-23T00:00:00Z',releasedOn:'2026-11-21',releasedCopy:true,snapshot:{...structuredClone(source.snapshot),previousPayments:[]}});
  await db.query('update payroll_v2_workspaces set state=$1 where business_id=$2 and branch_id=$3',[JSON.stringify(state),b,r]);
  await db.query("insert into payroll_v2_files(business_id,branch_id,file_id,kind,data_url,created_by) values($1,$2,'protected-release','pdf','data:application/pdf;base64,JVBERi0xLjQK',$3)",[b,r,owner]);
  await db.query("insert into businesses values($1,'active')",[other]);await db.query("insert into branches values($1,$2,'Unrelated business',true)",[staff,other]);
  await db.query('insert into payroll_v2_workspaces(business_id,branch_id,state,revision) values($1,$2,$3,1)',[other,staff,JSON.stringify(state)]);
  const protectedTables=['payroll_v2_files','payroll_v2_directory','payroll_v2_access','payroll_workers','profiles','business_team_invites'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(protectedTables.map(async table=>[table,(await db.query('select * from '+table)).rows])));
  const before=await snapshot();await db.exec(worksheetMigration);
  const updated=await auth(owner,()=>call('payroll_v2_load',[b,r]));assert.equal(updated.revision,loaded.revision+1);assert.deepEqual(updated.state,S.compact(state));assert.deepEqual(await snapshot(),before);
  assert.deepEqual((await db.query('select state from payroll_v2_workspaces where business_id=$1',[other])).rows[0].state,state);
  await assert.rejects(auth(owner,()=>save(state,loaded.revision)),/Another user/);
  const after=(await db.query('select * from payroll_v2_workspaces')).rows,events=(await db.query('select * from payroll_v2_events')).rows;
  await db.exec(worksheetMigration);assert.deepEqual((await db.query('select * from payroll_v2_workspaces')).rows,after);assert.deepEqual((await db.query('select * from payroll_v2_events')).rows,events);
 });
 await t.test('employee-management migration preserves existing state and grants nobody by default',async()=>{
  const protectedTables=['payroll_v2_workspaces','payroll_v2_files','payroll_v2_directory','payroll_v2_events','payroll_workers','profiles','business_memberships','business_member_branch_access'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(protectedTables.map(async table=>[table,(await db.query('select * from '+table)).rows])));
  const before=await snapshot(),grants=(await db.query('select to_jsonb(a) as value from payroll_v2_access a')).rows;
  const sql=fs.readFileSync(path.join(ROOT,'supabase/082_payroll_employee_management.sql'),'utf8');
  await db.exec(sql);await db.exec(sql);
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual((await db.query("select to_jsonb(a)-'manage_employees' as value from payroll_v2_access a")).rows,grants);
  const loaded=await auth(staff,()=>call('payroll_v2_load',[b,r]));assert.equal(loaded.canManageEmployees,false);assert.equal(loaded.access,'edit');assert.equal(loaded.state.employees[0].accountNumber,undefined);
  assert.equal((await auth(owner,()=>call('payroll_v2_load',[b,r]))).canManageEmployees,true);
  assert.equal((await auth(owner,()=>call('payroll_v2_team',[b,r])))[0].manageEmployees,false);
 });
 await t.test('employee management needs an owner grant for an existing editor in that branch',async()=>{
  await assert.rejects(auth(staff,()=>call('payroll_v2_grant_employee_management',[b,r,staff,true])),/Owner access/);
  await assert.rejects(auth(owner,()=>call('payroll_v2_grant_employee_management',[b,other,staff,true])),/active payroll editor/);
  await assert.rejects(auth(owner,()=>call('payroll_v2_grant_employee_management',[b,r,staff,null])),/Choose whether/);
  await assert.rejects(auth(staff,()=>db.query('update payroll_v2_access set manage_employees=true')),/permission denied/);
  const stale=await auth(staff,()=>call('payroll_v2_load',[b,r])),before=(await db.query('select state from payroll_v2_workspaces where business_id=$1 and branch_id=$2',[b,r])).rows[0].state;
  await auth(owner,()=>call('payroll_v2_grant_employee_management',[b,r,staff,true]));
  const loaded=await auth(staff,()=>call('payroll_v2_load',[b,r]));assert.equal(loaded.canManageEmployees,true);assert.equal(loaded.access,'edit');assert.equal(loaded.revision,stale.revision+1);assert.equal(loaded.state.employees[0].accountNumber,'PRIVATE-TEST');
  assert.deepEqual(loaded.state,before);await assert.rejects(auth(staff,()=>save(stale.state,stale.revision)),/Another user/);
  await assert.rejects(auth(staff,()=>call('payroll_v2_load',[b,other])),/access/);
  await assert.rejects(auth(staff,()=>call('payroll_v2_get_files',[b,other,['photo-private-12345678']])),/access denied/);
  const member=(await auth(owner,()=>call('payroll_v2_team',[b,r])))[0];assert.equal(member.manageEmployees,true);
  const snapshot=(await db.query('select * from payroll_v2_access')).rows;
  await db.exec(fs.readFileSync(path.join(ROOT,'supabase/082_payroll_employee_management.sql'),'utf8'));assert.deepEqual((await db.query('select * from payroll_v2_access')).rows,snapshot);
  await auth(owner,()=>call('payroll_v2_grant_employee_management',[b,r,staff,true]));assert.equal((await auth(staff,()=>call('payroll_v2_load',[b,r]))).revision,loaded.revision);
 });
 await t.test('approved employee manager can add, edit, archive, restore and upload documents',async()=>{
  let loaded=await auth(staff,()=>call('payroll_v2_load',[b,r])),s=loaded.state;
  const protectedHistory=JSON.stringify([s.painterTestSheets,s.releasedPainterSlips,s.payslips,s.slipReleases]);
  s.employees.push({id:'new-test-employee',name:'Fictional New Employee',position:'Admin',type:'daily',rate:600,accountNumber:'000123',photos:[{id:'manager-upload',name:'Test.png',type:'image/png',size:8}]});
  loaded=await auth(staff,()=>save(s,loaded.revision,[{id:'manager-upload',kind:'photo',dataUrl:'data:image/png;base64,iVBORw0KGgo='}]));
  assert.equal(loaded.state.employees.at(-1).accountNumber,'000123');
  assert.equal((await auth(staff,()=>call('payroll_v2_get_files',[b,r,['manager-upload','photo-private-12345678']]))).length,2);
  s=loaded.state;s.employees.at(-1).name='Fictional Updated Employee';s.employees.at(-1).archived=true;s.employees.at(-1).removalReason='Test archive';
  loaded=await auth(staff,()=>save(s,loaded.revision));assert.equal(loaded.state.employees.at(-1).archived,true);
  s=loaded.state;s.employees.at(-1).archived=false;loaded=await auth(staff,()=>save(s,loaded.revision));
  assert.equal(loaded.state.employees.at(-1).archived,false);assert.equal(JSON.stringify([s.painterTestSheets,s.releasedPainterSlips,s.payslips,s.slipReleases]),protectedHistory);
  const hardDelete=structuredClone(loaded.state);hardDelete.employees.pop();await assert.rejects(auth(staff,()=>save(hardDelete,loaded.revision)),/Archive an employee/);
  assert.equal((await db.query("select full_name from payroll_v2_directory where local_id='new-test-employee'")).rows[0].full_name,'Fictional Updated Employee');
 });
 await t.test('employee manager does not gain owner powers or permission to rewrite released history',async()=>{
  const loaded=await auth(staff,()=>call('payroll_v2_load',[b,r])),bad=structuredClone(loaded.state);bad.rules.hoursPerDay=7;
  await assert.rejects(auth(staff,()=>save(bad,loaded.revision)),/Only the owner can manage payroll rules/);
  await assert.rejects(auth(staff,()=>call('payroll_v2_team',[b,r])),/Owner access/);
  await assert.rejects(auth(staff,()=>call('payroll_v2_grant',[b,r,staff,'edit'])),/Owner access/);
  await assert.rejects(auth(staff,()=>call('payroll_v2_void',[b,r,'protected-release','Test correction'])),/Only the owner/);
  const history=structuredClone(loaded.state);history.releasedPainterSlips=[];await assert.rejects(auth(staff,()=>save(history,loaded.revision)),/read-only/);
  const overwrite={id:'manager-upload',kind:'photo',dataUrl:'data:image/png;base64,dGVzdA=='};await assert.rejects(auth(staff,()=>save(loaded.state,loaded.revision,[overwrite])),/cannot be overwritten/);
 });
 await t.test('revocation and downgrade redact profiles, block documents and invalidate stale saves',async()=>{
  const old=await auth(staff,()=>call('payroll_v2_load',[b,r]));await auth(owner,()=>call('payroll_v2_grant_employee_management',[b,r,staff,false]));
  let loaded=await auth(staff,()=>call('payroll_v2_load',[b,r]));assert.equal(loaded.canManageEmployees,false);assert.equal(loaded.state.employees[0].accountNumber,undefined);assert.equal(loaded.revision,old.revision+1);
  assert.equal((await auth(staff,()=>call('payroll_v2_get_files',[b,r,['manager-upload','photo-private-12345678']]))).length,0);
  await assert.rejects(auth(staff,()=>save(old.state,old.revision)),/Another user/);
  const bad=structuredClone(loaded.state);bad.employees[0].name='Forbidden edit';await assert.rejects(auth(staff,()=>save(bad,loaded.revision)),/Employee management access/);
  // Ordinary payroll saves retain hidden private values after management is revoked.
  await auth(staff,()=>save(loaded.state,loaded.revision));assert.equal((await auth(owner,()=>call('payroll_v2_load',[b,r]))).state.employees[0].accountNumber,'PRIVATE-TEST');
  await auth(owner,()=>call('payroll_v2_grant_employee_management',[b,r,staff,true]));await auth(owner,()=>call('payroll_v2_grant',[b,r,staff,'view']));
  loaded=await auth(staff,()=>call('payroll_v2_load',[b,r]));assert.equal(loaded.canManageEmployees,false);
  await assert.rejects(auth(owner,()=>call('payroll_v2_grant_employee_management',[b,r,staff,true])),/active payroll editor/);
  await auth(owner,()=>call('payroll_v2_grant',[b,r,staff,'edit']));assert.equal((await auth(staff,()=>call('payroll_v2_load',[b,r]))).canManageEmployees,false);
  assert.ok((await db.query("select count(*)::int n from payroll_v2_events where action='employee_management_access'")).rows[0].n>=3);
  await db.exec('set role anon');try{await assert.rejects(call('payroll_v2_grant_employee_management',[b,r,staff,true]),/permission denied/)}finally{await db.exec('reset role')}
  await db.query("update business_memberships set status='inactive' where user_id=$1",[staff]);await assert.rejects(auth(staff,()=>call('payroll_v2_load',[b,r])),/access/);
 });
 await t.test('starting-balance migration is idempotent and preserves existing payroll, roles and private files',async()=>{
  const sql=fs.readFileSync(path.join(ROOT,'supabase/083_payroll_starting_balances.sql'),'utf8');
  const tables=['payroll_v2_workspaces','payroll_v2_files','payroll_v2_directory','payroll_v2_access','payroll_v2_events','business_memberships'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query('select * from '+table)).rows])));
  const before=await snapshot();await db.exec(sql);await db.exec(sql);assert.deepEqual(await snapshot(),before);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.payroll_v2_check_starting_balances(jsonb,jsonb)','execute') allowed")).rows[0].allowed,false);
 });
 let carryLoaded,carryJob;
 await t.test('online saves persist starting settlements without new payments and reject forged amounts',async()=>{
  const loaded=await auth(owner,()=>call('payroll_v2_load',[b,r])),before=structuredClone(loaded.state);let id=0;
  const s=W.selectWeek(loaded.state,'2026-11-28');
  const next=S.save(s,'painter',[{unit:'Starting balance QA',contract:15000,priorSettlement:8000,weekly:2000}],0,()=>`carry-${++id}`);
  carryJob=S.savedFor(next,'painter').snapshot.rows.find(x=>x.job.unit==='Starting balance QA').job.id;
  carryLoaded=await auth(owner,()=>save(next,loaded.revision));
  const row=carryLoaded.state.painterTestSheets.find(x=>x.period.start==='2026-11-28').snapshot.rows.find(x=>x.job.id===carryJob);
  assert.deepEqual([row.job.contract,row.job.priorSettlement,row.opening,row.remaining],[15000,8000,7000,5000]);
  for(const key of ['employees','payments','releases','advances','payslips','releasedPainterSlips'])assert.deepEqual(carryLoaded.state[key],before[key]);
  for(const mutate of [rw=>rw.job.priorSettlement=-1,rw=>rw.job.priorSettlement=16000,rw=>rw.job.payrollStart='2026-11-27',rw=>{rw.opening+=1;rw.remaining+=1},rw=>{delete rw.job.priorSettlement;delete rw.job.payrollStart}]){
   const bad=structuredClone(carryLoaded.state);mutate(bad.painterTestSheets.find(x=>x.period.start==='2026-11-28').snapshot.rows.find(x=>x.job.id===carryJob));
   await assert.rejects(auth(owner,()=>save(bad,carryLoaded.revision)),/starting balance|Starting balance/);
  }
 });
 await t.test('server prevents repeat settlement deductions or changed opening metadata after rollover',async()=>{
  const next=S.save(W.selectWeek(carryLoaded.state,'2026-12-05'),'painter',[{id:carryJob,weekly:1000}],0,()=> 'carry-next-week');
  carryLoaded=await auth(owner,()=>save(next,carryLoaded.revision));
  const current=carryLoaded.state.painterTestSheets.find(x=>x.period.start==='2026-12-05').snapshot.rows.find(x=>x.job.id===carryJob);
  assert.equal(current.opening,5000);assert.equal(current.remaining,4000);
  const changed=structuredClone(carryLoaded.state);
  for(const sh of changed.painterTestSheets)for(const rw of sh.snapshot.rows)if(rw.job.id===carryJob){rw.job.priorSettlement=7000;rw.opening+=1000;rw.remaining+=1000}
  await assert.rejects(auth(owner,()=>save(changed,carryLoaded.revision)),/Starting balance is locked/);
  const double=structuredClone(carryLoaded.state),rw=double.painterTestSheets.find(x=>x.period.start==='2026-12-05').snapshot.rows.find(x=>x.job.id===carryJob);rw.opening-=8000;rw.remaining-=8000;
  await assert.rejects(auth(owner,()=>save(double,carryLoaded.revision)),/Starting balance does not match/);
 });
 await t.test('pending-contract migration is idempotent, accepts null balances and rejects fabricated numbers',async()=>{
  const before=(await db.query('select * from payroll_v2_workspaces')).rows;
  const sql=fs.readFileSync(path.join(ROOT,'supabase/084_payroll_pending_contracts.sql'),'utf8');await db.exec(sql);await db.exec(sql);
  assert.deepEqual((await db.query('select * from payroll_v2_workspaces')).rows,before);
  let loaded=await auth(owner,()=>call('payroll_v2_load',[b,r])),id=0;
  let next=S.save(W.selectWeek(loaded.state,'2026-12-12'),'painter',[{unit:'Unknown contract QA',contractPending:true,weekly:7500}],0,()=>`unknown-${++id}`);
  loaded=await auth(owner,()=>save(next,loaded.revision));const sh=()=>loaded.state.painterTestSheets.find(s=>s.period.start==='2026-12-12');
  const jobId=sh().snapshot.rows.find(r=>r.job.contractPending).job.id;
  for(const mutate of [rw=>rw.job.contract=0,rw=>rw.opening=0,rw=>rw.remaining=0,rw=>rw.previousRecorded=4,rw=>rw.weekly=-1,rw=>rw.job.contractPending='true']){
   const bad=structuredClone(loaded.state);mutate(bad.painterTestSheets.find(s=>s.period.start==='2026-12-12').snapshot.rows.find(r=>r.job.id===jobId));
   await assert.rejects(auth(owner,()=>save(bad,loaded.revision)),/painter amount|previous payments|starting balance/);
  }
  next=S.save(W.selectWeek(loaded.state,'2026-12-19'),'painter',[{id:jobId,weekly:1000}],0,()=>`unknown-${++id}`);loaded=await auth(owner,()=>save(next,loaded.revision));
  assert.equal(S.savedFor(loaded.state,'painter').snapshot.rows.find(r=>r.job.id===jobId).previousRecorded,7500);
  next=S.save(loaded.state,'painter',[{id:jobId,contractPending:false,contract:12000,weekly:1000}],0,()=>`unknown-${++id}`);loaded=await auth(owner,()=>save(next,loaded.revision));
  assert.equal(S.savedFor(loaded.state,'painter').snapshot.rows.find(r=>r.job.id===jobId).remaining,3500);
 });
 await t.test('reviewed imports are private, owner-only, atomic, revision-checked and run once',async()=>{
  const sql=fs.readFileSync(path.join(ROOT,'supabase/085_payroll_reviewed_history_import.sql'),'utf8');await db.exec(sql);await db.exec(sql);
  let loaded=await auth(owner,()=>call('payroll_v2_load',[b,r]));const before=structuredClone(loaded.state);let id=0;
  let next=S.save(W.selectWeek(before,'2026-12-26'),'painter',[{unit:'Reviewed historical QA',contractPending:true,weekly:120}],0,()=>`reviewed-${++id}`);
  const source=S.savedFor(next,'painter');next=A.release(next,source.id,'reviewed-release','2027-01-02');
  const copies=next.releasedPainterSlips.filter(x=>x.employeeId==='painter'),sheets=next.painterTestSheets.filter(x=>x.employeeId==='painter');
  const pdfs=[{id:'reviewed-release',kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0xLjQ='}];
  await db.query('insert into payroll_v2_history_imports(id,business_id,branch_id,employee_id,expected_revision,before_sheets,before_releases,worksheets,released_copies,files,review_note) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',['reviewed-qa',b,r,'painter',loaded.revision-1,JSON.stringify(before.painterTestSheets.filter(x=>x.employeeId==='painter')),JSON.stringify(before.releasedPainterSlips.filter(x=>x.employeeId==='painter')),JSON.stringify(sheets),JSON.stringify(copies),JSON.stringify(pdfs),'Fictional reviewed import']);
  assert.equal((await auth(owner,()=>call('payroll_v2_apply_reviewed_history',[b,r]))).status,'stale');
  assert.deepEqual((await auth(owner,()=>call('payroll_v2_load',[b,r]))).state,before);
  assert.equal((await auth(staff,()=>call('payroll_v2_apply_reviewed_history',[b,r]))).status,'none');
  await assert.rejects(auth(staff,()=>db.query('select * from payroll_v2_history_imports')),/permission denied/);
  await db.query('update payroll_v2_history_imports set expected_revision=$1',[loaded.revision]);
  assert.equal((await auth(owner,()=>call('payroll_v2_apply_reviewed_history',[b,r]))).status,'applied');
  loaded=await auth(owner,()=>call('payroll_v2_load',[b,r]));
  for(const key of Object.keys(before).filter(k=>!['painterTestSheets','releasedPainterSlips'].includes(k)))assert.deepEqual(loaded.state[key],before[key]);
  assert.deepEqual(loaded.state.painterTestSheets,sheets);assert.deepEqual(loaded.state.releasedPainterSlips,copies);
  assert.equal((await auth(owner,()=>call('payroll_v2_get_files',[b,r,['reviewed-release']]))).length,1);
  assert.equal((await auth(owner,()=>call('payroll_v2_apply_reviewed_history',[b,r]))).status,'none');
  assert.equal((await auth(owner,()=>call('payroll_v2_load',[b,r]))).revision,loaded.revision);
  assert.equal((await db.query("select count(*)::int n from payroll_v2_events where action='reviewed_history_import'")).rows[0].n,1);
 });
 await t.test('unit-release guard is idempotent and prevents paying carried read-only rows',async()=>{
  const before=(await db.query('select * from payroll_v2_workspaces')).rows;
  const sql=fs.readFileSync(path.join(ROOT,'supabase/086_payroll_unit_release_flow.sql'),'utf8');await db.exec(sql);await db.exec(sql);
  assert.deepEqual((await db.query('select * from payroll_v2_workspaces')).rows,before);
  let loaded=await auth(owner,()=>call('payroll_v2_load',[b,r])),id=0;
  let next=S.save(W.selectWeek(loaded.state,'2027-01-02'),'painter',[{unit:'Released QA',contract:1000,weekly:300,retentionStatus:'retained',unitReleasedOn:'2027-01-05'}],0,()=>`release-db-${++id}`);
  loaded=await auth(owner,()=>save(next,loaded.revision));
  const j=S.savedFor(loaded.state,'painter').snapshot.rows.find(r=>r.job.unit==='Released QA').job;
  next=S.save(W.selectWeek(loaded.state,'2027-01-09'),'painter',[],0,()=>`release-db-${++id}`);loaded=await auth(owner,()=>save(next,loaded.revision));
  assert.equal(S.mainRows(S.savedFor(loaded.state,'painter').snapshot).some(r=>r.job.id===j.id),false);
  for(const mutate of [r=>r.job.unitReleasedOn='',r=>r.job.releasePayrollStart='2027-01-03',r=>{r.weekly=10;r.remaining-=10}]){
   const bad=structuredClone(loaded.state),sheet=bad.painterTestSheets.find(s=>s.period.start==='2027-01-09');mutate(sheet.snapshot.rows.find(r=>r.job.id===j.id));
   sheet.snapshot.basic=W.sum(sheet.snapshot.rows,'weekly');sheet.snapshot.net=sheet.snapshot.basic-sheet.snapshot.cashAdvance;
   await assert.rejects(auth(owner,()=>save(bad,loaded.revision)),/released-unit|date/);
  }
 });
 await t.test('September historical worksheets save online without moving existing later records',async()=>{
  const loaded=await auth(owner,()=>call('payroll_v2_load',[b,r])),before=structuredClone(loaded.state);let n=0;
  let next=S.save(W.selectWeek(before,'2026-09-01'),'painter',[{unit:'September back-entry QA',contract:10000,weekly:2000}],0,()=>`sept-db-${++n}`);
  let result=await auth(owner,()=>save(next,loaded.revision));const first=S.savedFor(result.state,'painter'),job=first.snapshot.rows[0].job;
  assert.deepEqual(first.period,{start:'2026-08-29',end:'2026-09-04',releaseDate:'2026-09-05'});
  for(const old of before.painterTestSheets)assert.deepEqual(result.state.painterTestSheets.find(s=>s.id===old.id),old);
  for(const key of ['employees','payments','releases','advances','payslips','releasedPainterSlips'])assert.deepEqual(result.state[key],before[key]);
  next=S.save(W.selectWeek(result.state,'2026-09-05'),'painter',[{id:job.id,weekly:1000}],0,()=>`sept-db-${++n}`);
  result=await auth(owner,()=>save(next,result.revision));assert.equal(S.savedFor(result.state,'painter').snapshot.rows[0].remaining,7000);
 });
 await t.test('45-day receipts are server-dated, scoped, append-only, idempotent and do not change weekly amounts',async()=>{
  const before=(await db.query('select * from payroll_v2_workspaces order by business_id,branch_id')).rows;
  const sql=fs.readFileSync(path.join(ROOT,'supabase/087_payroll_retention_receipts.sql'),'utf8');await db.exec(sql);await db.exec(sql);
  assert.deepEqual((await db.query('select * from payroll_v2_workspaces order by business_id,branch_id')).rows,before);
  const today=(await db.query("select (now() at time zone 'Asia/Manila')::date::text d")).rows[0].d,release=W.addDays(today,-45);let n=0;
  let state=S.save(W.emptyWorkspace([{id:'receipt-painter',name:'Fictional Receipt Painter',position:'Painter',type:'contract',rate:0}],undefined,today),'receipt-painter',[
   {unit:'Due today',contract:1000,weekly:300,retentionStatus:'retained',unitReleasedOn:release},
   {unit:'Second due',contract:1000,weekly:500,retentionStatus:'retained',unitReleasedOn:release},
   {unit:'Unknown',contract:'',weekly:'',retentionStatus:'retained',unitReleasedOn:release},
   {unit:'Early',contract:1000,weekly:500,retentionStatus:'retained',unitReleasedOn:W.addDays(release,1)}],0,()=>`receipt-db-${++n}`);
  const existing=await auth(owner,()=>call('payroll_v2_load',[b,other]));
  let loaded=await auth(owner,()=>call('payroll_v2_save',[b,other,existing.revision,JSON.stringify(state),'[]']));
  const rows=S.savedFor(loaded.state,'receipt-painter').snapshot.rows,j=rows[0].job;
  const receive=(rev=loaded.revision,jobId=j.id,date=today,amount=700,who=owner,branch=other,releaseDate=release)=>auth(who,()=>call('payroll_v2_receive_retention',[b,branch,rev,'receipt-painter',jobId,date,amount,releaseDate]));
  await assert.rejects(receive(loaded.revision-1),/Another user/);
  await assert.rejects(receive(loaded.revision,j.id,W.addDays(today,-1)),/45-day/);
  await assert.rejects(receive(loaded.revision,j.id,W.addDays(today,1)),/today/);
  await assert.rejects(receive(loaded.revision,j.id,today,701),/changed/);
  await assert.rejects(receive(loaded.revision,rows[2].job.id,today,0),/Confirm/);
  await assert.rejects(receive(loaded.revision,rows[3].job.id,today,500,owner,other,W.addDays(release,1)),/45-day/);
  await assert.rejects(receive(loaded.revision,j.id,today,700,staff),/access/);
  const basis=S.receiptBasis(loaded.state,'receipt-painter',j.id),unchanged=structuredClone(loaded.state);
  loaded=await receive();assert.equal(loaded.state.painterRetentionReceipts.length,1);assert.deepEqual(loaded.state.painterRetentionReceipts[0].basis,basis);assert.equal(loaded.state.painterRetentionReceipts[0].recordedBy,owner);
  for(const k of Object.keys(unchanged))assert.deepEqual(loaded.state[k],unchanged[k]);assert.deepEqual(S.validate(loaded.state),[]);
  const rev=loaded.revision;assert.equal((await receive(rev-1)).revision,rev);await assert.rejects(receive(rev,j.id,today,701),/already/);
  for(const mutate of [s=>s.painterRetentionReceipts=[],s=>s.painterRetentionReceipts[0].amount=1,s=>{const rw=s.painterTestSheets[0].snapshot.rows[0];rw.job.contract+=10;rw.opening+=10;rw.remaining+=10}]){
   const bad=structuredClone(loaded.state);mutate(bad);await assert.rejects(auth(owner,()=>call('payroll_v2_save',[b,other,rev,JSON.stringify(bad),'[]'])),/receipt|locked|basis/);
  }
  let carried=S.save(W.selectWeek(loaded.state,W.addDays(state.period.start,7)),'receipt-painter',[],0,()=>`receipt-db-${++n}`);
  loaded=await auth(owner,()=>call('payroll_v2_save',[b,other,rev,JSON.stringify(carried),'[]']));assert.equal(S.savedFor(loaded.state,'receipt-painter').snapshot.net,0);assert.deepEqual(S.validate(loaded.state),[]);
  carried=A.release(loaded.state,S.savedFor(loaded.state,'receipt-painter').id,'receipt-pdf',loaded.state.period.releaseDate);
  loaded=await auth(owner,()=>call('payroll_v2_save',[b,other,loaded.revision,JSON.stringify(carried),JSON.stringify([{id:'receipt-pdf',kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0xLjQ='}])]));assert.equal(loaded.state.releasedPainterSlips[0].snapshot.retentionReceipts.length,1);
  assert.equal(loaded.state.releasedPainterSlips[0].retentionPreviousPayday,state.period.releaseDate);
  await db.query("update business_memberships set status='active' where user_id=$1",[staff]);await db.query('insert into business_member_branch_access values($1,$2,$3)',[b,staff,other]);
  await auth(owner,()=>call('payroll_v2_grant',[b,other,staff,'view']));await assert.rejects(receive(loaded.revision,rows[1].job.id,today,500,staff),/edit access/);
  await auth(owner,()=>call('payroll_v2_grant',[b,other,staff,'edit']));loaded=await receive(loaded.revision,rows[1].job.id,today,500,staff);assert.equal(loaded.state.painterRetentionReceipts.length,2);
  assert.equal((await db.query("select count(*)::int n from payroll_v2_events where action='retention_received'")).rows[0].n,2);
  assert.equal((await db.query("select has_function_privilege('authenticated','payroll_v2_check_retention_receipts(jsonb,jsonb,boolean)','execute') allowed")).rows[0].allowed,false);
  await db.exec('set role anon');try{await assert.rejects(call('payroll_v2_receive_retention',[b,other,loaded.revision,'receipt-painter',j.id,today,700,release]),/permission denied/)}finally{await db.exec('reset role')}
 });
 await t.test('cross-date guard is idempotent, preserves live records, validates caps and backdated balances',async()=>{
  const before=(await db.query('select * from payroll_v2_workspaces order by business_id,branch_id')).rows;
  const sql=fs.readFileSync(path.join(ROOT,'supabase/088_payroll_cross_date_safeguards.sql'),'utf8');await db.exec(sql);await db.exec(sql);
  assert.deepEqual((await db.query('select * from payroll_v2_workspaces order by business_id,branch_id')).rows,before);
  const branch='10000000-0000-4000-8000-000000000088';await db.query('insert into branches values($1,$2,$3,true)',[branch,b,'CROSS DATE TEST']);
  let n=0;const uid=()=>`cross-db-${++n}`,persist=(state,rev,files=[])=>auth(owner,()=>call('payroll_v2_save',[b,branch,rev,JSON.stringify(state),JSON.stringify(files)]));
  let loaded=await auth(owner,()=>call('payroll_v2_load',[b,branch]));
  let state=S.save(W.selectWeek(seed(),'2026-11-25'),'painter',[{unit:'Test Honda',invoice:'QA-1',plate:'QA 245',contract:10000,weekly:5000}],0,uid);
  loaded=await persist(state,loaded.revision);const id=S.savedFor(state,'painter').snapshot.rows[0].job.id;
  state=S.save(W.selectWeek(state,'2026-11-10'),'painter',[{linkJobId:id,weekly:3000}],0,uid);
  const forged=structuredClone(state),oldRow=forged.painterTestSheets.find(s=>s.period.start==='2026-11-21').snapshot.rows[0];oldRow.opening=10000;oldRow.remaining=5000;
  await assert.rejects(persist(forged,loaded.revision),/other dates/);
  const over=structuredClone(state),past=over.painterTestSheets.find(s=>s.period.start==='2026-11-07'),future=over.painterTestSheets.find(s=>s.period.start==='2026-11-21');
  past.snapshot.rows[0].weekly=6000;past.snapshot.rows[0].remaining=4000;past.snapshot.basic=6000;past.snapshot.net=6000;future.snapshot.rows[0].opening=4000;future.snapshot.rows[0].remaining=-1000;
  await assert.rejects(persist(over,loaded.revision),/exceed agreed labor/);
  loaded=await persist(state,loaded.revision);assert.equal(loaded.state.painterTestSheets.find(s=>s.period.start==='2026-11-21').snapshot.rows[0].remaining,2000);
  await assert.rejects(persist(state,loaded.revision-1),/Another user/);
  // Direct callers cannot hide a known contract or duplicate an exact invoice/plate.
  const duplicate=structuredClone(state),dupe=duplicate.painterTestSheets.find(s=>s.period.start==='2026-11-07');dupe.snapshot.rows[0].job.id='duplicate-id';dupe.snapshot.jobs=dupe.snapshot.rows.map(r=>r.job);
  await assert.rejects(persist(duplicate,loaded.revision),/other dates|existing job/);
  // Pending zero-settlement markers may safely move earlier; received/released copies may not.
  state=S.save(W.selectWeek(loaded.state,'2026-11-25'),'painter',[{unit:'Pending anchor',contract:'',weekly:100}],0,uid);loaded=await persist(state,loaded.revision);
  const pendingId=S.savedFor(state,'painter').snapshot.rows.find(r=>r.job.unit==='Pending anchor').job.id;
  state=S.save(W.selectWeek(state,'2026-09-05'),'painter',[{linkJobId:pendingId,weekly:200}],0,uid);loaded=await persist(state,loaded.revision);
  assert.deepEqual(S.validate(loaded.state),[]);assert.equal(loaded.state.painterTestSheets.find(s=>s.period.start==='2026-11-21').snapshot.rows.find(r=>r.job.id===pendingId).previousRecorded,200);
  state=W.selectWeek(loaded.state,'2026-11-25');const source=S.savedFor(state,'painter');state=A.release(state,source.id,'cross-released','2026-11-28');
  loaded=await persist(state,loaded.revision,[{id:'cross-released',kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0xLjQ='}]);
  const bad=structuredClone(loaded.state),earlier=bad.painterTestSheets.find(s=>s.period.start==='2026-11-07');earlier.snapshot.rows[0].weekly=2000;earlier.snapshot.rows[0].remaining=8000;earlier.snapshot.basic=2000;earlier.snapshot.net=2000;
  await assert.rejects(persist(bad,loaded.revision),/other dates|released payslip|locked/);
  assert.equal((await db.query("select has_function_privilege('authenticated','payroll_v2_check_cross_date(jsonb,jsonb)','execute') allowed")).rows[0].allowed,false);
 });
 await t.test('job items persist online, validate totals, preserve older records, and cannot be stripped by old clients',async()=>{
  const before=(await db.query('select * from payroll_v2_workspaces order by business_id,branch_id')).rows;
  const sql=fs.readFileSync(path.join(ROOT,'supabase/089_payroll_job_items.sql'),'utf8');await db.exec(sql);await db.exec(sql);
  assert.deepEqual((await db.query('select * from payroll_v2_workspaces order by business_id,branch_id')).rows,before);
  const branch='10000000-0000-4000-8000-000000000089';await db.query('insert into branches values($1,$2,$3,true)',[branch,b,'ITEMIZED TEST']);
  let n=0;const uid=()=>`items-db-${++n}`,persist=(state,rev,files=[])=>auth(owner,()=>call('payroll_v2_save',[b,branch,rev,JSON.stringify(state),JSON.stringify(files)]));
  let loaded=await auth(owner,()=>call('payroll_v2_load',[b,branch]));
  let state=S.save(W.selectWeek(seed(),'2026-11-21'),'painter',[{unit:'Fictional itemized unit',contract:10000,workItems:[{description:'Repair bumper',amount:1125},{description:'Paint cover',amount:700},{description:'Paint tailgate',amount:1000},{description:'Repair compartment',amount:1800}]}],200,uid);
  loaded=await persist(state,loaded.revision);assert.deepEqual(S.validate(loaded.state),[]);assert.equal(S.savedFor(loaded.state,'painter').snapshot.net,4425);
  for(const edit of [r=>r.workItems[0].amount=1,r=>r.workItems[0].amount=-1,r=>r.workItems[0].amount='1125',r=>r.workItems[0].description='',r=>r.workItems[0].description='Changed',r=>delete r.workItems,r=>r.workItems=null,r=>r.workItems[0].extra='bad']){
   const bad=structuredClone(loaded.state);edit(bad.painterTestSheets[0].snapshot.rows[0]);await assert.rejects(persist(bad,loaded.revision),/job|amount|numeric|description|itemized/);
  }
  state=S.save(W.selectWeek(loaded.state,'2026-11-28'),'painter',[],0,uid);loaded=await persist(state,loaded.revision);
  const current=S.savedFor(loaded.state,'painter');assert.equal(current.snapshot.rows[0].workItems.length,4);assert.equal(current.snapshot.basic,0);assert.deepEqual(S.validate(loaded.state),[]);
  const id=current.snapshot.rows[0].job.id;state=S.save(loaded.state,'painter',[{id,workItems:[{description:'Next stage',amount:1000}]}],0,uid);loaded=await persist(state,loaded.revision);assert.equal(S.savedFor(loaded.state,'painter').snapshot.rows[0].remaining,4375);
  state=A.release(loaded.state,S.savedFor(loaded.state,'painter').id,'itemized-released','2026-12-05');loaded=await persist(state,loaded.revision,[{id:'itemized-released',kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0xLjQ='}]);
  const changed=structuredClone(loaded.state),rw=changed.painterTestSheets.at(-1).snapshot.rows[0];rw.workItems[0].description='Cannot rewrite released job';rw.job.work=rw.workItems[0].description;changed.painterTestSheets.at(-1).snapshot.jobs=changed.painterTestSheets.at(-1).snapshot.rows.map(r=>r.job);
  await assert.rejects(persist(changed,loaded.revision),/Released|released|locked/);
  assert.equal((await db.query("select has_function_privilege('authenticated','payroll_v2_check_job_items(jsonb,jsonb)','execute') allowed")).rows[0].allowed,false);
 });
 await t.test('dated contract changes enforce permissions, audit, immutable payments and cross-date caps online',async()=>{
  const K=require('../payroll-v2/contract-ledger.js'),sql=fs.readFileSync(path.join(ROOT,'supabase/093_payroll_contract_changes.sql'),'utf8');
  const before=(await db.query('select * from payroll_v2_workspaces order by branch_id')).rows;
  await db.exec(sql);await db.exec(sql);assert.deepEqual((await db.query('select * from payroll_v2_workspaces order by branch_id')).rows,before);
  const branch='10000000-0000-4000-8000-000000000093';await db.query('insert into branches values($1,$2,$3,true)',[branch,b,'CONTRACT TEST']);
  let n=0;const uid=()=>`contract-db-${++n}`,persist=(state,rev,actor=owner,files=[])=>auth(actor,()=>call('payroll_v2_save',[b,branch,rev,JSON.stringify(state),JSON.stringify(files)]));
  let loaded=await auth(owner,()=>call('payroll_v2_load',[b,branch]));
  let state=S.save(W.selectWeek(seed(),'2026-09-12'),'painter',[{unit:'Fictional contract unit',invoice:'TEST-093',plate:'TEST 093',contract:10000,workItems:[{description:'Bumper',amount:5000}]}],0,uid);
  loaded=await persist(state,loaded.revision);const id=S.savedFor(loaded.state,'painter').snapshot.rows[0].job.id;
  const change=(s,kind,amount,date='2026-09-21')=>K.createEvent(s,'painter',id,{kind,amount,effectiveOn:date,description:'Added work',reason:'Approved by owner'},uid);
  const add=change(loaded.state,'addition',2000),proposed=K.apply(loaded.state,add);
  assert.deepEqual(await call('payroll_v2_apply_contract_event',[JSON.stringify(loaded.state),JSON.stringify(add)]),proposed);
  loaded=await persist(proposed,loaded.revision);assert.equal(K.current(loaded.state,'painter',id),12000);
  assert.equal((await db.query("select actor_id from payroll_v2_events where action='contract_change' and branch_id=$1",[branch])).rows[0].actor_id,owner);
  for(const mutate of [s=>delete s.painterContractEvents,s=>s.painterContractEvents[0].amount=3]){const bad=structuredClone(loaded.state);mutate(bad);await assert.rejects(persist(bad,loaded.revision),/permanent|history/)}
  state=S.save(W.selectWeek(loaded.state,'2026-09-26'),'painter',[{id,workItems:[{description:'Next portion',amount:1000}]}],0,uid);loaded=await persist(state,loaded.revision);
  const correction=change(loaded.state,'correction',11000),corrected=K.apply(loaded.state,correction);
  assert.deepEqual(await call('payroll_v2_apply_contract_event',[JSON.stringify(loaded.state),JSON.stringify(correction)]),corrected);
  const mixed=structuredClone(corrected);mixed.rules.workDays=4;await assert.rejects(persist(mixed,loaded.revision),/separately/);
  await assert.rejects(call('payroll_v2_check_contract_events',[JSON.stringify(loaded.state),JSON.stringify(corrected),'edit']),/Only the owner/);
  loaded=await persist(corrected,loaded.revision);assert.deepEqual(S.validate(loaded.state),[]);
  const bad=structuredClone(loaded.state),rw=bad.painterTestSheets.at(-1).snapshot.rows[0];rw.job.contract=12000;rw.opening=7000;rw.remaining=6000;bad.painterTestSheets.at(-1).snapshot.jobs=bad.painterTestSheets.at(-1).snapshot.rows.map(r=>r.job);
  await assert.rejects(persist(bad,loaded.revision),/Agreed labor/);
  const earlier=W.selectWeek(loaded.state,'2026-09-05');assert.throws(()=>S.save(earlier,'painter',[{linkJobId:id,workItems:[{description:'Earlier portion',amount:5500}]}],0,uid),/effective|exceed/);
  state=S.save(earlier,'painter',[{linkJobId:id,workItems:[{description:'Earlier portion',amount:4000}]}],0,uid);loaded=await persist(state,loaded.revision);assert.deepEqual(S.validate(loaded.state),[]);
  state=S.save(W.selectWeek(loaded.state,'2026-09-26'),'painter',[{id,retentionStatus:'retained',unitReleasedOn:'2026-09-27'}],0,uid);loaded=await persist(state,loaded.revision);
  state=S.save(W.selectWeek(loaded.state,'2026-10-03'),'painter',[{unit:'Fictional new visit',invoice:'TEST-093',plate:'TEST 093',contract:1000,weekly:100,transactionRef:'NEW-VISIT-2',separateJobReason:'New work after previous unit release'}],0,uid);loaded=await persist(state,loaded.revision);
  assert.deepEqual(S.validate(loaded.state),[]);
  assert.equal((await db.query("select has_function_privilege('authenticated','payroll_v2_apply_contract_event(jsonb,jsonb)','execute') allowed")).rows[0].allowed,false);
 });
 await t.test('agreement rollout and atomic retained-payday PDFs are protected on the server',async()=>{
  const K=require('../payroll-v2/contract-ledger.js'),R=require('../payroll-v2/retained-payday.js');
  const before=(await db.query('select * from payroll_v2_workspaces order by branch_id')).rows;
  for(const name of ['095_payroll_agreed_job_prices.sql','096_payroll_retained_payday.sql']){const sql=fs.readFileSync(path.join(ROOT,'supabase',name),'utf8');await db.exec(sql);await db.exec(sql)}
  assert.deepEqual((await db.query('select * from payroll_v2_workspaces order by branch_id')).rows,before);
  const branch='10000000-0000-4000-8000-000000000096';await db.query('insert into branches values($1,$2,$3,true)',[branch,b,'ROLLOUT TEST']);
  await db.query('insert into payroll_v2_rollouts(business_id,branch_id,employee_id,first_week) values($1,$2,$3,$4)',[b,branch,'painter','2026-09-12']);
  let serial=0;const uid=()=>`rollout-${++serial}`,files=s=>(s.retainedPaydayCopies||[]).concat(s.releasedPainterSlips||[]).map(x=>({id:x.id,kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0xLjQ='}));
  const persist=(state,rev,pdfs=[])=>auth(owner,()=>call('payroll_v2_save',[b,branch,rev,JSON.stringify(state),JSON.stringify(pdfs)]));
  let state=S.save(W.selectWeek(seed(),'2026-09-12'),'painter',[{unit:'Fictional rollout unit',invoice:'TEST-096',plate:'TEST 096',agreementMode:true,agreedWorkItems:[{description:'Repair',amount:8000},{description:'Polish',amount:2000}],weekly:5000}],0,uid);
  let loaded=await persist(state,0);assert.equal(loaded.payrollWorkflowVersion,2);const id=S.savedFor(loaded.state,'painter').snapshot.rows[0].job.id;
  const ev=K.createEvent(loaded.state,'painter',id,{kind:'addition',amount:2000,effectiveOn:'2026-09-14',description:'Extra bumper work',reason:'Approved new work',itemizedAgreement:true},uid);
  state=K.apply(loaded.state,ev);assert.deepEqual(await call('payroll_v2_apply_contract_event',[JSON.stringify(loaded.state),JSON.stringify(ev)]),state);loaded=await persist(state,loaded.revision);
  const changed=structuredClone(loaded.state);changed.painterTestSheets[0].snapshot.rows[0].job.agreedWorkItems[0].description='Changed';await assert.rejects(persist(changed,loaded.revision),/prices|agreement|Agreed/);
  state=S.save(loaded.state,'painter',[{id,agreementMode:true,retentionStatus:'retained',unitReleasedOn:'2026-09-18'}],0,uid);loaded=await persist(state,loaded.revision);
  state=S.save(W.selectWeek(loaded.state,'2026-11-21'),'painter',[],0,uid);loaded=await persist(state,loaded.revision);
  const args={employeeId:'painter',jobId:id,date:'2026-11-26',expectedAmount:7000,expectedReleaseDate:'2026-09-18',expectedPeriod:R.target(loaded.state,'painter','2026-11-26').period,acknowledge:true,recordedBy:owner};
  state=R.receive(loaded.state,args,uid);await assert.rejects(persist(state,loaded.revision),/PDF/);
  assert.equal((await auth(owner,()=>call('payroll_v2_load',[b,branch]))).revision,loaded.revision);
  const forged=structuredClone(state);forged.painterRetentionReceipts[0].recordedBy=staff;await assert.rejects(persist(forged,loaded.revision,files(forged)),/account|confirmation/);
  loaded=await persist(state,loaded.revision,files(state));assert.equal(loaded.state.retainedPaydayCopies[0].snapshot.paydayTotal,7000);
  // Real JSONB round-trip: unchanged versions need neither a new ID nor PDF.
  const stable=R.prepareSave(loaded.state,loaded.state,()=>assert.fail('Unchanged payday must reuse the stored PDF'));
  assert.deepEqual(stable,loaded.state);loaded=await persist(stable,loaded.revision);
  await assert.rejects(auth(owner,()=>call('payroll_v2_receive_retention',[b,branch,loaded.revision,'painter',id,'2026-11-26',7000,'2026-09-18'])),/updated payroll/);
  const old=structuredClone(loaded.state.retainedPaydayCopies[0]);
  state=S.save(loaded.state,'painter',[{unit:'New work',agreementMode:true,agreedWorkItems:[{description:'New job',amount:1000}],weekly:500}],0,uid);
  state=R.prepareSave(state,loaded.state,uid);await assert.rejects(persist(state,loaded.revision),/PDF/);
  loaded=await persist(state,loaded.revision,files(state));assert.deepEqual(loaded.state.retainedPaydayCopies[0],old);assert.equal(loaded.state.retainedPaydayCopies[1].snapshot.paydayTotal,7500);
  state=A.release(loaded.state,S.savedFor(loaded.state,'painter').id,uid(),'2026-11-26');state=R.prepareSave(state,loaded.state,uid);loaded=await persist(state,loaded.revision,files(state));
  assert.equal(loaded.state.retainedPaydayCopies.at(-1).weeklyReleased,true);
  const bad=structuredClone(loaded.state);bad.retainedPaydayCopies[0].snapshot.net=2;await assert.rejects(persist(bad,loaded.revision),/read-only/);
  for(const name of ['payroll_v2_check_payday(jsonb,jsonb,uuid,uuid)','payroll_v2_check_agreements(jsonb,jsonb)'])assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') allowed",[name])).rows[0].allowed,false);
  assert.deepEqual((await db.query('select * from payroll_v2_workspaces where branch_id<>$1 order by branch_id',[branch])).rows,before);
 });
 await t.test('agreement performance migration preserves validation, records, permissions and is idempotent',async()=>{
  const sql=fs.readFileSync(path.join(ROOT,'supabase/099_payroll_agreement_validation_performance.sql'),'utf8');
  const s=(await db.query('select state from payroll_v2_workspaces where branch_id=$1',['10000000-0000-4000-8000-000000000096'])).rows[0].state;
  const cases=[['unchanged',s,s],['empty prior',seed(),s]],changed=fn=>{const n=structuredClone(s);fn(n);return n};
  for(const amount of [0,-1,1000000000,1.001,'100',null])cases.push(['invalid agreed price '+amount,s,changed(n=>{n.painterTestSheets[0].snapshot.rows[0].job.agreedWorkItems[0].amount=amount})]);
  for(const description of ['', ' space ', null, 100, 'x'.repeat(1001)])cases.push(['invalid description',s,changed(n=>{n.painterTestSheets[0].snapshot.rows[0].job.agreedWorkItems[0].description=description})]);
  for(const mode of [false,'true',null])cases.push(['invalid weekly mode',s,changed(n=>{n.painterTestSheets[0].snapshot.rows[0].weeklyManual=mode})]);
  cases.push(['missing agreement',s,changed(n=>{delete n.painterTestSheets[0].snapshot.rows[0].job.agreedWorkItems})]);
  cases.push(['setup marker',s,changed(n=>{n.painterTestSheets[0].snapshot.rows[0].job.pricingSetup=true})]);
  cases.push(['changed item order',s,changed(n=>{n.painterTestSheets[0].snapshot.rows[0].job.agreedWorkItems.reverse()})]);
  cases.push(['forged effective items',s,changed(n=>{n.painterTestSheets[0].snapshot.rows[0].agreementItems[0].amount++})]);
  cases.push(['duplicate older worksheet',s,changed(n=>{const older=structuredClone(n.painterTestSheets[0]);older.id='older-invalid';older.snapshot.rows[0].job.agreedWorkItems[0].amount++;n.painterTestSheets.unshift(older)})]);
  // Identical job IDs in different employees must never collide in the cache.
  const split=changed(n=>{const sheet=structuredClone(n.painterTestSheets[0]);sheet.employeeId='another:employee';n.painterTestSheets.push(sheet)});cases.push(['employee-scoped keys',{},split]);
  const outcome=async([label,old,next])=>{try{await call('payroll_v2_check_agreements',[JSON.stringify(old),JSON.stringify(next)]);return {label,accepted:true}}catch(error){return {label,accepted:false,message:error.message}}};
  const expected=[];for(const c of cases)expected.push(await outcome(c));
  assert.ok(expected.some(x=>x.accepted));assert.ok(expected.some(x=>!x.accepted));
  const tables=['payroll_v2_workspaces','payroll_v2_files','payroll_v2_directory','payroll_v2_access','payroll_v2_events','payroll_v2_rollouts','payroll_workers','profiles'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query('select * from '+table)).rows])));
  const before=await snapshot(),originalDefinition=(await db.query("select pg_get_functiondef('payroll_v2_check_agreements(jsonb,jsonb)'::regprocedure) d")).rows[0].d;
  await db.exec(sql);assert.deepEqual(await snapshot(),before);
  const actual=[];for(const c of cases)actual.push(await outcome(c));assert.deepEqual(actual,expected);
  const definition=(await db.query("select pg_get_functiondef('payroll_v2_check_agreements(jsonb,jsonb)'::regprocedure) d")).rows[0].d;
  assert.match(definition,/099: one ledger scan/);assert.doesNotMatch(definition,/if exists\(select 1 from payroll_v2_ledger_rows\(new_state\) x where x.employee=sh/);
  await db.exec(sql);assert.equal((await db.query("select pg_get_functiondef('payroll_v2_check_agreements(jsonb,jsonb)'::regprocedure) d")).rows[0].d,definition);assert.deepEqual(await snapshot(),before);
  const rollback=fs.readFileSync(path.join(ROOT,'supabase/repairs/rollback_099_payroll_agreement_validation_performance.sql'),'utf8');
  await db.exec(rollback);await db.exec(rollback);
  assert.equal((await db.query("select pg_get_functiondef('payroll_v2_check_agreements(jsonb,jsonb)'::regprocedure) d")).rows[0].d,originalDefinition);
  assert.deepEqual(await snapshot(),before);
  // Production was installed through Windows SQL Editor and has CRLF bodies.
  // Preserve those bytes too, including on a manual rollback and repeat install.
  await db.exec(originalDefinition.replace(/\r?\n/g,'\r\n'));
  const windowsDefinition=(await db.query("select pg_get_functiondef('payroll_v2_check_agreements(jsonb,jsonb)'::regprocedure) d")).rows[0].d;
  assert.match(windowsDefinition,/begin\r\n for sh in/);
  await db.exec(sql);await db.exec(sql);
  const windowsActual=[];for(const c of cases)windowsActual.push(await outcome(c));assert.deepEqual(windowsActual,expected);
  await db.exec(rollback);await db.exec(rollback);
  assert.equal((await db.query("select pg_get_functiondef('payroll_v2_check_agreements(jsonb,jsonb)'::regprocedure) d")).rows[0].d,windowsDefinition);
  assert.deepEqual(await snapshot(),before);
  await db.exec(originalDefinition);
  await db.exec(sql);assert.equal((await db.query("select pg_get_functiondef('payroll_v2_check_agreements(jsonb,jsonb)'::regprocedure) d")).rows[0].d,definition);
  assert.equal((await db.query("select has_function_privilege('authenticated','payroll_v2_check_agreements(jsonb,jsonb)','execute') allowed")).rows[0].allowed,false);
 });
 await t.test('scoped restart archives data and preserves all unrelated payroll and private files',async()=>{
  const sql=fs.readFileSync(path.join(ROOT,'supabase/097_payroll_scoped_restart.sql'),'utf8'),before=(await db.query('select * from payroll_v2_workspaces order by branch_id')).rows;
  await db.exec(sql);await db.exec(sql);assert.deepEqual((await db.query('select * from payroll_v2_workspaces order by branch_id')).rows,before);
  const branch='10000000-0000-4000-8000-000000000096';
  const old=(await db.query('select *,md5(state::text) hash from payroll_v2_workspaces where branch_id=$1',[branch])).rows[0],privateFiles=(await db.query('select * from payroll_v2_files order by file_id')).rows;
  const args=[b,branch,'painter','Fictional Painter',old.revision,old.hash,'2026-09-12','Owner-approved fictional test restart'];
  await assert.rejects(auth(owner,()=>call('payroll_v2_restart_employee',args)),/permission denied/);
  await assert.rejects(call('payroll_v2_restart_employee',[...args.slice(0,4),0,...args.slice(5)]),/changed/);
  const reset=await call('payroll_v2_restart_employee',args),loaded=await auth(owner,()=>call('payroll_v2_load',[b,branch]));
  assert.equal(loaded.state.painterTestSheets.length,0);assert.equal(loaded.state.releasedPainterSlips.length,0);assert.equal(loaded.state.retainedPaydayCopies.length,0);
  assert.deepEqual(loaded.state.employees,old.state.employees);assert.deepEqual(loaded.state.attendance,old.state.attendance);assert.deepEqual(loaded.state.payrollPaydays,old.state.payrollPaydays);
  assert.deepEqual((await db.query('select * from payroll_v2_files order by file_id')).rows,privateFiles);
  assert.deepEqual(loaded.state.period,{start:'2026-09-12',end:'2026-09-18',releaseDate:'2026-09-19'});
  const legacy=structuredClone(old.state);legacy.payrollFreshStarts=loaded.state.payrollFreshStarts;legacy.employeePayrollPaydays=loaded.state.employeePayrollPaydays;
  await assert.rejects(auth(owner,()=>call('payroll_v2_save',[b,branch,loaded.revision,JSON.stringify(legacy),'[]'])),/archived|separately|permanent|one retained|old payroll|Save the unit first/);
  await assert.rejects(call('payroll_v2_check_restart_ids',[JSON.stringify(legacy),b,branch]),/archived/);
  await call('payroll_v2_restore_restart',[reset.archive_id]);
  const restored=await auth(owner,()=>call('payroll_v2_load',[b,branch]));assert.deepEqual(restored.state,old.state);assert.equal(restored.payrollWorkflowVersion,1);
  assert.deepEqual((await db.query('select * from payroll_v2_workspaces where branch_id<>$1 order by branch_id',[branch])).rows,before.filter(x=>x.branch_id!==branch));
 });
 await t.test('undo unit release saves through existing branch-scoped payroll RPC without changing payment amounts',async()=>{
  const R=require('../payroll-v2/retained-payday.js'),before=(await db.query('select * from payroll_v2_workspaces order by branch_id')).rows;
  const branchIds=['10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000102'];
  let serial=0;const uid=()=>`undo-rpc-${++serial}`;
  const amounts=s=>s.painterTestSheets.map(sh=>({id:sh.id,period:sh.period,basic:sh.snapshot.basic,net:sh.snapshot.net,cashAdvance:sh.snapshot.cashAdvance,rows:sh.snapshot.rows.map(r=>[r.job.id,r.job.contract,r.job.work,r.agreementItems,r.opening,r.weekly,r.remaining])}));
  for(const [i,branch] of branchIds.entries()){
   await db.query('insert into branches values($1,$2,$3,true)',[branch,b,['STA. ROSA TEST','STO. TOMAS TEST'][i]]);
   await db.query('insert into payroll_v2_rollouts(business_id,branch_id,employee_id,first_week) values($1,$2,$3,$4)',[b,branch,'painter','2026-09-12']);
   await db.query('insert into business_member_branch_access values($1,$2,$3)',[b,staff,branch]);
   const persist=(state,rev,actor=owner,files=[])=>auth(actor,()=>call('payroll_v2_save',[b,branch,rev,JSON.stringify(state),JSON.stringify(files)]));
   let state=S.save(W.selectWeek(seed(),'2026-09-12'),'painter',[{unit:'Fictional mistaken release',plate:'TEST UNDO',invoice:'TEST-UNDO',agreementMode:true,agreedWorkItems:[{description:'Repair',amount:15400}],weekly:5000}],200,uid);
   const id=S.savedFor(state,'painter').snapshot.rows[0].job.id;
   state=S.save(W.selectWeek(state,'2026-09-19'),'painter',[{id,weekly:2000,retentionStatus:'retained',unitReleasedOn:'2026-09-05'}],300,uid);
   state=S.save(W.selectWeek(state,'2026-09-26'),'painter',[],0,uid);
   let loaded=await persist(state,0);const oldAmounts=amounts(loaded.state),plan=S.unitReleaseUndoPlan(loaded.state,'painter',id);
   let next=S.undoUnitRelease(loaded.state,'painter',id,plan);next=R.prepareSave(next,loaded.state,uid);
   await auth(owner,()=>call('payroll_v2_grant',[b,branch,staff,'view']));await assert.rejects(persist(next,loaded.revision,staff),/cannot save/);
   await auth(owner,()=>call('payroll_v2_grant',[b,branch,staff,'edit']));
   const editor=await auth(staff,()=>call('payroll_v2_load',[b,branch]));next=S.undoUnitRelease(editor.state,'painter',id,S.unitReleaseUndoPlan(editor.state,'painter',id));next=R.prepareSave(next,editor.state,uid);
   const oldRevision=loaded.revision;loaded=await persist(next,loaded.revision,staff);
   assert.equal(loaded.state.period.start,'2026-09-19');assert.deepEqual(amounts(loaded.state),oldAmounts);assert.deepEqual(loaded.state.releasedPainterSlips,[]);assert.deepEqual(loaded.state.painterRetentionReceipts||[],[]);
   assert.equal(S.activeRows(S.view(W.selectWeek(loaded.state,'2026-09-26'),'painter').snapshot).some(r=>r.job.id===id),true);
   await assert.rejects(persist(next,oldRevision,staff),/Another user/);
   // Server-level source immutability still rejects a forged UI bypass.
   state=S.save(W.selectWeek(loaded.state,'2026-09-26'),'painter',[{id,retentionStatus:'retained',unitReleasedOn:'2026-09-26'}],0,uid);loaded=await persist(state,loaded.revision,staff);
   state=A.release(loaded.state,S.savedFor(loaded.state,'painter').id,uid(),'2026-10-03');const slip=state.releasedPainterSlips.at(-1);
   loaded=await persist(state,loaded.revision,owner,[{id:slip.id,kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0xLjQ='}]);
   const forged=structuredClone(loaded.state),sheet=S.savedFor(forged,'painter'),job=sheet.snapshot.rows[0].job;
   job.retentionStatus='ongoing';job.unitReleasedOn='';delete job.releasePayrollStart;sheet.snapshot.jobs=sheet.snapshot.rows.map(r=>r.job);
   await assert.rejects(persist(forged,loaded.revision,staff),/read-only|released|locked/i);
  }
  assert.deepEqual((await db.query('select * from payroll_v2_workspaces where not(branch_id=any($1::uuid[])) order by branch_id',[branchIds])).rows,before);
 });
 await t.test('record-first migration preserves data and permissions; both branches save receipts and releases without PDFs',async()=>{
  const R=require('../payroll-v2/retained-payday.js'),sql=fs.readFileSync(path.join(ROOT,'supabase/100_payroll_save_records_print_on_demand.sql'),'utf8'),rollback=fs.readFileSync(path.join(ROOT,'supabase/repairs/rollback_100_payroll_record_documents.sql'),'utf8');
  // Earlier legacy-import cases directly inserted synthetic archive sources.
  // Complete their fake PDFs only in this in-memory DB before rollback testing.
  await db.query("insert into payroll_v2_files(business_id,branch_id,file_id,kind,data_url,created_by) select w.business_id,w.branch_id,x.id,'pdf','data:application/pdf;base64,JVBERi0xLjQ=',$1 from payroll_v2_workspaces w cross join lateral (select e->>'id' id from jsonb_array_elements(coalesce(w.state->'releasedPainterSlips','[]')||coalesce(w.state->'retainedPaydayCopies','[]')) e union all select e->>'slipId' from jsonb_array_elements(coalesce(w.state->'slipReleases','[]')) e) x on conflict do nothing",[owner]);
  const tables=['payroll_v2_workspaces','payroll_v2_files','payroll_v2_events','payroll_v2_directory','payroll_v2_access','profiles','payroll_workers','pms_service_records'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query('select * from '+table)).rows]))),before=await snapshot();
  const defs=async()=> (await db.query("select proname,pg_get_functiondef(oid) definition,proacl from pg_proc where oid in ('payroll_v2_save(uuid,uuid,bigint,jsonb,jsonb)'::regprocedure,'payroll_v2_load(uuid,uuid)'::regprocedure) order by proname")).rows;
  const original=await defs();await db.exec(sql);await db.exec(sql);const installed=await defs();assert.deepEqual(await snapshot(),before);
  assert.deepEqual(installed.map(x=>x.proacl),original.map(x=>x.proacl));assert.match(installed[0].definition,/payrollDocumentMode/);
  await db.exec(rollback);await db.exec(rollback);assert.deepEqual(await defs(),original);assert.deepEqual(await snapshot(),before);
  // CRLF function bodies from the Windows SQL editor must also install/restore.
  for(const f of original)await db.exec(f.definition.replace(/\r?\n/g,'\r\n'));const windowsOriginal=await defs();
  await db.exec(sql);await db.exec(rollback);assert.deepEqual(await defs(),windowsOriginal);
  for(const f of original)await db.exec(f.definition);await db.exec(sql);
  assert.equal((await auth(owner,()=>call('payroll_v2_load',[b,r]))).payrollDocumentMode,'record');
  let serial=0;const uid=()=>`record-only-${++serial}`,branches=['10000000-0000-4000-8000-000000000103','10000000-0000-4000-8000-000000000104'];
  for(const [i,branch] of branches.entries()){
   await db.query('insert into branches values($1,$2,$3,true)',[branch,b,['STA. ROSA RECORD TEST','STO. TOMAS RECORD TEST'][i]]);
   await db.query('insert into payroll_v2_rollouts(business_id,branch_id,employee_id,first_week) values($1,$2,$3,$4)',[b,branch,'painter','2026-09-12']);
   await db.query('insert into business_member_branch_access values($1,$2,$3)',[b,staff,branch]);
   const persist=(s,revision,actor=owner,files=[])=>auth(actor,()=>call('payroll_v2_save',[b,branch,revision,JSON.stringify(s),JSON.stringify(files)]));
   let state=S.save(W.selectWeek(seed(),'2026-09-12'),'painter',[{unit:'Fictional no-PDF unit',plate:'TEST ONLY',invoice:'TEST',agreementMode:true,agreedWorkItems:[{description:'Repair',amount:5000}],weekly:2750}],0,uid);
   let loaded=await persist(state,0),id=S.savedFor(loaded.state,'painter').snapshot.rows[0].job.id;
   state=S.save(loaded.state,'painter',[{id,retentionStatus:'retained',unitReleasedOn:'2026-09-18'}],0,uid);loaded=await persist(state,loaded.revision);
   state=S.save(W.selectWeek(loaded.state,'2026-11-07'),'painter',[],0,uid);loaded=await persist(state,loaded.revision);
   await auth(owner,()=>call('payroll_v2_grant',[b,branch,staff,'view']));await assert.rejects(persist(loaded.state,loaded.revision,staff),/cannot save/);
   await auth(owner,()=>call('payroll_v2_grant',[b,branch,staff,'edit']));loaded=await auth(staff,()=>call('payroll_v2_load',[b,branch]));
   const input={employeeId:'painter',jobId:id,date:'2026-11-09',expectedAmount:2250,expectedReleaseDate:'2026-09-18',expectedPeriod:R.target(loaded.state,'painter','2026-11-09').period,acknowledge:true,recordedBy:staff};
   state=R.receive(loaded.state,input,uid);const oldRevision=loaded.revision;loaded=await persist(state,loaded.revision,staff);
   assert.equal(loaded.state.painterRetentionReceipts.length,1);assert.equal(loaded.state.retainedPaydayCopies.length,1);
   assert.equal(loaded.state.retainedPaydayCopies[0].snapshot.paydayTotal,2250);assert.equal(loaded.state.retainedPaydayCopies[0].snapshot.retainedPaydayPayments[0].receivedOn,'2026-11-09');
   await assert.rejects(persist(state,oldRevision,staff),/Another user/);
   const forged=structuredClone(loaded.state);forged.painterRetentionReceipts[0].amount++;await assert.rejects(persist(forged,loaded.revision,staff),/read-only|receipt|amount|balance|exceed agreed labor/i);
   const duplicate=structuredClone(loaded.state);duplicate.painterRetentionReceipts.push({...duplicate.painterRetentionReceipts[0],id:uid()});await assert.rejects(persist(duplicate,loaded.revision,staff),/receipt|balance|payment|duplicate/i);
   const missingCopy=structuredClone(loaded.state);missingCopy.retainedPaydayCopies=[];await assert.rejects(persist(missingCopy,loaded.revision,staff),/read-only/);
   state=A.release(loaded.state,S.savedFor(loaded.state,'painter').id,uid(),'2026-11-14');state=R.prepareSave(state,loaded.state,uid);loaded=await persist(state,loaded.revision,staff);
   assert.equal(loaded.state.retainedPaydayCopies.at(-1).weeklyReleased,true);
   const changed=structuredClone(loaded.state);changed.retainedPaydayCopies[0].snapshot.net++;await assert.rejects(persist(changed,loaded.revision,staff),/read-only/);
   state=loaded.state;state.attendance=W.dates(state.period.start,state.period.end).map(date=>({employeeId:'daily',date,status:'present',lateMinutes:0}));
   state=W.saveReleasedPayslip(state,'daily',uid(),'2026-11-14T10:00:00Z','2026-11-28');loaded=await persist(state,loaded.revision,staff);
   const attendance=structuredClone(loaded.state);attendance.attendance[0].status='absent';await assert.rejects(persist(attendance,loaded.revision,staff),/Void the released/);
   assert.equal((await db.query('select count(*)::int n from payroll_v2_files where branch_id=$1',[branch])).rows[0].n,0);
  }
  assert.deepEqual((await db.query('select * from payroll_v2_files')).rows,before.payroll_v2_files);
  assert.deepEqual((await db.query('select * from payroll_v2_workspaces where not(branch_id=any($1::uuid[]))',[branches])).rows,before.payroll_v2_workspaces);
  await assert.rejects(db.exec(rollback),/Record-only payslips exist/);await db.exec('rollback');assert.deepEqual(await defs(),installed);
  const prior=await auth(owner,()=>call('payroll_v2_load',[b,r]));
  await assert.rejects(auth(owner,()=>save(prior.state,prior.revision,[{id:'daily-release',kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0xLjQ='}])),/cannot be overwritten/);
  for(const table of ['profiles','payroll_workers','pms_service_records'])assert.deepEqual((await db.query('select * from '+table)).rows,before[table]);
 });
 await db.close();
});
