const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {create}=require('../invoice-save-actions.js');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const scope={userId:'owner',businessId:'business',branchId:'rosa'};
const record={requestId:'request-a',scope,invoice:{id:'offline:request-a',number:'OFF-REQUEST-A',client:'Saved client'}};
const receipt={request_id:'request-a',created_by:'owner',business_id:'business',branch_id:'rosa',invoice_id:'remote-a',invoice_number:251};
const saved={id:251,remoteId:'remote-a',number:'INV-00251',client:'Saved client',date:'2026-09-01',total:5000,paid:1000,services:[{n:'Saved service',a:5000}],parts:[]};
function fixture(){
 const calls=[],state={scope:{...scope},offline:false,pending:true,read:async()=>saved};
 const api=create({scope:()=>state.scope,read:async(s,id)=>{calls.push(['read',s,id]);return state.read()},pending:id=>state.pending&&id===record.invoice.id,offline:()=>state.offline,print:id=>calls.push(['print',id]),changed(){}});
 const queue=()=>api.queued(api.begin(),record);
 return {api,state,calls,queue};
}

test('print remains unavailable until both upload confirmation and saved record loading succeed',async()=>{
 const f=fixture();assert.equal(f.api.view(),null);f.queue();assert.equal(f.api.view().enabled,false);f.api.print();assert.equal(f.calls.length,0);
 let finish;f.state.read=()=>new Promise(resolve=>finish=resolve);const loading=f.api.confirmed(receipt);
 assert.equal(f.api.view().phase,'loading');assert.equal(f.api.view().number,'INV-00251');assert.equal(f.api.view().enabled,false);f.api.print();
 finish(saved);await loading;assert.equal(f.api.view().enabled,true);assert.equal(f.calls.filter(c=>c[0]==='print').length,0);
 f.api.print();assert.deepEqual(f.calls.at(-1),['print','remote-a']);
});

test('wrong invoice, branch, business or account receipt never enables print',async()=>{
 for(const change of [{request_id:'another'},{branch_id:'tomas'},{business_id:'other'},{created_by:'other'},{invoice_id:null},{invoice_number:null}]){
  const f=fixture();f.queue();await f.api.confirmed({...receipt,...change});assert.equal(f.api.view().phase,'pending');assert.equal(f.calls.length,0);
 }
});

test('failed or unverified saved record can be retried without making another invoice',async()=>{
 for(const response of [()=>{throw Error('network')},()=>null,()=>({...saved,remoteId:'wrong'}),()=>({...saved,id:999})]){
  const f=fixture();f.queue();f.state.read=response;await f.api.confirmed(receipt);assert.equal(f.api.view().phase,'error');assert.equal(f.api.find('remote-a'),null);f.api.print();assert.equal(f.calls.filter(c=>c[0]==='print').length,0);
  f.state.read=async()=>saved;await f.api.retry();assert.equal(f.api.view().phase,'ready');assert.deepEqual(f.calls.map(c=>c[0]),['read','read']);
 }
});

test('clearing, editing the form or starting a new invoice invalidates a late print response',async()=>{
 for(const action of ['clear','begin']){const f=fixture();f.queue();let finish;f.state.read=()=>new Promise(resolve=>finish=resolve);const loading=f.api.confirmed(receipt);f.api[action]();finish(saved);await loading;assert.equal(f.api.view(),null);assert.equal(f.api.find('remote-a'),null)}
});

test('a delayed local save cannot restore print after a new attempt or branch change',()=>{
 const f=fixture(),ticket=f.api.begin();f.api.begin();f.api.queued(ticket,record);assert.equal(f.api.view(),null);
 const next=f.api.begin();f.state.scope.branchId='tomas';f.api.queued(next,record);assert.equal(f.api.view(),null);
});

test('scope changes hide and block print even before the branch UI refreshes',async()=>{
 for(const key of ['branchId','businessId','userId']){const f=fixture();f.queue();await f.api.confirmed(receipt);f.state.scope[key]='other';assert.equal(f.api.view(),null);assert.equal(f.api.find('remote-a'),null);f.api.print();assert.equal(f.calls.filter(c=>c[0]==='print').length,0)}
});

test('late confirmation for an earlier invoice cannot replace the newest invoice',async()=>{
 const f=fixture();f.queue();const other={...record,requestId:'request-b',invoice:{...record.invoice,id:'offline:request-b'}};f.api.queued(f.api.begin(),other);await f.api.confirmed(receipt);assert.equal(f.api.view().phase,'pending');assert.equal(f.calls.length,0);
});

