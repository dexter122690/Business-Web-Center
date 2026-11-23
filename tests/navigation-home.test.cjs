const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const html=read('index.html');
function classes(){const values=new Set();return {toggle(name,on){on?values.add(name):values.delete(name)},contains:name=>values.has(name)}}

test('initial markup and script select Invoice Making without a Dashboard flash',()=>{
 const active=Array.from(html.matchAll(/<section class="view active" id="([^"]+)"/g),m=>m[1]);
 assert.deepEqual(active,['invoices']);
 assert.ok(html.includes("show('invoices');renderLists();"));
 assert.ok(!html.includes("show('dashboard');renderLists();"));
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
});

test('every visit starts on invoices regardless of last tab; subsequent navigation still works',()=>{
 const block=Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),m=>m[1]).find(s=>s.includes('function showTab(id)'));
 assert.ok(block);
 for(const previous of [null,'dashboard','formsFolder','payrollV2','expenses','owner','unknown']){
  const storage={'15m-last-tab':previous,'bwc-active-branch':'keep-branch','invoice-outbox':'keep-pending-invoices'},handlers={};
  const views=['dashboard','invoices','expenses','formsFolder','payrollV2'].map(id=>({id,classList:classes()}));
  const nav={buttons:[],set innerHTML(value){this.buttons=Array.from(value.matchAll(/data-restore-tab="([^"]+)"/g),m=>({dataset:{restoreTab:m[1]},classList:classes()}))},querySelectorAll(){return this.buttons}};
  const document={getElementById:id=>id==='nav'?nav:null,querySelectorAll:selector=>{assert.equal(selector,'.view');return views}};
  vm.runInNewContext(block,{document,window:{addEventListener:(event,fn)=>handlers[event]=fn},localStorage:{getItem:key=>storage[key]??null,setItem:(key,value)=>storage[key]=value}});
  handlers.load();
  assert.deepEqual(views.filter(v=>v.classList.contains('active')).map(v=>v.id),['invoices']);
  assert.deepEqual(nav.buttons.filter(b=>b.classList.contains('active')).map(b=>b.dataset.restoreTab),['invoices']);
  assert.equal(storage['15m-last-tab'],'invoices');
  nav.buttons.find(b=>b.dataset.restoreTab==='expenses').onclick();
  assert.deepEqual(views.filter(v=>v.classList.contains('active')).map(v=>v.id),['expenses']);
  assert.equal(storage['15m-last-tab'],'expenses');
  assert.equal(storage['bwc-active-branch'],'keep-branch');assert.equal(storage['invoice-outbox'],'keep-pending-invoices');
 }
});

test('Forms follows Client Requests including late tabs, preserving handlers, visibility and account footer',()=>{
 const make=(key,id='')=>({id,key,dataset:key?{restoreTab:key}:{},querySelector:()=>({}),onclick(){return key||id},hidden:false,classList:classes()});
 const forms=make('','formsFolderTab'),invoices=make('invoices'),dashboard=make('dashboard'),schedule=make('','scheduleTab');
 const footer={settings:{},logout:{}},nav={children:[forms,invoices,dashboard,schedule],querySelectorAll(){return this.children},insertBefore(child,before){this.children.splice(this.children.indexOf(child),1);const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,child)}};
 const css={},sidebar={footer,style:{getPropertyValue:key=>css[key],setProperty:(key,value)=>css[key]=value}},handlers={};
 let observer;
 class Observer{constructor(fn){this.callback=fn;observer=this}disconnect(){}observe(target){assert.strictEqual(target,nav)}}
 const document={getElementById:id=>id==='nav'?nav:id==='bwcSidebar'?sidebar:null,querySelector:()=>null};
 invoices.classList.toggle('active',true);dashboard.hidden=true;const click=forms.onclick;
 vm.runInNewContext(read('vertical-layout.js'),{document,MutationObserver:Observer,window:{MutationObserver:Observer,addEventListener:(event,fn)=>handlers[event]=fn,requestAnimationFrame:()=>1}});
 assert.deepEqual(nav.children,[dashboard,invoices,schedule,forms]);
 const requests=make('','clientRequestsTab');nav.children.push(requests);observer.callback();
 assert.deepEqual(nav.children,[dashboard,invoices,schedule,requests,forms]);
 handlers.load();observer.callback();
 assert.deepEqual(nav.children,[dashboard,invoices,schedule,requests,forms]);
 assert.strictEqual(forms.onclick,click);assert.equal(forms.onclick(),'formsFolderTab');
 assert.equal(invoices.classList.contains('active'),true);assert.equal(dashboard.hidden,true);assert.strictEqual(sidebar.footer,footer);
});

test('changed sidebar asset is versioned in the page and refreshed offline cache',()=>{
 const worker=read('sw.js');
 for(const source of [html,worker])assert.ok(source.includes('vertical-layout.js?v=20261124-invoice-home'));
 assert.match(worker,/bwc-invoice-offline-v32/);assert.match(worker,/version:32/);
 new vm.Script(read('vertical-layout.js'));new vm.Script(worker);
});
