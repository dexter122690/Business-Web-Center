const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const R=require('../pms-rules.js'),Q=require('../invoice-outbox.js');
const read=n=>fs.readFileSync(require('node:path').join(__dirname,'..',n),'utf8');
test('six calendar months clamp month-end and leap days; not 180 days',()=>{
 for(const [day,next] of [['2026-11-25','2027-05-25'],['2026-08-31','2027-02-28'],['2027-08-31','2028-02-29'],['2024-02-29','2024-08-29'],['2026-03-31','2026-09-30']])assert.equal(R.sixMonths(day),next);
 for(const bad of ['','2026-02-30','2026-13-01','nonsense'])assert.equal(R.sixMonths(bad),'');
});
test('schedule uses dated full payment, not service date, writeoff or partial payment',()=>{
 const payments=[{date:'2026-11-25',amount:700},{date:'2026-09-02',amount:300}];
 assert.equal(R.schedule(1000,payments),'2027-05-25');assert.equal(R.schedule(1001,payments),'');
 assert.equal(R.schedule(1000,[{amount:1000}]),'');assert.equal(R.schedule(0,payments),'');
 assert.equal(R.schedule(1000,[{date:'2026-11-25',amount:500},{date:'2026-11-25',amount:500}]),'2027-05-25');
 assert.equal(R.schedule(1000,[{payment_date:'2026-08-31',amount:1000}]),'2027-02-28');
});
test('PMS requires both finite odometers; zero valid, technician manual and not a worker ID',()=>{
 const details={odometer_km:0,next_pms_odometer_km:5000,technician_name:'  Any technician  '};
 assert.deepEqual(R.details(details),{odometer_km:0,next_pms_odometer_km:5000,technician_name:'Any technician',technician_worker_id:null,technician_employee_id:null,notes:''});
 for(const field of ['odometer_km','next_pms_odometer_km'])for(const value of ['',null,undefined,-1,Infinity,'bad',99999999999,1.001])assert.throws(()=>R.details({...details,[field]:value}));
 assert.equal(R.hasPms([{n:'PMS / Mechanical service'}]),true);assert.equal(R.hasPms([{n:'Repainting'}]),false);
});
test('new offline PMS requests validate mileage and calculate date; recovery records remain immutable',()=>{
 const invoice={isNewInvoice:true,services:[{n:'PMS'}],parts:[],total:1000,paid:1000,paymentDate:'2026-08-31',pms:{odometer_km:'45000',next_pms_odometer_km:'50000',technician_name:'Manual name',next_pms_date:'2099-01-01'}};
 const scope={userId:'u',businessId:'b',branchId:'r'},saved=Q.request(scope,invoice,crypto);assert.equal(saved.invoice.pms.next_pms_date,'2027-02-28');assert.equal(invoice.pms.next_pms_date,'2099-01-01');
 assert.throws(()=>Q.request(scope,{...invoice,pms:{}},crypto),/odometer/);
 const old=structuredClone(saved);delete old.invoice.pms.next_pms_odometer_km;assert.equal(Q.valid(old),old); // Kept for owner recovery, never silently rewritten.
});
test('manual input, required fields, readonly schedule and atomic edit path are wired',()=>{
 const ui=read('pms-client-history.js'),adapter=read('invoice-online.js');
 assert.match(ui,/<input id="pmsTechnician" type="text"/);assert.doesNotMatch(ui,/<select id="pmsTechnician"|payroll_workers|payroll_v2_employee_options/);
 assert.match(ui,/id="pmsNextDate" type="date" readonly/);assert.match(ui,/el\(id\)\.required=active\|\|selected/);
 assert.ok(adapter.indexOf('BwcPmsForm.collect(x)')<adapter.indexOf('BwcInvoiceOffline.saveNew(x)'));assert.match(adapter,/payload.pms=x.pms/);assert.doesNotMatch(adapter,/bwcSyncPmsRecord|techField\.options/);
});

