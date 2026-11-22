const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const api=require('../inventory-costing.js'),{setup,ids}=require('./helpers/inventory-cost-db.cjs');
const migration=fs.readFileSync(path.resolve(__dirname,'../supabase/074_inventory_reference_prices.sql'),'utf8');
const raw=()=>({version:1,business_id:'biz',branch_id:'branch',can_edit:true,vehicle:null,history:[],purchases:[],materials:[{id:'m',item_name:'Rubbing Compound',quantity:0,measure_unit:null,cost_initialized:false,cost_value:null,stock_unit_cost:null,new_qty:0,new_cost:0,old_adjustment_count:0,old_adjustment_qty:0,old_usage_count:0,old_usage_qty:0}]});
const reference=(extra={})=>({material_id:'m',business_id:'biz',branch_id:'branch',price:520,price_unit:'500 mL',note:'Owner supplied',revision:'revision',updated_at:'2026-11-22',...extra});
const data=(prices=[reference()],extra={})=>({version:1,business_id:'biz',branch_id:'branch',prices,history:[],...extra});
const attach=(d=data())=>api.attachReferences(api.model(raw()),{data:d});

test('reference prices display at zero stock without inventing stock valuation or usage',()=>{
 const r=attach(),html=api.referenceHTML(r);assert.match(html,/₱520.00/);assert.match(html,/500 mL/);
 assert.match(html,/do not change quantities/);assert.equal(r.total,0);assert.equal(r.rows[0].material.quantity,0);assert.equal(r.rows[0].material.cost_initialized,false);
 assert.match(api.stockHTML(r),/Cost not recorded/);assert.match(api.reportHTML(r),/No material usage/);
});
test('missing and zero reference prices are distinct',()=>{
 assert.match(api.referenceHTML(attach(data([]))),/Not set/);
 assert.match(api.referenceHTML(attach(data([reference({price:0})]))),/₱0.00/);
});
test('price scope, duplicate references, invalid values and missing setup fail closed',()=>{
 for(const d of [null,data(undefined,{branch_id:'other'}),data([reference({branch_id:'other'})]),data([reference({material_id:'other'})]),data([reference(),reference()]),data([reference({price:null})]),data([reference({price:-1})])]){
  const r=attach(d);assert.ok(r.referenceError);assert.doesNotMatch(api.referenceHTML(r),/data-ic-action="reference"/);assert.equal(r.total,0);
 }
 assert.match(api.referenceHTML(api.attachReferences(api.model(raw()),{error:{code:'PGRST202'}})),/074/);
});
test('reference strings are escaped, and view-only users get no edit buttons',()=>{
 const r=attach(data([reference({price_unit:'<img>',note:'<script>'})]));assert.doesNotMatch(api.referenceHTML(r),/<img>|<script>/);assert.match(api.referenceHTML(r),/&lt;img&gt;/);
 r.data.can_edit=false;assert.doesNotMatch(api.referenceHTML(r),/data-ic-action="reference"/);
});
test('price payload is isolated from stock and carries the expected revision',()=>{
 const state={action:'reference',report:attach(),context:{vehicle:'car'}},v={material_id:'m',price:520,unit:'500 mL',note:'Owner supplied'};
 const p=api.payloadFrom(state,v);assert.deepEqual(p,{material_id:'m',price:520,unit:'500 mL',note:'Owner supplied',expected_revision:'revision'});
 for(const price of [null,'',-1,Infinity,1.00001,1000000000])assert.throws(()=>api.payloadFrom(state,{...v,price}));
 assert.throws(()=>api.payloadFrom(state,{...v,unit:''}));assert.throws(()=>api.payloadFrom(state,{...v,material_id:'other'}));
 assert.equal(api.payloadFrom({...state,report:attach(data([]))},v).expected_revision,null);
});

