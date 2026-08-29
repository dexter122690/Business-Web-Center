/* Printed invoices keep the complete installment history on the original invoice. */
(function(){
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function amount(value){return 'PHP '+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function getInvoices(){try{return JSON.parse(localStorage.getItem('15m-replica-invoices')||'[]')}catch(e){return []}}
  function settings(key,fallback){try{return Object.assign({},fallback,JSON.parse(localStorage.getItem(key)||'{}'))}catch(e){return fallback}}
  function paymentRows(invoice){return (invoice.payments||invoice.invoice_payments||[]).map(function(p){return {date:p.date||p.payment_date||'',method:p.method||p.payment_method||'',reference:p.reference||p.reference_number||'',notes:p.notes||'',amount:Number(p.amount||0)}}).sort(function(a,b){return String(a.date).localeCompare(String(b.date))})}
  async function paymentsFromServer(invoice){
    var known=paymentRows(invoice),db=window.businessSupabase;
    if(!db||!invoice.remoteId)return known;
    try{
      var result=await db.from('invoice_payments').select('payment_date,payment_method,reference_number,notes,amount,created_at').eq('invoice_id',invoice.remoteId).order('payment_date',{ascending:true}).order('created_at',{ascending:true});
      if(result.error||!result.data)return known;
      return result.data.map(function(p){return {date:p.payment_date||'',method:p.payment_method||'',reference:p.reference_number||'',notes:p.notes||'',amount:Number(p.amount||0)}});
    }catch(e){return known}
  }
  async function printInvoice(id){
    var invoice=getInvoices().find(function(x){return String(x.id)===String(id)});
    if(!invoice){alert('Invoice record not found.');return}
    var win=window.open('','_blank');
    if(!win){alert('Allow pop-ups to print the invoice.');return}
    var brand=settings('15m-custom-header',{company:'Your Business Name'}),contact=settings('15m-business-contact',{address:'',phone:'',email:''}),theme=settings('15m-brand-theme',{accent:'#ff5219',text:'#16100d',background:'#ffffff'}),logo=localStorage.getItem('15m-custom-logo')||'';
    var payments=await paymentsFromServer(invoice),paid=Number(invoice.paid||0),total=Number(invoice.total||0),balance=Math.max(0,total-paid);
    /* Older invoices may have a paid total from before installment records existed.
       Show that opening amount as the first entry instead of hiding it. */
    var listed=payments.reduce(function(sum,p){return sum+Number(p.amount||0)},0),opening=paid-listed;
    if(opening>0.009)payments.unshift({date:invoice.date||'',method:invoice.method||'',reference:'Opening recorded payment',notes:'',amount:opening});
    var services=(invoice.services||[]).map(function(x){return '<tr><td>'+esc(x.n)+(x.d?' - '+esc(x.d):'')+'</td><td>'+amount(x.a)+'</td></tr>'}).join('')||'<tr><td colspan="2">No services added.</td></tr>';
    var parts=(invoice.parts||[]).map(function(x){return '<tr><td>'+esc(x.n)+' × '+Number(x.q||0)+'</td><td>'+amount(x.a||Number(x.q||0)*Number(x.p||0))+'</td></tr>'}).join('')||'<tr><td colspan="2">No replacement parts added.</td></tr>';
    var paymentTable=payments.length?'<h3>Payment history</h3><table class="payments"><thead><tr><th>Date</th><th>Method</th><th>Reference / note</th><th>Amount received</th></tr></thead><tbody>'+payments.map(function(p){return '<tr><td>'+esc(p.date)+'</td><td>'+esc(p.method||'—')+'</td><td>'+esc([p.reference,p.notes].filter(Boolean).join(' · ')||'—')+'</td><td>'+amount(p.amount)+'</td></tr>'}).join('')+'</tbody></table>':'<p class="small">No installment records have been added yet.</p>';
    var identity=logo?'<img src="'+esc(logo)+'" alt="Company logo">':'<span class="logo">logo</span>';
    win.document.open();
    win.document.write('<!doctype html><html><head><title>Invoice '+esc(invoice.number)+'</title><style>@page{margin:.45in}body{font:12px Arial;color:'+theme.text+';background:'+theme.background+'}.head{display:flex;gap:13px;align-items:center;border-bottom:3px solid '+theme.accent+';padding-bottom:12px}.head img{max-width:72px;max-height:58px;object-fit:contain}.logo{display:grid;place-items:center;width:54px;height:54px;border:1px solid '+theme.accent+';color:'+theme.accent+';font-weight:bold}.company{font-size:18px;font-weight:bold}.doc{margin-left:auto;color:'+theme.accent+';font-size:18px;font-weight:bold;text-align:right}.doc small{font-size:10px;color:'+theme.text+'}h2{margin:20px 0 8px}h3{margin:16px 0 4px;border-bottom:2px solid '+theme.accent+';padding-bottom:4px}table{width:100%;border-collapse:collapse}td,th{padding:7px;border-bottom:1px solid #ddd;text-align:left}td:last-child,th:last-child{text-align:right}.total{color:'+theme.accent+';font-size:18px;font-weight:bold;text-align:right;margin-top:16px}.summary{text-align:right}.payments{font-size:10px}.small{color:#666}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:52px;text-align:center}.signature-line{border-top:1px solid '+theme.text+';padding-top:6px;min-height:34px}.signature-line b{display:block;font-size:11px}.signature-line small{color:#666}</style></head><body><div class="head"><div>'+identity+'</div><div><div class="company">'+esc(brand.company)+'</div><div>'+esc(contact.address)+'<br>'+esc(contact.phone)+'<br>'+esc(contact.email)+'</div></div><div class="doc">INVOICE<br><small>Invoice No. '+esc(invoice.number)+'</small></div></div><h2>Invoice '+esc(invoice.number)+'</h2><p><b>'+esc(invoice.client)+'</b><br>'+esc(invoice.contact)+'<br>'+esc(invoice.address)+'<br>'+esc(invoice.make)+' '+esc(invoice.yearModel)+' - '+esc(invoice.plate)+'</p><h3>Services</h3><table>'+services+'</table><h3>Parts</h3><table>'+parts+'</table><div class="total">TOTAL '+amount(total)+'</div><p class="summary">Total paid: '+amount(paid)+' | Balance remaining: '+amount(balance)+' | Status: '+esc(invoice.status||'Pending')+'</p>'+paymentTable+'<div class="signatures"><div class="signature-line"><b>'+esc(invoice.admin||'Assigned admin')+'</b><small>Prepared by / Authorized signature</small></div><div class="signature-line"><b>'+esc(invoice.client||'Client')+'</b><small>Received by / Client signature</small></div></div></body></html>');
    win.document.close();setTimeout(function(){win.print()},250);
  }
  function pdfText(value){
    var text=String(value==null?'':value).replace(/[\r\n]+/g,' ').replace(/[–—]/g,'-').replace(/[•·]/g,'-');
    if(text.normalize)text=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    text=text.replace(/[^\x20-\xFF]/g,'?').replace(/[\\()]/g,'\\$&');
    return '('+text+')';
  }
  function wrapPdf(text,width){
    var words=String(text==null?'':text).split(/\s+/),lines=[],line='';
    words.forEach(function(word){var next=line?line+' '+word:word;if(next.length>width&&line){lines.push(line);line=word}else line=next});
    if(line)lines.push(line);return lines.length?lines:[''];
  }
  function downloadFile(name,contents){
    var blob=new Blob([contents],{type:'application/pdf'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url)},1200);
  }
  async function downloadInvoicePdf(id){
    var invoice=getInvoices().find(function(x){return String(x.id)===String(id)});
    if(!invoice){alert('Invoice record not found.');return}
    var brand=settings('15m-custom-header',{company:'Your Business Name'}),contact=settings('15m-business-contact',{address:'',phone:'',email:''});
    var payments=await paymentsFromServer(invoice),paid=Number(invoice.paid||0),total=Number(invoice.total||0),balance=Math.max(0,total-paid);
    var listed=payments.reduce(function(sum,p){return sum+Number(p.amount||0)},0),opening=paid-listed;
    if(opening>0.009)payments.unshift({date:invoice.date||'',method:invoice.method||'',reference:'Opening recorded payment',notes:'',amount:opening});
    var lines=[];
    function add(text,bold,size){wrapPdf(text,size>=15?44:86).forEach(function(row){lines.push({text:row,bold:!!bold,size:size||10})})}
    add(brand.company||'Your Business Name',true,17);add([contact.address,contact.phone,contact.email].filter(Boolean).join(' | ')||' ',false,8);add('INVOICE  '+String(invoice.number||''),true,14);add('');
    add('Bill to: '+String(invoice.client||'Client'),true,11);add([invoice.contact,invoice.address].filter(Boolean).join(' | '));add('Vehicle: '+[invoice.make,invoice.yearModel,invoice.color,invoice.plate].filter(Boolean).join(' | '));add('Invoice date: '+String(invoice.date||'')+(invoice.release?'    Release date: '+invoice.release:''));add('');
    add('SERVICES',true,11);(invoice.services||[]).forEach(function(item){add(String(item.n||'')+(item.d?' - '+item.d:'')+'    '+amount(item.a),false,10)});if(!(invoice.services||[]).length)add('No services added.');
    add('PARTS',true,11);(invoice.parts||[]).forEach(function(item){add(String(item.n||'')+' x '+Number(item.q||0)+'    '+amount(item.a||Number(item.q||0)*Number(item.p||0)),false,10)});if(!(invoice.parts||[]).length)add('No replacement parts added.');
    add('');add('TOTAL: '+amount(total),true,12);add('Total paid: '+amount(paid)+'    Balance remaining: '+amount(balance)+'    Status: '+String(invoice.status||'Pending'));
    if(payments.length){add('');add('PAYMENT HISTORY',true,11);payments.forEach(function(payment){add([payment.date,payment.method,payment.reference||payment.notes,amount(payment.amount)].filter(Boolean).join(' | '))})}
    add('');add('Prepared by: '+String(invoice.admin||'Assigned admin'));add('Received by: '+String(invoice.client||'Client'));
    var pageLines=48,pages=[];for(var start=0;start<lines.length;start+=pageLines)pages.push(lines.slice(start,start+pageLines));
    var objects=['<< /Type /Catalog /Pages 2 0 R >>',''];var pageIds=[],contentIds=[];
    pages.forEach(function(page,index){pageIds.push(3+index*2);contentIds.push(4+index*2)});
    objects[1]='<< /Type /Pages /Kids ['+pageIds.map(function(pageId){return pageId+' 0 R'}).join(' ')+'] /Count '+pages.length+' >>';
    pages.forEach(function(page,index){var commands=['BT /F1 8 Tf 45 815 Td '+pdfText('Invoice '+String(invoice.number||'')+' - Page '+(index+1)+' of '+pages.length)+' Tj ET'],y=790;page.forEach(function(line){commands.push('BT /'+(line.bold?'F2':'F1')+' '+line.size+' Tf 45 '+y+' Td '+pdfText(line.text)+' Tj ET');y-=line.size>=15?25:15});var stream=commands.join('\n');objects[pageIds[index]-1]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 '+(3+pages.length*2)+' 0 R /F2 '+(4+pages.length*2)+' 0 R >> >> /Contents '+contentIds[index]+' 0 R >>';objects[contentIds[index]-1]='<< /Length '+new TextEncoder().encode(stream).length+' >>\nstream\n'+stream+'\nendstream'});
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    var pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n',offsets=[0];objects.forEach(function(object,index){offsets.push(new TextEncoder().encode(pdf).length);pdf+=(index+1)+' 0 obj\n'+object+'\nendobj\n'});var xref=new TextEncoder().encode(pdf).length;pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(function(offset){return String(offset).padStart(10,'0')+' 00000 n \n'}).join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
    downloadFile('Invoice-'+String(invoice.number||'record').replace(/[^a-z0-9_-]+/gi,'-')+'.pdf',pdf);
  }
  window.printInvoice=printInvoice;
  window.downloadInvoicePdf=downloadInvoicePdf;
  setTimeout(function(){window.printInvoice=printInvoice},900);
  setTimeout(function(){window.downloadInvoicePdf=downloadInvoicePdf},900);
})();
