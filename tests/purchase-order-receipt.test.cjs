const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../purchase-orders-online.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(options={}){
  const order={id:'po-id',business_id:'business',branch_id:'a',po_number:'3',status:'Approved',supplier_name:'Fictional supplier',payment_method:'Authorized Manager',purchase_order_items:[
    {description:'Liha 120',category:'Parts & Materials',quantity:5,unit_cost:12},
    {description:'Masking tape',category:'Parts & Materials',quantity:2,unit_cost:28}
  ],...options.order};
  const calls=[],alerts=[],prompts=[],confirms=[],events=[],storage={'bwc-active-business':'business','bwc-active-branch':'a'};
  const posted=[];let status=order.status;
  const db={from(table){
    const q={table,operation:'select',filters:{}};
    const b={select(fields){q.fields=fields;return b},eq(k,v){q.filters[k]=v;return b},order(){return b},range(){return b},limit(n){q.limit=n;return b},single(){q.single=true;return b},maybeSingle(){q.maybeSingle=true;return b},insert(data){q.operation='insert';q.data=copy(data);return b},update(data){q.operation='update';q.data=copy(data);return b},then(resolve,reject){
      return Promise.resolve().then(async()=>{
        calls.push(copy(q));
        if(options.respond){const result=await options.respond(q,{storage,posted,order});if(result!==undefined)return result}
        if(table==='purchase_orders'&&q.operation==='select')return {data:q.single?{...copy(order),status}:[]};
        if(table==='expenses'&&q.operation==='select')return {data:posted.length?[{id:'existing'}]:[]};
        if(table==='expenses'&&q.operation==='insert'){posted.push(...q.data);return {data:null}}
        if(table==='purchase_orders'&&q.operation==='update'){status=q.data.status;return {data:{id:order.id}}}
        if(table==='inventory_tracker_materials')return {data:[],count:0};
        throw Error('Unexpected request '+JSON.stringify(q));
      }).then(resolve,reject);
    }};
    return b;
  }};
  const document={getElementById(){return null},addEventListener(){},dispatchEvent(e){events.push(e.type)}};
  const window={testReceipt:async order=>{prompts.push(copy(order));return options.confirm===false?null:options.receipt===undefined?'  OR-00123  ':options.receipt}};
  const exposed=source.replace(/\}\)\(\);\s*$/,`window.qa={receive,ready(client,rows){db=client;orders=rows;online=true;businessId='business';userId='user';requestReceipt=window.testReceipt}};})();`);
  vm.runInNewContext(exposed,{window,document,localStorage:{getItem:k=>storage[k]||null},setTimeout(){},Event:class {constructor(type){this.type=type}},
    alert:m=>alerts.push(m),prompt:m=>{prompts.push(m);return options.receipt===undefined?'  OR-00123  ':options.receipt},confirm:m=>{confirms.push(m);return options.confirm!==false},console});
  window.qa.ready(db,[copy(order)]);
  return {api:window.qa,order,calls,alerts,prompts,confirms,events,storage,posted,get status(){return status}};
}
const writes=f=>f.calls.filter(q=>q.operation!=='select');

test('Receive asks for supplier receipt and keeps it separate from the PO reference on every expense',async()=>{
  const f=fixture();await f.api.receive('po-id');
  assert.equal(f.prompts[0].po_number,'3');assert.equal(f.prompts[0].supplier_name,'Fictional supplier');
  assert.match(source,/name="receipt_number" type="text" required maxlength="120"/);
  assert.match(source,/already encoded in Expenses, cancel/);
  assert.match(source,/Confirm receive/);
  assert.equal(f.posted.length,2);
  for(const entry of f.posted){
    assert.equal(entry.receipt_number,'OR-00123');assert.equal(entry.reference_number,'3');
    assert.equal(entry.branch_id,'a');assert.equal(entry.business_id,'business');assert.equal(entry.created_by,'user');
    assert.equal(entry.remarks,'Received purchase order');
  }
  assert.deepEqual(f.posted.map(e=>[e.description,e.quantity,e.unit_amount]),[['Liha 120',5,12],['Masking tape',2,28]]);
  assert.equal(f.status,'Received');
  assert.deepEqual(writes(f).map(q=>[q.table,q.operation]),[['expenses','insert'],['purchase_orders','update']]);
  assert.equal(writes(f)[1].filters.status,'Approved');
  assert.match(f.alerts.at(-1),/supplier receipt OR-00123/);
  assert.doesNotMatch(f.alerts.join(' '),/stock.*added|added.*Inventory/i);
});

for(const receipt of [null,'','   ','x'.repeat(121)])test('cancel, blank or invalid receipt cannot receive or create expenses: '+JSON.stringify(receipt).slice(0,35),async()=>{
  const f=fixture({receipt});await f.api.receive('po-id');
  assert.equal(writes(f).length,0);assert.equal(f.status,'Approved');assert.equal(f.confirms.length,0);
});

