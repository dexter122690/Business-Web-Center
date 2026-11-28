// Isolated in-memory PostgreSQL reproduction; fictional data only, no network.
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const ROOT=path.resolve(__dirname,'../..'),{PGlite}=require(process.env.BWC_PGLITE_PATH);
const W=require('../../payroll-v2/workflow.js'),S=require('../../payroll-v2/simple-painter.js'),R=require('../../payroll-v2/retained-payday.js');
const b='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875',r='20000000-0000-4000-8000-000000000001',owner='20000000-0000-4000-8000-000000000003';
async function run(){
 const db=new PGlite();
 await db.exec(`create role authenticated;create role anon;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select '${owner}'::uuid$$;
 create table businesses(id uuid primary key,status text);create table branches(id uuid primary key,business_id uuid,name text,is_active boolean);create table profiles(id uuid primary key,full_name text,email text);
 create table business_memberships(business_id uuid,user_id uuid,role text,status text);create table business_member_branch_access(business_id uuid,user_id uuid,branch_id uuid);
 create table business_team_invites(id uuid primary key default gen_random_uuid(),business_id uuid,email text,full_name text,branch_id uuid,status text,created_at timestamptz default now());
 create table payroll_workers(id uuid primary key default gen_random_uuid(),business_id uuid,branch_id uuid,full_name text,position text,is_active boolean);create table pms_service_records(id uuid primary key default gen_random_uuid(),business_id uuid,branch_id uuid,technician_worker_id uuid);
 create function can_view_invoice_branch(b uuid,r uuid) returns boolean language sql stable security definer as $$select true$$;
 insert into auth.users values('${owner}');insert into businesses values('${b}','active');insert into branches values('${r}','${b}','SYNTHETIC BRANCH',true);
 insert into profiles values('${owner}','Synthetic owner','test@example.invalid');insert into business_memberships values('${b}','${owner}','owner','active');grant usage on schema public,auth to authenticated,anon;`);
 for(const name of fs.readdirSync(path.join(ROOT,'supabase')).filter(n=>/^(077|078|080|082|083|084|085|086|087|088|089|093|095|096|097)_.*\.sql$/.test(n)).sort())await db.exec(fs.readFileSync(path.join(ROOT,'supabase',name),'utf8'));
 await db.query('insert into payroll_v2_rollouts(business_id,branch_id,employee_id,first_week) values($1,$2,$3,$4)',[b,r,'synthetic','2026-09-12']);
 let serial=0;const uid=()=>`synthetic-${++serial}`;
 let state=S.save(W.emptyWorkspace([{id:'synthetic',name:'Synthetic painter',position:'Painter',type:'contract',rate:0}],undefined,'2026-09-12'),'synthetic',Array.from({length:30},(_,i)=>({unit:'Synthetic unit '+i,plate:'TEST '+i,invoice:'TEST-'+i,agreementMode:true,agreedWorkItems:[{description:'Synthetic repair',amount:6000},{description:'Synthetic paint',amount:4000}],weekly:1000,retentionStatus:'retained',unitReleasedOn:'2026-09-18'})),0,uid);
 for(let n=1;n<11;n++)state=S.save(W.selectWeek(state,W.addDays('2026-09-12',n*7)),'synthetic',[],0,uid);
 const ids=S.view(state,'synthetic').snapshot.rows.map(x=>x.job.id);
 const receive=(s,id,date)=>{const basis=S.receiptBasis(s,'synthetic',id);return R.receive(s,{employeeId:'synthetic',jobId:id,date,expectedAmount:basis.amount,expectedReleaseDate:basis.unitReleasedOn,expectedPeriod:R.target(s,'synthetic',date).period,acknowledge:true,recordedBy:owner},uid)};
 for(let i=0;i<14;i++)state=receive(state,ids[i],i<8?'2026-11-05':'2026-11-20');
 await db.query('insert into payroll_v2_workspaces(business_id,branch_id,state,revision) values($1,$2,$3,1)',[b,r,JSON.stringify(state)]);
 for(const slip of state.retainedPaydayCopies)await db.query('insert into payroll_v2_files(business_id,branch_id,file_id,kind,data_url,created_by) values($1,$2,$3,$4,$5,$6)',[b,r,slip.id,'pdf','data:application/pdf;base64,JVBERi0xLjQ=',owner]);
 const old=(await db.query('select state from payroll_v2_workspaces where branch_id=$1',[r])).rows[0].state,next=R.prepareSave(receive(old,ids[14],'2026-11-09'),old,uid);
 const previous=new Set(old.retainedPaydayCopies.map(x=>x.id)),files=next.retainedPaydayCopies.filter(s=>!previous.has(s.id)).map(s=>({id:s.id,kind:'pdf',dataUrl:'data:application/pdf;base64,JVBERi0x'+'A'.repeat(150000)}));
 console.log(JSON.stringify({bytes:JSON.stringify(next).length,worksheets:next.painterTestSheets.length,copies:next.retainedPaydayCopies.length,receipts:next.painterRetentionReceipts.length,newPdfs:files.length}));
 const time=async(name,args)=>{const start=performance.now();try{await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);console.log(JSON.stringify({step:name,ms:Math.round(performance.now()-start)}))}catch(error){console.log(JSON.stringify({step:name,ms:Math.round(performance.now()-start),error:error.message}));throw error}};
 const oldJson=JSON.stringify(old),newJson=JSON.stringify(next);
 const checks=[
  ['payroll_v2_validate',[newJson]],['payroll_v2_check_agreements',[oldJson,newJson]],['payroll_v2_check_contract_events',[oldJson,newJson,'owner']],['payroll_v2_check_cross_date',[oldJson,newJson]],['payroll_v2_check_job_items',[oldJson,newJson]],['payroll_v2_check_unit_release_flow',[newJson]],['payroll_v2_check_starting_balances',[oldJson,newJson]],['payroll_v2_check_payday',[oldJson,newJson,b,r]],['payroll_v2_save',[b,r,1,newJson,JSON.stringify(files)]]
 ];
 for(const [name,args] of checks)await time(name,args);
 console.log('Applying candidate optimization to isolated database only');
 await db.exec(fs.readFileSync(path.join(ROOT,'supabase/099_payroll_agreement_validation_performance.sql'),'utf8'));
 for(const [name,args] of checks.filter(([name])=>name!=='payroll_v2_save'))await time(name,args);
 // Reset the synthetic fixture only in this disposable database for a fair save comparison.
 await db.query('update payroll_v2_workspaces set state=$1,revision=1 where business_id=$2 and branch_id=$3',[oldJson,b,r]);
 await time('payroll_v2_save',[b,r,1,newJson,JSON.stringify(files)]);
 console.log('Current production baseline (100): record-only save, no PDFs');
 await db.exec(fs.readFileSync(path.join(ROOT,'supabase/100_payroll_save_records_print_on_demand.sql'),'utf8'));
 await db.query('update payroll_v2_workspaces set state=$1,revision=1 where business_id=$2 and branch_id=$3',[oldJson,b,r]);
 await time('payroll_v2_save',[b,r,1,newJson,'[]']);
 console.log('Applying batch-cache update 101 to isolated database only');
 await db.exec(fs.readFileSync(path.join(ROOT,'supabase/101_payroll_validation_batch_cache.sql'),'utf8'));
 for(const [name,args] of checks.filter(([name])=>name!=='payroll_v2_save'))await time(name,args);
 await db.query('update payroll_v2_workspaces set state=$1,revision=1 where business_id=$2 and branch_id=$3',[oldJson,b,r]);
 await time('payroll_v2_save',[b,r,1,newJson,'[]']);
 await db.close();
}
run().catch(error=>{console.error(error.message);process.exitCode=1});
