const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup}=require('./helpers/inventory-cost-db.cjs');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const migration=read('supabase/076_pause_15m_legacy_payroll.sql');
const BUSINESS='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875';
const branches=['c87de8df-6ab3-4392-9508-612de0ec05f6','84fecf85-fdd8-4dc6-bf8c-20f007782af7'];
const tables=['payroll_workers','payroll_attendance','payroll_vehicle_jobs','payroll_job_payments',
  'payroll_obligations','payroll_obligation_payments','payroll_periods','payslips','payroll_adjustments'];

function browser(business=BUSINESS,pathname='/index.html'){
  const data={'bwc-active-business':business,'bwc-active-branch':branches[0],'15m-recovery-payroll':'{"history":"preserve"}'};
  const writes=[],events={},timers=[],styles=[];let requests=0,alerts=0,dashboardClicks=0;
  class Storage {getItem(k){return data[k]||null;}setItem(k,v){writes.push(k);data[k]=v;}removeItem(k){writes.push(k);delete data[k];}}
  const localStorage=new Storage();
  const classes=new Set();const classList={toggle(k,v){v?classes.add(k):classes.delete(k);},contains:k=>classes.has(k)};
  const section={classList:{contains:()=>false},inert:false},main={inert:false},status={textContent:''};
  function add(name,fn){(events[name]||=[]).push(fn);}
  const document={head:{appendChild:style=>styles.push(style)},documentElement:{classList},
    createElement:()=>({}),getElementById:id=>({payroll:section,status}[id]||null),
    querySelector:s=>s==='main'?main:s.includes('dashboard')?{click(){dashboardClicks++;}}:null,
    querySelectorAll:()=>[],addEventListener:add};
  const window={location:{pathname},addEventListener:add,alert(){alerts++;},supabase:{},
    BUSINESS_WEB_CENTER_SUPABASE:{url:'fixture',publishableKey:'fixture'},
    getBusinessSupabaseClient(){requests++;throw new Error('Paused payroll must not connect');}};
  const sandbox={window,document,localStorage,Storage,Event:class{},MutationObserver:class{},
    setTimeout(fn){timers.push(fn);},console};
  vm.runInNewContext(read('legacy-payroll-pause.js'),sandbox);
  return {sandbox,data,writes,events,timers,styles,classes,section,main,status,window,
    requests:()=>requests,alerts:()=>alerts,dashboardClicks:()=>dashboardClicks,
    emit(name,event={}){for(const fn of events[name]||[])fn(event);},
    event(payroll=false,clock=false){return {type:'click',prevented:false,stopped:false,
      target:{closest:s=>s.includes('#payroll')?payroll:clock},
      preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};}};
}
test('paused UI hides both sidebar formats without rewriting any saved data',()=>{
  const b=browser();assert.equal(b.window.bwcLegacyPayrollPaused(),true);
  assert.equal(b.section.inert,true);assert.equal(b.classes.has('bwc-legacy-payroll-paused'),true);
  assert.match(b.styles[0].textContent,/data-restore-tab="payroll"/);assert.match(b.styles[0].textContent,/data-t="payroll"/);
  const payroll=b.event(true);b.emit('click',payroll);assert.equal(payroll.prevented,true);assert.equal(payroll.stopped,true);
  const expense=b.event(false);b.emit('click',expense);assert.equal(expense.prevented,false);
  assert.deepEqual(b.writes,[]);assert.equal(b.data['15m-recovery-payroll'],'{"history":"preserve"}');
});
test('pause follows business switches and leaves other businesses usable',()=>{
  const b=browser('other');assert.equal(b.section.inert,false);
  const e=b.event(true);b.emit('click',e);assert.equal(e.prevented,false);
  b.data['bwc-active-business']=BUSINESS;b.emit('bwc:business-ready');assert.equal(b.section.inert,true);
  b.data['bwc-active-business']='other';b.emit('storage',{key:'bwc-active-business'});assert.equal(b.section.inert,false);
  assert.deepEqual(b.writes,[]);
});
test('the local legacy clock cannot capture or save for the paused business',()=>{
  const b=browser(BUSINESS,'/attendance.html');const e=b.event(false,true);b.emit('click',e);
  assert.equal(e.stopped,true);assert.equal(b.main.inert,true);assert.match(b.status.textContent,/old payroll is paused/);
  assert.deepEqual(b.writes,[]);
});
test('paused online payroll does not start background sync or create clock links',()=>{
  const b=browser();vm.runInNewContext(read('payroll-online.js'),b.sandbox);
  b.emit('load');b.emit('bwc:business-ready');b.emit('bwc:branch-ready');
  for(const fn of b.timers.splice(0))fn();
  assert.equal(b.requests(),0);assert.deepEqual(b.writes,[]);
});
test('early pause guard and cache versions are wired without changing shared readers',()=>{
  const index=read('index.html'),clock=read('attendance.html'),sw=read('sw.js');
  for(const html of [index,clock])assert.ok(html.indexOf('legacy-payroll-pause.js?v=20261123-pause')<html.indexOf('<body'));
  assert.match(sw,/legacy-payroll-pause\.js\?v=20261123-pause/);
  assert.match(sw,/payroll-online\.js\?v=20261123-pause/);
  assert.match(sw,/bwc-invoice-offline-v24/);
  assert.match(index,/payroll-online\.js\?v=20261123-pause/);
  assert.match(read('invoice-online.js'),/from\('payroll_workers'\)\.select/);
  assert.match(read('pms-client-history.js'),/from\('payroll_workers'\)\.select/);
  const issue=read('payroll-online.js').split('async function issuePayroll(button){')[1].split('async function approveOvertime')[0];
  assert.ok(issue.indexOf('if(slipResult.error)throw slipResult.error')<issue.indexOf("db.from('expenses')"));
});

