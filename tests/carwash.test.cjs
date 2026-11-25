const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const api=require('../carwash.js'),{setup}=require('./helpers/carwash-db.cjs');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'carwash.js'),'utf8');
test('Manila clock and elapsed minutes are timezone-safe, live while ongoing, frozen when done',()=>{
 assert.equal(api.today('2026-11-25T16:01:02Z'),'2026-11-26');assert.match(api.manilaTime('2026-11-25T16:01:02Z'),/12:01:02\s*AM/i);assert.equal(api.manilaTime(null),'Not recorded');
 const start='2026-11-25T15:59:00Z',ongoing={arrived_at:start,status:'ongoing',elapsed_seconds:null};
 assert.equal(api.elapsed(ongoing,Date.parse('2026-11-25T16:01:05Z')),125);assert.equal(api.duration(125),'2 min 05 sec');assert.equal(api.duration(3661),'61 min 01 sec');assert.equal(api.duration(null),'Not recorded');assert.equal(api.elapsed({status:'done',arrived_at:null}),null);
 assert.equal(api.elapsed(ongoing,Date.parse(start)-1000),0);
 const done={...ongoing,status:'done',elapsed_seconds:125,completed_at:'2026-11-25T16:01:05Z'};assert.equal(api.elapsed(done,Date.parse('2027-01-01')),125);
 let wall=10000,mono=100;const clock=api.createClock(()=>wall,()=>mono);assert.equal(clock.now(),10000);clock.sync(start);wall+=3600000;mono+=2000;assert.equal(clock.now(),Date.parse(start)+2000);assert.throws(()=>clock.sync('invalid'));
 assert.match(source,/root\.setInterval\(tick,1000\)/);assert.match(source,/Arrival time \(Manila\)/);assert.match(source,/data-cw-elapsed/);
});
test('weekly cutoff is always Saturday–Friday, including month and year boundaries',()=>{
 assert.deepEqual(api.week('2026-11-27'),{from:'2026-11-21',to:'2026-11-27'});assert.deepEqual(api.week('2026-11-28'),{from:'2026-11-28',to:'2026-12-04'});
 assert.deepEqual(api.week('2027-01-01'),{from:'2026-12-26',to:'2027-01-01'});
 assert.equal(api.monthRange(2028,2).to,'2028-02-29');for(const args of [[2026,13],[1899,1],[2026,0]])assert.throws(()=>api.monthRange(...args));assert.throws(()=>api.week('2026-02-30'));
});
test('daily/month totals exclude neighboring dates while full weeks include them once',()=>{
 const rows=[['2026-10-31',100],['2026-11-01',200],['2026-11-01',50],['2026-11-27',150],['2026-11-28',250],['2026-12-04',300],['2026-12-05',900]].map(([service_date,price])=>({service_date,payment_date:service_date,price}));rows.push({service_date:'2026-11-01',payment_date:'2026-11-01',price:1000,voided_at:'now'});
 const s=api.summarize(rows,2026,11);assert.equal(s.total,650);assert.equal(s.count,4);assert.deepEqual(s.days[0],{date:'2026-11-01',count:2,total:250});assert.equal(s.weeks[0].total,350);assert.equal(s.weeks.at(-1).total,550);
 assert.equal(api.summarize([],2026,11).total,0);assert.equal(api.sum([{price:.1},{price:.2}]),.3);
});
test('arrival entry validates optional charge but cannot mark itself paid',()=>{
 const value={id:'id',revision:0,service_date:'2026-09-05',unit:' Honda City ',plate_number:' abc 123 ',price:'150.25'};
 const p=api.payload({...value,payment_date:'2026-11-25'},'2026-11-25');assert.equal(p.plate_number,'ABC 123');assert.equal(p.unit,'Honda City');assert.equal(p.price,'150.25');assert.equal(p.payment_date,undefined);
 for(const change of [{price:'0'},{price:'-1'},{price:'1.001'},{price:'NaN'},{price:'1e3'},{service_date:'2026-02-30'},{service_date:'2026-11-26'},{unit:''},{plate_number:''}])assert.throws(()=>api.payload({...value,...change},'2026-11-25'));
});
function fakeDB(rows,modify){const calls=[];return {calls,from(){let q={};return {select(c,o){q.count=o.count;return this},eq(k,v){q[k]=v;return this},is(k,v){q[k]=v;return this},gte(){return this},lte(){return this},order(){return this},async range(a,b){calls.push({...q,a,b});return modify?modify(a):{count:rows.length,data:rows.slice(a,Math.min(b+1,a+200))}}}}}}
const record=i=>({id:String(i),business_id:'b',branch_id:'rosa',service_date:'2026-11-25',price:150,status:'ongoing',payment_date:null,voided_at:null});