test('offline print explicitly uses only a durably saved local copy',()=>{
 const f=fixture();f.state.offline=true;assert.equal(f.api.view(),null);f.queue();assert.equal(f.api.view().temporary,true);f.api.print();assert.deepEqual(f.calls.at(-1),['print',record.invoice.id]);
 f.state.pending=false;assert.equal(f.api.view().enabled,false);f.api.print();assert.equal(f.calls.length,1);
 f.state.pending=true;f.state.offline=false;assert.equal(f.api.view().enabled,false);assert.equal(f.api.view().temporary,false);
});

test('print fallback holds an isolated saved snapshot, not a mutable cleared form or another invoice',async()=>{
 const f=fixture();f.queue();await f.api.confirmed(receipt);const copy=f.api.find('remote-a');copy.client='Unsaved changes';copy.services[0].a=1;
 assert.equal(f.api.find('remote-a').client,'Saved client');assert.equal(f.api.find('remote-a').services[0].a,5000);assert.equal(f.api.find('wrong-id'),null);
});

test('printer uses confirmed saved fallback for older invoices outside the loaded register',async()=>{
 const f=fixture();f.queue();await f.api.confirmed(receipt);let html='',printed=false;
 const win={closed:false,document:{images:[],open(){},write(text){html+=text},close(){}},print(){printed=true}};
 const window={BwcInvoiceOffline:{find:()=>null},BwcInvoiceSaveActions:f.api,open:()=>win,location:{href:'https://fictional.test'}};
 vm.runInNewContext(read('invoice-payment-print.js'),{window,inv:[],localStorage:{getItem:()=>null},navigator:{onLine:false},setTimeout(){},clearTimeout(){},alert:msg=>{throw Error(msg)},console});
 await window.printInvoice('remote-a');assert.equal(printed,true);assert.match(html,/INV-00251/);assert.match(html,/Saved client/);assert.match(html,/Saved service/);assert.match(html,/PHP 5,000.00/);
});

test('actual Create invoice handler arms print only after durable save and form reset',async()=>{
 const body='window.createInvoice=async function(){'+read('invoice-online.js').split('window.createInvoice=async function(){')[1].split('window.deleteInvoice=')[0];
 const events=[],fields=Object.fromEntries(Object.entries({client:'Client',contact:'Contact',address:'Address',email:'',make:'Car',yearModel:'2026',color:'Blue',plate:'TEST',invoiceDate:'2026-11-25',releaseDate:'',paymentDate:'',admin:'Admin',method:'Cash',source:'Walk-in',paid:'0',discountAmount:'0'}).map(([k,value])=>[k,{value}]));
 let fail=false;
 const context={window:{BwcInvoiceSaveActions:{begin(){events.push('begin');return 7},queued(ticket,r){events.push(['queued',ticket,r])}},BwcInvoiceOffline:{saveNew:async()=>{events.push('save');if(fail)throw Error('Storage full');return record}}},...fields,document:{getElementById:id=>fields[id]},navigator:{onLine:true},online:true,invoiceSaving:false,services:[{n:'Wash',a:100}],parts:[],inv:[],edit:null,total:()=>100,formValue:id=>fields[id].value,resetInvoice:()=>events.push('reset'),setInvoiceFormMode(){},show(){},message(){},alert(){},syncOfflineQueue:()=>events.push('sync')};
 vm.runInNewContext(body,context);await context.window.createInvoice();assert.deepEqual(events,['begin','save','reset',['queued',7,record],'sync']);events.length=0;fail=true;await context.window.createInvoice();assert.deepEqual(events,['begin','save']);
});

test('create acknowledgement uses the guarded direct reader; no automatic print call is introduced',()=>{
 const online=read('invoice-online.js'),actions=read('invoice-save-actions.js');assert.match(online,/readInvoiceForOpen\(db,scope.businessId,scope.branchId,id\)/);assert.match(online,/BwcInvoiceSaveActions\.confirmed\(receipt\)/);
 assert.match(actions,/button\.onclick=controller\.print/);assert.match(actions,/button\.disabled=!state.enabled/);assert.doesNotMatch(online,/window\.printInvoice\(/);
 for(const name of ['invoice-save-actions.js','invoice-online.js','invoice-payment-print.js'])assert.ok(read('index.html').includes(name+'?v=20261125-print-after-save'));
});
