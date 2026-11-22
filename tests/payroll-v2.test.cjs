const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),W=require('../payroll-v2/workflow.js'),S=require('../payroll-v2/simple-painter.js'),A=require('../payroll-v2/payslip-archive.js');
const b='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875',r='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',owner='10000000-0000-4000-8000-000000000003',staff='10000000-0000-4000-8000-000000000004';
const migration=fs.readFileSync(path.join(ROOT,'supabase/077_payroll_v2.sql'),'utf8');
const seed=()=>W.emptyWorkspace([{id:'painter',name:'Fictional Painter',position:'Auto painter',type:'contract',rate:0,accountNumber:'PRIVATE-TEST',photos:[]},{id:'daily',name:'Fictional Admin',position:'Admin',type:'daily',rate:550}],undefined,'2026-11-14');
test('new app has no offline payroll write path and old pause stays enabled',()=>{
 const app=fs.readFileSync(path.join(ROOT,'payroll-v2/app-v2.js'),'utf8'),online=fs.readFileSync(path.join(ROOT,'payroll-v2/online.js'),'utf8');
 assert.doesNotMatch(app,/localStorage\.(setItem|getItem)|openCleanWorkspace/);assert.match(app,/await O.save\(next\)/);assert.match(online,/expected_revision:revision/);assert.doesNotMatch(online,/from\(['"](?:expenses|invoices|payroll_workers)/);
 assert.match(fs.readFileSync(path.join(ROOT,'payroll-v2-online.js'),'utf8'),/section.id='payrollV2'/);
});
test('PDF uses half short bond, peso glyph, all unit rows and prior balance',()=>{
 const PDF=require('../payroll-v2/pdf.js');let n=0,s=S.save(seed(),'painter',[{unit:'Test unit',contract:15000,weekly:3000,work:'Panel repaint'}],500,()=>`test-${++n}`),record=S.savedFor(s,'painter');
 const def=PDF.definition(record),json=JSON.stringify(def);assert.deepEqual(def.pageSize,{width:612,height:396});assert.match(json,/₱3,000.00/);assert.match(json,/₱2,500.00/);assert.match(json,/PREV. RECORDED/);assert.match(json,/BALANCE \/ RETAINED/);assert.match(json,/Test unit/);
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
 await timers.shift()();let button=nodes.nav.children.find(n=>n.dataset.t==='payrollV2');assert.ok(button);button.click();assert.equal(nodes.payroll.inert,true);assert.ok(nodes.payrollV2.classList.contains('active'));assert.equal(nodes.payrollV2.children[0].src,'payroll-v2/index.html?v=20261123-online');assert.ok(!nodes.dashboard.classList.contains('active'));
 data['bwc-active-branch']=other;access='none';await events['bwc:branch-ready'][0]();assert.equal(button.hidden,true);assert.equal(nodes.payrollV2.children.length,0);assert.ok(nodes.dashboard.classList.contains('active'));
 access='owner';await events.focus[0]();assert.equal(button.hidden,false);button.click();assert.equal(nodes.payrollV2.children.length,1);
 data['bwc-active-business']='another-business';const previous=requests;await events.storage[0]({key:'bwc-active-business'});assert.equal(requests,previous);assert.equal(button.hidden,true);assert.equal(nodes.payrollV2.children.length,0);
});
test('online PostgreSQL permissions, immutable PDFs and safe correction',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
 const {PGlite}=require(process.env.BWC_PGLITE_PATH),db=new PGlite();
 await db.exec(`create role authenticated;create role anon;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select current_setting('test.actor')::uuid$$;
 create table businesses(id uuid primary key,status text);create table branches(id uuid primary key,business_id uuid,name text,is_active boolean);create table profiles(id uuid primary key,full_name text,email text);
 create table business_memberships(business_id uuid,user_id uuid,role text,status text);create table business_member_branch_access(business_id uuid,user_id uuid,branch_id uuid);
 create table payroll_workers(id uuid primary key default gen_random_uuid(),business_id uuid,branch_id uuid,full_name text,position text,is_active boolean);create table pms_service_records(id uuid primary key default gen_random_uuid(),business_id uuid,branch_id uuid,technician_worker_id uuid);
 create function can_view_invoice_branch(b uuid,r uuid) returns boolean language sql stable security definer as $$select exists(select 1 from business_memberships m where m.business_id=b and m.user_id=auth.uid() and m.status='active')$$;
 insert into auth.users values('${owner}'),('${staff}');insert into businesses values('${b}','active');insert into branches values('${r}','${b}','TEST BRANCH',true),('${other}','${b}','OTHER BRANCH',true);
 insert into profiles values('${owner}','Test owner','test@example.invalid'),('${staff}','Test staff','staff@example.invalid');insert into business_memberships values('${b}','${owner}','owner','active'),('${b}','${staff}','staff','active');insert into business_member_branch_access values('${b}','${staff}','${r}');
 insert into payroll_workers(business_id,branch_id,full_name,position,is_active) values('${b}','${r}','Legacy Employee','Admin',true);grant usage on schema public,auth to authenticated,anon;set test.actor='${owner}';`);
 await db.exec(migration);await db.exec(migration);
 const call=async(name,args)=>{const q=`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`;return (await db.query(q,args)).rows[0].value};
 const auth=async(id,fn)=>{await db.exec(`set test.actor='${id}';set role authenticated`);try{return await fn()}finally{await db.exec('reset role')}};
 const save=(state,rev,files=[])=>call('payroll_v2_save',[b,r,rev,JSON.stringify(state),JSON.stringify(files)]);
 const original=await db.query('select * from payroll_workers');
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
 await t.test('release must atomically save original PDF; duplicate/history mutation denied',async()=>{
  current=A.release(current,record.id,'released-1','2026-11-21');await assert.rejects(auth(owner,()=>save(current,2)),/Generate the PDF/);
  const pdf={id:'released-1',kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0xLjQK'};assert.equal((await auth(owner,()=>save(current,2,[pdf]))).revision,3);
  const bad=structuredClone(current);bad.releasedPainterSlips=[];await assert.rejects(auth(owner,()=>save(bad,3)),/read-only/);await assert.rejects(auth(staff,()=>call('payroll_v2_void',[b,r,'released-1','Correction needed'])),/owner/);
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
  await db.exec('set role anon');try{await assert.rejects(call('payroll_v2_load',[b,r]),/permission denied/)}finally{await db.exec('reset role')}
  const loaded=await auth(owner,()=>call('payroll_v2_load',[b,r]));await assert.rejects(auth(owner,()=>save(loaded.state,null)),/revision is required/);
 });
 await db.close();
});