test('work monitoring counts follow month and status, exclude voids, and do not depend on payment',async()=>{
 const rows=[{...record(1),price:null},{...record(2),payment_date:'2026-11-25'},{...record(3),status:'done',price:null},{...record(4),status:'done',payment_date:'2026-11-25'},{...record(5),voided_at:'2026-11-25'},{...record(6),status:'done',voided_at:'2026-11-25'},{...record(7),service_date:'2026-10-31'},{...record(8),status:'done',service_date:'2026-12-01'}];
 const counts=(month=11)=>{const s=api.summarize(rows,2026,month);return [s.ongoingCount,s.doneCount]};
 assert.deepEqual(counts(),[2,2]);assert.deepEqual(counts(10),[1,0]);assert.deepEqual(counts(12),[0,1]);assert.deepEqual(counts(9),[0,0]);
 rows.push({...record(9),price:null});assert.deepEqual(counts(),[3,2]);
 rows.at(-1).status='done';assert.deepEqual(counts(),[2,3]);
 rows.at(-1).status='ongoing';assert.deepEqual(counts(),[3,2]);
 rows.at(-1).voided_at='2026-11-25';assert.deepEqual(counts(),[2,2]);
 await assert.rejects(api.read(fakeDB([{...record(10),branch_id:'tomas'}]),{businessId:'b',branchId:'rosa'}));
 assert.match(source,/id="cwOngoingCount"/);assert.match(source,/id="cwDoneCount"/);assert.match(source,/aria-label="Carwash work status"/);
});

