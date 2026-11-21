const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),printer=require('../executive-print.js');
const current=fs.readFileSync(path.join(root,'index.html'),'utf8');
function inline(html){const start=html.indexOf('/* Keep the Excel exporter inline.');assert.ok(start>=0);return html.slice(start,html.indexOf('</script>',start));}
const data={invoices:[
  {invoice_date:'2026-11-01',amount_paid:1000.25,total_amount:1500,invoice_services:[{service_name:'Dent repair'},{service_name:'Panel repaint'}]},
  {invoice_date:'2026-11-14',amount_paid:2000.50,total_amount:3000,invoice_services:[{service_name:'Dent repair'},{service_name:'Panel repaint'}]},
  {invoice_date:'2026-11-20',amount_paid:500,invoice_services:[]},
  {invoice_date:'2026-11-21',amount_paid:0,invoice_services:[{service_name:'Unpaid'}]},
  {invoice_date:'2026-10-31',amount_paid:9000,invoice_services:[{service_name:'October only'}]}
],expenses:[
  {expense_date:'2026-11-02',category:'Cost of Sales',quantity:2,unit_amount:100.50},
  {expense_date:'2026-11-03',category:'Salaries & Wages',quantity:1,unit_amount:4000},
  {expense_date:'2026-11-10',category:'Supplies',quantity:3,unit_amount:20},
  {expense_date:'2026-10-31',category:'October',quantity:1,unit_amount:800}
]};
function setup(code=inline(current),source=data){
  let blob=null,resolveRows=null;
  const values={'bwc-active-business':'biz-test','bwc-active-branch':'branch-test','bwc-active-business-name':'Test Autocare','bwc-branding':JSON.stringify({name:'Test Autocare'})};
  const fields={dm:{value:'10',selectedIndex:0,options:[{textContent:'November'}]},dy:{value:'2026'},dashboardDateFrom:{value:''},dashboardDateTo:{value:''},onlineBranchPicker:{value:'branch-test',selectedIndex:0,options:[{textContent:'Test Branch'}]}};
  const queries=[],alerts=[],button={};
  const db={from(table){const call={table,filters:[]};queries.push(call);return {select(columns){call.columns=columns;return this},eq(k,v){call.filters.push([k,v]);return this},then(ok,fail){return Promise.resolve(resolveRows?resolveRows(table):{data:source[table],error:null}).then(ok,fail)}}}};
  const sandbox={window:{getBusinessSupabaseClient:()=>db},localStorage:{getItem:k=>values[k]||null},document:{getElementById:id=>fields[id],querySelector:s=>s.includes('exportReport')?button:null,createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}},URL:{createObjectURL:b=>{blob=b;return 'blob:test'},revokeObjectURL(){}},Blob,alert:m=>alerts.push(m),setTimeout(){},Date:class extends Date{constructor(...args){super(...(args.length?args:['2026-11-21T01:00:00Z']))}}};
  vm.runInNewContext(code,sandbox);
  return {api:sandbox.window.BWCExecutiveReport,export:sandbox.window.exportReport,fields,values,queries,alerts,blob:()=>blob,setResponse:fn=>{resolveRows=fn}};
}
test('every inline production script still parses',()=>{
  for(const m of current.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});
test('report calculation preserves every expected row and amount',async()=>{
  const s=setup(),r=await s.api.prepare();
  assert.equal(r.sales,3500.75);assert.equal(r.cost,201);assert.equal(r.gross,3299.75);assert.equal(r.opex,4060);assert.equal(r.net,-760.25);
  assert.deepEqual(JSON.parse(JSON.stringify(r.salesRows)),[['Dent repair + Panel repaint',3000.75],['Invoice payment',500]]);
  assert.equal(r.branch,'Test Branch');assert.equal(r.businessName,'Test Autocare');assert.equal(r.period,'November / 2026');
});
test('new Excel output matches the pre-change exporter byte for byte',async()=>{
  const baseline=execFileSync('git',['show','f42ab77:index.html'],{cwd:root,encoding:'utf8',maxBuffer:2e6});
  const old=setup(inline(baseline)),next=setup();await old.export();await next.export();
  assert.deepEqual(next.alerts,old.alerts);assert.equal(await next.blob().text(),await old.blob().text());
});
test('both source reads keep business and branch permissions',async()=>{
  const s=setup();await s.api.prepare();assert.equal(s.queries.length,2);
  for(const q of s.queries)assert.deepEqual(q.filters,[['business_id','biz-test'],['branch_id','branch-test']]);
  assert.deepEqual(s.queries.map(q=>q.table),['invoices','expenses']);
});

test('an unfiltered branch query is never labelled as one specific branch',async()=>{
  const s=setup();s.values['bwc-active-branch']='';s.fields.onlineBranchPicker.value='';
  s.fields.onlineBranchPicker.options[0].textContent='MAIN';
  const r=await s.api.prepare();assert.equal(r.branch,'All accessible branches');
  for(const q of s.queries)assert.deepEqual(q.filters,[['business_id','biz-test']]);
});
test('complete custom range overrides month without changing calculations',async()=>{
  const s=setup();s.fields.dashboardDateFrom.value='2026-11-14';s.fields.dashboardDateTo.value='2026-11-20';
  const r=await s.api.prepare();assert.equal(r.period,'2026-11-14 to 2026-11-20');assert.equal(r.sales,2500.5);assert.equal(r.cost,0);assert.equal(r.opex,0);
});
test('January zero-valued month is filtered correctly',async()=>{
  const s=setup();s.fields.dm.value='0';const r=await s.api.prepare();assert.equal(r.sales,0);assert.equal(r.salesRows.length,0);
});
test('all months keeps all Executive rows',async()=>{
  const s=setup();s.fields.dm.value='';const r=await s.api.prepare();assert.equal(r.sales,12500.75);assert.equal(r.opex,4860);
});
test('incomplete or reversed custom dates are rejected before querying',async()=>{
  const s=setup();s.fields.dashboardDateFrom.value='2026-11-20';await assert.rejects(s.api.prepare(),/both From and To/);assert.equal(s.queries.length,0);
  s.fields.dashboardDateTo.value='2026-11-01';await assert.rejects(s.api.prepare(),/cannot be after/);assert.equal(s.queries.length,0);
});
test('changing branch during loading rejects stale report',async()=>{
  const s=setup();s.setResponse(table=>{s.values['bwc-active-branch']='new-branch';return {data:data[table]}});await assert.rejects(s.api.prepare(),/changed while loading/);
});
test('changing dates during loading rejects mixed-period report',async()=>{
  const s=setup();s.setResponse(table=>{s.fields.dm.value='9';return {data:data[table]}});await assert.rejects(s.api.prepare(),/changed while loading/);
});
test('database errors never become zero-value reports',async()=>{
  const s=setup();s.setResponse(()=>({data:null,error:new Error('Unavailable')}));await assert.rejects(s.api.prepare(),/Unavailable/);
});
test('print contains every grouped label, amount and total from shared model',async()=>{
  const r=await setup().api.prepare(),before=JSON.stringify(r),html=printer.html(r);
  for(const row of [...r.salesRows,...r.costRows,...r.opexRows]){assert.ok(html.includes(row[0].replace(/&/g,'&amp;')));assert.ok(html.includes(printer.money(row[1])));}
  for(const key of ['sales','cost','gross','opex','net'])assert.ok(html.includes(printer.money(r[key])));
  assert.equal((html.match(/class="detail-row"/g)||[]).length,5);assert.match(html,/net negative/);assert.match(html,/PHP -760.25/);assert.equal(JSON.stringify(r),before);
});
test('long descriptions and large multi-page reports are not shortened',async()=>{
  const r=await setup().api.prepare();r.salesRows=Array.from({length:150},(_,i)=>['Full description '+i+' '+('Panel repaint + Interior detailing + '.repeat(12)),1000+i/100]);
  const html=printer.html(r);for(const row of r.salesRows)assert.ok(html.includes(row[0]));
  assert.equal((html.match(/class="detail-row"/g)||[]).length,153);assert.match(html,/table-header-group/);assert.match(html,/overflow-wrap:anywhere/);assert.doesNotMatch(html,/text-overflow:ellipsis|line-clamp/);
});
test('empty reports still show all headings and zero totals',async()=>{
  const r=await setup(undefined,{invoices:[],expenses:[]}).api.prepare(),html=printer.html(r);
  for(const label of ['TOTAL SALES','TOTAL COST OF SALES','GROSS PROFIT','TOTAL OPERATING EXPENSES','NET INCOME'])assert.ok(html.includes(label));
  assert.equal((html.match(/class="detail-row"/g)||[]).length,3);assert.match(html,/No operating expenses/);
});
test('text fields are escaped and the report cannot run injected scripts',async()=>{
  const r=await setup().api.prepare();r.businessName='<script>alert(1)</script>';r.branch='A & B';r.salesRows=[['<img src=x onerror=alert(1)>',12.34]];
  const html=printer.html(r);assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('A &amp; B'));assert.doesNotMatch(html,/<script|<img/);assert.match(html,/default-src 'none'/);
});
test('paper selection supports A4 and short bond without changing data',async()=>{
  const r=await setup().api.prepare(),a=printer.html(r,'a4'),b=printer.html(r,'letter');assert.match(a,/@page\{size:A4 portrait/);assert.match(b,/@page\{size:letter portrait/);
  assert.deepEqual(a.match(/PHP [\d,.-]+/g),b.match(/PHP [\d,.-]+/g));
});
test('invalid monetary values stop printing instead of silently hiding errors',()=>assert.throws(()=>printer.money(NaN),/invalid/));
test('print button directly follows executive export and module is versioned',()=>{
  assert.match(current,/Export Executive Excel<\/button><button[^>]*id="printFinancialReport"/);
  assert.match(current,/executive-print\.js\?v=20261121-complete-report/);
});