test('canceling final confirmation leaves all records unchanged',async()=>{
  const f=fixture({confirm:false});await f.api.receive('po-id');assert.equal(writes(f).length,0);assert.equal(f.status,'Approved');
});

test('numeric leading zeros, letters and punctuation in receipt numbers are preserved as plain text',async()=>{
  const f=fixture({receipt:'000123-A/<test>'});await f.api.receive('po-id');assert.equal(f.posted[0].receipt_number,'000123-A/<test>');
});

for(const status of ['Draft','Received'])test(status+' orders cannot be received',async()=>{
  const f=fixture({order:{status}});await f.api.receive('po-id');assert.equal(f.calls.length,0);assert.equal(f.prompts.length,0);
});

test('stale Approved view rechecks server status before asking for receipt',async()=>{
  const f=fixture({respond:q=>q.table==='purchase_orders'&&q.single?{data:{status:'Received'}}:undefined});await f.api.receive('po-id');
  assert.equal(writes(f).length,0);assert.equal(f.prompts.length,0);assert.match(f.alerts[0],/no longer waiting/);
});

test('receipt preflight is scoped and fail-closed',async()=>{
  for(const response of [{error:{message:'offline'}},{data:[{id:'existing-expense'}]}]){
    const f=fixture({respond:q=>q.table==='expenses'&&q.operation==='select'?response:undefined});await f.api.receive('po-id');
    assert.equal(writes(f).length,0);
    const check=f.calls.find(q=>q.table==='expenses');
    assert.deepEqual(check.filters,{business_id:'business',branch_id:'a',reference_number:'3',remarks:'Received purchase order'});assert.equal(check.limit,1);
  }
});

test('double-click while receiving does not insert expenses twice',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);
  const f=fixture({respond:async q=>{if(q.table==='purchase_orders'&&q.single)await wait}});
  const first=f.api.receive('po-id');const second=f.api.receive('po-id');release();await Promise.all([first,second]);
  assert.equal(f.prompts.length,1);assert.equal(f.calls.filter(q=>q.table==='expenses'&&q.operation==='insert').length,1);
});

test('changing branch during the preflight cannot post into the new branch',async()=>{
  const f=fixture({respond:(q,{storage})=>{if(q.table==='expenses'&&q.operation==='select')storage['bwc-active-branch']='b'}});
  await f.api.receive('po-id');assert.equal(writes(f).length,0);
});

test('branch switch after expense insertion still updates only the original PO scope',async()=>{
  const f=fixture({respond:(q,{storage})=>{if(q.table==='expenses'&&q.operation==='insert')storage['bwc-active-branch']='b'}});
  await f.api.receive('po-id');const update=writes(f).find(q=>q.table==='purchase_orders');assert.equal(update.filters.branch_id,'a');assert.equal(update.filters.business_id,'business');
});

test('expense insert failure never marks the order Received',async()=>{
  const f=fixture({respond:q=>q.table==='expenses'&&q.operation==='insert'?{error:{message:'Connection error'}}:undefined});await f.api.receive('po-id');
  assert.equal(f.status,'Approved');assert.equal(writes(f).filter(q=>q.table==='purchase_orders').length,0);assert.match(f.alerts.at(-1),/Check Expenses before trying again/);
});

test('status update failure warns against retry and detects the existing expenses on the next attempt',async()=>{
  const f=fixture({respond:q=>q.table==='purchase_orders'&&q.operation==='update'?{error:{message:'offline'}}:undefined});await f.api.receive('po-id');
  assert.equal(f.posted.length,2);assert.match(f.alerts.at(-1),/Do not receive it again/);
  await f.api.receive('po-id');assert.equal(f.posted.length,2);assert.match(f.alerts.at(-1),/Expenses already exist/);
});

test('an empty conditional status update is not reported as a successful receive',async()=>{
  const f=fixture({respond:q=>q.table==='purchase_orders'&&q.operation==='update'?{data:null}:undefined});await f.api.receive('po-id');
  assert.match(f.alerts.at(-1),/status could not be confirmed/);
});

test('network exceptions release the busy guard and give an explicit verification warning',async()=>{
  let fail=true;const f=fixture({respond:()=>{if(fail)throw Error('offline')}});await f.api.receive('po-id');
  assert.equal(writes(f).length,0);assert.match(f.alerts.at(-1),/Check Expenses/);fail=false;await f.api.receive('po-id');assert.equal(f.posted.length,2);
});

test('receipt update does not claim automatic tracker stock-in or change historical records',()=>{
  assert.doesNotMatch(source,/stock-in entries|eligible stock has been added|Expenses and stock-in automatically/);
  const receive=source.slice(source.indexOf('  async function receive('),source.indexOf('  async function remove('));
  assert.doesNotMatch(receive,/\.delete\(\)|\.rpc\(|from\('inventory/);
});
