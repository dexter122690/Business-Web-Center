const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../inventory-costing.js');
const context={business:'business',branch:'rosa',vehicle:'car'};
const material=(extra={})=>({id:'sand',item_name:'Liha 120',quantity:99,new_qty:0,new_cost:0,old_adjustment_count:3,old_adjustment_qty:3,old_usage_count:0,old_usage_qty:0,...extra});
const snapshot=(materials=[material()],extra={})=>({version:1,simple_pricing_version:1,business_id:context.business,branch_id:context.branch,vehicle:{id:context.vehicle,released_at:'2026-11-10'},materials,history:[],can_edit:true,...extra});
const reference=(id='sand',price=12,extra={})=>({material_id:id,price,price_unit:'1PC',revision:'r1',business_id:context.business,branch_id:context.branch,...extra});
const prices=(rows=[reference()])=>({data:{version:1,business_id:context.business,branch_id:context.branch,prices:rows,history:[]}});
const report=(raw=snapshot(),refs=prices())=>api.attachReferences(api.model(raw),refs);

test('past +/- usage uses present price, not current stock, without writing original quantities or costs',()=>{
 const r=report(),before=JSON.stringify(r),estimate=api.archivePriceModel(r);
 assert.equal(estimate.rows[0].quantity,3);assert.equal(estimate.rows[0].price,12);assert.equal(estimate.rows[0].cost,36);assert.equal(estimate.total,36);
 assert.equal(JSON.stringify(r),before);assert.equal(r.total,0);assert.equal(r.data.materials[0].quantity,99);
 const html=api.reportHTML(r,true);assert.match(html,/Current price \/ stock item/);assert.match(html,/₱36.00/);assert.match(html,/Original saved costs \(unchanged\)/);
 assert.doesNotMatch(api.reportHTML(r,false),/current-price estimate/);
});
test('all used materials are repriced for the estimate while saved actual costs remain intact',()=>{
 const raw=snapshot([material({new_qty:2,new_cost:40}),material({id:'other',item_name:'Tape',old_adjustment_qty:2})]);
 const r=report(raw,prices([reference(),reference('other',28)])),e=api.archivePriceModel(r);
 assert.equal(e.rows[0].quantity,5);assert.equal(e.rows[0].cost,60);assert.equal(e.total,116);assert.equal(r.total,40);
 const changed=report(raw,prices([reference('sand',20),reference('other',30)]));assert.equal(api.archivePriceModel(changed).total,160);assert.equal(changed.total,40);
});
test('legacy usage-only is costed and overlapping equal logs are counted once',()=>{
 for(const old_adjustment_count of [0,3]){
  const e=api.archivePriceModel(report(snapshot([material({old_usage_qty:3,old_usage_count:1,old_adjustment_count,new_qty:1,new_cost:5})])));
  assert.equal(e.rows[0].quantity,4);assert.equal(e.total,48);assert.equal(e.incomplete,false);
 }
});
test('conflicting and negative legacy quantities are visible, not guessed or added twice',()=>{
 for(const m of [material({old_usage_count:1,old_usage_qty:5}),material({old_adjustment_qty:-1})]){
  const r=report(snapshot([m])),e=api.archivePriceModel(r);assert.equal(e.rows[0].quantity,null);assert.equal(e.rows[0].cost,null);assert.equal(e.unresolved,1);assert.equal(e.incomplete,true);
  assert.match(api.archivePriceHTML(r),/Priced subtotal · incomplete/);assert.match(api.archivePriceHTML(r),/Not included/);
 }
});
test('verified past quantity overrides duplicate legacy sources and adds new net usage only once',()=>{
 const r=report(snapshot([material({old_usage_count:1,old_usage_qty:6,new_qty:2,new_cost:20,baseline:{quantity:4,amount:40,unit_cost:10,measure_unit:'sheet'}})]));
 const e=api.archivePriceModel(r);assert.equal(e.rows[0].quantity,6);assert.equal(e.total,72);assert.equal(r.total,60);
});
test('missing prices are excluded and flagged, zero prices are valid, unused materials add nothing',()=>{
 const raw=snapshot([material(),material({id:'missing',item_name:'Tape'}),material({id:'unused',old_adjustment_count:0,old_adjustment_qty:0})]);
 const r=report(raw,prices([reference('sand',0)])),e=api.archivePriceModel(r);
 assert.equal(e.rows.length,2);assert.equal(e.rows[0].cost,0);assert.equal(e.rows[1].cost,null);assert.equal(e.missing,1);
 assert.match(api.archivePriceHTML(r),/Price not set/);assert.match(api.archivePriceHTML(r),/1 material\(s\) have no saved price/);
 const zero=api.archivePriceModel(report(snapshot([material({old_adjustment_qty:0})]),prices([])));assert.equal(zero.total,0);assert.equal(zero.incomplete,false);
});
test('a price-load failure or wrong branch never presents a misleading zero estimate',()=>{
 for(const refs of [{error:{message:'Network down'}},prices([reference('sand',12,{branch_id:'wrong'})]),{data:{...prices().data,branch_id:'wrong'}}]){
  const r=report(snapshot(),refs);assert.equal(api.archivePriceModel(r).unavailable,true);
  const html=api.archivePriceHTML(r);assert.match(html,/estimate unavailable/);assert.match(html,/No estimate is shown/);assert.doesNotMatch(html,/₱0.00/);
 }
});
test('fractional stock/package quantities and four-decimal prices round line-by-line to centavos',()=>{
 const raw=snapshot([material({old_adjustment_qty:0.3}),material({id:'two',old_adjustment_qty:0.5})]);
 const r=report(raw,prices([reference('sand',3.35),reference('two',2.01,{price_unit:'1L'})])),e=api.archivePriceModel(r);
 assert.equal(e.rows[0].cost,1.01);assert.equal(e.rows[1].cost,1.01);assert.equal(e.total,2.02);
 const packageReport=report(snapshot([material({old_adjustment_qty:2})]),prices([reference('sand',162,{price_unit:'200PCS'})]));
 assert.equal(api.archivePriceModel(packageReport).total,324);assert.match(api.archivePriceHTML(packageReport),/per 200PCS/);
});
test('custom base coat is added once using its saved total, never multiplied by mL or stock price',()=>{
 const basecoat={vehicle_id:'car',business_id:'business',branch_id:'rosa',revision:'b1',quantity:500,measure_unit:'mL',amount:600};
 const r=report(snapshot(undefined,{basecoat})),e=api.archivePriceModel(r);
 assert.equal(e.materialsTotal,36);assert.equal(e.total,636);assert.match(api.archivePriceHTML(r),/500 mL/);assert.match(api.archivePriceHTML(r),/Saved cost for the quantity used, not repriced/);
});
test('empty units, unsafe values, escaped labels and read-only controls',()=>{
 const empty=report(snapshot([]),prices([]));assert.equal(api.archivePriceModel(empty).total,0);assert.match(api.archivePriceHTML(empty),/No material usage/);
 const r=report(snapshot([material({item_name:'<img onerror=x>'})]),prices([reference('sand',12,{price_unit:'<script>'})]));
 const html=api.reportHTML(r,true);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img|<script|data-ic-action="(?:use|return|baseline|reference|basecoat)"/);
 for(const m of [material({old_adjustment_qty:null}),material({old_adjustment_count:-1}),material({old_usage_count:0.5}),material({old_adjustment_qty:9000000000})]){
  assert.throws(()=>api.archivePriceModel(report(snapshot([m]))));
 }
});

