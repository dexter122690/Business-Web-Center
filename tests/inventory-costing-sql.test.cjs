const {test}=require('node:test'),assert=require('node:assert/strict'),{setup,ids}=require('./helpers/inventory-cost-db.cjs');
test('inventory costing PostgreSQL transaction suite (set BWC_PGLITE_PATH to a local PGlite installation)',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
 const f=await setup(),{db,snapshot,action,input}=f;
 try{
  await t.test('migration does not change stock, infer old prices or combine overlapping history',async()=>{
   const s=await snapshot(),m=s.materials[0];assert.equal(Number(m.quantity),10);assert.equal(m.cost_initialized,false);assert.equal(m.cost_value,null);assert.equal(m.old_adjustment_qty,3);assert.equal(m.old_usage_qty,3);assert.equal(m.new_cost,0);
  });
  await t.test('unvalued stock blocks purchase and usage without partial writes',async()=>{
   await assert.rejects(action(await input('use',{vehicle_id:ids.unit})),/opening stock cost/);
   await assert.rejects(action(await input('purchase',{unit:'sheet',unit_cost:15,supplier:'B',receipt:'B1',purchase_date:'2026-01-01'})),/existing stock first/);
   assert.equal((await snapshot()).materials[0].quantity,10);
  });
  await t.test('opening cost prices existing stock without increasing it',async()=>{
   await action(await input('opening',{quantity:10,unit:'sheet',unit_cost:12}));const m=(await snapshot()).materials[0];assert.equal(m.quantity,10);assert.equal(m.cost_value,120);assert.equal(m.stock_unit_cost,12);
   await assert.rejects(action(await input('opening',{quantity:10,unit:'sheet',unit_cost:20})),/already been valued/);
  });
  await t.test('actual purchases produce the agreed weighted average',async()=>{
   await action(await input('purchase',{quantity:20,unit:'sheet',unit_cost:15,supplier:'Supplier B',receipt:'B-100',purchase_date:'2026-01-01'}));
   await action(await input('purchase',{quantity:10,unit:'sheet',unit_cost:20,supplier:'Supplier C',receipt:'C-101',purchase_date:'2026-01-02'}));
   const m=(await snapshot()).materials[0];assert.equal(m.quantity,40);assert.equal(m.cost_value,620);assert.equal(m.stock_unit_cost,15.5);
  });
  let useId;
  await t.test('one use saves stock, quantity and historical cost atomically',async()=>{
   const p=await input('use',{quantity:3,vehicle_id:ids.unit}),key=crypto.randomUUID();await action(p,key);await action(p,key);
   let s=await snapshot();assert.equal(s.materials[0].quantity,37);assert.equal(s.materials[0].new_qty,3);assert.equal(s.materials[0].new_cost,46.5);assert.equal(s.history.length,1);useId=s.history[0].id;
   await assert.rejects(action({...p,quantity:4},key),/different operation/);
  });
  await t.test('supplier-price changes do not rewrite earlier vehicle costs',async()=>{
   await action(await input('purchase',{quantity:3,unit:'sheet',unit_cost:30,supplier:'D',receipt:'D1',purchase_date:'2026-01-03'}));
   const s=await snapshot();assert.equal(s.materials[0].new_cost,46.5);assert.equal(s.history[0].unit_cost,15.5);assert.equal(s.materials[0].stock_unit_cost,16.5875);
  });
  await t.test('returns reverse the original price, not the current average',async()=>{
   await action(await input('return',{vehicle_id:ids.unit,quantity:1,return_of:useId}));const s=await snapshot();assert.equal(s.materials[0].new_qty,2);assert.equal(s.materials[0].new_cost,31);assert.equal(s.materials[0].quantity,41);
   await assert.rejects(action(await input('return',{vehicle_id:ids.unit,quantity:3,return_of:useId})),/exceeds/);
  });
  await t.test('fractional usage and final returns preserve exact recorded value',async()=>{
   await action(await input('use',{quantity:0.25,vehicle_id:ids.unit}));let s=await snapshot(),h=s.history.find(x=>x.delta===0.25);
   await action(await input('return',{quantity:0.1,vehicle_id:ids.unit,return_of:h.id}));
   await action(await input('return',{quantity:0.15,vehicle_id:ids.unit,return_of:h.id}));s=await snapshot();assert.equal(s.materials[0].new_qty,2);assert.equal(s.materials[0].new_cost,31);
  });
  await t.test('verified past usage is costed once without changing stock or old records',async()=>{
   const before=(await snapshot()).materials[0].quantity;
   await action(await input('baseline',{vehicle_id:ids.unit,quantity:3,unit:'sheet',unit_cost:12,confirmed:true,note:'Checked original receipt and overlapping usage logs'}));
   const m=(await snapshot()).materials[0];assert.equal(m.quantity,before);assert.equal(m.baseline.amount,36);assert.equal(m.old_adjustment_qty,3);assert.equal(m.old_usage_qty,3);
   await assert.rejects(action(await input('baseline',{vehicle_id:ids.unit,quantity:6,unit:'sheet',unit_cost:12,confirmed:true})),/duplicate key/);
  });
  await t.test('stale stock versions fail without changing anything',async()=>{
   const p=await input('use',{quantity:1,vehicle_id:ids.unit});await action(await input('count',{quantity:40}));const before=await snapshot();await assert.rejects(action(p),/changed in another session/);assert.deepEqual(await snapshot(),before);
  });
  await t.test('invalid values and units fail closed',async()=>{
   for(const quantity of [-1,1.001,'NaN','Infinity',null])await assert.rejects(action(await input('use',{quantity,vehicle_id:ids.unit})));
   for(const unit_cost of [-1,'NaN',null])await assert.rejects(action(await input('purchase',{unit:'sheet',unit_cost,supplier:'X',receipt:'X',purchase_date:'2026-01-01'})));
   await assert.rejects(action(await input('purchase',{unit:'gallon',unit_cost:12,supplier:'X',receipt:'X',purchase_date:'2026-01-01'})),/measurement unit/);
   await assert.rejects(action(await input('purchase',{unit:'sheet',unit_cost:12,supplier:'X',receipt:'X',purchase_date:'2999-01-01'})),/future date/);
   await assert.rejects(action(await input('use',{quantity:999999,vehicle_id:ids.unit})),/Not enough stock/);
  });
  await t.test('released and other-branch units cannot receive stock',async()=>{
   await assert.rejects(action(await input('use',{vehicle_id:ids.released})),/Released units/);
   const p=await input('use',{vehicle_id:ids.unit});await assert.rejects(action(p,crypto.randomUUID(),ids.other),/unavailable/);
  });
  await t.test('old stock-writing RPCs fail closed',async()=>{
   await assert.rejects(db.query('select adjust_inventory_tracker_stock($1,1)',[ids.material]),/Reload BWC/);
   await assert.rejects(db.query('select log_inventory_tracker_adjustment($1,$2,1)',[ids.unit,ids.material]),/Reload BWC/);
  });
  await t.test('a failure after stock updates rolls back quantity, costs and usage together',async()=>{
   await db.exec("create function fail_cost_event() returns trigger language plpgsql as $$begin if new.note='SIMULATED FAILURE' then raise exception 'Simulated event-write failure';end if;return new;end$$;create trigger test_fail_cost_event before insert on inventory_tracker_cost_events for each row execute function fail_cost_event();");
   const before=await snapshot();await assert.rejects(action(await input('use',{quantity:1,vehicle_id:ids.unit,note:'SIMULATED FAILURE'})),/Simulated/);assert.deepEqual(await snapshot(),before);
  });
  await t.test('view-only staff can read their branch but cannot mutate or read another branch',async()=>{
   await db.query("select set_config('test.user',$1,false)",[ids.staff]);assert.equal((await snapshot()).can_edit,false);
   await assert.rejects(action(await input('use',{vehicle_id:ids.unit})),/edit access/);await assert.rejects(snapshot(null,ids.other),/Inventory access/);
   await db.query("select set_config('test.user',$1,false)",[ids.user]);
  });
  await t.test('direct authenticated writes cannot bypass valuation',async()=>{
   await db.exec('set role authenticated');
   await assert.rejects(db.query('update inventory_tracker_materials set quantity=999 where id=$1',[ids.material]),/permission denied/);
   await assert.rejects(db.query('delete from inventory_tracker_adjustments where vehicle_id=$1',[ids.unit]),/permission denied/);
   await assert.rejects(db.exec("insert into inventory_tracker_cost_events(request_id) values(gen_random_uuid())"),/permission denied/);
   await db.exec('reset role');
  });
  await t.test('snapshot aggregates more than 1000 records without truncation',async()=>{
   await db.exec(`insert into inventory_tracker_adjustments(business_id,branch_id,vehicle_id,material_id,material_name,delta,cost_version,unit_cost,cost_amount,measure_unit) select '${ids.business}','${ids.branch}','${ids.released}','${ids.material}','Liha 120',0.01,1,10,0.1,'sheet' from generate_series(1,1205)`);
   const s=await snapshot(ids.released);assert.equal(s.history.length,1205);assert.equal(s.materials[0].new_qty,12.05);assert.equal(s.materials[0].new_cost,120.5);
  });
  await t.test('migration is safely rerunnable without changing costs or stock',async()=>{
   const fs=require('node:fs'),path=require('node:path'),before=await snapshot();await db.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/073_inventory_tracker_costing.sql'),'utf8'));assert.deepEqual(await snapshot(),before);
  });
 }finally{await db.close();}
});
