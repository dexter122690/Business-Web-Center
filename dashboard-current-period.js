/* Start each new dashboard visit on the calendar month that is current on the
   device. Once the user changes the period, their choice is left untouched. */
(function(){
  var applied=false;
  function applyCurrentPeriod(){
    if(applied)return;
    var month=document.getElementById('dm'),year=document.getElementById('dy');
    if(!month||!year||!year.options.length)return;
    var now=new Date(),currentMonth=String(now.getMonth()),currentYear=String(now.getFullYear());
    if(!month.value)month.value=currentMonth;
    if(!year.value){
      var hasYear=Array.prototype.slice.call(year.options).some(function(option){return option.value===currentYear});
      if(!hasYear){var option=document.createElement('option');option.value=currentYear;option.textContent=currentYear;year.appendChild(option)}
      year.value=currentYear;
    }
    applied=true;
    document.dispatchEvent(new Event('bwc:dashboard-period-changed'));
  }
  document.addEventListener('bwc:dashboard-data-ready',applyCurrentPeriod);
  window.addEventListener('load',function(){setTimeout(applyCurrentPeriod,1200)});
}());
