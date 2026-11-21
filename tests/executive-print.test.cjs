const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),printer=require('../executive-print.js');
const current=fs.readFileSync(path.join(root,'index.html'),'utf8');
const reporting=fs.readFileSync(path.join(root,'reporting-online.js'),'utf8');
function inline(html){const start=html.indexOf('/* Keep the Excel exporter inline.');assert.ok(start>=0);return html.slice(start,html.indexOf('</script>',start));}
const json=value=>JSON.parse(JSON.stringify(value));
const data={invoices:[
  {id:'a',invoice_date:'2026-11-01',amount_paid:1000.25,total_amount:1500,invoice_services:[{service_name:'Dent repair'},{service_name:'Panel repaint'}]},
  {id:'b',invoice_date:'2026-11-14',amount_paid:2000.50,total_amount:3000,invoice_services:[{service_name:'Dent repair'},{service_name:'Panel repaint'}]},
  {id:'c',invoice_date:'2026-11-20',amount_paid:500,total_amount:500,invoice_services:[]},
  {id:'d',invoice_date:'2026-11-21',amount_paid:0,total_amount:8000,invoice_services:[{service_name:'Unpaid'}]},
  {id:'e',invoice_date:'2026-10-31',amount_paid:9000,total_amount:9000,invoice_services:[{service_name:'October only'}]}
],expenses:[
  {expense_date:'2026-11-02',category:'Cost of Sales',quantity:2,unit_amount:100.50},
  {expense_date:'2026-11-03',category:'Salaries & Wages',quantity:1,unit_amount:4000},
  {expense_date:'2026-11-10',category:'Supplies',quantity:3,unit_amount:20},
  {expense_date:'2026-10-31',category:'October',quantity:1,unit_amount:800}
]};
data.invoice_payments=data.invoices.filter(i=>i.amount_paid).map(i=>({invoice_id:i.id,payment_date:i.invoice_date,amount:i.amount_paid,invoices:i}));
data.invoices.forEach(i=>{i.invoice_payments=data.invoice_payments.filter(p=>p.invoice_id===i.id).map(p=>({payment_date:p.payment_date,amount:p.amount}));});
function selectField(value,options){return {value,options,get selectedIndex(){return this.options.findIndex(o=>o.value===this.value);},appendChild(o){this.options.push(o);}};}
function setup(source=data){
  let blob=null,resolveRows=null;
  const values={'bwc-active-business':'biz-test','bwc-active-branch':'branch-test','bwc-active-business-name':'Test Autocare','bwc-branding':JSON.stringify({name:'Test Autocare'})};
  const fields={dm:selectField('10',[{value:'10',textContent:'November'},{value:'9',textContent:'October'},{value:'0',textContent:'January'},{value:'',textContent:'All months'}]),
    dy:selectField('2026',[{value:'2026',textContent:'2026'},{value:'',textContent:'All years'}]),
    dashboardDateFrom:{value:''},dashboardDateTo:{value:''},onlineBranchPicker:selectField('branch-test',[{value:'branch-test',textContent:'Test Branch'}]),
    paidSales:{},profit:{},gross:{},net:{},unpaid:{},paidCount:{}};
  const queries=[],alerts=[],button={},timers=[],events={};
  const db={auth:{async getSession(){return {data:{session:{user:{id:'test'}}}};}},from(table){
    const call={table,filters:[],bounds:[]};queries.push(call);
    return {select(columns,options){call.columns=columns;call.count=options&&options.count;return this;},eq(k,v){call.filters.push([k,v]);return this;},
      gte(k,v){call.bounds.push(['gte',k,v]);return this;},lte(k,v){call.bounds.push(['lte',k,v]);return this;},order(){return this;},
      range(from,to){call.range=[from,to];return this;},
      then(ok,fail){
        const allRows=(source[table]||[]).map((r,i)=>Object.assign({id:table+'-'+i,business_id:'biz-test',branch_id:'branch-test'},r))
          .filter(r=>call.filters.every(([k,v])=>r[k]===v)&&call.bounds.every(([op,k,v])=>r[k]&&(op==='gte'?r[k]>=v:r[k]<=v)));
        const defaultRows=call.range?allRows.slice(call.range[0],call.range[1]+1):allRows;
        return Promise.resolve(resolveRows?resolveRows(call,defaultRows):{data:json(defaultRows),error:null}).then(result=>Object.assign({count:allRows.length},result)).then(ok,fail);
      }};
  }};
  const sandbox={window:{supabase:{},BUSINESS_WEB_CENTER_SUPABASE:{url:'fixture',publishableKey:'fixture'},getBusinessSupabaseClient:()=>db},
    localStorage:{getItem:k=>values[k]||null},document:{getElementById:id=>fields[id]||null,querySelector:s=>s.includes('exportReport')?button:null,querySelectorAll:()=>[],
    addEventListener:(name,fn)=>{(events[name]||=[]).push(fn);},dispatchEvent(){},createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}},
    URL:{createObjectURL:b=>{blob=b;return 'blob:test';},revokeObjectURL(){}},Blob,alert:m=>alerts.push(m),
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},setInterval(){},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
    Date:class extends Date{constructor(...args){super(...(args.length?args:['2026-11-21T01:00:00Z']));}}};
  vm.runInNewContext(reporting,sandbox);
  vm.runInNewContext(inline(current),sandbox);
  return {api:sandbox.window.BWCExecutiveReport,dashboard:sandbox.window.BWCDashboardReport,window:sandbox.window,
    start:async()=>{await timers.find(t=>t.ms===900).fn();queries.length=0;},export:sandbox.window.exportReport,fields,values,queries,alerts,
    blob:()=>blob,setResponse:fn=>{resolveRows=fn;}};
}
async function ready(source){const s=setup(source);await s.start();return s;}
test('every inline production script and changed scripts parse',()=>{
  for(const m of current.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
  for(const name of ['reporting-online.js','executive-print.js','sw.js'])new vm.Script(fs.readFileSync(path.join(root,name),'utf8'));
});
test('Dashboard, Print and Excel share the same refreshed calculation',async()=>{
  const s=await ready(),r=await s.api.prepare();
  assert.equal(r.sales,3500.75);assert.equal(r.cost,201);assert.equal(r.gross,3299.75);assert.equal(r.opex,4060);assert.equal(r.totalExpenses,4261);assert.equal(r.net,-760.25);
  assert.deepEqual(json(r.salesRows),[['Dent repair + Panel repaint',3000.75],['Invoice payment / parts only',500]]);
  assert.equal(r.branch,'Test Branch');assert.equal(r.businessName,'Test Autocare');assert.equal(r.period,'November / 2026');
  assert.equal(s.fields.profit.textContent,printer.money(r.net));assert.equal(s.fields.paidSales.textContent,printer.money(r.sales));
  await s.export();const xml=await s.blob().text(),html=printer.html(r);
  for(const key of ['sales','cost','gross','opex','totalExpenses','net']){assert.ok(xml.includes('>'+r[key]+'</Data>'));assert.ok(html.includes(printer.money(r[key])));}
  assert.match(xml,/Payment date \/ expense date/);assert.match(xml,/INVOICES, COLLECTIONS AND BALANCES/);
  assert.doesNotMatch(xml,/NET INCOME|GROSS PROFIT/);
});
test('October Sta. Rosa reported totals regression (synthetic aggregate fixture)',async()=>{
  const october={id:'oct',invoice_date:'2026-10-01',total_amount:426998,amount_paid:426998,invoice_services:[{service_name:'October services'}],
    invoice_payments:[{payment_date:'2026-10-15',amount:312448},{payment_date:'2026-11-01',amount:114550}]};
  const previous={id:'sep',invoice_date:'2026-09-20',total_amount:80605,amount_paid:80605,invoice_services:[{service_name:'Prior-period services'}]};
  const s=await ready({invoices:[october,previous],invoice_payments:[
    {payment_date:'2026-10-15',amount:312448,invoices:october},
    {payment_date:'2026-11-01',amount:114550,invoices:october},
    {payment_date:'2026-10-20',amount:80605,invoices:previous}
  ],expenses:[{expense_date:'2026-10-20',category:'Cost of Sales',quantity:1,unit_amount:77409},{expense_date:'2026-10-20',category:'OPEX',quantity:1,unit_amount:124229.56}]});
  s.fields.dm.value='9';const r=await s.api.prepare();
  assert.equal(r.sales,393053);assert.equal(r.totalExpenses,201638.56);assert.equal(r.net,191414.44);
  assert.equal(s.fields.profit.textContent,'PHP 191,414.44');
  assert.equal(r.reconciliationRows[1][1],426998);assert.equal(r.reconciliationRows[5][1],80605);
  assert.notEqual(r.net,225359.44);assert.equal(225359.44-r.net,33945);
  assert.ok(printer.html(r).includes('PHP 191,414.44'));assert.ok(s.api.workbook(r).includes('>191414.44</Data>'));
});
test('shared reads preserve business, branch and payment-date scope',async()=>{
  const s=await ready();await s.api.prepare();
  for(const q of s.queries)assert.deepEqual(q.filters,[['business_id','biz-test'],['branch_id','branch-test']]);
  const paid=s.queries.find(q=>q.table==='invoice_payments'&&q.columns.includes('invoices!inner'));
  assert.deepEqual(paid.bounds,[['gte','payment_date','2026-11-01'],['lte','payment_date','2026-11-30']]);
  assert.ok(paid.columns.includes('invoice_services(service_name,amount)'));
  assert.doesNotMatch(inline(current),/db\.from|amount_paid/);
});
test('records belonging to another branch or business are not exported',async()=>{
  const source=json(data);source.invoice_payments.push({branch_id:'other',payment_date:'2026-11-10',amount:99999},{business_id:'other',payment_date:'2026-11-10',amount:88888});
  const s=await ready(source);assert.equal((await s.api.prepare()).sales,3500.75);
});
test('no branch filter is labelled all accessible branches',async()=>{
  const s=await ready();s.values['bwc-active-branch']='';s.fields.onlineBranchPicker.value='';
  const r=await s.api.prepare();assert.equal(r.branch,'All accessible branches');
  for(const q of s.queries)assert.deepEqual(q.filters,[['business_id','biz-test']]);
});
test('custom range includes boundary payment dates and overrides month',async()=>{
  const s=await ready();s.fields.dashboardDateFrom.value='2026-11-14';s.fields.dashboardDateTo.value='2026-11-20';
  const r=await s.api.prepare();assert.equal(r.period,'2026-11-14 to 2026-11-20');assert.equal(r.sales,2500.5);assert.equal(r.cost,0);assert.equal(r.opex,0);
});
test('January zero-valued month is filtered correctly',async()=>{
  const s=await ready();s.fields.dm.value='0';const r=await s.api.prepare();assert.equal(r.sales,0);assert.equal(r.salesRows.length,0);
});
test('all months is preserved when refreshing or exporting',async()=>{
  const s=await ready();s.fields.dm.value='';const r=await s.api.prepare();assert.equal(r.sales,12500.75);assert.equal(r.opex,4860);assert.equal(s.fields.dm.value,'');
});
test('all years remains selected when exporting',async()=>{
  const s=await ready();s.fields.dy.value='';await s.api.prepare();assert.equal(s.fields.dy.value,'');
});
test('incomplete or reversed custom dates fail before querying',async()=>{
  const s=await ready();s.fields.dashboardDateFrom.value='2026-11-20';await assert.rejects(s.api.prepare(),/both From and To/);assert.equal(s.queries.length,0);
  s.fields.dashboardDateTo.value='2026-11-01';await assert.rejects(s.api.prepare(),/cannot be after/);assert.equal(s.queries.length,0);
});
for(const key of ['branch','business','dates'])test('changing '+key+' while loading rejects stale reports',async()=>{
  const s=await ready();s.setResponse((q,rows)=>{if(key==='dates')s.fields.dm.value='9';else s.values['bwc-active-'+key]='changed';return {data:rows};});
  await assert.rejects(s.api.prepare(),/changed while loading/);
});
test('overlapping refreshes cannot return an older snapshot',async()=>{
  const s=await ready();let release;const gate=new Promise(r=>{release=r;});let held=false;
  s.setResponse(async(q,rows)=>{if(!held&&q.columns.includes('invoices!inner')){held=true;await gate;}return {data:rows};});
  const first=s.api.prepare();await Promise.resolve();await Promise.resolve();
  const second=s.api.prepare();const rejection=assert.rejects(first,/newer refresh/);await second;release();await rejection;
});
test('database errors never become zero reports or downloads',async()=>{
  const s=await ready();s.setResponse(()=>({data:null,error:new Error('Unavailable')}));
  await assert.rejects(s.api.prepare(),/Unavailable/);await s.export();assert.equal(s.blob(),null);assert.match(s.alerts[0],/Unavailable/);
});
test('missing or old Dashboard module fails closed',async()=>{
  const s=setup();await assert.rejects(s.api.prepare(),/still loading/);
  delete s.window.BWCDashboardReport;await assert.rejects(s.api.prepare(),/still loading/);
  s.window.BWCDashboardReport={prepare:async()=>({sales:123})};await assert.rejects(s.api.prepare(),/needs an update/);
});
test('payments are counted individually; invoice totals, discounts and parts are not counted again',async()=>{
  const source=json(data),invoice=source.invoices[0];
  source.invoice_payments=[{payment_date:'2026-11-01',amount:300,invoices:invoice},{payment_date:'2026-11-02',amount:400.25,invoices:invoice},
    {payment_date:'2026-12-01',amount:800,invoices:invoice},{payment_date:null,amount:900,invoices:invoice}];
  const s=await ready(source),r=await s.api.prepare();assert.equal(r.sales,700.25);assert.equal(r.paymentCount,2);assert.equal(r.salesRows[0][1],700.25);
});
test('undated legacy collections and writeoffs remain separate from dated receipts',async()=>{
  const source={invoices:[{invoice_date:'2026-11-01',total_amount:1000,amount_paid:700,invoice_payments:[],invoice_balance_writeoffs:[{amount:100}]}],invoice_payments:[],expenses:[]};
  const s=await ready(source),r=await s.api.prepare();assert.equal(r.sales,0);assert.equal(r.reconciliationRows[1][1],700);assert.equal(r.reconciliationRows[2][1],200);assert.equal(r.reconciliationRows[3][1],700);
});
test('pure shared calculator excludes undated payments even when invoice date is present',()=>{
  const s=setup(),r=s.dashboard.calculate({payments:[{invoice_date:'2026-11-01',amount:500,payment_date:null}]},{month:'10',year:'2026'});
  assert.equal(r.sales,0);
});
test('zero service amount, parts-only receipts, and special group names do not lose cash',()=>{
  const s=setup(),r=s.dashboard.calculate({payments:[
    {payment_date:'2026-11-01',amount:500,invoices:{total_amount:1000,invoice_services:[{service_name:'__proto__',amount:0}]}},
    {payment_date:'2026-11-01',amount:300,invoices:{total_amount:300,invoice_services:[]}}
  ]},{month:'10',year:'2026'});
  assert.equal(r.sales,800);assert.equal(r.salesRows.reduce((a,r)=>a+r[1],0),800);
});
test('prepared snapshot is independent of later source mutations',async()=>{
  const source=json(data),s=await ready(source),r=await s.api.prepare(),before=JSON.stringify(r);
  source.invoice_payments[0].amount=9000;await s.api.prepare();assert.equal(JSON.stringify(r),before);
});
test('print and Excel contain every grouped row, reconciliation and total',async()=>{
  const s=await ready(),r=await s.api.prepare(),before=JSON.stringify(r),html=printer.html(r),xml=s.api.workbook(r);
  for(const row of [...r.salesRows,...r.costRows,...r.opexRows,...r.reconciliationRows]){
    assert.ok(html.includes(row[0].replace(/&/g,'&amp;')));assert.ok(html.includes(printer.money(row[1])));assert.ok(xml.includes('>'+row[1]+'</Data>'));
  }
  assert.equal((html.match(/class="detail-row"/g)||[]).length,11);assert.match(html,/net negative/);assert.match(html,/PHP -760.25/);
  assert.doesNotMatch(html,/NET INCOME|GROSS PROFIT|they can differ/);assert.equal(JSON.stringify(r),before);
});
test('long descriptions and 150 groups are not shortened',async()=>{
  const s=await ready(),r=await s.api.prepare();r.salesRows=Array.from({length:150},(_,i)=>['Full description '+i+' '+('Panel repaint + Interior detailing + '.repeat(12)),1000+i/100]);
  const html=printer.html(r),xml=s.api.workbook(r);for(const row of r.salesRows){assert.ok(html.includes(row[0]));assert.ok(xml.includes(row[0]));}
  assert.equal((html.match(/class="detail-row"/g)||[]).length,159);assert.match(html,/table-header-group/);assert.match(html,/overflow-wrap:anywhere/);assert.doesNotMatch(html,/text-overflow:ellipsis|line-clamp/);
});
test('empty report still shows clear headings and zero totals',async()=>{
  const s=await ready({}),r=await s.api.prepare(),html=printer.html(r);
  for(const label of ['TOTAL CASH RECEIVED','TOTAL COST OF SALES','TOTAL OPERATING EXPENSES','TOTAL RECORDED EXPENSES','CASH RECEIVED LESS RECORDED COSTS AND OPEX'])assert.ok(html.includes(label));
  assert.equal((html.match(/class="detail-row"/g)||[]).length,9);assert.match(html,/No operating expenses/);
});
test('text fields are escaped in Print and Excel',async()=>{
  const s=await ready(),r=await s.api.prepare();r.businessName='<script>alert(1)</script>';r.branch='A & B';r.salesRows=[['<img src=x onerror=alert(1)>',12.34]];
  const html=printer.html(r),xml=s.api.workbook(r);for(const content of [html,xml]){assert.ok(content.includes('&lt;script&gt;'));assert.ok(content.includes('A &amp; B'));assert.doesNotMatch(content,/<script|<img/);}
  assert.match(html,/default-src 'none'/);
});
test('A4 and short bond carry identical numbers',async()=>{
  const s=await ready(),r=await s.api.prepare(),a=printer.html(r,'a4'),b=printer.html(r,'letter');assert.match(a,/@page\{size:A4 portrait/);assert.match(b,/@page\{size:letter portrait/);
  assert.deepEqual(a.match(/PHP [\d,.-]+/g),b.match(/PHP [\d,.-]+/g));
});
test('invalid model amounts stop report preparation',()=>{
  const s=setup();assert.throws(()=>printer.money(NaN),/invalid/);
  const r=s.dashboard.calculate({},{});r.net=NaN;assert.throws(()=>s.api.build(r,{label:'Test'},{}),/invalid/);
});
test('print button follows export and updated modules are versioned',()=>{
  assert.match(current,/Export Executive Excel<\/button><button[^>]*id="printFinancialReport"/);
  assert.match(current,/executive-print\.js\?v=20261121-payment-date-report/);
  assert.match(current,/reporting-online\.js\?v=20261122-unpaid-details/);
});
