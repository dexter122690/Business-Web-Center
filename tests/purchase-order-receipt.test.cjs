const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../purchase-orders-online.js'),'utf8');
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture(options={}){
  const order={id:'po-id',business_id:'business',branch_id:'a',po_number:'3',status:'Approved',supplier_name:'Fictional supplier',purchase_order_items:[{id:'line-1',description:'Liha 120',quantity:5,unit_cost:12}],...options.order};
  const calls=[],alerts=[],prompts=[],events=[],storage={'bwc-active-business':'business','bwc-active-branch':'a'};
  const materials=[{id:'mat-1',item_name:'Liha 120',quantity:10,stock_unit:'1PC'}];let posted=0,status=order.status;
  const db={async rpc(name,args){
    calls.push({name,args:copy(args)});
    if(options.respond){const r=await options.respond(name,args,{storage});if(r!==undefined)return r}
    if(name==='purchase_order_receive_preview')return {data:{order:{...copy(order),status},revision:'revision',materials:copy(materials)}};
    if(name==='receive_purchase_order_to_tracker'){posted++;status='Received';return {data:{ok:true,po_number:'3',receipt_number:args.p_receipt_number,expense_count:1,stock_line_count:1,expense_only_count:0}}}
    throw Error('Unexpected RPC');
  },from(table){const b={select(){return b},eq(){return b},order(){return b},range(){return b},then(resolve){return Promise.resolve({data:[],count:0}).then(resolve)}};return b}};
  const window={testReceipt:async order=>{prompts.push(copy(order));if(options.onPrompt)options.onPrompt(storage);return options.cancel?null:{receipt_number:options.receipt===undefined?'  OR-00123  ':options.receipt,lines:[{item_id:'line-1',material_id:'mat-1',material_name:'Liha 120',stock_unit:'1PC',quantity:5}]}}};
  const document={getElementById(){return null},addEventListener(){},dispatchEvent(e){events.push(e)}};
  const exposed=source.replace(/\}\)\(\);\s*$/,`window.qa={receive,receiptRows,receiptChoices,ready(client,rows){db=client;orders=rows;online=true;businessId='business';userId='user';requestReceipt=window.testReceipt}};})();`);
  vm.runInNewContext(exposed,{window,document,localStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v},setTimeout(){},Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,args){this.type=type;this.detail=args.detail}},alert:m=>alerts.push(m),console});
  window.qa.ready(db,[copy(order)]);return {api:window.qa,order,materials,calls,alerts,prompts,storage,events,get posted(){return posted},get status(){return status}};
}
const writes=f=>f.calls.filter(c=>c.name==='receive_purchase_order_to_tracker');
test('receipt confirmation sends one scoped atomic request, then refreshes tracker and Expenses',async()=>{
  const f=fixture();await f.api.receive('po-id');assert.equal(writes(f).length,1);
  const a=writes(f)[0].args;assert.equal(a.p_receipt_number,'OR-00123');assert.equal(a.p_business_id,'business');assert.equal(a.p_branch_id,'a');assert.equal(a.p_order_id,'po-id');assert.equal(a.p_revision,'revision');
  assert.equal(a.p_lines[0].quantity,5);assert.equal(f.status,'Received');assert.deepEqual(f.events.map(e=>e.type),['bwc:expenses-loaded','bwc:inventory-cost-changed']);
  assert.equal(JSON.parse(f.storage['bwc-inventory-cost-changed']).branch,'a');assert.match(f.alerts.at(-1),/1 line\(s\) added to the new Inventory Tracker/);
});
for(const receipt of ['',null,'   ','x'.repeat(121)])test('invalid receipt cannot submit '+JSON.stringify(receipt).slice(0,20),async()=>{const f=fixture({receipt});await f.api.receive('po-id');assert.equal(writes(f).length,0)});
test('cancel does not change stock or Expenses',async()=>{const f=fixture({cancel:true});await f.api.receive('po-id');assert.equal(writes(f).length,0)});
test('receipt leading zeroes and punctuation remain text',async()=>{const f=fixture({receipt:'000123-A/<test>'});await f.api.receive('po-id');assert.equal(writes(f)[0].args.p_receipt_number,'000123-A/<test>')});
for(const status of ['Draft','Received'])test(status+' order cannot be received',async()=>{const f=fixture({order:{status}});await f.api.receive('po-id');assert.equal(f.calls.length,0)});
test('stale approved screen is checked before opening the popup',async()=>{
 const f=fixture({respond:(name)=>name==='purchase_order_receive_preview'?{data:{order:{id:'po-id',business_id:'business',branch_id:'a',status:'Received'},revision:'r',materials:[]}}:undefined});await f.api.receive('po-id');assert.equal(f.prompts.length,0);assert.equal(writes(f).length,0);assert.match(f.alerts[0],/no longer waiting/);
});
test('double clicks make only one atomic receive call',async()=>{
 let release;const pending=new Promise(r=>release=r);const f=fixture({respond:async name=>{if(name==='purchase_order_receive_preview')await pending}});
 const a=f.api.receive('po-id'),b=f.api.receive('po-id');release();await Promise.all([a,b]);assert.equal(writes(f).length,1);
});
test('branch change while preview or popup is open prevents submission',async()=>{
 for(const options of [{respond:(name,args,c)=>{if(name==='purchase_order_receive_preview')c.storage['bwc-active-branch']='b'}},{onPrompt:s=>s['bwc-active-branch']='b'}]){const f=fixture(options);await f.api.receive('po-id');assert.equal(writes(f).length,0)}
});
test('missing migration/permissions/offline preview never falls back to direct writes',async()=>{
 const f=fixture({respond:()=>({error:{message:'RPC unavailable'}})});await f.api.receive('po-id');assert.equal(writes(f).length,0);assert.match(f.alerts[0],/Nothing was received/);
});
test('server validation error and network uncertainty never claim success',async()=>{
 for(const response of [{error:{message:'Expenses already exist'}},{data:null}]){const f=fixture({respond:n=>n==='receive_purchase_order_to_tracker'?response:undefined});await f.api.receive('po-id');assert.equal(f.status,'Approved');assert.doesNotMatch(f.alerts.join(' '),/record\(s\) saved/)}
});
test('idempotent response says no additional expenses or stock',async()=>{
 const f=fixture({respond:n=>n==='receive_purchase_order_to_tracker'?{data:{ok:true,duplicate:true,po_number:'3'}}:undefined});await f.api.receive('po-id');assert.match(f.alerts.at(-1),/No additional Expenses or stock/);
});
test('network exception releases busy guard for safe retry',async()=>{
 let fail=true;const f=fixture({respond:()=>{if(fail)throw Error('offline')}});await f.api.receive('po-id');fail=false;await f.api.receive('po-id');assert.equal(writes(f).length,1);
});
test('mapping UI uses explicit branch material IDs, visible pack units, and mandatory stock destination',()=>{
 const f=fixture(),html=f.api.receiptRows(f.order,f.materials);assert.match(html,/value="mat-1" selected/);assert.match(html,/1PC/);assert.match(html,/Stock quantity to add/);assert.doesNotMatch(html,/Expense only|expense-only/);
 assert.match(source,/data-po-stock-reviewed/);assert.match(source,/NOT already been added manually/);assert.match(source,/Saved material prices will not change/);assert.match(source,/name="receipt_number" type="text" required maxlength="120"/);
 const unknown=f.api.receiptRows({...f.order,purchase_order_items:[{id:'custom',description:'Custom <item>',quantity:1,unit_cost:2}]},f.materials);
 assert.doesNotMatch(unknown,/selected/);assert.match(unknown,/Custom &lt;item&gt;/);
});
test('receive has no legacy expense inserts or status updates',()=>{
 const body=source.slice(source.indexOf('  async function receive('),source.indexOf('  async function remove('));assert.doesNotMatch(body,/db\.from\(/);assert.match(body,/receive_purchase_order_to_tracker/);
});
