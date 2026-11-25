const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../carwash.js'),{setup}=require('./helpers/carwash-db.cjs');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'carwash.js'),'utf8');
test('weekly cutoff is always Saturday–Friday, including month and year boundaries',()=>{
 assert.deepEqual(api.week('2026-11-27'),{from:'2026-11-21',to:'2026-11-27'});assert.deepEqual(api.week('2026-11-28'),{from:'2026-11-28',to:'2026-12-04'});
 assert.deepEqual(api.week('2027-01-01'),{from:'2026-12-26',to:'2027-01-01'});
 assert.equal(api.monthRange(2028,2).to,'2028-02-29');for(const args of [[2026,13],[1899,1],[2026,0]])assert.throws(()=>api.monthRange(...args));assert.throws(()=>api.week('2026-02-30'));
});
test('daily/month totals exclude neighboring dates while full weeks include them once',()=>{
 const rows=[['2026-10-31',100],['2026-11-01',200],['2026-11-01',50],['2026-11-27',150],['2026-11-28',250],['2026-12-04',300],['2026-12-05',900]].map(([service_date,price])=>({service_date,price}));rows.push({service_date:'2026-11-01',price:1000,voided_at:'now'});
 const s=api.summarize(rows,2026,11);assert.equal(s.total,650);assert.equal(s.count,4);assert.deepEqual(s.days[0],{date:'2026-11-01',count:2,total:250});assert.equal(s.weeks[0].total,350);assert.equal(s.weeks.at(-1).total,550);
 assert.equal(api.summarize([],2026,11).total,0);assert.equal(api.sum([{price:.1},{price:.2}]),.3);
});
test('paid entry validation uses the entered payment date, typed unit/plate and exact positive cents',()=>{
 const value={id:'id',revision:0,service_date:'2026-09-05',unit:' Honda City ',plate_number:' abc 123 ',price:'150.25'};
 const p=api.payload(value,'2026-11-25');assert.equal(p.plate_number,'ABC 123');assert.equal(p.unit,'Honda City');assert.equal(p.price,'150.25');
 for(const change of [{price:'0'},{price:'-1'},{price:'1.001'},{price:'NaN'},{price:'1e3'},{service_date:'2026-02-30'},{service_date:'2026-11-26'},{unit:''},{plate_number:''}])assert.throws(()=>api.payload({...value,...change},'2026-11-25'));
});
function fakeDB(rows,modify){const calls=[];return {calls,from(){let q={};return {select(c,o){q.count=o.count;return this},eq(k,v){q[k]=v;return this},is(k,v){q[k]=v;return this},gte(){return this},lte(){return this},order(){return this},async range(a,b){calls.push({...q,a,b});return modify?modify(a):{count:rows.length,data:rows.slice(a,Math.min(b+1,a+200))}}}}}}
const record=i=>({id:String(i),business_id:'b',branch_id:'rosa',service_date:'2026-11-25',price:150,voided_at:null});
test('complete scoped reads page through more than 1,000 carwashes and smaller server caps',async()=>{
 const db=fakeDB(Array.from({length:1205},(_,i)=>record(i))),rows=await api.read(db,{businessId:'b',branchId:'rosa'},'2026-11-01','2026-11-30');assert.equal(rows.length,1205);assert.deepEqual(db.calls.map(c=>c.a),[0,200,400,600,800,1000,1200]);assert.ok(db.calls.every(c=>c.branch_id==='rosa'&&c.business_id==='b'&&c.voided_at===null&&c.count==='exact'));
});
test('missing setup is distinguished from unsafe, failed or partial reads',async()=>{
 assert.deepEqual(await api.reportRows(fakeDB([],()=>({error:{code:'42P01'}})),{businessId:'b'}),{rows:[],available:false});
 for(const response of [{error:{code:'42501'}},{data:[record(1)],count:null},{data:[],count:1},{data:[{...record(1),branch_id:'tomas'}],count:1},{data:[record(1),record(1)],count:2}])await assert.rejects(api.read(fakeDB([],()=>response),{businessId:'b',branchId:'rosa'}));
});
test('dashboard combines separate carwash receipts once without changing invoice reconciliation',()=>{
 const sandbox={window:{},document:{addEventListener(){}},setTimeout(){},setInterval(){}};vm.runInNewContext(fs.readFileSync(path.join(root,'reporting-online.js'),'utf8'),sandbox);
 const invoice={invoice_date:'2026-10-01',total_amount:1000,amount_paid:500,invoice_services:[{service_name:'Repair',amount:1000}],invoice_payments:[{amount:500,payment_date:'2026-11-25'}]};
 const data={invoices:[invoice],payments:[{payment_date:'2026-11-25',amount:500,invoices:invoice}],expenses:[{expense_date:'2026-11-25',category:'Cost of Sales',quantity:1,unit_amount:100}],carwash:[{service_date:'2026-11-25',price:150},{service_date:'2026-10-31',price:900},{service_date:'2026-11-25',price:800,voided_at:'now'}]};
 const r=sandbox.window.BWCDashboardReport.calculate(data,{month:'10',year:'2026'});assert.equal(r.sales,650);assert.equal(r.net,550);assert.equal(r.carwashIncome,150);assert.equal(r.paymentCount,1);assert.equal(r.carwashCount,1);assert.equal(r.outsideInvoicePeriod,500);assert.equal(r.invoiceCount,0);assert.equal(r.unpaid,0);assert.equal(r.salesRows.reduce((n,r)=>n+r[1],0),650);assert.equal(r.serviceMix['Carwash income (separate register)'],150);
 const all=sandbox.window.BWCDashboardReport.calculate(data,{from:'2026-10-31',to:'2026-11-25'});assert.equal(all.carwashIncome,1050);
});
test('carwash database transactions and permissions',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
 const f=await setup(),{db,save,row,ids,user}=f;let saved,p;
 try{
  await t.test('new paid row and same-request retries post income once',async()=>{p=row();const request=crypto.randomUUID();saved=await save(p,request);assert.equal(saved.price,150);assert.equal(saved.plate_number,'QA 001');assert.deepEqual(await save(p,request),saved);assert.equal((await db.query('select count(*) n from carwash_records')).rows[0].n,1);await assert.rejects(save({...p,price:'200'},request),/different operation/)});
  await t.test('edit replaces an amount, with immutable audit and stale-write protection',async()=>{saved=await save({...p,revision:1,price:'200.50'});assert.equal(saved.price,200.5);assert.equal(saved.revision,2);await assert.rejects(save({...p,revision:1,price:'250'}),/Record changed/);assert.equal((await db.query('select sum(price) total from carwash_records')).rows[0].total,'200.50');assert.equal((await db.query('select count(*) n from carwash_events')).rows[0].n,2)});
  await t.test('invalid amounts/dates and cross-branch updates roll back',async()=>{for(const change of [{price:'0'},{price:'1.001'},{price:'NaN'},{unit:''},{plate_number:''},{service_date:'9999-01-01'},{service_date:'2025-02-30'}])await assert.rejects(save({...row(),...change}));await assert.rejects(save({...p,revision:2},crypto.randomUUID(),ids.other),/unavailable in this branch/)});
  await t.test('staff can edit only their permitted branch; cannot void or write tables directly',async()=>{
   await user(ids.editor);const staffRow=await save(row());assert.equal(staffRow.created_by,ids.editor);await assert.rejects(save(row(),crypto.randomUUID(),ids.other),/edit access/);await assert.rejects(save({action:'void',id:staffRow.id,revision:1}),/Only the owner/);
   await db.exec('set role authenticated');await assert.rejects(db.query('update carwash_records set price=1'),/permission denied/);await assert.rejects(db.query('delete from carwash_records'),/permission denied/);await db.exec('reset role');
   await user(ids.viewer);await assert.rejects(save(row()),/edit access/);await user(null);await assert.rejects(save(row()),/edit access/);await user(ids.owner);
  });
  await t.test('owner void excludes income but preserves the record and audit',async()=>{const v=await save({action:'void',id:saved.id,revision:2});assert.ok(v.voided_at);assert.equal(v.revision,3);assert.equal((await db.query('select count(*) n from carwash_records where id=$1',[saved.id])).rows[0].n,1);await assert.rejects(save({...p,revision:3}),/Record changed/)});
  await t.test('RLS filters branch reads and anonymous access stays closed',async()=>{await save(row(),crypto.randomUUID(),ids.other);await user(ids.viewer);await db.exec('set role authenticated');const rows=(await db.query('select * from carwash_records')).rows;assert.ok(rows.every(r=>r.branch_id===ids.branch));assert.equal((await db.query('select * from carwash_events')).rows.length,0);await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from carwash_records'),/permission denied/);await db.exec('reset role')});
  await t.test('unrelated business records remain unchanged',async()=>assert.deepEqual((await db.query('select * from existing_records order by kind')).rows,f.before));
 }finally{await db.close()}
});
test('app assets and income reports include CARWASH without printing, invoicing, or cash mutation',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 for(const asset of ['carwash.js?v=20261125-carwash','reporting-online.js?v=20261125-carwash','executive-print.js?v=20261125-carwash','vertical-layout.js?v=20261125-carwash']){assert.ok(html.includes(asset));assert.ok(worker.includes(asset))}
 assert.doesNotMatch(source,/\.print\(|create_invoice|cash_transactions|invoice_payments/);assert.match(source,/bwc:carwash-updated/);assert.match(source,/save_carwash_record/);
 new vm.Script(source);new vm.Script(worker);
 const reporting=fs.readFileSync(path.join(root,'reporting-online.js'),'utf8');assert.doesNotMatch(reporting,/paid=paid\.concat\(carwash/);assert.match(reporting,/var sales=receiptRows\.filter/);
});
