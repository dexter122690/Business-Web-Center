/* Read-only service-category report. Uses invoice dates, not payment dates.
   Service charges are before invoice-wide discounts; no discount is allocated
   to a service, and no invoice, payment, or cash record is written here. */
(function(root,factory){
  var api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {root.BWCServiceReport=api;api.install();}
}(typeof window!=='undefined'?window:null,function(root){
  'use strict';
  var months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var defaults=['Per Panel Repainting','Full Washover Repainting','Exterior Washover','PMS','Ceramic Booster','Tinsmith Job','Dent Repair','Ceramic / Graphene Coating','Paint Protection Film (PPF)','Exterior Detailing','Interior Detailing','Paint Correction / Intensive Buffing','Rubberized Undercoating','Nano Ceramic Tint Installation','Other services'];
  var columns='id,business_id,branch_id,invoice_number,invoice_date,client_name,contact_number,vehicle_make,vehicle_year_model,vehicle_color,plate_number,discount_amount,total_amount,invoice_services(id,service_name,service_detail,amount)';
  var methodNote='Service amounts are before invoice-wide discounts and exclude parts. Invoice discount and final total are shown for reference only, not allocated to a service. This is services invoiced, not cash received.';
  var state={selected:'',rows:[],status:'idle',error:'',key:'',scope:'',version:0,timer:0,installed:false};
  function text(value){return String(value==null?'':value);}
  function esc(value){return text(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function xml(value){return esc(value).replace(/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g,'');}
  function key(value){return text(value).trim().replace(/\s+/g,' ').toLowerCase();}
  function cents(value){var n=Number(value==null?0:value);if(!Number.isFinite(n)||n<0)throw new Error('An invoice contains an invalid amount. Review the invoice before exporting.');return Math.round(n*100);}
  function money(value){return 'PHP '+(value/100).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function periodLabel(p){return (p.month===''?'All months':months[Number(p.month)])+' '+(p.year||'/ All years');}
  function matches(date,p){var value=text(date).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(value)&&(p.month===''||Number(value.slice(5,7))-1===Number(p.month))&&(!p.year||value.slice(0,4)===text(p.year));}
  function clientKey(row){var name=key(row.client_name),contact=text(row.contact_number).replace(/[^0-9a-z]/gi,'').toLowerCase();return name?name+'|'+contact:'unknown:'+row.id;}
  function model(records,p,choice,known){
    var groups=new Map(),seen=new Set(),all=[],noServices=0;
    (known||defaults).forEach(function(name){var k=key(name);if(k&&!groups.has(k))groups.set(k,{key:k,name:text(name).trim(),total:0,invoices:new Set(),clients:new Set()});});
    records.forEach(function(row){
      if(row.business_id!==p.business||row.branch_id!==p.branch||!matches(row.invoice_date,p))return;
      if(!row.id||seen.has(row.id))throw new Error('Duplicate or missing invoice identifier. Refresh the report.');seen.add(row.id);
      var lines=(row.invoice_services||[]).map(function(line){var name=text(line.service_name).trim().replace(/\s+/g,' ')||'Unspecified service',k=key(name);return {key:k,name:name,detail:text(line.service_detail),amount:cents(line.amount)};});
      if(!lines.length){noServices++;return;}
      lines.forEach(function(line){if(!groups.has(line.key))groups.set(line.key,{key:line.key,name:line.name,total:0,invoices:new Set(),clients:new Set()});var group=groups.get(line.key);group.total+=line.amount;group.invoices.add(row.id);group.clients.add(clientKey(row));line.name=group.name;});
      all.push({invoice:row,lines:lines,discount:cents(row.discount_amount),net:cents(row.total_amount),clientKey:clientKey(row)});
    });
    if(choice&&!groups.has(choice))groups.set(choice,{key:choice,name:choice,total:0,invoices:new Set(),clients:new Set()});
    var rows=all.map(function(item){var lines=item.lines.filter(function(line){return !choice||line.key===choice;});return Object.assign({},item,{lines:lines,total:lines.reduce(function(sum,line){return sum+line.amount;},0)});}).filter(function(item){return item.lines.length;});
    return {choice:choice||'',title:choice?groups.get(choice).name:'All services',rows:rows,noServices:noServices,
      total:rows.reduce(function(sum,item){return sum+item.total;},0),clients:new Set(rows.map(function(item){return item.clientKey;})).size,
      allTotal:all.reduce(function(sum,item){return sum+item.lines.reduce(function(n,line){return n+line.amount;},0);},0),allCount:all.length,allClients:new Set(all.map(function(item){return item.clientKey;})).size,
      groups:Array.from(groups.values()).map(function(group){return {key:group.key,name:group.name,total:group.total,count:group.invoices.size,clients:group.clients.size};})};
  }
  async function readRecords(db,p,isCurrent){
    var rows=[],seen=new Set(),expected=null,offset=0;
    while(true){
      if(!isCurrent())return null;
      var query=db.from('invoices').select(columns,{count:'exact'}).eq('business_id',p.business).eq('branch_id',p.branch);
      if(p.year){
        var month=p.month===''?1:Number(p.month)+1,nextMonth=p.month===''?1:month===12?1:month+1,nextYear=Number(p.year)+(p.month===''||month===12?1:0);
        query=query.gte('invoice_date',p.year+'-'+String(month).padStart(2,'0')+'-01').lt('invoice_date',nextYear+'-'+String(nextMonth).padStart(2,'0')+'-01');
      }
      var result=await query.order('invoice_date',{ascending:false}).order('invoice_number',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);
      if(!isCurrent())return null;
      if(result.error)throw result.error;
      if(!Number.isInteger(result.count)||result.count<0)throw new Error('The complete invoice count could not be verified. Please retry.');
      if(expected===null)expected=result.count;
      if(result.count!==expected)throw new Error('Invoices changed while loading. Refresh to get a complete report.');
      var page=result.data||[];
      page.forEach(function(row){if(!row.id||seen.has(row.id))throw new Error('Invoices changed while loading. Refresh the report.');if(row.business_id!==p.business||row.branch_id!==p.branch)throw new Error('Invoice scope could not be verified. Reload the workspace.');seen.add(row.id);rows.push(row);});
      if(rows.length===expected)return rows;
      if(!page.length||rows.length>expected)throw new Error('The complete invoice list could not be loaded. Please retry.');
      offset+=page.length;
    }
  }
  function invoiceNumber(row){return 'INV-'+String(row.invoice_number).padStart(5,'0');}
  function tableHtml(data){
    if(!data.rows.length)return '<p class="service-empty">No invoices with '+esc(data.title.toLowerCase())+' in this period.</p>';
    return '<div class="service-table-scroll"><table aria-label="Service category invoices"><thead><tr>'+['Invoice / date','Client / contact','Vehicle / plate','Matching services / details','Service amount before discount','Whole-invoice discount','Whole-invoice final total','Action'].map(function(label){return '<th scope="col">'+label+'</th>';}).join('')+'</tr></thead><tbody>'+data.rows.map(function(item){var r=item.invoice;return '<tr data-service-invoice="'+esc(r.id)+'"><td><b>'+esc(invoiceNumber(r))+'</b><br>'+esc(r.invoice_date)+'</td><td>'+esc(r.client_name)+'<br><small>'+esc(r.contact_number)+'</small></td><td>'+esc([r.vehicle_make,r.vehicle_year_model].filter(Boolean).join(' '))+'<br><b>'+esc(r.plate_number)+'</b><br><small>'+esc(r.vehicle_color)+'</small></td><td>'+item.lines.map(function(line){return '<div class="service-detail"><b>'+esc(line.name)+'</b>'+(line.detail?'<br>'+esc(line.detail):'')+'<br>'+money(line.amount)+'</div>';}).join('')+'</td><td><b>'+money(item.total)+'</b></td><td>'+money(item.discount)+'</td><td>'+money(item.net)+'</td><td><button type="button" class="secondary" data-service-open="'+esc(r.id)+'">Open invoice</button></td></tr>';}).join('')+'</tbody></table></div>';
  }
  // A small, dependency-free XLSX writer. String cells are explicitly text, so
  // client names/plates beginning with '=' cannot become spreadsheet formulas.
  function join(parts){var size=parts.reduce(function(sum,p){return sum+p.length;},0),out=new Uint8Array(size),offset=0;parts.forEach(function(p){out.set(p,offset);offset+=p.length;});return out;}
  function crc32(bytes){var c=0xffffffff;for(var i=0;i<bytes.length;i++){c^=bytes[i];for(var j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
  function zip(files){
    var encoder=new TextEncoder(),locals=[],central=[],offset=0;
    files.forEach(function(file){var name=encoder.encode(file.name),data=encoder.encode(file.data),crc=crc32(data),header=new Uint8Array(30),h=new DataView(header.buffer);
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);
      var local=join([header,name,data]),entry=new Uint8Array(46),v=new DataView(entry.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(14,33,true);v.setUint32(16,crc,true);v.setUint32(20,data.length,true);v.setUint32(24,data.length,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);locals.push(local);central.push(join([entry,name]));offset+=local.length;
    });
    var directory=join(central),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,directory.length,true);e.setUint32(16,offset,true);return join(locals.concat([directory,end]));
  }
  function letters(index){var result='';for(index++;index;index=Math.floor((index-1)/26))result=String.fromCharCode(65+(index-1)%26)+result;return result;}
  function excelDate(value){return Math.round(Date.parse(text(value).slice(0,10)+'T00:00:00Z')/86400000)+25569;}
  function workbookFiles(data,p){
    var rows=[],merge=[],widths=[18,14,26,20,25,12,17,17,52,21,21,23],headerRow=10;
    function row(values,style){style=style||0;var height=style===1?27:style===2?44:style===3?Math.min(409,Math.max(32,values.reduce(function(max,value,i){return Math.max(max,text(value).split('\n').reduce(function(n,line){return n+Math.max(1,Math.ceil(line.length/(widths[i]||20)));},0));},1)*16)):32;rows.push('<row r="'+(rows.length+1)+'" ht="'+height+'" customHeight="1">'+values.map(function(value,i){var numeric=typeof value==='number',s=style===3?(i===1?5:i>=9?4:0):style;return '<c r="'+letters(i)+(rows.length+1)+'" s="'+s+'"'+(numeric?'><v>'+value+'</v>':' t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is>')+'</c>';}).join('')+'</row>');}
    row(['Services invoiced — '+data.title],1);merge.push('A1:L1');
    row([p.businessName||'BWC','','','',p.branchName||p.branch]);merge.push('A2:D2','E2:L2');
    row(['Invoice period',periodLabel(p)]);
    row(['Matching invoices',data.rows.length,'Unique clients (name + contact)',data.clients]);
    row(['Matching service amount before discount (PHP)','','','','','','','','',data.total/100],4);merge.push('A5:I5');
    row([methodNote]);merge.push('A6:L6');
    row(['Source: existing BWC invoices and service lines for the selected branch.']);merge.push('A7:L7');
    row(['Generated',new Date().toISOString()]);row([]);
    row(['Invoice','Invoice date','Client','Contact','Vehicle','Year model','Plate number','Color','Matching services / details (PHP)','Service amount before discount (PHP)','Whole-invoice discount (PHP)','Whole-invoice final total (PHP)'],2);
    data.rows.forEach(function(item){var r=item.invoice;row([invoiceNumber(r),excelDate(r.invoice_date),text(r.client_name),text(r.contact_number),text(r.vehicle_make),text(r.vehicle_year_model),text(r.plate_number),text(r.vehicle_color),item.lines.map(function(line){return line.name+(line.detail?' — '+line.detail:'')+' ('+money(line.amount)+')';}).join('\n'),item.total/100,item.discount/100,item.net/100],3);});
    if(!data.rows.length){row(['No matching invoices for this category and period.']);merge.push('A11:L11');}
    var lastData=rows.length;row(['MATCHING SERVICE TOTAL','','','','','','','', '',data.total/100],4);merge.push('A'+rows.length+':I'+rows.length);
    row(['Do not add whole-invoice totals across category exports: one invoice may appear in several categories.']);merge.push('A'+rows.length+':L'+rows.length);
    var sheet='<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:L'+rows.length+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="10" topLeftCell="A11" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="32"/><cols>'+widths.map(function(width,i){return '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+width+'" customWidth="1"/>';}).join('')+'</cols><sheetData>'+rows.join('')+'</sheetData>'+(data.rows.length?'<autoFilter ref="A'+headerRow+':L'+lastData+'"/>':'')+'<mergeCells count="'+merge.length+'">'+merge.map(function(ref){return '<mergeCell ref="'+ref+'"/>';}).join('')+'</mergeCells><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>';
    var styles='<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF263445"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    return [
      {name:'[Content_Types].xml',data:'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
      {name:'_rels/.rels',data:'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name:'xl/workbook.xml',data:'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Service category report" sheetId="1" r:id="rId1"/></sheets></workbook>'},
      {name:'xl/_rels/workbook.xml.rels',data:'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
      {name:'xl/styles.xml',data:styles},{name:'xl/worksheets/sheet1.xml',data:sheet}
    ];
  }
  function xlsx(data,p){return zip(workbookFiles(data,p));}
  function byId(id){return root.document.getElementById(id);}
  function context(){var month=byId('im'),year=byId('iy'),picker=byId('onlineBranchPicker');return {business:root.localStorage.getItem('bwc-active-business')||'',branch:root.localStorage.getItem('bwc-active-branch')||'',month:month?month.value:String(new Date().getMonth()),year:year?year.value:String(new Date().getFullYear()),businessName:root.localStorage.getItem('bwc-active-business-name')||'BWC',branchName:picker&&picker.selectedIndex>=0?picker.options[picker.selectedIndex].textContent:'Selected branch'};}
  function contextKey(p){return JSON.stringify([p.business,p.branch,p.month,p.year]);}
  function available(){var view=byId('invoices');return view&&view.dataset.access!=='none';}
  function known(){var field=byId('service');return field?Array.from(field.options).map(function(o){return o.textContent;}):defaults;}
  function options(){var im=byId('im'),iy=byId('iy');if(!im||!iy)return;byId('serviceReportMonth').innerHTML=im.innerHTML;byId('serviceReportMonth').value=im.value;byId('serviceReportYear').innerHTML=iy.innerHTML;byId('serviceReportYear').value=iy.value;}
  function mount(){
    if(byId('serviceCategoryReport'))return true;
    var month=byId('im'),heading=month&&month.closest('.heading');if(!heading)return false;
    var section=root.document.createElement('section');section.id='serviceCategoryReport';section.className='card';section.setAttribute('aria-label','Service Category Report');
    section.innerHTML='<div class="service-report-heading"><div><div class="k">Services invoiced</div><h2>Service Category Report</h2><p id="serviceReportContext"></p></div><div class="filters"><label>Service month<select id="serviceReportMonth"></select></label><label>Service year<select id="serviceReportYear"></select></label><button type="button" class="secondary" data-service-refresh>Refresh</button><button type="button" class="primary" data-service-export disabled>Export Excel</button></div></div><p class="service-report-help">Click a service to see its clients and invoices. Dates follow the Invoice Register, independently of the Dashboard.</p><p class="service-report-help">'+methodNote+'</p><div id="serviceReportContent" aria-live="polite"></div>';
    heading.insertAdjacentElement('beforebegin',section);options();return true;
  }
  function card(name,k,total,count,clients){return '<button type="button" class="service-category-card" data-service-category="'+esc(k)+'" aria-pressed="'+(state.selected===k)+'" aria-controls="serviceCategoryResults"><span>'+esc(name)+'</span><strong>'+money(total)+'</strong><small>'+count+' invoice'+(count===1?'':'s')+' · '+clients+' client'+(clients===1?'':'s')+'</small></button>';}
  function render(){
    if(!mount())return;options();var p=context(),content=byId('serviceReportContent'),exportButton=byId('serviceCategoryReport').querySelector('[data-service-export]');
    byId('serviceReportContext').textContent=p.branchName+' · '+periodLabel(p)+' · Invoice date';
    var ready=available()&&state.status==='ready'&&state.key===contextKey(p);exportButton.disabled=!ready;
    if(!ready){content.innerHTML='<p class="service-empty" role="status">'+esc(!available()?'Invoice access is required to view this report.':state.status==='error'?state.error:'Loading complete service records for this branch…')+'</p>';return;}
    try{
      var data=model(state.rows,p,state.selected,known());
      content.innerHTML='<div class="service-category-grid">'+card('All services','',data.allTotal,data.allCount,data.allClients)+data.groups.map(function(g){return card(g.name,g.key,g.total,g.count,g.clients);}).join('')+'</div><div id="serviceCategoryResults"><div class="service-result-heading"><h3>'+esc(data.title)+' — '+esc(periodLabel(p))+'</h3><p>'+data.rows.length+' matching invoice'+(data.rows.length===1?'':'s')+' · '+data.clients+' unique client'+(data.clients===1?'':'s')+' · <b>'+money(data.total)+'</b> before invoice-wide discounts</p></div>'+tableHtml(data)+'</div><p class="service-report-help">'+(data.noServices?data.noServices+' invoice(s) with no service lines are excluded. ':'')+'An invoice can appear in several categories. Client counts use the saved name and contact number. The complete Invoice Register remains below.</p>';
    }catch(error){state.status='error';state.error=error.message;render();}
  }
  async function refresh(){
    if(!mount())return;var p=context(),version=++state.version,scope=p.business+'|'+p.branch;
    if(scope!==state.scope){state.selected='';state.scope=scope;}state.key=contextKey(p);state.status='loading';state.rows=[];render();
    function current(){return version===state.version&&state.key===contextKey(context())&&available();}
    if(!available())return;
    try{
      var db=root.getBusinessSupabaseClient&&root.getBusinessSupabaseClient();
      if(!db||!p.business||!p.branch)throw new Error('The workspace is still loading. Select a branch, then click Refresh.');
      var records=await readRecords(db,p,current);if(records===null||!current())return;
      state.rows=records;state.status='ready';render();
    }catch(error){if(!current())return;state.status='error';state.error='Service report unavailable: '+(error.message||'Please click Refresh to retry.')+' No partial totals are shown.';render();}
  }
  function schedule(){++state.version;state.status='loading';state.rows=[];render();root.clearTimeout(state.timer);state.timer=root.setTimeout(refresh,100);}
  function exportReport(){
    var p=context();if(!available()||state.status!=='ready'||state.key!==contextKey(p))return;
    var data=model(state.rows,p,state.selected,known()),bytes=xlsx(data,p),blob=new root.Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),link=root.document.createElement('a');
    link.href=root.URL.createObjectURL(blob);link.download='services-'+(p.branchName||p.branch)+'-'+(p.year||'all-years')+'-'+(p.month===''?'all-months':String(Number(p.month)+1).padStart(2,'0'))+'-'+data.title+'.xlsx';link.download=link.download.replace(/[<>:"/\\|?*]/g,'-');root.document.body.appendChild(link);link.click();root.setTimeout(function(){root.URL.revokeObjectURL(link.href);link.remove();},1000);
  }
  function install(){
    if(!root||state.installed)return;state.installed=true;
    var style=root.document.createElement('style');style.textContent='#serviceCategoryReport{margin:20px 0;font-size:16px}#serviceCategoryReport h2{margin:4px 0 8px}.service-report-heading{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}.service-report-heading .filters{flex-wrap:wrap}#serviceReportContext{margin:0;font-size:16px;font-weight:600}#serviceCategoryReport label{font-size:14px}.service-report-help{font-size:14px;line-height:1.5;color:#655b55}.service-category-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:18px 0}.service-category-card{font:inherit;text-align:left;border:1px solid #dfd5ce;border-radius:10px;background:#fff;color:#28221f;padding:14px;display:flex;flex-direction:column;gap:10px;cursor:pointer;min-width:0}.service-category-card span{font-size:14px;font-weight:700;line-height:1.35;overflow-wrap:anywhere}.service-category-card strong{font-size:20px;overflow-wrap:anywhere}.service-category-card small{font-size:13px}.service-category-card:hover{border-color:#be3b12;background:#fff5ef}.service-category-card[aria-pressed="true"]{background:#ff5219;color:#111;border-color:#a7310a}.service-category-card:focus-visible{outline:3px solid #1e4b8c;outline-offset:3px}.service-result-heading{border-top:1px solid #ded4cd;padding-top:12px}.service-result-heading h3{font-size:20px;margin:8px 0}.service-result-heading p{font-size:16px}.service-table-scroll{overflow-x:auto}.service-table-scroll table{min-width:980px}.service-table-scroll th,.service-table-scroll td{font-size:14px;vertical-align:top}.service-table-scroll small{font-size:13px}.service-detail+.service-detail{margin-top:10px;padding-top:10px;border-top:1px solid #eee}.service-empty{padding:24px 0;color:#655b55}@media(max-width:480px){.service-category-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.service-category-card{padding:11px}.service-category-card strong{font-size:17px}}';root.document.head.appendChild(style);
    root.document.addEventListener('click',function(event){
      var categoryButton=event.target.closest('[data-service-category]');
      if(categoryButton){state.selected=categoryButton.dataset.serviceCategory;render();Array.from(root.document.querySelectorAll('[data-service-category]')).some(function(button){if(button.dataset.serviceCategory===state.selected){button.focus();return true;}return false;});return;}
      if(event.target.closest('[data-service-refresh]'))refresh();
      if(event.target.closest('[data-service-export]')){try{exportReport();}catch(error){root.alert('Export could not be created: '+error.message);}}
      var open=event.target.closest('[data-service-open]');
      if(open&&available()&&state.status==='ready'&&state.key===contextKey(context()))root.document.dispatchEvent(new root.CustomEvent('bwc:open-invoice',{detail:{remoteId:open.dataset.serviceOpen}}));
      if(event.target.closest('[data-t="invoices"],[data-restore-tab="invoices"]')&&(state.status!=='ready'||state.key!==contextKey(context())))schedule();
    });
    root.document.addEventListener('change',function(event){
      var id=event.target&&event.target.id;
      if(id==='serviceReportMonth'||id==='serviceReportYear'){var field=byId(id==='serviceReportMonth'?'im':'iy');field.value=event.target.value;field.dispatchEvent(new root.Event('change',{bubbles:true}));}
      else if(id==='im'||id==='iy')schedule();
    });
    ['bwc:branch-ready','bwc:business-ready','bwc:invoices-loaded','bwc:invoice-saved','bwc:invoice-deleted'].forEach(function(name){root.document.addEventListener(name,schedule);});
    root.addEventListener('online',schedule);
    root.addEventListener('load',schedule);mount();
  }
  return {install:install,model:model,matches:matches,readRecords:readRecords,tableHtml:tableHtml,workbookFiles:workbookFiles,xlsx:xlsx,excelDate:excelDate,crc32:crc32};
}));