test('PMS database rules cover create/edit, installments, corrections and unchanged finances',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
 const {PGlite}=require(process.env.BWC_PGLITE_PATH),db=new PGlite();
 const b='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875',br='10000000-0000-4000-8000-000000000002',other='10000000-0000-4000-8000-000000000003',user='10000000-0000-4000-8000-000000000004';
 const sql=n=>read('supabase/'+n),q=async(s,args=[])=>(await db.query(s,args)).rows;
 const details={odometer_km:45000,next_pms_odometer_km:50000,technician_name:'Fictional typed technician',notes:'Fictional QA only'};
 const payload={client_name:'Fictional PMS client',contact_number:'TEST',client_address:'TEST',vehicle_make:'Test car',vehicle_year_model:'2026',vehicle_color:'White',plate_number:'TEST',invoice_date:'2026-09-01',assigned_admin:'Test admin',payment_method:'Cash',client_source:'Test'};
 const create=async(paid=0,pms=details,service='PMS')=>(await q('select create_invoice_from_outbox($1,$2,$3,$4,$5,$6,$7,$8) value',[b,br,crypto.randomUUID(),JSON.stringify(payload),JSON.stringify([{service_name:service,amount:1000}]),'[]',JSON.stringify({amount:paid,date:'2026-08-31'}),JSON.stringify(pms)]))[0].value.invoice_id;
 const visit=async id=>(await q('select next_pms_date::text as day from pms_service_records where invoice_id=$1',[id]))[0]?.day;
 const edit=async(id,pms,amount=1000,service='PMS')=>q('select update_invoice_with_lines($1,$2,$3,$4,$5)',[id,br,JSON.stringify({...payload,...(pms===undefined?{}:{pms})}),JSON.stringify([{service_name:service,amount}]),'[]']);
 const pay=async(id,amount,date)=>(await q('insert into invoice_payments(invoice_id,business_id,branch_id,amount,payment_date,payment_method,created_by) values($1,$2,$3,$4,$5,\'Cash\',$6) returning id',[id,b,br,amount,date,user]))[0].id;
 const financial=async()=>Object.fromEntries(await Promise.all(['invoices','invoice_services','invoice_parts','invoice_payments','cash_transactions','cash_collections','invoice_upload_receipts'].map(async table=>[table,await q('select * from '+table+' order by 1')])));
 try{
 await db.exec(`create role authenticated;create role anon;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table businesses(id uuid primary key,status text);create table branches(id uuid primary key,business_id uuid,name text,is_active boolean);
 create function can_manage_invoice_branch(b uuid,r uuid) returns boolean language sql stable as $$select auth.uid()='${user}'::uuid and b='${b}'::uuid and r='${br}'::uuid$$;
 create function set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
 insert into auth.users values('${user}');insert into businesses values('${b}','active');insert into branches values('${br}','${b}','Fictional branch',true),('${other}','${b}','Other',true);
 create table payroll_workers(id uuid primary key,business_id uuid,branch_id uuid);create table payroll_v2_directory(id uuid primary key,business_id uuid,branch_id uuid);
 grant usage on schema public,auth to authenticated,anon;set test.actor='${user}';`);
 await db.exec(sql('003_invoices.sql').split('drop trigger if exists set_invoices_updated_at')[0]+'commit;');
 await db.exec('alter table invoices add column branch_id uuid references branches(id),add column discount_amount numeric(14,2) default 0;create table invoice_balance_writeoffs(invoice_id uuid references invoices(id) on delete cascade,amount numeric(14,2));');
 for(const name of ['025_invoice_payment_history.sql','024_cash_controls.sql'])await db.exec(sql(name).split('create index if not exists')[0]+'commit;');
 await db.exec(sql('014_cash_remittances.sql').split('insert into public.cash_collections (business_id, branch_id, invoice_id, received_date, amount, received_by)\nselect')[0]+'commit;');
 await db.exec(sql('038_pms_client_history.sql').split('create index if not exists')[0]+'commit;alter table pms_service_records add column technician_employee_id uuid references payroll_v2_directory(id);');
 for(const name of ['071_update_invoice_transaction.sql','056_invoice_payment_cash_sync.sql','079_invoice_outbox.sql'])await db.exec(sql(name));
 const legacy=await create(1000,{...details,next_pms_date:'2099-01-01'}),incomplete=await create(0,{}),before=await financial();
 await db.exec(sql('090_pms_payment_schedule.sql'));
 await t.test('migration changes PMS dates only, preserves backup and does not invent missing odometers',async()=>{
  assert.deepEqual(await financial(),before);assert.equal(await visit(legacy),'2027-02-28');assert.equal(await visit(incomplete),null);
  const old=(await q('select previous_next_pms_date::text,calculated_next_pms_date::text from pms_schedule_090_backup where invoice_id=$1',[legacy]))[0];assert.equal(old.previous_next_pms_date,'2099-01-01');assert.equal(old.calculated_next_pms_date,'2027-02-28');
  assert.equal((await q('select odometer_km from pms_service_records where invoice_id=$1',[incomplete]))[0].odometer_km,null);
 });
 await t.test('new invoice rejects missing odometers atomically, accepts zero and manual name',async()=>{
  const snapshot=await financial();for(const pms of [{},{...details,odometer_km:''},{...details,next_pms_odometer_km:null},{...details,odometer_km:-1},{...details,odometer_km:'NaN'}])await assert.rejects(create(500,pms));assert.deepEqual(await financial(),snapshot);
  let id;await db.exec('set role authenticated');try{id=await create(1000,{...details,odometer_km:0,next_pms_date:'2099-01-01'})}finally{await db.exec('reset role')}
  assert.equal(await visit(id),'2027-02-28');assert.equal((await q('select technician_name from pms_service_records where invoice_id=$1',[id]))[0].technician_name,details.technician_name);
 });
 let installment,payment;
 await t.test('unpaid, partial and writeoff have no due date; final installment sets six months',async()=>{
  installment=await create(300);assert.equal(await visit(installment),null);
  await q('insert into invoice_balance_writeoffs values($1,700)',[installment]);assert.equal(await visit(installment),null);
  await q('delete from invoice_balance_writeoffs where invoice_id=$1',[installment]);payment=await pay(installment,700,'2026-11-25');assert.equal(await visit(installment),'2027-05-25');
 });
 await t.test('payment date/amount correction or deletion recalculates automatically',async()=>{
  await q("update invoice_payments set payment_date='2026-10-31' where id=$1",[payment]);assert.equal(await visit(installment),'2027-04-30');
  await q('update invoice_payments set amount=600 where id=$1',[payment]);assert.equal(await visit(installment),null);
  await q('update invoice_payments set amount=700 where id=$1',[payment]);assert.equal(await visit(installment),'2027-04-30');
  await q('delete from invoice_payments where id=$1',[payment]);assert.equal(await visit(installment),null);
 });
 await t.test('invoice edits and PMS details are atomic; old valid details preserved; removal affects PMS only',async()=>{
  const snapshot=await financial();await assert.rejects(edit(installment,{},1200),/odometer/);assert.deepEqual(await financial(),snapshot);
  await edit(installment,{...details,technician_name:'Changed typed name'},300);assert.equal(await visit(installment),'2027-02-28');
  await edit(installment,undefined,300);assert.equal((await q('select technician_name from pms_service_records where invoice_id=$1',[installment]))[0].technician_name,'Changed typed name');
  await edit(installment,{},300,'Repainting');assert.equal(await visit(installment),undefined);assert.equal((await q('select sum(amount)::numeric n from invoice_payments where invoice_id=$1',[installment]))[0].n,'300.00');
 });
 await t.test('direct forged next-date writes are overridden; cross-branch rows rejected; payment deletion cascade works',async()=>{
  await q("update pms_service_records set next_pms_date='2099-01-01' where invoice_id=$1",[legacy]);assert.equal(await visit(legacy),'2027-02-28');
  await assert.rejects(q('update pms_service_records set branch_id=$1 where invoice_id=$2',[other,legacy]),/business and branch/);
  const id=await create(1000);await q('delete from invoices where id=$1',[id]);assert.equal(await visit(id),undefined);
  assert.equal((await q("select has_function_privilege('authenticated','public.pms_next_visit(uuid)','EXECUTE') allowed"))[0].allowed,false);
 });
 await t.test('idempotent migration and non-PMS creation preserve records',async()=>{
  const snapshot=await financial(),pms=await q('select * from pms_service_records order by id');await db.exec(sql('090_pms_payment_schedule.sql'));assert.deepEqual(await financial(),snapshot);assert.deepEqual(await q('select * from pms_service_records order by id'),pms);
  const id=await create(1000,{},'Repainting');assert.equal(await visit(id),undefined);
 });
 }finally{await db.close()}
});
