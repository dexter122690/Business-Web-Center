const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {model,details,numberFromAction,read,create}=require('../invoice-payment-history.js');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'invoice-payment-history.js'),'utf8');
const scope={businessId:'fictional-business',branchId:'fictional-rosa'};
const row={id:'fictional-invoice',business_id:scope.businessId,branch_id:scope.branchId,invoice_number:247,client_name:'Fictional client',vehicle_make:'Car',plate_number:'QA-ONLY',total_amount:6000,amount_paid:3000,invoice_payments:[{payment_date:'2026-11-24',created_at:'2026-11-24T09:00:00',payment_method:'GCash',amount:2000,reference_number:'QA-REF',notes:'Second payment'},{payment_date:'2026-11-23',payment_method:'Cash',amount:1000,notes:'Deposit'}],invoice_balance_writeoffs:[]};

test('history shows chronological payments, reference AND notes, and accurate partial totals',()=>{
 const m=model(row);assert.equal(m.paid,3000);assert.equal(m.total,6000);assert.equal(m.balance,3000);assert.equal(m.legacy,0);
 assert.equal(m.payments[0].payment_date,'2026-11-23');assert.equal(row.invoice_payments[0].payment_date,'2026-11-24');
 const html=details(row);assert.match(html,/QA-REF · Second payment/);assert.match(html,/₱3,000.00/);assert.match(html,/GCash/);
 assert.ok(html.indexOf('2026-11-23')<html.indexOf('2026-11-24'));assert.doesNotMatch(html,/Earlier recorded payment/);
});
test('fully paid, zero payments, and legacy undated amounts do not fabricate installments',()=>{
 assert.equal(model({...row,total_amount:3000}).balance,0);
 const empty={...row,amount_paid:0,invoice_payments:[]};assert.match(details(empty),/No individual payment entries/);assert.equal(model(empty).balance,6000);
 const legacy={...row,amount_paid:4000,invoice_date:'2026-10-01',payment_method:'Bank transfer'};
 assert.equal(model(legacy).legacy,1000);assert.match(details(legacy),/Earlier recorded payment: ₱1,000.00/);
 assert.doesNotMatch(details(legacy),/2026-10-01|Bank transfer/);assert.match(details(legacy),/date and method were not recorded/);
});
test('writeoffs are not counted as payments, and both relationship shapes work',()=>{
 for(const writeoffs of [[{amount:2000}],{amount:2000}]){
  const m=model({...row,invoice_balance_writeoffs:writeoffs});assert.equal(m.paid,3000);assert.equal(m.balance,1000);assert.equal(m.writtenOff,2000);
  assert.match(details({...row,invoice_balance_writeoffs:writeoffs}),/not a client payment/);
 }
});
test('history safely renders all user-supplied text and same-day payment order',()=>{
 const html=details({...row,client_name:'<img src=x onerror=alert(1)>',vehicle_make:'<b>Car</b>',plate_number:'<script>bad</script>',invoice_payments:[{payment_date:'<date>',payment_method:'<method>',reference_number:'<ref>',notes:'<note>',amount:5}]});
 assert.doesNotMatch(html,/<img|<script>|<method>|<note>/);assert.match(html,/&lt;img/);assert.match(html,/&lt;note&gt;/);
 const m=model({...row,invoice_payments:[{payment_date:'2026-11-24',created_at:'2026-11-24T10:00:00',amount:2},{payment_date:'2026-11-24',created_at:'2026-11-24T09:00:00',amount:1}]});assert.equal(m.payments[0].amount,1);
});
test('register button parses only an existing numeric invoice edit target',()=>{
 assert.equal(numberFromAction('editInvoice(247)'),247);assert.equal(numberFromAction(' editInvoice( 247 ); '),247);
 for(const value of ['editInvoice(0)','editInvoice("offline:123")','printInvoice(247)','editInvoice(247); evil()','editInvoice(-4)','editInvoice(x)'])assert.equal(numberFromAction(value),null);
});
function dbFixture(result){const calls=[];return {calls,db:{from(table){calls.push(['from',table]);return {select(fields){calls.push(['select',fields]);return this},eq(key,value){calls.push(['eq',key,value]);return this},async maybeSingle(){calls.push(['read']);return result}}}}}}
test('server history is a read-only query scoped to exact business, branch, and invoice',async()=>{
 const f=dbFixture({data:row});assert.equal(await read(f.db,scope,247),row);
 assert.deepEqual(f.calls.filter(c=>c[0]==='eq'),[['eq','business_id',scope.businessId],['eq','branch_id',scope.branchId],['eq','invoice_number',247]]);
 assert.match(f.calls[1][1],/invoice_payments/);assert.match(f.calls[1][1],/invoice_balance_writeoffs/);
 assert.doesNotMatch(source,/\.insert\(|\.update\(|\.delete\(|\.rpc\(|\.print\(|root\.open\(/);
});
test('server errors, missing permissions, mismatched rows and invalid scope fail closed',async()=>{
 for(const result of [{error:{message:'private database details'}},{data:null},{data:{...row,branch_id:'other'}},{data:{...row,business_id:'other'}},{data:{...row,invoice_number:248}}]){
  const f=dbFixture(result);await assert.rejects(read(f.db,scope,247),error=>!error.message.includes('private database details'));
 }
 for(const s of [null,{}, {...scope,branchId:''}])await assert.rejects(read(dbFixture({data:row}).db,s,247));
 for(const n of [0,-1,1.5,NaN,'247'])await assert.rejects(read(dbFixture({data:row}).db,scope,n));
});
function fixture(){
 const state={scope:{...scope},offline:false,reader:async()=>row},changes=[],calls=[];
 const api=create({scope:()=>state.scope,offline:()=>state.offline,read:async(s,n)=>{calls.push([s,n]);return state.reader()},changed:value=>changes.push(value&&{...value})});
 return {state,changes,calls,api};
}
test('dialog loads from server each time and can retry failed reads without writing',async()=>{
 const f=fixture();f.state.reader=async()=>{throw Error('Please retry')};await f.api.open(247);assert.equal(f.changes[0].phase,'loading');assert.equal(f.api.view().phase,'error');
 f.state.reader=async()=>row;await f.api.refresh();assert.equal(f.api.view().phase,'ready');assert.equal(f.calls.length,2);
 await f.api.open(247);assert.equal(f.calls.length,3);
});
test('offline mode clearly requires connection instead of silently showing stale payment data',async()=>{
 const f=fixture();f.state.offline=true;await f.api.open(247);assert.equal(f.api.view().phase,'error');assert.match(f.api.view().message,/Connect to the internet/);assert.equal(f.calls.length,0);
 f.state.offline=false;await f.api.refresh();assert.equal(f.api.view().phase,'ready');
});
test('branch/business changes and closing invalidate pending requests',async()=>{
 for(const action of ['branchId','businessId','close']){
  const f=fixture();let finish;f.state.reader=()=>new Promise(resolve=>finish=resolve);const loading=f.api.open(247);
  if(action==='close')f.api.close();else f.state.scope[action]='other';
  finish(row);await loading;assert.equal(f.api.view(),null);assert.equal(f.changes.at(-1),null);
 }
});
test('a late response cannot overwrite a newer selected invoice',async()=>{
 const f=fixture();let finish;f.state.reader=()=>new Promise(resolve=>finish=resolve);const first=f.api.open(247);
 f.state.reader=async()=>({...row,invoice_number:248});await f.api.open(248);finish(row);await first;
 assert.equal(f.api.view().number,248);assert.equal(f.api.view().row.invoice_number,248);
});
test('history has accessible dialog, safe scoped observer, close, and matching offline cache asset',()=>{
 assert.match(source,/aria-labelledby/);assert.match(source,/aria-live/);assert.match(source,/dialog\.showModal\(\)/);assert.match(source,/addEventListener\('cancel'/);assert.match(source,/lastFocus\.focus\(\)/);
 assert.match(source,/observer\.observe\(table/);assert.match(source,/data-view-payment-history/);
 const asset='invoice-payment-history.js?v=20261125-history-button';for(const file of ['index.html','sw.js'])assert.ok(fs.readFileSync(path.join(root,file),'utf8').includes(asset));
 new vm.Script(source);new vm.Script(fs.readFileSync(path.join(root,'sw.js'),'utf8'));
});
