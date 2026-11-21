const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../expense-categories.js');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'expense-online.js'),'utf8');
const rows=[
  {remoteId:'labor-first',date:'2026-11-02',category:'Labor',amount:1000,quantity:1,branchId:'rosa',supplier:'Shared supplier',receiptNumber:'SHARED'},
  {remoteId:'parts-second',date:'2026-11-02',category:'Parts & Materials',amount:100,quantity:3,branchId:'rosa',supplier:'Shared supplier',receiptNumber:'SHARED'},
  {remoteId:'parts-third',date:'2026-11-18',category:'Parts & Materials',amount:250.5,quantity:2,branchId:'rosa'},
  {remoteId:'old',date:'2026-10-20',category:'Parts & Materials',amount:9999,quantity:1,branchId:'rosa'},
  {remoteId:'other-branch',date:'2026-11-20',category:'Parts & Materials',amount:8888,quantity:1,branchId:'tomas'},
  {remoteId:'old-year',date:'2025-11-20',category:'Parts & Materials',amount:7777,quantity:1,branchId:'rosa'}
];
const november={month:'10',year:'2026',from:'',to:''};
function adapter(){
  const fields={},storage={'bwc-active-business':'business-test','bwc-active-branch':'rosa'},window={__bwcOnlineExpenses:[]};
  const document={getElementById:id=>id==='bwc-expenses-loading-style'?{}:fields[id]||null,addEventListener(){},dispatchEvent(){},querySelector(){return null;},head:{appendChild(){}},
    createElement(tag){return {tag,children:[],attributes:{},dataset:{},appendChild(el){this.children.push(el);},setAttribute(name,value){this.attributes[name]=value;}};}};
  const sandbox={window,document,localStorage:{getItem:k=>storage[k]||null},setTimeout(){},Event:class{},console,Map,Set};
  const code=source.replace(/\}\)\(\);\s*$/,'window.__test={readExpenseRows:readExpenseRows,decorateExpenseTable:decorateExpenseTable};})();');
  vm.runInNewContext(code,sandbox);
  return {api:window.__test,window,document,fields,storage};
}
function readerFixture(total,options={}){
  const rows=Array.from({length:total},(_,i)=>({id:'expense-'+i,expense_date:'2026-11-01'})),queries=[];
  return {rows,queries,client:{from(table){const call={table,filters:[],orders:[]};queries.push(call);return {
    select(columns,options){call.columns=columns;call.options=options;return this;},
    eq(k,v){call.filters.push([k,v]);return this;},order(k,v){call.orders.push([k,v]);return this;},
    range(from,to){call.range=[from,to];return this;},
    then(ok,fail){const page=queries.length-1,[from,to]=call.range;
      let result={data:rows.slice(from,Math.min(to+1,from+(options.cap||500))),count:rows.length,error:null};
      if(options.transform)result=options.transform(result,page,call);
      return Promise.resolve(result).then(ok,fail);
    }};}}};
}
test('category selection keeps every matching row within month/year and branch',()=>{
  const before=JSON.stringify(rows),result=api.model(rows,november,'Parts & Materials','rosa');
  assert.deepEqual(result.rows.map(r=>r.remoteId),['parts-second','parts-third']);
  assert.equal(result.subtotal,801);assert.equal(result.total,1801);
  assert.equal(result.groups.find(g=>g.name==='Parts & Materials').count,2);
  assert.equal(JSON.stringify(rows),before);
});
test('mixed-category receipt contributes only matching item lines',()=>{
  const result=api.model(rows.slice(0,2),november,'Parts & Materials','rosa');
  assert.equal(result.rows.length,1);assert.equal(result.subtotal,300);assert.equal(result.total,1300);
});

