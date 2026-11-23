const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const source=read('global-search.js');
const hide='function hideRedundantInvoiceSearch() {'+source.split('function hideRedundantInvoiceSearch() {')[1].split('function setupRemoteRefresh()')[0];
function element(){return {hidden:false,attributes:{},css:{},style:{setProperty(key,value,priority){this.owner.css[key]=[value,priority]}},setAttribute(key,value){this.attributes[key]=value}}}
function node(){const value=element();value.style.owner=value;return value}
test('legacy invoice search and its helper stay hidden despite author display rules',()=>{
 const label=node(),helper=node(),field=node(),header=node(),client=node();
 helper.textContent='Search results update as you type.';label.nextElementSibling=helper;field.closest=()=>label;
 const seen=[];vm.runInNewContext(hide+'hideRedundantInvoiceSearch();',{document:{getElementById(id){seen.push(id);return field}}});
 assert.deepEqual(seen,['search']);assert.equal(label.hidden,true);assert.deepEqual(label.css.display,['none','important']);assert.equal(label.attributes['aria-hidden'],'true');
 assert.equal(helper.hidden,true);assert.deepEqual(helper.css.display,['none','important']);assert.equal(header.hidden,false);assert.equal(client.hidden,false);
 assert.equal(field.hidden,false); // Keep the input available to the existing register filter.
});
test('missing label or input is handled without removing the legacy filter',()=>{
 const field=node();field.closest=()=>null;vm.runInNewContext(hide+'hideRedundantInvoiceSearch();',{document:{getElementById:()=>field}});assert.equal(field.hidden,true);assert.deepEqual(field.css.display,['none','important']);
 assert.doesNotThrow(()=>vm.runInNewContext(hide+'hideRedundantInvoiceSearch();',{document:{getElementById:()=>null}}));
});
test('late styling no longer decorates or moves invoice search; global search remains installed and versioned',()=>{
 const html=read('index.html'),enhancer=html.slice(html.indexOf('  var specs=['));
 assert.doesNotMatch(enhancer,/id:'search'|invoiceRoot\.insertBefore\(invoiceLabel/);
 assert.match(enhancer,/id:'masterSearch'/);assert.match(enhancer,/id:'cmSearch'/);
 assert.match(source,/id="bwcGlobalSearch"/);assert.match(source,/placeholder="Search BWC\.\.\."/);
 assert.ok(html.includes('global-search.js?v=20261123-single-search'));assert.ok(read('sw.js').includes('global-search.js?v=20261123-single-search'));
 new vm.Script(source);new vm.Script(read('sw.js'));
});
