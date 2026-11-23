const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'payroll-v2/online.js'),'utf8');
async function setup(access,granted){
 const actions=['directory-open','employee-new','employee-edit','employee-remove','employee-restore','rules'].map(action=>({dataset:{action},hidden:false})),backup={hidden:false},label={textContent:''},calls=[];
 const result={revision:1,access,canManageEmployees:granted,branchName:'TEST BRANCH',state:{employees:[],releasedPainterSlips:[],slipReleases:[]}};
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'test-user'}}}})},rpc:async(name,args)=>{calls.push({name,args});return {data:name==='payroll_v2_get_files'?[]:result}}};
 const window={},parent={location:{origin:'https://example.invalid'},getBusinessSupabaseClient:()=>client,localStorage:{getItem:k=>k==='bwc-active-business'?'test-business':'test-branch'}};
 const document={body:{dataset:{}},getElementById:()=>label,querySelectorAll:s=>s==='[data-action]'?actions:s==='#exportBackup'?[backup]:[]};
 vm.runInNewContext(source,{window,parent,document,location:parent.location});await window.PayrollOnline.ready;
 return {api:window.PayrollOnline,result,actions,backup,label,calls};
}
test('only an explicit employee-management capability enables profile actions; owner tools stay hidden',async()=>{
 for(const [role,flag,allowed] of [['edit',false,false],['edit',true,true],['view',true,false],['none',true,false],['owner',false,true]]){
  const x=await setup(role,flag);x.api.permissions();assert.equal(x.api.canManageEmployees,allowed);
  for(const a of x.actions)assert.equal(a.hidden,a.dataset.action==='rules'?role!=='owner':!allowed);
  assert.equal(x.backup.hidden,role!=='owner');
  const photo={id:'test-photo',dataUrl:'data:image/png;base64,iVBORw0KGgo='};
  if(allowed){assert.equal(x.api.stagePhotos([photo])[0],photo.id);assert.equal((await x.api.getFiles([photo.id]))[0].kind,'photo')}
  else assert.throws(()=>x.api.stagePhotos([photo]),/management access/);
 }
});
test('updated permission results clear staged private photos and hide management controls on revocation',async()=>{
 const x=await setup('edit',true);x.api.stagePhotos([{id:'private-photo',dataUrl:'data:image/png;base64,iVBORw0KGgo='}]);
 x.api.accept({...x.result,revision:2,canManageEmployees:false});x.api.permissions();
 assert.equal((await x.api.getFiles(['private-photo']))[0],undefined);assert.equal(x.actions[0].hidden,true);
 assert.equal(x.calls.at(-1).name,'payroll_v2_get_files');
});
test('employee editor checks are separate from owner-only rules, grants, backups and corrections',()=>{
 const app=fs.readFileSync(path.join(root,'payroll-v2/app-v2.js'),'utf8');new vm.Script(app);new vm.Script(source);
 assert.match(app,/\['employee','employee-remove'\]\.includes\(kind\)&&!O\.canManageEmployees/);
 assert.match(app,/kind==='rules'&&O\.access!=='owner'/);assert.match(app,/payrollAccess'\)\.hidden=O\.access!=='owner'/);
 assert.match(app,/if\(O\.access!=='owner'\)throw Error\('Only the owner can export/);
 assert.match(app,/if\(!record\|\|O\.access!=='owner'\)return/);
 assert.match(source,/confirm\('Allow '/);assert.match(source,/data-employee-manager/);
 assert.match(source,/rpc\('payroll_v2_grant_employee_management'/);
});
