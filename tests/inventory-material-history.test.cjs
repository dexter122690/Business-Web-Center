const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../inventory-material-history.js'),root=path.join(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x));
const context={business:'biz',branch:'rosa',vehicle:'swift'};
const vehicle={id:'swift',business_id:'biz',branch_id:'rosa',vehicle_name:'SWIFT',plate_number:'NDF4074',released_at:'2026-10-31T17:00:00Z',updated_at:'2026-10-31T17:00:00Z'};
const usage={id:'usage-1',business_id:'biz',branch_id:'rosa',vehicle_id:'swift',recorded_at:'2026-10-20T02:00:00Z'};
const line=(id,extra={})=>Object.assign({id:'line-'+id,business_id:'biz',branch_id:'rosa',usage_id:usage.id,material_id:'sand',material_name:'Liha 120',quantity:2,created_at:'2026-10-20T02:00:00Z',inventory_tracker_usage:copy(usage)},extra);
const adjustment=(id,extra={})=>Object.assign({id:'adjust-'+id,business_id:'biz',branch_id:'rosa',vehicle_id:'swift',material_id:'sand',material_name:'Liha 120',delta:1,recorded_at:'2026-10-21T02:00:00Z'},extra);
function client(data){
 const calls=[];let responder=null,cap=500;
 return {calls,setResponse:fn=>responder=fn,setCap:n=>cap=n,from(table){
  const call={table,filters:[],order:[]};calls.push(call);
  return {select(fields,opts){call.fields=fields;call.count=opts?.count;return this},eq(k,v){call.filters.push([k,v]);return this},order(k,v){call.order.push([k,v]);return this},range(a,b){call.range=[a,b];return this},maybeSingle(){call.single=true;return this},then(ok,fail){
   const read=(row,key)=>key.split('.').reduce((v,k)=>v?.[k],row);
   const matches=(data[table]||[]).filter(r=>call.filters.every(([k,v])=>read(r,k)===v));
   const result={data:copy(call.single?matches[0]||null:call.range?matches.slice(call.range[0],Math.min(call.range[1]+1,call.range[0]+cap)):matches),count:matches.length,error:null};
   return Promise.resolve().then(()=>responder?responder(call,result):result).then(ok,fail);
  }};
 }};
}
function fixture(lines=[line(1)],adjustments=[adjustment(1),adjustment(2,{delta:-0.5})]){return {inventory_tracker_vehicles:[copy(vehicle)],inventory_tracker_usage_lines:lines,inventory_tracker_adjustments:adjustments}}
test('released archive summary preserves usage and plus/minus logs separately',async()=>{
 const data=fixture(),before=JSON.stringify(data),c=client(data),report=await api.readRecords(c,context);
 assert.equal(report.summary.length,1);assert.equal(report.summary[0].recorded,2);assert.equal(report.summary[0].added,1);assert.equal(report.summary[0].reduced,0.5);assert.equal(report.summary[0].net,0.5);assert.equal(report.records.length,3);assert.equal(report.mixed,true);assert.equal(JSON.stringify(data),before);
 assert.match(api.html(report),/they are not added together/);assert.doesNotMatch(api.html(report),/Total used.*2.5/);
});
test('signed fractional adjustments use exact hundredths and retain zero-net materials',()=>{
 const report=api.model(vehicle,[],[adjustment(1,{delta:0.1}),adjustment(2,{delta:0.2}),adjustment(3,{delta:-0.3})]);
 assert.equal(report.summary[0].net,0);assert.equal(report.summary[0].added,0.3);assert.equal(report.records.length,3);assert.match(api.html(report),/Quantity reduced/);
});
test('negative adjustment totals are visible and flagged, not silently clamped',()=>{
 const r=api.model(vehicle,[],[adjustment(1,{delta:-2})]);assert.equal(r.summary[0].net,-2);assert.equal(r.negative,true);assert.match(api.html(r),/shown as saved, not changed to zero/);
});
test('historical names remain in records while different material IDs are not merged',()=>{
 const r=api.model(vehicle,[line(1,{material_name:'Old name'})],[adjustment(1,{material_name:'New name'}),adjustment(2,{material_id:'other',material_name:'New name'})]);
 assert.equal(r.summary.length,2);assert.equal(r.summary.find(x=>x.id==='sand').name,'New name');assert.ok(r.records.some(x=>x.name==='Old name'));
});
test('empty archive reports no records rather than inventing stock quantities',async()=>{
 const c=client(fixture([],[])),r=await api.readRecords(c,context);assert.equal(r.summary.length,0);assert.match(api.html(r),/No saved material usage/);assert.ok(!c.calls.some(q=>q.table==='inventory_tracker_materials'));
});
test('every query is scoped to the business, branch and exact vehicle',async()=>{
 const c=client(fixture());await api.readRecords(c,context);
 for(const q of c.calls){assert.ok(q.filters.some(([k,v])=>k==='business_id'&&v==='biz'));assert.ok(q.filters.some(([k,v])=>k==='branch_id'&&v==='rosa'));
  assert.ok(q.filters.some(([k,v])=>['id','vehicle_id','inventory_tracker_usage.vehicle_id'].includes(k)&&v==='swift'));
  if(q.range){assert.equal(q.count,'exact');assert.equal(q.order.at(-1)[0],'id')}
 }
});
test('complete history loads more than 1000 rows even with a smaller server cap',async()=>{
 const c=client(fixture(Array.from({length:1007},(_,i)=>line(i,{quantity:0.25})),Array.from({length:1205},(_,i)=>adjustment(i,{delta:0.01}))));c.setCap(200);
 const r=await api.readRecords(c,context);assert.equal(r.records.length,2212);assert.equal(r.summary[0].recorded,251.75);assert.equal(r.summary[0].net,12.05);assert.equal((api.html(r).match(/data-imh-record=/g)||[]).length,2212);
});
for(const kind of ['error','exception','count-change','count-missing','empty-page','duplicate','wrong-branch','wrong-unit','wrong-parent'])test('incomplete/unsafe history rejects: '+kind,async()=>{
 const c=client(fixture(Array.from({length:501},(_,i)=>line(i)),[]));
 c.setResponse((q,r)=>{if(q.table!=='inventory_tracker_usage_lines'||q.range[0]!==500)return r;
  if(kind==='error')return {error:{message:'Read interrupted'}};if(kind==='exception')throw new Error('Disconnected');if(kind==='count-change')r.count++;if(kind==='count-missing')r.count=null;if(kind==='empty-page')r.data=[];if(kind==='duplicate')r.data[0].id='line-0';if(kind==='wrong-branch')r.data[0].branch_id='other';if(kind==='wrong-unit')r.data[0].inventory_tracker_usage.vehicle_id='other';if(kind==='wrong-parent')r.data[0].usage_id='other';return r;
 });await assert.rejects(api.readRecords(c,context));
});
test('stale branch/request checks stop before returning data',async()=>{
 const c=client(fixture());let valid=true;c.setResponse((q,r)=>{if(q.table==='inventory_tracker_adjustments')valid=false;return r});await assert.rejects(api.readRecords(c,context,()=>{if(!valid)throw new Error('stale')}),/stale/);
});
test('deleted, reactivated and changed units fail closed',async()=>{
 for(const action of ['deleted','active','changed']){const data=fixture(),c=client(data);let n=0;c.setResponse((q,r)=>{if(q.table==='inventory_tracker_vehicles'&&++n===2){if(action==='deleted')r.data=null;if(action==='active')r.data.released_at=null;if(action==='changed')r.data.plate_number='changed'}return r});await assert.rejects(api.readRecords(c,context));}
});
test('units from another branch and missing context cannot be opened',async()=>{
 const c=client(fixture());await assert.rejects(api.readRecords(c,{...context,branch:'other'}),/no longer available/);await assert.rejects(api.readRecords(c,{...context,branch:''}),/Select a business and branch/);
});
test('invalid quantities fail rather than produce misleading totals',()=>{
 for(const value of [null,'',NaN,'bad',Infinity,0,-1])assert.throws(()=>api.model(vehicle,[line(1,{quantity:value})],[]));
 assert.throws(()=>api.model(vehicle,[],[adjustment(1,{delta:0})]));assert.throws(()=>api.model(vehicle,[],[adjustment(1,{material_id:null})]));
});
test('archived metadata and material labels are escaped; Philippine release date is accurate',()=>{
 const r=api.model({...vehicle,vehicle_name:'<script>',plate_number:'" onload="bad'},[line(1,{material_name:'<img> & paint'})],[]),html=api.html(r);
 assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img&gt; &amp; paint/);assert.doesNotMatch(html,/<script>|<img>|" onload="/);assert.match(api.dateTime(vehicle.released_at),/Nov/);assert.match(api.dateTime(vehicle.released_at),/01/);
});
test('released cards have separate view and delete buttons; only summary toggles the folder',()=>{
 const src=fs.readFileSync(path.join(root,'inventory-tracker.js'),'utf8'),line=src.split(/\r?\n/).find(l=>l.startsWith('  function releasedUnitCard(')),box={};vm.runInNewContext('function esc(v){return String(v).replace(/"/g,"&quot;")}'+line+';result=releasedUnitCard({id:"unit-1",vehicle_name:"SWIFT",plate_number:"NDF4074",released_at:"2026-10-31"})',box);
 assert.match(box.result,/data-it-view-materials="unit-1"/);assert.match(box.result,/data-it-delete="unit-1"/);assert.match(box.result,/type="button"/);assert.match(src,/archived.map\(releasedUnitCard\)/);assert.match(src,/closest\('\[data-it-archive\] > summary'\)/);assert.doesNotMatch(src,/archiveExpanded\?\(archived.length/);
});
test('history code is read-only and versioned with the app shell',()=>{
 const code=fs.readFileSync(path.join(root,'inventory-material-history.js'),'utf8'),index=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');new vm.Script(code);new vm.Script(fs.readFileSync(path.join(root,'inventory-tracker.js'),'utf8'));
 assert.doesNotMatch(code,/\.(insert|update|delete|upsert|rpc)\s*\(/);assert.match(code,/event.stopPropagation\(\)/);assert.match(code,/dialog.showModal\(\)/);assert.match(code,/bwc:branch-ready/);
 for(const name of ['inventory-tracker','inventory-material-history']){assert.ok(index.includes(name+'.js?v=20261122-released-materials'));assert.ok(sw.includes(name+'.js?v=20261122-released-materials'))}
});
