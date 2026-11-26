const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'repaint-monitoring.js'),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));
const unit=(extra={})=>Object.assign({id:'unit-1',business_id:'business',branch_id:'rosa',vehicle_model:'Test unit',plate_number:'QA ONLY',work_label:'Washover',date_in:'2026-11-20',target_completion_date:'2026-12-03',released_at:null},extra);

// Execute the real browser script with an isolated in-memory database and DOM.
// No live connection, credentials, or production records are used by these tests.
function fixture(initial=[],options={}){
  const records={repaint_monitoring_jobs:copy(initial),repaint_monitoring_days:copy(options.days||[]),repaint_monitoring_tasks:copy(options.tasks||[])};
  const calls=[],listeners={},fields={},store=new Map([['bwc-active-business','business'],['bwc-active-branch','rosa']]);
  const page={innerHTML:'',querySelector:()=>({insertAdjacentHTML(){}})};
  const client={auth:{async getSession(){return {data:{session:{user:{id:'test-user'}}}}}},from(table){
    const call={table,action:'select',filters:[]};calls.push(call);
    return {
      select(){return this},order(){return this},single(){call.single=true;return this},
      eq(k,v){call.filters.push([k,v]);return this},is(k,v){call.filters.push([k,v]);return this},in(k,v){call.filters.push([k,v]);return this},
      insert(data){call.action='insert';call.data=copy(data);return this},update(data){call.action='update';call.data=copy(data);return this},delete(){call.action='delete';return this},
      then(resolve,reject){return Promise.resolve().then(async()=>{
        if(options.respond){const result=await options.respond(call);if(result!==undefined)return result;}
        const rows=records[table],matches=r=>call.filters.every(([k,v])=>Array.isArray(v)?v.includes(r[k]):r[k]===v);
        let data=rows.filter(matches);
        if(call.action==='insert'){data=[Object.assign({id:'new-unit',released_at:null},call.data)];rows.push(...data);}
        if(call.action==='update')data.forEach(r=>Object.assign(r,call.data));
        if(call.action==='delete')records[table]=rows.filter(r=>!matches(r));
        return {data:copy(call.single?data[0]:data),error:null};
      }).then(resolve,reject)}
    };
  }};
  const document={
    getElementById:id=>id==='repaintMonitoring'?page:null,
    querySelector:selector=>fields[selector]||null,
    createElement:()=>({}),head:{appendChild(){}},
    addEventListener(type,handler){(listeners[type]||=[]).push(handler)}
  };
  const context=vm.createContext({document,window:{confirm:()=>true,addEventListener(){}},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},setTimeout(){},Intl,Date});
  const hook=`\nwindow.testApi={load,current,maxDays,addUnit,releaseUnit,deleteUnit,setClient:c=>db=c,setSelection:(id,n)=>{selectedJob=id;selectedDay=n;draft=null},state:()=>({jobs,days,tasks,selectedJob,selectedDay,draft})};\n}());`;
  assert.ok(source.endsWith('}());\n')||source.endsWith('}());\r\n'));
  vm.runInContext(source.replace(/\}\(\)\);\s*$/,hook),context);
  const api=context.window.testApi;api.setClient(client);
  function event(type,attr,value='',newForm=false){
    const target={value,checked:true,dataset:{},parentElement:{querySelector:()=>({textContent:''})},
      closest:selector=>selector==='#repaintMonitoring'?page:selector==='.rm-add'&&newForm?{}:null,
      matches:selector=>selector.split(',').some(s=>s.trim()==='['+attr+']')};
    for(const handler of listeners[type]||[])handler({target});
  }
  return {api,page,records,calls,store,fields,event};
}

