/* Private employee supporting photos: owner-only online storage. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EmployeePhotos=api})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const MAX_FILES=10,MAX_BYTES=10*1024*1024,MAX_BACKUP_BYTES=256*1024*1024;
  const TYPES=['image/jpeg','image/png','image/webp'],DB_NAME='payweek-employee-photos-v1';
  const copy=v=>JSON.parse(JSON.stringify(v));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function validRefs(refs){
    if(refs===undefined)return true;
    if(!Array.isArray(refs)||refs.length>MAX_FILES)return false;
    const ids=new Set();
    for(const p of refs){
      if(!p||typeof p.id!=='string'||!/^photo-[a-zA-Z0-9-]{8,100}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>255||!TYPES.includes(p.type)||!Number.isSafeInteger(p.size)||p.size<=0||p.size>MAX_BYTES||typeof p.addedAt!=='string'||!Number.isFinite(Date.parse(p.addedAt))||(p.label!==undefined&&(typeof p.label!=='string'||p.label.length>120)))return false;
      ids.add(p.id);
    }
    return true;
  }
  function allRefs(state){const out=[];for(const employee of state.employees||[]){if(!validRefs(employee.photos))throw Error('Invalid employee supporting-photo details.');out.push(...(employee.photos||[]))}const ids=new Set();for(const p of out){if(ids.has(p.id))throw Error('A supporting photo must belong to only one employee.');ids.add(p.id)}return out}
  function detectedType(bytes){
    if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'image/png';
    if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
    if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
    return '';
  }
  function validateFile(file){if(!TYPES.includes(file.type))throw Error('Choose JPG, PNG or WebP photos. Convert HEIC/PDF documents to a photo first.');if(!file.size||file.size>MAX_BYTES)throw Error('Each photo must be 10 MB or smaller.');if(!file.name?.trim()||file.name.length>255)throw Error('Use a photo filename of 255 characters or fewer.')}
  function validateRecord(ref,record){
    if(!validRefs([ref])||!record||record.id!==ref.id||typeof record.dataUrl!=='string')throw Error('Invalid supporting photo.');
    const prefix='data:'+ref.type+';base64,';
    if(!record.dataUrl.startsWith(prefix))throw Error('Photo format does not match its saved details.');
    const raw=record.dataUrl.slice(prefix.length);
    if(raw.length>Math.ceil(MAX_BYTES/3)*4||!raw.length||raw.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))throw Error('Invalid photo data.');
    const size=raw.length/4*3-(raw.endsWith('==')?2:raw.endsWith('=')?1:0);
    if(size!==ref.size)throw Error('Photo size does not match its saved details.');
    const prefixBytes=Uint8Array.from(atob(raw.slice(0,Math.min(24,raw.length))),c=>c.charCodeAt(0));
    if(detectedType(prefixBytes)!==ref.type)throw Error('This file is not a supported photo.');
    return record;
  }
  async function getMany(ids){return window.PayrollOnline.getFiles(ids)}
  async function putMany(records){return window.PayrollOnline.stagePhotos(records)}
  async function deleteMany(ids){window.PayrollOnline.discardFiles(ids)}
  async function discardUnreferenced(ids,state){const used=new Set(allRefs(state).map(p=>p.id));await deleteMany(ids.filter(id=>!used.has(id)))}
  async function readFile(file){validateFile(file);return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('Could not read '+file.name+'. Please select the photo again.'));reader.readAsDataURL(file)})}
  async function imageReadable(dataUrl){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>80000000)reject(Error('This photo is too large to preview. Choose a smaller image.'));else resolve()};image.onerror=()=>reject(Error('The selected photo could not be opened. Choose another JPG, PNG or WebP image.'));image.src=dataUrl})}
  async function prepareFiles(files,existing=[]){
    if(existing.length+files.length>MAX_FILES)throw Error('Keep up to 10 photos per employee. Remove one before adding another.');
    files.forEach(validateFile);
    const out=[];for(const file of files){const ref={id:'photo-'+crypto.randomUUID(),name:file.name,type:file.type,size:file.size,label:'',addedAt:new Date().toISOString()},record={id:ref.id,dataUrl:await readFile(file)};validateRecord(ref,record);await imageReadable(record.dataUrl);out.push({ref,record})}return out;
  }
  async function ensureRecords(state,provided=[]){
    if(!Array.isArray(provided))throw Error('Invalid photo backup.');
    const refs=allRefs(state),byId=new Map();
    for(const record of provided){if(!record?.id||byId.has(record.id))throw Error('Duplicate or invalid photo backup.');byId.set(record.id,record)}
    const saved=await getMany(refs.filter(p=>!byId.has(p.id)).map(p=>p.id));
    for(const record of saved)if(record)byId.set(record.id,record);
    return refs.map(ref=>{const record=byId.get(ref.id);if(!record)throw Error('Photo missing: '+ref.name+'. Restore a full backup containing the photo before continuing.');return validateRecord(ref,record)});
  }
  async function packBackup(state){const out=copy(state),refs=allRefs(state);if(refs.length)out.employeePhotoFiles=await ensureRecords(state);else delete out.employeePhotoFiles;return out}
  function splitBackup(bundle){const state={...bundle},records=state.employeePhotoFiles||[];delete state.employeePhotoFiles;if(!Array.isArray(records))throw Error('Invalid supporting-photo backup.');const refs=allRefs(state),known=new Map(refs.map(p=>[p.id,p])),seen=new Set();for(const record of records){if(!known.has(record?.id)||seen.has(record.id))throw Error('Photo backup has an unknown or duplicate image.');validateRecord(known.get(record.id),record);seen.add(record.id)}return {state,records}}
  function sectionHtml(){return `<section class="employee-photo-section span2" aria-label="Photos and supporting documents"><h3 class="employee-form-section">Photos / supporting documents <small>Optional</small></h3><p>ID, police clearance, NBI, barangay clearance, or any other supporting photo. No separate folder.</p><label class="photo-upload-label">Add photos<input id="employeePhotoFiles" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple></label><small>JPG, PNG or WebP · up to 10 photos · 10 MB each. Originals are kept; photos are not printed on payslips.</small><div id="employeePhotoStatus" role="status" aria-live="polite"></div><div id="employeePhotoGrid" class="employee-photo-grid"></div><p class="photo-privacy">Private documents are saved online and visible only to the owner. Owner backups include them. Click Save record to keep uploads or removals; Cancel discards photo changes.</p></section>`}
  function showPhoto(ref,dataUrl){const dialog=document.createElement('dialog');dialog.className='employee-photo-viewer';dialog.setAttribute('aria-label','Supporting photo preview');dialog.innerHTML=`<div class="photo-viewer-head"><strong>${esc(ref.label||ref.name)}</strong><button type="button" class="button secondary">Close photo</button></div><img alt="${esc(ref.label||ref.name)}"><p>Employee supporting document · not part of the payslip.</p>`;dialog.querySelector('img').src=dataUrl;dialog.querySelector('button').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal()}
  function mount(container,original=[],onBusy=()=>{}){
    let refs=copy(original),disposed=false,busy=false;const records=new Map(),pending=new Map(),grid=container.querySelector('#employeePhotoGrid'),status=container.querySelector('#employeePhotoStatus'),picker=container.querySelector('#employeePhotoFiles');
    const markBusy=value=>{busy=value;if(!disposed){picker.disabled=value;onBusy(value)}};
    function render(){if(disposed)return;grid.innerHTML=refs.map(ref=>`<article class="employee-photo-card"><button type="button" data-photo-open="${esc(ref.id)}" class="photo-thumbnail" aria-label="View ${esc(ref.label||ref.name)}" ${records.has(ref.id)?'':'disabled'}>${records.has(ref.id)?`<img src="${esc(records.get(ref.id).dataUrl)}" alt="${esc(ref.label||ref.name)}">`:'<span>Photo unavailable</span>'}</button><span class="photo-filename" title="${esc(ref.name)}">${esc(ref.name)}</span><label>Label (optional)<input type="text" data-photo-label="${esc(ref.id)}" value="${esc(ref.label||'')}" maxlength="120" placeholder="e.g. NBI clearance"></label><button type="button" class="button secondary small" data-photo-remove="${esc(ref.id)}">Remove photo</button></article>`).join('')||'<p class="photo-empty">No photos added yet.</p>'}
    picker.onchange=async()=>{const files=Array.from(picker.files||[]);if(!files.length||busy)return;markBusy(true);status.textContent='Preparing photos…';try{const items=await prepareFiles(files,refs);if(disposed)return;for(const item of items){refs.push(item.ref);records.set(item.ref.id,item.record);pending.set(item.ref.id,item.record)}render();status.textContent=items.length+' photo(s) added. Click Save record to keep them.'}catch(error){if(!disposed)status.textContent=error.message}finally{if(!disposed){picker.value='';markBusy(false)}}};
    grid.onclick=event=>{const remove=event.target.closest('[data-photo-remove]'),open=event.target.closest('[data-photo-open]');if(busy||disposed)return;if(remove){const id=remove.dataset.photoRemove;refs=refs.filter(p=>p.id!==id);pending.delete(id);records.delete(id);render();status.textContent='Photo removed from this form. Click Save record to apply, or Cancel to keep the previous photos.'}else if(open){const ref=refs.find(p=>p.id===open.dataset.photoOpen),record=records.get(ref?.id);if(record)showPhoto(ref,record.dataUrl)}};
    grid.oninput=event=>{const id=event.target.dataset.photoLabel;if(id){const ref=refs.find(p=>p.id===id);if(ref)ref.label=event.target.value}};
    const ready=(async()=>{render();if(!refs.length)return;markBusy(true);status.textContent='Loading saved photos…';try{const loaded=await getMany(refs.map(p=>p.id));if(disposed)return;loaded.forEach((record,i)=>{if(record){validateRecord(refs[i],record);records.set(record.id,record)}});render();status.textContent=loaded.some(r=>!r)?'Some photos are unavailable. Restore their full backup; existing references are kept.':refs.length+' saved photo(s). Click a photo to view.'}catch(error){if(!disposed)status.textContent=error.message}finally{if(!disposed)markBusy(false)}})();
    return {ready,isBusy:()=>busy,refs:()=>{if(busy)throw Error('Please wait for the photos to finish loading.');return copy(refs)},newRecords:()=>Array.from(pending.values()),removedIds:()=>original.filter(p=>!refs.some(r=>r.id===p.id)).map(p=>p.id),dispose:()=>{disposed=true;refs=[];records.clear();pending.clear();picker.value='';grid.innerHTML=''}};
  }
  return {MAX_FILES,MAX_BYTES,MAX_BACKUP_BYTES,validRefs,allRefs,detectedType,validateFile,validateRecord,getMany,putMany,deleteMany,discardUnreferenced,prepareFiles,ensureRecords,packBackup,splitBackup,sectionHtml,mount};
});