test('payroll pause PostgreSQL suite (isolated; no live connection)',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
  const {db,ids}=await setup();
  const rows=async(q,args=[])=>(await db.query(q,args)).rows;
  const auth=async fn=>{await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}};
  const load=name=>db.exec(read('supabase/'+name));
  async function snapshot(){const out={};for(const table of [...tables,'invoices','pms_service_records','repaint_monitoring_jobs','inventory_tracker_materials','inventory_tracker_adjustments'])out[table]=await rows(`select to_jsonb(t) as data from ${table} t order by to_jsonb(t)::text`);return out;}
  async function seed(business,branch,code){
    const worker=(await rows(`insert into payroll_workers(business_id,branch_id,employee_code,full_name,position,created_by) values($1,$2,$3,'Fictional test worker','Admin',$4) returning id`,[business,branch,code,ids.user]))[0].id;
    const invoice=crypto.randomUUID();await db.query('insert into invoices values($1,$2)',[invoice,business]);
    const job=(await rows(`insert into payroll_vehicle_jobs(business_id,branch_id,worker_id,invoice_id,job_order_number,vehicle,created_by) values($1,$2,$3,$4,$5,'Fictional test car',$6) returning id`,[business,branch,worker,invoice,code,ids.user]))[0].id;
    const obligation=(await rows(`insert into payroll_obligations(business_id,branch_id,worker_id,obligation_type,original_amount,created_by) values($1,$2,$3,'cash_advance',100,$4) returning id`,[business,branch,worker,ids.user]))[0].id;
    const period=(await rows(`insert into payroll_periods(business_id,branch_id,period_start,period_end,created_by) values($1,$2,'2000-01-01','2000-01-07',$3) returning id`,[business,branch,ids.user]))[0].id;
    await db.query(`insert into payroll_attendance(business_id,branch_id,worker_id,work_date) values($1,$2,$3,'2000-01-01')`,[business,branch,worker]);
    await db.query('insert into payroll_job_payments(business_id,branch_id,job_id,amount) values($1,$2,$3,10)',[business,branch,job]);
    await db.query('insert into payroll_obligation_payments(business_id,branch_id,obligation_id,amount) values($1,$2,$3,10)',[business,branch,obligation]);
    await db.query(`insert into payslips(business_id,branch_id,payroll_period_id,worker_id,payslip_number,status,created_by) values($1,$2,$3,$4,$5,'approved',$6)`,[business,branch,period,worker,code,ids.user]);
    await db.query(`insert into payroll_adjustments(business_id,branch_id,worker_id,adjustment_type,amount,reason) values($1,$2,$3,'bonus',10,'Fictional test')`,[business,branch,worker]);
    return {business,branch,worker,invoice,job,obligation,period,code};
  }
  try{
    await db.exec(`alter table businesses add column name text, add column status text default 'active';
      alter table branches add column created_at timestamptz default now();
      insert into businesses(id,name) values('${BUSINESS}','15M Autocare Services');
      insert into branches(id,business_id) values('${branches[0]}','${BUSINESS}'),('${branches[1]}','${BUSINESS}');
      create table invoices(id uuid primary key,business_id uuid);`);
    for(const name of ['005_business_management.sql','006_payroll_foundation.sql','016_payroll_branch_records.sql','020_payroll_attendance_approval.sql','021_payroll_adjustments.sql','060_repaint_monitoring.sql'])await load(name);
    await db.exec(`insert into business_management(business_id,billing_status,admin_notes) values('${BUSINESS}','complimentary','Preserve this note'),('${ids.business}','pending','Other business');
      create table pms_service_records(id uuid primary key default gen_random_uuid(),business_id uuid,technician_worker_id uuid references payroll_workers(id) on delete set null);
      grant select,insert,update,delete on all tables in schema public to authenticated;`);
    const a=await seed(BUSINESS,branches[0],'TEST-A'),b=await seed(BUSINESS,branches[1],'TEST-B'),other=await seed(ids.business,ids.branch,'TEST-OTHER');
    const before=await snapshot();const managementBefore=await rows('select * from business_management order by business_id');
    await t.test('pause is idempotent, changes only the payroll flag, and preserves all historical rows',async()=>{
      await db.exec(migration);await db.exec(migration);assert.deepEqual(await snapshot(),before);
      const after=await rows('select * from business_management order by business_id');
      for(let i=0;i<after.length;i++){
        const expected={...managementBefore[i]};if(expected.business_id===BUSINESS){expected.enabled_features={...expected.enabled_features,payroll:false};expected.updated_at=after[i].updated_at;}
        assert.deepEqual(after[i],expected);
      }
      assert.equal((await rows("select count(*)::int n from pg_policies where policyname like 'payroll_15m_paused_%'"))[0].n,27);
      assert.equal((await rows("select to_regclass('public.branch_time_clock_links') as name"))[0].name,null);
    });
    await t.test('all nine payroll tables block new entries, edits and deletes in both 15M branches',async()=>{
      for(const table of tables)for(const branch of branches){
        const old=(await rows(`select to_jsonb(t) as data from ${table} t where business_id=$1 and branch_id=$2 limit 1`,[BUSINESS,branch]))[0].data;
        await assert.rejects(auth(()=>db.query(`insert into ${table} select (jsonb_populate_record(null::${table},$1::jsonb)).*`,[JSON.stringify({...old,id:crypto.randomUUID()})])),/row-level security/);
        assert.equal((await auth(()=>rows(`update ${table} set business_id=business_id where id=$1 returning id`,[old.id]))).length,0);
        assert.equal((await auth(()=>rows(`delete from ${table} where id=$1 returning id`,[old.id]))).length,0);
        assert.equal((await auth(()=>rows(`select id from ${table} where id=$1`,[old.id]))).length,1);
      }
      assert.deepEqual(await snapshot(),before);
    });
    await t.test('shared worker-name reads and new PMS/Repaint references still work',async()=>{
      assert.equal((await auth(()=>rows('select id,full_name,position from payroll_workers where business_id=$1 and is_active',[BUSINESS]))).length,2);
      await auth(()=>db.query('insert into pms_service_records(business_id,technician_worker_id) values($1,$2)',[BUSINESS,a.worker]));
      await auth(()=>db.query(`insert into repaint_monitoring_jobs(business_id,branch_id,source_vehicle_job_id,vehicle_model,plate_number,work_label,date_in,target_completion_date) values($1,$2,$3,'Test car','TEST','Washover','2000-01-01','2000-01-02')`,[BUSINESS,a.branch,a.job]));
      assert.equal((await rows('select * from pms_service_records')).length,1);
      assert.equal((await rows('select * from repaint_monitoring_jobs')).length,1);
    });
    await t.test('other businesses retain payroll write access',async()=>{
      for(const table of tables)assert.equal((await auth(()=>rows(`update ${table} set business_id=business_id where business_id=$1 returning id`,[ids.business]))).length,1);
      await auth(()=>db.query(`insert into payroll_attendance(business_id,branch_id,worker_id,work_date) values($1,$2,$3,'2000-01-02')`,[ids.business,other.branch,other.worker]));
      assert.equal((await auth(()=>rows("delete from payroll_attendance where business_id=$1 and work_date='2000-01-02' returning id",[ids.business]))).length,1);
    });
    await t.test('invoice deletion still performs normal shared foreign-key cleanup',async()=>{
      await auth(()=>db.query('delete from invoices where id=$1',[a.invoice]));
      assert.equal((await rows('select invoice_id from payroll_vehicle_jobs where id=$1',[a.job]))[0].invoice_id,null);
    });
    await t.test('if public clocks are installed, the pause disables only 15M links and blocks recreation',async()=>{
      await load('033_public_employee_time_clock.sql');
      await db.exec('grant select,insert,update,delete on branch_time_clock_links to authenticated');
      const token=crypto.randomUUID(),otherToken=crypto.randomUUID();
      await db.query('insert into branch_time_clock_links(business_id,branch_id,public_token) values($1,$2,$3),($4,$5,$6)',[BUSINESS,a.branch,token,ids.business,other.branch,otherToken]);
      await db.exec(migration);await db.exec(migration);
      assert.equal((await rows('select enabled from branch_time_clock_links where branch_id=$1',[a.branch]))[0].enabled,false);
      assert.equal((await rows('select enabled from branch_time_clock_links where branch_id=$1',[other.branch]))[0].enabled,true);
      await assert.rejects(auth(()=>db.query('insert into branch_time_clock_links(business_id,branch_id) values($1,$2)',[BUSINESS,b.branch])),/row-level security/);
      await auth(()=>db.query('update branch_time_clock_links set enabled=true where branch_id=$1',[a.branch]));
      await db.exec('set role anon');
      try{
        await assert.rejects(db.query('select get_public_time_clock_workers($1)',[token]),/no longer active/);
        await assert.rejects(db.query('select submit_public_time_clock_punch($1,$2,$3)',[token,a.code,'in']),/no longer active/);
        assert.equal((await rows('select * from get_public_time_clock_workers($1)',[otherToken])).length,1);
        await db.query('select submit_public_time_clock_punch($1,$2,$3)',[otherToken,other.code,'in']);
      }finally{await db.exec('reset role');}
    });
    await t.test('unknown payroll writer fails closed rather than leaving a bypass',async()=>{
      await db.exec(`create function unexpected_payroll_writer() returns void language sql security definer as $$delete from public.payroll_adjustments where false$$;`);
      await assert.rejects(db.exec(migration),/Unreviewed payroll writer/);await db.exec('rollback');
    });
  }finally{await db.close();}
});
