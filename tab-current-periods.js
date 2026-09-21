/* Start every time-based working register on the current period. A period
   explicitly chosen by the user remains in place while that screen redraws. */
(function(){
  var selections={invoice:null,expense:null,payroll:null},timer=0;
  function currentPeriod(){return {month:String(new Date().getMonth()),year:String(new Date().getFullYear())}}
  function addYear(year,value){
    if(!Array.prototype.some.call(year.options,function(option){return option.value===value})){
      var option=document.createElement('option');option.value=value;option.textContent=value;year.appendChild(option);
    }
  }
  function pair(key,monthId,yearId){
    var month=document.getElementById(monthId),year=document.getElementById(yearId);
    if(!month||!year||month.dataset.currentPeriodReady==='1')return;
    if(!selections[key])selections[key]=currentPeriod();
    var wanted=selections[key];addYear(year,wanted.year);
    month.value=wanted.month;year.value=wanted.year;
    month.dataset.currentPeriodReady='1';year.dataset.currentPeriodReady='1';
    month.dispatchEvent(new Event('change',{bubbles:true}));
    year.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function applyInvoice(){pair('invoice','im','iy')}
  function applyExpense(){pair('expense','exMonth','exYear')}
  function applyPayroll(){
    var month=document.querySelector('[data-pr-issued-filter="month"]');
    var year=document.querySelector('[data-pr-issued-filter="year"]');
    if(!month||!year||month.dataset.currentPeriodReady==='1')return;
    if(!selections.payroll){var now=new Date();selections.payroll={month:String(now.getMonth()+1).padStart(2,'0'),year:String(now.getFullYear())}}
    var wanted=selections.payroll;addYear(year,wanted.year);
    /* Payroll redraws after each individual filter change. Set one value per
       redraw; the observer returns for the other, then marks the filter done. */
    if(year.value!==wanted.year){year.value=wanted.year;year.dispatchEvent(new Event('change',{bubbles:true}));return}
    if(month.value!==wanted.month){month.value=wanted.month;month.dispatchEvent(new Event('change',{bubbles:true}));return}
    month.dataset.currentPeriodReady='1';year.dataset.currentPeriodReady='1';
  }
  function applyAll(){applyInvoice();applyExpense();applyPayroll()}
  document.addEventListener('change',function(event){
    var id=event.target&&event.target.id;
    if(id==='im'||id==='iy'){var invoice=selections.invoice||{};invoice[id==='im'?'month':'year']=event.target.value;selections.invoice=invoice}
    if(id==='exMonth'||id==='exYear'){var expense=selections.expense||{};expense[id==='exMonth'?'month':'year']=event.target.value;selections.expense=expense}
    var payroll=event.target&&event.target.closest&&event.target.closest('[data-pr-issued-filter]');
    if(payroll){var issued=selections.payroll||{};issued[payroll.dataset.prIssuedFilter]=payroll.value;selections.payroll=issued}
  },true);
  document.addEventListener('click',function(event){
    if(event.target.closest('[data-t="invoices"]'))setTimeout(applyInvoice,100);
    if(event.target.closest('[data-t="expenses"]'))setTimeout(applyExpense,420);
    if(event.target.closest('[data-t="payroll"]'))setTimeout(applyPayroll,420);
  },true);
  document.addEventListener('bwc:invoices-loaded',function(){setTimeout(applyInvoice,100)});
  document.addEventListener('bwc:expenses-loaded',function(){setTimeout(applyExpense,420)});
  window.addEventListener('load',function(){setTimeout(applyAll,1400)});
  new MutationObserver(function(){clearTimeout(timer);timer=setTimeout(applyAll,0)}).observe(document.documentElement,{childList:true,subtree:true});
}());
