/* Read-only drill-down of the exact snapshot used by the Dashboard card.
   No separate balance calculation and no financial database writes. */
(function(root,factory){
  var api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.BWCUnpaidInvoices=api;api.install()}
}(typeof window!=='undefined'?window:null,function(root){
  'use strict';
  var dialog=null,card=null,content=null,installed=false;
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(value){return 'PHP '+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function periodLabel(period){
    if(period.from&&period.to)return period.from+' to '+period.to;
    var months=['January','February','March','April','May','June','July','August','September','October','November','December'];
    return (period.month!==''&&period.month!=null?months[Number(period.month)]:'All months')+' / '+(period.year||'All years');
  }
  function tableHtml(rows,canOpen){
    if(!rows.length)return '<p class="unpaid-empty">No unpaid or partially paid invoices in this period.</p>';
    return '<div class="unpaid-table-scroll" tabindex="0" aria-label="Unpaid invoice details"><table><thead><tr>'+['Invoice / date','Client / vehicle / plate','Invoice total','Paid to date','Written off','Remaining balance','Status','Action'].map(function(label){return '<th scope="col">'+label+'</th>'}).join('')+'</tr></thead><tbody>'+rows.map(function(row){
      return '<tr data-unpaid-row="'+esc(row.id)+'"><td><b>'+esc(row.number)+'</b><br><span>'+esc(row.date)+'</span></td><td class="unpaid-client"><b>'+esc(row.client||'Not recorded')+'</b><br>'+esc(row.vehicle||'Not recorded')+'<br><span>'+esc(row.plate||'No plate recorded')+'</span></td><td class="unpaid-money">'+money(row.total)+'</td><td class="unpaid-money">'+money(row.paid)+'</td><td class="unpaid-money">'+money(row.writtenOff)+'</td><td class="unpaid-money"><b>'+money(row.balance)+'</b></td><td><span class="unpaid-status">'+esc(row.status)+'</span></td><td><button type="button" class="secondary" data-unpaid-open="'+esc(row.id)+'"'+(!canOpen?' disabled':'')+'>Open invoice</button></td></tr>';
    }).join('')+'</tbody></table></div>';
  }
  function byId(id){return root.document.getElementById(id)}
  function access(id){var view=byId(id);return !!view&&view.dataset.access!=='none'}
  function snapshot(){var api=root.BWCDashboardReport;return api&&typeof api.unpaidSnapshot==='function'?api.unpaidSnapshot():{status:'loading'}}
  function close(){if(dialog&&dialog.open)dialog.close()}
  function branchLabel(context){
    if(!context.branch)return 'All accessible branches';
    var picker=byId('onlineBranchPicker'),option=picker&&Array.prototype.find.call(picker.options,function(item){return item.value===context.branch});
    return option?option.textContent:'Selected branch';
  }
  function draw(){
    var state=snapshot(),allowed=access('dashboard');
    if(card){card.setAttribute('aria-busy',state.status==='loading'?'true':'false');card.setAttribute('aria-label','View unpaid invoices'+(state.status==='ready'?' — '+money(state.total):''))}
    if(!dialog||!dialog.open)return;
    if(!allowed){close();return}
    if(state.status!=='ready'){
      content.innerHTML='<p class="unpaid-empty" role="status">'+esc(state.status==='error'?state.message:'Loading the current Dashboard invoice balances…')+'</p>'+(state.status==='error'?'<button type="button" class="secondary" data-unpaid-retry>Try again</button>':'');
      return;
    }
    var canOpen=access('invoices')&&!!state.context.branch;
    content.innerHTML='<p class="unpaid-scope">'+esc(branchLabel(state.context))+' · '+esc(periodLabel(state.context.period))+'</p>'+ 
      '<div class="unpaid-summary"><div><span>Remaining unpaid balance</span><strong>'+money(state.total)+'</strong></div><b>'+state.rows.length+' invoice'+(state.rows.length===1?'':'s')+'</b></div>'+ 
      '<p class="unpaid-note">Invoices issued in the selected Dashboard period. Includes fully unpaid and partially paid invoices. Paid to date includes all recorded payment dates; written-off amounts are deducted from the balance, not counted as payments.</p>'+ 
      (!canOpen?'<p class="unpaid-note">'+(!state.context.branch?'Select a branch on the Dashboard to open an invoice.':'Invoice Making access is required to open a record.')+'</p>':'')+
      tableHtml(state.rows,canOpen)+'<p class="unpaid-footnote">These balances use the same records and calculation as the Dashboard card. Viewing this list does not change invoices, payments or CIB.</p>';
  }
  function ensureDialog(){
    if(dialog)return;
    dialog=root.document.createElement('dialog');dialog.id='unpaidInvoiceDialog';dialog.setAttribute('aria-labelledby','unpaidInvoiceTitle');
    dialog.innerHTML='<header class="unpaid-header"><div><div class="unpaid-eyebrow">Dashboard details</div><h2 id="unpaidInvoiceTitle">Unpaid invoices</h2></div><button type="button" class="secondary" data-unpaid-close aria-label="Close unpaid invoices">Close</button></header><div class="unpaid-content"></div>';
    root.document.body.appendChild(dialog);content=dialog.querySelector('.unpaid-content');
    dialog.addEventListener('close',function(){if(card){card.setAttribute('aria-expanded','false');card.focus()}});
    dialog.addEventListener('click',function(event){
      if(event.target.closest('[data-unpaid-close]')){close();return}
      if(event.target===dialog){var box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close();return}
      if(event.target.closest('[data-unpaid-retry]')){
        var api=root.BWCDashboardReport;if(api&&api.prepare)api.prepare().catch(function(){draw()});return;
      }
      var button=event.target.closest('[data-unpaid-open]');if(!button)return;
      var state=snapshot();
      if(!access('dashboard')||!access('invoices')||state.status!=='ready'||!state.context.branch||!state.rows.some(function(row){return row.id===button.dataset.unpaidOpen})){draw();return}
      var id=button.dataset.unpaidOpen;
      close();
      if(typeof root.show==='function')root.show('invoices');
      root.document.dispatchEvent(new root.CustomEvent('bwc:open-invoice',{detail:{remoteId:id}}));
    });
  }
  function open(){
    if(!access('dashboard'))return;
    ensureDialog();if(!dialog.open)dialog.showModal();card.setAttribute('aria-expanded','true');draw();
  }
  function install(){
    if(!root||installed)return;
    var metric=byId('unpaid');if(!metric)return;installed=true;card=metric.closest('.card');if(!card)return;
    var style=root.document.createElement('style');style.id='unpaidInvoiceStyles';
    style.textContent='.unpaid-card{cursor:pointer;transition:border-color .15s,box-shadow .15s}.unpaid-card:hover{border-color:#ff5219;box-shadow:0 3px 12px #ff521914}.unpaid-card:focus-visible{outline:3px solid #b13d15;outline-offset:3px}.unpaid-card-hint{display:block;color:#a53b15;font-size:14px;font-weight:600;margin-top:10px}'+
      '#unpaidInvoiceDialog{width:min(1280px,calc(100vw - 36px));max-width:none;max-height:88vh;padding:0;border:1px solid #dccfc9;border-radius:16px;color:#26201c;background:#fff;box-shadow:0 18px 75px #0004;font:16px/1.45 Arial,sans-serif}#unpaidInvoiceDialog[open]{display:flex;flex-direction:column}#unpaidInvoiceDialog::backdrop{background:#1d151299}'+
      '#unpaidInvoiceDialog .unpaid-header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 26px;border-bottom:1px solid #eaded8;background:#fff}#unpaidInvoiceDialog h2{font-size:23px;margin:3px 0 0}.unpaid-eyebrow{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#a53b15}.unpaid-content{padding:20px 26px;overflow:auto;min-height:0}.unpaid-scope{margin:0 0 16px;color:#66534a;font-size:15px}.unpaid-summary{display:flex;align-items:center;justify-content:space-between;gap:18px;background:#fff4ef;border:1px solid #f1d5c7;padding:18px 20px;border-radius:12px}.unpaid-summary span{display:block;font-size:14px}.unpaid-summary strong{display:block;color:#bc3f12;font-size:28px;margin-top:3px;font-variant-numeric:tabular-nums}.unpaid-summary>b{font-size:15px;white-space:nowrap}.unpaid-note,.unpaid-footnote{font-size:14px;color:#66534a;line-height:1.5}.unpaid-footnote{margin-bottom:0}.unpaid-empty{padding:24px 0;color:#66534a}'+
      '.unpaid-table-scroll{overflow:auto;border:1px solid #eaded8;border-radius:10px;margin:20px 0}.unpaid-table-scroll table{width:100%;min-width:1050px;border-collapse:collapse}.unpaid-table-scroll th,.unpaid-table-scroll td{padding:14px 12px;text-align:left;border-bottom:1px solid #eaded8;font-size:14px;vertical-align:top}.unpaid-table-scroll th{font-weight:600;background:#faf6f4;color:#66534a}.unpaid-table-scroll tr:last-child td{border-bottom:0}.unpaid-table-scroll .unpaid-money{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}.unpaid-client{min-width:175px;max-width:260px;overflow-wrap:anywhere}.unpaid-table-scroll td span{font-size:13px}.unpaid-status{display:inline-block;padding:3px 8px;background:#fff0e9;border-radius:6px;color:#90380f}.unpaid-table-scroll button{white-space:nowrap}#unpaidInvoiceDialog button{font-size:14px;cursor:pointer}#unpaidInvoiceDialog button:disabled{opacity:.5;cursor:not-allowed}'+
      '@media(max-width:600px){#unpaidInvoiceDialog{width:calc(100vw - 16px);max-height:94vh}#unpaidInvoiceDialog .unpaid-header,.unpaid-content{padding:16px}.unpaid-summary{padding:14px}.unpaid-summary strong{font-size:23px}}';
    // The app's global header rule is for the black masthead, not this dialog.
    style.textContent+='#unpaidInvoiceDialog .unpaid-header{color:inherit;height:auto;flex-shrink:0}';
    root.document.head.appendChild(style);
    card.classList.add('unpaid-card');card.setAttribute('role','button');card.tabIndex=0;card.setAttribute('aria-haspopup','dialog');card.setAttribute('aria-controls','unpaidInvoiceDialog');card.setAttribute('aria-expanded','false');
    var hint=root.document.createElement('span');hint.className='unpaid-card-hint';hint.textContent='View unpaid invoices';card.appendChild(hint);
    card.addEventListener('click',open);card.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();open()}});
    root.document.addEventListener('bwc:unpaid-state-changed',draw);
    ['bwc:branch-ready','bwc:business-ready'].forEach(function(name){root.document.addEventListener(name,close)});
    root.document.addEventListener('visibilitychange',function(){if(!root.document.hidden)draw()});
    draw();
  }
  return {install:install,tableHtml:tableHtml,periodLabel:periodLabel};
}));
