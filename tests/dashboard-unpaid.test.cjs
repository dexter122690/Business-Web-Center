const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'reporting-online.js'),'utf8'),ui=require('../dashboard-unpaid.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const invoice=(id,extra={})=>Object.assign({id:String(id),business_id:'biz',branch_id:'rosa',invoice_number:id,invoice_date:'2026-11-15',client_name:'Test Client',vehicle_make:'Toyota',plate_number:'ABC 0123',total_amount:1000,amount_paid:0,invoice_payments:[],invoice_balance_writeoffs:[]},extra);
function setup(rows=[]){
  const fields={dm:{value:'10'},dy:{value:'2026',options:[]},dashboardDateFrom:{value:''},dashboardDateTo:{value:''},unpaid:{}};
  const storage={'bwc-active-business':'biz','bwc-active-branch':'rosa'},events={},timers=[],queries=[];
  let respond=null,cap=500;
  const doc={getElementById:id=>fields[id]||null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(name,fn)=>(events[name]||=[]).push(fn),dispatchEvent:e=>(events[e.type]||[]).forEach(fn=>fn(e))};
  const db={auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},from(table){
    const q={table,filters:[],bounds:[],order:[]};queries.push(q);
    return {select(s,opts){q.select=s;q.count=opts?.count;return this},eq(k,v){q.filters.push([k,v]);return this},gte(k,v){q.bounds.push([k,v,1]);return this},lte(k,v){q.bounds.push([k,v,-1]);return this},order(k,v){q.order.push([k,v]);return this},range(a,b){q.range=[a,b];return this},then(ok,fail){
      let matches=(table==='invoices'?rows:[]).filter(r=>q.filters.every(([k,v])=>r[k]===v)&&q.bounds.every(([k,v,dir])=>dir===1?r[k]>=v:r[k]<=v));
      const result={data:copy(q.range?matches.slice(q.range[0],Math.min(q.range[1]+1,q.range[0]+cap)):matches),count:matches.length,error:null};
      return Promise.resolve(respond?respond(q,result):result).then(ok,fail);
    }};
  }};
  const sandbox={window:{supabase:{},BUSINESS_WEB_CENTER_SUPABASE:{url:'fixture',publishableKey:'fixture'},getBusinessSupabaseClient:()=>db},document:doc,localStorage:{getItem:k=>storage[k]||null},CustomEvent:class{constructor(type){this.type=type}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},setInterval(){},Date};
  vm.runInNewContext(source,sandbox);
  return {api:sandbox.window.BWCDashboardReport,fields,storage,queries,rows,events,
    start:()=>timers.find(t=>t.ms===900).fn(),emit:name=>doc.dispatchEvent({type:name}),lastTimer:()=>timers.at(-1).fn(),setResponse:fn=>respond=fn,setCap:n=>cap=n};
}
test('unpaid breakdown equals the card using paid history, legacy header and writeoffs',async()=>{
  const s=setup([invoice(1),invoice(2,{amount_paid:100,invoice_payments:[{amount:300},{amount:200,payment_date:'2026-12-20'}]}),invoice(3,{amount_paid:700,invoice_balance_writeoffs:{amount:100}}),invoice(4,{amount_paid:1000}),invoice(5,{amount_paid:1200}),invoice(6,{invoice_balance_writeoffs:[{amount:1000}]}),invoice(7,{invoice_date:'2026-10-01'}),invoice(8,{branch_id:'tomas'}),invoice(9,{business_id:'other'})]);
  await s.start();const view=s.api.unpaidSnapshot();assert.equal(view.status,'ready');assert.equal(view.total,1700);assert.equal(s.fields.unpaid.textContent,'PHP 1,700.00');
  assert.deepEqual(copy(view.rows.map(r=>r.number)),['INV-00001','INV-00002','INV-00003']);assert.equal(view.rows[1].paid,500);assert.equal(view.rows[2].writtenOff,100);assert.equal(view.rows[0].status,'Unpaid');assert.equal(view.rows[1].status,'Partially paid');assert.equal(view.rows.reduce((n,r)=>n+r.balance,0),view.total);
});
test('list and card match the example PHP 71,700.88 without hardcoding',async()=>{
  const s=setup([invoice(1,{total_amount:30000}),invoice(2,{total_amount:50000,amount_paid:10000}),invoice(3,{total_amount:2000,amount_paid:299.12})]);await s.start();
  const view=s.api.unpaidSnapshot();assert.equal(view.total,71700.88);assert.equal(s.fields.unpaid.textContent,'PHP 71,700.88');assert.match(ui.tableHtml(view.rows,true),/PHP 1,700.88/);
});
test('floating-point residue never lists a settled invoice as PHP 0.00 unpaid',async()=>{
  const s=setup([invoice(1,{total_amount:0.8,invoice_payments:[{amount:0.7},{amount:0.1}]}),invoice(2,{total_amount:0.81,amount_paid:0.8})]);await s.start();
  const view=s.api.unpaidSnapshot();assert.equal(view.rows.length,1);assert.equal(view.rows[0].balance,0.01);assert.equal(view.total,0.01);
});
test('all outstanding invoices are read across pages and smaller server caps',async()=>{
  const s=setup(Array.from({length:1205},(_,i)=>invoice(i+1,{total_amount:10.25})));s.setCap(200);await s.start();
  const view=s.api.unpaidSnapshot();assert.equal(view.rows.length,1205);assert.equal(view.total,12351.25);assert.equal((ui.tableHtml(view.rows,true).match(/data-unpaid-row=/g)||[]).length,1205);
  const queries=s.queries.filter(q=>q.range);assert.deepEqual(queries.map(q=>q.range[0]),[0,200,400,600,800,1000,1200]);
  for(const q of queries){assert.equal(q.count,'exact');assert.deepEqual(q.filters,[['business_id','biz'],['branch_id','rosa']]);assert.deepEqual(q.order.map(o=>o[0]),['invoice_date','id'])}
});
for(const scenario of ['error','throw','count','missing','duplicate','scope','business'])test('no stale or partial breakdown after '+scenario+' failure',async()=>{
  const s=setup(Array.from({length:501},(_,i)=>invoice(i+1)));await s.start();
  s.setResponse((q,r)=>{if(!q.range||q.range[0]===0)return r;if(scenario==='error')return {error:{message:'Unavailable'}};if(scenario==='throw')throw new Error('Disconnected');if(scenario==='count')r.count++;if(scenario==='missing')r.count=null;if(scenario==='duplicate')r.data[0].id='1';if(scenario==='scope')r.data[0].branch_id='tomas';if(scenario==='business')r.data[0].business_id='other';return r});
  await assert.rejects(s.api.prepare());const view=s.api.unpaidSnapshot();assert.equal(view.status,'error');assert.equal(view.rows,undefined);assert.equal(s.fields.unpaid.textContent,'Unavailable');
  s.setResponse(null);await s.api.prepare();assert.equal(s.api.unpaidSnapshot().rows.length,501);
});
test('branch and month changes reject stale snapshots even before refresh handlers run',async()=>{
  const s=setup([invoice(1)]);await s.start();s.storage['bwc-active-branch']='tomas';assert.equal(s.api.unpaidSnapshot().status,'loading');await s.api.prepare();assert.equal(s.api.unpaidSnapshot().rows.length,0);
  s.storage['bwc-active-branch']='rosa';s.fields.dm.value='9';await s.api.prepare();assert.equal(s.api.unpaidSnapshot().rows.length,0);
});
test('custom range, January, all years and all branches use exactly the card scope',async()=>{
  const s=setup([invoice(1,{invoice_date:'2026-01-01'}),invoice(2,{invoice_date:'2025-01-31'}),invoice(3,{invoice_date:'2026-02-01'}),invoice(4,{invoice_date:'2026-01-15',branch_id:'tomas'})]);await s.start();
  s.fields.dm.value='0';s.fields.dy.value='';await s.api.prepare();assert.equal(s.api.unpaidSnapshot().rows.length,2);
  s.storage['bwc-active-branch']='';await s.api.prepare();assert.equal(s.api.unpaidSnapshot().total,3000);
  s.fields.dashboardDateFrom.value='2026-01-15';s.fields.dashboardDateTo.value='2026-02-01';await s.api.prepare();assert.equal(s.api.unpaidSnapshot().total,2000);
});
test('invoice save, deletion, payment correction and period events immediately hide old rows',async()=>{
  const s=setup([invoice(1)]);await s.start();
  for(const name of ['bwc:invoice-saved','bwc:invoice-deleted','bwc:invoice-payments-updated','bwc:invoices-loaded','bwc:dashboard-period-changed']){s.emit(name);assert.equal(s.api.unpaidSnapshot().status,'loading');await s.api.prepare();assert.equal(s.api.unpaidSnapshot().status,'ready')}
});
test('opening the Dashboard cannot cancel an already queued data refresh',async()=>{
  const s=setup([invoice(1)]);await s.start();s.rows[0].amount_paid=700;s.emit('bwc:invoice-saved');
  for(const handler of s.events.click)handler({target:{closest:selector=>selector.includes('[data-t="dashboard"]')?{}:null}});
  await s.lastTimer();assert.equal(s.api.unpaidSnapshot().status,'ready');assert.equal(s.api.unpaidSnapshot().total,300);
});
test('older in-flight refresh cannot overwrite a newer snapshot',async()=>{
  const s=setup([invoice(1)]);await s.start();let release,held=false;const gate=new Promise(r=>release=r);
  s.setResponse(async(q,r)=>{if(q.range&&!held){held=true;await gate}return r});const first=s.api.prepare();await Promise.resolve();s.rows[0].amount_paid=500;await s.api.prepare();release();await assert.rejects(first,/newer refresh/);assert.equal(s.api.unpaidSnapshot().total,500);
});
test('returned snapshots are copies, not mutable dashboard state',async()=>{
  const s=setup([invoice(1)]);await s.start();const view=s.api.unpaidSnapshot();view.rows[0].balance=0;view.context.branch='wrong';assert.equal(s.api.unpaidSnapshot().rows[0].balance,1000);assert.equal(s.api.unpaidSnapshot().context.branch,'rosa');
});
test('empty view, escaping, branch labels and no invoice access are clear',()=>{
  assert.match(ui.tableHtml([],true),/No unpaid or partially paid/);
  const row={id:'" onclick="bad',number:'<script>',client:'<img>',vehicle:'A & B',plate:'0012',balance:100,status:'Unpaid'};const html=ui.tableHtml([row],false);
  assert.doesNotMatch(html,/<script>|<img>|" onclick="/);assert.match(html,/&lt;script&gt;/);assert.match(html,/A &amp; B/);assert.match(html,/ disabled/);
  assert.equal(ui.periodLabel({month:'0',year:'2026'}),'January / 2026');assert.equal(ui.periodLabel({month:'',year:''}),'All months / All years');assert.equal(ui.periodLabel({from:'2026-11-01',to:'2026-11-10'}),'2026-11-01 to 2026-11-10');
});
test('UI is read-only, keyboard accessible and app shell versions match',()=>{
  const code=fs.readFileSync(path.join(root,'dashboard-unpaid.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');new vm.Script(code);
  assert.doesNotMatch(code,/\.(insert|update|delete|upsert|rpc)\s*\(/);assert.match(code,/event.key==='Enter'/);assert.match(code,/event.key===' '/);assert.match(code,/showModal\(\)/);assert.match(code,/bwc:open-invoice/);assert.match(code,/show\('invoices'\)/);
  for(const name of ['dashboard-unpaid','reporting-online']){assert.ok(html.includes(name+'.js?v=20261122-unpaid-details'));assert.ok(sw.includes(name+'.js?v=20261122-unpaid-details'))}
});