test('subtotal label comes from the selected data rather than hidden UI state',()=>{
  const filtered=api.model(rows,november,'Parts & Materials','rosa');
  const all=api.model(rows,november,'','rosa');
  assert.match(api.tableHtml(filtered,'Parts & Materials'),/Category subtotal/);
  assert.match(api.tableHtml(all,'All expenses'),/All expenses total/);
});
test('All expenses restores the full period without reclassifying categories',()=>{
  const result=api.model(rows,november,'','rosa');assert.equal(result.rows.length,3);assert.equal(result.subtotal,1801);
  assert.equal(result.cost,0);assert.equal(result.groups.find(g=>g.name==='Labor').total,1000);
});
test('Cost of Sales remains a separate category and receipt items are counted once',()=>{
  const result=api.model(rows.concat({remoteId:'cost',date:'2026-11-03',category:'Cost of Sales',quantity:1,amount:90,branchId:'rosa'}),november,'Cost of Sales','rosa');
  assert.equal(result.subtotal,90);assert.equal(result.cost,90);assert.equal(result.total,1891);
});
test('empty category remains selectable with zero entries',()=>{
  const result=api.model(rows,november,'Marketing Expense','rosa');
  assert.equal(result.rows.length,0);assert.equal(result.subtotal,0);assert.ok(result.groups.some(g=>g.name==='Marketing Expense'));
  assert.match(api.tableHtml(result,'Marketing Expense — November 2026'),/No expenses in this category/);
});
test('historical and unknown category names are retained without merging labels',()=>{
  const result=api.model([{date:'2026-11-01',category:'Salaries and Wages',amount:50},{date:'2026-11-02',category:'Custom category',amount:30}],november,'','rosa');
  assert.equal(result.groups.find(g=>g.name==='Salaries and Wages').total,50);
  assert.equal(result.groups.find(g=>g.name==='Salaries & Wages').total,0);
  assert.equal(result.groups.find(g=>g.name==='Custom category').total,30);
});
test('January, year, All months, and All years filters work',()=>{
  assert.ok(api.matches('2026-01-01',{month:'0',year:'2026'}));assert.ok(!api.matches('2026-11-01',{month:'0',year:'2026'}));
  assert.ok(api.matches('2026-12-31',{month:'',year:'2026'}));assert.ok(!api.matches('2025-12-31',{month:'',year:'2026'}));
  assert.ok(api.matches('2025-11-30',{month:'10',year:''}));assert.ok(!api.matches('',{month:'',year:''}));
});
test('Dashboard custom range overrides month and includes both boundaries',()=>{
  const p={month:'0',year:'2025',from:'2026-11-02',to:'2026-11-18'};
  assert.equal(api.model(rows,p,'Parts & Materials','rosa').subtotal,801);
  assert.ok(!api.matches('2026-11-19',p));assert.ok(!api.matches('2026-11-01',p));
});
test('all 1,205 matching rows are rendered, with full descriptions and stable IDs',()=>{
  const many=Array.from({length:1205},(_,i)=>({remoteId:'id-'+i,date:'2026-11-01',category:'Parts & Materials',amount:10.25,quantity:2,description:'Description '+i+' '+('long full description '.repeat(15)),branchId:'rosa'}));
  const result=api.model(many,november,'Parts & Materials','rosa'),html=api.tableHtml(result,'Parts & Materials');
  assert.equal(result.subtotal,24702.5);assert.equal((html.match(/data-expense-record-id=/g)||[]).length,1205);
  assert.ok(html.includes(many[1204].description));assert.match(html,/1205 expense entries/);
});
test('row fields and ID attributes are escaped',()=>{
  const html=api.rowHtml({remoteId:'" onclick="bad',date:'<script>',description:'<img onerror=x>',supplier:'A & B',category:'<test>',amount:1,quantity:2});
  assert.doesNotMatch(html,/<script|<img|data-expense-record-id="" onclick/);assert.match(html,/&lt;img/);assert.match(html,/A &amp; B/);
});
test('complete reader requests all pages with business/branch filters and stable order',async()=>{
  const a=adapter(),f=readerFixture(1205),result=await a.api.readExpenseRows(f.client,'business-test','rosa',()=>true);
  assert.equal(result.length,1205);assert.deepEqual(f.queries.map(q=>q.range),[[0,499],[500,999],[1000,1499]]);
  for(const q of f.queries){assert.equal(q.table,'expenses');assert.deepEqual(q.filters,[['business_id','business-test'],['branch_id','rosa']]);assert.equal(q.options.count,'exact');assert.deepEqual(q.orders.map(o=>o[0]),['expense_date','created_at','id']);}
});
test('server row limits below the requested page size still return every record',async()=>{
  const a=adapter(),f=readerFixture(1205,{cap:200}),result=await a.api.readExpenseRows(f.client,'business-test','rosa',()=>true);
  assert.equal(result.length,1205);assert.equal(f.queries.length,7);assert.deepEqual(f.queries[1].range,[200,699]);
});
test('exact multiple of page size and empty branches terminate cleanly',async()=>{
  const a=adapter(),f=readerFixture(1000);assert.equal((await a.api.readExpenseRows(f.client,'b','r',()=>true)).length,1000);assert.equal(f.queries.length,2);
  const empty=readerFixture(0);assert.equal((await a.api.readExpenseRows(empty.client,'b','r',()=>true)).length,0);assert.equal(empty.queries.length,1);
});
test('failed later pages reject instead of returning an incomplete list',async()=>{
  const a=adapter(),f=readerFixture(1205,{transform:(r,p)=>p===1?{error:new Error('Offline')}:r});
  await assert.rejects(a.api.readExpenseRows(f.client,'b','r',()=>true),/Offline/);
});
test('missing count, changed count, duplicate rows, or empty intermediate pages fail closed',async()=>{
  const a=adapter();
  for(const transform of [(r)=>({...r,count:null}),(r,p)=>({...r,count:p?1206:r.count}),(r,p)=>p?{...r,data:[{id:'expense-0'}]}:r,(r,p)=>p?{...r,data:[]}:r]){
    const f=readerFixture(1205,{transform});await assert.rejects(a.api.readExpenseRows(f.client,'b','r',()=>true),/count|changed|complete/);
  }
});
test('branch/business changes cancel an in-flight page without publishing rows',async()=>{
  const a=adapter();let current=true;const f=readerFixture(1205,{transform:r=>{current=false;return r;}});
  assert.equal(await a.api.readExpenseRows(f.client,'b','r',()=>current),null);assert.equal(f.queries.length,1);
});
test('Edit and Void target stable IDs after filtering, not original row position',()=>{
  const a=adapter();a.window.__bwcOnlineExpenses=rows;
  a.fields.exMonth={value:'10'};a.fields.exYear={value:'2026'};
  const heading=a.document.createElement('tr');
  const tr=id=>Object.assign(a.document.createElement('tr'),{getAttribute:()=>id});
  const rendered=[tr('parts-third'),tr('parts-second'),tr('missing')];
  const table={dataset:{expenseCategoryView:'1'},querySelector:()=>heading,querySelectorAll:()=>rendered};
  a.document.querySelector=()=>table;a.api.decorateExpenseTable();
  assert.equal(rendered[0].children[0].children[0].children[0].attributes['data-edit-expense'],'parts-third');
  assert.equal(rendered[0].children[0].children[0].children[1].attributes['data-delete-expense'],'parts-third');
  assert.equal(rendered[1].children[0].children[0].children[0].attributes['data-edit-expense'],'parts-second');
  assert.equal(rendered[2].children[0].textContent,'-');
  assert.equal(heading.children.length,1);a.api.decorateExpenseTable();assert.equal(heading.children.length,1);
});
test('protected audit rows never acquire Edit or Void buttons',()=>{
  const a=adapter();a.window.__bwcOnlineExpenses=[{remoteId:'protected',branchId:'rosa',invoiceWriteoffId:'writeoff',date:'2026-11-01'}];
  const row=Object.assign(a.document.createElement('tr'),{getAttribute:()=> 'protected'});
  a.document.querySelector=()=>({dataset:{expenseCategoryView:'1'},querySelector:()=>a.document.createElement('tr'),querySelectorAll:()=>[row]});
  a.api.decorateExpenseTable();assert.equal(row.children[0].innerHTML,'<small>Protected audit record</small>');
});
test('changed modules parse and integration loads category module before online actions',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const name of ['expense-online.js','expense-categories.js','tab-current-periods.js','sw.js'])new vm.Script(fs.readFileSync(path.join(root,name),'utf8'));
  assert.ok(html.indexOf('src="expense-categories.js')<html.indexOf('src="expense-online.js'));
  assert.match(html,/BWCExpenseCategories\.render\(read\(\)\)/);
  assert.match(fs.readFileSync(path.join(root,'tab-current-periods.js'),'utf8'),/BWCExpenseCategories\.restorePeriod/);
  const added=fs.readFileSync(path.join(root,'expense-categories.js'),'utf8');assert.doesNotMatch(added,/\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
});
