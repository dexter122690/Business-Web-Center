/* Same-origin BWC session; private payroll never falls back to browser storage. */
(function(){
  'use strict';
  const pending=new Map(),cache=new Map(),committedPdfs=new Set();
  let client,b,r,user,revision=0,access='none',branchName='',busy=false;
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
  async function rpc(name,args={}){await context();const result=await client.rpc(name,{b,r,...args});if(result.error)throw Error(result.error.message||'Payroll request failed.');return result.data}
  function accept(result){revision=Number(result.revision);access=result.access;branchName=result.branchName;committedPdfs.clear();for(const s of result.state.releasedPainterSlips||[])committedPdfs.add(s.id);for(const s of result.state.slipReleases||[])committedPdfs.add(s.slipId);return result.state}
  const ready=(async()=>{await context();return accept(await rpc('payroll_v2_load'))})();
  // A save is atomic: both state and newly generated PDF/photo files succeed or fail.
  async function save(state){
    if(busy)throw Error('A save is still running. Please wait.');if(!['owner','edit'].includes(access))throw Error('Your payroll access is view-only.');
    busy=true;document.body.classList.add('online-saving');
    try{
      const next=JSON.parse(JSON.stringify(state));
      for(const slip of next.releasedPainterSlips||[])if(!committedPdfs.has(slip.id)&&!pending.has(slip.id)){
        const existing=await getFiles([slip.id]);if(!existing[0])pending.set(slip.id,{id:slip.id,kind:'pdf',dataUrl:await PayrollPDF.dataUrl(slip)});
      }
      for(const confirmation of next.slipReleases||[]){const slip=next.payslips.find(s=>s.id===confirmation.slipId);if(slip&&!committedPdfs.has(slip.id)&&!pending.has(slip.id)){
        const existing=await getFiles([slip.id]);if(!existing[0])pending.set(slip.id,{id:slip.id,kind:'pdf',dataUrl:await PayrollPDF.dataUrl({...slip,releaseConfirmation:confirmation})});
      }}
      const photos=new Set(next.employees.flatMap(e=>(e.photos||[]).map(p=>p.id))),pdfs=new Set([...next.releasedPainterSlips.map(s=>s.id),...next.payslips.map(s=>s.id)]);
      const files=[...pending.values()].filter(f=>f.kind==='photo'?photos.has(f.id):pdfs.has(f.id));
      const result=await rpc('payroll_v2_save',{expected_revision:revision,payload:next,files});
      files.forEach(f=>{cache.set(f.id,f);pending.delete(f.id)});return accept(result);
    }finally{busy=false;document.body.classList.remove('online-saving')}
  }
  async function getFiles(ids){const missing=ids.filter(id=>!pending.has(id)&&!cache.has(id));if(missing.length){const files=await rpc('payroll_v2_get_files',{ids:missing});files.forEach(f=>cache.set(f.id,f))}return ids.map(id=>pending.get(id)||cache.get(id))}
  function stagePhotos(records){if(access!=='owner')throw Error('Only the owner can upload employee documents.');for(const record of records)pending.set(record.id,{...record,kind:'photo'});return records.map(r=>r.id)}
  function discardFiles(ids){ids.forEach(id=>pending.delete(id))} // Never deletes committed files.
  function permissions(){
    document.body.dataset.access=access;
    const ownerActions=['directory-open','employee-new','employee-edit','employee-remove','employee-restore','rules'];
    document.querySelectorAll('[data-action]').forEach(el=>{if(ownerActions.includes(el.dataset.action)&&access!=='owner')el.hidden=true});
    document.querySelectorAll('#exportBackup').forEach(el=>el.hidden=access!=='owner');
    if(access==='view'){
      document.querySelectorAll('#app input,#app textarea,#app select,#editorForm input,#editorForm select,#editorForm textarea').forEach(el=>{if(!['painterWeek'].includes(el.id)&&!el.closest('#periodForm'))el.disabled=true});
      document.querySelectorAll('[data-attendance],[data-overtime-toggle],button[form="painterWorksheet"],[data-action$="-new"],[data-action$="-edit"],[data-action="simple-release"],[data-action="simple-empty"],[data-action="slip-save"],[data-action="confirm-slip"],[data-action="remove"]').forEach(el=>el.disabled=true);
    }
    document.getElementById('payrollBranchLabel').textContent=branchName+' · '+(access==='owner'?'Owner':access==='edit'?'Payroll editor':'View only');
  }
  async function accessDialog(){
    const people=await rpc('payroll_v2_team'),dialog=document.createElement('dialog');dialog.className='editor-dialog payroll-access-dialog';
    dialog.innerHTML='<h2>Payroll access · '+esc(branchName)+'</h2><p>Only you can manage employee profiles and documents. Approved editors can enter payroll and release payslips. Other BWC permissions are unchanged.</p><p class="payroll-access-hint">Names follow Settings → Team access for this branch. Check the sign-in email before changing access.</p>'+people.map(p=>'<label class="field payroll-access-member"><span class="payroll-access-name">'+esc(p.name||p.email)+'</span><small class="payroll-access-email">'+esc(p.email||'')+'</small><select data-member="'+esc(p.id)+'">'+['none','view','edit'].map(level=>'<option value="'+level+'" '+(p.level===level?'selected':'')+'>'+({none:'No access',view:'View payroll',edit:'Enter and release payroll'}[level])+'</option>').join('')+'</select></label>').join('')+'<p class="form-error" role="status"></p><button type="button">Close</button>';
    dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();dialog.onchange=async event=>{const select=event.target.closest('[data-member]');if(!select)return;select.disabled=true;try{await rpc('payroll_v2_grant',{member:select.dataset.member,level:select.value});dialog.querySelector('[role=status]').textContent='Access saved.'}catch(e){dialog.querySelector('[role=status]').textContent=e.message}finally{select.disabled=false}};document.body.append(dialog);dialog.showModal();
  }
  async function fileFor(record){const existing=(await getFiles([record.id]))[0];return existing?.dataUrl||PayrollPDF.dataUrl(record)}
  async function output(record,intent){
    const win=intent==='print'?window.open('','_blank'):null;
    if(intent==='print'&&!win)throw Error('Allow the payslip window to open, then click Print again.');
    if(win){win.opener=null;win.document.body.textContent='Preparing the original payslip PDF…'}
    try{await context();const data=await fileFor(record);if(intent==='pdf'){const a=document.createElement('a');a.href=data;a.download='15M-payslip-'+(record.snapshot.employee.name+'-'+record.snapshot.period.start).replace(/[^a-z0-9-]/gi,'-')+'.pdf';a.click()}else{const blob=await (await fetch(data)).blob(),url=URL.createObjectURL(blob);win.location.href=url;setTimeout(()=>URL.revokeObjectURL(url),60000)}}catch(error){if(win)win.close();throw error}
  }
  window.PayrollOnline={ready,save,getFiles,stagePhotos,discardFiles,permissions,accessDialog,output,rpc,accept,get access(){return access},get branchName(){return branchName},get busy(){return busy}};
})();
