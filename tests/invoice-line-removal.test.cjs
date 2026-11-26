const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const editor=html.slice(html.indexOf(' /* Recommendation 3:')).split('</script>')[0];
const legacy=html.slice(html.indexOf('function addService(){'),html.indexOf('function printInvoice(id){'));
const saveSource='window.createInvoice=async function(){'+fs.readFileSync(path.join(root,'invoice-online.js'),'utf8').split('window.createInvoice=async function(){')[1].split('window.deleteInvoice=')[0];
const discounts=fs.readFileSync(path.join(root,'invoice-discounts.js'),'utf8');
const discountMath=discounts.slice(discounts.indexOf('  function money('),discounts.indexOf('  function install('));
const branches=[['STA. ROSA','84fecf85-fdd8-4dc6-bf8c-20f007782af7'],['STO. TOMAS','c87de8df-6ab3-4392-9508-612de0ec05f6']];

function fixture(branch){
 const nodes={},listeners={},timers=[],observers=[],calls=[],alerts=[];
 class Element{
  constructor(tag='div',attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.dataset={};this.children=[];this.style={};this.value='';this.textContent='';this.disabled=false;if(attrs.id)nodes[attrs.id]=this;}
  appendChild(child){child.parent=this;this.children.push(child);if(child.id)nodes[child.id]=child;return child;}
  insertBefore(child,before){child.parent=this;const i=this.children.indexOf(before);this.children.splice(i<0?0:i,0,child);if(child.id)nodes[child.id]=child;}
  insertAdjacentElement(where,child){const p=this.parent,i=p.children.indexOf(this);child.parent=p;p.children.splice(i+(where==='afterend'?1:0),0,child);if(child.id)nodes[child.id]=child;}
  get id(){return this.attrs.id;}set id(value){this.attrs.id=value;nodes[value]=this;}
  getAttribute(name){return this.attrs[name]??null;}
  matches(selector){
   const s=selector.trim(),space=s.indexOf(' ');if(space>=0&&s[space-1]!==':'){
    const prefix=s.slice(0,space),rest=s.slice(space+1);let p=this.parent;while(p){if(p.matches(prefix)&&this.matches(rest))return true;p=p.parent;}return false;
   }
   if(s.startsWith('#'))return this.id===s.slice(1);
   if(s==='.line')return this.attrs.class==='line';
   if(s==='label'||s==='button')return this.tagName===s.toUpperCase();
   const m=s.match(/^(button)?\[([^\]=*]+)(\*=|=)?(?:"([^"]*)")?\]$/);if(!m)return false;
   if(m[1]&&this.tagName!=='BUTTON')return false;
   const key=m[2].replace(/^data-/, '').replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
   const v=m[2].startsWith('data-')?this.dataset[key]:this.attrs[m[2]];
   return v!==undefined&&(!m[3]||(m[3]==='='?v===m[4]:v.includes(m[4])));
  }
  closest(selector){for(let e=this;e;e=e.parent)if(selector.split(',').some(s=>e.matches(s)))return e;return null;}
  querySelectorAll(selector){const out=[];for(const e of this.children){if(selector.split(',').some(s=>e.matches(s)))out.push(e);out.push(...e.querySelectorAll(selector));}return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  set innerHTML(value){this._html=value;this.children=[];for(const match of value.matchAll(/<div class="line">([\s\S]*?)<\/div>/g)){
   const row=this.appendChild(new Element('div',{class:'line'}));for(const b of match[1].matchAll(/<button onclick="([^"]*)">([^<]*)<\/button>/g)){const button=row.appendChild(new Element('button',{onclick:b[1]}));button.textContent=b[2];}
  }}get innerHTML(){return this._html||'';}
 }
 const body=new Element(),invoices=body.appendChild(new Element('section',{id:'invoices'}));
 for(const id of ['service','serviceDetail','serviceAmount','partName','partQty','partPrice','client','contact','address','email','make','yearModel','color','plate','invoiceDate','releaseDate','paymentDate','admin','method','source','paid','status','discountAmount']){
  const label=invoices.appendChild(new Element('label'));label.appendChild(new Element('input',{id}));
 }
 for(const id of ['serviceList','partList','subtotal','total','received','balance','invoiceDiscountSummary'])invoices.appendChild(new Element('div',{id}));
 const addService=invoices.appendChild(new Element('button',{onclick:'addService()'})),addPart=invoices.appendChild(new Element('button',{onclick:'addPart()'}));
 const editButton=invoices.appendChild(new Element('button',{onclick:'editInvoice(1)'}));
 const resetButton=invoices.appendChild(new Element('button',{onclick:'resetInvoice()'}));
 const snapshot={id:1,remoteId:'invoice-'+branch,number:'INV-TEST',branchId:branch,client:'Test client',contact:'Test contact',address:'Test address',make:'Test car',yearModel:'2026',color:'White',plate:'TEST',date:'2026-11-26',admin:'Test admin',method:'Cash',source:'Walk-in',paid:100,discount:50,total:1450,
  services:[{n:'Body repair',d:'Front panel',a:1000},{n:'Polishing',d:'Hood',a:300}],parts:[{n:'Clip',q:2,p:50,a:100},{n:'Bolt',q:1,p:100,a:100}]};
 const ctx={...nodes,document:{body,getElementById:id=>nodes[id]||null,querySelector:s=>body.querySelector(s),createElement:tag=>new Element(tag),addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn),dispatchEvent:e=>(listeners[e.type]||[]).forEach(fn=>fn(e))},
  services:[],parts:[],inv:[snapshot],edit:null,P:v=>'PHP '+Number(v).toFixed(2),scrollTo(){},setTimeout:fn=>timers.push(fn),MutationObserver:class{constructor(fn){observers.push(fn)}observe(){}},
  alert:msg=>alerts.push(msg),confirm:()=>true,localStorage:{getItem:key=>key==='bwc-active-branch'?branch:null,setItem:()=>calls.push('local write')},render(){},show(){}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(legacy,ctx);vm.runInContext(editor,ctx);
 vm.runInContext('(function(){'+discountMath+'window.updateSummary=update;window.total=function(){return Math.max(0,subtotal()-discount())}})();',ctx);
 const drain=()=>{while(timers.length)timers.shift()();for(const fn of observers)fn();};
 function click(button){if(button.disabled)return;const e={target:button,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};for(const fn of listeners.click||[]){fn(e);if(e.stopped)break;}if(!e.stopped&&button.getAttribute('onclick'))vm.runInContext(button.getAttribute('onclick'),ctx);drain();return e;}
 click(editButton);nodes.discountAmount.value=50;
 function rowButton(list,index,label){return nodes[list].children[index].children.find(b=>b.textContent===label);}
 return {ctx,nodes,calls,alerts,snapshot,click,drain,addService,addPart,editButton,resetButton,rowButton,branches};
}

for(const [name,branch] of branches){
 test(name+': removing saved service and part rows changes only the unsaved editor',()=>{
  const f=fixture(branch),before=JSON.stringify(f.snapshot);
  f.click(f.rowButton('serviceList',0,'Remove'));
  assert.equal(f.ctx.services.length,1,'Remove must not be swallowed by the Edit handler');
  assert.equal(f.ctx.services[0].n,'Polishing');
  f.click(f.rowButton('partList',1,'Remove'));assert.equal(f.ctx.parts.length,1);assert.equal(f.ctx.parts[0].n,'Clip');
  assert.equal(f.nodes.subtotal.textContent,'PHP 400.00');assert.equal(f.nodes.total.textContent,'PHP 350.00');assert.equal(f.nodes.balance.textContent,'PHP 250.00');
  assert.equal(JSON.stringify(f.snapshot),before);assert.deepEqual(f.calls,[]);assert.deepEqual(f.alerts,[]);
 });
 test(name+': removing a row cancels its pending line edit instead of resurrecting or overwriting another row',()=>{
  for(const [list,field,add] of [['serviceList','serviceAmount','addService'],['partList','partPrice','addPart']]){
   const f=fixture(branch);f.click(f.rowButton(list,1,'Edit'));f.nodes[field].value=555;
   f.click(f.rowButton(list,0,'Remove'));assert.equal(f[add].textContent,add==='addService'?'Add service':'Add auto part');
   f.click(f.rowButton(list,0,'Edit'));f.nodes[field].value=200;f.click(f[add]);
   const rows=list==='serviceList'?f.ctx.services:f.ctx.parts;assert.equal(rows.length,1);assert.equal(rows[0].a,200);
  }
 });
 test(name+': removed lines stay removed in the branch-scoped save payload; payments are preserved',async()=>{
  const f=fixture(branch),c=f.ctx;f.click(f.rowButton('serviceList',0,'Remove'));f.click(f.rowButton('partList',1,'Remove'));
  Object.assign(c,{invoiceSaving:false,navigator:{onLine:true},online:true,businessId:'test-business',paidFromHistory:r=>r.paid,invoiceEditPayload:x=>({client_name:x.client,discount_amount:x.discount}),
   confirmInvoiceBranchAccess:async()=>({}),message(){},loadRemote:async()=>{},setInvoiceFormMode(){},publishCrossTabRefresh(){},Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts.detail}},
   db:{rpc:async(name,payload)=>{f.calls.push({name,payload});return {data:{invoice_number:1}}}}});
  vm.runInContext(saveSource,c);await c.createInvoice();assert.deepEqual(f.alerts,[]);assert.equal(f.calls.length,1);
  const saved=f.calls[0];assert.equal(saved.name,'update_invoice_with_lines');assert.equal(saved.payload.p_branch_id,branch);assert.equal(saved.payload.p_invoice_id,'invoice-'+branch);
  assert.deepEqual(Array.from(saved.payload.p_services,s=>s.service_name),['Polishing']);assert.deepEqual(Array.from(saved.payload.p_parts,p=>p.part_name),['Clip']);
  assert.equal(f.snapshot.paid,100);assert.equal(f.snapshot.services.length,2);assert.equal(f.snapshot.parts.length,2);
 });
 test(name+': removing every line keeps the existing invoice intact and Save refuses an empty invoice',async()=>{
  const f=fixture(branch),before=JSON.stringify(f.snapshot);
  for(const list of ['serviceList','partList'])while(f.nodes[list].children.length)f.click(f.rowButton(list,0,'Remove'));
  assert.equal(f.nodes.total.textContent,'PHP 0.00');assert.equal(f.nodes.balance.textContent,'PHP 0.00');
  Object.assign(f.ctx,{invoiceSaving:false});vm.runInContext(saveSource,f.ctx);await f.ctx.createInvoice();
  assert.deepEqual(f.alerts,['Add at least one service or auto part.']);assert.equal(JSON.stringify(f.snapshot),before);assert.deepEqual(f.calls,[]);
 });
}

test('Edit buttons still edit only the selected row and clearing the form drops pending line edits',()=>{
 const f=fixture(branches[0][1]);f.click(f.rowButton('serviceList',0,'Edit'));f.nodes.serviceAmount.value=600;f.click(f.addService);
 assert.equal(f.ctx.services[0].a,600);assert.equal(f.ctx.services[1].a,300);assert.equal(f.snapshot.services[0].a,1000);
 f.click(f.rowButton('serviceList',1,'Edit'));f.click(f.resetButton);assert.equal(f.ctx.services.length,0);assert.equal(f.addService.textContent,'Add service');
});

test('reopening an invoice cannot reuse the previous invoice line-edit index',()=>{
 const f=fixture(branches[0][1]);f.click(f.rowButton('serviceList',1,'Edit'));f.click(f.editButton);
 assert.equal(f.addService.textContent,'Add service');
});
