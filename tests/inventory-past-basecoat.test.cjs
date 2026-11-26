const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../inventory-costing.js'),{setup,ids}=require('./helpers/inventory-cost-db.cjs');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/098_inventory_past_basecoat.sql'),'utf8');
const context={business:ids.business,branch:ids.branch,vehicle:ids.released};
const raw=(extra={})=>({version:1,simple_pricing_version:1,past_basecoat_version:1,business_id:ids.business,branch_id:ids.branch,vehicle:{id:ids.released,vehicle_name:'DEMO HONDA',plate_number:'TEST',released_at:'2026-10-01'},can_edit:true,materials:[],history:[],basecoat_history:[],...extra});
const report=(extra={})=>api.attachReferences(api.model(raw(extra)),{data:{version:1,business_id:ids.business,branch_id:ids.branch,prices:[],history:[]}});
const coat=(extra={})=>({vehicle_id:ids.released,business_id:ids.business,branch_id:ids.branch,quantity:500,measure_unit:'mL',liters:.5,amount:600,revision:'saved',...extra});
const values={quantity:500,unit:'mL',amount:600,note:'Historical receipt'};
test('past basecoat action is gated by release, edit access and installed migration',()=>{
 assert.match(api.reportHTML(report(),true),/Add past basecoat/);
 for(const extra of [{can_edit:false},{past_basecoat_version:undefined},{vehicle:{id:ids.released,released_at:null}}])assert.doesNotMatch(api.archiveBasecoatHTML(report(extra)),/data-ic-action="past_basecoat"/);
 assert.doesNotMatch(api.reportHTML(report(),false),/Add past basecoat/);
 assert.match(api.archiveBasecoatHTML(report({basecoat:coat()})),/Edit past basecoat/);
 assert.equal(api.archivePriceModel(report({basecoat:coat()})).total,600);
 assert.doesNotMatch(api.reportHTML(report({basecoat:coat()}),true),/data-ic-action="(?:use|return|basecoat|basecoat_remove)"/);
});
test('past basecoat payload validates input and scope; edits use revision rather than adding another line',()=>{
 const state={action:'past_basecoat',report:report(),context};
 assert.deepEqual(api.payloadFrom(state,values),{action:'past_basecoat',note:'Historical receipt',vehicle_id:ids.released,expected_revision:null,quantity:500,unit:'mL',amount:600});
 assert.equal(api.payloadFrom({...state,report:report({basecoat:coat()})},values).expected_revision,'saved');
 for(const bad of [{quantity:''},{quantity:0},{quantity:.001},{quantity:Infinity},{quantity:1e9},{amount:''},{amount:-1},{amount:Infinity},{amount:1.001},{unit:'gal'},{note:'x'},{note:'x'.repeat(1001)}])assert.throws(()=>api.payloadFrom(state,{...values,...bad}));
 for(const extra of [{can_edit:false},{past_basecoat_version:0},{vehicle:{id:ids.unit,released_at:'2026-10-01'}},{branch_id:ids.other},{business_id:ids.other},{vehicle:{id:ids.released}}])assert.throws(()=>api.payloadFrom({...state,report:report(extra)},values));
});
test('edit history displays before/after, timestamp and escaped note/account text',()=>{
 const r=report({basecoat:coat(),basecoat_history:[{recorded_at:'2026-11-26T02:00:00Z',recorded_by:'<script>user</script>',note:'<img src=x>',before_record:coat({amount:400}),after_record:coat()}]});
 const html=api.archiveBasecoatHTML(r);assert.match(html,/₱400.00/);assert.match(html,/₱600.00/);assert.match(html,/Manila/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<script|<img/);
});
test('form offers L/mL, consumed total, historical note and Save basecoat without a remove option',()=>{
 const source=fs.readFileSync(require.resolve('../inventory-costing.js'),'utf8'),submit={textContent:''};
 const box={formState:{action:'past_basecoat',report:report(),context},dialog:{innerHTML:'',querySelector:()=>submit},preview(){},esc:String,qty:String,money:String,button:()=>'<button>unexpected remove</button>'};
 vm.runInNewContext(source.slice(source.indexOf('  function field('),source.indexOf('  function ensureDialog('))+source.slice(source.indexOf('  function fillForm('),source.indexOf('  function preview(')),box);box.fillForm();
 assert.match(box.dialog.innerHTML,/Add past basecoat/);assert.match(box.dialog.innerHTML,/Milliliters/);assert.match(box.dialog.innerHTML,/TOTAL cost/);assert.match(box.dialog.innerHTML,/before this feature/);assert.doesNotMatch(box.dialog.innerHTML,/unexpected remove/);assert.equal(submit.textContent,'Save basecoat');
});
test('new server action is narrow and does not rewrite existing transaction handler',()=>{
 assert.doesNotMatch(sql,/create or replace function public.inventory_tracker_simple_action/);
 assert.doesNotMatch(sql,/(?:insert into|update|delete from) public\.(?:expenses|invoices|inventory_tracker_materials|inventory_tracker_adjustments|inventory_tracker_vehicles|inventory_tracker_usage)/i);
 assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/for update/);assert.match(sql,/before_record,after_record/);
});
test('past basecoat PostgreSQL workflow for both branches',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
 const f=await setup(),{db}=f,otherUnit='00000000-0000-4000-8000-000000000099';
 const snap=(vehicle=ids.released,branch=ids.branch)=>db.query('select inventory_tracker_simple_snapshot($1,$2,$3) value',[ids.business,branch,vehicle]).then(r=>r.rows[0].value);
 const save=(payload,key=crypto.randomUUID(),branch=ids.branch)=>db.query('select inventory_tracker_archive_basecoat_save($1,$2,$3,$4::jsonb) value',[ids.business,branch,key,JSON.stringify(payload)]).then(r=>r.rows[0].value);
 const input=(extra={})=>({action:'past_basecoat',vehicle_id:ids.released,quantity:500,unit:'mL',amount:600,expected_revision:null,note:'Fictional historical cost',...extra});
 const fingerprint=async()=>{
  const tables=['inventory_tracker_materials','inventory_tracker_vehicles','inventory_tracker_usage','inventory_tracker_usage_lines','inventory_tracker_adjustments','inventory_tracker_reference_prices'];
  return Promise.all(tables.map(table=>db.query(`select * from ${table} order by id`).then(r=>r.rows).catch(async e=>{if(table==='inventory_tracker_reference_prices')return (await db.query('select * from inventory_tracker_reference_prices order by material_id')).rows;throw e})));
 };
 try{
  for(const file of ['074_inventory_reference_prices.sql','091_inventory_simple_prices.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../supabase',file),'utf8'));
  await db.query('insert into inventory_tracker_vehicles(id,business_id,branch_id,vehicle_name,plate_number,released_at) values($1,$2,$3,$4,$5,now())',[otherUnit,ids.business,ids.other,'OTHER BRANCH DEMO','OTHER']);
  const initial=await fingerprint();await db.exec(sql);
  await t.test('installation preserves all existing data',async()=>{assert.deepEqual(await fingerprint(),initial);assert.equal((await snap()).past_basecoat_version,1);assert.deepEqual((await snap()).basecoat_history,[])});
  await t.test('save/retry creates one line and one event; no stock, usage, prices or unit changes',async()=>{
   const p=input(),key=crypto.randomUUID();await save(p,key);assert.equal((await save(p,key)).duplicate,true);
   const s=await snap();assert.equal(s.basecoat.liters,.5);assert.equal(s.basecoat.amount,600);assert.equal(s.basecoat_history.length,1);assert.equal(s.basecoat_history[0].before_record,null);assert.equal(s.basecoat_history[0].recorded_by,ids.user);
   assert.deepEqual(await fingerprint(),initial);await assert.rejects(save({...p,amount:800},key),/different operation/);
  });
  await t.test('editing replaces one saved line and stale concurrent changes cannot overwrite it',async()=>{
   const p=input({quantity:1.5,unit:'L',amount:900,expected_revision:(await snap()).basecoat.revision});await save(p);
   const s=await snap();assert.equal(s.basecoat.liters,1.5);assert.equal(s.basecoat.amount,900);assert.equal(s.basecoat_history.length,2);assert.equal(s.basecoat_history[0].before_record.amount,600);assert.equal(s.basecoat_history[0].after_record.amount,900);
   await assert.rejects(save(p),/changed in another session/);await assert.rejects(save(input()),/changed in another session/);
   assert.equal((await db.query('select count(*)::int n from inventory_tracker_basecoat where vehicle_id=$1',[ids.released])).rows[0].n,1);
  });
  await t.test('second branch can save independently; cross-branch unit targeting is rejected',async()=>{
   await save(input({vehicle_id:otherUnit,quantity:1,unit:'L',amount:100}),crypto.randomUUID(),ids.other);
   assert.equal((await snap(otherUnit,ids.other)).basecoat.amount,100);assert.equal((await snap()).basecoat.amount,900);
   await assert.rejects(save(input({vehicle_id:otherUnit})),/unavailable/);await assert.rejects(snap(otherUnit),/unavailable|not found|branch/i);
  });
  await t.test('only released basecoat cost can change; old released usage guard stays intact',async()=>{
   await assert.rejects(save(input({vehicle_id:ids.unit})),/only available for released/);
   await assert.rejects(save(input({action:'stock'})),/valid past basecoat/);
   await assert.rejects(db.query('select inventory_tracker_simple_action($1,$2,$3,$4::jsonb)',[ids.business,ids.branch,crypto.randomUUID(),JSON.stringify(input({action:'basecoat'}))]),/read-only/);
  });
  await t.test('invalid quantities, costs, units and notes are rejected without changes',async()=>{
   const before=await snap();for(const bad of [{quantity:null},{quantity:0},{quantity:.001},{quantity:'Infinity'},{amount:null},{amount:-1},{amount:'NaN'},{amount:1.001},{unit:'gallon'},{note:'x'},{note:'x'.repeat(1001)}])await assert.rejects(save(input({expected_revision:before.basecoat.revision,...bad})));
   assert.deepEqual(await snap(),before);
  });
  await t.test('audit failure rolls back the basecoat edit atomically',async()=>{
   await db.exec("create function fail_past_event() returns trigger language plpgsql as $$begin if new.payload->>'note'='FAIL TEST' then raise exception 'Simulated audit failure';end if;return new;end$$;create trigger past_test_failure before insert on inventory_tracker_simple_events for each row execute function fail_past_event()");
   const before=await snap();await assert.rejects(save(input({expected_revision:before.basecoat.revision,note:'FAIL TEST'})),/Simulated/);assert.deepEqual(await snap(),before);
  });
  await t.test('view-only, anonymous, wrong branch and direct writes cannot bypass the function',async()=>{
   const p=input({expected_revision:(await snap()).basecoat.revision});
   await db.query("select set_config('test.user',$1,false)",[ids.staff]);await assert.rejects(save(p),/edit access/);await assert.rejects(snap(otherUnit,ids.other),/access/);
   await db.exec('set role authenticated');await assert.rejects(db.exec('update inventory_tracker_basecoat set amount=1'),/permission denied/);await assert.rejects(db.exec('delete from inventory_tracker_simple_events'),/permission denied/);await db.exec('reset role');
   await db.exec('set role anon');await assert.rejects(save(p),/permission denied/);await assert.rejects(snap(),/permission denied/);await db.exec('reset role');await db.query("select set_config('test.user',$1,false)",[ids.user]);
  });
  await t.test('rerun preserves both branches, history and all unrelated inventory data',async()=>{
   const before=await snap(),other=await snap(otherUnit,ids.other);await db.exec(sql);assert.deepEqual(await snap(),before);assert.deepEqual(await snap(otherUnit,ids.other),other);assert.deepEqual(await fingerprint(),initial);
  });
 }finally{await db.close()}
});
