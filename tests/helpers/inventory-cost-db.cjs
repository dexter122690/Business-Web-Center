// Entirely isolated PostgreSQL fixture. Never accepts a connection URL.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const ids={business:'00000000-0000-4000-8000-000000000001',branch:'00000000-0000-4000-8000-000000000002',other:'00000000-0000-4000-8000-000000000003',user:'00000000-0000-4000-8000-000000000004',staff:'00000000-0000-4000-8000-000000000005',unit:'00000000-0000-4000-8000-000000000006',released:'00000000-0000-4000-8000-000000000007',material:'00000000-0000-4000-8000-000000000008',usage:'00000000-0000-4000-8000-000000000009'};
async function setup(){
 const {PGlite}=require(process.env.BWC_PGLITE_PATH||'@electric-sql/pglite');const db=new PGlite();
 await db.exec(`create role authenticated; create role anon; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('test.user',true),''),'${ids.user}')::uuid$$;
 create table businesses(id uuid primary key);
 create table branches(id uuid primary key,business_id uuid references businesses(id),is_active boolean default true);
 create table business_memberships(business_id uuid,user_id uuid,status text,permissions jsonb);
 create table business_member_branch_access(business_id uuid,user_id uuid,branch_id uuid);
 create function is_platform_admin() returns boolean language sql stable as $$select false$$;
 create function is_business_owner(uuid) returns boolean language sql stable as $$select auth.uid()='${ids.user}'::uuid$$;
 create function is_business_manager(uuid) returns boolean language sql stable as $$select auth.uid()='${ids.user}'::uuid$$;
 create function is_business_member(uuid) returns boolean language sql stable as $$select true$$;
 create function set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
 create function capture_business_audit() returns trigger language plpgsql as $$begin return new;end$$;
 create function can_manage_inventory_branch(b uuid,r uuid) returns boolean language sql stable as $$select is_business_owner(b) or exists(select 1 from business_memberships m join business_member_branch_access a on a.business_id=m.business_id and a.user_id=m.user_id where m.business_id=b and m.user_id=auth.uid() and m.status='active' and m.permissions->>'inventory'='edit' and a.branch_id=r)$$;
 insert into auth.users values('${ids.user}'),('${ids.staff}');insert into businesses values('${ids.business}');
 insert into branches values('${ids.branch}','${ids.business}',true),('${ids.other}','${ids.business}',true);
 insert into business_memberships values('${ids.business}','${ids.staff}','active','{"inventory":"view"}');
 insert into business_member_branch_access values('${ids.business}','${ids.staff}','${ids.branch}');`);
 for(const f of ['063_inventory_tracker.sql','064_inventory_tracker_released_units.sql','067_inventory_tracker_adjustment_log.sql'])await db.exec(fs.readFileSync(path.join(ROOT,'supabase',f),'utf8'));
 await db.exec(`grant usage on schema public,auth to authenticated,anon;grant select,insert,update,delete on all tables in schema public to authenticated;
 insert into inventory_tracker_materials(id,business_id,branch_id,item_name,quantity) values('${ids.material}','${ids.business}','${ids.branch}','Liha 120',10);
 insert into inventory_tracker_vehicles(id,business_id,branch_id,vehicle_name,plate_number) values('${ids.unit}','${ids.business}','${ids.branch}','HONDA CITY','ZFF 245'),('${ids.released}','${ids.business}','${ids.branch}','SWIFT','NDF4074');
 update inventory_tracker_vehicles set released_at=now() where id='${ids.released}';
 insert into inventory_tracker_usage(id,business_id,branch_id,vehicle_id) values('${ids.usage}','${ids.business}','${ids.branch}','${ids.unit}');
 insert into inventory_tracker_usage_lines(business_id,branch_id,usage_id,material_id,material_name,quantity) values('${ids.business}','${ids.branch}','${ids.usage}','${ids.material}','Liha 120',3);
 insert into inventory_tracker_adjustments(business_id,branch_id,vehicle_id,material_id,material_name,delta) values('${ids.business}','${ids.branch}','${ids.unit}','${ids.material}','Liha 120',3);`);
 const before=(await db.query('select quantity from inventory_tracker_materials')).rows;
 await db.exec(fs.readFileSync(path.join(ROOT,'supabase/073_inventory_tracker_costing.sql'),'utf8'));
 async function snapshot(vehicle=ids.unit,branch=ids.branch){return (await db.query('select inventory_tracker_cost_snapshot($1,$2,$3) as value',[ids.business,branch,vehicle])).rows[0].value;}
 async function action(payload,request=crypto.randomUUID(),branch=ids.branch){return (await db.query('select inventory_tracker_cost_action($1,$2,$3,$4::jsonb) as value',[ids.business,branch,request,JSON.stringify(payload)])).rows[0].value;}
 async function input(actionName,extra={}){const s=await snapshot(extra.vehicle_id||ids.unit),m=s.materials.find(x=>x.id===(extra.material_id||ids.material));return {action:actionName,material_id:ids.material,expected_updated_at:m.updated_at,quantity:1,note:'Fictional test receipt',...extra};}
 return {db,ids,snapshot,action,input,before};
}
module.exports={setup,ids};
