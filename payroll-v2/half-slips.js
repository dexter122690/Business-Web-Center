/* Half-short-bond payslips. Paginate measured table rows; never hide overflow. */
(function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const date=d=>d?new Date(d+'T12:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}):'Not set';
  const textBlock=text=>({html:`<p class="slip-note">${esc(text)}</p>`,text});
  function tableRow(group,headers,cells,kind=''){
    const row={group,headers,cells:cells.map(String),kind,text:group+' — '+cells.join(' | ')};
    row.html=bodyHtml([row]);return row;
  }
  function bodyHtml(rows){let html='',group=null;for(const r of rows){if(!r.group){if(group)html+='</tbody></table>';group=null;html+=r.html;continue}if(group!==r.group){if(group)html+='</tbody></table>';html+=`<table class="payroll-grid ${r.kind||''}"><caption>${esc(r.group)}</caption><thead><tr>${r.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>`;group=r.group}html+=`<tr>${r.cells.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`}return html+(group?'</tbody></table>':'')}
  function blocks(c,detailedHistory=true){
    const out=[];
    if(c.simpleTest){
      const headings=['Unit / year','Invoice / plate','Color','Job order','Agreed labor','Previous recorded','Balance before','This week'];
      for(const r of c.rows)out.push(tableRow('WEEKLY LABOR — AMOUNTS IN ₱',headings,[r.job.unit+'\n'+(r.job.year||''),[r.job.invoice?'INV '+r.job.invoice:'',r.job.plate].filter(Boolean).join('\n'),r.job.color||'',r.job.work||'',peso(r.job.contract),peso(r.job.contract-r.opening),peso(r.opening),peso(r.weekly)],'labor-grid'));
      if(!c.rows.length)out.push(textBlock('No units entered for this week.'));
      const balances=c.rows.filter(r=>r.remaining!==0||r.job.retentionStatus==='retained'||r.job.closed);
      for(const r of balances){const j=r.job,status=j.retentionStatus||(j.closed?'retained':'ongoing');out.push(tableRow('BALANCE / RETAINED UNITS — NOT EXTRA SALARY',['Unit / plate','Job order','Status','Amount remaining','Unit released','Retention payout date'],[j.unit+'\n'+(j.plate||''),j.work||'',status==='retained'?'Retained':'Ongoing',peso(r.remaining),date(j.unitReleasedOn??j.releasedOn),status==='retained'?date(j.retentionDue??j.retentionEligibleOn??j.due):'Not set'], 'balance-grid'))}
      if(detailedHistory)for(const p of c.previousPayments||[]){const j=c.rows.find(r=>r.job.id===p.jobId)?.job;out.push(tableRow('PREVIOUS ENTRIES — REFERENCE ONLY, EXCLUDED FROM THIS WEEK',['Payroll / entry date','Unit / plate','Entry type','Amount'],[p.periodStart!==p.periodEnd?date(p.periodStart)+' – '+date(p.periodEnd):date(p.date),[j?.unit,j?.plate].filter(Boolean).join(' · '),p.note,peso(p.amount)],'previous-grid'))}
      out.push(textBlock('Previous amounts and remaining balances are references, not additional salary. Retention dates are references only; no automatic deduction or payment.'));
      return out;
    }
    if(c.employee.type==='daily'){
      out.push(textBlock('Daily rate '+peso(c.employee.rate)+' · '+c.rules.hoursPerDay+' hours/day · '+c.paidDays+' paid day(s)'));
      const hasOvertime=c.attendance.some(a=>a.overtimeEnabled||a.overtimeMinutes>0),duration=n=>n?Math.floor(n/60)+'h '+n%60+'m':'—';
      for(const a of c.attendance)out.push(tableRow('DAILY ATTENDANCE',['Date','Attendance','Late duration',...(hasOvertime?['Overtime*']:[]),'Day pay'],[date(a.date),{present:'Present',absent:'Absent',late:'Late',rest:'Rest',unset:'Unmarked'}[a.status],duration(a.lateMinutes),...(hasOvertime?[duration(a.overtimeMinutes)]:[]),peso(a.net)]));
      if(hasOvertime)out.push(textBlock('* Overtime: '+duration(c.attendance.reduce((total,a)=>total+(a.overtimeMinutes||0),0))+'. Recorded time only; not included in pay. Overtime rate is not configured yet.'));
    }else{
      for(const p of c.portions||[])out.push(tableRow('RECORDED LABOR — THIS PERIOD',['Unit / plate','Job order','Date','Gross','Held','Net before advance'],[p.job.unit+' · '+p.job.plate,p.job.work,date(p.date),peso(p.gross),peso(p.retention),peso(p.gross-p.retention)]));
      for(const r of c.releases||[])out.push(tableRow('RETENTION PAYMENTS — THIS PERIOD',['Unit / plate','Date','Amount'],[r.job.unit+' · '+r.job.plate,date(r.date),peso(r.amount)]));
      const balances=c.unitBalances||[];
      for(const a of balances.filter(a=>a.remaining>0&&!a.completedAtCutoff))out.push(tableRow('ONGOING BALANCES — REFERENCE ONLY',['Unit / plate','Job order','Balance'],[a.job.unit+' · '+a.job.plate,a.job.work,peso(a.remaining)]));
      for(const a of (c.retentionAccounts||[]).filter(a=>a.balance>0&&(!balances.find(r=>r.job.id===a.job.id)||balances.find(r=>r.job.id===a.job.id).completedAtCutoff))){const schedule=window.PayrollWorkflow.retentionSchedule(a.job);out.push(tableRow('RETAINED UNITS — REFERENCE ONLY',['Unit / plate','Amount','Unit released','Recorded eligibility'],[a.job.unit+' · '+a.job.plate,peso(a.balance),date(a.job.releasedOn),date(schedule.eligibleOn)]))}
    }
    for(const a of c.advances||[])out.push(tableRow('CASH ADVANCE DEDUCTIONS',['Date','Note','Amount'],[date(a.date),a.note||'Deduction',peso(a.amount)]));
    for(const w of c.warnings||[])out.push(textBlock('Review: '+w));return out;
  }
  function header(s,index=1,total=1){const c=s.snapshot,status=s.releasedCopy?'RELEASED COPY':c.simpleTest?'SAVED WORKSHEET':s.releaseConfirmation?'RELEASED COPY':s.savedAt?'SAVED · UNCONFIRMED':'DRAFT';return `<header class="half-head"><div class="slip-brand"><img src="15m-logo.png" width="52" height="52" alt="15M Autocare Services logo"><div><strong>15M AUTOCARE SERVICES</strong><span>WEEKLY PAYSLIP · ${status}</span></div><small>Part ${index} of ${total}</small></div><table class="slip-meta"><tbody><tr><th>DATE RANGE</th><td>${date(c.period.start)} – ${date(c.period.end)}</td><th>PAYDAY</th><td>${date(c.period.releaseDate)}</td></tr><tr><th>EMPLOYEE</th><td>${esc(c.employee.name)}</td><th>POSITION</th><td>${esc(c.employee.position)}</td></tr></tbody></table>${s.releasedCopy||s.releaseConfirmation?`<p class="release-reference">Released ${date(s.releasedOn||s.releaseConfirmation.date)} · ${esc(s.id)}</p>`:''}</header>`}
  function footer(c,last){return last?`<footer class="half-foot"><table class="slip-totals"><tbody><tr><th>${c.employee.type==='daily'?'BASIC PAY':'TOTAL THIS WEEK'}</th><td>${peso(c.basic)}</td></tr>${c.late?`<tr><th>LESS LATE</th><td>${peso(c.late)}</td></tr>`:''}${c.held?`<tr><th>LESS RETENTION HELD</th><td>${peso(c.held)}</td></tr>`:''}${c.retentionReleased?`<tr><th>ADD RETENTION PAID</th><td>${peso(c.retentionReleased)}</td></tr>`:''}<tr><th>LESS CASH ADVANCE</th><td>${peso(c.cashAdvance)}</td></tr><tr class="net-row"><th>NET PAY / TOTAL SALARY</th><td>${peso(c.net)}</td></tr></tbody></table><div class="slip-signatures"><span>Prepared by</span><span>Received by / date</span></div><small>BWC payroll · Recording a release does not transfer money.</small></footer>`:`<footer class="half-foot continued">Continued on the next half-sheet. Totals and signatures appear on the final part only.</footer>`}
  function cardHtml(s,rows,index,total,last){return `<article class="half-slip">${header(s,index,total)}<div class="half-content">${bodyHtml(rows)}</div>${footer(s.snapshot,last)}</article>`}
  function paginate(s,detailedHistory){
    const measure=document.createElement('div');measure.className='slip-measure';measure.setAttribute('aria-hidden','true');document.body.append(measure);measure.innerHTML=cardHtml(s,[],1,1,true);const body=measure.querySelector('.half-content'),pages=[];let current=[];
    const fits=rows=>{body.innerHTML=bodyHtml(rows);return body.scrollHeight<=body.clientHeight+1};
    const flush=()=>{if(current.length)pages.push(current);current=[]};
    try{for(const b of blocks(s.snapshot,detailedHistory)){
      if(fits([...current,b])){current.push(b);continue}flush();if(fits([b])){current.push(b);continue}
      // Extremely long cells continue as labeled text rather than being clipped.
      let remaining=b.text;while(remaining){let low=1,high=remaining.length,best=0;while(low<=high){const mid=Math.floor((low+high)/2);if(fits([textBlock(remaining.slice(0,mid))])){best=mid;low=mid+1}else high=mid-1}if(!best)throw Error('Payslip content cannot fit the half-sheet layout.');let cut=best;if(best<remaining.length){const space=remaining.lastIndexOf(' ',best);if(space>best/2)cut=space}current.push(textBlock(remaining.slice(0,cut)));remaining=remaining.slice(cut);if(remaining)flush()}
    }flush();if(!pages.length)pages.push([]);return pages.map((rows,i)=>cardHtml(s,rows,i+1,pages.length,i===pages.length-1))}finally{measure.remove()}
  }
  function render(records,options={}){const halves=records.flatMap(s=>paginate(s,Boolean(options.detailedHistory))),sheets=[];for(let i=0;i<halves.length;i+=2)sheets.push(`<section class="print-sheet">${halves.slice(i,i+2).join('')}</section>`);return {html:sheets.join(''),halves:halves.length,sheets:sheets.length}}
  window.PayrollSlips={render,blocks,bodyHtml,cardHtml};
})();
