const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,'supabase',n),'utf8');
const b='11111111-1111-4111-8111-111111111111',br='11111111-1111-4111-8111-222222222222',other='11111111-1111-4111-8111-333333333333',owner='10000000-0000-4000-8000-000000000001',staff='10000000-0000-4000-8000-000000000002';
const inv='22222222-2222-4222-8222-111111111111',p1='22222222-2222-4222-8222-222222222222',p2='22222222-2222-4222-8222-333333333333',p3='22222222-2222-4222-8222-444444444444',col='33333333-3333-4333-8333-111111111111';
test('payment remittance PostgreSQL safeguards',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
 const {PGlite}=require(process.env.BWC_PGLITE_PATH),db=new PGlite();
 const q=async(s,args=[])=>(await db.query(s,args)).rows;
 const all=async()=>Object.fromEntries(await Promise.all(['invoices','invoice_payments','cash_collections','cash_transactions','audit_logs','cash_collection_legacy_payments'].map(async n=>[n,await q('select * from '+n+' order by 1')])));
 const correct=(id,payment,amount,method='GCash',branch=br)=>q('select correct_invoice_payment($1,$2,$3,$4,null,$5,null,null,$6)',[id,branch,amount,payment,method,'Test authorized correction']);
 try {
  await db.exec(`create role authenticated;create role anon;create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
   create function is_platform_admin() returns boolean language sql stable as $$select false$$;
   create function is_business_manager(b uuid) returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid and b='${b}'::uuid$$;
   create function is_business_member(b uuid) returns boolean language sql stable as $$select b='${b}'::uuid$$;
   create function can_manage_invoice_branch(b uuid,r uuid) returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid and b='${b}'::uuid and r='${br}'::uuid$$;
   create table businesses(id uuid primary key);create table branches(id uuid primary key,business_id uuid,is_active boolean default true);
   create table profiles(id uuid primary key,full_name text,email text);
   create table audit_logs(id uuid primary key default gen_random_uuid(),business_id uuid,branch_id uuid,actor_id uuid,actor_name text,action text,entity_type text,entity_id text,details jsonb,created_at timestamptz default now());
   insert into auth.users values('${owner}'),('${staff}');insert into profiles values('${owner}','Test owner','test@example.invalid');
   insert into businesses values('${b}');insert into branches(id,business_id) values('${br}','${b}'),('${other}','${b}');
   create table invoices(id uuid primary key default gen_random_uuid(),business_id uuid,branch_id uuid,invoice_number integer,client_name text,invoice_date date,total_amount numeric(14,2),amount_paid numeric(14,2),payment_method text,status text,assigned_admin text);
   create table invoice_balance_writeoffs(invoice_id uuid,amount numeric);
   grant usage on schema public,auth to authenticated,anon;set test.actor='${owner}';`);
  await db.exec(read('025_invoice_payment_history.sql'));
  await db.exec(read('024_cash_controls.sql'));
  await db.exec(read('014_cash_remittances.sql'));
  await db.exec(read('019_audit_history.sql').split('create or replace function public.capture_business_audit()')[1].split('$audit$;')[0].replace(/^/,'create or replace function public.capture_business_audit()')+'$audit$;');
  await db.exec('create trigger audit_cash_collections after insert or update or delete on cash_collections for each row execute function capture_business_audit();');
  await db.exec(read('051_cash_transaction_upsert_key.sql'));await db.exec(read('056_invoice_payment_cash_sync.sql'));await db.exec(read('072_invoice_payment_corrections.sql'));
  await db.exec(`insert into invoices values('${inv}','${b}','${br}',176,'Fictional remittance client','2026-10-22',61000,5000,'Cash','Partially paid','Fictional administrator');
   update cash_collections set id='${col}',status='Remitted',remitted_at='2026-10-27 09:24:59.812+00',remitted_by='${owner}' where invoice_id='${inv}';
   insert into invoice_payments(id,invoice_id,business_id,branch_id,amount,payment_date,payment_method,created_by) values
   ('${p1}','${inv}','${b}','${br}',5000,'2026-10-22','Cash','${owner}'),
   ('${p2}','${inv}','${b}','${br}',30000,'2026-11-03','Bank transfer','${owner}'),
   ('${p3}','${inv}','${b}','${br}',26000,'2026-11-23','Cash','${owner}');
   update invoices set amount_paid=61000,status='Paid' where id='${inv}';
   select sync_invoice_payment_cash('${inv}','${br}');
   insert into invoices values(gen_random_uuid(),'${b}','${other}',999,'Unrelated branch','2026-11-23',500,500,'Cash','Paid','Other admin');
   grant all on all tables in schema public to authenticated;`);
  const before=await q('select to_jsonb(c) as data from cash_collections c order by id'),migration=read('081_payment_level_remittances.sql');
  await db.exec(migration);
  await t.test('migration preserves existing financial values and captures legacy coverage',async()=>{
   assert.deepEqual(await q("select to_jsonb(c)-'payment_id' as data from cash_collections c order by id"),before);
   assert.equal((await q('select count(*)::int n from cash_collection_legacy_payments')).at(0).n,3);
  });
  await t.test('exact scoped repair restores 5000, corrects 26000 and preserves original cash row and paid total',async()=>{
   const cashBefore=await q("select * from cash_transactions where amount=5000"),invoiceBefore=await q('select * from invoices');
   await db.exec("set test.actor=''");
   const repair=fs.readFileSync(path.join(__dirname,'fixtures/payment-remittance-repair.sql'),'utf8');await db.exec(repair);
   assert.deepEqual(await q("select * from cash_transactions where amount=5000"),cashBefore);assert.deepEqual(await q('select * from invoices'),invoiceBefore);
   assert.equal((await q('select payment_method from invoice_payments where id=$1',[p3]))[0].payment_method,'GCash');
   const c=(await q('select * from cash_collections where id=$1',[col]))[0];assert.equal(c.payment_id,p1);assert.equal(Number(c.amount),5000);assert.equal(c.remitted_by,owner);assert.equal(c.status,'Remitted');
   const snap=await all();await db.exec(repair);assert.deepEqual(await all(),snap);
   await db.exec(`set test.actor='${owner}'`);
  });
  await t.test('original remitted payment cannot be changed by correction or direct update/delete',async()=>{
   const snap=await all();await assert.rejects(correct(inv,p1,5000),/covered by a recorded remittance/);
   await assert.rejects(q('update invoice_payments set payment_method=$1 where id=$2',['GCash',p1]),/covered by a recorded remittance/);
   await assert.rejects(q('delete from invoice_payments where id=$1',[p1]),/covered by a recorded remittance/);assert.deepEqual(await all(),snap);
  });
  await t.test('newer payment correction is allowed without touching original remittance',async()=>{
   const c=await q('select * from cash_collections where id=$1',[col]);await correct(inv,p3,26000);assert.deepEqual(await q('select * from cash_collections where id=$1',[col]),c);
   const log=await q("select details from audit_logs where entity_type='invoice_payments' and entity_id=$1 order by created_at desc",[p3]);assert.ok(log.some(x=>x.details.before.payment_method==='Cash'&&x.details.after.payment_method==='GCash'));
  });
  let fresh,a,secondPayment,bank,cash;
  await t.test('new installments are separately pending; noncash never becomes a collection',async()=>{
   fresh=(await q(`insert into invoices values(gen_random_uuid(),'${b}','${br}',177,'Fictional QA','2026-11-23',10000,0,'Cash','Pending','Test') returning id`))[0].id;
   const add=async(amount,method)=>(await q('insert into invoice_payments(invoice_id,business_id,branch_id,payment_date,amount,payment_method,created_by) values($1,$2,$3,$4,$5,$6,$7) returning id',[fresh,b,br,'2026-11-23',amount,method,owner]))[0].id;
   a=await add(1000,'Cash');cash=(await q('select * from cash_collections where payment_id=$1',[a]))[0];
   await q('select mark_payment_remitted($1,$2,$3)',[cash.id,br,1000]);
   secondPayment=await add(700,'Cash');bank=await add(300,'Bank transfer');
   await q('update invoices set amount_paid=2000 where id=$1',[fresh]);await q('select sync_invoice_payment_cash($1,$2)',[fresh,br]);
   const records=await q('select payment_id,amount,status from cash_collections where invoice_id=$1 order by amount',[fresh]);
   assert.deepEqual(records.map(x=>[x.payment_id,Number(x.amount),x.status]),[[secondPayment,700,'Pending remittance'],[a,1000,'Remitted']]);
  });
  await t.test('later cash to GCash removes only that cash entry, paid total and original receipt stay',async()=>{
   const old=await q('select * from cash_transactions where amount=1000');await correct(fresh,secondPayment,700);
   assert.deepEqual(await q('select * from cash_transactions where amount=1000'),old);
   assert.equal((await q('select count(*)::int n from cash_collections where invoice_id=$1',[fresh]))[0].n,1);
   assert.equal(Number((await q('select amount_paid from invoices where id=$1',[fresh]))[0].amount_paid),2000);
  });
  await t.test('scope, privilege, stale amount and duplicate mark safeguards',async()=>{
   await assert.rejects(q('select mark_payment_remitted($1,$2,$3)',[cash.id,other,1000]),/not found/);
   await assert.rejects(q('select mark_payment_remitted($1,$2,$3)',[cash.id,br,900]),/changed/);
   assert.equal((await q('select mark_payment_remitted($1,$2,$3) as result',[cash.id,br,1000]))[0].result.already_recorded,true);
   await db.exec(`set test.actor='${staff}'`);await assert.rejects(correct(fresh,bank,300),/authorized/);await assert.rejects(q('select mark_payment_remitted($1,$2,$3)',[cash.id,br,1000]),/cannot record/);
   await db.exec(`set test.actor='${owner}';set role authenticated`);
   await assert.rejects(q('update cash_collections set amount=999 where id=$1',[cash.id]),/permission denied/);
   await assert.rejects(q('delete from cash_collections where id=$1',[cash.id]),/permission denied/);
   await assert.rejects(q('select * from cash_collection_legacy_payments'),/permission denied/);
   await db.exec('reset role');await assert.rejects(correct(fresh,bank,300,'GCash',other),/not found/);
  });
  await t.test('migration rerun does not alter records or expand legacy coverage',async()=>{const snap=await all();await db.exec(migration);assert.deepEqual(await all(),snap)});
  await t.test('audit failure rolls back payment, CIB and remittance changes together',async()=>{
   const snap=await all();await db.exec(`create function fail_correction_audit() returns trigger language plpgsql as $$begin if new.action='corrected' then raise exception 'Simulated audit failure';end if;return new;end$$;create trigger fail_correction_audit before insert on audit_logs for each row execute function fail_correction_audit();`);
   await assert.rejects(correct(fresh,secondPayment,700,'Cash'),/Simulated audit failure/);assert.deepEqual(await all(),snap);
  });
 }finally{await db.close()}
});
test('remittance UI uses a distinct action and scoped server transaction',()=>{
 const source=fs.readFileSync(path.join(root,'cash-remittance-online.js'),'utf8');new (require('node:vm').Script)(source);
 assert.match(source,/data-payment-remit/);assert.doesNotMatch(source,/data-cash-remit|from\('cash_collections'\)\.update/);
 assert.match(source,/rpc\('mark_payment_remitted'/);assert.match(source,/p_branch_id:branchId/);assert.match(source,/Older record · review required/);
});
