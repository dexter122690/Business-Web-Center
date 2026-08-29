/* Keep public client appointment requests separate from staff schedules. */
(function(){
  var key='15m-unit-schedule';
  var preparedKey='bwc-prepared-client-schedule';
  function read(){try{var rows=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(rows)?rows:[]}catch(error){return []}}
  function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]})}
  function clientRequest(item){return item&&item.online===true&&(item.appointmentSource==='client'||(!item.createdBy&&item.clientResponse))}
  function responseLabel(value){return {confirmed:'Confirmed — client will come',call:'Please call client first',visit:'Client plans to visit'}[value]||'Client request'}
  function selectedBranchName(){var picker=document.getElementById('onlineBranchPicker');return picker&&picker.options[picker.selectedIndex]?picker.options[picker.selectedIndex].textContent:'Selected branch'}
  function ensureRequestsTab(){
    var nav=document.getElementById('nav'),main=document.querySelector('main');if(!nav||!main)return null;
    var page=document.getElementById('clientRequests');
    if(!page){page=document.createElement('section');page.id='clientRequests';page.className='view';main.appendChild(page)}
    if(!document.getElementById('clientRequestsTab')){var button=document.createElement('button');button.id='clientRequestsTab';button.type='button';button.textContent='Client Requests';button.onclick=function(){document.querySelectorAll('.view').forEach(function(view){view.classList.toggle('active',view===page)});nav.querySelectorAll('button').forEach(function(item){item.classList.toggle('active',item===button)});render();if(typeof window.bwcRefreshSchedule==='function')window.bwcRefreshSchedule()};var scheduleTab=document.getElementById('scheduleTab');if(scheduleTab)scheduleTab.insertAdjacentElement('afterend',button);else nav.appendChild(button)}
    return page;
  }
  function removeFromInternalViews(requests){
    var ids={};requests.forEach(function(item){ids[item.id]=true});
    document.querySelectorAll('#scheduleCalendar [data-schedule-edit]').forEach(function(button){if(ids[button.dataset.scheduleEdit])button.remove()});
    document.querySelectorAll('#scheduleUpcoming [data-schedule-edit]').forEach(function(button){if(ids[button.dataset.scheduleEdit]){var line=button.closest('.line');if(line)line.remove()}});
    var upcoming=document.getElementById('scheduleUpcoming');
    if(upcoming&&!upcoming.children.length)upcoming.innerHTML='<div class="empty">No staff appointments scheduled in the next 7 days.</div>';
  }
  function render(){
    var page=ensureRequestsTab();
    if(!page||!page.classList.contains('active'))return;
    var requests=read().filter(clientRequest).sort(function(a,b){return (a.date+a.time).localeCompare(b.date+b.time)});
    var rows=requests.map(function(item){var unit=[item.unit||item.vehicle,item.year,item.color].filter(Boolean).join(' · ');return '<tr><td><b>'+escapeHtml(item.client)+'</b><br><small>'+escapeHtml(item.contact||'No contact number')+'</small></td><td>'+escapeHtml(item.date)+'<br><small>'+escapeHtml(item.time||'Any time')+'</small></td><td><b>'+escapeHtml(unit||'Vehicle not entered')+'</b></td><td>'+escapeHtml(item.procedure||'No procedure entered')+(item.notes?'<br><small>Note: '+escapeHtml(item.notes)+'</small>':'')+'</td><td><span class="badge">'+escapeHtml(responseLabel(item.clientResponse))+'</span></td><td><button class="secondary" data-client-request-prepare="'+escapeHtml(item.id)+'">Prepare staff schedule</button></td></tr>'}).join('');
    page.innerHTML='<style>#clientRequests .client-requests-head{display:flex;justify-content:space-between;gap:12px;align-items:start}#clientRequests .request-table{overflow:auto}#clientRequests .request-table table{min-width:820px}@media(max-width:700px){#clientRequests .client-requests-head{display:block}#clientRequests .client-requests-head button{margin-top:9px}}</style><div class="heading"><div><div class="k">CLIENT APPOINTMENT REQUESTS</div><h1>Requests submitted by clients</h1><p class="muted">These requests are waiting here until your staff reviews and schedules them.</p></div><button class="secondary" type="button" data-client-appointment-copy>Copy client booking link</button></div><div class="notice">Showing requests for <b>'+escapeHtml(selectedBranchName())+'</b>. They do not appear in the staff calendar until you prepare and save a staff schedule.</div><div class="card request-table" style="margin-top:14px;padding:0"><table><thead><tr><th>Client</th><th>Requested date</th><th>Vehicle / unit</th><th>Service / notes</th><th>Client choice</th><th>Action</th></tr></thead><tbody>'+ (rows||'<tr><td colspan="6" class="empty">No client appointment requests for this branch yet.</td></tr>') +'</tbody></table></div>';
  }
  function setValue(id,value){var input=document.getElementById(id);if(input)input.value=value||''}
  function preparedRequest(){try{return JSON.parse(sessionStorage.getItem(preparedKey)||'null')}catch(error){return null}}
  function placePreparedRequest(scroll){
    var item=preparedRequest();if(!item)return;
    setValue('scheduleDate',item.date);setValue('scheduleTime',item.time);setValue('scheduleClient',item.client);setValue('scheduleContact',item.contact);setValue('scheduleVehicle',item.unit||item.vehicle);setValue('scheduleYear',item.year);setValue('scheduleColor',item.color);setValue('scheduleService',item.procedure||item.service);setValue('scheduleNotes',item.notes);
    if(scroll){var form=document.querySelector('#schedule .schedule-layout .card');if(form)form.scrollIntoView({behavior:'smooth',block:'start'})}
  }
  document.addEventListener('click',function(event){
    var copy=event.target.closest('[data-client-appointment-copy]');if(copy){
      event.preventDefault();
      if(typeof window.bwcCopyClientAppointmentLink==='function')window.bwcCopyClientAppointmentLink(copy);
      else alert('The booking link is still loading. Please try again in a moment.');
      return;
    }
    var button=event.target.closest('[data-client-request-prepare]');if(!button)return;
    var item=read().find(function(row){return row.id===button.dataset.clientRequestPrepare});if(!item)return;
    sessionStorage.setItem(preparedKey,JSON.stringify(item));
    var scheduleTab=document.getElementById('scheduleTab');if(scheduleTab)scheduleTab.click();
    alert('The request is now in the staff schedule form. Review it, then click Save schedule.');
    /* The schedule refreshes after a client request is read. Apply the values
       after that refresh and scroll the owner straight to the form. */
    placePreparedRequest(true);setTimeout(function(){placePreparedRequest(false)},180);setTimeout(function(){placePreparedRequest(false)},500);
  });
  document.addEventListener('bwc:schedule-loaded',function(){setTimeout(function(){render();placePreparedRequest(false)},0)});
  document.addEventListener('bwc:branch-ready',function(){setTimeout(render,200)});
  document.addEventListener('click',function(event){if(event.target.closest('[data-schedule-save],[data-schedule-cancel]'))sessionStorage.removeItem(preparedKey)});
  document.addEventListener('click',function(event){if(event.target.closest('#clientRequestsTab,[data-schedule-cancel],[data-schedule-save]'))setTimeout(render,180)});
  window.addEventListener('load',function(){setTimeout(function(){ensureRequestsTab();render()},700)});
})();
