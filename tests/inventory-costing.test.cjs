const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../inventory-costing.js');
const material=(extra={})=>({id:'sand',item_name:'Liha 120',quantity:37,measure_unit:'sheet',cost_initialized:true,cost_value:573.5,stock_unit_cost:15.5,updated_at:'2026-11-22T01:00:00Z',new_qty:3,new_cost:46.5,old_adjustment_qty:0,old_adjustment_count:0,old_usage_qty:0,old_usage_count:0,baseline:null,...extra});
const snapshot=(materials=[material()],extra={})=>({version:1,business_id:'business',branch_id:'branch',vehicle:{id:'car',vehicle_name:'HONDA CITY',plate_number:'ZFF 245'},can_edit:true,materials,history:[{id:'entry',material_id:'sand',delta:3,cost_amount:46.5,unit_cost:15.5,material_name:'Liha 120',measure_unit:'sheet',recorded_at:'2026-11-22T01:00:00Z',cost_note:'Used'}],purchases:[],...extra});
const priced=(s=snapshot())=>api.attachReferences(api.model(s),{data:{version:1,business_id:'business',branch_id:'branch',prices:[{material_id:'sand',business_id:'business',branch_id:'branch',price:12,price_unit:'1PC',revision:'r1'}],history:[]}});
test('unit total uses saved usage, never current stock or current supplier price',()=>{
 const s=snapshot([material({stock_unit_cost:50,cost_value:1850})]),r=api.model(s);assert.equal(r.total,46.5);assert.equal(r.rows[0].rate,15.5);assert.match(api.reportHTML(r),/₱46.50/);assert.doesNotMatch(api.reportHTML(r),/₱150.00/);
});
test('unpriced legacy sources stay separate and make totals explicitly incomplete',()=>{
 const r=api.model(snapshot([material({old_adjustment_count:2,old_adjustment_qty:3,old_usage_count:1,old_usage_qty:3})]));assert.equal(r.total,46.5);assert.equal(r.unknown,1);assert.equal(r.rows[0].quantity,3);assert.match(api.reportHTML(r),/Known materials cost · incomplete/);assert.match(api.reportHTML(r),/Not added together/);assert.match(api.reportHTML(r),/older usage without a recorded cost/);
});
test('verified past usage is added once, not twice from historical sources',()=>{
 const r=api.model(snapshot([material({old_adjustment_count:1,old_usage_count:1,old_adjustment_qty:3,old_usage_qty:3,baseline:{quantity:3,amount:36,unit_cost:12,measure_unit:'sheet',note:'Receipt',recorded_at:'2026-11-22'}})]));assert.equal(r.total,82.5);assert.equal(r.rows[0].quantity,6);assert.equal(r.rows[0].rate,13.75);assert.equal(r.unknown,0);
});
test('mixed quantities remain separate by measurement unit',()=>{
 const r=api.model(snapshot([material(),material({id:'paint',item_name:'Topcoat',measure_unit:'liter',new_qty:0.25,new_cost:62.5})]));assert.equal(r.total,109);assert.equal(r.used.length,2);assert.match(r.quantities,/3 sheet/);assert.match(r.quantities,/0.25 liter/);assert.doesNotMatch(r.quantities,/3.25/);
});
test('total equals displayed line totals at centavo rounding boundaries',()=>{
 const r=api.model(snapshot([material({new_cost:1.005}),material({id:'other',new_cost:1.005})]));assert.equal(r.total,2.02);
});
test('zero-price verified materials are not confused with missing prices',()=>{
 const r=api.model(snapshot([material({new_qty:3,new_cost:0})]));assert.equal(r.total,0);assert.equal(r.unknown,0);assert.match(api.reportHTML(r),/₱0.00/);
});
test('empty units show no invented material costs',()=>{
 const r=api.model(snapshot([material({new_qty:0,new_cost:0})],{history:[]}));assert.equal(r.used.length,0);assert.match(api.reportHTML(r),/No material usage/);
});
test('invalid snapshots and duplicate IDs fail closed',()=>{
 for(const s of [null,{},snapshot([material(),material()]),snapshot([material({new_cost:null})]),snapshot([material({new_cost:-1})]),snapshot([material({new_qty:-1})])])assert.throws(()=>api.model(s));
});
test('names, supplier fields, notes and units cannot inject markup',()=>{
 const r=api.model(snapshot([material({item_name:'<img src=x>',measure_unit:'<script>'})],{purchases:[{action:'purchase',material_id:'sand',quantity:1,amount:12,supplier:'<script>',receipt:'<img>',note:'<svg>',recorded_at:'2026-11-22'}]}));const html=api.reportHTML(r)+api.stockHTML(r);assert.doesNotMatch(html,/<img|<script|<svg/);assert.match(html,/&lt;img/);
});
test('read-only staff and released units do not get stock-usage controls',()=>{
 assert.doesNotMatch(api.reportHTML(api.model(snapshot(undefined,{can_edit:false}))),/data-ic-action="use"|data-ic-action="return"/);
 assert.doesNotMatch(api.reportHTML(api.model(snapshot()),true),/data-ic-action="use"|data-ic-action="return"/);
});
test('payload binds exact material, unit, branch-context vehicle and expected stock version',()=>{
 const r=priced(),state={action:'use',report:r,context:{vehicle:'car'}};
 const p=api.payloadFrom(state,{material_id:'sand',quantity:'0.25',note:'Prep'});assert.equal(p.vehicle_id,'car');assert.equal(p.quantity,0.25);assert.equal(p.expected_updated_at,r.rows[0].material.updated_at);
 for(const quantity of ['',null,-1,0,0.001,'bad'])assert.throws(()=>api.payloadFrom(state,{material_id:'sand',quantity,note:'Prep'}));
 assert.throws(()=>api.payloadFrom(state,{material_id:'otherbranch',quantity:1,note:'Prep'}));
});
test('historical verification requires explicit confirmation and supporting note',()=>{
 const state={action:'baseline',report:api.model(snapshot()),context:{vehicle:'car'}},v={material_id:'sand',quantity:3,unit_cost:12,unit:'sheet',note:'Receipt'};
 assert.throws(()=>api.payloadFrom(state,v));const p=api.payloadFrom(state,{...v,confirmed:'on'});assert.equal(p.confirmed,true);assert.equal(p.unit_cost,12);
});
test('new purchases require actual receipt information',()=>{
 const s={action:'purchase',report:api.model(snapshot()),context:{}},v={material_id:'sand',quantity:10,unit_cost:20,unit:'sheet',note:'Receipt'};
 assert.throws(()=>api.payloadFrom(s,v));assert.equal(api.payloadFrom(s,{...v,supplier:'A',receipt:'1',purchase_date:'2026-11-21'}).unit_cost,20);
});
test('new feature is versioned and no client directly changes stock tables',()=>{
 const root=path.join(__dirname,'..'),code=fs.readFileSync(path.join(root,'inventory-costing.js'),'utf8'),index=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');new vm.Script(code);
 assert.doesNotMatch(code,/\.(insert|update|delete|upsert)\s*\(/);assert.match(code,/inventory_tracker_cost_action/);assert.match(code,/state\.retryPayload/);assert.match(code,/BroadcastChannel/);
 assert.ok(index.indexOf('inventory-costing.js?v=')<index.indexOf('inventory-tracker.js?v='));assert.match(sw,/inventory-costing.js\?v=20261126-archive-prices/);
});

test('quick + records exactly one item with the same atomic costing writer',()=>{
 const report=priced(),p=api.quickPayload(report,{vehicle:'car'},'sand',1);
 assert.equal(p.action,'use');assert.equal(p.quantity,1);assert.equal(p.vehicle_id,'car');assert.equal(p.material_id,'sand');assert.equal(p.expected_updated_at,material().updated_at);
 assert.equal(p.unit_cost,undefined);assert.equal(p.expected_reference_revision,'r1');assert.match(p.note,/Quick \+/);
});

test('quick buttons reject missing prices, insufficient stock, released units and view-only access',()=>{
 assert.throws(()=>api.quickPayload(api.model(snapshot([material({cost_initialized:false})])),{vehicle:'car'},'sand',1),/Set the price/);
 assert.equal(api.quickPayload(priced(snapshot([material({cost_initialized:false})])),{vehicle:'car'},'sand',1).quantity,1);
 assert.throws(()=>api.quickPayload(priced(snapshot([material({quantity:0.5})])),{vehicle:'car'},'sand',1),/Not enough stock/);
 for(const extra of [{can_edit:false},{vehicle:{id:'car',released_at:'2026-11-22'}},{vehicle:null}])assert.throws(()=>api.quickPayload(api.model(snapshot(undefined,extra)),{vehicle:'car'},'sand',1));
 assert.throws(()=>api.quickPayload(api.model(snapshot()),{vehicle:'other'},'sand',1));
 assert.throws(()=>api.quickPayload(api.model(snapshot()),{vehicle:'car'},'other',1));
 assert.throws(()=>api.quickPayload(api.model(snapshot()),{vehicle:'car'},'sand',2));
});

test('quick minus reverses the newest original usage, not current stock price or legacy history',()=>{
 const original=snapshot().history[0],history=[original,{...original,id:'new',delta:1,unit_cost:20,cost_amount:20,recorded_at:'2026-11-23T01:00:00Z'}];
 let report=api.model(snapshot(undefined,{history})),p=api.quickPayload(report,{vehicle:'car'},'sand',-1);
 assert.equal(p.action,'return');assert.equal(p.return_of,'new');assert.equal(p.quantity,1);assert.equal(p.unit_cost,undefined);
 history.push({...original,id:'return',delta:-0.75,return_of:'new',recorded_at:'2026-11-24T01:00:00Z'});
 report=api.model(snapshot(undefined,{history}));assert.equal(api.quickPayload(report,{vehicle:'car'},'sand',-1).quantity,0.25);
 history.push({...original,id:'return2',delta:-0.25,return_of:'new',recorded_at:'2026-11-24T02:00:00Z'});
 assert.equal(api.quickPayload(api.model(snapshot(undefined,{history})),{vehicle:'car'},'sand',-1).return_of,'entry');
 assert.throws(()=>api.quickPayload(api.model(snapshot([material({old_adjustment_count:1,old_adjustment_qty:3})],{history:[]})),{vehicle:'car'},'sand',-1),/Older usage records are preserved/);
});

test('original rows and general inventory remain; pricing and unit costs are separate collapsed sections',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../inventory-costing.js'),'utf8');
 assert.doesNotMatch(code,/old\.replaceWith\(mount\)|general\.replaceWith|card\.textContent=report\.used/);
 assert.match(code,/mount\.className='ic-unit ic-cost-panel'/);assert.match(code,/stock\.className='ic-stock ic-pricing'/);
 assert.match(code,/quickStep\(step\.dataset\.itUnitPlus/);assert.match(code,/root\.sessionStorage\.setItem\(quickStorageKey/);
});

function quickHarness(){
 const code=fs.readFileSync(path.join(__dirname,'../inventory-costing.js'),'utf8'),start=code.indexOf('  function selectedContext()'),end=code.indexOf('  function showPricing()',start);
 const context={business:'business',branch:'branch',vehicle:'car'},storage=new Map(),calls=[];
 const box={quickPending:null,quickMessage:null,saving:false,quickStorageKey:'test',current:null,Math,JSON,Number,Error,Promise,
  num:Number,qty:String,button:()=>'',esc:String,payloadFrom:api.payloadFrom,same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),scope:()=>box.context,
  context,read:async()=>priced(),changed:()=>{box.refreshed=(box.refreshed||0)+1},client:()=>({rpc:async(name,args)=>{calls.push(args);return box.response(args)}}),response:async()=>({data:{ok:true}}),
  root:{document:{getElementById:()=>null},BWCInventoryTracker:{context:()=>box.context},sessionStorage:{setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID:()=> 'fixed-id'}}};
 vm.runInNewContext(code.slice(start,end),box);return {box,storage,calls};
}

test('lost quick-save response retries the exact payload/key and blocks additional clicks',async()=>{
 const {box,storage,calls}=quickHarness();box.response=async()=>{throw Error('Network lost')};await box.quickStep('sand',1,false);
 assert.ok(box.quickPending);assert.equal(storage.size,1);assert.equal(calls.length,1);
 await box.quickStep('sand',1,false);assert.equal(calls.length,1);
 box.response=async()=>({data:{ok:true,duplicate:true}});await box.quickStep(null,0,true);
 assert.deepEqual(calls[1],calls[0]);assert.equal(box.quickPending,null);assert.equal(storage.size,0);assert.equal(box.refreshed,1);
});

test('rapid quick clicks serialize, server rejections clear pending state, branch changes before reading abort',async()=>{
 const {box,calls}=quickHarness();let release;box.response=()=>new Promise(r=>release=r);
 const first=box.quickStep('sand',1,false);await new Promise(r=>setImmediate(r));await box.quickStep('sand',1,false);assert.equal(calls.length,1);
 release({error:{code:'P0001',message:'Stock changed'}});await first;assert.equal(box.quickPending,null);assert.equal(box.refreshed,undefined);
 box.read=async()=>{box.context={...box.context,vehicle:'other'};return api.model(snapshot())};await box.quickStep('sand',1,false);assert.equal(calls.length,1);assert.match(box.quickMessage.text,/selected unit changed/);
});
test('tracker reads every page, including a server cap smaller than the requested page',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../inventory-tracker.js'),'utf8'),start=source.indexOf('  async function readTrackerRows('),end=source.indexOf('  async function load(){',start);
 let mode='ok',branch='branch';
 const all=Array.from({length:1205},(_,i)=>({id:String(i),business_id:'business',branch_id:'branch'}));
 const box={Set,Number,Error,biz:()=> 'business',branch:()=>branch,db:{from(){
  let offset;return {
   select(){return this},eq(){return this},order(){return this},range(a){offset=a;return this},
   then(ok){
    let data=all.slice(offset,offset+200),count=all.length;
    if(offset){if(mode==='error')return Promise.resolve({error:Error('Read failed')}).then(ok);if(mode==='count')count++;if(mode==='duplicate')data[0]=all[0];if(mode==='scope')data[0]={...data[0],branch_id:'wrong'};if(mode==='empty')data=[];if(mode==='stale')branch='other';}
    return Promise.resolve({data,count}).then(ok);
   }
  };
 }}};
 vm.runInNewContext(source.slice(start,end)+';read=readTrackerRows;',box);assert.equal((await box.read('table',{business:'business',branch:'branch'},'created_at')).length,1205);
 for(mode of ['error','count','duplicate','scope','empty','stale']){branch='branch';await assert.rejects(box.read('table',{business:'business',branch:'branch'},'created_at'));}
});