test('empty branch opens Add new unit instead of reading date_in from null',async()=>{
  const f=fixture();await f.api.load();
  assert.match(f.page.innerHTML,/No active units are available for this branch/);
  assert.match(f.page.innerHTML,/Add new unit/);assert.match(f.page.innerHTML,/data-rm-add/);
  assert.doesNotMatch(f.page.innerHTML,/Tracker could not load/);
  assert.equal(f.api.maxDays(null),1);assert.equal(f.api.current(),null);
  assert.equal(f.api.state().selectedDay,1);
  assert.deepEqual(f.calls.map(c=>c.table),['repaint_monitoring_jobs']);
  assert.ok(f.calls.every(c=>c.action==='select'),'Opening a branch must not seed demo records');
  assert.equal(f.records.repaint_monitoring_jobs.length,0);
});

test('null data response also has a usable empty state',async()=>{
  const f=fixture([],{respond:()=>({data:null,error:null})});await f.api.load();
  assert.match(f.page.innerHTML,/Add new unit/);assert.equal(f.api.current(),null);
});

test('every new-unit field can receive input/change with no current job',async()=>{
  const f=fixture();await f.api.load();
  for(const attr of ['unit','plate','color','procedure','scope','datein','target','worker']){
    for(const type of ['input','change'])assert.doesNotThrow(()=>f.event(type,'data-rm-new-'+attr,'Test',true));
  }
  assert.equal(f.api.state().draft,null);assert.ok(f.calls.every(c=>c.action==='select'));
});

test('first manually entered unit saves and opens the existing tracker',async()=>{
  const f=fixture();await f.api.load();
  const values={unit:'QA only',plate:'QA 001',color:'White',procedure:'Washover',scope:'',datein:'2026-11-26',target:'2026-12-09',worker:''};
  for(const [name,value] of Object.entries(values))f.fields['[data-rm-new-'+name+']']={value};
  f.fields['[data-rm-add-message]']={textContent:''};
  await f.api.addUnit();
  assert.equal(f.records.repaint_monitoring_jobs.length,1);
  assert.equal(f.records.repaint_monitoring_jobs[0].is_demo,false);
  assert.equal(f.records.repaint_monitoring_jobs[0].branch_id,'rosa');
  assert.equal(f.api.state().selectedJob,'new-unit');
  assert.match(f.page.innerHTML,/QA only/);assert.match(f.page.innerHTML,/data-rm-save/);
  assert.doesNotMatch(f.page.innerHTML,/Tracker could not load/);
  assert.equal(f.calls.filter(c=>c.action==='insert').length,1);
});

test('missing first-unit details do not create a record',async()=>{
  const f=fixture();await f.api.load();f.fields['[data-rm-add-message]']={textContent:''};
  await f.api.addUnit();assert.equal(f.records.repaint_monitoring_jobs.length,0);
  assert.match(f.fields['[data-rm-add-message]'].textContent,/Enter the unit/);
  assert.ok(f.calls.every(c=>c.action==='select'));
});

test('releasing the last active unit opens empty state and preserves its archived record',async()=>{
  const f=fixture([unit()]);await f.api.load();await f.api.releaseUnit();
  assert.equal(f.records.repaint_monitoring_jobs.length,1);
  assert.ok(f.records.repaint_monitoring_jobs[0].released_at);
  assert.equal(f.api.state().jobs.length,0);assert.equal(f.api.state().selectedJob,'');
  assert.equal(f.api.state().selectedDay,1);assert.equal(f.api.state().draft,null);
  assert.match(f.page.innerHTML,/No active units/);assert.match(f.page.innerHTML,/Add new unit/);
  assert.doesNotMatch(f.page.innerHTML,/Tracker could not load/);
  assert.equal(f.calls.filter(c=>c.action!=='select').length,1);
});

test('deleting the last unit in the isolated fixture also opens the empty form',async()=>{
  const f=fixture([unit()]);await f.api.load();await f.api.deleteUnit();
  assert.equal(f.records.repaint_monitoring_jobs.length,0);
  assert.match(f.page.innerHTML,/Add new unit/);assert.doesNotMatch(f.page.innerHTML,/Tracker could not load/);
});

