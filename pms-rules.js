/* Shared PMS rules for online forms and new offline invoice requests. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BwcPmsRules=factory()})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 function hasPms(lines){return (lines||[]).some(function(x){return /\bpms\b/i.test(x.n||x.service_name||'')})}
 function validDate(day){if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))return false;var d=new Date(day+'T12:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===day}
 function sixMonths(day){if(!validDate(day))return '';var d=new Date(day+'T12:00:00Z'),date=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+6);var last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(date,last));return d.toISOString().slice(0,10)}
 function fullPaymentDate(total,payments){var target=Math.round(Number(total)*100),sum=0;if(!Number.isFinite(target)||target<=0)return '';var rows=(payments||[]).filter(function(p){return validDate(p.date||p.payment_date)&&Number.isFinite(Number(p.amount))&&Number(p.amount)>0}).slice().sort(function(a,b){return (a.date||a.payment_date).localeCompare(b.date||b.payment_date)});for(var p of rows){sum+=Math.round(Number(p.amount)*100);if(sum>=target)return p.date||p.payment_date}return ''}
 function schedule(total,payments){return sixMonths(fullPaymentDate(total,payments))}
 function details(input){var p=input||{},out={};for(var field of ['odometer_km','next_pms_odometer_km']){var v=p[field];if(v===null||v===undefined||String(v).trim()==='')throw Error(field==='odometer_km'?'PMS: enter the odometer reading.':'PMS: enter the next PMS odometer reading.');var n=Number(v);if(!Number.isFinite(n)||n<0||n>9999999999.99||Math.round(n*100)/100!==n)throw Error('PMS odometer readings must be valid non-negative numbers (up to 2 decimal places).');out[field]=n}
  out.technician_name=String(p.technician_name||'').trim();if(out.technician_name.length>200)throw Error('Please shorten the technician name (maximum 200 characters).');out.technician_worker_id=null;out.technician_employee_id=null;out.notes=String(p.notes||'').trim();return out;
 }
 return {hasPms:hasPms,validDate:validDate,sixMonths:sixMonths,fullPaymentDate:fullPaymentDate,schedule:schedule,details:details};
});
