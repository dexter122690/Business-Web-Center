const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
test('access dialog shows escaped name and email, refreshes on reopen, and never grants on open',async()=>{
 const calls=[],dialogs=[];
 let people=[{id:'member-123',name:'Fictional Team Name',email:'test@example.invalid',level:'none'}];
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'owner-123'}}}})},rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='payroll_v2_apply_reviewed_history')return {data:{status:'none'}};if(name==='payroll_v2_load')return {data:{revision:1,access:'owner',branchName:'TEST BRANCH',state:{}}};
  assert.equal(name,'payroll_v2_team');return {data:people};
 }};
 const window={},parent={location:{origin:'https://example.invalid'},getBusinessSupabaseClient:()=>client,localStorage:{getItem:key=>key==='bwc-active-business'?'business-123':'branch-123'}};
 const document={createElement:tag=>{assert.equal(tag,'dialog');const close={};return {innerHTML:'',querySelector:()=>close,showModal(){this.open=true},close(){this.open=false;this.onclose()},remove(){this.removed=true}}},body:{append:dialog=>dialogs.push(dialog)}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'payroll-v2/online.js'),'utf8'),{window,parent,document,location:parent.location});
 await window.PayrollOnline.ready;await window.PayrollOnline.accessDialog();
 assert.match(dialogs[0].innerHTML,/<span class="payroll-access-name">Fictional Team Name<\/span><small class="payroll-access-email">test@example.invalid<\/small>/);
 assert.match(dialogs[0].innerHTML,/data-member="member-123"/);assert.match(dialogs[0].innerHTML,/value="none" selected/);
 dialogs[0].close();assert.equal(dialogs[0].removed,true);
 people=[{...people[0],name:'Renamed <script>alert("test")</script>',email:'a&b@example.invalid'}];
 await window.PayrollOnline.accessDialog();
 assert.match(dialogs[1].innerHTML,/Renamed &lt;script&gt;alert\(&quot;test&quot;\)&lt;\/script&gt;/);
 assert.match(dialogs[1].innerHTML,/a&amp;b@example.invalid/);assert.doesNotMatch(dialogs[1].innerHTML,/<script>|Fictional Team Name/);
 assert.deepEqual(calls.map(c=>c.name),['payroll_v2_apply_reviewed_history','payroll_v2_load','payroll_v2_team','payroll_v2_team']);
 for(const call of calls)assert.deepEqual({...call.args},{b:'business-123',r:'branch-123'});
 const index=fs.readFileSync(path.join(root,'payroll-v2/index.html'),'utf8');
 assert.ok(index.includes('online.js?v=20261125-retention-payday'));assert.ok(index.includes('online.css?v=20261123-employee-management'));
});
