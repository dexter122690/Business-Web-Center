const fs=require('node:fs'),path=require('node:path');
const ids={business:'10000000-0000-4000-8000-000000000001',branch:'10000000-0000-4000-8000-000000000002',other:'10000000-0000-4000-8000-000000000003',owner:'10000000-0000-4000-8000-000000000004',editor:'10000000-0000-4000-8000-000000000005',viewer:'10000000-0000-4000-8000-000000000006'};
async function setup(){
 const {PGlite}=require(process.env.BWC_PGLITE_PATH);const db=new PGlite();
 await db.exec(`create role authenticated;create role anon;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 create table businesses(id uuid primary key);create table branches(id uuid primary key,business_id uuid,is_active boolean default true);
 create function is_business_owner(b uuid) returns boolean language sql stable as $$select b='${ids.business}'::uuid and auth.uid()='${ids.owner}'::uuid$$;
 create function can_view_invoice_branch(b uuid,r uuid) returns boolean language sql stable as $$select is_business_owner(b) or (b='${ids.business}'::uuid and r='${ids.branch}'::uuid and auth.uid() in ('${ids.editor}'::uuid,'${ids.viewer}'::uuid))$$;
 create function can_manage_invoice_branch(b uuid,r uuid) returns boolean language sql stable as $$select is_business_owner(b) or (b='${ids.business}'::uuid and r='${ids.branch}'::uuid and auth.uid()='${ids.editor}'::uuid)$$;
 insert into businesses values('${ids.business}');insert into branches values('${ids.branch}','${ids.business}',true),('${ids.other}','${ids.business}',true);
 insert into auth.users values('${ids.owner}'),('${ids.editor}'),('${ids.viewer}');
 create table existing_records(kind text primary key,payload jsonb);insert into existing_records values('invoice','{"total":5000}'),('payroll','{"salary":1000}'),('stock','{"quantity":20}'),('cash','{"balance":2000}');
 grant usage on schema public,auth to authenticated,anon;`);
 const before=(await db.query('select * from existing_records order by kind')).rows;
 await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/092_carwash_records.sql'),'utf8'));
 const user=id=>db.query("select set_config('test.user',$1,false)",[id||'']);await user(ids.owner);
 const save=(payload,request=crypto.randomUUID(),branch=ids.branch)=>db.query('select save_carwash_record($1,$2,$3,$4::jsonb) value',[ids.business,branch,request,JSON.stringify(payload)]).then(r=>r.rows[0].value);
 const row=()=>({action:'save',id:crypto.randomUUID(),revision:0,service_date:'2025-11-21',unit:'Fictional Honda City',plate_number:'qa 001',price:'150.00'});
 return {db,ids,save,user,row,before};
}
module.exports={setup,ids};
