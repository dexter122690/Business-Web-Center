const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
function storage(){const data=new Map();return {data,getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v))}}
const business='ce3d6ecf-239e-4b27-a1f6-0ce7ddd16875';
function admins(saved=storage()){
 const field={value:'',dataset:{},title:'',_html:'',get innerHTML(){return this._html},set innerHTML(v){this._html=v;this.value=''}};
 let scope={userId:'user-a',businessId:business,branchId:'rosa'},fail=false,workerLoader=async branch=>({data:[{full_name:branch==='rosa'?'Rose Ann Pajaret':'Tomas Admin',position:'Admin',is_active:true},{full_name:'Inactive Person',position:'Admin',is_active:false},{full_name:'Painter',position:'Auto painter',is_active:true}]});
 const db={rpc:async(_,args)=>{if(fail)throw Error('Network unavailable');return workerLoader(args.r)},from(){let branch;const query={select(){return query},eq(key,value){if(key==='branch_id')branch=value;return query},in:async()=>({data:[{full_name:branch==='rosa'?'Rose Ann Pajaret':'Tomas Admin'},{full_name:branch==='rosa'?'Branch Owner':'Tomas Owner'}]})};return query}};
 const context={db,businessId:business,invoiceScope:()=>({...scope}),localStorage:saved,navigator:{onLine:true},document:{getElementById:()=>field,querySelector:()=>null},message(){},console};
 const section=read('invoice-online.js').split('  function escapeHtml(value)')[1].split('  function paidFromHistory')[0];
 vm.createContext(context);vm.runInContext('function escapeHtml(value)'+section+';this.api={loadAdmins,renderOfflineAdmins};',context);
 return {field,context,saved,api:context.api,branch:value=>scope.branchId=value,user:value=>scope.userId=value,fail:()=>fail=true,loader:fn=>workerLoader=fn};
}
test('offline admin dropdown preserves real branch names, selected admin, and names after reopening',async()=>{
 const a=admins();await a.api.loadAdmins();assert.match(a.field.innerHTML,/Rose Ann Pajaret/);assert.match(a.field.innerHTML,/Branch Owner/);assert.doesNotMatch(a.field.innerHTML,/Painter|Inactive Person|Owner \/ Admin/);
 assert.equal((a.field.innerHTML.match(/value="Rose Ann Pajaret"/g)||[]).length,1);
 a.field.value='Rose Ann Pajaret';a.context.navigator.onLine=false;await a.api.loadAdmins();assert.equal(a.field.value,'Rose Ann Pajaret');
 const reopened=admins(a.saved);reopened.context.navigator.onLine=false;await reopened.api.loadAdmins();assert.match(reopened.field.innerHTML,/Rose Ann Pajaret/);
 assert.equal(a.saved.data.size,1);assert.ok([...a.saved.data.keys()][0].endsWith(':user-a:'+business+':rosa'));
});
test('admin cache cannot leak names or selection across accounts and branches',async()=>{
 const a=admins();await a.api.loadAdmins();a.field.value='Rose Ann Pajaret';a.branch('tomas');a.context.navigator.onLine=false;await a.api.loadAdmins();assert.equal(a.field.value,'');assert.doesNotMatch(a.field.innerHTML,/Rose Ann|Owner \/ Admin/);assert.match(a.field.innerHTML,/Connect online/);
 a.context.navigator.onLine=true;await a.api.loadAdmins();a.context.navigator.onLine=false;await a.api.loadAdmins();assert.match(a.field.innerHTML,/Tomas Admin/);assert.doesNotMatch(a.field.innerHTML,/Rose Ann/);
 a.user('user-b');await a.api.loadAdmins();assert.doesNotMatch(a.field.innerHTML,/Tomas Admin|Rose Ann/);
});
test('failed network uses cached admin names even if browser reports online',async()=>{
 const a=admins();await a.api.loadAdmins();a.fail();await a.api.loadAdmins();assert.match(a.field.innerHTML,/Rose Ann Pajaret/);assert.match(a.field.title,/last loaded online/);
});
test('first offline roster retains employee admins when optional Team Access lookup fails',async()=>{
 const a=admins();a.context.db.from=()=>{const q={select:()=>q,eq:()=>q,in:async()=>({error:{message:'Optional team lookup unavailable'}})};return q};
 await a.api.loadAdmins();a.context.navigator.onLine=false;await a.api.loadAdmins();assert.match(a.field.innerHTML,/Rose Ann Pajaret/);
});
test('late admin response from another branch never replaces current choices',async()=>{
 const a=admins();let finish;a.loader(branch=>branch==='rosa'?new Promise(resolve=>finish=resolve):Promise.resolve({data:[{full_name:'Tomas Admin',position:'Admin'}]}));
 const pending=a.api.loadAdmins();a.branch('tomas');await a.api.loadAdmins();finish({data:[{full_name:'Rose Ann Pajaret',position:'Admin'}]});await pending;
 assert.match(a.field.innerHTML,/Tomas Admin/);assert.doesNotMatch(a.field.innerHTML,/Rose Ann/);assert.equal([...a.saved.data.keys()].some(k=>k.endsWith(':rosa')),false);
});
test('empty successful roster replaces old cached admin names, malformed cache is safe',async()=>{
 const a=admins();await a.api.loadAdmins();a.loader(async()=>({data:[]}));a.context.db.from=()=>{const q={select:()=>q,eq:()=>q,in:async()=>({data:[]})};return q};await a.api.loadAdmins();a.context.navigator.onLine=false;await a.api.loadAdmins();assert.doesNotMatch(a.field.innerHTML,/Rose Ann/);
 a.saved.setItem('bwc-invoice-admins:user-a:'+business+':rosa','broken JSON');const b=admins(a.saved);b.context.navigator.onLine=false;await b.api.loadAdmins();assert.match(b.field.innerHTML,/Connect online/);
});
function printer(options={}){
 const saved=storage(),alerts=[],lookups=[],fetches=[],windows=[];
 saved.setItem('15m-custom-header',JSON.stringify({company:'15M AUTOCARE SERVICES'}));saved.setItem('15m-business-contact',JSON.stringify({address:'Branch address',phone:'Branch contact'}));saved.setItem('15m-custom-logo',options.logo||'/icons/15m-autocare-logo-transparent.png?v=1');
 saved.setItem('15m-replica-invoices',JSON.stringify([{id:1,client:'Fictional QA client',number:'INV-00001'}]));
 const invoice={id:'offline:unique-request',number:'OFF-UNIQUE-REF',offlinePending:true,client:'Actual client José & Sons',contact:'Client contact',address:'Client address',make:'Honda City',yearModel:'2020',plate:'ABC 123',date:'2026-11-23',paymentDate:'2026-11-21',admin:'Rose Ann Pajaret',total:5000,paid:2000,status:'Partially paid',services:[{n:'Per panel repainting',a:5000}],parts:[],payments:[],...options.invoice};
 class Reader{readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result='data:'+blob.type+';base64,'+Buffer.from(buffer).toString('base64');this.onload()})}}
 const cachedResponse=()=>new Response(new Blob(['PNG test data'],{type:'image/png'}));
 const window={location:{href:'https://bwc.test/index.html'},caches:{match:async url=>{lookups.push(url);return options.cache===false?undefined:cachedResponse()}},BwcInvoiceOffline:{find:id=>id===invoice.id?invoice:null},open(){const win={html:'',printed:false,closed:false,document:{images:options.images||[],open(){},write(s){win.html+=s},close(){}},print(){win.printed=true}};windows.push(win);return win}};
 const context={window,localStorage:saved,inv:[],navigator:{onLine:false},URL,AbortController,FileReader:Reader,fetch:async url=>{fetches.push(url);throw Error('Offline')},setTimeout:(fn,ms)=>ms===900?0:setTimeout(fn,ms),clearTimeout,console,alert:message=>alerts.push(message)};
 vm.runInNewContext(read('invoice-payment-print.js'),context);
 return {window,context,invoice,windows,alerts,lookups,fetches,print:(mode='capture')=>window.printInvoice(invoice.id,mode)};
}
test('customer offline print has embedded logo, exact saved admin/client names and payment date, no upload warning',async()=>{
 const p=printer(),w=await p.print();assert.match(w.html,/<img src="data:image\/png;base64,/);assert.equal(p.fetches.length,0);assert.equal(p.lookups[0],'https://bwc.test/icons/15m-autocare-logo-transparent.png?v=1');
 assert.doesNotMatch(w.html,/TEMPORARY OFFLINE|waiting to upload|not yet uploaded|Fictional QA client/);assert.match(w.html,/OFF-UNIQUE-REF/);
 assert.match(w.html,/<b>Actual client José &amp; Sons<\/b><small>Received by \/ Client signature/);assert.match(w.html,/<b>Rose Ann Pajaret<\/b><small>Prepared by/);
 assert.match(w.html,/2026-11-21/);assert.match(w.html,/Initial payment/);assert.match(w.html,/PHP 5,000.00/);assert.match(w.html,/PHP 2,000.00/);assert.match(w.html,/PHP 3,000.00/);
});
test('an empty current register cannot print an old QA record from unscoped storage',async()=>{
 const p=printer();await p.window.printInvoice(1,'capture');assert.equal(p.windows.length,0);assert.deepEqual(p.alerts,['Invoice record not found.']);
});
test('print waits until the logo has loaded instead of using a fixed short delay',async()=>{
 const image={complete:false},p=printer({images:[image]});const printing=p.print('print');
 for(let i=0;i<20&&!image.onload;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof image.onload,'function');assert.equal(p.windows[0].printed,false);image.complete=true;image.onload();await printing;assert.equal(p.windows[0].printed,true);
});
test('stored image data prints offline without fetching or cache lookups',async()=>{
 const p=printer({logo:'data:image/png;base64,TEST'}),w=await p.print();assert.match(w.html,/data:image\/png;base64,TEST/);assert.equal(p.lookups.length,0);assert.equal(p.fetches.length,0);
});
test('broken old logo URL falls back to the cached official 15M logo',async()=>{
 const p=printer({logo:'https://old.invalid/logo.png'});p.window.caches.match=async url=>url.startsWith('https://bwc.test/')?new Response(new Blob(['PNG'],{type:'image/png'})):undefined;
 const w=await p.print();assert.match(w.html,/data:image\/png;base64,/);assert.deepEqual(p.fetches,['https://old.invalid/logo.png']);
});
test('HTML and PDF capture share the corrected branded print; staff upload notices remain',()=>{
 const print=read('invoice-payment-print.js'),offline=read('invoice-offline.js');assert.match(print,/win=await printInvoice\(id,'capture'\)/);assert.match(offline,/invoice\(s\) waiting to upload/);assert.match(offline,/not yet confirmed online/);
 for(const file of ['invoice-online.js','invoice-payment-print.js','sw.js'])new vm.Script(read(file));
});