test('reference-price PostgreSQL suite',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
 const {db,snapshot,action,input}=await setup();
 const snap=(branch=ids.branch)=>db.query('select inventory_tracker_reference_price_snapshot($1,$2) as value',[ids.business,branch]).then(r=>r.rows[0].value);
 const save=(p,key=crypto.randomUUID(),branch=ids.branch)=>db.query('select inventory_tracker_reference_price_save($1,$2,$3,$4::jsonb) as value',[ids.business,branch,key,JSON.stringify(p)]).then(r=>r.rows[0].value);
 const base={material_id:ids.material,price:15,unit:'sheet',note:'Owner approved reference',expected_revision:null};
 try{
  const before=await snapshot();await db.exec(migration);
  await t.test('migration and price save leave complete existing snapshot untouched',async()=>{
   assert.deepEqual(await snapshot(),before);await save(base);assert.deepEqual(await snapshot(),before);
   const s=await snap();assert.equal(s.prices[0].price,15);assert.equal(s.history.length,1);
  });
  await t.test('retries are idempotent and different requests cannot reuse the same identifier',async()=>{
   const p={...base,price:20,expected_revision:(await snap()).prices[0].revision},key=crypto.randomUUID();await save(p,key);
   assert.equal((await save(p,key)).duplicate,true);assert.equal((await snap()).history.length,2);
   await assert.rejects(save({...p,price:30},key),/different operation/);
  });
  await t.test('stale edit rejects without partial changes',async()=>{
   const before=await snap();await assert.rejects(save(base),/changed in another session/);assert.deepEqual(await snap(),before);
  });
  await t.test('zero stock can retain a reference without gaining quantity or a stock cost',async()=>{
   await action(await input('create',{name:'Rubbing Compound',note:'Fictional fixture only'}));
   const m=(await snapshot()).materials.find(m=>m.item_name==='Rubbing Compound');
   await save({...base,material_id:m.id,price:520,unit:'500 mL'});
   const current=(await snapshot()).materials.find(x=>x.id===m.id);assert.equal(current.quantity,0);assert.equal(current.cost_initialized,false);assert.equal(current.stock_unit_cost,null);
  });
  await t.test('invalid prices, unit sizes, notes and mismatched branches are rejected',async()=>{
   const p={...base,expected_revision:(await snap()).prices.find(x=>x.material_id===ids.material).revision};
   for(const price of [null,-1,'NaN','Infinity',1.00001,1000000000])await assert.rejects(save({...p,price}));
   for(const unit of ['', ' '.repeat(2),'x'.repeat(51)])await assert.rejects(save({...p,unit}));
   await assert.rejects(save({...p,note:'x'}));await assert.rejects(save(p,crypto.randomUUID(),ids.other),/unavailable/);
   await assert.rejects(save(null));
  });
  await t.test('reference edit cannot change valued stock or an issued cost',async()=>{
   await action(await input('opening',{quantity:10,unit:'sheet',unit_cost:12}));
   await action(await input('use',{quantity:1,vehicle_id:ids.unit}));const before=await snapshot();
   await save({...base,price:999,expected_revision:(await snap()).prices.find(x=>x.material_id===ids.material).revision});assert.deepEqual(await snapshot(),before);
  });
  await t.test('event failure rolls back the reference price',async()=>{
   await db.exec("create function fail_reference_event() returns trigger language plpgsql as $$begin if new.payload->>'note'='FAIL TEST' then raise exception 'Simulated failure';end if;return new;end$$;create trigger test_reference_failure before insert on inventory_tracker_reference_price_events for each row execute function fail_reference_event();");
   const before=await snap(),p={...base,note:'FAIL TEST',expected_revision:before.prices.find(x=>x.material_id===ids.material).revision};
   await assert.rejects(save(p),/Simulated/);assert.deepEqual(await snap(),before);
  });
  await t.test('view-only staff can read only their assigned branch and cannot change prices',async()=>{
   const otherMaterial=(await db.query("insert into inventory_tracker_materials(business_id,branch_id,item_name,quantity) values($1,$2,'Other branch material',0) returning id",[ids.business,ids.other])).rows[0].id;
   await save({...base,material_id:otherMaterial},crypto.randomUUID(),ids.other);
   await db.query("select set_config('test.user',$1,false)",[ids.staff]);assert.equal((await snap()).prices.length,2);
   await assert.rejects(save(base),/edit access/);await assert.rejects(snap(ids.other),/Inventory access/);
   await db.exec('set role authenticated');assert.equal((await db.query('select count(*)::int n from inventory_tracker_reference_prices')).rows[0].n,2);
   await assert.rejects(db.exec('update inventory_tracker_reference_prices set price=1'),/permission denied/);
   await assert.rejects(db.exec('delete from inventory_tracker_reference_price_events'),/permission denied/);await db.exec('reset role');
   await db.query("select set_config('test.user',$1,false)",[ids.user]);
  });
  await t.test('anonymous execution is denied and migration rerun preserves price revisions/history',async()=>{
   await db.exec('set role anon');await assert.rejects(snap(),/permission denied/);await assert.rejects(save(base),/permission denied/);await db.exec('reset role');
   const before=await snap(),stock=await snapshot();await db.exec(migration);assert.deepEqual(await snap(),before);assert.deepEqual(await snapshot(),stock);
  });
 }finally{await db.close();}
});