test('blank price is optional, not zero paid income; ongoing and done remain independent',async()=>{
 const value={service_date:'2026-11-25',unit:'Test car',plate_number:'QA',price:''};
 for(const price of ['',null,undefined,'   '])assert.equal(api.payload({...value,price},'2026-11-25').price,null);
 assert.throws(()=>api.payload({...value,price:0},'2026-11-25'));
 const rows=[{...record(1),price:null},{...record(2),price:null,status:'done'},{...record(3),price:100},{...record(4),price:200,status:'done'}];
 assert.equal((await api.read(fakeDB(rows),{businessId:'b',branchId:'rosa'})).length,4);
 const summary=api.summarize(rows,2026,11);assert.equal(summary.total,0);assert.equal(summary.count,4);assert.equal(summary.paidCount,0);
 for(const bad of [{price:''},{price:0},{price:undefined},{status:'unknown'},{payment_date:undefined},{payment_date:'2026-11-24'},{price:null,payment_date:'2026-11-25'}])await assert.rejects(api.read(fakeDB([{...record(1),...bad}]),{businessId:'b'}));
 assert.match(source,/Mark done/);assert.match(source,/Mark paid/);assert.match(source,/Unpaid/);assert.doesNotMatch(source,/name="price"[^>]*required/);
});
test('receipt summaries use confirmation date across months while unit register keeps arrival date',()=>{
 const rows=[{service_date:'2026-10-31',payment_date:'2026-11-25',price:150,status:'ongoing'},{service_date:'2026-11-25',payment_date:null,price:900,status:'done'},{service_date:'2026-11-25',payment_date:'2026-12-01',price:200,status:'done'}];
 const nov=api.summarize(rows,2026,11);assert.equal(nov.rows.length,2);assert.equal(nov.total,150);assert.equal(nov.paidCount,1);assert.equal(nov.days[0].date,'2026-11-25');assert.equal(nov.weeks.at(-1).total,200);
 assert.equal(api.summarize(rows,2026,10).total,0);assert.equal(api.summarize(rows,2026,12).total,200);
 assert.equal(api.paymentDate('2026-11-25','2026-10-31','2026-11-25'),'2026-11-25');
 for(const d of ['','2026-02-30','2026-10-30','2026-11-26'])assert.throws(()=>api.paymentDate(d,'2026-10-31','2026-11-25'));
});
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
 const data={invoices:[invoice],payments:[{payment_date:'2026-11-25',amount:500,invoices:invoice}],expenses:[{expense_date:'2026-11-25',category:'Cost of Sales',quantity:1,unit_amount:100}],carwash:[{service_date:'2026-10-31',payment_date:'2026-11-25',price:150},{service_date:'2026-10-31',payment_date:'2026-10-31',price:900},{service_date:'2026-11-25',payment_date:'2026-11-25',price:800,voided_at:'now'},{service_date:'2026-11-25',price:5000,status:'done',payment_date:null}]};
 data.carwash.push({service_date:'2026-11-25',price:null,status:'done'},{service_date:'2026-11-25',price:null,status:'ongoing'});
 const r=sandbox.window.BWCDashboardReport.calculate(data,{month:'10',year:'2026'});assert.equal(r.sales,650);assert.equal(r.net,550);assert.equal(r.carwashIncome,150);assert.equal(r.paymentCount,1);assert.equal(r.carwashCount,1);assert.equal(r.outsideInvoicePeriod,500);assert.equal(r.invoiceCount,0);assert.equal(r.unpaid,0);assert.equal(r.salesRows.reduce((n,r)=>n+r[1],0),650);assert.equal(r.serviceMix['Carwash income (separate register)'],150);
 data.carwash[0].status='done';assert.equal(sandbox.window.BWCDashboardReport.calculate(data,{month:'10',year:'2026'}).sales,650);
 const all=sandbox.window.BWCDashboardReport.calculate(data,{from:'2026-10-31',to:'2026-11-25'});assert.equal(all.carwashIncome,1050);
});
test('carwash database transactions and permissions',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
 const f=await setup(),{db,save,row,ids,user}=f;let saved,p;
 try{
  await t.test('new priced row defaults unpaid and request retry creates only one row',async()=>{p={...row(),payment_date:'2025-11-21',paid_at:'2025-11-21',paid_by:ids.owner};const request=crypto.randomUUID();saved=await save(p,request);assert.equal(saved.price,150);assert.equal(saved.payment_date,null);assert.equal(saved.paid_at,null);assert.equal(saved.paid_by,null);assert.equal(saved.plate_number,'QA 001');assert.deepEqual(await save(p,request),saved);assert.equal((await db.query('select count(*) n from carwash_records')).rows[0].n,1);await assert.rejects(save({...p,price:'200'},request),/different operation/)});
  await t.test('edit replaces an amount, with immutable audit and stale-write protection',async()=>{saved=await save({...p,revision:1,price:'200.50'});assert.equal(saved.price,200.5);assert.equal(saved.revision,2);await assert.rejects(save({...p,revision:1,price:'250'}),/Record changed/);assert.equal((await db.query('select sum(price) total from carwash_records')).rows[0].total,'200.50');assert.equal((await db.query('select count(*) n from carwash_events')).rows[0].n,2)});
  await t.test('invalid amounts/dates and cross-branch updates roll back',async()=>{for(const change of [{price:'0'},{price:'1.001'},{price:'NaN'},{unit:''},{plate_number:''},{service_date:'9999-01-01'},{service_date:'2025-02-30'}])await assert.rejects(save({...row(),...change}));await assert.rejects(save({...p,revision:2},crypto.randomUUID(),ids.other),/unavailable in this branch/)});
  await t.test('staff can edit only their permitted branch; cannot void or write tables directly',async()=>{
   await user(ids.editor);const staffRow=await save(row());assert.equal(staffRow.created_by,ids.editor);await assert.rejects(save(row(),crypto.randomUUID(),ids.other),/edit access/);await assert.rejects(save({action:'void',id:staffRow.id,revision:1}),/Only the owner/);
   await db.exec('set role authenticated');await assert.rejects(db.query('update carwash_records set price=1'),/permission denied/);await assert.rejects(db.query('delete from carwash_records'),/permission denied/);await db.exec('reset role');
   await user(ids.viewer);await assert.rejects(save(row()),/edit access/);await user(null);await assert.rejects(save(row()),/edit access/);await user(ids.owner);
  });
  await t.test('owner void excludes income but preserves the record and audit',async()=>{const v=await save({action:'void',id:saved.id,revision:2});assert.ok(v.voided_at);assert.equal(v.revision,3);assert.equal((await db.query('select count(*) n from carwash_records where id=$1',[saved.id])).rows[0].n,1);await assert.rejects(save({...p,revision:3}),/Record changed/)});
  await t.test('unpriced units default ongoing, can finish, be priced later and reopen without payment',async()=>{
   await user(ids.editor);let entry=await save({...row(),price:null,status:'done'});assert.equal(entry.status,'ongoing');assert.equal(entry.price,null);assert.equal(entry.completed_at,null);
   const request=crypto.randomUUID(),operation={action:'done',id:entry.id,revision:entry.revision};
   let done=await save(operation,request);assert.equal(done.status,'done');assert.equal(done.price,null);assert.ok(done.completed_at);assert.deepEqual(await save(operation,request),done);
   await assert.rejects(save(operation),/Record changed/);await assert.rejects(save({...operation,revision:done.revision}),/already changed/);
   await assert.rejects(save({...operation,revision:done.revision},crypto.randomUUID(),ids.other),/edit access/);
   const paid=await save({...row(),id:done.id,revision:done.revision,price:'175.50',status:'ongoing'});assert.equal(paid.status,'done');assert.equal(paid.price,175.5);assert.equal(paid.payment_date,null);assert.equal(paid.completed_at,done.completed_at);
   await user(ids.viewer);await assert.rejects(save({action:'reopen',id:paid.id,revision:paid.revision}),/edit access/);await user(ids.editor);
   const reopened=await save({action:'reopen',id:paid.id,revision:paid.revision});assert.equal(reopened.status,'ongoing');assert.equal(reopened.price,175.5);assert.equal(reopened.completed_at,null);
   const finished=await save({action:'done',id:paid.id,revision:reopened.revision});assert.equal(finished.price,175.5);assert.equal(finished.status,'done');
   const audit=(await db.query('select before_record,after_record from carwash_events where request_id=$1',[request])).rows[0];assert.equal(audit.before_record.status,'ongoing');assert.equal(audit.after_record.status,'done');
   await user(ids.owner);await assert.rejects(save({...operation,revision:finished.revision},crypto.randomUUID(),ids.other),/unavailable in this branch/);
   await assert.rejects(save({...operation,id:crypto.randomUUID(),revision:0}),/unavailable/);
   const blank=await save({...row(),price:''});assert.equal(blank.price,null);
  });
  await t.test('only Mark paid records a full receipt; retries, stale clicks, edits and void are safe',async()=>{
   await user(ids.editor);const entry=await save(row());const op={action:'paid',id:entry.id,revision:entry.revision,payment_date:'2025-12-01'};
   for(const d of ['', '2025-02-30', '2025-11-20', '9999-12-01'])await assert.rejects(save({...op,payment_date:d}));
   const blank=await save({...row(),price:null});await assert.rejects(save({...op,id:blank.id}),/Save the price first/);
   await user(ids.viewer);await assert.rejects(save(op),/edit access/);await user(ids.editor);
   const req=crypto.randomUUID(),paid=await save(op,req);assert.equal(paid.payment_date,'2025-12-01');assert.ok(paid.paid_at);assert.equal(paid.paid_by,ids.editor);assert.equal(paid.status,'ongoing');assert.deepEqual(await save(op,req),paid);
   await assert.rejects(save(op),/Record changed/);await assert.rejects(save({...op,revision:paid.revision}),/Already paid/);
   const audit=(await db.query('select before_record,after_record from carwash_events where request_id=$1',[req])).rows[0];assert.equal(audit.before_record.payment_date,null);assert.equal(audit.after_record.payment_date,'2025-12-01');
   for(const change of [{price:200},{price:null},{service_date:'2025-11-20'}])await assert.rejects(save({...row(),id:paid.id,revision:paid.revision,...change}),/locked/);
   const updated=await save({...row(),id:paid.id,revision:paid.revision,unit:'Corrected unit',payment_date:null});assert.equal(updated.payment_date,paid.payment_date);
   const done=await save({action:'done',id:paid.id,revision:updated.revision});assert.equal(done.payment_date,paid.payment_date);assert.equal(done.status,'done');
   const reopened=await save({action:'reopen',id:paid.id,revision:done.revision});assert.equal(reopened.payment_date,paid.payment_date);
   await user(ids.owner);await assert.rejects(save({...op,revision:reopened.revision},crypto.randomUUID(),ids.other),/unavailable in this branch/);
   const total=()=>db.query('select coalesce(sum(price),0) total from carwash_records where payment_date is not null and voided_at is null').then(r=>Number(r.rows[0].total));assert.equal(await total(),150);
   await save({action:'void',id:paid.id,revision:reopened.revision});assert.equal(await total(),0);
   await assert.rejects(save({...op,revision:reopened.revision+1}),/Record changed/);
  });
  await t.test('server timestamps arrival once and freezes elapsed seconds on Done without altering payment',async()=>{
   await user(ids.editor);
   const server=(await db.query('select carwash_access($1,$2) value',[ids.business,ids.branch])).rows[0].value;assert.ok(Number.isFinite(Date.parse(server.server_now)));
   const date=api.today(server.server_now),p={...row(),service_date:date,arrived_at:'1900-01-01',elapsed_seconds:999,completed_at:'1900-01-02'},req=crypto.randomUUID();let entry=await save(p,req);
   assert.equal(api.today(entry.arrived_at),date);assert.equal(entry.elapsed_seconds,null);assert.equal(entry.completed_at,null);assert.notEqual(entry.arrived_at,p.arrived_at);assert.deepEqual(await save(p,req),entry);
   entry=await save({...p,revision:entry.revision,price:'100'});assert.equal(entry.arrived_at,(await save(p,req)).arrived_at);
   await assert.rejects(save({...p,revision:entry.revision,service_date:'2025-01-01'}),/arrival date and time are locked/);
   const paid=await save({action:'paid',id:entry.id,revision:entry.revision,payment_date:date});assert.equal(paid.arrived_at,entry.arrived_at);assert.equal(paid.elapsed_seconds,null);assert.equal(paid.status,'ongoing');
   // Local fixture clock only: represent a visit that began 2 minutes 5 seconds ago.
   await db.query("update carwash_records set arrived_at=clock_timestamp()-interval '125 seconds',service_date=((clock_timestamp()-interval '125 seconds') at time zone 'Asia/Manila')::date where id=$1",[entry.id]);
   const op={action:'done',id:entry.id,revision:paid.revision,elapsed_seconds:999999,completed_at:'1900-01-01'},doneReq=crypto.randomUUID(),done=await save(op,doneReq);
   assert.equal(done.status,'done');assert.ok(done.elapsed_seconds>=125&&done.elapsed_seconds<130);assert.ok(Date.parse(done.completed_at)>Date.parse(done.arrived_at));assert.equal(done.payment_date,paid.payment_date);assert.equal(done.price,100);assert.deepEqual(await save(op,doneReq),done);
   await assert.rejects(save(op),/Record changed/);
   const edited=await save({...p,service_date:done.service_date,revision:done.revision,unit:'Timer test edited',price:'100'});assert.equal(edited.elapsed_seconds,done.elapsed_seconds);assert.equal(edited.completed_at,done.completed_at);assert.equal(edited.arrived_at,done.arrived_at);
   const reopened=await save({action:'reopen',id:done.id,revision:edited.revision});assert.equal(reopened.arrived_at,done.arrived_at);assert.equal(reopened.completed_at,null);assert.equal(reopened.elapsed_seconds,null);assert.equal(reopened.payment_date,done.payment_date);
   const again=await save({action:'done',id:done.id,revision:reopened.revision});assert.ok(again.elapsed_seconds>=done.elapsed_seconds);assert.equal(again.arrived_at,done.arrived_at);
   const audit=(await db.query('select after_record from carwash_events where request_id=$1',[doneReq])).rows[0].after_record;assert.equal(audit.elapsed_seconds,done.elapsed_seconds);assert.equal(audit.completed_at,done.completed_at);
   const historic=await save({...row(),arrived_at:'2025-11-21T08:00:00Z'});assert.equal(historic.arrived_at,null);const historicDone=await save({action:'done',id:historic.id,revision:historic.revision});assert.equal(historicDone.elapsed_seconds,null);assert.ok(historicDone.completed_at);
   await user(ids.viewer);await assert.rejects(save({action:'done',id:reopened.id,revision:again.revision}),/edit access/);await user(ids.owner);
  });
  await t.test('preview migration can be re-run without clearing entries or completion state',async()=>{
   const before=(await db.query('select * from carwash_records order by id')).rows;
   await db.exec(fs.readFileSync(path.join(root,'supabase/092_carwash_records.sql'),'utf8'));
   assert.deepEqual((await db.query('select * from carwash_records order by id')).rows,before);
  });
  await t.test('RLS filters branch reads and anonymous access stays closed',async()=>{await save(row(),crypto.randomUUID(),ids.other);await user(ids.viewer);await db.exec('set role authenticated');const rows=(await db.query('select * from carwash_records')).rows;assert.ok(rows.every(r=>r.branch_id===ids.branch));assert.equal((await db.query('select * from carwash_events')).rows.length,0);await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from carwash_records'),/permission denied/);await db.exec('reset role')});
  await t.test('unrelated business records remain unchanged',async()=>assert.deepEqual((await db.query('select * from existing_records order by kind')).rows,f.before));
 }finally{await db.close()}
});
test('app assets and income reports include CARWASH without printing, invoicing, or cash mutation',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 for(const asset of ['carwash.js?v=20261125-carwash-counts','reporting-online.js?v=20261125-carwash-payment','executive-print.js?v=20261125-carwash','vertical-layout.js?v=20261125-carwash']){assert.ok(html.includes(asset));assert.ok(worker.includes(asset))}
 assert.doesNotMatch(source,/\.print\(|create_invoice|cash_transactions|invoice_payments/);assert.match(source,/bwc:carwash-updated/);assert.match(source,/save_carwash_record/);
 new vm.Script(source);new vm.Script(worker);
 const reporting=fs.readFileSync(path.join(root,'reporting-online.js'),'utf8');assert.doesNotMatch(reporting,/paid=paid\.concat\(carwash/);assert.match(reporting,/var sales=receiptRows\.filter/);
});
