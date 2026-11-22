/* Half-short-bond, portable PDF with embedded fonts and immutable release data. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PayrollPDF=api})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const text=v=>String(v??''),cell=(value,opts={})=>({text:text(value),...opts}),money=n=>cell(peso(n),{alignment:'right'});
  function table(headers,widths,rows){return {margin:[0,4,0,5],table:{headerRows:1,widths,body:[headers.map(h=>cell(h,{bold:true,fillColor:'#e8edf0'})),...rows]},layout:{hLineWidth:()=>.5,vLineWidth:()=>.5,hLineColor:()=>'#8996a0',vLineColor:()=>'#8996a0',paddingLeft:()=>3,paddingRight:()=>3,paddingTop:()=>3,paddingBottom:()=>3}}}
  function definition(record,logo){
    const c=record.snapshot,e=c.employee,p=c.period,released=record.releasedCopy||record.releaseConfirmation,content=[];
    content.push({columns:[logo?{image:logo,width:30}:{text:'15M',bold:true,fontSize:18,width:45},{stack:[{text:'15M AUTOCARE SERVICES',bold:true,fontSize:11},{text:'WEEKLY PAYSLIP'+(released?'':' · '+(record.id==='DRAFT'?'DRAFT':'SAVED WORKSHEET')),fontSize:8}],margin:[7,1,0,0]},{text:'Payday: '+p.releaseDate+'\n'+(released?'Released: '+(record.releasedOn||record.releaseConfirmation.date):'Not a release confirmation'),alignment:'right',fontSize:7}],margin:[0,0,0,5]});
    content.push(table(['EMPLOYEE','POSITION','SATURDAY–FRIDAY'],['*','*','*'],[[cell(e.name,{bold:true}),cell(e.position),cell(p.start+' — '+p.end)]]));
    if(c.simpleTest){
      content.push(table(['UNIT / YEAR','INVOICE / PLATE','COLOR','JOB ORDER','AGREED LABOR','PREV. RECORDED','BALANCE BEFORE','THIS WEEK'],[62,56,37,'*',56,55,55,55],c.rows.length?c.rows.map(r=>[cell(r.job.unit+'\n'+text(r.job.year)),cell(text(r.job.invoice)+'\n'+text(r.job.plate)),cell(r.job.color),cell(r.job.work),money(r.job.contract),money(r.job.contract-r.opening),money(r.opening),money(r.weekly)]):[[cell('No unit entries'),cell(''),cell(''),cell(''),money(0),money(0),money(0),money(0)]]));
    }else{
      content.push({text:'Daily rate: '+peso(e.rate)+' · '+c.rules.hoursPerDay+' hours/day · '+c.paidDays+' paid day(s)',margin:[0,2,0,2]});
      content.push(table(['DATE','ATTENDANCE','LATE','OVERTIME (RECORD)','DEDUCTION','DAY PAY'],[85,'*',55,95,70,70],c.attendance.map(a=>[cell(a.date),cell(a.status),cell((a.lateMinutes||0)+' min'),cell((a.overtimeMinutes||0)+' min'),money(a.deduction),money(a.net)])));
      if(c.advances?.length)content.push(table(['CASH ADVANCE DATE','NOTE','DEDUCTION'],[100,'*',80],c.advances.map(a=>[cell(a.date),cell(a.note||'Cash advance deduction'),money(a.amount)])));
    }
    const summary=[['GROSS EARNINGS',c.basic],...(!c.simpleTest?[['LATE DEDUCTION',-c.late],['RETENTION HELD',-c.held],['RETENTION PAID',c.retentionReleased]]:[]),['LESS CASH ADVANCE',-c.cashAdvance],['TOTAL SALARY',c.net]];
    content.push(table(['SUMMARY','AMOUNT'],['*',95],summary.map(([label,n],i)=>[cell(label,{bold:i===summary.length-1,fillColor:i===summary.length-1?'#fff0c2':null}),{...money(n),bold:i===summary.length-1,fillColor:i===summary.length-1?'#fff0c2':null}])));
    const balances=c.simpleTest?c.rows.filter(r=>r.remaining!==0||r.job.retentionStatus==='retained').map(r=>[cell(r.job.unit+' · '+text(r.job.plate)),cell(r.job.work),money(r.remaining),cell(r.job.retentionStatus==='retained'?'Retained':'Ongoing'),cell(r.job.unitReleasedOn||r.job.releasedOn||'Not set'),cell(r.job.retentionDue||r.job.retentionEligibleOn||r.job.due||'Not set')]):(c.retentionAccounts||[]).filter(a=>a.balance>0).map(a=>[cell(a.job.unit+' · '+a.job.plate),cell(a.job.work),money(a.balance),cell('Retained'),cell(a.job.releasedOn||'Not set'),cell(a.job.retentionEligibleOn||a.job.due||'Not set')]);
    if(balances.length){content.push({text:'BALANCE / RETAINED UNITS · NOT ADDED TO THIS WEEK’S PAY',bold:true,fontSize:7,margin:[0,4,0,0]});content.push(table(['UNIT','JOB ORDER','BALANCE','STATUS','UNIT RELEASED','PAYOUT DATE'],[85,'*',65,45,65,65],balances));content.push({text:'Retention dates are reference only. A blank date means the payout date has not been set.',fontSize:6.5,color:'#465562'});}
    if(c.previousPayments?.length){content.push({text:'PREVIOUS PAYMENT RECORD',bold:true,fontSize:7,margin:[0,6,0,0]});content.push(table(['UNIT','PAYROLL PERIOD','PAYMENT DATE','AMOUNT'],['*',140,90,80],c.previousPayments.map(v=>[cell(c.rows.find(r=>r.job.id===v.jobId)?.job.unit||v.jobId),cell(v.periodStart+' — '+v.periodEnd),cell(v.date),money(v.amount)])));}
    content.push({text:'Prepared by: ____________________       Received by: ____________________',fontSize:7,margin:[0,12,0,0]});
    return {pageSize:{width:612,height:396},pageMargins:[18,16,18,24],defaultStyle:{font:'Roboto',fontSize:7,lineHeight:1.08},content,footer:(page,pages)=>({text:'15M Payroll · '+record.id+' · '+page+' / '+pages,alignment:'center',fontSize:6,margin:[10,7,10,0]}),info:{title:'15M Payslip — '+e.name+' — '+p.start,author:'15M Autocare Services'}};
  }
  let logoPromise;
  async function logo(){if(!logoPromise)logoPromise=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const canvas=document.createElement('canvas');canvas.width=240;canvas.height=Math.round(img.naturalHeight*240/img.naturalWidth);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/png'))};img.onerror=()=>reject(Error('The 15M logo could not be loaded.'));img.src='15m-logo.png'});return logoPromise}
  async function dataUrl(record){if(!window.pdfMake)throw Error('PDF files are not ready. Reload Payroll and try again.');const doc=definition(record,await logo());return new Promise((resolve,reject)=>{try{pdfMake.createPdf(doc).getDataUrl(resolve)}catch(e){reject(e)}})}
  return {definition,dataUrl};
});
