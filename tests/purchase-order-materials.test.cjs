const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'purchase-orders-online.js'),'utf8');
const material=(id,name,branch='a',business='business')=>({id,item_name:name,branch_id:branch,business_id:business});

function fixture(respond){
  const elements={},events={},calls=[],alerts=[],storage={'bwc-active-business':'business','bwc-active-branch':'a'};
  function element(tag='input'){
    let html='';return {tagName:tag.toUpperCase(),value:'',children:[],attributes:{},dataset:{},textContent:'',
      get innerHTML(){return html},set innerHTML(v){html=v;this.children=[]},
      setAttribute(k,v){this.attributes[k]=v},appendChild(e){this.children.push(e);if(e.id)elements[e.id]=e},
      insertAdjacentElement(where,e){elements[e.id]=e}};
  }
  for(const id of ['poItem','poCategory','poQty','poCost','poSupplier','poNumber','poDate','poExpected','poPayment','poNotes','poStatus'])elements[id]=element();
  elements.poQty.value='1';elements.poCost.value='45';elements.poCategory.value='Other';
  const db={auth:{getSession:async()=>({data:{session:{user:{id:'user'}}}})},from(table){
    const request={table,filters:{},orders:[]};calls.push(request);
    const builder={select(fields,options){request.fields=fields;request.options=options;return builder},eq(k,v){request.filters[k]=v;return builder},order(k){request.orders.push(k);return builder},range(a,b){request.range=[a,b];return builder},then(resolve,reject){return Promise.resolve().then(()=>respond(request)).then(resolve,reject)}};
    return builder;
  }};
  const window={BUSINESS_WEB_CENTER_SUPABASE:{url:'fictional',publishableKey:'fictional'},supabase:{},getBusinessSupabaseClient:()=>db};
  const document={getElementById:id=>elements[id]||null,createElement:element,body:element('body'),addEventListener:(name,fn)=>events[name]=fn};
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,`window.qa={load,loadMaterials,setupMaterialPicker,addLine,start,get lines(){return lines},get orders(){return orders},ready(){db=window.getBusinessSupabaseClient();businessId=localStorage.getItem('bwc-active-business');online=true}};})();`),{window,document,localStorage:{getItem:k=>storage[k]||null},setTimeout(){},alert:m=>alerts.push(m),console});
  window.qa.ready();
  return {api:window.qa,elements,events,calls,alerts,storage,options:()=>elements.poMaterialOptions?.children.map(o=>o.value)||[]};
}
function responses(rows){return q=>q.table==='purchase_orders'?{data:[]}:{data:rows.filter(r=>r.branch_id===q.filters.branch_id&&r.business_id===q.filters.business_id).slice(q.range[0],q.range[1]+1),count:rows.filter(r=>r.branch_id===q.filters.branch_id&&r.business_id===q.filters.business_id).length}}

test('PO suggestions use the current branch tracker names, including zero-stock items, in tracker order',async()=>{
  const rows=[material('1','Masking tape'),material('2','Liha 1000'),material('3','Liha 220'),material('4','Liha 120'),material('5','Other branch material','b')];
  const f=fixture(responses(rows));await f.api.load();
  assert.deepEqual(f.options(),['Liha 120','Liha 220','Liha 1000','Masking tape']);
  const request=f.calls.find(q=>q.table==='inventory_tracker_materials');
  assert.deepEqual(request.filters,{business_id:'business',branch_id:'a'});
  assert.deepEqual(request.orders,['item_name','id']);
  assert.equal(f.calls.some(q=>q.table==='inventory_sku_catalog'),false);
  assert.equal(f.elements.poItem.tagName,'INPUT');assert.equal(f.elements.poItem.attributes.list,'poMaterialOptions');
  assert.equal(f.elements.poCost.value,'45');assert.equal(f.elements.poCategory.value,'Other');
});

