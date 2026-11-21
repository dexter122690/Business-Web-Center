/* Read-only category drill-down for the existing Expense Register.
   No expense, payment, or cash writes. The online adapter owns record actions. */
(function(root,factory){
  var api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {root.BWCExpenseCategories=api;api.install();}
}(typeof window!=='undefined'?window:null,function(root){
  'use strict';
  var selected='',lastContext='',lastRows=[],installed=false;
  var months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var defaults=['Parts & Materials','Labor','Salaries & Wages','Cost of Sales','Shipping Expense','Transportation Allowance','Supplies Expense','Marketing Expense','Utilities Expense','Rent Expense','Staff Cash Shortage / Unremitted Collection','Other'];
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function category(row){return String(row.category||row.type||'Other');}
  function amount(row){return Number(row.amount||0)*Number(row.quantity||1);}
  function money(value){return 'PHP '+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function matches(date,period){
    var raw=String(date||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return false;
    if(period.from&&period.to)return raw>=period.from&&raw<=period.to;
    return (period.month===''||Number(raw.slice(5,7))-1===Number(period.month))&&(!period.year||raw.slice(0,4)===String(period.year));
  }
  function model(rows,period,choice,branchId,known){
    var all=rows.filter(function(row){return (!row.branchId||row.branchId===branchId)&&matches(row.date,period);});
    var groups=new Map();
    (known||defaults).forEach(function(name){groups.set(name,{name:name,count:0,total:0});});
    all.forEach(function(row){var name=category(row);if(!groups.has(name))groups.set(name,{name:name,count:0,total:0});var group=groups.get(name);group.count++;group.total+=amount(row);});
    if(choice&&!groups.has(choice))groups.set(choice,{name:choice,count:0,total:0});
    var filtered=choice?all.filter(function(row){return category(row)===choice;}):all;
    return {choice:choice||'',all:all,rows:filtered,groups:Array.from(groups.values()),total:all.reduce(function(sum,row){return sum+amount(row);},0),
      subtotal:filtered.reduce(function(sum,row){return sum+amount(row);},0),
      cost:all.filter(function(row){return category(row)==='Cost of Sales';}).reduce(function(sum,row){return sum+amount(row);},0)};
  }
  function id(row){return String(row.remoteId||row.id||'');}
  function rowHtml(row){
    var qty=Number(row.quantity||1),unit=Number(row.amount||0);
    return '<tr data-expense-record-id="'+esc(id(row))+'"><td>'+esc(row.date)+'</td><td>'+esc(row.supplier||'—')+'</td><td>'+esc(row.receiptNumber||row.reference||'—')+'</td><td>'+esc(row.description)+'</td><td>'+esc(category(row))+'</td><td>'+esc(qty)+'</td><td>'+money(unit)+'</td><td><b>'+money(qty*unit)+'</b></td><td>'+esc(row.payment||'—')+'</td></tr>';
  }
  function tableHtml(data,title){
    return '<div class="expense-category-result-heading"><h2 id="expenseCategoryResultTitle">'+esc(title)+'</h2><p>Full list of matching expense items. Receipts with mixed categories include only the matching lines.</p></div>'+
      (data.rows.length?'<div class="expense-category-table-scroll"><table data-expense-category-view="1" aria-labelledby="expenseCategoryResultTitle"><thead><tr>'+['Date','Supplier','Receipt no.','Item / service','Category','Qty','Unit amount','Total','Payment source'].map(function(name){return '<th scope="col">'+name+'</th>';}).join('')+'</tr></thead><tbody>'+data.rows.map(rowHtml).join('')+'</tbody></table></div>':'<div class="empty">No expenses in this category for the selected period.</div>')+
      '<div class="expense-category-total" role="status"><span>'+data.rows.length+' expense entr'+(data.rows.length===1?'y':'ies')+' · '+(data.choice?'Category subtotal':'All expenses total')+'</span><strong>'+money(data.subtotal)+'</strong></div>';
  }
  function byId(name){return root.document.getElementById(name);}
  function context(){return {business:root.localStorage.getItem('bwc-active-business')||'',branch:root.localStorage.getItem('bwc-active-branch')||'main'};}
  function period(){
    var month=byId('dm')||byId('exMonth'),year=byId('dy')||byId('exYear');
    return {month:month?month.value:String(new Date().getMonth()),year:year?year.value:String(new Date().getFullYear()),from:(byId('dashboardDateFrom')||{}).value||'',to:(byId('dashboardDateTo')||{}).value||''};
  }
  function periodLabel(p){return p.from&&p.to?p.from+' to '+p.to:(p.month===''?'All months':months[Number(p.month)])+' '+(p.year||'/ All years');}
  function setSelect(field,value){if(!field)return;if(value&&!Array.from(field.options).some(function(o){return o.value===value;})){var option=root.document.createElement('option');option.value=value;option.textContent=value;field.appendChild(option);}field.value=value;}
  function restorePeriod(){
    var p=period();setSelect(byId('exMonth'),p.month);setSelect(byId('exYear'),p.year);
    ['exMonth','exYear'].forEach(function(name){var field=byId(name);if(field)field.dataset.currentPeriodReady='1';});
  }
  function knownCategories(){var field=byId('receiptItemCategory');return field?Array.from(field.options).map(function(o){return o.value;}):defaults;}
  function branchName(c){var picker=byId('onlineBranchPicker');return picker&&picker.value===c.branch&&picker.options[picker.selectedIndex]?picker.options[picker.selectedIndex].textContent:'Selected branch';}
  function cardHtml(name,value,count,active){
    return '<button type="button" class="expense-category-button" data-expense-category="'+esc(name)+'" aria-pressed="'+active+'" aria-controls="expenseReceiptTable"><span class="expense-category-name">'+esc(name||'All expenses')+'</span><strong>'+money(value)+'</strong><span class="expense-category-count">'+count+' entr'+(count===1?'y':'ies')+'</span></button>';
  }
  function section(table){
    var box=byId('expenseCategoryBrowser');
    if(!box){box=root.document.createElement('section');box.id='expenseCategoryBrowser';box.className='card';box.setAttribute('aria-label','Expenses by category');table.parentElement.insertAdjacentElement('beforebegin',box);}
    return box;
  }
  function metrics(data){
    var suppliers=new Set((data?data.all:[]).map(function(row){return String(row.supplier||'').trim();}).filter(Boolean));
    var text={exTotal:data?money(data.total):'—',exCost:data?money(data.cost):'—',exSuppliers:data?String(suppliers.size):'—',exLines:data?String(data.all.length):'—',exCount:data?data.all.length+' expense entries · all categories':'Expense totals unavailable'};
    Object.keys(text).forEach(function(name){var el=byId(name);if(el)el.textContent=text[name];});
  }
  function render(rows){
    if(!root)return;
    if(Array.isArray(rows))lastRows=rows;
    var table=byId('expenseReceiptTable');if(!table)return;
    var c=context(),key=JSON.stringify(c);
    if(key!==lastContext){selected='';lastContext=key;}
    restorePeriod();
    var p=period(),box=section(table),state=root.__bwcExpenseLoadState;
    if(state&&(state.status!=='ready'||state.businessId!==c.business||state.branchId!==c.branch)){
      metrics(null);box.innerHTML='<div class="k">Expense review</div><h2>Expenses by category</h2>';
      table.innerHTML='<div class="empty" role="status">'+esc(state.status==='error'?'Expenses could not be loaded completely. Please retry; no partial totals are shown.':'Loading complete expense records for this branch…')+(state.status==='error'?' <button type="button" class="secondary" data-retry-expenses>Retry loading</button>':'')+'</div>';
      return;
    }
    var source=Array.isArray(root.__bwcOnlineExpenses)?root.__bwcOnlineExpenses:lastRows,data=model(source,p,selected,c.branch,knownCategories());
    metrics(data);
    box.innerHTML='<div class="k">Expense review</div><h2>Expenses by category</h2><p class="expense-category-context">'+esc(branchName(c))+' · '+esc(periodLabel(p))+'</p><p class="expense-category-help">Choose a category to see every matching item below. The summary cards above always show all categories for this period. Month and year follow the Dashboard; changing them here updates that reporting period too.</p>'+
      (p.from&&p.to?'<p class="expense-category-help"><b>Dashboard custom range is active.</b> Choose a month or year to return to a monthly report.</p>':'')+
      '<div class="expense-category-grid">'+cardHtml('',data.total,data.all.length,!selected)+data.groups.map(function(group){return cardHtml(group.name,group.total,group.count,group.name===selected);}).join('')+'</div>';
    table.innerHTML=tableHtml(data,(selected||'All expenses')+' — '+periodLabel(p));
    root.document.dispatchEvent(new root.Event('bwc:expense-table-rendered'));
  }
  function refresh(){render();}
  function install(){
    if(!root||installed)return;installed=true;
    var style=root.document.createElement('style');style.id='expenseCategoryStyle';
    style.textContent='#expenseCategoryBrowser{margin-top:16px}#expenseCategoryBrowser h2{margin:4px 0 8px}.expense-category-context{font-size:16px;font-weight:600;margin:0 0 8px}.expense-category-help{font-size:14px;line-height:1.5;color:#655b55;margin:8px 0 14px}.expense-category-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.expense-category-button{font:inherit;text-align:left;border:1px solid #dfd5ce;border-radius:10px;padding:14px;background:#fff;color:#28221f;cursor:pointer;display:flex;flex-direction:column;gap:8px;min-width:0}.expense-category-button:hover{border-color:#be3b12;background:#fff5ef}.expense-category-button[aria-pressed="true"]{background:#ff5219;color:#111;border-color:#a7310a;box-shadow:inset 0 0 0 1px #a7310a}.expense-category-button:focus-visible{outline:3px solid #1e4b8c;outline-offset:3px}.expense-category-name{font-size:14px;font-weight:700;line-height:1.35;overflow-wrap:anywhere}.expense-category-button strong{font-size:20px;line-height:1.2;overflow-wrap:anywhere}.expense-category-count{font-size:13px}.expense-category-result-heading{padding:18px 18px 8px}.expense-category-result-heading h2{margin:0 0 8px;font-size:20px}.expense-category-result-heading p{font-size:14px;color:#655b55;margin:0 0 8px}.expense-category-table-scroll{overflow-x:auto}.expense-category-table-scroll th,.expense-category-table-scroll td{font-size:14px}.expense-category-total{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px 18px;border-top:1px solid #d6c6bc;background:#fff4ee;font-size:16px}.expense-category-total strong{font-size:20px}@media(max-width:480px){.expense-category-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.expense-category-button{padding:11px}.expense-category-button strong{font-size:17px}}';
    root.document.head.appendChild(style);
    root.document.addEventListener('click',function(event){
      var button=event.target.closest('[data-expense-category]');if(!button)return;
      selected=button.dataset.expenseCategory;render();
      var buttons=root.document.querySelectorAll('[data-expense-category]');Array.from(buttons).some(function(el){if(el.dataset.expenseCategory===selected){el.focus();return true;}return false;});
    });
    // Capture the user's expense-period selection before the existing table renderer.
    root.document.addEventListener('change',function(event){
      var name=event.target&&event.target.id;if(name!=='exMonth'&&name!=='exYear')return;
      var dm=byId('dm'),dy=byId('dy');if(!dm||!dy)return;
      setSelect(dm,byId('exMonth').value);setSelect(dy,byId('exYear').value);
      ['dashboardDateFrom','dashboardDateTo','dashboardRangePreset'].forEach(function(id){var field=byId(id);if(field)field.value='';});
      var hint=byId('dashboardRangeHint');if(hint)hint.textContent='Choose Month and Year for a standard monthly report, or select both dates for a custom range.';
      root.document.dispatchEvent(new root.Event('bwc:dashboard-period-changed'));
    },true);
    root.document.addEventListener('change',function(event){if(event.target&&['dm','dy'].indexOf(event.target.id)>=0)refresh();});
    ['bwc:expenses-loaded','bwc:expense-load-state','bwc:dashboard-period-changed','bwc:dashboard-data-ready'].forEach(function(name){root.document.addEventListener(name,refresh);});
  }
  return {install:install,render:render,restorePeriod:restorePeriod,model:model,matches:matches,rowHtml:rowHtml,tableHtml:tableHtml};
}));
