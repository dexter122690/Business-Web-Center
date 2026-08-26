/* Keep public client appointment requests separate from staff schedules. */
(function(){
  var key='15m-unit-schedule';
  function read(){try{var rows=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(rows)?rows:[]}catch(error){return []}}
  function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]})}
  function clientRequest(item){return item&&item.online===true&&(item.appointmentSource==='client'||(!item.createdBy&&item.clientResponse))}
  function responseLabel(value){return {confirmed:'Confirmed — client will come',call:'Please call client first',visit:'Client plans to visit'}[value]||'Client request'}
  function removeFromInternalViews(requests){
    var ids={};requests.forEach(function(item){ids[item.id]=true});
    document.querySelectorAll('#scheduleCalendar [data-schedule-edit]').forEach(function(button){if(ids[button.dataset.scheduleEdit])button.remove()});
    document.querySelectorAll('#scheduleUpcoming [data-schedule-edit]').forEach(function(button){if(ids[button.dataset.scheduleEdit]){var line=button.closest('.line');if(line)line.remove()}});
    var upcoming=document.getElementById('scheduleUpcoming');
    if(upcoming&&!upcoming.children.length)upcoming.innerHTML='<div class="empty">No staff appointments scheduled in the next 7 days.</div>';
  }
  function render(){
    var schedule=document.getElementById('schedule');
    if(!schedule||!schedule.classList.contains('active'))return;
    var requests=read().filter(clientRequest).sort(function(a,b){return (a.date+a.time).localeCompare(b.date+b.time)});
    removeFromInternalViews(requests);
    var existing=document.getElementById('clientAppointmentRequests');if(existing)existing.remove();
    var card=document.createElement('div');card.id='clientAppointmentRequests';card.className='card';
    var rows=requests.map(function(item){
      var procedure=item.procedure||'No procedure entered';
      var unit=[item.unit||item.vehicle,item.year,item.color].filter(Boolean).join(' · ');
      return '<div class="client-request-row"><div><b>'+escapeHtml(item.client)+'</b><br><small>'+escapeHtml(item.date)+' '+escapeHtml(item.time||'Any time')+' · '+escapeHtml(responseLabel(item.clientResponse))+'</small></div><div><b>'+escapeHtml(unit)+'</b><br><small>'+escapeHtml(procedure)+' · '+escapeHtml(item.contact||'No contact number')+'</small>'+(item.notes?'<br><small>Note: '+escapeHtml(item.notes)+'</small>':'')+'</div><button class="secondary" data-client-request-prepare="'+escapeHtml(item.id)+'">Prepare staff schedule</button></div>';
    }).join('');
    card.innerHTML='<style>#clientAppointmentRequests .client-request-row{display:grid;grid-template-columns:minmax(170px,.9fr) minmax(230px,1.4fr) auto;gap:12px;align-items:center;padding:11px 0;border-top:1px solid var(--l)}#clientAppointmentRequests .client-request-row:first-of-type{border-top:0}@media(max-width:700px){#clientAppointmentRequests .client-request-row{grid-template-columns:1fr}#clientAppointmentRequests .client-request-row button{width:100%}}</style><div class="k">CLIENT APPOINTMENT REQUESTS</div><h2>Requests submitted by clients</h2><p class="muted">These are submitted through your public appointment link. They are separate from staff-created schedules below.</p>'+(rows||'<div class="empty">No client appointment requests for this branch yet.</div>');
    var layout=schedule.querySelector('.schedule-layout');if(layout)layout.insertAdjacentElement('beforebegin',card);else schedule.appendChild(card);
  }
  function setValue(id,value){var input=document.getElementById(id);if(input)input.value=value||''}
  document.addEventListener('click',function(event){
    var button=event.target.closest('[data-client-request-prepare]');if(!button)return;
    var item=read().find(function(row){return row.id===button.dataset.clientRequestPrepare});if(!item)return;
    setValue('scheduleDate',item.date);setValue('scheduleTime',item.time);setValue('scheduleClient',item.client);setValue('scheduleContact',item.contact);setValue('scheduleVehicle',item.unit||item.vehicle);setValue('scheduleYear',item.year);setValue('scheduleColor',item.color);setValue('scheduleService',item.procedure||item.service);setValue('scheduleNotes',item.notes);
    var form=document.querySelector('#schedule .schedule-layout .card');if(form)form.scrollIntoView({behavior:'smooth',block:'start'});
    alert('The client request was copied into a new staff schedule. Review it, then click Save schedule.');
  });
  document.addEventListener('bwc:schedule-loaded',function(){setTimeout(render,0)});
  document.addEventListener('bwc:branch-ready',function(){setTimeout(render,200)});
  document.addEventListener('click',function(event){if(event.target.closest('#scheduleTab,[data-schedule-cancel],[data-schedule-save]'))setTimeout(render,180)});
  window.addEventListener('load',function(){setTimeout(render,700)});
})();
