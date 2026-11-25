const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),Q=require('../invoice-outbox.js');
const b='10000000-0000-4000-8000-000000000001',branch='10000000-0000-4000-8000-000000000002',other='10000000-0000-4000-8000-000000000003',user='10000000-0000-4000-8000-000000000004',second='10000000-0000-4000-8000-000000000005';
const scope=()=>({businessId:b,branchId:branch,userId:user,branchName:'TEST ROSA'});
const invoice=()=>({isNewInvoice:true,client:'Fictional test client',contact:'TEST ONLY',address:'TEST ONLY',email:'',make:'Test unit',yearModel:'2026',color:'White',plate:'TEST-ONLY',date:'2026-11-23',release:'',paymentDate:'2026-11-21',admin:'Fictional admin',method:'Cash',source:'Test',discount:30,total:500,paid:100,services:[{n:'PMS',d:'Fictional job',a:500}],parts:[{n:'Fictional part',q:2,p:15,a:30}],pms:{odometer_km:'45000',next_pms_date:'2027-01-01',next_pms_odometer_km:'50000',notes:'Test only'}});
function storage(){const data=new Map();return {data,get length(){return data.size},key:i=>[...data.keys()][i],getItem:k=>data.has(k)?data.get(k):null,setItem(k,v){data.set(k,String(v))},removeItem:k=>data.delete(k)}}
test('immutable records carry branch/account and unique IDs; other tabs cannot overwrite the queue',()=>{
 const s=storage(),a=Q.create(s),c=Q.create(s),first=Q.request(scope(),invoice(),crypto),next=Q.request({...scope(),branchId:other},invoice(),crypto);
 a.put(first);c.put(next);assert.equal(a.list().rows.length,2);assert.equal(Q.args(first).p_branch_id,branch);assert.equal(Q.args(next).p_branch_id,other);assert.notEqual(first.requestId,next.requestId);assert.notEqual(first.invoice.id,next.invoice.id);
 assert.throws(()=>a.put({...first,invoice:{...first.invoice,paid:200}}),/different/);assert.equal(a.list().rows[0].invoice.paid,100);
 const receipt={request_id:first.requestId,business_id:b,branch_id:branch,created_by:user,invoice_id:crypto.randomUUID(),invoice_number:1};
 assert.throws(()=>a.acknowledge(first,{...receipt,branch_id:other}),/match/);assert.equal(a.list().rows.length,2);a.acknowledge(first,receipt);assert.equal(a.list().rows.length,1);assert.equal(a.list().rows[0].requestId,next.requestId);
});
test('quota/corruption fail safely, legacy queues stay untouched and backups retain identity',()=>{
 const s=storage(),q=Q.create(s),r=Q.request(scope(),invoice(),crypto);s.setItem('15m-offline-invoice-queue','[{"number":"OFF-OLD"}]');q.put(r);s.setItem(Q.PREFIX+'damaged','bad JSON');
 assert.equal(q.legacyCount(),1);assert.equal(q.list().damaged,1);assert.equal(q.list().rows.length,1);
 const backup=q.backup(scope()),destination=Q.create(storage());assert.equal(destination.restore(backup,scope()),1);assert.deepEqual(destination.list().rows,[r]);assert.throws(()=>destination.restore(backup,{...scope(),userId:second}),/original account/);
 const before=s.getItem('15m-offline-invoice-queue');s.setItem=()=>{throw Error('QuotaExceeded')};assert.throws(()=>q.put(Q.request(scope(),invoice(),crypto)),/Quota/);assert.equal(s.getItem('15m-offline-invoice-queue'),before);
 assert.throws(()=>Q.request(scope(),{...invoice(),remoteId:'existing'},crypto),/review/);
});
function engine(){
 const s=storage(),q=Q.create(s),calls=[],saved=[];let current=scope(),actor=user,available=true,allowed=true,lost=false;const receipts=new Map();
 const client={auth:{getSession:async()=>({data:{session:{user:actor?{id:actor}:null}}})},rpc:async(name,args)=>{calls.push({name,args});if(!available)return {error:{message:'Network unavailable'}};if(name==='can_manage_invoice_branch')return {data:allowed};assert.equal(name,'create_invoice_from_outbox');if(!allowed)return {error:{message:'Permission denied'}};let result=receipts.get(args.p_request_id);if(!result){result={request_id:args.p_request_id,business_id:args.p_business_id,branch_id:args.p_branch_id,created_by:actor,invoice_id:crypto.randomUUID(),invoice_number:receipts.size+1};receipts.set(args.p_request_id,result)}if(lost){lost=false;return {error:{message:'Response lost'}}}return {data:result}}};
 const listeners={},window={crypto,addEventListener:(event,fn)=>listeners[event]=fn},navigator={onLine:true},document={getElementById:()=>null,addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'invoice-offline.js'),'utf8'),{window,navigator,document,localStorage:s,BwcInvoiceOutbox:Q,setTimeout,clearTimeout,setInterval(){},console,Blob,URL,alert(){},confirm:()=>false});
 const api=window.BwcInvoiceOffline;api.configure({db:()=>client,scope:()=>({...current}),refresh:async()=>{},saved:r=>saved.push(r)});
 return {api,s,q,calls,saved,receipts,navigator,listeners,branch(id){current.branchId=id},actor(id){actor=id;current.userId=id},network(value){available=value},allowed(value){allowed=value},loseResponse(){lost=true}};
}
test('original branch survives switching and partial responses retry once',async()=>{
 const h=engine();await h.api.verify();h.navigator.onLine=false;const r=await h.api.saveNew(invoice());assert.equal(h.q.list().rows.length,1);h.branch(other);h.navigator.onLine=true;h.loseResponse();await h.api.sync();assert.equal(h.receipts.size,1);assert.equal(h.q.list().rows.length,1);await h.api.sync();assert.equal(h.receipts.size,1);assert.equal(h.q.list().rows.length,0);assert.equal(h.saved[0].branch_id,branch);assert.equal(h.saved[0].request_id,r.requestId);
});
test('network failure while browser says online queues safely; account changes and denied permissions do not upload',async()=>{
 const h=engine();await h.api.verify();h.network(false);await h.api.saveNew(invoice());await h.api.sync();assert.equal(h.q.list().rows.length,1);h.network(true);h.actor(second);await h.api.sync();assert.equal(h.receipts.size,0);assert.equal(h.q.list().rows.length,1);h.actor(user);h.allowed(false);await h.api.sync();assert.equal(h.receipts.size,0);assert.equal(h.q.list().rows.length,1);await assert.rejects(h.api.saveNew(invoice()),/cannot create/);
});
test('offline preparation expires and full storage never reports a saved invoice',async()=>{
 const h=engine();h.navigator.onLine=false;await assert.rejects(h.api.saveNew(invoice()),/not ready/);h.navigator.onLine=true;await h.api.verify();h.navigator.onLine=false;
 const grant=[...h.s.data.keys()].find(k=>k.startsWith('bwc-invoice-offline-ready:'));h.s.setItem(grant,Date.now()-86400001);await assert.rejects(h.api.saveNew(invoice()),/not ready/);h.s.setItem(grant,Date.now());
 const put=h.s.setItem;h.s.setItem=(k,v)=>{if(k.startsWith(Q.PREFIX))throw Error('Quota');put(k,v)};await assert.rejects(h.api.saveNew(invoice()),/NOT SAVED/);assert.equal(h.q.list().rows.length,0);
});
test('acknowledging an upload never removes a newer pending invoice or an older unscoped record',async()=>{
 const h=engine();await h.api.verify();await h.api.saveNew(invoice());h.s.setItem('15m-offline-invoice-queue','[{"id":1}]');
 const remove=h.s.removeItem;let added=false;h.s.removeItem=k=>{if(k.startsWith(Q.PREFIX)&&!added){added=true;h.q.put(Q.request(scope(),invoice(),crypto))}remove(k)};
 await h.api.sync();assert.equal(h.receipts.size,1);assert.equal(h.q.list().rows.length,1);assert.equal(h.q.legacyCount(),1);
 h.s.removeItem=()=>{throw Error('Storage unavailable')};await h.api.sync();assert.equal(h.receipts.size,2);assert.equal(h.q.list().rows.length,1);h.s.removeItem=remove;await h.api.sync();assert.equal(h.receipts.size,2);assert.equal(h.q.list().rows.length,0);assert.equal(h.q.legacyCount(),1);
});
function invoiceForm(){
 const source=fs.readFileSync(path.join(root,'invoice-online.js'),'utf8'),body='window.createInvoice=async function(){'+source.split('window.createInvoice=async function(){')[1].split('window.deleteInvoice=')[0];
 const values={client:'Test client',contact:'TEST',address:'TEST',email:'',make:'Test car',yearModel:'2026',color:'White',plate:'TEST',invoiceDate:'2026-11-23',releaseDate:'',paymentDate:'2026-11-21',admin:'Test admin',method:'Cash',source:'Test',paid:'100',discountAmount:'30'};
 const fields=Object.fromEntries(Object.entries(values).map(([id,value])=>[id,{value}])),alerts=[],messages=[],saves=[];
 let resets=0,queueResult=async x=>({invoice:{number:'OFF-TEST'}});
 const context={window:{BwcPmsForm:{collect:()=>require('../pms-rules.js').details(invoice().pms)},BwcInvoiceOffline:{saveNew:async x=>{saves.push(x);return queueResult(x)}}},document:{getElementById:id=>fields[id]||null},services:invoice().services,parts:invoice().parts,inv:[],edit:null,navigator:{onLine:true},online:true,invoiceSaving:false,formValue:id=>fields[id].value,total:()=>500,alert:s=>alerts.push(s),message:s=>messages.push(s),resetInvoice:()=>resets++,setInvoiceFormMode(){},show(){},syncOfflineQueue(){},...fields};
 vm.createContext(context);vm.runInContext(body,context);
 return {context,fields,saves,alerts,messages,get resets(){return resets},save:()=>context.window.createInvoice(),result(fn){queueResult=fn}};
}
test('actual create handler keeps the form on storage failure and saves once on double click',async()=>{
 const f=invoiceForm();f.result(async()=>{throw Error('NOT SAVED: storage full')});await f.save();assert.equal(f.resets,0);assert.equal(f.context.invoiceSaving,false);assert.match(f.alerts[0],/NOT SAVED/);
 let finish;f.result(()=>new Promise(resolve=>finish=resolve));const first=f.save();await f.save();assert.equal(f.saves.length,2);assert.equal(f.resets,0);finish({invoice:{number:'OFF-TEST'}});await first;assert.equal(f.resets,1);assert.equal(f.saves[1].total,500);assert.equal(f.saves[1].pms.odometer_km,45000);assert.equal(f.context.invoiceSaving,false);
});
test('actual create handler rejects offline existing edits and unfinished reopened edits',async()=>{
 const f=invoiceForm();f.context.edit=1;f.context.inv=[{id:1,remoteId:'server-id'}];f.context.navigator.onLine=false;await f.save();assert.equal(f.saves.length,0);assert.equal(f.resets,0);assert.match(f.alerts[0],/cannot be edited offline/);
 f.context.inv=[];await f.save();assert.equal(f.saves.length,0);assert.match(f.alerts[1],/no longer loaded/);
});
test('existing-payment mutations fail immediately offline without touching the database',async()=>{
 const source=fs.readFileSync(path.join(root,'invoice-payments-online.js'),'utf8');
 for(const name of ['save','correctPayment','closeAsUnremittedCollection']){
  const body=source.split('async function '+name+'(){')[1].split('\n')[1];
  const call=vm.runInNewContext('(async function(){'+body+'})',{navigator:{onLine:false}});
  await assert.rejects(call(),/require.*internet/);
 }
});
test('service worker caches every real app dependency once and never caches database traffic',async()=>{
 const handlers={},origin='https://test.invalid',html=fs.readFileSync(path.join(root,'index.html'),'utf8');let cached=[],wait;
 vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),{URL,Response,console,self:{location:{origin},addEventListener:(n,fn)=>handlers[n]=fn,skipWaiting(){}},fetch:async()=>({ok:true,text:async()=>html}),caches:{open:async()=>({addAll:async urls=>cached=urls})}});
 handlers.install({waitUntil:p=>wait=p});await wait;assert.equal(cached.length,new Set(cached).size);
 for(const asset of cached){const url=new URL(asset);if(url.origin===origin)assert.ok(fs.existsSync(path.join(root,decodeURIComponent(url.pathname))),'Missing offline asset '+url.pathname)}
 assert.ok(cached.some(s=>s.includes('branch-online.js')));assert.ok(cached.some(s=>s.includes('supabase-js@2')));
 let intercepted=false;handlers.fetch({request:{url:'https://test.supabase.co/rest/v1/invoices',method:'GET'},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
});
test('new adapter never falls back to direct inserts or queues existing edits; assets are versioned',()=>{
 for(const file of ['invoice-online.js','invoice-offline.js','invoice-outbox.js','invoice-payment-print.js','sw.js'])new vm.Script(fs.readFileSync(path.join(root,file),'utf8'));
 const adapter=fs.readFileSync(path.join(root,'invoice-online.js'),'utf8');assert.doesNotMatch(adapter,/from\('invoices'\)\.insert|pending\.push\(x\)|writeOfflineQueue/);assert.match(adapter,/existing\.offlinePending/);assert.match(adapter,/invoiceSaving=true/);assert.match(adapter,/version!==remoteLoadVersion/);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');for(const file of ['invoice-online.js','invoice-offline.js','invoice-outbox.js','invoice-payment-print.js','pms-rules.js','pms-client-history.js','invoice-save-actions.js']){const version=['invoice-online.js','invoice-payment-print.js','invoice-save-actions.js'].includes(file)?'20261125-print-after-save':file==='invoice-offline.js'?'20261123-offline-safe':'20261125-pms-payment';assert.ok(html.includes(file+'?v='+version));assert.ok(sw.includes(file+'?v='+version))}assert.ok(html.indexOf('pms-rules.js')<html.indexOf('invoice-outbox.js'));assert.ok(html.indexOf('invoice-outbox.js')<html.indexOf('invoice-online.js'));assert.ok(html.indexOf('invoice-save-actions.js')<html.indexOf('invoice-online.js'));assert.match(sw,/html2canvas@1\.4\.1/);assert.match(sw,/jspdf@2\.5\.1/);assert.match(sw,/BWC_OFFLINE_STATUS/);
});
test('atomic PostgreSQL uploads',{skip:!process.env.BWC_PGLITE_PATH},async t=>{
 const {PGlite}=require(process.env.BWC_PGLITE_PATH),db=new PGlite(),read=name=>fs.readFileSync(path.join(root,'supabase',name),'utf8');
 await db.exec(`create role authenticated;create role anon;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table businesses(id uuid primary key,status text);create table branches(id uuid primary key,business_id uuid,name text,is_active boolean);
 create function can_manage_invoice_branch(b uuid,r uuid) returns boolean language sql stable as $$select auth.uid() in ('${user}'::uuid,'${second}'::uuid) and b='${b}'::uuid and r='${branch}'::uuid$$;
 create function set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
 insert into auth.users values('${user}'),('${second}');insert into businesses values('${b}','active');insert into branches values('${branch}','${b}','TEST ROSA',true),('${other}','${b}','TEST TOMAS',true);
 create table payroll_workers(id uuid primary key,business_id uuid,branch_id uuid);create table payroll_v2_directory(id uuid primary key,business_id uuid,branch_id uuid);
 grant usage on schema public,auth to authenticated,anon;set test.actor='${user}';`);
 await db.exec(read('003_invoices.sql').split('drop trigger if exists set_invoices_updated_at')[0]+'commit;');
 await db.exec(`alter table invoices add column branch_id uuid references branches(id),add column discount_amount numeric(14,2) default 0;create table invoice_balance_writeoffs(invoice_id uuid references invoices(id) on delete cascade,amount numeric(14,2));`);
 await db.exec(read('025_invoice_payment_history.sql').split('create index if not exists')[0]+'commit;');await db.exec(read('024_cash_controls.sql').split('create index if not exists')[0]+'commit;');
 await db.exec(read('014_cash_remittances.sql').split('insert into public.cash_collections (business_id, branch_id, invoice_id, received_date, amount, received_by)\nselect')[0]);
 await db.exec('commit;');await db.exec(read('038_pms_client_history.sql').split('create index if not exists')[0]+'commit;');await db.exec('alter table pms_service_records add column technician_employee_id uuid references payroll_v2_directory(id);');
 await db.exec(read('071_update_invoice_transaction.sql'));await db.exec(read('056_invoice_payment_cash_sync.sql'));await db.exec(read('079_invoice_outbox.sql'));await db.exec(read('079_invoice_outbox.sql'));
 const call=async record=>{const args=Object.values(Q.args(record));return (await db.query('select create_invoice_from_outbox('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',args.map(v=>typeof v==='object'?JSON.stringify(v):v))).rows[0].value};
 const count=async table=>(await db.query('select count(*)::int n from '+table)).rows[0].n;
 const snapshot=async()=>Object.fromEntries(await Promise.all(['invoices','invoice_services','invoice_parts','invoice_payments','cash_transactions','cash_collections','pms_service_records','invoice_upload_receipts'].map(async table=>[table,(await db.query('select * from '+table)).rows])));
 let record=Q.request(scope(),invoice(),crypto),receipt;
 await t.test('one transaction records lines, discount, real payment date, CIB and PMS',async()=>{
  await db.exec('set role authenticated');try{receipt=await call(record)}finally{await db.exec('reset role')}
  assert.equal(await count('invoices'),1);assert.equal(await count('invoice_payments'),1);assert.equal(await count('cash_transactions'),1);assert.equal(await count('pms_service_records'),1);
  const inv=(await db.query('select * from invoices')).rows[0];assert.equal(Number(inv.total_amount),500);assert.equal(Number(inv.amount_paid),100);assert.equal(inv.status,'Partially paid');assert.equal(inv.branch_id,branch);
  assert.equal((await db.query('select transaction_date::text as day from cash_transactions')).rows[0].day,'2026-11-21');
  assert.equal(Number((await db.query('select odometer_km from pms_service_records')).rows[0].odometer_km),45000);
 });
 await t.test('lost-response and simultaneous retries return the same receipt without any new rows',async()=>{
  const before=await snapshot();assert.deepEqual(await call(record),receipt);const results=await Promise.all([call(record),call(record)]);assert.deepEqual(results,[receipt,receipt]);assert.deepEqual(await snapshot(),before);
  await assert.rejects(call({...record,invoice:{...record.invoice,paid:200}}),/different invoice/);
 });
 await t.test('failure after header/lines/payment rolls the entire upload back',async()=>{
  const before=await snapshot();await db.exec(`create function test_failure() returns trigger language plpgsql as $$begin raise exception 'Test cash failure';end$$;create trigger test_failure before insert on cash_transactions for each row execute function test_failure();`);
  const retry=Q.request(scope(),invoice(),crypto);await assert.rejects(call(retry),/Test cash failure/);assert.deepEqual(await snapshot(),before);await db.exec('drop trigger test_failure on cash_transactions');await call(retry);assert.equal(await count('invoices'),2);
 });
 await t.test('foreign branches, reused identity and anonymous calls are denied',async()=>{
  await assert.rejects(call({...record,scope:{...record.scope,branchId:other}}),/original branch/);
  await db.exec(`set test.actor='${second}'`);await assert.rejects(call(record),/different invoice or account/);await db.exec(`set test.actor='';`);await assert.rejects(call(record),/original branch/);
  await db.exec(`set test.actor='${user}';set role anon`);try{await assert.rejects(call(record),/permission denied/)}finally{await db.exec('reset role')}
  await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from invoice_upload_receipts'),/permission denied/)}finally{await db.exec('reset role')}
 });
 await t.test('invalid amounts, missing dates and incomplete lines leave no partial records',async()=>{
  const before=await snapshot();for(const patch of [{paid:501},{paid:-1},{paymentDate:''},{client:''},{services:[{n:'PMS',a:'NaN'}]},{parts:[{n:'Part',q:0,p:10}]}])await assert.rejects(call(Q.request(scope(),{...invoice(),...patch},crypto)));assert.deepEqual(await snapshot(),before);
 });
 await t.test('deleted online invoices are never recreated by stale backups',async()=>{
  await db.query('delete from invoices where id=$1',[receipt.invoice_id]);await assert.rejects(call(record),/later deleted/);assert.equal(await count('invoices'),1);
 });
 await t.test('migration rerun preserves all populated business records',async()=>{const before=await snapshot();await db.exec(read('079_invoice_outbox.sql'));assert.deepEqual(await snapshot(),before)});
 await db.close();
});