test('both a tracker material and any custom item remain addable without changing prices or stock',async()=>{
  const f=fixture(responses([material('1','Liha 120')]));await f.api.load();
  for(const name of ['Liha 120','Custom supplier item - large','PTN-OLD-001']){f.elements.poItem.value=name;f.api.addLine()}
  assert.deepEqual(JSON.parse(JSON.stringify(f.api.lines)),['Liha 120','Custom supplier item - large','PTN-OLD-001'].map(description=>({description,quantity:1,unit_cost:45,category:'Other'})));
  assert.equal(f.alerts.length,0);assert.ok(f.calls.every(q=>['purchase_orders','inventory_tracker_materials'].includes(q.table)));
});

test('suggestions use option values safely, without interpreting material names as HTML',async()=>{
  const name='Custom <img src=x onerror=alert(1)> & "material"';const f=fixture(responses([material('1',name)]));await f.api.loadMaterials();
  assert.deepEqual(f.options(),[name]);assert.equal(f.elements.poMaterialOptions.children[0].innerHTML,'');
});

test('material suggestions paginate beyond the default database response limit',async()=>{
  const f=fixture(responses(Array.from({length:1205},(_,i)=>material(String(i),'Material '+i))));await f.api.loadMaterials();
  assert.equal(f.options().length,1205);assert.deepEqual(f.calls.map(q=>q.range),[[0,499],[500,999],[1000,1499]]);
});

test('an incomplete, wrong-scope or failed list clears suggestions but still permits custom entry',async()=>{
  for(const result of [{error:{message:'offline'}},{count:2,data:[]},{count:1,data:[material('1','Wrong branch','b')]},{count:1,data:[material('1','Wrong business','a','other')]}]){
    let fail=false;const good=responses([material('1','Old suggestion')]);const f=fixture(q=>fail?result:good(q));await f.api.loadMaterials();assert.equal(f.options().length,1);fail=true;await f.api.loadMaterials();
    assert.equal(f.options().length,0);assert.match(f.elements.poMaterialHint.textContent,/could not load/);
    f.elements.poItem.value='Still typeable';f.api.addLine();assert.equal(f.api.lines[0].description,'Still typeable');
  }
});

test('tracker refresh updates suggestions without overwriting a typed item or supplier price',async()=>{
  let rows=[material('1','Liha 120')];const f=fixture(q=>responses(rows)(q));await f.api.loadMaterials();
  f.elements.poItem.value='Unsaved custom item';f.elements.poCost.value='19.75';rows.push(material('2','New tracker material'));
  f.events['bwc:inventory-cost-changed']({detail:{business:'business',branch:'a'}});await new Promise(setImmediate);
  assert.deepEqual(f.options(),['Liha 120','New tracker material']);assert.equal(f.elements.poItem.value,'Unsaved custom item');assert.equal(f.elements.poCost.value,'19.75');
});

test('late previous-branch responses cannot restore its material list or orders',async()=>{
  let release;const pending=new Promise(resolve=>release=resolve);
  const f=fixture(q=>q.filters.branch_id==='a'?pending:q.table==='purchase_orders'?{data:[]}:{count:1,data:[material('b1','Branch B material','b')]});
  const old=f.api.load();await new Promise(setImmediate);f.storage['bwc-active-branch']='b';f.events['bwc:branch-ready']();
  assert.deepEqual(f.options(),[]);await new Promise(setImmediate);assert.deepEqual(f.options(),['Branch B material']);
  release({count:1,data:[material('a1','Stale branch A material')]});await old;
  assert.deepEqual(f.options(),['Branch B material']);assert.equal(f.api.orders.length,0);
});

test('empty tracker stays free-text and does not fall back to the old SKU list',async()=>{
  const f=fixture(responses([]));await f.api.loadMaterials();assert.deepEqual(f.options(),[]);assert.match(f.elements.poMaterialHint.textContent,/Type any item/);
  assert.doesNotMatch(source,/inventory_sku_catalog|poSkuOptions|PTN-THIN|setupSkuPicker/);
});

test('the PO update is versioned and cached with the app shell',()=>{
  for(const file of ['index.html','sw.js'])assert.match(fs.readFileSync(path.join(root,file),'utf8'),/purchase-orders-online\.js\?v=20261125-tracker-materials/);
});
