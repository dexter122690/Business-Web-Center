/* Same-origin BWC session; private payroll never falls back to browser storage. */
(function(){
  'use strict';
  const pending=new Map(),cache=new Map(),committedPdfs=new Set();
  let client,b,r,user,revision=0,access='none',canManageEmployees=false,branchName='',busy=false;
  let workflowVersion=1,documentMode='pdf',savedState=null;
  const paydayId=()=>crypto.randomUUID();
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function context(){
    if(parent===window||parent.location.origin!==location.origin||!parent.getBusinessSupabaseClient)throw Error('Open Payroll inside BWC after signing in.');
    client=parent.getBusinessSupabaseClient();
    const session=await client.auth.getSession();if(session.error)throw session.error;
    const nextUser=session.data.session?.user?.id,nextB=parent.localStorage.getItem('bwc-active-business'),nextR=parent.localStorage.getItem('bwc-active-branch');
    if(!nextUser||!nextB||!nextR)throw Error('Sign in and select a BWC branch first.');
    if(b&&(b!==nextB||r!==nextR||user!==nextUser))throw Error('Your account or branch changed. Reopen Payroll before continuing.');
    b=nextB;r=nextR;user=nextUser;
  }
  async function rpc(name,args={}){await context();const result=await client.rpc(name,{b,r,...args});if(result.error){const error=Error(result.error.message||'Payroll request failed.');error.status=result.status;error.code=result.error.code;throw error}return result.data}
  // JSONB changes object key order, not values or array order. Only an exact
  // committed snapshot at the next revision can resolve an uncertain save.
  function sameState(a,b){
    if(a===b)return true;
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&sameState(a[k],b[k]));
  }
  const uncertain=error=>error.status===0||error.status===408||error.status>=500||/timeout|timed out|failed to fetch|network(?:error| error)|load failed/i.test(error.message);
  function accept(result){revision=Number(result.revision);access=result.access;workflowVersion=result.payrollWorkflowVersion||1;documentMode=result.payrollDocumentMode==='record'?'record':'pdf';savedState=JSON.parse(JSON.stringify(result.state));canManageEmployees=access==='owner'||(access==='edit'&&result.canManageEmployees===true);branchName=result.branchName;if(!canManageEmployees){for(const [id,file] of cache)if(file.kind==='photo')cache.delete(id);for(const [id,file] of pending)if(file.kind==='photo')pending.delete(id)}if(documentMode==='record')for(const [id,file] of pending)if(file.kind==='pdf')pending.delete(id);committedPdfs.clear();for(const s of [...result.state.releasedPainterSlips||[],...result.state.retainedPaydayCopies||[]])committedPdfs.add(s.id);for(const s of result.state.slipReleases||[])committedPdfs.add(s.slipId);return result.state}
  const ready=(async()=>{await context();const reviewed=await rpc('payroll_v2_apply_reviewed_history');const state=accept(await rpc('payroll_v2_load'));if(reviewed.status==='stale'||reviewed.status==='applied'){const notice=document.createElement('p');notice.className='rule-note';notice.textContent=reviewed.status==='applied'?'Reviewed historical payroll imported. These payments were already received; no money was transferred.':reviewed.message;document.getElementById('payrollBranchLabel').after(notice)}return state})();
  // A save remains atomic: receipts and immutable payday snapshots save together.
  // Migration 100 advertises record mode; older servers retain the PDF fallback.
  async function save(state,onProgress=()=>{}){
    if(busy)throw Error('A save is still running. Please wait.');if(!['owner','edit'].includes(access))throw Error('Your payroll access is view-only.');
    busy=true;document.body.classList.add('online-saving');
    try{
      let next=JSON.parse(JSON.stringify(state));
      if(workflowVersion===2)next=PayrollRetainedPayday.prepareSave(next,savedState,paydayId);
      if(documentMode!=='record'){
      const required=new Map([...next.releasedPainterSlips||[],...next.retainedPaydayCopies||[]].map(s=>[s.id,s]));
      for(const confirmation of next.slipReleases||[]){const slip=next.payslips.find(s=>s.id===confirmation.slipId);if(slip)required.set(slip.id,{...slip,releaseConfirmation:confirmation})}
      const candidates=[...required.values()].filter(s=>!committedPdfs.has(s.id)&&!pending.has(s.id));
      // One lookup for all new versions, never one network round trip per PDF.
      if(candidates.length){onProgress('Checking saved payslip files…');await getFiles(candidates.map(s=>s.id))}
      const generate=candidates.filter(s=>!cache.has(s.id));
      for(let i=0;i<generate.length;i++){
        const slip=generate[i];onProgress('Preparing payslip PDF '+(i+1)+' of '+generate.length+'…');
        pending.set(slip.id,{id:slip.id,kind:'pdf',dataUrl:await PayrollPDF.dataUrl(slip)});
      }
      }
      const photos=new Set(next.employees.flatMap(e=>(e.photos||[]).map(p=>p.id))),pdfs=new Set([...next.releasedPainterSlips.map(s=>s.id),...next.payslips.map(s=>s.id),...(next.retainedPaydayCopies||[]).map(s=>s.id)]);
      const files=[...pending.values()].filter(f=>f.kind==='photo'?photos.has(f.id):documentMode!=='record'&&pdfs.has(f.id));
      const expectedRevision=revision;let result;
      onProgress(documentMode==='record'?'Saving payroll records—no PDF processing…':'Saving payroll and payslip records together…');
      try{result=await rpc('payroll_v2_save',{expected_revision:expectedRevision,payload:next,files})}
      catch(error){
        if(!uncertain(error))throw error;
        onProgress('The server is slow. Checking whether the save completed—please wait…');
        // Read only: never repeat a write after a timeout. Do not accept another
        // user's revision or replace unsaved inputs when the outcome is unknown.
        try{const loaded=await rpc('payroll_v2_load');if(Number(loaded.revision)===expectedRevision+1&&sameState(loaded.state,next))result=loaded}catch(ignore){}
        if(!result)throw Error('The server response was delayed, so this save could not be confirmed. Your inputs are still here. Check Past Payslips in a separate Payroll tab before trying again; do not record the payment twice.');
      }
      files.forEach(f=>{cache.set(f.id,f);pending.delete(f.id)});return accept(result);
    }finally{busy=false;document.body.classList.remove('online-saving')}
  }
  async function getFiles(ids){const missing=ids.filter(id=>!pending.has(id)&&!cache.has(id));if(missing.length){const files=await rpc('payroll_v2_get_files',{ids:missing});files.forEach(f=>cache.set(f.id,f))}return ids.map(id=>pending.get(id)||cache.get(id))}
  async function receiveRetention(employeeId,jobId,date,amount,unitReleasedOn,expectedPeriod,onProgress){
    if(workflowVersion===2){await context();return save(PayrollRetainedPayday.receive(savedState,{employeeId,jobId,date,expectedAmount:amount,expectedReleaseDate:unitReleasedOn,expectedPeriod,acknowledge:true,recordedBy:user},paydayId),onProgress);}
    if(busy)throw Error('A save is still running. Please wait.');if(!['owner','edit'].includes(access))throw Error('Your payroll access is view-only.');
    busy=true;document.body.classList.add('online-saving');
    try{return accept(await rpc('payroll_v2_receive_retention',{expected_revision:revision,employee_id:employeeId,job_id:jobId,received_on:date,expected_amount:amount,expected_release_date:unitReleasedOn}))}
    finally{busy=false;document.body.classList.remove('online-saving')}
  }
  function stagePhotos(records){if(!canManageEmployees)throw Error('Employee management access is required to upload documents.');for(const record of records)pending.set(record.id,{...record,kind:'photo'});return records.map(r=>r.id)}
  function discardFiles(ids){ids.forEach(id=>pending.delete(id))} // Never deletes committed files.
  function permissions(){
    document.body.dataset.access=access;
    const employeeActions=['directory-open','employee-new','employee-edit','employee-remove','employee-restore'];
    document.querySelectorAll('[data-action]').forEach(el=>{if(employeeActions.includes(el.dataset.action))el.hidden=!canManageEmployees;if(el.dataset.action==='rules')el.hidden=access!=='owner'});
    document.querySelectorAll('#exportBackup').forEach(el=>el.hidden=access!=='owner');
    if(access==='view'){
      document.querySelectorAll('#app input,#app textarea,#app select,#editorForm input,#editorForm select,#editorForm textarea').forEach(el=>{if(!['painterWeek','cashSummaryWeek','cashIncludeDue'].includes(el.id)&&!el.closest('#periodForm'))el.disabled=true});
      document.querySelectorAll('[data-attendance],[data-overtime-toggle],button[form="painterWorksheet"],[data-job-add],[data-job-remove],[data-action$="-new"],[data-action$="-edit"],[data-action="simple-release"],[data-action="simple-empty"],[data-action="slip-save"],[data-action="confirm-slip"],[data-action="remove"]').forEach(el=>el.disabled=true);
    }
    document.getElementById('payrollBranchLabel').textContent=branchName+' · '+(access==='owner'?'Owner':access==='edit'?'Payroll editor'+(canManageEmployees?' · Employee management':''):'View only');
  }
  async function accessDialog(){
    const people=await rpc('payroll_v2_team'),dialog=document.createElement('dialog');dialog.className='editor-dialog payroll-access-dialog';
    dialog.innerHTML='<h2>Payroll access · '+esc(branchName)+'</h2><p>Editors can enter payroll and release payslips. Employee management is a separate permission for profiles, payout-account details and supporting documents. Payroll rules, access settings and released-payslip corrections remain owner-only.</p><p class="payroll-access-hint">Names follow Settings → Team access for this branch. Check the sign-in email before changing access. Other BWC permissions are unchanged.</p>'+people.map(p=>'<div class="field payroll-access-member"><span class="payroll-access-name">'+esc(p.name||p.email)+'</span><small class="payroll-access-email">'+esc(p.email||'')+'</small><select aria-label="Payroll access for '+esc(p.email||p.name)+'" data-member="'+esc(p.id)+'">'+['none','view','edit'].map(level=>'<option value="'+level+'" '+(p.level===level?'selected':'')+'>'+({none:'No access',view:'View payroll',edit:'Enter and release payroll'}[level])+'</option>').join('')+'</select><label class="employee-management-option"><input type="checkbox" data-employee-manager="'+esc(p.id)+'" '+(p.manageEmployees?'checked ':'')+(p.level!=='edit'?'disabled':'')+'> Add &amp; manage employees</label></div>').join('')+'<p class="form-error" role="status"></p><button type="button">Close</button>';
    dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
    dialog.onchange=async event=>{
      const control=event.target.closest('[data-member],[data-employee-manager]');if(!control)return;
      const isEmployee=Boolean(control.dataset.employeeManager),member=control.dataset.employeeManager||control.dataset.member,p=people.find(p=>p.id===member);if(!p)return;
      if(isEmployee&&control.checked&&!confirm('Allow '+(p.name||p.email)+' ('+p.email+') to add and manage employees in '+branchName+'? This includes personal details, payout-account details and uploaded IDs/clearances.')){control.checked=Boolean(p.manageEmployees);return}
      const controls=dialog.querySelectorAll('[data-member],[data-employee-manager]');controls.forEach(el=>el.disabled=true);
      try{
        if(isEmployee){await rpc('payroll_v2_grant_employee_management',{member,allowed:control.checked});p.manageEmployees=control.checked}
        else{await rpc('payroll_v2_grant',{member,level:control.value});p.level=control.value;if(p.level!=='edit')p.manageEmployees=false}
        dialog.querySelector('[role=status]').textContent='Access saved. Reopen Payroll to load the updated permissions.';
      }catch(e){if(isEmployee)control.checked=Boolean(p.manageEmployees);else control.value=p.level;dialog.querySelector('[role=status]').textContent=e.message}
      finally{controls.forEach(el=>{const person=people.find(p=>p.id===(el.dataset.employeeManager||el.dataset.member));el.disabled=Boolean(el.dataset.employeeManager)&&person.level!=='edit';if(el.dataset.employeeManager)el.checked=Boolean(person.manageEmployees)})}
    };document.body.append(dialog);dialog.showModal();
  }
  async function fileFor(record){const existing=(await getFiles([record.id]))[0];return existing?.dataUrl||PayrollPDF.dataUrl(record)}
  async function output(record,intent){
    const win=intent==='print'?window.open('','_blank'):null;
    if(intent==='print'&&!win)throw Error('Allow the payslip window to open, then click Print again.');
    if(win){win.opener=null;win.document.body.textContent='Preparing the printable payslip…'}
    try{
      await context();
      if(intent==='print'){window.PayrollPrint.write(win,record);return;}
      // Explicit, optional download only. Existing archived PDFs are reused.
      const data=await fileFor(record),a=document.createElement('a');a.href=data;a.download='15M-payslip-'+(record.snapshot.employee.name+'-'+record.snapshot.period.start).replace(/[^a-z0-9-]/gi,'-')+'.pdf';a.click();
    }catch(error){if(win)win.close();throw error}
  }
  window.PayrollOnline={ready,save,receiveRetention,getFiles,stagePhotos,discardFiles,permissions,accessDialog,output,rpc,accept,get retainedPaydayPreview(){return workflowVersion===2},get agreedJobPricingPreview(){return workflowVersion===2},get initialPayrollWeek(){const starts=Object.values(savedState?.payrollFreshStarts||{});return starts.length?starts.sort()[0]:undefined},get access(){return access},get canManageEmployees(){return canManageEmployees},get branchName(){return branchName},get busy(){return busy}};
})();
