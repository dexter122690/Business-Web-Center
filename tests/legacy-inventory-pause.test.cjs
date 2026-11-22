// Isolated PostgreSQL only. Never connects to Supabase or creates live test records.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {setup}=require('./helpers/inventory-cost-db.cjs');
const root=path.resolve(__dirname,'..');
const sql=name=>fs.readFileSync(path.join(root,'supabase',name),'utf8');
const migration=sql('075_pause_15m_legacy_inventory.sql');
const business='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875';
const branches=['c87de8df-6ab3-4392-9508-612de0ec05f6','84fecf85-fdd8-4dc6-bf8c-20f007782af7'];

test('legacy Inventory pause preserves records and isolates writes to 15M only',
  {skip:!process.env.BWC_PGLITE_PATH},async t=>{
  const f=await setup(),{db,ids}=f;
  const expenseId=crypto.randomUUID();
  const row=async q=>(await db.query(q)).rows;
  const scalar=async q=>(await row(q))[0].value;
  const auth=async fn=>{await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}};
  const expense=(b,branch,category='Parts & Materials')=>db.query(`insert into expenses
    (business_id,branch_id,description,category,quantity,unit_amount,created_by)
    values($1,$2,'Fictional test material',$3,2,15,$4) returning id`,[b,branch,category,ids.user]);
  try {
    await db.exec(`alter table businesses add column name text;
      insert into businesses(id,name) values('${business}','15M Autocare Services');
      insert into branches(id,business_id) values('${branches[0]}','${business}'),('${branches[1]}','${business}');
      create table invoices(id uuid primary key, business_id uuid, amount numeric);
      create table expenses(id uuid primary key default gen_random_uuid(),business_id uuid,branch_id uuid,
        description text,category text,quantity numeric,unit_amount numeric,receipt_number text,reference_number text,created_by uuid);
      insert into expenses values('${expenseId}','${business}','${branches[0]}','Existing fictional expense','Parts & Materials',2,12,null,null,'${ids.user}');`);
    await db.exec(sql('022_inventory.sql'));
    await db.exec('drop policy inventory_movements_manage on inventory_stock_movements');
    // Keep the fixture's permission helper; apply the real manual-stock policies.
    const manualPolicies=sql('055_team_manual_stock_access.sql');
    await db.exec('begin;\n'+manualPolicies.slice(manualPolicies.indexOf('create policy inventory_movements_insert')));
    await db.exec(sql('057_inventory_actual_count_cutover.sql'));
    await db.exec(`grant select,insert,update,delete on all tables in schema public to authenticated;
      insert into inventory_stock_movements(business_id,branch_id,movement_type,item_name,category,quantity,created_by)
        values('${business}','${branches[0]}','in','Existing manual item','Parts & Materials',3,'${ids.user}');
      insert into inventory_opening_cutovers(business_id,branch_id,created_by) values('${business}','${branches[0]}','${ids.user}');
      insert into inventory_opening_counts(business_id,branch_id,sku,item_name,category,quantity) values('${business}','${branches[0]}','TEST','Existing count','Parts & Materials',2);`);
    const watched=['expenses','invoices','inventory_stock_movements','inventory_opening_cutovers','inventory_opening_counts',
      'inventory_tracker_materials','inventory_tracker_vehicles','inventory_tracker_usage','inventory_tracker_usage_lines',
      'inventory_tracker_adjustments','inventory_tracker_cost_events','inventory_tracker_cost_baselines'];
    async function records(){const values={};for(const table of watched)values[table]=await row(`select to_jsonb(t) as data from ${table} t order by to_jsonb(t)::text`);return values;}
    const before=await records();
    const functionsBefore=await row("select proname,prosrc from pg_proc where pronamespace='public'::regnamespace order by oid");
    await t.test('migration and repeat run change no saved data or function bodies',async()=>{
      await db.exec(migration);await db.exec(migration);
      assert.deepEqual(await records(),before);
      assert.deepEqual(await row("select proname,prosrc from pg_proc where pronamespace='public'::regnamespace order by oid"),functionsBefore);
      assert.equal(await scalar("select count(*)::int as value from pg_policies where policyname like 'inventory_15m_paused_%'"),9);
    });
    await t.test('both 15M branches can save expenses without new old-inventory copies',async()=>{
      const old=await row('select * from inventory_stock_movements order by id');
      for(const branch of branches)for(const category of ['Parts & Materials','Cost of Sales','Salaries & Wages'])await auth(()=>expense(business,branch,category));
      await auth(()=>db.exec(`update expenses set quantity=7,description='Corrected expense' where id='${expenseId}'`));
      assert.equal(await scalar('select count(*)::int as value from expenses'),7);
      assert.equal(Number(await scalar(`select quantity as value from expenses where id='${expenseId}'`)),7);
      assert.deepEqual(await row('select * from inventory_stock_movements order by id'),old);
    });
    await t.test('other businesses retain normal automatic stock recording',async()=>{
      const inserted=await auth(()=>expense(ids.business,ids.branch));const id=inserted.rows[0].id;
      assert.equal(Number(await scalar(`select quantity as value from inventory_stock_movements where expense_id='${id}'`)),2);
      await auth(()=>db.exec(`update expenses set quantity=4 where id='${id}'`));
      assert.equal(Number(await scalar(`select quantity as value from inventory_stock_movements where expense_id='${id}'`)),4);
    });
    await t.test('stale browser manual stock and baseline writes are blocked for both branches',async()=>{
      for(const branch of branches){
        for(const type of ['in','out'])await assert.rejects(auth(()=>db.exec(`insert into inventory_stock_movements(business_id,branch_id,movement_type,item_name,category,quantity,created_by) values('${business}','${branch}','${type}','Blocked test','Parts & Materials',1,'${ids.user}')`)),/row-level security/);
        await assert.rejects(auth(()=>db.exec(`insert into inventory_opening_counts(business_id,branch_id,sku,item_name,category,quantity) values('${business}','${branch}','NEW','Blocked','Parts & Materials',1)`)),/row-level security/);
      }
      await assert.rejects(auth(()=>db.exec(`insert into inventory_opening_cutovers(business_id,branch_id) values('${business}','${branches[1]}')`)),/row-level security/);
      for(const table of ['inventory_stock_movements','inventory_opening_counts','inventory_opening_cutovers']){
        const before=await row(`select * from ${table} where business_id='${business}' order by id`);
        const column=table==='inventory_opening_cutovers'?'finalized_at=now()':'quantity=99';
        await auth(()=>db.exec(`update ${table} set ${column} where business_id='${business}'`));
        await auth(()=>db.exec(`delete from ${table} where business_id='${business}'`));
        assert.deepEqual(await row(`select * from ${table} where business_id='${business}' order by id`),before);
        assert.deepEqual(await auth(()=>row(`select * from ${table} where business_id='${business}' order by id`)),before);
      }
    });
    await t.test('other businesses can still create and edit manual stock and opening counts',async()=>{
      await auth(()=>db.exec(`insert into inventory_stock_movements(business_id,branch_id,movement_type,item_name,category,quantity,created_by) values('${ids.business}','${ids.branch}','in','Other manual','Parts & Materials',1,'${ids.user}');
        insert into inventory_opening_cutovers(business_id,branch_id) values('${ids.business}','${ids.branch}');
        insert into inventory_opening_counts(business_id,branch_id,sku,item_name,category,quantity) values('${ids.business}','${ids.branch}','OTHER','Other count','Parts & Materials',1);
        update inventory_stock_movements set quantity=5 where item_name='Other manual';
        update inventory_opening_counts set quantity=5 where sku='OTHER';
        update inventory_opening_cutovers set finalized_at=now() where business_id='${ids.business}';`));
      assert.equal(Number(await scalar("select quantity as value from inventory_stock_movements where item_name='Other manual'")),5);
      assert.equal(Number(await scalar("select quantity as value from inventory_opening_counts where sku='OTHER'")),5);
    });
    await t.test('current Inventory Tracker material and per-unit usage still work for 15M',async()=>{
      const material=await auth(()=>db.query('select inventory_tracker_cost_action($1,$2,$3,$4::jsonb) as data',[business,branches[0],crypto.randomUUID(),JSON.stringify({action:'create',name:'Fictional test Liha',note:'Isolated test only'})]));
      const id=material.rows[0].data.material_id;
      const vehicle=await auth(()=>db.query(`insert into inventory_tracker_vehicles(business_id,branch_id,vehicle_name,plate_number) values($1,$2,'Test vehicle','TEST') returning id`,[business,branches[0]]));
      const snapshot=await auth(()=>db.query('select inventory_tracker_cost_snapshot($1,$2,$3) as data',[business,branches[0],vehicle.rows[0].id]));
      const updated=snapshot.rows[0].data.materials.find(m=>m.id===id).updated_at;
      await auth(()=>db.query('select inventory_tracker_cost_action($1,$2,$3,$4::jsonb)',[business,branches[0],crypto.randomUUID(),JSON.stringify({action:'purchase',material_id:id,expected_updated_at:updated,quantity:10,unit:'sheet',unit_cost:15,supplier:'Fictional supplier',receipt:'TEST',purchase_date:'2026-01-01',note:'Isolated test only'})]));
      const snap2=await auth(()=>db.query('select inventory_tracker_cost_snapshot($1,$2,$3) as data',[business,branches[0],vehicle.rows[0].id]));
      await auth(()=>db.query('select inventory_tracker_cost_action($1,$2,$3,$4::jsonb)',[business,branches[0],crypto.randomUUID(),JSON.stringify({action:'use',material_id:id,vehicle_id:vehicle.rows[0].id,expected_updated_at:snap2.rows[0].data.materials.find(m=>m.id===id).updated_at,quantity:1,note:'Isolated test only'})]));
      assert.equal(Number(await scalar(`select quantity as value from inventory_tracker_materials where id='${id}'`)),9);
    });
    await t.test('ordinary source-record deletion is not blocked by the pause',async()=>{
      await auth(()=>db.exec(`delete from expenses where id='${expenseId}'`));
      assert.equal(await scalar(`select count(*)::int as value from inventory_stock_movements where expense_id='${expenseId}'`),0);
    });
    await t.test('unexpected business or trigger fails safely',async()=>{
      await db.exec(`update businesses set name='Different business' where id='${business}'`);
      await assert.rejects(db.exec(migration),/Expected 15M business/);await db.exec('rollback');
      await db.exec(`update businesses set name='15M Autocare Services' where id='${business}';
        alter table expenses disable trigger expenses_sync_inventory_stock_in;`);
      await assert.rejects(db.exec(migration),/trigger changed/);await db.exec('rollback');
    });
  } finally {await db.close();}
});
