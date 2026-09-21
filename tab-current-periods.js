/* Keep the working registers focused on the current period by default, while
   retaining a period a user deliberately chooses during the current visit. */
(function(){
  var selections={invoice:null,expense:null};
  function pair(key,monthId,yearId){
    var month=document.getElementById(monthId),year=document.getElementById(yearId);if(!month||!year)return;
    var now=new Date(),current={month:String(now.getMonth()),year:String(now.getFullYear())};
    if(!selections[key])selections[key]=current;
    var wanted=selections[key],hasYear=Array.prototype.slice.call(year.options).some(function(option){return option.value===wanted.year});
    if(!hasYear){var option=document.createElement('option');option.value=wanted.year;option.textContent=wanted.year;year.appendChild(option)}
    month.value=wanted.month;year.value=wanted.year;
    month.dispatchEvent(new Event('change',{bubbles:true}));year.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function applyInvoice(){pair('invoice','im','iy')}
  function applyExpense(){pair('expense','exMonth','exYear')}
  function applyAll(){applyInvoice();applyExpense()}
  document.addEventListener('change',function(event){var id=event.target&&event.target.id;if(id==='im'||id==='iy'){var current=selections.invoice||{};current[id==='im'?'month':'year']=event.target.value;selections.invoice=current}if(id==='exMonth'||id==='exYear'){var selected=selections.expense||{};selected[id==='exMonth'?'month':'year']=event.target.value;selections.expense=selected}},true);
  document.addEventListener('click',function(event){if(event.target.closest('[data-t="invoices"]'))setTimeout(applyInvoice,100);if(event.target.closest('[data-t="expenses"]'))setTimeout(applyExpense,420)},true);
  document.addEventListener('bwc:invoices-loaded',function(){setTimeout(applyInvoice,100)});
  document.addEventListener('bwc:expenses-loaded',function(){setTimeout(applyExpense,420)});
  window.addEventListener('load',function(){setTimeout(applyAll,1400)});
}());
