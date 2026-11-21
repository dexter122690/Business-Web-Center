const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../service-category-report.js');
const p={business:'biz',branch:'rosa',month:'10',year:'2026',businessName:'Test Autocare',branchName:'STA. ROSA'};
const line=(name,amount,detail='')=>({service_name:name,amount,service_detail:detail});
const invoice=(id,lines,extra={})=>({id,business_id:'biz',branch_id:'rosa',invoice_number:id,invoice_date:'2026-11-02',client_name:'Client One',contact_number:'0917-000-0001',vehicle_make:'Toyota Vios',vehicle_year_model:'2023',vehicle_color:'White',plate_number:'ABC 0123',discount_amount:500,total_amount:6500,invoice_services:lines,...extra});
const records=[
  invoice('101',[line('PMS',2000),line('Per Panel Repainting',3000,'Hood'),line('Per Panel Repainting',2000,'Door')]),
  invoice('102',[line(' pms ',800),line('PMS',200,'Oil filter')],{client_name:' client  one ',contact_number:'09170000001',invoice_date:'2026-11-18',discount_amount:100,total_amount:900}),
  invoice('103',[line('Full Washover Repainting',12000)],{client_name:'Client Two',contact_number:'02',total_amount:11000,discount_amount:1000}),
  invoice('104',[line('Exterior Washover',5000),line('Custom Service',75.55)],{client_name:'Client Two',contact_number:'02',total_amount:5075.55,discount_amount:0}),
  invoice('105',[],{total_amount:600,discount_amount:0}),
  invoice('201',[line('PMS',9999)],{invoice_date:'2026-10-02'}),
  invoice('202',[line('PMS',8888)],{invoice_date:'2025-11-02'}),
  invoice('203',[line('PMS',7777)],{branch_id:'tomas'}),
  invoice('204',[line('PMS',6666)],{business_id:'other'}),
];
test('matching services only, no duplicate invoice count, no whole-invoice double counting',()=>{
  const before=JSON.stringify(records),data=api.model(records,p,'pms');
  assert.equal(data.rows.length,2);assert.equal(data.total,300000);assert.equal(data.clients,1);
  assert.equal(data.rows[1].lines.length,2);assert.equal(data.rows[0].discount,50000);assert.equal(data.rows[0].net,650000);
  assert.equal(data.groups.find(g=>g.key==='per panel repainting').count,1);
  assert.equal(data.groups.find(g=>g.key==='per panel repainting').total,500000);
  assert.equal(JSON.stringify(records),before);
});
test('all services subtotal excludes parts-only invoices and includes all categories once',()=>{
  const data=api.model(records,p,'');assert.equal(data.allCount,4);assert.equal(data.rows.length,4);assert.equal(data.clients,2);assert.equal(data.noServices,1);assert.equal(data.total,2507555);
  assert.equal(data.groups.reduce((n,g)=>n+g.total,0),data.total);
});
test('washover categories are distinct; unknown categories are not discarded',()=>{
  const data=api.model(records,p,'');assert.equal(data.groups.find(g=>g.name==='Full Washover Repainting').total,1200000);assert.equal(data.groups.find(g=>g.name==='Exterior Washover').total,500000);assert.equal(data.groups.find(g=>g.name==='Custom Service').total,7555);
});
test('empty and missing category totals are zero, with no unrelated records',()=>{
  const data=api.model(records,p,'ceramic booster');assert.equal(data.rows.length,0);assert.equal(data.total,0);assert.equal(data.clients,0);assert.match(api.tableHtml(data),/No invoices/);
});
test('month/year, January, all-months and all-years selections use invoice dates',()=>{
  assert.equal(api.model(records,{...p,month:'9'},'pms').total,999900);
  assert.equal(api.model(records,{...p,month:'',year:'2026'},'pms').total,1299900);
  assert.equal(api.model(records,{...p,year:''},'pms').total,1188800);
  assert.equal(api.matches('2026-01-01',{month:'0',year:'2026'}),true);
  assert.equal(api.matches('2026-11-01',{month:'0',year:'2026'}),false);
  assert.equal(api.matches('',p),false);
});
test('client count uses name plus contact; unknown clients do not merge',()=>{
  const rows=[invoice('1',[line('PMS',1)]),invoice('2',[line('PMS',1)],{contact_number:'different'}),invoice('3',[line('PMS',1)],{client_name:''}),invoice('4',[line('PMS',1)],{client_name:''})];
  assert.equal(api.model(rows,p,'pms').clients,4);
});
test('currency adds in cents and a discount is never guessed or allocated',()=>{
  const data=api.model([invoice('1',[line('PMS',0.1),line('PMS',0.2)],{discount_amount:0.1,total_amount:0.2})],p,'pms');assert.equal(data.total,30);assert.equal(data.rows[0].net,20);assert.equal(data.rows[0].discount,10);
});
test('duplicates and malformed financial values fail closed',()=>{
  assert.throws(()=>api.model([records[0],records[0]],p,''),/Duplicate/);
  for(const value of ['bad',Infinity,-1])assert.throws(()=>api.model([invoice('a',[line('PMS',value)])],p,''),/invalid amount/);
});
test('HTML escapes source fields and stable invoice IDs',()=>{
  const data=api.model([invoice('x" onclick="bad',[line('PMS',1,'<script>bad</script>')],{client_name:'<b>Client</b>'})],p,'pms'),html=api.tableHtml(data);
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;b&gt;'));assert.ok(html.includes('data-service-open="x&quot; onclick=&quot;bad"'));assert.ok(!html.includes('<script>bad'));
});
function clientFixture(rows,transform){
  const calls=[];
  return {calls,db:{from(table){const call={table,filters:[],orders:[]};calls.push(call);return {
    select(fields,options){call.fields=fields;call.options=options;return this;},eq(k,v){call.filters.push([k,v]);return this;},gte(k,v){call.from=v;return this;},lt(k,v){call.to=v;return this;},order(k,v){call.orders.push([k,v]);return this;},range(start,end){call.range=[start,end];return this;},
    then(ok,fail){let data=rows.filter(r=>call.filters.every(([k,v])=>r[k]===v)&&(!call.from||r.invoice_date>=call.from)&&(!call.to||r.invoice_date<call.to)),result={data:data.slice(call.range[0],call.range[1]+1),count:data.length,error:null};if(transform)result=transform(result,call,calls.length);return Promise.resolve(result).then(ok,fail);}
  };}}};
}
test('read queries are scoped by business/branch, invoice period, and stable order',async()=>{
  const f=clientFixture(records),rows=await api.readRecords(f.db,p,()=>true);assert.equal(rows.length,5);const call=f.calls[0];assert.deepEqual(call.filters,[['business_id','biz'],['branch_id','rosa']]);assert.equal(call.from,'2026-11-01');assert.equal(call.to,'2026-12-01');assert.deepEqual(call.orders.map(o=>o[0]),['invoice_date','invoice_number','id']);assert.equal(call.options.count,'exact');
});
test('December rollover and full-year ranges are correct',async()=>{
  const f=clientFixture([]);await api.readRecords(f.db,{...p,month:'11'},()=>true);assert.equal(f.calls[0].to,'2027-01-01');
  await api.readRecords(f.db,{...p,month:''},()=>true);assert.equal(f.calls[1].from,'2026-01-01');assert.equal(f.calls[1].to,'2027-01-01');
  await api.readRecords(f.db,{...p,year:''},()=>true);assert.equal(f.calls[2].from,undefined);
});
test('all 1,205 invoices are fetched and rendered',async()=>{
  const all=Array.from({length:1205},(_,i)=>invoice(String(i),[line('PMS',10.25)])),f=clientFixture(all),loaded=await api.readRecords(f.db,p,()=>true),data=api.model(loaded,p,'pms');
  assert.equal(loaded.length,1205);assert.equal(f.calls.length,3);assert.equal(data.total,1235125);assert.equal((api.tableHtml(data).match(/data-service-invoice=/g)||[]).length,1205);
});
test('lower server response cap still loads the complete list',async()=>{
  const all=Array.from({length:1100},(_,i)=>invoice(String(i),[])),f=clientFixture(all,r=>({...r,data:r.data.slice(0,200)}));assert.equal((await api.readRecords(f.db,p,()=>true)).length,1100);assert.equal(f.calls.length,6);
});
test('page failures, count changes, wrong scope and duplicate rows cannot produce partial totals',async()=>{
  const all=Array.from({length:600},(_,i)=>invoice(String(i),[]));
  for(const transform of [(r,c,n)=>n===2?{...r,error:{message:'offline'}}:r,(r,c,n)=>({...r,count:r.count+n}),r=>({...r,count:null}),(r,c,n)=>n===2?{...r,data:[all[0]]}:r,r=>({...r,data:[{...all[0],branch_id:'wrong'}]})])await assert.rejects(api.readRecords(clientFixture(all,transform).db,p,()=>true));
});
test('stale branch or period requests do not publish results',async()=>{
  let current=true;const f=clientFixture(records,r=>{current=false;return r;});assert.equal(await api.readRecords(f.db,p,()=>current),null);
});
test('XLSX exports selected invoice rows, numeric dates and amounts, with explicit discount rules',()=>{
  const data=api.model(records,p,'pms'),files=api.workbookFiles(data,p),sheet=files.find(f=>f.name==='xl/worksheets/sheet1.xml').data;
  assert.ok(sheet.includes('INV-00101'));assert.ok(sheet.includes('INV-00102'));assert.ok(!sheet.includes('INV-00103'));assert.ok(sheet.includes('before invoice-wide discounts'));
  assert.match(sheet,/<c r="B11" s="5"><v>\d+<\/v><\/c>/);assert.match(sheet,/<c r="J11" s="4"><v>2000<\/v>/);assert.match(sheet,/<c r="K11" s="4"><v>500<\/v>/);assert.match(sheet,/<c r="L11" s="4"><v>6500<\/v>/);assert.ok(!sheet.includes('s="undefined"'));
  assert.equal(api.excelDate('1970-01-01'),25569);assert.ok(sheet.includes('ySplit="10"'));assert.ok(sheet.includes('autoFilter ref="A10:L12"'));
});
test('export source strings cannot become formulas; XML unsafe characters are escaped',()=>{
  const data=api.model([invoice('1',[line('PMS',2)],{client_name:'=HYPERLINK("unsafe")',plate_number:'<bad>&\u0001'})],p,'pms'),sheet=api.workbookFiles(data,p).find(f=>f.name.endsWith('sheet1.xml')).data;
  assert.ok(sheet.includes('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK'));assert.ok(sheet.includes('&lt;bad&gt;&amp;'));assert.ok(!sheet.includes('<f>'));assert.ok(!sheet.includes('\u0001'));
});
test('real XLSX zip contains valid CRCs, sizes and workbook relationships',()=>{
  const bytes=Buffer.from(api.xlsx(api.model(records,p,'pms'),p));let offset=0,count=0;
  while(bytes.readUInt32LE(offset)===0x04034b50){const crc=bytes.readUInt32LE(offset+14),size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),start=offset+30+nameLength,data=bytes.subarray(start,start+size);assert.equal(api.crc32(data),crc);offset=start+size;count++;}
  assert.equal(count,6);assert.equal(bytes.readUInt32LE(offset),0x02014b50);assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);assert.equal(bytes.readUInt16LE(bytes.length-12),6);
});
test('empty category still exports an honest empty report',()=>{
  const data=api.model(records,p,'ceramic booster'),sheet=api.workbookFiles(data,p).find(f=>f.name.endsWith('sheet1.xml')).data;assert.ok(sheet.includes('No matching invoices'));assert.ok(!sheet.includes('INV-00101'));assert.ok(!sheet.includes('autoFilter'));
});
function openHelper(){
  const source=fs.readFileSync(path.join(__dirname,'../invoice-online.js'),'utf8');
  const normalize=source.slice(source.indexOf('  function normalize('),source.indexOf('  async function resolveBusiness'));
  const open=source.slice(source.indexOf('  async function readInvoiceForOpen('),source.indexOf("  document.addEventListener('bwc:open-invoice'"));
  return vm.runInNewContext(normalize+open+';readInvoiceForOpen');
}
test('Open invoice fetches exact ID and scope even outside cached register; preserves discount and payments',async()=>{
  const calls=[],r={...records[0],invoice_number:101,invoice_parts:[{part_name:'Filter',quantity:2,unit_price:50}],invoice_payments:[{amount:200,payment_date:'2026-11-03'}],invoice_balance_writeoffs:[{amount:300}],amount_paid:200};
  const db={from(table){calls.push(table);return {select(){return this;},eq(k,v){calls.push([k,v]);return this;},maybeSingle(){return Promise.resolve({data:r,error:null});}};}};
  const item=await openHelper()(db,'biz','rosa','101');assert.deepEqual(calls,['invoices',['id','101'],['business_id','biz'],['branch_id','rosa']]);assert.equal(item.discount,500);assert.equal(item.total,6500);assert.equal(item.parts[0].a,100);assert.equal(item.payments[0].amount,200);assert.equal(item.balance,6000);
});
test('Open invoice fails safely for missing/deleted records and wrong branch',async()=>{
  for(const data of [null,{...records[0],branch_id:'wrong'}]){const db={from(){return {select(){return this;},eq(){return this;},maybeSingle(){return Promise.resolve({data,error:null});}};}};await assert.rejects(openHelper()(db,'biz','rosa','101'));}
});
test('overlapping Open invoice requests only open the newest selection',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../invoice-online.js'),'utf8'),handlers={},pending={},opened=[],alerts=[];
  const code=source.slice(source.indexOf('  function normalize('),source.indexOf('  async function resolveBusiness'))+source.slice(source.indexOf('  var openInvoiceVersion=0;'),source.indexOf("  document.addEventListener('bwc:workers-updated'"));
  const sandbox={online:true,inv:[],localStorage:{getItem:k=>k==='bwc-active-business'?'biz':'rosa'},document:{addEventListener:(k,fn)=>handlers[k]=fn},window:{editInvoice:id=>opened.push(id),scrollTo(){}},setInvoiceFormMode(){},message(){},alert:s=>alerts.push(s),db:{from(){let id;return {select(){return this;},eq(k,v){if(k==='id')id=v;return this;},maybeSingle(){return new Promise(resolve=>pending[id]=resolve);}};}}};
  vm.runInNewContext(code,sandbox);const first=handlers['bwc:open-invoice']({detail:{remoteId:'101'}}),second=handlers['bwc:open-invoice']({detail:{remoteId:'102'}});
  pending['102']({data:records[1]});await second;pending['101']({data:records[0]});await first;assert.deepEqual(opened,['102']);assert.equal(alerts.length,0);assert.equal(sandbox.inv.length,1);
});
test('an interrupted edit cannot fall through into new-invoice creation',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../invoice-online.js'),'utf8'),start=source.indexOf('    if(edit&&(!existing||'),end=source.indexOf('\n',start),guard=source.slice(start,end);
  assert.ok(start>0);assert.ok(start<source.indexOf("message('Saving invoice securely"));
  function check(existing,online=true){const out={existing,online,edit:101,alert(){out.stopped=true;}};vm.runInNewContext('(function(){'+guard+'; completed=true;})()',out);return out;}
  assert.equal(check(null).completed,undefined);assert.equal(check({}).completed,undefined);assert.equal(check({remoteId:'saved'}).completed,true);assert.equal(check({offlinePending:true}).completed,true);
});
test('new report is read-only, scripts parse and versioned app shell includes it',()=>{
  const dir=path.join(__dirname,'..'),source=fs.readFileSync(path.join(dir,'service-category-report.js'),'utf8'),html=fs.readFileSync(path.join(dir,'index.html'),'utf8'),sw=fs.readFileSync(path.join(dir,'sw.js'),'utf8');
  new vm.Script(source);new vm.Script(fs.readFileSync(path.join(dir,'invoice-online.js'),'utf8'));assert.ok(!/\.(insert|update|delete|upsert|rpc)\s*\(/.test(source));
  assert.ok(html.includes('service-category-report.js?v=20261122-service-categories'));assert.ok(sw.includes('service-category-report.js?v=20261122-service-categories'));assert.ok(sw.includes('bwc-invoice-offline-v20'));
});
