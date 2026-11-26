/* Half-short-bond, portable PDF with embedded fonts and immutable release data. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./simple-painter.js'):root.SimplePainter);if(typeof module==='object'&&module.exports)module.exports=api;else root.PayrollPDF=api})(typeof window!=='undefined'?window:this,function(S){
  'use strict';
  const peso=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const text=v=>String(v??''),cell=(value,opts={})=>({text:text(value),...opts}),money=n=>cell(peso(n),{alignment:'right'});
  function table(headers,widths,rows){return {margin:[0,2,0,2],table:{headerRows:1,widths,body:[headers.map(h=>cell(h,{bold:true,fillColor:'#e8edf0'})),...rows]},layout:{hLineWidth:()=>.5,vLineWidth:()=>.5,hLineColor:()=>'#8996a0',vLineColor:()=>'#8996a0',paddingLeft:()=>3,paddingRight:()=>3,paddingTop:()=>1,paddingBottom:()=>1}}}
  function signatures(){
    // Keep both signing areas together; reserve actual handwriting space in points.
    const rule=height=>({canvas:[{type:'line',x1:0,y1:height,x2:270,y2:height,lineWidth:.5,lineColor:'#555555'}]});
    return {unbreakable:true,columnGap:36,margin:[0,5,0,0],columns:['Prepared by','Received by'].map(label=>({width:270,stack:[{text:label,bold:true,alignment:'center',fontSize:7},rule(22),{text:'Signature',alignment:'center',fontSize:6.5,margin:[0,2,0,0]},rule(14),{text:'Printed name',alignment:'center',fontSize:6.5,margin:[0,2,0,0]},{text:'Date: ____________________________________________',fontSize:7,margin:[0,7,0,0]}]}))};
  }
  function definition(record,logo,{paper='half'}={}){
    const c=record.snapshot,e=c.employee,p=c.period,released=record.releasedCopy||record.releaseConfirmation,content=[];
    content.push({columns:[logo?{image:logo,width:30}:{text:'15M',bold:true,fontSize:18,width:45},{stack:[{text:'15M AUTOCARE SERVICES',bold:true,fontSize:11},{text:'WEEKLY PAYSLIP'+(released?'':' · '+(record.id==='DRAFT'?'DRAFT':'SAVED WORKSHEET')),fontSize:8}],margin:[7,1,0,0]},{text:'Payday: '+p.releaseDate+'\n'+(released?'Released: '+(record.releasedOn||record.releaseConfirmation.date):'Not a release confirmation'),alignment:'right',fontSize:7}],margin:[0,0,0,5]});
    content.push(table(['EMPLOYEE','POSITION','SATURDAY–FRIDAY'],['*','*','*'],[[cell(e.name,{bold:true}),cell(e.position),cell(p.start+' — '+p.end)]]));
    if(record.retainedPaydayCopy)content.push({text:(record.updatedCopy?'UPDATED COPY':'RETAINED PAYMENT RECORDED')+' · Version '+record.version+' · '+(record.weeklyReleased?'Weekly salary released.':'Weekly salary not yet confirmed as received.')+' Previous versions are reference only, not additional pay.',bold:true,fontSize:7,margin:[0,2,0,4]});
    if(c.simpleTest){
      const visible=S.mainRows(c);
      content.push(table(['UNIT / YEAR','INVOICE / PLATE','COLOR','JOB ORDER','AGREED LABOR','BALANCE BEFORE','THIS WEEK'],[90,70,30,'*',62,72,55],visible.length?visible.map(r=>[cell([r.job.unit,r.job.year].filter(Boolean).join('\n')),cell([r.job.invoice,r.job.plate].filter(Boolean).join('\n')),cell(r.job.color),cell(S.itemizedWorkText(r,peso)),r.job.contractPending?cell('Pending confirmation'):money(r.job.contract),r.job.contractPending?cell('Pending confirmation'):money(r.opening),money(r.weekly)]):[[cell('No ongoing unit entries'),cell(''),cell(''),cell(''),cell(''),cell(''),money(0)]]));
    }else{
      content.push({text:'Daily rate: '+peso(e.rate)+' · '+c.rules.hoursPerDay+' hours/day · '+c.paidDays+' paid day(s)',margin:[0,2,0,2]});
      content.push(table(['DATE','ATTENDANCE','LATE','OVERTIME (RECORD)','DEDUCTION','DAY PAY'],[85,'*',55,95,70,70],c.attendance.map(a=>[cell(a.date),cell(a.status),cell((a.lateMinutes||0)+' min'),cell((a.overtimeMinutes||0)+' min'),money(a.deduction),money(a.net)])));
      if(c.advances?.length)content.push(table(['CASH ADVANCE DATE','NOTE','DEDUCTION'],[100,'*',80],c.advances.map(a=>[cell(a.date),cell(a.note||'Cash advance deduction'),money(a.amount)])));
    }
    // Match the print preview: omit only unused zero adjustments, never actual amounts.
    const summary=[['GROSS EARNINGS',c.basic],...(!c.simpleTest?[...(c.late?[['LATE DEDUCTION',-c.late]]:[]),...(c.held?[['RETENTION HELD',-c.held]]:[]),...(c.retentionReleased?[['RETENTION PAID',c.retentionReleased]]:[])]:[]),['LESS CASH ADVANCE',-c.cashAdvance],['TOTAL SALARY',c.net]];
    const totals=table(['SUMMARY','AMOUNT'],['*',95],summary.map(([label,n],i)=>[cell(label,{bold:i===summary.length-1,fillColor:i===summary.length-1?'#fff0c2':null}),{...money(n),bold:i===summary.length-1,fillColor:i===summary.length-1?'#fff0c2':null}]));
    totals.table.body.shift();totals.table.headerRows=0;
    const balances=c.simpleTest?S.balanceRows(c,c.retentionReceipts,record.retentionPreviousPayday??(record.releasedCopy?'':c.period.start)).map(r=>{const info=S.retentionInfo(r,c.retentionReceipts,undefined,c.period.releaseDate);return [cell(r.job.unit+' · '+text(r.job.plate)),cell(r.job.work),r.job.contractPending?cell('Pending confirmation'):money(info.remaining),cell(info.receipt?'Received '+info.receipt.receivedOn+'\n'+peso(info.receipt.amount):'Not yet received'),cell(r.job.unitReleasedOn||r.job.releasedOn||'Not set'),cell(info.due||'Not set')]}):(c.retentionAccounts||[]).filter(a=>a.balance>0).map(a=>[cell(a.job.unit+' · '+a.job.plate),cell(a.job.work),money(a.balance),cell('Retained'),cell(a.job.releasedOn||'Not set'),cell(a.job.retentionEligibleOn||a.job.due||'Not set')]);
    if(balances.length){const balanceTable=table(['UNIT','JOB ORDER','BALANCE','PAYMENT STATUS','UNIT RELEASED','AVAILABLE (+45D)'],[80,'*',60,85,62,65],balances);balanceTable.table.body.unshift([{text:'BALANCE / RETAINED UNITS · NOT ADDED TO THIS WEEK’S PAY',bold:true,colSpan:6},{},{},{},{},{}]);balanceTable.table.headerRows=2;content.push(balanceTable);content.push({text:'Available 45 calendar days after unit release. Receipt confirmations are separate payments already received, not extra weekly salary. No automatic payment.',fontSize:6.5,color:'#465562'});}
    // Historical payment details stay in the immutable snapshot / Job history.
    if(c.retainedPaydayPayments?.length){
      content.push({text:'RETAINED BALANCE RELEASED — THIS PAYDAY',bold:true,fontSize:8,margin:[0,4,0,2]});
      content.push(table(['UNIT / PLATE','ACTUAL DATE RECEIVED','AMOUNT'],['*',140,90],c.retainedPaydayPayments.map(v=>[cell(v.basis.unit+' · '+v.basis.plate),cell(v.receivedOn),money(v.amount)])));
      totals.table.body.at(-1)[0].text='NET WEEKLY SALARY';
      totals.table.body.push([cell('ADD RETAINED BALANCE RELEASED'),money(c.retainedPaydayTotal)]);
      totals.table.body.push([cell(record.weeklyReleased?'TOTAL RECEIVED FOR THIS PAYDAY':'TOTAL FOR THIS PAYDAY · WEEKLY SALARY UNCONFIRMED',{bold:true,fillColor:'#fff0c2'}),{...money(c.paydayTotal),bold:true,fillColor:'#fff0c2'}]);
    }
    content.push({unbreakable:true,stack:[totals,signatures()]});
    return {pageSize:{width:612,height:paper==='full'?792:396},pageMargins:[18,16,18,24],defaultStyle:{font:'Roboto',fontSize:7.5,lineHeight:1},content,footer:(page,pages)=>({text:'15M Payroll · '+e.name+' · Payday '+p.releaseDate+' · '+page+' / '+pages,alignment:'center',fontSize:6,margin:[10,7,10,0]}),info:{title:'15M Payslip — '+e.name+' — '+p.start,author:'15M Autocare Services'}};
  }
  let logoPromise;
  async function logo(){if(!logoPromise)logoPromise=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const canvas=document.createElement('canvas');canvas.width=240;canvas.height=Math.round(img.naturalHeight*240/img.naturalWidth);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/png'))};img.onerror=()=>reject(Error('The 15M logo could not be loaded.'));img.src='15m-logo.png'});return logoPromise}
  async function layout(record,options={}){
    const engine=options.engine||(typeof window!=='undefined'?window.pdfMake:null);
    if(!engine)throw Error('PDF files are not ready. Reload Payroll and try again.');
    const brand=options.logo??(typeof window!=='undefined'?await logo():undefined);
    // The pinned pdfmake renderer measures wrapped text, tables and signature space.
    // Use full bond if either the screen preview or actual half-bond PDF overflows.
    let paper=options.minimumPaper||(typeof window!=='undefined'&&window.PayrollSlips?window.PayrollSlips.paperSize(record):'half');
    const measure=doc=>new Promise((resolve,reject)=>{try{engine.createPdf(doc)._getPages({},pages=>resolve(pages.length))}catch(e){reject(e)}});
    let doc=definition(record,brand,{paper}),pages=await measure(doc);
    if(paper==='half'&&pages>1){paper='full';doc=definition(record,brand,{paper});pages=await measure(doc)}
    // pdfmake annotates definitions during layout; output must use a fresh definition.
    return {paper,pages,definition:definition(record,brand,{paper})};
  }
  async function dataUrl(record){const result=await layout(record);return new Promise((resolve,reject)=>{try{window.pdfMake.createPdf(result.definition).getDataUrl(resolve)}catch(e){reject(e)}})}
  return {definition,dataUrl,layout};
});