test('existing Washover checklist and editing remain available without read-time writes',async()=>{
  const f=fixture([unit()],{tasks:[{job_id:'unit-1',day_number:1,task_number:1,completed:true,done_on:'2026-11-21'}]});
  const before=JSON.stringify(f.records);await f.api.load();
  assert.equal((f.page.innerHTML.match(/data-rm-day=/g)||[]).length,14);
  assert.equal(f.api.current().tasks[0].completed,true);assert.equal(JSON.stringify(f.records),before);
  f.event('input','data-rm-unit','Updated draft');
  assert.equal(f.api.current().job.vehicle_model,'Updated draft');assert.equal(f.api.current().dirty,true);
  assert.equal(JSON.stringify(f.records),before);
});

test('other procedures keep flexible day counts and saved progress',async()=>{
  const f=fixture([unit({work_label:'Other Procedure',work_scope:'Repaint bumper',target_completion_date:'2026-11-22'})],{days:[{job_id:'unit-1',day_number:1,progress_update:'Prepared bumper'}]});
  await f.api.load();assert.equal((f.page.innerHTML.match(/data-rm-day=/g)||[]).length,3);
  assert.match(f.page.innerHTML,/Prepared bumper/);assert.match(f.page.innerHTML,/Repaint bumper/);
});

test('new-unit typing does not dirty the selected existing unit',async()=>{
  const f=fixture([unit()]);await f.api.load();const before=JSON.stringify(f.api.current());
  f.event('input','data-rm-new-unit','Another unit',true);f.event('change','data-rm-new-procedure','Other Procedure',true);
  assert.equal(JSON.stringify(f.api.current()),before);
});

test('stale selection resets safely when switching from a populated branch to an empty one',async()=>{
  const f=fixture([unit()]);await f.api.load();f.api.setSelection('unit-1',14);
  f.store.set('bwc-active-branch','tomas');await f.api.load();
  assert.equal(f.api.state().selectedJob,'');assert.equal(f.api.state().selectedDay,1);
  assert.equal(f.api.state().days.length,0);assert.equal(f.api.state().tasks.length,0);
  assert.match(f.page.innerHTML,/No active units/);
  const last=f.calls.at(-1);assert.ok(last.filters.some(([k,v])=>k==='branch_id'&&v==='tomas'));
  assert.ok(last.filters.some(([k,v])=>k==='business_id'&&v==='business'));
  assert.ok(last.filters.some(([k,v])=>k==='released_at'&&v===null));
});

test('a late response from a previous branch cannot replace the current empty branch',async()=>{
  let resolveOld,started;
  const oldStarted=new Promise(r=>started=r);
  const f=fixture([],{respond:call=>{
    if(call.table==='repaint_monitoring_jobs'&&call.filters.some(([k,v])=>k==='branch_id'&&v==='rosa')){
      started();return new Promise(r=>resolveOld=r);
    }
  }});
  const oldLoad=f.api.load();await oldStarted;
  f.store.set('bwc-active-branch','tomas');await f.api.load();
  resolveOld({data:[unit()],error:null});await oldLoad;
  assert.equal(f.api.state().jobs.length,0);assert.match(f.page.innerHTML,/No active units/);
  assert.equal(f.calls.filter(c=>c.table!=='repaint_monitoring_jobs').length,0);
});

test('failed reads are still reported as errors, not falsely shown as an empty branch',async()=>{
  const f=fixture([],{respond:()=>({data:null,error:{message:'Connection interrupted'}})});await f.api.load();
  assert.match(f.page.innerHTML,/Tracker could not load: Connection interrupted/);
  assert.doesNotMatch(f.page.innerHTML,/No active units/);assert.ok(f.calls.every(c=>c.action==='select'));
});

test('page and offline shell reference the same updated tracker asset',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const asset=html.match(/src="(repaint-monitoring\.js\?v=[^"]+)"/)[1];
  assert.match(asset,/20261126-empty-branch/);assert.ok(sw.includes('/'+asset));
  assert.ok(Number(sw.match(/bwc-invoice-offline-v(\d+)/)[1])>=55);
});
