const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const api=require('../inventory-costing.js'),{setup,ids}=require('./helpers/inventory-cost-db.cjs');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/091_inventory_simple_prices.sql'),'utf8');
const material=()=>({id:ids.material,item_name:'Liha 120',quantity:10,new_qty:2,new_cost:24,old_adjustment_count:0,old_adjustment_qty:0,old_usage_count:0,old_usage_qty:0,updated_at:'2026-11-25',cost_initialized:false,cost_value:null});
const raw=(extra={})=>({version:1,simple_pricing_version:1,business_id:ids.business,branch_id:ids.branch,vehicle:{id:ids.unit},can_edit:true,materials:[material()],history:[],...extra});
const coat=(extra={})=>({vehicle_id:ids.unit,business_id:ids.business,branch_id:ids.branch,quantity:500,measure_unit:'mL',liters:0.5,amount:600,revision:'r1',...extra});
test('visible line costs and total include one custom base coat without multiplying its total cost',()=>{
 const r=api.model(raw({basecoat:coat()}));assert.equal(r.materialsTotal,24);assert.equal(r.total,624);
 assert.match(api.inlineCostHTML(r.rows[0]),/₱24.00/);assert.match(api.basecoatHTML(r,false),/500 mL used/);assert.match(api.basecoatHTML(r,false),/₱600.00/);assert.match(api.simpleTotalHTML(r),/₱624.00/);
 assert.doesNotMatch(api.basecoatHTML(r,true),/data-ic-action/);
 for(const c of [coat({branch_id:ids.other}),coat({vehicle_id:ids.released}),coat({amount:-1}),coat({quantity:0}),coat({measure_unit:'gal'})])assert.throws(()=>api.model(raw({basecoat:c})));
});
test('custom base coat payload replaces one per-unit line; validates quantity, cost and units',()=>{
 const state={action:'basecoat',report:api.model(raw()),context:{vehicle:ids.unit}},v={quantity:500,unit:'mL',amount:600,note:'Used on unit'};
 const p=api.payloadFrom(state,v);assert.equal(p.quantity,500);assert.equal(p.amount,600);assert.equal(p.expected_revision,null);assert.equal(p.material_id,undefined);
 for(const values of [{quantity:0},{quantity:0.001},{quantity:Infinity},{amount:-1},{amount:0.001},{unit:'gallon'}])assert.throws(()=>api.payloadFrom(state,{...v,...values}));
 assert.equal(api.payloadFrom({...state,report:api.model(raw({basecoat:coat()}))},v).expected_revision,'r1');
 assert.equal(api.payloadFrom({...state,action:'basecoat_remove',report:api.model(raw({basecoat:coat()}))},v).expected_revision,'r1');
 assert.throws(()=>api.payloadFrom({...state,action:'basecoat_remove'},v));
 assert.throws(()=>api.payloadFrom({...state,report:api.model(raw({vehicle:{id:ids.unit,released_at:'2026-11-25'}}))},v));
});
test('new UI has one price section, direct costs and no opening-cost blocking message',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../inventory-costing.js'),'utf8');
 assert.doesNotMatch(code,/Set the opening cost for/);assert.doesNotMatch(code,/referenceHTML\(report\)\+stockHTML/);
 assert.match(code,/inventory_tracker_simple_snapshot/);assert.match(code,/rpc:'inventory_tracker_simple_action'/);
 assert.match(code,/decorateUsage\(old,report\)/);assert.match(code,/simpleTotalHTML\(report\)/);
 assert.match(code,/stockButton.hasAttribute\('data-it-toggle-manage'\)\?'create':'stock'/);
});

