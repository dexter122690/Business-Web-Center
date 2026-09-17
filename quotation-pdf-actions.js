/* Download the exact branded quotation as a PDF file, without opening the
   browser print destination chooser. Print remains a separate user action. */
(function(){
  function loadPopupScript(win,url,ready){
    return new Promise(function(resolve,reject){
      if(ready())return resolve();
      var script=win.document.createElement('script');script.src=url;script.async=true;
      script.onload=function(){ready()?resolve():reject(new Error('PDF tool did not load'))};
      script.onerror=function(){reject(new Error('PDF tool could not load'))};
      win.document.head.appendChild(script);
    });
  }
  function waitForImages(win){
    return Promise.all(Array.prototype.slice.call(win.document.images).map(function(image){
      if(image.complete)return Promise.resolve();
      return new Promise(function(resolve){image.onload=image.onerror=resolve});
    }));
  }
  function cleanFilePart(value){return String(value||'quotation').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'')||'quotation'}
  async function downloadQuotationPdf(){
    if(!window.printQuotation){alert('The quotation is still loading. Please wait a moment and try again.');return}
    var client=(document.getElementById('qtClient')||{}).value||'quotation',date=(document.getElementById('qtDate')||{}).value||new Date().toISOString().slice(0,10),win=window.printQuotation('capture');
    if(!win)return;
    try{
      await waitForImages(win);
      await loadPopupScript(win,'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',function(){return !!win.html2canvas});
      await loadPopupScript(win,'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',function(){return !!(win.jspdf&&win.jspdf.jsPDF)});
      var body=win.document.body,doc=win.document;
      doc.documentElement.style.width='720px';doc.documentElement.style.background='#ffffff';body.style.width='720px';body.style.margin='0';body.style.padding='30px';
      var sizing=win.document.createElement('style');
      sizing.textContent='body{font-size:14px!important}.company{font-size:21px!important}.doc{font-size:20px!important}h2{font-size:19px!important}h3{font-size:16px!important}td,th{padding:9px!important}.total{font-size:21px!important}li{margin-bottom:5px!important}';
      win.document.head.appendChild(sizing);
      var captureWidth=780,captureHeight=Math.max(body.scrollHeight,680),canvas=await win.html2canvas(body,{scale:2,width:captureWidth,height:captureHeight,windowWidth:captureWidth,windowHeight:captureHeight,backgroundColor:'#ffffff',useCORS:true,logging:false});
      var Pdf=win.jspdf.jsPDF,pdf=new Pdf({orientation:'portrait',unit:'pt',format:'letter',compress:true}),width=pdf.internal.pageSize.getWidth(),height=pdf.internal.pageSize.getHeight(),margin=18,usableWidth=width-margin*2,usableHeight=height-margin*2,imageHeight=canvas.height*usableWidth/canvas.width,image=canvas.toDataURL('image/jpeg',0.94),remaining=imageHeight,position=margin;
      pdf.addImage(image,'JPEG',margin,position,usableWidth,imageHeight);remaining-=usableHeight;
      while(remaining>0){position=remaining-imageHeight+margin;pdf.addPage();pdf.addImage(image,'JPEG',margin,position,usableWidth,imageHeight);remaining-=usableHeight}
      pdf.save('Quotation-'+cleanFilePart(client)+'-'+cleanFilePart(date)+'.pdf');
      win.close();
    }catch(error){
      console.error('Quotation PDF download failed:',error);
      alert('The PDF could not be created automatically. The quotation is open—use Print as a fallback.');
      try{win.print()}catch(_){}
    }
  }
  window.downloadQuotationPdf=downloadQuotationPdf;
}());