function harness(){
 const code=fs.readFileSync(require.resolve('../inventory-costing.js'),'utf8'),mount={isConnected:true,innerHTML:''},calls=[];
 const box={...api,context,Error,JSON,scope:()=>box.context,same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),esc:String,button:()=>'<button>Try again</button>',
  root:{document:{createElement:()=>mount}},client:()=>({rpc:async(name,args)=>{calls.push({name,args});return box.response(name)}}),
  response:async name=>name==='inventory_tracker_simple_snapshot'?{data:snapshot()}:prices()};
 vm.runInNewContext(code.slice(code.indexOf('  async function read(context)'),code.indexOf('  function attachReferences('))+code.slice(code.indexOf('  async function renderArchive('),code.indexOf('  function field(')),box);
 return {box,mount,calls,container:{querySelector(){return null},prepend(){}}};
}
test('opening and refreshing archive read current branch prices without any write calls',async()=>{
 const {box,mount,calls,container}=harness();await box.renderArchive(container,context);assert.match(mount.innerHTML,/₱36.00/);
 box.response=async name=>name==='inventory_tracker_simple_snapshot'?{data:snapshot()}:prices([reference('sand',20)]);
 await box.renderArchive(container,context);assert.match(mount.innerHTML,/₱60.00/);
 assert.deepEqual(calls.map(x=>x.name),['inventory_tracker_simple_snapshot','inventory_tracker_reference_price_snapshot','inventory_tracker_simple_snapshot','inventory_tracker_reference_price_snapshot']);
 for(const c of calls){assert.equal(c.args.p_business_id,'business');assert.equal(c.args.p_branch_id,'rosa');}
});
test('archive read guards prevent wrong-unit, reactivated, stale and failed reads from showing totals',async()=>{
 for(const mode of ['wrong-unit','active','stale','closed','error']){
  const {box,mount,container}=harness();box.response=async name=>{
   if(mode==='error')return {error:{message:'Unavailable'}};
   if(name==='inventory_tracker_reference_price_snapshot'){if(mode==='stale')box.context={...context,branch:'other'};if(mode==='closed')mount.isConnected=false;return prices();}
   return {data:snapshot(undefined,{vehicle:{id:mode==='wrong-unit'?'other':'car',released_at:mode==='active'?null:'2026-11-10'}})};
  };
  await box.renderArchive(container,context);assert.doesNotMatch(mount.innerHTML,/₱36.00|Released unit current-price costing/);
 }
});