test('simple inventory PostgreSQL transactions',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
 const f=await setup(),{db}=f;
 const snap=(vehicle=ids.unit,branch=ids.branch)=>db.query('select inventory_tracker_simple_snapshot($1,$2,$3) value',[ids.business,branch,vehicle]).then(r=>r.rows[0].value);
 const action=(payload,key=crypto.randomUUID(),branch=ids.branch)=>db.query('select inventory_tracker_simple_action($1,$2,$3,$4::jsonb) value',[ids.business,branch,key,JSON.stringify(payload)]).then(r=>r.rows[0].value);
 const refs=()=>db.query('select inventory_tracker_reference_price_snapshot($1,$2) value',[ids.business,ids.branch]).then(r=>r.rows[0].value);
 const price=async(value)=>db.query('select inventory_tracker_reference_price_save($1,$2,$3,$4::jsonb)',[ids.business,ids.branch,crypto.randomUUID(),JSON.stringify({material_id:ids.material,price:value,unit:'1PC',note:'Fictional supplier',expected_revision:(await refs()).prices[0]?.revision||null})]);
 const input=async(act,extra={})=>({action:act,material_id:ids.material,expected_updated_at:(await snap()).materials[0].updated_at,expected_reference_revision:(await refs()).prices[0]?.revision,quantity:1,note:'Fictional test usage',...(act==='stock'?{}:{vehicle_id:ids.unit}),...extra});
 try{
  await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/074_inventory_reference_prices.sql'),'utf8'));
  const before=await f.snapshot();await db.exec(sql);
  await t.test('installation preserves every prior stock, usage and price record',async()=>{
   assert.deepEqual(await f.snapshot(),before);assert.equal((await snap()).basecoat,null);assert.equal((await refs()).prices.length,0);
  });
  await t.test('missing reference rejects; saved 12 price works on unvalued stock without opening setup',async()=>{
   await assert.rejects(action(await input('use')),/Set the price/);await price(12);
   await action(await input('use'));const s=await snap(),m=s.materials[0];
   assert.equal(m.quantity,9);assert.equal(m.new_qty,1);assert.equal(m.new_cost,12);assert.equal(m.cost_initialized,false);assert.equal(m.cost_value,null);
   assert.equal(s.history[0].unit_cost,12);assert.equal(s.history[0].measure_unit,'1PC');assert.equal(m.old_adjustment_qty,3);
   assert.equal((await snap(ids.released)).materials[0].new_qty,0);
  });
  await t.test('same request retried changes stock and usage exactly once',async()=>{
   const p=await input('use'),key=crypto.randomUUID();await action(p,key);assert.equal((await action(p,key)).duplicate,true);
   assert.equal((await snap()).materials[0].quantity,8);assert.equal((await snap()).materials[0].new_cost,24);
   await assert.rejects(action({...p,quantity:2},key),/different operation/);
  });
  await t.test('price edits affect future usage only; minus restores quantity and original saved price',async()=>{
   const old=(await snap()).history[0];await price(20);assert.equal((await snap()).materials[0].new_cost,24);
   await action(await input('use'));assert.equal((await snap()).materials[0].new_cost,44);
   await action(await input('return',{return_of:old.id}));const m=(await snap()).materials[0];assert.equal(m.quantity,8);assert.equal(m.new_cost,32);
   await assert.rejects(action(await input('return',{return_of:old.id})),/exceeds/);
  });
  await t.test('stale prices and stock cannot silently overwrite another session',async()=>{
   const stalePrice=await input('use');await price(25);const before=await snap();await assert.rejects(action(stalePrice),/price changed/);assert.deepEqual(await snap(),before);
   const staleStock=await input('use');await action(await input('stock',{quantity:11}));await assert.rejects(action(staleStock),/Stock changed/);
   assert.equal((await snap()).materials[0].quantity,11);
  });
  await t.test('zero price is valid and stock still decrements; no negative stock',async()=>{
   await price(0);await action(await input('use'));assert.equal((await snap()).materials[0].quantity,10);assert.equal((await snap()).materials[0].new_cost,32);
   await assert.rejects(action(await input('use',{quantity:11})),/Not enough stock/);
   for(const q of [null,-1,0,0.001,'NaN','Infinity',1000000000])await assert.rejects(action(await input('use',{quantity:q})));
  });
  await t.test('general stock can be replenished or corrected with no second price; usage unchanged',async()=>{
   const old=(await snap()).materials[0];await action(await input('stock',{quantity:0}));await action(await input('stock',{quantity:30}));const m=(await snap()).materials[0];
   assert.equal(m.quantity,30);assert.equal(m.new_qty,old.new_qty);assert.equal(m.new_cost,old.new_cost);assert.equal(m.cost_value,null);
  });
  await t.test('valued old stock remains consistent while usage follows reference price',async()=>{
   await f.action(await f.input('opening',{quantity:30,unit:'sheet',unit_cost:10}));await price(12);
   await action(await input('use',{quantity:2}));let s=await snap(),entry=s.history.find(x=>x.delta===2);
   assert.equal(s.materials[0].quantity,28);assert.equal(s.materials[0].cost_value,280);assert.equal(entry.cost_amount,24);assert.equal(entry.stock_cost_amount,20);
   await action(await input('return',{quantity:1,return_of:entry.id}));await action(await input('return',{quantity:1,return_of:entry.id}));
   s=await snap();assert.equal(s.materials[0].quantity,30);assert.equal(s.materials[0].cost_value,300);
  });
  await t.test('base coat 500mL costs 600 total, saves once and never moves stock',async()=>{
   const stock=(await snap()).materials,p={action:'basecoat',vehicle_id:ids.unit,quantity:500,unit:'mL',amount:600,expected_revision:null,note:'Fictional base coat'},key=crypto.randomUUID();
   await action(p,key);assert.equal((await action(p,key)).duplicate,true);const s=await snap();assert.equal(s.basecoat.liters,0.5);assert.equal(s.basecoat.amount,600);assert.deepEqual(s.materials,stock);
   assert.equal(api.model(s).total,api.model(s).materialsTotal+600);assert.equal((await snap(ids.released)).basecoat,null);
   await assert.rejects(action({...p,amount:700}),/changed in another session/);
  });
  await t.test('base coat edits replace the line; removal preserves audit and prevents stale resurrection',async()=>{
   const old=(await snap()).basecoat,p={action:'basecoat',vehicle_id:ids.unit,quantity:1.5,unit:'L',amount:1000,expected_revision:old.revision,note:'Fictional corrected quantity'};
   await action(p);let c=(await snap()).basecoat;assert.equal(c.liters,1.5);assert.equal(c.amount,1000);
   await action({action:'basecoat_remove',vehicle_id:ids.unit,expected_revision:c.revision,note:'Fictional remove'});assert.equal((await snap()).basecoat,null);
   await assert.rejects(action(p),/changed in another session/);
   assert.equal((await db.query("select count(*)::int n from inventory_tracker_simple_events where action like 'basecoat%'")).rows[0].n,3);
   for(const bad of [{quantity:0},{quantity:0.001},{amount:-1},{amount:1.001},{amount:'NaN'},{unit:'gallon'}])await assert.rejects(action({...p,expected_revision:null,...bad}));
  });
  await t.test('audit failure rolls back stock and usage together',async()=>{
   await db.exec("create function fail_simple_event() returns trigger language plpgsql as $$begin if new.payload->>'note'='FAIL TEST' then raise exception 'Simulated failure';end if;return new;end$$;create trigger simple_test_failure before insert on inventory_tracker_simple_events for each row execute function fail_simple_event()");
   const before=await snap();await assert.rejects(action(await input('use',{note:'FAIL TEST'})),/Simulated/);assert.deepEqual(await snap(),before);
   await assert.rejects(action({action:'basecoat',vehicle_id:ids.unit,quantity:1,unit:'L',amount:100,expected_revision:null,note:'FAIL TEST'}),/Simulated/);assert.equal((await snap()).basecoat,null);
  });
  await t.test('released units, wrong branches, view-only and anonymous writes are blocked',async()=>{
   await assert.rejects(action(await input('use',{vehicle_id:ids.released})),/read-only/);
   await assert.rejects(action(await input('use'),crypto.randomUUID(),ids.other),/unavailable/);
   await assert.rejects(action({action:'basecoat',vehicle_id:ids.released,quantity:1,unit:'L',amount:1,expected_revision:null,note:'Test'}),/read-only/);
   const p=await input('use');await db.query("select set_config('test.user',$1,false)",[ids.staff]);await assert.rejects(action(p),/edit access/);await assert.rejects(snap(ids.unit,ids.other),/access/);
   await db.exec('set role authenticated');await assert.rejects(db.exec('update inventory_tracker_basecoat set amount=1'),/permission denied/);await assert.rejects(db.exec('delete from inventory_tracker_simple_events'),/permission denied/);await db.exec('reset role');
   await db.exec('set role anon');await assert.rejects(action(p),/permission denied/);await assert.rejects(snap(),/permission denied/);await db.exec('reset role');
   await db.query("select set_config('test.user',$1,false)",[ids.user]);
  });
  await t.test('rerunning migration preserves snapshot and events',async()=>{
   const before=await snap(),events=(await db.query('select * from inventory_tracker_simple_events order by id')).rows;await db.exec(sql);assert.deepEqual(await snap(),before);assert.deepEqual((await db.query('select * from inventory_tracker_simple_events order by id')).rows,events);
  });
 }finally{await db.close()}
});
